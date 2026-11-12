"""M3 安装器（installer）的单元测试。

核心不变量：
1. **torch 必须排在 requirements 之前**——ComfyUI 的 requirements.txt 里含
   `torch` 且无版本约束，反序会让 pip 按 PyPI 版本重装，把 CUDA 版覆盖掉
2. **channel → 索引映射**——映射错了装出来就是 CPU 版
3. **依赖步骤只在基础环境未就绪时出现**——这是"装第二个版本不用重下 2GB"的实现
"""
from __future__ import annotations

import json
import os
import time
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.comfy.installer import (
    TORCH_INDEX,
    TORCH_MIRRORS,
    InstallSpec,
    build_steps,
    clean_env,
    list_versions,
    make_spec,
    parse_tags,
    pick_python,
    runtime_url,
)
from app.comfy.models import DeviceReport, DiskInfo, GpuInfo, PythonInfo, RuntimeStatus
from app.comfy.plan import build_plan


# ---------------- 构造 ----------------
def spec(tmp_path: Path, channel: str = "cu130", **kwargs) -> InstallSpec:
    defaults = dict(
        name="v-test",
        workspace=tmp_path / "comfy" / "v-test",
        environment=tmp_path / "comfy" / ".environment",
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
    """环境放在 comfy/.environment，与实例平级；点前缀保证遍历时被跳过。"""
    s = spec(tmp_path)
    assert s.environment.name == ".environment"
    assert s.environment.parent.name == "comfy"
    assert s.environment.parent == s.workspace.parent
    assert s.env_site == s.environment / "site-packages"
    assert ".environment" in str(s.env_python)


def test_all_deps_install_into_shared_target(tmp_path) -> None:
    """torch 必须 --target 到共享目录；requirements 交给并发安装器写同一个目录。"""
    s = spec(tmp_path)
    steps = keyed(build_steps(s))
    torch_cmd = steps["torch"].command
    assert torch_cmd is not None
    assert "--target" in torch_cmd and str(s.env_site) in torch_cmd
    # requirements 不再用单条 pip 命令：pip 的 --target 隐含 --ignore-installed，
    # 会把已装好的包（包括加速版 torch）整体重装一遍
    assert steps["requirements"].command is None


def test_requirements_step_uses_parallel_installer(tmp_path) -> None:
    step = keyed(build_steps(spec(tmp_path)))["requirements"]
    assert step.key == "requirements"
    assert "多线程" in step.detail


def test_filtered_requirements_drop_torch(tmp_path) -> None:
    """requirements.txt 里的 torch 系列必须剔除，只留其它包。"""
    from app.comfy.installer import write_filtered_requirements

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text(
        "# 注释\nTorch\ntorchvision>=0.20\ntorchaudio\nnumpy>=1.0\n--extra-index-url https://x\n",
        encoding="utf-8",
    )
    kept = write_filtered_requirements(s).read_text(encoding="utf-8").splitlines()
    assert kept == ["# 注释", "numpy>=1.0", "--extra-index-url https://x"]


def test_run_requirements_skips_when_nothing_missing(tmp_path, monkeypatch) -> None:
    from app.comfy import installer

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("numpy\n", encoding="utf-8")
    # 共享环境里已有 numpy（dist-info 存在）+ 上次装完的指纹标记 → 直接跳过
    (s.env_site / "numpy-2.5.4.dist-info").mkdir(parents=True)
    installer.write_filtered_requirements(s)
    marker, fingerprint = installer._requirements_marker(s)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(fingerprint, encoding="utf-8")
    monkeypatch.setattr(installer, "resolve_wheels", lambda *a, **k: pytest.fail("不该查索引"))
    ok, message = installer.run_requirements(s, lambda _e: None, lambda _m: None)
    assert ok and "已齐全" in message


def test_run_requirements_installs_missing_wheels(tmp_path, monkeypatch) -> None:
    """缺包时走「查索引 → 并发下载 → --no-deps 离线安装」，并且不碰 torch。"""
    from app.comfy import installer

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("torch\nhumanize>=4\n", encoding="utf-8")

    wheel_dir = s.environment / "cache" / "wheels"

    def fake_resolve(_spec, specs, _log):
        assert specs == ["humanize>=4"], "torch 必须被过滤掉"
        return [{"name": "humanize", "version": "4.16.0", "url": "https://x/humanize-4.16.0-py3-none-any.whl",
                 "requirement": "humanize>=4"}]

    def fake_download(items, dest, send, log, key="requirements", **_kw):
        dest.mkdir(parents=True, exist_ok=True)
        out = []
        for item in items:
            path = dest / "humanize-4.16.0-py3-none-any.whl"
            path.write_bytes(b"PK\x05\x06" + b"\x00" * 18)  # 空 zip，读 METADATA 返回空
            item["local_path"] = str(path)
            out.append(path)
        return out, []

    monkeypatch.setattr(installer, "resolve_wheels", fake_resolve)
    monkeypatch.setattr(installer, "download_many", fake_download)

    seen: dict[str, list[str]] = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        from types import SimpleNamespace
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(installer.subprocess, "run", fake_run)
    ok, message = installer.run_requirements(s, lambda _e: None, lambda _m: None)
    assert ok, message
    cmd = seen["cmd"]
    assert "--no-deps" in cmd and "--no-index" in cmd and "--target" in cmd
    assert all("torch" not in str(part) for part in cmd if part.endswith(".whl"))


def test_run_requirements_prunes_cache_keeping_used_wheels(tmp_path, monkeypatch) -> None:
    """装完顺手压缓存，但本次用过的轮子必须被保护起来。"""
    from app.comfy import installer

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("humanize>=4\n", encoding="utf-8")

    def fake_resolve(_spec, _specs, _log):
        return [{"name": "humanize", "version": "4.16.0",
                 "url": "https://x/humanize-4.16.0-py3-none-any.whl",
                 "requirement": "humanize>=4"}]

    def fake_download(items, dest, send, log, key="requirements", **_kw):
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / "humanize-4.16.0-py3-none-any.whl"
        path.write_bytes(b"PK\x05\x06" + b"\x00" * 18)
        items[0]["local_path"] = str(path)
        return [path], []

    seen: dict = {}

    def fake_prune(_wheel_dir, *, keep=None, log=None):
        seen["keep"] = set(keep or ())
        return {"removed": 0, "freed": 0, "size": 0, "limit": 0}

    monkeypatch.setattr(installer, "resolve_wheels", fake_resolve)
    monkeypatch.setattr(installer, "download_many", fake_download)
    monkeypatch.setattr(installer, "prune_cache", fake_prune)
    monkeypatch.setattr(
        installer.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout="", stderr=""),
    )

    ok, message = installer.run_requirements(s, lambda _e: None, lambda _m: None)

    assert ok, message
    assert seen["keep"] == {"humanize-4.16.0-py3-none-any.whl"}


def test_download_many_keeps_step_key_in_progress(tmp_path, monkeypatch) -> None:
    """进度事件的 key 必须是步骤名，不能被去重用的 wheel 文件名覆盖。"""
    from app.comfy import installer

    class FakeResponse:
        status_code = 200
        headers = {"content-length": "1"}

        def iter_bytes(self, _size):
            yield b"x"

    class FakeStream:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return FakeResponse()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(installer.httpx, "stream", lambda *args, **kwargs: FakeStream())
    # 预取大小会真的发 HEAD，测试里别碰网络
    monkeypatch.setattr(installer, "_remote_size", lambda *_a, **_k: 1)

    items = [
        {"name": "a", "url": "https://x/a-1.0-py3-none-any.whl", "requirement": "a"},
        {"name": "b", "url": "https://x/b-1.0-py3-none-any.whl", "requirement": "b"},
    ]
    events: list[dict] = []
    installer.download_many(items, tmp_path, events.append, lambda _m: None, key="requirements")

    keys = {event.get("key") for event in events if event.get("type") == "progress"}
    assert keys == {"requirements"}


def test_download_progress_never_jumps_to_full_on_cache_hit(tmp_path, monkeypatch) -> None:
    """缓存命中不能让总进度一上来就满格。

    之前分母是「已启动任务的累计大小」：第一个命中缓存的线程立刻 done == size，
    percent=100，总进度被 max() 永久钉死在依赖步末端 —— 就是那个「上手 96%」。
    """
    from app.comfy import installer

    items = []
    for name in ("a-1.0-py3-none-any.whl", "b-1.0-py3-none-any.whl"):
        (tmp_path / name).write_bytes(b"PK\x05\x06" + b"\x00" * 18)  # 合法空 zip
        items.append({"name": name[0], "url": f"https://x/{name}"})
    # 第三个只有网络才有，模拟慢下载
    items.append({"name": "c", "url": "https://x/c-1.0-py3-none-any.whl"})

    class SlowResponse:
        status_code = 200
        headers = {"content-length": "4000"}

        def iter_bytes(self, _size):
            for _ in range(4):
                time.sleep(0.25)
                yield b"x" * 1000

    class SlowStream:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return SlowResponse()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(installer.httpx, "stream", lambda *args, **kwargs: SlowStream())
    monkeypatch.setattr(installer, "_remote_size", lambda *_a, **_k: 4000)

    events: list[dict] = []
    installer.download_many(items, tmp_path, events.append, lambda _m: None)
    percents = [e["percent"] for e in events if e.get("type") == "progress"]

    assert percents
    # 未全部落盘前不许到区间上界（90），中间态应该真的在中间
    assert max(percents) <= 90, percents
    assert any(0 < p < 90 for p in percents), percents


def test_run_requirements_succeeds_when_everything_already_installed(tmp_path, monkeypatch) -> None:
    """依赖全在共享环境里时不能再落到普通 pip。

    pip 的 --target 隐含 --ignore-installed，全量重装既慢又会因为镜像缺
    某个传递依赖（comfyui-workflow-templates-media-assets-02）直接失败。
    """
    from app.comfy import installer

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("numpy>=1.25\nhumanize\n", encoding="utf-8")
    for dist in ("numpy-2.5.4.dist-info", "humanize-4.16.0.dist-info"):
        (s.env_site / dist).mkdir(parents=True)

    monkeypatch.setattr(installer, "resolve_wheels", lambda *a, **k: pytest.fail("不该查索引"))
    monkeypatch.setattr(installer, "_exec", lambda *a, **k: pytest.fail("不该走普通 pip"))
    ok, message = installer.run_requirements(s, lambda _e: None, lambda _m: None)
    assert ok and "已齐全" in message
    # 记下指纹，第二次直接命中，不再扫索引
    # 主 ComfyUI 依赖的 cache_key 是 "comfy"，指纹文件名跟着带后缀
    marker, fingerprint = installer._requirements_marker(s, name="requirements.comfy.done")
    assert marker.is_file() and marker.read_text(encoding="utf-8").strip() == fingerprint


def test_run_requirements_only_retries_missing_packages(tmp_path, monkeypatch) -> None:
    """索引里查不到的包才交给普通 pip，且只装这几个 + --no-deps。"""
    from app.comfy import installer

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("numpy\nghost-pkg\n", encoding="utf-8")
    (s.env_site / "numpy-2.5.4.dist-info").mkdir(parents=True)
    monkeypatch.setattr(installer, "resolve_wheels", lambda *a, **k: [])
    seen: dict[str, list[str]] = {}

    def fake_exec(step, send, log):
        seen["cmd"] = step.command or []
        return True, "ok"

    monkeypatch.setattr(installer, "_exec", fake_exec)
    ok, _ = installer.run_requirements(s, lambda _e: None, lambda _m: None)
    assert ok
    cmd = seen["cmd"]
    assert "--target" in cmd and str(s.env_site) in cmd
    assert "--no-deps" in cmd
    # 只补真正缺的那个包，别把整个 requirements 再解析一遍
    assert "ghost-pkg" in cmd
    assert not any("requirements.comfy.txt" in part for part in cmd)
    assert "numpy" not in cmd


def test_installed_versions_reads_dist_info(tmp_path) -> None:
    from app.comfy.installer import installed_versions

    site = tmp_path / "site"
    (site / "torch-2.14.1+cu130.dist-info").mkdir(parents=True)
    (site / "comfyui_workflow_templates-0.11.105.dist-info").mkdir()
    versions = installed_versions(site)
    assert versions["torch"] == "2.14.1+cu130"
    assert versions["comfyui-workflow-templates"] == "0.11.105"


def test_wheel_compatibility_filters_platform() -> None:
    from app.comfy.installer import _wheel_compatible

    assert _wheel_compatible("numpy-2.5.4-cp313-cp313-win_amd64.whl", "cp313")
    assert _wheel_compatible("rich-15.0.0-py3-none-any.whl", "cp313")
    # 别的 Python 版本、别的平台都要滤掉
    assert not _wheel_compatible("numpy-2.5.4-cp312-cp312-win_amd64.whl", "cp313")
    assert not _wheel_compatible("numpy-2.5.4-cp313-cp313-manylinux_2_17_x86_64.whl", "cp313")
    assert not _wheel_compatible("numpy-2.5.4.tar.gz", "cp313")


def test_pick_wheel_respects_specifier() -> None:
    from app.comfy.installer import _pick_wheel

    candidates = [
        {"name": "x", "version": "2.0.0", "url": "u2"},
        {"name": "x", "version": "1.5.0", "url": "u15"},
        {"name": "x", "version": "1.0.0", "url": "u1"},
    ]
    assert _pick_wheel(candidates, "x<2", "cp313")["version"] == "1.5.0"
    assert _pick_wheel(candidates, "x", "cp313")["version"] == "2.0.0"
    assert _pick_wheel([], "x", "cp313") is None


def test_pick_wheel_avoids_free_threaded_abi() -> None:
    """cp313t 是自由线程 ABI，普通 CPython 装不上，必须跳过。"""
    from app.comfy.installer import _pick_wheel, _wheel_compatible

    urls = [
        "https://x/psutil-7.2.2-cp313-cp313t-win_amd64.whl",
        "https://x/psutil-7.2.2-cp313-cp313-win_amd64.whl",
    ]
    assert not _wheel_compatible("psutil-7.2.2-cp313-cp313t-win_amd64.whl", "cp313")
    candidates = [
        {"name": "psutil", "version": "7.2.2", "url": url}
        for url in urls
        if _wheel_compatible(url.rsplit("/", 1)[-1], "cp313")
    ]
    assert _pick_wheel(candidates, "psutil", "cp313")["url"] == urls[1]


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


# ---------------- 可安装版本 ----------------
def test_parse_tags_sorts_versions_and_prefers_stable() -> None:
    text = "\n".join(
        [
            "aaa\trefs/tags/v0.3.9",
            "bbb\trefs/tags/v0.3.40",
            "ccc\trefs/tags/v0.4.0-rc1",
            "ddd\trefs/tags/nightly",
            "eee\trefs/tags/v0.2.0",
        ]
    )
    tags = [item["tag"] for item in parse_tags(text)]
    # 语义排序（v0.3.40 在 v0.3.9 之前），稳定版在前，非版本号 tag 丢弃
    assert tags == ["v0.3.40", "v0.3.9", "v0.2.0", "v0.4.0-rc1"]


def test_parse_tags_respects_limit() -> None:
    text = "\n".join(f"{index:040d}\trefs/tags/v0.3.{index}" for index in range(40))
    assert len(parse_tags(text, limit=5)) == 5
    assert parse_tags(text, limit=5)[0]["tag"] == "v0.3.39"


def test_list_versions_hits_cache_on_second_call(monkeypatch) -> None:
    from app.comfy import installer

    calls: list[list[str]] = []

    def fake_run(cmd, **_kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="abc123\trefs/tags/v1.2.3\n", stderr="")

    monkeypatch.setattr(installer.subprocess, "run", fake_run)
    monkeypatch.setattr(installer, "_version_cache", {"at": 0.0, "payload": None})

    first = list_versions()
    assert [item["tag"] for item in first["tags"]] == ["v1.2.3"]
    assert first["cached"] is False

    second = list_versions()
    assert second["cached"] is True
    assert len(calls) == 1


def test_list_versions_degrades_to_empty(monkeypatch) -> None:
    """镜像和 GitHub 都失败时返回空列表，前端退回「最新版」，不能让安装点不动。"""
    from app.comfy import installer

    monkeypatch.setattr(
        installer.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="boom")
    )
    monkeypatch.setattr(installer, "_version_cache", {"at": 0.0, "payload": None})

    result = list_versions()
    assert result["tags"] == []
    assert result["source"] == ""
    # 失败不写缓存，下次还要再试
    assert installer._version_cache["payload"] is None


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


def test_make_spec_names_instance_after_tag(monkeypatch, tmp_path) -> None:
    """选定版本时目录就叫那个版本；同名已存在则加序号，绝不覆盖已有实例。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "COMFY_DIR", tmp_path)
    report = nvidia_report()
    plan = build_plan(report)

    built = make_spec(report, plan, tag="v0.3.40")
    assert built.name == "v0.3.40"
    assert built.workspace == tmp_path / "v0.3.40"
    assert built.tag == "v0.3.40"

    built.workspace.mkdir()
    again = make_spec(report, plan, tag="v0.3.40")
    assert again.name == "v0.3.40-2"


def test_make_spec_rejects_invalid_tag(monkeypatch, tmp_path) -> None:
    """tag 会拼进 git 命令行，非法字符必须挡在 400 之前。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "COMFY_DIR", tmp_path)
    report = nvidia_report()
    plan = build_plan(report)
    for bad in ("v1.0; rm -rf /", "../../etc", "v1 0", ""):
        if bad == "":
            continue
        with pytest.raises(ValueError):
            make_spec(report, plan, tag=bad)


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
def test_dry_run_creates_no_dirs(tmp_path, monkeypatch) -> None:
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    s = spec(tmp_path)
    events: list[dict] = []
    result = installer.run_install(s, events.append, dry_run=True)
    assert result.ok
    assert len([e for e in events if e["type"] == "step_plan"]) == 8
    assert not s.workspace.exists()
    assert not s.environment.exists()


# ---------------- 安装收尾：日志关闭顺序 / 实例登记 ----------------
def test_successful_install_writes_final_log_before_closing(tmp_path, monkeypatch) -> None:
    """回归：收尾日志曾写在 log_file.close() 之后，装完了却报 I/O 错误。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    monkeypatch.setattr(installer, "build_steps", lambda _spec, _kind: [])
    s = spec(tmp_path)
    s.workspace.mkdir(parents=True)
    s.comfy_dir.mkdir(parents=True)
    (s.comfy_dir / "comfyui_version.py").write_text('__version__ = "0.44.0"\n', encoding="utf-8")

    events: list[dict] = []
    result = installer.run_install(s, events.append)

    assert result.ok and result.instance is not None
    assert result.instance.version == "0.44.0"
    assert "安装完成" in (tmp_path / "comfy-v-test.log").read_text(encoding="utf-8")
    assert any(e["type"] == "log" and "安装完成" in (e.get("line") or "") for e in events)

    # probe 只认 instance.json，装完不写它界面里就看不到新实例
    meta = json.loads((s.workspace / "instance.json").read_text(encoding="utf-8"))
    assert meta["version"] == "0.44.0"
    assert meta["python"] == s.runtime_version
    assert meta["torch_channel"] == "cu130"


def test_failed_step_returns_failure_without_io_error(tmp_path, monkeypatch) -> None:
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    failing = installer.Step(key="boom", title="失败步骤", detail="", command=None)
    monkeypatch.setattr(installer, "build_steps", lambda _spec, _kind: [failing])
    monkeypatch.setattr(installer, "_run_step", lambda *args: (False, "模拟失败"))

    result = installer.run_install(spec(tmp_path), [])

    assert not result.ok
    assert result.message == "模拟失败"
    assert not (tmp_path / "comfy" / "v-test" / "instance.json").exists()


# ---------------- 总进度 ----------------
def test_overall_progress_weighs_steps_by_cost(tmp_path) -> None:
    """torch（下 2GB）必须比「建个目录」占更多进度，不能一步一格平均分。"""
    from app.comfy import installer

    steps = installer.build_steps(spec(tmp_path), kind="environment")
    weights = {step.key: step.expected_seconds for step in steps}
    assert weights["torch"] > weights["prepare"] * 10
    assert weights["torch"] > weights["verify"] * 10


def test_overall_progress_is_monotonic(tmp_path, monkeypatch) -> None:
    """总进度只能涨：轮询乱序、百分比抖动都不能让数字往回跳。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    steps = [
        installer.Step(key="a", title="A", detail="", expected_seconds=1.0),
        installer.Step(key="b", title="B", detail="", expected_seconds=9.0),
    ]
    monkeypatch.setattr(installer, "build_steps", lambda _spec, _kind: steps)

    def fake_step(step, _spec, send, _log):
        if step.key == "a":
            send({"type": "progress", "key": "a", "phase": "download", "percent": 100})
            send({"type": "progress", "key": "a", "phase": "download", "percent": 40})
            return True, "ok"
        # 解压 / pip 解析这类拿不到真实百分比的阶段：percent 保持 -1
        for _ in range(3):
            send({"type": "progress", "key": "b", "phase": "unpack", "percent": -1})
        send({"type": "progress", "key": "b", "phase": "download", "percent": 50})
        return True, "ok"

    monkeypatch.setattr(installer, "_run_step", fake_step)

    events: list[dict] = []
    s = spec(tmp_path)
    s.workspace.mkdir(parents=True)
    s.comfy_dir.mkdir(parents=True)
    result = installer.run_install(s, events.append)
    assert result.ok

    values = [e["overall"] for e in events if "overall" in e]
    assert values == sorted(values), values
    assert values[-1] == 100
    # a 权重 1/10：a 走完时总进度刚到 10%，之后才是 b 的 10→100
    assert values[0] == 0
    assert any(9 <= v <= 11 for v in values)
    assert all(0 <= v <= 100 for v in values)


def test_indeterminate_step_still_moves_but_capped(monkeypatch) -> None:
    """拿不到百分比的步骤靠时间估算往前挪，但最多到 92%，不假装快完成。"""
    from app.comfy import installer

    overall = installer._Overall(
        [installer.Step(key="big", title="Big", detail="", expected_seconds=10.0)]
    )
    overall.start("big")
    assert overall.advance(-1) == 0
    # 把开始时间人为提前到远超预计耗时
    overall.started -= 1000.0  # 远超该步预计耗时
    assert installer.INDETERMINATE_CAP - 1 < overall.advance(-1) <= installer.INDETERMINATE_CAP


def test_failed_step_does_not_fill_overall(tmp_path, monkeypatch) -> None:
    """失败步骤不能因为发过 step_done 就被算成 100%。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    steps = [
        installer.Step(key="a", title="A", detail="", expected_seconds=1.0),
        installer.Step(key="b", title="B", detail="", expected_seconds=1.0),
    ]
    monkeypatch.setattr(installer, "build_steps", lambda _spec, _kind: steps)
    monkeypatch.setattr(
        installer, "_run_step",
        lambda step, *_a: (True, "ok") if step.key == "a" else (False, "失败了"),
    )

    events: list[dict] = []
    result = installer.run_install(spec(tmp_path), events.append)
    assert not result.ok
    overall = [e["overall"] for e in events if "overall" in e]
    assert overall[-1] < 60, overall  # 停在第一步之后，不是 100


# ---------------- 刷新后接管（/install/current） ----------------
def _fake_job(job_id: str, status: str, started: str) -> dict:
    return {
        "id": job_id,
        "status": status,
        "name": f"v-{job_id}",
        "workspace": f"C:/comfy/{job_id}",
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


# ---------------- 实时进度事件（安装弹层左栏的数据源） ----------------
def test_to_bytes_parses_pip_sizes() -> None:
    from app.comfy.installer import _to_bytes

    assert _to_bytes("2.4 GB") == 2_400_000_000
    assert _to_bytes("850 kB") == 850_000
    assert _to_bytes("") == 0


def test_pip_command_enables_raw_progress() -> None:
    from app.comfy.installer import _pip_command

    pip = ["python", "-m", "pip", "install", "torch"]
    assert _pip_command(pip)[-2:] == ["--progress-bar", "raw"]
    assert _pip_command(["git", "clone", "url"]) == ["git", "clone", "url"]
    assert _pip_command([*pip, "--progress-bar", "off"])[-2:] == ["--progress-bar", "off"]


def test_exec_once_turns_pip_output_into_progress_events() -> None:
    """速度 / 字节数来自这里；原始 Progress 行不能混进右栏日志。"""
    import sys

    from app.comfy.installer import Step, _exec_once

    script = (
        "print('Collecting torch');"
        "print('  Downloading torch-2.9.1.whl (100 MB)');"
        "print('Progress 0 of 100');"
        "print('Progress 50 of 100');"
        "print('Progress 100 of 100');"
        "print('Successfully installed torch-2.9.1')"
    )
    step = Step(
        key="torch", title="安装 PyTorch", detail="",
        command=[sys.executable, "-c", script], timeout=60,
    )
    events: list[dict] = []
    lines: list[str] = []

    ok, message, _ = _exec_once(step, list(step.command or []), events.append, lines.append)
    assert ok, message

    downloads = [e for e in events if e["type"] == "progress" and e["phase"] == "download"]
    assert downloads[-1]["done"] == 100 and downloads[-1]["size"] == 100
    assert downloads[-1]["percent"] == 100
    assert downloads[-1]["speed"] > 0
    phases = {e["phase"] for e in events if e["type"] == "progress"}
    assert {"resolve", "install"} <= phases

    logs = [e["line"] for e in events if e["type"] == "log"]
    assert not any(line.startswith("Progress ") for line in logs)
    assert any("Successfully installed" in line for line in logs)
    assert all(not line.startswith("Progress ") for line in lines)


def test_download_reports_byte_progress_without_network(tmp_path, monkeypatch) -> None:
    """内置运行时的下载进度同样要走字节级事件，而不是 10% 一行的日志。"""
    from contextlib import contextmanager

    from app.comfy import installer

    class Resp:
        status_code = 200
        headers = {"content-length": "8"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def iter_bytes(self, size):
            yield b"abcd"
            yield b"efgh"

    @contextmanager
    def fake_stream(*args, **kwargs):
        yield Resp()

    monkeypatch.setattr(installer.httpx, "stream", fake_stream)
    events: list[dict] = []
    lines: list[str] = []
    dest = tmp_path / "runtime.tar.gz"

    ok, message = installer._download(
        "https://example.test/runtime.tar.gz", dest, events.append, lines.append,
        key="runtime", label="内置运行时",
    )
    assert ok, message
    assert dest.read_bytes() == b"abcdefgh"
    progress = [e for e in events if e["type"] == "progress"]
    assert progress[-1]["percent"] == 100
    assert progress[-1]["size"] == 8
    assert progress[-1]["speed"] > 0
    assert any("下载完成" in line for line in lines)


# ---------------- 实例删除 / 残留目录识别 ----------------
def _instance_api(tmp_path, monkeypatch):
    """把删除端点指向临时目录，避免碰到真机上的 comfy/。"""
    from app.comfy import api

    root = tmp_path / "comfy"
    root.mkdir(parents=True)
    monkeypatch.setattr(api, "COMFY_DIR", root)
    monkeypatch.setattr(api, "COMFY_ENV_DIR", root / ".environment")
    # 测试固定走标准删除路径；宿主运行时的补丁与否由具体用例单独打桩
    monkeypatch.setattr(api, "_rmtree_is_patched", lambda: False)
    api._jobs.clear()
    api._cache["payload"] = {"stale": True}
    return api, root


def _make_instance(root, name: str, *, meta: bool = True):
    target = root / name
    (target / "ComfyUI").mkdir(parents=True)
    if meta:
        (target / "instance.json").write_text("{}", encoding="utf-8")
    return target


def test_delete_instance_removes_only_its_own_dir(tmp_path, monkeypatch) -> None:
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-test")
    (root / ".environment" / "python").mkdir(parents=True)
    (root / "v-keep").mkdir()

    assert api.delete_instance("v-test") == {"deleted": "v-test"}
    assert not target.exists()
    assert (root / ".environment" / "python").is_dir()  # 共享环境绝不能删
    assert (root / "v-keep").is_dir()
    assert api._cache["payload"] is None  # 设备报告缓存立即失效


def test_delete_instance_accepts_unregistered_residue(tmp_path, monkeypatch) -> None:
    """早期安装没写 instance.json，也要能从界面清理掉。"""
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-old", meta=False)

    assert api.delete_instance("v-old") == {"deleted": "v-old"}
    assert not target.exists()


def test_delete_instance_rejects_unsafe_names(tmp_path, monkeypatch) -> None:
    api, _root = _instance_api(tmp_path, monkeypatch)
    for name in ("..", "../comfy", "v/../x", ".environment", ""):
        with pytest.raises(HTTPException) as err:
            api.delete_instance(name)
        assert err.value.status_code == 400


def test_delete_instance_refuses_unknown_dirs(tmp_path, monkeypatch) -> None:
    api, root = _instance_api(tmp_path, monkeypatch)
    (root / "not-ours").mkdir()
    with pytest.raises(HTTPException) as err:
        api.delete_instance("not-ours")
    assert err.value.status_code == 404
    assert (root / "not-ours").is_dir()
    with pytest.raises(HTTPException) as err:
        api.delete_instance("missing")
    assert err.value.status_code == 404


def test_delete_instance_refuses_running_install(tmp_path, monkeypatch) -> None:
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-busy")
    api._jobs["j1"] = {"status": "running", "workspace": str(target)}
    with pytest.raises(HTTPException) as err:
        api.delete_instance("v-busy")
    assert err.value.status_code == 409
    assert target.exists()


def test_delete_instance_falls_back_when_host_blocks_bulk_delete(tmp_path, monkeypatch) -> None:
    """宿主运行时的批量删除守卫会抛 SystemExit；不能让它变成裸 500。"""
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-guard")
    real_rmtree = api.shutil.rmtree
    calls: list[str] = []

    def blocked(*_args, **_kwargs):
        calls.append("python")
        raise SystemExit(1)

    monkeypatch.setattr(api.shutil, "rmtree", blocked)
    monkeypatch.setattr(api, "_rmtree_is_patched", lambda: False)
    monkeypatch.setattr(
        api,
        "_rmtree_native",
        lambda path: (calls.append("native"), real_rmtree(path))[-1],
    )

    assert api.delete_instance("v-guard") == {"deleted": "v-guard"}
    assert calls == ["python", "native"]
    assert not target.exists()
    assert api._cache["payload"] is None


def test_delete_instance_skips_patched_python_delete(tmp_path, monkeypatch) -> None:
    """宿主替换了 shutil.rmtree 时，直接用原生命令，不去触发批量删除守卫。"""
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-patched")
    real_rmtree = api.shutil.rmtree
    blocked = lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("不应调用 Python 删除"))
    monkeypatch.setattr(api.shutil, "rmtree", blocked)
    monkeypatch.setattr(api, "_rmtree_is_patched", lambda: True)
    monkeypatch.setattr(api, "_rmtree_native", lambda path: real_rmtree(path))

    assert api.delete_instance("v-patched") == {"deleted": "v-patched"}
    assert not target.exists()


def test_delete_instance_reports_real_failure_with_detail(tmp_path, monkeypatch) -> None:
    """真正删不掉时给前端可显示的 detail，而不是误导性的「目录被占用」。"""
    api, root = _instance_api(tmp_path, monkeypatch)
    target = _make_instance(root, "v-locked")

    def locked(*_args, **_kwargs):
        raise OSError("WinError 32: 文件被占用")

    monkeypatch.setattr(api.shutil, "rmtree", locked)
    with pytest.raises(HTTPException) as err:
        api.delete_instance("v-locked")
    assert err.value.status_code == 500
    assert "文件被占用" in err.value.detail
    assert target.exists()


def test_native_delete_reports_command_failure(tmp_path, monkeypatch) -> None:
    from app.comfy import api

    class Failed:
        returncode = 1
        stdout = ""
        stderr = "Access is denied."

    monkeypatch.setattr(api.subprocess, "run", lambda *_a, **_k: Failed())
    with pytest.raises(OSError, match="Access is denied"):
        api._rmtree_native(tmp_path)


def test_probe_lists_unregistered_residue(tmp_path, monkeypatch) -> None:
    from app.comfy import probe
    from app.comfy.platforms.base import ProbeContext

    root = tmp_path / "comfy"
    monkeypatch.setattr(probe, "COMFY_DIR", root)
    (root / ".environment").mkdir(parents=True)
    (root / "v-old" / "ComfyUI").mkdir(parents=True)
    (root / "v-new").mkdir()
    (root / "v-new" / "instance.json").write_text(
        json.dumps({"version": "0.44.0", "python": "3.13.18"}), encoding="utf-8"
    )
    (root / "not-ours").mkdir()

    items = {item.name: item for item in probe._collect_instances(ProbeContext())}
    assert set(items) == {"v-old", "v-new"}
    assert items["v-old"].registered is False
    assert items["v-new"].registered is True
    assert items["v-new"].version == "0.44.0"


# ---------------- 共享基础环境（内置 Python / torch / CUDA）探测 ----------------
def _fake_runtime_root(tmp_path, monkeypatch):
    from app.comfy import probe

    env = tmp_path / "comfy" / ".environment"
    env.mkdir(parents=True)
    monkeypatch.setattr(probe, "COMFY_ENV_DIR", env)
    monkeypatch.setattr(probe, "COMFY_ENV_NAME", "3.13.18")
    return probe, env


def test_probe_runtime_reports_missing_environment(tmp_path, monkeypatch) -> None:
    probe, _env = _fake_runtime_root(tmp_path, monkeypatch)
    status = probe.probe_runtime()
    assert not status.ready and not status.python_ready and not status.torch_ready
    assert status.python_version == "3.13.18"  # 计划值照样给，页面才好显示
    assert status.python_source == "cnb"
    assert status.torch_version is None and not status.python_cached


def test_probe_runtime_reads_installed_versions(tmp_path, monkeypatch) -> None:
    probe, env = _fake_runtime_root(tmp_path, monkeypatch)
    exe = env / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    (env / "cache").mkdir()
    (env / "cache" / "cpython-3.13.18-win.tar.gz").write_bytes(b"x")
    torch_dir = env / "site-packages" / "torch"
    torch_dir.mkdir(parents=True)
    (torch_dir / "version.py").write_text(
        "__version__ = '2.14.1+cu130'\ncuda: Optional[str] = '13.0'\n", encoding="utf-8"
    )
    torchvision = env / "site-packages" / "torchvision"
    torchvision.mkdir()
    (torchvision / "version.py").write_text("__version__ = '0.29.1+cu130'\n", encoding="utf-8")
    (env / "requirements.lock").write_text("torch==2.14.1\n", encoding="utf-8")

    status = probe.probe_runtime()
    assert status.ready and status.python_ready and status.torch_ready
    assert status.python_cached and status.lock_ready
    assert status.torch_version == "2.14.1+cu130"
    assert status.torchvision_version == "0.29.1+cu130"
    assert status.cuda_runtime == "13.0"
    assert status.torch_channel == "cu130"


def test_probe_runtime_falls_back_to_dist_info(tmp_path, monkeypatch) -> None:
    probe, env = _fake_runtime_root(tmp_path, monkeypatch)
    (env / "site-packages" / "torch").mkdir(parents=True)
    meta = env / "site-packages" / "torch-2.14.1.dist-info" / "METADATA"
    meta.parent.mkdir(parents=True)
    meta.write_text("Name: torch\nVersion: 2.14.1\n", encoding="utf-8")
    assert probe.probe_runtime().torch_version == "2.14.1"


def test_env_payload_exposes_runtime(monkeypatch) -> None:
    from app.comfy import api

    monkeypatch.setattr(api, "_cache", {"at": 0.0, "payload": None})
    monkeypatch.setattr(api, "probe_device", lambda: DeviceReport(os="windows"))
    monkeypatch.setattr(api, "build_plan", lambda _report: SimpleNamespace(model_dump=lambda: {}))
    monkeypatch.setattr(api, "probe_runtime", lambda: RuntimeStatus(ready=True, python_version="3.13.18"))
    payload = api.get_comfy_env(refresh=True)
    assert payload["runtime"]["ready"] is True
    assert payload["runtime"]["python_source"] == "cnb"


def test_preview_does_not_wait_for_mirror_probe(monkeypatch) -> None:
    """预演要立刻返回：测速只吃缓存，没有就丢给后台预热，绝不在请求里等。"""
    from app.comfy import api

    report = nvidia_report()
    monkeypatch.setattr(api, "_device_snapshot", lambda force=False: (report, build_plan(report)))
    monkeypatch.setattr(api, "cached_mirrors", lambda *_a, **_k: None)
    warmed: list[str] = []
    monkeypatch.setattr(api, "warm_mirrors", lambda channel: warmed.append(channel))
    monkeypatch.setattr(
        api, "probe_mirrors", lambda *_a, **_k: pytest.fail("预演不能同步测速")
    )

    payload = api.preview_install(kind="environment")

    assert [step["key"] for step in payload["steps"]][:2] == ["prepare", "runtime"]
    assert warmed == [payload["spec"]["channel"]]


def test_preview_reuses_cached_mirror_result(monkeypatch) -> None:
    """缓存里有实测结果时直接用，不再预热也不再测速。"""
    from app.comfy import api

    report = nvidia_report()
    monkeypatch.setattr(api, "_device_snapshot", lambda force=False: (report, build_plan(report)))
    monkeypatch.setattr(api, "cached_mirrors", lambda *_a, **_k: ["cached"])
    monkeypatch.setattr(api, "warm_mirrors", lambda channel: pytest.fail("有缓存不该预热"))
    monkeypatch.setattr(
        api, "probe_mirrors", lambda *_a, **_k: pytest.fail("预演不能同步测速")
    )
    seen: dict[str, object] = {}

    def fake_build(report_, mirrors=None):
        seen["mirrors"] = mirrors
        return build_plan(report_)

    monkeypatch.setattr(api, "build_plan", fake_build)

    api.preview_install(kind="environment")

    assert seen["mirrors"] == ["cached"]


# ---------------- 异种硬件：验证脚本与探测 ----------------
def test_verify_snippet_matches_backend() -> None:
    from app.comfy.installer import _verify_snippet

    assert "torch.xpu.is_available()" in _verify_snippet("xpu")
    assert "torch.backends.mps" in _verify_snippet("mps")
    assert "cpu_threads" in _verify_snippet("cpu")
    assert "torch_directml" in _verify_snippet("directml")
    assert "torch.cuda.is_available()" in _verify_snippet("cu130")
    assert "torch.cuda.is_available()" not in _verify_snippet("xpu")


def test_requirements_never_overwrites_hardware_torch(tmp_path) -> None:
    """requirements.txt 里的裸 torch 不能参与解析，否则会覆盖成 PyPI 通用轮子。"""
    from app.comfy.installer import write_filtered_requirements

    s = spec(tmp_path)
    s.comfy_dir.mkdir(parents=True, exist_ok=True)
    (s.comfy_dir / "requirements.txt").write_text("torch\ntorchvision\ntorchaudio\ntqdm\n", encoding="utf-8")
    kept = write_filtered_requirements(s).read_text(encoding="utf-8").splitlines()
    assert kept == ["tqdm"]
    # 步骤本身也不带任何会动 torch 的命令
    assert keyed(build_steps(s))["requirements"].command is None


def _fake_wheel(directory: Path, name: str, size: int, mtime: float) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(b"0" * size)
    os.utime(path, (mtime, mtime))
    return path


def test_prune_cache_keeps_only_newest_version(tmp_path, monkeypatch) -> None:
    """同一个包缓存了多个版本时，只留版本最高的那个，顺手清掉半截下载。"""
    from app.comfy import installer

    wheels = tmp_path / "wheels"
    _fake_wheel(wheels, "yarl-1.9.4-cp313-cp313-win_amd64.whl", 10, 1_000)
    _fake_wheel(wheels, "yarl-1.18.3-cp313-cp313-win_amd64.whl", 10, 2_000)
    _fake_wheel(wheels, "tqdm-4.67.1-py3-none-any.whl", 10, 3_000)
    (wheels / "broken-1.0.0-py3-none-any.whl.3.part").write_bytes(b"x")
    monkeypatch.setattr(installer, "_cache_limit_bytes", lambda: 1024**3)

    stats = installer.prune_cache(wheels)

    left = sorted(p.name for p in wheels.iterdir())
    assert left == ["tqdm-4.67.1-py3-none-any.whl", "yarl-1.18.3-cp313-cp313-win_amd64.whl"]
    assert stats["removed"] == 2


def test_prune_cache_evicts_oldest_over_limit(tmp_path, monkeypatch) -> None:
    """总量超上限时按最久未用淘汰，删到刚好回到上限内就停。"""
    from app.comfy import installer

    wheels = tmp_path / "wheels"
    for index in range(4):
        _fake_wheel(wheels, f"pkg{index}-1.0.0-py3-none-any.whl", 100, 1_000 + index)
    monkeypatch.setattr(installer, "_cache_limit_bytes", lambda: 250)

    stats = installer.prune_cache(wheels)

    left = sorted(p.name for p in wheels.iterdir())
    assert left == ["pkg2-1.0.0-py3-none-any.whl", "pkg3-1.0.0-py3-none-any.whl"]
    assert stats["size"] <= 250


def test_prune_cache_never_drops_current_wheels(tmp_path, monkeypatch) -> None:
    """本次安装要用的轮子即使超上限也不能删，否则装完立刻又要重下。"""
    from app.comfy import installer

    wheels = tmp_path / "wheels"
    keep = _fake_wheel(wheels, "torch-2.9.1-cp313-cp313-win_amd64.whl", 400, 1_000)
    _fake_wheel(wheels, "numpy-2.2.0-cp313-cp313-win_amd64.whl", 400, 2_000)
    monkeypatch.setattr(installer, "_cache_limit_bytes", lambda: 500)

    installer.prune_cache(wheels, keep={keep.name})

    assert keep.exists()
    assert sorted(p.name for p in wheels.iterdir()) == [keep.name]


def test_prune_cache_disabled_by_zero_limit(tmp_path, monkeypatch) -> None:
    """上限设 0 表示不限制，一个字节都不动。"""
    from app.comfy import installer

    wheels = tmp_path / "wheels"
    _fake_wheel(wheels, "yarl-1.9.4-cp313-cp313-win_amd64.whl", 10, 1_000)
    _fake_wheel(wheels, "yarl-1.18.3-cp313-cp313-win_amd64.whl", 10, 2_000)
    monkeypatch.setattr(installer, "_cache_limit_bytes", lambda: 0)

    installer.prune_cache(wheels)

    assert len(list(wheels.iterdir())) == 2


def test_ascend_probe_detects_davinci(tmp_path, monkeypatch) -> None:
    from app.comfy.platforms import ProbeContext, linux

    monkeypatch.setattr(linux, "ASCEND_DEVICES", tmp_path)
    monkeypatch.setattr(linux, "ASCEND_TOOLKIT", tmp_path / "toolkit")
    (tmp_path / "davinci0").touch()
    (tmp_path / "davinci1").touch()
    gpus = linux.LinuxGpuProbe()._ascend(ProbeContext(), {"01:00.0": "Huawei Ascend 910B"})
    assert len(gpus) == 1
    assert gpus[0].vendor == "ascend" and gpus[0].is_discrete
    assert "910B" in gpus[0].name and "×2" in gpus[0].name


# ---------------- 基础环境 / 实例拆成两类任务 ----------------
def test_environment_job_never_installs_comfyui(tmp_path) -> None:
    s = spec(tmp_path)
    steps = keyed(build_steps(s, "environment"))
    assert list(steps) == ["prepare", "runtime", "torch", "lock", "verify"]
    assert "clone" not in steps and "models" not in steps
    assert steps["prepare"].scope == "env"
    assert steps["verify"].cwd == s.environment


def test_instance_job_only_installs_comfyui_code(tmp_path) -> None:
    s = spec(tmp_path)
    steps = keyed(build_steps(s, "instance"))
    assert list(steps) == ["prepare", "clone", "models", "requirements", "verify"]
    assert "runtime" not in steps and "torch" not in steps and "lock" not in steps
    assert steps["prepare"].scope == "instance"
    assert steps["verify"].cwd == s.comfy_dir


def test_environment_ready_reuses_torch(tmp_path) -> None:
    s = spec(tmp_path)
    (s.env_site / "torch").mkdir(parents=True)
    keys = [step.key for step in build_steps(s, "environment")]
    assert "deps-reuse" in keys and "torch" not in keys


def test_repair_forces_torch_reinstall(tmp_path) -> None:
    """目录还在但 torch 跑不起来时，修复不能走「复用已有依赖」的空操作。"""
    s = spec(tmp_path, repair=True)
    (s.env_site / "torch").mkdir(parents=True)
    keys = [step.key for step in build_steps(s, "environment")]
    assert "torch" in keys and "lock" in keys and "deps-reuse" not in keys


def test_make_spec_passes_repair_flag() -> None:
    report = nvidia_report()
    assert make_spec(report, build_plan(report), repair=True).repair is True


def test_unknown_install_kind_rejected(tmp_path) -> None:
    with pytest.raises(ValueError):
        build_steps(spec(tmp_path), "oops")


def test_environment_job_registers_no_instance(tmp_path, monkeypatch) -> None:
    """基础环境装完不能凭空多出一个实例目录 / instance.json。"""
    from app.comfy import installer

    monkeypatch.setattr(installer, "LOG_DIR", tmp_path)
    monkeypatch.setattr(installer, "_run_step", lambda *args: (True, "完成"))
    s = spec(tmp_path)
    result = installer.run_install(s, [], kind="environment")
    assert result.ok and result.instance is None
    assert not (s.workspace / "instance.json").exists()


# ---------------- 环境检测 ----------------
def test_doctor_reports_missing_python(tmp_path, monkeypatch) -> None:
    from app.comfy import doctor

    monkeypatch.setattr(doctor, "COMFY_ENV_DIR", tmp_path / "not-installed")
    result = doctor.check_environment()
    assert not result["ok"]
    assert result["issues"][0]["code"] == "python-missing"
    assert result["issues"][0]["fix"] == "install"


def test_doctor_reads_real_torch_probe(tmp_path, monkeypatch) -> None:
    from app.comfy import doctor

    fake_exe = tmp_path / "python.exe"
    fake_exe.touch()
    monkeypatch.setattr(doctor, "_python_exe", lambda: fake_exe)
    payload = json.dumps(
        {"python": "3.13.18", "torch": "2.14.1+cu130", "backend": "cuda", "accelerator": True}
    )
    monkeypatch.setattr(
        doctor.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout=payload + "\n", stderr="", returncode=0),
    )
    result = doctor.check_environment()
    assert result["ok"] and result["torch"].startswith("2.14") and result["accelerator"] is True


def test_system_memory_is_positive() -> None:
    from app.comfy import probe
    from app.comfy.platforms import ProbeContext

    assert probe._system_memory_gb(probe.detect_os(), ProbeContext()) > 1


def test_unified_memory_detection() -> None:
    from app.comfy import probe

    assert probe._is_unified_memory("macos", "arm64", []) is True
    assert probe._is_unified_memory("linux", "arm64", [GpuInfo(vendor="nvidia", name="GB10")]) is True
    assert probe._is_unified_memory(
        "linux", "x86_64", [GpuInfo(vendor="amd", name="Radeon 8060S", memory_shared=True)]
    ) is True
    assert probe._is_unified_memory(
        "windows", "x86_64", [GpuInfo(vendor="nvidia", name="RTX 4080")]
    ) is False
    # 独显 + 核显共存的普通桌面：核显共享内存只是显示输出，整机不是 UMA
    assert probe._is_unified_memory(
        "windows",
        "x86_64",
        [
            GpuInfo(vendor="nvidia", name="RTX 4080 SUPER", is_discrete=True),
            GpuInfo(vendor="intel", name="Intel UHD Graphics 770", memory_shared=True),
        ],
    ) is False
    # 纯核显 / 纯虚拟显示器
    assert probe._is_unified_memory(
        "windows",
        "x86_64",
        [GpuInfo(vendor="intel", name="Intel UHD Graphics 770", memory_shared=True)],
    ) is True
    assert probe._is_unified_memory(
        "windows",
        "x86_64",
        [GpuInfo(vendor="unknown", name="Parsec Virtual Display Adapter", memory_shared=True)],
    ) is False


# ---------------- 目录扁平化迁移 ----------------
def test_legacy_layout_migration_is_lossless_and_idempotent(tmp_path, monkeypatch) -> None:
    from app import config

    root = tmp_path / "comfy"
    legacy = root / "instances"
    (legacy / ".environment" / "site-packages").mkdir(parents=True)
    (legacy / ".environment" / "site-packages" / "torch").mkdir()
    (legacy / "v-a" / "ComfyUI").mkdir(parents=True)
    (legacy / "v-a" / "instance.json").write_text('{"version":"0.44.0"}', encoding="utf-8")
    (legacy / "v-b").mkdir()
    monkeypatch.setattr(config, "COMFY_DIR", root)

    moved = config.migrate_legacy_comfy_layout()

    assert set(moved) == {".environment", "v-a", "v-b"}
    assert (root / ".environment" / "site-packages" / "torch").is_dir()
    assert json.loads((root / "v-a" / "instance.json").read_text(encoding="utf-8"))["version"] == "0.44.0"
    assert (root / "v-b").is_dir()
    assert not legacy.exists()
    assert config.migrate_legacy_comfy_layout() == []  # 幂等


def test_legacy_layout_migration_never_overwrites(tmp_path, monkeypatch) -> None:
    from app import config

    root = tmp_path / "comfy"
    (root / "v-a").mkdir(parents=True)
    (root / "instances" / "v-a").mkdir(parents=True)
    monkeypatch.setattr(config, "COMFY_DIR", root)

    assert config.migrate_legacy_comfy_layout() == []
    assert (root / "v-a").is_dir()
    assert (root / "instances" / "v-a").is_dir()  # 冲突项留在原地，绝不覆盖


def test_legacy_layout_migration_skips_real_instance_named_instances(tmp_path, monkeypatch) -> None:
    from app import config

    root = tmp_path / "comfy"
    real = root / "instances"
    (real / "ComfyUI").mkdir(parents=True)
    (real / "instance.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(config, "COMFY_DIR", root)

    assert config.migrate_legacy_comfy_layout() == []
    assert (real / "instance.json").is_file()


# ---------------- 实例显示名（alias） ----------------
def test_probe_reads_instance_alias(tmp_path, monkeypatch) -> None:
    from app.comfy import probe
    from app.comfy.platforms.base import ProbeContext

    root = tmp_path / "comfy"
    monkeypatch.setattr(probe, "COMFY_DIR", root)
    (root / "v-1").mkdir(parents=True)
    (root / "v-1" / "instance.json").write_text(
        json.dumps({"version": "0.45.0", "alias": "主力"}), encoding="utf-8"
    )
    (root / "v-2").mkdir()
    (root / "v-2" / "instance.json").write_text(json.dumps({"version": "0.45.0"}), encoding="utf-8")

    items = {item.name: item for item in probe._collect_instances(ProbeContext())}
    assert items["v-1"].alias == "主力"
    # 没写别名时保持 None，界面回落显示目录名
    assert items["v-2"].alias is None


def test_clean_alias_trims_and_limits() -> None:
    from app.comfy.names import ALIAS_MAX, clean_alias

    assert clean_alias("  ComfyUI   主力 ") == "ComfyUI 主力"
    assert clean_alias("") == ""
    assert clean_alias("  ") == ""
    with pytest.raises(ValueError, match="最多"):
        clean_alias("长" * (ALIAS_MAX + 1))


def test_rename_instance_writes_alias(tmp_path, monkeypatch) -> None:
    from app.comfy import api

    root = tmp_path / "comfy"
    root.mkdir()
    monkeypatch.setattr(api, "COMFY_DIR", root)
    meta = root / "v-1" / "instance.json"
    meta.parent.mkdir()
    meta.write_text(json.dumps({"version": "0.45.0", "port": 8188}), encoding="utf-8")

    assert api.rename_instance("v-1", {"alias": " 主力 "}) == {"name": "v-1", "alias": "主力"}
    data = json.loads(meta.read_text(encoding="utf-8"))
    assert data["alias"] == "主力"
    # 其他字段必须原样保留：改名只碰 alias
    assert data["version"] == "0.45.0" and data["port"] == 8188

    api.rename_instance("v-1", {"alias": ""})
    assert json.loads(meta.read_text(encoding="utf-8"))["alias"] == ""


def test_rename_instance_rejects_unknown_and_illegal(tmp_path, monkeypatch) -> None:
    from fastapi import HTTPException

    from app.comfy import api

    root = tmp_path / "comfy"
    root.mkdir()
    monkeypatch.setattr(api, "COMFY_DIR", root)
    (root / ".environment").mkdir()

    with pytest.raises(HTTPException) as missing:
        api.rename_instance("v-none", {"alias": "x"})
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as dotted:
        api.rename_instance(".environment", {"alias": "x"})
    assert dotted.value.status_code == 400


def test_make_spec_carries_alias() -> None:
    from app.comfy.installer import make_spec
    from app.comfy.plan import build_plan

    report = nvidia_report()
    plan = build_plan(report, {})
    spec = make_spec(report, plan, name="v-x", alias=" 主力 ")
    assert spec.alias == "主力"
    assert spec.name == "v-x"
