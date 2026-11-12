"""FastAPI 入口：/api 路由 + Angular 静态托管（SPA 回退）。"""
from __future__ import annotations

import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

from .api.routes import router, warm_discover
from .comfy.api import router as comfy_router
from .comfy.runner import stop_all as stop_comfy_instances
from .config import ensure_workspace, get_web_dist, migrate_legacy_comfy_layout
from .db import init_db
from .sources.base import SourceError


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    migrate_legacy_comfy_layout()
    # workspace 是 ComfyUI 的 --base-directory，启动实例前必须存在
    ensure_workspace()
    # 预热发现页首屏的三条查询。必须放后台线程：它要打三家的网络，慢起来好几秒，
    # 在 lifespan 里同步跑等于让端口晚好几秒才开始监听。
    if "pytest" not in sys.modules:
        threading.Thread(target=warm_discover, name="warm-discover", daemon=True).start()
    try:
        yield
    finally:
        # 后端退出时收掉自己拉起的实例，别留占端口的孤儿进程
        stop_comfy_instances()


app = FastAPI(title="Model Downloader", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.include_router(comfy_router)


@app.exception_handler(SourceError)
async def source_error_handler(_request, exc: SourceError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})

DIST = get_web_dist()


@app.get("/{full_path:path}")
def spa(full_path: str):
    if DIST is None:
        return JSONResponse(
            {"detail": "前端未构建。请先执行: cd web && npm install && npm run build"},
            status_code=503,
        )
    base = DIST.resolve()
    if full_path:
        candidate = (DIST / full_path).resolve()
        if candidate.is_file() and base in candidate.parents:
            return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
