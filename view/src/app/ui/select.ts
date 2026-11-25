import { Component, input, model } from '@angular/core';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * 下拉选择：原生 `<select>` 承载体，视觉只换皮。
 *
 * 选项少（≤5）且要并排比较时用 `ui-segmented`；这里是需要收纳更多项、
 * 且要保留浏览器原生键盘与移动端选择器的场景。
 * 左侧可投影 `[select-leading]` 放图标，控件本身不再包 Material。
 */
@Component({
  selector: 'ui-select',
  template: `
    <label
      class="wrap"
      [class.invalid]="!!error()"
      [class.disabled]="disabled()"
      [class.sm]="size() === 'sm'"
    >
      @if (label()) {
        <span class="lbl">{{ label() }}</span>
      }
      <span class="control">
        <span class="lead"><ng-content select="[select-leading]" /></span>
        <select
          [class.is-placeholder]="!value() && !!placeholder()"
          [disabled]="disabled()"
          [attr.aria-label]="ariaLabel() || null"
          (change)="onChange($event)"
        >
          @if (placeholder()) {
            <option value="" disabled [selected]="value() === ''">{{ placeholder() }}</option>
          }
          @for (option of options(); track option.value) {
            <option
              [value]="option.value"
              [disabled]="option.disabled === true"
              [selected]="option.value === value()"
            >
              {{ option.label }}
            </option>
          }
        </select>
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6.2 8 10.2 12 6.2" />
        </svg>
      </span>
      @if (error()) {
        <span class="msg error" role="alert">{{ error() }}</span>
      } @else if (hint()) {
        <span class="msg">{{ hint() }}</span>
      }
    </label>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .wrap {
      display: block;
      min-width: 0;
    }

    .lbl {
      display: block;
      margin-bottom: var(--ui-field-label-gap);
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-medium);
      letter-spacing: 0.01em;
    }

    .control {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      height: var(--ui-h-md);
      padding: 0 var(--ui-space-2);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius);
      background: var(--ui-inset);
      transition:
        border-color 0.16s ease,
        box-shadow 0.16s ease;
    }

    .sm .control {
      height: var(--ui-h-sm);
    }

    .control:focus-within {
      border-color: var(--ui-primary);
      box-shadow: var(--ui-ring);
    }

    .invalid .control {
      border-color: var(--err);
    }

    .invalid .control:focus-within {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--err) 24%, transparent);
    }

    select {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      cursor: pointer;
      appearance: none;
      outline: none;
    }

    /* 空值时显示占位项，用弱化色提示「还没选」 */
    select.is-placeholder {
      color: var(--ui-muted);
    }

    /* 原生 option 面板用系统色，只保证深色主题下文字可读 */
    select option {
      background: var(--ui-overlay);
      color: var(--ui-text);
    }

    select:disabled {
      color: var(--ui-muted);
      cursor: not-allowed;
    }

    .lead {
      display: contents;
      color: var(--ui-muted);
    }

    /* 投影进来的前缀属于父组件作用域，必须用 ::ng-deep 才能定尺寸 */
    :host ::ng-deep .lead :is(svg, img) {
      flex: none;
      width: var(--icon-inline);
      height: var(--icon-inline);
      color: var(--ui-muted);
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
    }

    .chevron {
      flex: none;
      width: var(--icon-inline);
      height: var(--icon-inline);
      color: var(--ui-muted);
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      pointer-events: none;
    }

    .msg {
      display: block;
      margin-top: var(--ui-msg-gap);
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      line-height: 1.5;
    }

    .msg.error {
      color: var(--err);
    }

    .disabled .control {
      opacity: 0.6;
    }
  `,
})
export class SelectComponent {
  readonly options = input.required<SelectOption[]>();
  readonly value = model('');
  /** 空值时的占位项；它是 disabled 的空 option，不会成为合法取值。 */
  readonly placeholder = input('');
  readonly label = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly disabled = input(false);
  readonly size = input<'md' | 'sm'>('md');
  /** 没有可见标签时（筛选条等）用它给控件一个可访问名。 */
  readonly ariaLabel = input('');

  onChange(event: Event): void {
    this.value.set((event.target as HTMLSelectElement).value);
  }
}
