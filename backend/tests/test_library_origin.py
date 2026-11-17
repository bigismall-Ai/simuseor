"""本地导入目录的来源还原：只认明确证据，不猜。"""
from __future__ import annotations

import json

from app import library_origin


def _no_task(monkeypatch):
    monkeypatch.setattr(library_origin, "query", lambda *a, **k: [])


def test_civitai_sidecar_gives_version_page(tmp_path, monkeypatch):
    _no_task(monkeypatch)
    (tmp_path / "model.safetensors").write_bytes(b"x")
    (tmp_path / "model.safetensors.civitai.info").write_text(
        json.dumps({"id": 123456, "modelId": 128374, "name": "v1"}),
        encoding="utf-8",
    )

    origin = library_origin.detect_origin(tmp_path)

    assert origin is not None
    assert origin["source"] == "civitai"
    assert origin["repo_id"] == "128374"
    assert origin["revision"] == "123456"
    assert origin["source_url"] == "https://civitai.com/models/128374?modelVersionId=123456"


def test_civitai_sidecar_without_version_falls_back_to_model_page(tmp_path, monkeypatch):
    _no_task(monkeypatch)
    (tmp_path / "model.civitai.json").write_text(
        json.dumps({"modelId": 128374}),
        encoding="utf-8",
    )

    origin = library_origin.detect_origin(tmp_path)

    assert origin is not None
    assert origin["revision"] == ""
    assert origin["source_url"] == "https://civitai.com/models/128374"


def test_app_download_task_restores_origin(tmp_path, monkeypatch):
    monkeypatch.setattr(
        library_origin,
        "query",
        lambda *a, **k: [
            {"source": "huggingface", "repo_id": "org/repo", "revision": "abc123"}
        ],
    )

    origin = library_origin.detect_origin(tmp_path)

    assert origin is not None
    assert origin["source"] == "huggingface"
    assert origin["repo_id"] == "org/repo"
    assert origin["source_url"] == "https://huggingface.co/org/repo/tree/abc123"


def test_no_evidence_returns_none(tmp_path, monkeypatch):
    _no_task(monkeypatch)
    (tmp_path / "model.safetensors").write_bytes(b"x")

    assert library_origin.detect_origin(tmp_path) is None


def test_broken_sidecar_is_ignored(tmp_path, monkeypatch):
    _no_task(monkeypatch)
    (tmp_path / "model.civitai.info").write_text("{not json", encoding="utf-8")

    assert library_origin.detect_origin(tmp_path) is None
