"""下载任务按文件分目录落盘（分体仓库：transformer / text_encoder / vae）。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.db as db
from app.download import manager as mm
from app.sources.base import RemoteFile, RepoInfo


class FakeAdapter:
    uses_repo_subdir = True

    def resolve(self, repo_id, revision, cfg):
        return RepoInfo(
            repo_id=repo_id,
            display_name="FLUX.1-dev",
            revision="main",
            source="huggingface",
            files=[
                RemoteFile("transformer/diffusion_pytorch_model.safetensors", 10, ["https://x/1"]),
                RemoteFile("text_encoder/model.safetensors", 10, ["https://x/2"]),
                RemoteFile("vae/diffusion_pytorch_model.safetensors", 10, ["https://x/3"]),
            ],
        )


class NoThread:
    def __init__(self, *a, **kw):
        pass

    def start(self):
        return None


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_conn", None)
    db.init_db()

    monkeypatch.setattr(mm, "get_adapter", lambda name: FakeAdapter())
    monkeypatch.setattr(mm, "threading", type("T", (), {"Thread": NoThread}))
    monkeypatch.setattr(
        mm,
        "load_settings",
        lambda: {
            "sources": {"huggingface": {"label": "HF"}},
            "download": {"save_dir": str(tmp_path / "models"), "strategy": "direct"},
            "proxy": {},
            "aria2": {},
        },
    )
    yield tmp_path
    if db._conn is not None:
        db._conn.close()
    monkeypatch.setattr(db, "_conn", None)


def test_split_repo_lands_in_separate_folders(env):
    tmp_path = env
    mm.manager.create_task(
        "huggingface", "black-forest-labs/FLUX.1-dev", "main",
        ["transformer/diffusion_pytorch_model.safetensors",
         "text_encoder/model.safetensors",
         "vae/diffusion_pytorch_model.safetensors"],
        save_dir=str(tmp_path / "models"),
    )

    rows = db.query("SELECT path, folder, target_dir FROM task_files ORDER BY path")
    got = {r["path"]: r["folder"] for r in rows}
    assert got["transformer/diffusion_pytorch_model.safetensors"] == "diffusion_models"
    assert got["text_encoder/model.safetensors"] == "text_encoders"
    assert got["vae/diffusion_pytorch_model.safetensors"] == "vae"

    for r in rows:
        assert Path(r["target_dir"]).name == "FLUX.1-dev"
        assert r["folder"] in r["target_dir"]

    task = db.query("SELECT target_dir FROM tasks")[0]
    # 混装任务的任务级落点是保存根目录，真实落点看每个文件
    assert Path(task["target_dir"]).name == "models"


def test_override_forces_one_folder(env):
    tmp_path = env
    mm.manager.create_task(
        "huggingface", "a/b", "main",
        ["vae/ae.safetensors", "text_encoder/model.safetensors"],
        save_dir=str(tmp_path / "models"),
        target_folder="diffusers",
    )
    rows = db.query("SELECT folder FROM task_files")
    assert {r["folder"] for r in rows} == {"diffusers"}
