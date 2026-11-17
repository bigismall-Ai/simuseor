import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges, output } from '@angular/core';
import { LibraryModel, fmtBytes } from '../core/types';
import { coverMeta } from '../core/cover';
import { modelTone, type Tone } from '../core/model-tone';
import { sourceAuthor, sourceLabel, sourceShort, sourceUrl } from '../core/source-links';

/**
 * 模型库卡片：一张海报（v4 终稿）。
 *
 * 结构三层，没有多余的壳：
 *   .mplate  封面（145px，家族色 + 几何纹样，或有真实图时铺图）
 *   .gauge   显存压力条（9px，与卡片等宽、左右顶满、无圆角）
 *   .mfoot   两个动作
 *
 * 正常卡 / 残缺卡 / DEMO 卡走**同一个模板**，只有内容不同 ——
 * 之前三套 HTML 各写一遍，结果残缺卡的横条高度跟正常卡对不上、一屏混排像两种卡。
 *
 * 颜色不写家族类，而是把「家族色优先、任务色兜底」算成两套变量内联
 * （`--t-*` / `--t-*-d`），再由 CSS 映射到 `--plate-*`：
 * 内联永远赢过 CSS 规则，两套色都写内联的话深色主题切不过去。
 *
 * 「权重缺失 / 损坏」不是「无法判定」，是「这个条目残了」——
 * 所以它走红色斜纹（通用的「不完整」语言），主操作换成「重新下载模型」。
 */
@Component({
  selector: 'md-library-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="mcard"
      [style.--t-bg]="tone.bg"
      [style.--t-ink]="tone.ink"
      [style.--t-strong]="tone.strong"
      [style.--t-mark]="tone.mark"
      [style.--t-bg-d]="toneDark.bg"
      [style.--t-ink-d]="toneDark.ink"
      [style.--t-strong-d]="toneDark.strong"
      [style.--t-mark-d]="toneDark.mark"
    >
      <div class="mplate" [class.on-shot]="shotOk && !broken" [class.broken-plate]="broken">
        @if (cover && !dead && !broken) {
          <img
            class="photo"
            [src]="cover"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            (load)="onImgLoad($event)"
            (error)="onImgError()"
          />
        }

        @if (!broken) {
          <span class="motif" [ngClass]="'mo-' + meta.motif"></span>
          <div class="scrim"></div>
        }

        <div class="top-half">
          <div class="brand-slot">
            @if (meta.logo) {
              <span class="brand" [class.has-dark]="!!meta.logoDark">
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
              </span>
            } @else if (meta.code !== '—') {
              <span class="brand code">{{ meta.code }}</span>
            }
            @if (specLine) {
              <span class="spec">{{ specLine }}</span>
            }
          </div>
          @if (sourceHref) {
            <a
              class="origin"
              [href]="sourceHref"
              target="_blank"
              rel="noreferrer"
              [title]="sourceTitle"
            >
              {{ sourceShortLabel }}
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4.5 2.5H2.5v7h7v-2" />
                <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
              </svg>
            </a>
          }
        </div>

        @if (broken) {
          <div class="broken-inner">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                 stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
              <path d="M12 8v5" />
              <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
              <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span class="broken-title">{{ brokenTitle }}</span>
            <span class="broken-msg">{{ brokenMsg }}</span>
          </div>
        }

        <div class="plate-foot">
          <h3 class="mname" [title]="model.name">{{ model.name }}</h3>
          @if (!broken) {
            <!-- 类型 / 发布方；原站链接在右上角 -->
            <div class="plate-meta">
              <span
                class="pill"
                [class.pill-on-media]="shotOk"
                [class.pill-demo]="!!model.isDemo"
              >{{ taskLabel }}</span>
              @if (author) {
                <span
                  class="pill pill-author"
                  [class.pill-on-media]="shotOk"
                  [title]="'发布者：' + author"
                >{{ author }}</span>
              }
              <span class="grow"></span>
              <span class="msize">{{ fmtBytes(model.size_bytes) }}</span>
            </div>
          }
        </div>
      </div>

      <span [class]="gaugeClass" [style.--fill]="fill + '%'" [title]="gaugeTip"></span>

      <div class="mfoot">
        <button type="button" class="mini danger" (click)="remove.emit()">删除模型</button>
        <span class="grow"></span>
        @if (broken) {
          <button type="button" class="mini primary" (click)="redownload.emit()">重新下载模型</button>
        } @else {
          <button type="button" class="mini" (click)="use.emit()">查找适配工作流</button>
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .mcard {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius);
        background: var(--panel);
        /* 间接层：内联只给 --t-*，这里映射到 --plate-*，深色主题才切得动 */
        --plate-bg: var(--t-bg);
        --plate-ink: var(--t-ink);
        --plate-strong: var(--t-strong);
        --plate-mark: var(--t-mark);
        transition: transform 0.16s ease, box-shadow 0.16s ease;
      }
      :host-context([data-theme='dark']) .mcard {
        --plate-bg: var(--t-bg-d);
        --plate-ink: var(--t-ink-d);
        --plate-strong: var(--t-strong-d);
        --plate-mark: var(--t-mark-d);
      }

      /* 描边只用 ::after —— border 会让 inset:0 从边框内沿起算，描边整体内缩 1px */
      .mcard::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 3;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--border);
        pointer-events: none;
        transition: box-shadow 0.16s ease;
      }
      /* M1-c：hover 不再位移 + 不再外阴影（Phase2 §2.10-13 / §8-E 第 3 处）。
         保留 1px 描边作为唯一可见反馈。

         v2.2 改画在 **::after**（inset accent），与 model-card / workflow-card 统一：
         本体的 inset 描边在**铺满型封面**下会被盖住（model-card 的 .card-plate 是
         position:absolute; inset:0 铺满整卡 → 实测 accent 像素 off=37 / on=37，
         hover 视觉上毫无反应）。::after 在两种封面结构下都成立：
         本卡 ::after 是 z-index:3，盖得住流式封面的 .mplate。

         注：本体外圈 box-shadow 也能看见（实测 off=0 → on=297），因为 box-shadow
         的外圈绘制在 border box 之外、不被元素自身的 overflow 裁剪（overflow 只裁
         子元素）—— 但那样三个卡片口径就不一致了。**统一的价值在于「一条规则走
         天下」，而不是「视觉恰好一样」。 */
      .mcard:hover {
        box-shadow: none;
      }
      .mcard:hover::after {
        box-shadow: inset 0 0 0 1px var(--accent);
      }

      /* ---- 封面：固定 145px，6:4 的上部 ---- */
      .mplate {
        position: relative;
        height: 145px;
        overflow: hidden;
        background: var(--plate-bg);
      }
      .photo {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 28%;
      }

      /* ---- 纹样：5 种变体，类名在 .motif 自己身上（.mo-0::before） ---- */
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
      .mplate.on-shot .motif {
        display: none;
      }

      .mo-0::before {
        right: -28%;
        top: -44%;
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        background: color-mix(in oklab, var(--plate-mark) 30%, transparent);
      }
      .mo-0::after {
        right: 10%;
        top: 24%;
        width: 44%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklab, var(--plate-mark) 46%, transparent);
      }
      .mo-1::before {
        inset: 0;
        background: repeating-linear-gradient(
          -58deg,
          color-mix(in oklab, var(--plate-mark) 17%, transparent) 0 12px,
          transparent 12px 38px
        );
        -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 30%, transparent 60%);
        mask-image: linear-gradient(to bottom, #000 0%, #000 30%, transparent 60%);
      }
      .mo-1::after { display: none; }
      .mo-2::before {
        left: -22%;
        top: -74%;
        width: 96%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklab, var(--plate-mark) 40%, transparent);
        box-shadow: 0 0 0 20px color-mix(in oklab, var(--plate-mark) 12%, transparent);
      }
      .mo-2::after {
        left: -2%;
        top: -46%;
        width: 54%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1px solid color-mix(in oklab, var(--plate-mark) 26%, transparent);
      }
      .mo-3::before {
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
      .mo-3::after { display: none; }
      .mo-4::before {
        inset: 0;
        background:
          radial-gradient(62% 72% at 10% 0%,
            color-mix(in oklab, var(--plate-mark) 40%, transparent), transparent 70%),
          radial-gradient(52% 62% at 98% 30%,
            color-mix(in oklab, var(--plate-mark) 26%, transparent), transparent 72%);
      }
      .mo-4::after { display: none; }

      /* 深色下 mark 是「提亮」，同一百分比会更抢，统一压一档 */
      :host-context([data-theme='dark']) .motif { opacity: 0.66; }
      :host-context([data-theme='dark']) .mo-1::before {
        background: repeating-linear-gradient(
          -58deg,
          color-mix(in oklab, var(--plate-mark) 13%, transparent) 0 12px,
          transparent 12px 44px
        );
      }

      /* 蒙版：无图时用家族色压底，有图时用深色压底，正文永远落在稳定底色上 */
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
      .mplate.on-shot .scrim {
        background: linear-gradient(
          to top,
          rgb(0 0 0 / 0.74) 0%,
          rgb(0 0 0 / 0.18) 34%,
          rgb(0 0 0 / 0.1) 62%,
          rgb(0 0 0 / 0.42) 100%
        );
      }
      .mplate.on-shot {
        --plate-strong: #fff;
        --plate-ink: rgb(255 255 255 / 0.78);
      }

      /* ---- 上半：厂标靠左 ---- */
      .top-half {
        position: absolute;
        left: 11px;
        right: 11px;
        top: 10px;
        z-index: 2;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .brand-slot {
        /* 让位给右上角的文件形态角标：规格文字过长时自己省略，不把角标挤出去 */
        flex: 0 1 auto;
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      .brand {
        width: 24px;
        height: 24px;
        padding: 0;
        display: grid;
        place-items: center;
        border-radius: 6px;
        background: color-mix(in oklab, var(--plate-mark) 30%, transparent);
        border: 1.5px solid color-mix(in oklab, var(--plate-mark) 46%, transparent);
      }
      .brand img {
        display: block;
        width: 14px;
        height: 14px;
        object-fit: contain;
        transform: scale(var(--logo-scale, 1));
      }
      /* 只有黑白标才备反白版。彩色 / 渐变资产（Qwen 紫、混元多色、MiniMax 渐变）
         没有深色版：深色主题下必须继续显示浅色版，否则整个厂标会消失。 */
      .brand.has-dark .logo-dark { display: none; }
      :host-context([data-theme='dark']) .brand.has-dark .logo-light { display: none; }
      :host-context([data-theme='dark']) .brand.has-dark .logo-dark { display: block; }
      .brand.code {
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--plate-strong);
      }

      .spec {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: var(--plate-strong);
        opacity: 0.82;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      /* 右上角：直接跳回模型原站。格式角标（SAFE/GGUF）已删除。 */
      .origin {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 18px;
        padding: 0 6px;
        border-radius: 4px;
        background: color-mix(in oklab, var(--plate-mark) 42%, var(--plate-bg));
        color: var(--plate-strong);
        font: 600 10px/1 'Cascadia Mono', Consolas, monospace;
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
      .mplate.on-shot .origin {
        background: rgb(255 255 255 / 0.18);
        color: #fff;
        backdrop-filter: blur(6px);
      }
      .mplate.on-shot .origin:hover {
        background: rgb(255 255 255 / 0.28);
        color: #fff;
      }

      /* ---- 残缺卡：斜纹底 + 居中警示 + 红底标题 + 中性底详情 ---- */
      .broken-plate {
        background: repeating-linear-gradient(
          45deg,
          var(--panel-2), var(--panel-2) 9px,
          var(--panel-3), var(--panel-3) 18px
        );
      }
      .broken-inner {
        position: absolute;
        left: 0;
        right: 0;
        top: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        color: var(--err);
      }
      .broken-title {
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.02em;
        background: var(--err-soft);
        color: var(--err);
        padding: 2px 9px;
        border-radius: var(--radius-xs);
      }
      .broken-msg {
        font-size: 10.5px;
        font-weight: 500;
        color: var(--muted);
        background: var(--panel);
        padding: 2px 8px;
        border-radius: var(--radius-xs);
        border: 1px solid var(--border-soft);
        max-width: 82%;
        text-align: center;
        line-height: 1.35;
      }
      /* 斜纹底太花，厂标压在上面读不清 → 给它一块实底衬 */
      .broken-plate .brand-slot { position: relative; z-index: 2; }
      .broken-plate .brand { background: var(--panel); box-shadow: 0 1px 3px rgb(0 0 0 / 0.1); }
      .broken-plate .spec { color: var(--faint); }

      /* ---- 封面底部：名称 / 类型 / 规格 / 大小 ---- */
      .plate-foot {
        position: absolute;
        left: 11px;
        right: 11px;
        bottom: 8px;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .mname {
        margin: 0;
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        font-weight: 650;
        line-height: 1.35;
        letter-spacing: -0.008em;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mplate.on-shot .mname {
        color: #fff;
        text-shadow: 0 1px 3px rgb(0 0 0 / 0.55);
      }
      .plate-meta {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }
      .msize {
        font-size: 10.5px;
        color: var(--faint);
        font-variant-numeric: tabular-nums;
        flex: none;
      }
      .mplate.on-shot .msize {
        color: rgb(255 255 255 / 0.78);
        text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
      }

      /* 卡片里的分类标签直接用全站 .pill —— 跟发现页同一套圆角、字号、填充。
         只在高度上收紧 2px，适配 145px 封面底部这一行。 */
      .plate-meta .pill {
        flex: none;
        max-width: 42%;
        height: 18px;
        padding: 0 7px;
        font-size: 10.5px;
        line-height: 16px;
      }
      /* 作者最长，也最先让位：它可以用省略号，类型和大小不能 */
      .plate-meta .pill-author {
        flex: 0 1 auto;
        max-width: 44%;
        min-width: 0;
      }
      .plate-meta .pill.pill-demo {
        background: var(--err-soft);
        color: var(--err);
        letter-spacing: 0.06em;
      }
      /* 照片上的标签是白 14% 半透明；hover 不能翻回灰底，否则一块灰斑 */
      .plate-meta .pill-on-media.pill-link:hover {
        background: rgb(255 255 255 / 0.24);
        color: #fff;
      }

      /* ---- 显存压力条：9px，与卡片等宽，无圆角无 border ----
         渐变铺满整条再用 clip-path 裁出左侧填充段；用 background-size 压缩
         会把整条渐变塞进那一小段（错）。 */
      .gauge {
        position: relative;
        display: block;
        height: 9px;
        background: var(--border-strong);
      }
      .gauge::before {
        content: '';
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.22) 0 3px, transparent 3px 7px),
          linear-gradient(to right,
            #15803d 0%, #15803d 26%,
            #b45309 56%, #b45309 74%,
            #ff0000 100%);
        clip-path: inset(0 calc(100% - var(--fill)) 0 0);
      }
      .gauge-unknown { background: var(--border-strong); }
      .gauge-unknown::before { display: none; }
      .gauge-broken {
        background: repeating-linear-gradient(-45deg,
          #ff0000, #ff0000 4px, rgb(255 0 0 / 0.5) 4px, rgb(255 0 0 / 0.5) 8px);
      }
      .gauge-broken::before { display: none; }
      .gauge-demo {
        background: repeating-linear-gradient(-45deg,
          #eab308, #eab308 4px, rgb(234 179 8 / 0.5) 4px, rgb(234 179 8 / 0.5) 8px);
      }
      .gauge-demo::before { display: none; }

      /* ---- 下部：两个动作 ---- */
      .mfoot {
        position: relative;
        padding: 8px 11px;
        display: flex;
        align-items: center;
        gap: 7px;
        background: color-mix(in oklab, var(--panel) 88%, transparent);
      }
      .mini {
        height: 23px;
        padding: 0 9px;
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--panel);
        color: var(--text-2);
        font: inherit;
        font-size: 10.5px;
        cursor: pointer;
        white-space: nowrap;
        flex: none;
      }
      .mini:hover { border-color: var(--border-strong); color: var(--text); }
      .mini.danger {
        color: var(--err);
        border-color: color-mix(in oklab, var(--err) 26%, transparent);
      }
      .mini.danger:hover {
        background: var(--err-soft);
        border-color: color-mix(in oklab, var(--err) 46%, transparent);
      }
      /* 残缺条目的唯一下一步是补救 → 强调色实心，在一堆灰按钮里跳出来 */
      .mini.primary {
        color: #fff;
        background: var(--accent);
        border-color: var(--accent);
        font-weight: 600;
      }
      .mini.primary:hover {
        background: var(--accent-hover);
        border-color: var(--accent-hover);
      }
      :host-context([data-theme='dark']) .mini.primary { color: #17101d; }

      @media (prefers-reduced-motion: reduce) {
        .mcard { transition: none; }
        .mcard:hover { transform: none; }
      }
    `,
  ],
})
export class LibraryCardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) model!: LibraryModel;
  /** 后端解析出的真实封面；取不到就退回家族色构图 */
  @Input() cover = '';
  /** 本机独显显存（GB），压力条的分母 */
  @Input() vramGb = 0;

  readonly remove = output<void>();
  readonly use = output<void>();
  readonly redownload = output<void>();

  /** 照片是否真的画出来了（有 URL 不等于加载成功，lazy 图在滚动前根本不发请求） */
  shotOk = false;
  /** 图片彻底失败（error / 超时）：模板据此撤掉 <img>，退回构图 */
  dead = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  fmtBytes = fmtBytes;

  /**
   * 铭牌信息与色板只在 model 变化时算一次。
   *
   * 放成 getter 会在每次变更检测里重跑正则与哈希 —— 一屏几十张卡、悬停一下
   * 就整墙重算一遍。`@for` 传进来的 model 引用是稳定的，ngOnChanges 足够。
   */
  meta = coverMeta({ name: '' });
  /** 两套色都内联：CSS 按 data-theme 选，切换主题不需要重算 */
  tone: Tone = modelTone('other', '', false);
  toneDark: Tone = modelTone('other', '', true);

  get broken(): boolean {
    const lvl = this.model.vram?.level;
    return lvl === 'broken' || lvl === 'missing';
  }

  get brokenTitle(): string {
    return this.model.vram?.level === 'broken' ? '权重损坏' : '权重缺失';
  }

  get brokenMsg(): string {
    return this.model.vram?.level === 'broken'
      ? '有权重文件但头部解析失败'
      : '目录里没有权重文件，下载不完整';
  }

  get specLine(): string {
    return [this.model.precision, this.model.params].filter(Boolean).join(' · ');
  }

  get taskLabel(): string {
    return this.model.isDemo ? 'DEMO' : this.model.taskLabel || '未标注';
  }

  /**
   * 模型原站地址。优先用后端入库时留下的精确版本页（HF 分支 / Civitai
   * modelVersionId）；老数据没有 source_url 时回退到按 source + repo_id 拼的主页。
   * 本地导入 / Demo 两者都为空，不渲染链接。
   */
  get sourceHref(): string {
    return this.model.source_url || sourceUrl(this.model.source, this.model.repo_id);
  }

  get sourceShortLabel(): string {
    return sourceShort(this.model.source);
  }

  get sourceTitle(): string {
    return `在 ${sourceLabel(this.model.source)} 上打开原始仓库`;
  }

  /** 发布方：HF / ModelScope 的仓库归属，其它来源没有可靠字段 */
  get author(): string {
    return sourceAuthor(this.model.source, this.model.repo_id);
  }

  /** 压力条形态：演示黄斜纹 / 残缺红斜纹 / 无独显灰 / 正常渐变 */
  get gaugeClass(): string {
    if (this.model.isDemo) return 'gauge gauge-demo';
    const lvl = this.model.vram?.level;
    if (lvl === 'broken' || lvl === 'missing') return 'gauge gauge-broken';
    if (lvl !== 'ok' && lvl !== 'warn' && lvl !== 'err') return 'gauge gauge-unknown';
    return 'gauge';
  }

  /** 填充百分比（0~100）。超过 100% 就填满 —— 条子表达不了更多 */
  get fill(): number {
    const lvl = this.model.vram?.level;
    if (this.model.isDemo || lvl === 'broken' || lvl === 'missing') return 0;
    if (lvl !== 'ok' && lvl !== 'warn' && lvl !== 'err') return 0;
    const need = this.model.needGb ?? 0;
    if (!this.vramGb || need <= 0) return 0;
    return Math.max(0, Math.min(Math.round((need / this.vramGb) * 100), 100));
  }

  get gaugeTip(): string {
    if (this.model.isDemo) return '离线演示占位文件，权重内容为假';
    const lvl = this.model.vram?.level;
    if (lvl === 'broken' || lvl === 'missing') {
      return this.model.vram?.hint || '权重不完整，这个条目还不能用';
    }
    if (lvl !== 'ok' && lvl !== 'warn' && lvl !== 'err') {
      return '本机未检测到独立显卡，无法判断能否运行';
    }
    return `显存压力 · 本机 ${this.vramGb.toFixed(0)} GB（估算值，实际占用取决于推理方式）`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['model'] && this.model) {
      this.meta = coverMeta({ name: this.model.name, tags: this.model.tags || [] });
      this.tone = modelTone(this.meta.family, this.model.task || '', false);
      this.toneDark = modelTone(this.meta.family, this.model.task || '', true);
    }
    if (changes['cover']) {
      this.shotOk = false;
      this.dead = false;
      this.armTimeout();
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  onImgLoad(event: Event): void {
    // gated 仓库会回 401/HTML，浏览器仍可能触发 load 而 naturalWidth 是 0
    if (!(event.target as HTMLImageElement).naturalWidth) {
      this.onImgError();
      return;
    }
    this.clearTimer();
    this.shotOk = true;
  }

  /**
   * 远程缩略图最终没拿回来时退回生成构图。
   * Civitai 的图会 301 到 blobs CDN，没代理时会一直挂着，既不 load 也不 error，
   * 所以必须给一个超时，否则那一格永远停在「有图但没画出来」的状态。
   */
  onImgError(): void {
    this.clearTimer();
    this.dead = true;
    this.shotOk = false;
  }

  private armTimeout(): void {
    this.clearTimer();
    if (!this.cover) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.shotOk) this.onImgError();
    }, 8000);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
