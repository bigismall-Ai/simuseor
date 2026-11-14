import { Component, Input, output } from '@angular/core';
import { SearchItem, fmtNum } from '../core/types';
import { CoverPlateComponent } from './cover-plate.component';

const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  demo: 'Demo',
  github: 'GitHub',
  templates: '官方模板',
};

/** 封面取图顺序，与后端 `covers.PREFERENCE` 保持一致 */
const COVER_ORDER = ['modelscope', 'huggingface', 'civitai'];

/**
 * 模型卡：一张海报，不是「封面 + 正文」两段。
 *
 * 铭牌铺满整块当背景（生成构图，或在有缩略图时铺图），正文靠 `margin-top:auto` 贴底，
 * 所以卡片高度只由正文决定，换任何一张背景都不会塌、也不会跳。
 *
 * 为什么不再分上下两段：旧卡片上半截是封面、下半截是正文，一屏 20 张就是
 * 20 个「上面一块、下面一块」，卡片被撑到 300px 以上，一屏看不了几条。
 * 合成一张之后高度掉到 200 以内，信息一个没少。
 *
 * 模型名是卡片里唯一的大字。铭牌只负责「哪个家族、什么规格、什么文件形态」，
 * 字号不跟模型名抢。
 */
@Component({
  selector: 'md-model-card',
  standalone: true,
  imports: [CoverPlateComponent],
  template: `
    <article class="card" [class.on-shot]="photoOk">
      <app-cover-plate class="card-plate" [model]="plate" (shotState)="photoOk = $event" />

      <div class="card-body">
        <h2 class="card-name" [title]="primary?.id">{{ primary?.name }}</h2>

        <div class="card-meta">
          @for (it of items; track it.source + '/' + it.id) {
            <a
              class="src"
              [href]="it.url"
              target="_blank"
              rel="noreferrer"
              [title]="'打开 ' + labelOf(it.source) + ' 上的原始仓库'"
              >{{ labelOf(it.source) }}<span class="arrow" aria-hidden="true">↗</span></a
            >
          }
          @if (authorText) {
            <span class="sep">·</span>
            <span class="card-author">{{ authorText }}</span>
          }
          <span class="card-stat" title="下载量">↓ {{ fmtNum(maxDownloads) }}</span>
        </div>

        <div class="card-actions">
          <button class="primary btn-xs" (click)="download.emit()" data-testid="card-download">
            下载
          </button>
          @if (items.length > 1) {
            <span class="src-count">{{ items.length }} 个来源</span>
          }
          @if (inLibrary) {
            <span class="in-lib">已在库</span>
          }
        </div>
      </div>
    </article>
  `,
  styles: `
    :host { display: block; min-width: 0; }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 202px;
      overflow: hidden;
      border-radius: var(--radius);
      background: var(--panel);
      transition: transform 0.16s ease, box-shadow 0.16s ease;
    }

    /* 边框用内描边而不是 border：border 画在盒子外沿，背景图只能铺到 padding box，
       两者之间永远隔着 1px，浅色边框压在图上会被读成「图没贴边」。 */
    .card::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 2;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px var(--border);
      pointer-events: none;
      transition: box-shadow 0.16s ease;
    }
    .card.on-shot::after { box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.16); }

    /**
     * hover 统一成「抬起 + 外描边」，两种卡片一模一样。
     *
     * 之前是内描边变色：普通卡从 --border 变 accent 混合色，照片卡从黑 16% 变黑 30%。
     * 同一个动作在两种底色上表现完全不同——照片卡上那点黑色变化肉眼看不出来，
     * 看起来就是「有图的卡没有 hover 效果」。内描边画在图片上就注定没法统一，
     * 所以改画在外圈（贴着页面底色），与卡片内容无关；内描边同时让位，避免两层边。
     */
    /* M1-c：hover 不再位移 + 不再外阴影。边框优先于阴影是全站约束，
       抬起 2px 在密集列表里会让整行抖动，阴影又掩盖了 1px 描边的分层。 */
    .card:hover,
    .card:focus-within {
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .card:hover::after,
    .card:focus-within::after {
      box-shadow: inset 0 0 0 1px transparent;
    }

    @media (prefers-reduced-motion: reduce) {
      .card { transition: none; }
      .card:hover,
      .card:focus-within { transform: none; }
    }

    .card-plate {
      position: absolute;
      inset: 0;
      border-radius: inherit;
    }

    .card-body {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: auto;
      /* 顶部 44px 留给铭牌那一行（厂牌名 + 形态角标），正文永不压上去 */
      padding: 44px 13px 12px;
    }

    .card-name {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.38;
      letter-spacing: -0.008em;
      color: var(--text);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
    }

    /* 来源写成小号大写字母：它是「去哪儿下载」的索引，不是正文，
       用字重和字距区分层级，不用另一种颜色再加噪音。
       末尾的 ↗ 必须留着——没有它，这一串字母看起来只是一个标签，
       没人知道点它能跳到原始仓库。 */
    .src {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      text-decoration: none;
      flex: none;
      border-bottom: 1px solid transparent;
    }
    .src .arrow { font-size: 9px; opacity: 0.55; letter-spacing: 0; }
    .src:hover { color: var(--accent); border-bottom-color: currentColor; }
    .src:hover .arrow { opacity: 1; }
    .sep { flex: none; opacity: 0.5; }
    .card-author {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-stat {
      flex: none;
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      padding-left: 6px;
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }
    .src-count,
    .in-lib {
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
    }
    .in-lib { color: var(--ok); }

    /* 有真实封面时正文翻白：蒙版下沿已经是近实色的深底，正文永远落在稳定底色上 */
    .on-shot .card-name {
      color: #fff;
      text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    }
    .on-shot .card-meta { color: rgb(255 255 255 / 0.76); }
    .on-shot .src { color: rgb(255 255 255 / 0.76); }
    .on-shot .src:hover { color: #fff; }
    .on-shot .card-stat,
    .on-shot .src-count { color: rgb(255 255 255 / 0.66); }
  `,
})
export class ModelCardComponent {
  @Input({ required: true }) items: SearchItem[] = [];
  /** 后端按「魔搭 → HF → Civitai」解析出来的封面，比条目自带的更优先 */
  @Input() cover = '';
  @Input() inLibrary = false;
  readonly download = output<void>();

  /** 铭牌通知「照片真的显示出来了」；决定正文用白字还是深色字 */
  photoOk = false;

  get primary(): SearchItem | undefined {
    return this.items[0];
  }

  /**
   * 一组来源里任意一个带缩略图就用它，顺序固定为 魔搭 → HF → Civitai。
   *
   * 为什么不是「谁先有图就用谁」：同名模型常同时挂在三家，魔搭的示例图质量
   * 和相关性普遍好于 Civitai 的社区投稿；顺序写死才不会因为返回顺序变化而抖动。
   * `cover` 是后端按同一顺序解析好的结果，优先级最高。
   */
  get shot(): string | undefined {
    if (this.cover) return this.cover;
    for (const source of COVER_ORDER) {
      const hit = this.items.find((i) => i.source === source && !!i.image);
      if (hit) return hit.image;
    }
    return this.items.find((i) => !!i.image)?.image;
  }

  /**
   * 铭牌只吃稳定字段：name 定家族与构图，tags 辅助分类；有缩略图就铺图。
   *
   * 这里按引用缓存：模板里的 `[model]="plate"` 每次变更检测都会求值，返回新对象
   * 就会让子组件的 ngOnChanges 每帧触发（`meta` 被反复重置，图片加载失败时
   * 甚至会把失败的图重新挂回去形成死循环）。
   */
  get plate(): { name: string; tags: string[]; image?: string } {
    const p = this.primary;
    const shot = this.shot;
    const name = p?.name || '';
    if (!this._plate || this._plate.name !== name || this._plate.image !== shot) {
      this._plate = { name, tags: p?.tags || [], image: shot };
    }
    return this._plate;
  }
  private _plate: { name: string; tags: string[]; image?: string } | null = null;

  get authorText(): string {
    const authors = [...new Set(this.items.map((i) => i.author).filter((a) => !!a))];
    return authors.join(' · ');
  }

  get maxDownloads(): number {
    return Math.max(...this.items.map((i) => i.downloads || 0), 0);
  }

  labelOf(source: string): string {
    return SOURCE_LABELS[source] || source;
  }

  fmtNum = fmtNum;
}
