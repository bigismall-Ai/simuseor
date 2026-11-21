import { Component, EventEmitter, Input, Output } from '@angular/core';

/** 状态条里的一条只读事实。tone 只给异常，常态一律中性。 */
export interface CollectionFact {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
  /** 悬停说明：解释这个数字怎么来的，不再往条上堆字 */
  title?: string;
}

/**
 * 列表顶部 · 状态条（原型 `prototypes/page-status.html`）。
 *
 * 三层各司其职：
 *   页头    这是哪一页（身份 + 全局动作）
 *   状态条  现在看到多少（主读数 + 只读事实 + 重新读数）
 *   筛选条  怎么缩小范围（搜索 → 分面 → 排序 / 视图）
 *
 * 为什么独立成组件：六页此前各写各的 —— 模型库是一行散字，工作流是读数条
 * 加分组行加工具行，节点管理是四个统计盒。把「读数 + 过滤」收进同一个壳，
 * 同一件事就不再靠自觉保持一致。
 *
 * 槽位约定：
 *   - 主读数永远在左；筛选生效时传 total，组件渲染成 `42 / 128`。
 *   - facts 只放只读聚合。可点的状态 / 动作放投影内容（chips / 按钮）。
 *   - 刷新在状态行右端；排序 / 视图由页面投影进筛选行右端。
 */
@Component({
  selector: 'ui-collection-bar',
  standalone: true,
  template: `
    <section class="cb" aria-label="列表状态与筛选">
      <div class="cb-status">
        @if (loading && count === null) {
          <p class="cb-count is-loading">读取中…</p>
        } @else {
          <p class="cb-count" aria-live="polite">
            <b>{{ count }}</b>
            @if (total !== null && total !== count) {
              <span class="cb-total">/ {{ total }}</span>
            }
            <span class="cb-unit">{{ unit }}</span>
          </p>
        }

        @if (facts.length && !(loading && count === null)) {
          <ul class="cb-facts" aria-label="当前结果概览">
            @for (f of facts; track f.label) {
              <li [title]="f.title || ''">
                <span class="cb-fact-label">{{ f.label }}</span>
                <b
                  class="cb-fact-value"
                  [class.is-ok]="f.tone === 'ok'"
                  [class.is-warn]="f.tone === 'warn'"
                  [class.is-err]="f.tone === 'err'"
                >{{ f.value }}</b>
              </li>
            }
          </ul>
        }

        <div class="cb-status-actions">
          @if (progress) {
            <span class="cb-progress">{{ progress }}</span>
          }
          <button
            class="cb-icon"
            type="button"
            [disabled]="loading"
            [attr.aria-label]="refreshLabel"
            [title]="refreshLabel"
            (click)="refresh.emit()"
          >
            <svg [class.is-spin]="loading" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13.2 7.4a5.3 5.3 0 1 0-.3 2.6" />
              <path d="M13.3 3.6v3.9H9.4" />
            </svg>
          </button>
        </div>
      </div>

      <div class="cb-filters">
        <ng-content />
      </div>
    </section>
  `,
  styleUrls: ['./collection-bar.css'],
})
export class CollectionBarComponent {
  /** 当前集合的条数。null = 首次加载还没数 */
  @Input() count: number | string | null = null;
  /** 全部条数：仅在筛选生效时传，组件会渲染成 `42 / 128` */
  @Input() total: number | null = null;
  @Input() unit = '';
  @Input() facts: CollectionFact[] = [];
  @Input() loading = false;
  /** 加载中但仍保留旧读数时，右侧的一行小字（如「检测中…」） */
  @Input() progress = '';
  @Input() refreshLabel = '刷新';
  @Output() refresh = new EventEmitter<void>();
}
