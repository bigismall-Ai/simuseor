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
      margin-bottom: 14px;
      padding: 18px 20px 20px;
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
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      padding-bottom: 13px;
      border-bottom: 1px solid var(--ui-border-2);
    }

    .ui-panel-heading {
      min-width: 0;
    }

    .ui-page-kicker {
      margin: 0 0 5px;
      color: var(--ui-muted);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    .ui-panel-heading h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .ui-panel-hint {
      max-width: 76ch;
      margin: 4px 0 0;
      color: var(--ui-muted);
      font-size: 12px;
    }

    .ui-panel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
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
