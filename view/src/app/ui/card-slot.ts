import { Component, computed, input } from '@angular/core';

export type CardSlotTone = '' | 'ok' | 'warn' | 'err';

/**
 * 卡片状态槽：左状态 · 一根线 · 右数值。
 *
 * 只定义槽的结构与配色；状态文案、数值、提示由卡片传入 ——
 * 组件不规定「状态」具体是磁盘、下载量还是节点类。
 */
@Component({
  selector: 'ui-card-slot',
  template: `
    <div class="acard-slot">
      <span class="status" [class]="toneClass()" [attr.title]="statusTitle() || null">
        @if (icon() === 'warn') {
          <svg
            viewBox="0 0 16 16"
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M8 2.6v6.2" />
            <circle cx="8" cy="11.9" r="0.85" fill="currentColor" stroke="none" />
            <path
              d="M6.9 2.4 1.5 11.9A1.6 1.6 0 0 0 2.9 14.4h10.2a1.6 1.6 0 0 0 1.4-2.5L9.1 2.4a1.6 1.6 0 0 0-2.2 0z"
            />
          </svg>
        }
        {{ status() }}
      </span>
      <span class="acard-rule"></span>
      <span class="acard-size" [attr.title]="sizeTitle() || null">{{ size() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .acard-slot {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      font-size: var(--card-slot-size);
      font-weight: var(--ui-weight-semibold);
      color: var(--card-scrim-ink);
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status.is-ok {
      color: var(--card-scrim-ok);
    }

    .status.is-warn {
      color: var(--card-scrim-warn);
    }

    .status.is-err {
      color: var(--card-scrim-err);
    }

    .acard-rule {
      flex: 1 1 auto;
      min-width: 12px;
      height: 1px;
      background: var(--card-scrim-line);
    }

    .acard-size {
      flex: none;
      color: var(--card-scrim-muted);
      font-variant-numeric: tabular-nums;
    }

    svg {
      flex: none;
    }
  `,
})
export class CardSlotComponent {
  readonly status = input('');
  readonly statusTitle = input('');
  readonly tone = input<CardSlotTone>('');
  readonly icon = input<'' | 'warn'>('');
  readonly size = input('');
  readonly sizeTitle = input('');

  readonly toneClass = computed(() => (this.tone() ? 'is-' + this.tone() : ''));
}
