"""工作流依赖比对：缺模型 / 缺节点包。

口径要点：
- 模型按文件名精确匹配，不做「同族不同版本算命中」的宽松匹配
- 下载中的 .aria2 / .part 与 config.json 不算模型，否则会谎报「已有」
- 节点包反查用 owner 索引；查不到归属的单列 unknown，不猜
- 核心节点（ComfyUI 自带）不算缺
"""
from __future__ import annotations

import pathlib

from app import workflow_deps as wd


def _make_models(tmp_path, monkeypatch, files: dict[str, str]) -> pathlib.Path:
    """在临时目录里造模型文件。files: {相对路径: 内容}"""
    root = tmp_path / "models"
    for rel, content in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    monkeypatch.setattr(wd, "WORKSPACE_MODELS_DIR", root)
    return root


# ---------------- 模型索引 ----------------

def test_index_ignores_non_model_files(tmp_path, monkeypatch):
    """config.json / tokenizer.json / .aria2 临时文件都不是模型。"""
    _make_models(tmp_path, monkeypatch, {
        "checkpoints/m1/config.json": "{}",
        "checkpoints/m1/tokenizer.json": "{}",
        "checkpoints/m1/model.safetensors": "x",
        "vae/m2/big.safetensors": "x",
        "vae/m2/big.safetensors.aria2": "x",
        "vae/m2/big.safetensors.part": "x",
    })
    idx = wd._model_index()
    assert "model.safetensors" in idx
    assert "big.safetensors" in idx
    assert "config.json" not in idx
    assert "tokenizer.json" not in idx
    assert "big.safetensors.aria2" not in idx
    assert "big.safetensors.part" not in idx


def test_index_is_case_insensitive(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {"diffusion_models/Flux1-dev.sft": "x"})
    idx = wd._model_index()
    assert "flux1-dev.sft" in idx


def test_index_records_relative_dir(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {"vae/sub/a.safetensors": "x"})
    idx = wd._model_index()
    assert idx["a.safetensors"] == "vae/sub"


def test_missing_dir_yields_empty_index(tmp_path, monkeypatch):
    monkeypatch.setattr(wd, "WORKSPACE_MODELS_DIR", tmp_path / "nope")
    assert wd._model_index() == {}


# ---------------- 模型依赖 ----------------

def test_model_present_and_missing(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {"diffusion_models/have.safetensors": "x"})
    slots = [
        {"file": "have.safetensors", "directory": "diffusion_models", "node": "UNETLoader"},
        {"file": "gone.safetensors", "directory": "diffusion_models", "node": "UNETLoader"},
    ]
    deps = wd.model_deps(slots)
    assert [m["file"] for m in deps["have"]] == ["have.safetensors"]
    assert [m["file"] for m in deps["missing"]] == ["gone.safetensors"]
    assert deps["have"][0]["found_dir"] == "diffusion_models"


def test_model_match_ignores_declared_directory(tmp_path, monkeypatch):
    """工作流声明去 vae 找，但文件实际在 checkpoints 里 —— 同名就算命中。

    用户关心的是「这个文件在不在」，不是「放对目录没有」。
    """
    _make_models(tmp_path, monkeypatch, {"checkpoints/a.safetensors": "x"})
    deps = wd.model_deps([{"file": "a.safetensors", "directory": "vae", "node": "VAELoader"}])
    assert len(deps["have"]) == 1
    assert deps["have"][0]["found_dir"] == "checkpoints"


def test_quantized_variant_is_not_a_match(tmp_path, monkeypatch):
    """flux1-dev-Q4_K_M.gguf 存在，不代表 flux1-dev.sft 存在。"""
    _make_models(tmp_path, monkeypatch, {"diffusion_models/flux1-dev-Q4_K_M.gguf": "x"})
    deps = wd.model_deps([{"file": "flux1-dev.sft", "directory": "diffusion_models"}])
    assert deps["have"] == []
    assert len(deps["missing"]) == 1


def test_empty_slots():
    deps = wd.model_deps([])
    assert deps == {"have": [], "missing": []}


# ---------------- 节点包依赖 ----------------

def _fake_catalog(monkeypatch, *, owner, by_id, core):
    monkeypatch.setattr(wd.node_service, "catalog", lambda: {
        "items": [], "by_id": by_id, "owner": owner, "core": core,
        "classes": {}, "at": 0,
    })


def test_node_deps_reports_missing_package(monkeypatch):
    _fake_catalog(
        monkeypatch,
        owner={"FancyLoader": "owner/fancy", "SAMLoader": "owner/sam"},
        by_id={
            "owner/fancy": {"id": "owner/fancy", "name": "Fancy Pack", "author": "o",
                            "repo": "https://github.com/o/fancy", "node_count": 12,
                            "installable": True},
            "owner/sam": {"id": "owner/sam", "name": "SAM Pack", "author": "o",
                          "repo": "https://github.com/o/sam", "node_count": 3,
                          "installable": True},
        },
        core={"KSampler"},
    )
    deps = wd.node_deps({"FancyLoader", "SAMLoader", "KSampler"}, installed={})
    assert len(deps["missing"]) == 2
    assert {p["id"] for p in deps["missing"]} == {"owner/fancy", "owner/sam"}
    # 核心节点不进依赖
    assert deps["unknown"] == []


def test_node_deps_skips_installed_package(monkeypatch):
    _fake_catalog(
        monkeypatch,
        owner={"FancyLoader": "owner/fancy"},
        by_id={"owner/fancy": {"id": "owner/fancy", "name": "Fancy Pack", "node_count": 1,
                               "installable": True}},
        core=set(),
    )
    installed = {"fancy": {"dir": "fancy", "id": "owner/fancy"}}
    deps = wd.node_deps({"FancyLoader"}, installed=installed)
    assert deps["missing"] == []
    assert len(deps["have"]) == 1


def test_node_deps_collects_unknown_classes(monkeypatch):
    """清单里查不到归属的节点：如实列进 unknown，不猜成某个包。"""
    _fake_catalog(monkeypatch, owner={}, by_id={}, core={"KSampler"})
    deps = wd.node_deps({"Power Lora Loader (rgthree)", "KSampler"}, installed={})
    assert deps["missing"] == []
    assert deps["unknown"] == ["Power Lora Loader (rgthree)"]


def test_node_deps_empty_classes(monkeypatch):
    _fake_catalog(monkeypatch, owner={}, by_id={}, core=set())
    assert wd.node_deps(set(), installed={}) == {"have": [], "missing": [], "unknown": []}


# ---------------- 汇总状态 ----------------

def test_analyze_ready_when_nothing_missing(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {"diffusion_models/a.safetensors": "x"})
    _fake_catalog(monkeypatch, owner={}, by_id={}, core={"KSampler"})
    result = wd.analyze(
        [{"file": "a.safetensors", "directory": "diffusion_models"}],
        {"KSampler"},
    )
    assert result["ready"] is True
    assert result["state"] == "ready"
    assert result["missing_count"] == 0


def test_analyze_missing_when_model_absent(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {})
    _fake_catalog(monkeypatch, owner={}, by_id={}, core=set())
    result = wd.analyze([{"file": "gone.safetensors"}], set())
    assert result["ready"] is False
    assert result["state"] == "missing"
    assert result["missing_count"] == 1


def test_analyze_counts_models_and_packages_together(tmp_path, monkeypatch):
    _make_models(tmp_path, monkeypatch, {})
    _fake_catalog(
        monkeypatch,
        owner={"FancyLoader": "owner/fancy"},
        by_id={"owner/fancy": {"id": "owner/fancy", "name": "Fancy", "node_count": 1,
                               "installable": True}},
        core=set(),
    )
    result = wd.analyze([{"file": "a.safetensors"}], {"FancyLoader"})
    assert result["missing_count"] == 2
