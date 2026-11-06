"""ComfyUI 环境安装（M3）。

设计要点
--------
1. **两段式**：`build_steps()` 是纯函数，只产出"要执行什么"；`run_install()` 负责执行。
   预演（dry-run）和真实安装走同一份步骤列表，保证"看到的"就是"要做的"。
2. **不用 comfy-cli**：它的 `--cuda-version` 枚举只到 12.9，装不了 cu130，
   而 cu130 是官方文档给 Blackwell 的推荐组合。直接用 PyTorch 官方索引更可控。
3. **不用 venv**：torch 跟硬件走、不跟 ComfyUI 版本走，所以整套依赖装在
   `instances/.environment/` 里共享，装第二个版本只需克隆代码。
4. **顺序不能反**：先按 channel 装 torch，再装 ComfyUI 的 requirements。
   requirements 里含 `torch`，反序的话 pip 会按 PyPI 版本重装，把 CUDA 版覆盖掉。
5. **环境隔离**：执行前清掉 VIRTUAL_ENV / PYTHONPATH / PYTHONHOME，
   否则 pip 会认到后端自己的 venv 上。
"""
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import httpx

from ..config import (
    COMFY_ENV_DIR,
    COMFY_ENV_NAME,
    COMFY_FALLBACK,
    COMFY_MIRROR,
    COMFY_PYTHON_SHA256,
    COMFY_PYTHON_URLS,
    LOG_DIR,
)
from .model_dirs import models_root, write_extra_model_paths
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

# 国内 PyTorch 镜像。download.pytorch.org 在国内直连很慢，
# 上海交大同步了全部 channel 且支持 pip 的 index 协议。
TORCH_MIRRORS: dict[str, str] = {
    "cu130": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu130/",
    "cu126": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu126/",
}

# 有些附加包的安装方式与 torch 不同
SPECIAL_PACKAGES: dict[str, list[str]] = {
    "directml": ["torch-directml"],
}

STEP_TIMEOUT = 3600
PIP_TIMEOUT = 5400
DOWNLOAD_TIMEOUT = 900


@dataclass
class Step:
    """一个可展示、可执行的安装步骤。"""

    key: str
    title: str
    detail: str
    command: list[str] | None = None
    cwd: Path | None = None
    env_extra: dict[str, str] = field(default_factory=dict)
    timeout: int = STEP_TIMEOUT
    # 该步骤预计产生的磁盘占用（GB），用于预热提示
    estimated_gb: float = 0.0
    # 失败后是否还能继续（例如升级 pip 失败不该否定整个安装）
    optional: bool = False


@dataclass
class InstallSpec:
    """一次安装的全部已知条件。由 make_spec() 从 device + plan 生成。"""

    name: str
    workspace: Path
    environment: Path
    torch_channel: str
    repo_url: str = COMFY_MIRROR
    fallback_url: str = COMFY_FALLBACK
    tag: str | None = None
    runtime_version: str = COMFY_ENV_NAME

    @property
    def comfy_dir(self) -> Path:
        return self.workspace / "ComfyUI"

    @property
    def env_python(self) -> Path:
        """基础环境里的解释器。便携版解压后根目录就是 python/。"""
        if os.name == "nt":
            return self.environment / "python" / "python.exe"
        return self.environment / "python" / "bin" / "python3"

    @property
    def env_site(self) -> Path:
        return self.environment / "site-packages"

    @property
    def python_ready(self) -> bool:
        return self.env_python.is_file()

    @property
    def deps_ready(self) -> bool:
        return (self.env_site / "torch").is_dir()


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

    只在已有基础环境时可跳过下载；否则只用来做版本参考。
    """
    target = _parse(plan.python_version)
    # 与 plan 保持同一口径：跳过应用自带的运行时
    trusted = [info for info in report.pythons if info.trusted]
    parsed = [(ver, info) for info in trusted if (ver := _parse(info.version))]
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

    instance_name = name or time.strftime("v%Y%m%d-%H%M%S")
    return InstallSpec(
        name=instance_name,
        workspace=COMFY_ENV_DIR.parent / instance_name,
        environment=COMFY_ENV_DIR,
        torch_channel=plan.torch_channel,
        tag=tag,
    )


# ---------------- 步骤生成（纯函数） ----------------
def build_steps(spec: InstallSpec) -> list[Step]:
    """产出完整步骤序列。不触碰文件系统，可安全用于预演。"""
    index_url = TORCH_MIRRORS.get(spec.torch_channel) or TORCH_INDEX.get(spec.torch_channel)
    steps: list[Step] = [
        Step(
            key="prepare",
            title="准备工作目录",
            detail=f"创建 {spec.workspace}",
        ),
        Step(
            key="runtime",
            title="准备 Python 运行时",
            detail=(
                f"基础环境已就绪（{spec.env_python}）"
                if spec.python_ready
                else f"下载 Python {spec.runtime_version} 便携版（约 48MB），解压到 {spec.environment}"
            ),
            estimated_gb=0.0 if spec.python_ready else 0.2,
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
            key="models",
            title="接入共享模型目录",
            detail=f"写入 extra_model_paths.yaml，直接使用项目里的 {models_root()}（与实例目录平级，不复制权重）",
        ),
    ]

    if not spec.deps_ready:
        if spec.torch_channel in SPECIAL_PACKAGES:
            packages = SPECIAL_PACKAGES[spec.torch_channel]
            steps.append(
                Step(
                    key="torch",
                    title="安装加速运行时",
                    detail=f"安装 {' '.join(packages)}（DirectML 后端）到共享环境",
                    command=[str(spec.env_python), "-m", "pip", "install", "--target", str(spec.env_site), *packages],
                    timeout=PIP_TIMEOUT,
                    estimated_gb=2.5,
                )
            )
        else:
            cmd = [
                str(spec.env_python), "-m", "pip", "install",
                "--target", str(spec.env_site), "--upgrade",
                "torch", "torchvision", "torchaudio",
            ]
            if index_url:
                cmd += ["--index-url", index_url]
            steps.append(
                Step(
                    key="torch",
                    title="安装 PyTorch",
                    detail=(
                        f"从 {'交大镜像' if index_url in TORCH_MIRRORS.values() else 'PyTorch 官方索引'}安装 {spec.torch_channel} 版本"
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
                detail="按 requirements.txt 安装到共享环境；torch 已就位，不会被覆盖",
                command=[
                    str(spec.env_python), "-m", "pip", "install",
                    "--target", str(spec.env_site), "--upgrade",
                    "-r", "requirements.txt",
                ],
                cwd=spec.comfy_dir,
                timeout=PIP_TIMEOUT,
                estimated_gb=1.5,
            ),
            Step(
                key="lock",
                title="记录依赖快照",
                detail="生成 requirements.lock，便于出问题时恢复到当前状态",
            ),
        ]
    else:
        steps.append(
            Step(
                key="deps-reuse",
                title="复用已有依赖环境",
                detail=f"{spec.env_site} 里已有 torch，跳过下载，只克隆代码",
            )
        )

    steps.append(
        Step(
            key="verify",
            title="验证安装结果",
            detail="检查 torch 版本、CUDA 运行时与 GPU 是否真的可用",
            command=[
                str(spec.env_python),
                "-c",
                "import torch;"
                "print('torch', torch.__version__);"
                "print('cuda_runtime', torch.version.cuda);"
                "print('cuda_available', torch.cuda.is_available());"
                "print('device_count', torch.cuda.device_count());",
            ],
            cwd=spec.comfy_dir,
            env_extra={"PYTHONPATH": str(spec.env_site)},
            timeout=180,
        )
    )
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


def runtime_url() -> tuple[str, str] | None:
    """当前平台对应的运行时包 (url, filename)，不支持时返回 None。"""
    system = platform.system().lower()
    os_name = {"darwin": "macos"}.get(system, system)
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x86_64"
    url = COMFY_PYTHON_URLS.get((os_name, arch))
    if url is None:
        return None
    return url, url.rsplit("/", 1)[-1]


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
    log(f"# 实例目录 {spec.workspace}")
    log(f"# 基础环境 {spec.environment}（Python {spec.runtime_version}）")
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
        python=spec.runtime_version,
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
            spec.environment.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return False, f"无法创建工作目录: {exc}"
        return True, "已创建"

    if step.key == "runtime":
        return _prepare_runtime(spec, send, log)

    if step.key == "clone":
        return _clone(step, spec, send, log)

    if step.key == "models":
        try:
            path = write_extra_model_paths(spec.comfy_dir)
        except (OSError, ValueError) as exc:
            return False, f"写入 extra_model_paths.yaml 失败: {exc}"
        log(f"$ 写入 {path}")
        send({"type": "log", "line": f"共享模型目录已接入: {path}"})
        return True, "已接入共享模型目录"

    if step.key == "lock":
        return _write_lock(spec, log)

    if step.key == "deps-reuse":
        return True, "已复用"

    if step.command is None:
        return True, "跳过"

    return _exec(step, send, log)


def _prepare_runtime(spec: InstallSpec, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    """下载并解压便携版 Python。已就绪时直接跳过。"""
    if spec.python_ready:
        send({"type": "log", "line": f"Python 运行时已就绪: {spec.env_python}"})
        return True, "已就绪"

    target = runtime_url()
    if target is None:
        return False, f"当前平台（{platform.system()} {platform.machine()}）没有预编译的 Python 运行时"
    url, filename = target

    cache_dir = spec.environment / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / filename

    expected = COMFY_PYTHON_SHA256.get(filename)
    if archive.is_file() and expected and _sha256(archive) == expected:
        send({"type": "log", "line": f"复用已缓存的运行时: {archive.name}"})
    else:
        send({"type": "log", "line": f"下载 {filename}"})
        ok, message = _download(url, archive, send, log)
        if not ok:
            return False, message
        if expected:
            actual = _sha256(archive)
            if actual != expected:
                archive.unlink(missing_ok=True)
                return False, f"校验失败：期望 {expected[:16]}…，实际 {actual[:16]}…"
            send({"type": "log", "line": "sha256 校验通过"})

    # 包里根目录就是 python/，直接解到 environment 下
    try:
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(spec.environment)
    except (tarfile.TarError, OSError) as exc:
        return False, f"解压失败: {exc}"

    if not spec.python_ready:
        return False, f"解压后未找到解释器: {spec.env_python}"
    send({"type": "log", "line": f"Python 已就绪: {spec.env_python}"})
    return True, "已就绪"


def _download(
    url: str,
    dest: Path,
    send: Callable[[dict], None],
    log: Callable[[str], None],
) -> tuple[bool, str]:
    """流式下载，按 10% 粒度汇报进度。"""
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_report = -1
    try:
        with httpx.stream("GET", url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as resp:
            if resp.status_code >= 400:
                return False, f"下载失败：HTTP {resp.status_code}"
            total = int(resp.headers.get("content-length") or 0)
            done = 0
            with tmp.open("wb") as fh:
                for chunk in resp.iter_bytes(262144):
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        pct = int(done * 100 / total)
                        if pct // 10 != last_report // 10:
                            last_report = pct
                            line = f"下载进度 {pct}%（{done / 1048576:.1f} / {total / 1048576:.1f} MB）"
                            log(line)
                            send({"type": "log", "line": line})
    except (httpx.HTTPError, OSError) as exc:
        tmp.unlink(missing_ok=True)
        return False, f"下载中断: {exc}"

    tmp.replace(dest)
    return True, "下载完成"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_lock(spec: InstallSpec, log: Callable[[str], None]) -> tuple[bool, str]:
    """记录当前依赖版本，便于以后恢复到同一状态。"""
    env = clean_env()
    env["PYTHONPATH"] = str(spec.env_site)
    try:
        proc = subprocess.run(
            [str(spec.env_python), "-m", "pip", "freeze"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            env=env,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"生成依赖快照失败: {exc}"
    if proc.returncode != 0:
        return False, f"pip freeze 失败: {(proc.stderr or '').strip()[:200]}"
    lock_path = spec.environment / "requirements.lock"
    lock_path.write_text(proc.stdout, encoding="utf-8")
    log(f"$ 写入 {lock_path}（{len(proc.stdout.splitlines())} 个包）")
    return True, "已记录"


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
        send({"type": "log", "line": "镜像不可用，尝试下一个源…" if url == attempts[0] and len(attempts) > 1 else last})
    return False, f"代码获取失败: {last}"


def _exec(step: Step, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    assert step.command is not None
    log(f"$ {' '.join(step.command)}")
    env = clean_env()
    env.update(step.env_extra)
    try:
        proc = subprocess.Popen(
            step.command,
            cwd=str(step.cwd) if step.cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
            env=env,
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
