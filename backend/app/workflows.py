"""工作流发现：聚合各站点的 ComfyUI 工作流。

- ComfyUI 官方模板：Comfy-Org/workflow_templates 的 index.json（约 750 个），raw 直链
- Civitai：官方 API 的 `types=Workflows`，结果本身就是工作流包（.zip / .json）
- Hugging Face：`filter=comfyui` 的仓库，用 `expand=siblings` 直接看到文件，按文件名筛出工作流
- ModelScope：关键词搜索后逐个仓库列文件（并发），只保留含工作流文件的仓库
- GitHub：仓库搜索 + Git Trees 列文件（需 token，未认证会很快触发限流）

下载统一走 `/api/workflows/resolve`，落盘目录固定为 `workflows`。
"""
from __future__ import annotations

import io
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import httpx

from .config import ROOT, load_settings
from .sources import get_adapter
from .sources.base import RepoInfo, SourceError
from .sources.civitai import pick_cover
from .sources.github import tree_files

HF_API = "https://huggingface.co/api"
MS_API = "https://modelscope.cn"
CIVITAI_API = "https://civitai.com/api/v1"
GH_API = "https://api.github.com"
TEMPLATES_INDEX = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/index.json"
TEMPLATE_WEB = "https://github.com/Comfy-Org/workflow_templates/blob/main/templates"
UA = {"User-Agent": "model-downloader/0.1"}


def is_workflow_file(path: str) -> bool:
    """判断一个文件名是否可能是 ComfyUI 工作流（.json / .zip）。"""
    name = (path or "").rsplit("/", 1)[-1].lower()
    if name.endswith(".zip"):
        return True
    if name.endswith(".json"):
        return any(k in name for k in ("workflow", "comfy", "工作流"))
    return False


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
        for t in module.get("templates") or []:
            name = (t.get("name") or "").strip()
            if not name:
                continue
            thumb = next((x for x in t.get("thumbnail") or [] if x), "")
            if thumb:
                thumb = f"https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/{thumb}"
            requires = [m for m in t.get("models") or [] if m]
            requires += [f"节点:{c}" for c in t.get("requiresCustomNodes") or [] if c]
            items.append(
                _item(
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
            )
    _TEMPLATES_CACHE.update(at=now, items=items)
    return items


def _search_templates(q: str, limit: int, page: int, sort: str = "downloads") -> tuple[list[dict], bool]:
    keyword = (q or "").strip().lower()
    items = _templates()
    if keyword:
        items = [
            it
            for it in items
            if keyword
            in f"{it['name']} {it['id']} {it['description']} {' '.join(it['tags'])}".lower()
        ]
    if sort == "latest":
        items = sorted(items, key=lambda x: x.get("updated_at") or "", reverse=True)
    else:
        items = sorted(items, key=lambda x: x.get("downloads") or 0, reverse=True)
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
    items: list[dict] = []
    errors: dict[str, str] = {}
    done = True
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        futures = {pool.submit(_SEARCHERS[name], q, limit, page, sort): name for name in names}
        for future, name in futures.items():
            try:
                part, has_more = future.result()
                items.extend(part)
                # has_more=False 表示该源已经到底；所有源都到底才算 done
                done = done and not has_more
            except SourceError as exc:
                errors[name] = str(exc)
    if sort == "latest":
        items.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    else:
        items.sort(key=lambda x: x.get("downloads") or 0, reverse=True)
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
    """本机 ComfyUI 实例（comfy/<name>/ComfyUI），用于"导入工作流"。"""
    root = ROOT / "comfy"
    out: list[dict] = []
    if not root.is_dir():
        return out
    for child in sorted(root.iterdir()):
        if child.name.startswith("."):
            continue  # .environment 是共享基础环境，不是实例
        comfy = child / "ComfyUI"
        if not comfy.is_dir():
            continue
        wf = comfy / "user" / "default" / "workflows"
        count = len(list(wf.glob("*.json"))) if wf.is_dir() else 0
        out.append({"name": child.name, "path": str(comfy), "workflows_dir": str(wf), "count": count})
    return out


def import_to_instance(source: str, repo_id: str, instance: str, revision: str = "") -> dict:
    """把工作流直接下载并放进实例的 user/default/workflows/，供 ComfyUI 工作流面板直接打开。"""
    inst = next((i for i in instances() if i["name"] == instance), None)
    if not inst:
        raise SourceError(f"找不到 ComfyUI 实例: {instance}")
    repo = resolve(source, repo_id, revision)
    headers = dict(UA)
    if source == "github" and _source_cfg(source).get("token"):
        headers["Authorization"] = f"Bearer {_source_cfg(source)['token']}"

    dest = Path(inst["workflows_dir"]) / repo["display_name"].replace("/", "--")
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
            with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".json") and not name.startswith("__MACOSX"):
                        (dest / Path(name).name).write_bytes(zf.read(name))
                        saved.append(Path(name).name)
        else:
            (dest / Path(f["path"]).name).write_bytes(resp.content)
            saved.append(Path(f["path"]).name)
    if not saved:
        raise SourceError("没有可导入的工作流文件（.json）")
    return {"instance": inst["name"], "dir": str(dest), "files": saved}
