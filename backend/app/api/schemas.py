"""对外响应契约：只覆盖前端真正依赖的稳定字段。

原则：
- 字段少的接口用严格模型，多加字段会被 FastAPI 过滤掉，避免悄悄漂移
- 历史字段多、扩展性强的对象用 `extra="allow"`，但必填字段仍然锁住
- 请求体模型留在 routes.py；这里只放响应
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str
    web: bool


class FolderOption(BaseModel):
    id: str
    label: str


class GpuInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    vendor: str = ""
    vramMb: int | float = 0
    vramGb: int | float = 0
    vramText: str = "未检测到"


class TaskFile(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    task_id: str
    path: str
    size: int = 0
    done_bytes: int | None = 0
    status: str = ""
    gid: str | None = None
    url: str = ""
    candidates: list[dict] = Field(default_factory=list)
    error: str | None = None
    folder: str = ""
    target_dir: str = ""


class TaskItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    source: str
    repo_id: str
    revision: str = ""
    strategy: str = ""
    save_dir: str = ""
    target_dir: str = ""
    status: str
    error: str | None = None
    total_bytes: int = 0
    done_bytes: int = 0
    created_at: str
    updated_at: str
    path: str = ""
    kind: str = ""
    files: list[TaskFile] = Field(default_factory=list)


class WorkflowGroupCount(BaseModel):
    name: str
    count: int = 0


class WorkflowLocalItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    key: str = ""
    title: str = ""
    group: str = ""
    path: str
    folder: str = ""
    size: int = 0
    mtime: int | float = 0
    nodes: int = 0
    format: str = ""
    main_model: str = ""
    model_slots: list[dict] = Field(default_factory=list)
    deps: dict = Field(default_factory=dict)
    node_deps: dict = Field(default_factory=dict)
    cover: str = ""


class WorkflowLocalList(BaseModel):
    dir: str
    total: int = 0
    items: list[WorkflowLocalItem] = Field(default_factory=list)
    groups: list[WorkflowGroupCount] = Field(default_factory=list)


class NodeInstalledItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    dir: str
    path: str
    disabled: bool = False
    repo: str = ""
    id: str = ""
    title: str = ""
    description: str = ""
    node_count: int = 0
    nodes: list[str] = Field(default_factory=list)
    tracked: bool = False
    requirements: bool = False
    commit: str = ""
    size: int = 0


class NodeInstalledList(BaseModel):
    items: list[NodeInstalledItem] = Field(default_factory=list)


class SearchItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    author: str = ""
    source: str
    description: str = ""
    downloads: int = 0
    likes: int = 0
    tags: list[str] = Field(default_factory=list)
    task: str = ""
    url: str = ""
    updated_at: str = ""


class SearchResponse(BaseModel):
    items: list[SearchItem] = Field(default_factory=list)
    total: int = 0
    errors: dict[str, str] = Field(default_factory=dict)
    gated: list[str] = Field(default_factory=list)


class LibraryFile(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    path: str
    size: int = 0


class VramInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    level: str = ""
    text: str = ""
    hint: str = ""


class LibraryItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    repo_id: str = ""
    source: str = ""
    local_path: str = ""
    size_bytes: int = 0
    file_count: int = 0
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""
    revision: str = ""
    source_url: str = ""
    files: list[LibraryFile] = Field(default_factory=list)
    folder: str = ""
    folderLabel: str = ""
    task: str = ""
    taskLabel: str = ""
    isDemo: bool = False
    hasWeights: bool = False
    vram: VramInfo | None = None


class ProbePath(BaseModel):
    model_config = ConfigDict(extra="allow")

    path: str = ""
    state: str = ""
    latency_ms: int | float | None = None
    speed_mbps: int | float | None = None
    reason: str = ""
    reason_text: str = ""
    detail: str = ""
    skip: str = ""
    restricted: bool = False


class ProbePaths(BaseModel):
    direct: ProbePath = Field(default_factory=ProbePath)
    mirror: ProbePath = Field(default_factory=ProbePath)
    proxy: ProbePath = Field(default_factory=ProbePath)


class ProbeSource(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    label: str = ""
    verdict: str = ""
    paths: ProbePaths = Field(default_factory=ProbePaths)
    path: str = ""
    path_text: str = ""
    fallback: bool = False
    gated: bool = False
    checked_at: int | float = 0
    age_seconds: int | float | None = None


class ProbeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    sources: list[ProbeSource] = Field(default_factory=list)
    strategy: str = ""
    summary: dict = Field(default_factory=dict)
    cooldown: dict = Field(default_factory=dict)


class DeviceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    os: str = ""
    os_version: str = ""
    os_build: str = ""
    arch: str = ""
    is_wsl: bool = False
    memory_gb: int | float = 0
    unified_memory: bool = False
    gpus: list[dict] = Field(default_factory=list)
    primary_gpu: dict | None = None
    gpu: GpuInfo | None = None
    save_dir: str = ""
    save_disk: dict = Field(default_factory=dict)
