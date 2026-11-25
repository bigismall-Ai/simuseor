import { Component, ElementRef, computed, input, model, viewChild } from '@angular/core';

let seq = 0;

/**
 * 多行文本：与 `ui-input` 同一套标签 / 说明 / 错误结构，只是控件换成 textarea。
 *
 * 备注、提示词、出错原因这类需要两三行的内容用它；单行仍用 `ui-input`。
 * 不自动增高：高度由 `rows` 决定，超出后内部滚动，避免长文本把页面顶开。
 */
@Component({
  selector: 'ui-textarea',
  template: `
    <label
      class="wrap"
      [class.invalid]="!!error()"
      [class.disabled]="disabled()"
    >
      @if (label()) {
        <span class="lbl">{{ label() }}</span>
      }
      <textarea
        #field
        [value]="value()"
        [rows]="rows()"
        [attr.name]="name() || null"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-label]="ariaLabel() || null"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="hasMessage() ? messageId : null"
        [disabled]="disabled()"
        [required]="required()"
        [readOnly]="readOnly()"
        (input)="onInput($event)"
      ></textarea>
      @if (error()) {
        <span class="msg error" [id]="messageId" role="alert">{{ error() }}</span>
      } @else if (hint()) {
        <span class="msg" [id]="messageId">{{ hint() }}</span>
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

    textarea {
      display: block;
      width: 100%;
      min-width: 0;
      padding: var(--ui-space-2) var(--ui-space-3);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-lg);
      background: var(--ui-inset);
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      line-height: 1.6;
      resize: vertical;
      transition:
        border-color 0.16s ease,
        box-shadow 0.16s ease;
    }

    textarea::placeholder {
      color: var(--ui-muted);
      opacity: 0.75;
    }

    textarea:focus-visible {
      border-color: var(--ui-primary);
      box-shadow: var(--ui-ring);
      outline: none;
    }

    .invalid textarea {
      border-color: var(--err);
    }

    .invalid textarea:focus-visible {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--err) 24%, transparent);
    }

    textarea:disabled {
      color: var(--ui-muted);
      cursor: not-allowed;
      opacity: 0.6;
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
  `,
})
export class TextareaComponent {
  readonly value = model('');
  readonly rows = input(3);
  readonly placeholder = input('');
  readonly label = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly disabled = input(false);
  /** 没有可见标签时用它给控件一个可访问名。 */
  readonly ariaLabel = input('');
  readonly name = input('');
  readonly required = input(false);
  readonly readOnly = input(false);

  readonly messageId = `textarea-msg-${++seq}`;
  readonly hasMessage = computed(() => !!this.error() || !!this.hint());

  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');

  /** 供父组件（弹层）把焦点送进真实文本域。 */
  focus(): void {
    this.field()?.nativeElement.focus();
  }

  onInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
  }
}
