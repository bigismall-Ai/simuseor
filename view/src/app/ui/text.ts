import { Component, input } from '@angular/core';

/**
 * 文档说明段落：引言（lead）与提示（hint）两种语气。
 *
 * 列表规则用 `ui-rules`，小标题用 `ui-label`；这里只处理普通段落。
 */
@Component({
  selector: 'ui-text',
  template: `
    <p [class]="'prose ' + variant()"><ng-content /></p>
  `,
  styles: `
    :host {
      display: block;
    }

    .prose {
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      line-height: 1.65;
    }

    .lead {
      max-width: 72ch;
      margin: -4px 0 var(--ui-space-4);
    }

    .hint {
      max-width: 640px;
      margin: var(--ui-space-3) 0 0;
    }
  `,
})
export class TextComponent {
  readonly variant = input<'lead' | 'hint'>('hint');
}
