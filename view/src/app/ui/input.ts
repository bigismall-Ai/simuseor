import { Component, input, model } from '@angular/core';

/**
 * 文本输入：标签、控件、说明/错误三件套。
 *
 * 标签包住控件（隐式关联），不需要调用方再补 id。
 * 两侧可投影 `[input-leading]` / `[input-trailing]` 放图标或单位。
 */
@Component({
  selector: 'ui-input',
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
        <span class="lead"><ng-content select="[input-leading]" /></span>
        <input
          [type]="type()"
          [value]="value()"
          [attr.placeholder]="placeholder() || null"
          [attr.inputmode]="inputmode() || null"
          [attr.autocomplete]="autocomplete() || null"
          [disabled]="disabled()"
          [class.mono]="mono()"
          [attr.aria-label]="ariaLabel() || null"
          (input)="onInput($event)"
        />
        <span class="trail"><ng-content select="[input-trailing]" /></span>
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

    .sm .control {
      height: 30px;
      padding: 0 9px;
    }

    .lbl {
      display: block;
      margin-bottom: 6px;
      color: var(--ui-muted);
      font-size: 11.5px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .control {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius);
      background: var(--ui-inset);
      transition:
        border-color 0.16s ease,
        box-shadow 0.16s ease;
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

    input {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      font-size: 12.5px;
      outline: none;
    }

    input.mono {
      font-family: var(--ui-font-mono);
    }

    input::placeholder {
      color: var(--ui-muted);
      opacity: 0.75;
    }

    input:disabled {
      color: var(--ui-muted);
      cursor: not-allowed;
    }

    .lead,
    .trail {
      display: contents;
      color: var(--ui-muted);
    }

    /* 投影进来的前后缀属于父组件作用域，必须用 ::ng-deep 才能定尺寸 */
    :host ::ng-deep .lead :is(svg, img),
    :host ::ng-deep .trail :is(svg, img) {
      flex: none;
      width: 15px;
      height: 15px;
      color: var(--ui-muted);
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
    }

    :host ::ng-deep .lead > span,
    :host ::ng-deep .trail > span {
      color: var(--ui-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .msg {
      display: block;
      margin-top: 5px;
      color: var(--ui-muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .msg.error {
      color: var(--err);
    }
  `,
})
export class InputComponent {
  readonly label = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly placeholder = input('');
  readonly type = input('text');
  readonly inputmode = input('');
  readonly autocomplete = input('');
  readonly disabled = input(false);
  readonly mono = input(false);
  readonly size = input<'md' | 'sm'>('md');
  /** 没有可见标签时（搜索框等）用它给控件一个可访问名。 */
  readonly ariaLabel = input('');
  readonly value = model('');

  onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
