"""下载源适配器基类：解析仓库 -> 文件列表 + 多站点候选 URL。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


class SourceError(Exception):
    pass


@dataclass
class RemoteFile:
    path: str
    size: int
    candidates: list[str] = field(default_factory=list)


@dataclass
class RepoInfo:
    repo_id: str
    display_name: str
    revision: str
    source: str
    files: list[RemoteFile]

    def to_dict(self) -> dict:
        return {
            "repo_id": self.repo_id,
            "display_name": self.display_name,
            "revision": self.revision,
            "source": self.source,
            "files": [
                {"path": f.path, "size": f.size, "candidates": f.candidates}
                for f in self.files
            ],
        }


class SourceAdapter(ABC):
    name: str = "base"
    # HF/MS 下载会建同名子目录（Rodel 风格），Civitai 单文件平铺
    uses_repo_subdir: bool = True

    @abstractmethod
    def resolve(self, repo_id: str, revision: str, cfg: dict) -> RepoInfo:
        ...

    def supports_sdk(self) -> bool:
        return False

    def search(self, q: str, limit: int, page: int, sort: str, cfg: dict, task: str = "") -> dict:
        """跨源模型搜索（AbyssBeacon 式发现列表）。返回 {"items": [...], "total": n}

        task: 任务类型过滤（如 text-generation / text-to-image），空串不过滤。
        """
        raise SourceError(f"{self.name} 源不支持搜索")

    def sdk_download(
        self,
        repo_id: str,
        revision: str,
        files: list[str],
        dest: Path,
        cfg: dict,
        on_file_done: Callable[[str], None] | None = None,
    ) -> None:
        raise NotImplementedError
