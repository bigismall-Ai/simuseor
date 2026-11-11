"""Windows GPU 采集：nvidia-smi 拿 NVIDIA 详情，CIM 兜底其它厂商，注册表补显存。

注意：
- CIM 的 AdapterRAM 是 32 位，>4GB 会截断，不能用来算显存；
- 显存改读注册表 HardwareInformation.qwMemorySize（QWORD），用标准库 winreg，不为此起 PowerShell。
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from ..models import GpuInfo
from .base import (
    ProbeContext,
    is_discrete_gpu,
    normalize_name,
    query_nvidia_smi,
    shares_system_memory,
    to_int,
)

# 中文 Windows 的 PowerShell 5.1 重定向输出默认是 GBK，先强制 UTF-8 再输出 JSON
CIM_SCRIPT = (
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
    "Get-CimInstance Win32_VideoController | "
    "Select-Object Name,DriverVersion,AdapterCompatibility,PNPDeviceID | ConvertTo-Json"
)

REG_CLASS = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
REG_VRAM_VALUE = "HardwareInformation.qwMemorySize"


class WindowsGpuProbe:
    name = "windows"

    def probe(self, ctx: ProbeContext) -> list[GpuInfo]:
        gpus = query_nvidia_smi(ctx)
        gpus.extend(self._cim(ctx, gpus))
        return gpus

    # ---------------- CIM ----------------
    def _cim(self, ctx: ProbeContext, known: list[GpuInfo]) -> list[GpuInfo]:
        result = ctx.exec(
            [_powershell(), "-NoProfile", "-NonInteractive", "-Command", CIM_SCRIPT],
            "cim",
            record_warning=False,
        )
        if result is None:
            ctx.warnings.append("PowerShell 无法执行，跳过 CIM 显卡采集")
            return []
        if not result.ok:
            ctx.warnings.append(f"PowerShell 查询显卡失败（exit={result.code}），详见 raw.cim")
            return []

        try:
            data = json.loads(result.out.lstrip("\ufeff").strip() or "[]")
        except json.JSONDecodeError as exc:
            ctx.warnings.append(f"CIM 显卡输出不是合法 JSON: {exc}")
            return []
        if isinstance(data, dict):
            data = [data]

        vram_map = _registry_vram(ctx)
        known_nvidia = {normalize_name(g.name) for g in known if g.vendor == "nvidia"}
        wddm_warned = False
        gpus: list[GpuInfo] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            name = str(item.get("Name") or "").strip()
            if not name:
                continue
            vendor = _vendor(name, str(item.get("AdapterCompatibility") or ""))
            if vendor == "nvidia" and normalize_name(name) in known_nvidia:
                # 已被 nvidia-smi 覆盖，避免重复且避免用 WDDM 版本号冒充驱动版本
                continue

            bytes_total = vram_map.get(normalize_name(name))
            vram_mb = int(bytes_total // (1024 * 1024)) if bytes_total else None
            discrete = is_discrete_gpu(vendor, name)
            shared = shares_system_memory(vendor, name, discrete)

            if vendor == "nvidia" and not wddm_warned:
                ctx.warnings.append("NVIDIA 驱动版本取自 CIM（WDDM 版本），可能不是 nvidia-smi 报告的真实驱动版本")
                wddm_warned = True
            if discrete and vram_mb is None:
                ctx.warnings.append(f"未能读取 {name} 的显存大小（注册表无 qwMemorySize）")

            gpus.append(
                GpuInfo(
                    vendor=vendor,
                    name=name,
                    driver_version=str(item.get("DriverVersion") or ""),
                    # 核显注册表里的 qwMemorySize 是共享内存配额，不是独立显存
                    vram_mb=None if shared else vram_mb,
                    compute_cap=None,
                    source="cim",
                    is_discrete=discrete,
                    memory_shared=shared,
                )
            )
        return gpus


def _powershell() -> str:
    """部分精简 PATH 不含 WindowsPowerShell 目录，优先用绝对路径。"""
    candidate = (
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32"
        / "WindowsPowerShell"
        / "v1.0"
        / "powershell.exe"
    )
    return str(candidate) if candidate.is_file() else "powershell"


def _vendor(name: str, compatibility: str) -> str:
    text = f"{name} {compatibility}".lower()
    if "nvidia" in text:
        return "nvidia"
    if "amd" in text or "advanced micro devices" in text or "radeon" in text:
        return "amd"
    if "intel" in text:
        return "intel"
    if "ascend" in text or "huawei" in text:
        return "ascend"
    if "apple" in text:
        return "apple"
    return "unknown"


def _registry_vram(ctx: ProbeContext) -> dict[str, int]:
    """读取各显示适配器注册表项的 qwMemorySize（字节），按 DriverDesc 建索引。"""
    if os.name != "nt":
        return {}
    try:
        import winreg  # noqa: PLC0415 - 仅 Windows 需要
    except ImportError:
        return {}

    sizes: dict[str, int] = {}
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, REG_CLASS) as root:
            index = 0
            while True:
                try:
                    sub = winreg.EnumKey(root, index)
                except OSError:
                    break
                index += 1
                if not re.fullmatch(r"\d{4}", sub):
                    continue
                try:
                    with winreg.OpenKey(root, sub) as key:
                        desc = str(winreg.QueryValueEx(key, "DriverDesc")[0])
                        raw = winreg.QueryValueEx(key, REG_VRAM_VALUE)[0]
                except OSError:
                    continue
                size = _as_uint64(raw)
                if size:
                    sizes[normalize_name(desc)] = size
    except OSError as exc:
        ctx.warnings.append(f"读取注册表显存失败: {exc}")
        return {}

    if sizes:
        ctx.raw["registry.qwMemorySize"] = json.dumps(sizes, ensure_ascii=False)
    return sizes


def _as_uint64(value: object) -> int | None:
    """qwMemorySize 通常是 REG_QWORD，个别驱动写成 REG_BINARY（小端）。"""
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, (bytes, bytearray)) and len(value) <= 8:
        number = int.from_bytes(bytes(value), "little")
        return number or None
    size = to_int(value if isinstance(value, str) else None)
    return size if size and size > 0 else None
