"""工作流发现：聚合各站点的 ComfyUI 工作流。

- ComfyUI 官方模板：Comfy-Org/workflow_templates 的 index.json（约 750 个），raw 直链
- Civitai：官方 API 的 `types=Workflows`，结果本身就是工作流包（.zip / .json）
- Hugging Face：`filter=comfyui` 的仓库，用 `expand=siblings` 直接看到文件，按文件名筛出工作流
- ModelScope：关键词搜索后逐个仓库列文件（并发），只保留含工作流文件的仓库
- GitHub：仓库搜索 + Git Trees 列文件（需 token，未认证会很快触发限流）

下载统一走 `/api/workflows/resolve`，落盘到共享工作流目录
`workspace/userdata/default/workflows/`——ComfyUI 以 `--user-directory` 指向它，
所有实例看到的是同一份，不需要往实例目录里复制。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import httpx

from .config import COMFY_DIR, COMFY_ENV_DIR, DATA_DIR, WORKSPACE_WORKFLOWS_DIR, load_settings
from .comfy.runner import active as active_instance, start as start_instance, status as instance_status
from .sources import get_adapter
from .sources.base import RepoInfo, SourceError
from .sources.civitai import pick_cover
from .nodes import extract_classes
from .workflow_covers import local_cover
from .workflow_deps import analyze as analyze_deps, _model_index
from .workflow_models import analyze as analyze_models
from .sources.github import tree_files

HF_API = "https://huggingface.co/api"
MS_API = "https://modelscope.cn"
CIVITAI_API = "https://civitai.com/api/v1"
GH_API = "https://api.github.com"
TEMPLATES_INDEX = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/index.json"
TEMPLATE_WEB = "https://github.com/Comfy-Org/workflow_templates/blob/main/templates"
UA = {"User-Agent": "model-downloader/0.1"}

# 自定义命名 / 分组的侧车文件。
# 不写回工作流 JSON —— 那些文件 ComfyUI 自己也要读，改坏了画布就打不开。
# 键是相对共享工作流目录的路径，移动文件后元数据自然失效（不猜、不跟）。
WORKFLOW_META_PATH = DATA_DIR / "workflow_meta.json"


def is_workflow_file(path: str) -> bool:
    """判断一个文件名是否可能是 ComfyUI 工作流（.json / .zip）。"""
    name = (path or "").rsplit("/", 1)[-1].lower()
    if name.endswith(".zip"):
        return True
    if name.endswith(".json"):
        return any(k in name for k in ("workflow", "comfy", "工作流"))
    return False


# 分词用：下划线 / 连字符 / 标点都算分隔，中文按字保留（中文没有空格分词）
_SEP_RE = re.compile(r"[^0-9a-z\u3400-\u9fff]+")


def _norm_text(value: str) -> str:
    """归一化成「空格分隔的小写词串」。

    `image_minimax_h3_image_edit` 与查询 `minimax h3 image edit` 必须能对上，
    所以分隔符一律折叠成空格——之前直接拿整串做子串匹配，带空格就一定搜不到。
    """
    return _SEP_RE.sub(" ", (value or "").lower()).strip()


def _query_tokens(q: str) -> list[str]:
    return [t for t in _norm_text(q).split(" ") if t]


def _item_haystack(item: dict) -> str:
    parts = [
        item.get("id") or "",
        item.get("name") or "",
        item.get("description") or "",
        " ".join(item.get("tags") or []),
        " ".join(item.get("categories") or []),
        " ".join(item.get("requires") or []),
    ]
    return _norm_text(" ".join(parts))


def _relevance(item: dict, tokens: list[str]) -> int:
    """命中越靠「标题」分数越高；一个词都没命中的返回 -1（应被过滤掉）。"""
    title = _norm_text(item.get("name") or "")
    rid = _norm_text(item.get("id") or "")
    tags = _norm_text(" ".join(item.get("tags") or []))
    desc = _norm_text(item.get("description") or "")
    score = 0
    for token in tokens:
        if token in title:
            score += 6
        elif token in rid:
            score += 4
        elif token in tags:
            score += 2
        elif token in desc:
            score += 1
        else:
            return -1
    return score


def _hot_score(item: dict, now: float | None = None) -> float:
    """模板热度：使用量 + 新上线基线。

    官方模板的 usage 由 ComfyUI 前端上报，刚发布的头几天必然是 0。只按 usage
    排会把所有新模板沉到 760 条的最后——搜「minimax」连排名 19 都进不了前 12。
    这里给 14 天内发布的条目一个线性衰减的基线，让新模板能进第一屏，
    但不会压过真正用得多的老模板。
    """
    usage = float(item.get("downloads") or 0)
    stamp = item.get("updated_at") or ""
    if not stamp:
        return usage
    try:
        published = time.mktime(time.strptime(stamp, "%Y-%m-%d"))
    except ValueError:
        return usage
    age_days = max(0.0, ((now or time.time()) - published) / 86400)
    if age_days >= 14:
        return usage
    return usage + 300.0 * (1 - age_days / 14)


def _interleave(parts: list[list[dict]]) -> list[dict]:
    """按来源轮询合并，保证每个源都能进第一屏。

    之前是各源取 limit 条后按下载量全局排序——官方模板的 usage 只有几千，
    Hugging Face 仓库动辄几十万下载，模板永远排到后面甚至被挤出 limit 之外。
    轮询后第一屏每个源都有几条，官方模板不会再被淹没。
    """
    out: list[dict] = []
    seen: set[str] = set()
    depth = max((len(p) for p in parts), default=0)
    for rank in range(depth):
        for part in parts:
            if rank >= len(part):
                continue
            item = part[rank]
            key = f"{item.get('source')}/{item.get('id')}"
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    return out


def _source_cfg(name: str) -> dict:
    return (load_settings().get("sources") or {}).get(name) or {}


def _item(
    *,
    rid: str,
    name: str,
    author: str,
    source: str,
    description: str,
    downloads: int,
    likes: int,
    tags: list[str],
    url: str,
    updated_at: str,
    files: list[str],
    thumbnail: str = "",
    requires: list[str] | None = None,
) -> dict:
    return {
        "id": rid,
        "name": name or rid.split("/")[-1],
        "author": author,
        "source": source,
        "description": description,
        "downloads": downloads,
        "likes": likes,
        "tags": tags[:6],
        "task": "Workflows",
        "url": url,
        "updated_at": updated_at,
        "files": files,
        "file_count": len(files),
        "target_folder": "workflows",
        "thumbnail": thumbnail,
        "requires": (requires or [])[:8],
    }


def _search_civitai(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    cfg = _source_cfg("civitai")
    # Civitai 的 page 参数对 Workflows 类型无效（实测翻页返回同一批），只取首页
    if page > 1:
        return [], False
    params = {
        "types": "Workflows",
        "limit": max(1, min(int(limit), 50)),
        "sort": "Newest" if sort == "latest" else "Most Downloaded",
        "query": q or "",
    }
    # Civitai 不带 query 时才允许 page，其它情况下 page 会被忽略
    if not q:
        params["page"] = 1
    if cfg.get("full_catalog"):
        params["nsfw"] = "true"
    headers = dict(UA)
    if cfg.get("token"):
        headers["Authorization"] = f"Bearer {cfg['token']}"
    try:
        resp = httpx.get(f"{CIVITAI_API}/models", params=params, headers=headers, timeout=30, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise SourceError(f"Civitai 工作流搜索失败: {exc}") from exc
    if resp.status_code >= 400:
        raise SourceError(f"Civitai 工作流搜索错误 {resp.status_code}")

    web = "https://civitai.red" if cfg.get("full_catalog") else "https://civitai.com"
    items: list[dict] = []
    for m in resp.json().get("items") or []:
        version = (m.get("modelVersions") or [{}])[0]
        files = [f.get("name") for f in (version.get("files") or []) if f.get("name")]
        if not files:
            continue
        stats = m.get("stats") or {}
        base = version.get("baseModel") or ""
        items.append(
            _item(
                rid=str(m.get("id")),
                name=m.get("name") or "",
                author=(m.get("creator") or {}).get("username") or "",
                source="civitai",
                description="",
                downloads=int(stats.get("downloadCount") or 0),
                likes=int(stats.get("favoriteCount") or 0),
                tags=m.get("tags") or [],
                url=f"{web}/models/{m.get('id')}",
                updated_at=(version.get("createdAt") or "")[:10],
                files=files,
                thumbnail=pick_cover(m.get("modelVersions") or [], bool(cfg.get("full_catalog"))),
                requires=[f"底模:{base}"] if base else [],
            )
        )
    return items, len(items) >= limit


def _search_huggingface(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    # 扫描比 limit 更大的候选池：很多 comfyui 仓库只放权重，按文件筛掉后需要更多候选
    # skip 按整个候选池推进，避免相邻页重复
    scan = max(int(limit) * 3, 24)
    params = {
        "filter": "comfyui",
        "limit": min(scan, 100),
        "skip": (max(1, int(page)) - 1) * scan,
        "expand": "siblings",
        "sort": "lastModified" if sort == "latest" else "downloads",
        "direction": "-1",
        "search": q or "workflow",
    }
    try:
        resp = httpx.get(f"{HF_API}/models", params=params, headers=UA, timeout=30)
    except httpx.HTTPError as exc:
        raise SourceError(f"Hugging Face 工作流搜索失败: {exc}") from exc
    if resp.status_code >= 400:
        raise SourceError(f"Hugging Face 工作流搜索错误 {resp.status_code}")

    raw = resp.json()
    items: list[dict] = []
    for m in raw if isinstance(raw, list) else []:
        rid = m.get("id") or ""
        files = [
            s.get("rfilename")
            for s in m.get("siblings") or []
            if is_workflow_file(s.get("rfilename") or "")
        ]
        if not files:
            continue
        tags = [t for t in m.get("tags") or [] if not t.startswith("base_model:")]
        items.append(
            _item(
                rid=rid,
                name=rid.split("/")[-1],
                author=rid.split("/")[0] if "/" in rid else "",
                source="huggingface",
                description="",
                downloads=int(m.get("downloads") or 0),
                likes=int(m.get("likes") or 0),
                tags=tags,
                url=f"https://huggingface.co/{rid}",
                updated_at=(m.get("lastModified") or "")[:10],
                files=files,
            )
        )
    return items[:limit], len(raw) >= max(1, int(limit))


def _ms_files(repo_id: str, cfg: dict) -> list[str]:
    headers = dict(UA)
    if cfg.get("token"):
        headers["Authorization"] = f"Bearer {cfg['token']}"
    try:
        resp = httpx.get(
            f"{MS_API}/api/v1/models/{repo_id}/repo/files",
            params={"Revision": "master", "Root": ""},
            headers=headers,
            timeout=20,
            follow_redirects=True,
        )
    except httpx.HTTPError:
        return []
    if resp.status_code >= 400:
        return []
    data = resp.json().get("Data") or {}
    out: list[str] = []

    def walk(nodes: list) -> None:
        for node in nodes:
            if node.get("Type") == "folder" or node.get("IsFolder"):
                walk(node.get("Files") or node.get("Children") or [])
                continue
            path = node.get("Path") or node.get("Name")
            if path:
                out.append(path)

    walk(data.get("Files") or data.get("Root") or [])
    return out


def _search_modelscope(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    cfg = _source_cfg("modelscope")
    page_size = max(1, min(int(limit) * 2, 50))
    params = {
        "search": q or "workflow",
        "page_size": page_size,
        "page_number": max(1, int(page)),
        "sort": "downloads",
    }
    headers = dict(UA)
    if cfg.get("token"):
        headers["Authorization"] = f"Bearer {cfg['token']}"
    try:
        resp = httpx.get(f"{MS_API}/openapi/v1/models", params=params, headers=headers, timeout=30)
    except httpx.HTTPError as exc:
        raise SourceError(f"ModelScope 工作流搜索失败: {exc}") from exc
    if resp.status_code >= 400:
        raise SourceError(f"ModelScope 工作流搜索错误 {resp.status_code}")

    models = (resp.json().get("data") or {}).get("models") or []

    def probe(m: dict) -> dict | None:
        rid = m.get("id") or ""
        if not rid:
            return None
        files = [p for p in _ms_files(rid, cfg) if is_workflow_file(p)]
        if not files:
            return None
        tags = [t for t in [m.get("license"), m.get("task"), m.get("library")] if t]
        return _item(
            rid=rid,
            name=m.get("display_name") or rid.split("/")[-1],
            author=rid.split("/")[0] if "/" in rid else "",
            source="modelscope",
            description=(m.get("description") or "")[:160],
            downloads=int(m.get("downloads") or 0),
            likes=int(m.get("likes") or 0),
            tags=tags,
            url=f"https://modelscope.cn/models/{rid}",
            updated_at=(m.get("last_updated_time") or m.get("created_at") or "")[:10],
            files=files,
        )

    items: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for item in pool.map(probe, models):
            if item:
                items.append(item)
    return items[:limit], len(models) >= page_size


_TEMPLATES_CACHE: dict = {"at": 0.0, "items": []}
_TEMPLATES_TTL = 600


def _templates() -> list[dict]:
    """官方模板清单（进程内缓存 10 分钟，避免每次搜索拉 800KB 索引）。"""
    now = time.time()
    if _TEMPLATES_CACHE["items"] and now - _TEMPLATES_CACHE["at"] < _TEMPLATES_TTL:
        return _TEMPLATES_CACHE["items"]
    try:
        resp = httpx.get(TEMPLATES_INDEX, headers=UA, timeout=60, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise SourceError(f"ComfyUI 官方模板拉取失败: {exc}") from exc
    if resp.status_code >= 400:
        raise SourceError(f"ComfyUI 官方模板拉取错误 {resp.status_code}")

    items: list[dict] = []
    for module in resp.json() or []:
        module_title = (module.get("title") or "").strip()
        module_cat = (module.get("category") or "").strip()
        for t in module.get("templates") or []:
            name = (t.get("name") or "").strip()
            if not name:
                continue
            thumb = next((x for x in t.get("thumbnail") or [] if x), "")
            if thumb:
                thumb = f"https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/{thumb}"
            requires = [m for m in t.get("models") or [] if m]
            requires += [f"节点:{c}" for c in t.get("requiresCustomNodes") or [] if c]
            entry = _item(
                rid=name,
                name=t.get("title") or name,
                author=t.get("username") or "ComfyUI 官方",
                source="templates",
                description=(t.get("description") or "")[:200],
                downloads=int(t.get("usage") or 0),
                likes=0,
                tags=[x for x in t.get("tags") or [] if x],
                url=f"{TEMPLATE_WEB}/{name}.json",
                updated_at=(t.get("date") or "")[:10],
                files=[f"{name}.json"],
                thumbnail=thumb,
                requires=requires,
            )
            # 分类只用于检索与排序（Image / Video / Audio 这些模块标题），不上界面
            entry["categories"] = [module_title, module_cat]
            items.append(entry)
    _TEMPLATES_CACHE.update(at=now, items=items)
    return items


def _search_templates(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    tokens = _query_tokens(q)
    items = _templates()
    if tokens:
        scored = [(score, it) for it in items if (score := _relevance(it, tokens)) >= 0]
        # 有关键词时先按相关度（标题命中 > 标签 > 描述）；同相关度再排热度。
        # 「最新」是明确的时间语义，就别让相关度打乱日期顺序了。
        if sort == "latest":
            scored.sort(key=lambda pair: pair[1].get("updated_at") or "", reverse=True)
        else:
            scored.sort(key=lambda pair: (pair[0], _hot_score(pair[1])), reverse=True)
        items = [it for _, it in scored]
    elif sort == "latest":
        items = sorted(items, key=lambda x: x.get("updated_at") or "", reverse=True)
    else:
        items = sorted(items, key=lambda x: (_hot_score(x), x.get("updated_at") or ""), reverse=True)
    start = (max(1, int(page)) - 1) * max(1, int(limit))
    end = start + max(1, int(limit))
    return items[start:end], end < len(items)


def _search_github(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    cfg = _source_cfg("github")
    if not cfg.get("token"):
        raise SourceError("GitHub 搜索需要 Access Token（设置 → GitHub）；未认证仅 60 次/小时")
    headers = {**UA, "Accept": "application/vnd.github+json", "Authorization": f"Bearer {cfg['token']}"}
    scan = max(8, int(limit) * 2)
    params = {
        "q": f"comfyui workflow {q or ''}".strip(),
        "sort": "updated" if sort == "latest" else "stars",
        "order": "desc",
        "per_page": min(scan, 50),
        "page": max(1, int(page)),
    }
    try:
        resp = httpx.get(f"{GH_API}/search/repositories", params=params, headers=headers, timeout=30)
    except httpx.HTTPError as exc:
        raise SourceError(f"GitHub 搜索失败: {exc}") from exc
    if resp.status_code in (403, 429):
        raise SourceError("GitHub API 限流，请稍后再试或更换 token")
    if resp.status_code >= 400:
        raise SourceError(f"GitHub 搜索错误 {resp.status_code}")
    repos = resp.json().get("items") or []

    def probe(repo: dict) -> dict | None:
        rid = repo.get("full_name") or ""
        if "/" not in rid:
            return None
        try:
            entries = tree_files(rid, repo.get("default_branch") or "main", cfg)
        except SourceError:
            return None  # 单个仓库列目录失败（空仓库/限流）不影响整页
        files = [path for path, _ in entries if is_workflow_file(path)]
        if not files:
            return None
        return _item(
            rid=rid,
            name=rid.split("/")[-1],
            author=(repo.get("owner") or {}).get("login") or rid.split("/")[0],
            source="github",
            description=(repo.get("description") or "")[:160],
            downloads=int(repo.get("stargazers_count") or 0),
            likes=int(repo.get("forks_count") or 0),
            tags=list(repo.get("topics") or []),
            url=repo.get("html_url") or f"https://github.com/{rid}",
            updated_at=(repo.get("updated_at") or "")[:10],
            files=files[:20],
            thumbnail=(repo.get("owner") or {}).get("avatar_url") or "",
        )

    items: list[dict] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item in pool.map(probe, repos):
            if item:
                items.append(item)
    return items[:limit], len(repos) >= max(1, int(limit))


_SEARCHERS: dict[str, Callable[..., tuple[list[dict], bool]]] = {
    "templates": _search_templates,
    "huggingface": _search_huggingface,
    "modelscope": _search_modelscope,
    "civitai": _search_civitai,
    "github": _search_github,
}


def search(q: str, source: str = "all", limit: int = 12, page: int = 1, sort: str = "downloads") -> dict:
    """聚合搜索工作流，单源失败不影响其它源。"""
    names = [source] if source in _SEARCHERS else list(_SEARCHERS)
    # 没配 GitHub token 时，"全部来源"跳过 GitHub（必然限流，避免每次都弹错误）
    if source not in _SEARCHERS and not _source_cfg("github").get("token"):
        names = [name for name in names if name != "github"]
    parts: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    done = True
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        futures = {pool.submit(_SEARCHERS[name], q, limit, page, sort): name for name in names}
        for future, name in futures.items():
            try:
                part, has_more = future.result()
                parts[name] = part
                # has_more=False 表示该源已经到底；所有源都到底才算 done
                done = done and not has_more
            except SourceError as exc:
                errors[name] = str(exc)
    # 按 names 的固定顺序轮询合并：单源结果内保持它自己的排序
    ordered = [parts[name] for name in names if parts.get(name)]
    items = _interleave(ordered) if len(ordered) > 1 else (ordered[0] if ordered else [])
    return {"items": items, "errors": errors, "done": done}


def resolve(source: str, repo_id: str, revision: str = "") -> dict:
    """解析工作流仓库，只返回工作流文件（.json / .zip）。"""
    cfg = _source_cfg(source)
    if not cfg:
        raise SourceError(f"未配置的下载源: {source}")
    repo: RepoInfo = get_adapter(source).resolve(repo_id, revision, cfg)
    # Civitai / 官方模板的结果本身就是工作流，不再按文件名过滤
    if source in ("civitai", "templates"):
        files = repo.files
    else:
        files = [f for f in repo.files if is_workflow_file(f.path)]
    if not files:
        raise SourceError("该仓库没有工作流文件（.json / .zip）")
    payload = repo.to_dict()
    payload["files"] = [{"path": f.path, "size": f.size, "candidates": f.candidates} for f in files]
    payload["target_folder"] = "workflows"
    return payload


def instances() -> list[dict]:
    """本机 ComfyUI 实例（comfy/<name>/ComfyUI）。

    工作流已改为共享目录，所有实例看到的是同一份，所以 workflows_dir 一律
    指向 workspace/userdata/default/workflows。
    """
    out: list[dict] = []
    if not COMFY_DIR.is_dir():
        return out
    shared = WORKSPACE_WORKFLOWS_DIR
    count = len(list(shared.glob("*.json"))) if shared.is_dir() else 0
    for child in sorted(COMFY_DIR.iterdir()):
        if child.name.startswith("."):
            continue  # .environment 是共享基础环境，不是实例
        comfy = child / "ComfyUI"
        if not comfy.is_dir():
            continue
        out.append(
            {
                "name": child.name,
                "path": str(comfy),
                "workflows_dir": str(shared),
                "count": count,
            }
        )
    return out


# ---------------- 工作流文件写入 ----------------
def _looks_like_workflow(data: bytes) -> bool:
    """ComfyUI 工作流一定带 nodes；仓库里的配置类 json 不能摊进面板。"""
    try:
        payload = json.loads(data.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return False
    if not isinstance(payload, dict):
        return False
    return isinstance(payload.get("nodes"), list) or isinstance(payload.get("workflow"), dict)


def _write_unique(directory: Path, name: str, data: bytes) -> str:
    """同名不覆盖：追加 -2、-3 后缀。"""
    target = directory / name
    if target.exists():
        stem, suffix = Path(name).stem, Path(name).suffix
        index = 2
        while (directory / f"{stem}-{index}{suffix}").exists():
            index += 1
        target = directory / f"{stem}-{index}{suffix}"
    target.write_bytes(data)
    return target.name


def _json_from_archive(directory: Path, archive: Path) -> list[str]:
    """解开一个 zip：只取工作流 json 平铺到目录，成功后删掉压缩包。"""
    saved: list[str] = []
    try:
        with zipfile.ZipFile(archive) as zf:
            for name in zf.namelist():
                if name.startswith("__MACOSX") or name.endswith("/"):
                    continue
                if not name.lower().endswith(".json"):
                    continue
                data = zf.read(name)
                if not _looks_like_workflow(data):
                    continue
                saved.append(_write_unique(directory, Path(name).name, data))
    except (zipfile.BadZipFile, OSError):
        return saved
    archive.unlink(missing_ok=True)
    return saved


def extract_workflow_archives(directory: Path) -> list[str]:
    """把目录下的 .zip 全部解成工作流 json（下载任务收尾时调用）。"""
    if not directory.is_dir():
        return []
    saved: list[str] = []
    for archive in sorted(directory.glob("*.zip")):
        saved.extend(_json_from_archive(directory, archive))
    return saved


def import_to_instance(source: str, repo_id: str, instance: str = "", revision: str = "") -> dict:
    """把工作流下载到共享工作流目录。

    `instance` 只为兼容旧调用保留：工作流对所有实例共享，不再复制进实例目录。
    """
    repo = resolve(source, repo_id, revision)
    headers = dict(UA)
    if source == "github" and _source_cfg(source).get("token"):
        headers["Authorization"] = f"Bearer {_source_cfg(source)['token']}"

    dest = WORKSPACE_WORKFLOWS_DIR / repo["display_name"].replace("/", "--")
    dest.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for f in repo["files"]:
        url = (f.get("candidates") or [""])[0]
        if not url:
            continue
        try:
            resp = httpx.get(url, headers=headers, timeout=60, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise SourceError(f"下载失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"下载失败 {resp.status_code}: {f['path']}")
        if f["path"].lower().endswith(".zip"):
            tmp = dest / Path(f["path"]).name
            tmp.write_bytes(resp.content)
            saved.extend(_json_from_archive(dest, tmp))
        elif _looks_like_workflow(resp.content):
            saved.append(_write_unique(dest, Path(f["path"]).name, resp.content))
    if not saved:
        raise SourceError("没有可导入的工作流文件（.json）")
    return {"instance": instance, "dir": str(dest), "files": saved}


# ---------------- 本地工作流（「我的工作流」） ----------------
MAX_WORKFLOW_BYTES = 8 * 1024 * 1024


def _shape(payload: object) -> tuple[int, str]:
    """返回 (节点数, 格式)。UI 格式是 {nodes:[...]}；API 格式是 {id:{class_type}} 的扁平表。"""
    if not isinstance(payload, dict):
        return 0, "unknown"
    nodes = payload.get("nodes")
    if isinstance(nodes, list):
        return len(nodes), "ui"
    inner = payload.get("workflow")
    if isinstance(inner, dict) and isinstance(inner.get("nodes"), list):
        return len(inner["nodes"]), "ui"
    if payload and all(isinstance(v, dict) and "class_type" in v for v in payload.values()):
        return len(payload), "api"
    return 0, "unknown"


# ---------------- 自定义命名 / 分组（侧车元数据） ----------------

def load_meta() -> dict:
    """读侧车元数据。文件坏了不该拖垮整个列表 —— 退回空表。"""
    try:
        raw = WORKFLOW_META_PATH.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def save_meta(data: dict) -> None:
    WORKFLOW_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = WORKFLOW_META_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(WORKFLOW_META_PATH)


def _rel_key(path: Path) -> str:
    """工作流文件相对共享目录的路径，作为侧车键。"""
    try:
        return path.resolve().relative_to(WORKSPACE_WORKFLOWS_DIR.resolve()).as_posix()
    except ValueError:
        return path.name


def meta_groups(meta: dict) -> list[dict]:
    """分组清单：名称 + 条数（按名称排序）。空分组不列。"""
    counts: dict[str, int] = {}
    for entry in meta.values():
        if not isinstance(entry, dict):
            continue
        g = (entry.get("group") or "").strip()
        if g:
            counts[g] = counts.get(g, 0) + 1
    return [{"name": g, "count": c} for g, c in sorted(counts.items())]


def set_meta(path: str, title: str = "", group: str = "", rename_file: bool = False) -> dict:
    """设置某条工作流的自定义名与分组。

    - title 为空 → 清除自定义名（回落文件名）
    - group 为空 → 取消分组
    - rename_file=True 时同时把真实文件改名（ComfyUI 里也会显示新名字）
    """
    root = WORKSPACE_WORKFLOWS_DIR.resolve()
    target = Path(path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise SourceError("只能整理共享工作流目录里的文件") from exc
    if not target.is_file():
        raise SourceError("文件不存在，可能已被移动或删除")

    title = (title or "").strip()
    group = (group or "").strip()
    if len(title) > 80:
        raise SourceError("名称太长了")
    if len(group) > 24:
        raise SourceError("分组名太长了")

    key = _rel_key(target)
    meta = load_meta()
    # 重建而不是就地改：旧条目里可能只剩 updated_at，
    # 就地 pop 会把它留下来 → 清空后变成只有时间戳的空壳条目。
    entry: dict = {}
    if title:
        entry["title"] = title
    if group:
        entry["group"] = group
    if entry:
        entry["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        meta[key] = entry
    else:
        meta.pop(key, None)
    save_meta(meta)

    renamed = ""
    new_key = key
    if rename_file and title:
        safe = re.sub(r'[\\/:*?"<>|]+', "_", title).strip() or target.stem
        new_path = target.with_name(f"{safe}.json")
        if new_path != target and not new_path.exists():
            target.rename(new_path)
            renamed = new_path.name
            # 文件改名了，侧车键也得跟着换，否则自定义名会丢
            new_key = _rel_key(new_path)
            if new_key != key:
                entry = meta.pop(key, None)
                if entry:
                    meta[new_key] = entry
                save_meta(meta)

    return {"title": title, "group": group, "file": renamed, "key": new_key}


def local() -> dict:
    """共享工作流目录里的本地工作流。

    只数节点，不解析依赖——「这条工作流缺哪个模型/节点」是下一步的事。
    目录里可能混着 ComfyUI 自己的配置文件，认不出工作流形状的直接跳过。
    解析失败的文件也要列出来（error + 行号），不能被 ValueError 静默吞掉。

    顺带解析主模型（main_model + model_slots）：家族徽标要靠它，
    前端用现成的 FAMILIES 表判定，不需要后端再实现一遍正则。
    """
    root = WORKSPACE_WORKFLOWS_DIR
    meta = load_meta()
    items: list[dict] = []
    # 模型索引整批只扫一遍：5 条工作流共用一份，别每条都 rglob 一次
    model_index = _model_index()
    if root.is_dir():
        for path in root.rglob("*.json"):
            try:
                stat = path.stat()
                if stat.st_size > MAX_WORKFLOW_BYTES:
                    continue
                raw = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            key = _rel_key(path)
            entry = meta.get(key) if isinstance(meta.get(key), dict) else {}
            title = (entry.get("title") or "").strip()
            group = (entry.get("group") or "").strip()
            try:
                payload = json.loads(raw)
            except ValueError as exc:
                # 坏文件仍占位可见：错误信息直接进卡片封面图区，不另开错误区
                # 语法坏了照样能认主模型 —— 文本兜底扫文件名，
                # 坏文件也得显示家族徽标，不能因为解析失败就变成一张没有身份的白卡
                info = analyze_models(None, raw)
                deps = analyze_deps(info["slots"], set(), model_index=model_index)
                items.append(
                    {
                        "name": path.stem,
                        "key": key,
                        "title": title,
                        "group": group,
                        "path": str(path),
                        "folder": "",
                        "size": stat.st_size,
                        "mtime": int(stat.st_mtime),
                        "nodes": 0,
                        "format": "broken",
                        "error": str(exc),
                        "error_line": _error_line(raw, exc),
                        "main_model": info["main_file"],
                        "model_slots": info["slots"],
                        "deps": deps["models"],
                        "node_deps": deps["nodes"],
                        "cover": local_cover(str(path)),
                    }
                )
                continue
            nodes, fmt = _shape(payload)
            if fmt == "unknown":
                continue
            parent = path.parent.relative_to(root)
            # 主模型：家族徽标与依赖清单都从它出发
            info = analyze_models(payload, raw)
            # 节点包依赖：先取工作流用到的节点类型，再反查「哪个包提供它、装没装」。
            # extract_classes 只认真节点容器（子图槽位里的 {"type":"CLIP"} 是数据类型
            # 标注不是节点），所以不会一屏误报。
            classes = extract_classes(payload)
            deps = analyze_deps(info["slots"], classes, model_index=model_index)
            items.append(
                {
                    "name": path.stem,
                    "key": key,
                    "title": title,
                    "group": group,
                    "path": str(path),
                    "folder": "" if parent == Path(".") else parent.as_posix(),
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "nodes": nodes,
                    "format": fmt,
                    "main_model": info["main_file"],
                    "model_slots": info["slots"],
                    "deps": deps["models"],
                    "node_deps": deps["nodes"],
                    "cover": local_cover(str(path), payload),
                }
            )
    items.sort(key=lambda it: it["mtime"], reverse=True)
    return {
        "dir": str(root),
        "total": len(items),
        "items": items,
        "groups": meta_groups(meta),
    }


def _error_line(raw: str, exc: ValueError) -> int:
    """从 JSONDecodeError 里取行号（1 起）；解析不出就返回 0。"""
    line = getattr(exc, "lineno", 0)
    return int(line) if isinstance(line, int) and line > 0 else 0


def _inside_workflows(path: str) -> Path:
    """路径必须落在共享工作流目录内，且确实是个文件。"""
    root = WORKSPACE_WORKFLOWS_DIR.resolve()
    target = Path(path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise SourceError("只能操作共享工作流目录里的文件") from exc
    if not target.is_file():
        raise SourceError("文件不存在，可能已被移动或删除")
    return target


def _open_command(target: Path, mode: str) -> list[str] | None:
    """要执行的命令。返回 None 表示走 Windows 的 `os.startfile`（另起进程的方式不同）。"""
    if mode == "edit":
        if os.name == "nt":
            return None
        return ["open", str(target)] if sys.platform == "darwin" else ["xdg-open", str(target)]
    if os.name == "nt":
        return ["explorer", "/select,", str(target)]
    if sys.platform == "darwin":
        return ["open", "-R", str(target)]
    return ["xdg-open", str(target.parent)]


def open_local(path: str, mode: str = "reveal") -> dict:
    """在文件管理器里定位，或用系统默认程序打开这个工作流。

    `mode="edit"` 走默认关联程序：Windows 上是 os.startfile，Linux/macOS 是
    `xdg-open` / `open`。语法坏掉的 JSON 只有这条路能改 —— 画布打不开它。
    """
    target = _inside_workflows(path)
    cmd = _open_command(target, mode)
    if cmd is None:
        os.startfile(str(target))  # noqa: S606  # 用户明确点了「用编辑器打开」
    else:
        subprocess.Popen(cmd)  # noqa: S603
    return {"opened": str(target), "mode": mode}


def delete_local(path: str) -> dict:
    """删除一条本地工作流，同时清掉它的侧车命名/分组。

    侧车键是「相对路径」，删文件后必须一起清，否则以后放回同名文件会继承旧名字。
    """
    target = _inside_workflows(path)
    key = _rel_key(target)
    try:
        target.unlink()
    except OSError as exc:
        raise SourceError(f"删除失败：{exc.strerror or exc}") from exc
    meta = load_meta()
    if key in meta:
        meta.pop(key, None)
        save_meta(meta)
    return {"deleted": str(target), "key": key}


def _latest_instance() -> str:
    """最近安装的可用实例。没有就返回空串。"""
    best, best_at = "", 0.0
    if not COMFY_DIR.is_dir():
        return ""
    for child in COMFY_DIR.iterdir():
        if not child.is_dir() or child.name.startswith("."):
            continue
        if not (child / "ComfyUI" / "main.py").is_file():
            continue
        at = (child / "ComfyUI" / "main.py").stat().st_mtime
        if at > best_at:
            best, best_at = child.name, at
    return best


def _ui_ready(name: str) -> bool:
    """实例能不能真的打开画布。

    前端包（comfyui-frontend-package）不在 requirements 的常规依赖里，
    依赖装到一半中断时最容易缺它 —— 这时后端能跑、端口能通，但打开是一片白，
    比报错更让人困惑。所以先把话说清楚。
    """
    if (COMFY_ENV_DIR / "site-packages" / "comfyui_frontend_package" / "static").is_dir():
        return True
    return (COMFY_DIR / name / "ComfyUI" / "web" / "index.html").is_file()


def _log_tail(path: str, lines: int = 3) -> str:
    """实例日志的最后几行 —— 启动失败时，真正的原因在这儿而不在 HTTP 层。"""
    if not path:
        return ""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    keep = [row.strip() for row in text.splitlines() if row.strip() and not row.startswith("#")]
    return " / ".join(keep[-lines:])


def use_local(path: str) -> dict:
    """使用工作流：确保有实例在跑，返回画布地址。

    ComfyUI 0.45 的前端没有「按名字打开某条工作流」的深链（路由只有画布根），
    所以这里负责把环境准备好并把画布地址给出去；工作流本身已经在
    `--user-directory` 指向的共享目录里，画布左侧「工作流」即可看到。
    """
    target = _inside_workflows(path)
    running = active_instance()
    if running is None:
        name = _latest_instance()
        if not name:
            raise SourceError("还没有可用的 ComfyUI 实例，请先到「环境管理」安装一个")
        try:
            start_instance(name)
        except (RuntimeError, ValueError) as exc:
            raise SourceError(str(exc)) from exc
        # 首次启动要 import torch 并扫模型目录，给它 20 秒；起不来就把日志尾巴带出来，
        # 依赖缺件（比如 comfy_aimdo）是这一步最常见的原因
        info = instance_status(name, wait=20)
        if info.get("state") != "running":
            if info.get("state") == "stopped":
                tail = _log_tail(info.get("log") or "")
                raise SourceError("实例启动失败：" + (tail or "进程已退出，详情见环境管理页的日志"))
            raise SourceError("实例还在启动中，等十几秒再点一次通常就好了")
        running = {"name": info["name"], "url": info["url"], "port": info.get("port")}
    url = running.get("url") or ""
    if not url:
        raise SourceError("实例正在启动，请稍后重试")
    if not _ui_ready(running.get("name") or ""):
        raise SourceError("实例缺少 ComfyUI 前端包，画布打不开 —— 请到「环境管理」补齐依赖")
    return {
        "url": url,
        "instance": running.get("name") or "",
        "name": target.stem,
        "folder": _rel_key(target).rsplit("/", 1)[0] if "/" in _rel_key(target) else "",
    }
