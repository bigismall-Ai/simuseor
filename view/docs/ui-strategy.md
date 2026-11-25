# UI 策略：Material 做骨架，品牌与资产卡做特色

这是一次方向调整的记录。结论先说：**通用控件不再自建，交给 `@angular/material`；
缺失的行为用 `@angular/cdk` 补；只保留品牌层和产品特有的表面。**

## 一、为什么改

现有 `src/app/ui/` 是 59 个组件 / 10,992 行。其中约 2,800 行（19 个组件）在做
Material 已经做过的事：按钮、输入、下拉、勾选、开关、选项卡、分页、弹层、
提示、进度、菜单、分隔线。我们维护的不只是样式，还有焦点、键盘、浮层定位、
表单接入——这些正是框架的职责。

继续自建的边际收益很低：设计语言已经稳定，剩下的是长期维护
（每个大版本自己修键盘与 ARIA）。而 Material 的视觉体系是现成且一致的。

## 二、两个必须说清的点

### 1. CDK 没有皮肤

`@angular/cdk` 只提供行为（overlay、a11y、portal、drag、scrolling），
不带任何视觉。想要 Material 的观感，用的是 `@angular/material`；
CDK 用来补 Material 没覆盖的行为（例如导航树、页内目录、搜索的活动项）。

### 2. 不做「薄壳包装」

Material 的能力大量以**指令**形式挂在真实元素上：

```html
<button matButton matTooltip="…" [matMenuTriggerFor]="menu">
```

而 `<ui-button>` 的宿主不是 `<button>`，`matTooltip` / `matMenuTriggerFor` /
`matRipple` / `cdkDrag` 都挂不上去。要在壳里逐个转发输入，等于把 Material 的
API 重抄一遍，还挡住了它的组合能力。

**所以按组件族整族替换，不做包装层。**

## 三、退役 / 保留

### 退役：交给 Material（19 个，约 2,850 行）

| 自有组件 | 替换 | 调用点 |
| --- | --- | --- |
| `ui-button` / `ui-text-button` | `MatButton`（filled / outlined / text / tonal） | 116 |
| `ui-chip` | `MatChip`（filter） | 6 |
| `ui-segmented` | `MatButtonToggle` | 6 |
| `ui-input` / `ui-textarea` | `MatFormField` + `MatInput` | 24 |
| `ui-select` | `MatSelect` | 5 |
| `ui-checkbox` / `ui-switch` | `MatCheckbox` / `MatSlideToggle` | 10 |
| `ui-field` | 并入 `MatFormField` | — |
| `ui-tabs` | `MatTabGroup` | 3 |
| `ui-pagination` | `MatPaginator` + 自有 `MatPaginatorIntl` | 2 |
| `ui-dialog` | `MatDialog` | 3 |
| `ui-tooltip` | `MatTooltip` | 4 |
| `ui-toast` | `MatSnackBar` | 9 |
| `ui-progress` | `MatProgressBar` | 6 |
| `ui-divider` | `MatDivider` | — |
| `ui-card-menu` | `MatMenu` | 卡片内 |
| `ui-table` | `MatTable`（只有接数据源时；静态表保留皮肤） | 31 |

### 保留：只有品牌与资产卡（约 3.8k 行）

这一层是 Material 表达不了、也不该表达的东西：

- **品牌层**：`styles.scss` 的色板 / 字体 / token、渐变背景、logo。
- **封面与纹样**：`app-cover-plate`（家族色、纹样、照片、家族码水印、蒙版）。
- **资产卡族**：`ui-card-shell` 的布局与展开动画、`card-mark` 厂牌位、
  `card-slot` 状态槽、`card-body` 信息区、`card-origin` 原站入口，
  以及 `md-model-card` / `app-workflow-card` / `md-hub-card` / `md-node-card`。
- **静态标签**：`ui-badge` / `tag`（`MatChip` 是可交互的，语义不同）。

这一层和 Material 是**正交**的：它只是 DOM + CSS + 组件，不依赖我们自建的按钮、
输入、弹层。唯一需要改的是卡片里三个交互件：

| 卡片内交互件 | 改为 |
| --- | --- |
| `ui-card-action` 的按钮 | `MatButton`（保留卡片动作的 28px 外观，用 `--mat-button-*` 覆盖） |
| `ui-card-kebab` | `MatIconButton`（按钮内联进 `ui-card-shell`，否则 `matMenuTriggerFor` 挂不上宿主） |
| `ui-card-menu` | `MatMenu`（顺带解决菜单被卡片 `overflow: clip` 裁切的问题） |

### 其余全部归 Material

除上面这层之外，交互控件一个都不自建：按钮、输入、下拉、勾选、开关、选项卡、
分页、弹层、提示、进度、菜单、分隔线全部用 `@angular/material`。
Material 没有对应物的**内容件**（`ui-code`、`ui-notice`、`ui-empty`、`ui-skeleton`、
`ui-label`、`ui-text`、`ui-rules`、`ui-kbd`、`ui-source-chip`、`ui-tag`、`ui-badge`）
保留，但它们是排版/展示件，不承担键盘、焦点、浮层，不算「UI framework」。

页面骨架（`ui-page` / `section` / `panel` / `grid` / `toolbar`）保留为**布局原语**，
视觉参数改读 M3 的间距与圆角，不再自定一套。

## 四、视觉代价（必须先接受）

Material 的视觉是 M3：半径阶梯、字号、密度、控件解剖都与现行 VIS 不同。
两条路：

- **对齐 M3**：保留的自有表面也改用 M3 的间距 / 圆角 / 字号，两套语言合成一套。
  需要一次全站视觉重审与基线重置，但长期只有一套规范。
- **不对齐**：Material 控件与自有表面各说各话，观感会明显割裂，不建议。

选择对齐 M3 之后，VIS 的角色也变了：从「定义 59 个组件的皮肤」变成
「品牌 token + 10 个自有表面 + Material 组件映射表」，页面数可以从 30+ 收到 12 左右。

## 五、阶段

| 阶段 | 内容 | 规模 |
| --- | --- | --- |
| 0 | `UiMaterialModule` 收口（18 → 7） | 已完成，vendor −88 kB |
| 1 | 按钮族：`ui-button` / `text-button` / `chip` / `segmented` → Material | 128 调用点 |
| 2 | 表单族：`input` / `select` / `textarea` / `checkbox` / `switch` / `field` | 39 调用点 |
| 3 | 反馈与浮层：`dialog` / `tooltip` / `toast` / `progress` / `divider` / `card-menu` | 22 调用点 |
| 4 | 数据展示：`tabs` / `pagination` / `table` | 36 调用点 |
| 5 | VIS 重写为「品牌 + 自有表面 + Material 映射」，合并重叠原语 | 30+ 页 |

每阶段验收：`ng build` + `npm run lint` + `node scripts/card-guard.mjs` +
双主题视觉冒烟；视觉基线在该阶段结束时统一 bump，不逐页改。

## 六、先做哪个

建议从**按钮族**开始，理由：

1. 调用点最多（116），替换一次收益最大，也最先暴露 M3 与品牌的冲突；
2. 按钮是设计语言的锚点，它定了，表单/反馈族跟着定；
3. 改完能立刻看出「只换配色字体」不够、还差哪些 M3 对齐。

风险：按钮改动会触及几乎每个页面，视觉 diff 很大，必须整批评审，
不适合与其他改动混在一个提交里。
