"""ComfyUI 安装方案推导（M2 plan）。

纯函数：只根据 DeviceReport 计算方案，不读写文件、不联网、不启动子进程、
不读环境变量。输出全部是语义字段（tier / backend / torch_channel ...），
具体 pip 命令与索引地址由 installer 层按 comfy-cli 的当前版本拼装。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

from ..config import COMFY_ENV_NAME
from .models import DeviceReport, GpuInfo, MirrorProbe

# 安装 ComfyUI 环境（venv + torch + 依赖）所需空间
ENV_REQUIRED_GB = 8.0
# 低于这个值只够装环境，放不下大模型
DISK_COMFORT_GB = 20.0
# ComfyUI 自身的最低 Python 要求
MIN_PYTHON = (3, 10)
# 内置解释器的版本边界：只用于统计"本机是否存在可信且版本合适的解释器"
# （API 的 python_available 字段），安装本身一律使用内置 3.13.18，不挑系统 Python。
MAX_PYTHON = (3, 13)
# NVIDIA 驱动门槛：低于 527 装不了 cu126；580 起可用 cu130
NVIDIA_DRIVER_MIN = 527
NVIDIA_DRIVER_CU130 = 580
# Turing（含）之后的算力下限
NVIDIA_MIN_COMPUTE_CAP = 7.5

# 内置便携 Python 目前只上架了这三个组合。其它架构（ARM Linux 工作站、
# Windows on ARM、Intel Mac）必须明确挡住，否则 pip 会装到错误架构的解释器上。
RUNTIME_PLATFORMS = {
    ("windows", "x86_64"),
    ("linux", "x86_64"),
    ("macos", "arm64"),
}
# 统一内存机器（Strix Halo / GB10 / Apple Silicon）按系统内存判断能装多大模型
LARGE_MEMORY_GB = 64.0
LOW_MEMORY_GB = 16.0

NVIDIA_DRIVER_URL = "https://www.nvidia.com/Download/index.aspx"

ACTION_LEVELS = ("info", "warn", "block")
TIERS = ("full", "limited", "blocked")


class Action(BaseModel):
    """给用户看的一条待办 / 提示。"""

    level: str = Field(description="info | warn | block")
    title: str = Field(description="用户该做什么；不放技术名词")
    detail: str = Field(description="技术细节与判断依据")
    url: str | None = Field(default=None, description="可点的下载页 / 文档")


class InstallPlan(BaseModel):
    """一次安装的完整方案，供 installer 层翻译成具体命令。"""

    tier: str = Field(description="full | limited | blocked")
    backend: str = Field(description="cuda | rocm | directml | xpu | mps | cpu")
    torch_channel: str = Field(description="语义通道，如 cu130 / rocm7.2，不是 URL")
    torch_index: str = Field(default="", description="实测选出的 torch 索引 URL；空表示用默认")
    pip_index: str = Field(default="", description="实测选出的 PyPI 索引 URL；空表示用默认")
    torch_index_note: str = Field(default="", description="选中 torch 源的说明，如 南大 · 实测 2.2 MB/s")
    pip_index_note: str = Field(default="", description="选中 PyPI 源的说明")
    python_version: str = Field(description="建议使用的主版本，如 3.13")
    python_available: bool = Field(description="本机是否已有 >= 3.10 的可信解释器")
    python_source: str = Field(
        default="system",
        description="system | download。download 表示安装时下载内置运行时，不再要求用户自备 Python",
    )
    disk_ok: bool = Field(description="目标盘是否够装")
    disk_required_gb: float = ENV_REQUIRED_GB
    actions: list[Action] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    blocked_reason: str | None = None


@dataclass(frozen=True)
class _Choice:
    """决策矩阵算出来的后端选型，磁盘 / Python 之后再补。"""

    tier: str
    backend: str
    torch_channel: str
    python_version: str


def build_plan(report: DeviceReport, mirrors: list[MirrorProbe] | None = None) -> InstallPlan:
    """根据探测结果推导安装方案。

    mirrors 是 probe_mirrors() 的测速结果。传了就用实测最快的源，
    没传（或全部不可用）就留空，由 installer 用默认顺序。
    """
    warnings = list(report.warnings)
    actions: list[Action] = []
    block_reasons: list[str] = []

    gpu = _usable_gpu(report)
    choice = _choose_backend(report, gpu, warnings, actions, block_reasons)

    python_available, python_source = _resolve_python(report, choice.python_version, actions)
    disk_ok, disk_required = _resolve_disk(report, actions, block_reasons)
    _check_runtime(report, actions, block_reasons)

    tier = "blocked" if block_reasons else choice.tier
    return InstallPlan(
        tier=tier,
        backend=choice.backend,
        torch_channel=choice.torch_channel,
        torch_index=_pick_index(mirrors, "torch", choice.torch_channel),
        pip_index=_pick_index(mirrors, "pip", ""),
        torch_index_note=_index_note(mirrors, "torch", choice.torch_channel),
        pip_index_note=_index_note(mirrors, "pip", ""),
        python_version=choice.python_version,
        python_available=python_available,
        python_source=python_source,
        disk_ok=disk_ok,
        disk_required_gb=disk_required,
        actions=actions,
        warnings=warnings,
        blocked_reason="；".join(block_reasons) if block_reasons else None,
    )


# ---------------- 显卡选型 ----------------
def _choose_backend(
    report: DeviceReport,
    gpu: GpuInfo | None,
    warnings: list[str],
    actions: list[Action],
    block_reasons: list[str],
) -> _Choice:
    if gpu is None:
        actions.append(_cpu_action(report, "没有检测到可用的独立显卡"))
        return _Choice("limited", "cpu", "cpu", "3.13")

    vendor = (gpu.vendor or "unknown").lower()
    if vendor == "nvidia":
        return _nvidia_choice(gpu, warnings, actions, block_reasons)
    if vendor == "amd":
        return _amd_choice(report, gpu, actions)
    if vendor == "ascend":
        # 昇腾走 CANN + torch_npu，驱动与运行时由系统提供，pip 装不了也不该猜
        actions.append(
            Action(
                level="warn",
                title="将以 CPU 运行，NPU 加速需另行配置",
                detail=(
                    f"检测到 {gpu.name}。昇腾依赖系统里的 CANN 驱动和 torch_npu，"
                    "本项目不会自动安装这一套；本次先按 CPU 装好 ComfyUI，"
                    "确认 NPU 驱动可用后可手动接入，不影响出图。"
                ),
            )
        )
        return _Choice("limited", "cpu", "cpu", "3.13")
    if vendor == "intel":
        if gpu.memory_shared or not gpu.is_discrete:
            actions.append(_cpu_action(report, "检测到的是 Intel 核显，加速只对 Arc 独立显卡可用"))
            return _Choice("limited", "cpu", "cpu", "3.13")
        actions.append(
            Action(
                level="warn",
                title="可以安装，但部分功能可能不可用",
                detail=(
                    f"检测到 {gpu.name}。Intel XPU 后端目前仍属实验性，"
                    "部分算子或模型可能报错，性能也不稳定。"
                ),
            )
        )
        return _Choice("limited", "xpu", "xpu", "3.13")
    if vendor == "apple":
        return _apple_choice(report, actions)

    # 未知厂商：不猜，按 CPU 保守处理
    actions.append(_cpu_action(report, f"显卡厂商无法识别（{gpu.name}）"))
    return _Choice("limited", "cpu", "cpu", "3.13")


def _nvidia_choice(
    gpu: GpuInfo,
    warnings: list[str],
    actions: list[Action],
    block_reasons: list[str],
) -> _Choice:
    name = gpu.name or "NVIDIA 显卡"
    compute_cap = _parse_compute_cap(gpu.compute_cap)
    driver = _version_tuple(gpu.driver_version)
    driver_major = driver[0] if driver else None

    # 驱动低于 CUDA 12.x 最低门槛时，不论架构新旧都跑不起来——这条必须挡在架构判断之前。
    # 否则老卡（cc < 7.5）会先命中"limited / cu126"，而 cu126 同样要求 527+ 驱动，
    # 装下去必然失败。
    if driver_major is not None and driver_major < NVIDIA_DRIVER_MIN:
        block_reasons.append(
            f"显卡驱动版本过低（需要 {NVIDIA_DRIVER_MIN} 或更新，当前 {gpu.driver_version}）"
        )
        actions.append(
            Action(
                level="block",
                title="需要升级显卡驱动",
                detail=(
                    f"当前驱动为 {gpu.driver_version}，低于 CUDA 12.x 的最低要求 {NVIDIA_DRIVER_MIN}。"
                    f"任何版本的 PyTorch GPU 构建都无法在此驱动上运行，请升级到 "
                    f"{NVIDIA_DRIVER_CU130} 或更新版本后重新检测。"
                ),
                url=NVIDIA_DRIVER_URL,
            )
        )
        return _Choice("blocked", "cuda", "cu126", "3.13")

    # 算力未知：按老架构保守处理，不猜它是新卡
    if compute_cap is None:
        warnings.append("未能读取显卡算力（compute_cap），已按保守方案（cu126）处理")
        actions.append(
            Action(
                level="warn",
                title="按兼容模式安装（未能识别显卡架构）",
                detail=(
                    f"{name} 的算力信息读取失败，无法判断架构新旧。"
                    "已选择兼容性最好的 CUDA 12.6（cu126）组合；"
                    "若确认是 RTX 20 系及以后，升级驱动后可改用更新的通道。"
                ),
            )
        )
        return _Choice("limited", "cuda", "cu126", "3.13")

    if compute_cap < NVIDIA_MIN_COMPUTE_CAP:
        actions.append(
            Action(
                level="warn",
                title="可以安装，但新模型支持有限",
                detail=(
                    f"{name} 的算力为 {compute_cap:.1f}，属于 Pascal / Maxwell / Volta 一代的老架构，"
                    "只能使用 CUDA 12.6（cu126）。多数模型能跑，但 FP8、新版 attention 优化等新特性"
                    "不可用或明显更慢。"
                ),
            )
        )
        return _Choice("limited", "cuda", "cu126", "3.13")

    # 新架构：再按驱动分档
    if driver_major is None:
        warnings.append(f"未能读取 NVIDIA 驱动版本（{gpu.driver_version or '空'}），已选择兼容性优先的 cu126")
        actions.append(
            Action(
                level="info",
                title="按兼容模式安装（未能读取驱动版本）",
                detail=(
                    "无法解析当前驱动版本，为避免装出不匹配的包，"
                    "本次使用 CUDA 12.6（cu126）。"
                ),
            )
        )
        return _Choice("full", "cuda", "cu126", "3.13")

    if driver_major >= NVIDIA_DRIVER_CU130:
        return _Choice("full", "cuda", "cu130", "3.13")

    if driver_major >= NVIDIA_DRIVER_MIN:
        actions.append(
            Action(
                level="info",
                title="升级显卡驱动可使用最新加速",
                detail=(
                    f"当前驱动为 {gpu.driver_version}，CUDA 13.0（cu130）需要 {NVIDIA_DRIVER_CU130} 或更新。"
                    "本次将使用 CUDA 12.6（cu126），功能完整，只是少了最新版本的性能优化。"
                ),
                url=NVIDIA_DRIVER_URL,
            )
        )
        return _Choice("full", "cuda", "cu126", "3.13")

    # 驱动已确认 >= NVIDIA_DRIVER_MIN，但不足以使用 cu130
    return _Choice("full", "cuda", "cu126", "3.13")


def _amd_choice(report: DeviceReport, gpu: GpuInfo, actions: list[Action]) -> _Choice:
    os_name = (report.os or "").lower()
    # 集成显卡 / APU（Strix Halo 395+、Radeon 8x0M 等）共用系统内存，
    # sysfs / 注册表里那点"显存"只是预留量，不能按独显方案装 ROCm
    apu = gpu.memory_shared or not gpu.is_discrete

    if os_name == "linux":
        if report.is_wsl:
            # ROCm 官方不支持 WSL，WSL 内的 AMD 卡无法走 HIP
            actions.append(_cpu_action(report, "ROCm 不支持 WSL，WSL 内的 AMD 显卡无法加速"))
            return _Choice("limited", "cpu", "cpu", "3.13")
        if apu:
            memory_note = (
                f"机器有 {report.memory_gb:.0f} GB 统一内存，能加载较大模型，但速度仍明显慢于独显。"
                if report.memory_gb
                else ""
            )
            actions.append(
                Action(
                    level="warn",
                    title="将以 CPU 运行，集成显卡暂不自动加速",
                    detail=(
                        f"{gpu.name} 是集成显卡，与 CPU 共用系统内存；ROCm 官方只覆盖部分独立显卡，"
                        f"本次按 CPU 安装，避免装上一个无法使用的加速库。{memory_note}"
                        "如果系统已单独装好对应架构的 ROCm，可手动切换。"
                    ),
                )
            )
            return _Choice("limited", "cpu", "cpu", "3.13")
        return _Choice("full", "rocm", "rocm7.2", "3.13")

    if os_name == "windows":
        # 内置 Python 固定 3.13.18（cp313）。实测 PyTorch 官方 ROCm 索引
        # （rocm7.2 / 7.1 / 7.0 / 6.4 / 6.3）只有 Linux 轮子，没有 win_amd64；
        # torch-directml 最高只发布到 cp312。两条 Windows AMD 加速路都装不上，
        # 与其给一个注定失败的安装方案，不如如实按 CPU 装好 ComfyUI。
        memory_note = (
            f"这台机器有 {report.memory_gb:.0f} GB 统一内存，能加载较大的模型。"
            if report.unified_memory and (report.memory_gb or 0) >= LARGE_MEMORY_GB
            else ""
        )
        actions.append(
            Action(
                level="warn",
                title="将以 CPU 运行，Windows 上的 AMD 加速暂不可用",
                detail=(
                    f"检测到 {gpu.name}。内置 Python 是 3.13，而 PyTorch 官方的 ROCm "
                    "轮子目前只提供 Linux 版，DirectML 插件也还没出 3.13 版；"
                    "为避免装上用不了的加速库，本次按 CPU 安装，ComfyUI 仍可出图但速度慢。"
                    f"{memory_note}等官方补齐对应轮子后会自动启用加速。"
                ),
            )
        )
        return _Choice("limited", "cpu", "cpu", "3.13")

    # macOS 上没有现代 AMD 驱动，按 CPU 处理
    actions.append(_cpu_action(report, "当前系统没有可用的现代 AMD 显卡驱动"))
    return _Choice("limited", "cpu", "cpu", "3.13")


def _apple_choice(report: DeviceReport, actions: list[Action]) -> _Choice:
    if (report.os or "").lower() == "macos" and (report.arch or "").lower() == "arm64":
        return _Choice("full", "mps", "mps", "3.13")

    actions.append(
        Action(
            level="warn",
            title="将以 CPU 运行，生成速度很慢",
            detail=(
                f"这台 Mac 的架构为 {report.arch or '未知'}，无法使用 Metal 加速（MPS）。"
                "Intel 芯片的 Mac 只能以 CPU 运行。"
            ),
        )
    )
    return _Choice("limited", "cpu", "cpu", "3.13")


def _cpu_action(report: DeviceReport, reason: str) -> Action:
    found = "、".join(gpu.name for gpu in report.gpus if gpu.name) or "无"
    detail = f"{reason}（探测到的显示适配器：{found}）。"
    memory = report.memory_gb or 0
    if report.unified_memory and memory >= LARGE_MEMORY_GB:
        # 128GB 的 Spark / Strix Halo 和 8GB 笔记本都走 CPU，但不能给同一句结论
        detail += (
            f"这台机器有 {memory:.0f} GB 统一内存，能加载较大的模型，"
            "只是生成速度仍明显慢于显卡加速。"
        )
    elif memory and memory < LOW_MEMORY_GB:
        detail += f"系统内存只有 {memory:.0f} GB，较大的模型可能装不下，生成速度也很慢。"
    else:
        detail += "CPU 可以出图，但耗时通常是显卡的数倍到数十倍。"
    if report.warnings:
        detail += " 探测过程中还有告警，详见 warnings。"
    return Action(level="warn", title="将以 CPU 运行，生成速度很慢", detail=detail)


def _usable_gpu(report: DeviceReport) -> GpuInfo | None:
    """挑出真正能算的显卡。

    虚拟显示器（Parsec / GameViewer 之类）和厂商未知的适配器不算数；
    primary_gpu 不可用时退回到 gpus 里继续找。
    """
    candidates: list[GpuInfo] = []
    if report.primary_gpu is not None:
        candidates.append(report.primary_gpu)
    candidates.extend(report.gpus)
    for gpu in candidates:
        vendor = (gpu.vendor or "").lower()
        if _is_virtual(gpu) or vendor == "unknown":
            continue
        # Intel 核显（UHD / Iris / Arc 140T）没有 XPU 轮子，别把它当加速卡
        if vendor == "intel" and (gpu.memory_shared or not gpu.is_discrete):
            continue
        return gpu
    return None


def _is_virtual(gpu: GpuInfo) -> bool:
    name = (gpu.name or "").lower()
    return "virtual" in name or "remote" in name


# ---------------- Python ----------------
def _resolve_python(report: DeviceReport, suggested: str, actions: list[Action]) -> tuple[bool, str]:
    """返回 (本机是否有可信解释器, 来源 system|download)，并产出一条说明。

    架构改成内置便携 Python 之后，安装**不再使用**系统里的任何解释器：
    `suggested` 和各 _Choice 里的 3.12/3.13 是早期"从本机挑 Python"时代的
    遗留值，仅保留字段兼容，不能再拿它写面向用户的文案（否则会出现
    「将下载内置 Python 3.12」而实际装的是 3.13.18）。
    这里仍统计本机解释器来填 python_available，但提示统一说明内置版本。
    """
    del suggested
    trusted = [info for info in report.pythons if info.trusted]
    parsed = [_parse_python(info.version) for info in trusted]
    has_usable = any(v and MIN_PYTHON <= v <= MAX_PYTHON for v in parsed)

    actions.append(
        Action(
            level="info",
            title=f"将使用内置 Python {COMFY_ENV_NAME}",
            detail=(
                "运行时随安装自动准备，不依赖系统里已装的 Python；"
                "所有 ComfyUI 版本共用这一套。"
            ),
        )
    )
    return has_usable, "system" if has_usable else "download"


# ---------------- 磁盘 ----------------
def _resolve_disk(
    report: DeviceReport, actions: list[Action], block_reasons: list[str]
) -> tuple[bool, float]:
    if not report.disks:
        block_reasons.append("未能读取目标磁盘的可用空间")
        actions.append(
            Action(
                level="block",
                title="无法确认磁盘空间",
                detail=(
                    f"探测结果里没有磁盘信息。安装环境至少需要 {ENV_REQUIRED_GB:.0f} GB，"
                    "请先确认目标盘剩余空间充足。"
                ),
            )
        )
        return False, ENV_REQUIRED_GB

    # 后续 installer 会把实例装到最大盘，这里用同一块盘做判断
    disk = max(report.disks, key=lambda item: item.free_gb)

    if disk.free_gb < ENV_REQUIRED_GB:
        block_reasons.append(
            f"磁盘空间不足（需要 {ENV_REQUIRED_GB:.0f} GB，{disk.path} 仅剩 {disk.free_gb:.1f} GB）"
        )
        actions.append(
            Action(
                level="block",
                title="目标磁盘空间不足",
                detail=(
                    f"安装 ComfyUI 环境至少需要 {ENV_REQUIRED_GB:.0f} GB"
                    f"（虚拟环境 + PyTorch + 依赖），{disk.path} 当前只剩 {disk.free_gb:.1f} GB。"
                    "请清理空间或换一块更大的磁盘。"
                ),
            )
        )
        return False, ENV_REQUIRED_GB

    if disk.free_gb < DISK_COMFORT_GB:
        actions.append(
            Action(
                level="warn",
                title="磁盘空间偏紧，可能放不下模型",
                detail=(
                    f"{disk.path} 剩余 {disk.free_gb:.1f} GB，装完环境后约剩 "
                    f"{disk.free_gb - ENV_REQUIRED_GB:.1f} GB。常见模型单个 2–20 GB，"
                    "建议预留更多空间。"
                ),
            )
        )

    return True, ENV_REQUIRED_GB


# ---------------- 内置运行时兼容性 ----------------
def _check_runtime(
    report: DeviceReport, actions: list[Action], block_reasons: list[str]
) -> None:
    """内置 Python 是绑死版本的便携包，架构不匹配时不能让它静默装错。

    DGX Spark / Grace 这类 ARM Linux 统一内存工作站、Windows on ARM、
    Intel Mac 都会被挡在这里，而不是等 pip 装到一半才发现解释器跑不起来。
    """
    key = ((report.os or "").lower(), (report.arch or "").lower())
    if key in RUNTIME_PLATFORMS:
        return
    block_reasons.append(f"尚未为 {report.os} / {report.arch} 准备内置运行环境")
    actions.append(
        Action(
            level="block",
            title="这台设备的架构还不支持",
            detail=(
                f"本机是 {report.os} / {report.arch}（例如 ARM 工作站、DGX Spark、Intel Mac）。"
                "内置便携 Python 目前只有 Windows x86_64、Linux x86_64、macOS arm64 三个包，"
                "直接安装会拿到架构不匹配的解释器。需要先给这个架构补一份对应的运行时包。"
            ),
        )
    )


# ---------------- 解析工具 ----------------
def _parse_compute_cap(text: str | None) -> float | None:
    if not text:
        return None
    match = re.match(r"\s*(\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else None


def _version_tuple(text: str | None) -> tuple[int, ...]:
    if not text:
        return ()
    return tuple(int(part) for part in re.findall(r"\d+", text))


def _parse_python(text: str | None) -> tuple[int, int] | None:
    if not text:
        return None
    match = re.match(r"\s*(\d+)\.(\d+)", text)
    return (int(match.group(1)), int(match.group(2))) if match else None


def _pick_index(mirrors: list[MirrorProbe] | None, kind: str, channel: str) -> str:
    """从测速结果里挑同类型里最快的可用源。"""
    if not mirrors:
        return ""
    candidates = [
        item
        for item in mirrors
        if item.kind == kind and item.ok and (not channel or item.channel == channel)
    ]
    if not candidates:
        return ""
    return max(candidates, key=lambda item: item.speed_kbps).url


def _index_note(mirrors: list[MirrorProbe] | None, kind: str, channel: str) -> str:
    """选中源的说明：把实测速度写出来，用户一眼能看出不是写死的。"""
    if not mirrors:
        return ""
    candidates = [
        item
        for item in mirrors
        if item.kind == kind and item.ok and (not channel or item.channel == channel)
    ]
    if not candidates:
        return ""
    best = max(candidates, key=lambda item: item.speed_kbps)
    return f"{best.label} · 实测 {best.speed_kbps / 1024:.1f} MB/s"
