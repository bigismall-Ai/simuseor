"""工作流的主模型解析：认出「这条工作流跑起来要哪个模型」。

**为什么要有这个**：工作流文件名是机器名（`flux_img2img_1_2`），看不出背后是什么模型。
家族徽标、依赖清单都依赖「主模型是谁」这个判断。

**三条通道**（按可靠性从高到低）：

1. **节点 `properties.models[]`** —— 新版 ComfyUI 会把模型登记在节点属性里，
   带 name + url + directory，是最权威的来源（能直接知道该去哪个目录找）。
   实测：Qwen Image 2.1 工作流的主模型就登记在**子图**里（`definitions.subgraphs`），
   顶层 nodes 里一个都没有 —— 所以扫描必须覆盖子图。

2. **widgets 槽位回落** —— 老版本工作流没有 `properties.models`，
   按节点类型取 widgets_values 的指定下标。
   实测坑：DualCLIPLoader 的 `[0]` 才是主编码器（t5xxl_fp16），
   `[1]` 是轻量编码器（clip_l）—— 设计文档写的 `[1]` 是错的，取 `[1]` 会把
   主模型认成 clip_l，家族判定直接错。

3. **文本兜底** —— JSON 语法损坏的文件（`video_minimax_h3_i2v` 第 2083 行崩了）
   用正则扫原始文本找模型文件名。坏文件也能认家族 —— 这条工作流的
   主模型 `minimax_h3_fl2va_pruned_int8_convrot.safetensors` 就是这么捞出来的。

**主体优先级按 directory 排，不按出现顺序**：checkpoints / diffusion_models
优先于 loras，再优先于 vae / text_encoders。按出现顺序会撞上 VAE——
先遇到 VAELoader 就把 ae.sft 当主模型了。
"""
from __future__ import annotations

import json
import re
from typing import Any

# 模型文件后缀。命中才算「这是个模型文件名」
_MODEL_EXT = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin", ".onnx")

# 槽位表：节点类型 → widgets_values 里模型文件名所在的下标。
# 下标可以是元组（一个节点挂多个模型，全都要）。
_SLOTS: dict[str, tuple[int, ...]] = {
    "CheckpointLoaderSimple": (0,),
    "CheckpointLoader": (0,),
    "UNETLoader": (0,),
    "UnetLoaderGGUF": (0,),
    "DiffusionLoader": (0,),
    "VAELoader": (0,),
    "LoraLoader": (0,),
    "LoraLoaderModelOnly": (0,),
    "CLIPLoader": (0,),
    "DualCLIPLoader": (0, 1),
    "TripleCLIPLoader": (0, 1, 2),
    "ControlNetLoader": (0,),
    "IPAdapterModelLoader": (0,),
    "UpscaleModelLoader": (0,),
    "StyleModelLoader": (0,),
    "GLIGENLoader": (0,),
}

# 主体优先级：数字越小越像「主模型」。按 directory 归类，
# 认不出目录的走 _SLOT_ROLE 兜底。
_DIR_RANK = {
    # checkpoint 是整套模型（权重+VAE+编码器全在一个文件里），
    # 比单个 diffusion_model 更像「这条工作流的主体」——两者都命中时取 checkpoint
    "checkpoints": 0,
    "diffusion_models": 1,
    "unet": 1,
    # loras 排在未知之后 —— 主模型不会是一堆 LoRA
    "loras": 3,
    "vae": 4,
    "text_encoders": 4,
    "style_models": 4,
    "controlnet": 4,
    "upscale_models": 4,
    "ipadapter": 4,
    "clip": 4,
    "gligen": 4,
    "embeddings": 5,
}

# 文本兜底没有目录线索，只能按文件名认角色。
# clip_l / t5xxl / qwen3vl 这类是文本编码器，不能当主模型。
_ENCODER_HINT = re.compile(
    r"^(clip|t5|umt5|text|qwen\d*vl|qwen3|pheony|stable\s*clip|comfyui_llama|llama|mistral|glm|gemma)[\s._-]",
    re.I,
)

# 节点类型 → 目录（没有 properties.models 时用这个推目录）
_SLOT_ROLE: dict[str, str] = {
    "CheckpointLoaderSimple": "checkpoints",
    "CheckpointLoader": "checkpoints",
    "UNETLoader": "diffusion_models",
    "UnetLoaderGGUF": "diffusion_models",
    "DiffusionLoader": "diffusion_models",
    "VAELoader": "vae",
    "LoraLoader": "loras",
    "LoraLoaderModelOnly": "loras",
    "CLIPLoader": "text_encoders",
    "DualCLIPLoader": "text_encoders",
    "TripleCLIPLoader": "text_encoders",
    "ControlNetLoader": "controlnet",
    "IPAdapterModelLoader": "ipadapter",
    "UpscaleModelLoader": "upscale_models",
    "StyleModelLoader": "style_models",
    "GLIGENLoader": "gligen",
}

# 文本兜底：模型文件名（带常见后缀）
_TEXT_MODEL_RE = re.compile(r"[\w][\w\-. ]*?\.(?:safetensors|sft|gguf|ckpt|pt|pth|onnx)\b", re.I)


def _looks_like_model(value: Any) -> bool:
    """是不是一个模型文件名。"""
    if not isinstance(value, str) or not value.strip():
        return False
    name = value.strip()
    if name.lower().endswith(_MODEL_EXT):
        return True
    return False


def _node_containers(payload: Any) -> list[list[dict]]:
    """工作流里所有装节点的容器：顶层、workflow 字段、子图。

    子图这层不能漏 —— 实测 Qwen Image 2.1 的模型登记全在子图里，
    只扫顶层会得出「这个工作流没有模型」的结论。
    """
    out: list[list[dict]] = []
    if not isinstance(payload, dict):
        return out

    def collect(container: Any) -> None:
        if isinstance(container, dict):
            nodes = container.get("nodes")
            if isinstance(nodes, list):
                out.append([n for n in nodes if isinstance(n, dict)])

    collect(payload)
    collect(payload.get("workflow"))
    definitions = payload.get("definitions")
    if isinstance(definitions, dict):
        for sg in definitions.get("subgraphs") or []:
            if isinstance(sg, dict):
                collect(sg)
    return out


# 认不出角色的兜底档位。文本兜底场景下，主模型往往就是那个「没线索」的文件
# （minimax_h3 的权重没有目录信息），所以它必须排在文本编码器前面。
_ROLE_UNKNOWN = 2


def _rank_of(directory: str, role: str) -> int:
    """主体优先级。目录优先，目录认不出就用节点角色推的目录。"""
    key = (directory or role or "").strip().lower()
    if key in _DIR_RANK:
        return _DIR_RANK[key]
    if not key:
        return _ROLE_UNKNOWN
    return _DIR_RANK.get(role, _ROLE_UNKNOWN)


def _from_properties(containers: list[list[dict]]) -> list[dict]:
    """通道 A：节点 properties.models[]（带 url + directory）。"""
    found: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for nodes in containers:
        for node in nodes:
            props = node.get("properties")
            if not isinstance(props, dict):
                continue
            models = props.get("models")
            if not isinstance(models, list):
                continue
            for entry in models:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get("name") or "").strip()
                if not _looks_like_model(name):
                    continue
                directory = str(entry.get("directory") or "").strip()
                key = (name, directory)
                if key in seen:
                    continue
                seen.add(key)
                found.append(
                    {
                        "file": name,
                        "node": str(node.get("type") or ""),
                        "directory": directory,
                        "url": str(entry.get("url") or ""),
                    }
                )
    return found


def _from_widgets(containers: list[list[dict]]) -> list[dict]:
    """通道 B：按节点类型取 widgets_values 的模型槽位。"""
    found: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for nodes in containers:
        for node in nodes:
            ntype = str(node.get("type") or "")
            indexes = _SLOTS.get(ntype)
            if not indexes:
                continue
            values = node.get("widgets_values")
            if not isinstance(values, list):
                continue
            role = _SLOT_ROLE.get(ntype, "")
            for idx in indexes:
                if idx >= len(values):
                    continue
                name = values[idx]
                if not _looks_like_model(name):
                    continue
                file = str(name).strip()
                key = (file, role)
                if key in seen:
                    continue
                seen.add(key)
                found.append({"file": file, "node": ntype, "directory": role, "url": ""})
    return found


def _from_text(raw: str) -> list[dict]:
    """通道 C：文本兜底。JSON 语法坏掉的文件也能认出模型。

    没有目录线索，只能按文件名猜角色：clip_l / t5xxl 这类文本编码器
    不能当主模型（真实案例：minimax_h3 工作流里同时有 clip 和 h3 权重，
    按出现顺序会选成 clip，家族判定直接错）。
    """
    found: list[dict] = []
    seen: set[str] = set()
    for match in _TEXT_MODEL_RE.finditer(raw):
        file = match.group(0).strip().lstrip(".").strip()
        if not file or file in seen:
            continue
        seen.add(file)
        role = "text_encoders" if _ENCODER_HINT.match(file) else ""
        found.append({"file": file, "node": "", "directory": role, "url": ""})
    return found


def parse_model_slots(payload: Any, raw: str = "") -> list[dict]:
    """解析工作流里的全部模型槽位。

    通道 A + B 合并去重；都拿不到时才用文本兜底（文件语法坏掉的场景）。
    """
    containers = _node_containers(payload)
    slots = _from_properties(containers) + _from_widgets(containers)
    if not slots and raw:
        slots = _from_text(raw)
    # 同一文件名可能在通道 A（带目录）和通道 B（角色目录）各出现一次，合并保留信息更全的那条
    merged: dict[str, dict] = {}
    for slot in slots:
        file = slot["file"]
        prev = merged.get(file)
        if prev is None:
            merged[file] = slot
            continue
        if not prev.get("directory") and slot.get("directory"):
            prev["directory"] = slot["directory"]
        if not prev.get("url") and slot.get("url"):
            prev["url"] = slot["url"]
        if not prev.get("node") and slot.get("node"):
            prev["node"] = slot["node"]
    return list(merged.values())


def main_model(slots: list[dict]) -> dict | None:
    """从模型槽位里挑出主模型。

    优先级：directory 决定 → 角色兜底。**不按出现顺序**——先遇到 VAELoader
    就把 ae.sft 当主模型了，那是错的。
    """
    if not slots:
        return None
    best: dict | None = None
    best_rank = 99
    for slot in slots:
        rank = _rank_of(slot.get("directory", ""), slot.get("directory", ""))
        # 目录认不出时，用节点类型反推角色
        if rank == _ROLE_UNKNOWN and slot.get("node"):
            role = _SLOT_ROLE.get(slot["node"], "")
            rank = _rank_of("", role)
        if rank < best_rank:
            best = slot
            best_rank = rank
    return best


def analyze(payload: Any, raw: str = "") -> dict:
    """一次算完：全部模型槽位 + 主模型。

    返回：
      slots        [{file, node, directory, url}]
      main         主模型槽位，没有就是 None
      main_file    主模型文件名，没有就是 ""
    """
    slots = parse_model_slots(payload, raw)
    main = main_model(slots)
    return {
        "slots": slots,
        "main": main,
        "main_file": main["file"] if main else "",
    }
