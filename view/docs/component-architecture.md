# 组件构建基准（对齐 MUI / Angular Material）

这份台账解决一个问题：**渲染正确 ≠ 组件构建正确**。视觉对齐只说明样式合并了，
不说明组件能被组合、替换、继承主题、被表单接管。下面逐条对照 MUI 的公开规则，
记录我们已经做到的、做错的、以及为什么错。

参考：

- MUI《API design approach》<https://mui.com/material-ui/guides/api/>
- MUI《Overriding component structure》（slots / slotProps / component）
  <https://mui.com/material-ui/customization/overriding-component-structure/>
- MUI《Themed components》（ownerState / variants / styleOverrides）
  <https://mui.com/material-ui/customization/theme-components/>
- WAI-ARIA APG：Tabs / Tooltip / Dialog 模式

MUI 的规则不是 React 专属。去掉 `styled()` 与 JSX 之后，剩下六条对 Angular 同样成立：

| MUI 规则 | 本质 | Angular 对应 |
| --- | --- | --- |
| root slot + `component` | 根节点可替换（`button` → `a`） | 根元素类型可配置，或提供真正的语义组件 |
| `classes` + `composeClasses` | 每个槽位有稳定、可合并的类名 | 槽位选择器 / `data-slot`，不是靠 `::ng-deep` 猜结构 |
| `slots` + `slotProps` | 内部节点可替换、可传属性 | 投影插槽 + 结构化输入，不是布尔的排列组合 |
| `ownerState` | 变体由状态计算，样式读状态 | `data-variant` / `data-size` / `data-tone`，不是 9 个 `[class.x]` |
| controlled / uncontrolled | 受控与非受控都能用 | `model()` + 可选默认值；表单控件实现 `ControlValueAccessor` |
| ref 前传 | 消费者能拿到真实 DOM 节点 | 暴露元素或 `focus()`，不要求 `querySelector` 穿透 |

---

## 一、审计结论（按严重度）

### P0 · 结构性

**1. 槽位靠 `::ng-deep` 穿透，共 53 处**

```text
table.ts 21 · notice.ts 11 · input.ts 5 · section-block.ts 3
workflow-card.ts 3 · select.ts 2 · node-card/model-card/hub-card 各 2
```

`ui-table` 是最典型的错法：它包住消费者写的 `<table>`，再用 21 条
`:host ::ng-deep .table-wrap th/td/tr…` 反过去改别人的 DOM。
MUI 的做法是复合组件（`Table` / `TableHead` / `TableRow` / `TableCell`），
每个节点自己带样式，父组件不知道子结构。

后果：消费者无法只改一格、无法替换表头渲染、样式优先级靠 `::ng-deep` 的偶然顺序。
同一份 `th` 规则在 `docs` 密度下被复制了 4 遍。

**2. 表单控件是三份复制，且不是表单控件**

`ui-input` / `ui-select` / `ui-textarea` 各自重写 `.lbl` / `.control` / `.msg` / `.invalid`；
三者的标签、说明、错误逻辑完全同构。MUI 的对应物是
`FormControl`（布局与状态）+ `InputLabel` / `Input` / `FormHelperText`（槽位）。

更关键的是**它们不能进 Angular 表单**：全仓库 `NG_VALUE_ACCESSOR` 出现 0 次。
`[(ngModel)]` / `formControlName` 都接不上，只能手动 `[(value)]`。
这是「看着像控件、实际不是控件」——MUI 用 `useControlled` 解决同一件事。

### P1 · 可访问性与运行时

**3. Tabs 不符合 APG（已修）**

修前实测：4 个页签 `tabindex` 全是 `null`（全部在 Tab 序列里），
`ArrowRight` 后焦点不动，`aria-controls` / `id` 全空。
APG 要求 roving tabindex + 左右键 + Home/End。

**4. Tooltip 与触发元素没有关联（已修）**

`role="tooltip"` 有了，但触发元素上没有 `aria-describedby`，气泡也没有 `id`；
读屏聚焦时读不到提示。另外 `visibility: hidden` 会把节点移出无障碍树，
即使写了 `aria-describedby` 也指空。现在改用透明度收起 + 渲染后接线 + Esc 收起。

**5. Dialog 自搭遮罩，没有焦点圈闭（已修）**

原实现自己画 `.overlay`，注释里直接写「生产环境需要完整焦点圈闭时仍走 MatDialog」——
等于承认它不是弹层。现在改成原生 `<dialog>` + `showModal()`：
焦点圈闭、top layer、Esc 全部由浏览器提供，`::backdrop` 承担遮罩。

**6. 每条卡片常驻 2 个 document 监听（已修）**

`ui-card-shell` 用 `@HostListener('document:click')` + `document:keydown.escape`。
40 张卡 = 80 条常驻监听，每次点击每张卡都写一次 signal。
现在只在菜单打开时挂载，关闭即摘，并用 `contains` 判断内外点击。

### P2 · 一致性

**7. 布尔 class 汤**

`ui-button` 用 9 个 `[class.primary]` / `[class.sm]` … 表达 `variant` × `size`。
MUI 把这些合成一个 `ownerState`，样式按状态取值。我们的等价物是一条
`data-variant` / `data-size`，CSS 用属性选择器，守卫也能静态检查。

**8. 组件内魔数没有回到 token**

`styles.scss` 的卡片 token 层是最集中的一处：`--card-title-size: 13px`、
`--card-meta-size: 11px`、`--card-slot-size: 9.5px`、`--card-tag-size: 9.5px`。
组件本身守规矩（读了 token），但 token 自己没进刻度。已改为
`--ui-text-md` / `--ui-text-sm` / `--ui-text-xs`。

同类残留：`ui-badge` 的 `11px` / `9.5px`、`ui-card-kebab` 的 `11px`、
`ui-input` 前后缀的 `11px`、`ui-code` 的 `13px`、`--ui-field-label-gap: 6px`。
这些要连同修，否则「token 化」只是把魔数挪了个位置。

**9. overlay 有三套实现**

`ui-search` 用 `<dialog>`、`ui-dialog` 原来自己搭、`ui-card-menu` 用绝对定位。
MUI 只有一个 Modal + 一个 Popper，其余组件组合它们。现在 search 与 dialog
都收敛到原生 dialog；card-menu 仍是定位菜单（可接受，但要在文档里写清边界）。

**10. 没有一致性测试**

`src/app/ui/*.spec.ts` 数量为 0；`ng test` 没有可跑的组件用例。
MUI 每个组件都有 conformance 测试（变体、禁用、焦点、ARIA）。
我们的守卫只检查「有没有登记」「有没有手写页面样式」，不检查行为。

---

## 二、已经做对的部分（不要改回去）

审计不是只挑错，下面这些是当前架构里真正的优点，重写时应当保留：

- **`ui-card-shell` 的槽位投影**：封面 / 身份行 / 状态槽 / 标签 / 动作行都有命名入口
  （`[cardMedia]`、`[cardIdent]`、`[cardStatus]`、`[cardTags]`、`[cardFoot]`），
  五张卡只填内容。这已经是 MUI `slots` 的等价物，比布尔属性组合高一层。
- **`ui-field` 自动关联 label**：渲染后给投影控件补 id 并写 `for`，
  调用点不需要手写 id。这正是「Angular 没有 cloneElement 时」的正确解法。
- **`ui-search` 用原生 `<dialog>` + `showModal()`**：top layer 与焦点管理免费拿到，
  比自搭 portal 更稳；`ui-dialog` 本轮才对齐到同一做法。
- **`ui-segmented` 用 `role="group"` + `aria-pressed`**：与 MUI `ToggleButtonGroup`
  的选择一致，互斥视图不需要伪装成 tablist。
- **注册表 + 守卫**：`registry.json` 强制「先登记再使用」，`class-guard` 冻结页面类名。
  MUI 靠文档约定 `classes`，我们在这一层比它更硬。

---

## 三、本轮已落地

| 改动 | 文件 | 验证 |
| --- | --- | --- |
| 卡片圆角改回卡片档 16px（原来误用列表档 12px） | `styles.scss` | 实测 `border-radius: 16px`，四角弧线与理论值差 ≤1px |
| 卡片字号 token 进刻度（13/11/9.5 → 12.5/11.5/10.5） | `styles.scss` | 构建通过 |
| `ui-grid` 夹住 `min ≤ max`：≥3440 时 `--layout-grid-min`(310) 会把卡拉到 310 | `grid.ts` | 实测 1440/1920/2560/3440 卡宽恒为 300，列数 3/5/5/6 |
| `ui-card-body` 内边距走 token，展开后保留底部呼吸位 | `card-body.ts` | 实测 `padding: 8px 12px` |
| `ui-page` 文档写明 `flushBottom` 只给画布外壳；`/shell` 示例不再误用 | `page.ts`、`shell.ts` | 示例内容不再贴底 |
| Tabs roving tabindex + 左右键 + Home/End + 稳定 id | `tabs.ts` | 实测 `tabindex=[-1,0,-1,-1]`，方向键移动并切换 |
| Tooltip `aria-describedby` 接线 + Esc 收起 + 悬停桥 | `tooltip.ts` | 实测触发元素 `aria-describedby=tip-1` |
| Form 三件套补 `aria-invalid` / `aria-describedby` / `name` / `required` / `readonly` | `input.ts`、`select.ts`、`textarea.ts` | 错误字段实测 `aria-invalid=true` 且描述 id 有效 |
| Dialog 改用原生 `<dialog>` + `showModal()` | `dialog.ts` | 实测 `:modal`、焦点圈闭、Esc 关闭、焦点还给触发元素 |
| 卡片菜单监听按需挂载 | `card-shell.ts` | 实测点外收起，监听随开关释放 |

---

## 四、下一批（按投入产出排序）

1. **`ui-form-field` 抽取**（P0-2）
   把 `.lbl` / `.control` / `.msg` / `.invalid` 收进一个 `ui-form-field`，
   `ui-input` / `ui-select` / `ui-textarea` 只渲染原生控件。
   同时给三者实现 `ControlValueAccessor`，让 `formControlName` 可用。
   这一步会消掉约 120 行重复 CSS，并把「三份实现」变成「一份布局 + 三个控件」。

2. **`ui-table` 复合化**（P0-1）
   拆 `ui-table` / `ui-table-head` / `ui-table-row` / `ui-table-cell`，
   删掉 21 处 `::ng-deep`。迁移顺序：VIS 表格页 → 文档页 → 原型页。

3. **根元素可替换**（P0）
   `ui-button` 支持 `href`（渲染 `<a>`），`ui-card-action` / `ui-text-button` 同理。
   这不是「加个布尔」，而是让按钮在语义上既能是按钮也能是链接。

4. **状态属性替代布尔类**（P2-7）
   `data-variant` / `data-size` / `data-tone` 三件套，先改 `ui-button` 与 `ui-badge`，
   再加一条 ESLint 规则禁止新组件用 `[class.variant]` 表达枚举。

5. **一致性测试**
   每个交互组件至少 4 条：默认渲染、禁用、键盘、ARIA 关联。
   用 `@angular/core/testing` + `TestBed`，跑在 `ng test` 里。

6. **overlay 边界写清**
   `ui-card-menu` 留在卡片内（不 portal），并在文档里注明：
   菜单高度超过卡片可视区时会被 `overflow: clip` 裁切，超过 5 项改用弹层。

---

## 五、新增准入规则（写进 AGENTS）

1. 新组件必须有**根节点 + 至少一个可命名槽位**；不允许用 `::ng-deep` 改消费者 DOM。
2. 枚举型变体（>2 值）用 `data-*` 状态属性或 `variant` 输入，不用布尔类叠加。
3. 表单控件必须实现 `ControlValueAccessor`；说明 / 错误必须接 `aria-describedby`。
4. 需要键盘交互的组件按 APG 对应模式实现，并在 VIS 页给出键盘说明。
5. 组件内不写字号 / 间距 / 圆角 / 时长数字；token 自己也不许停在刻度之外。
6. 每个交互组件至少 4 条行为测试（默认 / 禁用 / 键盘 / ARIA）。

---

## 六、已知不做

- 不做 `sx` prop：Angular 没有运行时样式合并的传统，token + 输入已经够用。
- 不做 `classes` 对象的运行时生成：用 `data-slot` 与语义选择器替代。
- 不追求与 MUI 的 API 同名：对齐的是分层与约束，不是签名。
