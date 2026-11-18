import { Component, Input } from '@angular/core';

/**
 * 页头：一行小标签 + 标题 + 说明，右侧放本页主操作。
 *
 * kicker 是可选的「栏目标签」，用大写字母间距把页面归到某个区（LIBRARY / DISCOVER）。
 * 它替代了原来那些没信息量的说明句——只标注位置，不复述页面名。
 */
@Component({
  selector: 'ui-page-header',
  standalone: true,
  template: `
    <header class="ui-page-header">
      <div class="ui-page-heading">
        @if (kicker) {
          <p class="ui-page-kicker">{{ kicker }}</p>
        }
        <h1>{{ title }}</h1>
        @if (hint) {
          <p class="ui-page-hint">{{ hint }}</p>
        }
      </div>
      <div class="ui-page-actions">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() hint = '';
  @Input() kicker = '';
}
