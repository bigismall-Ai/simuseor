# SiMuseor VIS 资产管理系统 v1.0

> 状态：提案（待主理人裁决）　·　编制：2026-11-21
> 适用范围：`artifacts/vis/`（规范与手册）+ `web/src/vis-tokens.css`（产品生效层）+ `web/public/brand/`、`web/public/families/`（产品资产）
> 上游依据：VIS v2.7 §3.8 渐变层 / §3.9 色域约束摘要 / §3.10 站点背景与底纹；`vis-check.mjs` 现有四道门禁；`.cnb.yml` 现有 CI 编排。

---

## 0. 三条宪法

整套系统只围绕三条不可协商的原则设计。任何方案细节与这三条冲突，改方案，不改宪法。

1. **每个事实只有一个真值**——每类资产、每条规则、每个数字，都只允许有一处权威定义。
2. **生成物禁止手改**——凡是能由真值算出来的东西，就是生成物；手改它，CI 必然报错，且报错要能指出真值在哪。
3. **每条规则都有机器检查**——人只负责「做决定」，机器负责「守住决定」。凡是需要靠人记的规则，都视为尚未实现。

> 现状违反了这三条的具体表现：家族色有 3 个口径（16 / 25 / 9）；`SiMuseor-VIS.md` 与 `SiMuseor-VIS.html` 是手工孪生；`reference/*.html` 8 页图示无人校验；蝉形资产的生成脚本被删后产物不可重建。

---

## 1. 资产台账

五类资产，**真值形态分两种**，防漂移打法完全不同：

| 类 | 内容 | 真值形态 | 真值源 | 生成物 | 漂移防线 |
|---|---|---|---|---|---|
| **A 标识** | 蝉形 MIN/MID/MAX、线稿两版、favicon 七档、字标三版 | **手工绘制**（不可重建） | `cicada-FULL.ai` + 设计稿 | `svg/`、`svg/favicon/*.ico`、`web/public/brand/` | **规格校验 + 文件指纹 + 签字**（§6） |
| **B 色彩** | 品牌纸墨六枚、产品 zinc+靛紫、语义色、**家族 25 + 任务 12 + 中性** | **程序化**（可重建） | `model-tone.ts` + `tokens/*.tokens.json` | 两层 CSS、手册色块、实测表 | **集合差集 + 对比度 + 配额**（§5 L1/L2） |
| **C 图形语言** | 5 构图变体 `mo-0..4`、图标集、圆角/间距/阴影档 | 程序化 | `vis-tokens.css` + 组件源码 | 手册图示页 | 引用一致性 + 规格校验 |
| **D 组件** | Angular 组件库（按钮/卡/面板/徽章/输入…） | 程序化 | `web/src/app/**` | 组件参考页 + 视觉回归快照 | **Playwright 快照 diff**（§5 L3） |
| **E 手册** | VIS 正文、图示页、预览手册 | 程序化 | `SiMuseor-VIS.md`（唯一源） | `SiMuseor-VIS.html`、`reference/*.html` | **标题集合一致 + 锚点有效 + 状态标注完整**（§5 L4） |

### 1.1 为什么 A 类要单独一套防线

蝉形是**手绘源稿**：`cicada-FULL.ai` 改一笔，七档 favicon 与三个帧就都不对了，而**没有任何脚本能重新生成它们**（生成脚本已于本轮删除，这是有意的设计决定——VIS §3.7.1 明确「七档由同一套画稿手工输出，禁止缩放代替」）。

因此 A 类不能沿用 B 类的「重跑一遍就一致」，只能守住**契约**：
- **规格**：每档的画布比例、主体占位、描边宽度、接缝可见性、深色版独立性、最小可辨尺寸——全部写成可测断言；
- **指纹**：每个产物登记 sha256；产物与登记不一致 = 资产被换过（不一定是坏事，但必须有人签字）；
- **签字**：改资产必须同时改版本号 + changelog 记「改了什么、为什么」。

B/C/D/E 类则是反过来：**能被重算出来的，绝不手写**。

---

## 2. 仓库结构（重构后）

```
artifacts/vis/
├─ src/                          ← 唯一手写区（真值 + 生成器）
│  ├─ tokens/                    ← DTCG JSON（色彩真值）
│  │   brand.tokens.json           品牌层纸墨六枚
│  │   product.tokens.json         产品层 zinc / 靛紫 / 语义色
│  │   family.tokens.json          家族 25 + 任务 12 + 中性（由 model-tone.ts 导出）
│  │   graphic.tokens.json         5 构图、圆角、间距、阴影
│  ├─ generators/                ← 生成器（Python / Node，纯脚本）
│  │   gen_tokens.py               tokens.json → 两层 CSS + 手册色块
│  │   gen_family_tone.py          model-tone.ts → family.tokens.json
│  │   gen_reference.py            手册源 → reference/*.html
│  │   gen_vis_html.py             SiMuseor-VIS.md → SiMuseor-VIS.html
│  │   gen_asset_report.py          A 类资产规格 + 指纹台账
│  └─ pages/                     ← 手册正文源（md 片段 + 模板）
├─ dist/                         ← 生成物（提交进 git，供离线查阅与外部归档）
│  ├─ SiMuseor-VIS.html
│  ├─ reference/*.html
│  └─ tokens.css
├─ assets/                       ← A 类资产（手绘源 + 导出件）
│  └─ cicada/  cicada-FULL.ai  svg/  svg/favicon/
├─ vis-tokens.css                ← 设计层（生成物）
└─ vis-check.mjs                 ← 门禁（手写，但是唯一手写且不允许手写规则）
```

**唯一手写区**原则：`src/` 之外的一切，要么是生成物，要么是手绘资产导出件。CI 负责证明这件事。

---

## 3. 真值 → 生成物 → 门禁 对照表

| 真值 | 生成命令 | 产出 | 校验命令 | 不一致时 |
|---|---|---|---|---|
| `model-tone.ts` | `gen_family_tone.py` | `family.tokens.json` | `vis-check` L1 | 阻塞 |
| `tokens/*.tokens.json` | `gen_tokens.py` | 设计层 + 生效层 CSS、手册色块 | `vis-check` L1/L2 | 阻塞 |
| `tokens/*.tokens.json` | `gen_tokens.py` | `tokens/*.css` → `web/src/vis-tokens.css` | `vis-check` 3C 交叉校验 | 阻塞 |
| 手册源 md | `gen_reference.py` / `gen_vis_html.py` | 8 页图示 + 预览手册 | `vis-check` L4 | 阻塞 |
| `web/src/app/**` | — | 组件参考页 + 快照 | `vis-check` L3（Playwright） | 阻塞 |
| `assets/cicada/**` | — | 规格 + 指纹台账 | `vis-check` L0' | 阻塞 |

单条命令：`npm run vis:build`（生成 + 自检 + 写报告），`npm run vis:check`（只校验）。

---

## 4. 状态模型

手册里出现的**每一件东西**都必须带状态，四态：

| 标记 | 含义 | 门禁要求 |
|---|---|---|
| 〔现〕 | 产品代码里真的在用 | 必须能在代码里指到出处 |
| 〔目〕 | 目标态，尚未落地 | 必须写明落地路径或归属阶段 |
| 〔历〕 | 历史稿，只留追溯 | **禁止**被任何组件引用；引用即失败 |
| 〔冻〕 | 冻结资产（标识类） | 改动必须走 §6 签字流程 |

规则：
- 每张图示块、每条 token、每个组件条目都要标；
- `vis-check` L4 扫 `reference/*.html`：无状态标注 → 报告（先提示，后续升阻塞）；
- 〔历〕资产被引用 → 直接阻塞。

---

## 5. 门禁体系（5 层）

| 层 | 查什么 | 手段 | 失败级别 | 跑在哪 |
|---|---|---|---|---|
| **L0 格式** | CSS/JSON/SVG 合法性、注释配对、文件编码 | 静态解析 | 阻塞 | pre-commit + CI |
| **L1 真值一致** | 生成物 == 真值；**集合差集必须为空**；两层 token 名称与字面值一致 | `vis-check` | 阻塞 | pre-commit + CI |
| **L2 语义合规** | 对比度（WCAG 实算）、面积配额、禁用组合、圆角/字重档 | `vis-check` | 阻塞（已登记旧债不阻塞） | pre-commit + CI |
| **L3 视觉回归** | 组件与关键页面渲染快照 diff | Playwright（Chromium 已在） | 阻塞 | CI |
| **L4 手册完整** | 标题集合一致（md ↔ html）、**引用锚点有效**、状态标注齐、无悬空章节号、图示资产在真值集合内 | `vis-check` | 阻塞 | pre-commit + CI |

退出码分级沿用现有约定：`0` 通过 / `1` 已登记旧债（提示）/ `2` 合规类违规（阻塞）/ `3` 脚本自身错（阻塞）。

### 5.1 L1 的两条硬检查（本次漂移的直接止血点）

1. **家族集合一致**：`reference/*.html` + `vis.css` 中出现的 `.f-*` 家族集合 == `model-tone.ts` 的家族集合，**差集必须为空**；任务色与中性兜底同样在册。
2. **标题集合一致**：`SiMuseor-VIS.md` 与 `SiMuseor-VIS.html` 的 § 标题集合必须相同（多一个少一个都算漂移）。

### 5.2 L4 的两条硬检查

3. **锚点有效**：文档内所有 `#s-xxx` / `§s-xx` 引用必须能解析到真实锚点；**禁止**使用会漂的章节号（`§4.5` 这类）。
4. **数字有来源**：正文里出现的家族数、对比度、alpha 等关键数字，必须由生成脚本注入（占位符替换），不允许手写。

---

## 6. A 类资产（手工绘制）的规格与指纹

给不可重建的资产一份可机检的契约。

### 6.1 资产规格台账（`src/generators/gen_asset_report.py` 读取）

| 资产 | 规格断言 | 实测方式 |
|---|---|---|
| favicon 16/24/32/48/64/128/256 | 画布比例、主体占画布比、描边宽度档、接缝可见性、alpha 占比 | PNG 逐档 alpha 包围盒 + 描边宽度量测 |
| 蝉形 MIN/MID/MAX | 宽高比、外接框、面片数、接缝白线存在性 | SVG 解析 + 渲染实测 |
| 深色版 | 不得由浅色版 `filter` 生成；须独立文件且逐面片比值登记 | 文件级 + 像素级 |
| 字标三版 | 字重仅 400、字距 .028em、无描边无渐变无投影 | 源码断言 |

### 6.2 指纹与签字

- 每个 A 类产物登记 `sha256` + 规格版本；
- 产物与登记不一致 → L0' 报「资产被替换」，要求同 PR 更新台账 + 版本号 + changelog；
- **禁止**「重生成」类操作——手绘资产只能人工改，改完必须签字。

---

## 7. 命名、ID 与引用

| 对象 | 规范 | 例 |
|---|---|---|
| 资产 ID | `<system>-<family>-<role>-<variant>-<size>.<ext>` | `si-cicada-max-dark-1405x671.svg` |
| Token 名 | 层级用连字符，值用数字档；**按角色命名，不按色值命名** | `--sem-accent-hover`（不是 `--indigo-700`） |
| 引用 | 相对路径 + 锚点；**禁绝对路径、禁裸章节号** | `reference/color.html#s-19` |
| 目录 | 全部小写连字符 | `vis-tokens.css` |

理由：按角色命名是 DTCG 与设计系统的共识——改色时只有语义层动，下游组件行为不变。

---

## 8. 发布流程

- **版本号**：`major. minor. patch`
  - major = 视觉系统结构性变更（色板重排、字体重排、标识改版）
  - minor = 资产增补（新增家族、图标、构图）
  - patch = 修正（数值纠错、文档勘误）
- **一次发布产出 Release Bundle**（挂在 tag `vis/v2.8.0`）：
  1. `tokens/*.tokens.json`（DTCG，可被任何工具读）
  2. 资产包（A 类 svg/ico + B/C 类派生物）
  3. 手册静态站（`dist/`，可离线可归档）
  4. `CHANGELOG.md`（本次改了什么、为什么、谁签的）
  5. **漂移报告**（§9）
- **分享卡 / 启动页 / 关于页** 从同一套 token 生成，不允许各自写死色值。

---

## 9. 漂移报告（每次 CI 自动产出）

每次 CI 产出一份可归档的 `artifacts/vis/dist/drift-report.md`：

1. 真值 vs 各副本的**集合差集**（家族色、任务色、token 名、组件条目）；
2. **对比度变化**：本版 vs 上一版，所有语义色对的比值增减，标出跌破阈值的；
3. **资产指纹变化**：A 类产物哪些变了、变的是规格哪一条；
4. **手册覆盖率**：组件 / token / 资产各自「有规范条目」的比例；
5. **未标注状态**的图示块清单。

这份报告是季度人工审查的输入，也是「规范是否还成立」的证据。

---

## 10. 治理

- **owner 制度**：每个真值文件头写 `owner` + `backup`，每次变更改 owner 记录；
- **季度审查**：走一遍漂移报告 + 规则有效性检查（规则还有意义吗？约束是否过紧？），产出审查记录；
- **规则退役机制**：任何约束都要写明「它拦的是什么」。拦不住东西的约束，留着只会稀释注意力。

---

## 11. 落地路线

| 阶段 | 内容 | 验收标准 | 预估 |
|---|---|---|---|
| **P0 止血** | ① 把 `artifacts/vis/_work/` 里的实测与生成脚本提级为 `src/generators/`（入库）；② `vis-check` 加 L1 两条硬检查（家族集合一致、标题集合一致） | 本次这类漂移（16 vs 25、悬空 §4.5）**以后自动拦** | 半天 |
| **P1 单一真值** | `model-tone.ts` → `family.tokens.json` → 生成两层 CSS 的家族色段 + 手册色块；**删掉 `vis.css` 的 `--lit-*` 副本** | 手册展示的家族集合 == 产品真值，手册里不再有任何手抄色值 | 1–2 天 |
| **P2 手册生成化** | `SiMuseor-VIS.md` 为唯一源，生成 `SiMuseor-VIS.html` 与 8 页图示；正文数字改占位符注入 | 改 md → 重新生成 → md 与 html 标题集合恒等 | 2–3 天 |
| **P3 视觉回归** | 组件参考页 + Playwright 快照（关键页 + 组件状态） | 任何视觉改动都能被 diff 出来 | 2 天 |
| **P4 发布包** | Release Bundle、tag、changelog、漂移报告 | 一个 tag 能还原出完整可用的资产与手册 | 2 天 |

P0 + P1 合计约 2 天，就能把「靠人记」变成「机器拦」，并立刻封住本次暴露的整类漂移。

---

## 12. 明确不做的事（及理由）

| 不做 | 理由 |
|---|---|
| Frontify / Bynder / Brandfolder / Zeroheight | 解决的是「对外发布规范 + 管资产 + 锁模板」。我们是**规范 ↔ 代码**双向的工程仓，规范要能被 CI 校验，不是给人翻的 PDF |
| Tokens Studio / Figma 作为源 | 蝉形与家族色都是程序化/手绘真源，Figma 里没有真源；把它当源等于多一份要同步的副本 |
| Storybook | 组件是 Angular，重搭一套 React 工作台的投入不划算；用 Playwright 快照 + 自建参考页覆盖同样的回归需求 |
| Style Dictionary（暂） | 要把 token 从 CSS 变量搬进 JSON 再生成回来，迁移成本大于收益。**但 `*.tokens.json` 采用 DTCG 格式，将来要接它（或出 iOS/Android/桌面端）零成本**，所以现在就按它的输入格式写 |

---

## 13. 与业界的关系

业界共识只有三条真正管用，我们全部采纳：**单一真值 + 生成**、**living 而非静态**、**规则要有机器检查**。工具层面我们不比拼 SaaS，而是把「生成物 + 门禁」这两件事做实——这正是我们仓库里 `vis-check.mjs` 已经存在的形态，把它扩到全资产层即可。

参考资料：
- [Design System Documentation: A Practical Guide for 2026](https://docsio.co/blog/design-system-documentation)
- [Design tokens and the W3C spec, in practice](https://www.chromabrew.com/blog/design-tokens-and-the-w3c-spec)
- [Design tokens in 2026](https://thridy.com/blog/design-tokens-in-2026-how-design-systems-finally-talk-to-code)
- [Style Dictionary vs Tokens Studio](https://aidesign.guide/compare/style-dictionary-vs-tokens-studio)
- [Best Brand Software: 8 Tools Compared](https://rankite.com/blog/best-brand-software)
- [How to write brand guidelines that people actually follow](https://academy.billionideas.co/tutorial/brand-guidelines-document-template)
