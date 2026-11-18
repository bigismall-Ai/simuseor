import { Component, Input, output } from '@angular/core';
import { sourceLabel, sourceShort } from '../core/source-links';
import { SearchItem, fmtNum } from '../core/types';
import { sourceTaskLabel } from '../core/task-labels';
import { CoverPlateComponent } from './cover-plate.component';

/** 封面取图顺序，与后端 `covers.PREFERENCE` 保持一致 */
const COVER_ORDER = ['modelscope', 'huggingface', 'civitai'];

/** 卡片上的一枚分类标签。有 href 的是可点的来源链接。 */
interface CardTag {
  key: string;
  text: string;
  title: string;
  href?: string;
}

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
      <!-- ratio="fill"：不声明比例，宽高由外层给 —— 本卡封面是
           position:absolute; inset:0 铺满整卡，正是 fill 的语义。 -->
      <app-cover-plate class="card-plate" ratio="fill" [model]="plate" (shotState)="photoOk = $event" />

      <div class="card-body">
        <h2 class="card-name" [title]="primary?.id">{{ primary?.name }}</h2>

        <!-- 下载量：独立一行，在模型名之下、标签之上。
             为什么放在这里（四站实测 Civitai / Comfy / HF / ModelScope 的结论）：
             - 下载量是**唯一**能证明「有人跑通过」的硬信号，社交指标（点赞、评论、
               点数）都能排最后，它不行。
             - 之前它跟「下载」按钮并排、11px 灰字靠右下，在 4 列网格里几乎读不到 ——
               而排序功能已经支持「按下载量」，**排序依据与视觉权重不一致是自相矛盾**。
             - 位置取「名之下」而不是「图之上」：Civitai 与 HF 的阅读动线都是
               「名 → 量」，放名之上会把动线倒过来，让人先读量再读名。
             - 也不放铭牌行左上角：那一行右侧已被「原站链接」占（cover-plate 的
               .origin），塞进去两者会挤，且身份信息与热度信息混排。
             右边的细线是分隔线不是装饰：它把这行和下面的分类标签分开，
             让「热度」独立于「分类」成层。 -->
        <div class="card-dl" title="下载量">
          <span class="card-dl-num">↓ {{ fmtNum(maxDownloads) }}</span>
          <span class="card-dl-rule"></span>
        </div>

        <!-- 分类标签：类型 / 来源 / 作者。
             规格跟 comfy.org Hub 模型卡一致 —— 一排等权重胶囊，
             分类信息用文字说明，权重信息（下载量）另行一路。
             装不下的折叠成「+N」，标题里给出全部内容。 -->
        <div class="pill-row card-tags">
          @for (t of visibleTags(); track t.key) {
            @if (t.href) {
              <a
                class="pill pill-link"
                [href]="t.href"
                target="_blank"
                rel="noreferrer"
                [title]="t.title"
                >{{ t.text }}</a
              >
            } @else {
              <span class="pill" [title]="t.title">{{ t.text }}</span>
            }
          }
          @if (hiddenTagCount() > 0) {
            <span class="pill pill-count is-more" [title]="allTagText()">+{{ hiddenTagCount() }}</span>
          }
        </div>

        <div class="card-actions">
          <button class="primary btn-xs" (click)="download.emit()" data-testid="card-download">
            下载
          </button>
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
       抬起 2px 在密集列表里会让整行抖动，阴影又掩盖了 1px 描边的分层。
       v2.1 修正：hover 描边画在 **::after** 而不是本体 —— 本体两条路都不通：
         · 本体 inset 描边 → 被 position:absolute + inset:0 铺满的 .card-plate 盖住
         · 本体外圈 box-shadow → 被本体的 overflow:hidden 裁掉
       实测（Playwright 像素级，顶部 18px 的 accent 像素）：
         改前 off=37 / on=37（hover 毫无反应）→ 改后 off=0 / on=323（可见）
       ::after 既有 z-index:2 盖得住封面，又与本体同框不会被裁。 */
    .card:hover,
    .card:focus-within {
      box-shadow: none;
    }
    .card:hover::after,
    .card:focus-within::after {
      box-shadow: inset 0 0 0 1px var(--accent);
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

    /* 标签行：单行不换行，装不下的折叠成「+N」。
       换行会让同一网格里的卡片高度参差 —— 卡片是海报，
       高度一乱，整墙的节奏就没了。折叠规则跟 comfy.org 一样。

       宽度约束：单枚上限 42%（约 94px），作者名再长也不会顶掉旁边的标签；
       「+N」不限宽且排在最后 —— 它是「还有更多」的提示，被裁掉就等于没折叠。 */
    .card-tags {
      position: relative;
      z-index: 1;
      flex-wrap: nowrap;
      overflow: hidden;
    }
    .card-tags .pill {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 42%;
    }
    .card-tags .pill.is-more {
      flex: none;
      max-width: none;
    }
    .on-shot .card-tags .pill {
      background: rgb(255 255 255 / 0.14);
      color: rgb(255 255 255 / 0.88);
      backdrop-filter: blur(6px);
    }
    .on-shot .card-tags .pill:hover {
      background: rgb(255 255 255 / 0.24);
      color: #fff;
    }

    /* 下载量：独立成行，在模型名之下、标签之上。
       独立成行是刻意的 —— 它是「热度」层的唯一信息，
       跟「分类」胶囊和「动作」按钮分开，扫读时能横向比较。 */
    .card-dl {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .card-dl-num {
      flex: none;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
    }
    /* 分隔线不是装饰：这行是「热度」，下面那行是「分类」，
       视觉上必须断开，否则两行会被读成同一组信息。 */
    .card-dl-rule {
      flex: 1 1 auto;
      min-width: 8px;
      height: 1px;
      background: var(--border);
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }
    .in-lib {
      font-size: 11px;
      color: var(--ok);
      white-space: nowrap;
    }

    /* 有真实封面时正文翻白：蒙版下沿已经是近实色的深底，正文永远落在稳定底色上 */
    .on-shot .card-name {
      color: #fff;
      text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    }
    .on-shot .card-dl-num { color: rgb(255 255 255 / 0.8); }
    .on-shot .card-dl-rule { background: rgb(255 255 255 / 0.28); }
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
  get plate(): {
    name: string;
    tags: string[];
    href?: string;
    hrefLabel?: string;
    image?: string;
    author?: string;
  } {
    const p = this.primary;
    const shot = this.shot;
    const name = p?.name || '';
    const href = p?.url || '';
    const hrefLabel = p ? sourceShort(p.source) : '';
    const author = p?.author || '';
    if (
      !this._plate ||
      this._plate.name !== name ||
      this._plate.image !== shot ||
      this._plate.href !== href ||
      this._plate.hrefLabel !== hrefLabel ||
      this._plate.author !== author
    ) {
      this._plate = { name, tags: p?.tags || [], href, hrefLabel, image: shot, author };
    }
    return this._plate;
  }
  private _plate: {
    name: string;
    tags: string[];
    href?: string;
    hrefLabel?: string;
    image?: string;
    author?: string;
  } | null = null;

  get authorText(): string {
    const authors = [...new Set(this.items.map((i) => i.author).filter((a) => !!a))];
    return authors.join(' · ');
  }

  /**
   * 分类标签里的「类型」。
   *
   * 同一模型可能同时挂在几个来源上，而各来源的 task 词表不同
   * （HF 给 text-to-image，Civitai 给 Checkpoint）。取第一个能翻译的，
   * 免得一个模型卡上同时冒出中英两种写法。
   */
  get taskLabel(): string {
    for (const it of this.items) {
      const label = sourceTaskLabel(it.task || '');
      if (label) return label;
    }
    return '';
  }

  /**
   * 卡片上的分类标签：类型 → 来源 → 作者。
   *
   * 顺序有讲究：类型先出来（这是模型「是什么」），来源次之（去哪儿拿），
   * 作者最后（谁做的，最不重要）。同一个模型挂了几个来源就并列几个来源，
   * 因为它们都是下载入口，不能只留一个。
   */
  private get allTags(): CardTag[] {
    const out: CardTag[] = [];
    const task = this.taskLabel;
    if (task) out.push({ key: 'task', text: task, title: `类型：${task}` });
    for (const it of this.items) {
      const full = sourceLabel(it.source);
      const short = sourceShort(it.source);
      out.push({
        key: 'src-' + it.source,
        text: short,
        href: it.url,
        title: `在 ${full} 上打开原始仓库`,
      });
    }
    const author = this.authorText;
    if (author) out.push({ key: 'author', text: author, title: `发布者：${author}` });
    return out;
  }

  /**
   * 最多露 3 枚，其余折成「+N」。
   *
   * 3 枚是量出来的：250px 的卡片减去内边距约 224px，
   * 用了短名后一枚「HF」只占 32px，3 枚稳稳放下。
   * 作者名可能很长，单枚上限 46%，超出就省略号 ——
   * 宁可少露一枚，也不能让标签行换行。
   */
  visibleTags(): CardTag[] {
    return this.allTags.slice(0, 3);
  }

  hiddenTagCount(): number {
    return Math.max(0, this.allTags.length - 3);
  }

  allTagText(): string {
    return this.allTags.map((t) => t.text).join(' · ');
  }

  get maxDownloads(): number {
    return Math.max(...this.items.map((i) => i.downloads || 0), 0);
  }

  fmtNum = fmtNum;
}
