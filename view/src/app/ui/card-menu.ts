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

    .acard-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      left: auto;
      z-index: 6;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      min-width: 132px;
      max-width: 240px;
      max-height: 150px;
      overflow-y: auto;
      padding: var(--ui-space-1);
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--ui-overlay);
      box-shadow:
        inset 0 0 0 1px var(--ui-inner-border),
        0 10px 24px rgb(0 0 0 / 0.32);
    }

    :host(.is-static) .acard-menu {
      position: static;
    }

    .acard-menu-item {
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: none;
      height: 22px;
      padding: 0 7px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--text);
      font-family: var(--ui-font-body);
      font-size: 11px;
      font-weight: 500;
      text-align: left;
      white-space: nowrap;
      text-decoration: none;
      cursor: pointer;
    }

    .acard-menu-item:hover {
      background: var(--hover);
    }

    .acard-menu-item.is-danger {
      color: var(--ui-error);
    }

    .acard-menu-item.is-danger:hover {
      background: color-mix(in srgb, var(--ui-error) 12%, transparent);
      color: var(--ui-error);
    }
  `,
})
export class CardMenuComponent {
  readonly items = input<CardMenuItem[]>([]);
  /** 设计页：取消绝对定位，作为一个独立表面展示 */
  readonly static = input(false);
  readonly picked = output<string>();
}
