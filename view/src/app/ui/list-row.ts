import { Component, input } from '@angular/core';

/**
 * 列表行：左主信息、右操作 / 数值。
 *
 * 只定义行高、分隔线与左右分栏；标题、meta、按钮都由页面投影：
 *   <ui-list-row>
 *     <div rowMain>名称 + meta</div>
 *     <div rowSide>进度 / 操作</div>
 *   </ui-list-row>
 */
@Component({
  selector: 'ui-list-row',
  template: `
    <div class="list-row">
      <div class="main">
        <ng-content select="[rowMain]" />
      </div>
      <div class="side">
        <ng-content select="[rowSide]" />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--ui-space-4);
      padding: var(--ui-space-3) 0;
      border-bottom: 1px solid var(--ui-border-2);
    }

    :host(:last-child) .list-row {
      border-bottom: 0;
    }

    .main,
    .side {
      min-width: 0;
    }

    .side {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--ui-space-2);
    }
  `,
})
export class ListRowComponent {}
