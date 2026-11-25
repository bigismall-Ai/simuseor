import { Component, input, model } from '@angular/core';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

/**
 * 选项卡：同一份数据的少量互斥视图。
 *
 * 与 `ui-segmented` 分工：segmented 是紧凑的分段开关（≤3 项、无计数）；
 * tabs 是有标题行的视图切换（可带计数），超过 7 项改用导航树。
 *
 * 两种表面：`underline` 用于内容区顶部，`pill` 用于工具条内。
 * 键盘可达性由原生按钮提供（Enter / Space 触发），不拦截方向键。
 */
@Component({
  selector: 'ui-tabs',
  template: `
    <div
      class="tabs"
      [class.underline]="variant() === 'underline'"
      [class.pill]="variant() === 'pill'"
      [class.sm]="size() === 'sm'"
      role="tablist"
      [attr.aria-label]="label() || null"
    >
      @for (tab of tabs(); track tab.key) {
        <button
          type="button"
          class="tab"
          role="tab"
          [class.on]="tab.key === value()"
          [disabled]="!!tab.disabled"
          [attr.aria-selected]="tab.key === value()"
          (click)="value.set(tab.key)"
        >
          <span class="label">{{ tab.label }}</span>
          @if (tab.count !== undefined) {
            <span class="count">{{ tab.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .tabs {
      display: flex;
      align-items: center;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tabs.underline {
      gap: var(--ui-space-4);
      /* 基线画在内侧：横向滚动裁切时不会把选中底线切掉 */
      box-shadow: inset 0 -1px 0 var(--ui-inner-border);
    }

    .tabs.pill {
      gap: var(--ui-space-1);
      padding: var(--ui-space-1);
      border: 1px solid var(--ui-border-2);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-panel-3);
    }

    .tab {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      height: var(--ui-h-md);
      padding: 0 var(--ui-space-2);
      border: 0;
      border-radius: var(--ui-radius-sm);
      background: none;
      color: var(--ui-muted);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background 0.16s ease,
        color 0.16s ease;
    }

    .tabs.sm .tab {
      height: var(--ui-h-sm);
      font-size: var(--ui-text-sm);
    }

    .tab:not(:disabled):hover {
      background: color-mix(in srgb, var(--ui-panel-2) 55%, transparent);
      color: var(--ui-text);
    }

    .tab:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: -2px;
    }

    .tab:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* ---- underline：选中项用正文色 + 2px 底线 ---- */
    .tabs.underline .tab {
      border-radius: var(--ui-radius-sm) var(--ui-radius-sm) 0 0;
    }

    .tabs.underline .tab.on {
      color: var(--ui-text);
      font-weight: 600;
    }

    .tabs.underline .tab.on::after {
      content: '';
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 2px;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-primary);
    }

    /* ---- pill：选中项实心 ---- */
    .tabs.pill .tab {
      height: var(--ui-h-sm);
      border-radius: var(--ui-radius-pill);
    }

    .tabs.pill.sm .tab {
      height: var(--ui-h-compact);
    }

    .tabs.pill .tab.on,
    .tabs.pill .tab.on:hover {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .count {
      flex: none;
      color: var(--ui-muted);
      font: 500 var(--ui-text-xs) / 1 var(--ui-font-mono);
    }

    .tabs.underline .tab.on .count {
      color: var(--ui-text);
      opacity: 0.72;
    }

    .tabs.pill .tab.on .count {
      color: inherit;
      opacity: 0.72;
    }

    @media (prefers-reduced-motion: reduce) {
      .tab {
        transition: none;
      }
    }
  `,
})
export class TabsComponent {
  readonly tabs = input.required<TabItem[]>();
  readonly value = model('');
  readonly variant = input<'underline' | 'pill'>('underline');
  readonly size = input<'md' | 'sm'>('md');
  /** 辅助技术读到的这组选项卡名称。 */
  readonly label = input('');
}
