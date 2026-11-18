import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FamilyMarkComponent } from './family-mark.component';
import { CoverPlateComponent } from './cover-plate.component';
import { LocalWorkflow } from '../core/types';

export type WorkflowState = 'broken' | 'api' | 'missing' | 'ready';

/** 四态的呈现规则：徽标说什么情况，按钮说该做什么，一一对应不重复。 */
interface StateView {
  /** 封面徽标：缺失用红底提示、齐全用中性计数、解析失败不戴徽标 */
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
 * 封面收敛：底板 / 纹样 / 铺图 / 蒙版都交给共享的 `app-cover-plate`
 * （`ratio="wide"` = 16:10 横版），本卡只留「这张工作流怎么样」的状态层
 * （家族厂标、状态徽标、⋯ 菜单、标题、解析失败提示）。
 */
@Component({
  selector: 'app-workflow-card',
  standalone: true,
  imports: [FamilyMarkComponent, CoverPlateComponent],
  template: `
    <article class="wc" [class.broken]="state() === 'broken'" [class.on-shot]="photoOk"
             [attr.data-name]="it.name">
      <!-- 封面本体 = 共享铭牌。ratio="wide" 给出 16:10 的横版封面，
           家族色底 / 几何纹样 / 铺满图 / 蒙版都在铭牌里，本卡不再各写一套。
           imgClass="wc-cover-img"：E2E 用 img.wc-cover-img 认这张封面
           （换封面 / 封面管理都断言它），class 必须落在 <img> 本身。 -->
      <div class="wc-cover">
        <app-cover-plate
          class="wc-plate"
          ratio="wide"
          imgClass="wc-cover-img"
          [model]="plate"
          (shotState)="photoOk = $event"
        />

        <!-- 状态层盖在封面上。这些是「这张工作流怎么样」，不是封面本身。 -->
        <div class="wc-over">
          @if (state() === 'broken') {
            <div class="wc-broken">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                   stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                <path d="M12 8v5" /><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
                <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              <span class="wc-broken-title">无法解析</span>
              <span class="wc-broken-msg">{{ it.error || '文件解析失败' }}</span>
            </div>
          }

          <div class="wc-top">
            <ui-family-mark [model]="it.main_model || ''" [plate]="true" />
            @if (view().badge === 'dep') {
              <span class="wc-dep" [title]="missingTip()">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"
                     stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                  <path d="M8 2.6v6.2" /><circle cx="8" cy="11.9" r="0.85" fill="currentColor" stroke="none" />
                  <path d="M6.9 2.4 1.5 11.9A1.6 1.6 0 0 0 2.9 14.4h10.2a1.6 1.6 0 0 0 1.4-2.5L9.1 2.4a1.6 1.6 0 0 0-2.2 0z" />
                </svg>
                <span>{{ view().badgeText }}</span>
              </span>
            } @else if (view().badge === 'count') {
              <span class="wc-count">
                <span>{{ it.nodes }} 节点</span><span>{{ totalDeps() }} 依赖</span>
              </span>
            } @else if (view().badge === 'note') {
              <span class="wc-note">{{ view().badgeText }}</span>
            }
            <div class="wc-acts">
              <button class="wc-kebab" type="button" aria-haspopup="menu" aria-label="更多操作"
                      title="更多操作" (click)="openMore($event)">⋯</button>
            </div>
          </div>

          <div class="wc-name">
            <h3 [title]="it.path">{{ it.title || it.name }}</h3>
            <p>{{ sizeText() }} · {{ agoText() }}</p>
          </div>
        </div>
      </div>

      <div class="wc-body">
        <div class="wc-split">
          <!-- 节点/依赖的计数从卡片正文撤掉：状态徽标已经说过一次，
               这个位置让给分组，分组是找工作流时真正要用的索引 -->
          <div class="wc-meta">
            @if (it.group) {
              <span class="wc-tag wc-grp-tag" [title]="it.group">{{ it.group }}</span>
            } @else {
              <span class="wc-tag wc-grp-tag is-none">未分组</span>
            }
            @if (it.format === 'ui' || it.format === 'api') {
              <span class="wc-fmt" [class.api]="it.format === 'api'"
                    [title]="it.format === 'api' ? '只有节点与连线，没有坐标，载不进画布' : '含节点坐标与连线，可直接载入画布'">
                <span class="wc-fmt-o" [class.on]="it.format === 'ui'">UI</span>
                <span class="wc-fmt-s"></span>
                <span class="wc-fmt-o" [class.on]="it.format === 'api'">API</span>
              </span>
            }
          </div>
          <button class="wc-primary" (click)="primary.emit({ item: it, act: view().act })">
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
  styles: `
    :host { display: block; min-width: 0; }
    .wc {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--panel);
      border-radius: var(--radius);
      overflow: hidden;
      position: relative;
    }
    /* 描边只由 ::after 画：inset:0 相对内边距盒，加 border 会整体内缩 1px 且圆角对不上 */
    .wc::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px var(--border);
      transition: box-shadow 0.14s ease;
      pointer-events: none;
    }
    .wc:hover::after,
    .wc:focus-within::after { box-shadow: inset 0 0 0 1px var(--accent); }

    /* ---- 封面：共享铭牌 ------------------------------------------------
       ratio="wide" 由铭牌自己声明 16:10，本卡不再写第二份 aspect-ratio。
       铭牌内部自己裁切（overflow:hidden），外层不用再裁。 */
    .wc-cover {
      position: relative;
      display: block;
      width: 100%;
    }
    .wc-plate {
      display: block;
      width: 100%;
    }
    /* 状态层：盖在封面上（家族厂标 / 徽标 / ⋯ / 标题 / 解析失败）。
       整层绝对定位铺满封面；pointer-events:none 让点击穿透到下面的铭牌，
       只有 ⋯ 菜单自己打开命中。 */
    .wc-over {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
    }
    .wc-over .wc-acts,
    .wc-over .wc-kebab { pointer-events: auto; }

    /* 铭牌自带的顶行（厂牌标 + 厂牌码 + 规格）在本卡里是重复的：
       本卡左上角已经有一枚 ui-family-mark（它自带随主题翻转的底衬，
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

       斜纹画在 .wc-cover（封面容器）而不是 .wc-over（状态层）：
       状态层带 z-index:2 会盖住 .wc::after 画的 1px 描边 ——
       实测坏卡顶边那一行整行变色（257px）。
       .wc-cover 的 z-index 是 auto，::after 作为最后一个子节点排在它后面，
       描边照样压在斜纹上。 */
    .wc.broken .wc-cover {
      background: repeating-linear-gradient(45deg, var(--panel-3), var(--panel-3) 9px,
        var(--panel-2) 9px, var(--panel-2) 18px);
    }
    /* 铭牌用 visibility 而不是 display 收掉：
       16:10 的高度是铭牌自己给的（:host(.ratio-wide) 的 aspect-ratio），
       display:none 会把铭牌从布局里摘掉 —— 封面高度塌成 0（实测 h=0）。
       visibility:hidden 保留占位、只是不画，斜纹底从底下透出来。 */
    :host ::ng-deep .wc.broken .wc-plate { visibility: hidden; }

    /* 解析失败：说明就长在图区里，不另开错误块 */
    .wc-broken {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding-bottom: 54px;
      color: var(--err);
    }
    .wc-broken-title {
      font-size: 11.5px;
      font-weight: 600;
      background: var(--err-soft);
      color: var(--err);
      padding: 2px 9px;
      border-radius: var(--radius-xs);
    }
    .wc-broken-msg {
      font-size: 10.5px;
      color: var(--muted);
      background: var(--panel);
      padding: 2px 8px;
      border-radius: var(--radius-xs);
      border: 1px solid var(--border-soft);
      max-width: 90%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wc-top {
      position: absolute;
      left: 9px;
      top: 9px;
      right: 9px;
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .wc-dep {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 1 auto;
      min-width: 0;
      font-size: 10px;
      font-weight: 600;
      color: #fff;
      /* 没有照片时封面是浅色家族底，半透明红底压不住 → 用实色；
         有照片时蒙版已把底下压暗，回到半透明红（压图上的老口径）。 */
      background: var(--err);
      border-radius: var(--radius-xs);
      padding: 2px 6px;
      white-space: nowrap;
      overflow: hidden;
    }
    .wc.on-shot .wc-dep { background: rgb(220 38 38 / 0.58); }
    .wc-dep span { overflow: hidden; text-overflow: ellipsis; }
    .wc-count,
    .wc-note {
      flex: 0 1 auto;
      min-width: 0;
      font-size: 10px;
      font-weight: 500;
      color: #fff;
      border-radius: var(--radius-xs);
      padding: 2px 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* 计数拆成两枚与分组同款的小标签，不再是一整条压在图上的文字 */
    .wc-count {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      background: none;
      border-radius: 0;
      overflow: visible;
    }
    /* 压在图上的计数与正文那枚是同一规格，只把底色换成深色半透明 */
    .wc-count > span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 16px;
      padding: 0 5px;
      border-radius: var(--radius-xs);
      background: var(--panel);
      box-shadow: inset 0 0 0 1px var(--border-strong);
      color: var(--text);
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .wc.on-shot .wc-count > span {
      background: rgb(0 0 0 / 0.42);
      box-shadow: none;
      color: #fff;
    }
    .wc-note { background: var(--warn); font-weight: 600; }
    .wc.on-shot .wc-note { background: rgb(217 119 6 / 0.86); }

    .wc-acts {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 5px;
      flex: none;
    }
    .wc-kebab {
      width: 27px;
      height: 23px;
      flex: none;
      border: 0;
      border-radius: var(--radius-sm);
      background: var(--panel);
      box-shadow: inset 0 0 0 1px var(--border-strong);
      color: var(--text-2);
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
      font-size: 13px;
      line-height: 1;
    }
    .wc.on-shot .wc-kebab {
      background: rgb(0 0 0 / 0.42);
      box-shadow: none;
      color: #fff;
    }
    .wc.on-shot .wc-kebab:hover { background: rgb(0 0 0 / 0.6); }

    .wc-name {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 8px;
    }
    /* 标题压在封面下沿。没有照片时封面是浅色家族底，字必须深色才读得出来；
       有照片时铭牌的蒙版已把下沿压到近实色，字翻白。
       口径与 md-model-card / md-library-card 的 .on-shot 翻转一致。 */
    .wc-name h3 {
      margin: 0;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wc.on-shot .wc-name h3 {
      color: #fff;
      text-shadow: 0 1px 4px rgb(0 0 0 / 0.58);
    }
    .wc-name p {
      margin: 2px 0 0;
      font-size: 10.5px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wc.on-shot .wc-name p {
      color: rgb(255 255 255 / 0.74);
      text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
    }
    .wc-body { padding: 8px 9px; }
    .wc-split {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .wc-meta {
      display: flex;
      gap: 5px;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
    }
    /* 分组标签：与分组筛选栏的数字标签同规格（16px 小圆角片 + 强描边）。
       底子留 --panel-3：卡片正文是 --panel，纯白片在白底上只剩一条边 */
    .wc-tag {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      height: 16px;
      padding: 0 5px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      box-shadow: inset 0 0 0 1px var(--border-strong);
      color: var(--text);
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* 未分组也占一枚标签：灰底 / 弱描边 / 灰字，是「无值」的禁用态，不是一行淡字 */
    .wc-tag.is-none {
      background: var(--panel-2);
      box-shadow: inset 0 0 0 1px var(--border);
      color: var(--muted);
      font-weight: 500;
    }
    /* UI | API 双段从封面右上挪到分组标签之后：保留双段形态，
       但换成浅底深字的正文档次（原来那套白底高亮是压图用的） */
    .wc-fmt {
      flex: none;
      display: inline-flex;
      align-items: stretch;
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
    .wc-primary {
      margin-left: auto;
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
   * 四态 → 徽标 + 唯一主按钮。
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
