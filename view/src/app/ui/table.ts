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
  `,
})
export class TableComponent {}
