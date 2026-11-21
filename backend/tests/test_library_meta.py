"""模型库的缓存行为。

- 硬件快照是进程级单例：启动时探一次，模型库 / 环境页 / 发现页共用；
- 文件事实（权重规格 / 分类）按 mtime/size 失效，不会拿旧规格。
"""
from __future__ import annotations

import json
import os
import struct

from app import library_meta
from app.comfy import probe as probe_mod
from app.comfy.models import DeviceReport, GpuInfo


def _make_safetensors(path, header: dict, payload: bytes = b""):
    blob = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pad = (8 - len(blob) % 8) % 8
    blob += b" " * pad
    path.write_bytes(struct.pack("<Q", len(blob)) + blob + payload)
    return path


def _warm_hardware(monkeypatch, gpu: GpuInfo | None) -> dict:
    """把启动时的后台探测替换成假数据，并真正跑一次 warm。"""
    calls = {"n": 0}

    def fake_probe():
        calls["n"] += 1
        return DeviceReport(
            os="windows",
            gpus=[gpu] if gpu else [],
            primary_gpu=gpu,
            probed_at="2026-01-01T00:00:00+08:00",
        )

    monkeypatch.setattr(probe_mod, "_probe_hardware", fake_probe)
    probe_mod.reset_hardware_snapshot()
    probe_mod.warm_hardware()
    return calls


def _isolate_meta_cache(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(library_meta, "_META_CACHE_PATH", tmp_path / "library_meta.json")
    monkeypatch.setattr(library_meta, "_meta_store", None)
    monkeypatch.setattr(library_meta, "_meta_dirty", False)
    # 显存结论不参与文件事实缓存；这里固定一个分母，别让测试去跑真实探测
    monkeypatch.setattr(library_meta, "_gpu_vram_mb", lambda: 16384)


# ---------------------------------------------------------------- 硬件快照


def test_gpu_snapshot_is_probed_once(monkeypatch):
    gpu = GpuInfo(vendor="nvidia", name="Test GPU", vram_mb=16384)
    calls = _warm_hardware(monkeypatch, gpu)
    try:
        first = library_meta.gpu_snapshot()
        second = library_meta.gpu_snapshot()

        assert first == second
        assert first["vramMb"] == 16384
        assert first["vramText"] == "16 GB"
        assert calls["n"] == 1

        # describe_model 里的显存查询也必须命中同一份快照
        assert library_meta._gpu_vram_mb() == 16384
        assert calls["n"] == 1
    finally:
        probe_mod.reset_hardware_snapshot()


def test_device_report_reuses_hardware_snapshot(monkeypatch):
    """环境页拿完整报告时，硬件只读快照；实例 / Python / 磁盘现扫。"""
    gpu = GpuInfo(vendor="nvidia", name="Cached GPU", vram_mb=24576)
    calls = _warm_hardware(monkeypatch, gpu)
    monkeypatch.setattr(probe_mod, "_collect_pythons", lambda ctx: [])
    monkeypatch.setattr(probe_mod, "_collect_disks", lambda os_name: [])
    monkeypatch.setattr(probe_mod, "_collect_instances", lambda ctx: [])
    try:
        first = probe_mod.current_device_report()
        second = probe_mod.current_device_report()

        assert first.primary_gpu is not None
        assert first.primary_gpu.vram_mb == 24576
        assert second.primary_gpu is not None
        assert calls["n"] == 1
    finally:
        probe_mod.reset_hardware_snapshot()


def test_gpu_snapshot_no_gpu(monkeypatch):
    _warm_hardware(monkeypatch, None)
    try:
        snap = library_meta.gpu_snapshot()
        assert snap["vramMb"] == 0
        assert snap["vramText"] == "未检测到"
        assert library_meta._gpu_vram_mb() is None
    finally:
        probe_mod.reset_hardware_snapshot()


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
    # 两次写的文件长度相同，Windows 的时钟粒度可能让 mtime 不变；
    # 显式推进一毫秒，才能稳定测到「文件变了 → 键变了」。
    st = weight.stat()
    os.utime(weight, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
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
