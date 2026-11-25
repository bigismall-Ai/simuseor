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
`backend/tests/test_api_contract.py` 里的形状断言。

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

历史字段较多的对象（任务、工作流、节点包）使用 `extra="allow"`：
新增字段不会被过滤，但上表里的必填字段不能改名或删除。

## 错误信封

所有 API 错误统一为：

```json
{ "detail": "人类可读的中文原因" }
```

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

## 不放进 OpenAPI 的字段

`/api/settings` 的响应包含 token；它不设置 `response_model`，也不写入契约文档。
客户端只按字段名读取，不把整份设置对象回传。
