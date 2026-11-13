# Model Downloader

AI 模型下载与本地管理工具：**aria2 为下载内核**，Rodel 式下载体验（文件勾选 / 进度 / 断点续传 / 每源配置）+ AbyssBeacon 式本地模型库（搜索 / 标签 / 收藏 / 评审），通过 **Angular Web UI** 提供可视化交互。

支持下载源：**Hugging Face**（含 hf-mirror 镜像）、**ModelScope**、**Civitai**（支持「完整目录 / CivitAI Red 可见性」开关）。另有测试专用的 **Demo** 源（仅 URL 带 `?demo=1` 时可见，正常界面永远不显示）。

## 功能特性

- **多源解析**：输入模型 ID → 列出仓库文件（路径 / 大小 / 候选下载地址）→ 勾选下载
- **模型发现**（AbyssBeacon 式）：跨源搜索 Hugging Face / ModelScope / Civitai 模型，统一卡片列表（下载量 / 点赞 / 标签 / 任务类型），支持热门排序与关键词搜索，一键跳转下载页自动解析
- **四种下载策略**（每源可独立设置默认策略，任务级可覆盖）：

  | 策略 | 说明 |
  |---|---|
  | `direct` | aria2 直连下载（默认） |
  | `proxy` | aria2 + 该源配置的代理（默认 `http://127.0.0.1:7890`，可改 / 可禁用） |
  | `mirror` | **多站点分片**：文件按候选站点轮询分配 + aria2 多连接分片（-x/-s），失败自动换站重试 |
  | `sdk` | 走官方下载 SDK（`huggingface_hub` / `modelscope`），失败自动回退 aria2 直连 |

- **每源代理独立控制**：设置页可对每个下载源单独 开启 / 禁用 / 修改 代理地址，并可一键测试「代理 vs 直连」连通性
- **断点续传**：aria2 `.aria2` 进度文件，同参数重跑即续传
- **任务管理**：暂停 / 继续 / 取消，实时进度与每文件明细（含实际命中的站点）
- **本地模型库**（AbyssBeacon 式）：下载完成自动入库；支持关键词搜索、来源/评审过滤、标签、收藏、打开目录、扫描导入已有模型目录
- **离线 Demo 源**：无网络也可完整走通 解析 → 勾选 → 下载 → 入库 流程。仅当 URL 带 **`?demo=1`** 时在界面出现（下载页/发现页/库筛选/设置卡片），如 `/models/discover?demo=1`；该开关只存在于 URL、不写配置，正常界面永远看不到 Demo。Playwright 测试依赖它保证可重复
- **CivitAI Red 可见性**：civitai 源可开启「完整目录」（API 带 `nsfw=true`，对应 civitai.red 前门的完整目录；civitai.com 仅 SFW）。注意 `browsingLevel` 参数服务端校验有缺陷不可用；18+，部分地区依法受限

## 架构

```
Angular 19 (web/)  ──HTTP──▶  FastAPI (backend/)
                                ├── sources/     HF / ModelScope / Civitai / Demo 适配器（解析+多候选 URL）
                                ├── download/    aria2 RPC 客户端 + 下载管理器（策略/回退/进度/入库）
                                └── SQLite       任务与模型库持久化 (var/data/)
```

- 下载引擎：本机 `aria2c`（RPC 模式自动拉起，端口 6800）
- 前端产物 `web/dist/browser` 由 FastAPI 直接托管（SPA），单一端口 `http://127.0.0.1:8000`

## 快速开始

### 环境要求

- Python 3.11+（开发环境 3.13）
- Node.js 20+（构建前端；已构建可跳过）
- aria2（`aria2c` 在 PATH 中，开发环境 1.37）

### 从零构建并启动

```bash
# 1. 后端依赖
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt     # Windows
# .venv/bin/pip install -r backend/requirements.txt       # macOS/Linux

# 2. 前端构建
cd web && npm install && npm run build && cd ..

# 3. 启动（前端由后端托管，打开 http://127.0.0.1:8000）
.venv/Scripts/python backend/run.py
# 或 Windows: scripts\start.ps1   macOS/Linux: bash scripts/start.sh
```

### Playwright UI 调试

```bash
cd tests && npm install && npx playwright install chromium   # 首次
cd tests && npx playwright test                               # 跑 5 个 UI 调试用例
cd tests && npx playwright show-report                        # 查看报告
```

测试覆盖：三页面渲染与导航、设置保存与代理连通性测试、demo 源完整下载流程（解析→勾选→下载→入库→收藏）、错误提示。截图输出在 `tests/artifacts/`。

## 配置说明

配置持久化在 `var/data/settings.json`（首次启动按默认值生成，UI 修改后保存）：

```jsonc
{
  "sources": {
    "huggingface": {
      "token": "",                       // 私有仓库需要
      "save_dir": ".../models/HuggingFace",
      "strategy": "direct",              // 该源默认策略
      "proxy": { "enabled": true, "url": "http://127.0.0.1:7890" },  // 按源开关/修改
      "mirror": "https://hf-mirror.com", // 多站点候选镜像
      "use_mirror": false                // true 时解析与下载优先走镜像
    },
    "modelscope": { "...": "同构，token 在魔搭「访问令牌」页获取" },
    "civitai":    { "...": "模型 ID 为数字或 slug-id；token 拼在下载 URL 上" }
  },
  "aria2": { "rpc_port": 6800, "connections": 8, "split": 8, "max_concurrent": 3 }
}
```

要点：
- **代理按源控制**：`proxy.enabled` + `proxy.url` 独立于策略；只有 `proxy` 策略会强制走代理，`mirror`/`direct` 用直连（网络受限时可把源策略改成 `proxy`）
- **多站点候选**：HF 解析时每文件带 官方 + hf-mirror 两个候选；`mirror` 策略按文件轮询分配站点，任一站点失败自动切下一个候选
- 保存目录规则（Rodel 式）：HF / ModelScope 在保存目录下建模型同名子文件夹；Civitai 单文件平铺

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET/PUT | `/api/settings` | 读写设置 |
| GET | `/api/search` | 跨源模型搜索（q/source/sort/limit/page；source 空为三源合并） |
| POST | `/api/resolve` | 解析仓库文件列表（source/repo_id/revision） |
| POST | `/api/tasks` | 创建下载任务（files 勾选、strategy、save_dir） |
| GET | `/api/tasks` | 任务列表（含每文件进度） |
| POST | `/api/tasks/{id}/pause｜resume｜cancel` | 任务控制 |
| GET/PATCH/DELETE | `/api/library[/{id}]` | 本地模型库查询/更新（标签/收藏/评审）/删除 |
| POST | `/api/library/scan` | 扫描目录入库（每个子文件夹 = 一个模型） |
| POST | `/api/library/{id}/open` | 打开模型所在目录 |
| POST | `/api/proxy/test` | 测试代理与直连连通性 |

## 目录结构

```
backend/            FastAPI 后端
  app/sources/      下载源适配器（HF / ModelScope / Civitai / Demo）
  app/download/     aria2 RPC 客户端 + 下载管理器
  app/api/          REST 路由
  run.py            启动入口
web/                Angular 19 前端（standalone 组件）
tests/              Playwright e2e + 产物（artifacts / report / test-results）
  package.json      测试依赖（独立于 web，另有自己的 node_modules）
  playwright.config.ts
  e2e/              UI 调试用例
scripts/            启动脚本
var/                运行时状态：data/（settings + SQLite）、logs/、tmp/  ← 唯一需要备份
models/             下载产物（权重），可重下
comfy/              ComfyUI 运行时（代码 + venv），可重建
hfd.sh              原有 hfd 脚本（保留，轻量命令行可继续用）
```

三种目录的生命周期不同：`var/` 删了不可恢复（备份它）、`models/` 删了要重下、`comfy/` 删了重装十分钟。

## 已知限制

- `sdk` 策略需要自行安装对应包：`pip install huggingface_hub` / `pip install modelscope`
- Civitai 解析取第一个（或指定 id 的）版本文件；Civitai 关键词搜索仅返回首页（其 API 限制：带 query 时不允许 page 参数）；内容分级/登录限制遵循站点自身策略
- aria2 进度由轮询（1s）更新，UI 刷新间隔 1.5s
- 仅供个人学习与本地模型管理使用；各站点内容遵守其服务条款
