# SiMuseor VIS · Phase 1 基础视觉系统规范

> 阶段：Phase 1（基础系统） / 共 3 阶段　·　编制：视觉设计架构师
> 工作区：`E:/Projects/model-downloader`（Windows）
> 交付物：本文件仅产出规范，**未修改 `web/src/` 下任何文件，未产出 HTML 手册**（手册由主理人汇编）
> 依据：以下资产均逐一打开核实，非照抄摘要。资产路径用 `路径:行号` 或 `选择器` 标注，供 Phase 3 直接定位。
> **版本：v1.1**（Phase 2 对齐修订）。v1.0 → v1.1 变更：① §2.5 `.brand-sub` 中文 `letter-spacing` 由 `.06em` 收敛为 `0`、`color` 由 `--faint` 改 `--muted`；② §3.5 新增两条禁止组合（白字填充、`--faint` 承载文本）；③ §7.2 把「深色 `--primary` 不翻」升级为 **WCAG 对比度硬约束** 并精确化 §7.3 裁决 G 的语义边界；④ §0.2 / §6.5 / §6.6 / §8-E 补登记 `model-card.component.ts:109-117` 第 3 处 hover 违规；⑤ §8 新增 M / N 两行（**A–N 含 A′ 共 15 项**；v1.0 为 13 项，此前对外统称的「12 项」为计数笔误，以 15 项为准）。**全部为口径对齐与使用边界补充，未改任何色值、未推翻 A/B/C 任何裁决、未变更冻结协议。** 对比度数值由本人按 WCAG 2.x 相对亮度公式独立复算，与 Phase 2 §3.2 一致。

> **⚠️ 标识状态警示（贯穿全文）**
> LOGO **仍在迭代**。已锁定的只有「Barlow Condensed Regular 400 / 混合大小写 SiMuseor / 字距 .028em」这一基线。
> `design-options.html` 六方向、`_r2_strip.png` 第二轮八方向、`preview.html`（Cormorant）、`smallcaps.html`、`designkit-artifacts/` 十张提案 **全部是实验稿，均非终稿、均不得写为主标**。
> 本规范第 1/3/4/5/6/7/8 章 **不依赖任何未冻结字形**；只有第 2 章与第 9 章处理标识，并给出占位与安全替换协议。

---

## 0. 现状审计

### 0.1 资产清单（含具体数值与状态）

| # | 路径 | 性质 | 关键数值 / 内容 | 状态判定 |
|---|---|---|---|---|
| 1 | `web/src/styles.css:1-1641` | 全站 token + 组件样式 | 三条约束（`:7-14`）；`:root:17-74` 与 `:root[data-theme="dark"]:77-122` 两套变量；`--sidebar-w:236px`；`.container max-width:1240px`；响应式三断点 `1040/900/860`（`:1589/:1599/:1632`） | **现行代码 / 应继承** |
| 2 | `web/src/app/app.component.ts:25-31` | 侧栏品牌位 | `<span class="brand-mark">MD</span>` + `Model Downloader` + `<small>Local Studio</small>` | **与品牌脱节 / 待替换（冲突 C）** |
| 3 | `web/src/index.html:5` | 文档标题 / 图标 | `<title>Model Downloader</title>`；**全文件无 favicon link** | **旧品牌遗留 / 待替换** |
| 4 | `web/src/app/lab/lab-theme.ts` | PrimeNG Aura preset | indigo `50#eef2ff … 950#1e1b4b`（`:27-39`）；zinc surface `0#ffffff … 950#09090b`（`:48-61`）；focusRing `2px solid`（`:40-45`）；borderRadius `3/6/10/12/16`（`:17-24`）；dialog `16px`（`:89`） | **现行代码 / 与 styles.css 有数值不一致** |
| 5 | `web/src/tailwind.css:1-11` | Tailwind v4 入口 | 仅 `@import theme.css` + `utilities.css`，**不引 preflight**；`@theme --font-mono`；`angular.json:29-31` 中排在 `styles.css` **之前** | **现行代码 / 保留** |
| 6 | `web/src/app/core/theme.service.ts:43-48` | 明暗机制 | `document.documentElement.setAttribute('data-theme', 'light'\|'dark')`；偏好 `light/dark/system`；存储键 `md-theme` | **现行代码 / 第 7 章落地点** |
| 7 | `logo-vector/design-options.html` | **当前最关键一版** | 基准「Barlow Condensed Regular 400 / 混合大小写 / .028em」（`:62`）；六方向 `00/A/B/C/D/E/F`；推荐 **D 负形月桂**、或 **D+A**（`:67-70`）；`--ink:#1b1b1e; --paper:#faf8f3; --line:#e4e0d6; --muted:#7d786e`（`:8`） | **迭代中实验 / 严禁当终稿** |
| 8 | `logo-vector/design-options.png` | 六方向七行留档长图 | 00 基准 / A 断笔 / B 连字 / C 分节 / D 负形月桂 / E 菱点 / F 铭牌细线 | 迭代中实验 |
| 9 | `logo-vector/preview.html` | Cormorant 矢量稿 | 页头自标 `VECTOR IDENTITY / BASELINE / NOT APPROVED`（`:42`）、`状态：字体未达标`（`:45`）；`--ink:#1b1b1e; --paper:#f8f6f1; --line:#dedbd3; --muted:#6d6a64`（`:8`）；反白底 `#15151a` / 反白字 `#f1ede4`；三节：主字标 / 反白稿 / 独立图标（128·64·32） | **已否方向 / 仅留档** |
| 10 | `logo-vector/font-options.html` | 8 款开源字体对比（第一批） | 自述「换了字体文件但没换出差别」；Cormorant Garamond Medium 标「≈ 原稿」 | **已被全否** |
| 11 | `logo-vector/font-options-2.html` | 压缩窄体对比（第二批） | 自述「前两批全被否……方向从一开始就反了」；参照站 CSS 结论「压缩窄体 + 全大写 + 紧字距 + 中等字重 + 大量留白」；Archivo Compressed 75 `wght500 / wdth75 / .024em / 全大写`；并记「全大写后 M 不再是唯一大写，月桂失去视觉锚点」 | **调性依据 / 全大写结论不采纳** |
| 12 | `logo-vector/smallcaps.html` + `smallcaps-400.png` | 小型大写实验 | Barlow Condensed 500 / 400；「这一页仍不放月桂：Barlow Condensed 的 M 内腔实测只有约 196 单位高，硬塞会糊成一团」（`:69`） | **未采纳实验 / 提供度量依据** |
| 13 | `logo-vector/try-mixed-weight.html` | 混合大小写 + 字重梯度 | Barlow Condensed 从 Light 300 → SemiBold 600 | 迭代中实验 |
| 14 | `logo-vector/laurel-study.html` | 月桂重设计 | 「Archivo 压缩体 M 的 V 槽尖端约 y=161、顶部开口宽约 263 单位；Barlow Condensed 的 V 槽只有约 196 单位高」 | **月桂几何依据** |
| 15 | `logo-vector/fonts/` | 25 个 TTF | `BarlowCondensed.ttf`（另有 Light/Medium/SemiBold/Bold）、`Inter.ttf`、Cormorant、Archivo、Oswald… | **仅素材 / 未进 web** |
| 16 | `designkit-artifacts/` 10 张 PNG | 早期提案 | 多为高对比衬线 + 对称月桂环；含「终稿_精修版」「终稿_缪斯月桂版」 | **已被全否（文件名"终稿"不作数）** |
| 17 | `web/src/app/ui/cover-plate.component.ts` | 封面铭牌 | 5 变体 `mo-0..mo-4`（`:328-415`）；9 家族色 `f-*` × 明暗两套（`:494-603`）；11px 单行（`.label 600 11px/1`、`.specs 400 11px/1`、`.chip 10.5px`）；品牌槽 20px（照片上 24px 白底，`:231-282`） | **现行代码 / 图形语言来源** |
| 18 | `web/src/app/core/cover.ts:13-49` | 铭牌原则 | 「官方标只在这个槽位出现，绝不放大做背景」「不许改色、拉伸、加阴影」「深色主题另备反白版 `-dark.svg`，不要用 CSS filter 反转」 | **现行代码 / 升格为标识使用边界** |
| 19 | `logo-vector/design-round2.py`、`_r2_strip.png`、`r2-*.svg/png`（Nov 13 11:11） | **补查发现：第二轮迭代** | 8 行：`00 BASELINE / O1 OPTICAL / W1 EMPHASIS 500 / W2 EMPHASIS 500 / S1 SPARK / M1 DESCENDER / L1 LAUREL / E1 SLANT-CUT`；L1 又回到「M 内正形月桂」，与 D 的负形是不同路线；W1/W2 尝试对 M 加重字重 | **迭代仍在活跃 / 强化"不得冻结"结论** |
| 20 | `web/src/**` 全局 | 字体加载 | **全仓无 `@font-face`**；`web/public/` 只有 `families/ samples/ sources/`，无字体文件 | **落地缺口（见冲突 F）** |

### 0.2 冲突表（现状两侧的具体数值）

| 编号 | 冲突点 | A 侧（品牌稿） | B 侧（产品 UI） | 定位 |
|---|---|---|---|---|
| A | 色彩体系 | 暖纸 `#f8f6f1`（`preview.html:8`）/ `#faf8f3`（`design-options.html:8`）、墨黑 `#1b1b1e`、线 `#dedbd3` / `#e4e0d6` | 中性 zinc `--bg:#f5f5f6` / `--text:#18181b`、靛紫 `--accent:#4f46e5`（`styles.css:21,30,42`） | `preview.html` ↔ `styles.css:17-122` |
| A′ | **品牌稿彼此不一致** | `preview.html` 纸/线/弱字 `#f8f6f1 / #dedbd3 / #6d6a64` | `design-options.html` 纸/线/弱字 `#faf8f3 / #e4e0d6 / #7d786e` | 两份 `:8` |
| B | 字体体系 | 字标 Barlow Condensed **400** / `.028em` / 混合大小写 | `body` Inter / Segoe UI / 微软雅黑（`styles.css:131`）；等宽 Cascadia Mono（`:475-479`） | 品牌稿 ↔ `styles.css:129-138` |
| B′ | 非标准字重 | 400（唯一） | `550 ×6 / 620 ×4 / 640 ×2 / 650 ×3 / 660 ×1 / 680 ×1`（`styles.css:204,529,563,592,629,695,741,764,970,1009,1106,1125,1134,1148,1385,1401,1437`） | `styles.css` 全文 |
| C | 侧栏品牌 | 应为 SiMuseor | `MD` + `Model Downloader` + `Local Studio`（`app.component.ts:26-30`）；`.brand-mark` 30×30 `linear-gradient(150deg,#6366f1,#4338ca)`、`radius:9px`、`font-weight:700`（`styles.css:185-198`）；`<title>Model Downloader</title>`（`index.html:5`） | 3 处 |
| D | 圆角「三档」约束 | 约束声明只有 `12/8/5`（`styles.css:12`） | 实存 `9px`（`.brand-mark`）、`16px`（`.modal:909`）、`6px`（`.btn-xs:621`、`.step-row`）、`4px`（`.tp-swatch:443`、`.skel-line:883`）、`999px` 胶囊；`lab-theme.ts` 另立 `3/6/10/12/16` | 多处 |
| E | 「边框优先于阴影」约束 | 约束声明（`:10-11`） | `.task:hover` 加 `--shadow-sm`（`styles.css:958-961`）；`.segmented button.active` 加 `box-shadow`（`:722`）；**`model-card.component.ts:109-117` `.card:hover/:focus-within` 加 `transform:translateY(-2px)` + `0 14px 30px -20px rgb(0 0 0/.45)` 外阴影**（v1.1 补登记，组件 scoped 样式，Phase 1 初版漏审） | **3 处** |
| F | 字体是否真正生效 | 基线假定 Barlow Condensed 400 | **无 `@font-face`、无字体文件**，实际回退 Segoe UI / 微软雅黑 | `web/src/**`、`web/public/` |
| G | 深色交互主色 | 参照 `lab-theme.ts:71` dark `primary.color = {primary.400} #818cf8` | `styles.css:98` dark `--accent:#a5b4fc`（indigo **300**） | 两文件不一致 |
| H | 参照站「全大写 / 中等字重」 | 用户锁定「混合大小写 / 400」（`design-options.html:62`） | `font-options-2.html` 参照站为全大写 + wght500；`_r2_strip` W1/W2 试过加重 | 需裁决取舍 |

---

## 1. 品牌内核

### 1.1 定位与命名

- **品牌名**：`SiMuseor`（内嵌 `muse` / 缪斯），**唯一对外书写形式**，大小写固定 `S-i-M-u-s-e-o-r`，不写 `SIMUSEOR` / `Simuseor` / `Si Museor`。
- **产品定位**：AIGC 创作工作台 / 模型社区 / 内容创作平台。
- **对外禁止**：`Model Downloader`、`下载器`、`Local Studio` 作为**品牌自称**。仓库名 `model-downloader` 仅作工程标识，不出现在 UI 文案。
- **例外（Phase 2/3 勿误删）**：导航项「下载任务」（`app.component.ts:82`）与路由 `/downloads` 是**功能名**，描述一个任务队列，允许保留；`DISCOVER_PATHS` 里的 `/downloads`、存储键 `md-*` 亦为工程标识，不在更名范围。

### 1.2 调性关键词（可验收，非形容词堆砌）

| 维度 | 取值 | 可验收判据 |
|---|---|---|
| 气质 | 克制收敛、艺术书卷气 | 单屏交互强调色面积 ≤ 5%；无渐变铺底、无发光 |
| 字形密度 | 压缩窄体 + 紧字距 + 大留白 | 字标字距 `.028em`；页面 `.container` 内边距 `26/28px`、上限 `1240px` |
| 层次手段 | 明度与边框，不靠字重与阴影 | 字重只用 4 档；卡片默认无阴影 |
| 意象 | 月桂藏在 M 内、内敛有层次 | 月桂不溢出字身、顶端低于 M 肩线 ≥ 字高 10% |

### 1.3 设计原则（5 条，含「避免什么」）

1. **强调色只给「可点的、当前选中的」**（继承 `styles.css:8-9`）。`--accent` / `--primary` 只允许出现在：激活导航、主按钮、聚焦环、选中态、进度/链接 hover。*避免*：正文、静态图标、普通边框、标题、装饰色块用靛紫。
2. **边框优先于阴影**（继承 `styles.css:10-11`）。分层一律 `1px solid var(--border)`；阴影仅给真正浮起的元素（`.modal-overlay`、`.theme-pop`、`.save-bar`）。*避免*：卡片/面板默认阴影、hover 靠加阴影或位移抬升（现状 `.task:hover`、`.segmented.active`、`model-card.component.ts` 的 `.card:hover` 共 3 处违规，见第 8 章）。
3. **圆角只有三档**（继承 `styles.css:12-13`）：`12 / 8 / 5`，对应 `--radius / --radius-sm / --radius-xs`。*避免*：`6 / 9 / 10` 等中间档、"大一号的随机圆角"。弹层与胶囊是登记过的两类例外（§6.4），不是新档。
4. **层次靠明度与留白，不靠加粗**（回应用户明确反感"单纯加粗"）。字标严格 400；正文只用 `400/500/600/700`。*避免*：Bodoni/Didot 式极端粗细对比细衬线（前两批已被全否）、给标题堆 `620/640/650/660/680` 六级近似字重、把 Medium 500 当"强调"用（`_r2_strip` W1/W2 即为需警惕的试作）。
5. **装饰只做「减」，不做「加」**（来自 `design-options.html` 对 A/D 的评价）。刀口、负形、发丝线、单点优于贴图形、加徽章、加光效。*避免*：对称月桂环、盾形徽章、放射星芒、渐变字、字标投影（早期 designkit 提案全否的原因）。

### 1.4 参照站结论的取舍（明确裁决 H）

`font-options-2.html` 抓到的参照站 CSS 是「压缩窄体 + 全大写 + 紧字距 + 中等字重 + 大留白」。**只采纳三项**：压缩窄体、紧字距、大留白。

- **不采纳「全大写」**：用户锁定的是混合大小写；且 `font-options-2.html` 自述「全大写后 M 不再是唯一大写，月桂失去视觉锚点」——与「月桂藏在 M 内」的核心意象直接冲突。
- **不采纳「中等字重」**：用户锁定 400 且反感加粗；窄体本身的字形密度已提供参照站的"重量感"，不需要 wght 500。
- **不取用 Rules Gothic**（商业字体）；字标字体体系已锁定，**本 VIS 不重开字体选型、不提新字体体系**。

### 1.5 Do / Don't

**Do**：用 1px 线分区；用 `--muted` / `--text-2` 降层级（`--faint` 只作非文本装饰，见 §3.5-9）；用 `tabular-nums` 排数字；用双份资产（light/dark SVG）做反白；把 SiMuseor 只放在品牌槽位；保留大留白。
**Don't**：把 Cormorant / designkit / `design-options` 任一版 / `r2-*` 任一版称为"终稿"或落地为主标；把暖纸色铺进 `--panel`；用 CSS `filter: invert()` 做反白；把标识放大做背景水印；拉伸/改字重/改字距/加阴影/渐变；把「MD」方块或旧称与新字标并置；重新提议字体选型。

---

## 2. 标识系统

### 2.1 已锁定基线（唯一可写入规范的字形事实）

| 项 | 值 | 来源 |
|---|---|---|
| 字体 | Barlow Condensed **Regular 400** | 用户附注；`design-options.html:62`；`fonts/BarlowCondensed.ttf` |
| 字样 | 混合大小写 `SiMuseor` | `design-options.html:62,78` |
| 字距 | `.028em` | `design-options.html:62,78` |
| 字重 | 仅 400（禁止 300/500/600/700） | `design-options.html:63`「不换字体、不调字重」 |
| 交付形态 | 纯路径 SVG，不依赖字体文件 | `preview.html:160`、`design-options.html:464` |

### 2.2 待冻结项（**一律不得预先写死**）

1. 字形手术：`00 / A 断笔 / B 连字 / C 分节 / D 负形月桂 / E 菱点 / F 铭牌细线` 六选一或 `D+A`（`design-options.html:67-70` 仅为"推荐"，非定案）。
2. 第二轮八方向去向：`O1 OPTICAL / W1·W2 EMPHASIS / S1 SPARK / M1 DESCENDER / L1 LAUREL / E1 SLANT-CUT`（`_r2_strip.png`）。注意 **L1 是 M 内正形月桂，与 D 的负形月桂是两条不同路线**，必须由品牌主理人裁定路线后再定叶数。
3. 月桂具体几何：叶数（候选 6 枚 `D` / 8 枚 `preview.html:151`）、咬口深度、枝干弧度、顶端与 M 肩线的距离。
4. 独立图标：是否保留「M 单体 + 月桂」，以及 32/64/128 各尺寸的删减规则。
5. 横版 / 竖版 / 字标 + 副行（中英）组合。
6. 最终色彩稿：纸墨是否微调、是否另出「单色靛紫标」。
7. 安全区与最小尺寸的**实测标定值**（本章给的是占位期约束，冻结后以实测替换）。
8. `smallcaps` 是否采纳（当前倾向：不采纳，维持混合大小写）。

### 2.3 安全区与最小尺寸（占位期约束，冻结后实测复核）

- **安全区单位 X** = 字标大写 `S` 的 cap-height。四周净空 **≥ 1X**；实用近似 **≥ 字标总高的 0.5 倍**。`cover.ts:45` 已用「槽位右侧 10px 间距」满足同类要求。
- **横向字标最小宽度 120px**。依据：`design-options.png` / `.html` 每方向均附「缩小等效 190px」实测；侧栏可用宽 = `236px(--sidebar-w) − 12px×2(.sidebar padding) − 6px×2(.brand padding) − 10px(gap) ≈ 190px`，减 1X 净空后取 120px 为下限。
- **独立图标最小 32px**（`preview.html:137-148` 已出 32px 深/浅两版，且 `:151` 注明「缩到 32px 仍能看出是一枝植物而不是一团点」）。
- **< 20px 只用字首单体、不带月桂**：对应 `cover-plate.component.ts:450-492` 的 15px / 16px 品牌槽。**注意：这些槽位放的是第三方模型家族标，不是 SiMuseor 标识**；SiMuseor 标识不进入封面铭牌。

### 2.4 单色 · 反白 · 禁用示例规范

**单色（品牌层）**
- 浅底：字标 `--brand-ink #1b1b1e`；深底：字标 `--brand-ink-reverse #f1ede4`。
- 允许纯黑 `#000` / 纯白 `#fff` 用于盖章、单色印刷、烫印。
- **不允许**给字标上交互靛紫 `#4f46e5`（品牌层不借交互色），除非冻结时正式另出「单色靛紫标」并登记。

**反白（品牌层）**
- 底 `--brand-paper-reverse #15151a`，字标 `#f1ede4`（**暖白，不是纯白**；`preview.html:76,78`）。
- 反白必须用**独立 SVG 资产 + 明暗切换**实现，参照 `cover-plate.component.ts:256-261` 的 `.logo-light/.logo-dark` 与 `:host-context([data-theme='dark'])`；**禁止 CSS filter 反转**（`cover.ts:43`）。

**禁用示例（逐条可执行）**

| # | 禁用行为 | 原因 / 冲突点 |
|---|---|---|
| 1 | 拉伸、压缩、改变 `.028em` 字距、改 400 字重 | 破坏锁定基线 |
| 2 | 旋转、镜像、斜切 | 字标方向固定 |
| 3 | 投影、发光、渐变、描边、内阴影 | 违反原则 1/5；`.brand-mark` 的 inset 高光即反例（`styles.css:197`） |
| 4 | 压在照片上而不垫白底槽 | `cover.ts:25-26`；参照 `cover-plate.component.ts:265-271` 白底 `rgba(255,255,255,.94)` |
| 5 | 放大做背景水印 / 平铺纹样 / 单独提取月桂做装饰 | `cover.ts:15-16,24`；违反「月桂藏在 M 内」 |
| 6 | < 120px 使用含月桂的完整字标 | §2.3 |
| 7 | 用 `filter: invert()` 代替反白资产 | `cover.ts:43` |
| 8 | 「MD」渐变方块 / `Model Downloader` / `Local Studio` 与字标并置 | 冲突 C |
| 9 | 采用 Cormorant / designkit / `r2-*` 任一稿作为主标 | 均已否或未冻结 |

### 2.5 占位规范（冻结前，Phase 3 可立即落地）

在 `app.component.ts:25-31` 的品牌位，LOGO 冻结前用**纯文字占位**，不引入任何实验稿字形：

```
<div class="brand">
  <span class="brand-wordmark" aria-label="SiMuseor">SiMuseor</span>
  <small class="brand-sub">创作工作台</small>
</div>
```

| 属性 | 占位值 | 对应现有选择器 |
|---|---|---|
| `.brand` | `display:flex; align-items:center; gap:10px; padding:2px 6px 16px` | 沿用 `styles.css:179-184`，不改 |
| `.brand-wordmark` | `font-family: "Barlow Condensed", "Segoe UI", sans-serif; font-weight:400; letter-spacing:.028em; font-size:20px; line-height:1.1; color:var(--text)` | **新增**；不加载字体时自动回退（见冲突 F） |
| `.brand-sub` | `font-size:10px; font-weight:500; letter-spacing:0; color:var(--muted)`；中文不加 `text-transform:uppercase` | 字号/字重沿用 `.brand-text small`（`styles.css:209-215`）；**v1.1 修正**：`.06em` 是旧英文副行 `Local Studio` 的拉丁字距，中文按 §4.1 硬约束必须为 `0`；`--faint` 实测 2.56:1 不达 AA（§3.5-9），改 `--muted`（白底 4.83:1 / 深底 5.44:1）。另按 Phase 2 §1.3 给字标元素补 `lang="en"` |
| 删除 | `.brand-mark`（30×30 渐变方块 / `radius:9px` / `700`）、`Model Downloader`、`Local Studio` | `styles.css:185-198`、`app.component.ts:26` |

> **v1.1 口径确认（回应 Phase 2 §1.3）**：`§4.1 中文 letter-spacing:0` 是硬约束，`.brand-sub` 作为中文副行**必须取 `0`**；`.06em` 只适用于拉丁字标 / 全大写 kicker（§4.3）。此处原值是沿用旧英文副行的疏漏，现予统一，Phase 2 §1.3 的写法正确。

**窄屏（≤900px）**：现状 `styles.css:1616` 是 `.brand-text{display:none}`，即只留 `.brand-mark`。占位期改为 **`.brand-sub{display:none}`、`.brand-wordmark` 保留**（120px 宽度在横条侧栏内可容纳）；冻结后该位换成 **30×30 图标 `<img>` 并保留显示**，且必须配深色版资产。

### 2.6 安全替换协议（冻结时只改 3 处，不动任何布局/颜色/字号 token）

1. **资产**：把冻结稿导出为 `web/public/brand/simuseor-light.svg`、`simuseor-dark.svg`、`simuseor-mono-light.svg`、`simuseor-mono-dark.svg`、`icon-32/64/128.svg`（+ PNG）。
2. **接入点**：全站标识**只允许**通过单一组件/单一类名 `.brand-wordmark` 引入，用两个 URL 变量 `--brand-logo-light` / `--brand-logo-dark`；明暗切换复用 `:host-context([data-theme='dark'])`（`cover-plate.component.ts:256-261`）。禁止第二个地方手写 `<img>`。
3. **常量**：安全区 `X`、最小宽度、图标最小尺寸写成 3 个 CSS 自定义属性，冻结时按实测值覆盖。

> 因此冻结**只影响第 2 章与第 9 章**；第 1/3/4/5/6/7/8 章无任何对未定字形的依赖。这是本规范刻意的结构约束。

### 2.7 与 favicon、侧栏的关系

- **favicon**：用「独立图标」一节（字首单体或冻结图标），**不用 8 字母全字标**（标签页放不下）。规格 `32 / 64 SVG + PNG`，深/浅两版；在 `web/src/index.html` 补 `<link rel="icon" type="image/svg+xml" href="brand/icon-32.svg">` 等（现状**完全缺失**）。
- **侧栏**：横版字标，宽度 ≤ 190px、≥ 120px；`--sidebar-w:236px`（`styles.css:73`）不变。
- **页面 `<title>`**：改为 `SiMuseor`（`index.html:5`）。
- **封面铭牌**：SiMuseor 标识**不进入** `cover-plate`；该处 20px 槽位是第三方模型家族标的指称性使用，遵守 `cover.ts:13-49`，与本标识系统互不干扰。

---

## 3. 色彩系统

### 3.1 【裁决 A】分层双轨，不全站换色

> **结论：保留靛紫为交互色；把墨黑/暖纸收敛为品牌层「纸墨」；产品 UI 的 zinc 中性阶与原样保留。本轮不动任何现有 CSS 变量。**

| 层 | 用途 | 色值来源 | 是否进高频 UI |
|---|---|---|---|
| **品牌层（Brand）** | LOGO 资产、关于页/启动页/分享卡、VIS 手册、品牌落款 | 新增 `--brand-*`，纸墨 | **否** |
| **产品层（UI）** | 全站界面 | `:root` / `:root[data-theme="dark"]` 现有 token，zinc + indigo | 是 |

**理由（4 条，含迁移影响）**
1. **语义不同**：现有靛紫承担的是「可点 / 当前选中」的**功能语义**（`styles.css:8-9` 三条约束第 1 条），不是品牌色。换成墨黑 = 抹掉交互信号，整页失去重点。
2. **并置会脏**：`styles.css:20` 自己写了「带蓝的底会让靛紫主色糊在一起」；暖纸 `#f8f6f1` 带黄调，同样会拉低靛紫纯度。高频密集信息需要**无色偏中性底**。
3. **书卷气不靠底色**：品牌调性由标识、窄体、留白、月桂承载；把整个工作台染成暖纸属于「设计过度」，正是用户反感的。
4. **迁移代价高、收益低**：全站换色要重算 `styles.css` 两套 `:root` 近 60 个 token、`cover-plate` 9 家族色 × 明暗两套（`:494-603`）、`lab-theme.ts` zinc surface 全阶，以及大量 `color-mix(in oklab, …)` 的对比度；且会破坏刚校准好的暗色层级。

**过渡方式**：本轮 **零 CSS 改动**，只登记品牌层新增变量（不覆盖现有 `--*`）。Phase 3 新增 `--brand-*` 六枚即可，无回归风险。
**副裁决**：`--brand-ink:#1b1b1e` 与 UI `--text:#18181b` 明度差 < 2%，视觉等价，**不合并、不互相引用**——品牌层只作资产导出常量，UI 继续用 `--text`。

### 3.2 【裁决 A′】两份品牌稿纸色统一

`preview.html` 用 `#f8f6f1 / #dedbd3 / #6d6a64`，`design-options.html` 用 `#faf8f3 / #e4e0d6 / #7d786e`。**统一取 `preview.html` 一组**（它是页头自标 `BASELINE` 的基准稿，且纸色更沉稳、线与底对比更明确）：`--brand-paper:#f8f6f1`、`--brand-line:#dedbd3`、`--brand-muted:#6d6a64`。`design-options.html` 那组视为**预览页专用底色，非品牌色**，Phase 3 不引入。

### 3.3 完整色板（HEX + CSS 变量）

#### (1) 品牌层 · 纸墨（新增变量，不覆盖现有 token）

| 角色 | 变量 | HEX | 用途 |
|---|---|---|---|
| 纸（浅） | `--brand-paper` | `#f8f6f1` | 品牌展示面底 |
| 墨 | `--brand-ink` | `#1b1b1e` | 字标、品牌文字（浅底） |
| 线 | `--brand-line` | `#dedbd3` | 品牌展示面分隔细线（1px） |
| 弱字 | `--brand-muted` | `#6d6a64` | 品牌展示面辅助文字 |
| 纸（深） | `--brand-paper-reverse` | `#15151a` | 反白底（`preview.html:76`） |
| 墨（反白） | `--brand-ink-reverse` | `#f1ede4` | 反白字标（暖白，非纯白） |

> 品牌层**不设交互色**，不引 `--accent`。

#### (2) 中性阶 zinc（现有 token 已与 `lab-theme.ts:48-61` surface 对齐）

| 阶 | HEX | 浅色映射 | 深色映射对应变量 |
|---|---|---|---|
| 0 | `#ffffff` | `--panel`, `--input-bg`, `--on-primary` | — |
| 50 | `#fafafa` | `--panel-2` | — |
| 100 | `#f4f4f5` | `--panel-3`, `--hover`, `--chip` | — |
| 200 | `#e4e4e7` | `--border` | — |
| 300 | `#d4d4d8` | `--border-strong` | — |
| 400 | `#a1a1aa` | `--faint`, `--placeholder` **⚠ 仅非文本装饰 / 占位符，不得承载文本（§3.5-9）** | — |
| 500 | `#71717a` | `--muted`（小号辅助文本的最低合规档，白底 4.83:1） | — |
| 600 | `#52525b` | — | — |
| 700 | `#3f3f46` | `--text-2` | — |
| 800 | `#27272a` | — | — |
| 900 | `#18181b` | `--text` | — |
| 950 | `#09090b` | — | — |
| 自定义 | `#f5f5f6` / `#ededef` / `#f0f0f1` / `#ececee` | `--bg` / `--bg-deep` / `--border-soft` / `--track` | — |
| 深色专用 | `#0b0b0d` / `#070708` / `#141417` / `#1a1a1e` / `#202025` / `#17171b` / `#1e1e23` / `#26262b` / `#1e1e22` / `#34343a` / `#ededf0` / `#d4d4d8` / `#8b8b94` / `#5f5f68` / `#232329` | — | `--bg / --bg-deep / --panel / --panel-2 / --panel-3 / --input-bg / --hover / --border / --border-soft / --border-strong / --text / --text-2 / --muted / --faint·--placeholder / --track·--chip` |

#### (3) 交互主色 indigo（全阶来自 `lab-theme.ts:27-39`）

| 阶 | HEX | 用途 |
|---|---|---|
| 50 | `#eef2ff` | 浅色 `--accent-soft` |
| 100 | `#e0e7ff` | 备用浅底 |
| 200 | `#c7d2fe` | 浅色 `--accent-line`；**深色 `--accent-hover`** |
| 300 | `#a5b4fc` | **深色 `--accent`** |
| 400 | `#818cf8` | lab-theme dark primary（见裁决 G） |
| 500 | `#6366f1` | 深色 `--primary-hover`；`.brand-mark` 渐变旧值（将删除） |
| 600 | `#4f46e5` | **浅色 `--accent` / `--primary`；深色 `--primary`（不变）** |
| 700 | `#4338ca` | 浅色 `--accent-hover` / `--primary-hover`；深色 `--accent-line` |
| 800 | `#3730a3` | 按压态备用 |
| 900 | `#312e81` | — |
| 950 | `#1e1b4b` | 深色强调文字备用底 |

| 变量 | 浅色 | 深色 | 现位置 |
|---|---|---|---|
| `--accent` | `#4f46e5` | `#a5b4fc` | `styles.css:42 / 98` |
| `--accent-hover` | `#4338ca` | `#c7d2fe` | `:43 / 99` |
| `--accent-soft` | `#eef2ff` | `rgb(79 70 229 / .18)` | `:44 / 100` |
| `--accent-line` | `#c7d2fe` | `#4338ca` | `:45 / 101` |
| `--primary` | `#4f46e5` | `#4f46e5`（**不翻**） | `:46 / 102` |
| `--primary-hover` | `#4338ca` | `#6366f1` | `:47 / 103` |
| `--on-primary` | `#ffffff` | `#ffffff` | `:48 / 104` |
| `--ring` | `0 0 0 3px rgb(79 70 229 / .14)` | `0 0 0 3px rgb(99 102 241 / .28)` | `:70 / 121` |

#### (4) 语义色（浅色用"能压在浅底读清"的深色档，深色用亮色档；一律**不用 500 荧光档**，`styles.css:50`）

| 语义 | 浅色 fg | 浅色 soft | 深色 fg | 深色 soft | 变量 |
|---|---|---|---|---|---|
| 成功 | `#15803d` | `#f0fdf4` | `#4ade80` | `rgb(74 222 128 / .12)` | `--ok / --ok-soft` |
| 警告 | `#b45309` | `#fffbeb` | `#fbbf24` | `rgb(251 191 36 / .12)` | `--warn / --warn-soft` |
| 错误 | `#b91c1c` | `#fef2f2` | `#f87171` | `rgb(248 113 113 / .12)` | `--err / --err-soft` |
| 星标 | `#d97706` | — | `#fbbf24` | — | `--star` |

#### (5) 阴影与遮罩

| 变量 | 浅色 | 深色 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgb(24 24 27 / .04)` | `0 1px 2px rgb(0 0 0 / .4)` |
| `--shadow-md` | `0 14px 36px -16px rgb(24 24 27 / .22), 0 2px 8px -4px rgb(24 24 27 / .08)` | `0 14px 36px -16px rgb(0 0 0 / .7), 0 2px 8px -4px rgb(0 0 0 / .4)` |
| `--shadow-lg` | `0 32px 64px -24px rgb(24 24 27 / .32)` | `0 32px 64px -24px rgb(0 0 0 / .8)` |
| 弹层遮罩 | `rgb(9 9 11 / .52)` + `backdrop-filter: blur(3px) saturate(.9)`（`styles.css:895-896`） | 同 |

### 3.4 使用比例建议（可执行配额）

| 场景 | 中性表面+文字 | 边框/结构线 | 交互强调色 | 语义色 |
|---|---|---|---|---|
| **产品 UI 单屏** | **≥ 85%** | ~10% | **≤ 5%**，且实心靛紫块 **≤ 2 处/屏** | ≤ 3%（仅状态出现时） |
| **品牌展示面** | 暖纸底 ≥ 75% | 线/装饰 ≤ 5% | 墨黑字标与文字 ≤ 20% | 0（语义色不进品牌层） |

### 3.5 禁止组合（逐条）

1. 墨黑字标压在靛紫/交互色底上（品牌层 ink 不进交互色）。
2. `--brand-paper` 用作 `--bg` / `--panel` / `--input-bg`（会打乱 zinc 中性阶）。
3. `--accent` 用于正文、静态图标、普通边框、页面标题（违反原则 1）。
4. 语义色 `500` 档（如 `#22c55e`、`#ef4444`）作前景（`styles.css:50`）。
5. 深色主题下使用浅色 `--accent-soft:#eef2ff` 或浅色语义 soft 实色（过曝）。
6. 靛紫渐变作标识底色（`styles.css:192` 的 `.brand-mark` 将删除）；**全站禁止大面积渐变铺底**（`>10%` 面积）。
7. 语义色用作装饰色 / 家族色编码以外的着色。
8. 品牌暖白 `#f1ede4` 与 UI 冷白 `#ededf0` / `#ffffff` 混用于同一文本块。
9. **以 `--faint` / `--placeholder` 的色值承载任何文本**（v1.1 新增，WCAG 派生；禁止的是**色值**，不是元素）。浅色 `#a1a1aa` on `#ffffff` = **2.56:1**、on `--bg #f5f5f6` = **2.35:1**；深色 `#5f5f68` on `--panel-3 #202025` = **2.57:1**、on `--panel #141417` = **2.91:1**，均 < 4.5:1。这两个色值只允许作：1px 分隔线、装饰性图标描边、禁用角标、进度环 track 等非信息图形，且不得作为识别控件/状态的唯一线索。文本一律改 `--muted`（浅 4.83:1 / 深 5.44:1）或 `--text-2`（浅 10.44:1）。**`::placeholder` 元素本身必须保留**（E2E `app.spec.ts:54,92` 依赖），只把它的 `color` 换成 `--muted`。**只改使用位置，不改任何 token 色值**（守住裁决 A 的零覆盖）。21 处清单见 Phase 2 §3.3。
10. **`--accent` 及其 `hover` / `soft` / `line` 变体作为承载白色文字的实心填充**（v1.1 新增，WCAG 派生）。深色 `--accent #a5b4fc` + 白字 = **1.99:1**、`--accent-hover #c7d2fe` + 白字 = **1.49:1**、indigo 400 `#818cf8` + 白字 = **2.98:1**，全部 FAIL；`--primary #4f46e5` + 白字 = **6.29:1** 且双主题一致。**凡承载白字的实心填充一律用 `--primary`**（见 §7.2 硬约束）。违规三处：`.filter-chip.active`（`styles.css:737`）、`.filter-chip.active:hover`（`:743`）、`.step-row.active .step-dot`（`:1469`）。

---

## 4. 字体系统

### 4.1 【裁决 B】两层角色，绝不混用

| 角色 | 字体栈 | 字重 | 字距 | 使用范围 |
|---|---|---|---|---|
| **品牌展示字** | `"Barlow Condensed", "Segoe UI", sans-serif` | **仅 400** | `.028em` | 字标 `.brand-wordmark`、关于页/启动页/分享卡的品牌级大字 |
| **西文 + 中文正文** | `"Inter", "Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif` | `400/500/600/700` | 见 §4.3 | 全站 UI（**沿用 `styles.css:131`，不改字体栈**） |
| **等宽 / 数字** | `"Cascadia Mono", Consolas, "JetBrains Mono", ui-monospace, monospace` | `400/500/600` | 见 §4.3 | `.mono`（`styles.css:475-479`）、`--font-mono`（`tailwind.css:10`）、所有量化读数 |

- 品牌字 **不用于中文**；中文不套用西文的负字距。
- **中英混排规则**：不显式切换字体（浏览器按 glyph 自动 fallback 到微软雅黑）；同一行内中英共享 `font-size / font-weight / line-height`；`letter-spacing` 的负值只施加于纯拉丁串，含中文的串一律 `letter-spacing: 0`。
- **数字**：所有量化读数必须 `font-variant-numeric: tabular-nums`（现状已用于 `.chip-count:744`、`.col-size/.col-count:797`、`.mc-stats:1026`、`.spec-value:1151`、`.inst-port:1306`、`.ring-label strong:1388`、`.metric strong:1438`、`.inst-count:1211`、`.task .meta:974`）——**本条为强制，保留并补齐遗漏处**。

### 4.2 【裁决 B′】字重白名单：`400 / 500 / 600 / 700`

**理由**：`Segoe UI` / `Microsoft YaHei` 不是可变字体，没有 550/620/660 这些轴；浏览器会就近取整或合成加粗，导致**中英混排时同一 `font-weight` 声明在中西文上粗细不一致**。且 `620/640/650/660/680` 五级在 13px 下肉眼无差别，正是 `styles.css:29` 自己反对的「看起来一样但代码里不同」。

| 现状值 | 规范值 | 涉及选择器（`styles.css` 行号） | 语义 |
|---|---|---|---|
| `400` | **400** | `body`、`.specs`、`.mc-desc` 等 | 正文 / 品牌字 |
| `500` | **500** | `.nav-item:241`、`.nav-sub-item:328`、`.segmented button:713`、`.filter-chip:734` 等 | 次要 / 控件默认 |
| `550` (×6) | **500** | `button:592`、`.field label:629`、`.radio-row span:695`、`.filter-chip.active:741`、`.badge:764`、`font:550 …mono:1106` | 轻微强调 → 归并到 500 |
| `600` (×23) | **600** | 已大量正确使用 | 标题 / 激活 / 强调 |
| `620` (×4) | **600** | `.task .title:970`、`.mc-title:1009`、`.spec-value:1148`、`.metric strong:1437` | 卡片/数据标题 |
| `640` (×2) | **600** | `.panel-heading h2:563`、`.dev-gpu:1134` | 区块标题 |
| `650` (×3) | **600** | `.brand-text:204`（将删除）、`.dev-vendor:1125`、`.hero-title:1401` | 展示标题 |
| `660` (×1) | **600** | `.page-heading h1:529` | 页面主标题 |
| `680` (×1) | **600** | `.ring-label strong:1385`（27px 进度数字） | 大数字 |
| `700` (×2) | **700** | `.brand-mark:195`（将删除）、`.step-dot:1467` | 仅极小角标数字 |

> 归并后全站只剩 4 档；`.brand-mark` 删除后，`700` 仅剩 `.step-dot` 一处。

### 4.3 字号阶梯（px · 字重 · 行高 · 字距）

字距收敛为 **4 档 + 1 个锁定值**：`-0.02em`（大标题）、`-0.01em`（小标题）、`0`（正文/中文）、`+0.09em`（全大写 kicker / 组标签）、品牌字标 `+.028em`（锁定）。
*避免*：再出现 `-0.005em / -0.015em / -0.022em / -0.03em / 0.11em / 0.4px` 这类一位小数微调。

| 级别 | px | 字重 | 行高 | 字距 | 用于 | 现状选择器（旧值 / 旧字重） |
|---|---|---|---|---|---|---|
| DISPLAY（品牌层） | 40 | 400 | 1.1 | `.028em` | 品牌展示面大字（Barlow，仅品牌层） | 品牌稿 `h1: 400 40px Georgia` |
| D1 页面主标题 | **22** | 600 | 1.2 | `-.02em` | `.page-heading h1` | `:526-532`（`660`, `-.022em`） |
| D2 展示标题 | **16** | 600 | 1.35 | `-.01em` | `.hero-title`、`.preview-loading .pl-title` | `:1401`（`650`, `-.015em`） |
| H 面板标题 | **14** | 600 | 1.4 | `-.01em` | `.panel-heading h2`、`.modal-head .mc-title` | `:560-565`（`640`） |
| H3 卡片/条目标题 | **13** | 600 | 1.4 | `0` | `.task .title`、`.mc-title`、`.cell-name`、`.inst-name` | `:968-973`、`:1009`（`620`, `-.005em`） |
| B 正文基准 | **13.5** | 400 | 1.55 | `0` | `body` | `:129-138` |
| B2 正文次级 / 控件 | **12.5** | 500 | 1.5 | `0` | `button`、`input/select/textarea`、`.nav-item`、`.page-hint`、`.cell-name` 表体 | `:591`、`:640`、`:240` |
| L 标签 / 辅助 | **11.5** | 500 | 1.45 | `0` | `.field label`、`.mono`、`.mc-author`、`.log-*`、`.badge` 等 | `:626-632`、`:475-479` |
| C 角标 / kicker | **10** | 600 | 1.4 | `+.09em` + `uppercase` | `.page-kicker`、`.nav-group`、`.tp-title`、`.dev-vendor`、表头 `th` | `:518-525`（`.11em`）、`:220-227`（`.09em`）、`:785-794`（`.08em`） |
| NUM 数据读数 | **15** | 600 | 1.2 | `0` + `tabular-nums` | `.spec-value`、`.ring-label strong`（27px 可保留为独立大数字档） | `:1146-1152`（`620`, `-.015em`） |
| XS 极小 | **9.5** | 500 | 1.3 | `+.02em` | `.nav-item em`、`.step-dot`、`.cell-path` 等 | 允许保留，不鼓励新增 |

> 现状字号集合 `27/22/21/16/15/14.5/14/13.5/13/12.5/12/11.5/11/10.5/10/9.5` 收敛后可归到上表；`14.5 / 12 / 11 / 10.5` 作为相邻级别的辅助值允许存在，但**不再新增中间字号**。

### 4.4 【冲突 F】字体尚未真正加载（Phase 3 必须补）

全仓 `web/src/**` **无 `@font-face`**，`web/public/` 无字体文件；`Inter.ttf` / `BarlowCondensed.ttf` 只在 `logo-vector/fonts/`。即现状「Inter / Barlow Condensed」在缺字体时全部回退到 Segoe UI / 微软雅黑，**字标基线字体在产品里根本没生效**。

Phase 3 补法（不在本轮执行）：
1. 由 `logo-vector/fonts/BarlowCondensed.ttf`（Regular 400）与 `Inter.ttf` 转 `woff2`，放 `web/public/fonts/`。
2. 在 `styles.css` 顶部加两条 `@font-face`，`font-display: swap`，`font-weight` 分别只声明 `400`（Barlow）/ `100 900`（Inter 可变）。
3. **仅对 `.brand-wordmark` 与品牌展示类声明 Barlow**，避免全量加载；正文继续用系统栈，不改变现有渲染。
4. 补齐后用实测截图核验字标 `.028em` 字距与「缩小等效 190px」一致性。

---

## 5. 图形与意象

### 5.1 月桂的使用边界（硬约束，冻结前亦成立）

| 约束 | 具体值 / 判据 | 依据 |
|---|---|---|
| 位置 | **只在字母 M 的 V 形内腔**，不溢出字身 | `preview.html:151`「沿 M 的 V 形内腔从槽底向上生长」；`design-options.html:302`「天然长在字母里、绝无外溢」 |
| 顶端 | **明显低于 M 肩线，距离 ≥ 字高的 10%** | 用户附注；`laurel-study.html` M V 槽度量 |
| 内腔容量 | Barlow Condensed 的 V 槽约 **196 单位高**（Archivo 约 263 / 开口 263 单位），「硬塞会糊成一团」 | `smallcaps.html:69`、`laurel-study.html` lead |
| 叶数 | 冻结前不给死值；候选 6 枚（`D` 两侧各 3，`design-options.html:300`）或 8 枚左右交替（`preview.html:151`）；**冻结后以实测定** | 两稿 |
| 形态 | 单线带弧度枝条、非对称、叶片随内腔变宽而递增；**不做对称徽章 / 月桂环** | `preview.html:151` |
| 尺寸下限 | 独立图标 ≥ 32px 才保留月桂；< 20px 只用字首单体 | §2.3；`preview.html:137-148` |
| 上色 | 与字标同色（单色）；**不得单独给月桂上色、不得渐变** | §2.4 |

**明确禁止**：把月桂从字标里提取出来做独立纹样、平铺背景、水印、loading 图形、family 色编码，或作为「缪斯」意象的通用装饰。`designkit-artifacts/` 的对称月桂环方向已被全否。

### 5.2 封面铭牌语言（继承 `cover-plate` / `cover.ts`，不改其构图）

- **5 种构图**（`mo-0` 出血圆 / `mo-1` 斜纹 / `mo-2` 同心环 / `mo-3` 点阵 / `mo-4` 双光斑，`cover-plate.component.ts:328-415`）：只占上半部、由 `name` 稳定哈希选定、只由 `--plate-mark` 派生；深色下 `:host-context([data-theme='dark']) .motif { opacity:.66 }`（`:419-421`）。
- **9 家族色 × 明暗两套**（`.f-*`，`:494-603`）**保留原值不改**——它们编码的是「模型家族」，不是品牌色，不参与本 VIS 色板裁决。
- **11px 单行内容**：`.label 600 11px/1 mono`、`.specs 400 11px/1 mono`、`.chip 400 10.5px/1.35 mono`；厂牌名已从 40px 降到 11px，不得回升（`cover-plate.component.ts:20-21`）。
- **指称性使用规则升格为 VIS 通用条款**（`cover.ts:13-49`）：标识只在固定槽位出现（20px；照片上 24px 白底 `rgba(255,255,255,.94)`），不改色、不拉伸、不加阴影、不放大做背景、不参与家族色编码、深色用独立反白资产而非 filter。

### 5.3 图标网格与线宽

| 项 | 规范值 | 现有依据 |
|---|---|---|
| 网格 | `viewBox="0 0 16 16"` | `app.component.ts` 全部导航 svg |
| 主线宽 | **1.5px**（16px 图标）；小尺寸状态点 **1.5px** | 现状 `1.6`（`styles.css:250,372`）、`1.5`（`.dot-spin:864`、`.env-mark:1098`）→ 统一 1.5 |
| 强调线宽 | **1.8px**（勾选/箭头 ≤ 24px） / **2.4px**（`cover-plate` 自绘标记 24px） | `.tp-check:436`、`cover-plate.component.ts:88` |
| 端点 | `stroke-linecap: round; stroke-linejoin: round`；`fill: none` | `styles.css:249-252` |
| 进度环 | `stroke-width: 8`（124px 环）| `.ring-track/.ring-value:1364-1371` |

*避免*：同一图标内 `fill` 与 `stroke` 混搭（除 `cover-plate` 自绘标记按 `meta.filled` 二选一）；给图标加投影；用 1px/3px 等与 1.5 不成体系的线宽。

### 5.4 几何母题（可复用清单）

1. **1px 发丝线**：分隔（`--border`）、`C` 分节竖线（x-height 高，`design-options.html:243`）、`F` 铭牌通栏细线（`:411`）。
2. **V 形内腔**：M 的中心负形，月桂的容器。
3. **菱形单点**：`E` 的 `60×60` 菱点（`:357`）、`S1 SPARK`（`_r2_strip`）——只允许作为字标内部单点，不放大。
4. **圆 / 环 / 点阵**：来自 `cover-plate` 的 `mo-0/2/3`，仅用于封面构图，不进 UI 图标体系。
5. **刀口 / 断笔**：`A` 的 10 单位横缝（`:135`）、`E1 SLANT-CUT`；属「减」法。

> 母题来源统一表述为「活字、钢印、书籍装帧与编辑式排版」，**不是**徽章 / 盾形 / 对称月桂环 / 科技光效。

---

## 6. 版式与空间

### 6.1 间距尺度（4px 基准）

| 档 | 值 | 典型用途 |
|---|---|---|
| `space-0.5` | 2px | 图标与文字微调、`gap:1-2px`（`.nav:218`） |
| `space-1` | **4px** | 紧凑控件间隙 |
| `space-1.5` | **6px** | 按钮内 gap、chip gap（`.chip-row:725`） |
| `space-2` | **8px** | `.page-actions`、`.panel-actions`（`:539,:572`） |
| `space-2.5` | **10px** | `.brand` gap、`.nav-item` gap、`button` gap（`:182,:234,:582`） |
| `space-3` | **12px** | `.sidebar` padding、`.spec-grid` gap |
| `space-3.5` | **14px** | `.grid` / `.form-grid` / `.panel margin-bottom` gap（`:498,:505,:547`） |
| `space-4` | **16px** | `.page-header margin-bottom`、`.sidebar padding-top` |
| `space-5` | **20px** | `.panel-head margin-bottom`、`.modal-overlay padding` |
| `space-6` | **24px** | 大区块间隔 |
| `space-8` | **32px** | 控件标准高度（`button:584`、`input:636`） |

*避免*：新增 `5 / 7 / 9 / 11 / 13 / 18 / 22` 等零散值。现状已存在的 `26 / 28 / 18`（`.container padding:176`、`.panel padding:546`）登记为**白名单、保留但不扩散**。

### 6.2 栅格与容器

| 项 | 值 | 定位 |
|---|---|---|
| 侧栏宽 | `--sidebar-w: 236px` | `styles.css:73`；`.sidebar flex:0 0 var(--sidebar-w)`（`:163`） |
| 内容上限 | `.container max-width: 1240px`；`padding: 26px 28px 72px` | `styles.css:176` |
| 窄屏容器 | `padding: 18px 16px 56px` | `styles.css:1629`（`@media 900px`） |
| 卡片网格 | `repeat(auto-fill, minmax(250px, 1fr))`, `gap:14px` | `.grid:502-506` |
| 表单网格 | `repeat(auto-fit, minmax(220px, 1fr))`, `gap:14px` | `.form-grid:495-499` |
| 环境页 | `minmax(0,1fr) 320px`, `gap:14px` | `.env-layout:1049-1054` |
| 设置页 | `3fr 7fr`, `gap:14px` | `.settings-cols:1578-1584` |
| 安装弹层 | `minmax(0,46fr) minmax(0,54fr)`, `gap:18px` | `.install-grid:1340-1346` |
| 响应式断点 | **1040 / 900 / 860px**（`styles.css:1589/:1599/:1632`）；`design-options.html:48` 的 760px 是预览页专用，**不进产品** | — |

### 6.3 层级（z-index）

`cover-plate` 内部 `0/1/2`（photo / scrim / head）· `.save-bar 5`（`:1565`）· `.sidebar 20`（`:161`）· `.theme-pop 40`（`:391`）· `.modal-overlay 100`（`:891`）。**新增浮层不得插入中间值**，按上述层级就近取值。

### 6.4 圆角三档 + 两类登记例外（裁决 D）

| 档 | 值 | 变量 / 用途 |
|---|---|---|
| 大 | **12px** | `--radius`：`.panel`、`.model-card`、`.task`、`.save-bar`、`.theme-pop` |
| 中 | **8px** | `--radius-sm`：`button`、`input`、`nav-item`、`.notice`、`.dev-plate`、`.instance-row`、`.btn` 类 |
| 小 | **5px** | `--radius-xs`：`.chip`、`.badge`(例外见下)、`.nav-item em`、`.inst-port`、`.tp-hint kbd`、`.skeleton` |

**例外 1 · 弹层 16px**：`.modal`（`styles.css:909`）与 `lab-theme.ts:89` dialog。`lab-theme.ts:88` 已给理由「弹层圆角比卡片大一号，否则大面板看起来比卡片还轻」——登记为白名单第 4 档 `--radius-lg:16px`，**仅限弹层**。
**例外 2 · 胶囊 999px**：`.badge`、`.segmented`、`.filter-chip`、`.progress`、滚动条 thumb。它们是「全圆角语义」而非圆角矩形，不算违反三档；`.tp-swatch:443` 的 `4px` 属小方角，收敛到 `5px`。

**待收敛的现存违规**（Phase 3，本轮不改）：`.brand-mark 9px`（随 C 删除）、`.btn-xs 6px`（→8 或 5）、`.step-row 6px`（→5）、`.skel-line 4px`（→5）、`.tp-swatch 4px`（→5）、`lab-theme.ts` borderRadius `xs 3→5 / sm 6→8 / md 10→12`（`lg 12` 不动、`xl 16` 与 dialog 对齐）。

### 6.5 边框优先规则（裁决 E）

- 分层：`1px solid var(--border)`（`#e4e4e7` / 深色 `#26262b`）；次级 `--border-soft`；强 `--border-strong`。
- 阴影**只允许** `.modal-overlay` / `.modal`（`--shadow-lg`）、`.theme-pop`（`:396`）、`.save-bar`（`--shadow-md`）、`button.primary`（`:606` 的 1px 内高光）。
- **hover 只动 `border-color` / `background`，不加阴影、不加位移**：`styles.css` 的 `.panel`、`.instance-row` 现状正确；待收敛 **3 处**：`.task:hover`（`styles.css:958-961` `--shadow-sm`）、`.segmented button.active`（`:722` box-shadow）、**`model-card.component.ts:109-117` 的 `.card:hover/:focus-within`（`transform:translateY(-2px)` + 外阴影；v1.1 补登记，组件 scoped 样式需单独收敛，全局 `styles.css` 改不到）**。后者已有的 `@media (prefers-reduced-motion: reduce){ transform:none }`（`:119-123`）保留，作为全仓降级规则的实现范本。
- 禁用态 `opacity:.45`（`button:disabled:617`）、`.nav-item.is-disabled opacity:.42`（`:262`），**不加灰底**。

### 6.6 关键组件视觉状态速查（默认 / 悬停 / 禁用 / 错误）

> 数值全部取自现有选择器，Phase 3 可直接逐条比对；字重按 §4.2 白名单归并。

| 组件 | 默认 | 悬停 | 激活/选中 | 禁用 | 错误 |
|---|---|---|---|---|---|
| **按钮 `button`**（`:579-619`） | `h32 / pad 0 13 / r8 / 1px --border / bg --panel / color --text-2 / 12.5px 500` | `bg --hover; border --border-strong; color --text` | `button.primary`: `bg --primary #4f46e5; color --on-primary`；**hover 保持 `bg --primary`，仅 `border-color:var(--accent)` 作 1px 装饰描边**（主理人裁决 A；深色 `--primary-hover #6366f1` + 白字仅 4.47:1 不达 AA，浅色 `#4338ca` 7.90:1 合规；不改任何 token 值，双主题维持 6.29:1） | `opacity:.45; cursor:not-allowed; hover 不还原` | `button.danger`: `color --err; hover bg --err-soft; border color-mix(err 34%, border)` |
| **导航 `.nav-item`**（`:230-263`） | `h32 / r8 / 13px 500 / color --muted / svg 15px 1.5px` | `bg --hover; color --text` | `.active`: `bg --accent-soft; color --accent; 600` | `.is-disabled opacity:.42` | — |
| **输入 `input,select,textarea`**（`:634-671`） | `h32 / r8 / 1px --border / bg --input-bg / 12.5px / placeholder --placeholder` | `border --border-strong` | `focus`: `border --accent; box-shadow --ring`；键盘 `:focus-visible outline 2px solid --accent; offset 2px`（`:142`） | `select:disabled opacity:.6` | 由 `.notice.err` / `.check-box` 承载，**不改输入框自身边框为红** |
| **卡片 `.model-card` / `.panel` / `.task` / `md-model-card .card`**（`styles.css:542,1000,949`；`model-card.component.ts:76-98`） | `r12 / 1px --border / bg --panel / 无阴影`；`.card::after` 用 `inset 0 0 0 1px var(--border)` 内描边（照片贴边需要，登记例外） | 仅 `border --border-strong` + `bg --hover`；**移除** `:960` 阴影、`model-card:111` 的 `translateY(-2px)` + 外阴影 | `.instance-row.installing`: `bg --accent-soft; border --accent-line`；`.card:focus-within` 改 `inset 0 0 0 1px var(--accent)` 内描边，不得只靠整卡外发光 | — | `.check-box`: `bg --err-soft; border color-mix(err 20%, transparent)` |
| **徽章 `.badge`**（`:757-772`） | `r999 / 11px 600 / lh18 / pad 1px 8px` | — | `gray/blue/green/orange/red` 五档 soft+fg | — | `.red` = `--err-soft / --err` |
| **弹层 `.modal`**（`:901-913`） | `w min(680px,100%) / maxh min(82vh,760px) / r16 / 1px --border / --shadow-lg` | — | — | — | — |
| **分段 / chip**（`:698-745`） | `.segmented r999 / bg --panel-3`；`.filter-chip h26 / r999 / 11.5px 500` | `border --border-strong; color --text`；**`.filter-chip.active:hover` 不再用 `--accent-hover`**（深 1.49:1） | **v1.1**：`.filter-chip.active` 改 `bg --primary; color --on-primary`（白字 6.29:1，双主题一致）；`.step-row.active .step-dot`（`:1469`）同样改 `--primary`。`segmented.active` 用 `bg --panel; color --accent; 600` 合规，**保持** | — | — |

---

## 7. 明暗双主题映射原则

### 7.1 机制（唯一入口）

`ThemeService.sync()` 在 `document.documentElement` 写 `data-theme="light|dark"`（`theme.service.ts:43-48`）；CSS 由 `:root` 与 `:root[data-theme="dark"]`（`styles.css:17/:77`）覆盖；组件内用 `:host-context([data-theme='dark'])`（`cover-plate.component.ts:256,419,550…`）。**不得**新增第二套主题开关，不得用 `filter: invert()`。

### 7.2 映射不是「逐一取反」，而是「保持相对层级」

| 通道 | 浅色 | 深色 | 原则 |
|---|---|---|---|
| 表面 | `--bg #f5f5f6` → `--panel #ffffff` → `--panel-2 #fafafa` → `--panel-3 #f4f4f5` | `#0b0b0d` → `#141417` → `#1a1a1e` → `#202025` | **保留 4 层阶差**，深色底不用纯黑 |
| 文字 | `--text #18181b` / `--text-2 #3f3f46` / `--muted #71717a` / `--faint #a1a1aa` | `#ededf0` / `#d4d4d8` / `#8b8b94` / `#5f5f68` | **四档一一对应**，不增不减（`styles.css:29`） |
| 线 | `--border #e4e4e7` / `--border-soft #f0f0f1` / `--border-strong #d4d4d8` | `#26262b` / `#1e1e22` / `#34343a` | 深色下"强"档比"默认"更亮（与浅色相反） |
| **文字型强调 `--accent`** | `#4f46e5`（600） | **`#a5b4fc`（300）** | **不翻色相，翻明度档**：深底需更亮 |
| **填充型 `--primary`** | `#4f46e5`（600） | **`#4f46e5`（600，不翻）** | **【v1.1 硬约束】凡承载白色文字的实心填充一律 `--primary` 600**：白字 6.29:1，双主题一致且 ≥ AA。深色 `--accent` 翻到 300 后**仅作文字/描边/图形色，绝不可作白字填充**（1.99:1 FAIL）。此条由审美偏好升级为**可验收的对比度硬约束**（§3.5-10） |
| 语义 fg | `#15803d / #b45309 / #b91c1c` | `#4ade80 / #fbbf24 / #f87171` | 浅底用深档、深底用亮档 |
| 语义 soft | 实色 `#f0fdf4 / #fffbeb / #fef2f2` | `rgb(… / .12)` 半透明 | 深色下实色 soft 会成荧光块 |
| 阴影 | `rgb(24 24 27 / α)` | `rgb(0 0 0 / α↑)` | 深色下 α 增大（`.22→.7`、`.04→.4`） |
| 聚焦 | `:focus-visible outline 2px solid --accent; offset 2px`（`:142`）；表单叠加 `--ring 3px 14%` 软环（`:70`） | `outline` 同；`--ring` → `rgb(99 102 241 / .28)`（`:121`） | 键盘焦点=2px 实线，鼠标聚焦=3px 软环，**两者用途不同不算冲突** |
| 封面构图 | `--plate-mark` 按家族色 | `.motif opacity:.66`；斜纹额外降浓（`:419-430`） | 深色下同一百分比更抢，统一压一档 |
| **品牌层反白** | `--brand-paper #f8f6f1` + `--brand-ink #1b1b1e` | `--brand-paper-reverse #15151a` + `--brand-ink-reverse #f1ede4` | **用独立 SVG 资产切换**，不是 CSS 取色；反白是暖白，与 UI 冷白 `#ededf0` 不同 |

### 7.3 【裁决 G】深色主色不一致归一

`lab-theme.ts:71` dark `primary.color = {primary.400} #818cf8`，而 `styles.css:98` dark `--accent:#a5b4fc`（indigo 300）。**统一到 `#a5b4fc`**：深底上 400 的亮度不足，`styles.css` 是实测选值；Phase 3 把 `lab-theme.ts` dark primary 改 `{primary.300}`。浅色两处已一致（均 `{primary.600}` / `#4f46e5`）。同时 `lab-theme.ts:40-45` focusRing `2px solid / offset 2px` 与 `styles.css:142` 一致，保留。

> **v1.1 语义边界精确化（回应 Phase 2 §2.10-3）**：本裁决的归一化对象**仅是「文字 / 描边 / 图形型 `--accent`」**，不可据此把两套实心填充方案合并成一个白字方案。两处填充各自合规的前提不同，Phase 3 必须分开处理：
> - **`styles.css --primary`**：深靛紫 600 底 + `--on-primary #ffffff` 白字 = **6.29:1** ✅（§7.2 硬约束）。
> - **`lab-theme.ts` dark primary**：亮靛紫底 + `contrastColor: '{primary.950}' #1e1b4b` **深字**（`lab-theme.ts:72`），实测 400 底 **5.36:1**、300 底 **8.02:1** ✅；**绝不可改成白字**（400 底 2.98:1、300 底 1.99:1，均 FAIL）。
>
> 即「`--primary` 不翻」说的是**主 UI 的白字实心填充**；lab 实验区走的是「亮底 + 深字」另一条合法路线。二者色相同族但字色相反，不构成冲突，也不需要互相拉齐。

---

## 8. 与现状的冲突裁决表

> 「是否本轮执行」列：**Phase 1 只产规范，全部为「否」**，仅登记供 Phase 3 排期；标「Phase 2 需知」的项影响体验规范输入。

| # | 冲突 | 现状 → 规范 | 迁移代价 | 本轮执行 |
|---|---|---|---|---|
| **A** | 暖纸墨黑 vs zinc+靛紫 | **分层双轨**：靛紫保留为交互色；纸墨收敛为品牌层 `--brand-*` 六枚；UI 两套 `:root` **原样保留** | 极低（仅新增 6 个变量，零覆盖、零回归） | **否** |
| **A′** | 两份品牌稿纸色不一致 | 统一取 `preview.html` 的 `#f8f6f1 / #dedbd3 / #6d6a64`；`design-options.html` 那组降级为预览页底色 | 无 | 否 |
| **B** | Barlow 400 vs Inter/雅黑 + 非标字重 | 两层角色不混用；字重白名单 `400/500/600/700`；`550→500`、`620/640/650/660/680→600`；中英混排中文 `letter-spacing:0`；数字强制 `tabular-nums` | 中：`styles.css` 17 处字重字面量替换，纯机械、无布局影响 | 否（Phase 2 需知） |
| **C** | 侧栏 MD / Model Downloader / Local Studio | 占位期：`.brand-wordmark` 纯文字 `SiMuseor` + 中文副行「创作工作台」；删除 `.brand-mark` 渐变方块；`<title>` 改 `SiMuseor`；补 favicon；冻结后按 §2.6 换成 SVG 双资产 | 低：`app.component.ts` 7 行 + `styles.css` 3 选择器 + `index.html` 2 行 + 品牌资产 | 否（Phase 2 需知） |
| **D** | 圆角三档约束 vs 实存 6/9/10/16/4px 及 lab-theme 五档 | 三档 `12/8/5` 为矩形唯一档；登记弹层 16px 与胶囊 999px 两类例外；收敛 6/9/4px；`lab-theme` `3→5 / 6→8 / 10→12` | 低：6 处字面量 + 1 个 preset 对象 | 否 |
| **E** | 边框优先 vs 卡片 hover 阴影 / 位移（**3 处**） | hover 只动 `border-color` / `background`，不加阴影与位移；移除 `.task:hover`（`styles.css:958-961`）、`.segmented.active`（`:722`）、**`model-card.component.ts:109-117` `.card:hover/:focus-within`**（v1.1 补登记，Phase 2 §2.10-13 发现，scoped 样式需单独改） | 极低：2 行 CSS + 1 个组件内联样式块 | 否 |
| **F** | 品牌字体根本没加载 | 转 woff2 进 `web/public/fonts/` + 2 条 `@font-face`（`font-display:swap`）；仅品牌类声明 Barlow；补后实测核验 | 中：新增字体文件与构建配置，需回归截图 | 否（Phase 3 重点） |
| **G** | 深色主色 300 vs 400 不一致 | `lab-theme.ts` dark primary 由 `{primary.400}` 改 `{primary.300}` `#a5b4fc` | 极低：1 行 | 否 |
| **H** | 参照站全大写 / 中等字重 vs 锁定混合大小写 400 | 只采纳「压缩窄体 + 紧字距 + 大留白」；明确不采纳全大写与 wght500 | 无（仅规范声明） | 否 |
| **I** | `index.html` 无 favicon、title 旧称 | `<title>SiMuseor</title>` + `icon-32/64.svg` 深浅两版（用冻结稿独立图标） | 低；**依赖 LOGO 冻结** | 否 |
| **J** | 第二轮 r2（8 方向）与 designkit「终稿」文件名 | 全部标注为**迭代中 / 已否**，不进 VIS 主标；文件名含"终稿"不作数 | 无（治理性） | 否 |
| **K** | `900px` 断点 `.brand-text{display:none}` 只留方块 | 占位期改为隐藏 `.brand-sub`、保留 `.brand-wordmark`；冻结后该位保留 30×30 图标 `<img>` + 深色版 | 低：1 条媒体查询 | 否（Phase 2 需知） |
| **L** | 对外「下载器」措辞 | 品牌自称一律 SiMuseor；「下载任务」等功能名保留不删 | 无 | 否（Phase 2 需知） |
| **M** | **`--accent` 作白字填充**（v1.1 新增，WCAG 派生） | `.filter-chip.active`（`:737`）、`.filter-chip.active:hover`（`:743`）、`.step-row.active .step-dot`（`:1469`）三处填充由 `--accent` / `--accent-hover` 改 **`--primary`**（白字 6.29:1 双主题一致）；配套把 §7.2「不翻」升级为硬约束、§3.5-10 列为禁止组合 | 低：3 处 `background` 声明，**不改任何 token 值** | 否（Phase 3 立即项） |
| **N** | **`--faint` / `--placeholder` 承载文本**（v1.1 新增，WCAG 派生） | 不改色值，只把 21 处文本引用迁到 `--muted` / `--text-2`（浅 4.83:1 / 10.44:1，深 5.44:1）；`--faint` 降级为仅 1px 分隔线、装饰描边、track 等非信息图形；`::placeholder` 改 `--muted` 但**保留 placeholder 文本**（E2E 依赖） | 中：21 处机械替换，纯使用位置、零色值改动、零布局影响 | 否（Phase 3 立即项） |

> **v1.1 合计 15 项**（`A / A′ / B / C / D / E / F / G / H / I / J / K / L / M / N`；v1.0 为 13 项）。**计数更正**：v1.0 回传摘要与 Phase 2 引用的「12 项」是笔误，实为 13 项，汇编手册请以 **15 项**为准。M / N 均由 Phase 2 的 WCAG 实算派生、由本人独立复算确认；二者**只改使用位置，不改任何 token 值**，因此不触碰裁决 A「零覆盖、零回归」的前提。E 项由 2 处扩为 3 处。全部 15 项仍为「本轮不执行」。

---

## 9. 待定项清单与 LOGO 冻结流程

### 9.1 待定项（Phase 1 明确挂起，禁止提前定案）

| # | 待定项 | 候选 / 现状 | 依赖 |
|---|---|---|---|
| 1 | 字形手术最终方案 | `00/A/B/C/D/E/F` 六方向，或 `D+A`；`design-options.html:67-70` 为推荐非定案 | 品牌主理人 + 用户 |
| 2 | 第二轮八方向去向 | `O1 / W1 / W2 / S1 / M1 / L1 / E1`；**L1 正形月桂 vs D 负形月桂需先裁路线** | 同上 |
| 3 | 月桂几何 | 叶数 6 或 8、咬口深度、枝干弧度、顶端距 M 肩线 ≥ 字高 10% | 路线裁定后实测 |
| 4 | 独立图标 | 是否「M 单体 + 月桂」；32/64/128 各尺寸删减 | 冻结稿 |
| 5 | 横 / 竖版、字标 + 中英副行组合 | 占位期只用横版 | 冻结稿 |
| 6 | 最终色彩稿 | 纸墨是否微调；是否另出「单色靛紫标」 | 冻结稿 |
| 7 | 安全区 / 最小尺寸**实测值** | 占位期 `1X / 120px / 32px / <20px 去月桂` | 冻结稿实测 |
| 8 | `smallcaps` 是否采纳 | 当前倾向不采纳（维持混合大小写） | 用户 |
| 9 | 字标字体文件进产品 | 见冲突 F（这是**工程待办**，不是字形待定） | Phase 3 |

### 9.2 冻结流程

| 步骤 | 谁确认 | 产出 |
|---|---|---|
| ① 收敛方向 | **品牌主理人（team-lead）** 汇总 `design-options` 六方向 + `_r2_strip` 八方向，先裁定「负形 / 正形月桂」路线 | 1 个候选方向 |
| ② 用户拍板 | **用户** 确认最终字形（含是否 D+A 组合、叶数、横竖版） | 冻结签字 |
| ③ 出冻结包 | 主理人 / 设计 | `simuseor-{light,dark,mono-light,mono-dark}.svg`、`icon-{32,64,128}.{svg,png}`、实测安全区 `X`、最小宽/尺寸、色彩稿 HEX |
| ④ 接入 | Phase 3 前端 | 按 §2.6 只改 3 处（资产 / `.brand-wordmark` 双 URL 变量 / 3 个常量），并补 favicon + `<title>`（冲突 I） |
| ⑤ 回写 VIS | 视觉架构师 / 主理人 | 同步 §9.3 列出的章节，升版号 |

### 9.3 冻结后 VIS 需同步的章节

| 章节 | 同步内容 |
|---|---|
| **§2 标识系统（全节）** | 2.1 基线保留；2.2 待定项关闭；2.3 换实测值；2.4 补冻结色彩稿的单色/反白规范；2.5 占位规范作废、换成正式接入；2.6 协议标为「已执行」；2.7 favicon/侧栏落地 |
| **§3 色彩系统** | 3.1 品牌层色值若微调则改 3.3-(1)；若另出「单色靛紫标」，在 3.3-(3) 增补一条品牌层专用交互色例外并写明仅限字标单色印刷 |
| **§5 图形与意象** | 5.1 月桂叶数/顶端距离由「冻结前不给死值」改为实测定值；5.3 图标网格若冻结稿另立 viewBox 则同步 |
| **§7 明暗映射** | 7.2 品牌层反白一行由「候选色」改为冻结资产色；确认双资产切换已实现；**7.2 的白字填充硬约束与 7.3 的 lab-theme 深字边界不受冻结影响，保持** |
| **§8 冲突表** | C 项状态由「占位」改为「已替换」；I 项标记完成；K 项标记完成；L 项不变；**E / M / N 属使用边界收敛，与冻结无关，按 Phase 3 排期独立执行** |
| **§9 本章** | 9.1 待定项逐条关闭并注明冻结版本与日期 |

> **不受冻结影响的章节（结构保证）**：§0 现状审计（历史记录）、§1 品牌内核、§4 字体系统（基线字体已锁定，与字形手术无关）、§6 版式与空间。这正是「VIS 其它章节不得依赖未定字形」的落实——Phase 2 可基于这四章立即开工，无需等 LOGO。

---

## 附录 · 交付给 Phase 2 / Phase 3 的硬约束速查

1. **LOGO 未冻结**：任何应用规范都不得引用具体实验稿字形；标识一律通过 `.brand-wordmark` 单一占位接入。
2. **色彩分层**：产品 UI 继续用现有 `:root` token；纸墨只在品牌层；靛紫只给可点/选中项（面积 ≤ 5%）。
3. **字重白名单** `400/500/600/700`；字标严格 400；中文 `letter-spacing:0`（含 `.brand-sub`）；数字 `tabular-nums`。
4. **三档圆角** `12/8/5` + 弹层 16 + 胶囊 999；边框优先于阴影；hover 不加阴影**与位移**（3 处待收敛，含 `model-card` scoped）。
5. **容器** `1240 / 236`；断点 `1040/900/860`；间距 4px 基准。
6. **明暗**：唯一入口 `data-theme`；反白用双份资产，不用 filter；深色 `--accent` 用 300 而 `--primary` 保持 600。
7. **对外命名** SiMuseor，功能名「下载任务」保留不删。
8. **字体文件缺失**：Phase 3 必须补 `@font-face`，否则基线字体不生效。
9. **`--accent` 永不作白字填充**（v1.1）：凡承载白字的实心填充一律 `--primary`（6.29:1）；深色 `--accent` 1.99:1 FAIL。
10. **`--faint` / `--placeholder` 永不承载文本**（v1.1）：2.35–2.91:1 全不达 AA，只改使用位置迁到 `--muted` / `--text-2`，**不改 token 值**。
11. **两套实心填充分开处理**（v1.1）：主 UI = 600 底 + 白字；`lab-theme` dark primary = 亮底 + `contrastColor:{primary.950}` 深字，不得改成白字。
