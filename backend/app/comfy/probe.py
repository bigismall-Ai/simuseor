"""设备探测编排：OS / Python / 磁盘 / 已有安装 + 调用平台 GPU 采集。

全程只读：不创建目录、不写配置、不装包、不改注册表。
任何单项失败只写入 warnings，整体仍返回 DeviceReport。
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import platform
import re
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

from urllib.parse import urljoin

import httpx

from ..config import COMFY_DIR, COMFY_ENV_DIR, COMFY_ENV_NAME, ROOT
from .models import (
    DeviceReport,
    DiskInfo,
    GpuInfo,
    ManagedInstance,
    MirrorProbe,
    PythonInfo,
    RuntimeStatus,
)
from .platforms import LinuxGpuProbe, MacOSGpuProbe, ProbeContext, WindowsGpuProbe

GPU_PROBES = {
    "windows": WindowsGpuProbe,
    "linux": LinuxGpuProbe,
    "macos": MacOSGpuProbe,
}

COMMON_PYTHON_NAMES = ("python3", "python3.13", "python3.12", "python3.11")
T = TypeVar("T")


def probe_device() -> DeviceReport:
    """完整探测：硬件 + Python + 磁盘 + 实例。

    每次调用都是新鲜结果，给安装预演 / CLI 用；页面和推荐走
    `current_device_report()` —— 硬件读进程级快照，环境部分现扫。
    """
    ctx = ProbeContext()
    report = _probe_hardware(ctx)
    report.pythons = _guard(ctx, "Python", lambda: _collect_pythons(ctx), [])
    report.disks = _guard(ctx, "磁盘", lambda: _collect_disks(report.os), [])
    report.instances = _guard(ctx, "自有实例", lambda: _collect_instances(ctx), [])
    report.warnings = list(ctx.warnings)
    report.raw = dict(ctx.raw)
    return report


def _probe_hardware(ctx: ProbeContext | None = None) -> DeviceReport:
    """只采集进程生命周期内不变的硬件事实（GPU / 内存 / OS / 架构）。"""
    ctx = ctx if ctx is not None else ProbeContext()
    os_name = detect_os()

    gpus: list[GpuInfo] = []
    try:
        gpus = GPU_PROBES[os_name]().probe(ctx)
    except Exception as exc:  # noqa: BLE001 - 单项失败不中断
        ctx.warnings.append(f"GPU 探测失败: {exc}")

    primary = _pick_primary(gpus)
    os_version, os_build = _guard(ctx, "操作系统版本", lambda: _describe_os(os_name), ("", ""))
    is_wsl = _guard(ctx, "WSL", lambda: _is_wsl(os_name, ctx), False)
    memory_gb = _guard(ctx, "内存", lambda: _system_memory_gb(os_name, ctx), None)
    arch = _detect_arch()

    return DeviceReport(
        os=os_name,
        os_version=os_version,
        os_build=os_build,
        arch=arch,
        is_wsl=is_wsl,
        memory_gb=memory_gb,
        unified_memory=_is_unified_memory(os_name, arch, gpus),
        gpus=gpus,
        primary_gpu=primary,
        warnings=list(ctx.warnings),
        raw=dict(ctx.raw),
        probed_at=datetime.now().astimezone().isoformat(timespec="seconds"),
    )


def _pick_primary(gpus: list[GpuInfo]) -> GpuInfo | None:
    """独显优先、未知厂商（虚拟显示器等）最后。"""
    gpus.sort(key=lambda gpu: (not gpu.is_discrete, gpu.vendor == "unknown"))
    primary = next((gpu for gpu in gpus if gpu.is_discrete), None)
    if primary is None:
        primary = next((gpu for gpu in gpus if gpu.vendor != "unknown"), gpus[0] if gpus else None)
    return primary


# ---------------- 进程级硬件快照 ----------------
# 换硬件必然要重启服务，所以硬件事实在进程生命周期内是常量：启动时后台探一次
# （main.py 的 lifespan），之后环境页 / 模型库 / 发现页读同一份，不再重探。
# 实例、Python、磁盘余量不在这里 —— 它们会变，由 current_device_report() 现扫。
_hardware: DeviceReport | None = None
_hardware_ready = threading.Event()
_hardware_lock = threading.Lock()


def _safe_probe_hardware() -> DeviceReport:
    """探测失败也要给调用方一份可展示的报告，不能让后台线程静默死掉。"""
    try:
        return _probe_hardware()
    except Exception as exc:  # noqa: BLE001
        return DeviceReport(
            os=detect_os(),
            warnings=[f"硬件探测失败: {exc}"],
            probed_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )


def warm_hardware() -> None:
    """后台线程入口：探测一次硬件并挂到进程上。"""
    global _hardware
    with _hardware_lock:
        if _hardware is None:
            _hardware = _safe_probe_hardware()
    _hardware_ready.set()


def hardware_snapshot(timeout: float = 1.5) -> DeviceReport:
    """取进程级硬件快照。

    正常直接命中启动时后台探测的结果。首个请求若抢在预热完成之前，最多等
    timeout 秒；仍拿不到（预热线程未启动或异常，例如 pytest）就地补探一次。
    这是启动竞态兜底，不是周期性重探 —— 硬件变了必须重启服务。
    """
    global _hardware
    if _hardware is None:
        _hardware_ready.wait(timeout)
    with _hardware_lock:
        if _hardware is None:
            _hardware = _safe_probe_hardware()
            _hardware_ready.set()
        return _hardware


def reset_hardware_snapshot() -> None:
    """丢掉硬件快照，下次调用重新探测（测试 / 手动重检用）。"""
    global _hardware
    with _hardware_lock:
        _hardware = None
    _hardware_ready.clear()


def current_device_report() -> DeviceReport:
    """硬件读启动快照，Python / 磁盘 / 实例现扫。

    环境页要看到刚装完的实例和当前磁盘余量，这些不该冻在启动快照里；
    硬件部分则完全复用，不重复跑 nvidia-smi / CIM。
    """
    hw = hardware_snapshot()
    ctx = ProbeContext()
    report = hw.model_copy(deep=True)
    report.pythons = _guard(ctx, "Python", lambda: _collect_pythons(ctx), [])
    report.disks = _guard(ctx, "磁盘", lambda: _collect_disks(report.os), [])
    report.instances = _guard(ctx, "自有实例", lambda: _collect_instances(ctx), [])
    report.warnings = [*hw.warnings, *ctx.warnings]
    report.raw = {**hw.raw, **ctx.raw}
    return report



def detect_os() -> str:
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def _detect_arch() -> str:
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64", "x64"}:
        return "x86_64"
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    return machine


def _guard(ctx: ProbeContext, label: str, func: Callable[[], T], default: T) -> T:
    try:
        return func()
    except Exception as exc:  # noqa: BLE001 - 单项失败不中断
        ctx.warnings.append(f"{label}探测失败: {exc}")
        return default


# ---------------- OS ----------------
def _describe_os(os_name: str) -> tuple[str, str]:
    if os_name == "windows":
        info = sys.getwindowsversion()
        build = int(getattr(info, "build", 0) or 0)
        if build >= 22000:
            name = "11"
        elif info.major >= 10:
            name = "10"
        else:
            name = platform.release()
        return f"{name} ({build})", str(build)
    if os_name == "macos":
        version = platform.mac_ver()[0] or platform.release()
        return version, ""
    return _linux_pretty_name(), ""


def _linux_pretty_name() -> str:
    text = Path("/etc/os-release").read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip().strip('"')
    return platform.release()


def _is_wsl(os_name: str, ctx: ProbeContext) -> bool:
    if os_name != "linux":
        return False
    try:
        text = Path("/proc/version").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    ctx.raw["/proc/version"] = text.strip()
    return "microsoft" in text.lower()


# ---------------- 内存 / 统一内存 ----------------
def _system_memory_gb(os_name: str, ctx: ProbeContext) -> float | None:
    """系统内存总量（GB）。统一内存机器能加载多大模型取决于这个值，而不是显存。"""
    if os.name == "nt":
        import ctypes  # noqa: PLC0415 - 仅 Windows 需要

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_uint32),
                ("dwMemoryLoad", ctypes.c_uint32),
                ("ullTotalPhys", ctypes.c_uint64),
                ("ullAvailPhys", ctypes.c_uint64),
                ("ullTotalPageFile", ctypes.c_uint64),
                ("ullAvailPageFile", ctypes.c_uint64),
                ("ullTotalVirtual", ctypes.c_uint64),
                ("ullAvailVirtual", ctypes.c_uint64),
                ("ullAvailExtendedVirtual", ctypes.c_uint64),
            ]

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return round(status.ullTotalPhys / (1024**3), 1)

    if os_name == "macos":
        result = ctx.exec(["sysctl", "-n", "hw.memsize"], "sysctl hw.memsize", record_warning=False)
        try:
            total = int((result.out or "").strip()) if result else 0
        except ValueError:
            total = 0
        return round(total / (1024**3), 1) if total > 0 else None

    text = Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        if line.startswith("MemTotal:"):
            return round(int(line.split()[1]) / 1048576, 1)
    return None


def _is_unified_memory(os_name: str, arch: str, gpus: list[GpuInfo]) -> bool:
    """整机层面的统一内存架构（UMA）判定。

    只有「主计算显卡也与 CPU 共用同一份内存」才算：Apple Silicon、
    Grace / GB10（DGX Spark）、AMD AI Max+ 395 这类纯 APU。
    机器上只要有带独立显存的显卡，核显共享系统内存就只是显示输出用，
    整机不能算 UMA（否则会把 RTX 4080 + UHD 770 的普通桌面误标成统一内存）。
    """
    if os_name == "macos" and arch == "arm64":
        return True
    # Grace / GB10（DGX Spark）是 ARM + 统一内存，nvidia-smi 仍报"显存"，其实是系统内存
    if os_name == "linux" and arch == "arm64" and any(gpu.vendor == "nvidia" for gpu in gpus):
        return True
    real = [gpu for gpu in gpus if gpu.vendor not in ("", "unknown")]
    if any(gpu.is_discrete for gpu in real):
        return False
    return any(gpu.memory_shared for gpu in real)


# ---------------- Python ----------------
def _collect_pythons(ctx: ProbeContext) -> list[PythonInfo]:
    candidates: list[tuple[str, str]] = []  # (路径, 来源提示)

    if os.name == "nt":
        result = ctx.exec(["py", "-0p"], "py -0p", record_warning=False)
        if result and result.out:
            for match in re.finditer(r"[A-Za-z]:\\[^\r\n]*?\.exe", result.out):
                candidates.append((match.group(0).strip(), "launcher"))
        result = ctx.exec(["where", "python"], "where python", record_warning=False)
        if result and result.out:
            for line in result.out.splitlines():
                path = line.strip()
                if re.match(r"^[A-Za-z]:\\", path):
                    candidates.append((path, "path"))
    else:
        result = ctx.exec(
            ["which", "-a", *COMMON_PYTHON_NAMES], "which -a python3", record_warning=False
        )
        if result and result.out:
            for line in result.out.splitlines():
                path = line.strip()
                if path.startswith("/"):
                    candidates.append((path, "path"))
        # 有些发行版没有把 python3.x 放进 PATH
        for executable in sorted(Path("/usr/bin").glob("python3*")):
            if re.fullmatch(r"python3(\.\d+)?", executable.name):
                candidates.append((str(executable), "system"))
        # pyenv：优先 pyenv versions，命令缺失时退回目录扫描
        result = ctx.exec(["pyenv", "versions", "--bare"], "pyenv versions", record_warning=False)
        pyenv_root = Path.home() / ".pyenv" / "versions"
        if result and result.out:
            for name in result.out.splitlines():
                executable = pyenv_root / name.strip() / "bin" / "python3"
                if executable.is_file():
                    candidates.append((str(executable), "pyenv"))
        else:
            for executable in sorted(pyenv_root.glob("*/bin/python3")):
                candidates.append((str(executable), "pyenv"))
        # Homebrew（Apple Silicon 与 Intel 两套前缀）
        for prefix in (Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
            for executable in sorted(prefix.glob("python3*")):
                if re.fullmatch(r"python3(\.\d+)?", executable.name):
                    candidates.append((str(executable), "homebrew"))

    # 本项目自带的虚拟环境 + ComfyUI 实例的虚拟环境
    candidates.append((str(_venv_python(ROOT / ".venv")), "path"))
    for instance in COMFY_DIR.glob("*"):
        candidates.append((str(_venv_python(instance / "venv")), "path"))
    candidates.append((sys.executable, "path"))

    pythons: list[PythonInfo] = []
    seen: set[str] = set()
    missing_version: list[str] = []
    for raw_path, hint in candidates:
        path = Path(raw_path)
        if os.name == "nt" and "\\windowsapps\\" in raw_path.lower():
            continue  # 应用商店的占位 exe，运行会弹商店
        if not path.is_file():
            continue
        key = os.path.normcase(os.path.realpath(path))
        if key in seen:
            continue
        seen.add(key)
        version = _python_version(str(path), ctx)
        if not version:
            missing_version.append(str(path))
        pythons.append(
            PythonInfo(
                version=version,
                path=str(path),
                source=_python_source(str(path), hint),
                trusted=is_trusted_python(str(path)),
            )
        )

    if missing_version:
        ctx.warnings.append(f"以下 Python 无法获取版本号: {', '.join(missing_version)}")
    return pythons


def _venv_python(base: Path) -> Path:
    if os.name == "nt":
        return base / "Scripts" / "python.exe"
    return base / "bin" / "python"


def _python_version(executable: str, ctx: ProbeContext) -> str:
    result = ctx.exec(
        [executable, "-c", "import sys;print('%d.%d.%d' % sys.version_info[:3])"],
        f"python -V {executable}",
        record_warning=False,
    )
    if result and result.ok and result.out.strip():
        return result.out.strip().splitlines()[0]
    # 回退：venv 的 pyvenv.cfg 里有版本号
    config = Path(executable).parent.parent / "pyvenv.cfg"
    try:
        for line in config.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lower().startswith("version") and "=" in line:
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _python_source(path: str, hint: str) -> str:
    low = path.lower().replace("\\", "/")
    if "/.pyenv/" in low:
        return "pyenv"
    if any(key in low for key in ("miniconda", "anaconda", "miniforge", "/conda/")):
        return "conda"
    if low.startswith("/opt/homebrew/") or low.startswith("/usr/local/cellar/") or low.startswith("/usr/local/opt/"):
        return "homebrew"
    if low.startswith("/usr/bin/") or low.startswith("/bin/"):
        return "system"
    if hint == "launcher":
        return "launcher"
    return "path"


# 工具链自带的解释器：随宿主应用升级或卸载而消失，不能用来建持久环境。
# 只列明确已知的路径特征——不能粗暴排除 AppData\Local\Programs，
# 因为 Python 官方安装器默认就装在那里。
TOOLCHAIN_PYTHON_MARKERS = (
    "/.workbuddy/",              # WorkBuddy 的 vendor python（符号链接到应用目录）
    "/resources/vendor/python",  # Electron 应用内置运行时
    "/resources/app/python",     # 同类打包方式
)


def is_trusted_python(path: str) -> bool:
    """能否作为长期依赖。

    排除两类：
    1. 应用自带的运行时（WorkBuddy 的 vendor python 等）——随宿主升级/卸载消失
    2. 虚拟环境里的解释器——venv 是派生环境，用它当另一个环境的来源是循环依赖，
       而且它自己的存亡还挂在基座解释器上
    """
    low = path.replace("\\", "/").lower()
    if any(marker in low for marker in TOOLCHAIN_PYTHON_MARKERS):
        return False
    # venv 内的 python 旁边（或上一级）一定有 pyvenv.cfg
    candidate = Path(path)
    for parent in (candidate.parent, candidate.parent.parent):
        try:
            if (parent / "pyvenv.cfg").is_file():
                return False
        except OSError:
            continue
    return True


# ---------------- 磁盘 ----------------
def _collect_disks(os_name: str) -> list[DiskInfo]:
    targets: list[Path] = []
    if os_name == "windows":
        targets.append(Path(os.environ.get("SystemDrive", "C:") + "/"))
        targets.append(Path(COMFY_DIR.resolve().anchor))
    elif os_name == "macos":
        # / 是只读的密封系统卷，可用空间要看数据卷
        targets.append(Path("/System/Volumes/Data"))
        targets.append(_mount_point(COMFY_DIR))
    else:
        targets.append(Path("/"))
        targets.append(_mount_point(COMFY_DIR))

    disks: list[DiskInfo] = []
    seen: set[str] = set()
    seen_usage: set[tuple[float, float]] = set()
    for target in targets:
        key = os.path.normcase(str(target))
        if key in seen:
            continue
        seen.add(key)
        try:
            usage = shutil.disk_usage(target)
        except OSError:
            continue
        info = DiskInfo(
            path=str(target),
            total_gb=round(usage.total / (1024**3), 1),
            free_gb=round(usage.free / (1024**3), 1),
        )
        # macOS 的 / 与 /System/Volumes/Data 共享同一 APFS 容器，容量完全相同；
        # 重复报两条会让界面出现两行一样的数字
        signature = (info.total_gb, info.free_gb)
        if signature in seen_usage:
            continue
        seen_usage.add(signature)
        disks.append(info)
    return disks


def _mount_point(path: Path) -> Path:
    current = path.resolve() if path.exists() else path
    while not os.path.ismount(current) and current.parent != current:
        current = current.parent
    return current


# ---------------- 共享基础环境 ----------------
def probe_runtime() -> RuntimeStatus:
    """只读检查 comfy/.environment：内置 Python 与 torch 是否已装上。

    不启动解释器、不 import torch——直接读 site-packages 里的 version.py，
    避免为了显示一行版本号付出几秒的加载代价。
    """
    python_exe = COMFY_ENV_DIR / "python" / (
        "python.exe" if os.name == "nt" else "bin/python3"
    )
    site = COMFY_ENV_DIR / "site-packages"
    torch_version = _package_version(site, "torch")
    channel = torch_version.rsplit("+", 1)[-1] if torch_version and "+" in torch_version else None

    python_ready = python_exe.is_file()
    torch_ready = (site / "torch").is_dir()
    return RuntimeStatus(
        ready=python_ready and torch_ready,
        python_ready=python_ready,
        python_version=COMFY_ENV_NAME,
        python_source="cnb",
        python_cached=any((COMFY_ENV_DIR / "cache").glob("cpython-*.tar.gz")),
        torch_ready=torch_ready,
        torch_version=torch_version,
        torchvision_version=_package_version(site, "torchvision"),
        torchaudio_version=_package_version(site, "torchaudio"),
        cuda_runtime=_torch_cuda_runtime(site),
        torch_channel=channel,
        lock_ready=(COMFY_ENV_DIR / "requirements.lock").is_file(),
        path=str(COMFY_ENV_DIR),
    )


def _package_version(site: Path, name: str) -> str | None:
    """优先读 <pkg>/version.py，退回 dist-info 的 METADATA。"""
    try:
        text = (site / name / "version.py").read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    match = re.search(r"__version__\s*=\s*['\"]([^'\"]+)", text)
    if match:
        return match.group(1)
    for meta in sorted(site.glob(f"{name}-*.dist-info/METADATA")):
        try:
            text = meta.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        match = re.search(r"^Version:\s*(\S+)", text, re.M)
        if match:
            return match.group(1)
    return None


def _torch_cuda_runtime(site: Path) -> str | None:
    """torch/version.py 里形如 `cuda: Optional[str] = '13.0'`。"""
    try:
        text = (site / "torch" / "version.py").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"^cuda\s*(?::[^=]+)?=\s*['\"]([^'\"]+)", text, re.M)
    return match.group(1) if match else None


# ---------------- 自有实例 ----------------
def _collect_instances(ctx: ProbeContext) -> list[ManagedInstance]:
    """只认本项目在 COMFY_DIR 下创建的实例。

    用户自行安装的 ComfyUI（官方便携版、Desktop、整合包）不探测、不接管：
    那些环境的版本、依赖、端口都由用户自己维护，我们不承担它的状态。
    """
    instances: list[ManagedInstance] = []
    meta_dir = COMFY_DIR
    if not meta_dir.is_dir():
        return instances

    for entry in sorted(meta_dir.iterdir()):
        # 点前缀目录是共享基础环境（.environment），不是实例
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        meta = entry / "instance.json"
        data: object = {}
        registered = True
        if meta.is_file():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                ctx.warnings.append(f"实例元数据无法解析: {meta} ({exc})")
                registered = False
        elif (entry / "ComfyUI").is_dir():
            # 早期安装没写 instance.json，但目录结构是我们自己的；标成未登记，
            # 用户才能在界面里把它清理掉，而不是留一堆看不见的垃圾目录。
            registered = False
        else:
            continue  # 用户在 comfy/ 下放的其他目录，不认、不接管

        instances.append(
            ManagedInstance(
                name=entry.name,
                alias=_first_str(data, ("alias", "label")),
                path=str(entry),
                version=_first_str(data, ("version", "comfyui_version", "ref")),
                python=_first_str(data, ("python", "python_version")),
                port=_first_int(data, "port"),
                created_at=_first_str(data, ("created_at",)),
                registered=registered,
            )
        )
    return instances


def _first_str(data: object, keys: tuple[str, ...]) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in keys:
        value = data.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    return None


def _first_int(data: object, key: str) -> int | None:
    if not isinstance(data, dict):
        return None
    try:
        return int(data.get(key))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


# ---------------- 软件源测速 ----------------
# 安装前并发测速选最快的源。写死单个源在部分网络下会很慢：
# 官方 PyPI 在国内约 1MB/s，国内镜像能到 5MB/s 以上；反过来在海外，
# 国内镜像可能反而慢。所以让实测数据决定。
PIP_MIRRORS: list[tuple[str, str]] = [
    ("清华", "https://pypi.tuna.tsinghua.edu.cn/simple"),
    ("阿里云", "https://mirrors.aliyun.com/pypi/simple"),
    ("官方", "https://pypi.org/simple"),
]
TORCH_MIRRORS: list[tuple[str, str]] = [
    ("上交", "https://mirror.sjtu.edu.cn/pytorch-wheels/{channel}/"),
    ("南大", "https://mirror.nju.edu.cn/pytorch/whl/{channel}/"),
    ("官方", "https://download.pytorch.org/whl/{channel}"),
]
# 测速读的必须是"真实 wheel 的前若干字节"，不能是索引页。
# 索引页只有 6KB，读它得到的是网页加载时间，和 2GB wheel 的吞吐无关
# ——第一版就是这么错的：同一批源两次测出 51 / 0 KB/s，而实际下载是 4.7 MB/s。
MIRROR_SAMPLE_BYTES = 512 * 1024
MIRROR_TIMEOUT = 5.0
MIRROR_CACHE_TTL = 600.0
MIRROR_UA = "model-downloader/0.1"

_cache: dict[str, tuple[float, list["MirrorProbe"]]] = {}
_cache_lock = threading.Lock()
# 正在后台预热的 channel，避免连点两次多跑一轮测速
_warming: set[str] = set()


def probe_mirrors(
    channel: str,
    *,
    sample: int = MIRROR_SAMPLE_BYTES,
    timeout: float = MIRROR_TIMEOUT,
    use_cache: bool = True,
) -> list["MirrorProbe"]:
    """并发测各软件源的真实下载速度。

    每个源两步：先取包索引页，从中找一个与当前平台匹配的 wheel，
    再对它发 Range 请求读 sample 字节计时。这样测到的是 wheel 的吞吐，
    而不是索引页的响应速度。

    结果缓存 10 分钟：预演和真正安装会各调一次，没必要重复测。
    """
    key = f"{channel}:{sample}:{timeout}"
    if use_cache:
        with _cache_lock:
            cached = _cache.get(key)
            if cached and time.time() - cached[0] < MIRROR_CACHE_TTL:
                return cached[1]

    # (类型, 展示名, 索引根地址, 用于取 wheel 的包名, 通道)
    # 记录的 url 必须是索引根，否则 pip --index-url 会指向子页。
    tasks: list[tuple[str, str, str, str, str]] = [
        ("pip", label, base, "pip", "") for label, base in PIP_MIRRORS
    ]
    for label, template in TORCH_MIRRORS:
        tasks.append(("torch", label, template.format(channel=channel), "torch", channel))

    results: list[MirrorProbe] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {
            pool.submit(_probe_source, base, package, sample, timeout): (kind, label, base, ch)
            for kind, label, base, package, ch in tasks
        }
        for future in concurrent.futures.as_completed(futures):
            kind, label, base, ch = futures[future]
            try:
                ok, kbps = future.result()
            except Exception:  # noqa: BLE001
                ok, kbps = False, 0.0
            results.append(
                MirrorProbe(kind=kind, label=label, url=base, channel=ch, ok=ok, speed_kbps=round(kbps, 1))
            )

    with _cache_lock:
        _cache[key] = (time.time(), results)
    return results


def cached_mirrors(
    channel: str,
    *,
    sample: int = MIRROR_SAMPLE_BYTES,
    timeout: float = MIRROR_TIMEOUT,
) -> list["MirrorProbe"] | None:
    """只读缓存，绝不发起测速。

    预演弹层要立刻出现，不能为「选最快的源」阻塞好几秒；没有缓存时调用方
    先按默认源出计划，再让它后台预热。
    """
    key = f"{channel}:{sample}:{timeout}"
    with _cache_lock:
        entry = _cache.get(key)
    if entry and time.time() - entry[0] < MIRROR_CACHE_TTL:
        return entry[1]
    return None


def warm_mirrors(channel: str) -> None:
    """后台跑一次测速，供下一次预演/安装直接命中缓存。失败无所谓。"""
    key = f"{channel}:{MIRROR_SAMPLE_BYTES}:{MIRROR_TIMEOUT}"
    with _cache_lock:
        if key in _warming:
            return
        _warming.add(key)

    def run() -> None:
        try:
            probe_mirrors(channel)
        except Exception:  # noqa: BLE001 - 预热只是优化，失败不能冒泡
            pass
        finally:
            with _cache_lock:
                _warming.discard(key)

    threading.Thread(target=run, name=f"mirror-warm-{channel}", daemon=True).start()


def _probe_source(base: str, package: str, sample: int, timeout: float) -> tuple[bool, float]:
    """取索引页 → 挑一个平台匹配的 wheel → 读前 sample 字节计时。"""
    wheel = _resolve_wheel(base.rstrip("/") + "/" + package + "/", min(timeout, 3.0))
    if wheel is None:
        return False, 0.0
    return _measure(wheel, sample, timeout)


def _resolve_wheel(page_url: str, timeout: float) -> str | None:
    """从 PEP 503 索引页里找出一个和当前平台匹配的 wheel 绝对地址。"""
    try:
        response = httpx.get(
            page_url, timeout=timeout, follow_redirects=True, headers={"User-Agent": MIRROR_UA}
        )
    except Exception:  # noqa: BLE001
        return None
    if response.status_code >= 400:
        return None
    links = re.findall(r'href="([^"]+\.whl[^"]*)"', response.text)
    if not links:
        return None
    best = max(links, key=_wheel_score)
    return urljoin(page_url, best)


def _wheel_score(link: str) -> int:
    """越像"本机能用的那个包"分越高；只是为了让测速打在同一个量级的文件上。"""
    low = link.lower()
    score = 0
    for tag in _platform_tags():
        if tag in low:
            score += 4
    python_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if python_tag in low:
        score += 2
    return score


def _platform_tags() -> tuple[str, ...]:
    machine = platform.machine().lower()
    if sys.platform == "win32":
        return ("win_amd64",) if machine in ("amd64", "x86_64") else ("win32",)
    if sys.platform == "darwin":
        return ("macosx", "arm64" if machine in ("arm64", "aarch64") else "x86_64")
    return ("manylinux", "linux_x86_64" if machine in ("x86_64", "amd64") else "linux_aarch64")


def _measure(url: str, sample: int, timeout: float) -> tuple[bool, float]:
    """读 Range 指定的一段字节并计时。服务器忽略 Range 时靠字节上限提前收手。"""
    started = time.time()
    got = 0
    headers = {"Range": f"bytes=0-{sample - 1}", "User-Agent": MIRROR_UA}
    try:
        with httpx.stream("GET", url, headers=headers, timeout=timeout, follow_redirects=True) as response:
            if response.status_code >= 400:
                return False, 0.0
            for chunk in response.iter_bytes(65536):
                got += len(chunk)
                if got >= sample or time.time() - started >= timeout:
                    break
    except Exception:  # noqa: BLE001
        return False, 0.0
    # 读到的太少没法判断吞吐，按不可用处理——真那么慢也不该选它
    if got < 32 * 1024:
        return False, 0.0
    elapsed = max(time.time() - started, 0.001)
    return True, (got / 1024) / elapsed
