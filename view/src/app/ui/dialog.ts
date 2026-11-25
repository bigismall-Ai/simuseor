import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';

let seq = 0;

/**
 * 弹层：遮罩 + 440px 表面 + 动作行。
 *
 * 负责 Esc / 点遮罩关闭、打开时把焦点送进弹层、关闭时还给触发元素、锁滚动。
 * 生产环境需要完整焦点圈闭时仍走 MatDialog；原型与轻量确认场景用这个，
 * 两边的表面样式共用 `--ui-panel` / `--ui-radius-lg` 令牌。
 *
 * 用法：
 *   <ui-dialog [(open)]="open" title="删除任务？">
 *     正文
 *     <div dialog-actions>
 *       <ui-button variant="secondary">取消</ui-button>
 *       <ui-button variant="danger">删除</ui-button>
 *     </div>
 *   </ui-dialog>
 */
@Component({
  selector: 'ui-dialog',
  template: `
    @if (open()) {
      <div class="overlay" role="presentation" (click)="onBackdrop($event)">
        <div
          #panel
          class="dialog"
          [attr.role]="destructive() ? 'alertdialog' : 'dialog'"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
        >
          <h2 [id]="titleId">{{ title() }}</h2>
          <div class="body"><ng-content /></div>
          <div class="actions"><ng-content select="[dialog-actions]" /></div>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: var(--ui-z-dialog);
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--ui-scrim);
      backdrop-filter: blur(2px);
    }

    .dialog {
      width: min(440px, 100%);
      max-height: calc(100vh - 48px);
      overflow: auto;
      padding: var(--ui-space-5);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-lg);
      background: var(--ui-overlay);
      box-shadow: var(--ui-shadow-md);
    }

    h2 {
      margin: 0 0 6px;
      color: var(--ui-text);
      font-size: var(--ui-text-lg);
      font-weight: 600;
    }

    .body {
      color: var(--ui-muted);
      font-size: var(--ui-text-md);
      line-height: 1.6;
    }

    .body :is(p, ul, ol) {
      margin: 0;
    }

    .body :is(p + p, p + ul, p + ol) {
      margin-top: 6px;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--ui-space-2);
      margin-top: var(--ui-space-5);
    }

    /* 投影进来的 [dialog-actions] 包装层不参与布局，让按钮直接吃到 flex gap */
    :host ::ng-deep .actions > * {
      display: contents;
    }

    .actions:not(:has(*)) {
      display: none;
    }
  `,
})
export class DialogComponent {
  readonly open = model(false);
  readonly title = input('');
  /** 破坏性确认：role 用 alertdialog。 */
  readonly destructive = input(false);
  /** 关闭按钮 / Esc / 点遮罩是否生效；重要确认可设 false。 */
  readonly dismissible = input(true);
  readonly closed = output<void>();

  readonly titleId = `dlg-title-${++seq}`;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);

  constructor() {
    effect((onCleanup) => {
      if (!this.open()) return;

      const previous = document.activeElement as HTMLElement | null;
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      afterNextRender(() => this.focusFirst(), { injector: this.injector });

      onCleanup(() => {
        document.body.style.overflow = overflow;
        previous?.focus?.();
      });
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }

  onBackdrop(event: MouseEvent): void {
    // 只认遮罩本身：点面板内部会冒泡上来，但 event.target 不是遮罩
    if (event.target !== event.currentTarget) return;
    this.close();
  }

  close(): void {
    if (!this.dismissible() || !this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }

  private focusFirst(attempt = 0): void {
    const root = this.panel()?.nativeElement;
    if (!root) {
      // @if 内容可能比 afterNextRender 晚一帧出现
      if (attempt < 3) requestAnimationFrame(() => this.focusFirst(attempt + 1));
      return;
    }
    const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
    // 优先项可能挂在 ui-button 宿主上，真正可聚焦的是它内部的 button
    const target = preferred
      ? (preferred.querySelector<HTMLElement>('button, [href], input, select, textarea') ??
        preferred)
      : root.querySelector<HTMLElement>(
          '.actions button, .actions [href], button, [href], input, select, textarea',
        );
    target?.focus();
  }
}
