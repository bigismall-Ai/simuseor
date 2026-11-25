import { Component } from '@angular/core';

/**
 * 表格表面：圆角卡 + 横向滚动 + 统一表头/行高/单元格内缩。
 *
 * 只负责外壳与表格基线样式，列与内容仍由页面写；
 * 这样表格不再每页手写一遍 `.table-wrap`。
 */
@Component({
  selector: 'ui-table',
  template: `
    <div class="table-wrap">
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
      backdrop-filter: blur(14px);
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
      font-size: 10.5px;
      font-weight: 500;
    }

    :host ::ng-deep .table-wrap tbody tr:nth-child(even) td {
      background: color-mix(in srgb, var(--ui-inset) 45%, transparent);
    }

    :host ::ng-deep .table-wrap tbody tr:hover td {
      background: var(--ui-raised);
    }
  `,
})
export class TableComponent {}
