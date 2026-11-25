import { Component, input } from '@angular/core';
import { BadgeComponent } from './badge';
import type { BadgeTone } from './badge';

/**
 * 状态卡：错误 / 空态 / 演示用的说明卡。
 *
 * 只定义卡头（标题 + 右侧标签/徽标）与内容区，正文由调用方投影。
 * 页面上不再手写 `.card + .card-head + .card-body` 这一套。
 */
@Component({
  selector: 'ui-state-card',
  imports: [BadgeComponent],
  template: `
    <article class="state-card" [class.is-bad]="bad()">
      @if (title() || tag() || badge()) {
        <header class="state-head">
          <h3>{{ title() }}</h3>
        @if (tag()) {
          <span class="state-tag">{{ tag() }}</span>
        }
          @if (badge()) {
            <ui-badge [tone]="badgeTone()">{{ badge() }}</ui-badge>
          }
        </header>
      }
      <div class="state-body">
        <ng-content />
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .state-card {
      overflow: hidden;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-card);
      background: var(--ui-surface);
      box-shadow: var(--ui-shadow);
    }

    .state-card.is-bad {
      border-color: color-mix(in oklab, var(--ui-error) 26%, var(--ui-border));
    }

    .state-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid var(--ui-border);
      background: var(--ui-raised);
    }

    .state-head h3 {
      margin: 0;
      font-size: var(--ui-text-md);
      font-weight: 600;
    }

    .state-tag {
      margin-left: auto;
      color: var(--ui-muted);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-xs);
    }

    .state-head ui-badge {
      margin-left: auto;
    }

    .state-body {
      padding: var(--ui-space-4);
    }
  `,
})
export class StateCardComponent {
  readonly title = input('');
  /** 右侧等宽小字（路由 / 位置），与 badge 二选一 */
  readonly tag = input('');
  /** 右侧状态徽标，与 tag 二选一 */
  readonly badge = input('');
  readonly badgeTone = input<BadgeTone>('gray');
  /** 现状 / 反例：红色描边 */
  readonly bad = input(false);
}
