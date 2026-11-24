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
- 颜色只用 `--ui-*` / `--ink-*` / `--aurora-*` token，不写死十六进制
- 按钮：统一用 `ui-button`，语义靠 `variant`：主操作 `primary`，次操作 `secondary`，弱操作 `ghost`，危险 `danger` / `danger-ghost`
- 按钮 999px 胶囊、1px 描边 + 内高光 + 轻投影，深浅色只换 token；面板 28px，卡片 24px，列表 16px
- MatDialog 的动作按钮仍用 Material 按钮（需要 `mat-dialog-close`），其余页面不得再用 `mat-flat-button` / `matButton`
- 页面结构：面包屑在最外层；不放大标题；每个区块用 `<ui-section title pill>`，标题在内容外，右侧标签用 `pill`
- 反馈表面：Toast 用 `ui-toast`（位置由页面容器决定），来源通路用 `ui-source-chip`
- 说明性文字集中在页面最后一块，不在各区块之间分散
- 区块内容直接铺在页面；表格/列表用 `.list-card`，圆角用 `--ui-radius-list`
- 文字说明用普通段落，不要用卡片包；卡片最多两层
- VIS 页面背景、侧栏、主题切换、收起/展开保持现有实现

## 图标

- 自有图标在 `src/app/ui/icons.ts`：24 grid、1.6px 描边、`currentColor`、`app:` 命名空间
- 页面用 `<mat-icon svgIcon="app:download">`，不要引入 Material Icons 字体
- 装饰性图标加 `aria-hidden="true"`；有语义的图标由外层按钮提供可访问名
- 新图标必须补进 `ICON_GROUPS`，并在 `/vis/icons` 页面可见

## 卡片约束（防漂移）

- 所有资产卡共用 `src/app/ui/asset-card.css` 的 `.acard` 外壳，不在组件内重写 `.acard-*` 外壳类
- 卡片尺寸、字号、按钮高度走 `--card-*` token；改规格先改 token
- 封面只渲染 `app-cover-plate`；纹样、家族色、照片、家族码水印都在该组件内维护
- 动作按钮只用共享 `.acard-kebab` / `.acard-primary`；组件内只允许状态修饰（如 `.ghost`、`[data-tone]`）
- 新增卡片组件必须同时出现在 `/vis/prototypes/components/cards`，并跑 `npm run cards:guard`
- 厂牌位统一用 `ui-card-mark`：32 × 32，支持官方 logo / 反白 logo / 家族码 / 发布方缩写 / 工作流图标；不在卡片里手写标识块

## 共享组件（`src/app/ui/`）

- 外壳：`ui-page-header`、`ui-section`、`ui-panel`、`ui-card-mark`、`app-cover-plate`
- 动作：`ui-button`、`ui-chip`、`ui-segmented`、`ui-source-chip`、`ui-toast`、`ui-badge`、`ui-empty`
- 表单：`ui-input`（文本）、`ui-field`（包非文本控件）
- 表面：`ui-table`、`ui-list-card`、`ui-dialog`、`ui-notice`
- 卡片：`md-model-card`、`md-library-card`、`app-workflow-card`、`md-hub-card`、`md-node-card`
- 页面不再手写 `.section-*`、`.btn*`、`.toast`、`.source`、`.notice`、`.table-wrap`、`.list-card`、`.modal`、`.badge`、`.chip`、`.segmented`、`.empty`；`npm run cards:guard` 会拦下这些漂移
- 原生 `<input type="text">` 一律用 `ui-input`；checkbox / radio / file / Material `matInput` 例外
- 新增共享组件必须同时出现在对应的 VIS 原型页，并保持浅色 / 深色两套表现一致

## VIS 目录

- `src/app/vis/`：视觉设计页
- `src/app/vis/prototypes/`：产品原型，分「组件」（如卡片）与「页面」（如资源管理器）两组
- `src/app/ui/`：共享组件与 Material 入口
- `src/app/pages/`：将来的产品页面
- 品牌资产在 `public/brand/`：MIN / MID / MAX 三种彩色展翅 + black-line / white-line 两种线稿，共 5 个 SVG

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
