"""Civitai 源：按模型 ID 解析版本文件（单文件下载为主）。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

API = "https://civitai.com/api/v1"


class CivitaiAdapter(SourceAdapter):
    name = "civitai"
    uses_repo_subdir = False

    def search(self, q: str, limit: int, page: int, sort: str, cfg: dict, task: str = "") -> dict:
        sort_map = {"downloads": "Most Downloaded", "likes": "Highest Rated", "recent": "Newest"}
        params = {
            "query": q or "",
            "limit": max(1, min(int(limit), 50)),
        }
        # 综合：不传 sort，等同官网默认排序
        sort_key = sort_map.get(sort)
        if sort_key:
            params["sort"] = sort_key
        if q:
            # Civitai 限制：关键词搜索不支持 page 参数（游标分页），只返回首页
            if int(page) > 1:
                return {"items": [], "total": 0}
        else:
            params["page"] = max(1, int(page))
        # CivitAI Red 可见性=完整目录（含成熟内容）。注意 browsingLevel 的 GET 校验有缺陷
        # （z.number() 不做字符串转数字，任何取值都报 ZodError），这里用官方遗留的 nsfw 参数。
        if (cfg or {}).get("full_catalog"):
            params["nsfw"] = "true"
        # 原始页面链接跟随可见性：完整目录走 civitai.red（.com 只有 SFW），API 仍用 civitai.com
        web_base = "https://civitai.red" if (cfg or {}).get("full_catalog") else "https://civitai.com"
        headers = {"User-Agent": "model-downloader/0.1"}
        token = (cfg or {}).get("token") or ""
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            resp = httpx.get(
                f"{API}/models", params=params, headers=headers, timeout=30, follow_redirects=True
            )
        except httpx.HTTPError as exc:
            raise SourceError(f"Civitai 搜索失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"Civitai 搜索错误 {resp.status_code}")
        items = []
        for m in resp.json().get("items") or []:
            stats = m.get("stats") or {}
            versions = m.get("modelVersions") or []
            desc = re.sub(r"<[^>]+>", " ", m.get("description") or "")
            items.append(
                {
                    "id": str(m.get("id")),
                    "name": m.get("name") or "",
                    "author": (m.get("creator") or {}).get("username") or "",
                    "source": "civitai",
                    "description": re.sub(r"\s+", " ", desc)[:160],
                    "downloads": int(stats.get("downloadCount") or 0),
                    "likes": int(stats.get("favoriteCount") or 0),
                    "tags": (m.get("tags") or [])[:6],
                    "task": m.get("type") or "",
                    "url": f"{web_base}/models/{m.get('id')}",
                    "updated_at": (versions[0].get("createdAt") if versions else "") or "",
                }
            )
        if task:
            items = [m for m in items if (m.get("task") or "") == task]
        return {"items": items, "total": len(items)}

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        cfg = cfg or {}
        model_id = repo_id.strip().rstrip("/").split("/")[-1]
        if "-" in model_id and model_id.split("-")[-1].isdigit():
            model_id = model_id.split("-")[-1]
        if not model_id.isdigit():
            raise SourceError("Civitai 需要数字模型 ID（如 123456）或 slug-id 形式")

        headers = {"User-Agent": "model-downloader/0.1"}
        token = cfg.get("token") or ""
        detail_params = {"nsfw": "true"} if cfg.get("full_catalog") else None
        try:
            resp = httpx.get(f"{API}/models/{model_id}", params=detail_params, headers=headers, timeout=30, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise SourceError(f"Civitai 解析失败: {exc}") from exc
        if resp.status_code == 404:
            raise SourceError(f"Civitai 模型不存在: {model_id}")
        if resp.status_code >= 400:
            raise SourceError(f"Civitai API 错误 {resp.status_code}: {resp.text[:200]}")

        payload = resp.json()
        name = payload.get("name") or model_id
        versions = payload.get("modelVersions") or []
        if not versions:
            raise SourceError("该模型没有可用版本")
        version = versions[0]
        for v in versions:
            if revision and str(v.get("id")) == str(revision):
                version = v
                break

        files: list[RemoteFile] = []
        for f in version.get("files") or []:
            fname = f.get("name") or "model.safetensors"
            size = int((f.get("sizeKB") or 0) * 1024)
            dl = f.get("downloadUrl") or ""
            if not dl:
                continue
            if token:
                dl = f"{dl}{'&' if '?' in dl else '?'}token={token}"
            files.append(RemoteFile(path=f"{version.get('name', 'v1')}/{fname}", size=size, candidates=[dl]))
        if not files:
            raise SourceError("该版本没有可下载文件")
        return RepoInfo(
            repo_id=model_id,
            display_name=name,
            revision=str(version.get("id")),
            source=self.name,
            files=files,
        )
