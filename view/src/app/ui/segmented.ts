import { Component, input, model } from '@angular/core';

export interface SegmentedOption {
  key: string;
  label: string;
}

/**
 * 分段控件：同一份数据的少量互斥视图。
 *
 * 超过 3 项就改用 chip 行，别把分段排成一条长条。
 */
@Component({
  selector: 'ui-segmented',
  template: `
    <div class="segmented" role="group" [attr.aria-label]="label() || null">
      @for (o of options(); track o.key) {
        <button
          type="button"
          [class.active]="o.key === value()"
          [attr.aria-pressed]="o.key === value()"
          (click)="value.set(o.key)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .segmented {
      display: inline-flex;
      gap: 2px;
      padding: var(--ui-space-1);
      border: 1px solid var(--ui-border-2);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-panel-3);
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: var(--ui-h-compact);
      padding: 0 var(--ui-space-3);
      border: 0;
      border-radius: var(--ui-radius-pill);
      background: none;
      color: var(--ui-muted);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background 0.16s ease,
        color 0.16s ease;
    }

    button:hover {
      background: color-mix(in srgb, var(--ui-panel) 60%, transparent);
      color: var(--ui-text);
    }

    button:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    button.active,
    button.active:hover {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
    }
  `,
})
export class SegmentedComponent {
  readonly options = input.required<SegmentedOption[]>();
  readonly value = model('');
  readonly label = input('');
}
