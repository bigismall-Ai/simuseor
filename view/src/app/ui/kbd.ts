import { Component, input } from '@angular/core';

/**
 * 快捷键小件：11px 等宽、6px 圆角、底部内阴影。
 *
 * 两种用法：
 *   - `[keys]="['Ctrl', 'K']"`：每个键各渲染一颗 <kbd>；
 *   - 投影内容：`<ui-kbd>Esc</ui-kbd>`，内容包在一颗 <kbd> 里。
 *
 * 深色面板里用 `--kbd-*` 局部覆盖（ui-code 的标题栏就是这样做的），
 * 不新增 tone 变体，避免快捷键出现两套以上皮肤。
 */
@Component({
  selector: 'ui-kbd',
  template: `
    @if (keys().length) {
      @for (key of keys(); track $index) {
        <kbd class="key">{{ key }}</kbd>
      }
    } @else {
      <kbd class="key"><ng-content /></kbd>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-1);
      vertical-align: middle;
    }

    .key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: var(--ui-kbd-h);
      padding: 0 var(--ui-space-1);
      border: 1px solid var(--kbd-line, var(--ui-kbd-line));
      border-radius: var(--ui-kbd-radius);
      background: var(--kbd-bg, var(--ui-kbd-bg));
      box-shadow: var(--kbd-shadow, var(--ui-kbd-shadow));
      color: var(--kbd-ink, var(--ui-kbd-ink));
      font: 500 var(--ui-kbd-size)/1 var(--ui-font-mono);
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
  `,
})
export class KbdComponent {
  /** 多个键：每个键一颗；为空时渲染投影内容。 */
  readonly keys = input<string[]>([]);
}
