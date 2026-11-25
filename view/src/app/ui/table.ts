import { Component, input } from '@angular/core';

export type TableDensity = 'default' | 'docs';

/**
 * 表格表面：圆角卡 + 横向滚动 + 统一表头/行高/单元格内缩。
 *
 * 只负责外壳与表格基线样式，列与内容仍由页面写；
 * 这样表格不再每页手写一遍 `.table-wrap`。
 *
 * 两档密度：
 *   - default：控制台密度（紧凑），表头铺底色、隔行斑马底；
 *   - docs：文档密度（更好读），表头 14px/500、单元格 14px、
 *     行间只留一条细线、不铺斑马底，悬停只做轻微提亮。
 */
@Component({
  selector: 'ui-table',
  template: `
    <div class="table-wrap" [class.docs]="density() === 'docs'">
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-list);
      background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
      box-shadow: var(--ui-shadow);
      backdrop-filter: blur(var(--ui-glass-blur));
    }

    :host ::ng-deep .table-wrap table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--ui-text-sm);
    }

    :host ::ng-deep .table-wrap th,
    :host ::ng-deep .table-wrap td {
      padding: var(--ui-space-2);
      border: 0;
      text-align: left;
    }

    :host ::ng-deep .table-wrap th:first-child,
    :host ::ng-deep .table-wrap td:first-child {
      padding-left: var(--ui-space-6);
    }

    :host ::ng-deep .table-wrap th:last-child,
    :host ::ng-deep .table-wrap td:last-child {
      padding-right: var(--ui-space-6);
    }

    :host ::ng-deep .table-wrap th {
      background: var(--ui-panel-2);
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      font-weight: var(--ui-weight-medium);
    }

    :host ::ng-deep .table-wrap tbody tr:nth-child(even) td {
      background: color-mix(in srgb, var(--ui-inset) 45%, transparent);
    }

    :host ::ng-deep .table-wrap tbody tr:hover td {
      background: var(--ui-raised);
    }

    /* ---- docs 密度：阅读优先，行间细线代替斑马底 ---- */

    :host ::ng-deep .table-wrap.docs table {
      font-size: var(--ui-text-md);
    }

    :host ::ng-deep .table-wrap.docs th,
    :host ::ng-deep .table-wrap.docs td {
      padding: var(--ui-space-4) var(--ui-space-5);
      border: 0;
      border-bottom: 1px solid var(--ui-inner-border);
      vertical-align: top;
    }

    :host ::ng-deep .table-wrap.docs th:first-child,
    :host ::ng-deep .table-wrap.docs td:first-child {
      padding-left: var(--ui-space-5);
    }

    :host ::ng-deep .table-wrap.docs th:last-child,
    :host ::ng-deep .table-wrap.docs td:last-child {
      padding-right: var(--ui-space-5);
    }

    :host ::ng-deep .table-wrap.docs th {
      background: transparent;
      color: var(--ui-text);
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-medium);
    }

    :host ::ng-deep .table-wrap.docs tbody tr:nth-child(even) td {
      background: transparent;
    }

    :host ::ng-deep .table-wrap.docs tbody tr:hover td {
      background: color-mix(in srgb, var(--ui-raised) 55%, transparent);
    }

    :host ::ng-deep .table-wrap.docs tbody tr:last-child td {
      border-bottom: 0;
    }
  `,
})
export class TableComponent {
  /** default = 控制台密度（紧凑）；docs = 文档密度（14px、行线、无斑马底） */
  readonly density = input<TableDensity>('default');
}
