# SiMuseor VIS 手册站 · 左侧导航缺口审计

> 审计日期：2026-11-21　·　审计范围：`artifacts/vis/` 导航结构与 `SiMuseor-VIS.md` 规范正文的覆盖比对
> 性质：只读调研，**未修改任何实现文件**（`shell.js` / `reference/*.html` / `SiMuseor-VIS.md` / `.gitignore` 均未触碰）
> 结论口径：导航项 → 页面 → 页内锚点 三级清单，逐条对规范章节，再对业界标准段

---

## 〇、本轮已处理（2026-11-21 · 报告出稿后立刻修的）

| 缺口 | 处置 |
|---|---|
| **G-16** 家族色 16 / 25 / 9 三口径 | **已修**：真值是 **25 组**（`model-tone.ts` 的 `FAMILY_TONE` / `FAMILY_TONE_DARK` 各 25 条）。以 `color.html` §s-16 为**唯一口径源**（生成器现场统计，改家族即改数字）；`layout.html` 那 16 组实为**节选样张**，已标注「节选 · 全集 25 组见色彩页 §s-16」并回链；`SiMuseor-VIS.md` 三处「9 家族色」已改正 |
| **G-18** 版本号三处漂移 | **已修**：12 个手册页（`vis-reference.html` + `reference/*.html` ×8 + `prototypes/*.html` ×2 + `SiMuseor-VIS.html`）版本标签统一 **v2.10**，meta / 页眉 / 页脚三处同源。**自 v2.10 起，原型页的版本标签由生成器从 `SiMuseor-VIS.md` 标题行自动带入，不再手写**（VIS §3.12） |
| 悬空引用（`_work/build.mjs`） | **已修**：`reference/audit.html` 与 `web/src/app/lab/lab-vis.component.ts` 不再声称本页数值由已不存在的生成器现场解析，改为如实写「一次性快照，真值在产品源码」；`assets/vis.css` 头部注释同步更正 |
| **G-22** 完整规范 `SiMuseor-VIS.html` 在导航外 | **已修（2026-11-21 二次修正）**：单文件版**降级为「单文件合订本」**，**不再作为站点的渲染面呈现**（从总览索引与导航移除）—— 放进章节列表会读成「另一套标准」。站点的唯一渲染面是 **12 个分章页**；**「整份读」由左侧两级导航实现**（一级=章、二级=章内的节，点二级项直链锚点），不再另设一个平级入口。合订本卷首写明「真值是 VIS.md；三者内容同源、版本同号」 |
| **G-01 / G-02 / G-03 / G-04** 补页（应用系统 / 工程落地 / 验收与治理 / 裁决与附录） | **已做**：新增 `reference/application.html`（6 节）、`reference/engineering.html`（4 节）、`reference/acceptance.html`（2 节）、`reference/decisions.html`（4 节），**站点从此覆盖 VIS 全篇**（此前 §7–§10 只存在于单文件合订本里，站点整份读是缺的） |
| **G-24** 页内锚点不可直达 | **已做**：左侧导航改**两级** —— 一级是章（章头可点进章、独立箭头展开），二级是章内的节，点二级项**直链到该节锚点**（现共 12 章 / 58 节，锚点全部核验存在） |
| **G-23** 总览页索引卡缺「背景实验」 | **已作废（不再需要）**：背景实验页已于 2026-11-21 随 v2 单束柔光定稿**退役删除**（VIS §3.12 生命周期口径）—— 候选不再是候选，留着只会让人以为还能改。总览页索引卡与 `shell.js` 的 `P`/`NAV` 已同步移除该页 |
| **原型页手写 → 生成式**（VIS §3.12 新增） | **已做**：`prototypes/cards.html` 改由「类型层 `_types.mjs` / 定义层 `_defs.mjs` / 展示面」三层生成；新工具 `vis-proto.mjs` 管 `build` + `check`（漂移 / 退役 / 野生文件 / 类覆盖四道）；`vis-check.mjs` 新增 [3.6] 段调它，漂移即阻塞。改造前后**结构与像素完全一致** |
| **G-19** 「厂牌」与「标识」易混 | **部分修**：总览页「厂牌」卡补边界声明「第三方模型家族（**非 VIS 品牌层**）」；**左侧导航的标签未改**（改成「厂牌 · 第三方模型家族」会撑破 236px 侧栏，建议留到导航骨架改造时一并做） |
| **G-03 / G-01 / G-02 / G-04** 补页（验收清单 / 应用系统 / 工程落地 / 裁决） | **未做**：需新写 4 个页面，本轮只做审计不写内容 |
| **G-17** 图标描边 1.3px vs 1.5px | **未做**：需在 `icons.html` 标注「本站 1.3px 为现状值 / 规范目标 1.5px」双口径，并登记 §8.3 M1 的 `1.6→1.5` 改造 |

> **本报告其余章节均为审计原始结论，未因上述处置而改写**；表格里的行号与措辞反映的是审计时点（2026-11-21 14:53）的工作树状态。

---

## 一、结论摘要（先看这个）

| 口径 | 覆盖率 | 算式 |
|---|---|---|
| **规范章节被手册页覆盖** | **约 46%** | §0–§10 + 附录 = 12 个顶层单元；完整覆盖 4（§2/§3/§4/§6）+ 部分覆盖 3×0.5（§0/§5/§9）= 5.5 / 12 |
| **业界标准段被覆盖** | **约 47%** | 16 个标准段；完整覆盖 6（标识/色彩/排版/图标/版式/组件）+ 部分覆盖 3×0.5（品牌内核/母题/应用示例）= 7.5 / 16 |

**最大的三个缺口**

1. **整块「怎么落地、怎么验收、谁裁决」无页** —— 规范 §7 应用系统 / §8 工程落地 / §9 验收与治理 / §10 裁决记录（`SiMuseor-VIS.md:612-811`）在手册站 **零页面**。手册站目前只回答"长什么样"，不回答"照着做会怎样""这条怎么验""这条谁拍的"。
2. **唯一一份完整可打印规范 `SiMuseor-VIS.html` 在导航外** —— 该文件 1034 行、覆盖全部 11 章，但 `shell.js` 的 `P` 映射（`shell.js:7-19`）与 `NAV`（`shell.js:44-56`）都没有它，全站 **零入站链接**。读者从手册站出发永远到不了规范正文。
3. **两处会直接导致误用的硬冲突** —— 家族色 **16 / 25 / 9** 三个口径同站并存；图标描边手册站写 **1.3px**、规范写 **1.5px**。详见 G-16、G-17。

---

## 二、现状盘点

### 2.1 导航清单（`artifacts/vis/assets/shell.js`）

`P` 映射（`shell.js:7-19`）与 `NAV` 数组（`shell.js:44-56`）**一一对应，共 11 项**：

| # | NAV 标签 | page key | 目标文件 | 页面内锚点 |
|---|---|---|---|---|
| 1 | 总览 | `overview` | `vis-reference.html` | `s-overview-spec` / `s-overview-proto` |
| 2 | 标识 | `brand` | `reference/brand.html` | `s-51`…`s-55`（5 个） |
| 3 | 厂牌 | `families` | `reference/families.html` | `s-fam-default` / `s-fam-official` / `s-fam-redraw` |
| 4 | 色彩 | `color` | `reference/color.html` | `s-11`…`s-19`（9 个）+ `s-16-1` |
| 5 | 排版 | `typography` | `reference/typography.html` | `s-21`…`s-24`（4 个） |
| 6 | 图标 | `icons` | `reference/icons.html` | `s-icon-grid` / `s-icon-size` |
| 7 | 布局 | `layout` | `reference/layout.html` | `s-41`…`s-46`（6 个） |
| 8 | 组件 | `components` | `reference/components.html` | `s-31`…`s-312`（12 个） |
| 9 | 资产卡片 | `cards` | `prototypes/cards.html` | 无 h2/h3 锚点（纯样张页） |
| 10 | 背景实验 | `backgrounds` | `prototypes/backgrounds.html` | `s-bg-3` / `s-bg-4` |
| 11 | 审计 | `audit` | `reference/audit.html` | `c-diff` / `s-61` |

**结构性观察**：`NAV` 全部为 `type: 'link'` 且**均无 `hash` 字段**，`shell.js:87` 调用 `href(item.page)` 不传锚点 —— 意味着**站点不存在任何锚点级导航**，所有长页（色彩 9 锚点、组件 12 锚点）只能靠滚动抵达。

### 2.2 规范章节清单（`SiMuseor-VIS.md`）

| 章节 | 行号 | 手册页对应 | 覆盖状态 |
|---|---|---|---|
| §0 现状审计与冲突裁决 | 18-52 | `reference/audit.html` | **部分**（audit.html 是 14 行"规范 vs 实现"差异表，非 15 项冲突裁决表） |
| §1 品牌内核 | 55-88 | — | **无**（命名定位 / 调性判据 / 五条原则 / Do-Don't） |
| §2 标识系统 | 90-269 | `reference/brand.html` | 完整 |
| §3 色彩系统 | 271-559 | `reference/color.html` | 完整 |
| §4 字体系统 | 561-587 | `reference/typography.html` | 完整 |
| §5 图形与意象 | 590-597 | 散落 brand / layout / icons | **部分**（无专页，母题与 ↗ 入口仅存 md） |
| §6 版式与空间 | 601-608 | `reference/layout.html` | 完整 |
| §7 应用系统 | 612-661 | — | **无** |
| §8 工程落地 | 665-716 | — | **无** |
| §9 验收与治理 | 720-764 | `reference/audit.html`（部分） | **部分**（无 62→78 条验收清单） |
| §10 主理人裁决记录 | 768-778 | — | **无** |
| 附录 A/B/C | 782-811 | — | **无** |

### 2.3 业界标准段基准（2026 年公开来源）

| 标准段 | 来源依据 | 本手册站 |
|---|---|---|
| 品牌内核 / 概览 | billionideas §1「Brand at a glance」 | 部分 |
| 标识系统 + 使用规则 | 全部来源共有的第 1 大段 | ✅ |
| 色彩（含 Pantone/CMYK） | guidelines.online §3、advent §2 | ✅（`color.html` `s-18` 已有 Pantone/红点） |
| 字体 | 全部来源共有 | ✅ |
| 影像 / 摄影风格 | guidelines.online §5、skydesigner §5、designerbox §6 | ❌ |
| 图标 | designerbox §7、skydesigner §5 | ✅ |
| 版式与栅格 | designerbox §9 | ✅ |
| 动效语言 | ryzedesigns（VI 核心构成之一）、cometbid「foundations 含 motion」、charmotion | ❌ |
| 图形元素 / 母题 | designerbox §8、krushnapalwe | 部分 |
| 语气与文案 | guidelines.online §6、daasign §5 | ❌ |
| 组件 | docsio §2 | ✅ |
| 模式 / 页面模板 | docsio §3、daasign §4 | ❌ |
| 无障碍标准 | daasign §6、cometbid §3 | ❌ |
| 治理 / 版本 / 变更日志 | docsio §4、daasign §7-8、ramotion §6 | ❌ |
| 资源与素材下载 | guidelines.online §8、designerbox §12 | ❌ |
| 真实场景应用示例 | guidelines.online §7、digifies「rules without mockups get misread」 | 部分 |

**主要来源 URL**
- https://www.guidelines.online/blog/brand-guidelines-template.html （8 段：Brand Overview / Logo / Color / Typography / Imagery / Voice & Tone / Applications / Resources & Assets）
- https://academy.billionideas.co/tutorial/brand-guidelines-document-template （10 段结构）
- https://designerbox.ai/blog/brand-guidelines-template （12 段）
- https://www.skydesigner.me/blogs/brand-guidelines-template （8 段）
- https://docsio.co/blog/design-system-documentation （2026 指南：foundations → components → patterns → contribution）
- https://cometbid.org/blog-video/mastering-design-system-documentation （三层：foundations 含 color/typography/spacing/elevation/motion → components → patterns）
- https://www.daasign.io/answers/what-should-be-included-in-design-system-documentation （8 层，含无障碍与治理）
- https://ryzedesigns.com/blog/visual-identity-design （VI 构成含 Motion and animation）
- https://charmotion.app/guides/brand-motion-guidelines （动效手册章节：Principles/Tokens/Logo/Loops/Accessibility/Files）
- https://www.joseph-studio.com/blog/vi-design-guide （VI 基本系统 vs 应用系统对照）

---

## 三、缺口表

> 类别：① 规范里有、手册站无页　② 业界有、我们完全没有　③ 手册站有但与规范章节错位/重复　④ 导航可达性问题

### P0 —— 必须补，缺失会导致误用

| # | 缺口内容 | 类别 | 证据 | 影响 | 建议 | 优先级 |
|---|---|---|---|---|---|---|
| G-16 | **家族色 16 / 25 / 9 三口径冲突**：色彩页说 25 组，布局页说 16 组，规范说 9 家族色 | ③ | `reference/color.html:1030`「家族色 · 25 组」、`color.html:1370`「家族色 25 组 / 任务色 12 组」／`reference/layout.html:275`「5 组纹样 × **16** 组家族色」、`layout.html:343`「**16** 组家族色」／`SiMuseor-VIS.md:594`「9 家族色」、`SiMuseor-VIS.md:607`「5 构图 / 9 家族色」／`VIS-ASSET-SYSTEM.md:17` 已自认「家族色有 3 个口径（16 / 25 / 9）」 | 开发者按不同页取到不同数量的色板；按 16 组实现会在第 17–25 组上无据可依，按 9 组实现会丢 16–25 组。**这是最容易导致实装取错色的一条** | **合并进现有页**：以 `color.html` `s-16` 为唯一口径源（25 组），删除 `layout.html` 的重复色板改为链接到 `color.html#s-16`；同时回改 `SiMuseor-VIS.md:594/607` 的「9」 | P0 |
| G-17 | **图标描边 1.3px vs 1.5px 冲突**：手册站全站用 1.3，规范 §5 规定主线宽 1.5（现状 1.6） | ③ | `reference/icons.html:28`「1.3px 描边」＋ 17 枚图标全部 `stroke-width="1.3"`（`icons.html:34-50`）／`SiMuseor-VIS.md:595`「主线宽 **1.5px**（现状 1.6）」／`assets/shell.js:41` 图标模板同样写死 `stroke-width="1.3"` | 照手册站实现的图标比规范细 0.2px，与 §8.3 M1 批次「`1.6→1.5` 线宽」直接打架；视觉一致性无法判定合格 | **只改口径不改实现**：在 `icons.html` 明确标注「本站 1.3px 为现状值 / 规范目标 1.5px」，并把 §8.3 M1 的 1.6→1.5 改造一并列入待办；不要让读者以为 1.3 就是规范 | P0 |
| G-22 | **完整规范手册 `SiMuseor-VIS.html` 在导航外，全站零入站链接** | ④ | `SiMuseor-VIS.html` 共 1034 行、含 §0–§10 全部章节；但 `shell.js:7-19` 的 `P` 映射与 `shell.js:44-56` 的 `NAV` 均无该文件；`vis-reference.html:39-54` 的索引卡也只有 9 张（8 规范页 + 1 原型页），无此入口；全仓 grep `SiMuseor-VIS` 仅命中该文件自身的 `<code>` 文本引用 | 手册站读者无法抵达规范正文；规范 §7/§8/§9/§10 的内容对站点读者等于不存在。**这是最大的可达性缺口** | **只在导航加一条**：NAV 增「完整规范」→ `SiMuseor-VIS.html`（同时补 `P` 映射与总览页索引卡） | P0 |
| G-03 | **§9.1 验收清单（62 条正式口径 + 蝉形 63–78 条）无页** | ① | `SiMuseor-VIS.md:722-760`（§9.1，含〔目〕〔冻〕标记与 CSS/DOM/E2E/A11Y/人工 校验方式）／`reference/audit.html` 仅 14 行差异表（`audit.html:31-133`），**不含**验收清单 | 无人知道"什么算做完"；E2E 保护清单（§7.6）与 78 条验收项无处可查，落地时靠猜 | **补页**：`reference/acceptance.html`，按 §9.1 原样搬 62 + 16 条并保留〔目〕〔冻〕标记与校验方式列 | P0 |
| G-01 | **§7 应用系统整章无页**（7.1 品牌落位 10 处 / 7.2 状态机与可程序读出 / 7.3 无障碍 / 7.4 响应式 / 7.5 文案与命名 / 7.6 E2E 保护清单） | ① | `SiMuseor-VIS.md:612-661`／站点侧：`components.html` 只画了组件外观态，**没有** §7.2 的"状态不得只靠颜色表达"规则、§7.3 的 ARIA 契约、§7.4 的三断点行为表、§7.6 的禁新增可访问名清单 | 这是 §7 与业界 accessibility / patterns 两段的共同落点。缺它：读者不知道焦点环只能用 `:focus-visible` 2px、不知道弹层要 `aria-modal` + 焦点陷阱 + 焦点归还三件套、不知道**禁止新增可访问名含「模型/安装/下载任务/设置」的元素**（这条一旦踩中会直接打挂 E2E） | **补页**：`reference/application.html`（§7 全章），无障碍可作为独立二级节 | P0 |

### P1 —— 该补

| # | 缺口内容 | 类别 | 证据 | 影响 | 建议 | 优先级 |
|---|---|---|---|---|---|---|
| G-24 | **页内章节无锚点级导航**：NAV 全部为页级链接，色彩页 9 个锚点、组件页 12 个锚点不可直达 | ④ | `shell.js:45-55` 全部 `type:'link'` 且无 `hash` 字段；`shell.js:87` `a.href = href(item.page)` 不传锚点；锚点本身齐全（`color.html:44,505,798,836,893,988,1367,1394,1428`；`components.html:33…667`） | 长页只能滚动找内容；"色彩 §3.9 色域约束"这类被反复引用的条目无法分享链接 | **只在导航加锚点**：NAV 项升级为可展开分组（`shell.js` 已支持 `type:'group'` + `items[].hash`），或在长页顶部加"本页目录"锚点条 | P1 |
| G-08 | **§0.2 15 项冲突裁决表无页**（A–N 冲突项与"本轮不执行"裁决） | ① | `SiMuseor-VIS.md:31-51`／`reference/audit.html` 只有"规范 vs 实现"现状差异，**没有** A/A′/B…N 的冲突与裁决列 | 读者只看到差异、看不到裁决理由，容易把"本轮不执行"误读为"可以执行" | **合并进现有页**：作为 `audit.html` 的第二个 `<section>`（与现有差异表并列，保留"本轮不执行"标红） | P1 |
| G-02 | **§8 工程落地无页**（8.1 `vis-tokens.css` 分层 / 8.2 `vis-check.mjs` 实跑报告 / 8.3 M0–M3 四阶段迁移 / 8.4 交付物索引） | ① | `SiMuseor-VIS.md:665-716`／站点零链接（grep `vis-tokens\|vis-check` 在 `reference/*.html` 与 `prototypes/*.html` 中无命中） | 交付物清单与迁移排期只在 md 里；接手开发者不知道 token 文件在哪、校验脚本怎么跑、当前阶段该做什么 | **补页**：`reference/engineering.html`，把 §8.4 交付物表做成可点链接（指向 `vis-tokens.css` / `vis-check.mjs`） | P1 |
| G-04 | **§10 主理人裁决记录（5 项）无页** | ① | `SiMuseor-VIS.md:768-778` | "为什么 M0 只落 Barlow 不落 Inter""为什么 cover-plate 圆角不收敛"这类决定读不到，开发者会反复重提同一问题 | **合并进现有页**：与 §9 验收、附录 C 版本记录合并为「治理」页 | P1 |
| G-06 | **§1 品牌内核无页**（1.1 命名与定位 / 1.2 调性判据 / 1.3 五条设计原则 / 1.4 Do-Don't） | ① | `SiMuseor-VIS.md:55-88`／`reference/brand.html` 标题虽为「BRAND」，内容实为 §2 标识系统（`brand.html:33-109` 五个锚点全是组合标/纸墨/蝉形/favicon/禁用） | **命名错位**：`brand.html` 的 `brand` key 与 "BRAND" 标题会让读者以为这是品牌内核页，实际是标识页；§1 的五条设计原则与 Do-Don't 是所有裁决的判据来源，却不可见 | **补页 + 改名**：新增 `reference/brand-core.html`（§1），同时把 `brand.html` 标签从「标识」保留但补导语指向 §1 | P1 |
| G-07 | **§5 图形与意象无专页**（蝉形 / 月桂改判 / 封面铭牌 / 母题 / ↗ 来源入口） | ① | `SiMuseor-VIS.md:590-597`／站点：蝉形在 `brand.html:68`、封面铭牌在 `layout.html:137`、图标在 `icons.html`，**母题**（1px 发丝线、V 形内腔、菱形单点、刀口断笔）与 **↗ 来源入口**规范仅存在于 md | 母题是"活字、钢印、书籍装帧"统一表述的载体，无页即无载体；↗ 是外链唯一提示却不可见 | **补页**：新增 `reference/graphics.html` 汇总 §5，并给 §5 各项加来自 brand/layout/icons 的回链 | P1 |
| G-12 | **无辅助材料下载入口**（logo/token/图标/字体的可获取路径） | ② | 站点全文无下载链接（grep `download|下载` 在 `reference/*.html`、`prototypes/*.html` 中零命中）；`SiMuseor-VIS.md:705-716` 列出 9 项交付物但站点无出口 | 读者知道"有这套资产"却拿不到文件；这正是 guidelines.online §8「Resources & Assets」与 billionideas「single link with every file」的核心诉求 | **补页**（轻量）：`reference/assets.html`，做交付物清单 + 仓库相对路径 + 取得方式；不做打包下载站 | P1 |
| G-09 | **无动效语言页**（duration / easing / 品牌动效边界） | ② | 业界已成标准段：ryzedesigns 将 "Motion and animation" 列为 VI 核心构成；cometbid 的 foundations 层明确含 motion；charmotion 给出 Principles/Tokens/Logo in motion/Loops/Accessibility/Files 六章——https://ryzedesigns.com/blog/visual-identity-design 、https://cometbid.org/blog-video/mastering-design-system-documentation 、https://charmotion.app/guides/brand-motion-guidelines ／本项目现状：spec §7.3 仅一句 reduced-motion（`SiMuseor-VIS.md:641`），且 §8.2 实测"reduced-motion 仅 1 处"（`SiMuseor-VIS.md:687`）；`_phase2-cicada.md:542` 有整节动效规范但**不在手册站** | 蝉形三帧动效、M1/M2 的过渡时长与缓动曲线全无统一口径；未来任何人写动画都是自由发挥 | **补页**：新增 `reference/motion.html`，**如实写"本版不做品牌动效"** + 现状实测（reduced-motion 1 处）+ 未来 token 命名草案（duration/easing 语义命名）+ `prefers-reduced-motion` 契约。**明确不做**完整动效体系 | P1 |
| G-18 | **版本号三处漂移**：总览页 meta 写 v2.5、页眉页脚写 v2.6；`cards.html` 写 v2.6；`SiMuseor-VIS.html` 标题写 v2.7、页脚写 v2.6；其余 reference 页写 v2.7 | ③ | `vis-reference.html:7`「v2.5」、`vis-reference.html:16/21/28`「v2.6」／`prototypes/cards.html:21`「v2.6」／`SiMuseor-VIS.html:6`「v2.7」对 `SiMuseor-VIS.html:1034`「v2.6」／`SiMuseor-VIS.md:1`「v2.7」 | 读者无法判断哪一页是当前口径；截图归档后版本不可追溯 | **合并进现有页**：统一取 spec 单一版本号，页眉/页脚/meta 三处同源取值 | P1 |
| G-25 | **规范正文与交付物在站点内不可达**（`.md` / `vis-tokens.css` / `vis-check-report.txt` 均无链接） | ④ | `SiMuseor-VIS.md:709-712` 列出交付物；站点 grep `vis-tokens\|vis-check\|\.md` 在所有 reference/prototypes 页零命中 | 读者只能看图，拿不到可执行文件，闭环断在最后一米 | **只在导航加锚点/链接**：在 G-12 资产页统一挂出 | P1 |

### P2 —— 可选

| # | 缺口内容 | 类别 | 证据 | 影响 | 建议 | 优先级 |
|---|---|---|---|---|---|---|
| G-23 | **总览页索引卡缺「背景实验」** —— NAV 有该项但首页索引没有对应卡片 | ④ | `shell.js:54` 有 `backgrounds` 项／`vis-reference.html:52-54` 原型区只有 `cards.html` 一张卡 | 从总览进入的人看不到背景实验，只能靠左侧栏发现 | **只在导航加锚点**：补一张索引卡 | P2 |
| G-19 | **「厂牌」页与「标识」页一级并列易误读**：`families.html` 是第三方模型家族标（Flux / Qwen 等），不是 VIS 品牌层，却与「标识」同级 | ③ | `reference/families.html:26` 标题「FAMILY 厂牌」，`families.html:36-66` 三个锚点为默认字标/官方 SVG/位图重绘／对照 `reference/layout.html:139` 明写「家族色编码的是**模型家族**，不是品牌色 —— §5 明确『SiMuseor 标识不进铭牌』」 | 读者可能把第三方家族标当成 VIS 标识的一部分去复用，违反 §5 | **合并进现有页**：改标签为「厂牌 · 第三方模型家族」，并在页首加一句与 VIS 品牌层的边界声明 | P2 |
| G-20 | **资产卡片原型与组件页卡片章节内容重叠** | ③ | `prototypes/cards.html:67-505`（模型/工作流/节点三型样张）对 `reference/components.html:322-470`（`s-37` 卡片四种态）、`components.html:470-538`（`s-38` 模型卡与模型库卡） | 两页都在画同一批卡片，读者不知道哪页是"最终形态"、哪页是"骨架原型" | **明确边界**：在 `cards.html` 页首声明"本页是**跨页复用骨架**原型，组件级状态见 components.html"，并互相加链接 | P2 |
| G-21 | **图标集页 17 枚 vs shell.js 图标库 16 枚**（`环境` 枚只存在于 icons.html） | ③ | `reference/icons.html:50` 有「环境」图标／`assets/shell.js:22-37` `ICONS` 共 16 个 key（overview…settings），**无** `environment` | 图标页声称提供"图标集"，但其中一枚不能从图标库取到 | **合并进现有页**：或在 icons.html 标注 `环境` 为"产品页图标，尚未进 ICONS 库" | P2 |
| G-13 | **无真实场景应用示例**（把系统套到真实业务场景的样张） | ② | 现有 `cards.html` / `backgrounds.html` 是**产品自身 UI 原型**，非品牌应用场景；guidelines.online §7 / digifies 均要求 Applications 段 | 读者看不到"这套规范落到一个完整页面上是什么样子" | **明确不做**（见下节）或降级为 P2 补一页「典型页面装配」 | P2 |
| G-14 | **无治理与贡献流程页**（如何提改动 / 谁评审 / 版本与废弃策略） | ② | docsio §4「contribution」、daasign §7-8、ramotion §6 均要求；本项目 spec §9/§10/附录C 有等价物但无页 | 长期看手册站会变成无人更新的孤儿文档 | **合并进现有页**：与 G-04「治理」页合并，一页覆盖裁决 + 验收 + 版本 + 贡献 | P2 |
| G-15 | **无跨组件模式页**（表单 / 筛选 / 空状态 / 错误流的组合用法） | ② | docsio §3、daasign §4 把 patterns 单列为设计系统文档第三层；`components.html` 只到单组件层 | 读者能拼单个组件但不知道"表格 + 筛选 + 分页"怎么组合 | **补页**（可选）：`reference/patterns.html`，初期从 §7.2 状态机 + `components.html` `s-39` 空状态扩写 | P2 |
| G-10 | **无影像 / 摄影风格页** | ② | guidelines.online §5、skydesigner §5、designerbox §6 均含 photography／https://www.skydesigner.me/blogs/brand-guidelines-template | 对纯 UI 工具价值低；但封面铭牌构图实际占位 | **明确不做**，改由 `layout.html` `s-46`「卡片背景（自有海报铭牌）」承载（见下节） | P2 |
| G-05 | **附录 A/B/C（LOGO 迭代档案 / 三条教训 / 版本记录）无页** | ① | `SiMuseor-VIS.md:782-811` | 历史资产状态与教训只在 md；新成员看不到"哪些稿已否" | **合并进现有页**：并入 G-04「治理」页的三个子节 | P2 |

---

## 四、建议的新导航结构草案

> 仅为草稿，**未实施**。`shell.js` 已原生支持 `type:'group'` + `items[].hash`（`shell.js:95-121`），可直接承载分组与二级锚点。

```
A. 入门
   ├─ 总览 ........................ vis-reference.html
   ├─ 品牌内核 ..................... reference/brand-core.html   ← 新增（§1）
   └─ 完整规范手册 ................ SiMuseor-VIS.html            ← 新增入口（现有文件，0 成本）

B. 基础系统 · Foundations
   ├─ 标识 ........................ reference/brand.html
   ├─ 图形与母题 .................. reference/graphics.html      ← 新增（§5）
   ├─ 厂牌 · 第三方模型家族 ........ reference/families.html
   ├─ 色彩 ........................ reference/color.html
   ├─ 排版 ........................ reference/typography.html
   ├─ 图标 ........................ reference/icons.html
   ├─ 布局与空间 .................. reference/layout.html
   └─ 动效 ........................ reference/motion.html        ← 新增（§8.3 前的过渡契约）

C. 组件与模式 · Components & Patterns
   ├─ 组件 ........................ reference/components.html
   ├─ 跨组件模式 .................. reference/patterns.html      ← 新增（可选，P2）
   └─ 资产卡片 · 骨架原型 .......... prototypes/cards.html

D. 应用与落地 · Application & Delivery
   ├─ 应用系统 .................... reference/application.html   ← 新增（§7）
   ├─ 工程落地 .................... reference/engineering.html   ← 新增（§8）
   └─ 验收清单 .................... reference/acceptance.html    ← 新增（§9.1）

E. 治理 · Governance
   ├─ 裁决与版本 .................. reference/decisions.html     ← 新增（§10 + 附录 A/B/C）
   ├─ 规范 vs 实现 · 差异审计 ...... reference/audit.html
   └─ 辅助材料 .................... reference/assets.html        ← 新增（交付物 + 下载路径）

F. 实验 · Prototype
   └─ 背景实验 .................... prototypes/backgrounds.html
```

> **本草案已被 2026-11-21 的处置部分推翻**：F 组的「背景实验」页已随 v2 单束柔光定稿**退役删除**（VIS §3.12 生命周期口径）—— 候选不再是候选，留着只会让人以为还能改。F 组今后只放**仍在比选中的**原型，且每个原型都必须在 `_defs.mjs` 注册、标明退役条件；裁决落地即自动退役。

**配套的两处导航机制改动（草案）**

1. **锚点级二级导航**：把 `NAV` 中 `color` / `layout` / `components` 三个长页项升级为 `type:'group'`，`items[].hash` 指向 `color.html#s-11…#s-19`、`layout.html#s-41…#s-46`、`components.html#s-31…#s-312`。
2. **总览页升级为索引 + 速览**：`vis-reference.html` 的 `proto-index` 卡片区补齐背景实验与新增页；同时在页首加一段"一页速览"（定位、五条原则、当前阶段、待拍板两件事），对齐 billionideas §1「Brand at a glance」。

---

## 五、明确不做的内容及理由

| 不做项 | 理由 |
|---|---|
| **模板与物料（templates / 名片 / 印刷 / 社媒版式）** | SiMuseor 是内部开发工具，**无对外物料场景**。且规范 §7.1 明确品牌只在侧栏 `.brand` 与 favicon **两处**落位（`SiMuseor-VIS.md:618-624`），"蝉形与字标都不许进"页头/弹层/卡片/移动端/打印物/关于页 —— 不存在需要模板化的应用面。行业标准模板来自对外品牌（B2C/营销），套到本项目只会产出永远没人用的死页面。 |
| **影像 / 摄影风格（photography）** | 产品是纯 UI 工具，无摄影内容。唯一涉及"图像"的封面铭牌，规范已定性为**产品自己的卡片背景语言，不是第三方素材**（`reference/layout.html:275`），由 `layout.html` `s-46` 承载即可。**降级方案**：把业界 photography 段替换为"封面铭牌构图 5 变体 + 家族色 25 组"的专段。 |
| **声音品牌（sonic branding）** | 无音频场景。 |
| **对外品牌中心 / 营销物料下载** | 同"模板与物料"，无对象。 |
| **组件 API / props 参考表** | 组件是 Angular + PrimeNG 实现，API 归属代码而非 VIS 手册。VIS 站管**视觉**，不管 API；做 API 表会与代码脱节。 |
| **Figma 组件库 / Storybook** | 交付形式已定为 HTML 参考站 + `vis-tokens.css` + `vis-check.mjs`（`SiMuseor-VIS.md:705-716`）。另起一套交付形态属无授权扩项。 |
| **完整动效 token 体系（duration/easing 全套）** | 只做**契约页**（现状实测 + `prefers-reduced-motion` 规则 + 未来语义命名草案），不做完整 motion 设计系统。理由：蝉形三帧动效本轮已裁决"不落地"（`SiMuseor-VIS.md:106`），现状 reduced-motion 仅 1 处（`SiMuseor-VIS.md:687`），没有真实使用面可提炼 token。 |
| **完整品牌手册 PDF / 打印物** | `SiMuseor-VIS.html` 已是可打印版，补 PDF 无增量。 |

---

## 六、总结（≤150 字）

规范章节覆盖率约 46%（12 单元中 4 完整 + 3 部分），业界标准段覆盖率约 47%（16 段中 6 完整 + 3 部分）。站点是一套扎实的"基础系统图示"，但缺了手册的另一半。最大三个缺口：① §7 应用 / §8 工程 / §9 验收 / §10 裁决整块无页，规范只讲"长什么样"不讲"怎么做、怎么验"；② 唯一完整规范 `SiMuseor-VIS.html` 在导航外、零入站链接；③ 家族色 16/25/9 三口径与图标描边 1.3/1.5 两处硬冲突，会直接导致实装取错。

---

*本报告由只读审计生成，未修改任何实现文件。*
