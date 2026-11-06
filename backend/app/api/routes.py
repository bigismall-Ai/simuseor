"""REST API：设置 / 解析 / 任务 / 本地模型库 / 代理测试。"""
from __future__ import annotations

import os
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import load_settings, save_settings
from ..db import execute, new_id, now_iso, query
from ..download.manager import manager
from ..sources import get_adapter
from ..sources.base import SourceError

router = APIRouter(prefix="/api")


class ResolveRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""


class CreateTaskRequest(BaseModel):
    source: str
    repo_id: str
    revision: str = ""
    files: list[str] = Field(default_factory=list)
    strategy: str = ""
    save_dir: str = ""


class LibraryPatch(BaseModel):
    tags: list[str] | None = None
    favorite: bool | None = None
    review_state: str | None = None
    notes: str | None = None


class ScanRequest(BaseModel):
    path: str


class ProxyTestRequest(BaseModel):
    url: str = ""


@router.get("/health")
def health() -> dict:
    from ..config import get_web_dist
    return {"status": "ok", "web": get_web_dist() is not None}


# ---------------- 设置 ----------------
@router.get("/settings")
def get_settings() -> dict:
    return load_settings()


@router.put("/settings")
def put_settings(body: dict) -> dict:
    current = load_settings()
    for key, value in body.items():
        if isinstance(value, dict) and isinstance(current.get(key), dict):
            current[key].update(value)
        else:
            current[key] = value
    return save_settings(current)


# ---------------- 解析 ----------------
@router.post("/resolve")
def resolve(body: ResolveRequest) -> dict:
    settings = load_settings()
    cfg = settings["sources"].get(body.source)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"未配置的下载源: {body.source}")
    adapter = get_adapter(body.source)
    return adapter.resolve(body.repo_id, body.revision, cfg).to_dict()


# ---------------- 任务 ----------------
@router.post("/tasks")
def create_task(body: CreateTaskRequest) -> dict:
    return manager.create_task(body.source, body.repo_id, body.revision, body.files, body.strategy, body.save_dir)


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
    settings = load_settings()
    if source and source != "all":
        names = [source]
    else:
        names = ["huggingface", "modelscope", "civitai"]
    items: list[dict] = []
    total = 0
    errors: dict[str, str] = {}
    for name in names:
        cfg = settings["sources"].get(name) or {}
        try:
            result = get_adapter(name).search(q, limit, page, sort, cfg, task)
            items.extend(result["items"])
            total += result["total"]
        except SourceError as exc:
            errors[name] = str(exc)
    if sort == "downloads":
        items.sort(key=lambda x: x.get("downloads") or 0, reverse=True)
    elif sort == "likes":
        items.sort(key=lambda x: x.get("likes") or 0, reverse=True)
    return {"items": items, "total": total, "errors": errors}


# ---------------- 代理测试 ----------------
@router.post("/proxy/test")
def proxy_test(body: ProxyTestRequest) -> dict:
    url = body.url or load_settings()["proxy"]["url"]
    result: dict = {"proxy_url": url, "proxy": None, "direct": None}

    def probe(use_proxy: bool) -> dict:
        started = time.time()
        try:
            if use_proxy:
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
