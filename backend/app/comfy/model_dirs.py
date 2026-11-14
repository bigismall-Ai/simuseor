"""ComfyUI 模型目录约定：统一落盘位置 + extra_model_paths.yaml 生成。

`models/` 是项目级共享仓库（与 `comfy/` 平级），`comfy/<name>/ComfyUI` 实例通过
`extra_model_paths.yaml` 直接挂载它，因此不需要把权重复制进每个实例。
下载任务按目录名（checkpoints / loras / ...）归类，避免把模型堆在按来源分的目录里。

目录清单以**本地 ComfyUI 的 folder_paths.py** 为准（`comfy/<实例>/ComfyUI/`），
不是凭印象写的：ComfyUI 陆续加了 latent_upscale_models / background_removal /
detection / frame_interpolation / geometry_estimation / optical_flow 等目录，
清单落后会让这些类型无处可落（normalize_folder 直接拒绝）。
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath

from ..config import WORKSPACE_MODELS_DIR, load_settings, resolve_save_dir

# ComfyUI 核心目录（与 folder_paths.py 对齐，2026-11 核对）。
# 顺序即前端下拉的常用顺序。
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
# 其余核心目录：按类型出现频率排列，低频但真实存在
EXTRA_FOLDERS = [
    "clip_vision",
    "style_models",
    "model_patches",
    "photomaker",
    "vae_approx",
    "hypernetworks",
    "gligen",
    "audio_encoders",
    "latent_upscale_models",
    "background_removal",
    "detection",
    "frame_interpolation",
    "geometry_estimation",
    "optical_flow",
    "classifiers",
    "configs",
    "diffusers",
]
# 自定义节点生态常用的目录：不在 ComfyUI 核心里，但社区模型实际会落在这里。
# 单独一组，避免和核心目录混在一起看不出边界。
EXTENSION_FOLDERS = [
    "sams",
    "ultralytics",
    "rmbg",
    "onnx",
    "animatediff_models",
]
# workflows 不是 ComfyUI 的模型类型，但放进 models/workflows 便于统一管理
SPECIAL_FOLDERS = ["workflows"]
ALLOWED_FOLDERS = COMMON_FOLDERS + EXTRA_FOLDERS + EXTENSION_FOLDERS + SPECIAL_FOLDERS

# Civitai 的 type（小写）→ ComfyUI 目录。
# 只映射「确实属于某个 ComfyUI 目录」的类型；Poses / AestheticGradient 是图片或
# 扩展私有格式，没有对应的核心目录，故意留空（由文件名兜底）。
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
    "motionmodule": "animatediff_models",
    "workflows": "workflows",
}

# 路径首段/中间段 → 目录。分体仓库（Flux / SD3）靠这个区分，不能只看文件名：
# transformer/、text_encoder/、vae/ 下的文件全叫 diffusion_pytorch_model.safetensors。
_SEGMENT_FOLDER = {
    "transformer": "diffusion_models",
    "unet": "diffusion_models",
    "diffusion_model": "diffusion_models",
    "text_encoder": "text_encoders",
    "text_encoder_2": "text_encoders",
    "text_encoder_3": "text_encoders",
    "clip": "text_encoders",
    "image_encoder": "clip_vision",
    "audio_encoder": "audio_encoders",
}

# 文件名特征（按顺序命中）。前面更具体，后面更泛。
_NAME_RULES: list[tuple[tuple[str, ...], str]] = [
    (("controlnet", "control_"), "controlnet"),
    (("taesd",), "vae_approx"),
    (("ip-adapter", "ipadapter", "ip_adapter", "instantid", "pulid"), "model_patches"),
    (("t5xxl", "clip_l", "clip_g", "umt5", "mt5", "text_encoder"), "text_encoders"),
    (("clip_vision", "vision_encoder", "image_encoder"), "clip_vision"),
    (("esrgan", "upscale", "swinir", "4x-", "realesrgan", "hat_gan"), "upscale_models"),
    (("yolo",), "ultralytics"),
    (("sam_vit", "sam2", "sam_hq"), "sams"),
    (("rmbg", "isnet", "birefnet"), "rmbg"),
]

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
    ("audio_encoders", "audio_encoders"),
    ("latent_upscale_models", "latent_upscale_models"),
    ("background_removal", "background_removal"),
    ("detection", "detection"),
    ("frame_interpolation", "frame_interpolation"),
    ("geometry_estimation", "geometry_estimation"),
    ("optical_flow", "optical_flow"),
    ("classifiers", "classifiers"),
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


def folder_for_file(path: str) -> str:
    """单个文件该放哪个 ComfyUI 目录。

    判断顺序：**路径段**（Comfy-Org 的 split_files/<目录>/ 与 diffusers 的
    transformer/ text_encoder/ vae/）→ **文件名特征** → 兜底 checkpoints。

    先看路径段是关键：分体仓库里每个组件的文件名都可能叫
    `diffusion_pytorch_model.safetensors`，只看文件名会把它们全塞进主模型目录。
    """
    parts = [p.lower() for p in PurePosixPath(path or "").parts]
    if not parts:
        return "checkpoints"
    name = parts[-1]
    dirs = parts[:-1]

    # 1) 目录段直接就是 ComfyUI 目录名（Comfy-Org 的 split_files/xxx、手写的 vae/ 等）
    for seg in reversed(dirs):
        if seg in ALLOWED_FOLDERS:
            return seg
        if seg in _SEGMENT_FOLDER:
            return _SEGMENT_FOLDER[seg]

    # 2) 文件名特征
    for keys, folder in _NAME_RULES:
        if any(k in name for k in keys):
            return folder
    if "vae" in name:
        return "vae"
    if "lora" in name:
        return "loras"
    if name.endswith(".gguf"):
        return "diffusion_models"
    if name.endswith(".onnx"):
        return "onnx"

    # 3) 兜底：单文件权重通常是完整 checkpoint
    return "checkpoints"


def plan_folders(file_paths: list[str]) -> dict[str, str]:
    """一条任务里每个文件各自的目标目录。

    diffusers 整仓（含 model_index.json）是一个整体，必须放同一个目录，
    不能按 transformer/ vae/ 拆开 —— 拆开 ComfyUI 的 diffusers 加载器就找不到它了。
    """
    paths = list(file_paths or [])
    if any(PurePosixPath(p).name.lower() == "model_index.json" for p in paths):
        return {p: "diffusers" for p in paths}
    return {p: folder_for_file(p) for p in paths}


def infer_folder(source: str, task: str = "", file_paths: list[str] | None = None) -> str:
    """**整条任务**的默认目标目录；文件分属多个目录时返回空字符串。

    优先用源站给出的类型（Civitai 的 type）；否则看文件清单。返回空串表示
    「按文件各自归类」（分体仓库），前端据此显示「自动（按文件）」。
    单文件任务与老逻辑行为一致。
    """
    folder = _TYPE_TO_FOLDER.get((task or "").strip().lower(), "")
    if folder:
        return folder
    plan = plan_folders(file_paths or [])
    uniq = set(plan.values())
    return uniq.pop() if len(uniq) == 1 else ""


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
