"""模型分类：存放类型（checkpoints/loras/vae…）与任务类型（文生图/文本生成…）。

两个维度是分开的：
- **存放类型**回答「ComfyUI 把它放哪」，由落盘目录决定，是物理事实
- **任务类型**回答「它是拿来干什么的」（文生图 / 文生视频 / 文本生成 / LoRA…），
  是使用意图，同一个目录里可以混着不同任务的模型

界面上两者都要能筛，所以这里给出稳定的 id + 中文标签。
"""
from __future__ import annotations

import re
from pathlib import Path

# ---- 存放类型：ComfyUI 的模型目录 ----
FOLDER_LABELS = {
    "checkpoints": "主模型",
    "diffusion_models": "扩散模型",
    "unet": "扩散模型",
    "text_encoders": "文本编码器",
    "vae": "VAE",
    "vae_approx": "VAE 近似",
    "loras": "LoRA",
    "controlnet": "ControlNet",
    "upscale_models": "放大模型",
    "embeddings": "Embedding",
    "clip_vision": "CLIP Vision",
    "style_models": "风格模型",
    "gligen": "GLIGEN",
    "diffusers": "Diffusers",
    "hypernetworks": "Hypernetwork",
    "unclassified": "未分类",
}

# ---- 任务类型：拿来干什么 ----
TASK_LABELS = {
    "text_to_image": "文生图",
    "image_to_image": "图生图",
    "text_to_video": "文生视频",
    "image_to_video": "图生视频",
    "text_generation": "文本生成",
    "image_understanding": "图像理解",
    "text_to_speech": "语音合成",
    "speech_to_text": "语音识别",
    "embedding": "向量嵌入",
    "lora": "LoRA 风格",
    "upscaler": "图像放大",
    "controlnet": "ControlNet 控制",
    "unknown": "未标注",
}

# 目录 → 任务类型倾向（同一个目录里可以混着不同任务的模型，只是倾向）
_FOLDER_TASK = {
    "loras": "lora",
    "controlnet": "controlnet",
    "upscale_models": "upscaler",
    "embeddings": "embedding",
    "text_encoders": "text_generation",
}

# 源站 tags 里的任务标记。HF 的 tags 最规范（text-generation / text-to-image / …），
# 比从文件名猜靠谱得多 —— 排在最前面。
_TAG_TASK_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("text_to_video", re.compile(r"(^|[-_ ])(text-to-video|image-to-video|video-to-video|video-generation)([-_ ]|$)", re.I)),
    ("text_to_image", re.compile(r"(^|[-_ ])(text-to-image|image-generation)([-_ ]|$)", re.I)),
    ("image_to_image", re.compile(r"(^|[-_ ])(image-to-image|image-editing|inpainting)([-_ ]|$)", re.I)),
    ("text_generation", re.compile(r"(^|[-_ ])(text-generation|conversational|conversational-instruct)([-_ ]|$)", re.I)),
    ("image_understanding", re.compile(r"(^|[-_ ])(image-text-to-text|visual-question|vqa|classification)([-_ ]|$)", re.I)),
    ("text_to_speech", re.compile(r"(^|[-_ ])(text-to-speech|tts|speech-synthesis)([-_ ]|$)", re.I)),
    ("speech_to_text", re.compile(r"(^|[-_ ])(speech-to-text|asr|automatic-speech)([-_ ]|$)", re.I)),
    ("embedding", re.compile(r"(^|[-_ ])(feature-extraction|sentence-similarity|embeddings)([-_ ]|$)", re.I)),
    ("upscaler", re.compile(r"(^|[-_ ])(upscal|super-resolution|image-super-resolution)([-_ ]|$)", re.I)),
    ("controlnet", re.compile(r"(^|[-_ ])(controlnet|depth-estimation|canny|openpose)([-_ ]|$)", re.I)),
]

# 文件名/模型名里的任务特征。顺序敏感：先命中具体的。
#
# 边界写法：关键词后面允许接数字或分隔符。
# 用「后面必须是分隔符」会漏掉 flux1-dev / sd15 / sdxl_base 这类真实命名 ——
# flux 后面跟的是版本号 1，不是分隔符。
_TASK_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("text_to_video", re.compile(
        r"(^|[-_. ])(t2v|i2v|video|wan|hunyuan.?video|ltx.?video|cogvideo|mochi|animatediff|svd|stable.?video)(?=[-_. ]|\d|$)", re.I)),
    ("image_to_video", re.compile(
        r"(^|[-_. ])(i2v|image.to.video)(?=[-_. ]|\d|$)", re.I)),
    ("text_to_speech", re.compile(
        r"(^|[-_. ])(tts|rvc|sovits|bark|fish.?speech|cosyvoice)(?=[-_. ]|\d|$)", re.I)),
    ("speech_to_text", re.compile(
        r"(^|[-_. ])(asr|whisper|wav2vec)(?=[-_. ]|\d|$)", re.I)),
    ("embedding", re.compile(
        r"(^|[-_. ])(embed|embedding|bge|gte|e5|negative)(?=[-_. ]|\d|$)", re.I)),
    ("image_understanding", re.compile(
        r"(^|[-_. ])(vlm|llava|qwen[-_.]?vl|internvl|classification)(?=[-_. ]|\d|$)", re.I)),
    ("text_generation", re.compile(
        # qwen 本身是通用 LLM，但 qwen-image 是文生图 —— 用否定前瞻把后者排掉
        r"(^|[-_. ])(llm|gpt\d*|llama|qwen(?![-_.]?image)|mistral|gemma|phi\d*|deepseek|text.?gen|code)(?=[-_. ]|\d|$)", re.I)),
    ("image_to_image", re.compile(
        r"(^|[-_. ])(i2i|inpaint|img2img|upscale|superscale|realesrgan|esrgan|swinir|"
        r"restore|face|detailer|instantid|pulid|ultrasharp|4x)(?=[-_. ]|\d|$)", re.I)),
    ("text_to_image", re.compile(
        r"(^|[-_. ])(t2i|diffusion|sd\d*|sdxl|sd3|flux|pixelart|pony|noobai|illustrious|juggernaut|"
        r"realvis|dreamshaper|anything|kolors|hidream|kandinsky|playground|revanimated|"
        r"animagine|meina|counterfeit)(?=[-_. ]|\d|$)|"
        # qwen_image 这类「qwen + 图像」的命名，qwen 本身是通用 LLM，
        # 单看 qwen 会判成文本生成 —— 得连着 image 一起看
        r"(^|[-_. ])qwen[-_.]?image(?=[-_. ]|\d|$)", re.I)),
]

# 家族名后面常跟大写后缀（juggernautXL、realvisXL）—— 上面那条边界不认大写字母，
# 这些名字要单独再判一次。放在最后，只兜底。
_FAMILY_HINTS = re.compile(
    r"(^|[-_. ])(juggernaut|realvis|dreamshaper|anything|illustrious|pony|noobai|"
    r"meina|counterfeit|animagine|revanimated|playground|kandinsky|kolors)(?=[-_. ]|\d|[A-Z]|$)",
    re.I,
)


def folder_of(local_path: str) -> str:
    """从落盘路径推出 ComfyUI 存放类型。

    取 `models/` 之后的第一段目录名 —— 那就是 ComfyUI 的分类目录。
    认不出就归「未分类」，不猜。
    """
    parts = [p for p in (local_path or "").replace("\\", "/").split("/") if p]
    for i, p in enumerate(parts):
        if p.lower() == "models" and i + 1 < len(parts):
            return parts[i + 1].lower()
    # 没有 models/ 段时，退而取最后两段里的上一段
    if len(parts) >= 2:
        cand = parts[-2].lower()
        if cand in FOLDER_LABELS:
            return cand
    return "unclassified"


def task_of(name: str, folder: str = "", tags: list[str] | None = None) -> str:
    """推断任务类型。

    顺序：显式 tags > 目录倾向 > 文件名特征。
    tags 是源站给的，最可信；目录只是倾向（loras 目录里的可能是任意风格）；
    文件名特征最后兜。
    """
    hay_tags = " ".join(tags or [])
    # 源站 tags 里的任务标记最直接
    for tid, pat in _TAG_TASK_PATTERNS:
        if pat.search(hay_tags):
            return tid

    for tid, pat in _TASK_PATTERNS:
        if pat.search(hay_tags):
            return tid

    # LoRA 类目录先判 lora —— 它的「任务」就是加风格
    if folder in ("loras",):
        return "lora"
    if folder in _FOLDER_TASK and not name:
        return _FOLDER_TASK[folder]

    hay = name or ""
    for tid, pat in _TASK_PATTERNS:
        if pat.search(hay):
            return tid
    if _FAMILY_HINTS.search(hay):
        return "text_to_image"
    if folder in _FOLDER_TASK:
        return _FOLDER_TASK[folder]
    return "unknown"


def classify(local_path: str, name: str = "", tags: list[str] | None = None) -> dict:
    """一次给出两个维度。"""
    folder = folder_of(local_path)
    task = task_of(name, folder, tags)
    return {
        "folder": folder,
        "folderLabel": FOLDER_LABELS.get(folder, folder),
        "task": task,
        "taskLabel": TASK_LABELS.get(task, task),
    }


def all_folders() -> list[dict]:
    """可选的存放类型（用于筛选面板）。"""
    return [{"id": k, "label": v} for k, v in FOLDER_LABELS.items()]


def all_tasks() -> list[dict]:
    """可选的任务类型（用于筛选面板）。"""
    return [{"id": k, "label": v} for k, v in TASK_LABELS.items()]
