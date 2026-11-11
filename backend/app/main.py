"""FastAPI 入口：/api 路由 + Angular 静态托管（SPA 回退）。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

from .api.routes import router
from .comfy.api import router as comfy_router
from .config import get_web_dist, migrate_legacy_comfy_layout
from .db import init_db
from .sources.base import SourceError


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    migrate_legacy_comfy_layout()
    yield


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
