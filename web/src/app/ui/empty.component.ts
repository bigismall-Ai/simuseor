import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-empty',
  standalone: true,
  template: `
    <div class="ui-empty">
      @if (icon) {
        <!-- 装饰性图形不进可访问名：空状态该被读到的是标题与提示（VIS §7.1 / §7.3） -->
        <div class="ui-empty-icon" aria-hidden="true">{{ icon }}</div>
      }
      <p class="ui-empty-title">{{ title }}</p>
      @if (hint) {
        <p class="ui-empty-hint">{{ hint }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyComponent {
  @Input() icon = '';
  @Input({ required: true }) title = '';
  @Input() hint = '';
}
