"""GitHub 源：公开仓库的文件解析 + raw 直链下载。

GitHub 没有"模型仓库"概念，这里把任意 `owner/repo` 当成一个文件仓库：
用 Git Trees API 列出全部文件，下载走 raw.githubusercontent.com。
未认证时 API 只有 60 次/小时，因此工作流发现页要求先在设置里填 token。
"""
from __future__ import annotations

from urllib.parse import quote

import httpx

from ..config import source_proxy
from .base import RemoteFile, RepoInfo, SourceAdapter, SourceError

GITHUB_API = "https://api.github.com"
RAW_BASE = "https://raw.githubusercontent.com"
UA = {"User-Agent": "model-downloader/0.1", "Accept": "application/vnd.github+json"}


def _headers(cfg: dict) -> dict:
    headers = dict(UA)
    token = (cfg or {}).get("token") or ""
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get_json(url: str, cfg: dict, params: dict | None = None) -> dict:
    try:
        resp = httpx.get(
            url,
            headers=_headers(cfg),
            params=params,
            timeout=30,
            follow_redirects=True,
            proxy=source_proxy(cfg),
        )
    except httpx.HTTPError as exc:
        raise SourceError(f"GitHub 请求失败: {exc}") from exc
    if resp.status_code in (403, 429) and "rate limit" in resp.text.lower():
        raise SourceError("GitHub API 限流（未认证 60 次/小时），请在「设置 → GitHub」填 Access Token")
    if resp.status_code >= 400:
        raise SourceError(f"GitHub 请求错误 {resp.status_code}: {resp.text[:120]}")
    return resp.json()


def tree_files(repo_id: str, branch: str, cfg: dict) -> list[tuple[str, int]]:
    """列出仓库全部文件（path, size），递归一次拿完，避免逐目录请求。"""
    data = _get_json(f"{GITHUB_API}/repos/{repo_id}/git/trees/{quote(branch)}", cfg, {"recursive": "1"})
    return [
        (node.get("path") or "", int(node.get("size") or 0))
        for node in (data.get("tree") or [])
        if node.get("type") == "blob" and node.get("path")
    ]


class GithubAdapter(SourceAdapter):
    name = "github"
    uses_repo_subdir = True

    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        rid = (repo_id or "").strip("/")
        if "/" not in rid:
            raise SourceError("GitHub 仓库格式应为 owner/repo")
        branch = (revision or "").strip()
        if not branch:
            info = _get_json(f"{GITHUB_API}/repos/{rid}", cfg)
            branch = info.get("default_branch") or "main"
        entries = tree_files(rid, branch, cfg)
        if not entries:
            raise SourceError("仓库里没有文件")
        files = [
            RemoteFile(
                path=path,
                size=size,
                candidates=[f"{RAW_BASE}/{rid}/{quote(branch)}/{quote(path)}"],
            )
            for path, size in entries
        ]
        return RepoInfo(
            repo_id=rid,
            display_name=rid.split("/")[-1],
            revision=branch,
            source=self.name,
            files=files,
        )
