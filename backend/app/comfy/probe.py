"""设备探测编排：OS / Python / 磁盘 / 已有安装 + 调用平台 GPU 采集。

全程只读：不创建目录、不写配置、不装包、不改注册表。
任何单项失败只写入 warnings，整体仍返回 DeviceReport。
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

from ..config import COMFY_DIR, ROOT
from .models import DeviceReport, DiskInfo, ExistingInstall, GpuInfo, PythonInfo
from .platforms import LinuxGpuProbe, MacOSGpuProbe, ProbeContext, WindowsGpuProbe

GPU_PROBES = {
    "windows": WindowsGpuProbe,
    "linux": LinuxGpuProbe,
    "macos": MacOSGpuProbe,
}

COMMON_PYTHON_NAMES = ("python3", "python3.13", "python3.12", "python3.11")
T = TypeVar("T")


def probe_device() -> DeviceReport:
    """采集本机软硬件信息，返回结构化报告。"""
    ctx = ProbeContext()
    os_name = detect_os()

    gpus: list[GpuInfo] = []
    try:
        gpus = GPU_PROBES[os_name]().probe(ctx)
    except Exception as exc:  # noqa: BLE001 - 单项失败不中断
        ctx.warnings.append(f"GPU 探测失败: {exc}")

    # 独显优先、未知厂商（虚拟显示器等）最后
    gpus.sort(key=lambda gpu: (not gpu.is_discrete, gpu.vendor == "unknown"))
    primary = next((gpu for gpu in gpus if gpu.is_discrete), None)
    if primary is None:
        primary = next((gpu for gpu in gpus if gpu.vendor != "unknown"), gpus[0] if gpus else None)

    os_version, os_build = _guard(ctx, "操作系统版本", lambda: _describe_os(os_name), ("", ""))
    pythons = _guard(ctx, "Python", lambda: _collect_pythons(ctx), [])
    disks = _guard(ctx, "磁盘", lambda: _collect_disks(os_name), [])
    installs = _guard(ctx, "已有 ComfyUI 安装", lambda: _collect_installs(ctx), [])
    is_wsl = _guard(ctx, "WSL", lambda: _is_wsl(os_name, ctx), False)

    return DeviceReport(
        os=os_name,
        os_version=os_version,
        os_build=os_build,
        arch=_detect_arch(),
        is_wsl=is_wsl,
        gpus=gpus,
        primary_gpu=primary,
        pythons=pythons,
        disks=disks,
        installs=installs,
        warnings=list(ctx.warnings),
        raw=dict(ctx.raw),
        probed_at=datetime.now().astimezone().isoformat(timespec="seconds"),
    )


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
    for instance in (COMFY_DIR / "instances").glob("*"):
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
            PythonInfo(version=version, path=str(path), source=_python_source(str(path), hint))
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
    for target in targets:
        key = os.path.normcase(str(target))
        if key in seen:
            continue
        seen.add(key)
        try:
            usage = shutil.disk_usage(target)
        except OSError:
            continue
        disks.append(
            DiskInfo(
                path=str(target),
                total_gb=round(usage.total / (1024**3), 1),
                free_gb=round(usage.free / (1024**3), 1),
            )
        )
    return disks


def _mount_point(path: Path) -> Path:
    current = path.resolve() if path.exists() else path
    while not os.path.ismount(current) and current.parent != current:
        current = current.parent
    return current


# ---------------- 已有安装 ----------------
def _collect_installs(ctx: ProbeContext) -> list[ExistingInstall]:
    installs: list[ExistingInstall] = []
    seen: set[str] = set()

    def add(path: Path, kind: str, version: str | None, note: str) -> None:
        key = os.path.normcase(str(path.resolve()) if path.exists() else str(path))
        if key in seen:
            return
        seen.add(key)
        installs.append(ExistingInstall(path=str(path), kind=kind, version=version, note=note))

    # 1) 本项目管理的实例：comfy/instances/*/instance.json
    for meta in sorted((COMFY_DIR / "instances").glob("*/instance.json")):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            ctx.warnings.append(f"实例元数据无法解析: {meta} ({exc})")
            continue
        version = _first_str(data, ("version", "comfyui_version", "ref"))
        note = f"本项目管理的实例（元数据 {meta.name}）"
        if isinstance(data.get("python"), str):
            note += f"，Python {data['python']}"
        add(meta.parent, "our-instance", version, note)

    # 2) 常见安装位置
    home = Path.home()
    for path, kind, note in (
        (home / "ComfyUI", "comfyui-repo", "用户主目录下的 ComfyUI 克隆"),
        (home / "Documents" / "comfy", "desktop", "ComfyUI Desktop 默认目录"),
        (home / "Documents" / "ComfyUI", "desktop", "ComfyUI Desktop 默认目录"),
    ):
        if path.is_dir():
            add(path, _guess_kind(path, kind), _comfy_version(path), note)

    # 3) 含 main.py 且带 .venv / venv / python_embeded 的目录（只扫一层，控制耗时）
    for root in (COMFY_DIR, home):
        try:
            children = sorted(child for child in root.iterdir() if child.is_dir())
        except OSError:
            continue
        for child in children:
            if not (child / "main.py").is_file():
                continue
            embedded = (child / "python_embeded").is_dir()
            virtualenv = (child / ".venv").is_dir() or (child / "venv").is_dir()
            if not (embedded or virtualenv):
                continue
            kind = "bundle" if embedded else "comfyui-repo"
            runtime = "python_embeded" if embedded else "虚拟环境"
            add(child, kind, _comfy_version(child), f"检测到 main.py + {runtime}")

    return installs


def _first_str(data: object, keys: tuple[str, ...]) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in keys:
        value = data.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    return None


def _guess_kind(path: Path, default: str) -> str:
    if (path / "python_embeded").is_dir():
        return "bundle"
    return default


def _comfy_version(path: Path) -> str | None:
    """ComfyUI 仓库根目录的 comfyui_version.py 里有 __version__。"""
    version_file = path / "comfyui_version.py"
    try:
        text = version_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"__version__\s*=\s*['\"]([^'\"]+)['\"]", text)
    return match.group(1) if match else None
