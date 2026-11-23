import { Component, input, output } from '@angular/core';

export type ToastTone = 'neutral' | 'ok' | 'error';

/**
 * Toast 表面：不负责定位。
 *
 * 位置由页面容器决定（右下角栈 / 底部居中 dock），这里只管面层、语义色和关闭。
 * tone=error 时用 role=alert，其余用 role=status。
 */
@Component({
  selector: 'ui-toast',
  template: `
    <div
      class="toast"
      [class.ok]="tone() === 'ok'"
      [class.error]="tone() === 'error'"
      [attr.role]="tone() === 'error' ? 'alert' : 'status'"
    >
      @if (tone() !== 'neutral') {
        <span class="ico" aria-hidden="true">{{ tone() === 'error' ? '!' : '✓' }}</span>
      }
      <div class="body">
        @if (title()) {
          <b>{{ title() }}</b>
        }
        <p><ng-content /></p>
      </div>
      @if (dismissible()) {
        <button class="x" type="button" aria-label="关闭" (click)="dismiss.emit()">×</button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 12px;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius);
      background: color-mix(in srgb, var(--ui-overlay) 94%, transparent);
      box-shadow: var(--ui-shadow-md);
      backdrop-filter: blur(14px);
      color: var(--ui-text-2);
      font-size: 12px;
      text-align: left;
    }

    .toast.error {
      border-color: color-mix(in srgb, var(--err) 32%, var(--ui-border));
    }

    :host-context([data-theme='dark']) .toast {
      background:
        linear-gradient(180deg, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.03)),
        color-mix(in srgb, var(--ui-raised) 88%, transparent);
      border-color: rgb(255 255 255 / 0.18);
      box-shadow:
        0 1px 0 rgb(255 255 255 / 0.16) inset,
        0 12px 28px -16px rgb(0 0 0 / 0.95);
    }

    :host-context([data-theme='dark']) .toast.error {
      border-color: color-mix(in srgb, var(--err) 45%, rgb(255 255 255 / 0.18));
    }

    .ico {
      flex: none;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--err-soft);
      color: var(--err);
      font-size: 11px;
      font-weight: 700;
    }

    .toast.ok .ico {
      background: var(--ok-soft);
      color: var(--ok);
    }

    .body {
      flex: 1;
      min-width: 0;
    }

    b {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--ui-text);
    }

    p {
      margin: 2px 0 0;
      color: var(--ui-text-2);
      font-size: 11.5px;
      line-height: 1.5;
    }

    .body > p:first-child {
      margin-top: 0;
    }

    .x {
      flex: none;
      padding: 0 2px;
      border: 0;
      background: none;
      color: var(--faint);
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
    }

    .x:hover {
      color: var(--ui-text);
    }
  `,
})
export class ToastComponent {
  readonly tone = input<ToastTone>('neutral');
  readonly title = input('');
  readonly dismissible = input(false);
  readonly dismiss = output<void>();
}
