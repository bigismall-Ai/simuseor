"""M3 安装器（installer）的单元测试。

重点验证两件事：
1. 步骤顺序——torch 必须排在 requirements 之前，否则 pip 会按 PyPI 版本
   重装 torch，把刚装好的 CUDA 版覆盖掉
2. channel → index URL 的映射——plan 只给语义通道，映射错了装出来的
   就是 CPU 版
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.comfy.installer import (
    TORCH_INDEX,
    InstallSpec,
    build_steps,
    clean_env,
    make_spec,
    pick_python,
)
from app.comfy.models import DeviceReport, DiskInfo, GpuInfo, PythonInfo
from app.comfy.plan import build_plan


# ---------------- 构造 ----------------
def spec(channel: str = "cu130", **kwargs) -> InstallSpec:
    defaults = dict(
        name="v-test",
        workspace=Path("C:/comfy/instances/v-test"),
        python_exe="C:/Python313/python.exe",
        python_version="3.13.0",
        torch_channel=channel,
    )
    defaults.update(kwargs)
    return InstallSpec(**defaults)


def keyed(channel: str = "cu130") -> dict[str, object]:
    return {step.key: step for step in build_steps(spec(channel))}


def nvidia_report(**overrides) -> DeviceReport:
    gpu = GpuInfo(
        vendor="nvidia",
        name="NVIDIA GeForce RTX 4080 SUPER",
        driver_version="610.88",
        vram_mb=16376,
        compute_cap="8.9",
        source="nvidia-smi",
        is_discrete=True,
    )
    data = dict(
        os="windows",
        os_version="11 (26100)",
        os_build="26100",
        arch="x86_64",
        gpus=[gpu],
        primary_gpu=gpu,
        pythons=[
            PythonInfo(version="3.13.4", path="C:/Python313/python.exe", source="path"),
            PythonInfo(version="3.9.20", path="C:/Python39/python.exe", source="path"),
        ],
        disks=[DiskInfo(path="C:/", total_gb=500.0, free_gb=200.0)],
    )
    data.update(overrides)
    return DeviceReport(**data)


# ---------------- 步骤结构 ----------------
def test_steps_cover_full_pipeline() -> None:
    steps = build_steps(spec())
    assert [s.key for s in steps] == ["prepare", "clone", "models", "venv", "pip", "torch", "requirements", "verify"]


def test_torch_before_requirements() -> None:
    """顺序错了会被 pip 覆盖成 PyPI 版 torch，CUDA 支持就没了。"""
    keys = [s.key for s in build_steps(spec())]
    assert keys.index("torch") < keys.index("requirements")


def test_requirements_runs_in_comfy_dir() -> None:
    step = keyed()["requirements"]
    assert step.cwd is not None
    assert str(step.cwd).endswith("ComfyUI")


def test_clone_uses_mirror_first() -> None:
    step = keyed()["clone"]
    assert step.command is not None
    assert any("cnb.cool" in part for part in step.command)


def test_clone_includes_branch_when_tag_given() -> None:
    step = keyed("cu130")["clone"]
    step_tagged = build_steps(spec(tag="v0.3.40"))[1]
    assert step.command is not None and "--branch" not in step.command
    assert step_tagged.command is not None and "--branch" in step_tagged.command
    assert "v0.3.40" in step_tagged.command


# ---------------- channel → index ----------------
@pytest.mark.parametrize(
    "channel,expected",
    [
        ("cu130", "https://download.pytorch.org/whl/cu130"),
        ("cu126", "https://download.pytorch.org/whl/cu126"),
        ("rocm7.2", "https://download.pytorch.org/whl/rocm7.2"),
        ("xpu", "https://download.pytorch.org/whl/xpu"),
        ("cpu", "https://download.pytorch.org/whl/cpu"),
    ],
)
def test_torch_uses_channel_index(channel: str, expected: str) -> None:
    step = keyed(channel)["torch"]
    assert step.command is not None
    assert "--index-url" in step.command
    assert step.command[step.command.index("--index-url") + 1] == expected


def test_mps_has_no_custom_index() -> None:
    """Apple 芯片用 PyPI 默认轮子，指定 index 反而装不上。"""
    step = keyed("mps")["torch"]
    assert step.command is not None
    assert "--index-url" not in step.command


def test_directml_installs_special_package() -> None:
    step = keyed("directml")["torch"]
    assert step.command is not None
    assert "torch-directml" in step.command
    assert "torchvision" not in step.command


def test_unknown_channel_raises() -> None:
    with pytest.raises(KeyError):
        # 未登记的后端不能静默退化成 PyPI 默认安装
        assert TORCH_INDEX["cuda999"] is None


# ---------------- venv 路径 ----------------
def test_venv_python_path_matches_platform() -> None:
    s = spec()
    if os.name == "nt":
        assert s.venv_python.endswith("Scripts\\python.exe") or s.venv_python.endswith("Scripts/python.exe")
    else:
        assert s.venv_python.endswith("bin/python")


# ---------------- 规格推导 ----------------
def test_make_spec_uses_plan_channel() -> None:
    report = nvidia_report()
    plan = build_plan(report)
    built = make_spec(report, plan, name="v1")
    assert built.torch_channel == plan.torch_channel
    assert built.name == "v1"
    assert built.comfy_dir.name == "ComfyUI"


def test_make_spec_rejects_blocked_plan() -> None:
    report = nvidia_report(disks=[DiskInfo(path="C:/", total_gb=50.0, free_gb=3.0)])
    plan = build_plan(report)
    assert plan.tier == "blocked"
    with pytest.raises(ValueError):
        make_spec(report, plan)


def test_make_spec_rejects_missing_python() -> None:
    report = nvidia_report(pythons=[PythonInfo(version="3.9.6", path="/usr/bin/python3", source="system")])
    plan = build_plan(report)
    with pytest.raises(ValueError):
        make_spec(report, plan)


def test_pick_python_prefers_exact_version() -> None:
    report = nvidia_report()
    plan = build_plan(report)
    chosen = pick_python(report, plan)
    assert chosen is not None
    assert chosen.version.startswith("3.13")


def test_pick_python_falls_back_not_newer() -> None:
    """方案要 3.13 但只有 3.12 和 3.14 时，选 3.12 而不是 3.14。"""
    report = nvidia_report(
        pythons=[
            PythonInfo(version="3.14.0", path="C:/Py314/python.exe", source="path"),
            PythonInfo(version="3.12.7", path="C:/Py312/python.exe", source="path"),
        ]
    )
    plan = build_plan(report)
    chosen = pick_python(report, plan)
    assert chosen is not None
    assert chosen.version.startswith("3.12")


# ---------------- 环境隔离 ----------------
def test_clean_env_drops_venv_vars(monkeypatch) -> None:
    """不清这些变量，pip 会装到后端自己的 venv 里。"""
    monkeypatch.setenv("VIRTUAL_ENV", "C:/backend/.venv")
    monkeypatch.setenv("PYTHONPATH", "C:/somewhere")
    monkeypatch.setenv("PYTHONHOME", "C:/python")
    env = clean_env()
    assert "VIRTUAL_ENV" not in env
    assert "PYTHONPATH" not in env
    assert "PYTHONHOME" not in env
    assert env.get("PYTHONUNBUFFERED") == "1"


# ---------------- 预演 ----------------
def test_dry_run_creates_no_dirs(tmp_path) -> None:
    """dry_run 只产事件，不碰磁盘。"""
    from app.comfy.installer import run_install

    workspace = tmp_path / "v-dry"
    s = spec(workspace=workspace)
    events: list[dict] = []
    result = run_install(s, events.append, dry_run=True)
    assert result.ok
    assert len([e for e in events if e["type"] == "step_plan"]) == 8
    assert not (workspace / "ComfyUI").exists()


# ---------------- 刷新后接管（/install/current） ----------------
def _fake_job(job_id: str, status: str, started: str) -> dict:
    return {
        "id": job_id,
        "status": status,
        "name": f"v-{job_id}",
        "workspace": f"C:/comfy/instances/{job_id}",
        "spec": {"name": f"v-{job_id}", "workspace": "", "comfy_dir": "", "venv_dir": "", "python": "3.13", "channel": "cu130"},
        "steps": [{"key": "prepare", "title": "准备工作目录", "detail": "", "command": None, "estimated_gb": 0.0}],
        "events": [],
        "result": None,
        "started_at": started,
    }


def test_current_install_none_when_empty() -> None:
    from app.comfy import api

    api._jobs.clear()
    assert api.get_current_install()["job"] is None


def test_current_install_prefers_running() -> None:
    """有正在跑的任务时，刷新页面必须接管它，而不是最近完成的那个。"""
    from app.comfy import api

    api._jobs.clear()
    api._jobs["done1"] = _fake_job("done1", "done", "2026-11-06T15:00:00")
    api._jobs["run2"] = _fake_job("run2", "running", "2026-11-06T14:00:00")
    picked = api.get_current_install()["job"]
    assert picked is not None and picked["id"] == "run2"
    # 接管所需的字段必须齐全
    assert picked["steps"] and picked["spec"]


def test_current_install_falls_back_to_latest() -> None:
    """没有运行中的任务时返回最近一次，让用户还能看到失败原因。"""
    from app.comfy import api

    api._jobs.clear()
    api._jobs["a"] = _fake_job("a", "failed", "2026-11-06T14:00:00")
    api._jobs["b"] = _fake_job("b", "done", "2026-11-06T15:00:00")
    picked = api.get_current_install()["job"]
    assert picked is not None and picked["id"] == "b"
