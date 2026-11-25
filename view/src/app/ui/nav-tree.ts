import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BadgeComponent } from './badge';
import { UiIconModule } from './material';

export type NavStatus = 'new' | 'preview' | 'planned' | 'deprecated';

export interface NavRowItem {
  key: string;
  label: string;
  route?: string;
  icon?: string;
  status?: NavStatus;
  /** 大写分组标题：不可点、子项跟随父级展开 */
  subheader?: boolean;
  /** 分组行：可展开 / 收起，点击不跳路由 */
  group?: boolean;
  /** 缩进层级：0 = 顶层，1 = 子项 */
  depth: number;
  open?: boolean;
}

/**
 * 侧栏导航树：只负责渲染行，不持有业务数据。
 *
 * 行由页面用 `flattenNav` 摊平后传入；组件只负责：
 *   - 分组行的展开 / 收起按钮；
 *   - 叶子行的链接与 active 态；
 *   - 状态 chip；
 *   - 收起侧栏时只留图标。
 */
@Component({
  selector: 'ui-nav-tree',
  imports: [BadgeComponent, RouterLink, RouterLinkActive, UiIconModule],
  host: {
    '[class.collapsed]': 'collapsed()',
  },
  template: `
    <nav class="nav ui-scrollbar" aria-label="设计区导航">
      @for (row of rows(); track row.key) {
        @if (row.subheader) {
          <p class="subheader" [style.padding-left.px]="12 + row.depth * 13">{{ row.label }}</p>
        } @else if (row.group) {
          <button
            type="button"
            class="group"
            [class.open]="row.open"
            [style.padding-left.px]="8 + row.depth * 13"
            [attr.aria-expanded]="row.open"
            (click)="toggled.emit(row.key)"
          >
            <span class="label">{{ row.label }}</span>
            <mat-icon
              class="caret"
              [class.closed]="!row.open"
              svgIcon="app:chevron-down"
              aria-hidden="true"
            ></mat-icon>
          </button>
        } @else if (row.route) {
          <a
            class="item"
            [class.sub]="row.depth > 0"
            [style.padding-left.px]="row.depth > 0 ? 28 : 12"
            [routerLink]="row.route"
            routerLinkActive="active"
            [attr.title]="collapsed() ? row.label : null"
          >
            <mat-icon
              class="icon"
              [svgIcon]="'app:' + (row.icon || 'library')"
              aria-hidden="true"
            ></mat-icon>
            <span class="label">{{ row.label }}</span>
            @if (row.status) {
              <ui-badge class="status" size="sm" [tone]="statusTone(row.status)">
                {{ statusLabel(row.status) }}
              </ui-badge>
            }
          </a>
        }
      }
    </nav>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .nav {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding-right: var(--ui-space-3);
      scrollbar-gutter: stable;
      --scrollbar-size: 6px;
    }

    :host(.collapsed) .nav {
      --scrollbar-size: 4px;
    }

    .nav > * {
      flex: none;
    }

    .subheader {
      margin: var(--ui-space-2) 0 0;
      padding: 5px 0 3px;
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      font-weight: var(--ui-weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .group {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      height: var(--ui-h-compact);
      margin: 4px 0 1px;
      padding: 0 var(--ui-space-2);
      border: 0;
      border-radius: var(--ui-radius);
      background: transparent;
      color: var(--ui-text-2);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-semibold);
      text-align: left;
      cursor: pointer;
      transition: background 0.14s ease, color 0.14s ease;
    }

    .group:hover {
      background: var(--ui-panel-2);
      color: var(--ui-text);
    }

    .caret {
      flex: none;
      width: var(--icon-inline);
      height: var(--icon-inline);
      font-size: var(--icon-inline);
      margin-left: auto;
      opacity: 0.55;
      transition: transform 0.14s ease;
    }

    .caret.closed {
      transform: rotate(-90deg);
    }

    .item {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      height: var(--ui-h-md);
      padding-right: var(--ui-space-3);
      border-radius: var(--ui-radius-pill);
      color: var(--ui-muted);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-medium);
      transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
    }

    .item:hover {
      background: var(--ui-panel-2);
      color: var(--ui-text);
    }

    .item.active {
      background: var(--ui-raised);
      color: var(--ui-text);
      font-weight: var(--ui-weight-semibold);
      box-shadow: inset 0 0 0 1px var(--ui-border-2);
    }

    .item.sub::before {
      content: '';
      position: absolute;
      left: 18px;
      top: 8px;
      bottom: 8px;
      width: 1px;
      background: var(--ui-border-2);
    }

    .icon {
      flex: none;
      width: var(--icon-control);
      height: var(--icon-control);
      font-size: var(--icon-control);
      color: currentColor;
      opacity: 0.65;
      transition: opacity 0.14s ease;
    }

    .item.active .icon {
      opacity: 1;
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status {
      margin-left: auto;
      flex: none;
    }

    :host(.collapsed) .subheader,
    :host(.collapsed) .group,
    :host(.collapsed) .label,
    :host(.collapsed) .status {
      display: none;
    }

    :host(.collapsed) .nav {
      padding-right: var(--ui-space-2);
    }

    :host(.collapsed) .item {
      justify-content: center;
      gap: 0;
      padding: 0 !important;
    }

    :host(.collapsed) .icon {
      width: var(--icon-action);
      height: var(--icon-action);
      font-size: var(--icon-action);
      opacity: 0.8;
    }

    :host(.collapsed) .item.active .icon {
      opacity: 1;
    }

    :host(.collapsed) .item.sub::before {
      display: none;
    }
  `,
})
export class NavTreeComponent {
  readonly rows = input<NavRowItem[]>([]);
  readonly activeRoute = input('');
  readonly collapsed = input(false);
  readonly toggled = output<string>();

  statusLabel(status: NavStatus): string {
    const labels: Record<NavStatus, string> = {
      new: 'New',
      preview: 'Preview',
      planned: 'Planned',
      deprecated: 'Deprecated',
    };
    return labels[status];
  }

  statusTone(status: NavStatus): 'green' | 'blue' | 'gray' | 'orange' {
    const tones: Record<NavStatus, 'green' | 'blue' | 'gray' | 'orange'> = {
      new: 'green',
      preview: 'blue',
      planned: 'gray',
      deprecated: 'orange',
    };
    return tones[status];
  }
}
