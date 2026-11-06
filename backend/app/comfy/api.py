"""ComfyUI 环境接口：设备探测 / 安装方案 / 安装执行。

探测与方案都是只读的；安装会真的写磁盘，因此走「预演 → 确认 → 后台任务」，
前端可以先看到完整命令序列再决定是否执行。
"""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from .installer import InstallSpec, build_steps, make_spec, run_install
from .plan import build_plan
from .probe import probe_device

router = APIRouter(prefix="/api/comfy", tags=["comfy"])

# 一次探测要跑 nvidia-smi / CIM 等子进程（约 0.3–1s）。前端每次进页面都会调，
# 加 60 秒缓存；用户点「重新检测」时带 refresh=true 绕过。
CACHE_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "payload": None}

# 安装任务：同时只允许一个在跑，避免两个进程抢同一个目录
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
RUNNING: set[str] = set()


@router.get("/env")
def get_comfy_env(refresh: bool = False) -> dict[str, Any]:
    """返回本机设备报告 + 据此推导出的安装方案。"""
    now = time.time()
    cached = _cache["payload"]
    if not refresh and cached is not None and now - float(_cache["at"]) < CACHE_SECONDS:
        return cached

    report = probe_device()
    plan = build_plan(report)
    payload = {
        "device": report.model_dump(),
        "plan": plan.model_dump(),
    }
    _cache["at"] = now
    _cache["payload"] = payload
    return payload


@router.post("/install/preview")
def preview_install(name: str = "", tag: str = "") -> dict[str, Any]:
    """预演：只生成步骤，不执行、不写盘。"""
    spec = _make_spec(name, tag)
    steps = build_steps(spec)
    return {
        "spec": {
            "name": spec.name,
            "workspace": str(spec.workspace),
            "comfy_dir": str(spec.comfy_dir),
            "venv_dir": str(spec.venv_dir),
            "python": spec.python_version,
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
def start_install(name: str = "", tag: str = "") -> dict[str, Any]:
    """启动安装。立即返回任务 id，进度通过 GET /install/{id} 轮询。"""
    spec = _make_spec(name, tag)

    with _jobs_lock:
        if RUNNING:
            raise HTTPException(status_code=409, detail="已有安装正在进行，请等待完成")
        job_id = uuid.uuid4().hex[:12]
        RUNNING.add(job_id)
        _jobs[job_id] = {
            "id": job_id,
            "status": "running",
            "name": spec.name,
            "workspace": str(spec.workspace),
            "events": [],
            "result": None,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

    def worker() -> None:
        job = _jobs[job_id]

        def emit(event: dict) -> None:
            job["events"].append({**event, "at": round(time.time(), 3)})

        try:
            result = run_install(spec, emit)
            job["status"] = "done" if result.ok else "failed"
            job["result"] = {
                "ok": result.ok,
                "message": result.message,
                "log_path": result.log_path,
                "instance": result.instance.model_dump() if result.instance else None,
            }
        except Exception as exc:  # noqa: BLE001
            job["status"] = "failed"
            job["result"] = {"ok": False, "message": f"安装异常: {exc}", "log_path": "", "instance": None}
        finally:
            with _jobs_lock:
                RUNNING.discard(job_id)
            # 安装完成后探测结果已过期（多了一个实例）
            _cache["payload"] = None

    threading.Thread(target=worker, name=f"comfy-install-{job_id}", daemon=True).start()
    return {"id": job_id}


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
        "name": job["name"],
        "workspace": job["workspace"],
        "result": job["result"],
        "total_events": len(events),
        "events": events[since:],
    }


def _make_spec(name: str, tag: str) -> InstallSpec:
    report = probe_device()
    plan = build_plan(report)
    try:
        return make_spec(report, plan, name=name.strip(), tag=tag.strip() or None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
