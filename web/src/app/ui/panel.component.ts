import { Component, Input } from '@angular/core';

/**
 * 面板：页面里所有内容的容器。
 *
 * 只要给了 title / kicker 就画一条分隔线——标题栏与内容之间有线，视线才知道从哪开始读；
 * 不带标题时不画线，避免出现「一条线下面什么都没有」的空槽。
 */
@Component({
  selector: 'ui-panel',
  standalone: true,
  template: `
    <section class="panel">
      @if (title || kicker) {
        <div class="panel-head">
          <div class="panel-heading">
            @if (kicker) {
              <p class="page-kicker">{{ kicker }}</p>
            }
            @if (title) {
              <h2>{{ title }}</h2>
            }
            @if (hint) {
              <p class="panel-hint">{{ hint }}</p>
            }
          </div>
          <div class="panel-actions">
            <ng-content select="[panel-actions]" />
          </div>
        </div>
      }
      <ng-content />
    </section>
  `,
})
export class PanelComponent {
  @Input() title = '';
  @Input() hint = '';
  @Input() kicker = '';
}
