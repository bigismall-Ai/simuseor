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
    memory_gb: float | None = None,
    unified_memory: bool = False,
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
        memory_gb=memory_gb,
        unified_memory=unified_memory,
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
    # 本机只有 3.12，但仍满足 ComfyUI 最低要求；安装实际固定用内置 3.13.18
    assert plan.python_available is True
    assert any("内置 Python 3.13.18" in action.title for action in plan.actions)


def test_fixture_macos_m4_full_mps() -> None:
    plan = build_plan(load_fixture("macos_m4_16g.json"))
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "mps", "mps")
    assert plan.python_version == "3.13"
    assert plan.disk_ok is True


# ---------------- B. 矩阵分支 ----------------
def test_rtx3060_driver552_uses_cu126_with_upgrade_hint() -> None:
    plan = build_plan(
        make_report(gpus=[nvidia(name="NVIDIA GeForce RTX 3060", driver="552.22", compute_cap="8.6")])
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("full", "cuda", "cu126")
    assert plan.python_version == "3.13"
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
    assert plan.python_version == "3.13"


def test_amd_win10_falls_back_to_cpu_without_cp313_wheel() -> None:
    """PyTorch 官方 ROCm 索引无 win_amd64、torch-directml 无 cp313 轮子，不能给装不上的方案。"""
    plan = build_plan(
        make_report(
            os_version="10 (19045)",
            os_build="19045",
            gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7800 XT", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
    assert any("DirectML" in action.detail and "3.13" in action.detail for action in plan.actions)


def test_amd_win11_also_falls_back_to_cpu() -> None:
    """Win11 + 系统装了 3.13 也没用：ROCm 官方索引根本没有 Windows 轮子。"""
    plan = build_plan(
        make_report(
            pythons=("3.13.5",),
            gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7900 XTX", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
    assert plan.python_version == "3.13"


def test_intel_arc_xpu() -> None:
    plan = build_plan(
        make_report(gpus=[GpuInfo(vendor="intel", name="Intel Arc A770", is_discrete=True)])
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "xpu", "xpu")
    assert any("实验" in action.detail for action in plan.actions)


def test_intel_mac_blocked_without_runtime_package() -> None:
    """Intel Mac 没有上架内置运行时包，不能静默装一个 x86_64 跑不了的解释器。"""
    plan = build_plan(
        make_report(
            os="macos",
            os_version="13.6",
            os_build="",
            arch="x86_64",
            gpus=[GpuInfo(vendor="apple", name="Intel Iris Plus")],
        )
    )
    assert (plan.tier, plan.backend) == ("blocked", "cpu")
    assert "x86_64" in (plan.blocked_reason or "")


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


def test_system_python_mix_does_not_change_plan() -> None:
    """本机 3.11 + 3.14 混杂也不影响方案：安装固定用内置 3.13.18。"""
    plan = build_plan(
        make_report(
            pythons=("3.11.9", "3.14.4"),
            gpus=[nvidia(driver="580.65", compute_cap="8.9")],
        )
    )
    assert plan.python_version == "3.13"
    assert plan.torch_channel == "cu130"
    assert plan.python_available is True
    assert any("内置 Python 3.13.18" in action.title for action in plan.actions)


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


def test_builtin_python_independent_of_system_version() -> None:
    """内置 Python 固定 3.13.18，本机只有 3.14 也不该影响方案或文案。"""
    report = make_report(pythons=("3.14.0",))
    plan = build_plan(report)
    assert plan.python_available is False
    assert plan.torch_channel == "cu130"
    assert any("内置 Python 3.13.18" in action.title for action in plan.actions)


def test_system_python_versions_do_not_leak_into_copy() -> None:
    """系统里同时有 3.12 / 3.14 时，页面也不能出现「将下载内置 Python 3.12」。"""
    report = make_report(pythons=("3.12.7", "3.14.0"))
    plan = build_plan(report)
    assert plan.python_available is True
    titles = " ".join(action.title for action in plan.actions)
    assert "内置 Python 3.13.18" in titles
    assert "3.12" not in titles


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
    """只有应用自带 3.13 时不能算可用解释器，安装仍走内置运行时。"""
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
    assert plan.python_source == "download"
    assert any("不依赖系统里已装的 Python" in action.detail for action in plan.actions)


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


# ---------------- E. 异种硬件与统一内存 ----------------
def test_ascend_falls_back_to_cpu_with_explicit_notice() -> None:
    """昇腾需要 CANN + torch_npu，不能假装它支持 CUDA/ROCm，也不能静默略过。"""
    plan = build_plan(
        make_report(
            os="linux",
            os_version="Ubuntu 24.04",
            gpus=[GpuInfo(vendor="ascend", name="Ascend 910B ×2", is_discrete=True)],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
    assert any("CANN" in action.detail for action in plan.actions)


def test_intel_igpu_is_not_treated_as_xpu() -> None:
    report = make_report(
        gpus=[
            GpuInfo(
                vendor="intel",
                name="Intel(R) UHD Graphics 770",
                is_discrete=False,
                memory_shared=True,
            )
        ]
    )
    plan = build_plan(report)
    assert (plan.backend, plan.torch_channel) == ("cpu", "cpu")


def test_intel_arc_140t_igpu_still_cpu() -> None:
    """Lunar Lake 核显名字带数字，不能被当成 Arc 独显。"""
    from app.comfy.platforms.base import is_discrete_gpu, shares_system_memory

    name = "Intel(R) Arc(TM) 140T GPU"
    assert is_discrete_gpu("intel", name) is False
    assert shares_system_memory("intel", name, False) is True


def test_strix_halo_apu_linux_uses_cpu_with_memory_note() -> None:
    """AMD 395+ 是统一内存 APU：不该装 ROCm 独显轮子，提示里要说明内存够大。"""
    plan = build_plan(
        make_report(
            os="linux",
            os_version="Ubuntu 24.04",
            memory_gb=128.0,
            unified_memory=True,
            gpus=[
                GpuInfo(
                    vendor="amd",
                    name="AMD Radeon 8060S Graphics",
                    is_discrete=False,
                    memory_shared=True,
                )
            ],
        )
    )
    assert (plan.tier, plan.backend) == ("limited", "cpu")
    assert any("128 GB" in action.detail for action in plan.actions)


def test_strix_halo_apu_windows_uses_cpu() -> None:
    """Windows 上的 APU 既没有 ROCm 轮子也没有 DirectML 轮子，只能按 CPU 装。"""
    plan = build_plan(
        make_report(
            memory_gb=128.0,
            unified_memory=True,
            gpus=[
                GpuInfo(
                    vendor="amd",
                    name="AMD Radeon 8060S Graphics",
                    is_discrete=False,
                    memory_shared=True,
                )
            ],
        )
    )
    assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
    assert any("128 GB" in action.detail or "统一内存" in action.detail for action in plan.actions)


def test_large_unified_memory_cpu_message_is_not_generic() -> None:
    plan = build_plan(make_report(gpus=[], memory_gb=128.0, unified_memory=True))
    action = next(item for item in plan.actions if "CPU" in item.title)
    assert "128 GB" in action.detail
    assert "数倍到数十倍" not in action.detail


def test_arm64_linux_blocked_like_dgx_spark() -> None:
    """GB10 能被识别成 NVIDIA，但 ARM Linux 没有内置运行时包，必须明确挡住。"""
    plan = build_plan(
        make_report(
            os="linux",
            os_version="Ubuntu 24.04",
            arch="arm64",
            memory_gb=128.0,
            unified_memory=True,
            gpus=[
                GpuInfo(
                    vendor="nvidia",
                    name="NVIDIA GB10",
                    driver_version="580.00",
                    compute_cap="12.1",
                    is_discrete=True,
                )
            ],
        )
    )
    assert plan.tier == "blocked"
    assert "arm64" in (plan.blocked_reason or "")
    assert any(action.level == "block" for action in plan.actions)


def test_windows_amd_never_emits_uninstallable_channel() -> None:
    """不管系统装的是 3.12 还是 3.13，Windows AMD 都不能选 rocm / directml。"""
    for pythons in (("3.12.3",), ("3.13.5",), ()):
        plan = build_plan(
            make_report(
                pythons=pythons,
                gpus=[GpuInfo(vendor="amd", name="AMD Radeon RX 7900 XTX", is_discrete=True)],
            )
        )
        assert (plan.tier, plan.backend, plan.torch_channel) == ("limited", "cpu", "cpu")
        assert plan.torch_channel not in {"rocm7.2", "rocm6.4", "directml"}


def test_every_channel_has_an_install_recipe() -> None:
    """plan 可能产出的通道必须在 installer 里有对应索引或特殊包，别再出现空映射。"""
    from app.comfy.installer import SPECIAL_PACKAGES, TORCH_INDEX

    channels = {"cu130", "cu126", "rocm7.2", "rocm6.4", "xpu", "cpu", "mps", "directml"}
    assert channels <= (set(TORCH_INDEX) | set(SPECIAL_PACKAGES))
