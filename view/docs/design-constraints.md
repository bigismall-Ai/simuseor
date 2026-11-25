# VIS 设计约束台账

这份台账记录「哪些约束来自外部参考、落到我们的哪个 token / 组件、哪些地方有意不同」。
目的不是证明我们像 MUI，而是让下一次“参考某站”时有据可查，不再把已经定死的决定改回去。

## 采用标准

一条外部约束只有同时满足四点才进入我们的 token / 组件：

1. **可度量**：有明确数值或行为，不是“看起来舒服”
2. **可复用**：能进 token 或组件变体，不是单页样式
3. **可测试**：能被守卫、Lint、像素回归或 AXE 验证
4. **与品牌无关**：换了主色、字体、圆角仍然成立

只满足“好看”但不满足四条的，只作为参考，不落地。

## 品牌层（`view/src/styles.scss`）

| 约束 | 值 | 来源 | 说明 |
|---|---|---|---|
| 间距刻度 | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 | 自有，8px 基准 | `--ui-space-1..8`，不允许中间值 |
| 字号 | 10.5 / 11.5 / 12.5 / 14 / 22 | 自有 | `--ui-text-xs/sm/md/lg/xl` |
| 控件高度 | 24 / 28 / 34 / 38 | 自有 | `--ui-h-compact/sm/md/lg` |
| 图标 | 14 / 16 / 18 / 20 | 自有 | `--icon-inline/control/action/nav` |
| 圆角阶梯 | 6 / 8 / 10 / 12 / 16 / 24 / 999 | MUI shape + 自有分层 | `--ui-radius-xs..2xl`，语义 token 映射到阶梯 |
| 阴影 | 两档 | 自有 | `--ui-shadow` / `--ui-shadow-md`，只表达层级距离 |
| 层级 | 10 / 20 / 60 / 80 / 90 / 1000 | 自有 | 不在页面写魔数 |
| 内容宽 | 1320 → 1480 → 1680 → 1880 → 2040 | 自有 | 按 1600 / 1920 / 2560 / 3440 逐级放大 |
| 正文阅读宽 | 72ch | MUI 105ch，收窄 | `--layout-prose-measure`，只用于正文段落 |
| 断点 | 768 / 1024 / 1440 / 1920 / 2560 / 3440 | 自有 | 映射 MUI 的 sm/md/lg/xl 语义，但不改档位 |
| 滚动条 | 10px 页面 / 6px 导航 / 4px 收起 | 自有 | `.ui-scrollbar` + `--scrollbar-size` |

## 组件约束

| 组件 | 关键约束 | 来源 |
|---|---|---|
| `ui-section` | 标题在内容外、`pill` 在右；内容卡与列表自适应；底部间距 32 | 自有 |
| `ui-panel` | 24px 圆角、标题栏分隔线、右侧动作槽 | 自有 + MUI `SectionHeadline` 参考 |
| `ui-inner-card` | 16px 圆角、透明底、内描边 | 自有 |
| `ui-grid` | `minmax(--layout-grid-min, --card-max)`；窄窗单列 | 自有，MUI `Grid/Stack` 只参考 |
| `ui-toolbar` | flex + gap + wrap；surface 变体 12px 圆角 | MUI `DemoToolbar` 参考 |
| `ui-table` | 默认 11.5px 控制台密度；`density="docs"` 12.5px、16/20 内缩、行底线、无斑马 | MUI 文档表格参考，字号收窄 |
| `ui-notice` | 12px 内边距、8px 图标井、语义色 | MUI `Alert/Callout` 参考 |
| `ui-card-shell` | 16px 圆角、`.acard` 骨架；状态槽 / 标签 / 动作行只走槽位 | 自有 |
| `ui-nav-tree` | 递归树、分组展开、`subheader`、状态 chip；展开 224 / 收起 64 | MUI 文档导航结构参考 |
| `ui-text` / `ui-label` / `ui-rules` | 引言 11.5 / 小标题 14 / 规则 11.5；72ch | 自有 + MUI Markdown 参考 |
| `ui-progress` | 6px / 3px 两档；aria 与 reduced-motion | 自有 |
| `ui-state-card` | 标题 + 标签/徽标 + 内容投影；bad 变体红描边 | 自有 |

## 已采用的 MUI 约束

| MUI 约束 | 落地 |
|---|---|
| 8px spacing 基准 | `--ui-space-1..8` |
| 标题 `scroll-margin-top` | `--ui-scroll-offset`，所有标题统一 |
| 正文阅读宽度用 `ch` | `--layout-prose-measure: 72ch` |
| 表格 docs 密度：行底线、无斑马、14px 级别 | `ui-table density="docs"`，字号按我们刻度收窄到 12.5 |
| TOC 242px、缩进 12/24/36 | `--layout-toc`（组件待做） |
| 代码面板：深色底、最高 400px | `--ui-code-*`（组件待做） |
| Callout：12px、图标井 26×26 | `--ui-callout-*`（组件待做） |
| 导航树：分组 / `subheader` / 状态 chip | `NAV_TREE` + `ui-nav-tree` |
| 标题锚点、滚动监听节流 166ms | `ui-toc`（组件待做） |
| reduced-motion 抑制动效 | 组件内部统一处理 |

## 有意差异

| MUI | 我们 | 原因 |
|---|---|---|
| 105ch ≈ 930px 主内容 | 1320 → 2040 | 我们是卡片网格，不是纯文档 |
| 300px 侧栏 | 224 展开 / 64 收起 | 已有产品侧栏宽度，不照搬 |
| 57px 顶栏 | `--layout-top` + 面包屑 | 页面壳不同 |
| 600 / 900 / 1200 / 1536 | 768 / 1024 / 1440 / 1920 / 2560 / 3440 | 项目已固定断点 |
| 全局 12px 圆角 | 6/8/10/12/16/24 阶梯 | 需要区分小件、控件、列表、卡片、面板 |
| General Sans / MUI 蓝 | 极光紫 / 现有字体 | 品牌 |
| 组件页内 Demos / API tab | 独立路由 | 我们的页面组织方式 |
| 文档表格 14px | 12.5px | 我们的基础字号更小，14px 在 VIS 里显大 |

## 不采用

- MUI 的 DOM 结构、React 组件 API
- Algolia DocSearch 的整套视觉
- “纯文档优先”的页面模型
- 4px 默认 shape、12px 全局 radius 的一刀切
- MUI 品牌色、字体、图标

## 待补组件

| 组件 | 用途 | 关键约束 |
|---|---|---|
| `ui-page` | 内容容器 | 最大宽 / gutter / 顶部偏移 |
| `ui-breadcrumb` | 面包屑 | 12px、分隔符、`aria-current` |
| `ui-toc` | 右栏目录 | 242px、缩进、scroll-spy、节流 166ms |
| `ui-code` | 代码块 | 深色底、400px 上限、复制按钮 |
| `ui-kbd` | 快捷键 | 11px mono、6px 圆角 |
| `ui-search` | 搜索 | 640px 上限、52px 命中行 |

## 验证

- `npm run lint`：模板 / 无障碍 / 组件登记
- `node scripts/card-guard.mjs`：样式归属 / token / 视觉债务棘轮
- `tests/e2e/vis-visual.mjs`：31 页 × 2 宽度 × 双主题像素回归
- AXE：可访问性

## 变更流程

新增或修改一条外部约束时：

1. 在本台账增加一行（来源、我们的映射、是否差异）
2. 能进 token 的先改 token
3. 能进组件变体的写在组件里
4. 跑 Lint、守卫、像素回归
5. 有意改视觉时更新基线版本
