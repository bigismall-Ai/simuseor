import { Component, ElementRef, input, viewChild } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'md' | 'sm' | 'xs' | 'icon';

/**
 * VIS 按钮：语义仍是主 / 次 / 弱 / 危险，但表面从纯色改为「玻璃 + 轻投影」。
 *
 * 浅色与深色共用同一套结构：1px 描边、内高光、轻投影、胶囊圆角；
 * 只换 token，不换几何。
 */
@Component({
  selector: 'ui-button',
  host: {
    '[class.block]': 'block()',
  },
  template: `
    <button
      #btn
      class="btn"
      [class.primary]="variant() === 'primary'"
      [class.secondary]="variant() === 'secondary'"
      [class.ghost]="variant() === 'ghost'"
      [class.danger]="variant() === 'danger'"
      [class.danger-ghost]="variant() === 'danger-ghost'"
      [class.sm]="size() === 'sm'"
      [class.xs]="size() === 'xs'"
      [class.icon]="size() === 'icon'"
      [type]="type()"
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

    .btn {
      --btn-bg: transparent;
      --btn-bg-hover: transparent;
      --btn-ink: var(--ui-text);
      --btn-border: transparent;
      --btn-border-hover: transparent;
      --btn-shadow: none;

      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      height: 38px;
      padding: 0 18px;
      border: 1px solid var(--btn-border);
      border-radius: var(--ui-radius-pill);
      background: var(--btn-bg);
      color: var(--btn-ink);
      box-shadow: var(--btn-shadow);
      font-family: var(--ui-font-body);
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      backdrop-filter: blur(12px) saturate(1.04);
      transition:
        background 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease,
        color 0.18s ease;
    }

    .btn:hover {
      background: var(--btn-bg-hover);
      border-color: var(--btn-border-hover);
      box-shadow: var(--button-shadow-hover);
    }

    .btn:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .btn:disabled {
      opacity: 0.42;
      box-shadow: none;
      cursor: not-allowed;
    }

    .btn:disabled:hover {
      background: var(--btn-bg);
      border-color: var(--btn-border);
    }

    :host(.block) .btn {
      width: 100%;
    }

    .sm {
      height: 30px;
      padding: 0 12px;
      font-size: 11.5px;
    }

    .xs {
      gap: 5px;
      height: 25px;
      padding: 0 10px;
      font-size: 11px;
    }

    .icon {
      width: 36px;
      height: 36px;
      padding: 0;
    }

    /* ---- 主操作：深色实心 + 顶高光 ---- */
    .primary {
      --btn-bg: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ui-primary) 88%, white) 0%,
        var(--ui-primary) 100%
      );
      --btn-bg-hover: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ui-primary) 84%, white) 0%,
        color-mix(in srgb, var(--ui-primary) 92%, black) 100%
      );
      --btn-ink: var(--ui-on-primary);
      --btn-border: color-mix(in srgb, var(--ui-primary) 72%, white);
      --btn-border-hover: color-mix(in srgb, var(--ui-primary) 60%, white);
      --btn-shadow:
        0 1px 0 rgb(255 255 255 / 0.22) inset,
        var(--button-shadow);
    }

    /* ---- 次操作：玻璃面 + 描边 ---- */
    .secondary {
      --btn-bg: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ui-surface) 94%, transparent),
        color-mix(in srgb, var(--ui-surface) 76%, transparent)
      );
      --btn-bg-hover: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ui-raised) 96%, transparent),
        color-mix(in srgb, var(--ui-raised) 84%, transparent)
      );
      --btn-ink: var(--ui-text);
      --btn-border: var(--ui-border);
      --btn-border-hover: var(--ui-border-2);
      --btn-shadow: var(--button-shadow);
    }

    /* 深色下玻璃面需要更明显的面层与顶高光，否则只剩一条描边 */
    :host-context([data-theme='dark']) .secondary {
      --btn-bg:
        linear-gradient(180deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.03)),
        color-mix(in srgb, var(--ui-raised) 88%, transparent);
      --btn-bg-hover:
        linear-gradient(180deg, rgb(255 255 255 / 0.18), rgb(255 255 255 / 0.06)),
        color-mix(in srgb, var(--ui-raised) 96%, transparent);
      --btn-border: rgb(255 255 255 / 0.24);
      --btn-border-hover: rgb(255 255 255 / 0.36);
      --btn-shadow:
        0 1px 0 rgb(255 255 255 / 0.2) inset,
        0 8px 20px -10px rgb(0 0 0 / 0.9);
    }

    /* ---- 弱操作：无底，悬浮才出现玻璃面 ---- */
    .ghost {
      --btn-bg: transparent;
      --btn-bg-hover: color-mix(in srgb, var(--ui-raised) 78%, transparent);
      --btn-ink: var(--ui-muted);
      --btn-border: transparent;
      --btn-border-hover: var(--ui-border-2);
      --btn-shadow: none;
    }

    .ghost:hover {
      color: var(--ui-text);
    }

    :host-context([data-theme='dark']) .ghost {
      --btn-bg-hover: color-mix(in srgb, var(--ui-raised) 82%, transparent);
    }

    /* ---- 危险：赭石实心 ---- */
    .danger {
      --btn-bg: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ink-accent) 84%, white) 0%,
        var(--ink-accent) 100%
      );
      --btn-bg-hover: linear-gradient(
        180deg,
        color-mix(in srgb, var(--ink-accent) 90%, white) 0%,
        color-mix(in srgb, var(--ink-accent) 90%, black) 100%
      );
      --btn-ink: var(--ui-on-primary);
      --btn-border: color-mix(in srgb, var(--ink-accent) 76%, white);
      --btn-border-hover: color-mix(in srgb, var(--ink-accent) 64%, white);
      --btn-shadow:
        0 1px 0 rgb(255 255 255 / 0.18) inset,
        var(--button-shadow);
    }

    /* ---- 危险弱操作：无底，文字赭石 ---- */
    .danger-ghost {
      --btn-bg: transparent;
      --btn-bg-hover: color-mix(in srgb, var(--ui-error) 10%, transparent);
      --btn-ink: var(--ui-error);
      --btn-border: transparent;
      --btn-border-hover: color-mix(in srgb, var(--ui-error) 24%, transparent);
      --btn-shadow: none;
    }
  `,
})
export class UiButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false);
  readonly block = input(false);
  readonly label = input('');

  private readonly inner = viewChild<ElementRef<HTMLButtonElement>>('btn');

  /** 供父组件把焦点移到内部真实按钮（宿主本身不可聚焦）。 */
  focus(): void {
    this.inner()?.nativeElement.focus();
  }
}
