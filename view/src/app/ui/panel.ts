import { Component, input } from '@angular/core';

/**
 * 面板：页面里所有内容的容器。
 *
 * 只要给了 title / kicker 就画一条分隔线——标题栏与内容之间有线，视线才知道从哪开始读；
 * 不带标题时不画线，避免出现「一条线下面什么都没有」的空槽。
 */
@Component({
  selector: 'ui-panel',
  template: `
    <section class="ui-panel">
      @if (title() || kicker()) {
        <div class="ui-panel-head">
          <div class="ui-panel-heading">
            @if (kicker()) {
              <p class="ui-page-kicker">{{ kicker() }}</p>
            }
            @if (title()) {
              <h2>{{ title() }}</h2>
            }
            @if (hint()) {
              <p class="ui-panel-hint">{{ hint() }}</p>
            }
          </div>
          <div class="ui-panel-actions">
            <ng-content select="[panel-actions]" />
          </div>
        </div>
      }
      <ng-content />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .ui-panel {
      margin-bottom: var(--ui-space-4);
      padding: var(--ui-space-5);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-panel);
      background: var(--ui-panel);
      box-shadow: var(--ui-shadow);
      backdrop-filter: blur(var(--ui-glass-blur));
    }

    .ui-panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ui-space-4);
      flex-wrap: wrap;
      margin-bottom: var(--ui-space-4);
      padding-bottom: var(--ui-space-3);
      border-bottom: 1px solid var(--ui-border-2);
    }

    .ui-panel-heading {
      min-width: 0;
    }

    .ui-page-kicker {
      margin: 0 0 var(--ui-space-1);
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      font-weight: var(--ui-weight-semibold);
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    .ui-panel-heading h2 {
      margin: 0;
      font-size: var(--ui-text-lg);
      font-weight: var(--ui-weight-semibold);
      letter-spacing: -0.01em;
      scroll-margin-top: var(--ui-scroll-offset);
    }

    .ui-panel-hint {
      max-width: var(--layout-prose-measure);
      margin: var(--ui-space-1) 0 0;
      color: var(--ui-muted);
      font-size: var(--ui-text-md);
    }

    .ui-panel-actions {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      flex: none;
    }

    /* 无标题面板里直接放内容时，不要顶到边框上 */
    .ui-panel > :first-child {
      margin-top: 0;
    }

    .ui-panel > :last-child {
      margin-bottom: 0;
    }
  `,
})
export class PanelComponent {
  readonly title = input('');
  readonly hint = input('');
  readonly kicker = input('');
}
