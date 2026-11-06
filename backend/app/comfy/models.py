"""ComfyUI 环境探测（M1 probe）的数据结构。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class GpuInfo(BaseModel):
    """单块显卡 / 显示适配器。"""

    vendor: str = Field(description="nvidia | amd | intel | apple | unknown")
    name: str
    driver_version: str = ""
    vram_mb: int | None = Field(default=None, description="显存 MB；macOS 为统一内存总量")
    compute_cap: str | None = Field(default=None, description="CUDA 算力，仅 NVIDIA")
    source: str = Field(default="", description="nvidia-smi | cim | registry | sysfs | system_profiler")
    is_discrete: bool = Field(default=False, description="独显 True，核显 False")


class PythonInfo(BaseModel):
    version: str = ""
    path: str
    source: str = Field(default="path", description="launcher | path | conda | pyenv | homebrew | system")


class DiskInfo(BaseModel):
    path: str
    total_gb: float
    free_gb: float


class ExistingInstall(BaseModel):
    path: str
    kind: str = Field(description="our-instance | comfyui-repo | desktop | bundle")
    version: str | None = None
    note: str = ""


class DeviceReport(BaseModel):
    os: str = Field(description="windows | linux | macos")
    os_version: str = ""
    os_build: str = ""
    arch: str = ""
    is_wsl: bool = False
    gpus: list[GpuInfo] = Field(default_factory=list)
    primary_gpu: GpuInfo | None = None
    pythons: list[PythonInfo] = Field(default_factory=list)
    disks: list[DiskInfo] = Field(default_factory=list)
    installs: list[ExistingInstall] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw: dict[str, str] = Field(default_factory=dict)
    probed_at: str = ""
