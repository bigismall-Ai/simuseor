"""「我的工作流」列表：只认工作流形状的 json，按修改时间倒序，打开路径不许越界。"""
from __future__ import annotations

import json
import os

import pytest

from app import workflows
from app.sources.base import SourceError


@pytest.fixture()
def wf_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(workflows, "WORKSPACE_WORKFLOWS_DIR", tmp_path)
    return tmp_path


def _write(path, payload, mtime: int | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def test_lists_ui_and_api_skips_junk(wf_dir):
    _write(wf_dir / "ui.json", {"nodes": [{"id": 1}, {"id": 2}, {"id": 3}]})
    _write(wf_dir / "sub" / "api.json", {"1": {"class_type": "KSampler"}, "2": {"class_type": "CLIPTextEncode"}})
    _write(wf_dir / "settings.json", {"theme": "dark"})

    data = workflows.local()

    by_name = {it["name"]: it for it in data["items"]}
    assert set(by_name) == {"ui", "api"}  # 认不出工作流形状的 json 不摊进列表
    assert by_name["ui"]["nodes"] == 3
    assert by_name["ui"]["format"] == "ui"
    assert by_name["api"]["nodes"] == 2
    assert by_name["api"]["format"] == "api"
    assert by_name["api"]["folder"] == "sub"
    assert by_name["ui"]["folder"] == ""
    assert data["total"] == 2


def test_sorted_by_mtime_desc(wf_dir):
    _write(wf_dir / "old.json", {"nodes": []}, mtime=1_700_000_000)
    _write(wf_dir / "new.json", {"nodes": []}, mtime=1_800_000_000)

    names = [it["name"] for it in workflows.local()["items"]]
    assert names == ["new", "old"]


def test_wrapper_workflow_is_recognised(wf_dir):
    """ComfyUI 新版把工作流套在 {"workflow": {...}} 里，也要能数出节点。"""
    _write(wf_dir / "wrapped.json", {"workflow": {"nodes": [{"id": 1}, {"id": 2}]}})

    item = workflows.local()["items"][0]
    assert item["nodes"] == 2
    assert item["format"] == "ui"


def test_missing_dir_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(workflows, "WORKSPACE_WORKFLOWS_DIR", tmp_path / "nope")
    data = workflows.local()
    assert data["total"] == 0
    assert data["items"] == []


def test_open_local_rejects_outside_path(wf_dir, tmp_path_factory, monkeypatch):
    # 换一棵目录树：和共享目录同级不算「在里面」
    outside = _write(tmp_path_factory.mktemp("outside") / "x.json", {"nodes": []})
    monkeypatch.setattr(workflows.subprocess, "Popen", lambda *a, **k: None)

    with pytest.raises(SourceError):
        workflows.open_local(str(outside))


def test_open_local_missing_file(wf_dir, monkeypatch):
    monkeypatch.setattr(workflows.subprocess, "Popen", lambda *a, **k: None)

    with pytest.raises(SourceError):
        workflows.open_local(str(wf_dir / "ghost.json"))


def test_open_local_allows_inside_path(wf_dir, monkeypatch):
    calls = []
    monkeypatch.setattr(workflows.subprocess, "Popen", lambda args, *a, **k: calls.append(args))
    target = _write(wf_dir / "ok.json", {"nodes": []})

    result = workflows.open_local(str(target))

    assert result["opened"].endswith("ok.json")
    assert calls  # 交给系统文件管理器，不在进程里等它
