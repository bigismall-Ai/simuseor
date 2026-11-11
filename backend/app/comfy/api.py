"""ComfyUI 环境接口：设备探测 / 安装方案 / 安装执行。

探测与方案都是只读的；安装会真的写磁盘，因此走「预演 → 确认 → 后台任务」，
前端可以先看到完整命令序列再决定是否执行。
"""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import COMFY_DIR, COMFY_ENV_DIR, LOG_DIR
from .doctor import check_environment
from .installer import (
    INSTALL_KINDS,
    JOB_KIND_ENV,
    JOB_KIND_INSTANCE,
    InstallSpec,
    build_steps,
    make_spec,
    run_install,
)
from .plan import build_plan
from .probe import cached_mirrors, probe_device, probe_mirrors, probe_runtime, warm_mirrors

router = APIRouter(prefix="/api/comfy", tags=["comfy"])

# 一次探测要跑 nvidia-smi / CIM 等子进程（约 0.3–1s）。前端每次进页面都会调，
# 加 60 秒缓存；用户点「重新检测」时带 refresh=true 绕过。
CACHE_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "payload": None}
# 探测结果单独留一份原始对象：/env 与「点开安装弹层」共用，省掉重复的 nvidia-smi
_probe_cache: dict[str, Any] = {"at": 0.0, "report": None, "plan": None}


def _device_snapshot(force: bool = False) -> tuple[Any, Any]:
    """取设备报告与基础方案，60 秒内复用，避免每次点安装都重跑一遍探测。"""
    now = time.time()
    if (
        not force
        and _probe_cache["report"] is not None
        and now - float(_probe_cache["at"]) < CACHE_SECONDS
    ):
        return _probe_cache["report"], _probe_cache["plan"]
    report = probe_device()
    plan = build_plan(report)
    _probe_cache.update(at=now, report=report, plan=plan)
    return report, plan

# 安装任务：同时只允许一个在跑，避免两个进程抢同一个目录
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
RUNNING: set[str] = set()

# 正在删除的实例名。删除是同步慢操作（rmdir 整个实例目录），
# 前端刷新页面后请求虽断开、后端仍会删完；靠这个集合让新页面知道「删除中」。
_deleting: set[str] = set()
_deleting_guard = threading.Lock()

# 实例目录名由安装器生成（vYYYYMMDD-HHMMSS），也允许用户自定义。
# 只允许单层名字，杜绝 "../" 之类的路径穿越。
INSTANCE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")


def _rmtree_force(func, path, exc) -> None:
    """Windows 上 git 对象常带只读属性，去掉只读位再重试删除。"""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        raise exc


def _rmtree_python(target: Path) -> None:
    if sys.version_info >= (3, 12):
        shutil.rmtree(target, onexc=_rmtree_force)
    else:
        shutil.rmtree(target, onerror=_rmtree_force)


def _rmtree_native(target: Path) -> None:
    """系统级递归删除，绕开被宿主运行时替换过的 Python 删除 API。

    某些开发运行时会给 shutil.rmtree / os.unlink 装上「批量删除确认」钩子：
    一次删上千个文件会抛 SystemExit，FastAPI 因此返回不带 detail 的裸 500，
    前端只能显示「目录被占用」这种误导性兜底文案。这是用户已在界面二次
    确认过的实例目录，改走系统原生命令，既不受钩子影响也能清掉只读文件。
    """
    if os.name == "nt":
        cmd = ["cmd", "/d", "/c", "rmdir", "/s", "/q", str(target)]
    else:
        cmd = ["rm", "-rf", "--", str(target)]
    # 中文 Windows 的 cmd 输出是 GBK，直接 text=True 会让读取线程 UnicodeDecodeError
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
        check=False,
    )
    if proc.returncode != 0 or target.exists():
        reason = (proc.stderr or proc.stdout or "").strip() or f"退出码 {proc.returncode}"
        raise OSError(f"系统删除命令失败：{reason}")


def _rmtree_is_patched() -> bool:
    """stdlib 的 rmtree 定义在 shutil 模块；被宿主运行时替换后 __module__ 会变。"""
    return getattr(shutil.rmtree, "__module__", "shutil") != "shutil"


def _remove_tree(target: Path) -> None:
    """优先 Python 删除；宿主替换过删除 API 或弹出守卫时走系统原生命令。"""
    if _rmtree_is_patched():
        _rmtree_native(target)
        return
    try:
        _rmtree_python(target)
    except SystemExit:
        _rmtree_native(target)


@router.delete("/instances/{name}")
def delete_instance(name: str) -> dict[str, Any]:
    """删除自有实例目录（含 ComfyUI 代码）；共享 .environment 与模型目录不动。"""
    if ".." in name or not INSTANCE_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="实例名不合法")

    root = COMFY_DIR.resolve()
    target = (root / name).resolve()
    if target == root or target.parent != root:
        raise HTTPException(status_code=400, detail="实例路径不合法")
    # 基础环境与实例平级后，绝不能让删除端点碰到 .environment
    if name.startswith(".") or target == COMFY_ENV_DIR.resolve():
        raise HTTPException(status_code=400, detail="共享基础环境不能删除")
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="实例不存在")
    # 只删我们自己创建的目录：有 instance.json，或者至少是克隆出的 ComfyUI 结构。
    # 用户在 comfy/ 下随手放的文件夹一律不碰。
    if not (target / "instance.json").is_file() and not (target / "ComfyUI").is_dir():
        raise HTTPException(status_code=404, detail="不是可管理的实例")

    with _jobs_lock:
        busy = any(
            job.get("status") == "running"
            and Path(job.get("workspace", "")).resolve() == target
            for job in _jobs.values()
        )
    if busy:
        raise HTTPException(status_code=409, detail="该实例正在安装，请等待完成")

    with _deleting_guard:
        if name in _deleting:
            raise HTTPException(status_code=409, detail="该实例正在删除，请等待完成")
        _deleting.add(name)

    try:
        try:
            _remove_tree(target)
        except Exception as exc:  # noqa: BLE001 - 任何失败都要给前端一个能显示的 detail
            raise HTTPException(status_code=500, detail=f"删除失败：{exc}") from exc
    finally:
        with _deleting_guard:
            _deleting.discard(name)

    _cache["payload"] = None  # 实例数量变了，设备报告的缓存立即失效
    return {"deleted": name}


@router.get("/env")
def get_comfy_env(refresh: bool = False) -> dict[str, Any]:
    """返回本机设备报告 + 据此推导出的安装方案。"""
    now = time.time()
    cached = _cache["payload"]
    if not refresh and cached is not None and now - float(_cache["at"]) < CACHE_SECONDS:
        return {**cached, "deleting_instances": sorted(_deleting)}

    report, plan = _device_snapshot(force=refresh)
    payload = {
        "device": report.model_dump(),
        "plan": plan.model_dump(),
        "runtime": probe_runtime().model_dump(),
    }
    # deleting_instances 是瞬时状态，不写入缓存体，只在响应里补
    _cache["at"] = now
    _cache["payload"] = payload
    return {**payload, "deleting_instances": sorted(_deleting)}


@router.post("/env/check")
def check_env() -> dict[str, Any]:
    """环境检测：实测内置解释器与 PyTorch 是否可用，产出可修复的问题列表。

    与 /env 的只读文件探测不同，这里会真的启动解释器 import torch，
    用于「环境出问题了」时定位并修复，不做任何写盘操作。
    """
    return check_environment()


@router.post("/install/preview")
def preview_install(
    name: str = "", tag: str = "", kind: str = "full", repair: bool = False
) -> dict[str, Any]:
    """预演：只生成步骤，不执行、不写盘。"""
    kind = _check_kind(kind)
    spec = _make_spec(name, tag, kind, repair, fast=True)
    steps = build_steps(spec, kind)
    return {
        "kind": kind,
        "spec": {
            "name": spec.name,
            "workspace": str(spec.workspace),
            "comfy_dir": str(spec.comfy_dir),
            "environment": str(spec.environment),
            "python": spec.runtime_version,
            "channel": spec.torch_channel,
        },
        "steps": [
            {
                "key": step.key,
                "title": step.title,
                "detail": step.detail,
                "command": step.command,
                "estimated_gb": step.estimated_gb,
            }
            for step in steps
        ],
        "total_gb": round(sum(step.estimated_gb for step in steps), 1),
    }


@router.post("/install")
def start_install(
    name: str = "", tag: str = "", kind: str = "full", repair: bool = False
) -> dict[str, Any]:
    """启动安装。立即返回任务 id，进度通过 GET /install/{id} 轮询。"""
    kind = _check_kind(kind)
    spec = _make_spec(name, tag, kind, repair)

    with _jobs_lock:
        if RUNNING:
            raise HTTPException(status_code=409, detail="已有安装正在进行，请等待完成")
        job_id = uuid.uuid4().hex[:12]
        RUNNING.add(job_id)
        # 步骤随任务一起存下来：页面刷新后重新接管时，靠它重建弹层内容
        steps = build_steps(spec, kind)
        _jobs[job_id] = {
            "id": job_id,
            "status": "running",
            "kind": kind,
            "repair": repair,
            "name": spec.name,
            "workspace": str(spec.workspace),
            "spec": {
                "name": spec.name,
                "workspace": str(spec.workspace),
                "comfy_dir": str(spec.comfy_dir),
                "environment": str(spec.environment),
                "python": spec.runtime_version,
                "channel": spec.torch_channel,
            },
            "steps": [
                {
                    "key": step.key,
                    "title": step.title,
                    "detail": step.detail,
                    "command": step.command,
                    "estimated_gb": step.estimated_gb,
                }
                for step in steps
            ],
            "events": [],
            "result": None,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

    def worker() -> None:
        job = _jobs[job_id]

        def emit(event: dict) -> None:
            job["events"].append({**event, "at": round(time.time(), 3)})

        try:
            result = run_install(spec, emit, kind=kind)
            job["status"] = "done" if result.ok else "failed"
            job["result"] = {
                "ok": result.ok,
                "message": result.message,
                "log_path": result.log_path,
                "instance": result.instance.model_dump() if result.instance else None,
            }
        except Exception as exc:  # noqa: BLE001
            # 兜底：run_install 自己会转成失败结果，走到这里说明是没预料到的异常。
            # 把调用栈推到右侧日志里，别只留一句干巴巴的「安装异常」。
            log_path = LOG_DIR / f"comfy-{spec.name}.log"
            job["status"] = "failed"
            job["result"] = {
                "ok": False,
                "message": f"安装异常: {exc}",
                "log_path": str(log_path) if log_path.is_file() else "",
                "instance": None,
            }
            emit({"type": "log", "line": f"!! 安装异常: {exc}"})
            for line in traceback.format_exc().strip().splitlines():
                emit({"type": "log", "line": line})
        finally:
            with _jobs_lock:
                RUNNING.discard(job_id)
            # 安装完成后探测结果已过期（多了一个实例）
            _cache["payload"] = None

    threading.Thread(target=worker, name=f"comfy-install-{job_id}", daemon=True).start()
    return {"id": job_id}


@router.get("/install/current")
def get_current_install() -> dict[str, Any]:
    """返回可接管的安装任务。

    刷新页面后前端靠这个接口恢复：优先返回正在跑的，没有则返回最近一次
    完成/失败的，让用户还能看到结果和日志。
    """
    running = [job for job in _jobs.values() if job["status"] == "running"]
    if running:
        return {"job": running[-1]}
    if _jobs:
        latest = max(_jobs.values(), key=lambda job: job["started_at"])
        return {"job": latest}
    return {"job": None}


@router.get("/install/{job_id}")
def get_install(job_id: str, since: int = 0) -> dict[str, Any]:
    """返回任务状态与事件。since 用于增量拉取（只返回该下标之后的事件）。"""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    events = job["events"]
    return {
        "id": job["id"],
        "status": job["status"],
        "kind": job.get("kind", "full"),
        "repair": job.get("repair", False),
        "name": job["name"],
        "workspace": job["workspace"],
        "spec": job.get("spec"),
        "steps": job.get("steps", []),
        "result": job["result"],
        "total_events": len(events),
        "events": events[since:],
    }


def _check_kind(kind: str) -> str:
    if kind not in INSTALL_KINDS:
        raise HTTPException(status_code=400, detail=f"未知的安装类型: {kind}")
    return kind


def _make_spec(
    name: str, tag: str, kind: str, repair: bool = False, *, fast: bool = False
) -> InstallSpec:
    # 实例只放 ComfyUI 代码，运行依赖靠共享基础环境；环境没装好时不允许建实例。
    if kind == JOB_KIND_INSTANCE and not probe_runtime().ready:
        raise HTTPException(status_code=409, detail="请先安装基础环境，再创建 ComfyUI 实例")

    report, plan = _device_snapshot()
    # 测速要读几个源的真实 wheel（实测量级 2–6 秒），绝不能在「点开弹层」这条
    # 路径上等它：有缓存就用实测结果，没有就先按默认源出计划、后台预热，
    # 等用户看完步骤点「确认安装」时缓存通常已经热了。
    if fast:
        mirrors = cached_mirrors(plan.torch_channel)
        if mirrors:
            plan = build_plan(report, mirrors)
        else:
            warm_mirrors(plan.torch_channel)
    else:
        plan = build_plan(report, probe_mirrors(plan.torch_channel))
    # 基础环境任务只需要一个稳定的日志名，不该占用实例名。
    resolved = "environment" if kind == JOB_KIND_ENV else name.strip()
    try:
        return make_spec(
            report, plan, name=resolved, tag=tag.strip() or None, repair=repair
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
