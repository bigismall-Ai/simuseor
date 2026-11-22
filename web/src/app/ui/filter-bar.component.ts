import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

/** 状态条里的一条只读事实。tone 只给异常，常态一律中性。 */
export interface CollectionFact {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'err';
  /** 悬停说明：解释这个数字怎么来的，不再往条上堆字 */
  title?: string;
}

/** 站点筛选项：来源站。disabled = 探针不可达 / 未探测（灰置、不可点）。 */
export interface FilterSite {
  key: string;
  label: string;
  count?: number | null;
  /** 灰置且不可点 */
  disabled?: boolean;
  /** 灰置原因（hover 气泡）。原因不印在页面上。 */
  tip?: string;
}

/** 类别筛选项：收在「筛选」浮层里的一档。 */
export interface FilterFacetOption {
  key: string;
  label: string;
  count?: number | null;
}

/** 浮层里的一组类别筛选（任务类型 / 用途 / 格式 …）。 */
export interface FilterFacetGroup {
  key: string;
  label: string;
  options: FilterFacetOption[];
}

export interface FilterSortOption {
  key: string;
  label: string;
}

/** 浮层里的一次分面切换。 */
export interface FilterFacetChange {
  group: string;
  key: string;
  on: boolean;
}

/**
 * 列表顶部 · 统一筛选条（VIS 定稿形态）。
 *
 * 来源：`artifacts/vis/prototypes/page-header.html`「搜索 + 筛选」段
 *      ＋ `artifacts/vis/prototypes/page-status.html` 的 .ps-* 既有语汇。
 *
 * 一行，从左到右：
 *   搜索框 → 站点筛选（chip 行）→「筛选」按钮（漏斗 ＋ 已选数量徽标）
 *   → 排序 → 列表/卡片视图切换 → 结果读数与「清除全部筛选」。
 *
 * 其余类别筛选（任务类型 / 用途 / 格式 / 状态 …）全部收进「筛选」浮层：
 * 分组 chip ＋ 每项计数，底部「清除全部」与「完成」，Esc / 点外部 / ✕ 都能关。
 *
 * 站点与类别是两层：站点决定「从哪儿找」（留在外面可见），类别决定「找什么样的」
 * （在浮层里）。站点候选项按探针状态定：不可达 / 未探测的站灰置不可点，
 * 原因放进 hover 气泡，不印在页面上。
 */
@Component({
  selector: 'ui-filter-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="ps-bar" aria-label="列表状态与筛选">
      <!-- 状态行：只读事实 ＋ 右端刷新（主读数按定稿移到筛选条右端） -->
      @if (facts.length || refreshLabel) {
        <div class="ps-status">
          @if (facts.length) {
            <ul class="ps-facts" aria-label="当前结果概览">
              @for (f of facts; track f.label) {
                <li [title]="f.title || ''">
                  <span class="ps-fact-label">{{ f.label }}</span>
                  <b
                    class="ps-fact-value"
                    [class.is-ok]="f.tone === 'ok'"
                    [class.is-warn]="f.tone === 'warn'"
                    [class.is-err]="f.tone === 'err'"
                  >{{ f.value }}</b>
                </li>
              }
            </ul>
          }

          <div class="ps-status-actions">
            @if (progress) {
              <span class="ps-progress">{{ progress }}</span>
            }
            <button
              class="ps-icon"
              type="button"
              [disabled]="loading"
              [attr.aria-label]="refreshLabel"
              [title]="refreshLabel"
              (click)="refresh.emit()"
            >
              <svg [class.is-spin]="loading" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.2 7.4a5.3 5.3 0 1 0-.3 2.6" />
                <path d="M13.3 3.6v3.9H9.4" />
              </svg>
            </button>
          </div>
        </div>
      }

      <div class="ps-filters sf-row">
        <!-- ① 搜索框 -->
        <label class="ps-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.4" />
            <path d="M10.3 10.3 13.6 13.6" />
          </svg>
          <input
            type="search"
            [value]="q"
            [placeholder]="searchPlaceholder"
            [attr.aria-label]="searchPlaceholder"
            [attr.data-testid]="searchTestId || null"
            (input)="onSearchInput($event)"
            (keyup.enter)="onSearchEnter()"
          />
          @if (q) {
            <button class="ps-clear" type="button" aria-label="清空搜索" (click)="clearSearch()">✕</button>
          }
        </label>

        <!-- ② 站点筛选：留在外面可见的一层 -->
        @if (sites.length) {
          <div class="ps-chips" role="group" aria-label="按站点筛选">
            @for (s of sites; track s.key) {
              @if (s.disabled) {
                <!-- 灰置项渲染成 span：不是可选入口，点不动；原因只在 hover 气泡里 -->
                <span
                  class="ps-chip is-off"
                  aria-disabled="true"
                  [attr.aria-label]="s.label + '（不可用）'"
                  [attr.data-tip]="s.tip || ''"
                >{{ s.label }}</span>
              } @else {
                <button
                  type="button"
                  class="ps-chip"
                  [class.on]="site === s.key"
                  (click)="siteChange.emit(s.key)"
                >
                  {{ s.label }}
                  @if (s.count !== null && s.count !== undefined) {
                    <b>{{ s.count }}</b>
                  }
                </button>
              }
            }
          </div>
        }

        <!-- ③ 其余类别筛选：收进「筛选」浮层 -->
        @if (facets.length) {
          <div class="sf-pop-wrap">
            <button
              class="ps-select sf-pop-trigger"
              type="button"
              aria-haspopup="dialog"
              [attr.aria-expanded]="popOpen"
              (click)="togglePop($event)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 3h12l-4.6 5.6V13l-2.8 1.4V8.6z" />
              </svg>
              <span>筛选</span>
              @if (selectedFacetCount) {
                <b class="ps-badge">{{ selectedFacetCount }}</b>
              }
            </button>

            <div class="sf-pop" role="dialog" aria-label="筛选" [hidden]="!popOpen">
              <div class="sf-pop-head">
                <b>筛选</b>
                <span class="sf-pop-sel">{{ selectedFacetCount }} 项已选</span>
                <button class="sf-pop-x" type="button" aria-label="关闭" (click)="closePop()">✕</button>
              </div>
              <div class="sf-pop-body">
                @for (g of facets; track g.key) {
                  <div class="sf-facet" data-testid="facet-group">
                    <div class="sf-facet-head">
                      <span>{{ g.label }}</span>
                      <b>{{ g.options.length }}</b>
                    </div>
                    <div class="sf-facet-list">
                      @for (o of g.options; track o.key) {
                        <button
                          type="button"
                          class="ps-chip"
                          [class.on]="isFacetOn(g.key, o.key)"
                          (click)="toggleFacet(g.key, o.key)"
                        >
                          {{ o.label }}
                          @if (o.count !== null && o.count !== undefined) {
                            <b>{{ o.count }}</b>
                          }
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
              <div class="sf-pop-foot">
                <button class="sf-pop-clear" type="button" (click)="clearFacets()">清除全部</button>
                <button class="primary btn-xs" type="button" data-pop-ok (click)="closePop()">完成</button>
              </div>
            </div>
          </div>
        }

        <!-- ④ 排序 ⑤ 视图切换 ⑥ 结果读数与清除全部：
             三者绑成一组，靠筛选条右端右对齐（窄屏时整组换行，仍贴右）。 -->
        <div class="sf-right">
        @if (sortOptions.length) {
            <label class="ps-select" title="排序">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 4.2h10M3 8h7M3 11.8h4" />
              </svg>
              <select [value]="sort" (change)="onSort($event)" aria-label="排序">
                @for (o of sortOptions; track o.key) {
                  <option [value]="o.key">{{ o.label }}</option>
                }
              </select>
              <svg class="caret" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4.4 6.4 3.6 3.4 3.6-3.4" />
              </svg>
            </label>
        }

        @if (view) {
            <div class="ps-view" role="group" aria-label="视图切换">
              <button
                type="button"
                [class.on]="view === 'grid'"
                (click)="viewChange.emit('grid')"
                title="网格视图"
                aria-label="网格视图"
              >▦</button>
              <button
                type="button"
                [class.on]="view === 'list'"
                (click)="viewChange.emit('list')"
                title="列表视图"
                aria-label="列表视图"
              >☰</button>
            </div>
          }

          <div class="sf-tail">
            @if (count === null) {
              <p class="ps-count is-loading">读取中…</p>
            } @else {
              <p class="ps-count">
                <b>{{ count }}</b>
                @if (showTotal()) {
                  <span class="ps-total">/ {{ total }}</span>
                }
                <span class="ps-unit">{{ unit }}</span>
              </p>
            }
            @if (hasFilter) {
              <button class="btn-xs sf-clear" type="button" (click)="clearAll.emit()">清除全部筛选</button>
            }
          </div>
        </div>
      </div>
    </section>

    <!-- 提示气泡：hover 才出。失败原因不印在页面上，页面保持干净。 -->
    <div
      #tipbox
      class="sf-tipbox"
      role="tooltip"
      [hidden]="!tipText"
      [style.left.px]="tipLeft"
      [style.top.px]="tipTop"
    >{{ tipText }}</div>
  `,
})
export class FilterBarComponent implements OnChanges, OnDestroy {
  // ---- 状态条 ----
  @Input() facts: CollectionFact[] = [];
  @Input() loading = false;
  @Input() progress = '';
  @Input() refreshLabel = '刷新';
  @Output() refresh = new EventEmitter<void>();

  // ---- 搜索 ----
  @Input() search = '';
  @Input() searchPlaceholder = '搜索';
  /** 本地过滤 0（边输边筛）；远端检索 300（停一下自动发一次，不等回车） */
  @Input() searchDebounceMs = 0;
  /** 给搜索框挂 data-testid（e2e 用） */
  @Input() searchTestId = '';
  @Output() searchChange = new EventEmitter<string>();

  // ---- 站点筛选 ----
  @Input() sites: FilterSite[] = [];
  /** 当前选中的站点；'' = 全部站点 */
  @Input() site = '';
  @Output() siteChange = new EventEmitter<string>();

  // ---- 类别筛选（浮层） ----
  @Input() facets: FilterFacetGroup[] = [];
  /** group key → 已选中的 option key */
  @Input() facetSelected: Record<string, string[]> = {};
  @Output() facetChange = new EventEmitter<FilterFacetChange>();

  // ---- 排序 ----
  @Input() sortOptions: FilterSortOption[] = [];
  @Input() sort = '';
  @Output() sortChange = new EventEmitter<string>();

  // ---- 视图 ----
  @Input() view: '' | 'grid' | 'list' = '';
  @Output() viewChange = new EventEmitter<'grid' | 'list'>();

  // ---- 结果读数 ----
  @Input() count: number | string | null = null;
  @Input() total: number | string | null = null;
  @Input() unit = '';
  /** 有筛选时才出现「清除全部筛选」 */
  @Input() hasFilter = false;
  @Output() clearAll = new EventEmitter<void>();

  /** 搜索框里的文字：本地留一份，父组件回填时同步 */
  q = '';
  popOpen = false;

  tipText = '';
  tipLeft = 0;
  tipTop = 0;

  @ViewChild('tipbox') tipbox?: ElementRef<HTMLElement>;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: ElementRef<HTMLElement>) {}

  ngOnChanges(ch: SimpleChanges): void {
    // 父组件回填（URL 参数 / 清除全部）时同步输入框；用户自己敲的字与回填值相同，不动
    if (ch['search'] && ch['search'].currentValue !== this.q) {
      this.q = ch['search'].currentValue ?? '';
    }
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ---------- 搜索 ----------

  onSearchInput(ev: Event): void {
    this.q = (ev.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.searchDebounceMs <= 0) {
      this.searchChange.emit(this.q);
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.searchChange.emit(this.q);
    }, this.searchDebounceMs);
  }

  onSearchEnter(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchChange.emit(this.q);
  }

  clearSearch(): void {
    this.q = '';
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchChange.emit('');
  }

  // ---------- 浮层 ----------

  /** 读数里的「总数」只在与当前数不同时出现（count 可能带「+」，按文本比）。 */
  showTotal(): boolean {
    return this.total !== null && String(this.total) !== String(this.count);
  }

  get selectedFacetCount(): number {
    let n = 0;
    for (const list of Object.values(this.facetSelected)) n += list?.length ?? 0;
    return n;
  }

  isFacetOn(group: string, key: string): boolean {
    return (this.facetSelected[group] || []).includes(key);
  }

  toggleFacet(group: string, key: string): void {
    const on = !this.isFacetOn(group, key);
    this.facetChange.emit({ group, key, on });
  }

  clearFacets(): void {
    for (const g of this.facets) {
      for (const o of g.options) {
        if (this.isFacetOn(g.key, o.key)) this.facetChange.emit({ group: g.key, key: o.key, on: false });
      }
    }
  }

  togglePop(ev: Event): void {
    ev.stopPropagation();
    this.popOpen = !this.popOpen;
  }

  closePop(): void {
    this.popOpen = false;
  }

  /** 点浮层外面收起 */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.popOpen) return;
    const el = this.host.nativeElement;
    if (el && !el.contains(ev.target as Node)) this.popOpen = false;
  }

  /** Esc 收起 */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.popOpen) this.popOpen = false;
  }

  // ---------- 排序 ----------

  onSort(ev: Event): void {
    this.sortChange.emit((ev.target as HTMLSelectElement).value);
  }

  // ---------- 提示气泡 ----------

  @HostListener('mouseover', ['$event'])
  onMouseOver(ev: MouseEvent): void {
    const t = (ev.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
    if (!t) {
      this.hideTip();
      return;
    }
    this.showTip(t);
  }

  @HostListener('mouseout', ['$event'])
  onMouseOut(ev: MouseEvent): void {
    const t = (ev.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
    if (t) this.hideTip();
  }

  private showTip(el: HTMLElement): void {
    const text = el.getAttribute('data-tip') || '';
    if (!text) {
      this.hideTip();
      return;
    }
    this.tipText = text;
    const r = el.getBoundingClientRect();
    requestAnimationFrame(() => {
      const box = this.tipbox?.nativeElement;
      if (!box) return;
      const b = box.getBoundingClientRect();
      let left = r.left + r.width / 2 - b.width / 2;
      if (left < 8) left = 8;
      if (left > window.innerWidth - b.width - 8) left = Math.max(8, window.innerWidth - b.width - 8);
      this.tipLeft = left;
      this.tipTop = Math.max(8, r.top - b.height - 8);
    });
  }

  private hideTip(): void {
    this.tipText = '';
  }
}
