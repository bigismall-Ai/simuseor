"""ComfyHub 社区工作流源。

条目来自 Hub 的已审核索引 `cloud.comfy.org/api/hub/workflows/index`
（发现页用它拼卡片），单条工作流的画布 JSON 走站点公开的下载路由
`comfy.org/workflows/download/<shareId>.json`——实测返回的是带 nodes/links
的 ComfyUI UI 格式，不需要登录，也不是 Cloud 专属的 ?share= 链接。

这里只负责「把 shareId 变成一个可下载文件」，列表与检索在 app/workflows.py。
"""
from __future__ import annotations

import re

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

DOWNLOAD_BASE = "https://comfy.org/workflows/download"
UA = {"User-Agent": "model-downloader/0.1"}
_SHARE_ID = re.compile(r"^[0-9a-fA-F]{8,20}$")


class ComfyHubAdapter(SourceAdapter):
    name = "comfyhub"
    uses_repo_subdir = True

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        # 只接受索引里给的 shareId，不接受任意 URL —— 免得变成开放代理
        sid = (repo_id or "").strip().strip("/")
        if not _SHARE_ID.fullmatch(sid):
            raise SourceError(f"无效的 ComfyHub 工作流 ID: {sid[:40]}")
        path = f"{sid}.json"
        url = f"{DOWNLOAD_BASE}/{path}"
        size = 0
        try:
            # 关掉压缩协商，否则 HEAD 的 content-length 是压缩后大小
            head = httpx.head(
                url, headers={**UA, "Accept-Encoding": "identity"}, timeout=20, follow_redirects=True
            )
            if head.status_code >= 400:
                raise SourceError(f"ComfyHub 工作流不存在: {sid}（HTTP {head.status_code}）")
            size = int(head.headers.get("content-length") or 0)
            # 站点用 chunked 返回，HEAD 没有 content-length；不补一次 GET 的话
            # tasks.total_bytes 恒为 0，进度条会一直停在 0%。
            if not size:
                probe = httpx.get(
                    url, headers={**UA, "Accept-Encoding": "identity"}, timeout=30, follow_redirects=True
                )
                if probe.status_code >= 400:
                    raise SourceError(f"ComfyHub 工作流不存在: {sid}（HTTP {probe.status_code}）")
                size = len(probe.content)
        except httpx.HTTPError as exc:
            raise SourceError(f"获取 ComfyHub 工作流失败: {exc}") from exc
        return RepoInfo(
            repo_id=sid,
            # 所有 ComfyHub 工作流收进同一个目录，不按条建 800 个子文件夹
            display_name="ComfyHub",
            revision="",
            source=self.name,
            files=[RemoteFile(path=path, size=size, candidates=[url])],
        )
