import { Component } from '@angular/core';

/**
 * 文档小标题：卡片 / 区块之间的第二级标题。
 *
 * 与 `ui-section` 的区块标题分工：section 是页面分区，label 是分区内的说明段落标题。
 */
@Component({
  selector: 'ui-label',
  template: `
    <h3 class="label"><ng-content /></h3>
  `,
  styles: `
    :host {
      display: block;
      margin-top: var(--ui-space-6);
    }

    :host(:first-child) {
      margin-top: 0;
    }

    .label {
      margin: 0 0 var(--ui-space-2);
      color: var(--ui-text);
      font-size: var(--ui-text-lg);
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: -0.01em;
      scroll-margin-top: var(--ui-scroll-offset);
    }
  `,
})
export class LabelComponent {}
