"""工作流主模型解析。

锁住几个实测出来的关键行为：
- DualCLIPLoader 的 [0] 才是主编码器（不是 [1]）
- 子图（definitions.subgraphs）里的模型登记不能漏
- 主体按 directory 排，不按出现顺序（先撞 VAE 就错认主模型）
- JSON 语法坏掉的文件靠文本兜底仍能认出主模型
"""
from __future__ import annotations

import json

from app import workflow_models as wm


def _ui(nodes: list[dict]) -> dict:
    return {"nodes": nodes, "links": [], "version": 0.4}


def _node(ntype: str, widgets=None, models=None) -> dict:
    node = {"id": 1, "type": ntype, "widgets_values": widgets}
    if models is not None:
        node["properties"] = {"models": models}
    return node


# ---------------- 通道 A：properties.models ----------------

def test_properties_models_is_authoritative():
    payload = _ui(
        [
            _node(
                "UNETLoader",
                ["qwen_image_2.1_int8_convrot.safetensors", "default"],
                [{"name": "qwen_image_2.1_int8_convrot.safetensors", "url": "https://x/y", "directory": "diffusion_models"}],
            )
        ]
    )
    info = wm.analyze(payload)
    assert info["main_file"] == "qwen_image_2.1_int8_convrot.safetensors"
    assert info["main"]["directory"] == "diffusion_models"
    assert info["main"]["url"] == "https://x/y"


def test_subgraph_models_are_found():
    """实测：Qwen Image 2.1 的模型登记全在子图里，顶层一个都没有。"""
    payload = {
        "nodes": [_node("SaveImageAdvanced", ["x", "png"])],
        "definitions": {
            "subgraphs": [
                {
                    "name": "Image Edit",
                    "nodes": [
                        _node(
                            "UNETLoader",
                            ["qwen_image_2.1_int8_convrot.safetensors", "default"],
                            [{"name": "qwen_image_2.1_int8_convrot.safetensors", "directory": "diffusion_models"}],
                        )
                    ],
                }
            ]
        },
    }
    info = wm.analyze(payload)
    assert info["main_file"] == "qwen_image_2.1_int8_convrot.safetensors"


def test_workflow_nested_nodes_are_found():
    payload = {"workflow": {"nodes": [_node("UNETLoader", ["flux1-dev.sft", "default"])]}}
    assert wm.analyze(payload)["main_file"] == "flux1-dev.sft"


# ---------------- 通道 B：widgets 槽位 ----------------

def test_widgets_fallback_without_properties():
    payload = _ui([_node("UNETLoader", ["flux1-dev.sft", "default"])])
    info = wm.analyze(payload)
    assert info["main_file"] == "flux1-dev.sft"
    assert info["main"]["directory"] == "diffusion_models"


def test_dual_clip_loader_takes_both_encoders():
    """实测 [0]=t5xxl_fp16 是主编码器，[1]=clip_l 是轻量的。两个都要收。"""
    payload = _ui([_node("DualCLIPLoader", ["t5xxl_fp16.safetensors", "clip_l.safetensors", "flux"])])
    files = [s["file"] for s in wm.analyze(payload)["slots"]]
    assert "t5xxl_fp16.safetensors" in files
    assert "clip_l.safetensors" in files


def test_main_model_ignores_appearance_order():
    """VAE 节点排在 UNET 前面，也不能把 ae.sft 当主模型。"""
    payload = _ui(
        [
            _node("VAELoader", ["ae.sft"]),
            _node("VAELoader", ["ae.safetensors"]),
            _node("UNETLoader", ["flux1-dev.sft", "default"]),
            _node("DualCLIPLoader", ["t5xxl_fp16.safetensors", "clip_l.safetensors", "flux"]),
        ]
    )
    assert wm.analyze(payload)["main_file"] == "flux1-dev.sft"


def test_lora_is_not_main_model():
    payload = _ui(
        [
            _node("LoraLoader", ["some_lora.safetensors", "model.safetensors"]),
            _node("UNETLoader", ["flux1-dev.sft", "default"]),
        ]
    )
    assert wm.analyze(payload)["main_file"] == "flux1-dev.sft"


def test_checkpoint_wins_over_unet():
    payload = _ui(
        [
            _node("UNETLoader", ["flux1-dev.sft", "default"]),
            _node("CheckpointLoaderSimple", ["sd_xl_base.safetensors"]),
        ]
    )
    assert wm.analyze(payload)["main_file"] == "sd_xl_base.safetensors"


def test_non_model_widgets_are_ignored():
    payload = _ui([_node("KSamplerSelect", ["deis"]), _node("BasicScheduler", ["normal", 25, 0.5])])
    assert wm.analyze(payload)["slots"] == []


def test_lora_widget_object_is_not_a_model():
    """rgthree 的 lora 槽位是个 dict，不能当成文件名。"""
    payload = _ui([_node("Power Lora Loader (rgthree)", [None, {"type": "PowerLoraLoaderHeaderWidget"}])])
    assert wm.analyze(payload)["slots"] == []


def test_model_extension_filter():
    payload = _ui([_node("UNETLoader", ["flux1-dev.sft", "default"]), _node("VAELoader", ["ae.png"])])
    files = [s["file"] for s in wm.analyze(payload)["slots"]]
    assert "flux1-dev.sft" in files
    assert "ae.png" not in files


# ---------------- 通道 C：文本兜底 ----------------

def test_broken_json_still_finds_main_model_by_text():
    """语法坏掉的文件：靠正则扫文本捞模型文件名。"""
    raw = '{"nodes": [{"type": "UNETLoader", "widgets_values": ["minimax_h3_fl2va_pruned_int8_convrot.safetensors"'
    info = wm.analyze(None, raw)
    assert "minimax_h3_fl2va_pruned_int8_convrot.safetensors" in info["main_file"]


def test_text_fallback_picks_a_real_model():
    raw = 'garbage "clip_l.safetensors" and "minimax_h3_fl2va_pruned_int8_convrot.safetensors"'
    info = wm.analyze(None, raw)
    assert info["main_file"] == "minimax_h3_fl2va_pruned_int8_convrot.safetensors"


def test_text_fallback_not_used_when_parse_ok():
    """能正常解析时不用文本兜底 —— 否则注释里的文件名会混进来。"""
    payload = _ui([_node("UNETLoader", ["flux1-dev.sft", "default"])])
    info = wm.analyze(payload, "mentions other_model.safetensors in text")
    assert [s["file"] for s in info["slots"]] == ["flux1-dev.sft"]


def test_empty_payload():
    info = wm.analyze(None, "")
    assert info["slots"] == []
    assert info["main"] is None
    assert info["main_file"] == ""


# ---------------- 合并去重 ----------------

def test_same_file_in_both_channels_is_deduped():
    payload = _ui(
        [
            _node(
                "UNETLoader",
                ["flux1-dev.sft", "default"],
                [{"name": "flux1-dev.sft", "url": "https://x/y", "directory": "diffusion_models"}],
            )
        ]
    )
    slots = wm.analyze(payload)["slots"]
    assert len(slots) == 1
    assert slots[0]["url"] == "https://x/y"
