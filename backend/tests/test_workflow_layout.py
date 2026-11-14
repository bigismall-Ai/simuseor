"""分组与真实目录自动同步：写操作即整理、启动收敛、孤儿键与封面迁移。

ComfyUI 侧栏只按目录展示，读不到侧车分组。因此「分组 = 文件夹」是持续成立的
不变量：任何改分组的操作之后都不该还需要用户点一次「按分组整理」。
"""
from __future__ import annotations

import pytest

from app import workflow_covers as wc
from app import workflows


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(workflows, "WORKSPACE_WORKFLOWS_DIR", tmp_path / "workflows")
    monkeypatch.setattr(workflows, "WORKFLOW_META_PATH", tmp_path / "data" / "workflow_meta.json")
    monkeypatch.setattr(wc, "COVERS_PATH", tmp_path / "data" / "workflow_covers.json")
    wc.reset_cache()
    yield tmp_path / "workflows"
    wc.reset_cache()


def _wf(root, rel):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"nodes": []}', encoding="utf-8")
    return path


def test_startup_sync_repairs_legacy_layout(env):
    """旧版本留下的「打了分组却还在根目录」，服务启动时一次收敛。"""
    _wf(env, "a.json")
    workflows.save_meta({"a.json": {"group": "人像", "updated_at": "2026-01-01"}})
    wc.pin("a.json", "https://img/x.png")

    got = workflows.organize_groups()

    assert got["moved"] == 1
    assert (env / "人像" / "a.json").is_file()
    assert set(workflows.load_meta()) == {"人像/a.json"}
    assert wc.pinned("人像/a.json") == "https://img/x.png"
    # 幂等：正常进页面反复同步都是零写入
    assert workflows.organize_groups()["moved"] == 0


def test_set_meta_moves_cover_cache_key(env, monkeypatch):
    """自动整理也是搬目录，封面缓存的键必须跟着走。"""
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        workflows, "rename_cover_key", lambda old, new: calls.append((old, new)) or True
    )
    a = _wf(env, "a.json")

    got = workflows.set_meta(str(a), "名字", "人像")

    assert got == {
        "title": "名字", "group": "人像", "file": "", "key": "人像/a.json",
        "moved": True, "folder": "人像",
    }
    assert calls == [("a.json", "人像/a.json")]


def test_clear_group_keeps_title_and_returns_to_root(env):
    """取消分组但保留显示名：文件回根目录，空目录清掉，名字不丢。"""
    a = _wf(env, "a.json")
    workflows.set_meta(str(a), "名字", "人像")

    got = workflows.set_meta(str(env / "人像" / "a.json"), "名字", "")

    assert got["key"] == "a.json" and got["folder"] == ""
    assert (env / "a.json").is_file()
    assert not (env / "人像").exists()
    assert workflows.load_meta()["a.json"]["title"] == "名字"


def test_delete_group_restores_files_and_removes_empty_folder(env):
    """删分组不能只在侧车里清标记，真实文件夹也要跟着消失。"""
    a, b = _wf(env, "a.json"), _wf(env, "b.json")
    workflows.set_meta(str(a), "甲", "人像")
    workflows.set_meta(str(b), "", "人像")
    workflows.create_group("人像")

    got = workflows.delete_group("人像")

    assert got["cleared"] == 2 and got["restored"] == 2
    assert (env / "a.json").is_file() and (env / "b.json").is_file()
    assert not (env / "人像").exists()
    assert all(not it["group"] for it in workflows.local()["items"])


def test_rename_group_also_places_stragglers(env):
    """改名时还留在根目录的同组工作流也要一起落进新目录。"""
    _wf(env, "人像/a.json")
    _wf(env, "b.json")
    workflows.save_meta({
        "人像/a.json": {"group": "人像"},
        "b.json": {"group": "人像"},
    })

    got = workflows.rename_group("人像", "肖像")

    assert got["moved"] == 1 and got["synced"] == 1
    assert (env / "肖像" / "a.json").is_file()
    assert (env / "肖像" / "b.json").is_file()
    assert not (env / "人像").exists()


def test_group_with_illegal_chars_gets_safe_folder(env):
    a = _wf(env, "a.json")

    got = workflows.set_meta(str(a), "名字", "人像/写真")

    assert got["folder"] == "人像_写真"
    assert (env / "人像_写真" / "a.json").is_file()
