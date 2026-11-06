"""M2 安装方案推导（plan）的单元测试。

A. 三份真实探测结果（tests/fixtures/probe/*.json）
B. 决策矩阵其余分支（直接构造 DeviceReport）
C. 不变量：tier 合法且 blocked 必带原因
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.comfy.models import DeviceReport, DiskInfo, GpuInfo, PythonInfo
from app.comfy.plan import ENV_REQUIRED_GB, build_plan

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "probe"


# ---------------- 构造样本 ----------------
def make_report(
    *,
    os: str = "windows",
    os_version: str = "11 (26100)",
    os_build: str = "26100",
    arch: str = "x86_64",
    is_wsl: bool = False,
    gpus: list[GpuInfo] | None = None,
    primary: GpuInfo | None = None,
    pythons: tuple[str, ...] = ("3.12.3",),
    disks: tuple[tuple[str, float, float], ...] = (("C:\\", 500.0, 100.0),),
    warnings: tuple[str, ...] = (),
) -> DeviceReport:
    gpu_list = [nvidia()] if gpus is None else list(gpus)
    if primary is None and gpu_list:
        primary = gpu_list[0]
    return DeviceReport(
        os=os,
        os_version=os_version,
        os_build=os_build,
        arch=arch,
        is_wsl=is_wsl,
        gpus=gpu_list,
        primary_gpu=primary,
        pythons=[PythonInfo(version=version, path=f"C:/Python/{index}/python.exe") for index, version in enumerate(pythons)],
        disks=[DiskInfo(path=path, total_gb=total, free_gb=free) for path, total, free in disks],
        warnings=list(warnings),
    )


def nvidia(
    *,
    name: str = "NVIDIA GeForce RTX 4080 SUPER",
    driver: str = "580.65",
    compute_cap: str | None = "8.9",
) -> GpuInfo:
    return GpuInfo(
        vendor="nvidia",
        name=name,
        driver_version=driver,
        vram_mb=16376,
        compute_cap=compute_cap,
        source="nvidia-smi",
        is_discrete=True,
    )


def load_fixture(name: str) -> DeviceReport:
    data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return DeviceReport.model_validate(data)


# ---------------- A. 真实 fixture ----------------
def test_fixture_win11_rtx4080s_full_cu130() -> None:
    plan = build_plan(load_fixture("win11_rtx4080s.json"))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "cuda", "cu130")
    assert plan.python_version == "3.13"
    assert plan.python_available is True
    assert plan.disk_ok is True
    assert plan.blocked_reason is None


def test_fixture_linux_rtxpro5000_full_cu130() -> None:
    plan = build_plan(load_fixture("linux_ubuntu_rtxpro5000.json"))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "cuda", "cu130")
    assert plan.python_version == "3.13"
    # 本机只有 3.12，但仍满足 ComfyUI 最低要求
    assert plan.python_available is True
    assert any("3.12" in action.title for action in plan.actions)


def test_fixture_macos_m4_full_mps() -> None:
    plan = build_plan(load_fixture("macos_m4_16g.json"))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "mps", "mps")
    assert plan.python_version == "3.12"
    assert plan.disk_ok is True


# ---------------- B. 矩阵分支 ----------------
def test_rtx3060_driver552_uses_cu126_with_upgrade_hint() -> None:
    plan = build_plan(
        make_report(gpus=[nvidia(name="NVIDIA GeForce RTX 3060", driver="552.22", compute_cap="8.6")])
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "cuda", "cu126")
    assert plan.python_version == "3.12"
    upgrade = [action for action in plan.actions if action.url]
    assert upgrade, "应有升级驱动以获得 cu130 的建议"
    assert "580" in upgrade[0].detail


def test_gtx1050ti_old_arch_limited() -> None:
    plan = build_plan(
        make_report(gpus=[nvidia(name="NVIDIA GeForce GTX 1050 Ti", driver="580.65", compute_cap="6.1")])
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cuda", "cu126")
    assert any("新模型" in action.title for action in plan.actions)


def test_nvidia_unknown_compute_cap_falls_back() -> None:
    plan = build_plan(make_report(gpus=[nvidia(driver="580.65", compute_cap=None)]))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cuda", "cu126")
    assert any("算力" in warning for warning in plan.warnings)


def test_amd_linux_rocm() -> None:
    plan = build_plan(
        make_report(
            os="linux",
            os_version="Ubuntu 24.04",
            os_build="",
            gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7900 XTX", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "rocm", "rocm7.2")
    assert plan.python_version == "3.12"


def test_amd_win10_directml() -> None:
    plan = build_plan(
        make_report(
            os_version="10 (19045)",
            os_build="19045",
            gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7800 XT", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "directml", "directml")
    assert any("DirectML" in action.detail for action in plan.actions)


def test_amd_win11_with_python313_full_rocm() -> None:
    plan = build_plan(
        make_report(
            pythons=("3.13.5",),
            gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7900 XTX", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "rocm", "rocm7.2")
    assert plan.python_version == "3.13"


def test_intel_arc_xpu() -> None:
    plan = build_plan(
        make_report(gpus=[GpuInfo(vendor="intel", name="Intel Arc A770", is_discrete=True)])
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "xpu", "xpu")
    assert any("实验" in action.detail for action in plan.actions)


def test_intel_mac_falls_back_to_cpu() -> None:
    plan = build_plan(
        make_report(
            os="macos",
            os_version="13.6",
            os_build="",
            arch="x86_64",
            gpus=[GpuInfo(vendor="apple", name="Intel Iris Plus")],
        )
    )
    assert (plan.tier, plan.backend) == ("limited", "cpu")


def test_no_gpu_cpu() -> None:
    plan = build_plan(make_report(gpus=[]))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
    assert any("CPU" in action.title for action in plan.actions)


def test_only_virtual_displays_cpu() -> None:
    plan = build_plan(
        make_report(
            gpus=[
                GpuInfo(vendor="unknown", name="Parsec Virtual Display Adapter"),
                GpuInfo(vendor="unknown", name="GameViewer Virtual Display Adapter"),
            ],
            primary=None,
        )
    )
    assert (plan.tier, plan.backend) == ("limited", "cpu")


def test_disk_5gb_blocks() -> None:
    plan = build_plan(make_report(disks=(("E:\\", 500.0, 5.0),)))
    assert plan.tier == "blocked"
    assert plan.disk_ok is False
    assert plan.disk_required_gb == ENV_REQUIRED_GB
    assert plan.blocked_reason


def test_disk_12gb_warns_but_ok() -> None:
    plan = build_plan(make_report(disks=(("E:\\", 500.0, 12.0),)))
    assert plan.disk_ok is True
    assert plan.tier == "full"
    assert any(action.level == "warn" and "模型" in action.title for action in plan.actions)


def test_python_only_39_not_available() -> None:
    plan = build_plan(make_report(pythons=("3.9.25",)))
    assert plan.python_available is False
    assert any("Python" in action.title for action in plan.actions)


def test_python_fallback_not_newer_than_suggested() -> None:
    """建议 3.13 时，优先用 3.11 而不是尚未被 torch 支持的 3.14。"""
    plan = build_plan(
        make_report(
            pythons=("3.11.9", "3.14.4"),
            gpus=[nvidia(driver="580.65", compute_cap="8.9")],
        )
    )
    assert plan.python_version == "3.13"
    assert plan.python_available is True
    assert any("3.11" in action.title for action in plan.actions)


# ---------------- C. 不变量 ----------------
@pytest.mark.parametrize(
    "report",
    [
        make_report(),
        make_report(gpus=[]),
        make_report(disks=()),
        make_report(pythons=()),
        make_report(
            gpus=[GpuInfo(vendor="unknown", name="VMware SVGA II")],
            disks=(("C:\\", 100.0, 1.0),),
        ),
        make_report(
            os="freebsd",
            os_version="14.1",
            os_build="",
            arch="amd64",
            gpus=[GpuInfo(vendor="mystery", name="Some Adapter")],
        ),
    ],
    ids=["nvidia-ok", "no-gpu", "no-disk", "no-python", "unknown-vendor-low-disk", "unknown-os"],
)
def test_invariant_tier_and_blocked_reason(report: DeviceReport) -> None:
    plan = build_plan(report)
    assert plan.tier in {"full", "limited", "blocked"}
    if plan.tier == "blocked":
        assert plan.blocked_reason


@pytest.mark.parametrize(
    "report",
    [
        load_fixture("win11_rtx4080s.json"),
        load_fixture("linux_ubuntu_rtxpro5000.json"),
        load_fixture("macos_m4_16g.json"),
        make_report(gpus=[nvidia(driver="500.0", compute_cap="8.9")]),
        make_report(gpus=[]),
        make_report(disks=(("E:\\", 500.0, 5.0),)),
    ],
    ids=["win11", "linux", "macos", "driver-blocked", "cpu", "disk-blocked"],
)
def test_action_titles_have_no_channel_jargon(report: DeviceReport) -> None:
    """标题只说人话，通道名 / 后端名只允许出现在 detail 里。"""
    plan = build_plan(report)
    jargon = ("cu126", "cu130", "rocm", "directml", "xpu", "mps", "extra-index-url")
    for action in plan.actions:
        low = action.title.lower()
        assert not any(token in low for token in jargon), action.title


# ---------------- D. 规则收紧后的边界 ----------------
def test_old_arch_with_ancient_driver_blocked() -> None:
    """老架构 + 驱动低于门槛：cu126 同样跑不了，必须挡住而不是给 limited。

    早期实现把驱动检查放在"算力 >= 7.5"分支内，导致 GTX 1050Ti + 驱动 500
    返回 limited / cu126，而 cu126 本身要求 527+，装下去必然失败。
    """
    report = make_report(
        gpus=[nvidia(name="NVIDIA GeForce GTX 1050 Ti", driver="500.20", compute_cap="6.1")]
    )
    plan = build_plan(report)
    assert plan.tier == "blocked"
    assert plan.blocked_reason is not None
    assert "驱动" in plan.blocked_reason


def test_amd_wsl_falls_back_to_cpu() -> None:
    """ROCm 官方不支持 WSL，WSL 内的 AMD 卡必须降级到 CPU。"""
    amd = GpuInfo(
        vendor="amd",
        name="AMD Radeon RX 7900 XTX",
        driver_version="",
        vram_mb=24576,
        source="sysfs",
        is_discrete=True,
    )
    report = make_report(
        os="linux",
        os_version="Ubuntu 24.04",
        os_build="",
        is_wsl=True,
        gpus=[amd],
        disks=(("/", 500.0, 200.0),),
    )
    plan = build_plan(report)
    assert plan.backend == "cpu"
    assert plan.tier == "limited"


def test_python_too_new_not_selected() -> None:
    """本机只有 3.14 时不能选它：PyTorch 轮子尚未覆盖，装了也拿不到 torch。"""
    report = make_report(pythons=("3.14.0",))
    plan = build_plan(report)
    assert plan.python_available is False
    assert any("3.14" in action.detail for action in plan.actions)


def test_python_prefers_not_newer_than_suggested() -> None:
    """同时有 3.12 和 3.14 时应选 3.12，不越级。"""
    report = make_report(pythons=("3.12.7", "3.14.0"))
    plan = build_plan(report)
    assert plan.python_available is True
    assert any("3.12" in action.title for action in plan.actions)


# ---------------- 解释器可信度 ----------------
def test_is_trusted_python_rejects_toolchain_paths() -> None:
    """应用自带的运行时不能用来建持久环境。"""
    from app.comfy.probe import is_trusted_python

    # WorkBuddy 的 vendor python（符号链接到应用安装目录）
    assert not is_trusted_python(r"C:/Users/Moc/.workbuddy/binaries/python/versions/3.13.12/python.exe")
    assert not is_trusted_python(r"D:/Program Files/WorkBuddy/resources/vendor/python/python.exe")
    # 正常来源必须放行——官方安装器默认就装在 AppData\Local\Programs
    assert is_trusted_python(r"C:/Users/Moc/AppData/Local/Programs/Python/Python313/python.exe")
    assert is_trusted_python("D:/ProgramData/miniconda3/python.exe")
    assert is_trusted_python("/usr/bin/python3")
    assert is_trusted_python("/opt/homebrew/bin/python3.13")


def test_plan_rejects_toolchain_python() -> None:
    """只有应用自带 3.13 时不能直接用，必须提示装独立 Python。"""
    report = make_report(
        pythons=(),
    )
    report.pythons = [
        PythonInfo(
            version="3.13.14",
            path=r"C:/Users/Moc/.workbuddy/binaries/python/versions/3.13.12/python.exe",
            source="path",
            trusted=False,
        )
    ]
    plan = build_plan(report)
    assert plan.python_available is False
    assert any("应用自带" in action.detail for action in plan.actions)


def test_pick_python_skips_untrusted() -> None:
    from app.comfy.installer import pick_python

    report = make_report(pythons=())
    report.pythons = [
        PythonInfo(version="3.13.14", path="C:/toolchain/python.exe", source="path", trusted=False),
        PythonInfo(version="3.12.7", path="C:/Py312/python.exe", source="path", trusted=True),
    ]
    plan = build_plan(report)
    chosen = pick_python(report, plan)
    assert chosen is not None
    assert chosen.version.startswith("3.12")


# ---------------- 镜像测速选源 ----------------
def _mirror(kind: str, label: str, url: str, kbps: float, ok: bool = True, channel: str = ""):
    from app.comfy.models import MirrorProbe

    return MirrorProbe(kind=kind, label=label, url=url, channel=channel, ok=ok, speed_kbps=kbps)


def test_pick_index_chooses_fastest() -> None:
    from app.comfy.plan import _pick_index

    mirrors = [
        _mirror("pip", "清华", "https://a/simple", 60),
        _mirror("pip", "阿里云", "https://b/simple", 700),
        _mirror("pip", "官方", "https://c/simple", 80),
    ]
    assert _pick_index(mirrors, "pip", "") == "https://b/simple"


def test_pick_index_skips_failed_and_wrong_channel() -> None:
    from app.comfy.plan import _pick_index

    mirrors = [
        _mirror("torch", "上交", "https://s/cu130/", 900, ok=False, channel="cu130"),
        _mirror("torch", "南大", "https://n/cu126/", 800, channel="cu126"),
        _mirror("torch", "官方", "https://p/cu130/", 10, channel="cu130"),
    ]
    # 上交不可用、南大通道不匹配 → 只剩官方
    assert _pick_index(mirrors, "torch", "cu130") == "https://p/cu130/"


def test_pick_index_empty_without_mirrors() -> None:
    from app.comfy.plan import _pick_index

    assert _pick_index(None, "pip", "") == ""
    assert _pick_index([], "pip", "") == ""


def test_plan_uses_probed_index() -> None:
    """传了测速结果，plan 就该用最快的源，而不是内置默认。"""
    report = make_report()
    mirrors = [
        _mirror("torch", "南大", "https://mirror.nju.edu.cn/pytorch/whl/cu130/", 500, channel="cu130"),
        _mirror("torch", "上交", "https://mirror.sjtu.edu.cn/pytorch-wheels/cu130/", 40, channel="cu130"),
        _mirror("pip", "阿里云", "https://mirrors.aliyun.com/pypi/simple", 800),
    ]
    plan = build_plan(report, mirrors)
    assert plan.torch_index == "https://mirror.nju.edu.cn/pytorch/whl/cu130/"
    assert plan.pip_index == "https://mirrors.aliyun.com/pypi/simple"


def test_plan_without_mirrors_leaves_index_empty() -> None:
    plan = build_plan(make_report())
    assert plan.torch_index == "" and plan.pip_index == ""


def test_index_note_shows_measured_speed() -> None:
    """选源说明要带实测速度，用户才能看出不是写死的。"""
    from app.comfy.plan import _index_note

    mirrors = [
        _mirror("torch", "南大", "https://n/cu130/", 2207, channel="cu130"),
        _mirror("torch", "上交", "https://s/cu130/", 1304, channel="cu130"),
    ]
    assert _index_note(mirrors, "torch", "cu130") == "南大 · 实测 2.2 MB/s"


def test_index_note_empty_when_all_failed() -> None:
    from app.comfy.plan import _index_note

    mirrors = [_mirror("torch", "南大", "https://n/cu130/", 0, ok=False, channel="cu130")]
    assert _index_note(mirrors, "torch", "cu130") == ""
