# Angular 22 开发约定（view/）

本文件给 AI 编码助手使用。它结合 Angular 官方 `develop-with-ai` 最佳实践与本项目约束。
更完整的官方文本：<https://angular.dev/assets/context/best-practices.md>。

## 版本与运行

- Angular **22.3**、TypeScript **6.0**、zoneless（没有 `zone.js`）
- 工作区在 `view/`，构建命令：`cd view && npm run build`
- 旧 `web/` 是留档，不要修改
- `server/` 是后续 Litestar 后端，目前尚未创建

## TypeScript

- 开启严格类型；能推断时不要手写类型
- 禁止 `any`；不确定时用 `unknown`
- 只用 `import type` 导入类型

## Angular

- 只用 standalone component；**不要**再写 `standalone: true`（v20+ 默认）
- **不要**显式写 `changeDetection: ChangeDetectionStrategy.OnPush`（v22+ 默认）
- 状态用 signal；派生状态用 `computed()`
- 双向绑定用 `model()`；输入输出用 `input()` / `output()`
- 依赖注入用 `inject()`，不要 constructor 注入
- 新单例服务优先用 `@Service()`（v22+）；现有 `@Injectable({ providedIn: 'root' })` 可以保留
- 模板用原生控制流 `@if` / `@for` / `@switch`，不要 `*ngIf` / `*ngFor`
- 不要 `ngClass` / `ngStyle`，用 `class` / `style` 绑定
- 不要导入 `CommonModule`；只导入模板实际用到的指令和管道
- 小页面优先内联模板；外部模板/样式用相对路径
- 静态图片优先 `NgOptimizedImage`（内联 base64 除外）
- 新表单优先 Signal Forms（`@angular/forms/signals`）；否则用 Reactive Forms，不用模板驱动
- 不要用 `signal.mutate()`，用 `update()` / `set()`

## UI 与 Material

- 页面只从 `src/app/ui/material.ts` 导入：`UiMaterialModule`、`MatDialog`、`MatSnackBar`
- **不要**直接 import `@angular/material/*`
- 不要改 `styles.scss` 里的主题 token 来局部修一个页面；页面级覆盖写在自己的样式里
- 全局样式只留品牌层：token、字体、滚动条；其余视觉件（区块、表格、列表、卡片、菜单、内层卡、文档排版）一律是组件，`styles.scss` 不再新增页面级类
- 颜色只用 `--ui-*` / `--ink-*` / `--aurora-*` token，不写死十六进制
- 按钮：统一用 `ui-button`，语义靠 `variant`：主操作 `primary`，次操作 `secondary`，弱操作 `ghost`，危险 `danger` / `danger-ghost`
- 按钮 999px 胶囊、1px 描边 + 内高光 + 轻投影，深浅色只换 token；圆角阶梯：小件 6 / 控件 8 / 常规 10 / 列表 12 / 卡片 16 / 面板 24 / 胶囊 999；页面只引用 `--ui-radius-*` 语义 token
- MatDialog 的动作按钮仍用 Material 按钮（需要 `mat-dialog-close`），其余页面不得再用 `mat-flat-button` / `matButton`
- 间距只用 `--ui-space-1..8`（4/8/12/16/20/24/32/48），不再写 6/10/14/18/22 这类中间值
- 字号只用 `--ui-text-xs/sm/md/lg/xl`（10.5/11.5/12.5/14/22），不再自造 13/15/9.5
- 控件高度只用 `--ui-h-compact/sm/md/lg`（24/28/34/38）：表格内 24、筛选 28、常规 34、主操作 38
- 图标只用 `--icon-inline/control/action/nav`（14/16/18/20）
- 层级只用 `--ui-z-nav/sticky/toast/overlay/dialog/material`（10/20/60/80/90/1000），不在页面里写魔数
- 动效只用 `--ui-duration-fast/base/slow`（0.14/0.18/0.34）与 `--ui-ease`；新增带过渡的组件必须同时写 `@media (prefers-reduced-motion: reduce)`
- 页面结构：面包屑在最外层；不放大标题；每个区块用 `<ui-section title pill>`，标题在内容外，右侧标签用 `pill`
- 反馈表面：Toast 用 `ui-toast`（位置由页面容器决定），来源通路用 `ui-source-chip`
- 行内提示用 `ui-notice`：一句话 / 紧凑横条用默认 `inline`；要标题、嵌套列表、`code`、链接或动作时用 `variant="callout"`（12 圆角 / 26×26 图标井）。图标投影走 `[notice-icon]`，动作投影走 `[notice-actions]`（旧）或 `[notice-action]`（新）；关闭按钮会把焦点还给提示外部的触发元素
- 说明性文字集中在页面最后一块，不在各区块之间分散
- 区块内容直接铺在页面；表格/列表用 `.list-card`，圆角用 `--ui-radius-list`
- 文字说明用普通段落，不要用卡片包；卡片最多两层
- VIS 页面背景、侧栏、主题切换、收起/展开保持现有实现

## 尺寸与断点

- 默认内容宽 `--layout-content-max` 1320px；大屏逐级放大：≥1600 → 1480，≥1920 → 1680，≥2560 → 1880，≥3440 → 2040
- 卡片网格最小列宽 `--layout-grid-min` 随大屏从 250 → 270 → 290 → 310
- 媒体查询只允许这几档：**768 / 1024 / 1440 / 1920 / 2560 / 3440**（CSS 变量不能用于 `@media`，写字面值）
- 目标屏幕包含 3440×1440 带鱼屏与 4K/5K：不要把内容固定死在 1320 居中，宽屏要真的多放列、放并列面板
- 窄窗只在 ≤1024 做降级（表格横滚、双栏改单栏），不要把卡片强行变窄

## 焦点与可访问性

- 弹层（`ui-dialog` / MatDialog）打开把焦点送进去，关闭必须还给触发元素
- 路由切换后焦点回到页面 `h1`
- Toast / notice 不抢焦点，只用 `role="status"` / `role="alert"` 播报
- 交互元素必须有可访问名：可见文本、`aria-label`（图标按钮）或外层标签
- 可见焦点不许用 `outline: none` 抹掉；需要自定义时用 `:focus-visible` + `--ui-ring`

## 表单文案

- 错误 ≤ 30 字，以字段名开头（例：「仓库 ID 不存在，检查拼写」）
- `hint` 与 `error` 互斥：同一字段同一时刻只显示一条
- 错误里不重复按钮文案；具体动作放按钮，不写进句子
- 校验规则只写「哪里错、怎么改」，不写堆栈、URL、英文异常原文

## 图标

- 自有图标在 `src/app/ui/icons.ts`：24 grid、1.6px 描边、`currentColor`、`app:` 命名空间
- 页面用 `<mat-icon svgIcon="app:download">`，不要引入 Material Icons 字体
- 装饰性图标加 `aria-hidden="true"`；有语义的图标由外层按钮提供可访问名
- 新图标必须补进 `ICON_GROUPS`，并在 `/vis/icons` 页面可见

## 卡片约束（防漂移）

- 所有资产卡共用 `src/app/ui/asset-card.css` 的 `.acard` 外壳，不在组件内重写 `.acard-*` 外壳类
- 卡片尺寸、字号、按钮高度走 `--card-*` token；改规格先改 token
- 封面只渲染 `app-cover-plate`；纹样、家族色、照片、家族码水印、蒙版都在该组件内维护
- 卡片内保留默认底部蒙版（正文需要稳定底色）；纯封面展示 / 设计页用 `[scrim]="false"`，照片上不再压半透明模板
- 动作按钮只用共享 `ui-card-kebab` / `ui-card-action`；组件内只允许状态修饰（如 `.ghost`、`[data-tone]`）
- 卡片圆角跟随列表：`--card-radius` = `--ui-radius-list`（16px），不要再单独设 24px
- ⑤ 分类标签只能用 `<ui-badge size="sm" tone="gray">`，禁止在卡里手写 pill
- ⋯ 固定在卡片右上角（`.acard-head` 末尾），用 `ui-card-kebab`；原站入口是动作行左侧的 `ui-card-origin`，右上角不再放链接
- 菜单用 `ui-card-menu`，几何在组件自身；危险项用 `danger`
- 卡片最大宽度 `--card-max`（300px），网格统一用 `ui-grid`（默认 `minmax(--layout-grid-min, --card-max)`），不要让卡在宽屏上拉伸
- 蒙版只留一道：有封面图时用封面自带的中性黑渐变（不拿主题色染照片），文字翻白；没有照片时不叠蒙版，家族色直接做底
- 厂牌位、⋯、原站图标都固定 `card-solid` 80% 底，不随照片切换皮肤；照片上也不做深色方块
- `ui-card-kebab` / `ui-card-origin` / `ui-card-menu` 是卡片动作的固定组合，卡片内不许手写 `.acard-kebab` / `.acard-origin`
- 卡片设计与五类卡片同页：`/vis/prototypes/components/cards`（5 类清单 + 收起/展开/菜单/身份行/token），新增卡片必须同时出现在这里并跑 `npm run cards:guard`
- 五张卡必须用 `ui-card-shell`：封面 / 身份行 / 状态槽 / 标签 / 动作行只通过槽位投影，不在卡里重写 `.acard-head` / `.acard-foot`
- 状态槽只用 `ui-card-slot`，主按钮只用 `ui-card-action`；⋯ 的开合、点外收起与 Esc 由外壳统一处理
- 厂牌位统一用 `ui-card-mark`：32 × 32，支持官方 logo / 反白 logo / 家族码 / 发布方缩写 / 工作流图标；不在卡片里手写标识块

## 组件注册（Material 方式）

参照 Angular Material 的组织方式：**一个视觉原语 = 一个组件 + 一套 token + 若干变体输入**，页面只组合，不重画。

- **唯一登记表**：`src/app/ui/registry.json`。组件、选择器、分类、展示页、demo 文件、变体、尺寸、token 都写在这里；`/vis/registry` 页面直接读它渲染。
- **先注册再使用**：`src/app/ui/*.ts` 里的组件如果没有登记，`npm run cards:guard` 直接失败；VIS 模板里出现未登记的 `<ui-*>` 也会失败。
- **变体走输入**：`variant` / `size` / `density` / `tone` 用 `input()`，状态用 signal；不要用页面 class 改组件内部样式。内容差异用 `<ng-content>` 投影，不复制组件。
- **展示页必须真实**：登记的 `demoFile` 必须实际渲染该选择器，`page` 必须是 `vis.routes.ts` 里存在的路由；只写文档不渲染样张不算。
- **页面样式只做布局**：grid / flex / gap / 位置 / 断点；颜色、圆角、阴影、字号、控件高度一律用 token。VIS 样式里禁止写死 `border-radius: 16px / 24px / 28px`（卡 / 列表 / 面板级圆角必须走 `--ui-radius-*`）。
- **新增组件的顺序**：① 写组件与 token → ② 在 VIS 加真实样张（含浅色 / 深色）→ ③ 登记 `registry.json` → ④ 跑 `node scripts/card-guard.mjs` 和 `npm run build` → ⑤ 页面才允许引用。
- **全局边界**：`styles.scss` 只允许品牌 token、字体与滚动条；`.section-*`、`.table-wrap`、`.list-card`、`.inner-card`、`.acard-menu`、`.mono`、`.set-label` 等页面级类不得再新增或本地重定义。
- **守卫 2.0**：`src/app/pages` 的样式只允许布局属性，视觉值必须走 token；`styles.scss` 只允许品牌层；VIS 现有视觉声明按基线冻结，新增会被拦下。
- **CI**：`.cnb.yml` 跑组件守卫、构建与 VIS 视觉冒烟（5 页 × 2 宽度 × 双主题，控制台无错误）。

## 共享组件（`src/app/ui/`）

- 外壳：`ui-page`（内容宽与留白）、`ui-page-header`、`ui-breadcrumb`、`ui-section`、`ui-panel`、`ui-inner-card`、`ui-grid`、`ui-toolbar`、`ui-nav-tree`、`ui-toc`（右栏目录 / 窄窗速览条）、`ui-card-mark`、`app-cover-plate`
- 动作：`ui-button`、`ui-chip`、`ui-segmented`、`ui-source-chip`、`ui-toast`、`ui-badge`、`ui-tag`、`ui-empty`
- 表单：`ui-input`（文本）、`ui-field`（包非文本控件）、`ui-setting-row`（设置项）
- 表面：`ui-table`、`ui-list-card`、`ui-list-row`、`ui-dialog`、`ui-notice`、`ui-state-card`、`ui-progress`、`ui-skeleton`
- 文档面：`ui-code`（深色代码面板）、`ui-kbd`（快捷键）、`ui-search`（触发条 + 结果浮层）
- 卡片：`ui-card-shell`（外壳）、`ui-card-slot`（状态槽）、`ui-card-action`（主按钮）、`md-model-card`（`mode="library"` / `mode="discover"`）、`app-workflow-card`、`md-hub-card`、`md-node-card`
- 文档：`ui-label`（小标题）、`ui-text`（引言 / 提示）、`ui-rules`（规则清单）
- 页面不再手写 `.section-*`、`.btn*`、`.toast`、`.source`、`.notice`、`.table-wrap`、`.list-card`、`.modal`、`.badge`、`.chip`、`.segmented`、`.empty`、`.code-block`；`npm run cards:guard` 会拦下这些漂移
- 原生 `<input type="text">` 一律用 `ui-input`；checkbox / radio / file / Material `matInput` 例外
- 新增共享组件必须同时出现在对应的 VIS 原型页，并保持浅色 / 深色两套表现一致
- Toast 的自动收起走 `ui-toast` 的 `duration`（默认 0 = 不关；常规 3000、错误 6000），页面不再自己 `setTimeout`
- 代码面板两套主题都是深色底：静态样例一律用 `ui-code`（标题 / 语言 / `code` 输入，长片段放组件字段，不塞进模板），页面不再手写 `<pre>`；必须保留自定义标记的语法示意块要在代码旁写明为什么不是 `ui-code`；快捷键提示只用 `ui-kbd`（`keys` 输入或投影内容）
- 搜索用 `ui-search`：只做触发条 + 浮层，数据由页面给、选中结果走 `picked`（`route` 只是随附字段，组件不跳转）
- 三态规则：首屏首次加载用 `ui-skeleton`；已有内容局部刷新用进度条 / 行内提示；无数据用 `ui-empty`；失败用 `ui-notice error`

## VIS 目录

- `src/app/vis/`：视觉设计页；导航唯一数据源是 `vis-nav.ts` 的 `NAV_TREE`（递归树 + `subheader` + 状态 chip），外壳用 `ui-nav-tree` 渲染，不再手写导航项
- 视觉设计分四组：品牌（标识/色彩/封面/背景/图标/布局/圆角）、组件（按钮/输入框/胶囊/表格/空状态/模态框）、定制（字体与排版/间距/层级与阴影/动效/主题 Token）、原型（见下）
- `src/app/vis/prototypes/`：产品原型，分「组件」（如卡片）与「页面」（如资源管理器）两组
- `src/app/ui/`：共享组件与 Material 入口
- `src/app/pages/`：将来的产品页面
- 品牌资产在 `public/brand/`：MIN / MID / MAX 三种彩色展翅 + black-line / white-line 两种线稿，共 5 个 SVG
- 外部参考与自有约束的映射在 `docs/design-constraints.md`；新增 token / 组件前先查台账，避免把已定死的决定改回去

## 可访问性

- 必须通过 AXE 检查
- 满足 WCAG AA：焦点管理、对比度、ARIA
- 交互控件必须有可访问名；不要只靠颜色传达状态

## AI 功能（design-patterns）

以后在 `view/` 里做 AI 功能时，按 Angular 官方模式：

- 用 `resource()` / `httpResource()` 管理请求，不要手写散落的 fetch 状态
- 用户输入与提交值分成两个 signal，避免每次输入都触发请求
- 流式响应用 `resource({ stream })`
- 派生/累积状态用 `computed()` 或 `linkedSignal()`
- 加载、错误、重试用 `resource.isLoading()` / `hasValue()` / `error()` / `reload()`

参考：<https://angular.dev/ai/design-patterns>
