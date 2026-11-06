"""ComfyUI 环境接口：设备探测 + 安装方案推导。

两个动作都是只读的：探测不装任何东西，方案推导是纯函数。
安装/启动等写操作留给后续的 installer 模块。
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter

from .plan import build_plan
from .probe import probe_device

router = APIRouter(prefix="/api/comfy", tags=["comfy"])

# 一次探测要跑 nvidia-smi / CIM 等子进程（约 0.3–1s）。前端每次进页面都会调，
# 加 60 秒缓存；用户点「重新检测」时带 refresh=true 绕过。
CACHE_SECONDS = 60
_cache: dict[str, Any] = {"at": 0.0, "payload": None}


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
