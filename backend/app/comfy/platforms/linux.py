"""Linux GPU 采集：nvidia-smi + sysfs(drm) + lspci 型号名。

nvidia-smi 不可用时退回 /proc/driver/nvidia/version 读驱动版本，
显存优先取 sysfs 的 mem_info_vram_total。
"""
from __future__ import annotations

import re
from pathlib import Path

from ..models import GpuInfo
from .base import ProbeContext, is_discrete_gpu, query_nvidia_smi

DRM_ROOT = Path("/sys/class/drm")
PROC_NVIDIA_VERSION = Path("/proc/driver/nvidia/version")
VENDOR_MAP = {0x1002: "amd", 0x8086: "intel", 0x10DE: "nvidia"}
LSPCI_LINE = re.compile(r"^(?P<slot>[0-9a-fA-F:.]+)\s+[^:]+:\s*(?P<name>.+)$")
PCI_ID_SUFFIX = re.compile(r"\s*\[[0-9a-fA-F]{4}:[0-9a-fA-F]{4}\]")
REV_SUFFIX = re.compile(r"\s*\(rev [0-9a-fA-F]+\)\s*$")
MODULE_VERSION = re.compile(r"Kernel Module\s+([0-9][0-9.]*)")


class LinuxGpuProbe:
    name = "linux"

    def probe(self, ctx: ProbeContext) -> list[GpuInfo]:
        names = self._lspci(ctx)
        gpus = query_nvidia_smi(ctx)
        if not gpus:
            gpus.extend(self._proc_nvidia(ctx, names))
        gpus.extend(self._drm(ctx, names))
        return gpus

    def _proc_nvidia(self, ctx: ProbeContext, names: dict[str, str]) -> list[GpuInfo]:
        try:
            text = PROC_NVIDIA_VERSION.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        ctx.raw["/proc/driver/nvidia/version"] = text.strip()
        match = MODULE_VERSION.search(text)
        driver = match.group(1) if match else ""

        # 从 DRM 里找第一块 NVIDIA 卡的显存，型号名沿用 lspci
        name = "NVIDIA GPU"
        vram_mb: int | None = None
        for card in sorted(DRM_ROOT.glob("card[0-9]*")):
            device = card / "device"
            if _read_hex(device / "vendor") != 0x10DE:
                continue
            slot = _pci_slot(device)
            name = names.get(slot or "") or names.get(_slot_without_domain(slot or "")) or name
            vram_mb = _vram_mb(device)
            break

        ctx.warnings.append(
            "nvidia-smi 不可用，NVIDIA 信息取自 /proc/driver/nvidia/version（可能缺少算力等字段）"
        )
        return [
            GpuInfo(
                vendor="nvidia",
                name=name,
                driver_version=driver,
                vram_mb=vram_mb,
                compute_cap=None,
                source="sysfs",
                is_discrete=True,
            )
        ]

    def _drm(self, ctx: ProbeContext, names: dict[str, str]) -> list[GpuInfo]:
        gpus: list[GpuInfo] = []
        for card in sorted(DRM_ROOT.glob("card[0-9]*")):
            device = card / "device"
            if not (device / "vendor").is_file():
                continue
            vendor_id = _read_hex(device / "vendor")
            vendor = VENDOR_MAP.get(vendor_id)
            if vendor in (None, "nvidia"):
                # NVIDIA 已在 nvidia-smi / /proc 分支处理，避免重复
                continue

            slot = _pci_slot(device)
            name = (
                names.get(slot or "")
                or names.get(_slot_without_domain(slot or ""))
                or f"{vendor.upper()} device {_read_hex(device / 'device') or 0:04x}"
            )
            gpus.append(
                GpuInfo(
                    vendor=vendor,
                    name=name,
                    driver_version="",
                    vram_mb=_vram_mb(device) if vendor == "amd" else None,
                    compute_cap=None,
                    source="sysfs",
                    is_discrete=is_discrete_gpu(vendor, name),
                )
            )
        return gpus

    def _lspci(self, ctx: ProbeContext) -> dict[str, str]:
        result = ctx.exec(["lspci", "-nn"], "lspci", record_warning=False)
        if result is None or not result.out:
            return {}
        names: dict[str, str] = {}
        for line in result.out.splitlines():
            stripped = line.strip()
            match = LSPCI_LINE.match(stripped)
            if not match:
                continue
            low = stripped.lower()
            if "vga" not in low and "3d controller" not in low and "display controller" not in low:
                continue
            model = REV_SUFFIX.sub("", PCI_ID_SUFFIX.sub("", match.group("name"), count=1)).strip()
            slot = match.group("slot")
            # lspci 的 BDF 可能不带 4 位域号，两种写法都存一份
            names[slot] = model
            names[_slot_without_domain(slot)] = model
        return names


def _slot_without_domain(slot: str) -> str:
    """把 "0000:01:00.0" 归一成 "01:00.0"，与 lspci 的写法对齐。"""
    parts = slot.split(":")
    return ":".join(parts[-2:]) if len(parts) >= 3 else slot


def _read_hex(path: Path) -> int | None:
    try:
        return int(path.read_text(encoding="utf-8").strip(), 16)
    except (OSError, ValueError):
        return None


def _pci_slot(device: Path) -> str | None:
    """从 uevent 里取 PCI_SLOT_NAME，与 lspci 的 BDF 对应。"""
    try:
        text = (device / "uevent").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("PCI_SLOT_NAME="):
            return line.split("=", 1)[1].strip()
    return None


def _vram_mb(device: Path) -> int | None:
    try:
        total = int((device / "mem_info_vram_total").read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    return total // (1024 * 1024) if total > 0 else None
