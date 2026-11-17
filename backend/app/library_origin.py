"""从本地目录还原模型的来源原址。

只认**明确证据**，不按目录名 / 文件名去猜：

1. 本应用自己的下载任务（`target_dir` 精确匹配）—— 用户删了库记录再扫描，
   任务表里还留着 source / repo_id / revision；
2. Civitai Helper 的 `.civitai.info` / `.civitai.json` 侧车 —— 里面直接写着
   `modelId` 与版本 id。

一个指向错误模型的链接比没有链接更糟，所以没有证据就返回 None，
前端就不渲染来源胶囊。
"""
from __future__ import annotations

import json
from pathlib import Path

from .db import query
from .source_urls import source_page_url

# 侧车文件名：Civitai Helper 常见 `{model}.civitai.info`，也有 `.civitai.json`
_SIDECAR_PATTERNS = ("*.civitai.info", "*.civitai.json")
# 这些来源没有可跳转的远端页面
_LOCAL_SOURCES = {"", "imported", "demo"}


def detect_origin(directory: Path) -> dict | None:
    """返回 `{source, repo_id, revision, source_url}`；识别不出返回 None。"""
    by_task = _from_task(directory)
    if by_task:
        return by_task
    return _from_civitai_sidecar(directory)


def _from_task(directory: Path) -> dict | None:
    rows = query(
        "SELECT source, repo_id, revision FROM tasks"
        " WHERE lower(target_dir)=lower(?) AND status='completed'"
        " ORDER BY created_at DESC LIMIT 1",
        (str(directory),),
    )
    if not rows:
        return None
    row = rows[0]
    source = row.get("source") or ""
    repo_id = row.get("repo_id") or ""
    if source in _LOCAL_SOURCES or not repo_id:
        return None
    revision = row.get("revision") or ""
    url = source_page_url(source, repo_id, revision)
    if not url:
        return None
    return {"source": source, "repo_id": repo_id, "revision": revision, "source_url": url}


def _from_civitai_sidecar(directory: Path) -> dict | None:
    if not directory.is_dir():
        return None
    sidecar = None
    for pattern in _SIDECAR_PATTERNS:
        hits = sorted(directory.glob(pattern))
        if hits:
            sidecar = hits[0]
            break
    if sidecar is None:
        return None
    try:
        data = json.loads(sidecar.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None

    model = data.get("model") if isinstance(data.get("model"), dict) else {}
    model_id = data.get("modelId") or model.get("id")
    if not model_id:
        return None
    version_id = data.get("id") or data.get("modelVersionId") or ""
    revision = str(version_id)
    url = source_page_url("civitai", str(model_id), revision)
    if not url:
        return None
    return {
        "source": "civitai",
        "repo_id": str(model_id),
        "revision": revision,
        "source_url": url,
    }
