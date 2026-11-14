"""节点扩展的用途分类。

ComfyUI-Manager 清单里的 `category` / `tags` 几乎全空（6031/6038 无 category），
只能从**名称 + 描述 + 节点类名**推断。两条经验（都是踩出来的）：

1. **必须按词边界匹配**。裸 `in` 会让 `sam` 命中 `sampler`、`t2i` 命中 `t2i2`，
   结果一个大扩展同时命中九个类型，筛选等于没有。
2. **只取一个主类型**。大扩展（WAS / Impact / IAMCCS）确实什么都能干，
   但筛选需要「这张卡主要是什么」；多标签会把分类计数撑成一团。

打分：越具体的词权重越高（`hunyuanvideo` 3 分、`video` 1 分），
同分按 CATEGORIES 顺序取第一个（生成类在前），一个都不命中 → `utility`。
"""
from __future__ import annotations

import re

# id, 中文标签（筛选用；顺序即展示顺序，也是同分时的优先级）
CATEGORIES: list[tuple[str, str]] = [
    ("text_to_image", "文生图"),
    ("image_to_image", "图生图"),
    ("text_to_video", "文生视频"),
    ("image_to_video", "图生视频"),
    ("video", "视频处理"),
    ("controlnet", "ControlNet"),
    ("segment", "检测分割"),
    ("upscale", "放大修复"),
    ("audio", "音频"),
    ("text", "文本/LLM"),
    ("utility", "工具"),
]

CATEGORY_LABELS = dict(CATEGORIES)

# 关键词 + 权重。短词（≤5 个字符的纯字母数字）走词边界，长词直接包含匹配。
RULES: list[tuple[str, tuple[tuple[str, int], ...]]] = [
    (
        "text_to_image",
        (
            ("txt2img", 3), ("t2i", 3), ("text to image", 3), ("text-to-image", 3),
            ("image generation", 2), ("sdxl", 2), ("flux", 2), ("checkpoint loader", 2),
            ("qwen-image", 2), ("krea", 2),
        ),
    ),
    (
        "image_to_image",
        (
            ("img2img", 3), ("i2i", 3), ("image to image", 3), ("inpaint", 2),
            ("outpaint", 2), ("image edit", 2), ("kontext", 2), ("redux", 2),
        ),
    ),
    (
        "text_to_video",
        (
            ("txt2vid", 3), ("t2v", 3), ("text to video", 3), ("text-to-video", 3),
            ("hunyuanvideo", 3), ("cogvideox", 3), ("ltx", 2), ("wan2", 2), ("mochi", 2),
        ),
    ),
    (
        "image_to_video",
        (
            ("img2vid", 3), ("i2v", 3), ("image to video", 3), ("image-to-video", 3),
            ("animatediff", 3), ("svd", 2), ("wananimate", 2), ("video combine", 2),
            ("video helper", 2),
        ),
    ),
    (
        "video",
        (
            ("video", 1), ("vhs", 2), ("loadvideo", 2), ("videocombine", 2),
            ("frame interpolation", 2), ("interpolation", 1),
        ),
    ),
    (
        "controlnet",
        (
            ("controlnet", 3), ("control net", 3), ("preprocessor", 2), ("openpose", 2),
            ("canny", 2), ("depth", 1), ("lineart", 2), ("softedge", 2), ("scribble", 2),
        ),
    ),
    (
        "segment",
        (
            ("segment", 3), ("yolo", 3), ("sam", 3), ("birefnet", 3), ("rembg", 3),
            ("background removal", 3), ("matting", 2), ("detect", 2),
        ),
    ),
    (
        "upscale",
        (
            ("upscale", 3), ("esrgan", 3), ("swinir", 3), ("super resolution", 3),
            ("4x", 2), ("detailer", 2), ("face restore", 2), ("gfpgan", 2), ("codeformer", 2),
        ),
    ),
    (
        "audio",
        (("audio", 3), ("tts", 3), ("voice", 2), ("speech", 2), ("music", 2), ("whisper", 3), ("ace-step", 3)),
    ),
    (
        "text",
        (
            ("llm", 3), ("gpt", 2), ("ollama", 3), ("chat", 1), ("caption", 2),
            ("florence", 2), ("joycaption", 2), ("translat", 2),
        ),
    ),
]

_ALNUM = re.compile(r"^[a-z0-9]+$")


def _hit(hay: str, word: str) -> bool:
    """短词走词边界，长词直接包含。"""
    if len(word) <= 5 and _ALNUM.match(word):
        return re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", hay) is not None
    return word in hay


def _best_of(hay: str) -> tuple[str, int]:
    best, best_score = "", 0
    for cid, words in RULES:
        score = sum(weight for keyword, weight in words if _hit(hay, keyword))
        if score > best_score:
            best, best_score = cid, score
    return best, best_score


def category_of(name: str, description: str = "", nodes: list[str] | None = None) -> str:
    """一个扩展的主类型。

    **两段判定**：先看「名称 + 描述」——那是扩展自己在说它是干什么的；
    只有它什么都没说（很多清单条目描述只有一句空话）才退回节点类名。
    反过来的话，类名多的扩展会被 `T2IAdapter` / `I2V` 这类边角类名带偏：
    实测一个视频增强扩展因为 267 个类名里带 `t2i`，被判成「文生图」。
    """
    said, _ = _best_of(" ".join([name or "", description or ""]).lower())
    if said:
        return said
    by_classes, _ = _best_of(" ".join(nodes or []).lower())
    return by_classes or "utility"


def label_of(category_id: str) -> str:
    return CATEGORY_LABELS.get(category_id, category_id)
