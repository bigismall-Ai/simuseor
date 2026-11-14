"""权重头部解析与模型分类。

这两块是模型库「规格」与「分类」两列的数据来源。
解析只读文件头，不加载权重。
"""
from __future__ import annotations

import json
import struct

import pytest

from app.weight_class import classify, folder_of, task_of
from app.weight_meta import fmt_bytes, pick_weight_file, read_weight, safetensors_info


def _make_safetensors(path, header: dict, payload: bytes = b""):
    blob = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pad = (8 - len(blob) % 8) % 8
    blob += b" " * pad
    path.write_bytes(struct.pack("<Q", len(blob)) + blob + payload)
    return path


# ---------------------------------------------------------------- 解析

def test_reads_dtype_and_params(tmp_path):
    p = _make_safetensors(tmp_path / "m.safetensors", {
        "a.weight": {"dtype": "F16", "shape": [100, 100], "data_offsets": [0, 20000]},
        "b.weight": {"dtype": "F16", "shape": [100, 100], "data_offsets": [20000, 40000]},
    })
    info = read_weight(p)
    assert info is not None
    assert info["precision"] == "FP16"
    assert info["params"] == 20000
    assert info["paramsText"] == "20.0 K"
    assert info["weightGb"] > 0


def test_precision_by_bytes_not_tensor_count(tmp_path):
    """主体精度按字节占比判 —— 按张量数会把 FP8 权重误判成 FP32。

    词嵌入是 F32（张量少、每张量小），主干是 F8（张量多、每张大）。
    """
    p = _make_safetensors(tmp_path / "m.safetensors", {
        # F32：一个张量，但只占 4 字节
        "emb.weight": {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]},
        # F8：三个张量，共占 300 字节
        "blk1.weight": {"dtype": "F8_E4M3", "shape": [100, 100], "data_offsets": [16, 10016]},
        "blk2.weight": {"dtype": "F8_E4M3", "shape": [100, 100], "data_offsets": [10016, 20016]},
        "blk3.weight": {"dtype": "F8_E4M3", "shape": [100, 100], "data_offsets": [20016, 30016]},
    })
    info = read_weight(p)
    assert info["precision"] == "FP8"
    assert info["mixed"], "非主体档位应记进 mixed"


def test_all_zero_file_does_not_crash(tmp_path):
    """全填 ASCII '0' 的占位文件：8 个 '0' 会被读成 3.4 EB 的头长度。

    不加防护的话 f.read(n) 直接 MemoryError，把进程带走。
    """
    p = tmp_path / "fake.safetensors"
    p.write_bytes(b"0" * 3000)
    assert read_weight(p) is None


def test_garbage_header_does_not_crash(tmp_path):
    p = tmp_path / "junk.safetensors"
    p.write_bytes(struct.pack("<Q", 100) + b"not json" * 20)
    assert read_weight(p) is None


def test_header_longer_than_file_rejected(tmp_path):
    p = tmp_path / "short.safetensors"
    p.write_bytes(struct.pack("<Q", 999999) + b"x" * 10)
    assert read_weight(p) is None


def test_demo_flag_detected(tmp_path):
    p = _make_safetensors(tmp_path / "demo.safetensors", {
        "__metadata__": {"demo": "true", "demo_note": "占位"},
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })
    info = read_weight(p)
    assert info["isDemo"] is True
    assert info["meta"]["demo_note"] == "占位"


def test_real_weight_is_not_demo(tmp_path):
    p = _make_safetensors(tmp_path / "real.safetensors", {
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })
    assert read_weight(p)["isDemo"] is False


def test_pick_weight_prefers_safetensors(tmp_path):
    (tmp_path / "a.gguf").write_bytes(b"GGUF" + b"\0" * 24)
    (tmp_path / "b.safetensors").write_bytes(b"\0" * 100)
    w = pick_weight_file(tmp_path)
    assert w.suffix == ".safetensors"


def test_pick_weight_none_when_empty(tmp_path):
    assert pick_weight_file(tmp_path) is None


def test_fmt_bytes():
    assert fmt_bytes(500) == "500 B"
    assert fmt_bytes(1024) == "1.0 KB"
    assert fmt_bytes(1024 ** 2 * 3) == "3.0 MB"
    assert fmt_bytes(1024 ** 3 * 2) == "2.00 GB"


# ---------------------------------------------------------------- 分类

@pytest.mark.parametrize("path,expected", [
    ("E:/x/workspace/models/checkpoints/foo", "checkpoints"),
    ("E:/x/workspace/models/loras/foo", "loras"),
    ("E:/x/workspace/models/vae/foo", "vae"),
    ("E:/x/workspace/models/diffusion_models/foo", "diffusion_models"),
    ("E:/x/workspace/models/upscale_models/foo", "upscale_models"),
    ("E:/x/workspace/models/embeddings/foo", "embeddings"),
])
def test_folder_of(path, expected):
    assert folder_of(path) == expected


def test_folder_unknown_is_unclassified():
    assert folder_of("C:/somewhere/else") == "unclassified"


@pytest.mark.parametrize("name,expected", [
    ("flux1-dev.sft", "text_to_image"),
    ("juggernautXL_v9.safetensors", "text_to_image"),
    ("realvis_xl_v4.safetensors", "text_to_image"),
    ("wan2.2_t2v_fp8.safetensors", "text_to_video"),
    ("4x-UltraSharp.pth", "image_to_image"),
    ("easy_negative.safetensors", "embedding"),
    ("gpt2", "text_generation"),
    ("qwen_image_2.1_int8.safetensors", "text_to_image"),
])
def test_task_of(name, expected):
    assert task_of(name, "checkpoints") == expected


def test_lora_folder_wins():
    """loras 目录里的东西，任务就是「加风格」，不按文件名猜。"""
    assert task_of("add_detail_lora.safetensors", "loras") == "lora"


def test_classify_returns_both_dimensions():
    c = classify("E:/x/workspace/models/loras/detail", "detail.safetensors", [])
    assert c["folder"] == "loras"
    assert c["folderLabel"] == "LoRA"
    assert c["task"] == "lora"
    assert c["taskLabel"] == "LoRA 风格"


def test_classify_unknown_task():
    c = classify("E:/x/workspace/models/checkpoints/zzz", "zzzz", [])
    assert c["task"] == "unknown"


# ---------------------------------------------------------------- 库条目描述

def test_describe_model_marks_demo(tmp_path):
    from app.library_meta import describe_model

    p = _make_safetensors(tmp_path / "demo.safetensors", {
        "__metadata__": {"demo": "true"},
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })
    r = describe_model(str(tmp_path), "demo-model", [])
    assert r["isDemo"] is True
    assert r["vram"]["level"] == "demo"
    assert r["vram"]["text"] == "演示数据"


def test_describe_model_no_weights(tmp_path):
    from app.library_meta import describe_model

    r = describe_model(str(tmp_path), "empty-model", [])
    assert r["hasWeights"] is False
    assert r["noReason"] == "none"
    assert r["vram"]["level"] == "none"
    assert r["vram"]["text"] == "无权重文件"


def test_describe_model_unreadable(tmp_path):
    from app.library_meta import describe_model

    (tmp_path / "bad.safetensors").write_bytes(b"0" * 1000)
    r = describe_model(str(tmp_path), "bad-model", [])
    assert r["noReason"] == "unreadable"
    assert r["vram"]["text"] == "权重不可读"


def test_describe_model_classifies():
    from app.library_meta import describe_model

    r = describe_model("/x/workspace/models/loras/detail", "add_detail.safetensors", [])
    assert r["folder"] == "loras"
    assert r["task"] == "lora"
