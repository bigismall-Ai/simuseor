# 后端 API 契约

面向 `view/` 与后续客户端，锁住**响应字段**和**错误语义**。请求体模型仍在
`backend/app/api/routes.py`，这里只约定响应。

## 生成与校验

```bash
# 生成快照
.venv/Scripts/python backend/scripts/dump_openapi.py

# CI 校验（不一致即失败）
.venv/Scripts/python backend/scripts/dump_openapi.py --check
.venv/Scripts/python -m pytest backend/tests/test_api_contract.py -q
```

改动响应字段后：重新生成 `backend/openapi.json`，同步更新
`backend/tests/test_api_contract.py` 里的形状断言，再生成前端类型：

```bash
cd tests && npm run api:types
cd tests && npm run api:types:check
```

前端只从 `view/src/app/core/api-contract.ts` 取别名，不手写同名字段。

## 已锁定的响应模型

| 端点 | 模型 | 说明 |
|---|---|---|
| `GET /api/health` | `HealthResponse` | 服务与前端产物状态 |
| `GET /api/folders` | `list[FolderOption]` | ComfyUI 模型目录 |
| `GET /api/library/gpu` | `GpuInfo` | 独显显存快照 |
| `GET /api/tasks` | `list[TaskItem]` | 下载任务列表 |
| `GET /api/tasks/{id}` | `TaskItem` | 任务详情，含 `files` |
| `GET /api/workflows/local` | `WorkflowLocalList` | 本地工作流与分组 |
| `GET /api/nodes/installed` | `NodeInstalledList` | 已装节点包 |
| `GET /api/search` | `SearchResponse` | 发现列表与来源错误 |
| `GET /api/library` | `list[LibraryItem]` | 本地模型库 |
| `GET /api/probe` | `ProbeResponse` | 源探针四态与通路 |
| `GET /api/device` | `DeviceInfo` | 硬件与下载目录余量 |
| `POST /api/resolve` | `ResolveResponse` | 仓库解析结果与逐文件 `folder` |
| `GET /api/library/facets` | `LibraryFacets` | 模型库筛选分面（含 `allFolders` / `allTasks`） |
| `GET /api/nodes` | `NodeSearchResponse` | 节点发现列表、分面与 `installed_count` |
| `GET /api/nodes/stats` | `NodeStatsResponse` | 节点清单 / 已装 / 核心节点计数 |
| `GET /api/nodes/missing` | `NodeMissingResponse` | 工作流缺节点报告与可安装扩展 |

历史字段较多的对象（任务、工作流、节点包、节点清单条目）使用 `extra="allow"`：
新增字段不会被过滤，但上表里的必填字段不能改名或删除。

## 错误信封

错误响应至少包含 `detail`（人类可读的中文原因）。迁移过的端点额外带一个
稳定的机器可读 `code`：

```json
{ "detail": "未配置的下载源: nope", "code": "invalid_source" }
```

仍使用普通 `HTTPException` / 全局 `SourceError` 处理的旧端点保持原样，只有
`detail`，不会凭空多出 `code`：

```json
{ "detail": "仓库不存在" }
```

### 错误码

| `code` | 典型状态码 | 语义 |
|---|---|---|
| `invalid_source` | 400 | 下载源未配置 / 不可识别 |
| `invalid_request` | 400 | 参数不合法（格式、状态不允许等） |
| `not_found` | 404 | 模型 / 图片 / 节点任务 / 下载任务不存在 |
| `conflict` | 409 | 并发冲突，例如工作流 `mtime` 已变化 |
| `forbidden` | 403 | 路径或目录越界 |
| `source_unavailable` | 503 | 节点清单、发现源等外部依赖不可达 |
| `filesystem_error` | 500 / 400 | 本机文件系统错误（改名失败、路径已消失等） |

错误码定义在 `backend/app/api/errors.py`；新增端点抛 `ApiError`，不要自己拼
`{"code": ...}`。没迁移的端点会集中在下面这一节跟踪。

| 状态码 | 语义 | 触发场景 |
|---|---|---|
| 400 | 请求可读但参数无效 | 未配置的下载源、路径不在允许目录、工作流文件损坏、任务状态不允许删除 |
| 403 | 路径越界 | 只允许读取工作流目录里的图片 |
| 404 | 资源不存在 | 模型 / 图片 / 节点任务不存在 |
| 409 | 并发冲突 | 工作流 `mtime` 已变化，乐观锁失败 |
| 503 | 依赖不可用 | 节点清单不可达、前端产物未构建、源探针失败 |
| 500 | 本机文件系统错误 | 节点目录改名失败等不可恢复的本机错误 |

`SourceError` 由全局处理器统一转成 `400`；新增端点如果抛它，不要再手动包一层
不同状态码。

### 仍只返回 `detail` 的端点（待迁移）

- 工作流：`/api/workflows/resolve`、`/api/workflows/local/*`、`/api/workflows/groups*`、
  `/api/workflows/covers/*`、`/api/workflows/import`
- 封面代理：`/api/cover`
- `comfy` 路由（`backend/app/comfy/api.py`）全部仍是普通 `HTTPException`

## 错误处理器

`ApiError`（`backend/app/api/errors.py`）由 `backend/app/main.py` 的
`api_error_handler` 渲染成 `{"detail", "code"}`；`HTTPException` 与 `SourceError`
沿用 FastAPI / 现有处理器，只输出 `{"detail"}`。

## 不放进 OpenAPI 的字段

`/api/settings` 的响应包含 token；它不设置 `response_model`，也不写入契约文档。
客户端只按字段名读取，不把整份设置对象回传。
