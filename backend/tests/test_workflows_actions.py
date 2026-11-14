"""本地工作流的三个动作：使用（起实例）、用默认程序打开、删除。

路径白名单是这里最要紧的东西 —— 这三个动作都能落到文件系统上。
"""
from __future__ import annotations

import pytest

from app import workflows as wf
from app.sources.base import SourceError


@pytest.fixture
def root(tmp_path, monkeypatch):
    base = tmp_path / "workflows"
    base.mkdir()
    monkeypatch.setattr(wf, "WORKSPACE_WORKFLOWS_DIR", base)
    monkeypatch.setattr(wf, "DATA_DIR", tmp_path)
    monkeypatch.setattr(wf, "WORKFLOW_META_PATH", tmp_path / "workflow_meta.json")
    wf.save_meta({})
    return base


def test_delete_removes_file_and_sidecar(root):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    wf.set_meta(str(target), title="我的名字", group="人像")

    out = wf.delete_local(str(target))

    assert out["key"] == "demo.json"
    assert not target.exists()
    assert wf.load_meta() == {}


def test_delete_rejects_outside_path(root, tmp_path):
    outside = tmp_path / "secret.json"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(SourceError):
        wf.delete_local(str(outside))
    assert outside.exists()


def test_delete_missing_file(root):
    with pytest.raises(SourceError):
        wf.delete_local(str(root / "nope.json"))


def test_use_local_requires_instance(root, monkeypatch):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wf, "active_instance", lambda: None)
    monkeypatch.setattr(wf, "_latest_instance", lambda: "")
    with pytest.raises(SourceError) as exc:
        wf.use_local(str(target))
    assert "安装" in str(exc.value)


def test_use_local_starts_instance_and_returns_url(root, monkeypatch):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    started: list[str] = []

    monkeypatch.setattr(wf, "active_instance", lambda: None)
    monkeypatch.setattr(wf, "_latest_instance", lambda: "v1")
    monkeypatch.setattr(wf, "start_instance", lambda name: started.append(name) or {})
    monkeypatch.setattr(
        wf,
        "instance_status",
        lambda name, wait=0: {"name": name, "state": "running", "port": 8188, "url": "http://127.0.0.1:8188/"},
    )
    monkeypatch.setattr(wf, "_ui_ready", lambda name: True)

    out = wf.use_local(str(target))

    assert started == ["v1"]
    assert out["url"] == "http://127.0.0.1:8188/"
    assert out["name"] == "demo"


def test_use_local_reports_exit_reason_from_log(root, monkeypatch, tmp_path):
    """起不来时要把日志尾巴带出来，否则用户只看到「启动失败」四个字。"""
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    log = tmp_path / "run.log"
    log.write_text("# heading\nModuleNotFoundError: No module named 'comfy_aimdo'\n", encoding="utf-8")

    monkeypatch.setattr(wf, "active_instance", lambda: None)
    monkeypatch.setattr(wf, "_latest_instance", lambda: "v1")
    monkeypatch.setattr(wf, "start_instance", lambda name: {})
    monkeypatch.setattr(
        wf,
        "instance_status",
        lambda name, wait=0: {"name": name, "state": "stopped", "port": None, "url": "", "log": str(log)},
    )

    with pytest.raises(SourceError) as exc:
        wf.use_local(str(target))
    assert "comfy_aimdo" in str(exc.value)


def test_use_local_rejects_instance_without_frontend(root, monkeypatch):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wf, "active_instance", lambda: {"name": "v1", "url": "http://127.0.0.1:8188/"})
    monkeypatch.setattr(wf, "_ui_ready", lambda name: False)

    with pytest.raises(SourceError) as exc:
        wf.use_local(str(target))
    assert "前端包" in str(exc.value)


def test_use_local_reuses_running_instance(root, monkeypatch):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wf, "active_instance", lambda: {"name": "v9", "url": "http://127.0.0.1:9000/"})
    monkeypatch.setattr(wf, "_ui_ready", lambda name: True)

    def boom(_name):  # 已经在跑就不该再启动
        raise AssertionError("不该启动新实例")

    monkeypatch.setattr(wf, "start_instance", boom)
    out = wf.use_local(str(target))
    assert out["instance"] == "v9"


def test_use_local_reports_start_failure(root, monkeypatch):
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wf, "active_instance", lambda: None)
    monkeypatch.setattr(wf, "_latest_instance", lambda: "v1")

    def fail(_name):
        raise RuntimeError("端口被占用")

    monkeypatch.setattr(wf, "start_instance", fail)
    with pytest.raises(SourceError) as exc:
        wf.use_local(str(target))
    assert "端口" in str(exc.value)


def test_open_local_edit_mode_uses_default_app(root, monkeypatch):
    """edit 走默认关联程序；这里只断言命令拼装，不真的去开文件。"""
    target = root / "demo.json"
    target.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(wf.os, "name", "posix")
    monkeypatch.setattr(wf.sys, "platform", "linux")

    assert wf._open_command(target, "edit") == ["xdg-open", str(target)]
    assert wf._open_command(target, "reveal") == ["xdg-open", str(target.parent)]


def test_open_command_windows_reveal_selects_file():
    import os

    if os.name != "nt":
        pytest.skip("只在 Windows 上验证 explorer /select 分支")
    from pathlib import Path

    cmd = wf._open_command(Path("C:/tmp/a.json"), "reveal")
    assert cmd[0] == "explorer"
    assert cmd[1] == "/select,"


def test_open_local_rejects_outside_path(root, tmp_path):
    outside = tmp_path / "x.json"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(SourceError):
        wf.open_local(str(outside), "edit")


# ---------------- 分组落成目录 ----------------

def test_organize_moves_grouped_files_into_folders(root):
    """ComfyUI 侧栏按目录展示，分组只有变成目录它才看得见。"""
    a = root / "a.json"
    a.write_text("{}", encoding="utf-8")
    b = root / "sub" / "b.json"
    b.parent.mkdir()
    b.write_text("{}", encoding="utf-8")
    wf.set_meta(str(a), title="", group="人像")
    wf.set_meta(str(b), title="", group="电商")

    out = wf.organize_groups()

    assert out["moved"] == 2
    assert (root / "人像" / "a.json").is_file()
    assert (root / "电商" / "b.json").is_file()
    # 侧车键必须跟着换，否则自定义名/分组会丢
    assert set(wf.load_meta()) == {"人像/a.json", "电商/b.json"}


def test_organize_skips_files_already_in_place(root):
    target = root / "人像" / "a.json"
    target.parent.mkdir()
    target.write_text("{}", encoding="utf-8")
    wf.set_meta(str(target), title="名字", group="人像")

    assert wf.organize_groups()["moved"] == 0
    assert wf.load_meta()["人像/a.json"]["title"] == "名字"


def test_organize_keeps_ungrouped_files_alone(root):
    loose = root / "loose.json"
    loose.write_text("{}", encoding="utf-8")
    wf.set_meta(str(loose), title="只有名字", group="")

    assert wf.organize_groups()["moved"] == 0
    assert loose.is_file()


def test_organize_does_not_overwrite_on_name_clash(root):
    existing = root / "人像" / "a.json"
    existing.parent.mkdir()
    existing.write_text('{"keep": 1}', encoding="utf-8")
    src = root / "a.json"
    src.write_text('{"new": 1}', encoding="utf-8")
    wf.set_meta(str(src), title="", group="人像")

    out = wf.organize_groups()

    assert out["moved"] == 1
    assert '{"keep": 1}' in existing.read_text(encoding="utf-8")
    assert (root / "人像" / "a-2.json").is_file()


# ---------------- 分组落成目录 ----------------

def test_organize_moves_grouped_files_into_folders(root):
    """ComfyUI 侧栏按目录展示，分组只有变成目录它才看得见。"""
    a = root / "a.json"
    a.write_text("{}", encoding="utf-8")
    b = root / "sub" / "b.json"
    b.parent.mkdir()
    b.write_text("{}", encoding="utf-8")
    wf.set_meta(str(a), title="", group="人像")
    wf.set_meta(str(b), title="", group="电商")

    out = wf.organize_groups()

    assert out["moved"] == 2
    assert (root / "人像" / "a.json").is_file()
    assert (root / "电商" / "b.json").is_file()
    # 侧车键必须跟着换，否则自定义名/分组会丢
    assert set(wf.load_meta()) == {"人像/a.json", "电商/b.json"}


def test_organize_skips_files_already_in_place(root):
    target = root / "人像" / "a.json"
    target.parent.mkdir()
    target.write_text("{}", encoding="utf-8")
    wf.set_meta(str(target), title="名字", group="人像")

    assert wf.organize_groups()["moved"] == 0
    assert wf.load_meta()["人像/a.json"]["title"] == "名字"


def test_organize_keeps_ungrouped_files_alone(root):
    loose = root / "loose.json"
    loose.write_text("{}", encoding="utf-8")
    wf.set_meta(str(loose), title="只有名字", group="")

    assert wf.organize_groups()["moved"] == 0
    assert loose.is_file()


def test_organize_does_not_overwrite_on_name_clash(root):
    existing = root / "人像" / "a.json"
    existing.parent.mkdir()
    existing.write_text('{"keep": 1}', encoding="utf-8")
    src = root / "a.json"
    src.write_text('{"new": 1}', encoding="utf-8")
    wf.set_meta(str(src), title="", group="人像")

    out = wf.organize_groups()

    assert out["moved"] == 1
    assert '{"keep": 1}' in existing.read_text(encoding="utf-8")
    assert (root / "人像" / "a-2.json").is_file()
