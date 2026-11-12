"""REST API：设置 / 解析 / 任务 / 本地模型库 / 代理测试 / 目录选择。"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import cache, covers as cover_service
from ..comfy.model_dirs import infer_folder
from .. import nodes as node_service
from .. import workflows as workflow_service
from ..config import build_proxy_url, load_settings, relativize_save_dir, save_settings
from ..db import execute, new_id, now_iso, query
from ..download.manager import manager
from ..sources import get_adapter
from ..sources.base import SourceError

router = APIRouter(prefix="/api")


class ResolveRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""
    task: str = ""


class CreateTaskRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""
    files: list[str] = Field(default_factory=list)
    strategy: str = ""
    save_dir: str = ""
    target_folder: str = ""
    task: str = ""


class WorkflowResolveRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""


class WorkflowImportRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""
    instance: str


class WorkflowLocalOpenRequest(BaseModel):
    path: str


class NodeInstallRequest(BaseModel):
    id: str


class LibraryPatch(BaseModel):
    tags: list[str] | None = None
    favorite: bool | None = None
    review_state: str | None = None
    notes: str | None = None


class ScanRequest(BaseModel):
    path: str


class ProxyTestRequest(BaseModel):
    url: str = ""


class BrowseFolderRequest(BaseModel):
    path: str = ""


@router.get("/health")
def health() -> dict:
    from ..config import get_web_dist
    return {"status": "ok", "web": get_web_dist() is not None}


# ---------------- 设置 ----------------
@router.get("/settings")
def get_settings() -> dict:
    s = load_settings()
    # 展示层用相对形态（项目内）；运行时 load_settings 仍解析为绝对
    s["download"]["save_dir"] = relativize_save_dir(s["download"]["save_dir"])
    return s


@router.put("/settings")
def put_settings(body: dict) -> dict:
    current = load_settings()
    for key, value in body.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            current[key].update(value)
        else:
            current[key] = value
    saved = save_settings(current)
    # token / 完整目录 / 代理都会改变搜索结果，不能留着旧缓存
    cache.clear_search()
    return saved


# ---------------- 解析 ----------------
@router.post("/resolve")
def resolve(body: ResolveRequest) -> dict:
    settings = load_settings()
    cfg = settings["sources"].get(body.source)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"未配置的下载源: {body.source}")
    adapter = get_adapter(body.source)
    repo = adapter.resolve(body.repo_id, body.revision, cfg)
    payload = repo.to_dict()
    # 建议的落盘目录（ComfyUI 模型分类），前端可覆盖
    payload["target_folder"] = infer_folder(body.source, body.task, [f.path for f in repo.files])
    return payload


# ---------------- 工作流发现 ----------------
@router.get("/workflows")
def search_workflows(q: str = "", source: str = "all", limit: int = 12, page: int = 1, sort: str = "downloads") -> dict:
    return workflow_service.search(q, source, limit, page, sort)


@router.post("/workflows/resolve")
def resolve_workflow(body: WorkflowResolveRequest) -> dict:
    try:
        return workflow_service.resolve(body.source, body.repo_id, body.revision)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflows/local")
def local_workflows() -> dict:
    """共享工作流目录里的「我的工作流」。依赖解析在下一步，这里只给列表。"""
    return workflow_service.local()


@router.post("/workflows/local/open")
def open_local_workflow(body: WorkflowLocalOpenRequest) -> dict:
    try:
        return workflow_service.open_local(body.path)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflows/instances")
def workflow_instances() -> dict:
    return {"items": workflow_service.instances()}


@router.post("/workflows/import")
def import_workflow(body: WorkflowImportRequest) -> dict:
    try:
        return workflow_service.import_to_instance(body.source, body.repo_id, body.instance, body.revision)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------- 节点发现 / 节点管理 ----------------
@router.get("/nodes")
def search_nodes(q: str = "", sort: str = "nodes", scope: str = "all", limit: int = 20, page: int = 1) -> dict:
    try:
        return node_service.search(q, sort, scope, limit, page)
    except SourceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/nodes/stats")
def node_stats() -> dict:
    try:
        return node_service.stats()
    except SourceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/nodes/refresh")
def refresh_nodes() -> dict:
    try:
        return node_service.fetch_catalog(force=True)
    except SourceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"节点清单刷新失败: {exc}") from exc


@router.get("/nodes/installed")
def installed_nodes() -> dict:
    try:
        return {"items": node_service.installed()}
    except SourceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/nodes/install")
def install_node(body: NodeInstallRequest) -> dict:
    try:
        return node_service.install(body.id)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/nodes/job")
def current_node_job() -> dict:
    return {"job": node_service.current_job()}


@router.get("/nodes/job/{job_id}")
def node_job(job_id: str, since: int = 0) -> dict:
    try:
        return node_service.job(job_id, since)
    except SourceError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/nodes/installed/{name}/toggle")
def toggle_node(name: str) -> dict:
    try:
        return node_service.toggle(name)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"改名失败: {exc}") from exc


@router.delete("/nodes/installed/{name}")
def remove_node(name: str, stop: bool = False) -> dict:
    try:
        return node_service.remove(name, stop=stop)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/nodes/missing")
def missing_nodes() -> dict:
    try:
        return node_service.missing()
    except SourceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ---------------- 任务 ----------------
@router.post("/tasks")
def create_task(body: CreateTaskRequest) -> dict:
    try:
        return manager.create_task(
            body.source,
            body.repo_id,
            body.revision,
            body.files,
            body.strategy,
            body.save_dir,
            body.target_folder,
            body.task,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tasks")
def list_tasks() -> list[dict]:
    return manager.list_tasks()


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    return manager.get_task(task_id)


@router.post("/tasks/{task_id}/pause")
def pause_task(task_id: str) -> dict:
    return manager.pause_task(task_id)


@router.post("/tasks/{task_id}/resume")
def resume_task(task_id: str) -> dict:
    return manager.resume_task(task_id)


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str) -> dict:
    return manager.cancel_task(task_id)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> dict:
    return manager.delete_task(task_id)


# ---------------- 本地模型库 ----------------
@router.get("/library")
def list_library(q: str = "", source: str = "", review: str = "", favorite: bool = False) -> list[dict]:
    import json as _json

    sql = "SELECT * FROM library_models WHERE 1=1"
    params: list = []
    if q:
        sql += " AND (name LIKE ? OR repo_id LIKE ? OR tags LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like]
    if source:
        sql += " AND source=?"
        params.append(source)
    if review:
        sql += " AND review_state=?"
        params.append(review)
    if favorite:
        sql += " AND favorite=1"
    sql += " ORDER BY created_at DESC"
    models = query(sql, tuple(params))
    for m in models:
        m["tags"] = _json.loads(m.get("tags") or "[]")
        m["files"] = query("SELECT id, path, size FROM library_files WHERE model_id=? ORDER BY path", (m["id"],))
    return models


def _library_item(model_id: str) -> dict:
    import json as _json

    rows = query("SELECT * FROM library_models WHERE id=?", (model_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="模型不存在")
    item = rows[0]
    item["tags"] = _json.loads(item.get("tags") or "[]")
    item["files"] = query("SELECT id, path, size FROM library_files WHERE model_id=? ORDER BY path", (model_id,))
    return item


@router.patch("/library/{model_id}")
def patch_library(model_id: str, body: LibraryPatch) -> dict:
    rows = query("SELECT * FROM library_models WHERE id=?", (model_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="模型不存在")
    import json as _json

    fields, params = [], []
    if body.tags is not None:
        fields.append("tags=?")
        params.append(_json.dumps(body.tags, ensure_ascii=False))
    if body.favorite is not None:
        fields.append("favorite=?")
        params.append(1 if body.favorite else 0)
    if body.review_state is not None:
        fields.append("review_state=?")
        params.append(body.review_state)
    if body.notes is not None:
        fields.append("notes=?")
        params.append(body.notes)
    if fields:
        params.append(model_id)
        execute(f"UPDATE library_models SET {', '.join(fields)} WHERE id=?", tuple(params))
    return _library_item(model_id)


@router.delete("/library/{model_id}")
def delete_library(model_id: str) -> dict:
    execute("DELETE FROM library_files WHERE model_id=?", (model_id,))
    execute("DELETE FROM library_models WHERE id=?", (model_id,))
    return {"deleted": model_id}


@router.post("/library/scan")
def scan_library(body: ScanRequest) -> dict:
    root = Path(body.path)
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"目录不存在: {body.path}")
    created = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        existing = query("SELECT id FROM library_models WHERE local_path=?", (str(child),))
        if existing:
            continue
        files = [f for f in child.rglob("*") if f.is_file()]
        if not files:
            continue
        model_id = new_id()
        size = sum(f.stat().st_size for f in files)
        execute(
            "INSERT INTO library_models (id, name, repo_id, source, local_path, size_bytes, file_count, tags, favorite, review_state, notes, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (model_id, child.name, "", "imported", str(child), size, len(files), "[]", 0, "untried", "", now_iso()),
        )
        for f in files:
            execute(
                "INSERT INTO library_files (id, model_id, path, size) VALUES (?,?,?,?)",
                (new_id(), model_id, str(f.relative_to(child)), f.stat().st_size),
            )
        created.append(model_id)
    return {"created": len(created), "ids": created}


@router.post("/library/{model_id}/open")
def open_library(model_id: str) -> dict:
    rows = query("SELECT local_path FROM library_models WHERE id=?", (model_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="模型不存在")
    path = Path(rows[0]["local_path"])
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"路径已不存在: {path}")
    if os.name == "nt":
        os.startfile(str(path))  # noqa: S606
    else:
        os.system(f'open "{path}"' if os.uname().sysname == "Darwin" else f'xdg-open "{path}"')  # noqa: S605
    return {"opened": str(path)}


# ---------------- 模型搜索（发现列表） ----------------
@router.get("/search")
def search_models(q: str = "", source: str = "", sort: str = "downloads", limit: int = 20, page: int = 1, task: str = "") -> dict:
    """跨源搜索。

    两处性能约束（都是实测出来的）：
    - **三源并行**：串行时 空关键词/limit=56 要 11.9 s，并行后压到最慢的那一源（约 3.5 s）。
    - **结果缓存 5 分钟**：发现页每次进入都会重新搜一遍，缓存后二次进入是毫秒级。
    """
    key = f"{q.strip().lower()}|{source}|{sort}|{limit}|{page}|{task}"
    cached = cache.get_search(key)
    if cached is not None:
        return cached

    settings = load_settings()
    if source and source != "all":
        names = [source]
    else:
        names = ["huggingface", "modelscope", "civitai"]

    def run(name: str) -> tuple[str, dict | None, str]:
        cfg = settings["sources"].get(name) or {}
        try:
            return name, get_adapter(name).search(q, limit, page, sort, cfg, task), ""
        except SourceError as exc:
            return name, None, str(exc)

    items: list[dict] = []
    total = 0
    errors: dict[str, str] = {}
    if len(names) == 1:
        results = [run(names[0])]
    else:
        with ThreadPoolExecutor(max_workers=len(names)) as pool:
            results = list(pool.map(run, names))
    for name, result, err in results:
        if err:
            errors[name] = err
            continue
        items.extend(result["items"])
        total += result["total"]

    if sort == "downloads":
        items.sort(key=lambda x: x.get("downloads") or 0, reverse=True)
    elif sort == "likes":
        items.sort(key=lambda x: x.get("likes") or 0, reverse=True)
    payload = {"items": items, "total": total, "errors": errors}
    # 有源失败时不写缓存：一次网络抖动不该把空列表钉住 20 分钟
    if not errors:
        cache.put_search(key, payload)
    return payload


def warm_discover() -> None:
    """预热发现页首屏的三条查询（后台线程调用，失败无所谓）。

    进入发现页时前端会按来源各发一次 `q='' sort=trending limit=20 page=1`，
    这三条恰好是全站最慢的冷启动（Civitai 单次要几秒）。后端起来先跑一遍，
    用户点进来就是缓存命中，首屏不用再等一轮网络。

    三源并行：串行预热时 Civitai 要排队等 HF 和 MS，预热窗口内进来的人照样要等它几秒。
    """
    def one(name: str) -> None:
        try:
            search_models("", name, "trending", 20, 1, "")
        except Exception:  # noqa: BLE001 —— 预热失败只是少了优化，不能影响启动
            pass

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(one, ("huggingface", "modelscope", "civitai")))


class CoverItem(BaseModel):
    source: str
    id: str
    image: str = ""  # Civitai 会在搜索响应里直接给出


class CoverGroup(BaseModel):
    key: str
    items: list[CoverItem]


class CoversRequest(BaseModel):
    groups: list[CoverGroup]


@router.post("/covers")
def resolve_covers(body: CoversRequest) -> dict:
    """按「魔搭 → HF → Civitai」为卡片组取封面，取到即停。

    单独一个接口而不是并进 /search：取图要额外地打详情接口（魔搭 0.3 s、HF 1.5 s），
    并进去等于让搜索慢一倍。前端先用兜底铭牌渲染，拿到封面再替换。
    """
    settings = load_settings()
    groups = body.groups[:60]  # 一屏塞不下更多；防止误传大数组打穿三家 API

    def run(group: CoverGroup) -> tuple[str, str]:
        items = [it.model_dump() for it in group.items]
        return group.key, cover_service.resolve_group(items, settings)

    if not groups:
        return {"covers": {}}
    # 每组最多打两次详情接口（魔搭 + HF），16 路并发能把一屏 56 组的冷启动
    # 从 14 s 压到 6 s 左右；再高就开始被对端限速了
    with ThreadPoolExecutor(max_workers=min(16, len(groups))) as pool:
        pairs = list(pool.map(run, groups))
    return {"covers": {k: v for k, v in pairs if v}}


# ---------------- 代理测试 ----------------
@router.post("/proxy/test")
def proxy_test(body: ProxyTestRequest) -> dict:
    url = body.url or build_proxy_url(load_settings()["proxy"])
    result: dict = {"proxy_url": url, "proxy": None, "direct": None}

    def probe(use_proxy: bool) -> dict:
        started = time.time()
        try:
            if use_proxy and url:
                with httpx.Client(proxy=url, timeout=8, follow_redirects=True) as client:
                    resp = client.get("https://huggingface.co")
            else:
                with httpx.Client(timeout=8, follow_redirects=True) as client:
                    resp = client.get("https://huggingface.co")
            return {"ok": resp.status_code < 400, "status": resp.status_code, "latency_ms": int((time.time() - started) * 1000)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)[:200], "latency_ms": int((time.time() - started) * 1000)}

    result["proxy"] = probe(True)
    result["direct"] = probe(False)
    return result


# ---------------- 系统目录选择框 ----------------
def _browse_folder(initial: str) -> tuple[str | None, str | None]:
    """打开系统原生目录选择框。返回 (选中路径 | None, 错误信息 | None)；用户取消时两者皆 None。"""
    try:
        if os.name == "nt":
            return _browse_folder_windows(initial)
        if sys.platform == "darwin":
            return _browse_folder_mac(initial)
        return _browse_folder_linux(initial)
    except Exception as exc:  # noqa: BLE001
        return None, f"无法打开目录选择框: {exc}"


def _powershell_exe() -> str:
    """解析 powershell 绝对路径：服务进程 PATH 可能被裁剪，兜底走 SystemRoot。"""
    import shutil

    exe = shutil.which("powershell") or shutil.which("powershell.exe")
    if exe:
        return exe
    root = os.environ.get("SystemRoot", r"C:\Windows")
    return str(Path(root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")


def _browse_folder_windows(initial: str) -> tuple[str | None, str | None]:
    init = str(initial or "").replace("'", "''")
    init_line = f"$dlg.SelectedPath = '{init}'" if init else ""
    script = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$dlg.Description = '选择保存目录'; "
        f"{init_line}; "
        "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.SelectedPath }"
    )
    proc = subprocess.run(  # noqa: S603
        [_powershell_exe(), "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=300, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if proc.returncode != 0:
        return None, (proc.stderr.strip() or "目录选择框调用失败")[:300]
    path = proc.stdout.strip()
    return (path, None) if path else (None, None)


def _browse_folder_mac(initial: str) -> tuple[str | None, str | None]:
    init = str(initial or "").replace('"', '\\"')
    default_loc = f' default location (POSIX file "{init}")' if init else ""
    script = f'POSIX path of (choose folder with prompt "选择保存目录"{default_loc})'
    proc = subprocess.run(  # noqa: S603
        ["osascript", "-e", script], capture_output=True, text=True, timeout=300
    )
    if proc.returncode != 0:
        if "User canceled" in (proc.stderr or ""):
            return None, None
        return None, (proc.stderr.strip() or "目录选择框调用失败")[:300]
    return (proc.stdout.strip().rstrip("/"), None) if proc.stdout.strip() else (None, None)


def _browse_folder_linux(initial: str) -> tuple[str | None, str | None]:
    import shutil

    init = str(initial or "")
    if shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", "--directory", "--title=选择保存目录"]
        if init:
            cmd.append(f"--filename={init}")
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getexistingdirectory", init or str(Path.home())]
    else:
        return None, "未找到 zenity/kdialog，无法打开目录选择框"
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)  # noqa: S603
    if proc.returncode != 0:
        return None, None  # 用户取消
    path = proc.stdout.strip()
    return (path, None) if path else (None, None)


@router.post("/browse-folder")
def browse_folder(body: BrowseFolderRequest) -> dict:
    path, error = _browse_folder(body.path)
    result: dict = {"path": relativize_save_dir(path) if path else None}
    if error:
        result["error"] = error
    return result
