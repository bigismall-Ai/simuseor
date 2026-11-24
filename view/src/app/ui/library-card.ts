import { Component, computed, input, output, signal } from '@angular/core';
import { coverMeta } from '../core/cover';
import { sourceAuthor, sourceLabel, sourceShort, sourceUrl } from '../core/source-links';
import { folderFileTypeLabel } from '../core/task-labels';
import { fmtBytes } from '../core/types';
import type { LibraryModel } from '../core/types';
import { BadgeComponent } from './badge';
import { CardOriginComponent } from './card-origin';
import { CardBodyComponent } from './card-body';
import { CardKebabComponent } from './card-kebab';
import { CardMenuComponent } from './card-menu';
import type { CardMenuItem } from './card-menu';
import { CardMarkComponent } from './card-mark';
import { CoverPlateComponent } from './cover-plate';

/**
 * 模型库卡片：资产卡统一骨架的本地库版。
 *
 * 外壳与几何全部来自 `asset-card.css`（产品侧唯一一份），本组件只填槽位：
 *   ① 封面     .acard-media / .acard-plate —— 铺满整卡
 *   ② 身份行   .acard-head —— 32×32 标识块 + 厂名 / 作者两行
 *   ③ 原站     ui-card-origin —— 动作行左侧
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
    <article
      class="mcard acard"
      [class.on-shot]="shotOk() && !broken()"
      [class.is-broken]="broken()"
     
    >
      <!-- ① 封面：铺满整卡。壳的几何在 asset-card.css，这里只放封面自己的内容 -->
      <div class="acard-media">
        <app-cover-plate
          class="acard-plate"
          ratio="fill"
          [model]="plate()"
          (shotState)="shotOk.set($event)"
        />

        @if (broken()) {
          <div class="broken-inner">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 8v5" />
              <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
              <path
                d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
              />
            </svg>
            <span class="broken-title">{{ brokenTitle() }}</span>
            <span class="broken-msg">{{ brokenMsg() }}</span>
          </div>
        }
      </div>

      <!-- ② 身份行 + ③ 原站链接。排版在 asset-card.css，这里只给库卡特有的内容 -->
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
          @if (author()) {
            <span class="pill-author" [title]="'发布者：' + author()">{{ author() }}</span>
          } @else {
            <span [title]="originLabel()">{{ originLabel() }}</span>
          }
        </span>


        <ui-card-kebab [expanded]="menuOpen()" (toggled)="toggleMenu($event)" />

        @if (menuOpen()) {
          <ui-card-menu [items]="menuItems" (picked)="onMenuPick($event)" />
        }
      </div>

      <!-- 底部信息区：压在封面上的遮罩 -->
      <ui-card-body [title]="model().name" titleClass="mname">
        <!-- 类别行：任务 + 规格。文件类型已经在标签位，只有回落成任务时才需要在这里说一次 -->
        <p class="acard-meta" [title]="metaLine()">{{ metaLine() }}</p>

        <!-- ④ 状态槽：左状态 · 半透明白线 · 右磁盘大小 -->
        <div class="acard-slot">
          <span [class.is-ok]="!broken()" [class.is-err]="broken()" [title]="statusTip()">{{
            statusText()
          }}</span>
          <span class="acard-rule"></span>
          <span class="msize acard-size">{{ fmtBytes(model().size_bytes) }}</span>
        </div>

        <!-- ⑤ 分类标签：恰好一枚 —— 模型文件类型（作者由身份行承担，不再重复） -->
        <div class="plate-meta acard-tags">
          <ui-badge size="sm" [class.pill-demo]="!!model().isDemo" [attr.title]="fileTypeTip()">{{
            fileTypeLabel()
          }}</ui-badge>
        </div>

        <!-- ⑥ 动作行：原站图标在左，主按钮在右；⋯ 在右上角 -->
        <div class="acard-foot">
          <ui-card-origin [href]="sourceHref()" [label]="model().source || '本地'" />

          <button
            type="button"
            class="acard-primary primary btn-xs"
            data-testid="lib-card-primary"
            [title]="primaryTip()"
            (click)="onPrimary()"
          >
            {{ primaryLabel() }}
          </button>
        </div>
      </ui-card-body>
    </article>
  `,
  /* 共享几何走外部样式文件：这份文件的规则会被本组件的作用域改写
     （Emulated 封装），四张卡引用的是同一份源，改一处四张卡一起变。 */
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
      /* ---- 封面内容：家族色底 / 几何纹样 / 铺图 / 蒙版 ---- */
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
        color: var(--ui-error);
      }
      .broken-title {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        background: color-mix(in srgb, var(--ui-error) 14%, transparent);
        color: var(--ui-error);
        padding: 1px 8px;
        border-radius: var(--ui-radius);
      }
      .broken-msg {
        font-size: 10px;
        font-weight: 500;
        color: var(--ui-muted);
        background: var(--ui-card-solid);
        padding: 1px 7px;
        border-radius: var(--ui-radius);
        border: 1px solid color-mix(in srgb, var(--ui-text) 8%, transparent);
        max-width: 82%;
        text-align: center;
        line-height: 1.35;
      }
      /* ---- ⑥ 动作行 ----
         ⋯ 按钮与菜单浮层的几何都在 asset-card.css，这里只补一处：
         删除是破坏性操作，菜单项要说得出 danger。 */
      /* DEMO 是离线占位文件，标红才不会被当成真模型 */
      .acard .acard-tags ui-badge.pill-demo {
        --badge-gray-bg: color-mix(in srgb, var(--ui-error) 14%, transparent);
        --badge-gray-ink: var(--ui-error);
      }

    `,
  ],
  host: {
    '(document:click)': 'closeMenu()',
  },
})
export class LibraryCardComponent {
  readonly model = input.required<LibraryModel>();
  /** 后端解析出的真实封面；取不到就退回家族色构图 */
  readonly cover = input('');
  /** 本机独显显存（GB）；状态槽的浮层说明要用 */
  readonly vramGb = input(0);

  readonly remove = output<void>();
  readonly use = output<void>();
  readonly redownload = output<void>();
  /** 本地导入条目没有远端仓库：主操作改为打开目录，而不是去发现页瞎搜 */
  readonly open = output<void>();

  /** ⋯ 菜单是否展开 */
  readonly menuOpen = signal(false);
  readonly menuItems: CardMenuItem[] = [
    { key: 'remove', label: '删除模型', danger: true, testId: 'lib-card-remove' },
  ];

  /** 照片是否真的画出来了（由共享封面 app-cover-plate 回传） */
  readonly shotOk = signal(false);

  readonly fmtBytes = fmtBytes;

  /**
   * 铭牌信息与色板只在 model 变化时算一次（computed 按输入引用缓存）。
   * 放成普通 getter 会在每次变更检测里重跑正则与哈希 —— 一屏几十张卡、
   * 悬停一下就整墙重算一遍。
   */
  readonly meta = computed(() =>
    coverMeta({
      id: this.model().repo_id,
      name: this.model().name,
      tags: this.model().tags || [],
    }),
  );
  /** 封面类名：家族色底 + 构图变体（旧模板用 ngClass 拼，这里由 computed 出串） */
  readonly plate = computed(() => ({
    id: this.model().id,
    name: this.model().name,
    tags: this.model().tags,
    image: this.broken() ? undefined : this.cover() || undefined,
  }));

  readonly broken = computed(() => {
    const lvl = this.model().vram?.level;
    return lvl === 'broken' || lvl === 'missing';
  });

  readonly brokenTitle = computed(() =>
    this.model().vram?.level === 'broken' ? '权重损坏' : '权重缺失',
  );

  readonly brokenMsg = computed(() =>
    this.model().vram?.level === 'broken'
      ? '有权重文件但头部解析失败'
      : '目录里没有权重文件，下载不完整',
  );

  readonly specLine = computed(() =>
    [this.model().precision, this.model().params].filter(Boolean).join(' · '),
  );

  /** 类别行：任务 + 规格。任务永远在这里说一次，标签位只放文件类型 */
  readonly metaLine = computed(() =>
    [this.taskLabel(), this.specLine()].filter(Boolean).join(' · '),
  );

  /** 任务类型：拿来干什么（文生图 / 文本生成…），是卡上的「类别」 */
  readonly taskLabel = computed(() => this.model().taskLabel || '未标注');

  /**
   * 分类标签：模型文件类型（主模型 / LoRA / 文本编码器…）。
   *
   * 存放类型是物理事实（落在 ComfyUI 的哪个目录），比任务类型更接近「这是什么文件」，
   * 原型里这一格也只放这一层；任务类型挪到上面的类别行，两者不重复。
   *
   * 词走**产品词表**（core/task-labels.ts）：存放目录先映射成文件类型，
   * 再由词表出中文 —— 与发现页同一套词（VIS §3.7.3）。
   */
  readonly fileTypeLabel = computed(() => {
    if (this.model().isDemo) return 'DEMO';
    return folderFileTypeLabel(this.model().folder, this.model().folderLabel || '模型');
  });

  readonly fileTypeTip = computed(() => {
    if (this.model().isDemo) return '离线演示占位文件，权重内容为假';
    return this.model().folderLabel
      ? `存放类型：${this.model().folderLabel}`
      : '文件类型未标注（存放目录不在已知分类里）';
  });

  /**
   * 模型原站地址。优先用后端入库时留下的精确版本页（HF 分支 / Civitai
   * modelVersionId）；老数据没有 source_url 时回退到按 source + repo_id 拼的主页。
   * 本地导入 / Demo 两者都为空，不渲染链接。
   */
  readonly sourceHref = computed(
    () => this.model().source_url || sourceUrl(this.model().source, this.model().repo_id),
  );

  readonly sourceShortLabel = computed(() => sourceShort(this.model().source));

  readonly sourceTitle = computed(() => `在 ${sourceLabel(this.model().source)} 上打开原始仓库`);

  /** 发布方：HF / ModelScope 的仓库归属，其它来源没有可靠字段 */
  readonly author = computed(() => sourceAuthor(this.model().source, this.model().repo_id));

  /** 厂名：家族码（产品里家族只有码，没有另一套展示名） */
  readonly familyName = computed(() => this.familyCode() || '未知家族');

  /** 标识块里的家族码；未登记家族留空，退到发布方缩写 */
  readonly familyCode = computed(() => (this.meta().code !== '—' ? this.meta().code : ''));

  /** 标识块的说明：官方标说家族，缩写说发布方 */
  readonly markTitle = computed(() => {
    if (this.meta().logo) return `${this.meta().code} 官方标识`;
    if (this.familyCode()) return `${this.familyCode()} 家族`;
    if (this.meta().publisher) return `未登记厂牌 · 发布方：${this.meta().publisher?.label}`;
    return '';
  });

  /** 身份行第二行没有发布者时说清这条模型从哪来 */
  readonly originLabel = computed(() => {
    if (this.model().isDemo) return '演示数据';
    if (this.model().source === 'imported') return '本地导入';
    return '未登记发布者';
  });

  /**
   * ④ 状态槽左侧：这条资产在库里是什么状态。
   *
   * 坏件的说法直接取封面区那一行（`brokenTitle`）—— 同一个状态在一张卡上
   * 出现两种说法（「权重损坏」与「文件格式错误」）会让「在库 / 权重缺失 / 权重损坏」
   * 三个口径定不下来。这里复用同一个来源，改一处即两处一起改。
   */
  readonly statusText = computed(() => {
    const lvl = this.model().vram?.level;
    if (lvl === 'broken' || lvl === 'missing') return this.brokenTitle();
    return '在库';
  });

  /**
   * 状态槽的浮层说明 —— 显存压力条撤掉后，本机跑不跑得动只在这里说。
   *
   * 用后端算好的结论（跑得动 / 勉强 / 装不下）与差额，不在前端重算一遍。
   */
  readonly statusTip = computed(() => {
    const v = this.model().vram;
    const parts = [v?.text, v?.hint].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    if (!this.vramGb()) return '本机未检测到独立显卡，无法判断能否运行';
    const need = this.model().needGb ?? 0;
    return need > 0
      ? `显存压力 · 本机 ${this.vramGb().toFixed(0)} GB（估算值，实际占用取决于推理方式）`
      : '';
  });

  /** ⑥ 主按钮：残缺条目的唯一下一步是补救，正常条目去找能跑它的工作流 */
  /** 只有「有原站的模型」才能按原仓库 / 原版本 / 原文件重下 */
  readonly canRedownload = computed(
    () =>
      ['huggingface', 'modelscope', 'civitai'].includes(this.model().source) &&
      !!this.model().repo_id,
  );

  readonly primaryLabel = computed(() => {
    if (!this.broken()) return '查找适配工作流';
    return this.canRedownload() ? '重新下载模型' : '打开目录';
  });

  readonly primaryTip = computed(() => {
    if (!this.broken()) return '查找能运行它的工作流';
    return this.canRedownload()
      ? '按原仓库 / 原版本 / 原文件重新下载'
      : '本地导入条目没有原站仓库；打开目录查看或清理';
  });


  /** ⋯ 菜单：破坏性操作（删除模型）收在这里，主按钮位只放正事 */
  onMenuPick(key: string): void {
    this.menuOpen.set(false);
    if (key === 'remove') this.onRemove();
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  /** 点别处收起菜单 */
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  onPrimary(): void {
    if (!this.broken()) {
      this.use.emit();
      return;
    }
    if (this.canRedownload()) this.redownload.emit();
    else this.open.emit();
  }

  onRemove(): void {
    this.menuOpen.set(false);
    this.remove.emit();
  }
}
