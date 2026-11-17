"""模型库的两级本地缓存。

一次 `probe_primary_gpu()` 要跑 nvidia-smi / CIM（约 0.38 s）；模型库列表对
**每个模型**都会问一次显存，facets 又从头算一遍。`describe_model()` 还要 glob
权重文件 + 读文件头。缓存分两层：

- 内存：挡住同一进程内的重复请求；
- 本地文件（var/data/gpu.json、var/data/library_meta.json）：挡住**重启后的
  第一次**，否则每次开服务都要先等半秒才出第一张卡。

这里锁住两个前提：同一进程只探一次；文件事实按 mtime/size 失效，不会拿旧规格。
"""
from __future__ import annotations

import json
import struct

from app import library_meta
from app.comfy import probe as probe_mod


def _make_safetensors(path, header: dict, payload: bytes = b""):
    blob = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pad = (8 - len(blob) % 8) % 8
    blob += b" " * pad
    path.write_bytes(struct.pack("<Q", len(blob)) + blob + payload)
    return path


def _isolate_gpu_cache(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(library_meta, "_GPU_CACHE_PATH", tmp_path / "gpu.json")
    library_meta.clear_gpu_snapshot()


def _isolate_meta_cache(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(library_meta, "_META_CACHE_PATH", tmp_path / "library_meta.json")
    monkeypatch.setattr(library_meta, "_meta_store", None)
    monkeypatch.setattr(library_meta, "_meta_dirty", False)
    # 显存结论不参与文件事实缓存；这里固定一个分母，别让测试去跑真实探测
    monkeypatch.setattr(library_meta, "_gpu_vram_mb", lambda: 16384)


# ---------------------------------------------------------------- 显存快照


def test_gpu_snapshot_is_probed_once(monkeypatch, tmp_path):
    _isolate_gpu_cache(monkeypatch, tmp_path)
    calls = {"n": 0}

    class FakeGpu:
        name = "Test GPU"
        vendor = "nvidia"
        vram_mb = 16384

    def fake_probe():
        calls["n"] += 1
        return FakeGpu()

    monkeypatch.setattr(probe_mod, "probe_primary_gpu", fake_probe)
    try:
        first = library_meta.gpu_snapshot()
        second = library_meta.gpu_snapshot()

        assert first == second
        assert first["vramMb"] == 16384
        assert first["vramText"] == "16 GB"
        assert calls["n"] == 1

        # describe_model 里的显存查询也必须命中同一份缓存
        assert library_meta._gpu_vram_mb() == 16384
        assert calls["n"] == 1
    finally:
        library_meta.clear_gpu_snapshot()


def test_gpu_snapshot_survives_memory_reset(monkeypatch, tmp_path):
    """模拟重启：内存清空、磁盘文件还在时，不能再跑一次探测。"""
    _isolate_gpu_cache(monkeypatch, tmp_path)
    calls = {"n": 0}

    class FakeGpu:
        name = "Cached GPU"
        vendor = "nvidia"
        vram_mb = 24576

    def fake_probe():
        calls["n"] += 1
        return FakeGpu()

    monkeypatch.setattr(probe_mod, "probe_primary_gpu", fake_probe)
    try:
        library_meta.gpu_snapshot()
        assert calls["n"] == 1

        library_meta._vram_cache.update(at=0.0, snapshot=None)  # 进程重启
        snap = library_meta.gpu_snapshot()

        assert snap["vramMb"] == 24576
        assert calls["n"] == 1
    finally:
        library_meta.clear_gpu_snapshot()


def test_gpu_snapshot_no_gpu(monkeypatch, tmp_path):
    _isolate_gpu_cache(monkeypatch, tmp_path)
    monkeypatch.setattr(probe_mod, "probe_primary_gpu", lambda: None)
    try:
        snap = library_meta.gpu_snapshot()
        assert snap["vramMb"] == 0
        assert snap["vramText"] == "未检测到"
        assert library_meta._gpu_vram_mb() is None
    finally:
        library_meta.clear_gpu_snapshot()


# ---------------------------------------------------------------- 文件事实


def test_describe_model_uses_disk_cache(monkeypatch, tmp_path):
    _isolate_meta_cache(monkeypatch, tmp_path)
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    _make_safetensors(model_dir / "w.safetensors", {
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })

    calls = {"n": 0}
    real_read = library_meta.read_weight

    def counting_read(path):
        calls["n"] += 1
        return real_read(path)

    monkeypatch.setattr(library_meta, "read_weight", counting_read)

    first = library_meta.describe_model(str(model_dir), "qwen-image", [])
    assert first["hasWeights"] is True
    assert first["precision"] == "FP16"
    assert calls["n"] == 1

    # 同一次进程内：命中内存
    second = library_meta.describe_model(str(model_dir), "qwen-image", [])
    assert second["precision"] == first["precision"]
    assert calls["n"] == 1

    # 落盘后模拟重启：内存清空、文件还在
    library_meta.flush_meta_cache()
    assert (tmp_path / "library_meta.json").exists()
    monkeypatch.setattr(library_meta, "_meta_store", None)

    third = library_meta.describe_model(str(model_dir), "qwen-image", [])
    assert third["precision"] == first["precision"]
    assert calls["n"] == 1


def test_describe_model_cache_invalidates_on_file_change(monkeypatch, tmp_path):
    """权重文件变了，键里的 mtime/size 就变 —— 不能继续拿旧规格。"""
    _isolate_meta_cache(monkeypatch, tmp_path)
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    weight = model_dir / "w.safetensors"
    _make_safetensors(weight, {
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })

    calls = {"n": 0}
    real_read = library_meta.read_weight

    def counting_read(path):
        calls["n"] += 1
        return real_read(path)

    monkeypatch.setattr(library_meta, "read_weight", counting_read)

    first = library_meta.describe_model(str(model_dir), "qwen-image", [])
    assert first["params"] == "100"
    assert calls["n"] == 1

    _make_safetensors(weight, {
        "w": {"dtype": "F32", "shape": [20, 20], "data_offsets": [0, 800]},
    })
    second = library_meta.describe_model(str(model_dir), "qwen-image", [])

    assert second["precision"] == "FP32"
    assert second["params"] == "400"
    assert calls["n"] == 2


def test_describe_model_cache_survives_tag_unchanged(monkeypatch, tmp_path):
    """标签是键的一部分：标签变了要重算，标签没变继续命中。"""
    _isolate_meta_cache(monkeypatch, tmp_path)
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    _make_safetensors(model_dir / "w.safetensors", {
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })

    calls = {"n": 0}
    real_read = library_meta.read_weight

    def counting_read(path):
        calls["n"] += 1
        return real_read(path)

    monkeypatch.setattr(library_meta, "read_weight", counting_read)

    library_meta.describe_model(str(model_dir), "m", ["a"])
    library_meta.describe_model(str(model_dir), "m", ["a"])
    assert calls["n"] == 1

    library_meta.describe_model(str(model_dir), "m", ["a", "b"])
    assert calls["n"] == 2
