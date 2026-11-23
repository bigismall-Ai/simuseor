import { Component, input } from '@angular/core';

export type BadgeTone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

@Component({
  selector: 'ui-badge',
  template: `
    <span
      class="ui-badge"
      [class.gray]="tone() === 'gray'"
      [class.blue]="tone() === 'blue'"
      [class.green]="tone() === 'green'"
      [class.orange]="tone() === 'orange'"
      [class.red]="tone() === 'red'"
      ><ng-content
    /></span>
  `,
  styles: `
    /* 语义色全部由全局 token 混合得到，不新增十六进制 */
    :host {
      --badge-gray-bg: var(--ui-panel-3);
      --badge-gray-ink: var(--ui-muted);
      --badge-blue-bg: color-mix(in srgb, var(--ui-accent) 14%, transparent);
      --badge-blue-ink: color-mix(in srgb, var(--ui-accent) 70%, var(--ui-text));
      --badge-green-bg: color-mix(in srgb, var(--ink-moss) 14%, transparent);
      --badge-green-ink: var(--ink-moss);
      --badge-orange-bg: color-mix(in srgb, var(--ui-glow-peach) 22%, transparent);
      --badge-orange-ink: color-mix(in srgb, var(--ui-glow-peach) 45%, var(--ui-text));
      --badge-red-bg: color-mix(in srgb, var(--ui-error) 14%, transparent);
      --badge-red-ink: color-mix(in srgb, var(--ui-error) 80%, var(--ui-text));
    }

    :host-context(html[data-theme='dark']) {
      --badge-green-bg: color-mix(in srgb, var(--aurora-mint) 14%, transparent);
      --badge-green-ink: var(--aurora-mint);
    }

    .ui-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      border-radius: var(--ui-radius-pill);
      font-size: 11px;
      font-weight: 500;
      line-height: 18px;
      white-space: nowrap;
    }

    .ui-badge.gray {
      background: var(--badge-gray-bg);
      color: var(--badge-gray-ink);
    }

    .ui-badge.blue {
      background: var(--badge-blue-bg);
      color: var(--badge-blue-ink);
    }

    .ui-badge.green {
      background: var(--badge-green-bg);
      color: var(--badge-green-ink);
    }

    .ui-badge.orange {
      background: var(--badge-orange-bg);
      color: var(--badge-orange-ink);
    }

    .ui-badge.red {
      background: var(--badge-red-bg);
      color: var(--badge-red-ink);
    }
  `,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('gray');
}
