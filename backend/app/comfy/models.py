"""ComfyUI 环境探测（M1 probe）的数据结构。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class GpuInfo(BaseModel):
    """单块显卡 / 显示适配器。"""

    vendor: str = Field(description="nvidia | amd | intel | apple | ascend | unknown")
    name: str
    driver_version: str = ""
    vram_mb: int | None = Field(default=None, description="显存 MB；macOS 为统一内存总量")
    compute_cap: str | None = Field(default=None, description="CUDA 算力，仅 NVIDIA")
    source: str = Field(default="", description="nvidia-smi | cim | registry | sysfs | system_profiler | davinci")
    is_discrete: bool = Field(default=False, description="独显 True，核显 False")
    memory_shared: bool = Field(
        default=False,
        description="与 CPU 共用系统内存（核显 / APU / 统一内存机器），没有独立显存",
    )


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
    """本项目在 COMFY_DIR 下创建的实例（comfy/<name>/，内含 ComfyUI/ 代码）。

    只反映我们自己装的那份。用户机器上已有的 ComfyUI（官方便携版、Desktop、
    整合包）不在探测范围内——我们不管理别人的环境，只保证自己这份可控。
    """

    name: str = Field(description="实例目录名，同时作为实例标识")
    path: str
    version: str | None = Field(default=None, description="ComfyUI 版本 / tag")
    python: str | None = Field(default=None, description="创建时共享基础环境的 Python 版本")
    port: int | None = None
    created_at: str | None = None
    registered: bool = Field(
        default=True,
        description="是否有 instance.json；False 表示安装残留目录，可安全清理",
    )


class RuntimeStatus(BaseModel):
    """共享基础环境（comfy/.environment）的安装状态与已装版本。

    这套环境跟硬件走、所有实例共用：Python 是我们固定版本的便携版
    （经 CNB Release 加速下载），torch 按显卡通道装一次。
    探测只读文件，不启动解释器、不 import torch。
    """

    ready: bool = Field(default=False, description="Python 与 torch 都已就位")
    python_ready: bool = False
    python_version: str = Field(default="", description="内置固定版本；未安装时也给出计划值")
    python_source: str = Field(default="cnb", description="内置解释器的来源：CNB Release")
    python_cached: bool = Field(default=False, description="运行时压缩包是否已缓存")
    torch_ready: bool = False
    torch_version: str | None = None
    torchvision_version: str | None = None
    torchaudio_version: str | None = None
    cuda_runtime: str | None = None
    torch_channel: str | None = Field(default=None, description="cu130 / rocm7.2 / xpu 等")
    lock_ready: bool = Field(default=False, description="requirements.lock 是否已生成")
    path: str = ""


class DeviceReport(BaseModel):
    os: str = Field(description="windows | linux | macos")
    os_version: str = ""
    os_build: str = ""
    arch: str = ""
    is_wsl: bool = False
    memory_gb: float | None = Field(default=None, description="系统内存总量 GB；统一内存机器据此判断能加载多大模型")
    unified_memory: bool = Field(
        default=False,
        description="显卡与 CPU 共享同一份内存（Apple Silicon / AMD APU / GB10 等）",
    )
    gpus: list[GpuInfo] = Field(default_factory=list)
    primary_gpu: GpuInfo | None = None
    pythons: list[PythonInfo] = Field(default_factory=list)
    disks: list[DiskInfo] = Field(default_factory=list)
    instances: list[ManagedInstance] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    raw: dict[str, str] = Field(default_factory=dict)
    probed_at: str = ""


class MirrorProbe(BaseModel):
    """一次软件源测速结果。

    安装前并发测各镜像的下载速度，选最快的那个——国内不同地区、不同运营商
    的最优镜像不一样，写死一个源在部分网络下会很慢。
    """

    kind: str = Field(description="pip | torch")
    label: str = Field(description="展示名，如 上交 / 清华")
    url: str
    channel: str = Field(default="", description="torch 源对应的 CUDA 通道")
    ok: bool = False
    speed_kbps: float = Field(default=0.0, description="实测下载速度 KB/s")
