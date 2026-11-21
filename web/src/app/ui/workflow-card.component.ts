import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FamilyMarkComponent } from './family-mark.component';
import { CoverPlateComponent } from './cover-plate.component';
import { LocalWorkflow } from '../core/types';

export type WorkflowState = 'broken' | 'api' | 'missing' | 'ready';

/** 四态的呈现规则：状态槽说什么情况，按钮说该做什么，一一对应不重复。 */
interface StateView {
  /** 状态槽左侧：缺失用红字提示、齐全用中性计数、API 格式用提示语、坏文件直接说格式错 */
  badge: 'dep' | 'count' | 'note' | 'none';
  badgeText: string;
  /** 唯一主按钮：现在统一进编辑器；补齐/运行都收进 ⋯ 菜单 */
  act: 'fix' | 'use' | 'edit';
  label: string;
}

/**
 * 工作流卡片。
 *
 * 三条来自卡片方案 v2 的硬规则：
 * 1. **一个卡上只有一个主按钮，而且永远是「编辑」**。缺不缺依赖不该换掉入口；
 *    使用工作流 / 补齐依赖是低频动作，收进 ⋯ 菜单。
 * 2. **解析失败的说明长在封面图区里**，不弹 toast、不弹模态、不另开错误块 ——
 *    坏文件是这条资产自己的属性。
 * 3. **徽标与正文不重复表达**。红色徽标已经说了「缺东西」，正文不再写一遍状态行。
 *
 * 外壳收敛：卡片骨架（封面 / 身份行 / 状态槽 / 分类标签 / 动作行）的几何统一走
 * `asset-card.css` 的 `.acard*`，底板 / 纹样 / 铺图 / 蒙版交给共享的 `app-cover-plate`
 * （`ratio="fill"`，宽高跟着卡片走，不再声明 16:10）。本卡只留工作流自己的内容：
 * 家族厂标、身份两行、状态槽、分类标签、⋯ 菜单、标题、解析失败提示。
 */
@Component({
  selector: 'app-workflow-card',
  standalone: true,
  imports: [FamilyMarkComponent, CoverPlateComponent],
  /* 共享几何走外部样式文件：这份文件的规则会被本组件的作用域改写
     （Emulated 封装），四张卡引用的是同一份源，改一处四张卡一起变。
     为什么不是 styles: ['./asset-card.css', …] —— ng build 的 esbuild 构建器
     把 styles 数组里的每一项都当内联 CSS 源码解析，文件路径不是合法 CSS，
     会直接报「Unknown word ./asset-card.css」。外部样式只能走 styleUrls。
     styleUrls 与 styles 并存：两者打在同一套作用域属性上，互不覆盖。 */
  styleUrls: ['./asset-card.css'],
  template: `
    <article class="wc acard" [class.broken]="state() === 'broken'" [class.on-shot]="photoOk"
             [attr.data-name]="it.name">
      <!-- ① 封面：铺满整卡。外壳几何（定位 / 裁切 / 圆角）由 .acard-media + .acard-plate 给，
           家族色底 / 几何纹样 / 铺满图 / 蒙版都在共享铭牌里，本卡不再各写一套。
           ratio="fill"：不再声明 16:10 —— 宽高跟着卡片走，比例由外壳决定。
           imgClass="wc-cover-img"：E2E 用 img.wc-cover-img 认这张封面
           （换封面 / 封面管理都断言它），class 必须落在 <img> 本身。 -->
      <div class="wc-cover acard-media">
        <div class="acard-plate">
          <app-cover-plate
            class="wc-plate"
            ratio="fill"
            imgClass="wc-cover-img"
            [model]="plate"
            (shotState)="photoOk = $event"
          />
        </div>

        <!-- 解析失败：说明长在图区里，不弹 toast、不弹模态、不另开错误块 ——
             坏文件是这条资产自己的属性。 -->
        @if (state() === 'broken') {
          <div class="wc-broken">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
              <path d="M12 8v5" /><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
              <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span class="wc-broken-title">无法解析</span>
            <span class="wc-broken-msg">{{ it.error || '文件解析失败' }}</span>
          </div>
        }
      </div>

      <!-- ② 身份行：左上「标识块 + 工作流名 / 底模」两行。
           ③ 原站：本地工作流没有来源站（文件就在共享目录里），这一槽留空。 -->
      <div class="acard-head">
        <span class="acard-mark">
          <ui-family-mark [model]="it.main_model || ''" [plate]="true" />
        </span>
        <span class="acard-ident">
          <b [title]="it.path">{{ it.name }}</b>
          <span [title]="it.main_model || ''">{{ it.main_model || '本地工作流' }}</span>
        </span>
      </div>

      <!-- 底部信息区：压在封面上的遮罩（几何由 .acard-body 给） -->
      <div class="acard-body">
        <h3 class="wc-name acard-name" [title]="it.path">{{ it.title || it.name }}</h3>

        <!-- 类别行：更新于什么时候 + 文件格式（UI / API） -->
        <p class="wc-meta acard-meta">
          <span class="wc-time">{{ agoText() }}</span>
          @if (it.format === 'ui' || it.format === 'api') {
            <span class="wc-fmt" [class.api]="it.format === 'api'"
                  [title]="it.format === 'api' ? '只有节点与连线，没有坐标，载不进画布' : '含节点坐标与连线，可直接载入画布'">
              <span class="wc-fmt-o" [class.on]="it.format === 'ui'">UI</span>
              <span class="wc-fmt-s"></span>
              <span class="wc-fmt-o" [class.on]="it.format === 'api'">API</span>
            </span>
          }
        </p>

        <!-- ④ 状态槽：左状态 · 半透明白线 · 右大小（工作流看文件大小） -->
        <div class="acard-slot">
          @if (view().badge === 'dep') {
            <span class="wc-dep is-err" [title]="missingTip()">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M8 2.6v6.2" /><circle cx="8" cy="11.9" r="0.85" fill="currentColor" stroke="none" />
                <path d="M6.9 2.4 1.5 11.9A1.6 1.6 0 0 0 2.9 14.4h10.2a1.6 1.6 0 0 0 1.4-2.5L9.1 2.4a1.6 1.6 0 0 0-2.2 0z" />
              </svg>
              <span>{{ view().badgeText }}</span>
            </span>
          } @else if (view().badge === 'count') {
            <span class="wc-count">{{ it.nodes }} 节点 · {{ totalDeps() }} 依赖</span>
          } @else if (view().badge === 'note') {
            <span class="wc-note is-warn">{{ view().badgeText }}</span>
          } @else {
            <span class="wc-broken-state is-err">文件格式错误</span>
          }
          <span class="acard-rule"></span>
          <span class="acard-size">{{ sizeText() }}</span>
        </div>

        <!-- ⑤ 分类标签：只放一枚 —— 工作流的自定义分组（没分组就写「未分组」） -->
        <div class="acard-tags">
          <span class="pill wc-tag" [class.is-none]="!it.group" [title]="it.group || '未分组'">
            {{ it.group || '未分组' }}
          </span>
        </div>

        <!-- ⑥ 动作行：⋯ 在左，主按钮在右。⋯ 的下拉菜单仍由页面层接管，
             卡片只负责报出点击坐标（菜单才会贴着按钮弹，而不是回页面顶上去找）。 -->
        <div class="acard-foot">
          <div class="wc-acts">
            <button class="wc-kebab acard-kebab" type="button" aria-haspopup="menu" aria-label="更多操作"
                    title="更多操作" (click)="openMore($event)">⋯</button>
          </div>
          <button class="wc-primary acard-primary" (click)="primary.emit({ item: it, act: view().act })">
            @if (view().act === 'use') {
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 3.3 12.4 8l-6.8 4.7z" fill="currentColor" stroke="none" /></svg>
            } @else if (view().act === 'fix') {
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M8 2.4v7.4" /><path d="M5.1 7.2 8 10.1l2.9-2.9" /><path d="M2.8 12.6h10.4" />
              </svg>
            } @else {
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M11.1 2.9 13.1 4.9 6 12 3.5 12.7l.7-2.5z" /><path d="M9.8 4.2 11.8 6.2" />
              </svg>
            }
            <span>{{ view().label }}</span>
          </button>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
    :host { display: block; min-width: 0; }

    /* 外壳几何（定位 / 圆角 / 描边 / 最小高度 / 遮罩）由 asset-card.css 的 .acard 给，
       这里不再写第二份。只留一条高度对齐：卡片要跟着栅格行走，
       否则同一行的卡会各高各的。 */
    .wc { height: 100%; }

    /* ---- ① 封面：共享铭牌 ------------------------------------------------
       ratio="fill" 让铭牌跟着卡片尺寸走（16:10 是旧的两段式封面才需要的比例）。
       铭牌内部自己裁切（overflow:hidden），外层不用再裁。 */
    /* 铭牌自带的顶行（厂牌标 + 厂牌码 + 规格）在本卡里是重复的：
       身份行已经在左上角放了一枚 ui-family-mark（它自带随主题翻转的底衬，
       且 E2E 按 ui-family-mark .fm 断言）。两枚叠在同一个角会打架，
       所以这里只借铭牌的「底 + 纹样 + 图 + 蒙版」，顶行整个收掉。

       选择器要带 .wc-plate 才压得住：铭牌自己的 .head 规则在它自己的
       作用域里（.head[_ngcontent-xxx]，特异性 0,2,0），
       而 :host ::ng-deep .head 只有 0,2,0 —— 平手时谁赢看样式注入顺序，
       实测是铭牌赢（display 仍是 flex，QWEN 标签压在厂标上）。
       多带一层类把它提到 0,3,0 才稳定压住。 */
    :host ::ng-deep .wc-plate .head { display: none; }
    /* 封面图的取景沿用原来的偏上 28%：重构不该顺带把裁切改了。
       同样要带 .wc-plate 才压得住铭牌自己的 .photo 规则。 */
    :host ::ng-deep .wc-plate .photo { object-position: center 28%; }

    /* 解析失败：整块铭牌收掉，只留斜纹底 + 警告文案。
       斜纹是「这个条目残了」的通用语言，与家族色区分开；
       坏文件本来就没有图，家族色块只会和警告文案抢注意力。

       斜纹画在封面容器（.wc-cover）上而不是警告块上：
       警告块带 z-index 会盖住 .acard::after 画的 1px 描边 ——
       实测坏卡顶边那一行整行变色（257px）。 */
    .wc.broken .wc-cover {
      background: repeating-linear-gradient(45deg, var(--panel-3), var(--panel-3) 9px,
        var(--panel-2) 9px, var(--panel-2) 18px);
    }
    /* 铭牌用 visibility 而不是 display 收掉：display:none 会把铭牌连占位一起
       摘掉，坏卡就塌成一张空卡；visibility:hidden 保留占位、只是不画，
       斜纹底从底下透出来。 */
    .wc.broken .wc-plate { visibility: hidden; }

    /* 解析失败：说明就长在图区里，不另开错误块。
       位置压在身份行下方 —— 底部信息区（遮罩）不能被它盖住。
       高度是卡出来的：身份行下沿到遮罩上沿只有这一条缝，
       三行（图标 / 徽标 / 报错）必须塞得进去，否则报错会被遮罩切掉。 */
    .wc-broken {
      position: absolute;
      left: 0;
      right: 0;
      top: 46px;
      height: 58px;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      color: var(--err);
    }
    .wc-broken-title {
      font-size: 11px;
      font-weight: 600;
      background: var(--err-soft);
      color: var(--err);
      padding: 1px 8px;
      border-radius: var(--radius-xs);
    }
    .wc-broken-msg {
      font-size: 10px;
      color: var(--muted);
      background: var(--panel);
      padding: 1px 7px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-soft);
      max-width: 90%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ---- ② 身份行 -------------------------------------------------------
       标识块的几何（32×32 / 圆角 / 居中）在共享文件里。
       家族标自带随主题翻转的底衬（E2E 按 ui-family-mark .fm 断言），
       方框就不再另加底色 —— 两层底会打架。 */
    .acard-mark {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ---- ④ 状态槽 -------------------------------------------------------
       槽位左说状态、右说大小，白线由 .acard-rule 给。
       颜色走共享的 is-ok / is-warn / is-err：槽位在正文层，
       不再自带徽章底色（原来那是压图用的）。 */
    .wc-dep {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
    }
    .wc-dep span { overflow: hidden; text-overflow: ellipsis; }
    .wc-count,
    .wc-note,
    .wc-broken-state {
      flex: 0 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ---- ⑤ 分类标签 -----------------------------------------------------
       分组片的几何（16px 胶囊、底色、字号）由 .acard-tags .pill 给，
       这里只补一枚描边：分组片要靠描边跟底色分层。 */
    .wc-tag { box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.22); }

    /* UI | API 双段：文件格式标识（可载入画布 / 只有节点连线）。
       跟更新时间是同一行，所以用 vertical-align 对齐，不占行高。 */
    .wc-fmt {
      flex: none;
      display: inline-flex;
      align-items: stretch;
      vertical-align: middle;
      height: 16px;
      border-radius: var(--radius-xs);
      overflow: hidden;
      background: var(--panel-2);
      box-shadow: inset 0 0 0 1px var(--border-strong);
    }
    .wc-fmt-o {
      display: inline-flex;
      align-items: center;
      padding: 0 5px;
      color: var(--faint);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
    }
    .wc-fmt-o.on { color: var(--text); background: var(--panel); }
    .wc-fmt.api .wc-fmt-o.on { color: var(--warn); }
    .wc-fmt-s { width: 1px; align-self: stretch; background: var(--border-strong); }

    /* ---- ⑥ 动作行 -------------------------------------------------------
       ⋯ 在左、主按钮在右由 .acard-foot 给。⋯ 现在压在封面遮罩上，
       底色跟着遮罩走，不能再用 --panel 的浅底（浅底压深色遮罩会发灰）。 */
    .wc-acts {
      display: inline-flex;
      align-items: center;
      flex: none;
    }
    .wc-kebab {
      width: 27px;
      height: 23px;
      flex: none;
      border: 0;
      border-radius: var(--radius-sm);
      background: rgb(0 0 0 / 0.42);
      color: #fff;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
      font-size: 13px;
      line-height: 1;
    }
    .wc-kebab:hover { background: rgb(0 0 0 / 0.6); }

    .wc-primary {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 27px;
      padding: 0 11px;
      border: 1px solid var(--primary);
      border-radius: var(--radius-sm);
      background: var(--primary);
      color: var(--on-primary);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .wc-primary.ghost {
      background: var(--panel);
      border-color: var(--border);
      color: var(--text-2);
    }
    .wc-primary.ghost:hover { border-color: var(--border-strong); color: var(--text); }
    .wc-primary svg { width: 13px; height: 13px; flex: none; }
  `,
  ],
})
export class WorkflowCardComponent {
  @Input({ required: true }) it!: LocalWorkflow;
  @Output() primary = new EventEmitter<{ item: LocalWorkflow; act: 'fix' | 'use' | 'edit' }>();
  /** 带上点击坐标，菜单才能贴着按钮弹出来而不是回页面顶上去找 */
  @Output() more = new EventEmitter<{ item: LocalWorkflow; x: number; y: number }>();

  /** 封面图是否真的画出来了（远程图会 401 / 超时）。决定状态层用深字还是白字 */
  photoOk = false;

  /**
   * 交给铭牌的最小字段集。
   *
   * 只吃稳定字段：主模型文件名定家族与构图，封面图有就铺、没有就退回家族色纹样。
   * 封面地址的归一（外链换成 /api/cover 代理、宽度换成 448）由 cover-plate
   * 内部的 coverMeta 统一做，这里给原始地址即可。
   *
   * 解析失败的文件不铺图 —— 那是「这条资产坏了」，不是「封面还没加载出来」，
   * 铺一张图反而会让斜纹底与警告文案抢注意力。
   *
   * 按引用缓存：模板每次变更检测都会求值 getter，返回新对象会让子组件的
   * ngOnChanges 每帧触发（meta 被反复重置，图片加载失败时甚至会把失败的图
   * 重新挂回去形成死循环）。
   */
  get plate(): { name: string; image?: string } {
    const name = this.it.main_model || this.it.name || '';
    const image = this.state() === 'broken' ? undefined : this.it.cover || undefined;
    if (!this._plate || this._plate.name !== name || this._plate.image !== image) {
      this._plate = { name, image };
    }
    return this._plate;
  }
  private _plate: { name: string; image?: string } | null = null;

  openMore(event: MouseEvent): void {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.more.emit({ item: this.it, x: rect.right, y: rect.bottom });
  }

  state(): WorkflowState {
    if (this.it.format === 'broken') return 'broken';
    if (this.it.format === 'api') return 'api';
    return this.missingCount() > 0 ? 'missing' : 'ready';
  }

  missingCount(): number {
    return (this.it.deps?.missing?.length || 0) + (this.it.node_deps?.missing?.length || 0);
  }

  totalDeps(): number {
    const m = this.it.model_slots?.length || 0;
    const n = (this.it.node_deps?.have?.length || 0) + (this.it.node_deps?.missing?.length || 0);
    return m + n;
  }

  /**
   * 四态 → 状态槽 + 唯一主按钮。
   *
   * 主按钮永远是「编辑」：工作是改工作流，缺不缺依赖不该把入口换掉。
   * 使用 / 补齐依赖是低频动作，收进 ⋯ 菜单（见 workflows 页的菜单模板）。
   */
  view(): StateView {
    switch (this.state()) {
      case 'broken':
        return { badge: 'none', badgeText: '', act: 'edit', label: '编辑' };
      case 'api':
        return { badge: 'note', badgeText: 'API 格式 · 不能载入画布', act: 'edit', label: '编辑' };
      case 'ready':
        return { badge: 'count', badgeText: `${this.it.nodes} 节点 · ${this.totalDeps()} 依赖`, act: 'edit', label: '编辑' };
      default: {
        const parts: string[] = [];
        const m = this.it.deps?.missing?.length || 0;
        const p = this.it.node_deps?.missing?.length || 0;
        if (m) parts.push(`缺 ${m} 模型`);
        if (p) parts.push(`${p} 节点包`);
        return { badge: 'dep', badgeText: parts.join(' · '), act: 'edit', label: '编辑' };
      }
    }
  }

  missingTip(): string {
    const m = this.it.deps?.missing?.length || 0;
    const p = this.it.node_deps?.missing?.length || 0;
    const un = this.it.node_deps?.unknown?.length || 0;
    const parts: string[] = [];
    if (m) parts.push(`${m} 个模型`);
    if (p) parts.push(`${p} 个节点包`);
    if (un) parts.push(`${un} 个节点类型待人工确认`);
    return '缺 ' + parts.join('、') + '，可在「⋯」菜单里补齐依赖';
  }

  sizeText(): string {
    const b = this.it.size || 0;
    if (b < 1000) return b + ' B';
    if (b < 1000 * 1000) return (b / 1000).toFixed(1) + ' KB';
    return (b / 1000 / 1000).toFixed(1) + ' MB';
  }

  agoText(): string {
    const t = this.it.mtime * 1000;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 30) return days + ' 天前';
    if (days < 365) return Math.floor(days / 30) + ' 个月前';
    return Math.floor(days / 365) + ' 年前';
  }
}
