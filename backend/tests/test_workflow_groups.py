"""分组管理：显式空组、改名（含目录与封面键迁移）、删除、入参校验。

分组存在 var/data/workflow_meta.json 的特殊键 __groups__ 里，它是 list，
所有遍历 entry 的地方都先判 isinstance(dict)，不会被当成一条工作流。
"""
from __future__ import annotations

import json

import pytest

from app import workflow_covers as wc
from app import workflows
from app.sources.base import SourceError


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(workflows, "WORKSPACE_WORKFLOWS_DIR", tmp_path / "workflows")
    monkeypatch.setattr(workflows, "WORKFLOW_META_PATH", tmp_path / "data" / "workflow_meta.json")
    monkeypatch.setattr(wc, "COVERS_PATH", tmp_path / "data" / "workflow_covers.json")
    wc.reset_cache()
    yield tmp_path / "workflows"
    wc.reset_cache()


def _wf(root, rel, group="", title=""):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"nodes": []}', encoding="utf-8")
    if group or title:
        workflows.set_meta(str(path), title, group)
    return path


def _raw():
    return json.loads(workflows.WORKFLOW_META_PATH.read_text(encoding="utf-8"))


# ---------------- 新建 ----------------

def test_create_group_allows_empty_group(env):
    got = workflows.create_group("人像")

    assert {"name": "人像", "count": 0} in got["groups"]
    assert got["defined"] == ["人像"]
    # 特殊键是 list，不会被当成工作流条目
    assert _raw()[workflows.GROUPS_KEY] == ["人像"]
    # 空组不能污染本地列表
    assert workflows.local()["items"] == []


def test_create_group_is_idempotent_and_validates(env):
    workflows.create_group("电商")
    got = workflows.create_group("电商")
    assert got["defined"] == ["电商"]

    for bad in ("", "   ", "x" * 25, "__internal"):
        with pytest.raises(SourceError):
            workflows.create_group(bad)


def test_list_groups_merges_defined_and_in_use(env):
    _wf(env, "a.json", "人像")
    workflows.create_group("电商")

    got = workflows.list_groups()
    by_name = {g["name"]: g["count"] for g in got["groups"]}
    assert by_name == {"人像": 1, "电商": 0}
    assert got["defined"] == ["电商"]


# ---------------- 改名 ----------------

def test_rename_group_moves_dir_and_cover_keys(env):
    a = _wf(env, "人像/a.json", "人像", "甲")
    b = _wf(env, "b.json", "人像")
    wc.pin("人像/a.json", "https://img/old.png")

    got = workflows.rename_group("人像", "肖像")

    assert got["renamed"] == 2
    assert got["moved"] == 1
    assert (env / "肖像" / "a.json").is_file()
    assert not (env / "人像").exists()
    assert a.exists() is False and b.is_file()

    raw = _raw()
    assert raw["肖像/a.json"]["group"] == "肖像"
    assert raw["肖像/a.json"]["title"] == "甲"
    assert raw["b.json"]["group"] == "肖像"
    assert "人像/a.json" not in raw

    # 封面按相对路径索引：目录一改，钉图也要跟着搬
    assert wc.pinned("肖像/a.json") == "https://img/old.png"
    assert wc.pinned("人像/a.json") == ""

    by_path = {it["path"]: it for it in workflows.local()["items"]}
    assert by_path[str(env / "肖像" / "a.json")]["group"] == "肖像"


def test_rename_group_rejects_duplicate_and_noop(env):
    _wf(env, "a.json", "人像")
    workflows.create_group("电商")

    with pytest.raises(SourceError):
        workflows.rename_group("人像", "电商")
    assert workflows.rename_group("人像", "人像")["renamed"] == 0


def test_rename_empty_group_keeps_it_defined(env):
    workflows.create_group("草稿")
    got = workflows.rename_group("草稿", "待定")

    assert got["renamed"] == 0
    assert workflows.list_groups()["defined"] == ["待定"]


def test_rename_group_syncs_existing_dir_without_meta_prefix(env):
    """目录存在但侧车里没有该前缀的键时，改名也不能把目录落下。"""
    _wf(env, "人像/a.json")
    assert workflows.rename_group("人像", "肖像")["moved"] == 0
    assert (env / "肖像" / "a.json").is_file()


# ---------------- 删除 ----------------

def test_delete_group_clears_markers_but_keeps_files(env):
    a = _wf(env, "a.json", "人像", "甲")
    _wf(env, "b.json", "人像")
    workflows.create_group("人像")

    got = workflows.delete_group("人像")

    assert got["cleared"] == 2
    assert a.is_file()
    raw = _raw()
    assert set(raw["a.json"]) == {"title", "updated_at"}
    assert raw["a.json"]["title"] == "甲"
    assert "b.json" not in raw  # 只剩时间戳的空壳要删掉
    assert workflows.GROUPS_KEY not in raw
    assert all(not it["group"] for it in workflows.local()["items"])


def test_delete_group_validates(env):
    with pytest.raises(SourceError):
        workflows.delete_group("")
