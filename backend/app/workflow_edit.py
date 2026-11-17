"""工作流编辑器：读文件、校验后写回、节点定义缓存。

编辑器不碰 ComfyUI 的画布，只处理共享目录里的 json。三条原则：

1. **只写回原文件**，写前留一份同名 `.bak`。编辑器的 bug 不该让用户丢工作流；
2. **保存前校验结构**（UI 的 nodes/links 或 API 的扁平节点表），校验失败不落盘；
3. **未知字段原样保留**。解析在前端做，后端只做 JSON 层的读写，不裁剪任何键。
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from .comfy.runner import active as active_instance
from .config import DATA_DIR, WORKSPACE_WORKFLOWS_DIR
from .sources.base import SourceError

MAX_WORKFLOW_BYTES = 8 * 1024 * 1024
OBJECT_INFO_TTL = 600.0

_OBJECT_INFO_PATH = DATA_DIR / "object_info.json"
_object_lock = threading.Lock()


class StaleWorkflow(SourceError):
    """磁盘上的文件在打开之后被别的程序改过，直接覆盖会吞掉对方的修改。"""


def _inside(path: str) -> Path:
    """路径必须落在共享工作流目录内，且是 json 文件。"""
    root = WORKSPACE_WORKFLOWS_DIR.resolve()
    try:
        target = Path(path).resolve()
    except (OSError, ValueError) as exc:
        raise SourceError("路径不合法") from exc
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise SourceError("只能编辑共享工作流目录里的文件") from exc
    if target.suffix.lower() != ".json":
        raise SourceError("只能编辑 .json 工作流文件")
    if not target.is_file():
        raise SourceError("文件不存在，可能已被移动或删除")
    return target


def shape(payload: object) -> str:
    """ui / api / broken。与列表页的判定保持一致，但这里允许空对象。"""
    if not isinstance(payload, dict):
        return "broken"
    nodes = payload.get("nodes")
    if isinstance(nodes, list):
        return "ui"
    inner = payload.get("workflow")
    if isinstance(inner, dict) and isinstance(inner.get("nodes"), list):
        return "ui"
    if payload and all(isinstance(v, dict) and "class_type" in v for v in payload.values()):
        return "api"
    if not payload:
        return "ui"
    return "broken"


def load(path: str) -> dict[str, Any]:
    """读一份工作流，连同原始文本一起返回。

    语法坏掉的文件不能整个拒之门外：编辑器至少要让用户看见原始内容，
    顺手改一个逗号。`data` 为 None 时前端只开 JSON 文本视图。
    """
    target = _inside(path)
    try:
        raw = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise SourceError(f"读取失败：{exc.strerror or exc}") from exc
    stat = target.stat()
    try:
        data = json.loads(raw)
        error = ""
        fmt = shape(data)
    except ValueError as exc:
        data = None
        error = f"JSON 语法错误：{exc}"
        fmt = "broken"
    return {
        "path": str(target),
        "name": target.stem,
        "folder": _folder(target),
        "format": fmt,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "data": data,
        "raw": raw,
        "error": error,
    }


def save(path: str, data: object, mtime: float | None = None) -> dict[str, Any]:
    """校验 + 备份 + 原子写回。

    `mtime` 是打开时的文件时间；传了就做一次乐观锁，防止两边同时改。
    """
    target = _inside(path)
    current = target.stat()

    if mtime is not None and abs(current.st_mtime - float(mtime)) > 0.001:
        raise StaleWorkflow("文件已被其他程序修改，请刷新后再保存")

    fmt = shape(data)
    if fmt == "broken":
        raise SourceError("不是有效的工作流结构：UI 格式需要 nodes 数组，API 格式需要 class_type")

    try:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    except (TypeError, ValueError) as exc:
        raise SourceError(f"内容无法序列化：{exc}") from exc
    blob = text.encode("utf-8")
    if len(blob) > MAX_WORKFLOW_BYTES:
        raise SourceError("工作流超过 8 MB，编辑器不再写回")

    backup = target.with_name(target.name + ".bak")
    tmp = target.with_name(target.name + ".tmp")
    try:
        shutil.copy2(target, backup)
        with tmp.open("wb") as fh:
            fh.write(blob)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except OSError as exc:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise SourceError(f"保存失败：{exc.strerror or exc}") from exc

    stat = target.stat()
    return {
        "path": str(target),
        "name": target.stem,
        "format": fmt,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "backup": str(backup),
    }


def _folder(target: Path) -> str:
    try:
        rel = target.resolve().relative_to(WORKSPACE_WORKFLOWS_DIR.resolve())
    except ValueError:
        return ""
    parent = rel.parent.as_posix()
    return "" if parent == "." else parent


def _read_cache() -> dict[str, Any] | None:
    try:
        data = json.loads(_OBJECT_INFO_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_cache(nodes: dict[str, Any], instance: str) -> None:
    try:
        _OBJECT_INFO_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _OBJECT_INFO_PATH.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {"fetched_at": time.time(), "instance": instance, "nodes": nodes},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        tmp.replace(_OBJECT_INFO_PATH)
    except OSError:
        pass  # 缓存写不进去只影响下次启动，不该让编辑器打不开


def object_info(refresh: bool = False) -> dict[str, Any]:
    """本机实例的 /object_info。实例没开就退回磁盘缓存，并标明没有实时来源。

    节点定义决定「能加哪些节点、每个端口是什么类型」。没有它时编辑器仍能
    改已有工作流（端口信息文件里自带），只是节点库是空的。
    """
    cached = _read_cache()
    fetched_at = float(cached.get("fetched_at") or 0) if cached else 0.0
    fresh = bool(cached) and (time.time() - fetched_at) < OBJECT_INFO_TTL

    instance = active_instance()
    with _object_lock:
        # 拿锁后再看一次：并发请求只该真的打一次实例
        if not refresh and fresh:
            return {
                "available": bool(instance),
                "source": (cached or {}).get("instance") or "",
                "fetched_at": fetched_at,
                "nodes": (cached or {}).get("nodes") or {},
                "cached": True,
            }

        if instance is None:
            return {
                "available": False,
                "source": (cached or {}).get("instance") or "",
                "fetched_at": fetched_at,
                "nodes": (cached or {}).get("nodes") or {},
                "cached": bool(cached),
                "error": "没有正在运行的 ComfyUI 实例，节点库暂时不可用",
            }

        url = f"http://127.0.0.1:{instance['port']}/object_info"
        try:
            resp = httpx.get(url, timeout=8.0, trust_env=False)
            resp.raise_for_status()
            nodes = resp.json()
            if not isinstance(nodes, dict):
                raise ValueError("object_info 不是对象")
        except (httpx.HTTPError, ValueError) as exc:
            return {
                "available": False,
                "source": (cached or {}).get("instance") or "",
                "fetched_at": fetched_at,
                "nodes": (cached or {}).get("nodes") or {},
                "cached": bool(cached),
                "error": f"读取节点定义失败：{exc}",
            }

        _write_cache(nodes, instance["name"])
        return {
            "available": True,
            "source": instance["name"],
            "fetched_at": time.time(),
            "nodes": nodes,
            "cached": False,
        }
