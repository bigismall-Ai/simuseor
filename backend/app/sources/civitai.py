"""Civitai 源：按模型 ID 解析版本文件（单文件下载为主）。"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Callable

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

API = "https://civitai.com/api/v1"

# 卡片是 4:3 横版，`object-fit: cover` 会从两端裁掉，所以按「离 4:3 多远」挑图。
COVER_RATIO = 4 / 3
# 非 PG 图（nsfwLevel > 1）的惩罚分：必须大于任何比例分，保证「有一张 PG 就用 PG」。
MATURE_PENALTY = 2.0


def pick_cover(versions: list[dict], allow_mature: bool = False) -> str:
    """从 Civitai 的 modelVersions 里挑一张适合当卡片封面的图，没有可用图返回空串。

    Civitai 是三家源里唯一「模型 = 图」的站，封面就挂在这里：
    `modelVersions[].images[]`，每条自带 nsfwLevel（1=PG / 2=Soft / 4=Mature / 8=X）。

    为什么不直接取 `images[0]`：实测 FLUX 的首图是 576×1024 竖版，铺进 266×202 的卡面
    要裁掉 48% 的高度，主体经常被切掉。这里按宽高比挑，单页解析不花额外请求。
    """
    best, best_score = "", None
    for version in versions[:3]:  # 只翻最新三个版本，老版本图基本是同一批风格的旧作
        for image in (version.get("images") or [])[:12]:
            url = image.get("url") or ""
            if not url or (image.get("type") or "image") != "image":
                continue  # 图集里混着视频，`<img>` 拿到会直接坏图
            level = int(image.get("nsfwLevel") or 0)
            if level > 1 and not allow_mature:
                continue
            width, height = int(image.get("width") or 0), int(image.get("height") or 0)
            if width > 0 and height > 0:
                score = abs(math.log((width / height) / COVER_RATIO))
            else:
                score = 1.5  # 没尺寸信息的排在有尺寸的后面，但别排除
            if level > 1:
                score += MATURE_PENALTY
            if best_score is None or score < best_score:
                best, best_score = url, score
    return best


class CivitaiAdapter(SourceAdapter):
    name = "civitai"
    uses_repo_subdir = False

    def __init__(self) -> None:
        # 关键词搜索游标缓存：key=(query,sort,nsfw,limit) → cursors[i] 为获取第 i+1 页所需游标（None 表示首页/末页）
        self._cursors: dict[tuple, list[str | None]] = {}

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
        page = max(1, int(page))
        if q:
            # Civitai 关键词搜索不支持 page 参数，走游标分页（缓存各页游标避免重复翻页）
            data = self._fetch_query_page(params, headers, page)
        else:
            data = self._fetch({**params, "page": page}, headers)
        items = []
        for m in data.get("items") or []:
            if m.get("type") == "Workflows":
                continue  # 工作流统一走工作流发现页，模型发现里屏蔽
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
                    # 只有 Civitai 给得出真封面；HF / ModelScope 的列表接口没有这个字段，
                    # 前端拿不到 `image` 就退回家族铭牌。
                    "image": pick_cover(versions, bool((cfg or {}).get("full_catalog"))),
                }
            )
        if task:
            items = [m for m in items if (m.get("task") or "") == task]
        return {"items": items, "total": len(items)}

    def _fetch(self, params: dict, headers: dict) -> dict:
        try:
            resp = httpx.get(
                f"{API}/models", params=params, headers=headers, timeout=30, follow_redirects=True
            )
        except httpx.HTTPError as exc:
            raise SourceError(f"Civitai 搜索失败: {exc}") from exc
        if resp.status_code >= 400:
            raise SourceError(f"Civitai 搜索错误 {resp.status_code}")
        return resp.json()

    def _fetch_query_page(self, params: dict, headers: dict, page: int) -> dict:
        """关键词搜索游标翻页：cursors[i] 为获取第 i+1 页的游标，末页之后再记 None。"""
        key = (params.get("query"), params.get("sort"), params.get("nsfw"), params.get("limit"))
        cursors = self._cursors.get(key) or [None]
        data: dict | None = None
        fetched = 0  # data 对应的页码
        while len(cursors) <= page:
            cur = cursors[-1]
            if cur is None and len(cursors) > 1:
                break  # 已到末页
            p = dict(params)
            if cur is not None:
                p["cursor"] = cur
            data = self._fetch(p, headers)
            fetched = len(cursors)
            cursors.append(self._next_cursor(data))
        self._cursors[key] = cursors
        while len(self._cursors) > 32:  # 有界缓存，淘汰最旧查询
            self._cursors.pop(next(iter(self._cursors)))
        if fetched == page and data is not None:
            return data
        if page == 1:
            return self._fetch(dict(params), headers)
        cur = cursors[page - 1] if page - 1 < len(cursors) else None
        if cur is None:
            return {"items": []}  # 已越过末页
        return self._fetch({**params, "cursor": cur}, headers)

    @staticmethod
    def _next_cursor(data: dict) -> str | None:
        meta = data.get("metadata") or {}
        cur = meta.get("nextCursor")
        if cur:
            return str(cur)
        m = re.search(r"[?&]cursor=([^&]+)", meta.get("nextPage") or "")
        return m.group(1) if m else None

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
