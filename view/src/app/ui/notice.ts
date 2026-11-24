import { Component, input, output } from '@angular/core';

export type NoticeTone = 'info' | 'ok' | 'warn' | 'error';

/**
 * 行内提示：影响一块区域、页面仍可继续用时用它。
 *
 * 与 `ui-toast` 的分工：
 *   - 行内提示属于页面流，位置由内容决定，不自动消失；
 *   - Toast 是悬浮的临时反馈，位置由页面容器决定，自动收起。
 *
 * 需要用户做决定的事不要用提示条，用 `ui-dialog`。
 */
@Component({
  selector: 'ui-notice',
  template: `
    <div
      class="notice"
      [attr.data-tone]="tone()"
      [attr.role]="tone() === 'error' ? 'alert' : 'status'"
    >
      @if (icon()) {
        <span class="ico" aria-hidden="true">{{ icon() }}</span>
      }
      <div class="body">
        @if (title()) {
          <b>{{ title() }}</b>
        }
        <div class="text"><ng-content /></div>
        <div class="acts"><ng-content select="[notice-actions]" /></div>
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

    .notice {
      --tone: var(--ui-accent);
      --tone-soft: color-mix(in srgb, var(--ui-accent) 12%, transparent);

      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 12px;
      border: 1px solid color-mix(in srgb, var(--tone) 26%, var(--ui-border));
      border-left: 3px solid var(--tone);
      border-radius: var(--ui-radius);
      background: var(--tone-soft);
      color: var(--ui-text-2);
      font-size: 12px;
    }

    .notice[data-tone='ok'] {
      --tone: var(--ok);
      --tone-soft: var(--ok-soft);
    }

    .notice[data-tone='warn'] {
      --tone: var(--warn);
      --tone-soft: var(--warn-soft);
    }

    .notice[data-tone='error'] {
      --tone: var(--err);
      --tone-soft: var(--err-soft);
    }

    .ico {
      flex: none;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--tone) 18%, transparent);
      color: var(--tone);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
    }

    .body {
      flex: 1;
      min-width: 0;
    }

    b {
      display: block;
      color: var(--ui-text);
      font-size: 12.5px;
      font-weight: 600;
    }

    .text {
      min-width: 0;
    }

    .text :is(p, ul, ol) {
      margin: 2px 0 0;
      color: var(--ui-muted);
      line-height: 1.6;
    }

    .text :is(ul, ol) {
      padding-left: 16px;
    }

    .acts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .acts:not(:has(*)) {
      display: none;
    }

    .x {
      flex: none;
      padding: 0 2px;
      border: 0;
      background: none;
      color: var(--ui-muted);
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
    }

    .x:hover {
      color: var(--ui-text);
    }
  `,
})
export class NoticeComponent {
  readonly tone = input<NoticeTone>('info');
  readonly title = input('');
  /** 单字符图标（! / ✓ / i）。装饰性，不进可访问名。 */
  readonly icon = input('');
  readonly dismissible = input(false);
  readonly dismiss = output<void>();
}
