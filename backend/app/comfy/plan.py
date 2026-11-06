"""ComfyUI 安装方案推导（M2 plan）。

纯函数：只根据 DeviceReport 计算方案，不读写文件、不联网、不启动子进程、
不读环境变量。输出全部是语义字段（tier / backend / torch_channel ...），
具体 pip 命令与索引地址由 installer 层按 comfy-cli 的当前版本拼装。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

from .models import DeviceReport, GpuInfo

# 安装 ComfyUI 环境（venv + torch + 依赖）所需空间
ENV_REQUIRED_GB = 8.0
# 低于这个值只够装环境，放不下大模型
DISK_COMFORT_GB = 20.0
# ComfyUI 自身的最低 Python 要求
MIN_PYTHON = (3, 10)
# PyTorch 官方轮子当前覆盖到的最高 Python。高于此版本即使装了也拿不到 torch 轮子，
# 因此不能因为"本机有 3.14"就选它——宁可提示用户装 3.12/3.13。
MAX_PYTHON = (3, 13)
# NVIDIA 驱动门槛：低于 527 装不了 cu126；580 起可用 cu130
NVIDIA_DRIVER_MIN = 527
NVIDIA_DRIVER_CU130 = 580
# Turing（含）之后的算力下限
NVIDIA_MIN_COMPUTE_CAP = 7.5
# Windows 11 起始 build
WIN11_BUILD = 22000

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
    python_version: str = Field(description="建议使用的主版本，如 3.13")
    python_available: bool = Field(description="本机是否已有 >= 3.10 的解释器")
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


def build_plan(report: DeviceReport) -> InstallPlan:
    """根据探测结果推导安装方案。纯函数，多次调用结果一致。"""
    warnings = list(report.warnings)
    actions: list[Action] = []
    block_reasons: list[str] = []

    gpu = _usable_gpu(report)
    choice = _choose_backend(report, gpu, warnings, actions, block_reasons)

    python_available = _resolve_python(report, choice.python_version, actions)
    disk_ok, disk_required = _resolve_disk(report, actions, block_reasons)

    tier = "blocked" if block_reasons else choice.tier
    return InstallPlan(
        tier=tier,
        backend=choice.backend,
        torch_channel=choice.torch_channel,
        python_version=choice.python_version,
        python_available=python_available,
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
        return _Choice("limited", "cpu", "cpu", "3.12")

    vendor = (gpu.vendor or "unknown").lower()
    if vendor == "nvidia":
        return _nvidia_choice(gpu, warnings, actions, block_reasons)
    if vendor == "amd":
        return _amd_choice(report, actions)
    if vendor == "intel":
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
        return _Choice("limited", "xpu", "xpu", "3.12")
    if vendor == "apple":
        return _apple_choice(report, actions)

    # 未知厂商：不猜，按 CPU 保守处理
    actions.append(_cpu_action(report, f"显卡厂商无法识别（{gpu.name}）"))
    return _Choice("limited", "cpu", "cpu", "3.12")


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
        return _Choice("blocked", "cuda", "cu126", "3.12")

    # 算力未知：按老架构保守处理，不猜它是新卡
    if compute_cap is None:
        warnings.append("未能读取显卡算力（compute_cap），已按保守方案（cu126 / Python 3.12）处理")
        actions.append(
            Action(
                level="warn",
                title="按兼容模式安装（未能识别显卡架构）",
                detail=(
                    f"{name} 的算力信息读取失败，无法判断架构新旧。"
                    "已选择兼容性最好的 CUDA 12.6（cu126）+ Python 3.12 组合；"
                    "若确认是 RTX 20 系及以后，升级驱动后可改用更新的通道。"
                ),
            )
        )
        return _Choice("limited", "cuda", "cu126", "3.12")

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
        return _Choice("limited", "cuda", "cu126", "3.12")

    # 新架构：再按驱动分档
    if driver_major is None:
        warnings.append(f"未能读取 NVIDIA 驱动版本（{gpu.driver_version or '空'}），已选择兼容性优先的 cu126")
        actions.append(
            Action(
                level="info",
                title="按兼容模式安装（未能读取驱动版本）",
                detail=(
                    "无法解析当前驱动版本，为避免装出不匹配的包，"
                    "本次使用 CUDA 12.6（cu126）+ Python 3.12。"
                ),
            )
        )
        return _Choice("full", "cuda", "cu126", "3.12")

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
        return _Choice("full", "cuda", "cu126", "3.12")

    # 驱动已确认 >= NVIDIA_DRIVER_MIN，但不足以使用 cu130
    return _Choice("full", "cuda", "cu126", "3.12")


def _amd_choice(report: DeviceReport, actions: list[Action]) -> _Choice:
    os_name = (report.os or "").lower()

    if os_name == "linux":
        if report.is_wsl:
            # ROCm 官方不支持 WSL，WSL 内的 AMD 卡无法走 HIP
            actions.append(_cpu_action(report, "ROCm 不支持 WSL，WSL 内的 AMD 显卡无法加速"))
            return _Choice("limited", "cpu", "cpu", "3.12")
        return _Choice("full", "rocm", "rocm7.2", "3.12")

    if os_name == "windows":
        build = _windows_build(report)
        has_313 = (3, 13) in _parsed_pythons(report)
        if build is not None and build >= WIN11_BUILD and has_313:
            return _Choice("full", "rocm", "rocm7.2", "3.13")
        actions.append(
            Action(
                level="warn",
                title="可以安装，但速度会明显低于预期",
                detail=(
                    f"当前系统为 {report.os_version or 'Windows'}，AMD 显卡只能使用 DirectML 后端，"
                    "性能明显低于 ROCm。升级到 Windows 11 并安装 Python 3.13 后，"
                    "可切换到 ROCm 通道获得更好性能。"
                ),
            )
        )
        return _Choice("limited", "directml", "directml", "3.12")

    # macOS 上没有现代 AMD 驱动，按 CPU 处理
    actions.append(_cpu_action(report, "当前系统没有可用的现代 AMD 显卡驱动"))
    return _Choice("limited", "cpu", "cpu", "3.12")


def _apple_choice(report: DeviceReport, actions: list[Action]) -> _Choice:
    if (report.os or "").lower() == "macos" and (report.arch or "").lower() == "arm64":
        return _Choice("full", "mps", "mps", "3.12")

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
    return _Choice("limited", "cpu", "cpu", "3.12")


def _cpu_action(report: DeviceReport, reason: str) -> Action:
    found = "、".join(gpu.name for gpu in report.gpus if gpu.name) or "无"
    detail = f"{reason}（探测到的显示适配器：{found}）。CPU 可以出图，但耗时通常是显卡的数倍到数十倍。"
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
        if _is_virtual(gpu) or (gpu.vendor or "").lower() == "unknown":
            continue
        return gpu
    return None


def _is_virtual(gpu: GpuInfo) -> bool:
    name = (gpu.name or "").lower()
    return "virtual" in name or "remote" in name


# ---------------- Python ----------------
def _resolve_python(report: DeviceReport, suggested: str, actions: list[Action]) -> bool:
    parsed = [(version, info.path) for info in report.pythons if (version := _parse_python(info.version))]
    versions = {version for version, _ in parsed}
    supported = sorted(version for version in versions if MIN_PYTHON <= version <= MAX_PYTHON)
    too_new = sorted(version for version in versions if version > MAX_PYTHON)

    if _parse_python(suggested) in supported:
        return True

    if supported:
        # 优先用不高于建议值的最高版本：新于建议值的解释器未必有对应的 torch 轮子
        target = _parse_python(suggested) or MIN_PYTHON
        not_newer = [version for version in supported if version <= target]
        best = not_newer[-1] if not_newer else supported[0]
        path = next(path for version, path in parsed if version == best)
        actions.append(
            Action(
                level="info",
                title=f"将使用本机已有的 Python {best[0]}.{best[1]}",
                detail=(
                    f"建议使用 Python {suggested}，但本机没有安装；"
                    f"改为使用已检测到的 {best[0]}.{best[1]}（{path}），功能不受影响。"
                ),
            )
        )
        return True

    # 有 Python 但都超出 PyTorch 轮子的覆盖范围（例如只有 3.14）
    if too_new:
        newest = too_new[-1]
        actions.append(
            Action(
                level="warn",
                title=f"需要安装 Python {suggested}",
                detail=(
                    f"检测到 Python {newest[0]}.{newest[1]}，但 PyTorch 官方轮子尚未覆盖该版本，"
                    f"装不上可用的 GPU 构建。请安装 Python {suggested} 后继续。"
                ),
            )
        )
        return False

    actions.append(
        Action(
            level="warn",
            title=f"需要先安装 Python {suggested}",
            detail=(
                "没有检测到 Python 3.10 或更新的解释器，而 ComfyUI 至少需要 Python 3.10。"
                "请先安装后再继续。"
            ),
        )
    )
    return False


def _parsed_pythons(report: DeviceReport) -> set[tuple[int, int]]:
    return {version for info in report.pythons if (version := _parse_python(info.version))}


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


def _windows_build(report: DeviceReport) -> int | None:
    match = re.search(r"\d+", report.os_build or "")
    if match:
        return int(match.group(0))
    match = re.search(r"\((\d+)\)", report.os_version or "")
    if match:
        return int(match.group(1))
    match = re.search(r"\b(\d{5,})\b", report.os_version or "")
    return int(match.group(1)) if match else None
