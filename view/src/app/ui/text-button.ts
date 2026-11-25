import { Component, input } from '@angular/core';

export type TextButtonVariant = 'plain' | 'underline' | 'danger';
export type TextButtonSize = 'md' | 'sm' | 'xs';

/**
 * 行内文字动作：链接、「查看全部」、「详情」、「编辑」这类不占按钮表面的动作。
 *
 * 与 `ui-button` 分工：需要描边 / 胶囊表面时用 `ui-button`，只是文字本身可点时用这里。
 * 无内边距、无边框、无底色；悬停只换下划线或颜色，焦点框走 `--ui-primary`。
 */
@Component({
  selector: 'ui-text-button',
  host: {
    '[class.block]': 'block()',
  },
  template: `
    <button
      class="text-btn"
      [class.plain]="variant() === 'plain'"
      [class.underline]="variant() === 'underline'"
      [class.danger]="variant() === 'danger'"
      [class.sm]="size() === 'sm'"
      [class.xs]="size() === 'xs'"
      type="button"
      [disabled]="disabled()"
      [attr.aria-label]="label() || null"
    >
      <ng-content />
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    :host(.block) {
      display: flex;
      width: 100%;
    }

    .text-btn {
      --text-btn-ink: var(--ui-muted);
      --text-btn-ink-hover: var(--ui-text);
      --text-btn-underline: none;

      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: var(--ui-space-1);
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-btn-ink);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-medium);
      line-height: var(--ui-leading-tight);
      text-align: left;
      text-decoration: var(--text-btn-underline);
      text-underline-offset: 0.16em;
      white-space: nowrap;
      cursor: pointer;
      transition: color var(--ui-duration-fast) var(--ui-ease);
    }

    .text-btn:not(:disabled):hover {
      color: var(--text-btn-ink-hover);
      text-decoration: var(--text-btn-underline-hover, underline);
    }

    .text-btn:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .text-btn:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }

    :host(.block) .text-btn {
      width: 100%;
    }

    .sm {
      font-size: var(--ui-text-sm);
    }

    .xs {
      font-size: var(--ui-text-xs);
    }

    /* 链接式动作：强调色，悬停才出现下划线 */
    .plain {
      --text-btn-ink: var(--ui-accent);
      --text-btn-ink-hover: var(--ui-accent);
    }

    /* 常驻下划线：偏中性，悬停加深并保留下划线 */
    .underline {
      --text-btn-ink: var(--ui-muted);
      --text-btn-ink-hover: var(--ui-text);
      --text-btn-underline: underline;
      --text-btn-underline-hover: underline;
    }

    /* 危险文字动作：赭石，悬停加下划线，不改语义色 */
    .danger {
      --text-btn-ink: var(--ui-error);
      --text-btn-ink-hover: var(--ui-error);
      font-weight: var(--ui-weight-semibold);
    }

    @media (prefers-reduced-motion: reduce) {
      .text-btn {
        transition: none;
      }
    }
  `,
})
export class TextButtonComponent {
  readonly variant = input<TextButtonVariant>('plain');
  readonly size = input<TextButtonSize>('md');
  readonly disabled = input(false);
  readonly block = input(false);
  /** 仅图标内容时给可访问名；有可见文本时留空。 */
  readonly label = input('');
}
