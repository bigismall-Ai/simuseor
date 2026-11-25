import { Component, input, output } from '@angular/core';

export type SourceChipState = 'ok' | 'degraded' | 'down';

/**
 * 来源胶囊：一个下载来源的可选状态。
 *
 * 状态点表达「这条通路的健康度」，胶囊本身承接按钮语言（玻璃面 + 描边 + 轻投影）。
 * 不可达时灰置并禁用，原因只放 title，不印在页面上。
 */
@Component({
  selector: 'ui-source-chip',
  template: `
    <button
      type="button"
      class="chip"
      [class.on]="active()"
      [class.degraded]="state() === 'degraded'"
      [class.down]="state() === 'down'"
      [disabled]="disabled() || state() === 'down'"
      [attr.aria-pressed]="active()"
      [attr.title]="tip() || null"
      (click)="picked.emit()"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{{ label() }}</span>
      @if (detail()) {
        <em>{{ detail() }}</em>
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
      height: var(--ui-h-md);
      padding: 0 var(--ui-space-3);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-pill);
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ui-surface) 94%, transparent),
        color-mix(in srgb, var(--ui-surface) 76%, transparent)
      );
      color: var(--ui-text-2);
      box-shadow: var(--button-shadow);
      backdrop-filter: blur(12px) saturate(1.04);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-semibold);
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        color 0.18s ease;
    }

    :host-context([data-theme='dark']) .chip {
      background:
        linear-gradient(180deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.03)),
        color-mix(in srgb, var(--ui-raised) 88%, transparent);
      border-color: rgb(255 255 255 / 0.2);
      box-shadow:
        0 1px 0 rgb(255 255 255 / 0.2) inset,
        0 8px 20px -10px rgb(0 0 0 / 0.9);
    }

    .chip:not(:disabled):hover {
      border-color: var(--accent-line);
      box-shadow: var(--button-shadow-hover);
    }

    .chip:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .chip.on {
      border-color: var(--accent-line);
      background: var(--accent-soft);
      color: var(--ui-accent);
    }

    .chip.down {
      opacity: 0.48;
      box-shadow: none;
      cursor: not-allowed;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 0 3px var(--ok-soft);
    }

    .chip.degraded .dot {
      background: var(--warn);
      box-shadow: 0 0 0 3px var(--warn-soft);
    }

    .chip.down .dot {
      background: var(--faint);
      box-shadow: none;
    }

    em {
      font-style: normal;
      color: var(--ui-muted);
      font-family: var(--ui-font-mono);
      font-size: 10.5px;
      font-weight: var(--ui-weight-medium);
    }

    .chip.on em {
      color: inherit;
    }
  `,
})
export class SourceChipComponent {
  readonly label = input.required<string>();
  /** 右侧读数：速度、延迟、探测结果。 */
  readonly detail = input('');
  readonly state = input<SourceChipState>('ok');
  readonly active = input(false);
  readonly disabled = input(false);
  /** 悬停说明：不可达原因等，不印在页面上。 */
  readonly tip = input('');
  readonly picked = output<void>();
}
