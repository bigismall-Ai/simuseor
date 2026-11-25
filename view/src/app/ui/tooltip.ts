import { Component, input } from '@angular/core';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * 提示气泡：包住任意投影内容，hover / 键盘聚焦时用纯 CSS 浮出。
 *
 * 不建 portal、不读 DOM 尺寸、不做边界翻转；气泡只靠 CSS 贴在宿主四侧。
 * 因此气泡只适合「补充说明」，不能承担唯一信息源：投影内容本身要有可访问名。
 * 祖先带 `overflow: hidden / auto` 时会裁掉气泡，这种位置改用 `ui-notice`。
 *
 * 12px 圆角 / 8px 内边距 / 8px 间距 / 层级走 --ui-z-toast；深浅色只换 token。
 */
@Component({
  selector: 'ui-tooltip',
  host: {
    '[class.top]': "placement() === 'top'",
    '[class.bottom]': "placement() === 'bottom'",
    '[class.left]': "placement() === 'left'",
    '[class.right]': "placement() === 'right'",
  },
  template: `
    <ng-content />
    @if (text()) {
      <span class="tip" role="tooltip">{{ text() }}</span>
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
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
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

    :host(:hover) .tip,
    :host(:focus-within) .tip {
      opacity: 1;
      visibility: visible;
    }
  `,
})
export class TooltipComponent {
  /** 气泡文字；为空时不渲染气泡，宿主行为不变。 */
  readonly text = input('');
  readonly placement = input<TooltipPlacement>('top');
}
