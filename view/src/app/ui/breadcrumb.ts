import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface CrumbItem {
  label: string;
  /** 中间层级的路由；最后一项即使带 route 也不渲染成链接 */
  route?: string;
}

/**
 * 面包屑：当前页在层级里的位置。
 *
 * 只做「层级 + 定位」这一件事：
 *   - 中间层级是链接，最后一项是文本 + `aria-current="page"`，不能再点自己；
 *   - 分隔符 `›` 由组件统一画，页面不重复写；
 *   - 长标签在中间截断（前后各留 10 字），完整值留在 `title` 里，
 *     页面不会被一条超长名称撑破；不用 `aria-label` 另起一个名字，
 *     否则可见文本与可访问名不一致（AXE label-content-name-mismatch）。
 *
 * 页头仍是 `ui-page-header`；面包屑放进 `ui-page` 的 `[page-head]` 槽即可。
 */
@Component({
  selector: 'ui-breadcrumb',
  imports: [RouterLink],
  template: `
    <nav class="crumb" [attr.aria-label]="label()">
      @for (item of items(); track $index; let last = $last) {
        @if (!$first) {
          <span class="sep" aria-hidden="true">›</span>
        }
        @if (last) {
          <span
            class="here"
            aria-current="page"
            [attr.title]="overflow(item.label) ? item.label : null"
          >{{ shown(item.label) }}</span>
        } @else if (item.route) {
          <a
            class="link"
            [routerLink]="item.route"
            [attr.title]="overflow(item.label) ? item.label : null"
          >{{ shown(item.label) }}</a>
        } @else {
          <span
            class="step"
            [attr.title]="overflow(item.label) ? item.label : null"
          >{{ shown(item.label) }}</span>
        }
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .crumb {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ui-space-1);
      min-width: 0;
      color: var(--ui-muted);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-medium);
      line-height: 1.5;
    }

    .sep {
      flex: none;
      color: var(--ui-muted);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-sm);
    }

    .link {
      min-width: 0;
      font-family: var(--ui-font-body);
      border-radius: var(--ui-radius-xs);
      color: inherit;
      text-decoration: none;
      white-space: nowrap;
    }

    .link:hover {
      color: var(--ui-text);
    }

    .link:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .step,
    .here {
      min-width: 0;
      white-space: nowrap;
    }

    .here {
      color: var(--ui-text);
      font-weight: var(--ui-weight-semibold);
    }
  `,
})
export class BreadcrumbComponent {
  readonly items = input<CrumbItem[]>([]);
  /** 导航的可访问名；一页只应有一处面包屑 */
  readonly label = input('面包屑');

  /** 超过这个字数就在中间截断，两端各留一部分，避免只剩前缀 */
  private readonly edge = 10;

  overflow(label: string): boolean {
    return label.length > this.edge * 2 + 1;
  }

  shown(label: string): string {
    if (!this.overflow(label)) return label;
    return `${label.slice(0, this.edge)}…${label.slice(-this.edge)}`;
  }
}
