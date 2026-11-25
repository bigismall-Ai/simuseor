import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { InputComponent } from './input';
import { KbdComponent } from './kbd';
import { UiIconModule } from './material';

export interface SearchItem {
  label: string;
  hint?: string;
  /** 目标路由；组件本身不跳转，只随 picked 一起交给父级。 */
  route?: string;
}

let seq = 0;

/**
 * 搜索触发条 + 结果浮层。
 *
 * 只做表现层：命中项随 `picked` 抛出，路由与数据来源都由父级决定。
 * 浮层最大 640px、命中行 52px；Esc 关闭并把焦点还给触发按钮，
 * ↑ / ↓ 移动高亮，Enter 选中当前项。
 *
 * 触发条：图标 + 占位文字 + 快捷键胶囊；≤768 只留图标。
 */
@Component({
  selector: 'ui-search',
  imports: [InputComponent, KbdComponent, UiIconModule],
  host: {
    '[class.block]': 'block()',
  },
  template: `
    <button
      #trigger
      class="trigger"
      type="button"
      [attr.aria-label]="label()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? listId : null"
      (click)="toggle()"
    >
      <mat-icon svgIcon="app:search" aria-hidden="true"></mat-icon>
      <span class="placeholder">{{ placeholder() }}</span>
      @if (shortcut().length) {
        <span class="keys"><ui-kbd [keys]="shortcut()" /></span>
      }
    </button>

    @if (open()) {
      <dialog
        #dlg
        class="overlay"
        [attr.aria-label]="label()"
        (cancel)="onCancel($event)"
        (mousedown)="onOverlayMouseDown($event)"
      >
      <div class="panel" tabindex="-1" (keydown)="onKeydown($event)">
        <div class="field">
          <ui-input
            ariaLabel="搜索内容"
            [placeholder]="placeholder()"
            [(value)]="query"
          >
            <mat-icon input-leading svgIcon="app:search" aria-hidden="true"></mat-icon>
          </ui-input>
        </div>

        @if (filtered().length) {
          <ul class="rows ui-scrollbar" [id]="listId" role="listbox" [attr.aria-label]="label()">
            @for (item of filtered(); track item.label + $index) {
              <li role="presentation">
                <button
                  class="row"
                  type="button"
                  role="option"
                  [id]="listId + '-' + $index"
                  [attr.aria-selected]="cursor() === $index"
                  (mouseenter)="cursor.set($index)"
                  (click)="pick(item)"
                >
                  <span class="row-text">
                    <b>{{ item.label }}</b>
                    @if (item.hint) {
                      <span>{{ item.hint }}</span>
                    }
                  </span>
                  <mat-icon svgIcon="app:chevron-right" aria-hidden="true"></mat-icon>
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="none">没有匹配「{{ query() }}」的条目，换个关键词试试。</p>
        }
      </div>
      </dialog>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
      vertical-align: middle;
    }

    :host(.block) {
      display: block;
    }

    .trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      width: 100%;
      height: var(--ui-search-trigger-h);
      padding: 0 var(--ui-space-2) 0 var(--ui-space-3);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-inset);
      color: var(--ui-muted);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-sm);
      text-align: left;
      cursor: pointer;
      transition:
        border-color 0.15s ease,
        background 0.15s ease,
        color 0.15s ease;
    }

    .trigger:hover {
      border-color: var(--ui-border-2);
      background: var(--ui-raised);
      color: var(--ui-text);
    }

    .trigger:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    .trigger mat-icon {
      flex: none;
      width: var(--icon-control);
      height: var(--icon-control);
      color: inherit;
    }

    .placeholder {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .keys {
      flex: none;
    }

    .overlay {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 12vh 0 0;
      border: 0;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: transparent;
      color: inherit;
    }

    .overlay::backdrop {
      background: transparent;
    }

    .panel {
      position: relative;
      z-index: calc(var(--ui-z-dialog) + 1);
      width: min(var(--ui-search-max-w), 80vw);
      overflow: hidden;
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-card);
      background: var(--ui-overlay);
      box-shadow: var(--ui-shadow-md);
      backdrop-filter: blur(14px);
    }

    .field {
      padding: var(--ui-space-2);
      border-bottom: 1px solid var(--ui-border-2);
    }

    .rows {
      max-height: 320px;
      margin: 0;
      padding: var(--ui-space-1);
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
      list-style: none;
      /* 浮层里用更细的导航滚动条，不占满 10px 页面滚动条 */
      --scrollbar-size: 6px;
    }

    .rows li {
      margin: 0;
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--ui-space-3);
      width: 100%;
      height: var(--ui-search-row-h);
      padding: 0 var(--ui-space-3);
      border: 0;
      border-radius: var(--ui-radius-sm);
      background: none;
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      text-align: left;
      cursor: pointer;
    }

    .row[aria-selected='true'] {
      background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
    }

    .row:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: -2px;
    }

    .row-text {
      display: grid;
      flex: 1;
      min-width: 0;
    }

    .row-text b {
      overflow: hidden;
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-semibold);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .row-text span {
      overflow: hidden;
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .row mat-icon {
      flex: none;
      width: var(--icon-inline);
      height: var(--icon-inline);
      color: var(--ui-muted);
    }

    .none {
      margin: 0;
      padding: var(--ui-space-4) var(--ui-space-3);
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
    }

    @media (max-width: 768px) {
      .placeholder,
      .keys {
        display: none;
      }

      .trigger {
        justify-content: center;
        width: var(--ui-search-trigger-h);
        padding: 0;
      }

      .overlay {
        padding-top: 10vh;
      }

      .panel {
        width: min(92vw, var(--ui-search-max-w));
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .trigger {
        transition: none;
      }
    }
  `,
})
export class SearchComponent {
  readonly open = model(false);
  readonly items = input<SearchItem[]>([]);
  readonly placeholder = input('搜索组件、页面、文档');
  /** 触发条右侧的快捷键胶囊；空数组则不显示。 */
  readonly shortcut = input<string[]>([]);
  /** `Ctrl/⌘ + K` 打开浮层；默认关闭，由页面决定。 */
  readonly hotkey = input(false);
  /** 辅助技术读到的名称。 */
  readonly label = input('搜索');
  /** 触发条占满一行（筛选条里常见）。 */
  readonly block = input(false);

  readonly picked = output<SearchItem>();

  readonly query = model('');
  readonly cursor = signal(0);

  /** 按 label / hint 做大小写不敏感包含匹配；空查询 = 全部。 */
  readonly filtered = computed(() => {
    const text = this.query().trim().toLowerCase();
    if (!text) return this.items();
    return this.items().filter((item) =>
      `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(text),
    );
  });

  readonly listId = `search-list-${++seq}`;

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly searchInput = viewChild(InputComponent);
  private readonly injector = inject(Injector);

  constructor() {
    effect((onCleanup) => {
      if (!this.open()) return;

      const previous = document.activeElement as HTMLElement | null;
      this.query.set('');
      this.cursor.set(0);
      afterNextRender(() => {
        const el = this.dialog()?.nativeElement;
        if (el && !el.open) el.showModal();
        this.searchInput()?.focus();
      }, { injector: this.injector });

      onCleanup(() => {
        // 浮层 DOM 会在本帧结束后移除；等渲染完再把焦点还给触发条，
        // 否则刚聚焦的元素被销毁，焦点掉回 body。
        const el = this.dialog()?.nativeElement;
        if (el?.open) el.close();
        const target = this.trigger()?.nativeElement ?? previous;
        afterNextRender(() => target?.focus(), { injector: this.injector });
      });
    });

    // 查询变化后高亮回到第一项，避免游标停在已消失的行上
    effect(() => {
      this.query();
      this.cursor.set(0);
    });
  }

  @HostListener('document:keydown', ['$event'])
  onHotkey(event: KeyboardEvent): void {
    if (!this.hotkey()) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    this.open.set(true);
  }

  toggle(): void {
    this.open.update((value) => !value);
  }

  close(): void {
    this.open.set(false);
  }

  /**
   * 点在面板外才关闭，点面板内部不关。
   *
   * 用 mousedown 而不是 click：按住选中文字再松开时 click 可能落在 overlay 上，
   * 会把「选择文本」误判成「点空白」。mousedown 的 target 就是按下位置。
   */
  onOverlayMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  onKeydown(event: KeyboardEvent): void {
    const total = this.filtered().length;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (!total) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.cursor.update((value) => (value + step + total) % total);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.filtered()[this.cursor()];
      if (item) this.pick(item);
    }
  }

  pick(item: SearchItem): void {
    this.picked.emit(item);
    this.open.set(false);
  }
}
