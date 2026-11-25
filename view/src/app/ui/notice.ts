import { Component, ElementRef, HostListener, computed, inject, input, output } from '@angular/core';

export type NoticeTone = 'info' | 'ok' | 'warn' | 'error';
export type NoticeVariant = 'inline' | 'callout';

const TONE_GLYPH: Record<NoticeTone, string> = { info: 'i', ok: '✓', warn: '!', error: '!' };

/**
 * 行内提示 / Callout：影响一块区域，页面仍可继续用时用它。
 *
 * 两种外壳，共用同一套语气与内容投影：
 *   - `variant="inline"`（默认）：紧凑横条，16 内边距、18 图标、不承载长内容；
 *   - `variant="callout"`：区块级说明，12 圆角 / 12 内边距 / 8 间距 / 26×26 图标井，
 *     可以放标题、嵌套列表、code 胶囊与动作；几何走 `--ui-callout-*`。
 *
 * 图标：`icon` 仍是单字符；callout 未给 icon 时按语气取默认（i / ✓ / !）。
 * 需要 SVG 或 `mat-icon` 时投影 `<span notice-icon>`，井会按 18px 约束图标。
 * 动作：`[notice-actions]`（旧写法）与 `[notice-action]`（新写法）都投影到同一行。
 *
 * 与 `ui-toast` 的分工：
 *   - 行内提示属于页面流，位置由内容决定，不自动消失；
 *   - Toast 是悬浮的临时反馈，位置由页面容器决定，自动收起。
 *
 * 关闭按钮会把焦点还给最近一次来自提示外部的焦点元素，
 * 页面不需要自己记录 activeElement。需要用户做决定的事不要用提示条，用 `ui-dialog`。
 */
@Component({
  selector: 'ui-notice',
  template: `
    <div
      class="notice"
      [attr.data-tone]="tone()"
      [attr.data-variant]="variant()"
      [attr.role]="tone() === 'error' ? 'alert' : 'status'"
    >
      <span class="ico" aria-hidden="true">
        <span class="ico-p"><ng-content select="[notice-icon]" /></span>
        @if (glyph()) {
          <span class="glyph">{{ glyph() }}</span>
        }
      </span>
      <div class="body">
        @if (title()) {
          <b class="title">{{ title() }}</b>
        }
        <div class="text"><ng-content /></div>
        <div class="acts">
          <ng-content select="[notice-actions]" />
          <ng-content select="[notice-action]" />
        </div>
      </div>
      @if (dismissible()) {
        <button class="x" type="button" aria-label="关闭" (click)="onDismiss()">×</button>
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
      /* 链接与强调用语气色压深，保证在提示底色和 code 胶囊上都能读（AA） */
      --tone-ink: color-mix(in srgb, var(--tone) 50%, var(--ui-text));
      --tone-strong: color-mix(in srgb, var(--tone) 36%, var(--ui-text));
      /* code 胶囊比提示底更深，链接在这里要再收一点语气色 */
      --tone-code-ink: color-mix(in srgb, var(--tone) 30%, var(--ui-text));

      display: flex;
      align-items: flex-start;
      gap: var(--ui-notice-gap);
      padding: var(--ui-notice-pad);
      border: 1px solid color-mix(in srgb, var(--tone) 26%, var(--ui-border));
      border-left: 3px solid var(--tone);
      border-radius: var(--ui-notice-radius);
      background: var(--tone-soft);
      color: var(--ui-text-2);
      font-size: var(--ui-text-md);
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

    /* ---- Callout：实底语气面 + 图标井，深色下加厚语气占比 ---- */
    .notice[data-variant='callout'] {
      gap: var(--ui-callout-gap);
      padding: var(--ui-callout-pad);
      border-color: color-mix(in srgb, var(--tone) 24%, var(--ui-border));
      border-left-width: 1px;
      border-left-color: color-mix(in srgb, var(--tone) 24%, var(--ui-border));
      border-radius: var(--ui-callout-radius);
      background: color-mix(in srgb, var(--tone) 10%, var(--ui-overlay));
    }

    :host-context([data-theme='dark']) .notice[data-variant='callout'] {
      background: color-mix(in srgb, var(--tone) 16%, var(--ui-overlay));
      border-color: color-mix(in srgb, var(--tone) 32%, var(--ui-border));
      border-left-color: color-mix(in srgb, var(--tone) 32%, var(--ui-border));
    }

    .ico {
      flex: none;
      display: grid;
      place-items: center;
      width: var(--ui-notice-icon);
      height: var(--ui-notice-icon);
      border-radius: 50%;
      background: color-mix(in srgb, var(--tone) 18%, transparent);
      color: var(--tone);
      font-size: var(--ui-text-sm);
      font-weight: 700;
      line-height: 1;
    }

    /* 既没有字符图标、也没有投影图标时不占位 */
    .ico:not(:has(.glyph)):not(:has(.ico-p > *)) {
      display: none;
    }

    /* 投影了 SVG / mat-icon 时隐藏单字符默认图标 */
    .ico:has(.ico-p > *) .glyph {
      display: none;
    }

    .ico-p {
      display: contents;
    }

    .ico-p:not(:has(*)) {
      display: none;
    }

    .notice[data-variant='callout'] .ico {
      display: grid;
      width: var(--ui-callout-well);
      height: var(--ui-callout-well);
      border-radius: var(--ui-callout-well-radius);
      color: var(--tone-ink);
    }

    .notice[data-variant='callout'] .glyph {
      font-size: var(--ui-text-lg);
    }

    .ico ::ng-deep :is(svg, mat-icon) {
      width: var(--ui-callout-icon);
      height: var(--ui-callout-icon);
      font-size: var(--ui-callout-icon);
    }

    .body {
      flex: 1;
      min-width: 0;
    }

    .title {
      display: block;
      color: var(--ui-text);
      font-size: var(--ui-text-md);
      font-weight: 600;
    }

    .text {
      min-width: 0;
    }

    .text ::ng-deep :is(p, ul, ol) {
      margin: var(--ui-space-1) 0 0;
      color: var(--ui-muted);
      line-height: 1.6;
    }

    .text ::ng-deep :is(ul, ol) {
      padding-left: var(--ui-space-4);
    }

    /* 以下排版只作用于 callout；inline 保持原样，避免既有页面视觉漂移 */
    .notice[data-variant='callout'] .text ::ng-deep :is(ul, ol) {
      padding-left: var(--ui-callout-indent);
    }

    .notice[data-variant='callout'] .text ::ng-deep :is(strong, b) {
      color: var(--tone-strong);
      font-weight: 600;
    }

    .notice[data-variant='callout'] .text ::ng-deep a {
      color: var(--tone-ink);
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--tone-ink) 55%, transparent);
      text-underline-offset: 2px;
    }

    .notice[data-variant='callout'] .text ::ng-deep a:hover {
      color: var(--ui-text);
    }

    .notice[data-variant='callout'] .text ::ng-deep a:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
      border-radius: var(--ui-radius-xs);
    }

    /* code 胶囊：底色压住语气底，link 在其上仍满足 AA */
    .notice[data-variant='callout'] .text ::ng-deep code {
      padding: 0 var(--ui-space-1);
      border-radius: var(--ui-radius-xs);
      background: color-mix(in srgb, var(--ui-text) 10%, transparent);
      color: var(--ui-text);
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-sm);
      line-height: 1.4;
    }

    .notice[data-variant='callout'] .text ::ng-deep code a {
      color: var(--tone-code-ink);
    }

    .acts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ui-space-1);
      margin-top: var(--ui-space-2);
    }

    .notice[data-variant='callout'] .acts {
      gap: var(--ui-space-2);
      margin-top: var(--ui-space-3);
    }

    .acts:not(:has(*)) {
      display: none;
    }

    /* 投影进来的 [notice-actions] / [notice-action] 包装层不参与布局 */
    :host ::ng-deep .notice[data-variant='callout'] .acts > * {
      display: contents;
    }

    .x {
      flex: none;
      padding: 0 var(--ui-space-1);
      border: 0;
      background: none;
      color: var(--ui-muted);
      font-size: var(--ui-text-lg);
      line-height: 1;
      cursor: pointer;
    }

    .x:hover {
      color: var(--ui-text);
    }

    .notice[data-variant='callout'] .x {
      display: grid;
      place-items: center;
      width: var(--ui-callout-well);
      height: var(--ui-callout-well);
      padding: 0;
      border-radius: var(--ui-radius-xs);
      color: var(--tone-ink);
    }
  `,
})
export class NoticeComponent {
  readonly tone = input<NoticeTone>('info');
  readonly variant = input<NoticeVariant>('inline');
  readonly title = input('');
  /** 单字符图标（! / ✓ / i）。装饰性，不进可访问名；callout 未给时按语气取默认。 */
  readonly icon = input('');
  readonly dismissible = input(false);
  readonly dismiss = output<void>();

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  /** 关闭后要还回去的焦点元素；只记提示外部的元素。 */
  private lastExternalFocus: HTMLElement | null = null;

  readonly glyph = computed(
    () => this.icon() || (this.variant() === 'callout' ? TONE_GLYPH[this.tone()] : ''),
  );

  @HostListener('focusin', ['$event'])
  onFocusIn(event: FocusEvent): void {
    const previous = event.relatedTarget;
    if (!(previous instanceof HTMLElement)) return;
    if (previous === document.body) return;
    if (this.host.nativeElement.contains(previous)) return;
    this.lastExternalFocus = previous;
  }

  /** 鼠标点进提示（包括关闭按钮）时，指针按下早于焦点转移，先记住外部焦点。 */
  @HostListener('pointerdown')
  onPointerDown(): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body) return;
    if (this.host.nativeElement.contains(active)) return;
    this.lastExternalFocus = active;
  }

  onDismiss(): void {
    const target = this.lastExternalFocus;
    this.dismiss.emit();
    if (!target) return;
    // 只在焦点确实在提示上（或已落回 body）时归还，避免抢走别处的焦点
    const active = document.activeElement;
    const insideNotice =
      active === document.body || this.host.nativeElement.contains(active);
    if (!insideNotice) return;
    // 等父级完成移除 / 重排后再归还焦点，元素可能已被销毁
    setTimeout(() => {
      if (target.isConnected) target.focus();
    });
  }
}
