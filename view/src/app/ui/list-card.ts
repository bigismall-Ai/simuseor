import { Component } from '@angular/core';

/**
 * 列表卡表面：圆角卡 + 裁切 + 玻璃底。
 *
 * 列表行由页面写（表格用 `ui-table`）；这里只管外壳，
 * 避免每个页面重复 `border-radius / background / overflow`。
 */
@Component({
  selector: 'ui-list-card',
  template: `
    <div class="list-card">
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
export class ListCardComponent {}
