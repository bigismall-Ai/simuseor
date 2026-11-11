from .base import RepoInfo, RemoteFile, SourceAdapter, SourceError
from .huggingface import HuggingFaceAdapter
from .modelscope import ModelScopeAdapter
from .civitai import CivitaiAdapter
from .demo import DemoAdapter
from .github import GithubAdapter
from .comfytemplates import ComfyTemplatesAdapter

ADAPTERS: dict[str, SourceAdapter] = {
    "huggingface": HuggingFaceAdapter(),
    "modelscope": ModelScopeAdapter(),
    "civitai": CivitaiAdapter(),
    "github": GithubAdapter(),
    "templates": ComfyTemplatesAdapter(),
    "demo": DemoAdapter(),
}


def get_adapter(name: str) -> SourceAdapter:
    adapter = ADAPTERS.get(name)
    if adapter is None:
        raise SourceError(f"未知的下载源: {name}")
    return adapter
