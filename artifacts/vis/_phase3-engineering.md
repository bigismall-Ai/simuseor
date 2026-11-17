# SiMuseor VIS · Phase 3 工程落地方案

> 阶段：Phase 3（工程落地方案 / 独立 token 层） / 共 3 阶段　·　编制：前端工程专家
> 工作区：`E:/Projects/model-downloader`（Windows）
> 上游依据（**v1.1 定稿口径**）：`artifacts/vis/_phase1-visual.md` **v1.1 / 620 行**、`artifacts/vis/_phase2-experience.md` **v1.1 / 888 行**（§7 验收清单 61 条），均已逐节打开核实；Phase 3 交付物已按三位队友回传的 v1.1 边界修订同步。
> 核实过的真实代码（全部本人打开）：`web/src/styles.css`(1641 行)、`web/src/app/app.component.ts`(236 行)、`web/src/index.html`、`web/src/tailwind.css`、`web/angular.json`、`web/src/app/lab/lab-theme.ts`、`web/src/app/core/theme.service.ts`、`web/src/app/ui/model-card.component.ts`、`logo-vector/fonts/{BarlowCondensed,Inter}.ttf`、`tests/e2e/app.spec.ts`(828 行，只读核对契约)、`web/package.json`、`tests/package.json`、`tests/playwright.config.ts`。

> **【本轮边界 · 硬性】零落地、零 E2E 改动、零实验稿字形。**
> 本阶段**只产方案 + 独立 token 文件 + 只读校验脚本**，**未修改** `web/src/`、`tests/`、`web/angular.json`、`web/public/` 下任何文件，未产出 HTML 手册（手册由主理人汇编）。
> 下文 M0–M3 是**未来排期**，不是「已经改了」。Phase1 §8 冲突表 **A–N 共 15 项**（`A/A′/B/C/D/E/F/G/H/I/J/K/L/M/N`；**v1.0 实为 13 项**，v1.1 新增 M/N 后 15 项，早期「12 项」为计数笔误）全部仍为「本轮不执行」。其中 **M（3 处 `--accent` 白字填充）/ N（21 处 `--faint` 文本引用）是 Phase 3 立即项、与 LOGO 冻结解耦**，已并入 M1 的 P3-5 / P3-6，不新开任务（Phase2 §8.3 / §8.5）。
> LOGO **仍在迭代**：`design-options` 六方向、`r2-*` 八方向、Cormorant `preview.html`、`smallcaps`、designkit「终稿」全部实验稿 / 已否，**无一终稿**。任何代码 / token 不引用实验稿字形、不依赖月桂几何；标识只允许 `.brand-wordmark` 单一接入点。

> **技术栈事实（不得偏离）**：Angular 19 standalone + FastAPI，**不是 React/Next.js**。全局样式 `web/src/styles.css`；Tailwind v4 入口 `web/src/tailwind.css`（只 `@import theme.css + utilities.css`，**不引 preflight**，`angular.json:29-31` 中排在 `styles.css` 之前）；PrimeNG Aura preset `web/src/app/lab/lab-theme.ts`；主题唯一入口 `theme.service.ts:43-48` 的 `data-theme`；E2E `tests/e2e/app.spec.ts`。

---

## 0. 交付物与本轮硬输入

| # | 文件 | 性质 |
|---|---|---|
| 1 | `E:/Projects/model-downloader/artifacts/vis/vis-tokens.css` | 可独立引入的 token 层（223 行，生效 CSS 仅 2 条 `@font-face` + 两个 `:root` 块） |
| 2 | `E:/Projects/model-downloader/artifacts/vis/_phase3-engineering.md` | 本文（落地方案） |
| 3 | `E:/Projects/model-downloader/artifacts/vis/vis-check.mjs` | 只读 Node 校验脚本，已实际运行，输出见 §3 |

**主理人已裁定的硬输入（不推翻）**：色彩分层双轨；字重白名单 `400/500/600/700`；中文 `letter-spacing:0`；数字 `tabular-nums`；`--accent` 永不作白字填充（`--primary` 6.29:1 vs `--accent` 深色 1.99:1，Phase2 附录 A-1 采纳为对比度硬约束）；`--faint/--placeholder` 永不承载文本（只改引用、不改 token 值）；`.brand-sub` `letter-spacing:.06em→0`（附录 A-4 采纳）；明暗唯一入口 `data-theme`，禁止 `filter:invert()`；`lab-theme.ts` dark primary `{primary.400}→{primary.300}`；三档圆角 `12/8/5` + 弹层 16 + 胶囊 999；900px 隐藏 `.brand-sub` 保留字标并预置 30×30 icon 分支；冻结只改 3 处；E2E 契约实测更正（`.nav > a[href="/models"]`、`test.describe('Model Downloader Web UI')` 保留、「安装实例」全页唯一、首个 `ui-badge` 必须是环境卡徽章、禁止新增含「模型/安装/下载任务/设置/安装实例」可访问名的元素）。

**v1.1 增量（视觉架构师 / 主理人 / 体验设计三方回传，已全部并入本方案）**：

| # | 边界 | 落在本方案 |
|---|---|---|
| 1 | §8 计数更正：v1.0 13 项 → v1.1 **15 项**（+M/N），早期「12 项」笔误 | 全文统一 15 项；§5.0 映射表注明 M/N 立即项 |
| 2 | **M 项**：3 处 `--accent` 白字填充改 `--primary`；`segmented.active` 合规**别一起改**；`.filter-chip.active:hover` 不再用 `--accent-hover` | §5.2 M1-d（含 hover 取值取舍说明） |
| 3 | **N 项**：21 处 `--faint`/`--placeholder` 文本引用迁 `--muted`/`--text-2`，**不改 token 值**；禁止的是「用这两个色值承载文本」，**不是禁止 `::placeholder` 元素**（E2E `:54,:92` 依赖），且 placeholder 不得成为唯一标签 | §5.2 M1-e + §5.3 M2-d（补 `<label>`） |
| 4 | **E 项 2→3 处**：`model-card.component.ts:109-117` 是组件 scoped，全局 `styles.css` 覆盖不到，需单独改；其 `:119-123` reduce 块保留作全仓范本 | §5.2 M1-c、§5.3 M2-c |
| 5 | **裁决 G 语义边界（v1.1 §7.3）**：归一对象仅「文字/描边/图形型 `--accent`」，两套实心填充路线各自合规、**字色相反、不得拉齐**：主 UI 600 底+白字 6.29:1；lab 亮靛紫底 + `contrastColor '{primary.950}'` 深字（on 400 = 5.36:1 / on 300 = 8.02:1）。白字 on 400 `#818cf8` = **2.98:1 FAIL**、on 300 = 1.99:1 FAIL → **绝不把 lab primary 改成白字** | §5.2 M1-g、§8.2，并由 `vis-check.mjs` **§1.10 正向验收 + §2 对比度表**自动化 |
| 6 | `vis-check.mjs` **只检主 UI** 的 `background:var(--accent)` + 白字组合，**不对 lab 的 `contrastColor` / 亮底深字方案报 FAIL** | §3、§9.1；脚本 §1.3 已加显式口径声明 |

> v1.1 只改规范文档与口径，**未改任何色值、未改 `web/src`、A/B/C 裁决与冻结协议不变**；本文读到的 `styles.css` 现状不变。

---

## 1. token 命名表

「是否覆盖现有变量」一列**全为否**（零覆盖承诺，由 `vis-check.mjs` §3 自动校验：交集 0 个 → PASS）。

| 变量名 | 浅值 | 深值 | 来源章节 | 影响面（未来） | 覆盖现有变量 |
|---|---|---|---|---|---|
| `--brand-paper` | `#f8f6f1` | 同浅值（常量，不随主题变） | Phase1 §3.3-(1) / §3.2 裁决 A′ | 品牌展示面底（关于页/分享卡/VIS 手册）；**禁止**用作 `--bg/--panel/--input-bg` | 否 |
| `--brand-ink` | `#1b1b1e` | 同浅值 | Phase1 §3.3-(1) | 浅底字标/品牌文字；与 `--text #18181b` 明度差 <2% 但不合并、不互引 | 否 |
| `--brand-line` | `#dedbd3` | 同浅值 | Phase1 §3.3-(1) | 1px 品牌展示面分隔细线；**仅装饰**（1.28:1，非文本） | 否 |
| `--brand-muted` | `#6d6a64` | 同浅值 | Phase1 §3.3-(1) | 品牌展示面辅助文字（纸底实测 4.99:1） | 否 |
| `--brand-paper-reverse` | `#15151a` | 同浅值 | Phase1 §3.3-(1) / `preview.html:76` | 反白底 | 否 |
| `--brand-ink-reverse` | `#f1ede4` | 同浅值 | Phase1 §3.3-(1) / `preview.html:76,78` | 反白字标（**暖白，非纯白**） | 否 |
| `--brand-surface` | `var(--brand-paper)` | `var(--brand-paper-reverse)` | Phase1 §7.2 / §2.4 | 品牌层「活跃面」语义别名，供将来展示面；本轮不接 UI | 否 |
| `--brand-fg` | `var(--brand-ink)` | `var(--brand-ink-reverse)` | Phase1 §7.2 / §2.4 | 同上（反白映射） | 否 |
| `--brand-rule` | `var(--brand-line)` | `var(--brand-line)` | Phase1 §3.3-(1) | 1px 发丝线别名 | 否 |
| `--border-control` | `#8b8b94` | `#8b8b94` | Phase2 §2.10-11 / §3.2 | 仅 `input/select/textarea/.radio-row` **静止边框**；实算浅 on `#fff` **3.38:1** / on `--bg #f5f5f6` **3.10:1**，深 on `--panel #141417` **5.44:1**，均 ≥3:1（1.4.11）；**不覆盖** `--border` | 否 |
| `--radius-lg` | `16px` | 同浅值 | Phase1 §6.4 例外 1 / §8-D | 仅弹层 `.modal`(`styles.css:909`) 与 `lab-theme.ts:89` dialog；三档 `12/8/5` 不变 | 否 |
| `--brand-logo-light` | `none` | 同浅值 | Phase1 §2.6-2 / Phase2 §1.1 | 横版字标 · 浅底。占位 `none` **无任何字形**；冻结后填 `url('/brand/simuseor-light.svg')` | 否 |
| `--brand-logo-dark` | `none` | 同浅值 | 同上 | 横版字标 · 深底（反白稿） | 否 |
| `--brand-icon-light` | `none` | 同浅值 | Phase1 §8-K / Phase2 §4.4 | ≤900px 紧凑 30×30 图标 · 浅 | 否 |
| `--brand-icon-dark` | `none` | 同浅值 | 同上 | ≤900px 紧凑 30×30 图标 · 深（**必须配深色资产**） | 否 |
| `--brand-clear-space` | `10px` | 同浅值 | Phase1 §2.3 / §2.6-3 | 占位近似（字标总高 20px 的 0.5 倍）；冻结后按实测 X（S cap-height）覆盖 | 否 |
| `--brand-min-width` | `120px` | 同浅值 | Phase1 §2.3 / §2.6-3 | 横向字标最小宽度；侧栏可用宽约 190px | 否 |
| `--brand-icon-min` | `32px` | 同浅值 | Phase1 §2.3 / §2.6-3 | 独立图标最小尺寸；<20px 只用字首单体 | 否 |

**两个设计取舍（请主理人知悉）**

1. **六枚 `--brand-*` 是固定 HEX 常量，不随 `data-theme` 变。** Phase1 §2.4 / §7.2 / `cover.ts:43` 明确「反白用独立 SVG 资产 + 明暗切换，不是 CSS 取色」。因此任务书要求的「`:root[data-theme="dark"]` 下的反白映射」落在一组**新增语义别名** `--brand-surface/--brand-fg`（浅→纸墨、深→`--brand-paper-reverse`/`--brand-ink-reverse`）上，供将来品牌展示面使用；四个 URL 变量也**不**在 dark 块重赋值（light/dark 是两份资产路径，由接入规则选读哪一个，而非改变量值），这样「冻结只改 3 处」才自洽。
2. **`--border-control` 深浅取同一 HEX** 是 Phase2 §2.10-11 的实测结论（浅 3.38:1 / 深 5.44:1）。仍分别在两个 `:root` 声明，为深色独立微调留接口；若视觉过重，走 §2.10-11 降级方案（可见 `<label>` + `F` 焦点环 + `aria`）并登记例外。

---

## 2. 与 `web/src/styles.css:17-122` 的映射与差异表

现有两套 `:root`：`styles.css:17-74`（浅，`color-scheme:light`）与 `:77-122`（深，`color-scheme:dark`），共 **39 个**唯一 `--*` 变量（脚本实算）。

| 现状变量 | 现行浅值 / 深值 | 目标态 | 是否本轮改 | 迁移步骤 |
|---|---|---|---|---|
| `--bg/--bg-deep/--panel/--panel-2/--panel-3/--input-bg/--hover` | `#f5f5f6 / #ededef / #ffffff / #fafafa / #f4f4f5 / #ffffff / #f4f4f5` ↔ 深 `#0b0b0d…#1e1e23` | **原样保留** | 否 | 无。裁决 A「分层双轨、零覆盖、零回归」；暖纸色**不得**进入 UI 表面 |
| `--text/--text-2/--muted/--faint/--placeholder` | 四档一一对应 ↔ 深 `#ededf0/#d4d4d8/#8b8b94/#5f5f68/#5f5f68` | **值原样保留**，只改 `--faint/--placeholder` 的**使用位置** | 否（本轮） | M1：21 处 `color:var(--faint)` → `--muted`/`--text-2`；`:653` `color:var(--placeholder)` → `--muted`；`::placeholder` 文本必须保留 |
| `--border/--border-soft/--border-strong` | `#e4e4e7 / #f0f0f1 / #d4d4d8` ↔ 深 `#26262b / #1e1e22 / #34343a` | **值原样保留**；新增 `--border-control` 承担控件边界 | 否 | M0 新增 token；M2 把 `input,select,textarea:638`、`.radio-row:684` 的 `border-color` 引到 `--border-control`。`--border` 1.27:1 继续只作结构分隔线 |
| `--accent` | `#4f46e5` ↔ `#a5b4fc` | **原样保留**（文字/描边/图形色） | 否 | M1：3 处「`--accent` 作白字填充」改 `--primary`（§3.5-10） |
| `--primary` | `#4f46e5` ↔ `#4f46e5`（**不翻**） | **原样保留**，并升级为对比度硬约束 | 否 | 不改值；`vis-tokens.css` 与校验脚本把 6.29:1 写成可验收判据 |
| `--primary-hover/--on-primary/--accent-hover/--accent-soft/--accent-line/--ring` | 见 `:43-48,70 / :99-104,121` | 原样保留 | 否 | 无 |
| `--ok/--warn/--err` + `-soft`、`--star`、`--track`、`--chip` | 浅用深档、深用亮档/半透明 | 原样保留 | 否 | 无 |
| `--radius/--radius-sm/--radius-xs` | `12/8/5px` | **原样保留**；新增第 4 档 `--radius-lg:16px` | 否 | M0 新增；M1 把 `:909` 的 `16px` 字面量 token 化（值不变） |
| `--shadow-sm/md/lg` | 见 `:66-68 / :117-119` | 原样保留 | 否 | M1 移除 3 处 hover 对 `--shadow-sm` / 外阴影的**引用**，不改 token 值 |
| `--sidebar-w` | `236px` | 原样保留 | 否 | 无（品牌位宽度约束依赖它） |
| **新增 `--brand-*` 六枚 + 3 别名 + `--border-control` + `--radius-lg` + 4 URL + 3 常量** | 无 | 见 §1 | **否（本轮零落地）** | M0 追加 `vis-tokens.css` 到 `angular.json:29-32` |

**差异本质**：Phase 1/2 反复强调「不达标集中在**使用位置**，不是色板」——因此本轮 token 层只做「新增」，把 `--accent` 白字填充、`--faint` 承载文本、控件边界 1.27:1 这三类问题留给 M1/M2 的**引用替换**，两套 `:root` 一个值都不动。

---

## 3. `vis-check.mjs` 实际运行输出摘要

**运行命令**（Node v22.22.2，无第三方依赖）：

```bash
node E:/Projects/model-downloader/artifacts/vis/vis-check.mjs
```

**实际运行结果**：脚本**完整跑完**并打印全部 4 段报告，末尾 `EXIT CODE = 1`（含义：`0`=全通过 / `1`=仅现状基线 FAIL，预期 / `2`=交付物校验失败）。有 FAIL 时非 0 可接受，且脚本先打印完整报告再退出，符合任务要求。

关键输出摘录：

```
[0] 扫描范围
    styles.css : web/src/styles.css  (1641 行)
    app/**/*.ts: 27 个文件
    vis-tokens.css: artifacts/vis/vis-tokens.css  (223 行)

[1] 现状基线扫描
    上游口径：Phase1 v1.1 (620 行) / Phase2 v1.1 (888 行)；§8 冲突表共 15 项
      （v1.0 13 项，v1.1 新增 M/N；早期「12 项」为笔误），全部「本轮不执行」；
      M（3 处 --accent 白字填充）/ N（21 处 --faint 文本）为 Phase 3 立即项，与 LOGO 冻结解耦
    v1.1 §7.3 边界：1.3 只检主 UI 的 CSS 规则，【不】对 lab-theme.ts 的深字方案报 FAIL
    1.1 非白名单 font-weight -> 26 处 = styles.css 17 + 组件 scoped 9
        判定: [PASS] styles.css 内 17 处 = Phase1 §4.2 登记 17 处
        [DISCOVERY] 组件 scoped 内 9 处，建议并入 M1 补充批次
    1.2 color: var(--faint|--placeholder) -> 39 处 = styles.css 22
        （--faint 21 / --placeholder 1） + 组件 scoped 17
        全量引用 41 处；差值 2 处为 background 等非文本装饰引用（§3.3 允许）
        判定: [PASS] styles.css 内 21 + 1 = Phase2 §3.3 登记值
    1.3 background: var(--accent*) + 同规则 color: var(--on-primary) -> 3 处
        styles.css:737 .filter-chip.active / :743 .filter-chip.active:hover
        / :1469 .step-row.active .step-dot        判定: [PASS] 与登记 3 处一致
    1.4 filter: invert() -> 0 处                          判定: [PASS]
    1.5 brand-wordmark 字面（项目源码）-> 0 个             判定: [PASS] 零落地
    1.6 圆角中间档 6/9/4/10px -> 9 处 = styles.css 5 + 组件 scoped 4
        判定: [PASS] styles.css 内 5 处 = Phase1 §6.4 登记 5 处
        登记例外: styles.css 16px x1 / 999px x7；nodes.component.ts 999px x1
    1.7 prefers-reduced-motion -> 1 处（model-card.component.ts:119） [WARN]
    1.8 @font-face（项目源码）-> 0 条；vis-tokens.css 目标态声明 2 条 [INFO]
    1.9a stroke-width: 1.6 -> 2 处（styles.css:250, :370）
    1.9b 源码引用新增 token: --brand-* 0 / --border-control 0 / --radius-lg 0
        判定: [PASS] 零落地证据
    1.10 lab-theme.ts 裁决 G 边界（v1.1 §7.3 / Phase2 §7.2 新增验收项）
        [INFO] dark primary.color 当前 = {primary.400}（现状）；裁决 G 只改这一行色值
        [PASS] dark.primary.contrastColor 保持 {primary.950} 深字
        [PASS] dark 块未被误改成白字 contrastColor（绝不改白字）
        [PASS] light.primary.contrastColor #ffffff 为合规浅色方案（不判 FAIL）
        [PASS] dialog.root.borderRadius 保持 16px / focusRing 2px+offset 2px
        独立复算: 白字 on indigo 400 #818cf8 = 2.98:1 FAIL；深字 #1e1b4b
                  on 400 = 5.36:1 / on 300 #a5b4fc = 8.02:1 -> 两套路线各自合规
        口径: 1.3 只检主 UI 的 --accent 白字填充，【不】对 lab 深字方案报 FAIL

[2] 关键对比度实算（WCAG 相对亮度公式，26 组 >= 要求的 10 组）
    小计: PASS 18 / FAIL 7 / INFO 1
    代表性实算：#ffffff on --primary #4f46e5 = 6.29:1 PASS（硬约束）
      #ffffff on --accent #a5b4fc = 1.99:1 FAIL（禁止组合）
      #ffffff on --accent-hover #c7d2fe = 1.49:1 FAIL（更差）
      #ffffff on indigo 400 #818cf8 = 2.98:1 FAIL（v1.1 §7.3 禁止组合，非 lab 现状）
      lab 深字 #1e1b4b on 400 = 5.36:1 PASS / on 300 = 8.02:1 PASS（合规路线）
      --faint #a1a1aa on #ffffff = 2.56:1 FAIL；--border #e4e4e7 on #fff = 1.27:1 FAIL
      --border-control #8b8b94 on #ffffff = 3.38:1 PASS / on --bg = 3.10:1 PASS
      深色 --muted #8b8b94 on --panel #141417 = 5.44:1 PASS
      品牌 --brand-ink on --brand-paper = 15.91:1 PASS
      品牌反白 --brand-ink-reverse on --brand-paper-reverse = 15.57:1 PASS
      --brand-line on --brand-paper = 1.28:1 INFO（仅 1px 装饰细线，豁免）

[3] 交付物校验：零覆盖
    web/src/styles.css 已有 --* 变量: 39 个
    vis-tokens.css 赋值 --* 变量  : 18 个
    重名赋值（必须为空）          : 0 个
    判定: [PASS]  ZERO-OVERRIDE / 零覆盖承诺
    新增变量清单 18 个（附浅/深取值）已打印
    vis-tokens.css 自身完整性自检：10 项全部 [PASS]
      （注释配对 / @font-face 恰好 2 条 / Barlow 400 / Inter 100 900 /
       两条 font-display:swap / 4 个 URL 变量占位 none / 3 个常量存在 /
       生效 CSS 不含组件实现规则 / 无 filter:invert / 无实验稿字形）

[4] SUMMARY
  交付物校验（零覆盖 / token 文件自检）: 全部 PASS
  基线计数一致性（styles.css 对 Phase1/2 登记值）: 全部吻合（17 字重 / 21+1 faint / 5 圆角 / 3 白字填充）
  组件 scoped 审计盲区（DISCOVERY）: 字重 +9 / --faint 文本 +17 / 圆角 +4 = 30 处
  其它现状: filter:invert 0 / brand-wordmark 0 / reduced-motion 仅 1 处 / @font-face 0 条
  对比度实算: PASS 18 / FAIL 7 / INFO 1（共 26 组）
  裁决 G 边界（v1.1 §7.3）: 1.10 正向验收 lab 深字方案全部 PASS；1.3 未对其报 FAIL；
     白字 on indigo 400 = 2.98:1 列为「禁止组合」示例，与主 UI --primary 白字 6.29:1 分开。
  上游口径: Phase1 v1.1 / Phase2 v1.1；§8 冲突表 15 项（v1.0 13 项 + M/N），
     M/N 为 Phase 3 立即项，与 LOGO 冻结解耦，并入 M1（P3-5/P3-6），不新开任务。
  本轮边界: 零落地、零 E2E 改动、零实验稿字形。本脚本只读，未写任何项目文件。
  EXIT CODE = 1
```

**结论**：`vis-check.mjs` 全部数值与 Phase1 §4.2、§8-M/N、Phase2 §3.2、§3.3、§6.4 的登记**逐条吻合**；「零覆盖」硬约束 PASS；对比度实算与 Phase2 §3.2 手工表完全一致（独立复算通过）。FAIL 7 组中 6 组是「已登记的现状违规 / 禁止组合」，第 7 组是 v1.1 §7.3 新增的「白字 on indigo 400」**禁止组合示例**（用于证明「不得把 lab primary 改成白字」），**不是 lab 现状违规**——lab 现状为「亮靛紫底 + `#1e1b4b` 深字」，由 §1.10 正向验收全部 PASS。**脚本未对 lab 深字方案报任何 FAIL**（team-lead 指定口径）。以上均非脚本错误，也不是本轮交付物缺陷。

---

## 4. 【新增发现】组件 scoped 样式的审计盲区（增补，不推翻 Phase1/2）

`vis-check.mjs` 按任务要求扫描 `web/src/app/**/*.ts`（27 个文件）后，发现 Phase 1/2 的登记范围**只覆盖 `web/src/styles.css`**，而 Angular 组件的 `styles: [\`…\`]` scoped 样式里还有 **30 处同类项**。Phase1 v1.1 已补登记 `model-card.component.ts:109-117` 为第 3 处 hover 阴影、并注明「组件 scoped 样式需单独收敛」，本发现是该已知盲区的系统性延伸。

| 类别 | 组件 scoped 命中（`文件:行号`） | 建议 |
|---|---|---|
| 非白名单字重 **9 处** | `lab/lab-primeng.component.ts:144`(650)、`pages/downloads.component.ts:223`(620)、`pages/library.component.ts:184`(`font: 620`)、`pages/node-library.component.ts:218`(620)`/:322`(550)、`pages/nodes.component.ts:259`(620)`/:279`(620)、`pages/workflows.component.ts:368`(620)、`ui/model-card.component.ts:145`(620) | 并入 M1 补充批次，按 `550→500`、`620/650→600` 归并；纯字面量、无布局影响 |
| `color: var(--faint)` **17 处** | `pages/discover.component.ts:362`、`pages/downloads.component.ts:254`、`pages/library.component.ts:181`、`pages/node-library.component.ts:252/299/319/333/335`、`pages/nodes.component.ts:216/265/335/366`、`pages/workflows.component.ts:244/263/297/424/431` | 并入 M1 补充批次 → `--muted`（落在 `--panel-3`/`--chip` 上的走查后升级 `--text-2`）；**不改 token 值** |
| 圆角中间档 **4 处** | `lab/lab-primeng.component.ts:344`(10px)、`ui/cover-plate.component.ts:128`(6px)`/:268`(6px)`/:310`(4px) | ⚠️ **`cover-plate` 3 处需主理人裁决**：Phase1 §5.2 / Phase2 §6.2 明确「9 家族色 × 明暗两套 + 5 构图**全部保留原值不改**」，本方案**不擅自纳入收敛**；`lab-primeng` 10px 属 lab 实验区，随 Phase1 §8-G 裁决（见 §5.2 M1-g）归一处理 |

> **口径声明**：本发现是**增补**，不推翻主理人给的 M1 数字（17 处字重 / 21 处 `--faint` / 6 处圆角）。`styles.css` 内部的登记值经脚本复核**逐条吻合**；组件 scoped 的 30 处是「同源问题、不同文件」，建议在 M1 末尾加一个「M1-b 组件 scoped 补充批次」，并请主理人先裁决 `cover-plate` 的 3 处是否受 §5.2 保护而豁免。

---

## 5. 四阶段迁移计划 M0–M3

> **所有阶段本轮均不执行**。每阶段给「具体文件 + 行号 + 选择器 + 可复制的改动前后字符串 + 验证命令 + 回归范围」。
> 通用验证命令（阶段末尾统一跑）：
> ```bash
> # 1) 只读校验（无依赖）
> node E:/Projects/model-downloader/artifacts/vis/vis-check.mjs
> # 2) 前端构建（angular.json 默认 production，输出 dist/）
> cd E:/Projects/model-downloader/web && npm run build
> # 3) E2E（tests/ 自带 playwright.config.ts，webServer 起 backend/run.py，baseURL 127.0.0.1:8000）
> cd E:/Projects/model-downloader/tests && npm run test:e2e -- e2e/app.spec.ts
> # 4) 开发预览（可选）：cd web && npm start  -> ng serve --port 4200 --host 127.0.0.1
> ```
> 注意：E2E 的 `webServer` 只起后端（静态托管前端 `dist/`），**跑 E2E 前必须先 `npm run build`**。

### 5.0 P3-1..P3-10 → M0–M3 映射表

| Phase2 批次 | 内容 | 归入 | 说明 |
|---|---|---|---|
| P3-1 | `<title>` + 空 favicon | **M0** | 零 E2E 断言 |
| P3-2 | 侧栏品牌位 DOM + 删 `.brand-mark` | **M2** | 结构 + a11y，需 DOM 回归 |
| P3-3 | 900px 规则替换 + 预置 icon 分支 | **M2** | 与品牌位 DOM 同批 |
| P3-4 | 新增 `--brand-*` / `--border-control` / 字重 / tabular-nums / 1.6→1.5 / lab-theme G | **M0**（新增 token）+ **M1**（机械替换） | 拆两批，M0 只做零风险新增 |
| P3-5 | `--faint` / `--placeholder` 21 处修正 | **M1** | 不改 token 值 |
| P3-6 | `--accent` 填充 3 处 + hover 阴影 3 处 | **M1** | 不改 token 值 |
| P3-7 | a11y 属性 + 全局 reduce + scroll-padding + T 键守卫 | **M2** | 仅加属性 / 加规则 |
| P3-8 | `ui-field` 标签关联 / instance-row 键盘 / 弹层焦点陷阱 | **M2** | 中风险，需回归弹层 E2E |
| P3-9 | `↗` 三处 / `.empty-icon` / `.plate` | **M2** | 低 |
| P3-10 | 字体 woff2 + 2 条 `@font-face` + 截图实测 | **M0**（声明 + 转换）+ **M2**（截图回归） | 文件落地属 M0 动作，需回归截图 |
| Phase2 §8.2 | 冻结包资产 / favicon / 3 处接入 / ≤900 icon / 手册同步 | **M3** | 必须等 LOGO 冻结 |

> **v1.1 冲突表 M/N 归属**：§8 共 **15 项**（v1.0 13 项 + M/N；早期「12 项」为笔误），全部「本轮不执行」、逐项评审。其中 **M（3 处 `--accent` 白字填充 → `--primary`）与 N（21 处 `--faint`/`--placeholder` 文本引用迁移）是「Phase 3 立即项」，与 LOGO 冻结解耦**（Phase2 §8.3 / §8.5）——本方案已分别并入 **M1-d（对应 P3-6）** 与 **M1-e（对应 P3-5）**，**不新开任务、不新开阶段**。其余 13 项按 §5.1–§5.4 逐项排期。

### 5.1 M0 · 零风险新增（token / 字体 / @font-face / title / 空 favicon）

**范围**：只新增文件与追加声明，**不改任何现有 CSS 规则、不改任何 DOM 结构**。

| # | 文件 + 行号 | 改动前 → 改动后（可复制） |
|---|---|---|
| M0-1 | 新增 `web/src/vis-tokens.css` | 复制 `artifacts/vis/vis-tokens.css` 全文（223 行）。生效 CSS 仅 2 条 `@font-face` + `:root` / `:root[data-theme="dark"]`；接入片段全在注释里 |
| M0-2 | `web/angular.json:29-32` | styles 数组由 2 项扩为 3 项，把 `"src/vis-tokens.css"` **追加到末尾**（完整 diff 见下方；理由见 §8.1） |
| M0-3 | `web/src/index.html:5` | `<title>Model Downloader</title>` → `<title>SiMuseor</title>` |
| M0-4 | `web/src/index.html:7` 之后追加 | 无 → `<link rel="icon" href="data:,">`（**空图标，不含任何字形/月桂**，仅消除 `/favicon.ico` 404；E2E 无 `toHaveTitle` / favicon 断言） |
| M0-5 | 新增 `web/public/fonts/BarlowCondensed-Regular.woff2`、`Inter-Variable.woff2` | 由 `logo-vector/fonts/*.ttf` 转换，命令见 §7.2。**本轮不写入**，文件缺失时 `@font-face` 被忽略/404，正文继续回退系统栈 → 零渲染回归 |

M0-2 完整 diff（可复制）：

```diff
  "styles": [
    "src/tailwind.css",
-   "src/styles.css"
+   "src/styles.css",
+   "src/vis-tokens.css"
  ]
```

**回归范围（E2E）**：全套 `tests/e2e/app.spec.ts`（828 行）应全绿。重点：
- `:7` `test.describe('Model Downloader Web UI')` **不受影响**（测试内字符串，不改）；
- `:36, :71` `.nav > a[href="/models"]`（M0 不动 DOM）；
- `:227` `page.locator('ui-badge').first()` 必须是环境卡徽章（M0 不新增任何 `ui-badge`）；
- `:54, :92` placeholder 文本保持；
- 所有负向断言 `:118/:121/:134/:135/:146/:278/:538-540` 保持 count 0。

**验收**：`vis-check.mjs` §3 零覆盖 PASS；§1.9b「源码引用新增 token 0」在 M0 后变为「token 文件已引入但组件仍未引用」，属预期。

---

### 5.2 M1 · 机械替换（零布局影响、零色值改动）

> **前置**：M0 已引入 `vis-tokens.css`。M1 **不新增/不删除任何 CSS 变量值**，只把字面量与引用换成白名单值 / 合规变量。

#### M1-a 字重白名单（styles.css 17 处，纯字面量）

```diff
- font-weight: 650;   /* :204 .brand-text / :1125 .dev-vendor / :1401 .hero-title  (3 处) */
+ font-weight: 600;
- font-weight: 660;   /* :529 .page-heading h1 (1 处) */
+ font-weight: 600;
- font-weight: 640;   /* :563 .panel-heading h2 / :1134 .dev-gpu (2 处) */
+ font-weight: 600;
- font-weight: 620;   /* :970 .task .title / :1009 .mc-title / :1148 .spec-value / :1437 .metric strong (4 处) */
+ font-weight: 600;
- font-weight: 680;   /* :1385 .ring-label strong (1 处) */
+ font-weight: 600;
- font-weight: 550;   /* :592 button / :629 .field label / :695 .radio-row:has(input:checked) span
                         / :741 .filter-chip.active / :764 .badge (5 处) */
+ font-weight: 500;
- font: 550 12px/1.4 "Cascadia Mono", Consolas, monospace;   /* :1106 .env-value strong */
+ font: 500 12px/1.4 "Cascadia Mono", Consolas, monospace;
```

可复制的批量替换（PowerShell，Windows）：

```powershell
$f = 'E:/Projects/model-downloader/web/src/styles.css'
$t = Get-Content $f -Raw
$t = $t -replace 'font-weight:\s*550', 'font-weight: 500' `
       -replace 'font-weight:\s*620', 'font-weight: 600' `
       -replace 'font-weight:\s*640', 'font-weight: 600' `
       -replace 'font-weight:\s*650', 'font-weight: 600' `
       -replace 'font-weight:\s*660', 'font-weight: 600' `
       -replace 'font-weight:\s*680', 'font-weight: 600' `
       -replace 'font:\s*550 ', 'font: 500 '
Set-Content -Path $f -Value $t -NoNewline -Encoding utf8
```

#### M1-b 6 处圆角（styles.css 5 处中间档收敛 + 1 处 `.modal` token 化）

```diff
- border-radius: 9px;    /* :191 .brand-mark —— 随 M2 删除，此处先收敛 */
+ border-radius: var(--radius-xs);      /* 5px */
- border-radius: 4px;    /* :444 .tp-swatch / :882 .skel-line (2 处) */
+ border-radius: var(--radius-xs);      /* 5px */
- border-radius: 6px;    /* :621 .btn-xs → 8；:1450 .step-row → 5（两处目标不同，逐条改） */
+ border-radius: var(--radius-sm);      /* :621 → 8px */
+ border-radius: var(--radius-xs);      /* :1450 → 5px */
- border-radius: 16px;   /* :909 .modal —— 值不变，只 token 化（第 6 处） */
+ border-radius: var(--radius-lg);      /* 16px，Phase1 §6.4 例外 1 */
```

> 主理人给的 M1 数字为「6 处圆角」；核实 `styles.css` 待收敛中间档为 **5 处**（`:191/:444/:621/:882/:1450`），第 6 处按「`.modal:909` 的 `16px` 改为 `var(--radius-lg)`（数值不变、仅 token 化）」补齐。`lab-theme.ts` 的 3 档归一单列于 M1-g。若主理人的「6 处」另有所指，以裁决为准。

#### M1-c 3 处 hover 阴影 / 位移（含组件 scoped 第 3 处）

```diff
/* web/src/styles.css:958-961 */
- .task:hover {
-   border-color: var(--border-strong);
-   box-shadow: var(--shadow-sm);
- }
+ .task:hover {
+   border-color: var(--border-strong);
+ }

/* web/src/styles.css:718-723（.segmented button.active） */
  .segmented button.active {
    background: var(--panel);
    color: var(--accent);
    font-weight: 600;
-   box-shadow: 0 1px 2px rgb(24 24 27 / 0.08);
  }

/* web/src/app/ui/model-card.component.ts:109-117（组件 scoped，第 3 处） */
  .card:hover,
  .card:focus-within {
-   transform: translateY(-2px);
-   box-shadow: 0 0 0 1px var(--accent), 0 14px 30px -20px rgb(0 0 0 / 0.45);
+   box-shadow: inset 0 0 0 1px var(--accent);
  }
  .card:hover::after,
  .card:focus-within::after {
    box-shadow: inset 0 0 0 1px transparent;
  }
```

> 保留该文件 `:119-123` 已有的 `@media (prefers-reduced-motion: reduce){ transform:none }` 作为全仓降级范本（Phase2 §2.10-13）。hover 只动 `border-color` / `background`。

#### M1-d 3 处 `--accent` 白字填充 → `--primary`

```diff
/* styles.css:737-742 */
  .filter-chip.active {
-   background: var(--accent);
-   border-color: var(--accent);
+   background: var(--primary);
+   border-color: var(--primary);
    color: var(--on-primary);
    font-weight: 500;          /* M1-a 已由 550 归并 */
  }
/* styles.css:743 */
- .filter-chip.active:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-primary); }
+ .filter-chip.active:hover { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
/* styles.css:1469 */
- .step-row.active .step-dot { background: var(--accent); color: var(--on-primary); }
+ .step-row.active .step-dot { background: var(--primary); color: var(--on-primary); }
```

> 依据：深色 `--accent #a5b4fc` + 白字 **1.99:1 FAIL**、`--accent-hover #c7d2fe` **1.49:1 FAIL**；`--primary #4f46e5` + 白字 **6.29:1 PASS** 且双主题一致。`segmented button.active` 用 `--panel` + `--accent` 文字，合规，**保持不改**（visual-architect / ux-designer 均特别叮嘱「别一起改」）。
>
> **`.filter-chip.active:hover` 的取值取舍（对齐 v1.1 M 项「保持 `--primary` 只动 `border-color`」）**：本方案让 hover 与 active **背景、边框、字色完全一致**（`background/border-color` 均 `var(--primary)`），即 hover 不再引入任何新色值。理由：
> - 不能用 `--accent-hover`（1.49:1 FAIL）；
> - 也不能用 `--primary-hover #6366f1`（深色 hover）作白字底 —— 实测 **4.47:1 < 4.5 临界 FAIL**（Phase2 §3.2）；
> - 若确需可见 hover 反馈，唯一安全做法是**只改 `border-color`**（如改为 `var(--accent)` 作装饰描边，不影响白字对比），或保持无变化并靠 `cursor:pointer` + `aria-pressed` + `:focus-visible` 承担可点性 —— Phase2 §2.4 明确「hover 不得作为可点/已选中的唯一提示」。
> 采用「完全一致」的保守版可避免引入任何新的不达标色对；若主理人要求「只动 `border-color`」的字面实现，把 `:743` 的 `border-color` 改为 `var(--accent)`（仅描边、白字仍在 `--primary` 底上，6.29:1 不变）即可。

#### M1-e 21 处 `--faint` 文本引用 + 1 处 placeholder（**不改任何 token 值**）

```diff
/* styles.css 共 21 处 color: var(--faint)，统一： */
- color: var(--faint);
+ color: var(--muted);
/* 行号：:214 .brand-sub / :226 .nav-group / :270 .nav-item em / :380 .theme-toggle em
   / :406 .tp-title / :458 .tp-hint / :462 .tp-hint kbd / :524 .page-kicker
   / :786 th / :1111 .env-state / :1128 .dev-vendor / :1140 .dev-gpu-meta
   / :1153 .spec-sub / :1163 .spec-foot / :1167 .spec-more p / :1211 .inst-count
   / :1294 .inst-sub / :1391 .ring-label span / :1432 .metric span
   / :1465 .step-dot / :1508 .log-line.cmd */
/* styles.css:653 */
- input::placeholder, textarea::placeholder { color: var(--placeholder); }
+ input::placeholder, textarea::placeholder { color: var(--muted); }
```

**保留 / 口径**（Phase1 v1.1 §8-N、Phase2 §3.3 / §7.2 新增验收项）：
- **禁止的是「用 `--faint` / `--placeholder` 这两个色值承载文本」，不是禁止 `::placeholder` 元素**（visual-architect / ux-designer / 主理人三方一致口径）。`::placeholder` **选择器、元素、提示文本三者必须原样保留**（E2E `app.spec.ts:54, :92` 依赖 `如 microsoft/Phi-3-mini-4k-instruct` / `搜索模型关键词，如 qwen / lora / flux`），**只换 `color`**；两个色值降级为 1px 线 / 装饰描边 / track 等非信息图形。
- **placeholder 不得成为唯一标签**：M2 的 P3-8 需补可见 `<label for>` / `id` 或 `aria-label`（3.3.2），`ui-field` 现无 `for`、输入经 `<ng-content>` 投射，属 1.3.1/3.3.2 缺口；补标签时**不得删 placeholder 文本**。
- 非文本装饰引用 `:153 *::-webkit-scrollbar-thumb:hover{background:var(--faint)}`、`:1493 .log-live.paused{background:var(--faint)}` **不改**（脚本实算「全量引用 41，差值 2」即这两处）；
- M2 走查：落在 `--bg #f5f5f6`(4.44:1) / `--panel-3 #f4f4f5`(4.40:1) / `--chip` 上的小字号 `--muted` 文本，按 Phase2 §3.3 升级为 `var(--text-2)`。
- `.brand-sub`（`:214`）随 P3-2 一并把 `letter-spacing:.06em → 0`（中文硬约束）与 `color:var(--faint) → var(--muted)` 落地（Phase1 v1.1 §2.5 已采纳）。

#### M1-f 1.6→1.5 线宽（2 处）+ `tabular-nums` 补齐

```diff
- stroke-width: 1.6;   /* styles.css:250 .nav-item svg / :370 .theme-toggle svg */
+ stroke-width: 1.5;
```

`tabular-nums` 现状已用于 `:744 .chip-count`、`:797 .col-size/.col-count`、`:974 .task .meta`、`:1026 .mc-stats`、`:1151 .spec-value`、`:1211 .inst-count`、`:1306 .inst-port`、`:1388 .ring-label strong`、`:1438 .metric strong` —— **保留并补齐遗漏处**（Phase1 §4.1），本轮不动。

#### M1-g `lab-theme.ts` 归一（裁决 G + 圆角三档）

```diff
/* web/src/app/lab/lab-theme.ts:17-24 */
  borderRadius: {
    none: '0',
-   xs: '3px',
-   sm: '6px',
-   md: '10px',
+   xs: '5px',
+   sm: '8px',
+   md: '12px',
    lg: '12px',      /* 不动：改 md 后 md 与 lg 同为 12px 是既有结构，不动 lg 以免牵动 PrimeNG 组件映射 */
    xl: '16px',      /* 与 components.dialog.root.borderRadius 16px 对齐，保留 */
  },
/* :71 dark primary（裁决 G） */
- color: '{primary.400}',
+ color: '{primary.300}',
  contrastColor: '{primary.950}',   /* 【绝不改白字】lab 是「亮底 + 深字」另一条合法路线，Phase1 §7.3 语义边界 */
  hoverColor: '{primary.300}',
  activeColor: '{primary.200}',
```

> **裁决 G 语义边界（Phase1 v1.1 §7.3 / Phase2 §8.1 P3-4 / §8.5，三方回传重点）**：归一对象**仅**「文字 / 描边 / 图形型 `--accent`」，即 `lab-theme.ts:71` 这一行色值。**两套实心填充路线各自合规、字色相反，绝不可拉齐成同一个白字方案**：
>
> | 路线 | 底色 | 字色 | 实算 | 判定 |
> |---|---|---|---|---|
> | 主 UI `--primary` | `#4f46e5`(600) | `--on-primary #fff` 白字 | **6.29:1** | ✅ 双主题一致，硬约束不得翻亮 |
> | lab 实验区 `dark.primary` | `{primary.400}` `#818cf8` → 归一后 `{primary.300}` `#a5b4fc` | `contrastColor '{primary.950}' #1e1b4b` **深字** | on 400 **5.36:1** / on 300 **8.02:1** | ✅ 独立合规路线 |
> | ⛔ 误改：lab primary 改白字 | indigo 400 / 300 | `#fff` | **2.98:1** / **1.99:1** | ❌ 全部 FAIL（400 连 3:1 都不到） |
>
> 因此：**`:72` 的 `contrastColor: '{primary.950}'` 深字保持不动，绝不改成白字**；`light.primary.contrastColor: '#ffffff'`（`:64`）是合规浅色方案，与本约束无关、保持不动。这条已做成 `vis-check.mjs` **§1.10 正向验收**（5 项全 PASS）+ **§2 对比度表 3 组**（`lab 边界` 分组），并且**脚本 §1.3 只检主 UI 的 `background:var(--accent)` + 白字组合，不对 lab 深字方案报 FAIL**（team-lead 指定口径）。
>
> 登记：`color` 改 300 后与 `hoverColor: '{primary.300}'` 相同；若需区分可把 hoverColor 提到 200，但 Phase1 §7.3 未授权，**不擅自改**，登记为待确认。`focusRing:40-45`（2px solid / offset 2px）与 `styles.css:142` 一致，保留。`components.togglebutton.root.padding:85-87` 实测有效保留；注释里「`selectbutton.root.padding` 无效已删」不要加回。

#### M1-h 组件 scoped 补充批次（§4 的 30 处，请主理人先裁决 `cover-plate`）

按 M1-a / M1-e / M1-b 的同样替换，应用到 §4 表格列出的 `文件:行号`；**`ui/cover-plate.component.ts:128/268/310` 的 3 处圆角先不动**（Phase1 §5.2 / Phase2 §6.2「全部保留原值不改」），`lab/lab-primeng.component.ts:344`(10px) 随 M1-g 归一。

**M1 回归范围（E2E）**：全套 `app.spec.ts`。机械替换不改变任何可访问名 / 选择器 / 文案，理论上 **0 用例受影响**；仍须全量跑一遍确认。特别：
- `:142/:235/:391/:392/:431/:432/:594` 「安装实例」全页唯一（M1 不新增按钮）；
- `:147-149` 「安装」(exact) 与「环境检测」计数和 = 1；`:146` 「重新检测」count 0；
- `:532/:597/:612/:803` `86% / 47% / 45%`、`:529` `734.00 MB`、`:528` `MB/s` 保持可见（M1 只改字重/颜色，不动文本）。

**验收**：`vis-check.mjs` §1.1 / §1.2 / §1.3 / §1.6 的 `styles.css` 命中数应归零；§1.9a 归零。

---

### 5.3 M2 · a11y 属性、reduced-motion 全局化、900px 品牌位、焦点/键盘

#### M2-a 侧栏品牌位 DOM（P3-2）

```diff
/* web/src/app/app.component.ts:25-31 */
  <div class="brand">
-   <span class="brand-mark">MD</span>
-   <span class="brand-text">
-     Model Downloader
-     <small>Local Studio</small>
-   </span>
+   <span class="brand-wordmark" lang="en" aria-label="SiMuseor">SiMuseor</span>
+   <small class="brand-sub">创作工作台</small>
  </div>
```

```diff
/* web/src/styles.css:185-215 —— 删除 .brand-mark / .brand-text / .brand-text small，改为： */
- .brand-mark { ... 30x30 渐变方块 / radius:9px / 700 / box-shadow ... }
- .brand-text { ... font-weight:650; letter-spacing:-0.01em ... }
- .brand-text small { ... letter-spacing:0.06em; text-transform:uppercase; color:var(--faint) }
+ .brand-wordmark {
+   font-family: "Barlow Condensed", "Segoe UI", sans-serif;
+   font-weight: 400; letter-spacing: .028em;
+   font-size: 20px; line-height: 1.1; color: var(--text);
+   min-width: var(--brand-min-width);      /* 120px */
+   white-space: nowrap; flex: none;
+ }
+ .brand-sub {
+   font-size: 10px; font-weight: 500;
+   letter-spacing: 0;                       /* 中文硬约束，主理人裁决采纳附录 A-4 */
+   color: var(--muted);                     /* --faint 2.56:1 不达 AA，附录 A-2 */
+ }
```

`.brand` 容器 `styles.css:179-184`（`display:flex; align-items:center; gap:10px; padding:2px 6px 16px`）**不改**；`.brand` 仍是 `<aside class="sidebar">` 第一个子元素、`<nav class="nav">` 的兄弟节点（E2E `.nav > a[href="/models"]` 是直接子选择器，**不得给 `.nav` 加包裹层**）。

#### M2-b 900px 品牌位（P3-3，替换 `styles.css:1616` 死规则 + 预置 icon 分支）

```diff
/* web/src/styles.css:1615-1616，@media (max-width: 900px) 内 */
  .brand { padding: 0 8px 0 0; gap: 8px; }
- .brand-text { display: none; }
+ .brand-sub { display: none; }                          /* 只隐藏中文副行 */
+ .brand-wordmark {
+   display: inline-block; flex: none;
+   white-space: nowrap; min-width: var(--brand-min-width);   /* 120px */
+ }
+ /* 〔冻·预置〕30x30 icon 分支：占位期以【注释】形式随 P3-3 一起写入文件，
+    规则本身不动布局/颜色/字号体系；冻结时取消注释 + 只填 4 个 URL 变量即可。
+    .brand-wordmark {
+      min-width: 30px; width: 30px; height: 30px;
+      font-size: 0;
+      background-image: var(--brand-icon-light);
+      background-size: contain; background-repeat: no-repeat;
+    }
+    :root[data-theme='dark'] .brand-wordmark {
+      background-image: var(--brand-icon-dark);   /* 必须配深色版资产 */
+    }
+ */
```

> **工程矛盾如实登记（请主理人裁决，见 §10-11）**：占位期 900px 显示**文字字标**（`min-width:120px`），冻结后要变成 **30×30 图标**必须隐藏文字（`font-size:0; width/height:30px`）——这两版是**互斥规则**，物理上「只填 URL」无法把文字态切成图标态（Phase2 §4.4 自身也给了两版互斥 CSS）。本方案把 icon 分支**以注释形式在占位期就预置**（`vis-tokens.css` 的接入片段同样已预置完整版），冻结时：① 取消注释；② 填 `--brand-icon-light/dark`；③ 按实测覆盖 3 个常量。**不新增任何设计决策、不改 DOM、不加第二个 `<img>`**。若主理人选择「冻结后 900px 继续显示文字字标、30×30 图标只用于 favicon」（Phase1 §2.7 侧栏用横版字标），则连注释都不用启用，真正只改 3 处。
>
> 组件 scoped 场景用 `:host-context([data-theme='dark'])`（`cover-plate.component.ts:256-261` 范本）；全局 `styles.css` 用 `:root[data-theme='dark']`（**`:host-context` 在全局样式里无效**）。≤900 的 `.sidebar{overflow:visible}`(`:1613`)、`.theme-pop{...184px}`(`:1628`) 保持不动。

#### M2-c 全局 `prefers-reduced-motion`（P3-7）

追加到 `web/src/styles.css` 末尾（Phase2 §3.8）：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
  /* 降级不能让状态消失 */
  .dot-spin { border-top-color: var(--accent); }   /* 静态环 + role="status" 文字 */
  .skeleton { background: var(--border-soft); animation: none; }
  .progress.indeterminate > div { width: 40%; animation: none; }
}
```

保留 `model-card.component.ts:119-123` 已有 reduce 规则。现状全仓仅 **1 处** reduce（脚本 §1.7 实测）。

#### M2-d 焦点 / 键盘（P3-7 / P3-8）

```diff
/* styles.css:1253 —— outline-offset 统一 2px */
- .instance-row.installing:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
+ .instance-row.installing:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* styles.css 全局滚动容器 —— 2.4.11 Focus Not Obscured */
+ html { scroll-padding-bottom: 80px; scroll-padding-top: 8px; }
/* 控件边界落地 --border-control（值不变，只改引用） */
- input, select, textarea { ... border: 1px solid var(--border); ... }   /* :638 */
+ input, select, textarea { ... border: 1px solid var(--border-control); ... }
- .radio-row { ... border: 1px solid var(--border); ... }                  /* :684 */
+ .radio-row { ... border: 1px solid var(--border-control); ... }
```

```diff
/* app.component.ts:227-235 —— T 键守卫补 WCAG 2.1.4（isComposing / keyCode 229 / repeat / defaultPrevented / 弹层内） */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
+   if (event.defaultPrevented || event.repeat ||
+       event.isComposing || (event as any).keyCode === 229) return;   // 中文拼音输入时按 t 不误切
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 't' && event.key !== 'T') return;
    ...
  }
```

> `:focus-visible:142`（2px 实线 + offset 2px）**是唯一合规焦点指示器**，不得被 `outline:none` 覆盖；`styles.css:644` 的 `input{outline:none}` 由 `:focus-visible` 特异性压过，**不得把 `:focus-visible` 收窄到 `button`**（Phase2 §2.2）。

其余 a11y 属性（P3-7/P3-8/P3-9，逐文件只加属性、不加可访问名）：`app.component.ts:64/78/108-114/124-142`（`aria-controls="theme-pop"` + `id="theme-pop"` + `aria-keyshortcuts="T"` + `[attr.aria-label]` + `.tp-opt` 的 `aria-pressed`）；`ui/field.component.ts`（`<label for>`/`id`，保留 `#comfy-tag`）；`pages/comfy.component.ts:253`（`.instance-row.installing` 加 `role="button" tabindex="0"` + Enter/Space）；`pages/{discover,nodes,workflows}.component.ts`（`↗` 三处包 `<span class="arrow" aria-hidden="true">` + 宿主 `title`）；`ui/empty.component.ts`（`.empty-icon` `aria-hidden`）；`ui/cover-plate.component.ts`（`.plate` `role="img"` + `aria-label`）；页面 `.modal-overlay` 加 `role="dialog" aria-modal="true" aria-labelledby` + 焦点陷阱 + Esc 归还焦点（三者必须一起做）。

**M2 回归范围（E2E，重点）**：

| 用例 | 位置 | 风险 |
|---|---|---|
| `.nav > a[href="/models"]` | `:36, :71` | 品牌位替换**不得**给 `.nav` 加包裹层、不得把品牌位塞进 `.nav` |
| `ui-badge.first()` = 「未安装」 | `:227` | 禁止在环境卡徽章之前插入任何 `ui-badge` / 品牌徽章 |
| 「安装实例」全页唯一 | `:142, :235, :391, :392, :431, :432, :594` | 禁止新增同名按钮；禁止给现有元素加覆盖性 `aria-label` |
| 「安装」/「环境检测」计数和=1、`重新检测` count 0 | `:146-149` | 同上 |
| placeholder 文本 | `:54, :92` | 补 `<label>` 时不得删 placeholder |
| `getByText('★')` / `getByTitle('收藏')` | `:76 / :75` | 给 `★` 加 `aria-hidden` 后 `getByText` 仍通过（`getByText` 不受 aria-hidden 影响） |
| `.instance-row.installing` `.click()` / `toContainText` | `:610 / :605-607` | 加 `role="button" tabindex="0"` 后 `.click()` 仍有效 |
| `.theme-pop` 的 `document:click` 判定 | `app.component.ts:211-216` | 用 `composedPath().some(el => el.classList.contains('appearance'))`，与新增属性无关，人工确认 |
| 负向断言 | `:118/:121/:134/:135/:146/:278/:538-540` | 不得回加任何被断言 count 0 的元素 / 文案 |
| 全套 | 828 行 | 必须全绿 |

**硬禁令**：**禁止新增任何可访问名含「模型 / 模型库 / 安装 / 下载任务 / 设置 / 安装实例」的元素**（Playwright `name` 默认子串匹配，会 strict mode 歧义）；`test.describe('Model Downloader Web UI')` 保留；「下载任务」/`/downloads`/`md-*` 功能名保留。

---

### 5.4 M3 · LOGO 冻结后（**必须等冻结**）

前置：品牌主理人裁定「负形 / 正形月桂」路线 → 用户拍板 → 出冻结包（Phase1 §9.2）。**冻结前一律不得实现**。

| # | 文件 + 行号 | 冻结前 → 冻结后 |
|---|---|---|
| M3-1 **资产** | 新增 `web/public/brand/` | 无 → `simuseor-light.svg` / `simuseor-dark.svg` / `simuseor-mono-light.svg` / `simuseor-mono-dark.svg` / `icon-32.svg` / `icon-64.svg` / `icon-128.svg`（+ PNG，深浅两版） |
| M3-2 **URL 变量 + 3 常量** | `web/src/vis-tokens.css` 的 `:root` | 见下方 diff；**不动布局 / 颜色 token / 字号** |
| M3-3 **favicon + title 同步** | `web/src/index.html:7` + `theme.service.ts:43-48` | `<link rel="icon" href="data:,">` → `<link rel="icon" type="image/svg+xml" href="brand/icon-32.svg">`（+64/PNG 深浅两版）；favicon **无法感知 `data-theme`**，需在 `ThemeService.sync()` 里同步 `link[rel=icon].href`（仍以 `data-theme` 为唯一真源）+ `media="(prefers-color-scheme: dark)"` 无 JS 兜底。`<title>` 在 M0 已是 `SiMuseor`，M3 只复核不回退 |

**冻结前后 diff 示例（只改这 7 行 + 资产 + favicon）**：

```diff
 :root {
-  --brand-logo-light: none;
-  --brand-logo-dark:  none;
-  --brand-icon-light: none;
-  --brand-icon-dark:  none;
-  --brand-clear-space: 10px;          /* 占位近似 */
+  --brand-logo-light: url('/brand/simuseor-light.svg');
+  --brand-logo-dark:  url('/brand/simuseor-dark.svg');
+  --brand-icon-light: url('/brand/icon-32.svg');
+  --brand-icon-dark:  url('/brand/icon-32-dark.svg');
+  --brand-clear-space: 14px;           /* 冻结包实测 X（S cap-height） */
   --brand-min-width:   120px;          /* 若实测不同才改，否则不动 */
   --brand-icon-min:    32px;
 }
```

**接入规则（占位期 M2 已写好，冻结不再改）**：

```css
/* 组件 scoped 样式内（cover-plate.component.ts:256-261 范本） */
.brand-wordmark { background-image: var(--brand-logo-light); }
:host-context([data-theme='dark']) .brand-wordmark {
  background-image: var(--brand-logo-dark);
}
```

**禁止**：`filter: invert()`；第二个手写 `<img>` 实例；把标识放进页头 / 空态 / 弹层 / `app-cover-plate`；`app-cover-plate .brand`（家族标槽，scoped、同名不同物）重命名或注入 `--brand-logo-*`；引用任何 `design-options` / `r2-*` / Cormorant / smallcaps / designkit 实验稿字形。

**M3 回归范围**：全套 E2E（favicon / title 无断言）；重点仍是 `:36/:71`、`:227`、「安装实例」唯一性。另需**人工截图**：≤900px 的 30×30 图标显示 + `--brand-icon-dark` 深色资产存在；字标 `.028em` 与「缩小等效 190px」一致性；深浅主题切换时反白资产正确（不用 filter）。

**冻结后 VIS 手册需同步章节**（Phase1 §9.3）：§2 全节、§3（若另出单色靛紫标）、§5.1（月桂实测值）、§7.2（反白改冻结资产色；**白字硬约束与 lab-theme 深字边界不受影响**）、§8（C/I/K 标完成）、§9 待定项关闭并升版号。

---

## 6. LOGO 冻结后的替换接口约定（3 处具体位置）

| 处 | 具体位置 | 改法 | 约束 |
|---|---|---|---|
| ① 资产文件 | 新建 `web/public/brand/`（由 `angular.json:22-28` assets glob `**/*` → output `/` 自动发布） | 导出 5 类 SVG + 各尺寸 PNG，深浅两版 | 纯路径 SVG、不依赖字体文件；单色稿用 `--brand-ink`/`--brand-ink-reverse`；**暖白非纯白** |
| ② URL 变量（含紧凑图标分支）+ 3 常量 | `web/src/vis-tokens.css` `:root` 内 7 行（见 §5.4 diff） | `none` → `url('/brand/*.svg')`；`--brand-clear-space` 由占位 10px → 实测 X | 只允许 `.brand-wordmark` 单一接入点读取；冻结**不新增第二个 `<img>` 实例** |
| ③ ≤900px 图标分支 | `web/src/styles.css` `@media(max-width:900px)` 内（M2 **以注释形式预置**，见 §5.3 M2-b） | 冻结时**取消该注释块的注释** + 填 `--brand-icon-light/dark`；不新增设计决策、不改 DOM、不加第二个 `<img>`。若主理人裁决「900px 继续显示文字字标、图标只用于 favicon」，则连注释都不用启用 | `30×30` / `font-size:0`；深色资产必备；工程矛盾见 §5.3 M2-b 与 §10-11 |

> 这 3 处即 Phase1 §2.6 / Phase2 §8.2 的「冻结只改 3 处」。**不动布局、不动颜色 token、不动字号**。favicon + `<title>` 是 §2.7 / §8-I 的附加动作（依赖冻结），不改变「3 处」计数口径。

---

## 7. 字体加载与性能

### 7.1 现状与落地缺口（已核实）

- `web/src/**` **全仓 0 条 `@font-face`**（脚本 §1.8）；`web/public/` 只有 `families/ samples/ sources/`，**无字体文件**。
- `logo-vector/fonts/BarlowCondensed.ttf`（102,480 B，Regular 400）、`Inter.ttf`（876,576 B）**存在但只在素材目录**。
- 因此 `styles.css:131` 的 `"Inter", "Segoe UI", "Microsoft YaHei", …` 与字标的 `"Barlow Condensed"` **实际全部回退到 Segoe UI / 微软雅黑**——**Barlow Condensed 基线字体在产品里根本没生效，落地前不得宣称生效**（Phase1 冲突 F / §4.4、Phase2 §0.3-5）。

### 7.2 ttf → woff2 可复现命令（M0 执行，本轮不执行）

环境实测：Node v22.22.2 可用；`.venv` 里 **fonttools / brotli 未安装**（本轮只登记前置）。

```bash
# 前置（一次性）
E:/Projects/model-downloader/.venv/Scripts/python.exe -m pip install "fonttools[woff]" brotli

# ① Barlow Condensed Regular 400 —— 只给 .brand-wordmark / 品牌展示类，子集化到基本拉丁
E:/Projects/model-downloader/.venv/Scripts/python.exe -m fontTools.subset ^
  E:/Projects/model-downloader/logo-vector/fonts/BarlowCondensed.ttf ^
  --output-file=E:/Projects/model-downloader/web/public/fonts/BarlowCondensed-Regular.woff2 ^
  --flavor=woff2 --layout-features="*" ^
  --unicodes="U+0020-007E,U+00A0-00FF" --no-hinting --desubroutinize

# ② Inter 可变 100 900 —— UI 正文；中文继续走系统 fallback，不进子集
E:/Projects/model-downloader/.venv/Scripts/python.exe -m fontTools.subset ^
  E:/Projects/model-downloader/logo-vector/fonts/Inter.ttf ^
  --output-file=E:/Projects/model-downloader/web/public/fonts/Inter-Variable.woff2 ^
  --flavor=woff2 --layout-features="*" ^
  --unicodes="U+0020-007E,U+00A0-00FF,U+2000-206F" --no-hinting

# ③ 验证可变字重轴未丢失（fvar 必须在），否则 100 900 声明会退化为单一字重
E:/Projects/model-downloader/.venv/Scripts/python.exe -c "from fontTools.ttLib import TTFont; f=TTFont(r'E:/Projects/model-downloader/web/public/fonts/Inter-Variable.woff2'); print('fvar kept:', 'fvar' in f)"
```

`pyftsubset` 等价于 `python -m fontTools.subset`；若用 `pyftsubset` 命令需 `.venv/Scripts/` 在 PATH。子集化取舍：
- **方案 A（最小）** `--text='SiMuseor'` 只留 8 字符 → ~2–4 KB，但将来「关于页」品牌大字会缺字回退，**不推荐**；
- **方案 B（推荐）** `--unicodes="U+0020-007E"` 基本拉丁 → ~15–25 KB，兼顾未来品牌展示面；
- 中文**不进 Barlow 子集**（中文走系统字体，品牌字不用于中文）。

### 7.3 `font-display:swap` 与 CLS

- 两条 `@font-face` 均 `font-display: swap`：字体未就绪时用回退字体先渲染（FOUT），避免 FOIT 白屏；`Barlow Condensed` 是窄体，与 `Segoe UI` 字宽差异明显，swap 瞬间会有横向位移。
- **CLS 抑制**（接入片段已内置）：`.brand-wordmark { min-width: 120px; white-space: nowrap; flex: none; }` 把字标容器宽度锁死，字体加载前后不改变兄弟节点布局；位移被限制在容器内部。另可给 `.brand-sub` 固定 `font-size:10px` + `line-height`，避免副行高度跳动。
- 可选（本轮不采用）：`@font-face` 的 `size-adjust` / `ascent-override` 度量覆盖能进一步消除 swap 抖动，但需要逐字体实测校准，登记为后续优化。

### 7.4 只给品牌类声明 Barlow

`@font-face` 是**全局注册**，不等于全量下载——只有 `font-family` 引用该族的元素才触发请求。`vis-tokens.css` 里两条声明：

```css
@font-face { font-family: "Barlow Condensed"; src: url('/fonts/BarlowCondensed-Regular.woff2') format('woff2');
             font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Inter"; src: url('/fonts/Inter-Variable.woff2') format('woff2');
             font-weight: 100 900; font-style: normal; font-display: swap; }
```

- `Barlow Condensed` **仅声明 400**（Phase1 §2.1 锁定基线，禁止 300/500/600/700），只有 `.brand-wordmark` 与品牌展示类引用它；`body`（`styles.css:131`）的字体栈**不含 Barlow**，不会被触发。
- **取舍（需主理人知悉）**：`Inter` 一旦真正落地，`body` 会从系统字体切换到 Inter 实际渲染（因为 `styles.css:131` 首位就是 `"Inter"`），**改变现有正文渲染**，属 P3-10 的「中风险、必须跑截图回归」。若不愿改动现有正文，可把 Inter 注册为独立族名（如 `"Inter VIS"`）只给品牌展示面用；本 token 文件按 Phase1 §4.1「UI 字体栈沿用不改」对齐，保留 `"Inter"`，把取舍留给用户。

### 7.5 是否 preload

| 字体 | 建议 | 理由 |
|---|---|---|
| `BarlowCondensed-Regular.woff2` | **preload**：`<link rel="preload" as="font" type="font/woff2" href="/fonts/BarlowCondensed-Regular.woff2" crossorigin>`（`index.html`） | 字标在侧栏首屏（LCP 区域）、子集后 <25KB；preload 让字体早于 CSS 发现到达，压缩 swap 期 |
| `Inter-Variable.woff2` | **不 preload** | 体积大、正文回退栈已可读、避免抢占首屏带宽；让它随 CSS 发现后加载 |

> preload 必须带 `crossorigin`（即使同源），否则字体会被请求两次。`font-display:swap` 与 preload 不冲突：preload 只提前请求，不改变 swap 行为。

### 7.6 构建产物路径与缓存

- `web/public/fonts/` → `web/angular.json:22-28` 的 `assets: [{ "glob":"**/*", "input":"public", "output":"/" }]` → 产物 `dist/fonts/*.woff2`，URL `/fonts/*.woff2` 与 `@font-face` 的 `src` 一致。
- 生产配置 `angular.json:43` `"outputHashing": "all"` 作用于构建产物；**`public/` 下静态资源是否带哈希取决于 Angular 的 assets 复制策略**，建议在文件名里自带版本（如 `BarlowCondensed-Regular.v1.woff2`）并配 `Cache-Control: public, max-age=31536000, immutable`（需后端 `backend/run.py` 静态路由配合，本轮不改）。
- 文件未落地时 `@font-face` 的 `url()` 会 404：浏览器忽略该声明并回退系统栈，**零渲染回归**；这正是 M0 之前可以安全引入 token 文件的原因。

### 7.7 补齐后必须做的核验

截图实测字标 `.028em` 字距与「缩小等效 190px」一致性（Phase1 §4.4-4、`design-options.png` 实测）；深色主题反白资产；≤900px 的 30×30 图标。补前**不得宣称 Barlow 生效**。

---

## 8. Tailwind v4 与 PrimeNG preset 冲突规避

### 8.1 Tailwind v4（`web/src/tailwind.css`，11 行）

```css
@import "tailwindcss/theme.css";
@import "tailwindcss/utilities.css";
@source "./app/lab";
@theme { --font-mono: "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace; }
```

| 事实 | 规避措施 |
|---|---|
| **不引 preflight**（文件注释已写明：`preflight` 会重置原生元素，把依赖 `styles.css` 元素选择器的页面打乱） | 保持不引；**不要**为 VIS 新增 `@import "tailwindcss/preflight.css"` |
| `angular.json:29-32` 中 `tailwind.css` **排在 `styles.css` 之前**，让 `styles.css:17/:77` 的 `:root` 覆盖 `@theme` 生成的同名 token | 顺序**不得调换**。`vis-tokens.css` 追加到**末尾**（`["tailwind.css","styles.css","vis-tokens.css"]`）：① 不参与覆盖关系（零重名）；② 同特异性后定义者生效，将来上游误写同名 `--brand-*` 时本层胜出；③ `@font-face` 全局注册与顺序无关 |
| `@source "./app/lab"`（`:7`）显式把 lab 实验区纳入 class 提取 | **不要**扩大成 `@source "../**"` 之类全仓扫描：会把产品语义类名也提取进 utilities，增大 CSS 体积并放大同名冲突 |
| `@theme { --font-mono: … }` 生成 `:root` 变量 `--font-mono` | 与 `styles.css` 无同名变量（脚本零覆盖校验 PASS），不冲突 |

**类名前缀的必要性（真实事故记录）**：`styles.css:1361-1362` 的注释明确写着「类名别叫 `ring`：Tailwind 的 `.ring` 工具类会给 svg 加 1px box-shadow 方框，光靠 `width/height/transform` 盖不掉」——项目**已经踩过一次**。因此 lab 实验区与今后所有新增工具类类名必须加 **2–3 字母前缀**（建议 `lab-` 或 `vis-`），并避开下列与 Tailwind utilities / 全局语义类同名的名字：

| 禁用裸类名 | 冲突对象 |
|---|---|
| `.container` | Tailwind 容器类 + `styles.css:176` 的 `.container`（`max-width:1240px`） |
| `.grid` / `.flex` / `.hidden` / `.table` | Tailwind utilities |
| `.ring` | Tailwind `.ring` box-shadow（已事故） |
| `.card` / `.brand` / `.panel` / `.badge` / `.chip` | `styles.css` 全局语义类；`.brand` 另与 `cover-plate.component.ts:62` 的 scoped 家族标槽**同名不同物**，不得重命名、不得互注 `--brand-logo-*` |

### 8.2 PrimeNG Aura preset（`web/src/app/lab/lab-theme.ts`）

| 项 | 现状 | 目标（M1-g） | 依据 |
|---|---|---|---|
| `primitive.borderRadius` `:17-24` | `xs 3 / sm 6 / md 10 / lg 12 / xl 16` | `xs→5 / sm→8 / md→10→12`；**`lg 12` 不动、`xl 16` 不动** | Phase1 §6.4「三档 12/8/5」；`md` 与 `lg` 同为 12px 是既有结构，不动 `lg` 免牵动组件映射 |
| `components.dialog.root.borderRadius` `:89-91` | `16px` | **保留** | Phase1 §6.4 例外 1「弹层比卡片大一号」，与 `--radius-lg:16px` 对齐 |
| `semantic.colorScheme.dark.primary.color` `:71` | `{primary.400}` `#818cf8` | `{primary.300}` `#a5b4fc` | 裁决 G：与 `styles.css:98` dark `--accent` 归一 |
| `semantic.colorScheme.dark.primary.contrastColor` `:72` | `{primary.950}` `#1e1b4b` **深字** | **绝不改白字** | Phase1 §7.3 v1.1 语义边界：lab 是「亮靛紫底 + 深字」另一条合法路线（400 底 5.36:1 / 300 底 8.02:1 ✅；改白字 400 底 2.98:1、300 底 1.99:1 均 FAIL） |
| `semantic.focusRing` `:40-45` | `2px solid / offset 2px` | **保留** | 与 `styles.css:142` 一致 |
| `semantic.primary` 色阶 `:27-39`、`light.primary` `:62-67`、`light.surface` `:48-61` | indigo 50–950 / zinc 0–950 | **保留** | 与 `styles.css:21-48` 已对齐 |

**关键冲突规避（工程结论）**：PrimeNG preset 生成的是自己的 `--p-*` token 体系，**不受全局 `styles.css :root` 影响**。因此新增的 `--brand-*` / `--border-control` / `--radius-lg` **不会自动进入 PrimeNG 组件**；若 lab 实验区要用，必须在 `components` 段显式映射或组件内单独声明。本轮不改 `lab-theme.ts` 任何组件级映射，登记为 lab 实验区的独立边界。另外注释里「`selectbutton.root.padding` 无效已删」不要重新加回（preset 组件名写错会静默失效）。

---

## 9. 自动校验方案与三分类清单

### 9.1 `vis-check.mjs` 设计

| 项 | 内容 |
|---|---|
| 运行 | `node E:/Projects/model-downloader/artifacts/vis/vis-check.mjs`（Node ≥18，零依赖，只读） |
| 不写文件 | 只 `fs.readFileSync` / `readdirSync`，全部输出 stdout；已实际运行验证 |
| 扫描范围 | `web/src/styles.css` + `web/src/app/**/*.ts`（实扫 27 个 .ts）+ `artifacts/vis/vis-tokens.css` |
| 注释处理 | 剥离 `/*…*/` 时把注释内容替换为空格但**保留换行**，保证报告行号与原文件一致 |
| 报告 4 段 | `[0]` 扫描范围 / `[1]` 现状基线 **10 项**（含 v1.1 新增 §1.10） / `[2]` 对比度实算 **26 组** PASS-FAIL 表（含 `lab 边界` 3 组） / `[3]` 零覆盖 + 新增变量清单 + token 文件 10 项自检 / `[4]` SUMMARY |
| 对比度算法 | sRGB → 线性化（`c≤0.04045 ? c/12.92 : ((c+.055)/1.055)^2.4`）→ `L=.2126R+.7152G+.0722B` → `(L1+.05)/(L2+.05)`；与 Phase2 §3.2 手工表独立复算一致 |
| 零覆盖算法 | 剥离注释后取两文件「`--xxx:` 赋值变量名」集合求交集，交集必须为空；并打印新增变量清单与浅/深取值 |
| **§1.10 裁决 G 正向验收**（v1.1 新增） | 单读 `lab-theme.ts`，只取 **dark 块**验证 `contrastColor: '{primary.950}'` 深字保持、未被改成白字；并把 `light.primary.contrastColor: '#ffffff'` 显式判为**合规浅色方案、不判 FAIL**（避免误报）；同时验 dialog 16px / focusRing 2px。**与 §1.3 互补：§1.3 只检主 UI 的 `background:var(--accent)` + `--on-primary` 组合，不对 lab 深字路线报 FAIL** |
| 上游口径打印 | 报告头打印 Phase1 v1.1 (620 行) / Phase2 v1.1 (888 行)、§8 冲突表 **15 项**（v1.0 13 项 + M/N）、M/N 为 Phase 3 立即项与冻结解耦 |
| 退出码 | `0`=全通过 / `1`=仅现状基线 FAIL（预期，M1/M2 待修）/ `2`=交付物校验失败（零覆盖被破坏，必须修）。**先打印完整报告再 `process.exit`** |
| 本次实测 | `EXIT CODE = 1`；交付物校验**全部 PASS**；基线计数与登记**全部吻合**；`ZERO-OVERRIDE: PASS`（39 个现有变量 / 18 个新增 / 0 个重名）；**§1.10 五项全 PASS**；对比度 26 组 PASS 18 / FAIL 7 / INFO 1 |
| 排期用法 | M0/M1/M2 每阶段结束重跑，§1.x 命中数应逐批下降；M3 不改变判定口径 |

> 建议（未来）：Phase2 §8.3 提议把 §7 验收清单的 `CSS`/`DOM` 项做成 `getComputedStyle` 快照测试与 axe 走查，属于 M2 验证手段，本轮不写、不碰 `tests/`。

### 9.2 三分类清单

**A. 可立即落地（不依赖 LOGO 冻结、不碰 E2E 文件）** — P3-1..P3-10 全部

| 批次 | 阶段 | 风险 |
|---|---|---|
| P3-1 `<title>` + `data:,` 空 favicon | M0 | 极低（无 E2E 断言） |
| P3-4 新增 `--brand-*` 六枚 / `--border-control` / `--radius-lg` / 4 URL / 3 常量 / 2 条 `@font-face` | M0 | 极低（零覆盖，脚本已校验） |
| P3-10 字体 woff2 转换 + 补后截图实测 | M0 + M2 | 中（Inter 会改变 body 渲染，必须回归截图） |
| P3-4 字重 17 处 / 圆角 6 处 / 1.6→1.5 / lab-theme 归一 | M1 | 低（纯机械） |
| P3-5 `--faint` 21 处（+ `:653` placeholder） | M1 | 低（不改 token 值） |
| P3-6 `--accent` 填充 3 处 + hover 阴影 3 处 | M1 | 低 |
| §4 组件 scoped 补充 30 处（含 cover-plate 3 处需裁决） | M1-h | 低～需裁决 |
| P3-2 / P3-3 品牌位 DOM + 900px 规则 | M2 | 低（E2E 不引用 `.brand*`） |
| P3-7 / P3-8 / P3-9 a11y 属性 + reduce + 焦点键盘 | M2 | 中（需回归弹层相关 E2E） |

**B. 必须等 LOGO 冻结** — M3

- 冻结包 5 类资产（`simuseor-{light,dark,mono-light,mono-dark}.svg` + `icon-{32,64,128}.svg/png` + 实测 X / 最小宽 / 尺寸 / 色彩稿 HEX）；
- 3 处接口：资产 / `--brand-logo-light·dark` + `--brand-icon-light·dark` 四个 URL 变量 / 3 个常量；
- favicon `data:,` → `brand/icon-32.svg`（+64/PNG 深浅两版）+ `ThemeService.sync()` 同步 href；
- ≤900px 30×30 图标分支（**规则在 M2 已预置，冻结只填 URL**）；
- 分享卡 / 导出（独立排期）；月桂只在冻结字标资产内出现、叶数实测后回写 Phase1 §5.1；
- VIS 手册 §2 全节 / §5.1 / §7.2 / §8（C/I/K 标完成）/ §9 待定项关闭并升版号。

**C. 会碰 E2E**：**0 项文件改动**（本阶段及 M0–M3 均不修改 `tests/` 任何文件）。但需要**回归验证**的用例清单：

| 用例（`tests/e2e/app.spec.ts`） | 触发改动 | 预期 |
|---|---|---|
| `:36, :71` `.nav > a[href="/models"]`（**不是 `/library`**） | M2 品牌位 DOM | 不给 `.nav` 加包裹层 → 仍通过 |
| `:227` `ui-badge.first()` = 「未安装」 | M2 加属性 / 品牌位 | 不在环境卡徽章前插入任何 `ui-badge` → 仍通过 |
| `:142/:235/:391/:392/:431/:432/:594` 「安装实例」全页唯一；`:146-149` 计数和=1；`:146` 「重新检测」count 0 | 全部 | 不新增同名按钮 / 不加覆盖性 `aria-label` |
| `:54, :92` placeholder 文本 | M1/M2 | 补 `<label>` 不删 placeholder |
| `:76` `getByText('★')` / `:75` `getByTitle('收藏')` | P3-9 给 `★` 加 `aria-hidden` | `getByText` 不受 aria-hidden 影响 → 仍通过 |
| `:610` `.instance-row.installing.click()` / `:605-607` | P3-8 加 `role="button" tabindex="0"` | `.click()` 仍有效 |
| `:7` `test.describe('Model Downloader Web UI')` | 全部 | **保留不改**（测试内字符串，非 UI 品牌自称） |
| 负向断言 `:118/:121/:134/:135/:146/:278/:538-540`、5 条负向断言、`data-testid` 清单、可见文本/数据白名单 | 全部 | 零改动，全套 828 行绿 |

**硬禁令**：禁止新增任何可访问名含「模型 / 模型库 / 安装 / 下载任务 / 设置 / 安装实例」的元素（Playwright `name` 默认子串匹配 → strict mode 歧义）；禁止给现有元素加覆盖性 `aria-label`；「下载任务」/`/downloads`/`md-*`/仓库名 `model-downloader` 等功能与工程标识保留不删。

---

## 10. 主理人汇编 VIS 手册时的注意事项

1. **核心承诺是「零覆盖」**：UI 两套 `:root`（`styles.css:17-74 / 77-122`）一个值都不改；`vis-check.mjs` 已自动校验「39 个现有变量 / 18 个新增 / 0 个重名 → PASS」。手册可把这段作为可验收的硬指标。
2. **VIS 是目标态，不是现状；冲突表按 15 项写**：Phase1 §8 **A–N 共 15 项**（`A/A′/B/C/D/E/F/G/H/I/J/K/L/M/N`）——**v1.0 实为 13 项，v1.1 新增 M/N 后 15 项，早期「12 项」为计数笔误**。全部「本轮不执行」、逐项评审；但 **M（3 处 `--accent` 白字填充）/ N（21 处 `--faint` 文本）是「Phase 3 立即项、与 LOGO 冻结解耦」**，已并入 M1 的 P3-6 / P3-5，手册可按「13 项待评审 + 2 项立即项」标注（Phase2 §8.3 / §8.5）。Phase3 同样只产方案 + token + 校验脚本，**零落地**。上游文档按 **Phase1 v1.1 / 620 行、Phase2 v1.1 / 888 行（§7 验收清单 61 条）** 引用。
3. **组件 scoped 30 处新增发现**（§4）请主理人裁决是否纳入 M1-b，尤其 `ui/cover-plate.component.ts:128/268/310` 的 3 处圆角受 Phase1 §5.2 / Phase2 §6.2「保留原值不改」保护，本方案**未擅自纳入收敛**。
4. **`--brand-surface/--brand-fg` 别名方案**（§1 取舍 1）：六枚常量本身不随 `data-theme` 变，反白靠双份 SVG 资产；若主理人期望「六枚在 dark 下各有一个值」，需回话，我可改成直接在 dark 块重赋值，但会与 Phase1 §2.4/§7.2「资产切换而非 CSS 取色」冲突，请裁决。
5. **Inter 落地会改变 `body` 渲染**（§7.4 取舍），需截图回归；**字体文件本轮未写入 `web/public/fonts/`**，手册不得写「Barlow 已生效」。
6. **E2E 实测更正以本阶段核对为准**：`.nav > a[href="/models"]`（`:36/:71`）、`test.describe('Model Downloader Web UI')` 保留、无 `getByRole('模型')` 字面调用但「模型」重名风险仍在、「安装实例」全页唯一、首个 `ui-badge` 是环境卡徽章。
7. **LOGO 冻结只改 3 处**、900px icon 分支在占位期就预置（M2）、favicon 占位 `href="data:,"`（**不含任何字形**）。
8. **对比度硬结论**：`--accent #a5b4fc` + 白字 1.99:1 FAIL → 凡白字实心填充一律 `--primary`（6.29:1）；`--faint/--placeholder` 2.33–3.11:1 禁止承载文本（21 处改引用、不改 token 值）；`--border-control #8b8b94`（浅 3.38 / 深 5.44）**新增不覆盖** `--border`。
9. **两套实心填充分开（v1.1 §7.3 语义边界）**：主 UI = 600 底 + 白字 6.29:1；`lab-theme` dark primary = 亮靛紫底 + `contrastColor:{primary.950}` 深字（on 400 5.36:1 / on 300 8.02:1），**不得改成白字**（白字 on 400 = 2.98:1 / on 300 = 1.99:1 全部 FAIL）。裁决 G 归一对象是「文字/描边型 `--accent`」，只改 `lab-theme.ts:71` 一行色值，`contrastColor` 保持不动。手册可引用 `vis-check.mjs` 的 **§1.10 正向验收（5 项全 PASS）** 与 §2 的 `lab 边界` 3 组实算作为可验收依据；脚本**不对 lab 深字方案报 FAIL**。
10. **校验脚本可复跑**：`node artifacts/vis/vis-check.mjs`，本次 `EXIT CODE = 1`（仅现状基线 FAIL，预期）；退出码 `2` 才代表零覆盖被破坏、必须修复。本次按 v1.1 修订后输出：对比度 **26 组 PASS 18 / FAIL 7 / INFO 1**、零覆盖 PASS、§1.10 全 PASS。FAIL 7 组中第 7 组是 v1.1 新增的「白字 on indigo 400」**禁止组合示例**，不是 lab 现状违规。
11. **N 项措辞要精确**：禁止的是「用 `--faint`/`--placeholder` 两个**色值**承载文本」，**不是禁止 `::placeholder` 元素**——元素、选择器、提示文本必须保留（E2E `:54,:92`），只换 `color`；且 placeholder 不得成为唯一标签，需 M2 补可见 `<label>` / `aria-label`。`.brand-sub` 的 `letter-spacing:0` + `color:var(--muted)` 是 v1.1 已采纳口径。
12. **900px icon 分支的工程矛盾需裁决**（§5.3 M2-b）：「占位期显示文字字标（`min-width:120px`）」与「冻结后显示 30×30 图标」是两条互斥 CSS 规则，严格「只填 URL」无法隐藏文字；Phase2 §4.4 自身也给了两版互斥 CSS。本方案把 icon 分支**以注释形式在 M2 预置**，冻结时取消注释 + 填 URL + 覆盖 3 个常量（不新增设计决策、不改 DOM）；另一可选裁决是「冻结后 900px 继续显示文字字标、30×30 图标只用于 favicon」（Phase1 §2.7 侧栏用横版字标），此时真正只改 3 处。请主理人在汇编手册时明确采用哪一条，以免 Phase1 §2.6「冻结只改 3 处」与 §8-K 出现口径不一致。

---

> **最终声明**：本阶段**未修改** `web/src/`、`tests/`、`web/angular.json`、`web/public/` 下任何文件；未产出 HTML 手册；未引用任何 LOGO 实验稿字形；未宣称基线字体已生效。三个交付物全部位于 `E:/Projects/model-downloader/artifacts/vis/`。VIS 手册由主理人汇编。
