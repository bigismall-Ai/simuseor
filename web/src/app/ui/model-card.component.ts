import { Component, ElementRef, HostListener, Input, inject, output } from '@angular/core';
import { CoverMeta, coverMeta } from '../core/cover';
import { sourceLabel, sourceShort } from '../core/source-links';
import { ThemeService } from '../core/theme.service';
import { SearchItem, fmtNum, fmtSize } from '../core/types';
import { SOURCE_TASK_LABELS, sourceTaskLabel } from '../core/task-labels';
import { CoverPlateComponent } from './cover-plate.component';

/** 封面取图顺序，与后端 `covers.PREFERENCE` 保持一致 */
const COVER_ORDER = ['modelscope', 'huggingface', 'civitai'];

/**
 * 「文件类型」词表 —— Civitai 的 modelType。
 *
 * 只有 Civitai 回答得了「这个文件是什么」（Checkpoint / LoRA / VAE…）；
 * HF / MS 的 task 是 pipeline 任务（text-to-image…），那是**类别**不是文件形态。
 * 两者混在一列里，标签既不是类型也不是类别。词表与 core/task-labels.ts 的 Civitai 分组一致。
 */
const FILE_TYPES = new Set([
  'Checkpoint', 'LORA', 'LoCon', 'VAE', 'Controlnet', 'TextualInversion', 'TextEncoder',
  'Upscaler', 'Embedding', 'Hypernetwork', 'Motion Module', 'Style Model',
  'Aesthetic Gradient', 'Poses', 'Wildcards', 'ComfyWorkflows', 'LLM',
]);

/**
 * 发现页条目可能带的文件大小（字节）。
 *
 * 共享类型 SearchItem 里没有这个字段，但各源的搜索列表接口都可能补上，
 * 所以按可选字段接住，不改共享类型（core/types.ts 不归本组件动）。
 */
interface SizedItem extends SearchItem {
  size?: number;
}

/**
 * 模型卡：资产卡统一骨架的模型版。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面   铺满整卡的铭牌（只贡献底图与蒙版）
 *   ② 身份行 32×32 标识块 + 厂名 / 作者
 *   ③ 原站   右上角一条原站链接
 *   ④ 状态槽 左下载量 · 一根白线 · 右大小
 *   ⑤ 标签   恰好一枚（文件类型）
 *   ⑥ 动作行 ⋯ 在左，主按钮在右
 *
 * 为什么把标签位收成一枚：旧卡一排等权重胶囊（类型 / 来源 / 作者 + 「+N」），
 * 信息互相稀释 —— 来源链接是出口，不该跟分类挤在一行；作者归身份行；
 * 分类只剩「这是什么文件」一件事，一枚就够。
 */
@Component({
  selector: 'md-model-card',
  standalone: true,
  imports: [CoverPlateComponent],
  template: `
    <article class="card acard" [class.on-shot]="photoOk">
      <!-- ① 封面：铺满整卡。ratio="fill" 不声明比例，宽高由外层给 ——
           本卡封面是 position:absolute; inset:0 铺满整卡，正是 fill 的语义。
           铭牌自带的顶行（厂标 + 家族码 + 规格 + 原站链接）在这里是重复的：
           身份与原站由 .acard-head 承担，所以整行收掉（与工作流卡同一手法）。 -->
      <div class="acard-media">
        <app-cover-plate
          class="card-plate acard-plate"
          ratio="fill"
          [model]="plate"
          (shotState)="photoOk = $event"
        />
      </div>

      <!-- ② 身份行（32×32 标识块 + 厂名 / 作者） + ③ 右上角原站链接 -->
      <div class="acard-head">
        <span class="acard-mark" [title]="markTitle">
          @if (markLogo) {
            <img
              class="logo-light"
              [src]="meta.logo"
              [alt]="meta.code"
              [style.--logo-scale]="meta.logoScale || 1"
            />
            @if (meta.logoDark) {
              <img
                class="logo-dark"
                [src]="meta.logoDark"
                alt=""
                aria-hidden="true"
                [style.--logo-scale]="meta.logoScale || 1"
              />
            }
          } @else if (familyCode) {
            <span class="acard-code">{{ familyCode }}</span>
          } @else if (meta.publisher) {
            <!-- 未登记家族：用发布方缩写兜底。它回答的是「谁发的」，不是伪造的厂牌标。 -->
            <span class="acard-code" [title]="'未登记厂牌 · 发布方：' + meta.publisher.label">{{
              meta.publisher.abbr
            }}</span>
          }
        </span>

        <span class="acard-ident">
          <b [title]="familyName">{{ familyName }}</b>
          <span [title]="authorText">{{ authorText || '—' }}</span>
        </span>

        @if (origin.href) {
          <a
            class="origin acard-origin"
            [href]="origin.href"
            target="_blank"
            rel="noreferrer"
            [title]="origin.title"
          >
            {{ origin.label }}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 2.5H2.5v7h7v-2" />
              <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
            </svg>
          </a>
        }
      </div>

      <div class="card-body acard-body">
        <h2 class="card-name acard-name" [title]="primary?.id">{{ primary?.name }}</h2>

        <!-- 类别行：参数 / 量化（原先在铭牌顶行上，那块地归了身份行）。
             高度固定 —— 规格不是每张卡都有，行高不一致整墙卡片就会参差。 -->
        <p class="card-meta acard-meta" [title]="metaLine">{{ metaLine }}</p>

        <!-- ④ 状态槽：左状态 · 一根白线 · 右大小。
             发现页的「状态」是下载量：它是唯一能证明「有人跑通过」的硬信号，
             排序功能也按它排，视觉权重必须跟排序依据一致。 -->
        <div class="card-slot acard-slot">
          <span [title]="'下载量：' + maxDownloads">↓ {{ fmtNum(maxDownloads) }}</span>
          <span class="acard-rule"></span>
          <span class="acard-size">{{ sizeText }}</span>
        </div>

        <!-- ⑤ 分类标签：恰好一枚。站点入口归右上角与 ⋯ 菜单，不再占标签位。 -->
        <div class="card-tags acard-tags">
          <span class="pill" [title]="tagTitle">{{ tagText }}</span>
        </div>

        <!-- ⑥ 动作行：⋯ 在左，主按钮在右 -->
        <div class="card-actions acard-foot">
          <button
            class="card-kebab acard-kebab"
            type="button"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen"
            aria-label="更多操作"
            title="更多操作"
            (click)="toggleMenu($event)"
          >
            ⋯
          </button>

          @if (menuOpen) {
            <div class="acard-menu" role="menu">
              @for (s of sourceLinks; track s.key) {
                <a
                  class="pill pill-link acard-menu-item"
                  role="menuitem"
                  [href]="s.href"
                  target="_blank"
                  rel="noreferrer"
                  [title]="s.title"
                  >{{ s.text }}</a
                >
              }
            </div>
          }

          @if (inLibrary) {
            <span class="in-lib">已在库</span>
          }

          <button class="acard-primary primary btn-xs" (click)="download.emit()" data-testid="card-download">
            下载
          </button>
        </div>
      </div>
    </article>
  `,
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host { display: block; min-width: 0; }

      /* 铭牌自带的顶行（厂标 + 家族码 + 搬运标注 + 规格）在本卡里是重复的：
         身份行已经在卡角给出厂标与厂名，规格挪到了类别行 —— 整行收掉，
         铭牌只贡献底图与蒙版（与工作流卡同一手法）。
         选择器要带 .acard-plate 才压得住：铭牌自己的 .head 规则在它自己的作用域里
         （.head[_ngcontent-xxx]，特异性 0,2,0），而 :host ::ng-deep .head 只有 0,2,0，
         平手时谁赢看样式注入顺序。 */
      :host ::ng-deep .acard-plate .head { display: none; }

      /* 标识块：几何（32×32 / 圆角 / 居中）在共享文件里；
         这里只给**底衬** —— 家族码是文字，压在家族色底纹上要有实底才读得出来。 */
      .acard-mark {
        background: color-mix(in oklab, var(--panel) 94%, transparent);
        box-shadow: inset 0 0 0 1px var(--border-strong);
        color: var(--text);
      }
      .acard-mark img {
        object-fit: contain;
        transform: scale(var(--logo-scale, 1));
      }
      /* 只有黑白标才备反白版；彩色 / 渐变资产没有深色版，深色主题下继续用浅色版。 */
      .logo-dark { display: none; }
      :host-context([data-theme='dark']) .logo-light { display: none; }
      :host-context([data-theme='dark']) .logo-dark { display: block; }

      /* 家族码 / 发布方缩写：中性色、方角细框，跟官方品牌标保持视觉距离。
         圆角用 var(--radius-xs)（5px，VIS §6.4 允许档）—— 不写字面量 4px，
         那是圆角中间档，vis-check 1.6 会按棘轮拦住。 */
      .acard-code {
        display: inline-flex;
        align-items: center;
        height: 15px;
        padding: 0 4px;
        border-radius: var(--radius-xs);
        background: var(--panel-3);
        box-shadow: inset 0 0 0 1px var(--border-soft);
        font: 700 9px/1 'Cascadia Mono', Consolas, monospace;
        letter-spacing: 0.02em;
        color: var(--text-2);
        white-space: nowrap;
      }
      .acard.on-shot .acard-code {
        background: rgb(255 255 255 / 0.16);
        box-shadow: none;
        color: #fff;
      }

      /* 类别行：规格不是每张卡都有（名字里没有参数量 / 量化就没有），
         行高必须一样 —— 同一墙卡片高度一乱，节奏就没了。 */
      .card-meta.acard-meta { min-height: 1.4em; }

      /* ⋯ 按钮与菜单浮层的外壳几何都在共享文件里（asset-card.css）；
         这里只补这张卡特有的：菜单项用胶囊外观、菜单底用双层描边。 */
      .acard-menu {
        align-items: flex-start;
        gap: 4px;
        max-height: 104px;
        overflow-y: auto;
        padding: 6px;
        box-shadow: inset 0 0 0 1px var(--border-strong), var(--shadow-md);
      }

      /* 已在库：内容型标记，不是外壳几何。 */
      .in-lib {
        font-size: 11px;
        color: var(--ok);
        white-space: nowrap;
      }
    `,
  ],
})
export class ModelCardComponent {
  @Input({ required: true }) items: SearchItem[] = [];
  /** 后端按「魔搭 → HF → Civitai」解析出来的封面，比条目自带的更优先 */
  @Input() cover = '';
  @Input() inLibrary = false;
  readonly download = output<void>();

  /** 铭牌通知「照片真的显示出来了」；决定正文用白字还是深色字 */
  photoOk = false;

  /** ⋯ 菜单是否展开 */
  menuOpen = false;

  private host = inject(ElementRef<HTMLElement>);
  private theme = inject(ThemeService);

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
   *
   * 不再传 href / hrefLabel：原站链接上移到卡角（.acard-origin），
   * 铭牌里再放一份就成了同一张卡上两个原站入口。
   */
  get plate(): {
    id?: string;
    name: string;
    tags: string[];
    image?: string;
    author?: string;
  } {
    const p = this.primary;
    const shot = this.shot;
    const id = p?.id || '';
    const name = p?.name || '';
    const author = p?.author || '';
    if (
      !this._plate ||
      this._plate.id !== id ||
      this._plate.name !== name ||
      this._plate.image !== shot ||
      this._plate.author !== author
    ) {
      this._plate = { id, name, tags: p?.tags || [], image: shot, author };
    }
    return this._plate;
  }
  private _plate: {
    id?: string;
    name: string;
    tags: string[];
    image?: string;
    author?: string;
  } | null = null;

  /**
   * 家族身份：标识块素材、厂名、规格。跟 plate 一起按引用缓存 ——
   * coverMeta 每次都要跑一遍正则，一屏几十张卡时不该每帧重算。
   */
  get meta(): CoverMeta {
    const p = this.plate;
    if (this._metaFor !== p) {
      this._metaFor = p;
      this._meta = coverMeta(p);
    }
    return this._meta as CoverMeta;
  }
  private _meta: CoverMeta | null = null;
  private _metaFor: unknown = null;

  /** 厂名：家族码（产品里家族只有码，没有另一套展示名） */
  get familyName(): string {
    return this.familyCode || '未知家族';
  }

  /** 标识块里的家族码；未登记家族留空，退到发布方缩写 */
  get familyCode(): string {
    return this.meta.code !== '—' ? this.meta.code : '';
  }

  /**
   * 标识块用官方资产还是家族码。
   *
   * 深色主题下没有反白资产的家族（混元只有浅色版）不能用黑标 ——
   * 深底上等于什么都没画，宁可用家族码。
   */
  get markLogo(): boolean {
    if (!this.meta.logo) return false;
    return !this.darkNow || !!this.meta.logoDark;
  }

  /** 标识块的说明：官方标说家族，缩写说发布方 */
  get markTitle(): string {
    if (this.markLogo) return `${this.meta.code} 官方标识`;
    if (this.familyCode) return `${this.familyCode} 家族`;
    if (this.meta.publisher) return `未登记厂牌 · 发布方：${this.meta.publisher.label}`;
    return '';
  }

  private get darkNow(): boolean {
    return this.theme.theme() === 'dark';
  }

  get authorText(): string {
    const authors = [...new Set(this.items.map((i) => i.author).filter((a) => !!a))];
    return authors.join(' · ');
  }

  /**
   * 右上角原站链接：主条目的原址。
   *
   * 旧卡上它在铭牌顶行（cover-plate 的 .origin），位置随铭牌走；
   * 现在固定到卡角，跟本地库卡同一位置、同一写法。
   */
  get origin(): { href: string; label: string; title: string } {
    const p = this.primary;
    if (!p) return { href: '', label: '', title: '' };
    return {
      href: p.url || '',
      label: sourceShort(p.source),
      title: `打开 ${sourceLabel(p.source)} 上的原始页面`,
    };
  }

  /**
   * ⋯ 菜单：每个来源一条原站入口。
   *
   * 标签位收成一枚之后，来源链接不能跟着一起没 —— 它们是这张卡唯一的出口，
   * 收进菜单（与工作流卡同一手法：次要操作进菜单，主按钮留在外面）。
   */
  get sourceLinks(): { key: string; text: string; href: string; title: string }[] {
    const out: { key: string; text: string; href: string; title: string }[] = [];
    for (const it of this.items) {
      if (!it.url) continue;
      out.push({
        key: `${it.source}:${it.id}`,
        text: sourceShort(it.source),
        href: it.url,
        title: `在 ${sourceLabel(it.source)} 上打开原始仓库`,
      });
    }
    return out;
  }

  /**
   * 文件类型：只有 Civitai 的 modelType 回答得了「这个文件是什么」。
   *
   * 显示走 `core/task-labels.ts` 的**产品词表**（Checkpoint → 主模型、
   * TextEncoder → 文本编码器…）—— 与本地库卡的「存放类型」同一套词。
   * 之前这里保留源站英文原词，同一个东西在发现页写 Checkpoint、在本地库写主模型，
   * 两页对不上；那张表的注释本来就写着「放两处就会漂移」。
   */
  get fileType(): string {
    for (const it of this.items) {
      const t = (it.task || '').trim();
      if (FILE_TYPES.has(t)) return sourceTaskLabel(t);
    }
    return '';
  }

  /**
   * 任务类别（文生图 / 文生视频…）。
   *
   * 优先看条目的 task（HF / MS 的 pipeline_tag 就在那儿）；
   * Civitai 的 task 是文件类型，类别藏在它的 tags 里（text-to-image / text-to-video）。
   */
  get categoryLabel(): string {
    for (const it of this.items) {
      const t = (it.task || '').trim();
      if (!t || FILE_TYPES.has(t)) continue;
      const label = sourceTaskLabel(t);
      if (label) return label;
    }
    for (const it of this.items) {
      for (const raw of it.tags || []) {
        const tag = (raw || '').trim();
        if (!tag || FILE_TYPES.has(tag)) continue;
        const label = SOURCE_TASK_LABELS[tag];
        if (label) return label;
      }
    }
    return '';
  }

  /**
   * 分类标签：恰好一枚。文件类型优先，没有就退到任务类别，再没有就是「模型」。
   */
  get tagText(): string {
    return this.fileType || this.categoryLabel || '模型';
  }

  get tagTitle(): string {
    if (this.fileType) return `文件类型：${this.fileType}`;
    if (this.categoryLabel) return `类别：${this.categoryLabel}`;
    return '模型';
  }

  /**
   * 类别行：类别 + 规格（参数 / 量化）。
   *
   * 类别只在标签位放文件类型时才出现 —— 同一个事实不说两遍；
   * 规格原先印在铭牌顶行上，那块地归了身份行，挪到这里。
   */
  get metaLine(): string {
    const parts: string[] = [];
    if (this.fileType) {
      const cat = this.categoryLabel;
      if (cat) parts.push(cat);
    }
    for (const s of this.meta.specs) parts.push(`${s.k} ${s.v}`);
    return parts.join(' · ');
  }

  /**
   * 状态槽右侧：文件大小。
   *
   * 发现页的条目现在没有大小字段（HF / MS / Civitai 的搜索列表都不给），
   * 所以按可选字段接住：后端补上就直接显示，没补就显示「—」——
   * 不拿点赞之类的别的东西凑数，那会把这个槽位的含义换掉。
   */
  get sizeText(): string {
    const bytes = Math.max(...this.items.map((i) => (i as SizedItem).size || 0), 0);
    return bytes > 0 ? fmtSize(bytes) : '—';
  }

  get maxDownloads(): number {
    return Math.max(...this.items.map((i) => i.downloads || 0), 0);
  }

  /** ⋯ 菜单开关。点外面 / Esc 收起。 */
  toggleMenu(event: MouseEvent): void {
    // 别让「点外面收菜单」的监听器跟着这次点击一起跑
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.menuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen = false;
  }

  fmtNum = fmtNum;
}
