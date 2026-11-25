import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';

export type CardActionIcon = 'play' | 'edit' | 'fix';

/**
 * 卡片动作行主按钮：动作行里只允许这一个主操作。
 *
 * 几何（高度 / 胶囊 / 字号）在这里，不散落在卡片模板里；
 * 文案、图标、禁用态、外链由卡片传入。次要动作仍走右上角 ⋯ 菜单。
 */
@Component({
  selector: 'ui-card-action',
  imports: [NgTemplateOutlet],
  host: {
    class: 'ui-card-action',
  },
  template: `
    @if (href()) {
      <a
        class="acard-primary"
        [class.ghost]="variant() === 'ghost'"
        [href]="href()"
        target="_blank"
        rel="noreferrer"
        [attr.title]="title() || null"
        [attr.data-testid]="testId() || null"
        (click)="pressed.emit()"
      >
        @if (icon()) {
          <ng-container [ngTemplateOutlet]="iconTpl" />
        }
        <span>{{ label() }}</span>
      </a>
    } @else {
      <button
        class="acard-primary"
        [class.ghost]="variant() === 'ghost'"
        type="button"
        [disabled]="disabled()"
        [attr.title]="title() || null"
        [attr.data-testid]="testId() || null"
        (click)="pressed.emit()"
      >
        @if (icon()) {
          <ng-container [ngTemplateOutlet]="iconTpl" />
        }
        <span>{{ label() }}</span>
      </button>
    }

    <ng-template #iconTpl>
      @switch (icon()) {
        @case ('play') {
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.6 3.3 12.4 8l-6.8 4.7z" fill="currentColor" stroke="none" />
          </svg>
        }
        @case ('fix') {
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.4v7.4" />
            <path d="M5.1 7.2 8 10.1l2.9-2.9" />
            <path d="M2.8 12.6h10.4" />
          </svg>
        }
        @default {
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11.1 2.9 13.1 4.9 6 12 3.5 12.7l.7-2.5z" />
            <path d="M9.8 4.2 11.8 6.2" />
          </svg>
        }
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: contents;
    }

    .acard-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: var(--card-action-height, 28px);
      padding: 0 var(--card-action-padding, 12px);
      border: 0;
      border-radius: var(--ui-radius-pill);
      background: var(--card-scrim-action-bg, var(--ui-primary));
      color: var(--card-scrim-action-ink, var(--ui-on-primary));
      font-family: var(--ui-font-body);
      font-size: 11px;
      font-weight: var(--ui-weight-semibold);
      white-space: nowrap;
      cursor: pointer;
      text-decoration: none;
    }

    .acard-primary:hover {
      filter: brightness(1.06);
    }

    .acard-primary:disabled {
      opacity: 0.5;
      cursor: default;
      filter: none;
    }

    .acard-primary:focus-visible {
      outline: 2px solid var(--ui-ring);
      outline-offset: 2px;
    }

    .acard-primary.ghost {
      border: 1px solid var(--ui-inner-border);
      background: var(--ui-card-solid);
      color: var(--ui-text-2);
    }

    .acard-primary.ghost:hover {
      border-color: var(--ui-inner-border);
      color: var(--ui-text);
    }

    svg {
      width: 13px;
      height: 13px;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class CardActionComponent {
  readonly label = input('');
  readonly icon = input<'' | CardActionIcon>('');
  readonly href = input('');
  readonly variant = input<'solid' | 'ghost'>('solid');
  readonly disabled = input(false);
  readonly title = input('');
  readonly testId = input('');
  readonly pressed = output<void>();
}
