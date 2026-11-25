import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

let seq = 0;

/**
 * 提示气泡：包住任意投影内容，hover / 键盘聚焦时用纯 CSS 浮出。
 *
 * 可访问性由组件补：渲染后把触发元素（投影内容里的第一个可聚焦节点，
 * 或第一个元素）接上 `aria-describedby`，读屏在聚焦时能读到气泡文字；
 * Esc 收起气泡，鼠标移出 / 焦点移走后再恢复。
 *
 * 不建 portal、不读 DOM 尺寸、不做边界翻转；气泡只靠 CSS 贴在宿主四侧。
 * 因此气泡只适合「补充说明」，不能承担唯一信息源：投影内容本身要有可访问名。
 * 祖先带 `overflow: hidden / auto` 时会裁掉气泡，这种位置改用 `ui-notice`。
 */
@Component({
  selector: 'ui-tooltip',
  host: {
    '[class.top]': "placement() === 'top'",
    '[class.bottom]': "placement() === 'bottom'",
    '[class.left]': "placement() === 'left'",
    '[class.right]': "placement() === 'right'",
    '[class.is-dismissed]': 'dismissed()',
  },
  template: `
    <ng-content />
    @if (text()) {
      <span class="tip" role="tooltip" [id]="tipId">{{ text() }}</span>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .tip {
      position: absolute;
      z-index: var(--ui-z-toast);
      width: max-content;
      max-width: 240px;
      padding: var(--ui-space-2);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-lg);
      background: var(--ui-overlay);
      box-shadow: var(--ui-shadow-md);
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-regular);
      line-height: 1.45;
      white-space: normal;
      text-align: left;
      /* 只用透明度收起：visibility / display 会把节点移出无障碍树，
         触发元素上的 aria-describedby 就落空了 */
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--ui-duration-fast) var(--ui-ease);
    }

    /* 气泡与宿主之间 8px 的空隙也要可悬停，否则指针移过去时气泡已经消失 */
    .tip::before {
      content: '';
      position: absolute;
      inset: calc(-1 * var(--ui-space-2));
      border-radius: inherit;
    }

    /* ---- 四个方向：只靠 inset 偏移，不计算位置 ---- */
    :host(.top) .tip {
      bottom: calc(100% + var(--ui-space-2));
      left: 50%;
      transform: translateX(-50%);
    }

    :host(.bottom) .tip {
      top: calc(100% + var(--ui-space-2));
      left: 50%;
      transform: translateX(-50%);
    }

    :host(.left) .tip {
      top: 50%;
      right: calc(100% + var(--ui-space-2));
      transform: translateY(-50%);
    }

    :host(.right) .tip {
      top: 50%;
      left: calc(100% + var(--ui-space-2));
      transform: translateY(-50%);
    }

    :host(:not(.is-dismissed)):hover .tip,
    :host(:not(.is-dismissed)):focus-within .tip {
      opacity: 1;
      pointer-events: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      .tip {
        transition: none;
      }
    }
  `,
})
export class TooltipComponent {
  /** 气泡文字；为空时不渲染气泡，宿主行为不变。 */
  readonly text = input('');
  readonly placement = input<TooltipPlacement>('top');

  readonly tipId = `tip-${++seq}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dismissed = signal(false);
  private described: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const id = this.text() ? this.tipId : '';
      afterNextRender(() => this.syncDescribedBy(id), { injector: this.injector });
    });

    this.destroyRef.onDestroy(() => this.described?.removeAttribute('aria-describedby'));
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    this.dismissed.set(true);
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.dismissed.set(false);
  }

  @HostListener('focusout')
  onFocusOut(): void {
    this.dismissed.set(false);
  }

  /**
   * 把气泡接到触发元素上。投影内容可能是 `ui-button` 这类外壳，
   * 真正可聚焦的是它内部的 `button`，所以优先找可聚焦后代。
   */
  private syncDescribedBy(id: string): void {
    const root = this.host.nativeElement;
    const trigger =
      root.querySelector<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? (root.firstElementChild as HTMLElement | null);

    if (this.described && (this.described !== trigger || !id)) {
      this.described.removeAttribute('aria-describedby');
      this.described = null;
    }

    if (!trigger || !id) return;
    trigger.setAttribute('aria-describedby', id);
    this.described = trigger;
  }
}
