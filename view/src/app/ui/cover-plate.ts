import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { coverMeta } from '../core/cover';
import type { CoverInput, CoverMeta } from '../core/cover';
import { FAMILY_TONE, FAMILY_TONE_DARK, NEUTRAL_TONE, NEUTRAL_TONE_DARK } from '../core/model-tone';

/**
 * 兜底封面铭牌：整块只有一层。
 *
 * 旧版是上下两截——上截家族色带 + 出血圆、下截 40px 家族码 + 规格行。
 * 一屏看下来每张卡都是「上面一块色、下面一块字」，而且卡片被撑到 300px 以上。
 * 现在合成一张海报：
 *
 *   背景层  真实封面图（有就铺满）或生成构图（5 种变体，按 name 稳定哈希选）
 *   蒙版层  上下两道渐变，保证贴在图上的字在任何照片上都读得出来
 *   内容层  左上 [厂牌标] 厂牌名 · 参数量 · 量化   右上 [文件形态]
 *
 * 为什么背景必须多一种：家族色只有 9 桶，一屏 20 张卡必然撞色。真正让两张卡不像
 * 同一张的是构图落点，不是色相。变体只由 name 哈希决定，不掺下载量那类会变的字段——
 * 封面随统计漂移，识别价值就归零了。
 *
 * 厂牌名从 40px 降到 11px 并挪到标后面：卡片里真正的大字应该是模型名（在卡片正文里），
 * 铭牌只负责「这是哪个家族、什么规格、什么文件形态」，字号不该跟模型名抢。
 *
 * 品牌槽位仍是 20px 固定格，有官方资产显示 <img>，没有显示自绘标记，版式不跳。
 * 官方标只在这个槽位出现，绝不放大做背景——那会从「指称该模型」变成「拿它装饰界面」。
 * 图片背景上给标加白底：各家规范都要求标不要压在不透明度的未知背景上，白底是最稳的解法，
 * 也不涉及改色（白底上继续用原本给浅色用的那版资产）。
 *
 * 颜色写成家族类 × 明暗两套规则，不用行内 color-mix 绑定变量：
 * 组件里的 CSS 自定义属性绑定在部分 Angular 版本上会被裁剪，静态类更稳。
 *
 * 家族色的**字面值只在 model-tone.ts 一份**（家族色单一出处），这里的类只做
 * 「家族 id → CSS 变量」的映射，用模板字面量插值取过来 —— 编译后与手写字面值
 * 逐字节一致，但改颜色只需改 model-tone.ts 一处。
 *
 * 实现上用 signal：`meta` 是 computed，图片的「已加载 / 已失败」记在**输入签名**上，
 * 签名一变状态自动作废 —— 等价于旧版 `ngOnChanges` 里的重置，但不需要手写生命周期。
 */
@Component({
  selector: 'app-cover-plate',
  host: {
    '[class.is-row]': 'size() === "row"',
    '[class.is-mini]': 'size() === "mini"',
    '[class.is-wide]': 'size() === "wide"',
    '[class.ratio-wide]': 'ratio() === "wide"',
    '[class.ratio-fill]': 'ratio() === "fill"',
    '[class.ratio-fixed]': 'ratio() === "fixed"',
  },
  template: `
    <div [class]="plateClass()" [attr.aria-label]="aria()">
      @if (meta().image; as image) {
        <!-- wide 是工作流列表的 132×88 缩略图：实测 loading="lazy" 时浏览器
             在页面没有滚动前根本不发起请求，首屏一排缩略图全是空白。列表最多
             几十行、一行一张图，直接 eager 更划算。 -->
        <img
          [class]="photoClass()"
          [src]="image"
          alt=""
          [attr.loading]="size() === 'wide' ? 'eager' : 'lazy'"
          decoding="async"
          referrerpolicy="no-referrer"
          (load)="onImgLoad($event)"
          (error)="onImgError()"
        />
      }
      <span class="motif"></span>
      <span class="dots"></span>
      @if (meta().code !== '—') {
        <span class="watermark">{{ meta().code }}</span>
      }
      <span class="scrim"></span>

      <div class="head">
        @if (meta().logo || meta().mark) {
          <span class="brand" [class.has-dark]="!!meta().logoDark">
            @if (meta().logo; as logo) {
              <img
                class="logo-light"
                [src]="logo"
                [alt]="meta().code"
                [style.--logo-scale]="meta().logoScale"
              />
              @if (meta().logoDark; as logoDark) {
                <img
                  class="logo-dark"
                  [src]="logoDark"
                  alt=""
                  aria-hidden="true"
                  [style.--logo-scale]="meta().logoScale"
                />
              }
            } @else {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                @if (meta().filled) {
                  <path [attr.d]="meta().mark" fill="currentColor" stroke="none" />
                } @else {
                  <path
                    [attr.d]="meta().mark"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
              </svg>
            }
          </span>
        } @else {
          @if (meta().publisher; as publisher) {
            <!-- 未登记家族：用发布方缩写兜底。文字本身就是「谁发的」，
                 不是装饰性占位符；方角细框与圆角/彩色的品牌标区分开。 -->
            <span
              class="brand mono"
              [title]="'未登记厂牌 · 发布方：' + publisher.label"
              [attr.aria-label]="'未登记厂牌，发布方 ' + publisher.label"
              >{{ publisher.abbr }}</span
            >
          }
        }

        @if (meta().code !== '—') {
          <span class="label">{{ meta().code }}</span>
        }
        @if (meta().byline; as byline) {
          <!-- 搬运标注：发布者不是家族官方时贴在家族码右侧 -->
          <span class="byline" [title]="'发布者：' + byline">{{ byline }}</span>
        }
        @if (specLine(); as specs) {
          <span class="specs">{{ specs }}</span>
        }

        @if (model().href; as href) {
          <a
            class="origin"
            [href]="href"
            target="_blank"
            rel="noreferrer"
            [title]="'打开 ' + (model().hrefLabel || '原站') + ' 原始页面'"
          >
            {{ model().hrefLabel }}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 2.5H2.5v7h7v-2" />
              <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
            </svg>
          </a>
        }
      </div>
    </div>
  `,
  styles: [
    `
      /* 高度由调用方给：要么绝对定位 inset:0，要么显式尺寸。
         这里曾经有 aspect-ratio: 4/3，结果在绝对定位的卡片里它压过了 inset——
         浏览器先按宽度算出 4:3 的高度（257.5 → 193.13），比卡片的 196 矮 2.9px，
         底部就露出一条 panel 色的缝。宽高都由外部决定时，就不要在组件里声明比例。 */
      :host {
        display: block;
      }
      :host(.is-row) {
        width: 76px;
        height: 56px;
      }
      /* 极小尺寸：只当「家族指纹」用，塞在表格的模型名前 */
      :host(.is-mini) {
        width: 40px;
        height: 30px;
        border-radius: 6px;
        overflow: hidden;
      }
      /* 列表缩略：工作流那种「左边一张图、右边一段字」的行 */
      :host(.is-wide) {
        width: 132px;
        height: 88px;
        border-radius: 8px;
        overflow: hidden;
      }
      :host(.is-wide) .head {
        padding: 9px 10px 0;
        gap: 6px;
      }

      /* ---- 比例参数（ratio） ----------------------------------------------
         size 决定「这块铭牌长什么样」（字号、留白、显示哪些行）；
         ratio 决定「这块铭牌占多大」。两者正交：size=wide 的 132×88 缩略图
         也可以配 ratio=fixed，size=card 的大卡也可以配 ratio=wide。

           ratio=wide  16:10，工作流卡片那种横版封面
           ratio=fill  不声明比例，宽高都由外部给（绝对定位铺满整卡）
           ratio=fixed 固定高 145px，模型库卡片那种「封面 + 正文」的上下分栏

         默认 auto = 现状行为（不声明任何比例，高度交给调用方）。
         刻意不写成 aspect-ratio 兜底：绝对定位的卡片里 aspect-ratio 会压过
         inset —— 浏览器先按宽度算出比例高度，比卡片矮一点，底部就露出一条缝。
         —— 那正是本组件 2024 年踩过的坑，注释还留在上面。 */
      :host(.ratio-wide) {
        aspect-ratio: 16 / 10;
      }
      /* ratio=fill：宽高都由外部决定，这里只保证不撑开。
         overflow:hidden 让内部绝对定位的构图不溢出。 */
      :host(.ratio-fill) {
        display: block;
        overflow: hidden;
      }
      /* ratio=fixed：固定高，宽度撑满 —— 对应「封面 145px + 正文」的上下分栏 */
      :host(.ratio-fixed) {
        display: block;
        height: 145px;
        overflow: hidden;
      }

      .plate {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        overflow: hidden;
        isolation: isolate;
        background: var(--plate-bg);
        color: var(--plate-ink);
      }

      /* 真实封面：裁切铺满。压暗交给 .scrim，图片本身不动——
         加 filter 会让同一张图在不同卡片里颜色不一致，那是编辑，不是排版。 */
      .photo {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 0;
      }

      .motif {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
      }

      /* 卡片尺寸的兜底封面：家族色 + 细点阵 + 家族码水印，与原型组件一致 */
      .dots,
      .watermark {
        display: none;
      }

      .plate.sz-card {
        background: linear-gradient(
          150deg,
          var(--plate-bg),
          color-mix(in srgb, var(--plate-bg) 58%, var(--plate-mark))
        );
      }

      .plate.sz-card .motif {
        display: none;
      }

      .plate.sz-card .dots {
        display: block;
        position: absolute;
        inset: 0;
        z-index: 0;
        opacity: .42;
        pointer-events: none;
        background-image:
          radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--plate-mark) 52%, transparent) 0 1.5px, transparent 2px),
          repeating-linear-gradient(135deg, color-mix(in srgb, var(--plate-mark) 16%, transparent) 0 1px, transparent 1px 18px);
        background-size: 16px 16px, auto;
        mask-image: linear-gradient(to bottom, #000 0%, #000 58%, transparent 88%);
      }

      .plate.sz-card .watermark {
        display: block;
        position: absolute;
        right: 10px;
        bottom: 84px;
        z-index: 0;
        color: var(--plate-strong);
        font: 700 40px/1 var(--ui-font-mono);
        letter-spacing: -.05em;
        opacity: .13;
        pointer-events: none;
      }

      .plate.sz-card .scrim {
        background: linear-gradient(
          to top,
          color-mix(in srgb, var(--ui-card-solid) 96%, transparent) 0%,
          color-mix(in srgb, var(--ui-card-solid) 88%, transparent) 40%,
          transparent 70%
        );
      }

      .plate.sz-card.on-shot .dots,
      .plate.sz-card.on-shot .watermark {
        display: none;
      }

      /* 视觉规范页：卡片尺寸但仍要展示纹样 */
      .plate.sz-card.show-motif .motif {
        display: block;
      }

      .plate.sz-card.show-motif .dots,
      .plate.sz-card.show-motif .watermark {
        display: none;
      }
      .motif::before,
      .motif::after {
        content: '';
        position: absolute;
      }

      /* 有照片时不再叠生成构图：图本身已经是背景，再盖一层圆环就成了「图案压在照片上」，
         既没有信息也不好看。变体只在没有照片时才存在。 */
      .plate.on-shot .motif {
        display: none;
      }

      /* 蒙版：上浅下深。上方只要压住照片的高光，下方要能把正文整块压下去，
         所以下沿直接给到近乎实色的底，正文永远落在稳定底色上，不赌照片内容。 */
      .scrim {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
        background: linear-gradient(
          to top,
          var(--plate-bg) 0%,
          color-mix(in oklab, var(--plate-bg) 88%, transparent) 28%,
          transparent 64%
        );
      }

      /* 文字压在照片上时整体翻白：--plate-* 一改，正文继承下去也一起翻。
         照片模式再叠一道顶部压暗，给厂牌名撑出对比度。 */
      .plate.on-shot {
        --plate-strong: var(--ui-on-primary);
        --plate-ink: color-mix(in oklab, var(--ui-on-primary) 76%, transparent);
        color: var(--plate-ink);
      }
      .plate.on-shot .scrim {
        background:
          linear-gradient(
            to bottom,
            color-mix(in oklab, var(--aurora-bg) 52%, transparent) 0%,
            transparent 34%
          ),
          linear-gradient(
            to top,
            color-mix(in oklab, var(--aurora-bg) 94%, transparent) 0%,
            color-mix(in oklab, var(--aurora-bg) 66%, transparent) 32%,
            transparent 72%
          );
      }

      /* 内容层：只有一行。厂牌名与规格同基线，形态角标推到最右。 */
      .head {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 11px 14px 0;
      }
      /* 照片上再加一道投影：顶部蒙版是渐变的，遇到高调照片（大面积亮区）会压不住，
         而投影只作用在笔画边缘，不改变整块明度 */
      .plate.on-shot .head {
        text-shadow: 0 1px 2px color-mix(in oklab, var(--aurora-bg) 55%, transparent);
      }

      /* 品牌槽位：20px 固定格。尺寸写死像素而不是 100%——全局样式里有对 svg 的宽度
         规则会覆盖百分比，实测会退化成 4px。padding 必须显式归零：styles.css 里
         应用头部有一条 .brand 的全局 padding 会漏进组件，把内容盒压成 6×4。 */
      .brand {
        position: relative;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        color: var(--plate-strong);
      }
      .brand svg,
      .brand img {
        display: block;
        flex: none;
        width: 20px;
        height: 20px;
        object-fit: contain;
      }
      .brand img {
        transform: scale(var(--logo-scale, 1));
      }
      /* 只有黑白标才备反白版。彩色 / 渐变资产（Qwen 紫、混元多色、MiniMax 渐变）
         没有深色版：深色主题下必须继续显示浅色版，否则整个厂标会消失。 */
      .brand.has-dark .logo-dark {
        display: none;
      }
      :host-context([data-theme='dark']) .brand.has-dark .logo-light {
        display: none;
      }
      :host-context([data-theme='dark']) .brand.has-dark .logo-dark {
        display: block;
      }

      /* 发布方缩写：1–3 个字符，中性色、方角细框。
         不做图形、不做随机色 —— 与官方品牌标保持明确的视觉距离。 */
      .brand.mono {
        width: 22px;
        border: 1px solid color-mix(in oklab, var(--plate-ink) 22%, transparent);
        border-radius: 3px;
        font:
          700 9px/1 'Cascadia Mono',
          Consolas,
          'JetBrains Mono',
          monospace;
        letter-spacing: 0.02em;
        color: var(--plate-ink);
        opacity: 0.82;
        white-space: nowrap;
      }

      /* 照片上没有可靠的底色，只压暗不够——给标垫一块白底。
         白底上必须用「给浅色用的那版」资产，所以下面把明暗切换在这里强行扳回来。 */
      .plate.on-shot .brand {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: color-mix(in oklab, var(--ui-on-primary) 94%, transparent);
        padding: 2px;
      }
      .plate.on-shot .brand svg,
      .plate.on-shot .brand img {
        width: 20px;
        height: 20px;
      }
      .plate.on-shot .brand .logo-light {
        display: block;
      }
      .plate.on-shot .brand .logo-dark {
        display: none;
      }

      /* 照片上的白底芯片：缩写必须用深色（深色主题下 --plate-ink 是浅色，
         直接继承会在白底上看不见）。芯片底恒为白，故用与主题无关的 --ink-ink
         派生描边 —— 两套主题下都压得住白底。 */
      .plate.on-shot .brand.mono {
        width: 22px;
        color: var(--ink-ink);
        border-color: color-mix(in oklab, var(--ink-ink) 18%, transparent);
      }

      .label {
        flex: none;
        font:
          600 11px/1 'Cascadia Mono',
          Consolas,
          'JetBrains Mono',
          monospace;
        letter-spacing: 0.08em;
        color: var(--plate-strong);
        white-space: nowrap;
      }

      /* 搬运标注：字号比家族码小一档、颜色更淡，不跟厂牌抢注意力；
         宽度封顶后截断 —— 发布者名可能很长（WarmBloodAban 这类），
         宁可省略也不能把规格和「原站」挤出这一行。 */
      /* 与家族码之间用一个中点隔开：两者字号/字重相近，不留分隔会读成「SD3Comfy-Org」。 */
      .byline::before {
        content: '·';
        margin: 0 3px 0 1px;
        opacity: 0.55;
      }

      .byline {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 96px;
        font:
          500 10px/1 'Cascadia Mono',
          Consolas,
          'JetBrains Mono',
          monospace;
        color: var(--plate-ink);
        opacity: 0.78;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 规格跟在同一行，用点隔开。旧版这三条各占一行高，加起来就是卡片高出来的那截 */
      .specs {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font:
          400 11px/1 'Cascadia Mono',
          Consolas,
          'JetBrains Mono',
          monospace;
        color: var(--plate-ink);
        white-space: nowrap;
        opacity: 0.9;
      }
      .specs::before {
        content: '·';
        margin: 0 5px;
        opacity: 0.7;
      }

      /* 右上角：直接跳回模型原站。
         格式角标（SAFE/GGUF）已删除 —— 信息量低，而且 SAFE 很容易被误读成
         「安全 / SFW」。原站链接是这张卡真正需要的出口。 */
      .origin {
        flex: none;
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 18px;
        padding: 0 6px;
        border-radius: 4px;
        background: color-mix(in oklab, var(--plate-mark) 42%, var(--plate-bg));
        color: var(--plate-strong);
        font:
          600 10px/1 'Cascadia Mono',
          Consolas,
          'JetBrains Mono',
          monospace;
        letter-spacing: 0.04em;
        text-decoration: none;
        white-space: nowrap;
        transition:
          background 0.14s ease,
          color 0.14s ease;
      }
      .origin svg {
        width: 9px;
        height: 9px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .origin:hover {
        background: color-mix(in oklab, var(--plate-mark) 62%, var(--plate-bg));
        color: var(--plate-strong);
      }
      .plate.on-shot .origin {
        background: color-mix(in oklab, var(--ui-on-primary) 18%, transparent);
        color: var(--ui-on-primary);
        backdrop-filter: blur(6px);
      }
      .plate.on-shot .origin:hover {
        background: color-mix(in oklab, var(--ui-on-primary) 28%, transparent);
        color: var(--ui-on-primary);
      }

      /* ── 背景构图：5 种变体 ──────────────────────────────────────────
         全部只用 --plate-mark 派生，所以每个家族自动带上自己的颜色；
         全部只占上半部，下半部留给正文，不跟文字抢。
         变体之间的差别必须一眼能认出来，否则加了等于没加。 */

      /* 0 出血圆：右上角一颗压出画面的实心圆 + 一道细环。
         硬边在这里是对的——圆的边是「图形」，直线的边会被读成「裁切错误」。 */
      .mo-0 .motif::before {
        right: -28%;
        top: -44%;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        background: color-mix(in oklab, var(--plate-mark) 30%, transparent);
      }
      .mo-0 .motif::after {
        right: 10%;
        top: 24%;
        width: 44%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklab, var(--plate-mark) 46%, transparent);
      }

      /* 1 斜纹：等宽斜条横贯整块。做成一整片斜带会像折痕——条状才是图案 */
      .mo-1 .motif::before {
        inset: 0;
        background: repeating-linear-gradient(
          -58deg,
          color-mix(in oklab, var(--plate-mark) 17%, transparent) 0 12px,
          transparent 12px 38px
        );
        -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 30%, transparent 60%);
        mask-image: linear-gradient(to bottom, #000 0%, #000 30%, transparent 60%);
      }
      .mo-1 .motif::after {
        display: none;
      }

      /* 2 同心环：圆心落在左上出血点，两道环往外荡 */
      .mo-2 .motif::before {
        left: -22%;
        top: -74%;
        width: 96%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklab, var(--plate-mark) 40%, transparent);
        box-shadow: 0 0 0 20px color-mix(in oklab, var(--plate-mark) 12%, transparent);
      }
      .mo-2 .motif::after {
        left: -2%;
        top: -46%;
        width: 54%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1px solid color-mix(in oklab, var(--plate-mark) 26%, transparent);
      }

      /* 3 点阵：印刷网点，往下渐隐。是所有变体里最安静的一种 */
      .mo-3 .motif::before {
        inset: 0;
        background-image: radial-gradient(
          circle,
          color-mix(in oklab, var(--plate-mark) 52%, transparent) 1.1px,
          transparent 1.4px
        );
        background-size: 6px 6px;
        -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 28%, transparent 60%);
        mask-image: linear-gradient(to bottom, #000 0%, #000 28%, transparent 60%);
      }
      .mo-3 .motif::after {
        display: none;
      }

      /* 4 双光斑：两团无边的柔光，一冷一暖地压住上下两个角。
         它是唯一没有硬边的变体，远看像打了光，适合做「安静但不空」的那一档 */
      .mo-4 .motif::before {
        inset: 0;
        background:
          radial-gradient(
            62% 72% at 10% 0%,
            color-mix(in oklab, var(--plate-mark) 40%, transparent),
            transparent 70%
          ),
          radial-gradient(
            52% 62% at 98% 30%,
            color-mix(in oklab, var(--plate-mark) 26%, transparent),
            transparent 72%
          );
      }
      .mo-4 .motif::after {
        display: none;
      }

      /* 深色下同一个百分比会更抢——mark 在深底上是「提亮」，方向反过来，同样的 30%
         看起来比浅色重一档。在这里统一压一格，不用逐个变体改数字，也不会漏掉新加的。 */
      :host-context([data-theme='dark']) .motif {
        opacity: 0.66;
      }
      /* 斜纹是唯一「重复图案」型变体，压一档还不够：近黑底上的规则条纹会被读成
         渲染毛刺。把条距拉开、浓度再降，让它退成一层布纹而不是一张网点图。 */
      :host-context([data-theme='dark']) .mo-1 .motif::before {
        background: repeating-linear-gradient(
          -58deg,
          color-mix(in oklab, var(--plate-mark) 13%, transparent) 0 12px,
          transparent 12px 44px
        );
      }

      /* 行内小尺寸：76×56 只够放「标 + 厂牌名」，其余全收 */
      .plate.sz-row {
        width: 100%;
        height: 100%;
      }
      .plate.sz-row .head {
        padding: 0 8px;
        height: 100%;
        gap: 6px;
      }
      .plate.sz-row .motif,
      .plate.sz-row .scrim {
        display: none;
      }
      .plate.sz-row .origin,
      .plate.sz-row .specs {
        display: none;
      }
      .plate.sz-row .brand {
        width: 15px;
        height: 15px;
      }
      .plate.sz-row .brand svg,
      .plate.sz-row .brand img {
        width: 15px;
        height: 15px;
      }
      .plate.sz-row .label {
        font-size: 10px;
        letter-spacing: 0.04em;
      }

      /* 列表缩略图上有图时，顶行字与蒙版都收掉：132×88 的图只用来认「长什么样」，
         再压一层渐变和字就只剩糊。没有图时保留顶行，否则那块就是一个哑色方块。 */
      .plate.sz-wide.on-shot .head,
      .plate.sz-wide.on-shot .scrim {
        display: none;
      }

      /* 极小尺寸：只留品牌标和构图，文字全收。40×30 放不下第二行字，
         硬塞进去只会变成一坨噪点。 */
      .plate.sz-mini .scrim {
        display: none;
      }
      .plate.sz-mini .head {
        padding: 0;
        height: 100%;
        justify-content: center;
      }
      .plate.sz-mini .label,
      .plate.sz-mini .specs,
      .plate.sz-mini .origin {
        display: none;
      }
      .plate.sz-mini .brand {
        width: 16px;
        height: 16px;
      }
      .plate.sz-mini .brand svg,
      .plate.sz-mini .brand img {
        width: 16px;
        height: 16px;
      }

      /* 家族色板：色值只在 model-tone.ts 定义一份（家族色单一出处）。
         这里只负责把「家族 id → 家族色」映射到 CSS 变量。

         色相在这里定死，不按 id 哈希取。撞色不可避免（16 个家族、一屏十来张卡）
         ——身份由家族码承担，颜色只做分组。 */
      .f-flux {
        --plate-bg: ${FAMILY_TONE['flux'].bg};
        --plate-ink: ${FAMILY_TONE['flux'].ink};
        --plate-strong: ${FAMILY_TONE['flux'].strong};
        --plate-mark: ${FAMILY_TONE['flux'].mark};
      }
      .f-wan {
        --plate-bg: ${FAMILY_TONE['wan'].bg};
        --plate-ink: ${FAMILY_TONE['wan'].ink};
        --plate-strong: ${FAMILY_TONE['wan'].strong};
        --plate-mark: ${FAMILY_TONE['wan'].mark};
      }
      .f-sdxl {
        --plate-bg: ${FAMILY_TONE['sdxl'].bg};
        --plate-ink: ${FAMILY_TONE['sdxl'].ink};
        --plate-strong: ${FAMILY_TONE['sdxl'].strong};
        --plate-mark: ${FAMILY_TONE['sdxl'].mark};
      }
      .f-sd15 {
        --plate-bg: ${FAMILY_TONE['sd15'].bg};
        --plate-ink: ${FAMILY_TONE['sd15'].ink};
        --plate-strong: ${FAMILY_TONE['sd15'].strong};
        --plate-mark: ${FAMILY_TONE['sd15'].mark};
      }
      .f-pony {
        --plate-bg: ${FAMILY_TONE['pony'].bg};
        --plate-ink: ${FAMILY_TONE['pony'].ink};
        --plate-strong: ${FAMILY_TONE['pony'].strong};
        --plate-mark: ${FAMILY_TONE['pony'].mark};
      }
      .f-hunyuan {
        --plate-bg: ${FAMILY_TONE['hunyuan'].bg};
        --plate-ink: ${FAMILY_TONE['hunyuan'].ink};
        --plate-strong: ${FAMILY_TONE['hunyuan'].strong};
        --plate-mark: ${FAMILY_TONE['hunyuan'].mark};
      }
      .f-ltx {
        --plate-bg: ${FAMILY_TONE['ltx'].bg};
        --plate-ink: ${FAMILY_TONE['ltx'].ink};
        --plate-strong: ${FAMILY_TONE['ltx'].strong};
        --plate-mark: ${FAMILY_TONE['ltx'].mark};
      }
      .f-qwen {
        --plate-bg: ${FAMILY_TONE['qwen'].bg};
        --plate-ink: ${FAMILY_TONE['qwen'].ink};
        --plate-strong: ${FAMILY_TONE['qwen'].strong};
        --plate-mark: ${FAMILY_TONE['qwen'].mark};
      }
      .f-minimax {
        --plate-bg: ${FAMILY_TONE['minimax'].bg};
        --plate-ink: ${FAMILY_TONE['minimax'].ink};
        --plate-strong: ${FAMILY_TONE['minimax'].strong};
        --plate-mark: ${FAMILY_TONE['minimax'].mark};
      }
      .f-krea {
        --plate-bg: ${FAMILY_TONE['krea'].bg};
        --plate-ink: ${FAMILY_TONE['krea'].ink};
        --plate-strong: ${FAMILY_TONE['krea'].strong};
        --plate-mark: ${FAMILY_TONE['krea'].mark};
      }
      .f-zimage {
        --plate-bg: ${FAMILY_TONE['zimage'].bg};
        --plate-ink: ${FAMILY_TONE['zimage'].ink};
        --plate-strong: ${FAMILY_TONE['zimage'].strong};
        --plate-mark: ${FAMILY_TONE['zimage'].mark};
      }
      .f-hidream {
        --plate-bg: ${FAMILY_TONE['hidream'].bg};
        --plate-ink: ${FAMILY_TONE['hidream'].ink};
        --plate-strong: ${FAMILY_TONE['hidream'].strong};
        --plate-mark: ${FAMILY_TONE['hidream'].mark};
      }
      .f-ernie {
        --plate-bg: ${FAMILY_TONE['ernie'].bg};
        --plate-ink: ${FAMILY_TONE['ernie'].ink};
        --plate-strong: ${FAMILY_TONE['ernie'].strong};
        --plate-mark: ${FAMILY_TONE['ernie'].mark};
      }
      .f-noobai {
        --plate-bg: ${FAMILY_TONE['noobai'].bg};
        --plate-ink: ${FAMILY_TONE['noobai'].ink};
        --plate-strong: ${FAMILY_TONE['noobai'].strong};
        --plate-mark: ${FAMILY_TONE['noobai'].mark};
      }
      .f-illustrious {
        --plate-bg: ${FAMILY_TONE['illustrious'].bg};
        --plate-ink: ${FAMILY_TONE['illustrious'].ink};
        --plate-strong: ${FAMILY_TONE['illustrious'].strong};
        --plate-mark: ${FAMILY_TONE['illustrious'].mark};
      }
      .f-chroma {
        --plate-bg: ${FAMILY_TONE['chroma'].bg};
        --plate-ink: ${FAMILY_TONE['chroma'].ink};
        --plate-strong: ${FAMILY_TONE['chroma'].strong};
        --plate-mark: ${FAMILY_TONE['chroma'].mark};
      }
      .f-sd3 {
        --plate-bg: ${FAMILY_TONE['sd3'].bg};
        --plate-ink: ${FAMILY_TONE['sd3'].ink};
        --plate-strong: ${FAMILY_TONE['sd3'].strong};
        --plate-mark: ${FAMILY_TONE['sd3'].mark};
      }
      .f-cogvideo {
        --plate-bg: ${FAMILY_TONE['cogvideo'].bg};
        --plate-ink: ${FAMILY_TONE['cogvideo'].ink};
        --plate-strong: ${FAMILY_TONE['cogvideo'].strong};
        --plate-mark: ${FAMILY_TONE['cogvideo'].mark};
      }
      .f-kolors {
        --plate-bg: ${FAMILY_TONE['kolors'].bg};
        --plate-ink: ${FAMILY_TONE['kolors'].ink};
        --plate-strong: ${FAMILY_TONE['kolors'].strong};
        --plate-mark: ${FAMILY_TONE['kolors'].mark};
      }
      .f-mochi {
        --plate-bg: ${FAMILY_TONE['mochi'].bg};
        --plate-ink: ${FAMILY_TONE['mochi'].ink};
        --plate-strong: ${FAMILY_TONE['mochi'].strong};
        --plate-mark: ${FAMILY_TONE['mochi'].mark};
      }
      .f-lumina {
        --plate-bg: ${FAMILY_TONE['lumina'].bg};
        --plate-ink: ${FAMILY_TONE['lumina'].ink};
        --plate-strong: ${FAMILY_TONE['lumina'].strong};
        --plate-mark: ${FAMILY_TONE['lumina'].mark};
      }
      .f-skyreels {
        --plate-bg: ${FAMILY_TONE['skyreels'].bg};
        --plate-ink: ${FAMILY_TONE['skyreels'].ink};
        --plate-strong: ${FAMILY_TONE['skyreels'].strong};
        --plate-mark: ${FAMILY_TONE['skyreels'].mark};
      }
      .f-kandinsky {
        --plate-bg: ${FAMILY_TONE['kandinsky'].bg};
        --plate-ink: ${FAMILY_TONE['kandinsky'].ink};
        --plate-strong: ${FAMILY_TONE['kandinsky'].strong};
        --plate-mark: ${FAMILY_TONE['kandinsky'].mark};
      }
      .f-playground {
        --plate-bg: ${FAMILY_TONE['playground'].bg};
        --plate-ink: ${FAMILY_TONE['playground'].ink};
        --plate-strong: ${FAMILY_TONE['playground'].strong};
        --plate-mark: ${FAMILY_TONE['playground'].mark};
      }
      .f-pixart {
        --plate-bg: ${FAMILY_TONE['pixart'].bg};
        --plate-ink: ${FAMILY_TONE['pixart'].ink};
        --plate-strong: ${FAMILY_TONE['pixart'].strong};
        --plate-mark: ${FAMILY_TONE['pixart'].mark};
      }

      /* other：中性兜底色（认不出家族），不属于家族色板 —— 取值直接来自
         model-tone.ts 的 NEUTRAL_TONE，色值仍然只有一份。 */
      .f-other {
        --plate-bg: ${NEUTRAL_TONE.bg};
        --plate-ink: ${NEUTRAL_TONE.ink};
        --plate-strong: ${NEUTRAL_TONE.strong};
        --plate-mark: ${NEUTRAL_TONE.mark};
      }

      :host-context([data-theme='dark']) .f-flux {
        --plate-bg: ${FAMILY_TONE_DARK['flux'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['flux'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['flux'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['flux'].mark};
      }
      :host-context([data-theme='dark']) .f-wan {
        --plate-bg: ${FAMILY_TONE_DARK['wan'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['wan'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['wan'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['wan'].mark};
      }
      :host-context([data-theme='dark']) .f-sdxl {
        --plate-bg: ${FAMILY_TONE_DARK['sdxl'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['sdxl'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['sdxl'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['sdxl'].mark};
      }
      :host-context([data-theme='dark']) .f-sd15 {
        --plate-bg: ${FAMILY_TONE_DARK['sd15'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['sd15'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['sd15'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['sd15'].mark};
      }
      :host-context([data-theme='dark']) .f-pony {
        --plate-bg: ${FAMILY_TONE_DARK['pony'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['pony'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['pony'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['pony'].mark};
      }
      :host-context([data-theme='dark']) .f-hunyuan {
        --plate-bg: ${FAMILY_TONE_DARK['hunyuan'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['hunyuan'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['hunyuan'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['hunyuan'].mark};
      }
      :host-context([data-theme='dark']) .f-ltx {
        --plate-bg: ${FAMILY_TONE_DARK['ltx'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['ltx'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['ltx'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['ltx'].mark};
      }
      :host-context([data-theme='dark']) .f-qwen {
        --plate-bg: ${FAMILY_TONE_DARK['qwen'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['qwen'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['qwen'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['qwen'].mark};
      }
      :host-context([data-theme='dark']) .f-minimax {
        --plate-bg: ${FAMILY_TONE_DARK['minimax'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['minimax'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['minimax'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['minimax'].mark};
      }
      :host-context([data-theme='dark']) .f-krea {
        --plate-bg: ${FAMILY_TONE_DARK['krea'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['krea'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['krea'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['krea'].mark};
      }
      :host-context([data-theme='dark']) .f-zimage {
        --plate-bg: ${FAMILY_TONE_DARK['zimage'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['zimage'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['zimage'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['zimage'].mark};
      }
      :host-context([data-theme='dark']) .f-hidream {
        --plate-bg: ${FAMILY_TONE_DARK['hidream'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['hidream'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['hidream'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['hidream'].mark};
      }
      :host-context([data-theme='dark']) .f-ernie {
        --plate-bg: ${FAMILY_TONE_DARK['ernie'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['ernie'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['ernie'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['ernie'].mark};
      }
      :host-context([data-theme='dark']) .f-noobai {
        --plate-bg: ${FAMILY_TONE_DARK['noobai'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['noobai'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['noobai'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['noobai'].mark};
      }
      :host-context([data-theme='dark']) .f-illustrious {
        --plate-bg: ${FAMILY_TONE_DARK['illustrious'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['illustrious'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['illustrious'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['illustrious'].mark};
      }
      :host-context([data-theme='dark']) .f-chroma {
        --plate-bg: ${FAMILY_TONE_DARK['chroma'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['chroma'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['chroma'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['chroma'].mark};
      }
      :host-context([data-theme='dark']) .f-sd3 {
        --plate-bg: ${FAMILY_TONE_DARK['sd3'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['sd3'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['sd3'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['sd3'].mark};
      }
      :host-context([data-theme='dark']) .f-cogvideo {
        --plate-bg: ${FAMILY_TONE_DARK['cogvideo'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['cogvideo'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['cogvideo'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['cogvideo'].mark};
      }
      :host-context([data-theme='dark']) .f-kolors {
        --plate-bg: ${FAMILY_TONE_DARK['kolors'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['kolors'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['kolors'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['kolors'].mark};
      }
      :host-context([data-theme='dark']) .f-mochi {
        --plate-bg: ${FAMILY_TONE_DARK['mochi'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['mochi'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['mochi'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['mochi'].mark};
      }
      :host-context([data-theme='dark']) .f-lumina {
        --plate-bg: ${FAMILY_TONE_DARK['lumina'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['lumina'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['lumina'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['lumina'].mark};
      }
      :host-context([data-theme='dark']) .f-skyreels {
        --plate-bg: ${FAMILY_TONE_DARK['skyreels'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['skyreels'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['skyreels'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['skyreels'].mark};
      }
      :host-context([data-theme='dark']) .f-kandinsky {
        --plate-bg: ${FAMILY_TONE_DARK['kandinsky'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['kandinsky'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['kandinsky'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['kandinsky'].mark};
      }
      :host-context([data-theme='dark']) .f-playground {
        --plate-bg: ${FAMILY_TONE_DARK['playground'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['playground'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['playground'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['playground'].mark};
      }
      :host-context([data-theme='dark']) .f-pixart {
        --plate-bg: ${FAMILY_TONE_DARK['pixart'].bg};
        --plate-ink: ${FAMILY_TONE_DARK['pixart'].ink};
        --plate-strong: ${FAMILY_TONE_DARK['pixart'].strong};
        --plate-mark: ${FAMILY_TONE_DARK['pixart'].mark};
      }

      :host-context([data-theme='dark']) .f-other {
        --plate-bg: ${NEUTRAL_TONE_DARK.bg};
        --plate-ink: ${NEUTRAL_TONE_DARK.ink};
        --plate-strong: ${NEUTRAL_TONE_DARK.strong};
        --plate-mark: ${NEUTRAL_TONE_DARK.mark};
      }
    `,
  ],
})
export class CoverPlateComponent {
  /** 铭牌的输入模型：名称、标签、原站链接、封面图 */
  readonly model = input.required<CoverInput>();

  /** 形态：card 是卡片大图；row / mini / wide 是列表里的三种缩略尺寸 */
  readonly size = input<'card' | 'row' | 'mini' | 'wide'>('card');

  /**
   * 封面比例。与 size 正交：size 管「长什么样」，ratio 管「占多大」。
   *
   * - `auto`（默认）现状行为：不声明比例，宽高由调用方给
   * - `wide` 16:10 横版 —— 工作流卡片
   * - `fill` 铺满 —— 绝对定位撑满整张卡
   * - `fixed` 固定高 145px —— 「封面 + 正文」上下分栏
   */
  readonly ratio = input<'auto' | 'wide' | 'fill' | 'fixed'>('auto');

  /** 强制指定纹样变体（仅视觉规范页使用；缺省按模型名稳定哈希） */
  readonly motif = input<number | null>(null);

  /** 卡片尺寸下也显示纹样（视觉规范页与封面展示用） */
  readonly showMotif = input(false);

  /**
   * 追加在封面图上的 class 名（空格分隔，可多个）。
   *
   * 为什么需要它：调用方有时要用固定选择器命中这张图 —— 工作流卡的 E2E 就靠
   * `app-workflow-card img.wc-cover-img` 认封面（换封面、选封面管理都断言它）。
   * CSS 没法给元素加 class，包一层容器也只会多一个壳、选择器照样命不中
   * （`img.wc-cover-img` 要求 class 落在 <img> 本身），所以只能由调用方指定。
   *
   * 追加而不是替换：`.photo` 的定位/裁切规则在组件自己的样式里，
   * 去掉它这张图就铺不满、也不会裁切了。
   */
  readonly imgClass = input('');

  /**
   * 照片是否真的显示出来了。
   *
   * 卡片正文压在铭牌上，有照片时正文要翻白、没照片时保持深色——但「有没有照片」
   * 只有这里知道（图会 401、会超时、会解码失败）。所以由铭牌把结论抛出去，
   * 别让外层拿 `image` 字段猜：猜错的后果是浅色铭牌上写白字，整张卡读不出来。
   */
  readonly shotState = output<boolean>();

  private readonly destroyRef = inject(DestroyRef);

  /**
   * 影响 `coverMeta` 的全部输入，拼成一个稳定的内容签名。
   *
   * 父组件每次变更检测都会传一个新的对象字面量进来（`[model]="plate"`），
   * 只认引用的话 meta 每帧都会重算，加载失败的图也会被重新挂回去，
   * 形成「报错→重算→再报错」的死循环。按内容签名比对，就能跳过「新对象、同内容」。
   */
  private readonly signature = computed(() => {
    const model = this.model();
    return [
      model.id ?? '',
      model.name,
      model.image ?? '',
      (model.tags ?? []).join(','),
      model.params ?? '',
      model.href ?? '',
      model.hrefLabel ?? '',
      model.author ?? '',
    ].join('|');
  });

  /** 只跟着签名走的模型快照：签名没变就复用上一份，不跟父组件的对象字面量起舞。 */
  private readonly snapshot = computed<CoverInput>(() => {
    this.signature();
    return untracked(this.model);
  });

  private readonly baseMeta = computed(() => coverMeta(this.snapshot()));

  /** 图片加载失败时的签名 —— 输入一变自动作废，等价于旧版 `meta.image = undefined` */
  private readonly failedFor = signal<string | null>(null);

  /** 图片加载成功时的签名 —— 输入一变自动回到「未加载」 */
  private readonly loadedFor = signal<string | null>(null);

  readonly meta = computed<CoverMeta>(() => {
    const meta = this.baseMeta();
    return this.failedFor() === this.signature() ? { ...meta, image: undefined } : meta;
  });

  /**
   * 照片是否**真的画出来了**，而不是「有没有图的 URL」。
   *
   * 两者必须分开：`loading="lazy"` 的图在滚动到之前根本不会请求，如果这时就按
   * 「有图」隐藏生成构图，卡片会变成一块没有任何图案的纯色——看起来像坏了。
   * 所以构图一直留着，等照片真的解码成功再让位。
   */
  private readonly onShot = computed(() => this.loadedFor() === this.signature());

  /** 当前要加载的封面地址；`undefined` 表示走生成构图 */
  private readonly imageSrc = computed(() => this.meta().image);

  readonly plateClass = computed(() => {
    const shot = this.onShot() ? ' on-shot' : '';
    const size = ` sz-${this.size()}`;
    const motif = this.motif() ?? this.meta().motif;
    const motifOn = this.showMotif() ? ' show-motif' : '';
    return `plate f-${this.meta().family} mo-${motif}${shot}${size}${motifOn}`;
  });

  /** 「12B · Q4_K_S」，竖线由 CSS 的 ::before 补，这里只管内容 */
  readonly specLine = computed(() =>
    this.meta()
      .specs.map((s) => s.v)
      .join(' · '),
  );

  /** 封面图的 class：`.photo` 永远在，调用方可以再追加自己的 */
  readonly photoClass = computed(() => (this.imgClass() ? `photo ${this.imgClass()}` : 'photo'));

  readonly aria = computed(() => {
    const meta = this.meta();
    return [meta.code, ...meta.specs.map((s) => `${s.k}${s.v}`), this.snapshot().hrefLabel || '']
      .filter(Boolean)
      .join(' ');
  });

  private imageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 换模型就重新计时：8 秒还没画出来就走生成构图。
    // Civitai 的图会 301 到 blobs CDN，没有代理时会一直挂着 —— 既不 load 也不 error，
    // 光有 error 回调处理不了，必须有个兜底超时。
    effect(() => {
      const src = this.imageSrc();
      this.clearImageTimer();
      if (!src) return;
      const armedFor = this.signature();
      this.imageTimer = setTimeout(() => {
        this.imageTimer = null;
        if (this.loadedFor() === armedFor || this.failedFor() === armedFor) return;
        this.failedFor.set(armedFor);
      }, 8000);
    });

    // 图片状态是在本组件的变更检测里定的，同步 emit 会让父组件的 `[class.on-shot]`
    // 在同一个周期被改动，dev 模式直接抛 ExpressionChangedAfterItHasBeenChecked。
    effect(() => {
      const shot = this.onShot();
      setTimeout(() => this.shotState.emit(shot));
    });

    this.destroyRef.onDestroy(() => this.clearImageTimer());
  }

  onImgLoad(event: Event): void {
    // HF 上的 gated 仓库会回 401/HTML，浏览器仍可能触发 load 而 naturalWidth 是 0；
    // 这种也算失败，否则卡片会变成一块没有任何构图的纯色。
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth) {
      this.onImgError();
      return;
    }
    this.clearImageTimer();
    this.loadedFor.set(this.signature());
  }

  /**
   * 远程缩略图最终没拿回来时退回生成构图。
   *
   * 不只是 404：Civitai 的图会 301 到 blobs CDN，那条链路在没有代理时会一直挂着，
   * 既不 load 也不 error——表现就是一个永远空着的方块。光有 error 回调处理不了这种情况，
   * 必须给一个超时。超时后立刻换成家族色构图，至少那一格还在传达信息。
   */
  onImgError(): void {
    this.clearImageTimer();
    this.failedFor.set(this.signature());
  }

  private clearImageTimer(): void {
    if (this.imageTimer !== null) {
      clearTimeout(this.imageTimer);
      this.imageTimer = null;
    }
  }
}
