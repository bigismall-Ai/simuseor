"""FastAPI 入口：/api 路由 + Angular 静态托管（SPA 回退）。"""
from __future__ import annotations

import re
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
from .nodes import warm_catalog
from .sources.base import SourceError


def sync_workflow_layout() -> None:
    """启动时把旧版本留下的「打了分组却还在根目录」收敛成真实目录。

    organize_groups() 是幂等的，全部就位时零写入；目录不可写或侧车损坏也
    不该挡住服务启动，所以整段吞掉异常。
    """
    try:
        from . import workflows

        workflows.organize_groups()
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    migrate_legacy_comfy_layout()
    # workspace 是 ComfyUI 的 --base-directory，启动实例前必须存在
    ensure_workspace()
    # 预热发现页首屏的三条查询。必须放后台线程：它要打三家的网络，慢起来好几秒，
    # 在 lifespan 里同步跑等于让端口晚好几秒才开始监听。
    if "pytest" not in sys.modules:
        threading.Thread(target=sync_workflow_layout, name="sync-wf-layout", daemon=True).start()
        threading.Thread(target=warm_discover, name="warm-discover", daemon=True).start()
        # 节点清单 5.6MB，第一次进节点页要等十几秒，同样丢后台先拉
        warm_catalog()
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

# 静态资源缓存策略：
# - index.html（以及任何 SPA 回退）**一律不缓存**。它是入口，缓存了就等于把
#   整个旧版本钉在用户浏览器里 —— 后端明明已经发了新产物，页面却还是旧的。
#   之前没设 Cache-Control，浏览器会自己猜着缓存，刷新多少次都不生效。
# - 带 hash 的构建产物（main-XXXX.js / styles-XXXX.css）可以长期缓存：
#   文件名变了就是新内容，旧的可以放心留着。
#   注意 Angular 的命名是「名字-HASH.ext」（横杠），不是 Vite 的「名字.HASH.ext」（点），
#   两种都要认 —— 早先只写了点号那版，结果构建产物也走成 no-cache。
_IMMUTABLE = re.compile(r"([-.])([0-9A-Za-z_-]{8,})\.(js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$")


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
            headers = (
                {"Cache-Control": "public, max-age=31536000, immutable"}
                if _IMMUTABLE.search(candidate.name)
                else {"Cache-Control": "no-cache"}
            )
            return FileResponse(candidate, headers=headers)
    # SPA 回退：每次都回 index.html，绝不能缓存
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
