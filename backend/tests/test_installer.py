"""M3 安装器（installer）的单元测试。

核心不变量：
1. **torch 必须排在 requirements 之前**——ComfyUI 的 requirements.txt 里含
   `torch` 且无版本约束，反序会让 pip 按 PyPI 版本重装，把 CUDA 版覆盖掉
2. **channel → 索引映射**——映射错了装出来就是 CPU 版
3. **依赖步骤只在基础环境未就绪时出现**——这是"装第二个版本不用重下 2GB"的实现
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.comfy.installer import (
    TORCH_INDEX,
    TORCH_MIRRORS,
    InstallSpec,
    build_steps,
    clean_env,
    make_spec,
    pick_python,
    runtime_url,
)
from app.comfy.models import DeviceReport, DiskInfo, GpuInfo, PythonInfo
from app.comfy.plan import build_plan


# ---------------- 构造 ----------------
def spec(tmp_path: Path, channel: str = "cu130", **kwargs) -> InstallSpec:
    defaults = dict(
        name="v-test",
        workspace=tmp_path / "instances" / "v-test",
        environment=tmp_path / "instances" / ".environment",
        torch_channel=channel,
    )
    defaults.update(kwargs)
    return InstallSpec(**defaults)


def keyed(steps) -> dict[str, object]:
    return {step.key: step for step in steps}


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
        pythons=[PythonInfo(version="3.13.4", path="C:/Python313/python.exe", source="path")],
        disks=[DiskInfo(path="C:/", total_gb=500.0, free_gb=200.0)],
    )
    data.update(overrides)
    return DeviceReport(**data)


# ---------------- 步骤结构 ----------------
def test_steps_cover_full_pipeline(tmp_path) -> None:
    steps = build_steps(spec(tmp_path))
    assert [s.key for s in steps] == [
        "prepare", "runtime", "clone", "models",
        "torch", "requirements", "lock", "verify",
    ]


def test_torch_before_requirements(tmp_path) -> None:
    """顺序错了会被 pip 覆盖成 PyPI 版 torch，CUDA 支持就没了。"""
    keys = [s.key for s in build_steps(spec(tmp_path))]
    assert keys.index("torch") < keys.index("requirements")


def test_environment_ready_skips_deps(tmp_path) -> None:
    """基础环境已装好时，装新版本只克隆代码，不再下载 2GB torch。"""
    s = spec(tmp_path)
    (s.env_site / "torch").mkdir(parents=True)
    keys = [step.key for step in build_steps(s)]
    assert "deps-reuse" in keys
    assert "torch" not in keys and "requirements" not in keys and "lock" not in keys
    assert "clone" in keys and "verify" in keys


def test_shared_environment_paths(tmp_path) -> None:
    """环境放在 instances/.environment，点前缀保证遍历实例时被跳过。"""
    s = spec(tmp_path)
    assert s.environment.name == ".environment"
    assert s.environment.parent.name == "instances"
    assert s.env_site == s.environment / "site-packages"
    assert ".environment" in str(s.env_python)


def test_all_deps_install_into_shared_target(tmp_path) -> None:
    """torch 和 requirements 都必须 --target 到共享目录，不能装进解释器自身。"""
    s = spec(tmp_path)
    steps = keyed(build_steps(s))
    for key in ("torch", "requirements"):
        cmd = steps[key].command
        assert cmd is not None
        assert "--target" in cmd
        assert str(s.env_site) in cmd


def test_requirements_runs_in_comfy_dir(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path)))["requirements"]
    assert step.cwd is not None
    assert str(step.cwd).endswith("ComfyUI")


def test_verify_uses_pythonpath(tmp_path) -> None:
    """不激活 venv，靠 PYTHONPATH 让解释器找到共享包。"""
    step = keyed(build_steps(spec(tmp_path)))["verify"]
    assert step.env_extra.get("PYTHONPATH") == str(spec(tmp_path).env_site)


def test_clone_uses_mirror_first(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path)))["clone"]
    assert step.command is not None
    assert any("cnb.cool" in part for part in step.command)


def test_clone_includes_branch_when_tag_given(tmp_path) -> None:
    plain = keyed(build_steps(spec(tmp_path)))["clone"]
    tagged = keyed(build_steps(spec(tmp_path, tag="v0.3.40")))["clone"]
    assert plain.command is not None and "--branch" not in plain.command
    assert tagged.command is not None and "v0.3.40" in tagged.command


# ---------------- channel → 索引 ----------------
@pytest.mark.parametrize(
    "channel,expected",
    [
        ("cu130", "https://mirror.sjtu.edu.cn/pytorch-wheels/cu130/"),
        ("cu126", "https://mirror.sjtu.edu.cn/pytorch-wheels/cu126/"),
        ("rocm7.2", "https://download.pytorch.org/whl/rocm7.2"),
        ("xpu", "https://download.pytorch.org/whl/xpu"),
        ("cpu", "https://download.pytorch.org/whl/cpu"),
    ],
)
def test_torch_uses_channel_index(tmp_path, channel: str, expected: str) -> None:
    step = keyed(build_steps(spec(tmp_path, channel)))["torch"]
    assert step.command is not None
    assert "--index-url" in step.command
    assert step.command[step.command.index("--index-url") + 1] == expected


def test_cu130_prefers_domestic_mirror(tmp_path) -> None:
    """cu130 走交大镜像——官方源在国内只有 1MB/s 左右。"""
    assert TORCH_MIRRORS["cu130"].startswith("https://mirror.sjtu.edu.cn")
    step = keyed(build_steps(spec(tmp_path, "cu130")))["torch"]
    assert step.command is not None
    assert "mirror.sjtu.edu.cn" in step.command[step.command.index("--index-url") + 1]


def test_mps_has_no_custom_index(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path, "mps")))["torch"]
    assert step.command is not None
    assert "--index-url" not in step.command


def test_directml_installs_special_package(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path, "directml")))["torch"]
    assert step.command is not None
    assert "torch-directml" in step.command
    assert "torchvision" not in step.command


def test_unknown_channel_raises() -> None:
    with pytest.raises(KeyError):
        assert TORCH_INDEX["cuda999"] is None


# ---------------- 运行时包 ----------------
def test_runtime_url_matches_platform() -> None:
    target = runtime_url()
    assert target is not None
    url, filename = target
    assert url.startswith("https://")
    assert filename.endswith(".tar.gz")
    assert "cpython-3.13.18" in filename


def test_runtime_step_notes_download_when_missing(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path)))["runtime"]
    assert "下载" in step.detail


def test_runtime_step_short_circuits_when_ready(tmp_path) -> None:
    s = spec(tmp_path)
    s.env_python.parent.mkdir(parents=True)
    s.env_python.write_bytes(b"")
    step = keyed(build_steps(s))["runtime"]
    assert "已就绪" in step.detail


# ---------------- 规格推导 ----------------
def test_make_spec_uses_shared_environment() -> None:
    report = nvidia_report()
    plan = build_plan(report)
    built = make_spec(report, plan, name="v1")
    assert built.name == "v1"
    assert built.environment.name == ".environment"
    assert built.workspace.name == "v1"
    assert built.torch_channel == plan.torch_channel


def test_make_spec_rejects_blocked_plan() -> None:
    report = nvidia_report(disks=[DiskInfo(path="C:/", total_gb=50.0, free_gb=3.0)])
    plan = build_plan(report)
    assert plan.tier == "blocked"
    with pytest.raises(ValueError):
        make_spec(report, plan)


def test_make_spec_allows_missing_system_python() -> None:
    """系统没有可用 Python 不再阻塞安装——内置运行时会补上。"""
    report = nvidia_report(pythons=[PythonInfo(version="3.9.6", path="/usr/bin/python3", source="system")])
    plan = build_plan(report)
    assert plan.python_available is False
    built = make_spec(report, plan)
    assert built.runtime_version


def test_pick_python_prefers_exact_version() -> None:
    report = nvidia_report()
    plan = build_plan(report)
    chosen = pick_python(report, plan)
    assert chosen is not None and chosen.version.startswith("3.13")


def test_pick_python_skips_untrusted() -> None:
    report = nvidia_report()
    report.pythons = [
        PythonInfo(version="3.13.14", path="C:/toolchain/python.exe", source="path", trusted=False),
        PythonInfo(version="3.12.7", path="C:/Py312/python.exe", source="path", trusted=True),
    ]
    plan = build_plan(report)
    chosen = pick_python(report, plan)
    assert chosen is not None and chosen.version.startswith("3.12")


# ---------------- 环境隔离 ----------------
def test_clean_env_drops_venv_vars(monkeypatch) -> None:
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
    from app.comfy.installer import run_install

    s = spec(tmp_path)
    events: list[dict] = []
    result = run_install(s, events.append, dry_run=True)
    assert result.ok
    assert len([e for e in events if e["type"] == "step_plan"]) == 8
    assert not s.workspace.exists()
    assert not s.environment.exists()


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
    from app.comfy import api

    api._jobs.clear()
    api._jobs["done1"] = _fake_job("done1", "done", "2026-11-06T15:00:00")
    api._jobs["run2"] = _fake_job("run2", "running", "2026-11-06T14:00:00")
    picked = api.get_current_install()["job"]
    assert picked is not None and picked["id"] == "run2"
    assert picked["steps"] and picked["spec"]


def test_current_install_falls_back_to_latest() -> None:
    from app.comfy import api

    api._jobs.clear()
    api._jobs["a"] = _fake_job("a", "failed", "2026-11-06T14:00:00")
    api._jobs["b"] = _fake_job("b", "done", "2026-11-06T15:00:00")
    picked = api.get_current_install()["job"]
    assert picked is not None and picked["id"] == "b"
