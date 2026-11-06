"""平台 GPU 探测的公共协议与只读子进程执行器。

约定：
- 所有子进程显式用 utf-8 解码（中文 Windows 默认 GBK，不解码会中文乱码）；
- 子进程失败 / 超时只记录到 warnings，不向上抛异常；
- 这里只做只读查询，不写文件、不改环境变量。
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from ..models import GpuInfo

TIMEOUT_SECONDS = 10.0
RAW_LIMIT = 8000

NVIDIA_FIELDS = "name,driver_version,memory.total,compute_cap"
# compute_cap 是 R510+ 才有的字段，老驱动整条查询会失败，需要降级重试
NVIDIA_FIELDS_LEGACY = "name,driver_version,memory.total"


@dataclass
class CommandOutput:
    code: int
    out: str
    err: str

    @property
    def ok(self) -> bool:
        return self.code == 0


@dataclass
class ProbeContext:
    """探测旁路信息：raw 存原始输出用于排障，warnings 存单项失败原因。"""

    raw: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def exec(
        self,
        args: Sequence[str],
        label: str,
        *,
        record_warning: bool = True,
        timeout: float = TIMEOUT_SECONDS,
    ) -> CommandOutput | None:
        """执行只读命令。命令缺失 / 超时返回 None。"""
        try:
            proc = subprocess.run(
                list(args),
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
        except subprocess.TimeoutExpired:
            self.raw[label] = f"超时（>{timeout:.0f}s）"
            if record_warning:
                self.warnings.append(f"{label} 超时（>{timeout:.0f}s）")
            return None
        except OSError as exc:
            self.raw[label] = f"无法执行: {exc}"
            if record_warning:
                self.warnings.append(f"{label} 无法执行: {exc}")
            return None

        result = CommandOutput(proc.returncode, proc.stdout or "", proc.stderr or "")
        text = result.out.strip() or result.err.strip() or f"exit={result.code}"
        self.raw[label] = text[:RAW_LIMIT]
        return result


class GpuProbe(Protocol):
    """平台实现只需返回 GPU 列表；旁路信息通过 ctx 写入。"""

    name: str

    def probe(self, ctx: ProbeContext) -> list[GpuInfo]: ...


def normalize_name(name: str) -> str:
    """归一化型号名，用于跨数据源去重 / 匹配注册表项。"""
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def to_int(value: str | None) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def is_discrete_gpu(vendor: str, name: str) -> bool:
    """按厂商 + 型号关键词判断独显。"""
    low = name.lower()
    if vendor == "nvidia":
        return True
    if vendor == "amd":
        # APU 通常只叫 "AMD Radeon(TM) Graphics"，不含具体型号
        return any(key in low for key in ("radeon rx", "radeon pro", "radeon vii", "instinct", "firepro"))
    if vendor == "intel":
        # "Intel(R) Arc(TM) Graphics" 是核显；带型号数字的 Arc 才是独显
        return "arc" in low and any(ch.isdigit() for ch in low)
    # Apple Silicon 是统一内存，不算独显
    return False


def query_nvidia_smi(ctx: ProbeContext) -> list[GpuInfo]:
    """nvidia-smi 查询；compute_cap 不被支持时降级重试一次。"""
    full = _run_smi(ctx, NVIDIA_FIELDS, "nvidia-smi")
    if full:
        return _rows_to_gpus(full, with_compute_cap=True)

    legacy = _run_smi(ctx, NVIDIA_FIELDS_LEGACY, "nvidia-smi (legacy)")
    if legacy:
        ctx.warnings.append(
            "nvidia-smi 不支持 compute_cap 字段（驱动早于 R510），已降级为 name,driver_version,memory.total"
        )
        return _rows_to_gpus(legacy, with_compute_cap=False)

    ctx.warnings.append("nvidia-smi 探测失败：未发现 NVIDIA 显卡或驱动不可用（原始输出见 raw）")
    return []


def _run_smi(ctx: ProbeContext, fields: str, label: str) -> list[str] | None:
    result = ctx.exec(
        ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
        label,
        record_warning=False,
    )
    if result is None or not result.ok:
        return None
    return [line for line in result.out.splitlines() if line.strip()]


def _rows_to_gpus(rows: list[str], *, with_compute_cap: bool) -> list[GpuInfo]:
    gpus: list[GpuInfo] = []
    for line in rows:
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 3:
            continue
        compute_cap = parts[3] if with_compute_cap and len(parts) > 3 and parts[3] else None
        gpus.append(
            GpuInfo(
                vendor="nvidia",
                name=parts[0],
                driver_version=parts[1],
                vram_mb=to_int(parts[2]),
                compute_cap=compute_cap,
                source="nvidia-smi",
                is_discrete=True,
            )
        )
    return gpus
