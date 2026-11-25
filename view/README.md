# View

Angular 22 视觉与原型区。包含 `/vis`（视觉规范与原型）与 `/svg`（SVG 工作台）。

> 本 README 的其余部分是 Angular CLI 默认内容，保留作参考。

## Lint 与组件登记

```bash
npm run lint        # ng lint：src/**/*.ts + src/**/*.html，含官方 angular-eslint 规则
npm run lint:rules  # 本地规则 no-unregistered-ui-element 的冒烟测试
npm run check       # 组件守卫 + lint
```

`eslint.config.js` 是 flat config；本地插件在 `eslint-rules/`。模板里出现 `ui-*` / `md-*` /
`app-cover-plate` / `app-workflow-card` 却没写进 `src/app/ui/registry.json` 时，
`local-ui-registry/no-unregistered-ui-element` 会报「组件未在 ui/registry.json 登记: <selector>」。
Material、原生标签、`app-vis-*` / `app-proto-*` 与其它自由 `app-*` 组件不拦。

## SVG 工作台（/svg）

给「现有 SVG 资产优化 + LLM 参与设计」用的最小闭环，不依赖任何后端或第三方编辑器壳。

```bash
npm run svg:index   # 扫描 public/ 生成 public/svg-index.json（start/build 前会自动跑）
npm start           # http://localhost:4200/svg
```

五条主线：

1. **载入**：左栏列出 `public/brand`、`public/families` 下的 SVG；也可「打开文件 / 粘贴」载入任意 SVG。
2. **诊断**：右栏「诊断」把问题拆成可解释的条目（内嵌位图、`<style>` 类选择器、编辑器元数据、缺 id、精度冗余…），每条可单步修复。
3. **规范化 / 优化 / 批量**：
   - 规范化 = 固定属性序、固定小数精度、幂等的 canonical 文本；不合并 path、不改 id。
   - 优化 = 保守清洗：内联 `<style>` 类选择器与行内 style、清 Illustrator 元数据、删空容器/未引用 defs、压缩 `d/points` 空白。所有改动按 pass 列报告，可先预览再采用。
   - 批量 = 对全部资产跑同一套 pass，并做**视觉等价校验**（原始 vs 优化后各渲染一次，逐像素比较；强差异单独标记）。可下载 ZIP（仅含 `optimized/`）或**写回包**。
4. **手动编辑**：
   - 「选择」工具：拖拽元素移动；选中 `polygon` / `polyline` / `path` 后出现锚点，拖动锚点改几何（path 的贝塞尔控制点也能拖）。
   - 拖出 viewBox 的内容在编辑时不会被裁掉（虚线即导出边界）；导出仍按 viewBox 裁剪。点工具条的「扩展画布」会把 `viewBox` 扩到包含所有内容，拖出去的部分就能进成品。
   - 「钢笔」工具：点击加**角点**（直线段）；**按下并拖动**拉出对称贝塞尔手柄（曲线段）。`Enter` 结束，点首点闭合，`Esc` 取消，`Backspace` 删掉上一个点；画完自动切回选择工具，锚点和控制点可直接拖。
   - 「矩形 / 圆形」：在当前画布中心插入形状（逐次偏移，避免完全重叠）；如果先选中了一个 `<g>`（例如语义部件），形状会落进该组。
   - 颜色：填充/描边支持取色器、十六进制输入、`无`、常用色板；改色时若元素还带 `class`，会先自动内联 CSS，避免被样式表覆盖。
   - 渐变：新建线性渐变、应用到填充/描边、增删停靠点、改颜色/位置/方向。
5. **LLM 闭环**：
   - 「结构」页给出不含 path 数据的 digest（树 + 元素计数 + 关键属性）；
   - 「补丁」页应用 JSON 补丁（`setAttr` / `translate` / `reorder` / `add` / `remove` / `replacePath` / `moveAnchor` / `moveHandle` / `setGradient` / `group` / `ungroup`），逐条返回机器可读错误；
   - 「提示词」页生成带硬约束、digest、当前源码的完整提示词，复制给任意 LLM，拿回补丁数组再粘回来。

### 从零新建 SVG

左栏「＋ 新建 SVG」：填宽高、可选白底，点「新建画布」。它会生成一份 canonical 空文档：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect id="bg" x="0" y="0" width="400" height="300" fill="#ffffff"/>
</svg>
```

之后用钢笔/矩形/圆形往上画，改颜色、渐变、锚点，下载或写回包即可。实现上它和「打开一个文件」走同一条管线：`createNewSvg()` 造文本 → `loadText()` 当作一个本地资产 → 后续所有编辑都是补丁 → canonical 文本。

### 语义层

「语义」页把「这是什么」显式写进 SVG。语义加在部件组上，不给每个面片起名：

```svg
<g id="hand" data-role="hand" data-label="手掌" aria-label="手掌">
  <g id="palm" data-role="palm" data-label="掌心" aria-label="掌心">
    <path id="facet-924bb0" .../>
  </g>
  <g id="thumb" data-role="thumb" data-label="拇指" data-synonyms="大拇指" aria-label="拇指">
    ...
  </g>
</g>
```

- `id`：机器寻址（稳定、唯一、ASCII）；
- `data-role`：受控词表（hand / palm / thumb / finger / wrist / body / wing / head / handle / blade / frame / ornament / background / text / logo / part …）；
- `data-label`：中文/自由文本；`data-synonyms`：同义词（`|` 分隔）；
- `aria-label`：可访问性；`<title>` 可选。

**语义计划**：

```json
{
  "version": 1,
  "kind": "hand",
  "parts": [
    { "id": "hand", "role": "hand", "label": "手掌" },
    { "id": "palm", "role": "palm", "label": "掌心", "parent": "hand", "required": true },
    { "id": "thumb", "role": "thumb", "label": "拇指", "synonyms": ["大拇指"], "parent": "hand" }
  ]
}
```

「应用计划」后会建/补 `<g>`；空组只给警告，提示“可以继续往里填几何”。点击部件行里的 `#id` 选中该组，再用钢笔/矩形/圆形往里画。

- **指纹**：`id|role|label|parent` 的哈希；只改几何不会变，增删/改名才变。
- **语义 diff**：区分「仅几何变化」与「部件增删/改名」。
- **自然语言 → id**：提示词里带部件的 label/synonyms，模型可以把“把拇指加长”落成 `#thumb`，再用 `moveAnchor` / `replacePath`。
- 语义属性是**保留名单**：`strip-editor`/`stable-ids`/`remove-empty`/`strip-title` 不会清掉它们。

完整方案稿见 `artifacts/svg-semantic-plan.md`；测试计划样例见 `artifacts/semantics-hand-plan.json`。

### 稳定 id

「诊断 → 元素 id 缺失或不稳定」可以一次改成稳定 id：

- 已有语义 id 保留；
- `data-name` 派生成 `wing-left` / `layer-2`；
- 匿名节点用几何哈希 `facet-924bb0`（重排不变，改形状才变）；
- `url(#…)`、`href`、`aria-labelledby`、`begin="id.…"` 和 `<style>` 里的引用同步改写。

批量的「处理」下拉也有对应模式：**仅规范化 / 仅稳定 id / 规范化+优化 / 优化+稳定 id**。

### 让 git diff 可读

SVG 是文本，仓库的 `.gitattributes` 已经声明 `* text=auto eol=lf`；真正让 diff 不可读的是「一行导出」的写法。

1. **长期做法：提交 canonical 文本。** 工作台「规范化 / 优化」后的文件每个元素一行、属性顺序固定、精度固定，`git diff` 会按元素和属性显示；再用「下载写回包」+ `scripts/svg_writeback.py` 落盘。
2. **过渡做法：给旧文件配 textconv**（只影响 diff 显示，不改文件）：

   ```bash
   sh scripts/setup-svg-diff.sh
   ```

   脚本设置 `diff.svg.textconv`，配合 `.gitattributes` 里的 `*.svg diff=svg`。path 会按命令拆行、base64 会截断，所以改一个点只显示一行，而不是整条 `d`。
3. **只看单条 path 的改动**：`git diff --word-diff=color -- path/to/file.svg`。
4. **视觉确认**：`git difftool` 用你惯用的对比工具；或者把两个版本分别载入 `/svg`，用「当前 / 优化后」对比。

textconv 只用于 `git diff` / `git log -p` 的显示，不参与合并，也不会改动工作区文件。

### 批量写回

页面「批量 → 下载写回包」（或展开「写回包 JSON」直接复制）得到 `svg-writeback.json`，然后在仓库根目录：

```bash
python scripts/svg_writeback.py ~/Downloads/svg-writeback.json --dry-run
python scripts/svg_writeback.py ~/Downloads/svg-writeback.json
```

脚本只依赖标准库：按「原文件大小 + CRC32」校验磁盘内容，冲突默认跳过，写入前留 `.bak`；同一文件第二次写回会留 `.bak.1`，不会覆盖第一次的原始备份。它不解析 SVG，优化仍在浏览器里完成。

> 本仓库已经用这套流程做过两轮：先「仅规范化」写回 53 个文件，再「仅稳定 id」写回一轮；两次视觉校验都是 53/53 一致。`view/public/**/*.svg.bak*` 是本地备份，已加入 `.gitignore`，确认后可以删。

实现分层（`src/app/svg/`）：

| 文件 | 职责 |
| --- | --- |
| `core/svg-doc.ts` | 解析、canonical 序列化、统计、digest |
| `core/svg-path.ts` | 可编辑路径模型：绝对命令、锚点、序列化 |
| `core/svg-gradient.ts` | 渐变读取、创建、停靠点与方向 |
| `core/svg-optimize.ts` | 保守优化 pass 管线（含 CSS 内联） |
| `core/svg-analyze.ts` | 诊断 finding |
| `core/svg-semantics.ts` | 语义计划、角色词表、指纹、语义 diff、校验、短语检索 |
| `core/svg-context.ts` | LLM 上下文包（约束/语义/digest/选中/op/源码） |
| `core/svg-patch.ts` | LLM 补丁协议与校验 |
| `svg-semantics-panel.ts` | 语义面板（计划导入、部件、指纹、diff、问题） |
| `core/svg-render.ts` | 视觉等价校验（光栅化 + 像素比较） |
| `core/svg-batch.ts` | 批量执行与报告 |
| `core/svg-zip.ts` | 无依赖 ZIP 写入（store） |
| `core/svg-sanitize.ts` | 预览前清洗（脚本/事件/外链） |
| `svg-stage.ts` | 渲染舞台：缩放、选中、拖拽、锚点、钢笔 |
| `svg-workbench.ts` | 状态、动作、面板 |

新增资产目录时，在 `scripts/svg-index.mjs` 的 `GROUPS` 里加一项即可。
