import { Component, computed, input, model } from '@angular/core';
import { UiIconModule } from './material';

/** 分页条目：页码，或一段省略号。 */
export type PaginationItem = number | 'gap';

/**
 * 分页：上一页 / 下一页 + 带省略号的页码窗口。
 *
 * 页码窗口始终保留首末两页，当前页左右各展开 `siblings` 页；
 * 窗口内页码总数不超过 7（含省略号），窄屏不换行。
 *
 * 控件走 28px 档（`--ui-h-sm`），当前页实心；页码按钮最多 7 个，
 * 再多的页数靠省略号压缩，不出现两行页码。
 */
@Component({
  selector: 'ui-pagination',
  imports: [UiIconModule],
  template: `
    <nav class="pager" [attr.aria-label]="label()">
      <button
        type="button"
        class="step"
        aria-label="上一页"
        [disabled]="!canPrev()"
        (click)="go(page() - 1)"
      >
        <mat-icon svgIcon="app:chevron-left" aria-hidden="true"></mat-icon>
      </button>

      @for (item of items(); track $index) {
        @if (item === 'gap') {
          <span class="gap" aria-hidden="true">…</span>
        } @else {
          <button
            type="button"
            class="page"
            [class.on]="item === page()"
            [attr.aria-current]="item === page() ? 'page' : null"
            [attr.aria-label]="'第 ' + item + ' 页'"
            (click)="go(item)"
          >
            {{ item }}
          </button>
        }
      }

      <button
        type="button"
        class="step"
        aria-label="下一页"
        [disabled]="!canNext()"
        (click)="go(page() + 1)"
      >
        <mat-icon svgIcon="app:chevron-right" aria-hidden="true"></mat-icon>
      </button>
    </nav>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .pager {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-1);
    }

    .step,
    .page {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: var(--ui-h-sm);
      border: 1px solid transparent;
      border-radius: var(--ui-radius-sm);
      background: none;
      color: var(--ui-text-2);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-medium);
      line-height: 1;
      cursor: pointer;
      transition:
        background 0.16s ease,
        border-color 0.16s ease,
        color 0.16s ease;
    }

    .step {
      width: var(--ui-h-sm);
      padding: 0;
    }

    .step mat-icon {
      width: var(--icon-inline);
      height: var(--icon-inline);
      font-size: var(--icon-inline);
    }

    .page {
      min-width: var(--ui-h-sm);
      padding: 0 var(--ui-space-1);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-xs);
    }

    .step:not(:disabled):hover,
    .page:not(.on):hover {
      border-color: var(--ui-border-2);
      background: var(--ui-panel-2);
      color: var(--ui-text);
    }

    .step:focus-visible,
    .page:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .step:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .page.on,
    .page.on:hover {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
      font-weight: var(--ui-weight-semibold);
    }

    .gap {
      min-width: var(--ui-h-sm);
      color: var(--ui-muted);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-xs);
      text-align: center;
    }

    @media (prefers-reduced-motion: reduce) {
      .step,
      .page {
        transition: none;
      }
    }
  `,
})
export class PaginationComponent {
  /**
   * 当前页，从 1 开始。
   *
   * `[(page)]` 双向绑定即可；翻页时 model 自动抛出 `pageChange` 事件
   * （与显式 output 同名会触发 NG1054，所以不再额外声明）。
   */
  readonly page = model(1);
  readonly pageCount = input.required<number>();
  /** 当前页左右各展开几页；默认 1，窗口最多 7 格。 */
  readonly siblings = input(1);
  readonly label = input('分页');

  /** 实际总页数：至少 1 页，避免 0 页时把控件排成空条。 */
  readonly total = computed(() => Math.max(1, Math.floor(this.pageCount())));

  readonly canPrev = computed(() => this.page() > 1);
  readonly canNext = computed(() => this.page() < this.total());

  readonly items = computed<PaginationItem[]>(() => {
    const total = this.total();
    const current = Math.min(Math.max(1, this.page()), total);

    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    // 首末两页固定保留，中间按 siblings 展开并压到 7 格以内。
    const numbers = windowNumbers(total, current, this.siblings());

    const items: PaginationItem[] = [];
    let previous = 0;
    for (const number of numbers) {
      if (number - previous > 1) items.push('gap');
      items.push(number);
      previous = number;
    }
    return items;
  });

  go(target: number): void {
    const next = Math.min(Math.max(1, target), this.total());
    if (next === this.page()) return;
    this.page.set(next);
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * 页码窗口：首末两页固定出现，中间围绕当前页展开。
 *
 * 首末页 + 省略号 + 中间页码合计不超过 7 格：先按 `siblings` 展开，
 * 超出就对称裁掉，还有空格就向未贴边的一侧补页；
 * 贴边时不会出现「1 … 12」这种只有两个数字的开头。
 */
function windowNumbers(total: number, current: number, siblings: number): number[] {
  const side = Math.max(0, Math.floor(siblings));
  let from = Math.max(2, current - side);
  let to = Math.min(total - 1, current + side);

  const slots = () =>
    2 + (to - from + 1) + (from > 2 ? 1 : 0) + (to < total - 1 ? 1 : 0);

  while (slots() > 7 && to >= from) {
    if (current - from >= to - current) from += 1;
    else to -= 1;
  }

  while (slots() < 7) {
    if (from > 2) from -= 1;
    else if (to < total - 1) to += 1;
    else break;
  }

  return [1, ...range(from, to), total];
}
