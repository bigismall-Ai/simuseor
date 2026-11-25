import {
  Component,
  ElementRef,
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
 * 弹层：原生 `<dialog>` + `showModal()`。
 *
 * 用原生 dialog 而不是自己搭遮罩，是因为浏览器已经替我们做了三件难做对的事：
 *   - 焦点圈闭（Tab / Shift+Tab 不会跑出弹层）；
 *   - top layer：不受祖先 `overflow` / `transform` / `z-index` 影响；
 *   - Esc 走 `cancel` 事件，可以按 `dismissible` 拦下。
 * 组件只补焦点首落点、关闭后还给触发元素、锁背景滚动。
 *
 * dialog 元素常驻 DOM，只用 `showModal()` / `close()` 控制显隐：
 * 若跟着 `@if` 一起销毁，浏览器会在节点移除时把焦点丢回 body，
 * 再想还给触发元素就晚了。
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
    <!-- 遮罩点击是补充操作，键盘等价物是 Esc（原生 cancel 事件）；dialog 本身不是可聚焦控件 -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #panel
      class="dialog"
      [attr.role]="destructive() ? 'alertdialog' : null"
      [attr.aria-labelledby]="titleId"
      (cancel)="onCancel($event)"
      (click)="onBackdrop($event)"
    >
      @if (open()) {
        <h2 [id]="titleId">{{ title() }}</h2>
        <div class="body"><ng-content /></div>
        <div class="actions"><ng-content select="[dialog-actions]" /></div>
      }
    </dialog>
  `,
  styles: `
    :host {
      display: contents;
    }

    .dialog {
      /* 原生 dialog 默认 margin:auto 居中；这里只固定尺寸与表面 */
      width: min(440px, calc(100vw - 48px));
      max-height: calc(100dvh - 48px);
      overflow: auto;
      padding: var(--ui-space-5);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-card);
      background: var(--ui-overlay);
      box-shadow: var(--ui-shadow-md);
      color: var(--ui-text);
    }

    .dialog::backdrop {
      background: var(--ui-scrim);
      backdrop-filter: blur(2px);
    }

    h2 {
      margin: 0 0 var(--ui-space-2);
      color: var(--ui-text);
      font-size: var(--ui-text-lg);
      font-weight: var(--ui-weight-semibold);
    }

    .body {
      color: var(--ui-muted);
      font-size: var(--ui-text-md);
      line-height: var(--ui-leading-relaxed);
    }

    .body :is(p, ul, ol) {
      margin: 0;
    }

    .body :is(p + p, p + ul, p + ol) {
      margin-top: var(--ui-space-2);
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
  /** Esc / 点遮罩是否生效；重要确认可设 false。 */
  readonly dismissible = input(true);
  readonly closed = output<void>();

  readonly titleId = `dlg-title-${++seq}`;

  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');
  private readonly injector = inject(Injector);
  private previous: HTMLElement | null = null;
  private scrollLock = '';

  constructor() {
    effect(() => {
      const open = this.open();
      afterNextRender(() => this.sync(open), { injector: this.injector });
    });
  }

  /** 原生 Esc：先拦下，再按 dismissible 决定是否真的关。 */
  onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  onBackdrop(event: MouseEvent): void {
    // 模态 dialog 的遮罩点击，target 就是 dialog 元素本身
    if (event.target !== event.currentTarget) return;
    this.close();
  }

  close(): void {
    if (!this.dismissible() || !this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }

  private sync(open: boolean): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;

    if (open && !el.open) {
      this.previous = document.activeElement as HTMLElement | null;
      this.scrollLock = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      el.showModal();
      this.focusFirst(el);
      return;
    }

    if (!open && el.open) {
      el.close();
      document.body.style.overflow = this.scrollLock;
      this.previous?.focus?.();
      this.previous = null;
    }
  }

  private focusFirst(root: HTMLElement): void {
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
