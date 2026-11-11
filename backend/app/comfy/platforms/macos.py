"""macOS GPU 采集：system_profiler JSON。

Apple Silicon 是统一内存，没有独立显存：vram_mb 填系统内存总量并在 warnings 里注明。
"""
from __future__ import annotations

import json
import re

from ..models import GpuInfo
from .base import ProbeContext, is_discrete_gpu

VRAM_VALUE = re.compile(r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>GB|MB)", re.IGNORECASE)


class MacOSGpuProbe:
    name = "macos"

    def probe(self, ctx: ProbeContext) -> list[GpuInfo]:
        ctx.exec(["sysctl", "-n", "machdep.cpu.brand_string"], "chip", record_warning=False)
        result = ctx.exec(
            ["system_profiler", "SPDisplaysDataType", "-json"], "system_profiler", record_warning=False
        )
        if result is None or not result.ok:
            ctx.warnings.append("system_profiler 查询显卡失败，无法采集 GPU 信息")
            return []

        try:
            data = json.loads(result.out.lstrip("\ufeff"))
        except json.JSONDecodeError as exc:
            ctx.warnings.append(f"system_profiler 输出不是合法 JSON: {exc}")
            return []

        total_mem = _hw_memsize(ctx)
        items = data.get("SPDisplaysDataType") or []
        gpus: list[GpuInfo] = []
        shared_warned = False
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("sppci_model") or item.get("_name") or "").strip()
            if not name:
                continue
            vendor = _vendor(name)
            vram_mb = _parse_vram(item.get("spdisplays_vram"))
            if vendor == "apple" and total_mem:
                vram_mb = total_mem // (1024 * 1024)
                if not shared_warned:
                    ctx.warnings.append("macOS 为统一内存架构：显存字段填的是系统内存总量，不是独立显存")
                    shared_warned = True
            gpus.append(
                GpuInfo(
                    vendor=vendor,
                    name=name,
                    driver_version="",
                    vram_mb=vram_mb,
                    compute_cap=None,
                    source="system_profiler",
                    is_discrete=is_discrete_gpu(vendor, name),
                    memory_shared=vendor == "apple",
                )
            )
        return gpus


def _hw_memsize(ctx: ProbeContext) -> int | None:
    result = ctx.exec(["sysctl", "-n", "hw.memsize"], "hw.memsize", record_warning=False)
    if result is None or not result.ok:
        return None
    try:
        return int(result.out.strip())
    except ValueError:
        return None


def _vendor(name: str) -> str:
    low = name.lower()
    if "apple" in low:
        return "apple"
    if "amd" in low or "radeon" in low:
        return "amd"
    if "intel" in low:
        return "intel"
    if "nvidia" in low:
        return "nvidia"
    return "unknown"


def _parse_vram(value: object) -> int | None:
    """把 "8 GB" / "1536 MB" 归一成 MB。"""
    if not isinstance(value, str):
        return None
    match = VRAM_VALUE.search(value)
    if not match:
        return None
    number = float(match.group("num"))
    if match.group("unit").upper() == "GB":
        number *= 1024
    return int(number)
