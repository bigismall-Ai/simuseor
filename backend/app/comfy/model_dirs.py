"""ComfyUI 模型目录约定：统一落盘位置 + extra_model_paths.yaml 生成。

`models/` 是项目级共享仓库（与 `comfy/` 平级），`comfy/<name>/ComfyUI` 实例通过
`extra_model_paths.yaml` 直接挂载它，因此不需要把权重复制进每个实例。
下载任务按目录名（checkpoints / loras / ...）归类，避免把模型堆在按来源分的目录里。
"""
from __future__ import annotations

from pathlib import Path

from ..config import WORKSPACE_MODELS_DIR, load_settings, resolve_save_dir

# ComfyUI 实际会扫描的目录；顺序即前端下拉的常用顺序
COMMON_FOLDERS = [
    "checkpoints",
    "diffusion_models",
    "text_encoders",
    "vae",
    "loras",
    "controlnet",
    "upscale_models",
    "embeddings",
]
EXTRA_FOLDERS = [
    "clip_vision",
    "style_models",
    "model_patches",
    "photomaker",
    "vae_approx",
    "hypernetworks",
    "gligen",
    "sams",
    "ultralytics",
    "rmbg",
    "audio_encoders",
    "configs",
    "diffusers",
    "onnx",
]
# workflows 不是 ComfyUI 的模型类型，但放进 models/workflows 便于统一管理
SPECIAL_FOLDERS = ["workflows"]
ALLOWED_FOLDERS = COMMON_FOLDERS + EXTRA_FOLDERS + SPECIAL_FOLDERS

# Civitai 的 type（小写）→ ComfyUI 目录
_TYPE_TO_FOLDER = {
    "checkpoint": "checkpoints",
    "lora": "loras",
    "locon": "loras",
    "dora": "loras",
    "lycoris": "loras",
    "textualinversion": "embeddings",
    "hypernetwork": "hypernetworks",
    "controlnet": "controlnet",
    "upscaler": "upscale_models",
    "vae": "vae",
    "workflows": "workflows",
}

# extra_model_paths.yaml 的键名（含 ComfyUI 新旧两套命名）
_YAML_KEYS: list[tuple[str, str]] = [
    ("checkpoints", "checkpoints"),
    ("diffusion_models", "diffusion_models"),
    ("unet", "diffusion_models"),
    ("text_encoders", "text_encoders"),
    ("clip", "text_encoders"),
    ("vae", "vae"),
    ("loras", "loras"),
    ("controlnet", "controlnet"),
    ("upscale_models", "upscale_models"),
    ("embeddings", "embeddings"),
    ("clip_vision", "clip_vision"),
    ("style_models", "style_models"),
    ("model_patches", "model_patches"),
    ("photomaker", "photomaker"),
    ("vae_approx", "vae_approx"),
    ("hypernetworks", "hypernetworks"),
    ("gligen", "gligen"),
    ("configs", "configs"),
    ("diffusers", "diffusers"),
]


def models_root() -> Path:
    """共享模型仓库根目录（跟随设置里的保存路径）。"""
    return Path(resolve_save_dir(load_settings()["download"]["save_dir"]))


def normalize_folder(value: str) -> str:
    """校验目录名，拒绝路径穿越。空值返回空字符串。"""
    name = (value or "").strip().strip("/\\")
    if not name:
        return ""
    if name not in ALLOWED_FOLDERS:
        raise ValueError(f"未知的模型目录: {value}（可用: {', '.join(COMMON_FOLDERS)} 等）")
    return name


def infer_folder(source: str, task: str = "", file_paths: list[str] | None = None) -> str:
    """按源类型 / 任务 / 文件名推断应放入的 ComfyUI 目录。

    优先用源站给出的类型（Civitai 的 type），其次看文件名特征，最后兜底 checkpoints。
    """
    folder = _TYPE_TO_FOLDER.get((task or "").strip().lower(), "")
    if folder:
        return folder

    names = [Path(p).name.lower() for p in (file_paths or [])]
    joined = " ".join(names)
    if any("model_index.json" == n for n in names):
        return "diffusers"
    if any(k in joined for k in ("controlnet", "control_")):
        return "controlnet"
    if any("lora" in n for n in names):
        return "loras"
    if any("taesd" in n for n in names):
        return "vae_approx"
    if any("vae" in n for n in names):
        return "vae"
    if any(k in joined for k in ("t5xxl", "clip_l", "umt5", "text_encoder")):
        return "text_encoders"
    if any(k in joined for k in ("esrgan", "upscale", "swinir", "4x-")):
        return "upscale_models"
    if joined.endswith(".gguf") or any(n.endswith(".gguf") for n in names):
        return "diffusion_models"
    return "checkpoints"


def ensure_folders(base: Path | None = None) -> Path:
    """建好常用目录，返回仓库根路径。

    扩展目录（sams / ultralytics / rmbg 等）用到时才由下载任务创建，
    避免一上来堆出二十多个空文件夹。
    """
    root = base or models_root()
    for name in COMMON_FOLDERS:
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def write_extra_model_paths(comfy_dir: Path) -> Path | None:
    """在 ComfyUI 根目录写 extra_model_paths.yaml，挂载额外的模型仓库。

    实例以 `--base-directory workspace` 启动时，模型默认就在
    `workspace/models`，再写一份 yaml 指向同一个目录等于把同一批文件
    注册两遍，因此这种情况直接跳过（返回 None）；只有用户把保存目录改到
    workspace 之外时，才需要 yaml 把它们补进来。
    """
    root = ensure_folders()
    if root.resolve() == WORKSPACE_MODELS_DIR.resolve():
        return None
    target = comfy_dir / "extra_model_paths.yaml"
    lines = [
        "# 由 model-downloader 自动生成：ComfyUI 直接读取项目共享模型目录",
        "md_shared:",
        f"    base_path: {root.as_posix()}",
    ]
    lines += [f"    {key}: {rel}" for key, rel in _YAML_KEYS]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return target
