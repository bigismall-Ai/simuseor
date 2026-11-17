"""Hugging Face 源：官方 API 解析 + 官方/镜像双候选 URL + 可选 huggingface_hub SDK。"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, quote, urlparse

import httpx

from ..config import source_proxy
from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

OFFICIAL = "https://huggingface.co"


def _json(resp: httpx.Response, what: str) -> Any:
    """取 JSON，失败时把「哪一步、什么状态码、重定向到哪」说清楚。

    踩过的坑：hf-mirror.com 在非大陆出口会把 `/api/*` 与 `/{repo}/resolve/*` 一律
    308 跳回官方站，响应体是空的。`resp.json()` 直接抛 JSONDecodeError，一路冒到 500，
    前端只能给出「搜索失败，请检查网络」—— 看起来像网络问题，实际是镜像没在代理。
    """
    try:
        return resp.json()
    except ValueError as exc:
        location = resp.headers.get("location") or ""
        detail = f"HTTP {resp.status_code}" + (f" → {location}" if location else "")
        raise SourceError(
            f"Hugging Face {what}返回的不是 JSON（{detail}）—— "
            "镜像站可能没有代理这个接口（或当前出口让它跳回官方），"
            "可在设置里关掉「使用镜像」后重试"
        ) from exc


class HuggingFaceAdapter(SourceAdapter):
    name = "huggingface"
    uses_repo_subdir = True

    def __init__(self) -> None:
        # HF 的 /api/models **不认 page 参数**（实测 1/2/3 页返回同一批），
        # 翻页只能跟随响应 Link 头里的 cursor。这里按查询缓存每页的游标。
        self._cursors: dict[tuple, list[str | None]] = {}

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
        # 走镜像时强制直连：镜像是国内线路，绕代理会让它看到海外 IP 并 308 跳回官方
        proxy = None if api_base != OFFICIAL else source_proxy(cfg)
        url = f"{api_base}/api/models/{repo_id}/tree/{quote(revision)}?recursive=true"
        try:
            resp = httpx.get(
                url, headers=self._headers(cfg), timeout=30, follow_redirects=True, proxy=proxy
            )
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
        for item in _json(resp, "文件列表"):
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
        proxy = None if api_base != OFFICIAL else source_proxy(cfg)
        sort_map = {"downloads": "downloads", "likes": "likes", "recent": "lastModified"}
        params = {
            "search": q or "",
            "limit": max(1, min(int(limit), 50)),
            "full": "false",
        }
        # 综合：不传 sort/direction，等同官网默认排序（trendingScore）
        sort_key = sort_map.get(sort)
        if sort_key:
            params["sort"] = sort_key
            params["direction"] = "-1"
        if task:
            params["filter"] = task
        data = self._fetch_query_page(api_base, params, self._headers(cfg), proxy, max(1, int(page)))
        items = []
        for m in data:
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

    def _fetch(self, api_base: str, params: dict, headers: dict,
               proxy: str | None) -> tuple[list, str | None]:
        try:
            resp = httpx.get(
                f"{api_base}/api/models",
                params=params,
                headers=headers,
                timeout=30,
                follow_redirects=True,
                proxy=proxy,
            )
        except httpx.HTTPError as exc:
            raise SourceError(f"Hugging Face 搜索失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"Hugging Face 搜索错误 {resp.status_code}")
        return _json(resp, "搜索"), self._next_cursor(resp)

    @staticmethod
    def _next_cursor(resp: httpx.Response) -> str | None:
        """从 Link 头里取下一页游标。

        `Link: <https://huggingface.co/api/models?...&cursor=eyJ...>; rel="next"`
        """
        link = resp.headers.get("link") or ""
        m = re.search(r'<([^>]+)>\s*;\s*rel="next"', link)
        if not m:
            return None
        cur = parse_qs(urlparse(m.group(1)).query).get("cursor")
        return cur[0] if cur else None

    def _fetch_query_page(self, api_base: str, params: dict, headers: dict,
                          proxy: str | None, page: int) -> list:
        """游标翻页：cursors[i] 为获取第 i+1 页所需游标（None = 首页/末页）。"""
        key = (
            api_base,
            params.get("search"),
            params.get("sort"),
            params.get("direction"),
            params.get("filter"),
            params.get("limit"),
        )
        cursors = self._cursors.get(key) or [None]
        data: list | None = None
        fetched = 0
        while len(cursors) <= page:
            cur = cursors[-1]
            if cur is None and len(cursors) > 1:
                break  # 已到末页
            p = dict(params)
            if cur is not None:
                p["cursor"] = cur
            data, nxt = self._fetch(api_base, p, headers, proxy)
            fetched = len(cursors)
            cursors.append(nxt)
        self._cursors[key] = cursors
        while len(self._cursors) > 32:  # 有界缓存，淘汰最旧查询
            self._cursors.pop(next(iter(self._cursors)))
        if fetched == page and data is not None:
            return data
        if page == 1:
            data, _ = self._fetch(api_base, dict(params), headers, proxy)
            return data
        cur = cursors[page - 1] if page - 1 < len(cursors) else None
        if cur is None:
            return []  # 已越过末页
        data, _ = self._fetch(api_base, {**params, "cursor": cur}, headers, proxy)
        return data

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
