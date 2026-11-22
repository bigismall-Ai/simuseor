import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, OnChanges, OnDestroy, SimpleChanges, output } from '@angular/core';
import { LibraryModel, fmtBytes } from '../core/types';
import { coverMeta } from '../core/cover';
import { modelTone, type Tone } from '../core/model-tone';
import { sourceAuthor, sourceLabel, sourceShort, sourceUrl } from '../core/source-links';
import { folderFileTypeLabel } from '../core/task-labels';

/**
 * 模型库卡片：资产卡统一骨架的本地库版。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面     .acard-media / .acard-plate —— 铺满整卡
 *   ② 身份行   .acard-head —— 32×32 标识块 + 厂名 / 作者两行
 *   ③ 原站     .acard-origin —— 右上角
 *   ④ 状态槽   .acard-slot —— 左状态 · 一根白线 · 右磁盘大小
 *   ⑤ 标签     .acard-tags —— 恰好一枚（模型文件类型）
 *   ⑥ 动作行   .acard-foot —— ⋯ 在左，主按钮在右
 *
 * 为什么不再「145px 封面 + 独立页脚」：本地库与发现页是同一批资产的两种状态，
 * 两套壳会让「这条已经在库里」和「这条可以下」看起来不像同一件东西。
 *
 * 显存压力条撤掉了（原型口径）：本机跑不跑得动是**环境**的属性，不是资产的属性，
 * 留在模型卡上，一屏卡片就被本机显卡牵着走。真要这个信息时，
 * 状态槽左边的状态字带着浮层说明（后端算好的结论与差额）。
 *
 * 颜色不写家族类，而是把「家族色优先、任务色兜底」算成两套变量内联
 * （`--t-*` / `--t-*-d`），再由 CSS 映射到 `--plate-*`：
 * 内联永远赢过 CSS 规则，两套色都写内联的话深色主题切不过去。
 */
@Component({
  selector: 'md-library-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="mcard acard"
      [class.on-shot]="shotOk && !broken"
      [class.is-broken]="broken"
      [style.--t-bg]="tone.bg"
      [style.--t-ink]="tone.ink"
      [style.--t-strong]="tone.strong"
      [style.--t-mark]="tone.mark"
      [style.--t-bg-d]="toneDark.bg"
      [style.--t-ink-d]="toneDark.ink"
      [style.--t-strong-d]="toneDark.strong"
      [style.--t-mark-d]="toneDark.mark"
    >
      <!-- ① 封面：铺满整卡。壳的几何在 asset-card.css，这里只放封面自己的内容 -->
      <div class="acard-media">
        <div class="acard-plate">
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

            @if (broken) {
              <div class="broken-inner">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                     stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M12 8v5" />
                  <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
                  <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                <span class="broken-title">{{ brokenTitle }}</span>
                <span class="broken-msg">{{ brokenMsg }}</span>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- ② 身份行 + ③ 原站链接。排版在 asset-card.css，这里只给库卡特有的内容 -->
      <div class="acard-head">
        <span class="acard-mark brand" [title]="markTitle">
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
          @if (author) {
            <span class="pill-author" [title]="'发布者：' + author">{{ author }}</span>
          } @else {
            <span [title]="originLabel">{{ originLabel }}</span>
          }
        </span>

        @if (sourceHref) {
          <a
            class="origin acard-origin"
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

      <!-- 底部信息区：压在封面上的遮罩 -->
      <div class="acard-body">
        <h3 class="mname acard-name" [title]="model.name">{{ model.name }}</h3>
        <!-- 类别行：任务 + 规格。文件类型已经在标签位，只有回落成任务时才需要在这里说一次 -->
        <p class="acard-meta" [title]="metaLine">{{ metaLine }}</p>

        <!-- ④ 状态槽：左状态 · 半透明白线 · 右磁盘大小 -->
        <div class="acard-slot">
          <span [class.is-ok]="!broken" [class.is-err]="broken" [title]="statusTip">{{ statusText }}</span>
          <span class="acard-rule"></span>
          <span class="msize acard-size">{{ fmtBytes(model.size_bytes) }}</span>
        </div>

        <!-- ⑤ 分类标签：恰好一枚 —— 模型文件类型（作者由身份行承担，不再重复） -->
        <div class="plate-meta acard-tags">
          <span class="pill" [class.pill-demo]="!!model.isDemo" [title]="fileTypeTip">{{ fileTypeLabel }}</span>
        </div>

        <!-- ⑥ 动作行：⋯ 在左（破坏性操作收进去），主按钮在右 -->
        <div class="acard-foot">
          <button
            type="button"
            class="acard-kebab"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen"
            aria-label="更多操作"
            title="更多操作"
            data-testid="lib-card-kebab"
            (click)="toggleMenu($event)"
          >⋯</button>

          @if (menuOpen) {
            <div class="acard-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="acard-menu-item is-danger"
                data-testid="lib-card-remove"
                (click)="onRemove()"
              >删除模型</button>
            </div>
          }

          <button
            type="button"
            class="acard-primary primary btn-xs"
            data-testid="lib-card-primary"
            (click)="onPrimary()"
          >{{ primaryLabel }}</button>
        </div>
      </div>
    </article>
  `,
  /* 共享几何走外部样式文件：这份文件的规则会被本组件的作用域改写
     （Emulated 封装），四张卡引用的是同一份源，改一处四张卡一起变。
     为什么不是 styles: ['./asset-card.css', …] —— ng build 的 esbuild 构建器
     只认 styleUrl / styleUrls，styles 数组里的字符串一律当内联 CSS 解析，
     写成路径会直接报「Unknown word ./asset-card.css」。 */
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .mcard {
        /* 间接层：内联只给 --t-*，这里映射到 --plate-*，深色主题才切得动 */
        --plate-bg: var(--t-bg);
        --plate-ink: var(--t-ink);
        --plate-strong: var(--t-strong);
        --plate-mark: var(--t-mark);
      }
      :host-context([data-theme='dark']) .mcard {
        --plate-bg: var(--t-bg-d);
        --plate-ink: var(--t-ink-d);
        --plate-strong: var(--t-strong-d);
        --plate-mark: var(--t-mark-d);
      }
      /* 有照片时封面上的字翻白。压在这一层而不是根上：
         深色主题的色板映射（--t-strong-d）写在根上，根上的声明会一路继承下来，
         只有在用它的那一层（身份行）再声明一次才盖得住。 */
      .acard.on-shot .acard-head {
        --plate-strong: #fff;
        --plate-ink: rgb(255 255 255 / 0.78);
      }

      /* ---- 封面内容：家族色底 / 几何纹样 / 铺图 / 蒙版 ---- */
      .mplate {
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

      /* 纹样：5 种变体，类名在 .motif 自己身上（.mo-0::before） */
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

      /* ---- ② 标识块：共享几何给了 32×32 与布局，底衬由本卡定 ----
         家族标自带底衬，家族码 / 发布方缩写没有 —— 两种都得有实底才读得出来。 */
      .acard-mark {
        background: color-mix(in oklab, var(--panel) 94%, transparent);
        box-shadow: inset 0 0 0 1px var(--border-strong);
        color: var(--text);
      }
      .acard-mark img {
        object-fit: contain;
        transform: scale(var(--logo-scale, 1));
      }
      /* 只有黑白标才备反白版。彩色 / 渐变资产（Qwen 紫、混元多色、MiniMax 渐变）
         没有深色版：深色主题下必须继续显示浅色版，否则整个厂标会消失。 */
      .logo-dark { display: none; }
      :host-context([data-theme='dark']) .logo-light { display: none; }
      :host-context([data-theme='dark']) .logo-dark { display: block; }

      /* 家族码 / 发布方缩写：中性色、方角细框，跟官方品牌标保持视觉距离
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
        /* 警示块整块落在封面区里，不能压到底部信息带下面 ——
           封面铺满整卡之后，信息带的位置随内容高度变，只能靠收紧这一块腾地方。 */
        top: 42px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        color: var(--err);
      }
      .broken-title {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        background: var(--err-soft);
        color: var(--err);
        padding: 1px 8px;
        border-radius: var(--radius-xs);
      }
      .broken-msg {
        font-size: 10px;
        font-weight: 500;
        color: var(--muted);
        background: var(--panel);
        padding: 1px 7px;
        border-radius: var(--radius-xs);
        border: 1px solid var(--border-soft);
        max-width: 82%;
        text-align: center;
        line-height: 1.35;
      }
      /* 斜纹底太花，标识块压在上面读不清 → 给它一块实底衬 */
      .is-broken .acard-mark { background: var(--panel); }

      /* ---- ⑥ 动作行 ----
         ⋯ 按钮与菜单浮层的几何都在 asset-card.css，这里只补一处：
         删除是破坏性操作，菜单项要说得出 danger。 */
      .acard-menu-item.is-danger { color: var(--err); }
      .acard-menu-item.is-danger:hover { background: var(--err-soft); color: var(--err); }

      /* DEMO 是离线占位文件，标红才不会被当成真模型 */
      .acard .acard-tags .pill.pill-demo {
        background: var(--err-soft);
        color: var(--err);
      }
    `,
  ],
})
export class LibraryCardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) model!: LibraryModel;
  /** 后端解析出的真实封面；取不到就退回家族色构图 */
  @Input() cover = '';
  /** 本机独显显存（GB）；状态槽的浮层说明要用 */
  @Input() vramGb = 0;

  readonly remove = output<void>();
  readonly use = output<void>();
  readonly redownload = output<void>();

  /** ⋯ 菜单是否展开 */
  menuOpen = false;

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

  /** 类别行：任务 + 规格。任务永远在这里说一次，标签位只放文件类型 */
  get metaLine(): string {
    return [this.taskLabel, this.specLine].filter(Boolean).join(' · ');
  }

  /** 任务类型：拿来干什么（文生图 / 文本生成…），是卡上的「类别」 */
  get taskLabel(): string {
    return this.model.taskLabel || '未标注';
  }

  /**
   * 分类标签：模型文件类型（主模型 / LoRA / 文本编码器…）。
   *
   * 存放类型是物理事实（落在 ComfyUI 的哪个目录），比任务类型更接近「这是什么文件」，
   * 原型里这一格也只放这一层；任务类型挪到上面的类别行，两者不重复。
   *
   * 词走**产品词表**（core/task-labels.ts）：存放目录先映射成文件类型，
   * 再由词表出中文 —— 与发现页同一套词（VIS §3.7.3）。
   * 否则同一个文件在发现页写「嵌入」、在本地库写「Embedding」。
   */
  get fileTypeLabel(): string {
    if (this.model.isDemo) return 'DEMO';
    return folderFileTypeLabel(this.model.folder, this.model.folderLabel || '模型');
  }

  get fileTypeTip(): string {
    if (this.model.isDemo) return '离线演示占位文件，权重内容为假';
    return this.model.folderLabel
      ? `存放类型：${this.model.folderLabel}`
      : '文件类型未标注（存放目录不在已知分类里）';
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

  /** 厂名：家族码（产品里家族只有码，没有另一套展示名） */
  get familyName(): string {
    return this.familyCode || '未知家族';
  }

  /** 标识块里的家族码；未登记家族留空，退到发布方缩写 */
  get familyCode(): string {
    return this.meta.code !== '—' ? this.meta.code : '';
  }

  /** 标识块的说明：官方标说家族，缩写说发布方 */
  get markTitle(): string {
    if (this.meta.logo) return `${this.meta.code} 官方标识`;
    if (this.familyCode) return `${this.familyCode} 家族`;
    if (this.meta.publisher) return `未登记厂牌 · 发布方：${this.meta.publisher.label}`;
    return '';
  }

  /** 身份行第二行没有发布者时说清这条模型从哪来 */
  get originLabel(): string {
    if (this.model.isDemo) return '演示数据';
    if (this.model.source === 'imported') return '本地导入';
    return '未登记发布者';
  }

  /**
   * ④ 状态槽左侧：这条资产在库里是什么状态。
   *
   * 坏件的说法直接取封面区那一行（`brokenTitle`）—— 同一个状态在一张卡上
   * 出现两种说法（「权重损坏」与「文件格式错误」）会让「在库 / 权重缺失 / 权重损坏」
   * 三个口径定不下来。这里复用同一个来源，改一处即两处一起改。
   */
  get statusText(): string {
    const lvl = this.model.vram?.level;
    if (lvl === 'broken' || lvl === 'missing') return this.brokenTitle;
    return '在库';
  }

  /**
   * 状态槽的浮层说明 —— 显存压力条撤掉后，本机跑不跑得动只在这里说。
   *
   * 用后端算好的结论（跑得动 / 勉强 / 装不下）与差额，不在前端重算一遍。
   */
  get statusTip(): string {
    const v = this.model.vram;
    const parts = [v?.text, v?.hint].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    if (!this.vramGb) return '本机未检测到独立显卡，无法判断能否运行';
    const need = this.model.needGb ?? 0;
    return need > 0
      ? `显存压力 · 本机 ${this.vramGb.toFixed(0)} GB（估算值，实际占用取决于推理方式）`
      : '';
  }

  /** ⑥ 主按钮：残缺条目的唯一下一步是补救，正常条目去找能跑它的工作流 */
  get primaryLabel(): string {
    return this.broken ? '重新下载模型' : '查找适配工作流';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['model'] && this.model) {
      this.meta = coverMeta({ id: this.model.repo_id, name: this.model.name, tags: this.model.tags || [] });
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

  /** ⋯ 菜单：破坏性操作（删除模型）收在这里，主按钮位只放正事 */
  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  /** 点别处收起菜单 */
  @HostListener('document:click')
  closeMenu(): void {
    this.menuOpen = false;
  }

  onPrimary(): void {
    if (this.broken) this.redownload.emit();
    else this.use.emit();
  }

  onRemove(): void {
    this.menuOpen = false;
    this.remove.emit();
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
