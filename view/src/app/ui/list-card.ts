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

    .list-card {
      overflow: hidden;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-list);
      background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
      box-shadow: var(--ui-shadow);
      backdrop-filter: blur(var(--ui-glass-blur));
    }
  `,
})
export class ListCardComponent {}
