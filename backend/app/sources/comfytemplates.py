"""ComfyUI 官方工作流模板源。

模板清单来自 Comfy-Org/workflow_templates 的 index.json（约 750 个官方模板），
每个模板对应 templates/<name>.json，走 raw.githubusercontent.com 直链下载，无需登录。
"""
from __future__ import annotations

from urllib.parse import quote

import httpx

from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

RAW_BASE = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates"
UA = {"User-Agent": "model-downloader/0.1"}


class ComfyTemplatesAdapter(SourceAdapter):
    name = "templates"
    uses_repo_subdir = True

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        name = (repo_id or "").strip("/").split("/")[-1]
        if not name:
            raise SourceError("缺少模板名称")
        path = f"{name}.json"
        url = f"{RAW_BASE}/{quote(path)}"
        size = 0
        try:
            # 关掉压缩协商，否则 HEAD 的 content-length 是压缩后大小，和实际下载字节不一致
            head = httpx.head(url, headers={**UA, "Accept-Encoding": "identity"}, timeout=20, follow_redirects=True)
            if head.status_code >= 400:
                raise SourceError(f"模板不存在: {name}（HTTP {head.status_code}）")
            size = int(head.headers.get("content-length") or 0)
        except httpx.HTTPError as exc:
            raise SourceError(f"获取模板失败: {exc}") from exc
        return RepoInfo(
            repo_id=name,
            display_name=name,
            revision="main",
            source=self.name,
            files=[RemoteFile(path=path, size=size, candidates=[url])],
        )
