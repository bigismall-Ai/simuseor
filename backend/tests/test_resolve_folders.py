"""解析接口要给出「每个文件自己的目录」，下载页据此显示预计落点。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import routes
from app.sources.base import RemoteFile, RepoInfo


class FakeAdapter:
    uses_repo_subdir = True

    def resolve(self, repo_id, revision, cfg):
        return RepoInfo(
            repo_id=repo_id,
            display_name=repo_id.split("/")[-1],
            revision=revision or "main",
            source="huggingface",
            files=[
                RemoteFile("transformer/diffusion_pytorch_model.safetensors", 10, ["https://x/1"]),
                RemoteFile("text_encoder/model.safetensors", 10, ["https://x/2"]),
                RemoteFile("vae/diffusion_pytorch_model.safetensors", 10, ["https://x/3"]),
            ],
        )


def _patch(monkeypatch, files=None):
    monkeypatch.setattr(routes, "get_adapter", lambda name: FakeAdapter())
    monkeypatch.setattr(routes, "load_settings", lambda: {"sources": {"huggingface": {"label": "HF"}}})
    if files is not None:
        class A(FakeAdapter):
            def resolve(self, repo_id, revision, cfg):
                repo = super().resolve(repo_id, revision, cfg)
                repo.files = files
                return repo
        monkeypatch.setattr(routes, "get_adapter", lambda name: A())


def test_resolve_exposes_per_file_folder(monkeypatch):
    _patch(monkeypatch)
    payload = routes.resolve(routes.ResolveRequest(source="huggingface", repo_id="black-forest-labs/FLUX.1-dev"))

    folders = {f["path"]: f["folder"] for f in payload["files"]}
    assert folders["transformer/diffusion_pytorch_model.safetensors"] == "diffusion_models"
    assert folders["text_encoder/model.safetensors"] == "text_encoders"
    assert folders["vae/diffusion_pytorch_model.safetensors"] == "vae"
    # 混装仓库没有「单一目标目录」
    assert payload["target_folder"] == ""


def test_resolve_single_folder_keeps_hint(monkeypatch):
    _patch(monkeypatch, [RemoteFile("vae/ae.safetensors", 10, ["https://x/1"])])
    payload = routes.resolve(routes.ResolveRequest(source="huggingface", repo_id="a/b"))

    assert payload["target_folder"] == "vae"
    assert payload["files"][0]["folder"] == "vae"


def test_folders_endpoint_covers_comfy_core(monkeypatch):
    folders = routes.folders()
    ids = {f["id"] for f in folders}
    for expected in ("checkpoints", "diffusion_models", "text_encoders", "vae", "latent_upscale_models"):
        assert expected in ids
    # 每个目录都有中文标签，前端下拉不会英文裸奔
    assert all(f.get("label") and f["label"] != f["id"] for f in folders)
