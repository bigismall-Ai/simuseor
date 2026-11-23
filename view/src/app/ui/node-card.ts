import { Component, computed, input, output, signal } from '@angular/core';
import { CardMarkComponent } from './card-mark';
import { CoverPlateComponent } from './cover-plate';
import { fmtSize } from '../core/types';

/**
 * 卡片要读的字段。
 *
 * 发现页给的是清单条目、节点库页给的是已装条目，两边字段不一样，
 * 但都带「名字 / 仓库 / 节点类」，所以这里只声明这张卡真正用到的那几个；
 * 多出来的字段（清单 id、目录、版本……）由页面自己处理，不动共享类型。
 */
export interface NodeCardItem {
  name: string;
  /** 已装条目的展示名（清单里的标题）；没有就用 name */
  title?: string;
  id?: string;
  author?: string;
  repo?: string;
  description?: string;
  /** 主用途分类（后端按标题 / 描述 / 节点类名推断）；清单条目可能没有 */
  category?: string;
  tags?: string[];
  /** 节点类名（清单里截前 10 个） */
  nodes?: string[];
  node_count?: number;
  install_type?: string;
  installable?: boolean;
  /** 额外依赖：pip 包 / 系统包 */
  needs?: string[];
  /** 与其它扩展重名的节点 */
  preemptions?: string[];
  installed?: boolean;
  /* ---- 节点库页 ---- */
  dir?: string;
  disabled?: boolean;
  commit?: string;
  size?: number;
  tracked?: boolean;
  requirements?: boolean;
  /** 预览图。清单目前没有这个字段，留着是为了有图时能直接铺满整卡 */
  image?: string;
}

/**
 * 节点卡：把「一行扩展」变成一张卡。
 *
 * 骨架六层与其它资产卡完全一致（几何在 asset-card.css），只有槽位内容是节点自己的：
 *   ④ 状态槽右 = 节点类数 —— 节点没有磁盘大小，它的规模就是提供多少节点类
 *   ⑤ 分类标签 = **它提供什么**（代表节点类名 +「+N」；一个节点类都不提供的给「管理面板」）
 *
 * 封面：节点扩展没有天然封面（清单里只有仓库地址），所以走共享铭牌兜底
 * （家族色底 + 几何纹样），上面压一枚大号标识 + 名字 —— 原型 `.ac-count.is-mark` 的做法。
 * 铭牌自带的顶行（厂牌标 / 厂牌码 / 原站）在这里是重复的：这张卡左上角已经有
 * 自己的身份行，所以整行收掉，只借铭牌的底、纹样、图与蒙版。
 */
@Component({
  selector: 'md-node-card',
  imports: [CardMarkComponent, CoverPlateComponent],
  template: `
    <article class="nd-card acard" [class.on-shot]="photoOk()">
      <!-- ① 封面：铺满整卡 -->
      <div class="acard-media">
        <div class="acard-plate">
          <app-cover-plate
            class="nd-plate"
            ratio="fill"
            [model]="plate()"
            (shotState)="photoOk.set($event)"
          />
          <div class="nd-cover">
            <strong>{{ mark() }}</strong>
            <span [title]="coverName()">{{ coverName() }}</span>
          </div>
        </div>
      </div>

      <!-- ② 身份行 + ③ 原站链接 -->
      <div class="acard-head">
        <ui-card-mark [code]="mark()" [title]="displayName()" [onShot]="photoOk()" />
        <span class="acard-ident">
          <!-- ② 身份行：短名 + 作者。全名留给下面的卡片标题 ——
               两处都写全名，同一张卡上同一个名字出现两次（原型口径：
               身份行 b=短厂名 / span=作者，标题才是全名）。 -->
          <b [title]="displayName()">{{ coverName() }}</b>
          <span [title]="subLine()">{{ subLine() }}</span>
        </span>
        @if (item().repo) {
          <a
            class="acard-origin"
            [href]="item().repo"
            target="_blank"
            rel="noreferrer"
            title="打开仓库"
          >
            GitHub
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 2.5H2.5v7h7v-2" />
              <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
            </svg>
          </a>
        }
      </div>

      <div class="acard-body">
        <h3 class="acard-name" [title]="displayName()">{{ displayName() }}</h3>
        <div class="acard-details">
        <p class="acard-meta" [title]="metaText()">{{ metaText() }}</p>

        <!-- ④ 状态槽：左状态 · 白线 · 右节点类数 -->
        <div class="acard-slot">
          <span [class.is-ok]="statusTone() === 'ok'" [class.is-warn]="statusTone() === 'warn'">{{
            statusText()
          }}</span>
          <span class="acard-rule"></span>
          <span class="acard-size">{{ sizeText() }}</span>
        </div>

        <!-- 安装中的实时反馈：百分比 + 阶段（进度条在页面顶部的任务面板里） -->
        @if (installing()) {
          <div class="nd-run">
            <span class="nd-progress">{{ percent() }}%</span>
            <span class="nd-stage">{{ stage() }}</span>
          </div>
        }

        <!-- ⑤ 分类标签：它提供什么 -->
        <div class="acard-tags">
          <span class="pill" [class.is-mono]="nodeTag().mono" [title]="nodeTagTitle()">{{
            nodeTag().text
          }}</span>
          @if (nodeTag().more > 0) {
            <span class="pill is-more" [title]="nodeTagTitle()">+{{ nodeTag().more }}</span>
          }
        </div>

        <!-- ⑥ 动作行：⋯ 在左，主按钮在右 -->
        <div class="acard-foot">
          <button
            class="acard-kebab"
            type="button"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen()"
            aria-label="更多操作"
            title="更多操作"
            (click)="toggleMenu()"
          >
            ⋯
          </button>

          @if (mode() === 'library') {
            <button
              class="acard-primary primary btn-xs"
              type="button"
              (click)="toggle.emit()"
              [disabled]="busy()"
            >
              {{ item().disabled ? '启用' : '禁用' }}
            </button>
          } @else if (installing()) {
            <button class="acard-primary primary btn-xs" type="button" disabled>安装中…</button>
          } @else if (!item().installable) {
            <button
              class="acard-primary primary btn-xs"
              type="button"
              disabled
              [title]="
                item().install_type
                  ? '安装方式是 ' + item().install_type + '，暂不支持一键安装'
                  : '暂不支持一键安装'
              "
            >
              不支持一键装
            </button>
          } @else if (!item().installed) {
            <button
              class="acard-primary primary btn-xs"
              type="button"
              (click)="install.emit()"
              [disabled]="busy()"
              [attr.data-testid]="'node-install-' + item().id"
            >
              安装
            </button>
          } @else if (item().repo) {
            <a
              class="acard-primary primary btn-xs"
              [href]="item().repo"
              target="_blank"
              rel="noreferrer"
              >查看</a
            >
          } @else {
            <button class="acard-primary primary btn-xs" type="button" disabled>已安装</button>
          }
        </div>
        </div>
      </div>

      <!-- 次要信息与次要操作收进这个菜单：节点类清单、额外依赖、重名冲突、卸载、仓库 -->
      @if (menuOpen()) {
        <div class="nd-menu" role="menu">
          @if (classList().length) {
            <div class="nd-menu-row">
              <span class="nd-menu-k">节点类</span>
              <span class="nd-menu-v" [title]="classList().join('、')">{{
                classList().join('、')
              }}</span>
            </div>
          }
          @if (needs().length) {
            <div class="nd-menu-row">
              <span class="nd-menu-k">额外依赖</span>
              <span class="nd-menu-v">{{ needs().join('、') }}</span>
            </div>
          }
          @if (preemptions().length) {
            <div class="nd-menu-row is-warn">
              <span class="nd-menu-k">重名冲突</span>
              <span class="nd-menu-v">{{ preemptions().join('、') }}</span>
            </div>
          }
          @if (mode() === 'library') {
            <div class="nd-menu-row">
              <span class="nd-menu-k">版本 / 大小</span>
              <span class="nd-menu-v">{{ versionText() }} · {{ sizeText2() }}</span>
            </div>
            @if (item().tracked === false) {
              <div class="nd-menu-row">
                <span class="nd-menu-k">来源</span>
                <span class="nd-menu-v">清单未收录</span>
              </div>
            }
            @if (item().requirements) {
              <div class="nd-menu-row">
                <span class="nd-menu-k">依赖</span>
                <span class="nd-menu-v">带 requirements.txt</span>
              </div>
            }
            <button class="nd-menu-act is-danger" type="button" (click)="onRemove()">卸载</button>
          }
          @if (item().repo) {
            <a class="nd-menu-act" [href]="item().repo" target="_blank" rel="noreferrer"
              >在 GitHub 打开 ↗</a
            >
          }
        </div>
      }
    </article>
  `,
  styleUrls: ['./asset-card.css'],
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      /* 铭牌自带的顶行（厂牌标 + 厂牌码 + 规格 + 原站）在本卡里是重复的：
         本卡左上角已经有自己的身份行（32×32 标识 + 双行身份 + 原站链接），
         两枚叠在同一个角会打架，所以整行收掉，只借铭牌的底、纹样、图与蒙版。

         选择器要带 .nd-plate 才压得住：铭牌自己的 .head 规则在它自己的作用域里
         （.head[_ngcontent-xxx]，特异性 0,2,0），而 :host ::ng-deep .head 只有 0,2,0 ——
         平手时谁赢看注入顺序，实测是铭牌赢。多带一层类提到 0,3,0 才稳定压住。 */
      :host ::ng-deep .nd-plate .head {
        display: none;
      }

      /* 封面上的大号标识 + 名字：节点没有预览图，封面区不能空着，
         也没有「节点类数」可以占位（原型的做法：同一个数字不在卡上报两次）。 */
      .nd-cover {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 2px;
        padding-top: 46px;
        text-align: center;
      }
      .nd-cover strong {
        font-size: 26px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.04em;
        color: var(--ui-text);
      }
      .nd-cover span {
        max-width: 86%;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: var(--ui-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* 标识块：几何（32×32 / 圆角 / 居中）在共享文件里；
         这里只给**底衬**与字重 —— 扩展缩写是文字，压在家族色底纹上要有实底。 */

      /* 安装中：百分比是这会儿唯一在动的数字，给足对比度。
         节点卡永远没有真实封面 → 走的是跟随主题的中性遮罩，
         所以文字用主题色（--ui-text），不能写死白色。 */
      .nd-run {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
      }
      .nd-progress {
        flex: none;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--ui-text);
        font-variant-numeric: tabular-nums;
      }
      .nd-stage {
        min-width: 0;
        font-size: 10.5px;
        color: var(--ui-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- ⋯ 菜单：次要信息与次要操作 -------------------------------
         挂在卡内（卡有 overflow:hidden），所以高度封顶 + 可滚动，
         免得菜单比卡还高被裁掉。z-index 要高过卡壳的描边（5）与身份行（4）。 */
      .nd-menu {
        position: absolute;
        left: 10px;
        bottom: 40px;
        z-index: 6;
        width: min(290px, calc(100% - 20px));
        max-height: 168px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        border-radius: var(--ui-radius);
        background: var(--ui-overlay);
        box-shadow:
          inset 0 0 0 1px var(--ui-inner-border),
          var(--ui-shadow-md);
      }
      .nd-menu-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 3px 4px;
        font-size: 10.5px;
        line-height: 1.5;
      }
      .nd-menu-k {
        flex: none;
        color: var(--ui-muted);
      }
      .nd-menu-v {
        min-width: 0;
        color: var(--ui-text);
        font-family: var(--ui-font-mono);
        overflow-wrap: anywhere;
      }
      .nd-menu-row.is-warn .nd-menu-v {
        color: var(--ui-accent);
      }
      .nd-menu-act {
        display: block;
        width: 100%;
        padding: 5px 6px;
        border: 0;
        border-radius: var(--ui-radius);
        background: none;
        color: var(--ui-text);
        font-family: inherit;
        font-size: 11px;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
      }
      .nd-menu-act:hover {
        background: var(--ui-inset);
      }
      .nd-menu-act.is-danger {
        color: var(--ui-error);
      }
    `,
  ],
  host: {
    '(document:click)': 'closeMenuOnOutside($event)',
  },
})
export class NodeCardComponent {
  readonly item = input.required<NodeCardItem>();
  /** discover = 清单里的扩展（装 / 看）；library = 已装扩展（启用 / 禁用 / 卸载） */
  readonly mode = input<'discover' | 'library'>('discover');
  /** 这一个扩展正在安装 */
  readonly installing = input(false);
  readonly percent = input(0);
  readonly stage = input('');
  /** 页面正忙（另一个任务在跑 / 操作处理中），主按钮置灰 */
  readonly busy = input(false);

  readonly install = output<void>();
  readonly toggle = output<void>();
  readonly remove = output<void>();

  /** 封面图是否真的画出来了（清单目前没有图，先留这条通路） */
  readonly photoOk = signal(false);

  /** ⋯ 菜单是否展开 */
  readonly menuOpen = signal(false);

  readonly displayName = computed(() => this.item().title || this.item().name || '');

  /** 身份行第二行：清单条目是作者；已装条目没有作者，用目录名顶上 */
  readonly subLine = computed(() => this.item().author || this.item().dir || '');

  /** 封面上的短名：去掉 ComfyUI- 前缀，剩下那个才是「这是个什么东西」 */
  readonly coverName = computed(() => {
    const raw = this.displayName()
      .replace(/^comfyui[-_\s]*/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return raw || this.displayName();
  });

  /** 32×32 标识块：扩展名的首字母缩写（ComfyUI-Impact-Pack → IP） */
  readonly mark = computed(() => markOf(this.displayName()));

  /**
   * 类别：清单里的 category（后端按标题 / 描述 / 节点类名推断的主用途分类）
   * → tags → 描述首句 → 通用词。tags 常常是空的，必须有兜底。
   *
   * 节点库页多一条：清单没收的手工装的扩展没有类别可说，
   * 那就把「清单未收录」摆出来 —— 这才是这类扩展最该先看到的一句。
   */
  readonly metaText = computed(() => {
    const it = this.item();
    const category = (it.category ?? '').trim();
    if (category) return category;
    const tag = (it.tags || []).find((t) => !!t?.trim());
    if (tag) return tag.trim();
    const desc = (it.description || '').trim();
    if (desc) return firstSentence(desc);
    if (this.mode() === 'library' && it.tracked === false) return '清单未收录';
    return '扩展';
  });

  readonly nodeCount = computed(() => this.item().node_count ?? this.item().nodes?.length ?? 0);

  /** 状态槽右侧：节点没有磁盘大小，规模就是它提供多少节点类 */
  readonly sizeText = computed(() => `${this.nodeCount().toLocaleString('en-US')} 节点类`);

  /**
   * 状态槽左侧。
   *
   * 缺依赖的告警只压在**已装**的扩展上：没装的扩展谈不上「缺」，
   * 它的依赖会随安装一起进来（安装通道已经把 requirements.txt 走了一遍）。
   */
  readonly statusText = computed(() => {
    if (this.mode() === 'library') return this.item().disabled ? '已禁用' : '已启用';
    if (this.item().installed && this.needs().length) return '缺 ' + this.needs().join('、');
    if (this.item().installed) return '已安装';
    return '未安装';
  });

  readonly statusTone = computed<'ok' | 'warn' | 'none'>(() => {
    if (this.mode() === 'library') return this.item().disabled ? 'warn' : 'ok';
    if (this.item().installed && this.needs().length) return 'warn';
    if (this.item().installed) return 'ok';
    return 'none';
  });

  /**
   * 分类标签：**它提供什么**。
   *
   * 有节点类的给代表类名 +「+N」（完整清单在 ⋯ 菜单里）；
   * 一个节点类都不提供的给「管理面板」—— ComfyUI-Manager 的 NODE_CLASS_MAPPINGS
   * 是空的，它只提供面板，节点类数恒为 0，不能拿数字硬凑。
   */
  readonly nodeTag = computed(() => {
    const nodes = this.item().nodes || [];
    const count = this.nodeCount();
    if (!count) return { text: '管理面板', more: 0, mono: false };
    // 有类名：报代表类名 +「+N」（原型口径）
    if (nodes.length) return { text: nodes[0], more: count - 1, mono: true };
    // 没有类名：这一格只答「是什么」，不答「有多少」——
    // 数量是 ④ 状态槽右侧的活，在 ⑤ 再报一遍就是同一个数字在卡上报两次。
    return { text: '节点类', more: 0, mono: false };
  });

  readonly nodeTagTitle = computed(() => {
    const nodes = this.item().nodes || [];
    const count = this.nodeCount();
    if (!count) return '不提供节点类，只提供管理面板';
    if (!nodes.length) return `提供 ${count} 个节点类（清单未展开类名）`;
    return `${nodes[0]} 等 ${count} 个节点类`;
  });

  readonly needs = computed(() => this.item().needs || []);

  readonly preemptions = computed(() => this.item().preemptions || []);

  readonly classList = computed(() => this.item().nodes || []);

  readonly versionText = computed(() => {
    const c = this.item().commit || '';
    return c ? c.slice(0, 8) : '—';
  });

  readonly sizeText2 = computed(() => {
    const size = this.item().size;
    return size ? fmtSize(size) : '—';
  });

  /**
   * 交给铭牌的最小字段集。
   *
   * 名字决定家族色与构图纹样；清单目前没有预览图，有就铺满整卡。
   */
  readonly plate = computed(() => {
    const name = this.item().name || '';
    const image = this.item().image || undefined;
    return { name, image };
  });

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  onRemove(): void {
    this.menuOpen.set(false);
    this.remove.emit();
  }

  closeMenuOnOutside(ev: MouseEvent): void {
    if (!this.menuOpen()) return;
    const el = ev.target as HTMLElement | null;
    if (!el?.closest('.nd-menu') && !el?.closest('.acard-kebab')) this.menuOpen.set(false);
  }
}

/**
 * 标识缩写：去掉 ComfyUI- 前缀后取各词首字母，最多两位。
 *
 * 为什么最多两位：32×32 的格子里塞三个字母会挤成一条，两位刚好。
 * 去掉前缀后只剩一个词时（ComfyUI-Manager）退回整名取首字母 —— CM。
 */
function markOf(name: string): string {
  const words = name
    .replace(/[-_\s.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
  if (!words.length) return name.slice(0, 2).toUpperCase();
  const rest = words[0].toLowerCase() === 'comfyui' ? words.slice(1) : words;
  const picked = rest.length >= 2 ? rest : words;
  return picked
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** 描述首句：描述常常是一整段，类别位只放第一句，剩下的靠 title 与省略号 */
function firstSentence(text: string): string {
  const m = text.match(/^[^。.!！?？]+[。.!！?？]?/);
  const s = (m ? m[0] : text).trim();
  return s.length > 32 ? s.slice(0, 31) + '…' : s;
}
