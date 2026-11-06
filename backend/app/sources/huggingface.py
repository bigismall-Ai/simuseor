"""Hugging Face 源：官方 API 解析 + 官方/镜像双候选 URL + 可选 huggingface_hub SDK。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable
from urllib.parse import quote

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

OFFICIAL = "https://huggingface.co"


class HuggingFaceAdapter(SourceAdapter):
    name = "huggingface"
    uses_repo_subdir = True

    def _headers(self, cfg: dict) -> dict:
        headers = {"User-Agent": "model-downloader/0.1"}
        token = (cfg or {}).get("token") or ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        cfg = cfg or {}
        revision = revision or "main"
        api_base = cfg.get("mirror") if cfg.get("use_mirror") and cfg.get("mirror") else OFFICIAL
        url = f"{api_base}/api/models/{repo_id}/tree/{quote(revision)}?recursive=true"
        try:
            resp = httpx.get(url, headers=self._headers(cfg), timeout=30, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise SourceError(f"Hugging Face 解析失败: {exc}") from exc
        if resp.status_code == 401:
            raise SourceError("Hugging Face 认证失败，请检查 token（私有仓库需要有效 token）")
        if resp.status_code == 404:
            raise SourceError(f"模型不存在: {repo_id}（revision={revision}）")
        if resp.status_code >= 400:
            raise SourceError(f"Hugging Face API 错误 {resp.status_code}: {resp.text[:200]}")

        mirror = (cfg.get("mirror") or "").rstrip("/")
        use_mirror = bool(cfg.get("use_mirror"))
        files: list[RemoteFile] = []
        for item in resp.json():
            if item.get("type") != "file":
                continue
            path = item.get("path") or ""
            size = int(item.get("size") or 0)
            official_url = f"{OFFICIAL}/{repo_id}/resolve/{revision}/{quote(path, safe='/')}"
            candidates = [official_url]
            if mirror:
                mirror_url = f"{mirror}/{repo_id}/resolve/{revision}/{quote(path, safe='/')}"
                candidates.insert(0, mirror_url) if use_mirror else candidates.append(mirror_url)
            files.append(RemoteFile(path=path, size=size, candidates=candidates))

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
        cfg = cfg or {}
        api_base = cfg.get("mirror") if cfg.get("use_mirror") and cfg.get("mirror") else OFFICIAL
        sort_map = {"downloads": "downloads", "likes": "likes", "recent": "lastModified"}
        params = {
            "search": q or "",
            "limit": max(1, min(int(limit), 50)),
            "page": max(1, int(page)),
            "sort": sort_map.get(sort, "downloads"),
            "direction": "-1",
            "full": "false",
        }
        if task:
            params["filter"] = task
        try:
            resp = httpx.get(
                f"{api_base}/api/models", params=params, headers=self._headers(cfg), timeout=30
            )
        except httpx.HTTPError as exc:
            raise SourceError(f"Hugging Face 搜索失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"Hugging Face 搜索错误 {resp.status_code}")
        items = []
        for m in resp.json():
            rid = m.get("id") or ""
            items.append(
                {
                    "id": rid,
                    "name": rid.split("/")[-1] if rid else "",
                    "author": m.get("author") or (rid.split("/")[0] if "/" in rid else ""),
                    "source": "huggingface",
                    "description": "",
                    "downloads": int(m.get("downloads") or 0),
                    "likes": int(m.get("likes") or 0),
                    "tags": (m.get("tags") or [])[:6],
                    "task": m.get("pipeline_tag") or "",
                    "url": f"https://huggingface.co/{rid}",
                    "updated_at": m.get("lastModified") or "",
                }
            )
        return {"items": items, "total": len(items)}

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
            from huggingface_hub import hf_hub_download
        except ImportError as exc:
            raise SourceError("未安装 huggingface_hub，无法使用 sdk 策略（pip install huggingface_hub）") from exc

        cfg = cfg or {}
        if cfg.get("use_mirror") and cfg.get("mirror"):
            os.environ["HF_ENDPOINT"] = cfg["mirror"]
        token = cfg.get("token") or None
        dest.mkdir(parents=True, exist_ok=True)
        for path in files:
            hf_hub_download(
                repo_id=repo_id,
                filename=path,
                revision=revision or "main",
                local_dir=str(dest),
                token=token,
            )
            if on_file_done:
                on_file_done(path)
