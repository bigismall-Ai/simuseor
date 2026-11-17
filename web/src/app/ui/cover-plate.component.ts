import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, output } from '@angular/core';
import { CoverInput, CoverMeta, coverMeta } from '../core/cover';

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
 * 颜色写成 9 个家族类 × 明暗两套静态规则，不用行内 color-mix 绑定变量：
 * 组件里的 CSS 自定义属性绑定在部分 Angular 版本上会被裁剪，静态类更稳。
 */
@Component({
  selector: 'app-cover-plate',
  standalone: true,
  imports: [CommonModule],
  host: {
    '[class.is-row]': 'size === "row"',
    '[class.is-mini]': 'size === "mini"',
    '[class.is-wide]': 'size === "wide"',
  },
  template: `
    <div [class]="cls" [attr.aria-label]="aria">
      @if (meta.image) {
        <!-- wide 是工作流列表的 132×88 缩略图：实测 loading="lazy" 时浏览器
             在页面没有滚动前根本不发起请求，首屏一排缩略图全是空白。列表最多
             几十行、一行一张图，直接 eager 更划算。 -->
        <img
          class="photo"
          [src]="meta.image"
          alt=""
          [attr.loading]="size === 'wide' ? 'eager' : 'lazy'"
          decoding="async"
          referrerpolicy="no-referrer"
          (load)="onImgLoad($event)"
          (error)="onImgError()"
        />
      }
      <span class="motif"></span>
      <span class="scrim"></span>

      <div class="head">
        @if (meta.logo || meta.mark) {
          <span class="brand" [class.has-dark]="!!meta.logoDark">
            @if (meta.logo) {
              <img
                class="logo-light"
                [src]="meta.logo"
                [alt]="meta.code"
                [style.--logo-scale]="meta.logoScale"
              />
              @if (meta.logoDark) {
                <img
                  class="logo-dark"
                  [src]="meta.logoDark"
                  alt=""
                  aria-hidden="true"
                  [style.--logo-scale]="meta.logoScale"
                />
              }
            } @else {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                @if (meta.filled) {
                  <path [attr.d]="meta.mark" fill="currentColor" stroke="none" />
                } @else {
                  <path
                    [attr.d]="meta.mark"
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
        }

        @if (meta.code !== '—') {
          <span class="label">{{ meta.code }}</span>
        }
        @if (specLine) {
          <span class="specs">{{ specLine }}</span>
        }

        @if (model.href) {
          <a
            class="origin"
            [href]="model.href"
            target="_blank"
            rel="noreferrer"
            [title]="'打开 ' + (model.hrefLabel || '原站') + ' 原始页面'"
          >
            {{ model.hrefLabel }}
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
      :host(.is-wide) .head { padding: 9px 10px 0; gap: 6px; }

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
        --plate-strong: #ffffff;
        --plate-ink: rgba(255, 255, 255, 0.76);
        color: var(--plate-ink);
      }
      .plate.on-shot .scrim {
        background:
          linear-gradient(to bottom, rgba(8, 10, 16, 0.52) 0%, rgba(8, 10, 16, 0) 34%),
          linear-gradient(
            to top,
            rgba(8, 10, 16, 0.94) 0%,
            rgba(8, 10, 16, 0.66) 32%,
            rgba(8, 10, 16, 0) 72%
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
        text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
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

      /* 照片上没有可靠的底色，只压暗不够——给标垫一块白底。
         白底上必须用「给浅色用的那版」资产，所以下面把明暗切换在这里强行扳回来。 */
      .plate.on-shot .brand {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.94);
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

      .label {
        flex: none;
        font: 600 11px/1 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace;
        letter-spacing: 0.08em;
        color: var(--plate-strong);
        white-space: nowrap;
      }

      /* 规格跟在同一行，用点隔开。旧版这三条各占一行高，加起来就是卡片高出来的那截 */
      .specs {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font: 400 11px/1 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace;
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
        font: 600 10px/1 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace;
        letter-spacing: 0.04em;
        text-decoration: none;
        white-space: nowrap;
        transition: background 0.14s ease, color 0.14s ease;
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
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
        backdrop-filter: blur(6px);
      }
      .plate.on-shot .origin:hover {
        background: rgba(255, 255, 255, 0.28);
        color: #fff;
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
      .plate.sz-mini .scrim { display: none; }
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

      /* 家族色板：17 桶 × 明暗两套（16 个家族 + other）。色相在这里定死，不按 id 哈希取。
         撞色不可避免（16 个家族、一屏十来张卡）——身份由家族码承担，颜色只做分组。 */
      .f-flux {
        --plate-bg: #f1eefc;
        --plate-ink: #574f8c;
        --plate-strong: #3c3489;
        --plate-mark: #8f86d6;
      }
      .f-wan {
        --plate-bg: #e1f5ee;
        --plate-ink: #2f7563;
        --plate-strong: #085041;
        --plate-mark: #59b79f;
      }
      .f-sdxl {
        --plate-bg: #fbeaf0;
        --plate-ink: #95516b;
        --plate-strong: #72243e;
        --plate-mark: #d78aa6;
      }
      .f-sd15 {
        --plate-bg: #f1f3f4;
        --plate-ink: #5b6165;
        --plate-strong: #41474a;
        --plate-mark: #a3abaf;
      }
      .f-pony {
        --plate-bg: #fbebf6;
        --plate-ink: #8a4a74;
        --plate-strong: #6d2a55;
        --plate-mark: #d18cb8;
      }
      .f-hunyuan {
        --plate-bg: #e7f0fa;
        --plate-ink: #3a6291;
        --plate-strong: #14487a;
        --plate-mark: #8cb4de;
      }
      .f-ltx {
        --plate-bg: #ecf4e3;
        --plate-ink: #55703a;
        --plate-strong: #3a5a1e;
        --plate-mark: #9dbe7c;
      }
      .f-qwen {
        --plate-bg: #f7efdd;
        --plate-ink: #8b6421;
        --plate-strong: #633806;
        --plate-mark: #d3a862;
      }
      /* MiniMax：底色取官方渐变（#E21680 品红 → #FF633A 橙）的低饱和底，
         家族标识本身就是那个渐变，底色不能再抢。 */
      .f-minimax {
        --plate-bg: #fdeef3;
        --plate-ink: #9c3f68;
        --plate-strong: #6d2645;
        --plate-mark: #e88ab0;
      }
      .f-krea {
        --plate-bg: #e2f2f5;
        --plate-ink: #2c6d78;
        --plate-strong: #0d4a54;
        --plate-mark: #66b3bf;
      }
      .f-zimage {
        --plate-bg: #e9ebfa;
        --plate-ink: #464c8e;
        --plate-strong: #262a63;
        --plate-mark: #8d94d6;
      }
      .f-hidream {
        --plate-bg: #fdeae6;
        --plate-ink: #93503f;
        --plate-strong: #70301f;
        --plate-mark: #dda08c;
      }
      /* ERNIE：底色跟官方蓝走（#002F8E / #26AAFF），但压低饱和度，
         免得和 hunyuan 的蓝抢；品牌识别交给官方 symbol 本身。 */
      .f-ernie {
        --plate-bg: #e8edfc;
        --plate-ink: #2f4fa0;
        --plate-strong: #16306e;
        --plate-mark: #7f9ede;
      }
      .f-noobai {
        --plate-bg: #eef2df;
        --plate-ink: #67703c;
        --plate-strong: #474e1f;
        --plate-mark: #a8b477;
      }
      .f-illustrious {
        --plate-bg: #f3ebf7;
        --plate-ink: #7a4a8c;
        --plate-strong: #582866;
        --plate-mark: #b789c9;
      }
      .f-chroma {
        --plate-bg: #f7ece2;
        --plate-ink: #7d5a3a;
        --plate-strong: #5a3c1e;
        --plate-mark: #c39a72;
      }
      .f-other {
        --plate-bg: #f2f1ed;
        --plate-ink: #6b6a63;
        --plate-strong: #57564f;
        --plate-mark: #b3b2aa;
      }
      :host-context([data-theme='dark']) .f-flux {
        --plate-bg: #1e1b33;
        --plate-ink: #c3bcfa;
        --plate-strong: #ded9ff;
        --plate-mark: #8f86d6;
      }
      :host-context([data-theme='dark']) .f-wan {
        --plate-bg: #10241f;
        --plate-ink: #8fdfca;
        --plate-strong: #bdf2e2;
        --plate-mark: #59b79f;
      }
      :host-context([data-theme='dark']) .f-sdxl {
        --plate-bg: #2a1620;
        --plate-ink: #f2adc3;
        --plate-strong: #ffd2e0;
        --plate-mark: #d78aa6;
      }
      :host-context([data-theme='dark']) .f-sd15 {
        --plate-bg: #202326;
        --plate-ink: #a8b0b4;
        --plate-strong: #d3d9dc;
        --plate-mark: #a3abaf;
      }
      :host-context([data-theme='dark']) .f-pony {
        --plate-bg: #281626;
        --plate-ink: #f3b6df;
        --plate-strong: #ffd6ee;
        --plate-mark: #d18cb8;
      }
      :host-context([data-theme='dark']) .f-hunyuan {
        --plate-bg: #131f2c;
        --plate-ink: #9dcbf3;
        --plate-strong: #cce6ff;
        --plate-mark: #8cb4de;
      }
      :host-context([data-theme='dark']) .f-ltx {
        --plate-bg: #1b2313;
        --plate-ink: #b4d68a;
        --plate-strong: #d9efbb;
        --plate-mark: #9dbe7c;
      }
      :host-context([data-theme='dark']) .f-qwen {
        --plate-bg: #232220;
        --plate-ink: #eec48a;
        --plate-strong: #ffdfae;
        --plate-mark: #d3a862;
      }
      :host-context([data-theme='dark']) .f-minimax {
        --plate-bg: #2a1620;
        --plate-ink: #f0a3c1;
        --plate-strong: #ffc8dc;
        --plate-mark: #e88ab0;
      }
      :host-context([data-theme='dark']) .f-krea {
        --plate-bg: #10282c;
        --plate-ink: #8fd6e0;
        --plate-strong: #bdeef5;
        --plate-mark: #66b3bf;
      }
      :host-context([data-theme='dark']) .f-zimage {
        --plate-bg: #1a1b33;
        --plate-ink: #b0b6f2;
        --plate-strong: #d9dcff;
        --plate-mark: #8d94d6;
      }
      :host-context([data-theme='dark']) .f-hidream {
        --plate-bg: #2b1a15;
        --plate-ink: #f0b5a2;
        --plate-strong: #ffd6c7;
        --plate-mark: #dda08c;
      }
      :host-context([data-theme='dark']) .f-ernie {
        --plate-bg: #141d33;
        --plate-ink: #a8bdf0;
        --plate-strong: #d3e0ff;
        --plate-mark: #7f9ede;
      }
      :host-context([data-theme='dark']) .f-noobai {
        --plate-bg: #202415;
        --plate-ink: #c3cf95;
        --plate-strong: #e2ecc0;
        --plate-mark: #a8b477;
      }
      :host-context([data-theme='dark']) .f-illustrious {
        --plate-bg: #251a2b;
        --plate-ink: #d9b2e6;
        --plate-strong: #f2d9fb;
        --plate-mark: #b789c9;
      }
      :host-context([data-theme='dark']) .f-chroma {
        --plate-bg: #2a2018;
        --plate-ink: #d8b596;
        --plate-strong: #f2dcc4;
        --plate-mark: #c39a72;
      }
      :host-context([data-theme='dark']) .f-other {
        --plate-bg: #232321;
        --plate-ink: #b0afa6;
        --plate-strong: #d7d6cd;
        --plate-mark: #b3b2aa;
      }
    `,
  ],
})
export class CoverPlateComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) model!: CoverInput;
  @Input() size: 'card' | 'row' | 'mini' | 'wide' = 'card';

  /**
   * 照片是否真的显示出来了。
   *
   * 卡片正文压在铭牌上，有照片时正文要翻白、没照片时保持深色——但「有没有照片」
   * 只有这里知道（图会 401、会超时、会解码失败）。所以由铭牌把结论抛出去，
   * 别让外层拿 `image` 字段猜：猜错的后果是浅色铭牌上写白字，整张卡读不出来。
   */
  readonly shotState = output<boolean>();

  meta: CoverMeta = coverMeta({ name: '' });

  /**
   * 照片是否**真的画出来了**，而不是「有没有图的 URL」。
   *
   * 两者必须分开：`loading="lazy"` 的图在滚动到之前根本不会请求，如果这时就按
   * 「有图」隐藏生成构图，卡片会变成一块没有任何图案的纯色——看起来像坏了。
   * 所以构图一直留着，等照片真的解码成功再让位。
   */
  private loaded = false;

  get cls(): string {
    const shot = this.loaded ? ' on-shot' : '';
    const size = this.size === 'card' ? '' : ` sz-${this.size}`;
    return `plate f-${this.meta.family} mo-${this.meta.motif}${shot}${size}`;
  }

  /** 「12B · Q4_K_S」，竖线由 CSS 的 ::before 补，这里只管内容 */
  get specLine(): string {
    return this.meta.specs.map((s) => s.v).join(' · ');
  }

  get aria(): string {
    return [
      this.meta.code,
      ...this.meta.specs.map((s) => `${s.k}${s.v}`),
      this.model.hrefLabel || '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  ngOnChanges(): void {
    // 父组件每次变更检测都会传一个新的对象字面量进来（`[model]="plate"`），
    // 只认引用的话 ngOnChanges 每帧都触发，`meta` 被重置 → 加载失败的图会
    // 被重新挂回去，形成「报错→重算→再报错」的死循环。按内容签名比对。
    const sig = `${this.size}|${this.model?.name}|${this.model?.image}|${(this.model?.tags || []).join(',')}|${this.model?.href || ''}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.meta = coverMeta(this.model);
    this.loaded = false;
    if (!this.meta.image) this.announce(false);
    this.armTimeout();
  }

  ngOnDestroy(): void {
    this.clearImageTimer();
  }

  onImgLoad(event: Event): void {
    // HF 上的 gated 仓库会回 401/HTML，浏览器仍可能触发 load 而 naturalWidth 是 0；
    // 这种也算失败，否则卡片会变成一块没有任何构图的纯色。
    if (!(event.target as HTMLImageElement).naturalWidth) {
      this.onImgError();
      return;
    }
    this.clearImageTimer();
    this.loaded = true;
    this.announce(true);
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
    this.meta = { ...this.meta, image: undefined };
    this.announce(false);
  }

  private imageTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上次算 meta 用的输入签名，用来跳过「新对象、同内容」的 ngOnChanges */
  private sig = '';

  /** 延后一拍再通知：图片状态是在本组件的变更检测里定的，同步 emit 会让
   *  父组件的 `[class.on-shot]` 在同一个周期被改动，dev 模式直接抛
   *  ExpressionChangedAfterItHasBeenChecked。 */
  private announce(ok: boolean): void {
    setTimeout(() => this.shotState.emit(ok));
  }

  private armTimeout(): void {
    this.clearImageTimer();
    if (!this.meta.image) return;
    this.imageTimer = setTimeout(() => {
      this.imageTimer = null;
      if (this.meta.image) {
        this.meta = { ...this.meta, image: undefined };
        this.announce(false);
      }
    }, 8000);
  }

  private clearImageTimer(): void {
    if (this.imageTimer !== null) {
      clearTimeout(this.imageTimer);
      this.imageTimer = null;
    }
  }
}
