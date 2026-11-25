import { Component, input } from '@angular/core';

/**
 * 只读分类标签：中性、不表达状态。
 *
 * 与 `ui-badge` 分工：badge 带语义色（成功 / 警告 / 错误），tag 只回答「它属于哪一类」。
 * `outlined` 用于来源短码这类次要标签，`mono` 用于 token / 路径 / 计数。
 */
@Component({
  selector: 'ui-tag',
  template: `
    <span class="tag" [class.outlined]="outlined()" [class.mono]="mono()" [class.sm]="size() === 'sm'">
      <ng-content />
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      height: 24px;
      padding: 0 9px;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-panel-2);
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      font-weight: var(--ui-weight-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tag.sm {
      height: 20px;
      padding: 0 7px;
      font-size: var(--ui-text-xs);
    }

    .tag.outlined {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--ui-border-2);
    }

    .tag.mono {
      font-family: var(--ui-font-mono);
      font-size: var(--ui-text-xs);
    }
  `,
})
export class TagComponent {
  readonly outlined = input(false);
  readonly mono = input(false);
  readonly size = input<'md' | 'sm'>('md');
}
