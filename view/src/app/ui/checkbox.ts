import { Component, input, model } from '@angular/core';

/**
 * 勾选：18px 方框 + 原生 checkbox（语义、键盘、表单行为都交给浏览器）。
 *
 * 文案靠投影，不在这里写第二个 label；整组全选时用 `indeterminate` 表达「部分选中」。
 * 需要立即生效的开关改用 `ui-switch`。
 */
@Component({
  selector: 'ui-checkbox',
  template: `
    <label class="wrap" [class.disabled]="disabled()">
      <input
        class="native"
        type="checkbox"
        [checked]="checked()"
        [indeterminate]="indeterminate()"
        [disabled]="disabled()"
        [attr.aria-label]="ariaLabel() || null"
        (change)="onChange($event)"
      />
      <span class="box" [class.on]="checked() || indeterminate()" aria-hidden="true">
        @if (indeterminate()) {
          <span class="line"></span>
        } @else if (checked()) {
          <svg class="tick" viewBox="0 0 16 16">
            <path d="M3.4 8.3 6.6 11.4 12.6 4.7" />
          </svg>
        }
      </span>
      <span class="lbl"><ng-content /></span>
    </label>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      cursor: pointer;
    }

    /* 原生 checkbox 只保留语义与焦点，方框与对勾全部由 .box 承担 */
    .native {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      opacity: 0;
      overflow: hidden;
      white-space: nowrap;
      clip-path: inset(50%);
    }

    .box {
      position: relative;
      flex: none;
      display: grid;
      place-items: center;
      width: var(--ui-checkbox-size);
      height: var(--ui-checkbox-size);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-xs);
      background: var(--ui-panel-3);
      transition:
        background 0.16s ease,
        border-color 0.16s ease;
    }

    .box.on {
      border-color: var(--ui-primary);
      background: var(--ui-primary);
    }

    .tick {
      width: var(--ui-checkbox-mark);
      height: var(--ui-checkbox-mark);
      fill: none;
      stroke: var(--ui-on-primary);
      stroke-width: 2;
    }

    .line {
      width: calc(var(--ui-checkbox-size) / 2);
      height: var(--ui-checkbox-line);
      border-radius: var(--ui-radius-xs);
      background: var(--ui-on-primary);
    }

    .native:focus-visible + .box {
      box-shadow: var(--ui-ring);
    }

    .lbl {
      display: inline-flex;
      align-items: center;
      color: var(--ui-text);
      font-size: var(--ui-text-md);
      line-height: 1.4;
    }

    /* 没有投影文案时（标签由外层 ui-field 提供）不占位 */
    .lbl:empty {
      display: none;
    }

    .disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .disabled .box {
      cursor: not-allowed;
    }
  `,
})
export class CheckboxComponent {
  readonly checked = model(false);
  /** 部分选中：方框显示横杠；用户点一下就清掉。 */
  readonly indeterminate = model(false);
  readonly disabled = input(false);
  /** 没有投影文案时用它给勾选一个可访问名。 */
  readonly ariaLabel = input('');

  onChange(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
    this.indeterminate.set(false);
  }
}
