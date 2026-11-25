import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { coverMeta } from '../core/cover';
import { sourceLabel, sourceShort } from '../core/source-links';
import { SOURCE_TASK_LABELS, sourceTaskLabel } from '../core/task-labels';
import { ThemeService } from '../core/theme.service';
import { fmtInt } from '../core/types';
import { BadgeComponent } from './badge';
import { CardOriginComponent } from './card-origin';
import { CardBodyComponent } from './card-body';
import { CardKebabComponent } from './card-kebab';
import { CardMenuComponent } from './card-menu';
import type { CardMenuItem } from './card-menu';
import { CardMarkComponent } from './card-mark';
import { CoverPlateComponent } from './cover-plate';
import type { CoverInput } from '../core/cover';
import type { SearchItem } from '../core/types';

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
  'Checkpoint',
  'LORA',
  'LoCon',
  'VAE',
  'Controlnet',
  'TextualInversion',
  'TextEncoder',
  'Upscaler',
  'Embedding',
  'Hypernetwork',
  'Motion Module',
  'Style Model',
  'Aesthetic Gradient',
  'Poses',
  'Wildcards',
  'ComfyWorkflows',
  'LLM',
]);

/**
 * 模型卡：资产卡统一骨架的模型版。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面   铺满整卡的铭牌（只贡献底图与蒙版）
 *   ② 身份行 32×32 标识块 + 厂名 / 作者
 *   ③ 原站   右上角一条原站链接
 *   ④ 状态槽 左下载量 · 一根白线 · 右点赞
 *   ⑤ 标签   恰好一枚（文件类型）
 *   ⑥ 动作行 ⋯ 在左，主按钮在右
 *
 * 为什么把标签位收成一枚：旧卡一排等权重胶囊（类型 / 来源 / 作者 + 「+N」），
 * 信息互相稀释 —— 来源链接是出口，不该跟分类挤在一行；作者归身份行；
 * 分类只剩「这是什么文件」一件事，一枚就够。
 */
@Component({
  selector: 'md-model-card',
  imports: [
    BadgeComponent,
    CardBodyComponent,
    CardKebabComponent,
    CardOriginComponent,
    CardMarkComponent,
    CardMenuComponent,
    CoverPlateComponent,
  ],
  template: `
    <article class="card acard" [class.on-shot]="photoOk()">
      <!-- ① 封面：铺满整卡。ratio="fill" 不声明比例，宽高由外层给 ——
           本卡封面是 position:absolute; inset:0 铺满整卡，正是 fill 的语义。
           铭牌自带的顶行（厂标 + 家族码 + 规格 + 原站链接）在这里是重复的：
           身份与原站由 .acard-head 承担，所以整行收掉（与工作流卡同一手法）。 -->
      <div class="acard-media">
        <app-cover-plate
          class="card-plate acard-plate"
          ratio="fill"
          [model]="plate()"
          (shotState)="photoOk.set($event)"
        />
      </div>

      <!-- ② 身份行（32×32 标识块 + 厂名 / 作者） + ③ 右上角原站链接 -->
      <div class="acard-head">
        <ui-card-mark
          [logo]="meta().logo || ''"
          [logoDark]="meta().logoDark || ''"
          [code]="familyCode() || (meta().publisher?.abbr ?? '')"
          [scale]="meta().logoScale || 1"
          [title]="markTitle()"
        />

        <span class="acard-ident">
          <b [title]="familyName()">{{ familyName() }}</b>
          <span [title]="authorText()">{{ authorText() || '—' }}</span>
        </span>


        <ui-card-kebab [expanded]="menuOpen()" (toggled)="toggleMenu($event)" />

        @if (menuOpen()) {
          <ui-card-menu [items]="menuItems()" (picked)="onMenuPick()" />
        }
      </div>

      <ui-card-body [title]="primary()?.name || ''" titleClass="card-name">

        <!-- 类别行：参数 / 量化（原先在铭牌顶行上，那块地归了身份行）。
             高度固定 —— 规格不是每张卡都有，行高不一致整墙卡片就会参差。 -->
        <p class="card-meta acard-meta" [title]="metaLine()">{{ metaLine() }}</p>

        <!-- ④ 状态槽：左下载量 · 一根白线 · 右点赞。
             发现页的搜索接口不返回文件大小，所以右侧不拿「—」占位：
             换成本页已有的第二个质量信号「点赞」。下载量回答「有多少人用」，
             点赞回答「用过的人认不认」，两者同一层但不是同一件事。 -->
        <div class="card-slot acard-slot">
          <span [title]="'下载量：' + fmtInt(maxDownloads())">↓ {{ fmtInt(maxDownloads()) }}</span>
          <span class="acard-rule"></span>
          <span class="card-likes acard-size" [title]="'点赞：' + fmtInt(maxLikes())">
            ♥ {{ fmtInt(maxLikes()) }}
          </span>
        </div>

        <!-- ⑤ 分类标签：恰好一枚。站点入口归右上角与 ⋯ 菜单，不再占标签位。 -->
        <div class="card-tags acard-tags">
          <ui-badge size="sm" [attr.title]="tagTitle()">{{ tagText() }}</ui-badge>
        </div>

        <!-- ⑥ 动作行：主按钮在右；⋯ 已移到右上角 -->
        <div class="card-actions acard-foot">
          <ui-card-origin [href]="origin().href" [label]="origin().name" />

          <!-- 发现页与本地库**只换 ④ 左侧与 ⑥ 主按钮**，
               其余完全一样（VIS §3.7.3）—— 所以这里不再挂「已在库」标记：
               「已在库」由状态条事实槽「已入库 N」与列表视图的徽章报。 -->
          <button
            class="acard-primary primary btn-xs"
            (click)="download.emit()"
            data-testid="card-download"
          >
            下载
          </button>
        </div>
      </ui-card-body>
    </article>
  `,
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      /* 铭牌自带的顶行（厂标 + 家族码 + 搬运标注 + 规格）在本卡里是重复的：
         身份行已经在卡角给出厂标与厂名，规格挪到了类别行 —— 整行收掉，
         铭牌只贡献底图与蒙版（与工作流卡同一手法）。
         选择器要带 .acard-plate 才压得住：铭牌自己的 .head 规则在它自己的作用域里
         （.head[_ngcontent-xxx]，特异性 0,2,0），而 :host ::ng-deep .head 只有 0,2,0，
         平手时谁赢看样式注入顺序。 */
/* ⋯ 按钮与菜单浮层的外壳几何都在共享文件里（asset-card.css）；
         这里只补这张卡特有的：菜单项用胶囊外观、菜单底用双层描边。 */
    `,
  ],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ModelCardComponent {
  readonly items = input.required<SearchItem[]>();
  /** 后端按「魔搭 → HF → Civitai」解析出来的封面，比条目自带的更优先 */
  readonly cover = input('');
  readonly inLibrary = input(false);
  readonly download = output<void>();

  /** 铭牌通知「照片真的显示出来了」；决定正文用白字还是深色字 */
  readonly photoOk = signal(false);

  /** ⋯ 菜单是否展开 */
  readonly menuOpen = signal(false);
  readonly menuItems = computed<CardMenuItem[]>(() =>
    this.sourceLinks().map((s) => ({ key: s.key, label: s.text, href: s.href })),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly theme = inject(ThemeService);

  readonly primary = computed(() => this.items()[0]);

  /**
   * 一组来源里任意一个带缩略图就用它，顺序固定为 魔搭 → HF → Civitai。
   *
   * 为什么不是「谁先有图就用谁」：同名模型常同时挂在三家，魔搭的示例图质量
   * 和相关性普遍好于 Civitai 的社区投稿；顺序写死才不会因为返回顺序变化而抖动。
   * `cover` 是后端按同一顺序解析好的结果，优先级最高。
   */
  readonly shot = computed<string | undefined>(() => {
    if (this.cover()) return this.cover();
    for (const source of COVER_ORDER) {
      const hit = this.items().find((i) => i.source === source && !!i.image);
      if (hit) return hit.image;
    }
    return this.items().find((i) => !!i.image)?.image;
  });

  /**
   * 铭牌只吃稳定字段：name 定家族与构图，tags 辅助分类；有缩略图就铺图。
   *
   * 不再传 href / hrefLabel：原站链接上移到卡角（.acard-origin），
   * 铭牌里再放一份就成了同一张卡上两个原站入口。
   */
  readonly plate = computed<CoverInput>(() => {
    const p = this.primary();
    return {
      id: p?.id || '',
      name: p?.name || '',
      tags: p?.tags || [],
      image: this.shot(),
      author: p?.author || '',
    };
  });

  /**
   * 家族身份：标识块素材、厂名、规格。
   *
   * coverMeta 每次都要跑一遍正则，放在 computed 里按输入缓存 —— 一屏几十张卡时
   * 不该每帧重算。
   */
  readonly meta = computed(() => coverMeta(this.plate()));

  /** 厂名：家族码（产品里家族只有码，没有另一套展示名） */
  readonly familyName = computed(() => this.familyCode() || '未知家族');

  /** 标识块里的家族码；未登记家族留空，退到发布方缩写 */
  readonly familyCode = computed(() => (this.meta().code !== '—' ? this.meta().code : ''));

  private readonly darkNow = computed(() => this.theme.theme() === 'dark');

  /**
   * 标识块用官方资产还是家族码。
   *
   * 深色主题下没有反白资产的家族（混元只有浅色版）不能用黑标 ——
   * 深底上等于什么都没画，宁可用家族码。
   */
  readonly markLogo = computed(() => {
    if (!this.meta().logo) return false;
    return !this.darkNow() || !!this.meta().logoDark;
  });

  /** 标识块的说明：官方标说家族，缩写说发布方 */
  readonly markTitle = computed(() => {
    if (this.markLogo()) return `${this.meta().code} 官方标识`;
    if (this.familyCode()) return `${this.familyCode()} 家族`;
    if (this.meta().publisher) return `未登记厂牌 · 发布方：${this.meta().publisher?.label}`;
    return '';
  });

  readonly authorText = computed(() => {
    const authors = [
      ...new Set(
        this.items()
          .map((i) => i.author)
          .filter((a) => !!a),
      ),
    ];
    return authors.join(' · ');
  });

  /**
   * 右上角原站链接：主条目的原址。
   *
   * 旧卡上它在铭牌顶行（cover-plate 的 .origin），位置随铭牌走；
   * 现在固定到卡角，跟本地库卡同一位置、同一写法。
   */
  readonly origin = computed(() => {
    const p = this.primary();
    if (!p) return { href: '', label: '', name: '', title: '' };
    return {
      href: p.url || '',
      label: sourceShort(p.source),
      name: sourceLabel(p.source),
      title: `打开 ${sourceLabel(p.source)} 上的原始页面`,
    };
  });

  /**
   * ⋯ 菜单：每个来源一条原站入口。
   *
   * 标签位收成一枚之后，来源链接不能跟着一起没 —— 它们是这张卡唯一的出口，
   * 收进菜单（与工作流卡同一手法：次要操作进菜单，主按钮留在外面）。
   */
  readonly sourceLinks = computed(() => {
    const out: { key: string; text: string; href: string; title: string }[] = [];
    for (const it of this.items()) {
      if (!it.url) continue;
      out.push({
        key: `${it.source}:${it.id}`,
        text: sourceShort(it.source),
        href: it.url,
        title: `在 ${sourceLabel(it.source)} 上打开原始仓库`,
      });
    }
    return out;
  });

  /**
   * 文件类型：只有 Civitai 的 modelType 回答得了「这个文件是什么」。
   *
   * 显示走 `core/task-labels.ts` 的**产品词表**（Checkpoint → 主模型、
   * TextEncoder → 文本编码器…）—— 与本地库卡的「存放类型」同一套词。
   */
  readonly fileType = computed(() => {
    for (const it of this.items()) {
      const t = (it.task || '').trim();
      if (FILE_TYPES.has(t)) return sourceTaskLabel(t);
    }
    return '';
  });

  /**
   * 任务类别（文生图 / 文生视频…）。
   *
   * 优先看条目的 task（HF / MS 的 pipeline_tag 就在那儿）；
   * Civitai 的 task 是文件类型，类别藏在它的 tags 里（text-to-image / text-to-video）。
   */
  readonly categoryLabel = computed(() => {
    for (const it of this.items()) {
      const t = (it.task || '').trim();
      if (!t || FILE_TYPES.has(t)) continue;
      const label = sourceTaskLabel(t);
      if (label) return label;
    }
    for (const it of this.items()) {
      for (const raw of it.tags || []) {
        const tag = (raw || '').trim();
        if (!tag || FILE_TYPES.has(tag)) continue;
        const label = SOURCE_TASK_LABELS[tag];
        if (label) return label;
      }
    }
    return '';
  });

  /**
   * 分类标签：恰好一枚，只回答「这是什么文件」。
   *
   * 认不出文件类型就写「模型」—— 不拿任务类别顶替：
   * 任务已经在上面的类别行，标签位再写一次就是同一个事实说两遍。
   */
  readonly tagText = computed(() => this.fileType() || '模型');

  readonly tagTitle = computed(() =>
    this.fileType() ? `文件类型：${this.fileType()}` : '文件类型未标注',
  );

  /**
   * 类别行：类别 + 规格（参数 / 量化）。
   *
   * 类别永远在这里说一次；标签位只放文件类型。规格原先印在铭牌顶行上，
   * 那块地归了身份行，挪到这里。
   */
  readonly metaLine = computed(() => {
    const parts: string[] = [];
    if (this.categoryLabel()) parts.push(this.categoryLabel());
    for (const s of this.meta().specs) parts.push(`${s.k} ${s.v}`);
    return parts.length ? parts.join(' · ') : '未标注';
  });

  readonly maxDownloads = computed(() => Math.max(...this.items().map((i) => i.downloads || 0), 0));

  /** 同一模型多来源时取最高点赞：与下载量同口径，不让合并行看起来比单源还冷 */
  readonly maxLikes = computed(() => Math.max(...this.items().map((i) => i.likes || 0), 0));

  /** ⋯ 菜单开关。点外面 / Esc 收起。 */
  onMenuPick(): void {
    this.menuOpen.set(false);
  }

  toggleMenu(event: MouseEvent): void {
    // 别让「点外面收菜单」的监听器跟着这次点击一起跑
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  onEscape(): void {
    this.menuOpen.set(false);
  }

  readonly fmtInt = fmtInt;
}
