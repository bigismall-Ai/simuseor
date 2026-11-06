"""ComfyUI 环境安装（M3）。

设计要点
--------
1. **两段式**：`build_steps()` 是纯函数，只产出"要执行什么"；`run_install()` 负责执行。
   预演（dry-run）和真实安装走同一份步骤列表，保证"看到的"就是"要做的"。
2. **不用 comfy-cli**：它的 `--cuda-version` 枚举只到 12.9，装不了 cu130，
   而 cu130 是官方文档给 Blackwell 的推荐组合。直接用 PyTorch 官方 index 更可控。
3. **顺序不能反**：先按 channel 装 torch，再装 ComfyUI 的 requirements。
   requirements 里含 `torch`，反序的话 pip 会按 PyPI 版本重装，把刚装好的 CUDA 版覆盖掉。
4. **环境隔离**：执行前清掉 VIRTUAL_ENV / PYTHONPATH / PYTHONHOME，
   否则 pip 会认到后端自己的 venv 上，装出两套互相干扰的环境。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

from ..config import COMFY_DIR, COMFY_FALLBACK, COMFY_MIRROR, LOG_DIR
from .models import DeviceReport, ManagedInstance, PythonInfo
from .plan import InstallPlan

# PyTorch 官方 wheel 索引。plan 输出的 channel 直接对应这里的 key，
# installer 不自己判断该装哪个版本。
TORCH_INDEX: dict[str, str | None] = {
    "cu130": "https://download.pytorch.org/whl/cu130",
    "cu126": "https://download.pytorch.org/whl/cu126",
    "rocm7.2": "https://download.pytorch.org/whl/rocm7.2",
    "rocm6.4": "https://download.pytorch.org/whl/rocm6.4",
    "xpu": "https://download.pytorch.org/whl/xpu",
    "cpu": "https://download.pytorch.org/whl/cpu",
    # macOS 的 MPS 用 PyPI 默认轮子，不指定 index
    "mps": None,
}

# 有些附加包的安装方式与 torch 不同
SPECIAL_PACKAGES: dict[str, list[str]] = {
    "directml": ["torch-directml"],
}

STEP_TIMEOUT = 3600
PIP_TIMEOUT = 5400


@dataclass
class Step:
    """一个可展示、可执行的安装步骤。"""

    key: str
    title: str
    detail: str
    command: list[str] | None = None
    cwd: Path | None = None
    timeout: int = STEP_TIMEOUT
    # 该步骤预计产生的磁盘占用（GB），用于预热提示
    estimated_gb: float = 0.0
    # 失败后是否还能继续（例如 pip 升级 pip 失败不该否定整个安装）
    optional: bool = False


@dataclass
class InstallSpec:
    """一次安装的全部已知条件。由 make_spec() 从 device + plan 生成。"""

    name: str
    workspace: Path
    python_exe: str
    python_version: str
    torch_channel: str
    repo_url: str = COMFY_MIRROR
    fallback_url: str = COMFY_FALLBACK
    tag: str | None = None
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def comfy_dir(self) -> Path:
        return self.workspace / "ComfyUI"

    @property
    def venv_dir(self) -> Path:
        return self.workspace / "venv"

    @property
    def venv_python(self) -> str:
        """venv 内的解释器。Windows 在 Scripts/，类 Unix 在 bin/。"""
        if os.name == "nt":
            return str(self.venv_dir / "Scripts" / "python.exe")
        return str(self.venv_dir / "bin" / "python")


@dataclass
class InstallResult:
    ok: bool
    message: str
    log_path: str
    instance: ManagedInstance | None = None


# ---------------- 规格推导 ----------------
def _parse(text: str | None) -> tuple[int, int] | None:
    """'3.13.14' -> (3, 13)，无法解析返回 None。"""
    if not text:
        return None
    parts = str(text).split(".")
    try:
        return (int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
    except (ValueError, IndexError):
        return None


def pick_python(report: DeviceReport, plan: InstallPlan) -> PythonInfo | None:
    """挑一个与方案匹配的解释器。

    优先精确匹配建议版本；没有就退到"不高于建议版本的最高可用版本"，
    与 plan 的判定保持同一套规则，避免"方案说 3.13、实际用 3.9"。
    """
    target = _parse(plan.python_version)
    parsed = [(version, info) for info in report.pythons if (version := _parse(info.version))]
    if not parsed:
        return None
    exact = [info for version, info in parsed if version == target]
    if exact:
        return exact[0]
    not_newer = sorted((version, info) for version, info in parsed if version <= target)
    if not_newer:
        return not_newer[-1][1]
    newer = sorted((version, info) for version, info in parsed if version > target)
    return newer[0][1] if newer else None


def make_spec(
    report: DeviceReport,
    plan: InstallPlan,
    *,
    name: str = "",
    tag: str | None = None,
) -> InstallSpec:
    """把 device + plan 折叠成执行所需的规格。缺关键前提时抛 ValueError。"""
    if plan.tier == "blocked":
        raise ValueError(plan.blocked_reason or "当前环境不满足安装条件")
    if not plan.python_available:
        raise ValueError(f"缺少 Python {plan.python_version}，无法创建虚拟环境")

    python = pick_python(report, plan)
    if python is None:
        raise ValueError("未能确定可用的 Python 解释器")

    instance_name = name or time.strftime("v%Y%m%d-%H%M%S")
    return InstallSpec(
        name=instance_name,
        workspace=COMFY_DIR / "instances" / instance_name,
        python_exe=python.path,
        python_version=python.version,
        torch_channel=plan.torch_channel,
        tag=tag,
    )


# ---------------- 步骤生成（纯函数） ----------------
def build_steps(spec: InstallSpec) -> list[Step]:
    """产出完整步骤序列。不触碰文件系统，可安全用于预演。"""
    index_url = TORCH_INDEX.get(spec.torch_channel)
    steps: list[Step] = [
        Step(
            key="prepare",
            title="准备工作目录",
            detail=f"创建 {spec.workspace}",
        ),
        Step(
            key="clone",
            title="获取 ComfyUI 代码",
            detail=f"从 {_repo_label(spec.repo_url)} 克隆"
            + (f"，检出 {spec.tag}" if spec.tag else "（默认分支）"),
            command=["git", "clone", "--depth", "1"]
            + (["--branch", spec.tag] if spec.tag else [])
            + [spec.repo_url, str(spec.comfy_dir)],
            timeout=900,
            estimated_gb=0.5,
        ),
        Step(
            key="venv",
            title="创建独立 Python 环境",
            detail=f"用 Python {spec.python_version} 在 {spec.venv_dir} 建 venv，与后端环境完全隔离",
            command=[spec.python_exe, "-m", "venv", str(spec.venv_dir)],
            timeout=300,
        ),
        Step(
            key="pip",
            title="升级安装工具",
            detail="更新 pip / setuptools / wheel，避免老版本解析不了新的 wheel 格式",
            command=[spec.venv_python, "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"],
            timeout=600,
            optional=True,
        ),
    ]

    if spec.torch_channel in SPECIAL_PACKAGES:
        # DirectML 等特殊后端：包名不同，不走 torch 三件套
        packages = SPECIAL_PACKAGES[spec.torch_channel]
        steps.append(
            Step(
                key="torch",
                title="安装加速运行时",
                detail=f"安装 {' '.join(packages)}（DirectML 后端）",
                command=[spec.venv_python, "-m", "pip", "install", *packages],
                timeout=PIP_TIMEOUT,
                estimated_gb=2.5,
            )
        )
    else:
        cmd = [spec.venv_python, "-m", "pip", "install", "torch", "torchvision", "torchaudio"]
        if index_url:
            cmd += ["--index-url", index_url]
        steps.append(
            Step(
                key="torch",
                title="安装 PyTorch",
                detail=(
                    f"从 PyTorch 官方索引安装 {spec.torch_channel} 版本"
                    if index_url
                    else "从 PyPI 安装默认版本（Apple 芯片走 Metal 加速）"
                ),
                command=cmd,
                timeout=PIP_TIMEOUT,
                estimated_gb=3.0,
            )
        )

    steps += [
        Step(
            key="requirements",
            title="安装 ComfyUI 依赖",
            detail="按 ComfyUI 的 requirements.txt 安装；torch 已就位，不会被覆盖",
            command=[spec.venv_python, "-m", "pip", "install", "-r", "requirements.txt"],
            cwd=spec.comfy_dir,
            timeout=PIP_TIMEOUT,
            estimated_gb=1.5,
        ),
        Step(
            key="verify",
            title="验证安装结果",
            detail="检查 torch 版本、CUDA 运行时与 GPU 是否真的可用",
            command=[
                spec.venv_python,
                "-c",
                "import torch;"
                "print('torch', torch.__version__);"
                "print('cuda_runtime', torch.version.cuda);"
                "print('cuda_available', torch.cuda.is_available());"
                "print('device_count', torch.cuda.device_count());",
            ],
            cwd=spec.comfy_dir,
            timeout=180,
        ),
    ]
    return steps


def _repo_label(url: str) -> str:
    return "CNB 镜像" if "cnb.cool" in url else url


# ---------------- 执行 ----------------
def clean_env() -> dict[str, str]:
    """子进程环境：清掉会把 pip 引到错误解释器的变量。"""
    env = {k: v for k, v in os.environ.items() if k not in {"VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME"}}
    env["PYTHONUNBUFFERED"] = "1"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    return env


def run_install(
    spec: InstallSpec,
    emit: Callable[[dict], None] | None = None,
    *,
    dry_run: bool = False,
) -> InstallResult:
    """按步骤执行安装。emit 收到结构化事件，供前端流式展示。"""
    steps = build_steps(spec)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"comfy-{spec.name}.log"
    started = time.time()

    def send(event: dict) -> None:
        if emit:
            emit(event)

    log_file = log_path.open("w", encoding="utf-8", errors="replace")

    def log(text: str) -> None:
        log_file.write(text + "\n")
        log_file.flush()

    log(f"# 安装 {spec.name}")
    log(f"# 工作目录 {spec.workspace}")
    log(f"# Python {spec.python_version} @ {spec.python_exe}")
    log(f"# 加速通道 {spec.torch_channel}")
    log("")

    if dry_run:
        for step in steps:
            send({"type": "step_plan", "key": step.key, "title": step.title, "command": step.command})
        log_file.close()
        return InstallResult(ok=True, message="预演完成，未改动磁盘", log_path=str(log_path))

    try:
        for index, step in enumerate(steps, start=1):
            send(
                {
                    "type": "step_start",
                    "key": step.key,
                    "title": step.title,
                    "index": index,
                    "total": len(steps),
                }
            )
            log(f"== [{index}/{len(steps)}] {step.title}")

            ok, message = _run_step(step, spec, send, log)
            send({"type": "step_done", "key": step.key, "ok": ok, "message": message})
            if not ok and not step.optional:
                log(f"!! 失败: {message}")
                return InstallResult(ok=False, message=message, log_path=str(log_path))
    except Exception as exc:  # noqa: BLE001
        log(f"!! 异常: {exc}")
        return InstallResult(ok=False, message=f"安装中断: {exc}", log_path=str(log_path))
    finally:
        log_file.close()

    instance = ManagedInstance(
        name=spec.name,
        path=str(spec.workspace),
        version=spec.tag,
        python=spec.python_version,
        port=None,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    )
    elapsed = time.time() - started
    return InstallResult(ok=True, message=f"安装完成，用时 {elapsed:.0f} 秒", log_path=str(log_path), instance=instance)


def _run_step(
    step: Step,
    spec: InstallSpec,
    send: Callable[[dict], None],
    log: Callable[[str], None],
) -> tuple[bool, str]:
    if step.key == "prepare":
        try:
            spec.workspace.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return False, f"无法创建工作目录: {exc}"
        return True, "已创建"

    if step.key == "clone":
        return _clone(step, spec, send, log)

    if step.command is None:
        return True, "跳过"

    return _exec(step, send, log)


def _clone(step: Step, spec: InstallSpec, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    """先试镜像，失败再试 GitHub。git 的进度走 stderr，要单独收集。"""
    attempts = [spec.repo_url]
    if spec.fallback_url and spec.fallback_url != spec.repo_url:
        attempts.append(spec.fallback_url)

    last = ""
    for url in attempts:
        if spec.comfy_dir.exists():
            shutil.rmtree(spec.comfy_dir, ignore_errors=True)
        cmd = ["git", "clone", "--depth", "1"]
        if spec.tag:
            cmd += ["--branch", spec.tag]
        cmd += [url, str(spec.comfy_dir)]
        log(f"$ {' '.join(cmd)}")
        send({"type": "log", "line": f"$ git clone {url}"})
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=step.timeout,
                env=clean_env(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            last = str(exc)
            log(f"  失败: {last}")
            continue
        if proc.returncode == 0:
            return True, f"已从 {_repo_label(url)} 获取"
        last = (proc.stderr or proc.stdout or "").strip()[-400:]
        log(f"  失败(exit {proc.returncode}): {last}")
        send({"type": "log", "line": f"镜像不可用，尝试下一个源…" if url == attempts[0] and len(attempts) > 1 else last})
    return False, f"代码获取失败: {last}"


def _exec(step: Step, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    assert step.command is not None
    log(f"$ {' '.join(step.command)}")
    try:
        proc = subprocess.Popen(
            step.command,
            cwd=str(step.cwd) if step.cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
            env=clean_env(),
        )
    except OSError as exc:
        return False, f"无法执行命令: {exc}"

    assert proc.stdout is not None
    deadline = time.time() + step.timeout
    tail: list[str] = []
    for line in _iter_lines(proc):
        line = line.rstrip()
        if not line:
            continue
        log(line)
        tail.append(line)
        if len(tail) > 40:
            tail.pop(0)
        send({"type": "log", "line": line})
        if time.time() > deadline:
            proc.kill()
            return False, f"步骤超时（>{step.timeout}s）"

    code = proc.wait()
    if code == 0:
        return True, "完成"
    return False, f"命令失败（exit {code}）：{tail[-1] if tail else '无输出'}"


def _iter_lines(proc: subprocess.Popen) -> Iterator[str]:
    assert proc.stdout is not None
    for line in proc.stdout:
        yield line
