"""导入模型的自动来源匹配：名字归一 + safetensors 头指纹。"""
from __future__ import annotations

import json
import struct
from types import SimpleNamespace

from app import library_match
from app.weight_meta import schema_hash


def _make_safetensors(path, header: dict, payload: bytes = b""):
    blob = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    pad = (8 - len(blob) % 8) % 8
    blob += b" " * pad
    path.write_bytes(struct.pack("<Q", len(blob)) + blob + payload)
    return path


def test_schema_hash_ignores_metadata_and_offsets():
    a = schema_hash({
        "__metadata__": {"demo": "true"},
        "w": {"dtype": "F16", "shape": [2, 3], "data_offsets": [0, 12]},
    })
    b = schema_hash({
        "__metadata__": {"something": "else"},
        "w": {"dtype": "F16", "shape": [2, 3], "data_offsets": [100, 112]},
    })
    c = schema_hash({
        "w": {"dtype": "F32", "shape": [2, 3], "data_offsets": [0, 24]},
    })
    assert a == b
    assert a != c


def test_norm_ignores_case_and_separators():
    assert library_match._norm("Krea2_NSFW-Uncensored Complete") == library_match._norm(
        "krea2 nsfw uncensored complete"
    )
    assert library_match._norm("a") != library_match._norm("b")


def test_local_fingerprint_reads_safetensors(tmp_path):
    _make_safetensors(tmp_path / "model.safetensors", {
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })
    fp = library_match.local_fingerprint(tmp_path)
    assert fp is not None
    assert fp["name"] == "model.safetensors"
    assert fp["schema"] == schema_hash({
        "w": {"dtype": "F16", "shape": [10, 10], "data_offsets": [0, 200]},
    })


def test_local_fingerprint_skips_non_safetensors(tmp_path):
    (tmp_path / "model.ckpt").write_bytes(b"x")
    assert library_match.local_fingerprint(tmp_path) is None


def test_match_origin_links_only_when_header_matches(tmp_path, monkeypatch):
    monkeypatch.setattr(library_match, "local_fingerprint", lambda d: {
        "file": tmp_path / "model.safetensors",
        "name": "model.safetensors",
        "size": 100,
        "schema": "abc",
        "params": 100,
        "tensors": 1,
    })
    monkeypatch.setattr(library_match, "load_settings", lambda: {"sources": {}})
    monkeypatch.setattr(library_match, "_candidates", lambda *a: [
        {"source": "huggingface", "repo_id": "org/repo", "name": "model"},
    ])
    repo = SimpleNamespace(revision="main")
    remote = SimpleNamespace(path="model.safetensors", size=100, candidates=["http://x"])
    monkeypatch.setattr(library_match, "_remote_files", lambda *a: (repo, [remote]))
    monkeypatch.setattr(library_match, "_remote_schema_hash", lambda urls: "abc")

    origin = library_match.match_origin(tmp_path)
    assert origin is not None
    assert origin["source"] == "huggingface"
    assert origin["repo_id"] == "org/repo"
    assert origin["source_url"] == "https://huggingface.co/org/repo"


def test_match_origin_rejects_different_header(tmp_path, monkeypatch):
    monkeypatch.setattr(library_match, "local_fingerprint", lambda d: {
        "file": tmp_path / "model.safetensors",
        "name": "model.safetensors",
        "size": 100,
        "schema": "abc",
        "params": 100,
        "tensors": 1,
    })
    monkeypatch.setattr(library_match, "load_settings", lambda: {"sources": {}})
    monkeypatch.setattr(library_match, "_candidates", lambda *a: [
        {"source": "huggingface", "repo_id": "org/repo", "name": "model"},
    ])
    repo = SimpleNamespace(revision="main")
    remote = SimpleNamespace(path="model.safetensors", size=100, candidates=["http://x"])
    monkeypatch.setattr(library_match, "_remote_files", lambda *a: (repo, [remote]))
    monkeypatch.setattr(library_match, "_remote_schema_hash", lambda urls: "different")

    assert library_match.match_origin(tmp_path) is None
