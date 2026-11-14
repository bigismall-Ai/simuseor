import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FamilyMarkComponent } from './family-mark.component';
import { LocalWorkflow } from '../core/types';

export type WorkflowState = 'broken' | 'api' | 'missing' | 'ready';

/** 四态的呈现规则：徽标说什么情况，按钮说该做什么，一一对应不重复。 */
interface StateView {
  /** 封面徽标：缺失用红底提示、齐全用中性计数、解析失败不戴徽标 */
  badge: 'dep' | 'count' | 'note' | 'none';
  badgeText: string;
  /** 唯一主按钮 */
  act: 'fix' | 'use' | 'edit';
  label: string;
}

/**
 * 工作流卡片。
 *
 * 三条来自卡片方案 v2 的硬规则：
 * 1. **一个卡上只有一个主按钮**。使用 / 补齐 / 编辑器三件事是先后关系不是并列，
 *    摆三个再置灰两个只是噪音。状态决定它是谁。
 * 2. **解析失败的说明长在封面图区里**，不弹 toast、不弹模态、不另开错误块 ——
 *    坏文件是这条资产自己的属性。
 * 3. **徽标与正文不重复表达**。红色徽标已经说了「缺东西」，正文不再写一遍状态行。
 */
@Component({
  selector: 'app-workflow-card',
  standalone: true,
  imports: [FamilyMarkComponent],
  template: `
    <article class="wc" [class.broken]="state() === 'broken'" [attr.data-name]="it.name">
      <div class="wc-cover" [class.broken-cover]="state() === 'broken'">
        @if (state() !== 'broken' && it.cover && !coverFailed) {
          <!-- 用 img 而不是 background-image：Civitai 按 referrer 拦图，
               只有 img 能带 referrerpolicy，背景图带不了 -->
          <img class="wc-cover-img" [src]="it.cover" alt="" referrerpolicy="no-referrer"
               loading="lazy" (error)="coverFailed = true" />
        }
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
        } @else {
          <div class="wc-veil"></div>
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
          <button class="wc-primary" [class.ghost]="view().act === 'edit'" (click)="primary.emit({ item: it, act: view().act })">
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

    .wc-cover {
      position: relative;
      aspect-ratio: 16 / 10;
      background-color: var(--panel-3);
      overflow: hidden;
    }
    .wc-cover-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center 28%;
      display: block;
    }
    .wc-cover.broken-cover {
      background: repeating-linear-gradient(45deg, var(--panel-3), var(--panel-3) 9px,
        var(--panel-2) 9px, var(--panel-2) 18px);
    }
    .wc-veil {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgb(0 0 0 / 0.46) 0%, rgb(0 0 0 / 0) 32%,
        rgb(0 0 0 / 0.26) 56%, rgb(0 0 0 / 0.82) 100%);
    }
    :host-context([data-theme='dark']) .wc-veil {
      background: linear-gradient(180deg, rgb(0 0 0 / 0.18) 0%, rgb(0 0 0 / 0) 38%, rgb(0 0 0 / 0.74) 100%);
    }

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
      background: rgb(220 38 38 / 0.58);
      border-radius: var(--radius-xs);
      padding: 2px 6px;
      white-space: nowrap;
      overflow: hidden;
    }
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
      background: rgb(0 0 0 / 0.42);
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .wc-note { background: rgb(217 119 6 / 0.86); font-weight: 600; }

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

    .wc-name {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 8px;
    }
    .wc-name h3 {
      margin: 0;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
      color: #fff;
      text-shadow: 0 1px 4px rgb(0 0 0 / 0.58);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wc.broken .wc-name h3 { color: var(--text); text-shadow: none; }
    .wc-name p {
      margin: 2px 0 0;
      font-size: 10.5px;
      color: rgb(255 255 255 / 0.74);
      text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wc.broken .wc-name p { color: var(--muted); text-shadow: none; }
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

  /** 远程图挂掉（防盗链 / 404）就退回空封面，别留一块碎图 */
  coverFailed = false;

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

  /** 四态 → 徽标 + 唯一主按钮。表格就是设计文档 3.0.2 的状态机。 */
  view(): StateView {
    switch (this.state()) {
      case 'broken':
        // 语法错误是硬阻断：没有「使用」这回事，只能去改
        return { badge: 'none', badgeText: '', act: 'edit', label: '用编辑器打开' };
      case 'api':
        return { badge: 'note', badgeText: 'API 格式 · 不能载入画布', act: 'edit', label: '用编辑器打开' };
      case 'ready':
        return { badge: 'count', badgeText: `${this.it.nodes} 节点 · ${this.totalDeps()} 依赖`, act: 'use', label: '使用工作流' };
      default: {
        const parts: string[] = [];
        const m = this.it.deps?.missing?.length || 0;
        const p = this.it.node_deps?.missing?.length || 0;
        if (m) parts.push(`缺 ${m} 模型`);
        if (p) parts.push(`${p} 节点包`);
        return { badge: 'dep', badgeText: parts.join(' · '), act: 'fix', label: '补齐依赖' };
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
    return '缺 ' + parts.join('、') + '，点「补齐依赖」处理';
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
