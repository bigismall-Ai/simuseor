"""ComfyUI 环境安装（M3）。

设计要点
--------
1. **两段式**：`build_steps()` 是纯函数，只产出"要执行什么"；`run_install()` 负责执行。
   预演（dry-run）和真实安装走同一份步骤列表，保证"看到的"就是"要做的"。
2. **不用 comfy-cli**：它的 `--cuda-version` 枚举只到 12.9，装不了 cu130，
   而 cu130 是官方文档给 Blackwell 的推荐组合。直接用 PyTorch 官方索引更可控。
3. **不用 venv**：torch 跟硬件走、不跟 ComfyUI 版本走，所以整套依赖装在
   `comfy/.environment/` 里共享，装第二个版本只需克隆代码。
   实例目录 `comfy/<name>/` 只放 ComfyUI 代码和 instance.json。
4. **顺序不能反**：先按 channel 装 torch，再装 ComfyUI 的 requirements。
   requirements 里含 `torch`，反序的话 pip 会按 PyPI 版本重装，把 CUDA 版覆盖掉。
5. **环境隔离**：执行前清掉 VIRTUAL_ENV / PYTHONPATH / PYTHONHOME，
   否则 pip 会认到后端自己的 venv 上。
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import unquote, urljoin, urlparse

import httpx
from packaging.requirements import Requirement
from packaging.version import InvalidVersion, Version

from ..config import (
    COMFY_DIR,
    COMFY_ENV_DIR,
    COMFY_ENV_NAME,
    COMFY_FALLBACK,
    COMFY_MIRROR,
    COMFY_PYTHON_SHA256,
    COMFY_PYTHON_URLS,
    LOG_DIR,
    WORKSPACE_DIR,
    WORKSPACE_USERDATA_DIR,
    ensure_workspace,
    instance_tmp_dir,
    load_settings,
)
from .model_dirs import write_extra_model_paths
from .models import DeviceReport, ManagedInstance, PythonInfo
from .names import clean_alias, validate_instance_name
from .plan import InstallPlan

# PyTorch 官方 wheel 索引。plan 输出的 channel 直接对应这里的 key，
# installer 不自己判断该装哪个版本。
TORCH_INDEX: dict[str, str | None] = {
    "cu130": "https://download.pytorch.org/whl/cu130",
    "cu126": "https://download.pytorch.org/whl/cu126",
    # rocm* 索引只有 Linux 轮子（无 win_amd64），因此 plan 只在 Linux 选这些通道。
    "rocm7.2": "https://download.pytorch.org/whl/rocm7.2",
    "rocm6.4": "https://download.pytorch.org/whl/rocm6.4",
    # xpu 索引的 cp313 轮子同时覆盖 win_amd64 与 linux_x86_64。
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

# 有些附加包的安装方式与 torch 不同。
# 注意：torch-directml 官方最高只发布到 cp312，没有适配内置 Python 3.13（cp313）
# 的轮子，所以 plan 目前不会产出 directml 通道（Windows AMD 一律按 CPU 装）。
# 保留这段占位，等官方补齐 cp313 轮子后可直接恢复，别在这之前启用。
SPECIAL_PACKAGES: dict[str, list[str]] = {
    "directml": ["torch-directml"],
}

STEP_TIMEOUT = 3600
PIP_TIMEOUT = 5400
DOWNLOAD_TIMEOUT = 900

# 依赖包并发下载数。pip 自己是单连接顺序下，几十个 wheel 时大部分时间在等网络；
# 拆成多路并发后实测能压掉一半以上的等待（镜像对小文件并发很友好）。
MAX_PARALLEL_DOWNLOADS = 6

# 依赖缓存上限（GB），可被 settings.comfy.cache_limit_gb 覆盖。超出后按最久未用淘汰。
DEFAULT_CACHE_LIMIT_GB = 4.0
# 宿主环境可能替换 Python 的删除 API（批量删会直接中断），所以分批删，单批不超过 40。
CACHE_DELETE_BATCH = 40

# 这三个包由 torch 步骤按硬件单独装（cu130/rocm/xpu/cpu），
# requirements.txt 里的 torch 没有版本约束，绝不能让 pip 参与解析——
# 否则会解析成 PyPI 的 CPU 轮子，把共享环境里的加速版本覆盖掉。
TORCH_PACKAGES = {"torch", "torchvision", "torchaudio"}

# 包名归一化：`torch>=2.0` / `torch[opt]` / `Torch` 都算同一个名字
_REQ_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")

# PEP 503 索引页里的 <a href="...whl#sha256=...">，只关心 href
_INDEX_LINK_RE = re.compile(r'href="([^"#]+\.whl)(?:#sha256=([0-9a-fA-F]+))?"')

# 依赖补全最多迭代几轮：每轮只补上一轮暴露出来的传递依赖
MAX_REQUIREMENT_ROUNDS = 4

# 没探测到镜像时的兜底索引（pypi.org 在国内经常连不上，别拿它当默认）
DEFAULT_PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"

# 索引覆盖并不一致：清华缺 comfyui 的模板包，阿里云有；所以按顺序试多个源
DEFAULT_INDEXES = [
    DEFAULT_PIP_INDEX,
    "https://mirrors.aliyun.com/pypi/simple",
]

# pip --progress-bar raw 每 0.25s 输出一行 `Progress <done> of <total>`。
# 解析它可以拿到真实下载字节数与速度，而不是把「第几步」当成进度糊弄用户。
_PIP_PROGRESS_RE = re.compile(r"^Progress (\d+) of (\d+)\s*$")
_PIP_DOWNLOAD_RE = re.compile(r"^\s*(?:Downloading|Using cached)\s+(\S+?)(?:\s+\(([^)]+)\))?\s*$")
_SIZE_RE = re.compile(r"^([\d.]+)\s*([KMG]?B)$", re.I)

# 进度事件的 phase → 阶段语义。前端只做映射展示，不解析中文文案。
PHASE_DOWNLOAD = "download"
PHASE_UNPACK = "unpack"
PHASE_CLONE = "clone"
PHASE_RESOLVE = "resolve"
PHASE_INSTALL = "install"
PHASE_DONE = "done"

# 估算法最多把「当前步骤」推进到 92%：还没跑完就别显示快完成
INDETERMINATE_CAP = 92.0


class _Overall:
    """按步骤耗时折算总进度。

    以前是「(步骤数 - 1 + 本步百分比) / 步骤数」，步骤等权 —— 但 torch 要下
    2GB、依赖要装几百 MB，等权会让进度环在最长的步骤里几乎不动，跨步时再猛
    跳一格。现在权重直接用各步骤的典型耗时（`Step.expected_seconds`），
    数字和真实时长对得上；拿不到百分比的步骤按自己的预计耗时做时间估算，
    永远取最大值，保证总进度只增不减。
    """

    def __init__(self, steps: list["Step"]) -> None:
        self.expected = {step.key: max(0.5, step.expected_seconds) for step in steps}
        self.total = sum(self.expected.values()) or 1.0
        self.cursor = 0.0
        self.span = 0.0
        self.last_pct = 0.0
        self.started = time.monotonic()
        self.value = 0.0

    def start(self, key: str | None) -> float:
        # 上一步的耗时在这里结算：step_done 之后还会补一条 100% 的进度事件，
        # 若在 step_done 里累加就会把同一步算两次。
        self.cursor += self.span
        self.span = self.expected.get(key or "", 0.5)
        self.last_pct = 0.0
        self.started = time.monotonic()
        return self.push(0.0)

    def advance(self, percent: float) -> float:
        if percent < 0:
            pct = self.estimate()
        else:
            self.last_pct = max(self.last_pct, min(100.0, percent))
            pct = self.last_pct
        return self.push(pct)

    def estimate(self) -> float:
        """拿不到真实百分比（git clone / pip 解包 / 索引解析）时按时间推进。

        时间常数取本步预计耗时的一半：跑掉一半预计时间就走到 ~58%，
        这样长步骤不会一动不动，但也不会假装快装完了（封顶 92%）。
        """
        elapsed = time.monotonic() - self.started
        guess = INDETERMINATE_CAP * (1.0 - math.exp(-elapsed / (self.span / 2.0)))
        return max(self.last_pct, guess)

    def push(self, percent: float) -> float:
        done = self.cursor + self.span * min(100.0, max(0.0, percent)) / 100.0
        self.value = max(self.value, min(100.0, done / self.total * 100.0))
        return round(self.value, 1)


class _SpeedMeter:
    """把字节增量换算成平滑速度，避免每个 chunk 都跳一次数字。"""

    def __init__(self) -> None:
        self.done = 0
        self.at = time.monotonic()
        self.speed = 0.0

    def reset(self) -> None:
        self.done = 0
        self.at = time.monotonic()
        self.speed = 0.0

    def update(self, done: int) -> float:
        now = time.monotonic()
        dt = now - self.at
        if dt > 0 and done >= self.done:
            instant = (done - self.done) / dt
            self.speed = instant if self.speed <= 0 else self.speed * 0.55 + instant * 0.45
        self.done = done
        self.at = now
        return self.speed


def _progress(
    send: Callable[[dict], None],
    *,
    key: str,
    phase: str,
    label: str = "",
    done: int = 0,
    size: int = 0,
    speed: float = 0.0,
    percent: float = -1.0,
) -> None:
    """发出一条进度事件。size=0 表示总量未知，percent 保持 -1（无限进度条）。"""
    if percent < 0 and size > 0:
        percent = min(100.0, done * 100.0 / size)
    eta = round((size - done) / speed, 1) if speed > 0 and size > done > 0 else None
    send(
        {
            "type": "progress",
            "key": key,
            "phase": phase,
            "label": label,
            "done": int(done),
            "size": int(size),
            "percent": round(percent, 1),
            "speed": round(speed, 1),
            "eta": eta,
        }
    )


def _pulse(
    send: Callable[[dict], None],
    *,
    key: str,
    phase: str,
    label: str,
    start: float,
    end: float,
    expected: float,
) -> Callable[[], None]:
    """给无法报告进度的阶段（pip 解包、git clone）打心跳。

    _Overall 会把 percent 当真实值，长阶段完全不动会让人以为卡死；
    按预计耗时平滑逼近上界，但绝不越过（真完成由调用方显式发 100）。
    """
    stop = threading.Event()
    began = time.monotonic()

    def loop() -> None:
        while not stop.wait(0.8):
            ratio = 1.0 - math.exp(-(time.monotonic() - began) / max(5.0, expected / 2.0))
            _progress(
                send, key=key, phase=phase, label=label,
                percent=start + (end - start) * ratio,
            )

    threading.Thread(target=loop, name=f"pulse-{key}", daemon=True).start()
    return stop.set


def _to_bytes(text: str) -> int:
    """'2.4 GB' -> 2400000000；解析不了返回 0。"""
    match = _SIZE_RE.match(text.strip())
    if not match:
        return 0
    units = {"B": 1, "KB": 1000, "MB": 1000**2, "GB": 1000**3}
    return int(float(match.group(1)) * units.get(match.group(2).upper(), 1))


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
    # prepare 目录作用域：env / instance / both。基础环境与实例分开装时互不建目录。
    scope: str = "both"
    # 该步骤的典型耗时（秒）。既是总进度里的权重，也是「拿不到真实百分比」
    # 时的估算基准 —— 一个数只维护一处，免得权重和时间两张皮。
    expected_seconds: float = 20.0


@dataclass
class InstallSpec:
    """一次安装的全部已知条件。由 make_spec() 从 device + plan 生成。"""

    name: str
    workspace: Path
    environment: Path
    torch_channel: str
    #: 用户起的可读名。目录名不能改（磁盘路径），所以单独存一份进 instance.json
    alias: str = ""
    repo_url: str = COMFY_MIRROR
    fallback_url: str = COMFY_FALLBACK
    tag: str | None = None
    # 「环境检测 → 修复」：强制重装 PyTorch，不能因为目录还在就跳过
    repair: bool = False
    runtime_version: str = COMFY_ENV_NAME
    # 由 plan 实测选出；为空时退回内置默认顺序
    torch_index: str = ""
    pip_index: str = ""
    torch_index_note: str = ""
    pip_index_note: str = ""

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


# ---------------- 可安装版本 ----------------

#: 版本 tag 会拼进 git 命令行，只放行版本号常见字符。
_TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
#: 列一次 tag 要走 `git ls-remote`（镜像约 1–3 秒），一小时内复用结果。
VERSION_CACHE_SECONDS = 3600
VERSION_LIMIT = 30
_version_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def parse_tags(text: str, limit: int = VERSION_LIMIT) -> list[dict[str, Any]]:
    """解析 `git ls-remote --tags --refs` 的输出，按版本号降序。

    只认能解析成 PEP 440 的 tag（ComfyUI 是 v0.3.40 这种）；稳定版排在预览版
    前面，别让 rc 挡住用户真正想装的版本。
    """
    found: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 2 or not parts[1].startswith("refs/tags/"):
            continue
        name = parts[1][len("refs/tags/"):].removesuffix("^{}")
        if name in found or not _TAG_RE.match(name):
            continue
        try:
            version = Version(name.lstrip("vV"))
        except InvalidVersion:
            continue
        found[name] = {
            "tag": name,
            "sha": parts[0][:12],
            "prerelease": version.is_prerelease,
        }
    ordered = sorted(
        found.values(),
        key=lambda item: Version(str(item["tag"]).lstrip("vV")),
        reverse=True,
    )
    stable = [item for item in ordered if not item["prerelease"]]
    preview = [item for item in ordered if item["prerelease"]]
    return (stable + preview)[:limit]


def list_versions(limit: int = VERSION_LIMIT) -> dict[str, Any]:
    """列出可安装的 ComfyUI 版本。镜像优先、失败退 GitHub，都失败给空列表。

    走 git 协议而不是 GitHub REST：镜像同样有 tag，且不受 60 次/小时的匿名限流。
    """
    cached = _version_cache.get("payload")
    if cached and time.time() - float(_version_cache["at"]) < VERSION_CACHE_SECONDS:
        return {**cached, "cached": True}

    tags: list[dict[str, Any]] = []
    source = ""
    for url in (COMFY_MIRROR, COMFY_FALLBACK):
        if not url:
            continue
        try:
            proc = subprocess.run(
                ["git", "ls-remote", "--tags", "--refs", url],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
                env=clean_env(),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0 and proc.stdout.strip():
            tags = parse_tags(proc.stdout, limit)
            source = "mirror" if url == COMFY_MIRROR else "github"
            break
    # 拿不到就下次再试，别让一次网络抖动把空列表锁一小时
    if tags:
        _version_cache.update(at=time.time(), payload={"tags": tags, "source": source})
    return {"tags": tags, "source": source, "cached": False}


def _unique_instance_name(name: str) -> str:
    """同名实例已存在时加序号，避免装第二个版本时覆盖前一个。"""
    if not (COMFY_DIR / name).exists():
        return name
    index = 2
    while (COMFY_DIR / f"{name}-{index}").exists():
        index += 1
    return f"{name}-{index}"


def make_spec(
    report: DeviceReport,
    plan: InstallPlan,
    *,
    name: str = "",
    tag: str | None = None,
    repair: bool = False,
    alias: str = "",
) -> InstallSpec:
    """把 device + plan 折叠成执行所需的规格。缺关键前提时抛 ValueError。"""
    if plan.tier == "blocked":
        raise ValueError(plan.blocked_reason or "当前环境不满足安装条件")

    tag = (tag or "").strip()
    # tag 会拼进 git 命令行，必须白名单校验，别让奇怪字符进到参数里
    if tag and not _TAG_RE.match(tag):
        raise ValueError(f"版本号不合法: {tag}")

    if name.strip():
        instance_name = name.strip()
    elif tag:
        # 装了某个版本，目录就叫那个版本，一眼能看出跑的是什么；
        # 同名已存在时加序号——绝不能落到已有实例目录上，_clone 会先 rmtree。
        instance_name = _unique_instance_name(tag)
    else:
        instance_name = time.strftime("v%Y%m%d-%H%M%S")
    # 名字会拼进 comfy/<name>/ 并参与写盘与删除，必须在唯一入口处挡住路径穿越
    instance_name = validate_instance_name(instance_name)
    return InstallSpec(
        name=instance_name,
        alias=clean_alias(alias),
        workspace=COMFY_DIR / instance_name,
        environment=COMFY_ENV_DIR,
        torch_channel=plan.torch_channel,
        torch_index=plan.torch_index,
        pip_index=plan.pip_index,
        torch_index_note=plan.torch_index_note,
        pip_index_note=plan.pip_index_note,
        tag=tag,
        repair=repair,
    )


def shared_spec() -> InstallSpec:
    """共享基础环境的轻量 spec，只用来装额外依赖（自定义节点）。

    `run_requirements` 只需要解释器、site-packages 与缓存目录，这三样都在
    `comfy/.environment` 里，与实例无关；comfy_dir 落到 workspace 下，
    仅作为 pip 的工作目录兜底。
    """
    return InstallSpec(
        name=".environment",
        workspace=WORKSPACE_DIR,
        environment=COMFY_ENV_DIR,
        torch_channel="",
        runtime_version=COMFY_ENV_NAME,
    )


# ---------------- 步骤生成（纯函数） ----------------
#: UI 只用 environment / instance：基础环境卡只装运行时，实例卡只装 ComfyUI 代码。
#: full 是一键全装的旧路径，保留给离线脚本与回归测试，界面不再暴露。
INSTALL_KINDS = ("environment", "instance", "full")
JOB_KIND_ENV = "environment"
JOB_KIND_INSTANCE = "instance"


def _prepare_step(scope: str) -> Step:
    return Step(key="prepare", title="准备工作目录", detail="创建所需目录", scope=scope, expected_seconds=1.0)


def _runtime_step(spec: InstallSpec) -> Step:
    return Step(
        key="runtime",
        title="准备运行环境",
        detail="基础环境已就绪" if spec.python_ready else "下载内置运行时",
        estimated_gb=0.0 if spec.python_ready else 0.2,
        expected_seconds=1.0 if spec.python_ready else 60.0,
    )


def _clone_step(spec: InstallSpec) -> Step:
    return Step(
        key="clone",
        title="获取 ComfyUI 代码",
        detail="从镜像获取代码" + (f" · {spec.tag}" if spec.tag else ""),
        command=["git", "clone", "--depth", "1"]
        + (["--branch", spec.tag] if spec.tag else [])
        + [spec.repo_url, str(spec.comfy_dir)],
        timeout=900,
        estimated_gb=0.5,
        expected_seconds=40.0,
    )


def _models_step() -> Step:
    return Step(key="models", title="接入共享模型目录", detail="接入项目里的共享模型目录", expected_seconds=1.0)


def _deps_reuse_step() -> Step:
    return Step(key="deps-reuse", title="复用已有依赖环境", detail="复用共享环境，跳过下载", expected_seconds=1.0)


def _torch_step(spec: InstallSpec) -> Step:
    index_url = (
        spec.torch_index
        or TORCH_MIRRORS.get(spec.torch_channel)
        or TORCH_INDEX.get(spec.torch_channel)
    )
    if spec.torch_channel in SPECIAL_PACKAGES:
        packages = SPECIAL_PACKAGES[spec.torch_channel]
        return Step(
            key="torch",
            title="安装加速运行时",
            detail="安装 DirectML 加速库",
            command=[str(spec.env_python), "-m", "pip", "install", "--target", str(spec.env_site), *packages],
            timeout=PIP_TIMEOUT,
            estimated_gb=2.5,
            expected_seconds=300.0,
        )
    cmd = [
        str(spec.env_python), "-m", "pip", "install",
        "--target", str(spec.env_site), "--upgrade",
        "torch", "torchvision", "torchaudio",
    ]
    if index_url:
        cmd += ["--index-url", index_url]
    return Step(
        key="torch",
        title="安装 PyTorch",
        detail="安装显卡加速库",
        command=cmd,
        timeout=PIP_TIMEOUT,
        estimated_gb=3.0,
        expected_seconds=300.0,
    )


def _requirements_step(spec: InstallSpec) -> Step:
    return Step(
        key="requirements",
        title="安装 ComfyUI 依赖",
        # 先让 pip 只解析出「缺哪些包」，再并发下载、离线安装；
        # 已装好的包一个字节都不重下（走普通 pip 时 --target 会整包重装）。
        detail="只补缺少的包，多线程下载",
        timeout=PIP_TIMEOUT,
        estimated_gb=1.5,
        expected_seconds=240.0,
    )


def _lock_step() -> Step:
    return Step(key="lock", title="记录依赖快照", detail="生成依赖快照", expected_seconds=2.0)


def _verify_step(spec: InstallSpec, cwd: Path) -> Step:
    return Step(
        key="verify",
        title="验证安装结果",
        detail="检查显卡加速是否可用",
        command=[
            str(spec.env_python),
            "-c",
            "import torch;print('torch', torch.__version__);" + _verify_snippet(spec.torch_channel),
        ],
        cwd=cwd,
        env_extra={"PYTHONPATH": str(spec.env_site)},
        timeout=180,
        expected_seconds=20.0,
    )


def _environment_steps(spec: InstallSpec) -> list[Step]:
    """只装 .environment：内置 Python + 按硬件选的 PyTorch（CUDA 运行时随 wheel）。

    repair=True 时即便 torch 目录还在也强制重装：环境检测发现「文件在但跑不起来」
    时，复用分支会让修复按钮变成空操作。
    """
    steps = [_prepare_step("env"), _runtime_step(spec)]
    if spec.deps_ready and not spec.repair:
        steps.append(_deps_reuse_step())
    else:
        steps += [_torch_step(spec), _lock_step()]
    steps.append(_verify_step(spec, spec.environment))
    return steps


def _instance_steps(spec: InstallSpec) -> list[Step]:
    """只装一个 ComfyUI 实例：代码 + 模型目录接入 + 补齐该版本依赖。"""
    return [
        _prepare_step("instance"),
        _clone_step(spec),
        _models_step(),
        _requirements_step(spec),
        _verify_step(spec, spec.comfy_dir),
    ]


def build_steps(spec: InstallSpec, kind: str = "full") -> list[Step]:
    """按任务类型产出步骤序列。不触碰文件系统，可安全用于预演。"""
    if kind == JOB_KIND_ENV:
        return _environment_steps(spec)
    if kind == JOB_KIND_INSTANCE:
        return _instance_steps(spec)
    if kind != "full":
        raise ValueError(f"未知的安装类型: {kind}")

    # 旧的一键全装路径：顺序必须保持 clone 在 requirements 之前、torch 在 requirements 之前。
    steps = [
        _prepare_step("both"),
        _runtime_step(spec),
        _clone_step(spec),
        _models_step(),
    ]
    if spec.deps_ready:
        steps.append(_deps_reuse_step())
    else:
        steps += [_torch_step(spec), _requirements_step(spec), _lock_step()]
    steps.append(_verify_step(spec, spec.comfy_dir))
    return steps


def _verify_snippet(channel: str) -> str:
    """安装收尾按实际后端验证，不能拿 CUDA 判定 XPU / MPS / CPU 是否可用。"""
    if channel == "xpu":
        return (
            "print('backend', 'xpu');"
            "print('xpu_available', hasattr(torch, 'xpu') and torch.xpu.is_available());"
        )
    if channel == "mps":
        return (
            "print('backend', 'mps');"
            "print('mps_available', hasattr(torch.backends, 'mps') and torch.backends.mps.is_available());"
        )
    if channel == "directml":
        return (
            "import torch_directml;print('backend', 'directml');"
            "print('device_count', torch_directml.device_count());"
        )
    if channel == "cpu":
        return "print('backend', 'cpu');print('cpu_threads', torch.get_num_threads());"
    # CUDA 与 ROCm 共用 torch.cuda 接口
    return (
        "print('backend', 'cuda/rocm');"
        "print('cuda_runtime', torch.version.cuda);"
        "print('cuda_available', torch.cuda.is_available());"
        "print('device_count', torch.cuda.device_count());"
    )


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
    kind: str = "full",
) -> InstallResult:
    """按任务类型执行安装。emit 收到结构化事件，供前端流式展示。"""
    steps = build_steps(spec, kind)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"comfy-{spec.name}.log"
    started = time.time()
    overall = _Overall(steps)

    def send(event: dict) -> None:
        kind_ = event.get("type")
        if kind_ == "step_start":
            event["overall"] = overall.start(event.get("key"))
        elif kind_ == "step_done":
            # 成功即算这一步走完；失败就停在原地，别把失败步骤也显示成 100%
            event["overall"] = (
                overall.advance(100.0)
                if event.get("ok")
                else overall.push(overall.last_pct)
            )
        elif kind_ == "progress":
            event["overall"] = overall.advance(event.get("percent", -1))
        if emit:
            emit(event)

    log_file = log_path.open("w", encoding="utf-8", errors="replace")

    def log(text: str) -> None:
        log_file.write(text + "\n")
        log_file.flush()

    # 所有写日志的动作（含最后那句「安装完成」）都必须在 close 之前完成。
    # 曾经把成功收尾放在 finally 之后，写入已关闭的句柄，结果整个安装明明
    # 成功却被上报成「安装异常: I/O operation on closed file」。
    try:
        log(f"# 安装类型 {kind}")
        log(f"# 任务名 {spec.name}")
        if kind in ("full", JOB_KIND_INSTANCE):
            log(f"# 实例目录 {spec.workspace}")
        log(f"# 基础环境 {spec.environment}（Python {spec.runtime_version}）")
        log(f"# 加速通道 {spec.torch_channel}")
        log("")

        if dry_run:
            for step in steps:
                send({"type": "step_plan", "key": step.key, "title": step.title, "command": step.command})
            return InstallResult(ok=True, message="预演完成，未改动磁盘", log_path=str(log_path))

        # 共享目录是实例运行的前提（--base-directory / --user-directory），
        # 安装阶段就建好，避免首次启动才发现目录缺失
        created = ensure_workspace()
        log(f"# 共享目录 {created}")

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
                header = f"== [{index}/{len(steps)}] {step.title}"
                log(header)
                send({"type": "log", "line": header})

                ok, message = _run_step(step, spec, send, log)
                send({"type": "step_done", "key": step.key, "ok": ok, "message": message})
                if ok:
                    # 让总进度条在步骤收尾时补满，不必等下一个 step_start
                    _progress(send, key=step.key, phase=PHASE_DONE, label=step.title, percent=100)
                if not ok and not step.optional:
                    log(f"!! 失败: {message}")
                    send({"type": "log", "line": f"!! {message}"})
                    return InstallResult(ok=False, message=message, log_path=str(log_path))
        except Exception as exc:  # noqa: BLE001
            log(f"!! 异常: {exc}")
            send({"type": "log", "line": f"!! 安装中断: {exc}"})
            return InstallResult(ok=False, message=f"安装中断: {exc}", log_path=str(log_path))

        # 只有实例类任务才登记 instance.json；装基础环境不该造出实例目录。
        instance = None
        if kind in ("full", JOB_KIND_INSTANCE):
            instance = ManagedInstance(
                name=spec.name,
                path=str(spec.workspace),
                version=spec.tag or _comfy_version(spec.comfy_dir),
                python=spec.runtime_version,
                port=None,
                created_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            )
            try:
                _write_instance_meta(spec, instance, log, send)
            except OSError as exc:
                message = f"写入实例信息失败: {exc}"
                log(f"!! 失败: {message}")
                send({"type": "log", "line": f"!! {message}"})
                return InstallResult(ok=False, message=message, log_path=str(log_path))

        elapsed = time.time() - started
        label = "基础环境安装完成" if kind == JOB_KIND_ENV else "安装完成"
        message = f"{label}，用时 {elapsed:.0f} 秒"
        log(f"== {message}")
        send({"type": "log", "line": f"== {message}"})
        return InstallResult(ok=True, message=message, log_path=str(log_path), instance=instance)
    finally:
        log_file.close()


def _comfy_version(comfy_dir: Path) -> str | None:
    """从克隆下来的 comfyui_version.py 里读真实版本号（比 tag 可靠）。"""
    try:
        text = (comfy_dir / "comfyui_version.py").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"__version__\s*=\s*[\"']([^\"']+)", text)
    return match.group(1) if match else None


def _write_instance_meta(
    spec: InstallSpec,
    instance: ManagedInstance,
    log: Callable[[str], None],
    send: Callable[[dict], None],
) -> None:
    """写 instance.json；probe 只认这个文件，缺了它界面里看不到新实例。"""
    meta_path = spec.workspace / "instance.json"
    payload = {
        "name": instance.name,
        "alias": spec.alias,
        "version": instance.version,
        "python": instance.python,
        "torch_channel": spec.torch_channel,
        "created_at": instance.created_at,
        # 端口在首次启动时由 runner 写回；这里先占位，保证字段稳定
        "port": instance.port,
        # 把三个共享目录登记下来：界面要知道资产在哪，启动时也按这套参数拉起
        "base_directory": str(WORKSPACE_DIR),
        "user_directory": str(WORKSPACE_USERDATA_DIR),
        "temp_directory": str(instance_tmp_dir(instance.name)),
    }
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"$ 写入 {meta_path}")
    send({"type": "log", "line": "实例信息已登记"})


def _req_name(line: str) -> str | None:
    """从 requirements 一行里取出包名（跳过注释、空行、-r/-e/--index-url 等选项）。"""
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or stripped.startswith("-"):
        return None
    match = _REQ_NAME_RE.match(stripped)
    return match.group(1).lower().replace("_", "-") if match else None


def write_filtered_requirements(
    spec: InstallSpec,
    source: Path | None = None,
    name: str = "requirements.comfy.txt",
) -> Path:
    """把 requirements.txt 里 torch 系列的条目剔掉，写到缓存目录。

    torch 由按硬件选定的通道单独安装；requirements 里的 `torch` 没有版本约束，
    一旦让 pip 参与解析，就会用 PyPI 的 CPU 轮子覆盖共享环境里的加速版本。
    这一步在实例安装时尤其重要：pip 的 `--target` 隐含 `--ignore-installed`。

    `source` 留给自定义节点：它们的 requirements 在各自仓库目录里，
    过滤后的副本按 `name` 分开存，互不覆盖。
    """
    source = source or (spec.comfy_dir / "requirements.txt")
    cache_dir = spec.environment / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / name

    kept: list[str] = []
    try:
        lines = source.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    for line in lines:
        name = _req_name(line)
        if name and (name in TORCH_PACKAGES or name.replace("-", "_") in TORCH_PACKAGES):
            continue
        kept.append(line)
    target.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return target


def _requirements_env(spec: InstallSpec) -> dict[str, str]:
    """让 pip 看得见共享 site-packages，才会跳过已经装好的包。"""
    env = clean_env()
    env["PYTHONPATH"] = str(spec.env_site)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    return env


def installed_versions(site: Path) -> dict[str, str]:
    """扫描共享 site-packages 里的 dist-info，得到 {归一化包名: 版本}。

    比启动解释器查 importlib.metadata 快得多（纯目录扫描，毫秒级），
    也避免了 pip 的 --target 会强制 ignore_installed 的坑。
    """
    out: dict[str, str] = {}
    try:
        entries = list(site.iterdir())
    except OSError:
        return out
    for entry in entries:
        name = entry.name
        if not name.endswith(".dist-info"):
            continue
        stem = name[: -len(".dist-info")]
        pkg, _, version = stem.rpartition("-")
        if pkg:
            out[_normalize(pkg)] = version
    return out


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(req_file: Path) -> list[str]:
    """取出 requirements 里的依赖声明（跳过注释与 -r/--index-url 这类选项）。"""
    try:
        lines = req_file.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    specs: list[str] = []
    for line in lines:
        stripped = line.split(" #", 1)[0].strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("-"):
            continue
        specs.append(stripped)
    return specs


def _spec_name(spec: str) -> str:
    match = _REQ_NAME_RE.match(spec)
    return _normalize(match.group(1)) if match else ""


def _index_candidates(primary: str) -> list[str]:
    """主索引优先，其次内置兜底源；去重后按顺序试。"""
    out: list[str] = []
    for item in [primary, *DEFAULT_INDEXES]:
        if item and item not in out:
            out.append(item)
    return out


def _index_page_url(index: str, name: str) -> str:
    return f"{index.rstrip('/')}/{name}/"


def _platform_ok(plat: str) -> bool:
    if plat == "any":
        return True
    if sys.platform == "win32":
        return plat.startswith("win_amd64")
    if sys.platform == "darwin":
        return plat.startswith(("macosx", "any"))
    return plat.startswith(("manylinux", "musllinux", "linux_x86_64"))


def _wheel_compatible(filename: str, python_tag: str) -> bool:
    """粗筛 wheel 是否适配目标解释器（3.13 / 当前平台）。

    注意排除 cp313t 这类「自由线程」ABI：python tag 一样是 cp313，
    但普通 CPython 装不上（pip 会直接报 not a supported wheel）。
    """
    if not filename.endswith(".whl"):
        return False
    parts = filename[:-4].split("-")
    if len(parts) < 5:
        return False
    py, abi, plat = parts[-3], parts[-2], parts[-1]
    if not _platform_ok(plat):
        return False
    if abi.startswith("cp") and abi.rstrip("0123456789").endswith("t"):
        return False
    python_parts = py.split(".")
    if python_tag in python_parts:
        return True
    if "py3" in python_parts:
        return abi == "none" or abi.startswith("abi3")
    return abi.startswith("abi3") and plat != "any"


def _wheel_rank(filename: str, python_tag: str) -> tuple[int, int]:
    """同版本多个轮子时的优先级：原生 cp313 轮 > abi3 > 纯 py3，平台专属优先。"""
    parts = filename[:-4].split("-")
    py, abi, plat = parts[-3], parts[-2], parts[-1]
    if py == python_tag and abi == python_tag:
        kind = 3
    elif abi.startswith("abi3"):
        kind = 2
    else:
        kind = 1
    return (kind, 0 if plat == "any" else 1)


def _name_variants(name: str) -> list[str]:
    """同一个包在索引里可能有多种写法：镜像对 dash / underscore 处理并不一致。"""
    variants = [name, name.replace("-", "_"), name.replace("_", "-")]
    seen: list[str] = []
    for item in variants:
        if item and item not in seen:
            seen.append(item)
    return seen


def _load_index(index: str, name: str, python_tag: str, log: Callable[[str], None]) -> list[dict]:
    """从 PEP 503 索引页拿某个包的全部候选 wheel（不下载包体）。

    镜像对包名写法并不统一（dash / underscore），大页面的响应也偏慢，
    所以逐个写法试、失败重试一次，别因为一个名字写法就判死。
    """
    for variant in _name_variants(name):
        resp = None
        url = ""
        for base in _index_candidates(index):
            url = _index_page_url(base, variant)
            for attempt in range(2):
                try:
                    resp = httpx.get(url, timeout=60, follow_redirects=True)
                    if resp.status_code < 400:
                        break
                except httpx.HTTPError as exc:
                    if attempt == 1:
                        log(f"  索引查询失败 {variant}: {exc}")
                    resp = None
            if resp is not None and resp.status_code < 400:
                break
        if resp is None or resp.status_code >= 400:
            continue

        found: list[dict] = []
        for href, digest in _INDEX_LINK_RE.findall(resp.text):
            filename = unquote(href.rsplit("/", 1)[-1].split("#")[0])
            if not _wheel_compatible(filename, python_tag):
                continue
            parts = filename[:-4].split("-")
            version = parts[1] if len(parts) > 1 else ""
            absolute = href if href.startswith("http") else urljoin(url, href)
            found.append({"name": name, "version": version, "url": absolute, "sha256": digest})
        if found:
            return found
    return []


def _pick_wheel(candidates: list[dict], spec_str: str, python_tag: str) -> dict | None:
    """按 requirements 的版本约束挑最高版本、且与本机最匹配的 wheel。"""
    if not candidates:
        return None
    try:
        requirement = Requirement(spec_str)
    except Exception:  # noqa: BLE001 - 解析不了的声明按无约束处理
        requirement = None
    usable = []
    for item in candidates:
        if requirement is not None:
            try:
                if not requirement.specifier.contains(item["version"], prereleases=False):
                    continue
            except Exception:  # noqa: BLE001
                pass
        usable.append(item)
    if not usable:
        return None
    try:
        usable.sort(key=lambda item: Version(item["version"]), reverse=True)
    except Exception:  # noqa: BLE001 - 版本号不规范时保持索引顺序
        pass
    # 同版本多个轮子时优先原生 cp313 轮、平台专属轮（避开 cp313t / any）
    top_version = usable[0]["version"]
    same = [item for item in usable if item["version"] == top_version]
    if len(same) > 1:
        same.sort(
            key=lambda item: _wheel_rank(_wheel_name(item["url"]), python_tag),
            reverse=True,
        )
        return same[0]
    return usable[0]


def _wheel_name(url: str) -> str:
    return unquote(urlparse(url).path.rsplit("/", 1)[-1])


def _python_tag(runtime_version: str | None) -> str:
    """3.13.18 → cp313（只取主次版本，多一位就会把所有轮子都滤掉）。"""
    parts = str(runtime_version or "3.13").split(".")
    major = parts[0] if parts else "3"
    minor = parts[1] if len(parts) > 1 else "13"
    return f"cp{major}{minor}"


def resolve_wheels(
    spec: InstallSpec,
    specs: list[str],
    log: Callable[[str], None],
) -> list[dict]:
    """并发查索引页，为每个待装依赖挑一个 wheel。

    这里刻意不走 pip 的解析：国内镜像不提供 PEP 658 元数据，pip 为了读依赖
    会把整个 wheel（ComfyUI 的模板包单个 78 MB）先下下来，几十个包串行跑
    能拖到十几分钟。直接读索引页 HTML 只要几 KB。
    """
    index = spec.pip_index or DEFAULT_PIP_INDEX
    python_tag = _python_tag(spec.runtime_version)
    results: list[dict] = []
    unresolved: list[str] = []
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_DOWNLOADS) as pool:
        futures = {
            pool.submit(_load_index, index, _spec_name(spec_str) or spec_str, python_tag, log): spec_str
            for spec_str in specs
        }
        for future, spec_str in futures.items():
            candidates = future.result()
            picked = _pick_wheel(candidates, spec_str, python_tag)
            if picked is None:
                unresolved.append(spec_str)
            else:
                picked["requirement"] = spec_str
                results.append(picked)
    if unresolved:
        log("  索引里没找到可用 wheel: " + ", ".join(unresolved[:5]))
    return results


def _wheel_filename(url: str, index: int) -> str:
    name = unquote(urlparse(url).path.rsplit("/", 1)[-1]) or f"package-{index}.whl"
    # 同一个文件名可能出现两次（不同 channel），加序号避免互相覆盖
    return f"{index:03d}-{name}" if len(name) > 120 else name


def _valid_wheel(path: Path) -> bool:
    """下载中断会留下半截文件；zip 头坏了 pip 会报 BadZipFile，提前剔掉。"""
    try:
        return path.is_file() and path.stat().st_size > 0 and zipfile.is_zipfile(path)
    except OSError:
        return False


def _remote_size(client: "httpx.Client", url: str) -> int:
    """问一下文件多大：分母准了，下载进度才不会一上来就 100%。"""
    try:
        resp = client.head(url, timeout=8.0, follow_redirects=True)
        if resp.status_code < 400:
            size = int(resp.headers.get("content-length") or 0)
            if size > 0:
                return size
    except (httpx.HTTPError, OSError):
        pass
    try:
        # 少数 CDN 不认 HEAD，退化成一个字节的 Range 请求读 Content-Range
        resp = client.get(
            url, headers={"Range": "bytes=0-0"}, timeout=8.0, follow_redirects=True
        )
        try:
            rng = resp.headers.get("content-range") or ""
        finally:
            resp.close()
        if "/" in rng:
            return int(rng.rsplit("/", 1)[-1] or 0)
    except (httpx.HTTPError, OSError, ValueError):
        pass
    return 0


def download_many(
    items: list[dict],
    dest_dir: Path,
    send: Callable[[dict], None],
    log: Callable[[str], None],
    *,
    key: str = "requirements",
    percent_span: tuple[float, float] = (0.0, 90.0),
) -> tuple[list[Path], list[str]]:
    """并发下载多个 wheel，进度按「累计字节 / 计划总量」上报。

    pip 单连接顺序下载时，几十个小包大部分时间耗在等首字节；
    并发 6 路后阻塞被重叠掉，总耗时明显下降。

    `percent_span` 把下载映射到整步进度的某个区间：依赖安装还有「解析」
    和「解包」两段，下载不该独占 0~100。
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    lo, hi = percent_span
    lock = threading.Lock()
    state = {"done": 0, "size": 0, "files": 0}
    errors: list[str] = []
    paths: list[Path] = []
    meter = _SpeedMeter()
    stop = threading.Event()

    def emit() -> None:
        with lock:
            done, size, files = state["done"], state["size"], state["files"]
        if size <= 0:
            percent = -1.0
        else:
            raw = min(100.0, done * 100.0 / size)
            percent = lo + (hi - lo) * raw / 100.0
            if files < total:
                # 还有包没落盘（或失败了），别把这一步显示成已完成
                percent = min(percent, max(lo, hi - 1.0))
        _progress(
            send, key=key, phase=PHASE_DOWNLOAD,
            label=f"依赖包（{files}/{total}）",
            done=done, size=size, speed=meter.update(done), percent=percent,
        )

    def monitor() -> None:
        while not stop.wait(0.4):
            emit()

    def fetch(position: int, item: dict, planned: int) -> None:
        target = dest_dir / _wheel_filename(item["url"], position)
        # 临时名带上序号：同一个 wheel 若被重复排进队列，两个线程也不会抢同一个 .part
        tmp = target.with_suffix(f"{target.suffix}.{position}.part")
        if target.is_file() and not _valid_wheel(target):
            target.unlink(missing_ok=True)
        if _valid_wheel(target):
            with lock:
                state["done"] += planned or target.stat().st_size
                state["files"] += 1
            item["local_path"] = str(target)
            paths.append(target)
            return
        resume = tmp.stat().st_size if tmp.is_file() else 0
        headers = {"Range": f"bytes={resume}-"} if resume else {}
        try:
            with httpx.stream(
                "GET", item["url"], headers=headers,
                timeout=DOWNLOAD_TIMEOUT, follow_redirects=True,
            ) as resp:
                if resp.status_code >= 400:
                    raise httpx.HTTPError(f"HTTP {resp.status_code}")
                if resp.status_code != 206:
                    resume = 0
                length = int(resp.headers.get("content-length") or 0)
                with lock:
                    if not planned:
                        # 预取没拿到大小，这里兜底补上，至少粒度不会更差
                        state["size"] += length
                    state["done"] += resume
                with tmp.open("ab" if resume else "wb") as fh:
                    for chunk in resp.iter_bytes(262144):
                        fh.write(chunk)
                        with lock:
                            state["done"] += len(chunk)
            digest = item.get("sha256")
            if digest and _sha256(tmp).lower() != digest.lower():
                tmp.unlink(missing_ok=True)
                with lock:
                    errors.append(f"{item['name']}: 校验不通过（文件不完整）")
                return
            try:
                tmp.replace(target)
            except OSError:
                # Windows 上目标文件可能正被另一个线程改名（同一个 wheel 重复入队）
                if not (target.is_file() and target.stat().st_size > 0):
                    raise
                tmp.unlink(missing_ok=True)
            with lock:
                state["files"] += 1
            item["local_path"] = str(target)
            paths.append(target)
        except (httpx.HTTPError, OSError) as exc:
            with lock:
                errors.append(f"{item['name']}: {exc}")

    if not items:
        return [], []

    # 去重：同一个 wheel 只下一次，重复项直接指向同一个文件
    # 注意：这里不能用 key 做变量名，会把进度事件要用的步骤 key 覆盖成 wheel 文件名
    unique: list[dict] = []
    by_file: dict[str, dict] = {}
    for position, item in enumerate(items):
        filename = _wheel_filename(item["url"], position)
        if filename in by_file:
            item["local_path"] = by_file[filename].get("local_path", "")
            item["duplicate_of"] = filename
            continue
        by_file[filename] = item
        unique.append(item)
    items = unique
    total = len(items)

    # 先把每个文件的大小问清（缓存直接 stat，其余并发 HEAD）。
    # 之前分母是「已启动任务的累计大小」，第一个线程命中缓存就 done == size，
    # 立刻算出 100%，总进度被 max() 永久钉死在依赖步末端（就是那个 96%）。
    with httpx.Client() as client:
        def plan(position: int, item: dict) -> tuple[int, int]:
            target = dest_dir / _wheel_filename(item["url"], position)
            if _valid_wheel(target):
                try:
                    return position, target.stat().st_size
                except OSError:
                    return position, 0
            return position, _remote_size(client, item["url"])

        planned: dict[int, int] = {}
        if total:
            with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_DOWNLOADS, total)) as pool:
                futures = [pool.submit(plan, position, item) for position, item in enumerate(items)]
                for future in futures:
                    position, size = future.result()
                    planned[position] = size
    state["size"] = sum(planned.values())

    watcher = threading.Thread(target=monitor, name="pip-download-progress", daemon=True)
    watcher.start()
    try:
        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_DOWNLOADS, total)) as pool:
            for position, item in enumerate(items):
                pool.submit(fetch, position, item, planned.get(position, 0))
    finally:
        stop.set()
        watcher.join(timeout=2)
    emit()
    log(f"并发下载 {total - len(errors)}/{total} 个包，共 {state['done'] / 1048576:.1f} MB")
    return paths, errors


def _satisfied(spec_str: str, installed: dict[str, str]) -> bool:
    """共享环境里是否已有满足该声明（含版本约束）的包。"""
    try:
        requirement = Requirement(spec_str)
    except Exception:  # noqa: BLE001
        return False
    current = installed.get(_normalize(requirement.name))
    if current is None:
        return False
    try:
        return requirement.specifier.contains(current, prereleases=True)
    except Exception:  # noqa: BLE001
        return True


def _wheel_deps(wheel: Path, extras: set[str]) -> list[str]:
    """读 wheel 内 dist-info/METADATA 的 Requires-Dist，替代 pip 的依赖解析。

    这样做的好处：不用联网解析、也不用把几十 MB 的包整包下下来读元数据，
    并发的下载线程拿到的就是最终要装的东西。
    """
    try:
        with zipfile.ZipFile(wheel) as zf:
            meta_name = next((n for n in zf.namelist() if n.endswith(".dist-info/METADATA")), None)
            if meta_name is None:
                return []
            text = zf.read(meta_name).decode("utf-8", "replace")
    except (zipfile.BadZipFile, OSError, KeyError):
        return []

    deps: list[str] = []
    for line in text.splitlines():
        if not line.lower().startswith("requires-dist:"):
            continue
        raw = line.split(":", 1)[1].strip()
        try:
            requirement = Requirement(raw)
        except Exception:  # noqa: BLE001
            continue
        marker = requirement.marker
        if marker is not None:
            try:
                if not marker.evaluate({"extra": ""}) and not any(
                    marker.evaluate({"extra": extra}) for extra in extras
                ):
                    continue
            except Exception:  # noqa: BLE001
                pass
        deps.append(f"{requirement.name}{requirement.specifier}")
    return deps


def _dedupe_wheels(paths: list[Path], python_tag: str) -> list[Path]:
    """同一个包可能缓存了多个轮子（含旧版本挑错的 py3-none-any），
    一起交给 pip 会判成「版本冲突」，这里只保留每个包最合适的那个。"""
    best: dict[str, Path] = {}
    for path in paths:
        filename = path.name
        parts = filename[:-4].split("-") if filename.endswith(".whl") else [filename]
        name = _normalize(parts[0]) if parts else filename
        current = best.get(name)
        if current is None:
            best[name] = path
            continue
        try:
            rank_new = _wheel_rank(filename, python_tag)
            rank_old = _wheel_rank(current.name, python_tag)
        except Exception:  # noqa: BLE001
            continue
        if rank_new > rank_old:
            best[name] = path
    return list(best.values())


def _cache_limit_bytes() -> int:
    """依赖缓存上限（字节），0 表示不限制。"""
    try:
        raw = load_settings().get("comfy", {}).get("cache_limit_gb")
        limit = float(DEFAULT_CACHE_LIMIT_GB if raw is None else raw)
    except (OSError, TypeError, ValueError, KeyError, AttributeError):
        limit = DEFAULT_CACHE_LIMIT_GB
    return int(limit * 1024**3) if limit > 0 else 0


def _wheel_identity(filename: str) -> tuple[str, str]:
    """wheel 文件名 → (归一化包名, 版本)，兼容 `000-` 这种序号前缀。"""
    base = filename[:-4] if filename.lower().endswith(".whl") else filename
    parts = base.split("-")
    if len(parts) > 3 and len(parts[0]) == 3 and parts[0].isdigit():
        parts = parts[1:]
    name = _normalize(parts[0]) if parts else base
    version = parts[1] if len(parts) > 1 else ""
    return name, version


def _version_key(value: str) -> tuple:
    """包版本比较键；解析不了的名字按字符串排在正常版本之后。"""
    try:
        return (1, Version(value))
    except Exception:  # noqa: BLE001 - 非标准版本号不该让清理逻辑崩掉
        return (0, value)


def prune_cache(
    wheel_dir: Path,
    *,
    keep: set[str] | None = None,
    log: Callable[[str], None] | None = None,
) -> dict:
    """把依赖缓存压回上限内，返回 {removed, freed, size, limit}。

    两步：① 同一个包只保留版本最高的一份（同版本留最新下载的）；
    ② 仍超出 settings.comfy.cache_limit_gb 时，按最久未用淘汰。
    `keep` 里的文件名（本次安装要用的）永远不删；删除失败只记日志——
    清缓存不能把安装搞失败。
    """
    keep_names = {str(k.name if isinstance(k, Path) else k) for k in (keep or ()) if k}
    limit = _cache_limit_bytes()
    result = {"removed": 0, "freed": 0, "size": 0, "limit": limit}
    if limit <= 0 or not wheel_dir.is_dir():
        return result

    def size_of(path: Path) -> int:
        try:
            return path.stat().st_size
        except OSError:
            return 0

    def mtime_of(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    wheels: list[Path] = []
    parts: list[Path] = []
    try:
        for entry in wheel_dir.iterdir():
            if not entry.is_file():
                continue
            if entry.name.lower().endswith(".whl"):
                wheels.append(entry)
            elif entry.name.endswith(".part"):
                parts.append(entry)
    except OSError:
        return result

    # ① 同包多版本：只留版本最高 / 最新的那份
    best: dict[str, tuple[Path, tuple]] = {}
    for path in wheels:
        name, version = _wheel_identity(path.name)
        key = _version_key(version)
        current = best.get(name)
        if current is None:
            best[name] = (path, key)
            continue
        cur_path, cur_key = current
        if key > cur_key or (key == cur_key and mtime_of(path) > mtime_of(cur_path)):
            best[name] = (path, key)
    winners = {path for path, _ in best.values()}

    def drop(paths: list[Path]) -> None:
        for start in range(0, len(paths), CACHE_DELETE_BATCH):
            for path in paths[start:start + CACHE_DELETE_BATCH]:
                size = size_of(path)
                try:
                    path.unlink()
                except OSError:
                    continue
                result["removed"] += 1
                result["freed"] += size

    # 半截下载（*.part）没有任何价值，先清掉
    drop(parts)
    drop([p for p in wheels if p not in winners and p.name not in keep_names])

    # 删完重算；删不掉的文件（被占用）也算进总量，交给下一步淘汰
    remaining = [p for p in wheels if p.exists()]
    total = sum(size_of(p) for p in remaining)
    if total > limit:
        # ② 按最久未用淘汰，直到回到上限内
        victims: list[Path] = []
        current = total
        for path in sorted(remaining, key=mtime_of):
            if current <= limit:
                break
            if path.name in keep_names:
                continue
            victims.append(path)
            current -= size_of(path)
        drop(victims)

    result["size"] = sum(size_of(p) for p in wheels if p.exists()) + sum(
        size_of(p) for p in parts if p.exists()
    )
    if log and result["removed"]:
        log(
            f"依赖缓存：清理 {result['removed']} 个旧包，释放 {result['freed'] / 1024**2:.0f} MB"
            f"（当前 {result['size'] / 1024**2:.0f} MB，上限 {limit / 1024**3:.1f} GB）"
        )
    return result


def _requirements_marker(
    spec: InstallSpec,
    req_file: Path | None = None,
    name: str = "requirements.done",
) -> tuple[Path, str]:
    req_file = req_file or (spec.environment / "cache" / "requirements.comfy.txt")
    fingerprint = hashlib.sha256(req_file.read_bytes()).hexdigest()[:16] if req_file.is_file() else ""
    return spec.environment / "cache" / name, fingerprint


def _pip_cwd(spec: InstallSpec) -> str:
    """pip 的工作目录：实例里有 ComfyUI 代码就在那跑，共享环境场景退回环境目录。"""
    return str(spec.comfy_dir if spec.comfy_dir.is_dir() else spec.environment)


def build_dependency_closure(
    spec: InstallSpec,
    specs: list[str],
    wheel_dir: Path,
    send: Callable[[dict], None],
    log: Callable[[str], None],
    *,
    key: str,
) -> tuple[list[Path], bool, list[str]]:
    """把依赖闭包补全到 wheelhouse：查索引 → 并发下载 → 读 METADATA 继续排队。

    返回 (待安装的 wheel 列表, 是否完整, 没搞定的依赖)。已装在共享环境里且
    版本满足的包会被跳过，所以典型情况下只下载真正缺的那几十个轮子。
    """
    installed = installed_versions(spec.env_site)
    collected: dict[str, Path] = {}
    queue = list(specs)
    unresolved: list[str] = []
    rounds = 0

    while queue and rounds < MAX_REQUIREMENT_ROUNDS:
        rounds += 1
        batch: list[str] = []
        seen_names: set[str] = set()
        for spec_str in queue:
            name = _spec_name(spec_str)
            if not name or name in collected or name in seen_names:
                continue
            seen_names.add(name)
            if _satisfied(spec_str, installed):
                continue
            batch.append(spec_str)
        if not batch:
            # 这一轮没有要下的：剩下的都已经装在共享环境里
            queue = []
            break

        send({"type": "log", "line": f"第 {rounds} 轮：解析 {len(batch)} 个依赖"})
        _progress(
            send, key=key, phase=PHASE_RESOLVE,
            label=f"解析依赖（{len(batch)} 个）",
            percent=min(9.0, 3.0 * rounds),
        )
        items = resolve_wheels(spec, batch, log)
        for item in items:
            item["local_path"] = ""
        if not items:
            unresolved = batch
            break
        # 下载只占依赖步的中段：前后还有解析和解包，别让它独占 0~100
        span_lo = 10.0 + (rounds - 1) * 15.0
        span_hi = min(88.0, span_lo + 66.0)
        paths, errors = download_many(
            items, wheel_dir, send, log, key=key, percent_span=(span_lo, span_hi)
        )
        if errors:
            log("下载失败: " + "; ".join(errors[:3]))
            unresolved = [
                str(item.get("requirement") or item["name"])
                for item in items
                if not Path(item.get("local_path") or "").is_file()
            ]
            return list(collected.values()), False, unresolved

        next_queue: list[str] = []
        for item in items:
            path = Path(item.get("local_path") or "")
            name = _normalize(item["name"])
            if not path.is_file():
                continue
            collected[name] = path
            extras = set()
            try:
                extras = set(Requirement(item.get("requirement") or item["name"]).extras)
            except Exception:  # noqa: BLE001
                pass
            for dep in _wheel_deps(path, extras):
                dep_name = _spec_name(dep)
                if not dep_name or dep_name in collected:
                    continue
                if _satisfied(dep, installed):
                    continue
                next_queue.append(dep)
        queue = next_queue

    missing = unresolved or queue
    if missing:
        log("依赖没补全: " + ", ".join(missing[:5]))
        return list(collected.values()), False, missing
    return list(collected.values()), True, []


def run_requirements(
    spec: InstallSpec,
    send: Callable[[dict], None],
    log: Callable[[str], None],
    *,
    key: str = "requirements",
    requirements: Path | None = None,
    cache_key: str = "comfy",
) -> tuple[bool, str]:
    """安装依赖：只补缺的包，并发下载，离线安装。

    1. requirements 里剔除 torch（它按硬件单独装，绝不能让 pip 碰）；
    2. 扫共享 site-packages 判断哪些已装，只处理缺的；
    3. 并发查索引 + 并发下载，读 wheel 元数据递归补全传递依赖；
    4. 最后用 --no-deps 离线装这批轮子（pip 的 --target 会 ignore_installed，
       所以不能让它自己解析，否则会把已装好的包整包重装一遍）。

    `requirements` / `cache_key` 给自定义节点用：不同节点各自的依赖清单与
    完成指纹必须分开存，否则后装的节点会误判「依赖已齐全」。
    """
    req_file = write_filtered_requirements(spec, requirements, f"requirements.{cache_key}.txt")
    specs = parse_requirements(req_file)
    if not specs:
        return True, "没有需要安装的依赖"

    marker, fingerprint = _requirements_marker(spec, req_file, f"requirements.{cache_key}.done")
    if marker.is_file() and marker.read_text(encoding="utf-8").strip() == fingerprint:
        installed = installed_versions(spec.env_site)
        if all(_satisfied(s, installed) for s in specs):
            send({"type": "log", "line": "依赖已齐全，无需下载"})
            _progress(send, key=key, phase=PHASE_DONE, label="依赖已齐全", percent=100)
            return True, "依赖已齐全"

    wheel_dir = spec.environment / "cache" / "wheels"
    wheel_dir.mkdir(parents=True, exist_ok=True)

    paths, complete, missing = build_dependency_closure(
        spec, specs, wheel_dir, send, log, key=key
    )
    if not paths:
        if complete:
            # 全部依赖都已在共享环境里，记下指纹，下次直接跳过
            marker.write_text(fingerprint + "\n", encoding="utf-8")
            send({"type": "log", "line": "依赖已齐全，无需下载"})
            _progress(send, key=key, phase=PHASE_DONE, label="依赖已齐全", percent=100)
            return True, "依赖已齐全"
        return _fallback_requirements(spec, req_file, send, log, key, missing)

    paths = _dedupe_wheels(paths, _python_tag(spec.runtime_version))
    _progress(send, key=key, phase=PHASE_INSTALL, label="解压安装依赖", percent=90)
    cmd = [
        str(spec.env_python), "-m", "pip", "install",
        "--target", str(spec.env_site),
        "--no-deps", "--no-index", "--disable-pip-version-check",
        *[str(p) for p in paths],
    ]
    log(f"$ pip install --no-deps （{len(paths)} 个本地轮子）")
    # pip 装本地轮子不输出进度，靠心跳把 90~99 这段填满，别让进度环定住
    stop_pulse = _pulse(
        send, key=key, phase=PHASE_INSTALL,
        label=f"解压安装 {len(paths)} 个包",
        start=90.0, end=99.0, expected=40.0,
    )
    try:
        proc = subprocess.run(
            cmd,
            cwd=_pip_cwd(spec),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=PIP_TIMEOUT,
            env=_requirements_env(spec),
            check=False,
        )
    finally:
        stop_pulse()
    if proc.returncode != 0:
        log("本地安装失败: " + (proc.stderr or proc.stdout or "").strip()[-300:])
        return _fallback_requirements(spec, req_file, send, log, key, missing)

    if not complete:
        # 少数包索引里找不到（镜像没同步），剩下交给普通 pip 补，别让安装停在这里
        log(f"还有 {len(missing)} 个包没下到，交给普通 pip 继续")
        return _fallback_requirements(spec, req_file, send, log, key, missing)

    marker.write_text(fingerprint + "\n", encoding="utf-8")
    # 依赖装完再收拾缓存：本次用到的轮子受保护，旧版本 / 超限部分在这里淘汰
    try:
        prune_cache(wheel_dir, keep={p.name for p in paths}, log=log)
    except Exception as exc:  # noqa: BLE001 - 清缓存失败不能连累安装结果
        log(f"清理依赖缓存失败（不影响安装）: {exc}")
    _progress(send, key=key, phase=PHASE_DONE, label="依赖安装完成", percent=100)
    send({"type": "log", "line": f"依赖安装完成（{len(paths)} 个包）"})
    return True, f"已安装 {len(paths)} 个缺失的包"


def _fallback_requirements(
    spec: InstallSpec,
    req_file: Path,
    send: Callable[[dict], None],
    log: Callable[[str], None],
    key: str,
    missing: list[str] | None = None,
) -> tuple[bool, str]:
    """兜底：普通 pip 安装。

    已知是哪几个包没搞定（missing）时只装这几个，并加 --no-deps：
    pip 的 --target 隐含 --ignore-installed，直接按 requirements 全量重装
    会把已装好的几十个包再下一遍，而且只要镜像缺其中任何一个传递依赖
    （例如 comfyui-workflow-templates-media-assets-02）就整个失败。
    """
    if missing:
        send({"type": "log", "line": f"改用普通模式补装 {len(missing)} 个包"})
        cmd = [
            str(spec.env_python), "-m", "pip", "install",
            "--target", str(spec.env_site),
            "--no-deps",
            *missing,
        ]
    else:
        send({"type": "log", "line": "改用普通模式安装依赖"})
        cmd = [
            str(spec.env_python), "-m", "pip", "install",
            "--target", str(spec.env_site),
            "-r", str(req_file),
        ]
    if spec.pip_index:
        cmd += ["--index-url", spec.pip_index]
    step = Step(
        key=key,
        title="安装 ComfyUI 依赖",
        detail="普通模式",
        command=cmd,
        cwd=_pip_cwd(spec),
        timeout=PIP_TIMEOUT,
    )
    return _exec(step, send, log)


def _run_step(
    step: Step,
    spec: InstallSpec,
    send: Callable[[dict], None],
    log: Callable[[str], None],
) -> tuple[bool, str]:
    if step.key == "prepare":
        targets: list[Path] = []
        if step.scope in {"env", "both"}:
            targets.append(spec.environment)
        if step.scope in {"instance", "both"}:
            targets.append(spec.workspace)
        try:
            for target in targets:
                target.mkdir(parents=True, exist_ok=True)
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
        if path is None:
            log("$ 模型目录由 --base-directory 直接提供，无需 extra_model_paths.yaml")
            send({"type": "log", "line": "共享模型目录由 workspace 直接提供"})
            return True, "已接入共享模型目录"
        log(f"$ 写入 {path}")
        send({"type": "log", "line": f"共享模型目录已接入: {path}"})
        return True, "已接入共享模型目录"

    if step.key == "lock":
        return _write_lock(spec, log)

    if step.key == "requirements":
        return run_requirements(spec, send, log, key=step.key)

    if step.key == "deps-reuse":
        return True, "已复用"

    if step.command is None:
        return True, "跳过"

    return _exec(step, send, log)


def _prepare_runtime(spec: InstallSpec, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    """下载并解压便携版 Python。已就绪时直接跳过。"""
    if spec.python_ready:
        send({"type": "log", "line": "运行环境已就绪"})
        _progress(send, key="runtime", phase=PHASE_UNPACK, label="运行环境就绪", percent=100)
        return True, "已就绪"

    target = runtime_url()
    if target is None:
        return False, f"当前平台（{platform.system()} {platform.machine()}）没有预编译的 Python 运行时"
    url, filename = target

    cache_dir = spec.environment / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / filename

    expected = COMFY_PYTHON_SHA256.get(filename)
    key = "runtime"
    if archive.is_file() and expected and _sha256(archive) == expected:
        send({"type": "log", "line": "复用已缓存的运行时"})
    else:
        ok, message = _download(url, archive, send, log, key=key, label="内置运行时")
        if not ok:
            return False, message
        if expected:
            actual = _sha256(archive)
            if actual != expected:
                archive.unlink(missing_ok=True)
                return False, f"校验失败：期望 {expected[:16]}…，实际 {actual[:16]}…"
            send({"type": "log", "line": "校验通过"})

    # 包里根目录就是 python/，直接解到 environment 下
    _progress(send, key=key, phase=PHASE_UNPACK, label="解压运行时")
    try:
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(spec.environment)
    except (tarfile.TarError, OSError) as exc:
        return False, f"解压失败: {exc}"

    if not spec.python_ready:
        return False, f"解压后未找到解释器: {spec.env_python}"
    _progress(send, key=key, phase=PHASE_UNPACK, label="运行环境就绪", percent=100)
    send({"type": "log", "line": "运行环境已就绪"})
    return True, "已就绪"


def _download(
    url: str,
    dest: Path,
    send: Callable[[dict], None],
    log: Callable[[str], None],
    *,
    key: str = "runtime",
    label: str = "",
) -> tuple[bool, str]:
    """流式下载，每 250ms 汇报一次真实字节数 / 速度 / 剩余时间。

    这些数字走 progress 事件，不写进日志——否则右侧日志会被进度行刷屏。
    """
    tmp = dest.with_suffix(dest.suffix + ".part")
    meter = _SpeedMeter()
    done = 0
    total = 0
    name = label or dest.name
    started = time.monotonic()
    try:
        with httpx.stream("GET", url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as resp:
            if resp.status_code >= 400:
                return False, f"下载失败：HTTP {resp.status_code}"
            total = int(resp.headers.get("content-length") or 0)
            _progress(send, key=key, phase=PHASE_DOWNLOAD, label=name, done=0, size=total)
            last_emit = time.monotonic()
            with tmp.open("wb") as fh:
                for chunk in resp.iter_bytes(262144):
                    fh.write(chunk)
                    done += len(chunk)
                    now = time.monotonic()
                    if now - last_emit >= 0.25 or (total and done >= total):
                        _progress(
                            send, key=key, phase=PHASE_DOWNLOAD, label=name,
                            done=done, size=total, speed=meter.update(done),
                        )
                        last_emit = now
    except (httpx.HTTPError, OSError) as exc:
        tmp.unlink(missing_ok=True)
        return False, f"下载中断: {exc}"

    _progress(send, key=key, phase=PHASE_DOWNLOAD, label=name, done=done, size=total,
              speed=meter.speed, percent=100)
    elapsed = max(0.001, time.monotonic() - started)
    log(f"下载完成 {name}（{done / 1048576:.1f} MB，{done / elapsed / 1048576:.1f} MB/s）")
    send({"type": "log", "line": f"下载完成 {name}（{done / 1048576:.1f} MB）"})
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
        _progress(send, key=step.key, phase=PHASE_CLONE, label="拉取 ComfyUI 代码")
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


def _pip_command(cmd: list[str]) -> list[str]:
    """给 pip install 加 --progress-bar raw：非 tty 下也能拿到逐秒下载字节数。"""
    if len(cmd) > 2 and cmd[1:3] == ["-m", "pip"] and "--progress-bar" not in cmd:
        return [*cmd, "--progress-bar", "raw"]
    return list(cmd)


def _exec(step: Step, send: Callable[[dict], None], log: Callable[[str], None]) -> tuple[bool, str]:
    assert step.command is not None
    command = _pip_command(step.command)
    ok, message, tail = _exec_once(step, command, send, log)
    # 老版本 pip 不认这个参数时，去掉它重试一次，别让进度功能拖垮安装
    if not ok and any("no such option: --progress-bar" in line for line in tail):
        send({"type": "log", "line": "当前 pip 不支持进度输出，已自动关闭"})
        ok, message, _ = _exec_once(step, list(step.command), send, log)
    return ok, message


def _exec_once(
    step: Step,
    command: list[str],
    send: Callable[[dict], None],
    log: Callable[[str], None],
) -> tuple[bool, str, list[str]]:
    """跑一条命令，边跑边把 pip 输出翻译成进度事件 + 可读日志。"""
    log(f"$ {' '.join(command)}")
    env = clean_env()
    env.update(step.env_extra)
    try:
        proc = subprocess.Popen(
            command,
            cwd=str(step.cwd) if step.cwd else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
    except OSError as exc:
        return False, f"无法执行命令: {exc}", []

    assert proc.stdout is not None
    deadline = time.time() + step.timeout
    tail: list[str] = []
    meter = _SpeedMeter()
    label = ""
    size = 0

    for raw in _iter_lines(proc):
        # rich 进度条用 \r 覆盖同一行，拆开后取每段单独判断
        for line in raw.replace("\r", "\n").split("\n"):
            line = line.rstrip()
            if not line:
                continue
            stripped = line.strip()

            match = _PIP_PROGRESS_RE.match(stripped)
            if match:
                bytes_done = int(match.group(1))
                bytes_total = int(match.group(2))
                if bytes_done < meter.done:  # 切到下一个文件了，速度重新计
                    meter.reset()
                _progress(
                    send, key=step.key, phase=PHASE_DOWNLOAD,
                    label=label or "下载依赖", done=bytes_done,
                    size=bytes_total, speed=meter.update(bytes_done),
                )
                continue  # 进度行不进日志，否则右侧会被刷屏

            match = _PIP_DOWNLOAD_RE.match(line)
            if match:
                label = match.group(1)
                size = _to_bytes(match.group(2) or "")
                meter.reset()
                _progress(send, key=step.key, phase=PHASE_DOWNLOAD, label=label, done=0, size=size)
            elif stripped.startswith("Collecting "):
                name = stripped[len("Collecting "):].split()[0]
                _progress(send, key=step.key, phase=PHASE_RESOLVE, label=f"解析 {name}")
            elif stripped.startswith(("Installing collected packages", "Building wheel", "Preparing metadata")):
                _progress(send, key=step.key, phase=PHASE_INSTALL, label="写入依赖")
            elif stripped.startswith("Successfully installed"):
                _progress(send, key=step.key, phase=PHASE_INSTALL, label="依赖安装完成", percent=100)

            log(line)
            tail.append(line)
            if len(tail) > 60:
                tail.pop(0)
            send({"type": "log", "line": line})

        if time.time() > deadline:
            proc.kill()
            return False, f"步骤超时（>{step.timeout}s）", tail

    code = proc.wait()
    if code == 0:
        return True, "完成", tail
    return False, f"命令失败（exit {code}）：{tail[-1] if tail else '无输出'}", tail


def _iter_lines(proc: subprocess.Popen) -> Iterator[str]:
    assert proc.stdout is not None
    for line in proc.stdout:
        yield line
