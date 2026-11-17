"""工作流编辑器后端：读取、校验、备份写回、节点定义缓存。"""
from __future__ import annotations

import json
import os

import pytest

from app import workflow_edit
from app.sources.base import SourceError


@pytest.fixture()
def wf_dir(tmp_path, monkeypatch):
    root = tmp_path / "workflows"
    root.mkdir()
    monkeypatch.setattr(workflow_edit, "WORKSPACE_WORKFLOWS_DIR", root)
    monkeypatch.setattr(workflow_edit, "_OBJECT_INFO_PATH", tmp_path / "data" / "object_info.json")
    monkeypatch.setattr(workflow_edit, "active_instance", lambda: None)
    return root


def _write(root, rel, payload):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


UI = {
    "nodes": [{"id": 1, "type": "KSampler", "widgets_values": [42]}],
    "links": [],
    "version": 0.4,
}
API = {
    "1": {"class_type": "KSampler", "inputs": {"seed": 42}},
    "2": {"class_type": "VAEDecode", "inputs": {"samples": ["1", 0]}},
}


def test_load_ui_includes_raw_and_folder(wf_dir):
    _write(wf_dir, "人像/a.json", UI)

    got = workflow_edit.load(str(wf_dir / "人像" / "a.json"))

    assert got["format"] == "ui"
    assert got["name"] == "a"
    assert got["folder"] == "人像"
    assert got["data"]["nodes"][0]["type"] == "KSampler"
    assert json.loads(got["raw"]) == UI
    assert got["error"] == ""


def test_load_api_format(wf_dir):
    _write(wf_dir, "b.json", API)
    assert workflow_edit.load(str(wf_dir / "b.json"))["format"] == "api"


def test_load_broken_json_still_returns_raw(wf_dir):
    path = wf_dir / "bad.json"
    path.write_text('{"nodes": [}', encoding="utf-8")

    got = workflow_edit.load(str(path))

    assert got["format"] == "broken"
    assert got["data"] is None
    assert "JSON 语法错误" in got["error"]
    assert got["raw"].startswith('{"nodes"')


def test_load_refuses_outside_and_non_json(wf_dir, tmp_path):
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(SourceError):
        workflow_edit.load(str(outside))

    note = wf_dir / "note.txt"
    note.write_text("x", encoding="utf-8")
    with pytest.raises(SourceError):
        workflow_edit.load(str(note))


def test_save_writes_backup_and_new_content(wf_dir):
    path = _write(wf_dir, "a.json", UI)
    loaded = workflow_edit.load(str(path))

    changed = json.loads(json.dumps(UI))
    changed["nodes"][0]["widgets_values"] = [99]

    got = workflow_edit.save(str(path), changed, loaded["mtime"])

    assert json.loads(path.read_text(encoding="utf-8"))["nodes"][0]["widgets_values"] == [99]
    backup = path.with_name(path.name + ".bak")
    assert backup.is_file()
    assert json.loads(backup.read_text(encoding="utf-8")) == UI
    assert got["backup"] == str(backup)
    assert got["format"] == "ui"
    # 未改动的自定义字段也要在
    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 0.4


def test_save_rejects_stale_mtime(wf_dir):
    path = _write(wf_dir, "a.json", UI)
    loaded = workflow_edit.load(str(path))
    path.write_text(json.dumps({**UI, "nodes": []}), encoding="utf-8")
    # 有些文件系统的时间精度会把两次写压在同一毫秒里，明确把 mtime 推远
    os.utime(path, (loaded["mtime"] + 5, loaded["mtime"] + 5))

    with pytest.raises(workflow_edit.StaleWorkflow):
        workflow_edit.save(str(path), UI, loaded["mtime"])

    # 拒绝时不能留下半截文件或把对方的修改盖掉
    assert json.loads(path.read_text(encoding="utf-8"))["nodes"] == []


def test_save_rejects_unknown_shape_without_touching_file(wf_dir):
    path = _write(wf_dir, "a.json", UI)

    with pytest.raises(SourceError):
        workflow_edit.save(str(path), {"hello": "world"})

    assert json.loads(path.read_text(encoding="utf-8")) == UI
    assert not path.with_name(path.name + ".bak").exists()


def test_object_info_without_instance_falls_back_to_cache(wf_dir):
    workflow_edit._write_cache({"KSampler": {"name": "KSampler"}}, "old")

    got = workflow_edit.object_info(refresh=True)

    assert got["available"] is False
    assert got["cached"] is True
    assert "KSampler" in got["nodes"]
    assert "没有正在运行" in got["error"]


def test_object_info_fetches_once_and_caches(wf_dir, monkeypatch):
    calls = {"n": 0}

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"KSampler": {"name": "KSampler"}}

    def fake_get(url, **kwargs):
        calls["n"] += 1
        assert url.endswith("/object_info")
        return Resp()

    monkeypatch.setattr(workflow_edit, "active_instance", lambda: {"name": "inst", "port": 8188})
    monkeypatch.setattr(workflow_edit.httpx, "get", fake_get)

    first = workflow_edit.object_info(refresh=True)
    second = workflow_edit.object_info()

    assert first["available"] is True
    assert first["nodes"]["KSampler"]["name"] == "KSampler"
    assert second["available"] is True
    assert second["cached"] is True
    assert calls["n"] == 1
