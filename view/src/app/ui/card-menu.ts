import { Component, input, output } from '@angular/core';

export interface CardMenuItem {
  key: string;
  label: string;
  /** 外链菜单项：渲染成 <a>，点了不关菜单由调用方决定 */
  href?: string;
  danger?: boolean;
  testId?: string;
}

/**
 * 卡片右上角 ⋯ 的弹出菜单。
 *
 * 只负责表面与条目，定位由宿主所在的 `.acard-head` 决定（贴右上角、向下弹）。
 * `static` 用于设计页单独展示，不参与定位。
 */
@Component({
  selector: 'ui-card-menu',
  host: {
    '[class.is-static]': 'static()',
  },
  template: `
    <div class="acard-menu" role="menu">
      @for (item of items(); track item.key) {
        @if (item.href) {
          <a
            class="acard-menu-item"
            role="menuitem"
            [href]="item.href"
            target="_blank"
            rel="noreferrer"
            [attr.data-testid]="item.testId || null"
            (click)="picked.emit(item.key)"
          >
            {{ item.label }}
          </a>
        } @else {
          <button
            type="button"
            role="menuitem"
            class="acard-menu-item"
            [class.is-danger]="item.danger"
            [attr.data-testid]="item.testId || null"
            (click)="picked.emit(item.key)"
          >
            {{ item.label }}
          </button>
        }
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class CardMenuComponent {
  readonly items = input<CardMenuItem[]>([]);
  /** 设计页：取消绝对定位，作为一个独立表面展示 */
  readonly static = input(false);
  readonly picked = output<string>();
}
