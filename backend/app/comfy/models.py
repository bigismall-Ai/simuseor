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
    trusted: bool = Field(
        default=True,
        description="是否为可长期依赖的解释器。工具链自带的（如 WorkBuddy 的 vendor python）"
        "标记为 False——那些路径会随应用升级或卸载消失，不能用来建持久环境。",
    )


class DiskInfo(BaseModel):
    path: str
    total_gb: float
    free_gb: float


class ManagedInstance(BaseModel):
    """本项目在 COMFY_DIR/instances 下创建的实例。

    只反映我们自己装的那份。用户机器上已有的 ComfyUI（官方便携版、Desktop、
    整合包）不在探测范围内——我们不管理别人的环境，只保证自己这份可控。
    """

    name: str = Field(description="实例目录名，同时作为实例标识")
    path: str
    version: str | None = Field(default=None, description="ComfyUI 版本 / tag")
    python: str | None = Field(default=None, description="该实例 venv 的 Python 版本")
    port: int | None = None
    created_at: str | None = None


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
    instances: list[ManagedInstance] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw: dict[str, str] = Field(default_factory=dict)
    probed_at: str = ""
