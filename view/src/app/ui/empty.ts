import { Component, input } from '@angular/core';

@Component({
  selector: 'ui-empty',
  template: `
    <div class="ui-empty">
      @if (icon()) {
        <!-- 装饰性图形不进可访问名：空状态该被读到的是标题与提示（VIS §7.1 / §7.3） -->
        <div class="ui-empty-icon" aria-hidden="true">{{ icon() }}</div>
      }
      <p class="ui-empty-title">{{ title() }}</p>
      @if (hint()) {
        <p class="ui-empty-hint">{{ hint() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .ui-empty {
      padding: var(--ui-space-8) var(--ui-space-5);
      color: var(--ui-muted);
      text-align: center;
    }

    .ui-empty-icon {
      margin-bottom: 10px;
      font-size: 26px;
      line-height: 1;
      opacity: 0.4;
    }

    .ui-empty-title {
      margin: 0 0 4px;
      color: var(--ui-text);
      font-size: var(--ui-text-lg);
      font-weight: 600;
    }

    .ui-empty-hint {
      margin: 0;
      font-size: var(--ui-text-md);
    }
  `,
})
export class EmptyComponent {
  readonly icon = input('');
  readonly title = input('');
  readonly hint = input('');
}
