import { Component, input, output } from '@angular/core';

/**
 * 筛选胶囊：一行里表达「筛哪一类」。
 *
 * 与 `ui-badge` 分工：badge 是只读状态，chip 是可点的筛选项。
 * 与 `ui-source-chip` 分工：chip 不带健康度圆点，不承担通路状态。
 */
@Component({
  selector: 'ui-chip',
  template: `
    <button
      type="button"
      class="chip"
      [class.on]="active()"
      [disabled]="disabled()"
      [attr.aria-pressed]="active()"
      (click)="picked.emit()"
    >
      <ng-content />
      @if (count() !== null) {
        <span class="count">{{ count() }}</span>
      }
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      height: var(--ui-h-sm);
      padding: 0 var(--ui-space-3);
      border: 1px solid transparent;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-panel-2);
      color: var(--ui-text-2);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background 0.16s ease,
        border-color 0.16s ease,
        color 0.16s ease;
    }

    .chip:not(:disabled):hover {
      background: var(--ui-panel-3);
      color: var(--ui-text);
    }

    .chip:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .chip.on {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
    }

    .chip:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .count {
      color: var(--ui-muted);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-xs);
    }

    .chip.on .count {
      color: inherit;
      opacity: 0.7;
    }
  `,
})
export class ChipComponent {
  readonly active = input(false);
  readonly disabled = input(false);
  readonly count = input<number | null>(null);
  readonly picked = output<void>();
}
