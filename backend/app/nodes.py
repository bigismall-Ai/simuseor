"""节点发现与节点管理。

数据来源是 ComfyUI-Manager 的两份清单（都在 GitHub raw 上，免 token）：

- `custom-node-list.json`：6038 个节点扩展，含标题、作者、描述、仓库地址、
  安装方式（`git-clone` 5998 条，其余是 copy / unzip）
- `extension-node-map.json`：5731 个仓库 → 提供的节点类名（共 45849 个），
  其中 `comfyanonymous/ComfyUI` 一项是 1081 个核心节点

清单里的 `category` / `tags` / `stars` / `last_update` 实测几乎全空
（category 6031/6038 为空，stars 只有 1 条），所以排序和筛选都不能靠它们；
能用的信号是「这个扩展提供了多少节点类」——按规模排序，搜索时连节点类名一起匹配，
用户搜 `SAM` 能直接找到 Impact Pack。

节点装在 `workspace/custom_nodes/`，实例以 `--base-directory workspace` 启动，
所以所有实例共享同一份；卸载节点不会动模型和工作流。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from .config import (
    COMFY_ENV_NAME,
    DATA_DIR,
    WORKSPACE_CUSTOM_NODES_DIR,
    WORKSPACE_WORKFLOWS_DIR,
    gh_proxy,
    gh_url,
    load_settings,
)
from .node_categories import CATEGORIES, category_of
from .sources.base import SourceError

CNL_URL = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/custom-node-list.json"
NODE_MAP_URL = "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/extension-node-map.json"

# 原始清单落盘一份：断网也能继续浏览，冷启动不用等 5MB 下载
CACHE_DIR = DATA_DIR / "nodes"
CNL_PATH = CACHE_DIR / "custom-node-list.json"
NODE_MAP_PATH = CACHE_DIR / "extension-node-map.json"
META_PATH = CACHE_DIR / "meta.json"

CATALOG_TTL = 24 * 3600
DISABLED_SUFFIX = ".disabled"
CORE_REPO = "comfyanonymous/comfyui"
UA = {"User-Agent": "model-downloader/0.1"}

# 工作流里会出现但不是真节点的类型：注释、转接点、子图实例（UUID）
UI_TYPES = {"Note", "Reroute", "PrimitiveNode", "MarkdownNote"}
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
# 静态扫 NODE_CLASS_MAPPINGS 的键（不 import，绝不执行节点代码）
_CLASS_KEY_RE = re.compile(r"""["']([^"'\n]{2,80})["']\s*:""")
_MAPPING_RE = re.compile(r"NODE_CLASS_MAPPINGS\s*=\s*\{")
# 显示名也要收：有些节点的 workflow 里存的是 "Power Lora Loader (rgthree)"
# 这种显示名，而不是类名 RgthreePowerLoraLoader，只按类名比对会误报
_DISPLAY_RE = re.compile(r"NODE_DISPLAY_NAME_MAPPINGS\s*=\s*\{")
_DISPLAY_VALUE_RE = re.compile(r"""["'][^"'\n]{2,80}["']\s*:\s*["']([^"'\n]{2,80})["']""")

_lock = threading.RLock()
_cache: dict[str, Any] = {"at": 0.0, "items": [], "by_id": {}, "owner": {}, "core": set(), "classes": {}}
_warming = False

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_busy: set[str] = set()


# ---------------- 地址归一化 ----------------
def _norm(url: str) -> str:
    """仓库地址归一化：去协议、去 www、去 .git、去尾斜杠、转小写。"""
    text = (url or "").strip()
    if not text:
        return ""
    text = text.split("#", 1)[0].split("?", 1)[0]
    text = re.sub(r"^[a-z]+://", "", text, flags=re.I)
    text = re.sub(r"^www\.", "", text, flags=re.I)
    text = text.rstrip("/")
    if text.lower().endswith(".git"):
        text = text[: -len(".git")]
    return text.lower()


def _slug(url: str) -> str:
    """github.com/owner/repo → owner/repo。

    清单里的 reference 有时会带 `/tree/main` 之类的路径，只取前两段路径，
    否则同一仓库会分裂成不同 id，去重和已装识别都会失效。
    """
    norm = _norm(url)
    if not norm:
        return ""
    parts = [p for p in norm.split("/") if p]
    if not parts:
        return ""
    if parts[0] in ("github.com", "gitlab.com", "bitbucket.org", "codeberg.org"):
        return f"{parts[1]}/{parts[2]}" if len(parts) >= 3 else parts[-1]
    if len(parts) >= 2:
        # gitee 之类可能有 group/sub/repo 多层，取最后两段更稳
        return f"{parts[-2]}/{parts[-1]}"
    return parts[0]


def _dir_name(url: str) -> str:
    """克隆目录名：仓库名，只保留安全字符。"""
    norm = _norm(url)
    tail = norm.rsplit("/", 1)[-1] if norm else ""
    tail = re.sub(r"[^A-Za-z0-9._-]", "-", tail).strip(".-")
    return tail or "node"


# ---------------- 清单加载 ----------------
def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _node_source_cfg() -> dict:
    """节点清单是 GitHub raw 上的文件，归 github 源管 —— 和下载/搜索共用同一个代理开关。

    单独读一次 settings，而不是在 _fetch 里逐次读：两份清单是同一时刻拉的，
    中途改设置没有意义，还可能一份走代理一份直连。
    """
    return (load_settings().get("sources") or {}).get("github") or {}


def _fetch(url: str, cfg: dict | None = None) -> Any:
    # 清单在 GitHub raw 上：填了 gh 加速前缀就套前缀，否则按 github 源的代理开关走
    cfg = cfg if cfg is not None else _node_source_cfg()
    resp = httpx.get(
        gh_url(url),
        headers=UA,
        timeout=90,
        follow_redirects=True,
        proxy=gh_proxy(cfg),
    )
    if resp.status_code >= 400:
        raise SourceError(f"节点清单拉取失败 {resp.status_code}: {url.rsplit('/', 1)[-1]}")
    return resp.json()


def fetch_catalog(force: bool = False) -> dict[str, Any]:
    """下载两份清单并落盘。force=False 时若本地副本未过期直接返回。"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    meta = _read_json(META_PATH) or {}
    fresh = time.time() - float(meta.get("fetched_at") or 0) < CATALOG_TTL
    if not force and fresh and CNL_PATH.is_file() and NODE_MAP_PATH.is_file():
        return {"fetched": False, "at": float(meta.get("fetched_at") or 0)}

    cnl = _fetch(CNL_URL)
    node_map = _fetch(NODE_MAP_URL)
    _write_json(CNL_PATH, cnl)
    _write_json(NODE_MAP_PATH, node_map)
    at = time.time()
    _write_json(META_PATH, {"fetched_at": at, "count": len((cnl or {}).get("custom_nodes") or [])})
    with _lock:
        _cache["at"] = 0.0  # 强制下次重建索引
    return {"fetched": True, "at": at, "count": len((cnl or {}).get("custom_nodes") or [])}


def _classes_of(node_map: dict[str, Any]) -> tuple[dict[str, list[str]], set[str]]:
    """把 extension-node-map 折成 {归一化仓库: 节点类列表} 与核心节点集合。"""
    classes: dict[str, list[str]] = {}
    core: set[str] = set()
    for repo, payload in (node_map or {}).items():
        if not isinstance(payload, list) or not payload:
            continue
        names = payload[0] if isinstance(payload[0], list) else []
        cleaned = [n for n in names if isinstance(n, str) and n]
        if not cleaned:
            continue
        norm = _norm(repo)
        classes[norm] = cleaned
        if _slug(repo).lower() == CORE_REPO:
            core.update(cleaned)
    return classes, core


def _build() -> dict[str, Any]:
    """从落盘清单构建内存索引（items / by_id / owner / core / classes）。"""
    cnl = _read_json(CNL_PATH) or {}
    node_map = _read_json(NODE_MAP_PATH) or {}
    raw = cnl.get("custom_nodes") if isinstance(cnl, dict) else None
    if not isinstance(raw, list):
        raise SourceError("节点清单为空，请先刷新")

    classes, core = _classes_of(node_map if isinstance(node_map, dict) else {})
    items: list[dict] = []
    by_id: dict[str, dict] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        ref = (entry.get("reference") or "").strip()
        if not ref:
            refs = entry.get("files") or []
            ref = refs[0] if refs and isinstance(refs[0], str) else ""
        slug = _slug(ref)
        if not slug or slug in by_id:
            continue
        install_type = (entry.get("install_type") or "").strip() or "git-clone"
        repo_classes = classes.get(_norm(ref), [])
        title = (entry.get("title") or entry.get("name") or slug.rsplit("/", 1)[-1]).strip()
        desc = (entry.get("description") or "").strip()
        item = {
            "id": slug,
            "name": title,
            "author": (entry.get("author") or slug.split("/")[0]).strip(),
            "repo": ref,
            "source": "manager",
            "description": desc,
            # 主用途分类：清单的 category 字段几乎全空，只能按名字/描述/节点类名推
            "category": category_of(title, desc, repo_classes),
            "tags": [t for t in (entry.get("tags") or []) if isinstance(t, str)][:6],
            "nodes": repo_classes[:10],
            "node_count": len(repo_classes),
            "install_type": install_type,
            "installable": install_type == "git-clone" and ref.lower().startswith(("http://", "https://")),
            # 清单里 preemptions 表示「同名的节点以谁为准」，装之前值得提示一句
            "preemptions": [p for p in (entry.get("preemptions") or []) if isinstance(p, str)][:6],
            "needs": [p for p in (entry.get("pip") or []) if isinstance(p, str)][:6]
            + [f"系统包 {p}" for p in (entry.get("apt_dependency") or []) if isinstance(p, str)][:3],
            "mirror": (entry.get("reference2") or "").strip() if isinstance(entry.get("reference2"), str) else "",
        }
        items.append(item)
        by_id[slug] = item

    # 节点类 → 提供它的仓库（检测缺节点时反查）。
    # 必须用**完整**类名列表：item["nodes"] 是截断到 10 个给界面展示的，
    # 拿它建索引会让排在第 11 位之后的节点全部误判成「清单未收录」。
    repo_classes: dict[str, list[str]] = {}
    owner: dict[str, str] = {}
    for slug, item in by_id.items():
        full = classes.get(_norm(item["repo"]), [])
        repo_classes[slug] = full
        for name in full:
            owner.setdefault(name, slug)
    for name in core:
        owner.pop(name, None)

    # 有些扩展在画布上存的是**显示名**而不是类名（rgthree 就是典型：
    # 类名 RgthreePowerLoraLoader，画布里叫 `Power Lora Loader (rgthree)`）。
    # 清单里的 nodename_pattern 正是为这种情况准备的，覆盖不到的只能标 unknown。
    patterns: dict[str, str] = {}
    for slug, item in by_id.items():
        payload = node_map.get(item["repo"]) if isinstance(node_map, dict) else None
        if isinstance(payload, list) and len(payload) > 1 and isinstance(payload[1], dict):
            pattern = payload[1].get("nodename_pattern")
            if isinstance(pattern, str) and pattern:
                patterns[slug] = pattern

    return {
        "at": time.time(),
        "items": items,
        "by_id": by_id,
        "owner": owner,
        "core": core,
        "classes": classes,
        "repo_classes": repo_classes,
        "patterns": patterns,
    }


def catalog() -> dict[str, Any]:
    """取内存索引；冷启动先读盘，盘里没有才联网。"""
    with _lock:
        fresh = _cache["items"] and time.time() - float(_cache["at"] or 0) < CATALOG_TTL
        if fresh:
            return _cache
    if not CNL_PATH.is_file() or not NODE_MAP_PATH.is_file():
        fetch_catalog(force=True)
    built = _build()
    with _lock:
        _cache.update(built)
        return _cache


def warm_catalog() -> None:
    """后台预热（lifespan 调用）：内存有就跳过，盘过期就静默刷新。"""
    global _warming
    with _lock:
        if _warming or _cache["items"]:
            return
        _warming = True

    def run() -> None:
        global _warming
        try:
            catalog()
            fetch_catalog(force=False)
        except Exception:  # noqa: BLE001 - 预热失败不影响正常请求
            pass
        finally:
            with _lock:
                _warming = False

    threading.Thread(target=run, name="node-catalog-warm", daemon=True).start()


# ---------------- 已装节点 ----------------
def _git_config_remote(directory: Path) -> str:
    """从 .git/config 读 origin 地址——不要用目录名猜仓库。"""
    config = directory / ".git" / "config"
    try:
        text = config.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    in_origin = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            in_origin = 'remote "origin"' in stripped
            continue
        if in_origin and stripped.lower().startswith("url"):
            _, _, value = stripped.partition("=")
            return value.strip()
    return ""


def _git_head(directory: Path) -> str:
    """短 commit（7 位）；读文件而不是跑 git，列表页才不会卡。"""
    head_file = directory / ".git" / "HEAD"
    try:
        head = head_file.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""
    if not head.startswith("ref:"):
        return head[:7]
    ref = head[4:].strip()
    for candidate in (directory / ".git" / ref, directory / ".git" / "packed-refs"):
        try:
            text = candidate.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if candidate.name == "packed-refs":
            for line in text.splitlines():
                if line.endswith(" " + ref) or line.endswith("\t" + ref):
                    return line.split(" ", 1)[0][:7]
        else:
            value = text.strip()
            if value:
                return value[:7]
    return ""


def _local_classes(directory: Path) -> list[str]:
    """静态扫 NODE_CLASS_MAPPINGS 的键，给未收录进清单的节点兜底。

    只读文件、正则取键，绝不 import——自定义节点是第三方代码。
    """
    found: list[str] = []
    try:
        files = sorted(directory.glob("*.py"))[:40]
    except OSError:
        return found
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        match = _MAPPING_RE.search(text)
        if match:
            # 只解析映射的起始 4KB，够取到前几十个键
            chunk = text[match.end() : match.end() + 4096]
            for key in _CLASS_KEY_RE.findall(chunk):
                if key not in found:
                    found.append(key)
        display = _DISPLAY_RE.search(text)
        if display:
            chunk = text[display.end() : display.end() + 4096]
            for value in _DISPLAY_VALUE_RE.findall(chunk):
                if value not in found:
                    found.append(value)
        if len(found) > 200:
            break
    return found[:200]


def _dir_size(directory: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(directory):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return total


def installed() -> list[dict]:
    """扫 workspace/custom_nodes：目录 + .git/config 里的 origin 地址定义「装了谁」。"""
    root = WORKSPACE_CUSTOM_NODES_DIR
    if not root.is_dir():
        return []
    data = catalog()
    by_id: dict[str, dict] = data["by_id"]
    repo_classes: dict[str, list[str]] = data.get("repo_classes") or {}
    out: list[dict] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        name = child.name
        if not child.is_dir() or name.startswith("."):
            continue
        disabled = name.endswith(DISABLED_SUFFIX)
        base = name[: -len(DISABLED_SUFFIX)] if disabled else name
        repo = _git_config_remote(child)
        node_id = _slug(repo) if repo else ""
        item = by_id.get(node_id) if node_id else None
        local = _local_classes(child) if not item else []
        full = repo_classes.get(node_id, []) if item else local
        out.append(
            {
                "name": base,
                "dir": name,
                "path": str(child),
                "disabled": disabled,
                "repo": repo,
                "id": node_id,
                "title": item["name"] if item else base,
                "description": item["description"] if item else "",
                "node_count": len(full) if full else (item["node_count"] if item else 0),
                "nodes": (full or (item["nodes"] if item else []))[:8],
                "tracked": bool(item),
                "requirements": (child / "requirements.txt").is_file(),
                "commit": _git_head(child),
                "size": _dir_size(child),
            }
        )
    return out


def installed_index() -> dict[str, dict]:
    """{目录名: 节点信息}，安装任务收尾与检测都要用。"""
    return {item["dir"]: item for item in installed()}


# ---------------- 搜索 ----------------
SORTS = ("nodes", "name", "default")


def search(
    q: str = "",
    sort: str = "nodes",
    scope: str = "all",
    limit: int = 20,
    page: int = 1,
    category: str = "",
) -> dict:
    """按标题 / 作者 / 描述 / 仓库 / 节点类名匹配。

    `scope` 可只看已装或未装；`category` 按用途分类过滤（多标签，包含即命中）。
    """
    data = catalog()
    keyword = (q or "").strip().lower()
    limit = max(1, min(int(limit or 20), 60))
    page = max(1, int(page or 1))

    have = {item["id"] for item in installed() if item["id"]}
    rows = data["items"]
    if keyword:
        terms = [t for t in re.split(r"[\s,]+", keyword) if t]
        picked = []
        for item in rows:
            haystack = " ".join(
                (item["name"], item["author"], item["repo"], item["description"], " ".join(item["nodes"]))
            ).lower()
            if all(term in haystack for term in terms):
                picked.append(item)
        rows = picked
    if scope == "installed":
        rows = [it for it in rows if it["id"] in have]
    elif scope == "available":
        rows = [it for it in rows if it["id"] not in have]

    # 分面计数在「分类过滤之前」算：切分类时其余分类的数量不该跟着归零
    counts: dict[str, int] = {}
    for it in rows:
        cid = it.get("category") or "utility"
        counts[cid] = counts.get(cid, 0) + 1
    facets = [
        {"id": cid, "label": label, "count": counts.get(cid, 0)}
        for cid, label in CATEGORIES
    ]

    if category:
        rows = [it for it in rows if (it.get("category") or "utility") == category]

    if sort == "name":
        rows = sorted(rows, key=lambda it: it["name"].lower())
    elif sort == "nodes":
        rows = sorted(rows, key=lambda it: (-it["node_count"], it["name"].lower()))

    total = len(rows)
    start = (page - 1) * limit
    end = start + limit
    page_items = []
    for item in rows[start:end]:
        page_items.append({**item, "installed": item["id"] in have})

    return {
        "items": page_items,
        "total": total,
        "done": end >= total,
        "errors": {},
        "sorts": list(SORTS),
        "categories": facets,
        "category": category,
        "installed_count": len(have),
    }


# ---------------- 安装任务 ----------------
def _job_event(job: dict, line: str) -> None:
    job["log"].append({"at": round(time.time(), 3), "line": line})
    if len(job["log"]) > 300:
        del job["log"][: len(job["log"]) - 300]


def _percent_clone_reader(job: dict, stream: Any, tail: list[str]) -> None:
    """git clone --progress 把进度打在 stderr 上（用 \\r 覆盖同一行），换算到 5~55。

    这里独占 stderr：stdout 走 DEVNULL，父进程只 wait()，不能再调 communicate()，
    否则两个读者抢同一个管道，报错信息会丢。
    """
    for raw in stream:
        line = (raw or "").strip()
        if not line:
            continue
        for piece in line.split("\r"):
            piece = piece.strip()
            if not piece:
                continue
            match = re.search(r"(\d{1,3})%", piece)
            if match:
                job["percent"] = max(job["percent"], 5 + min(50.0, int(match.group(1)) * 0.5))
                job["stage"] = "下载代码"
                continue
            tail.append(piece)
            del tail[:-6]
            _job_event(job, piece)


def _pick_dir(url: str) -> str:
    """重名不覆盖：追加 -2、-3，同时避开已禁用的同名目录。"""
    root = WORKSPACE_CUSTOM_NODES_DIR
    base = _dir_name(url)
    if not (root / base).exists() and not (root / (base + DISABLED_SUFFIX)).exists():
        return base
    index = 2
    while (root / f"{base}-{index}").exists() or (root / f"{base}-{index}{DISABLED_SUFFIX}").exists():
        index += 1
    return f"{base}-{index}"


def _run_requirements(job: dict, directory: Path, cache_key: str) -> None:
    """复用基础环境那条依赖通道：只补缺的包、并发下载、离线安装。"""
    from .comfy import installer

    req = directory / "requirements.txt"
    if not req.is_file():
        _job_event(job, "该节点没有 requirements.txt，跳过依赖")
        job["percent"] = max(job["percent"], 100)
        return

    _job_event(job, f"开始安装依赖：{req.name}")
    job["stage"] = "安装依赖"

    def send(event: dict) -> None:
        if event.get("type") == "progress":
            inner = float(event.get("percent") or 0)
            job["percent"] = max(job["percent"], 60 + min(39.0, inner * 0.39))
            label = event.get("label")
            if label:
                job["stage"] = f"安装依赖 · {label}"
        line = event.get("line")
        if line:
            _job_event(job, str(line))

    try:
        ok, message = installer.run_requirements(
            installer.shared_spec(),
            send,
            lambda line: _job_event(job, str(line)),
            key="requirements",
            requirements=req,
            cache_key=cache_key,
        )
    except Exception as exc:  # noqa: BLE001 - 依赖失败不该把整个节点判死
        _job_event(job, f"依赖安装出错（节点已下载，可稍后手动处理）: {exc}")
        return
    if not ok:
        _job_event(job, f"依赖未装完：{message}")
        return
    _job_event(job, f"依赖完成：{message}")


def install(node_id: str) -> dict:
    """克隆节点到共享目录，再装它自己的 requirements。返回任务 id。"""
    data = catalog()
    item = data["by_id"].get((node_id or "").strip())
    if not item:
        raise SourceError("没有这个节点")
    if not item["installable"]:
        raise SourceError(f"该节点的安装方式是 {item['install_type']}，暂不支持一键安装")

    with _jobs_lock:
        if _busy:
            raise SourceError("已有节点正在安装，请等待完成")
        job_id = uuid.uuid4().hex[:12]
        _busy.add(job_id)
        job = {
            "id": job_id,
            "node": item["id"],
            "name": item["name"],
            "status": "running",
            "stage": "准备",
            "percent": 0.0,
            "log": [],
            "error": "",
            "dir": "",
            "started_at": time.time(),
        }
        _jobs[job_id] = job
        for stale in sorted(_jobs.values(), key=lambda j: j["started_at"])[:-20]:
            _jobs.pop(stale["id"], None)

    def worker() -> None:
        root = WORKSPACE_CUSTOM_NODES_DIR
        root.mkdir(parents=True, exist_ok=True)
        target_name = _pick_dir(item["repo"])
        target = root / target_name
        tmp = root / f".tmp-{job_id}"
        try:
            _job_event(job, f"克隆 {item['repo']}")
            job["stage"] = "下载代码"
            cmd = [
                "git",
                "-c", "core.longpaths=true",
                "clone", "--depth", "1", "--single-branch", "--progress",
                gh_url(item["repo"]), str(tmp),
            ]
            env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo"}
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                encoding="utf-8",
                errors="replace",
                env=env,
                text=True,
            )
            tail: list[str] = []
            reader = threading.Thread(
                target=_percent_clone_reader, args=(job, proc.stderr, tail), daemon=True
            )
            reader.start()
            proc.wait(timeout=600)
            reader.join(timeout=3)
            if proc.stderr:
                proc.stderr.close()
            if proc.returncode != 0:
                detail = tail[-1] if tail else f"git 退出码 {proc.returncode}"
                raise SourceError(f"克隆失败：{detail}")
            if not tmp.is_dir():
                raise SourceError("克隆结束但目录不存在")
            if target.exists():
                raise SourceError(f"目标目录已存在：{target_name}")
            tmp.replace(target)
            job["dir"] = target_name
            job["percent"] = max(job["percent"], 60)
            _job_event(job, f"代码已就位：workspace/custom_nodes/{target_name}")

            _run_requirements(job, target, f"node-{target_name}")
            job["percent"] = 100.0
            job["stage"] = "完成"
            job["status"] = "done"
            _job_event(job, "安装完成。重启实例后生效。")
        except subprocess.TimeoutExpired:
            job["status"] = "failed"
            job["error"] = "克隆超时（600 秒）"
            _job_event(job, job["error"])
        except Exception as exc:  # noqa: BLE001 - 任务线程必须自己收尾
            job["status"] = "failed"
            job["error"] = str(exc) or "安装失败"
            _job_event(job, job["error"])
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
            with _jobs_lock:
                _busy.discard(job_id)

    threading.Thread(target=worker, name=f"node-install-{job_id}", daemon=True).start()
    return {"id": job_id}


def job(job_id: str, since: int = 0) -> dict:
    with _jobs_lock:
        found = _jobs.get(job_id)
    if not found:
        raise SourceError("任务不存在")
    logs = found["log"][max(0, int(since or 0)) :]
    return {
        "id": found["id"],
        "node": found["node"],
        "name": found["name"],
        "status": found["status"],
        "stage": found["stage"],
        "percent": round(float(found["percent"]), 1),
        "dir": found["dir"],
        "error": found["error"],
        "logs": logs,
        "next": len(found["log"]),
    }


def current_job() -> dict | None:
    with _jobs_lock:
        running = [job for job in _jobs.values() if job["status"] == "running"]
    return job(running[-1]["id"]) if running else None


# ---------------- 管理：禁用 / 卸载 ----------------
def _safe_dir(name: str) -> Path:
    """只允许操作 workspace/custom_nodes 下一层目录，且不能碰点开头的临时目录。"""
    root = WORKSPACE_CUSTOM_NODES_DIR.resolve()
    candidate = (root / (name or "")).resolve()
    if not name or name.startswith(".") or candidate.parent != root:
        raise SourceError("目录名不合法")
    if not candidate.is_dir():
        raise SourceError("节点目录不存在")
    return candidate


def toggle(name: str) -> dict:
    """启用 / 禁用：ComfyUI 只加载目录下的节点，改成 .disabled 后缀即不再加载。"""
    from .comfy import runner

    active = runner.active()
    if active:
        raise SourceError(f"实例 {active.get('name')} 正在运行，先停止再启用或禁用节点")

    base = name[: -len(DISABLED_SUFFIX)] if name.endswith(DISABLED_SUFFIX) else name
    source = _safe_dir(name)
    disabled = not name.endswith(DISABLED_SUFFIX)
    target = source.with_name(base + DISABLED_SUFFIX) if disabled else source.with_name(base)
    if target.exists():
        raise SourceError(f"目标目录已存在：{target.name}")
    source.rename(target)
    return {"dir": target.name, "disabled": disabled}


def remove(name: str, stop: bool = False) -> dict:
    """删目录。正在运行的实例会占住代码，必须显式允许停止才会动手。"""
    from .comfy import runner
    from .comfy.api import _remove_tree

    target = _safe_dir(name)
    active = runner.active()
    if active:
        if not stop:
            raise SourceError(f"实例 {active.get('name')} 正在运行，先停止再卸载")
        runner.stop(active.get("name") or "")
    _remove_tree(target)
    return {"deleted": target.name}


# ---------------- 缺节点检测 ----------------
def extract_classes(payload: Any) -> set[str]:
    """从工作流 JSON 取节点类型。

    只认真正的节点容器，不能递归找 `type` 字段——子图的槽位定义里
    `{"type": "CLIP"}`、`{"type": "CONDITIONING"}` 是**数据类型标注**，
    递归扫会把它们当成缺节点，一屏全是误报。

    两种格式都支持：
    - UI 格式：顶层 / `workflow` / `definitions.subgraphs[].nodes[].type`
    - API 格式：`{"<id>": {"class_type": "KSampler"}}`（也可能包一层 `prompt`）
    """
    found: set[str] = set()

    def take_ui(container: Any) -> None:
        if not isinstance(container, dict):
            return
        nodes = container.get("nodes")
        if isinstance(nodes, list):
            for node in nodes:
                if isinstance(node, dict):
                    value = node.get("type")
                    if isinstance(value, str) and value:
                        found.add(value)

    def take_api(container: Any) -> None:
        if not isinstance(container, dict):
            return
        for value in container.values():
            if isinstance(value, dict) and isinstance(value.get("class_type"), str):
                found.add(value["class_type"])

    if isinstance(payload, dict):
        take_ui(payload)
        workflow = payload.get("workflow")
        if isinstance(workflow, dict):
            take_ui(workflow)
        # 子图（New node → Convert to subgraph）里的节点也要算，它们同样是真节点
        for holder in (payload.get("definitions"), workflow.get("definitions") if isinstance(workflow, dict) else None):
            if isinstance(holder, dict):
                for sub in holder.get("subgraphs") or []:
                    take_ui(sub)
        if not found:
            take_api(payload.get("prompt"))
            take_api(payload)

    return {t for t in found if t not in UI_TYPES and not _UUID_RE.match(t)}


def workflow_files(directory: Path | None = None) -> list[Path]:
    root = directory or WORKSPACE_WORKFLOWS_DIR
    if not root.is_dir():
        return []
    return sorted(root.rglob("*.json"))


_pat_cache: dict[str, "re.Pattern[str] | None"] = {}


def _compile(pattern: str) -> "re.Pattern[str] | None":
    if pattern not in _pat_cache:
        try:
            _pat_cache[pattern] = re.compile(pattern)
        except re.error:
            _pat_cache[pattern] = None
    return _pat_cache[pattern]


def owner_by_pattern(name: str, patterns: dict[str, str]) -> str:
    """显示名 → 仓库。清单里 42 个扩展给了 nodename_pattern（如 ` \\(rgthree\\)$`）。"""
    for slug, pattern in patterns.items():
        rx = _compile(pattern)
        if rx is not None and rx.search(name):
            return slug
    return ""


def missing(directory: Path | None = None, limit: int = 60) -> dict:
    """工作流用到的节点 − (核心 + 已装)，并反查每个缺口能装哪个扩展。"""
    data = catalog()
    core: set[str] = set(data["core"])
    repo_classes: dict[str, list[str]] = data.get("repo_classes") or {}
    patterns: dict[str, str] = data.get("patterns") or {}
    installed_items = installed()
    available: set[str] = set(core)
    installed_ids: set[str] = set()
    for item in installed_items:
        if item["disabled"]:
            continue
        if item["id"]:
            installed_ids.add(item["id"])
        # 清单给的类名 + 本地静态扫出来的类名/显示名都要算「可用」：
        # rgthree 这类节点在 workflow 里存的是显示名，只比类名会误报缺失
        full = repo_classes.get(item["id"]) if item["id"] else None
        available.update(full or [])
        available.update(_local_classes(Path(item["path"])))

    owner: dict[str, str] = data["owner"]
    by_id: dict[str, dict] = data["by_id"]
    reports: list[dict] = []
    aggregate: dict[str, dict] = {}
    files = workflow_files(directory)

    for path in files[:limit]:
        try:
            if path.stat().st_size > 5 * 1024 * 1024:
                continue
            payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        used = extract_classes(payload)
        if not used:
            continue
        gaps = used - available
        if not gaps:
            continue
        providers: dict[str, dict] = {}
        unknown: list[str] = []
        still_missing = 0
        for name in sorted(gaps):
            node_id = owner.get(name) or owner_by_pattern(name, patterns)
            if not node_id:
                unknown.append(name)
                still_missing += 1
                continue
            if node_id in installed_ids:
                # 已装但本地静态扫没认出这个显示名（映射藏在子目录里）——不该算缺
                continue
            item = by_id.get(node_id)
            if not item:
                unknown.append(name)
                still_missing += 1
                continue
            still_missing += 1
            entry = providers.setdefault(
                node_id,
                {
                    "id": node_id,
                    "name": item["name"],
                    "author": item["author"],
                    "repo": item["repo"],
                    "node_count": item["node_count"],
                    "installable": item["installable"],
                    "covers": [],
                },
            )
            entry["covers"].append(name)
        if not still_missing:
            # 缺口全都能解释成「已装但没扫到显示名」，这条工作流其实不缺东西，
            # 不该留在报告里制造焦虑
            continue
        try:
            label = path.relative_to(directory or WORKSPACE_WORKFLOWS_DIR).as_posix()
        except ValueError:
            label = path.name
        reports.append(
            {
                "name": path.stem,
                "file": label,
                "path": str(path),
                "used": len(used),
                "missing": still_missing,
                "providers": sorted(providers.values(), key=lambda p: -p["node_count"]),
                "unknown": unknown[:20],
            }
        )
        for provider in providers.values():
            agg = aggregate.setdefault(provider["id"], {**provider, "files": 0, "covers": []})
            agg["files"] += 1
            for name in provider["covers"]:
                if name not in agg["covers"]:
                    agg["covers"].append(name)

    reports.sort(key=lambda r: (-r["missing"], r["file"]))
    providers = sorted(aggregate.values(), key=lambda p: (-p["files"], -p["node_count"]))
    return {
        "workflows": reports,
        "providers": providers,
        "scanned": len(files),
        "missing_files": len(reports),
        "core_nodes": len(core),
        "installed_nodes": len(available - core),
    }


def stats() -> dict:
    data = catalog()
    installed_rows = installed()
    return {
        "catalog": len(data["items"]),
        "installed": len(installed_rows),
        "disabled": sum(1 for i in installed_rows if i["disabled"]),
        "node_classes": sum(len(v) for v in data["classes"].values()),
        "core_nodes": len(data["core"]),
        "dir": str(WORKSPACE_CUSTOM_NODES_DIR),
        "runtime": COMFY_ENV_NAME,
    }
