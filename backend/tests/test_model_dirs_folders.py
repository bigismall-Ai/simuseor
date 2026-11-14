"""ComfyUI 目录表与落点判定。

两道硬约束：
- 目录表必须覆盖本地 ComfyUI 的 folder_paths.py（否则 normalize_folder 直接拒绝）
- 分体仓库要按**路径段**分目录，不能只看文件名（transformer/ 与 vae/ 下的文件同名）
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.comfy import model_dirs
from app.comfy.model_dirs import infer_folder, plan_folders
from app.weight_class import FOLDER_LABELS

ROOT = Path(__file__).resolve().parents[2]


def _comfy_folders() -> list[str]:
    """从本地 ComfyUI 的 folder_paths.py 读出目录名；没有实例就跳过。"""
    candidates = sorted((ROOT / "comfy").glob("*/ComfyUI/folder_paths.py"))
    if not candidates:
        pytest.skip("本机没有 ComfyUI 实例")
    src = candidates[-1].read_text(encoding="utf-8")
    keys = re.findall(r'folder_names_and_paths\["([a-z_]+)"\]', src)
    return [k for k in keys if k not in ("custom_nodes", "datasets")]


def test_allowed_folders_cover_comfyui_core():
    core = _comfy_folders()
    missing = [f for f in core if f not in model_dirs.ALLOWED_FOLDERS]
    assert not missing, f"ComfyUI 有但白名单没有: {missing}"


def test_every_allowed_folder_has_label():
    missing = [f for f in model_dirs.ALLOWED_FOLDERS if f not in FOLDER_LABELS]
    assert not missing, f"缺中文标签: {missing}"


def test_split_repo_routes_each_component():
    plan = plan_folders(
        [
            "transformer/diffusion_pytorch_model.safetensors",
            "text_encoder/model.safetensors",
            "vae/diffusion_pytorch_model.safetensors",
        ]
    )
    assert plan["transformer/diffusion_pytorch_model.safetensors"] == "diffusion_models"
    assert plan["text_encoder/model.safetensors"] == "text_encoders"
    assert plan["vae/diffusion_pytorch_model.safetensors"] == "vae"
    # 混装任务不能给出单一目录
    assert infer_folder("huggingface", "", list(plan)) == ""


def test_comfy_org_split_files_layout():
    """Comfy-Org 的仓库直接按 split_files/<ComfyUI 目录>/ 组织。"""
    assert plan_folders(["split_files/diffusion_models/flux1-dev.safetensors"]) == {
        "split_files/diffusion_models/flux1-dev.safetensors": "diffusion_models"
    }
    assert plan_folders(["split_files/vae/ae.safetensors"]) == {
        "split_files/vae/ae.safetensors": "vae"
    }
    assert plan_folders(["split_files/clip/clip_l.safetensors"]) == {
        "split_files/clip/clip_l.safetensors": "text_encoders"
    }


def test_diffusers_repo_stays_together():
    paths = ["model_index.json", "transformer/x.safetensors", "vae/y.safetensors"]
    assert set(plan_folders(paths).values()) == {"diffusers"}


def test_single_file_defaults_to_checkpoints():
    assert infer_folder("huggingface", "", ["flux1-dev.safetensors"]) == "checkpoints"
    assert infer_folder("huggingface", "", ["model.gguf"]) == "diffusion_models"
    assert infer_folder("huggingface", "", ["clip_vision/model.safetensors"]) == "clip_vision"


def test_civitai_type_wins():
    assert infer_folder("civitai", "LORA", ["whatever.safetensors"]) == "loras"
    assert infer_folder("civitai", "MotionModule", ["x.safetensors"]) == "animatediff_models"
    # Poses 不是模型目录，交给文件名兜底
    assert infer_folder("civitai", "Poses", ["x.safetensors"]) == "checkpoints"


def test_unknown_folder_rejected():
    with pytest.raises(ValueError):
        model_dirs.normalize_folder("../../etc")
    with pytest.raises(ValueError):
        model_dirs.normalize_folder("not_a_folder")
