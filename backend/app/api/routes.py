"""REST API：设置 / 解析 / 任务 / 本地模型库 / 代理测试 / 目录选择。"""
from __future__ import annotations

import copy
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import cache, covers as cover_service
from .. import probe, source_gate
from .. import hot_board
from .. import image_proxy
from ..comfy.model_dirs import infer_folder, plan_folders
from .. import nodes as node_service
from .. import workflow_covers as wf_covers
from .. import workflow_edit
from .. import workflows as workflow_service
from ..library_meta import describe_model, flush_meta_cache, gpu_snapshot
from ..library_match import match_origin
from ..library_origin import detect_origin
from ..weight_class import all_folders, all_tasks
from ..weight_meta import fmt_bytes
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
    """reveal = 文件管理器定位；edit = 系统默认程序打开（坏 JSON 只能这么改）"""
    mode: str = "reveal"


class WorkflowCoverEntry(BaseModel):
    """一条待取封面的工作流：key 是相对路径（与侧车元数据同一个键）。"""

    key: str
    name: str = ""
    model: str = ""
    """这条工作流自带出图时就别去社区补图，除非用户手动钉过封面"""
    has_local: bool = False


class WorkflowCoversRequest(BaseModel):
    items: list[WorkflowCoverEntry] = Field(default_factory=list)


class WorkflowFileRequest(BaseModel):
    """编辑器写回：data 是完整工作流对象，mtime 用于乐观锁。"""

    path: str
    data: dict
    mtime: float | None = None


class WorkflowMetaRequest(BaseModel):
    """自定义命名 / 分组。path 必须是共享工作流目录里的文件。"""

    path: str
    title: str = ""
    group: str = ""
    rename_file: bool = False


class WorkflowGroupRequest(BaseModel):
    """分组管理：name 是新建/改名的目标名，old 只用于改名。"""

    name: str = ""
    old: str = ""


class WorkflowCoverRefreshRequest(BaseModel):
    """换一张封面：current 是当前显示的图，重抽时要避开它。"""

    key: str
    name: str = ""
    model: str = ""
    current: str = ""


class WorkflowCoverCustomRequest(BaseModel):
    """自定义封面：url 是外链，data 是浏览器读出的 base64 data URI（二选一）。"""

    key: str
    url: str = ""
    data: str = ""


class WorkflowCoverCandidatesRequest(BaseModel):
    """封面管理画廊：一次发一批候选，offset 用来换一批（不重复搜社区）。"""

    key: str
    name: str = ""
    model: str = ""
    current: str = ""
    offset: int = 0


class WorkflowCoverChooseRequest(BaseModel):
    """从画廊里选中一张：只认本次发过的候选 URL。"""

    key: str
    url: str


class WorkflowCoverResetRequest(BaseModel):
    key: str


class NodeInstallRequest(BaseModel):
    id: str


class LibraryPatch(BaseModel):
    tags: list[str] | None = None


class ScanRequest(BaseModel):
    path: str
    # 默认开启：按名字 + safetensors 头自动匹配来源（要走网络，可能多花几秒）
    match: bool = True


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


def _probe_inputs_changed(before: dict, after: dict) -> bool:
    """这次的保存有没有动到「线路本身」。

    动到的：全局代理地址、某站的镜像地址 / 逐源代理开关 / 优先镜像开关。
    没动到的：下载策略、token、完整目录开关、下载目录 —— 这些换了不该让探针重测。
    """
    if (before.get("proxy") or {}) != (after.get("proxy") or {}):
        return True
    srcs_before = before.get("sources") or {}
    srcs_after = after.get("sources") or {}
    for key in set(srcs_before) | set(srcs_after):
        a = srcs_before.get(key) or {}
        b = srcs_after.get(key) or {}
        for field in ("mirror", "proxy_enabled", "use_mirror"):
            if bool(a.get(field)) != bool(b.get(field)):
                return True
    return False


@router.put("/settings")
def put_settings(body: dict) -> dict:
    current = load_settings()
    before = copy.deepcopy(current)
    for key, value in body.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            current[key].update(value)
        else:
            current[key] = value
    saved = save_settings(current)
    # token / 完整目录 / 代理都会改变搜索结果，不能留着旧缓存
    cache.clear_search()
    # 探针结论只在「线路真变了」时作废（规格 §2.4）：改代理地址、改某站镜像或
    # 逐源代理开关。改下载策略、填 token 都不动缓存 —— 那些不影响通路本身。
    if _probe_inputs_changed(before, current):
        probe.invalidate()
    return saved


# ---------------- 源探针（可达性 + 测速） ----------------
@router.get("/probe")
def probe_status() -> dict:
    """全部源的最新探针结论 + 下载策略汇总。

    结论与速度写在**同一份**进程内缓存里（可达 15 / 降级 10 / 不可达 3 分钟），
    下载与发现两条链路读的就是这份结论。没探过的源标 unknown（不门控），后台补探一轮。
    """
    return probe.status()


@router.post("/probe/refresh")
def probe_refresh() -> dict:
    """强制重探一轮 —— 设置页的「重新测试连通性」。"""
    return probe.refresh()


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
    # 每个文件各自的落盘目录（分体仓库的 transformer / text_encoder / vae 分属不同目录）；
    # target_folder 是「整条任务一个目录」时的建议值，混装时为空字符串。
    plan = plan_folders([f.path for f in repo.files])
    for item in payload["files"]:
        item["folder"] = plan.get(item["path"], "")
    payload["target_folder"] = infer_folder(body.source, body.task, [f.path for f in repo.files])
    return payload


# ---------------- ComfyUI 模型目录 ----------------
@router.get("/folders")
def folders() -> list[dict]:
    """可选的 ComfyUI 模型目录（核心目录 + 扩展目录）。

    下载任务已按文件自动归类，前端不再让用户选目录；保留端点给需要
    显式指定 target_folder 的调用方。
    """
    return all_folders()


# ---------------- 工作流发现 ----------------
@router.get("/workflows")
def search_workflows(q: str = "", source: str = "all", limit: int = 12, page: int = 1, sort: str = "downloads") -> dict:
    # 首屏（默认参数）直接给本地热力榜：重启后也是秒开，后台再换新
    if hot_board.matches("workflows", q=q, source=source, sort=sort, limit=limit, page=page):
        cached = hot_board.get("workflows")
        if cached is not None:
            return cached
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


@router.get("/workflows/file")
def read_workflow_file(path: str) -> dict:
    """编辑器读取工作流原文与解析结果。"""
    try:
        return workflow_edit.load(path)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/workflows/file")
def write_workflow_file(body: WorkflowFileRequest) -> dict:
    """校验后覆盖原文件，并留一份 `.bak`；mtime 不一致时拒绝写入。"""
    try:
        return workflow_edit.save(body.path, body.data, body.mtime)
    except workflow_edit.StaleWorkflow as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflows/object-info")
def workflow_object_info(refresh: bool = False) -> dict:
    """本机实例的节点定义（带磁盘缓存），供画布节点库与端口类型使用。"""
    return workflow_edit.object_info(refresh)


@router.post("/workflows/local/open")
def open_local_workflow(body: WorkflowLocalOpenRequest) -> dict:
    try:
        return workflow_service.open_local(body.path, body.mode)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflows/local/cover")
def local_workflow_cover(path: str) -> FileResponse:
    """工作流自带的出图。工作流目录不在 web 根下，只能由后端吐。"""
    try:
        file = wf_covers.serve_file(path)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="只能读取工作流目录里的图片") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="图片不存在") from exc
    return FileResponse(file, headers={"Cache-Control": "public, max-age=86400"})


@router.post("/workflows/covers")
def workflow_covers(body: WorkflowCoversRequest) -> dict:
    """批量取远程封面。钉过的图优先，本地自带出图的条目会被跳过。"""
    return {
        "covers": wf_covers.resolve_batch([item.model_dump() for item in body.items]),
        "pinned": wf_covers.pinned_keys(),
        "custom": wf_covers.custom_keys(),
    }


@router.post("/workflows/local/organize")
def organize_local_workflows() -> dict:
    """幂等兜底：重新同步分组与真实目录。前端已不再需要手动调用。"""
    return workflow_service.organize_groups()


@router.post("/workflows/local/use")
def use_local_workflow(body: WorkflowLocalOpenRequest) -> dict:
    """使用工作流：确保实例在跑，返回画布地址。"""
    try:
        return workflow_service.use_local(body.path)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/workflows/local")
def delete_local_workflow(path: str) -> dict:
    try:
        return workflow_service.delete_local(path)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/workflows/local/meta")
def set_local_workflow_meta(body: WorkflowMetaRequest) -> dict:
    """设置自定义名与分组，并自动同步真实目录（分组 = 文件夹）。"""
    try:
        return workflow_service.set_meta(
            body.path, body.title, body.group, body.rename_file
        )
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/workflows/groups")
def list_workflow_groups() -> dict:
    return workflow_service.list_groups()


@router.post("/workflows/groups")
def create_workflow_group(body: WorkflowGroupRequest) -> dict:
    try:
        return workflow_service.create_group(body.name)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/workflows/groups")
def rename_workflow_group(body: WorkflowGroupRequest) -> dict:
    try:
        return workflow_service.rename_group(body.old, body.name)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/workflows/groups")
def delete_workflow_group(name: str = "") -> dict:
    try:
        return workflow_service.delete_group(name)
    except SourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/workflows/covers/refresh")
def refresh_workflow_cover(body: WorkflowCoverRefreshRequest) -> dict:
    """换一张封面：避开当前图重新发牌，并把结果钉住（能压过工作流自带出图）。"""
    url = wf_covers.redeal(
        {"key": body.key, "name": body.name, "model": body.model}, body.current
    )
    return {"key": body.key, "cover": url, "pinned": bool(url), "source": "manual" if url else ""}


@router.post("/workflows/covers/candidates")
def workflow_cover_candidates(body: WorkflowCoverCandidatesRequest) -> dict:
    """封面管理画廊的候选图：只返回 URL，不改动当前封面。"""
    covers = wf_covers.candidates(
        {"key": body.key, "name": body.name, "model": body.model},
        current=body.current,
        offset=max(0, min(body.offset, 12)),
    )
    return {"key": body.key, "covers": covers}


@router.post("/workflows/covers/choose")
def choose_workflow_cover(body: WorkflowCoverChooseRequest) -> dict:
    """画廊点选：钉住选中的那张（会盖过工作流自带出图）。"""
    try:
        url = wf_covers.choose(body.key, body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"key": body.key, "cover": url, "pinned": True, "source": "manual"}


@router.post("/workflows/covers/custom")
def set_custom_workflow_cover(body: WorkflowCoverCustomRequest) -> dict:
    """用户自己指定封面：外链 URL 或上传的本地图片，结果钉在这条工作流上。"""
    try:
        cover = wf_covers.set_custom(body.key, body.url, body.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"key": body.key, "cover": cover, "pinned": True, "source": "custom"}


@router.post("/workflows/covers/reset")
def reset_workflow_cover(body: WorkflowCoverResetRequest) -> dict:
    """恢复自动封面：取消钉图并清掉手动结果，下次刷新回到本地出图/常规抽牌。"""
    wf_covers.restore_auto(body.key)
    return {"key": body.key, "pinned": False}


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
def search_nodes(
    q: str = "",
    sort: str = "nodes",
    scope: str = "all",
    limit: int = 20,
    page: int = 1,
    category: str = "",
) -> dict:
    if hot_board.matches("nodes", q=q, sort=sort, scope=scope, limit=limit, page=page, category=category):
        cached = hot_board.get("nodes")
        if cached is not None:
            return cached
    try:
        return node_service.search(q, sort, scope, limit, page, category)
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
def list_library(
    q: str = "",
    source: str = "",
    sort: str = "created",
    folder: str = "",
    task: str = "",
) -> list[dict]:
    """本地模型库。

    sort 四选一，与界面上的排序下拉一致：
      name    名称
      created 最新入库
      folder  类别（存放类型）
      size    大小
    类别排序依赖现算的分类结果，所以那一档在 Python 侧排 —— 数据库里没这一列。
    """
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
    sql += " ORDER BY created_at DESC"
    models = query(sql, tuple(params))
    for m in models:
        m["tags"] = _json.loads(m.get("tags") or "[]")
        m["files"] = query("SELECT id, path, size FROM library_files WHERE model_id=? ORDER BY path", (m["id"],))
        m.update(describe_model(m["local_path"], m["name"], m["tags"], m.get("size_bytes") or 0))

    # 分类筛选（存放类型 / 任务类型）是现算的，只能在内存里过
    if folder:
        models = [m for m in models if m["folder"] == folder]
    if task:
        models = [m for m in models if m["task"] == task]

    if sort == "name":
        models.sort(key=lambda m: (m["name"] or "").lower())
    elif sort == "size":
        models.sort(key=lambda m: m.get("size_bytes") or 0, reverse=True)
    elif sort == "folder":
        models.sort(key=lambda m: (m["folderLabel"], m["name"] or ""))
    else:  # created（默认，最新入库）
        models.sort(key=lambda m: m.get("created_at") or "", reverse=True)
    # 文件事实缓存攒到请求结束再落一次盘，不要每个模型写一次 JSON
    flush_meta_cache()
    return models


@router.get("/device")
def device_capabilities() -> dict:
    """本机硬件能力 + 下载目录的实时可用空间。

    硬件来自启动时的一次性快照（换硬件必然重启服务），磁盘余量现读 ——
    下载会改变它，不能冻在快照里。发现页用它判断权重能不能装下。
    """
    from ..comfy.probe import hardware_snapshot

    report = hardware_snapshot()
    save_dir = Path(load_settings()["download"]["save_dir"])
    # 下载目录可能还没建：往上找到第一个存在的父目录再读磁盘
    probe_path = save_dir
    while not probe_path.exists() and probe_path.parent != probe_path:
        probe_path = probe_path.parent
    try:
        usage = shutil.disk_usage(probe_path)
        disk = {
            "path": str(probe_path),
            "total_gb": round(usage.total / 1024**3, 1),
            "free_gb": round(usage.free / 1024**3, 1),
        }
    except OSError:
        disk = {"path": str(probe_path), "total_gb": 0.0, "free_gb": 0.0}

    payload = report.model_dump()
    # 环境部分不发给发现页：Python 清单 / 实例 / 磁盘留给环境页自己取
    for key in ("pythons", "instances", "disks", "raw"):
        payload.pop(key, None)
    payload["gpu"] = gpu_snapshot()
    payload["save_dir"] = str(save_dir)
    payload["save_disk"] = disk
    return payload


@router.get("/library/gpu")
def library_gpu() -> dict:
    """本机独显显存 —— 权重压力标志的分母。

    与 /device、环境页共用同一份启动时硬件快照。
    """
    return gpu_snapshot()


@router.get("/library/facets")
def library_facets() -> dict:
    """筛选面板用的分面：存放类型 / 任务类型 / 发布方 / 来源，各带条数与占用体积。

    分类是**现算**的（读目录路径 + 文件名推断），不落库 ——
    存一份就会和实际文件脱节，用户移动了模型目录就失效。
    """
    import json as _json

    rows = query("SELECT * FROM library_models")
    buckets: dict[str, dict] = {"folder": {}, "task": {}, "source": {}, "publisher": {}}
    for r in rows:
        tags = _json.loads(r.get("tags") or "[]")
        info = describe_model(r["local_path"], r["name"], tags, r.get("size_bytes") or 0)
        for dim in ("folder", "task"):
            key = info[dim]
            b = buckets[dim].setdefault(key, {"id": key, "label": info[dim + "Label"], "count": 0, "bytes": 0})
            b["count"] += 1
            b["bytes"] += r.get("size_bytes") or 0
        src = r.get("source") or ""
        b = buckets["source"].setdefault(src, {"id": src, "label": src, "count": 0, "bytes": 0})
        b["count"] += 1
        b["bytes"] += r.get("size_bytes") or 0

        # 发布方是独立于「家族」的维度：家族回答「哪条模型线」，发布方回答「谁发的」。
        # 只从 repo_id 的 org 段取 —— 库里的 local_path / tags 都不带这个信息。
        rid = (r.get("repo_id") or "").strip()
        org = rid.split("/")[0].strip() if "/" in rid else ""
        pub_id = org.lower()
        pub_label = org or "未登记"
        b = buckets["publisher"].setdefault(
            pub_id, {"id": pub_id, "label": pub_label, "count": 0, "bytes": 0}
        )
        b["count"] += 1
        b["bytes"] += r.get("size_bytes") or 0

    def _pack(dim: str) -> list[dict]:
        out = sorted(buckets[dim].values(), key=lambda x: (-x["count"], x["label"]))
        return [
            {"id": b["id"], "label": b["label"], "count": b["count"], "sizeText": fmt_bytes(b["bytes"])}
            for b in out
        ]

    flush_meta_cache()
    return {
        "folder": _pack("folder"),
        "task": _pack("task"),
        "source": _pack("source"),
        "publisher": _pack("publisher"),
        "allFolders": all_folders(),
        "allTasks": all_tasks(),
    }


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
    matched = 0
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        existing = query("SELECT id, source FROM library_models WHERE local_path=?", (str(child),))
        # 已入库的本地导入条目：再扫一次时试着补原址。
        # 先看明确证据（任务表 / Civitai 侧车），没有再按名字 + 头指纹匹配。
        origin = None
        if not existing or existing[0]["source"] == "imported":
            origin = detect_origin(child)
            if origin is None and body.match:
                origin = match_origin(child)
        if existing:
            if origin:
                execute(
                    "UPDATE library_models SET source=?, repo_id=?, revision=?, source_url=? WHERE id=?",
                    (origin["source"], origin["repo_id"], origin["revision"],
                     origin["source_url"], existing[0]["id"]),
                )
                matched += 1
            continue
        files = [f for f in child.rglob("*") if f.is_file()]
        if not files:
            continue
        model_id = new_id()
        size = sum(f.stat().st_size for f in files)
        if origin:
            matched += 1
        execute(
            "INSERT INTO library_models (id, name, repo_id, source, local_path, size_bytes, file_count, tags, revision, source_url, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                model_id,
                child.name,
                origin["repo_id"] if origin else "",
                origin["source"] if origin else "imported",
                str(child),
                size,
                len(files),
                "[]",
                origin["revision"] if origin else "",
                origin["source_url"] if origin else "",
                now_iso(),
            ),
        )
        for f in files:
            execute(
                "INSERT INTO library_files (id, model_id, path, size) VALUES (?,?,?,?)",
                (new_id(), model_id, str(f.relative_to(child)), f.stat().st_size),
            )
        created.append(model_id)
    return {"created": len(created), "ids": created, "matched": matched}


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

    # 首屏（空关键词 + trending + page 1）优先用本地热力榜：落过盘，重启也秒开
    board_name = f"models:{source}" if source else "models"
    if hot_board.matches(board_name, q=q, source=source, sort=sort, limit=limit, page=page, task=task):
        board = hot_board.get(board_name)
        if board is not None:
            return board

    settings = load_settings()
    if source and source != "all":
        names = [source]
    else:
        names = ["huggingface", "modelscope", "civitai"]

    def run(name: str) -> tuple[str, dict | None, str]:
        # 探针判 down 的源被门控：不向它发请求（规格 §3.1）。
        # unknown（没探过）不门控 —— 第一次打开应用时所有源都还在。
        if source_gate.is_gated(name, settings):
            gated.append(name)
            return name, None, ""
        # 发现与下载走同一条通路：读同一份探针缓存结论（规格 §3.6.2 层级三）
        cfg = source_gate.routed_source_cfg(name, settings)
        try:
            return name, get_adapter(name).search(q, limit, page, sort, cfg, task), ""
        except SourceError as exc:
            return name, None, str(exc)

    items: list[dict] = []
    total = 0
    errors: dict[str, str] = {}
    gated: list[str] = []
    if len(names) == 1:
        results = [run(names[0])]
    else:
        with ThreadPoolExecutor(max_workers=len(names)) as pool:
            results = list(pool.map(run, names))
    for name, result, err in results:
        if err:
            errors[name] = err
            continue
        if result is None:
            # 被门控的源：不发请求，也没有结果
            continue
        items.extend(result["items"])
        total += result["total"]

    if sort == "downloads":
        items.sort(key=lambda x: x.get("downloads") or 0, reverse=True)
    elif sort == "likes":
        items.sort(key=lambda x: x.get("likes") or 0, reverse=True)
    payload = {"items": items, "total": total, "errors": errors, "gated": gated}
    # 有源失败时不写缓存：一次网络抖动不该把空列表钉住 20 分钟。
    # 被门控的源同样不写 —— 源恢复后要能立刻搜到。
    if not errors and not gated:
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


# ---------------- 本地热力榜 ----------------
# 只登记「首屏默认参数」这一份；搜索词不空、或换了排序/来源时照旧实时查。
# 数据落在 var/data/hot/，进程重启后先读盘顶住，后台再去换新 ——
# 这样「后端重启一次，第一个进发现页的人白等一轮」这件事就不存在了。
hot_board.register(
    "models",
    hot_board.TTL_DEFAULT,
    {"q": "", "source": "", "sort": "trending", "limit": 20, "page": 1, "task": ""},
    lambda: search_models("", "", "trending", 20, 1, ""),
)
# 模型发现页前端是「按来源各发一次」，不是一次 all —— 必须按来源各建一份，
# 否则只有「全部来源」这种页面根本不发的参数能命中，等于没生效。
for _src in ("huggingface", "modelscope", "civitai"):
    hot_board.register(
        f"models:{_src}",
        hot_board.TTL_DEFAULT,
        {"q": "", "source": _src, "sort": "trending", "limit": 20, "page": 1, "task": ""},
        (lambda s: lambda: search_models("", s, "trending", 20, 1, ""))(_src),
    )
hot_board.register(
    "workflows",
    hot_board.TTL_DEFAULT,
    {"q": "", "source": "all", "sort": "downloads", "limit": 12, "page": 1},
    lambda: workflow_service.search("", "all", 12, 1, "downloads"),
)
hot_board.register(
    "nodes",
    hot_board.TTL_NODES,
    {"q": "", "sort": "nodes", "scope": "all", "limit": 20, "page": 1, "category": ""},
    lambda: node_service.search("", "nodes", "all", 20, 1, ""),
)


def warm_workflows() -> None:
    """预热工作流发现页首屏（后台线程调用，失败无所谓）。

    两件事：
    1. 把官方模板与 ComfyHub 两个全量索引读进内存 —— 它们落过盘，正常是毫秒级；
       盘上没有才真拉，那一步由 _index_cache 自己兜底。
    2. 跑一遍默认查询，让聚合结果（含时间预算后的合并结果）进 20 分钟缓存。

    不做这两步的话，后端每重启一次，第一个点进发现页的人就要等 2~3 秒：
    索引冷 + 聚合缓存冷，两笔一起付。
    """
    for warm in (
        lambda: workflow_service._templates(),
        lambda: workflow_service._hub_index(),
    ):
        try:
            warm()
        except Exception:  # noqa: BLE001 —— 预热失败只是少了优化，不该影响启动
            pass
    for sort in ("downloads", "latest"):
        try:
            workflow_service.search("", "all", 12, 1, sort)
        except Exception:  # noqa: BLE001
            pass


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


# ---------------- 封面图代理 ----------------
@router.get("/cover")
def cover_image(u: str) -> FileResponse:
    """把外部封面取到本地再发给浏览器。

    浏览器不挂代理/TUN 时，`image.civitai.com` 之类的图床直连拿不到；由后端按
    该源自己的代理开关去取，并落到 var/tmp/cover-cache 长期缓存。
    """
    try:
        path, media = image_proxy.get(u)
    except image_proxy.CoverError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    return FileResponse(
        path, media_type=media, headers={"Cache-Control": "public, max-age=604800, immutable"}
    )


@router.get("/cover/stats")
def cover_cache_stats() -> dict:
    """封面缓存占用：目录、张数、字节数。"""
    return image_proxy.stats()


@router.post("/cover/clear")
def clear_cover_cache() -> dict:
    """清空封面缓存（文件 + 索引），下次访问会重新取图。"""
    return image_proxy.clear()


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

# reload probe: touch
# reload probe 2
# fg probe
# precision probe
# statreload probe
# patched restart probe
# patched restart probe
# real project probe
# death probe
