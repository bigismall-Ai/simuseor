# SiMuseor VIS · Phase 3 工程补充 · 蝉形接入

> **定位**：本文件是**工程实施补充**，不是规范。规范口径以 `_phase2-cicada.md`（体验/应用）为准，本文件只回答「**规范落到代码上怎么改、改哪里、怎么验**」。
>
> **零落地声明**：本轮**不修改** `web/src/`、`tests/`、`angular.json`、`web/public/` 下任何文件。所有代码块均为**待粘贴草案**，需主理人批准后另行执行。
>
> **上游口径**：`artifacts/vis/SiMuseor-VIS.md` v1.0 · `_phase2-cicada.md`（体验/应用，§3 favicon 专项 / §4 组合标落地 / §5 可访问性与 E2E 安全 / §11 验收项 63–78）· `_cicada-measurements.md`（唯一实测基准）· `artifacts/vis/vis-tokens.css`（token 层，231 行 / 18 个新变量 / 与 `styles.css` 交集 0）
>
> **本文件作者**：fe-engineer · **实测日期**：2026-11-17

---

## 0. 结论速览

| # | 议题 | 结论 | 阻塞状态 |
|---|---|---|---|
| 0.1 | 组合标接入 | **已完成**。`web/src/app/app.component.ts:25-35` 已有 `.brand` → `.brand-mark`（双 `<img>` 明暗切换）→ `.brand-wordmark` + `.brand-sub`，`styles.css:210-234` 已实现 56×26 + `object-position:bottom` + baseline 对齐 | 无 |
| 0.2 | favicon 接入 | `index.html` **无任何 `<link rel=icon>`**。接入 markup 见 §1，但**前置资产有 4 项未过验收**（§2） | **被 §2 阻塞** |
| 0.3 | token 层 | 现有 `--brand-logo-*` / `--brand-icon-*` 四个 URL 变量**未被 `styles.css` 引用**（组合标走 `<img>` 双资产而非 `background-image`）。本轮**不需要**新增变量 | 无 |
| 0.4 | vis-check 扩展 | 建议新增 **§4 整段**（4.1–4.7），**不与现有 1.1–1.11 / 2.x / 3.x 冲突**（编号 1.12+ 与 4.x 均空缺） | 无 |
| 0.5 | E2E 回归 | 蝉形当前 `alt=""` + 容器 `aria-hidden="true"` → **零可访问名贡献**，不撞 Playwright `name` 子串匹配 | 无 |

**一句话**：组合标已就位；favicon 的**接入 markup 可以写，但接入前必须先补 4 项资产**（§2）——否则接上去必然验收 FAIL。

---

## 1. favicon 接入（`web/src/index.html`）

### 1.1 现状（实测）

```
web/src/index.html  ——  <head> 内 grep "icon" 命中数 = 0
```

即：**当前没有任何 favicon 声明**。这与 VIS §7.1 的占位期约定一致（「v1.0 占位期用 `href="data:,"`」）——注意本项目**连 `data:,` 都没写**，即浏览器会去请求 `/favicon.ico`（当前 `web/public/` 下没有该文件 → 404）。

### 1.2 资产落位（Angular `assets` 配置）

`web/angular.json:22-27`：

```json
"assets": [ { "glob": "**/*", "input": "public", "output": "/" } ]
```

`web/public/**` 会被原样拷到构建产物的根，即 **`web/public/brand/favicon.svg` → 站点路径 `/brand/favicon.svg`**。

现有 `web/public/brand/` 已有 3 个文件（18:31 放入）：

```
web/public/brand/cicada-max.svg       10,666 B   ← 浅色版 MAX（组合标）
web/public/brand/cicada-max-dark.svg  10,603 B   ← 深色版 MAX（组合标）
web/public/brand/favicon.svg          12,631 B   ← L3 favicon 矢量
```

**建议的落位**（与组合标同目录，保持品牌资产集中）：

| 源（`artifacts/vis/assets/cicada/`） | 目标（`web/public/brand/`） | 站点路径 |
|---|---|---|
| `svg/favicon.svg` | `brand/favicon.svg` | `/brand/favicon.svg` |
| `png/favicon-16.png` | `brand/favicon-16.png` | `/brand/favicon-16.png` |
| `png/favicon-32.png` | `brand/favicon-32.png` | `/brand/favicon-32.png` |
| `png/favicon-48.png` | `brand/favicon-48.png` | `/brand/favicon-48.png` |
| `png/favicon-180.png` | `brand/favicon-180.png` | `/brand/favicon-180.png` |
| `ico/favicon.ico` | `brand/favicon.ico` | `/brand/favicon.ico` |

### 1.3 接入 markup 草案（**待批准，勿直接落地**）

按 `_phase2-cicada.md` §3.6 的顺序规则（**SVG 在前、PNG 按尺寸从大到小、`.ico` 垫底**；浏览器取**最后一条匹配且受支持**的声明）：

```html
<head>
  <meta charset="utf-8">
  <title>Model Downloader</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- 蝉形 favicon（MAX 帧派生，L3 简化版）
       顺序规则见 _phase2-cicada.md §3.6：SVG 在前 → PNG 从大到小 → .ico 垫底。
       .ico 必须最后：旧浏览器只认 .ico，放前面会被支持 SVG 的浏览器跳过。
       单版浅底、不随 data-theme 切换（favicon 渲染在浏览器标签栏，
       底色由浏览器/OS 主题决定，与页面 data-theme 无关）。 -->
  <link rel="icon" type="image/svg+xml" href="brand/favicon.svg">
  <link rel="icon" type="image/png" sizes="48x48" href="brand/favicon-48.png">
  <link rel="icon" type="image/png" sizes="32x32" href="brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="brand/favicon-180.png">
  <link rel="icon" href="brand/favicon.ico" sizes="any">
</head>
```

**约束（逐条可验）**：

| # | 约束 | 依据 |
|---|---|---|
| 1 | `.ico` 必须在**最后** | `_phase2-cicada.md` §3.6 |
| 2 | 16/32/48 **逐档声明**，不得只声明一个 `sizes="any"` 的 PNG | §3.6 + 验收项 65 |
| 3 | **不得**使用 `<link rel="shortcut icon">` | §3.6 |
| 4 | `href` **不得**指向任何字标 SVG | 验收项 64 |
| 5 | **不得**用 `filter: invert()` 做明暗切换 | VIS §2.4 第 ⑦ 条 |
| 6 | 若将来改双版，机制是 `media="(prefers-color-scheme: dark)"` 双 `<link>`，**不得**用 `data-theme` | §8 W2 |

### 1.4 主题感知 —— **favicon 不需要主题切换**

这是本节最容易做错的一点，明确写死：

- **favicon 渲染在浏览器标签栏 / OS 界面**，底色由**浏览器或 OS 主题**决定，**与页面的 `data-theme` 无关**。`ThemeService`（`web/src/app/core/theme.service.ts:47`）写的是 `document.documentElement` 上的 `data-theme`，**够不到标签栏**。
- 因此**不要**写 `:root[data-theme="dark"]` 之类规则去换 favicon href —— 那在标签栏里永远不生效，只会造成「以为切了其实没切」。
- **单版浅底**（`_phase2-cicada.md` §0 结论速览第 3 行已拍板「不需要区分深浅两版」）是**唯一正确方案**：浅底保住 plum/品红边缘（14.7:1 / 9.0:1），深底会吃掉定义轮廓的深端。
- **需要随主题切换的是 in-app 组合标**（`.brand-mark`），走 §2.4 的双资产显隐，**不是 favicon**。两者不可混谈（§3.5）。

### 1.5 占位期与回退（开关 K3）

- **占位期**（资产未过验收前）：`<head>` 内**不写任何** `<link rel=icon>`，或写 `<link rel="icon" href="data:,">`。后者能消除 `/favicon.ico` 的 404（当前 `web/public/` 无该文件，浏览器会请求并拿到 404）。
- **回退开关 K3**：若上线后 favicon 出问题，把所有 `<link rel=icon>` 的 `href` 改回 `data:,`，**消除 404、标签页回到空图标**，其余功能不受影响。
- **红线**：回退目标**只能是 `data:,`**，不得回退到任何字形 SVG。

---

## 2. favicon 接入的**前置资产缺口**（实测，当前阻塞项）

> 以下 4 项**全部实测**，逐项给数。**在它们修复前接入 §1.3 的 markup，必然验收 FAIL。**

### 2.1 缺口总表（对照 `_phase2-cicada.md` §11.1 验收项 63–67）

| 验收项 | 要求 | 实测 | 判定 |
|---|---|---|---|
| 63 | 存在 `favicon-180.png`（apple-touch） | `png/` 下只有 16/32/48/64 → **缺失** | **FAIL** |
| 64 | `.ico` 含 16/32/48 三档 | sizes = `[(16,16),(32,32),(48,48)]`，4,278 B | PASS |
| 65 | 声明顺序 | `index.html` 无任何 `<link rel=icon>` | 待接入（§1.3） |
| **66** | favicon 全档**零透明像素** + `#f8f6f1` 不透明底板 | PNG 透明 **69.5% / 73.5% / 75.3%**；`favicon.svg` **无 `<rect>`、无 `#f8f6f1`** | **FAIL** |
| **67** | 16px 主体高 ≥ 10px | 主体 **16×8px**（高 8px） | **FAIL** |

### 2.2 验收项 66 —— 缺不透明底板（**最严重**）

```
favicon-16.png   16×16   alpha=0 的像素 178/256   → 透明 69.5%
favicon-32.png   32×32   alpha=0 的像素 753/1024  → 透明 73.5%
favicon-48.png   48×48   alpha=0 的像素 1736/2304 → 透明 75.3%
favicon.svg             <rect> 数量 = 0，无 #f8f6f1
ico/favicon.ico 三档    透明 69.5% / 73.5% / 75.3%
```

**目视复核**：`favicon-64.png` 是「**透明底上的蝉**」，不是「浅底板上的蝉」。

**与规范的关系**：`_phase2-cicada.md` §3.3 的核心推论是「**浅底是 favicon 的唯一正确地面**」（§0 结论速览第 2 行：**「必须自带不透明底板（已拍板）」**；§1.5 第 80 行：**「favicon 与组合标都必须自带底板，不能依赖背景透明」**）。**当前资产与已拍板口径正好相反。**

**修复方式**：

- `favicon.svg`：在 `<defs>` 之后、图形之前插 `<rect width="100%" height="100%" fill="#f8f6f1"/>`
- PNG / `.ico`：渲染时先把画布填成 `#f8f6f1` 再画图形（**alpha 恒为 255**）

### 2.3 验收项 67 —— 16px 档主体高不足

```
favicon-16.png  主体外接框 16×8   宽高比 2.000   （需 主体高 ≥ 10px）
favicon-32.png  主体外接框 32×16  宽高比 2.000   （需 主体高 ≥ 15px）✓
```

16px 档主体只占画布高度的 **50%**，规范要求 **≥ 62.5%**。规范 §3.2 对 16px 的要求是「**必须缩短翼展、抬升身体**」——即主体应比现在更接近方形。

**附带发现（§67 相关）**：`favicon.svg` 的 `viewBox` 是 **`0 0 1397 644`**（MAX 原始画板），而 §3.2 要求「viewBox 与 **16px 版构图**一致（以 16px 版的紧凑比例为基准）」。**当前 SVG 源与 PNG 档不是同一构图**，用 SVG 源的浏览器会看到与 PNG 档不同的蝉形。

**描边色偏差**：§3.2 / 验收项 66 要求深紫 `#2a0a2e` / `#3a0a3a`。`favicon.svg` 实际只有 `#3a0a3f`（绿通道 +5，非规范色）。

### 2.4 修复清单（交回资产侧）

| # | 动作 | 影响文件 | 验收项 |
|---|---|---|---|
| F1 | 重画 **L3 方形构图**（缩短翼展、抬升身体），16px 主体高 ≥ 10px | `svg/favicon.svg` + 全部 PNG | 67 |
| F2 | 加 `#f8f6f1` 不透明底板（SVG `<rect>` / 位图 alpha=255） | `svg/favicon.svg` + 全部 PNG + `.ico` | 66 |
| F3 | `favicon.svg` 的 viewBox 改为与 16px 版同构的方形画板 | `svg/favicon.svg` | 67 |
| F4 | 描边色改规范色 `#2a0a2e` | `svg/favicon.svg` | 66 |
| F5 | 补 `favicon-180.png`（180×180，opaque 底板） | `png/favicon-180.png` | 63 |

**注**：favicon 是 **L3 独立重画**资产（§3.2 明写「未缩放 MAX 帧」「禁止由 MAX 帧缩放/降采样得到」），**不依赖 MAX 的面片 id / 解剖分组**，因此这 5 项**不需要等 MAX 基线裁决**即可独立完成。

---

## 3. 组合标接入 —— **已落地，现状即规范**（只读确认）

### 3.1 现状 DOM（`web/src/app/app.component.ts:25-35`，实测）

```html
<div class="brand">
  <!-- 蝉形是辅助图形，字标才是主视觉（VIS v2.0 §2.0.2）。
       明暗两版靠 CSS 切换显隐，不在 TS 里读主题。 -->
  <span class="brand-mark" aria-hidden="true">
    <img class="logo-light" src="/brand/cicada-max.svg" alt="" />
    <img class="logo-dark" src="/brand/cicada-max-dark.svg" alt="" />
  </span>
  <span class="brand-wordmark">
    SiMuseor
    <small class="brand-sub">剧集导演台</small>
  </span>
</div>
```

### 3.2 现状 CSS（`web/src/styles.css:210-234`，实测）

```css
.brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 2px 6px 16px;
}
.brand-mark {
  flex: none;
  display: block;
  width: 56px;
  height: 26px;
  /* 地脚线对齐：蝉形底边落在字标基线上，不是盒子居中对齐 */
  align-self: baseline;
}
.brand-mark img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
}
/* 品牌层反白靠双份资产切换，不是 CSS 取色（VIS §2.5） */
.brand-mark .logo-dark { display: none; }
:root[data-theme="dark"] .brand-mark .logo-dark { display: block; }
:root[data-theme="dark"] .brand-mark .logo-light { display: none; }
```

### 3.3 逐条核对验收项 68–72

| 验收项 | 要求 | 现状 | 判定 |
|---|---|---|---|
| 68 | 组合标占位宽 ≤ 200px | `.brand` gap 10px + `.brand-mark` 56px + 字标槽；侧栏 236px − 12×2 − 6×2 = 200px | 待实测（§3.5） |
| 69 | `.brand-mark__img` = 56×26px，**等比不拉伸** | CSS `width:56px;height:26px` + `object-fit:contain` | ✓（CSS 侧） |
| 70 | 蝉形渲染宽 < 字标墨迹宽 62.92px | 56px < 62.92px，余量 11% | ✓ |
| 71 | 蝉形渲染宽 ≥ 48px | 56px | ✓ |
| 72 | **蝉形腹部尖端 ≡ 字标 baseline**；**禁 `align-items:center`** | `.brand { align-items: baseline }` + `.brand-mark { align-self: baseline }` + `object-position: bottom` | ✓ |

### 3.4 ⚠️ 与 `_phase2-cicada.md` §4.1 的**一处结构差异**（需主理人确认是「有意偏离」还是「漏项」）

`_phase2-cicada.md` §4.1 的目标 DOM 是：

```html
<span class="brand-mark" aria-hidden="true">
  <img class="brand-mark__img" src="..." alt="" width="56" height="26" decoding="async">
</span>
<span class="brand-text">
  <span class="brand-wordmark" lang="en">SiMuseor</span>
  <small class="brand-sub">剧集导演台</small>
</span>
```

**现状实现与它的差异**：

| # | 规范（§4.1） | 现状 | 影响 |
|---|---|---|---|
| 1 | `<img class="brand-mark__img" width="56" height="26" decoding="async">` | `<img class="logo-light" src="..." alt="" />`（**无 `width`/`height` 属性、无 `decoding`、类名不同**） | 缺 `width`/`height` 属性 → **首屏可能产生 CLS**；验收项 69 说「必须写死 width/height 属性 → 避免 CLS」（§4.1 约束 #6） |
| 2 | 有 `.brand-text` 包裹层（竖列容器） | **无 `.brand-text`**，`.brand-wordmark` 自身是 `display:flex; flex-direction:column` | 视觉等价（`.brand-wordmark` 自己就是竖列），但**结构与规范不一致** |
| 3 | `<span class="brand-wordmark" lang="en">` | `<span class="brand-wordmark">`（**无 `lang="en"`**） | 屏幕阅读器会按页面 `lang="zh-CN"` 朗读英文品牌名 → 读成「西Museor」类音译 |

**这三条都不属于「冻结只改 3 处」的范围吗？** 都不是 —— 它们在 `.brand` 内部，但 §2.6 的「冻结只改 3 处」指的是**资产文件 / 四个 URL 变量 / 三个常量**这三类，DOM 结构调整属于另一层。**需要主理人裁决**：以现状为准（现状已目视通过）还是补齐 §4.1 的三条。

**我的建议**：补 **`width="56" height="26"`**（防 CLS，实测有实际收益）与 **`lang="en"`**（a11y），`.brand-text` 包裹层可不动（视觉等价，少一个节点 = E2E 更稳）。

### 3.5 需要实测才能关闭的验收项

| 验收项 | 需要的实测 | 为什么现在不能给数 |
|---|---|---|
| 68 | `.brand` 的 `scrollWidth ≤ clientWidth`；占位三段 = 蝉形 56 + gap 10 + 字标槽 90 = **156px** | 需要**真实浏览器渲染**（字标回退字体宽度会变） |
| 72 | 蝉形腹部尖端与字标 baseline 偏差 ≤ ±1px | 需要 `getBoundingClientRect()` 逐点比对 |
| 66 | favicon 全档零透明 + 底板 | **被 §2 阻塞**（资产未重做） |

**建议的实测脚本**（放 `tests/`，只读 DOM，不改任何产品文件）：

```js
// tests/cicada-brand-check.mjs —— 组合标几何实测（只读）
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://127.0.0.1:8000/workflows', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
console.log(JSON.stringify(await p.evaluate(() => {
  const brand = document.querySelector('.brand');
  const mark  = document.querySelector('.brand-mark');
  const img   = document.querySelector('.brand-mark img');
  const wm    = document.querySelector('.brand-wordmark');
  const cs    = getComputedStyle(brand);
  return {
    brandScrollW: brand.scrollWidth, brandClientW: brand.clientWidth,
    brandOverflow: brand.scrollWidth > brand.clientWidth,
    brandGap: cs.gap, brandAlignItems: cs.alignItems,
    markRect: mark.getBoundingClientRect().toJSON(),
    markAlignSelf: getComputedStyle(mark).alignSelf,
    imgRect: img.getBoundingClientRect().toJSON(),
    imgNatural: { w: img.naturalWidth, h: img.naturalHeight },
    imgHasSizeAttr: img.hasAttribute('width') && img.hasAttribute('height'),
    imgAlt: img.getAttribute('alt'), imgAriaHiddenParent: mark.getAttribute('aria-hidden'),
    wordmarkCount: document.querySelectorAll('.brand-wordmark').length,
    wordmarkLang: wm.getAttribute('lang'),
    // 地脚线：蝉形 img 底边 vs 字标首行文字底边
    markBottom: img.getBoundingClientRect().bottom,
    wordmarkBottom: wm.getBoundingClientRect().bottom,
  };
}, null), null, 2));
await b.close();
```

### 3.6 ≤900px 紧凑位（已落地）

`styles.css:1746-1749`：

```css
.brand { padding: 0 8px 0 0; }
/* 横条里只藏副标，蝉形 + 字标保留：整块隐藏会让品牌位只剩一个孤立图形，
   而蝉形单独出现按 VIS §2.0 只允许用于 favicon。 */
.brand-sub { display: none; }
```

**注意**：§6.2 的结论是「≤900px **保留**蝉形（换更紧凑的方形资产），DOM 不变、类名不变、`alt` 不变」——**不是**移除。§4.5 的降级链（蝉形渲染宽 < 48px → **整块移除 `.brand-mark` 节点**）是**兜底**，不是 ≤900px 的默认行为。

---

## 4. token 层 —— **本轮不需要新增变量**

### 4.1 现状（实测）

`artifacts/vis/vis-tokens.css` 已有 6 个品牌相关变量：

| 变量 | 值 | 是否被 `styles.css` 引用 |
|---|---|---|
| `--brand-logo-light` / `--brand-logo-dark` | `none` | **否** |
| `--brand-icon-light` / `--brand-icon-dark` | `none` | **否** |
| `--brand-clear-space` | `10px` | 否（属参考值） |
| `--brand-min-width` | `120px` | **否**（`.brand-wordmark` 未设 `min-width`） |
| `--brand-icon-min` | `32px` | 否 |

**为什么 4 个 URL 变量没人用**：它们是为「字标走 `background-image`」准备的接入路径（`vis-tokens.css:205-225` 的注释片段）。**实际实现选了 `<img>` 双资产**（`app.component.ts:28-31`）——这更优：`object-fit:contain` 保证等比不拉伸（验收项 69），而 `background-image` 需要额外处理 `background-size`/`background-position`。

**结论：四个 URL 变量保持 `none`，不填。** 填了反而会让 `.brand-wordmark` 同时有文字和背景图。

### 4.2 建议新增（**本轮零落地，仅登记建议**）

**我建议本轮不新增任何 `--brand-*` 变量**，理由：

1. **零覆盖是硬指标**（`vis-check.mjs` §3：`vis-tokens.css` 与 `styles.css` 的变量名交集必须为 0）。新增变量虽然不破坏零覆盖，但会扩大 token 层与实现的偏离面。
2. 组合标已落地且视觉通过（§3），**没有需要 token 化的新尺寸/颜色**。
3. 若将来要 token 化，建议新增的是**这三个**（且全部是新名，不碰现有 39 个）：

```css
/* --- 建议（待批准，本轮不写入 vis-tokens.css）--- */
--brand-mark-w:      56px;    /* 组合标蝉形渲染宽（验收项 69/71） */
--brand-mark-h:      26px;    /* 组合标蝉形渲染高 */
--brand-mark-min-w:  48px;    /* 低于此值整块移除 .brand-mark（验收项 71） */
```

**但它们不解决任何实际问题** —— `.brand-mark` 的 `width`/`height` 是**硬编码的 56/26**，用不用 token 都是同一个值。**除非将来要做紧凑位换档**，否则不值得引入。

### 4.3 类名前缀纪律（历史事故登记）

> **事故背景**：Tailwind v4 工具类曾命中 `.ring` / `.grid` / `.m-2`，导致样式被工具类覆盖。

**现状类名实测**：`brand` / `brand-mark` / `brand-wordmark` / `brand-sub` / `logo-light` / `logo-dark`。

**风险判定**：

| 类名 | Tailwind v4 工具类同名？ | 风险 |
|---|---|---|
| `.brand` | 否 | 低 |
| `.brand-mark` | 否 | 低 |
| `.brand-wordmark` | 否 | 低 |
| `.brand-sub` | 否 | 低 |
| `.logo-light` | 否 | 低 |
| `.logo-dark` | 否 | 低 |
| `.grid` / `.ring` / `.m-2` | **是** | **高**（历史事故） |

**结论**：现有品牌类名**均不与 Tailwind v4 工具类冲突**，无需加前缀。

**实测依据**：对 `web/node_modules/tailwindcss/theme.css` 全文正则匹配 `^\s*\.(brand|brand-mark|brand-wordmark|brand-sub|logo-light|logo-dark)\b` → **0 命中**；匹配 `^\s*\.vis-` → **0 命中**（故 `vis-` 前缀同样安全）。

**但如果将来新增品牌类名**（例如 `.brand-mark__img`、`.brand-text`），**必须加 2–3 字母前缀**。推荐 **`vis-`**：

```css
.vis-brand-text { ... }      /* 而不是 .brand-text */
.vis-brand-mark__img { ... } /* 而不是 .brand-mark__img */
```

**理由**：`vis-` 前缀与项目已有产物 `vis-tokens.css` / `vis-check.mjs` 命名一致，且 Tailwind v4 无 `vis-*` 工具类。

> **注意**：§3.4 提到规范里的 `.brand-mark__img` 与 `.brand-text` 若要落地，**应直接采用 `vis-` 前缀**（`.vis-brand-text` / `.vis-brand-mark__img`），避免再次踩「双下划线 BEM + Tailwind」的地雷。

---

## 5. `vis-check.mjs` 扩展建议（**只读校验，不改脚本**）

### 5.1 编号现状（实测 `vis-check.mjs` 全文）

```
已占用：1.1  1.2  1.3  1.3b  1.4  1.5  1.6  1.7  1.8  1.9  1.9a  1.9b  1.10  1.11
        2.x（对比度实算）  3.x（零覆盖交付物校验）
空缺：  1.12 及以后 全部
        4.x 整段
```

**建议：新增 §4 整段**，编号 `4.1`–`4.7`。**不动现有 1.x / 2.x / 3.x 任何编号**，避免与既有报告 diff 失效。

### 5.2 建议新增的检查项

| 编号 | 检查项 | 判据 | 类型 | 依赖 |
|---|---|---|---|---|
| **4.1** | favicon 声明存在性 | `web/src/index.html` 的 `<head>` 内**至少 1 条** `<link rel="icon">`，且 `href` **不是** `data:,`、不是空串 | DOM | F5 完成后 |
| **4.2** | favicon 声明顺序 | 出现顺序为 **SVG → 48 → 32 → 16 → apple-touch-icon → .ico**；`.ico` 在最后；**无** `rel="shortcut icon"` | DOM | 4.1 |
| **4.3** | favicon 资产文件存在性 | `web/public/brand/` 下 `favicon.svg` / `favicon-16.png` / `favicon-32.png` / `favicon-48.png` / `favicon-180.png` / `favicon.ico` **6 个全在**，且**体积 > 0** | 资产 | F5 |
| **4.4** | favicon 零透明 + 浅底板 | 6 个档位**全部零透明像素**（PNG/ICO 逐像素 alpha 恒 255；SVG 内含 `<rect fill="#f8f6f1">`） | 资产 | F2 |
| **4.5** | favicon `.ico` 三档 | `.ico` 内含 16×16 / 32×32 / 48×48 **三档**，且每档**尺寸正确**（不是缩放填充） | 资产 | 现有即过 |
| **4.6** | 组合标 DOM 结构 | `.brand` 是 `.sidebar` 的**第一个子元素**；`.brand-mark` **恰好 1 个**；`.brand-wordmark` **恰好 1 个**；`.brand` 内**无** `ui-badge` | DOM | 现状即过 |

> **4.6 的现状实测依据**：`.brand` 确为 `.sidebar` 的第一个子元素（`app.component.ts:24-25`）；`.brand-wordmark` 全站 1 个（`app.component.ts:32`）；`.brand-mark` 1 个（`app.component.ts:28`）；`ui-badge` 的全部实例在 `web/src/app/pages/comfy.component.ts`（85/87/293/295/385 行），**`.brand` 内 0 个** → §4.1 约束 #4 当前满足。
>
> **对应的 E2E 断言**：`tests/e2e/app.spec.ts:502` —— `await expect(page.locator('ui-badge').first()).toContainText('未安装')`（在 `/environments` 页）。它取的是**第一个** `ui-badge`，所以只要 `.brand` 内不出现 `ui-badge`，该断言就稳定指向环境卡徽章。**蝉形不得引入任何 `ui-badge`。**
| **4.7** | 组合标尺寸常量 | `styles.css` 内 `.brand-mark` 的 `width`/`height` = **56px / 26px**，且 `object-fit:contain`；`.brand` 的 `align-items` = **baseline**（**禁 `center`**） | CSS | 现状即过 |

### 5.3 为什么不放进 §1 / §3

- **不放 §1**（现状基线扫描）：§1 扫的是 `styles.css` + `app/**/*.ts` 的**违规模式**（font-weight / `--faint` / invert / 字标实例数…）。4.1–4.5 扫的是 **`index.html` 与 `web/public/` 的二进制资产**，§1 的扫描范围不覆盖。
- **不放 §3**（交付物零覆盖）：§3 专指「`vis-tokens.css` 是否重名赋值 `styles.css` 已有变量」，是一个**纯 CSS 变量名集合**的交集检查。favicon 是**文件资产**，塞进去会破坏 §3 的语义边界。
- **新开 §4** 符合脚本现有的三段式结构（A 现状基线 / B 对比度 / C 交付物校验），新增第四段「D 资产与接入校验」逻辑最清晰。

### 5.4 实现要点（给写脚本的人）

- 脚本当前是 **Node ≥18、无第三方依赖**（`vis-check.mjs` 头部声明）。**读 PNG/ICO 的 alpha 通道不能用任何图像库**。
  - **可行方案**：PNG 的 alpha 可用 `zlib.inflateSync`（Node 内置）+ 手写 PNG chunk 解析实现 —— 但**不建议**，因为 PNG 还有 5 种 filter 类型要还原，成本高且易错。
  - **更稳的方案**：4.4 只做**文件级静态检查**（`favicon.svg` 内含 `#f8f6f1` 且含 `<rect>`；PNG/ICO 的**字节流里不含 `tRNS`/`PLTE` 透明标记**），把「逐像素零透明」留给 §11.1 验收项 66 的**人工/一次性核验**（已实测，见 §2.2）。
  - **或**：新增一个独立的 `tests/` 下 Playwright 脚本做像素级核验（浏览器 canvas 可读 alpha），`vis-check.mjs` 只负责静态层。
- **退出码语义**：脚本当前 `0=全通过 / 1=仅现状基线有 FAIL / 2=交付物校验失败`。新增 §4 属**交付物校验**，**FAIL 应计入 `deliverableFail`（退出码 2）**，与 §3 一致。
- **`web/public/` 是否在扫描范围**：脚本当前只读 `web/src/styles.css`、`web/src/app/**`、`artifacts/vis/vis-tokens.css`。§4 需要新增 `web/public/brand/` 与 `web/src/index.html` 两个只读路径。

### 5.5 与现有 §1.5 的关系（不要重复检查）

`.brand-wordmark` 实例数**已由 §1.5 检查**（现状 0 个 = 占位期；目标态恰好 1 个）。**4.6 不要再重复数它**，只检查 `.brand-mark` 与「`.brand` 是 `.sidebar` 第一个子元素」这两个 §1.5 没覆盖的点。

---

## 6. E2E 回归安全（蝉形可访问名）

### 6.1 现状（实测 `app.component.ts:28-31`）

```html
<span class="brand-mark" aria-hidden="true">
  <img class="logo-light" src="/brand/cicada-max.svg" alt="" />
  <img class="logo-dark" src="/brand/cicada-max-dark.svg" alt="" />
</span>
```

### 6.2 判定：**不撞 Playwright `name` 匹配**

Playwright 的 `getByRole(role, { name })` / `getByText()` 依赖**可访问名（accessible name）**。本例中：

| 元素 | 可访问名 | 说明 |
|---|---|---|
| `.brand-mark`（span） | **无** | `aria-hidden="true"` → 整棵子树从可访问性树中移除 |
| `.brand-mark img` | **无** | `alt=""` → 装饰性图片，不产生名字；且父级已 `aria-hidden` |
| `.brand-wordmark` | `SiMuseor` | 纯文字，无 `aria-label` |
| `.brand-sub` | `剧集导演台` | 纯文字 |

**结论**：蝉形**零可访问名贡献**。`getByRole('link', { name: '下载任务' })` 等断言**不可能**误命中 `.brand-mark`。

### 6.3 禁止新增的可访问名（红线）

`_phase2-cicada.md` §5.1 已定案，**本文件复述以防回归**：

> **禁止**任何新增可访问名包含：**模型 / 安装 / 下载任务 / 设置 / 安装实例**。

原因：`tests/e2e/app.spec.ts` 里 `getByRole('link', { name: '下载任务' })`、`getByRole('link', { name: '设置' })` 等用的是**子串匹配**（`name` 默认是子串匹配，非精确）。若蝉形 alt 文本含这些词，会**变成 2 个匹配** → `strict mode violation`。

### 6.4 建议的安全命名方案（若将来需要给蝉形加名字）

**首选：永远不加。** 蝉形是装饰性辅助图形（VIS §2.0.2），字标已承载品牌名。加 `aria-label="SiMuseor 蝉形标记"` 反而会让屏幕阅读器**重复播报**品牌。

**若产品要求必须有可访问名**（例如需要让用户知道这里有个蝉形标记）：

| 方案 | 写法 | 判定 |
|---|---|---|
| ✅ 推荐 | `<img alt="SiMuseor 标记">`（不加 `aria-label`，不加 `aria-hidden`） | 名字含「SiMuseor」，不含任何禁用词 → 安全 |
| ⚠️ 可 | `alt="SiMuseor 辅助图形"` | 同上，安全 |
| ❌ 禁止 | `alt="模型库"` / `alt="安装"` / `alt="下载任务"` / `alt="设置"` / `alt="安装实例"` | 含禁用词 → 撞子串匹配 |
| ❌ 禁止 | 给 `.brand` 容器加 `aria-label` | §5.4 明写「不要给 `.brand` 容器加命名」——会让整块品牌位变成一个命名区域 |

**注意**：`alt` 一旦从 `""` 改成文字，**`.brand-mark` 上的 `aria-hidden="true"` 必须同步去掉**（否则 `alt` 被 `aria-hidden` 压制，名字不会暴露，等于白改）。**两者要么都加、要么都不加。**

---

## 7. 待主理人裁决清单

| # | 事项 | 影响 | 我的建议 |
|---|---|---|---|
| D1 | favicon 资产重做（§2.4 的 F1–F5） | 阻塞 §1.3 接入 | 做。favicon 是 L3 独立资产，**不依赖 MAX 裁决**，可立即开始 |
| D2 | `artifacts/.../svg/cicada-max.svg` 与 `web/public/brand/cicada-max.svg` **内容分叉**（37,329 B vs 10,666 B，后者才是 533 顶点 / 4 分组 / 语义 id / 0 渐变） | 影响「按解剖分组整组换色」是否可行 | 以 `web/public/brand/` 那版为冻结基准，回滚 artifacts 副本对齐。但**需先确认 18:54 那次改写不是有意为之** |
| D3 | §3.4 的组合标结构差异（缺 `width`/`height` 属性、缺 `lang="en"`、无 `.brand-text` 包裹层） | 影响 CLS 与 a11y | 补 `width`/`height` + `lang="en"`；`.brand-text` 不动（少一个节点，E2E 更稳） |
| D4 | 任务 C 的最终交付形态 | — | 本文件即**工程补充章**（规范侧已由 `_phase2-cicada.md` 覆盖）。**不建议**再写一份完整 `_phase3-cicada.md`，避免两份规范互相冲突 |

---

## 附录 A · 本文件的实测方法（可复算）

| 实测项 | 方法 |
|---|---|
| favicon 透明度 | PIL 逐像素读 `RGBA`，统计 `alpha == 0` 的像素数 ÷ 总像素数 |
| `.ico` 内含档位 | PIL `Image.open(...).info['sizes']` |
| SVG 渐变 / 分组 / 语义 id | 正则统计 `<linearGradient` / `<g id=` / `<path id=` 计数 |
| 两份 MAX 是否同一文件 | `sha1` + 字节长度 |
| vis-check 编号占用 | `vis-check.mjs` 全文正则提取 `1.x` / `2.x` / `3.x` 标识符并去重排序 |
| 组合标类名是否撞 Tailwind | 对照 Tailwind v4 工具类清单逐个比对 |
| E2E 断言是否受影响 | 通读 `tests/e2e/app.spec.ts` 的 `getByRole` / `getByText` 全部用法 |

## 附录 B · 相关文件索引

| 文件 | 作用 |
|---|---|
| `artifacts/vis/SiMuseor-VIS.md` | 视觉识别系统 v1.0（总纲） |
| `artifacts/vis/_phase2-cicada.md` | 蝉形应用与体验规范（§3 favicon / §4 组合标 / §5 a11y / §11 验收 63–78） |
| `artifacts/vis/_cicada-measurements.md` | 唯一实测基准（全部数字出处） |
| `artifacts/vis/vis-tokens.css` | token 层（231 行 / 18 新变量 / 交集 0） |
| `artifacts/vis/vis-check.mjs` | 只读校验脚本（Node ≥18，无第三方依赖） |
| `web/src/app/app.component.ts:25-35` | 组合标 DOM 现状 |
| `web/src/styles.css:210-234` | 组合标 CSS 现状 |
| `web/src/app/core/theme.service.ts:47` | `data-theme` 唯一写入点 |
| `web/angular.json:22-27` | `web/public/**` → 站点根 |
| `tests/e2e/app.spec.ts` | E2E 断言（`getByRole` / `getByText` 子串匹配） |
