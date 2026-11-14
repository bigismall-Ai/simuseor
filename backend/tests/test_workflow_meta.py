"""工作流的自定义命名与分组：侧车元数据读写、键的算法、越权防护。

命名与分组存在 var/data/workflow_meta.json 侧车里，不写回工作流 JSON ——
那些文件 ComfyUI 自己也要读，改坏了画布就打不开。
"""
from __future__ import annotations

import json
import os

import pytest

from app import workflows
from app.sources.base import SourceError


@pytest.fixture()
def wf_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(workflows, "WORKSPACE_WORKFLOWS_DIR", tmp_path / "workflows")
    # 侧车在 var/data/ 下，不在工作流目录里 —— 放一起会被当成工作流扫到
    meta_path = tmp_path / "data" / "workflow_meta.json"
    monkeypatch.setattr(workflows, "WORKFLOW_META_PATH", meta_path)
    return tmp_path / "workflows"


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_meta_key_is_relative_path_not_filename(wf_dir):
    """键必须是相对共享目录的路径 —— 文件都在子文件夹里，只按文件名会撞。"""
    a = _write(wf_dir / "pack1" / "shot.json", {"nodes": []})
    b = _write(wf_dir / "pack2" / "shot.json", {"nodes": []})

    workflows.set_meta(str(a), "甲", "组一")
    workflows.set_meta(str(b), "乙", "组二")

    # 两个同名文件按路径区分，不能互相覆盖
    raw = json.loads(workflows.WORKFLOW_META_PATH.read_text(encoding="utf-8"))
    assert set(raw) == {"pack1/shot.json", "pack2/shot.json"}
    assert raw["pack1/shot.json"]["title"] == "甲"
    assert raw["pack2/shot.json"]["title"] == "乙"

    # 列表里两条都带着各自的元数据
    by_path = {it["path"]: it for it in workflows.local()["items"]}
    assert by_path[str(a)]["title"] == "甲"
    assert by_path[str(a)]["group"] == "组一"
    assert by_path[str(b)]["title"] == "乙"
    assert by_path[str(b)]["group"] == "组二"


def test_title_and_group_roundtrip(wf_dir):
    target = _write(wf_dir / "a.json", {"nodes": []})

    workflows.set_meta(str(target), "人像高清修复", "人像")

    item = workflows.local()["items"][0]
    assert item["title"] == "人像高清修复"
    assert item["group"] == "人像"


def test_empty_title_and_group_clears_entry(wf_dir):
    """清空后不能留下只有时间戳的空壳条目。"""
    target = _write(wf_dir / "a.json", {"nodes": []})

    workflows.set_meta(str(target), "临时", "组")
    assert workflows.WORKFLOW_META_PATH.exists()

    workflows.set_meta(str(target), "", "")

    raw = json.loads(workflows.WORKFLOW_META_PATH.read_text(encoding="utf-8"))
    assert raw == {}, f"清空后应不留空壳条目，实际：{raw}"


def test_groups_are_counted(wf_dir):
    _write(wf_dir / "a.json", {"nodes": []})
    _write(wf_dir / "b.json", {"nodes": []})
    _write(wf_dir / "c.json", {"nodes": []})

    workflows.set_meta(str(wf_dir / "a.json"), "甲", "人像")
    workflows.set_meta(str(wf_dir / "b.json"), "乙", "人像")
    workflows.set_meta(str(wf_dir / "c.json"), "丙", "电商")

    groups = workflows.local()["groups"]
    assert groups == [{"name": "人像", "count": 2}, {"name": "电商", "count": 1}]


def test_ungrouped_is_not_listed(wf_dir):
    _write(wf_dir / "a.json", {"nodes": []})
    workflows.set_meta(str(wf_dir / "a.json"), "只有名字", "")

    assert workflows.local()["groups"] == []


def test_meta_does_not_touch_workflow_file(wf_dir):
    """改名分组不能动工作流文件本身。"""
    target = _write(wf_dir / "a.json", {"nodes": [{"id": 1}]})
    before = target.read_text(encoding="utf-8")
    mtime_before = target.stat().st_mtime

    workflows.set_meta(str(target), "新名字", "新组")

    assert target.read_text(encoding="utf-8") == before
    assert target.stat().st_mtime == mtime_before
    assert target.exists()


def test_rename_file_moves_meta_key(wf_dir):
    """勾选「同时重命名文件」时，侧车键要跟着换，否则自定义名会丢。"""
    target = _write(wf_dir / "old.json", {"nodes": []})
    workflows.set_meta(str(target), "旧名字", "组")

    result = workflows.set_meta(str(target), "新名字", "组", rename_file=True)

    assert result["file"] == "新名字.json"
    assert (wf_dir / "新名字.json").exists()
    assert not (wf_dir / "old.json").exists()
    assert result["key"] == "新名字.json"

    item = workflows.local()["items"][0]
    assert item["name"] == "新名字"
    assert item["title"] == "新名字"
    assert item["group"] == "组"


def test_rename_file_moves_cover_cache(wf_dir, monkeypatch):
    """改文件名不该换封面 —— 封面缓存按路径索引，键得跟着搬。"""
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(workflows, "rename_cover_key", lambda old, new: calls.append((old, new)) or True)

    target = _write(wf_dir / "old.json", {"nodes": []})
    workflows.set_meta(str(target), "新名字", "", rename_file=True)

    assert calls == [("old.json", "新名字.json")]


def test_delete_local_forgets_cover(wf_dir, monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(workflows, "forget_cover", lambda key: seen.append(key) or True)

    target = _write(wf_dir / "a.json", {"nodes": []})
    workflows.delete_local(str(target))

    assert seen == ["a.json"]


def test_rename_file_does_not_overwrite(wf_dir):
    target = _write(wf_dir / "a.json", {"nodes": []})
    _write(wf_dir / "占用.json", {"nodes": []})

    workflows.set_meta(str(target), "占用", "组", rename_file=True)

    assert (wf_dir / "a.json").exists()  # 原文件还在，没被覆盖
    assert (wf_dir / "占用.json").exists()


def test_rename_file_sanitises_illegal_chars(wf_dir):
    target = _write(wf_dir / "a.json", {"nodes": []})

    result = workflows.set_meta(str(target), "a/b:c*d", "组", rename_file=True)

    assert "/" not in result["file"] and ":" not in result["file"]
    assert result["file"].endswith(".json")


def test_meta_rejects_outside_path(wf_dir, tmp_path_factory):
    outside = _write(tmp_path_factory.mktemp("outside") / "x.json", {"nodes": []})

    with pytest.raises(SourceError):
        workflows.set_meta(str(outside), "越权", "组")


def test_meta_rejects_missing_file(wf_dir):
    with pytest.raises(SourceError):
        workflows.set_meta(str(wf_dir / "ghost.json"), "名", "组")


def test_meta_rejects_overlong_values(wf_dir):
    target = _write(wf_dir / "a.json", {"nodes": []})

    with pytest.raises(SourceError):
        workflows.set_meta(str(target), "x" * 81, "组")
    with pytest.raises(SourceError):
        workflows.set_meta(str(target), "名", "g" * 25)


def test_broken_workflow_is_listed_with_error(wf_dir):
    """解析失败的文件也要占位可见，不能被静默吞掉。"""
    wf_dir.mkdir(parents=True, exist_ok=True)
    bad = wf_dir / "bad.json"
    bad.write_text('{"nodes": [1, 2', encoding="utf-8")

    data = workflows.local()
    item = data["items"][0]
    assert item["name"] == "bad"
    assert item["format"] == "broken"
    assert item["nodes"] == 0
    assert item["error"]
    assert item["error_line"] >= 1


def test_broken_workflow_can_still_be_named(wf_dir):
    wf_dir.mkdir(parents=True, exist_ok=True)
    bad = wf_dir / "bad.json"
    bad.write_text("{oops", encoding="utf-8")

    workflows.set_meta(str(bad), "坏文件", "待修")

    item = workflows.local()["items"][0]
    assert item["title"] == "坏文件"
    assert item["group"] == "待修"


def test_broken_meta_file_does_not_break_listing(wf_dir):
    """元数据文件坏了 → 退回空表，不拖垮整个列表。"""
    _write(wf_dir / "a.json", {"nodes": []})
    workflows.WORKFLOW_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    workflows.WORKFLOW_META_PATH.write_text("{ 这不是 json", encoding="utf-8")

    data = workflows.local()
    assert data["total"] == 1
    assert data["items"][0]["title"] == ""


def test_meta_file_written_atomically(wf_dir):
    """写侧车走 tmp → replace，中途失败不会留下半截文件。"""
    target = _write(wf_dir / "a.json", {"nodes": []})
    workflows.set_meta(str(target), "名", "组")

    assert not workflows.WORKFLOW_META_PATH.with_suffix(".json.tmp").exists()
    assert json.loads(workflows.WORKFLOW_META_PATH.read_text(encoding="utf-8"))
