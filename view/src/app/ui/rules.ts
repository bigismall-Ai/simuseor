import { Component } from '@angular/core';

/**
 * 文档规则清单：说明文字里的「必须 / 不要」条目。
 *
 * 列表项由调用方写 `<li>`，组件只定义字号、行高、缩进与强调色。
 */
@Component({
  selector: 'ui-rules',
  template: `
    <ul class="rules"><ng-content /></ul>
  `,
  styles: `
    :host {
      display: block;
    }

    .rules {
      margin: 0;
      padding-left: 18px;
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      line-height: 1.75;
    }

    .rules ::ng-deep b {
      color: var(--ui-text);
    }
  `,
})
export class RulesComponent {}
