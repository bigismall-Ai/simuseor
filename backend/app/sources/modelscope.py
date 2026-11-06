"""ModelScope 源：官方 repo/files API 解析 + 可选 modelscope SDK。"""
from __future__ import annotations

from pathlib import Path
from typing import Callable
from urllib.parse import quote

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

API = "https://modelscope.cn"


class ModelScopeAdapter(SourceAdapter):
    name = "modelscope"
    uses_repo_subdir = True

    def _headers(self, cfg: dict) -> dict:
        headers = {"User-Agent": "model-downloader/0.1"}
        token = (cfg or {}).get("token") or ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        cfg = cfg or {}
        revision = revision or "master"
        url = f"{API}/api/v1/models/{repo_id}/repo/files?Revision={quote(revision)}&Root="
        try:
            resp = httpx.get(url, headers=self._headers(cfg), timeout=30, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise SourceError(f"ModelScope 解析失败: {exc}") from exc
        if resp.status_code == 404:
            raise SourceError(f"模型不存在: {repo_id}（revision={revision}）")
        if resp.status_code >= 400:
            raise SourceError(f"ModelScope API 错误 {resp.status_code}: {resp.text[:200]}")

        payload = resp.json()
        data = payload.get("Data") or {}
        entries = data.get("Files") or data.get("Root") or []

        def walk(items: list, prefix: str = "") -> None:
            for item in items:
                name = item.get("Name") or item.get("Path") or ""
                path = item.get("Path") or f"{prefix}{name}"
                if item.get("Type") == "folder" or item.get("IsFolder"):
                    walk(item.get("Files") or item.get("Children") or [], prefix=f"{path}/")
                    continue
                size = int(item.get("Size") or 0)
                dl = f"{API}/api/v1/models/{repo_id}/repo?Revision={quote(revision)}&FilePath={quote(path, safe='/')}"
                files.append(RemoteFile(path=path, size=size, candidates=[dl]))

        files: list[RemoteFile] = []
        walk(entries)
        if not files:
            raise SourceError("仓库里没有可下载的文件")
        return RepoInfo(
            repo_id=repo_id,
            display_name=repo_id.split("/")[-1],
            revision=revision,
            source=self.name,
            files=files,
        )

    def supports_sdk(self) -> bool:
        return True

    def search(self, q: str, limit: int, page: int, sort: str, cfg: dict, task: str = "") -> dict:
        sort_map = {"downloads": "downloads", "likes": "likes", "recent": "last_modified"}
        params = {
            "search": q or "",
            "page_size": max(1, min(int(limit), 50)),
            "page": max(1, int(page)),
            "sort": sort_map.get(sort, "downloads"),
        }
        try:
            resp = httpx.get(
                f"{API}/openapi/v1/models",
                params=params,
                headers=self._headers(cfg or {}),
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise SourceError(f"ModelScope 搜索失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"ModelScope 搜索错误 {resp.status_code}")
        data = resp.json().get("data") or {}
        items = []
        for m in data.get("models") or []:
            rid = m.get("id") or ""
            tags = [t for t in [m.get("license"), m.get("task"), m.get("library"), m.get("language")] if t]
            items.append(
                {
                    "id": rid,
                    "name": m.get("display_name") or (rid.split("/")[-1] if rid else ""),
                    "author": rid.split("/")[0] if "/" in rid else "",
                    "source": "modelscope",
                    "description": (m.get("description") or "")[:160],
                    "downloads": int(m.get("downloads") or 0),
                    "likes": int(m.get("likes") or 0),
                    "tags": tags[:6],
                    "task": m.get("task") or "",
                    "url": f"https://modelscope.cn/models/{rid}",
                    "updated_at": m.get("last_updated_time") or m.get("created_at") or "",
                }
            )
        if task:
            items = [m for m in items if (m.get("task") or "") == task]
        return {"items": items, "total": int(data.get("total_count") or len(items))}

    def sdk_download(
        self,
        repo_id: str,
        revision: str,
        files: list[str],
        dest: Path,
        cfg: dict,
        on_file_done: Callable[[str], None] | None = None,
    ) -> None:
        try:
            from modelscope.hub.snapshot_download import snapshot_download
        except ImportError as exc:
            raise SourceError("未安装 modelscope，无法使用 sdk 策略（pip install modelscope）") from exc

        cfg = cfg or {}
        token = cfg.get("token") or None
        if token:
            import os

            os.environ["MODELSCOPE_API_TOKEN"] = token
        dest.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            model_id=repo_id,
            revision=revision or "master",
            local_dir=str(dest),
            allow_patterns=files,
        )
        if on_file_done:
            for path in files:
                on_file_done(path)
