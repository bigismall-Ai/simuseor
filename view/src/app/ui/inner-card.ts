import { Component } from '@angular/core';

/**
 * 内层卡片：透明底 + 内描边 + 阴影，用来在面板里再分一层。
 *
 * 宿主就是卡片本身（`<ui-inner-card>`），所以页面自己的布局类可以继续挂在宿主上：
 *   <ui-inner-card class="layout-pane">…</ui-inner-card>
 */
@Component({
  selector: 'ui-inner-card',
  template: `<ng-content />`,
  styles: `
    :host {
      display: block;
      border: 1px solid var(--ui-inner-border);
      border-radius: var(--ui-radius-card);
      background: transparent;
      box-shadow: var(--ui-shadow);
    }
  `,
})
export class InnerCardComponent {}
