import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { focusFirst, rememberFocus, restoreFocus, trapTab } from '../core/a11y';
import { ApiService } from '../core/api.service';
import { DiscoverCacheService } from '../core/discover-cache.service';
import { ProbeService } from '../core/probe.service';
import { RepoInfo, RemoteFile, SearchItem, errMsg, fmtNum, fmtSize } from '../core/types';
import { sourceTaskLabel } from '../core/task-labels';
import { matchedWeightFiles, weightFiles } from '../core/weight-files';
import { BadgeComponent } from '../ui/badge.component';
import {
  CollectionFact,
  FilterBarComponent,
  FilterFacetChange,
  FilterFacetGroup,
  FilterSite,
} from '../ui/filter-bar.component';
import { EmptyComponent } from '../ui/empty.component';
import { ModelCardComponent } from '../ui/model-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/** 合并后的模型：同一模型在多个来源的条目聚合到一行 */
interface MergedRow {
  /** 归一化模型名，仅用于跨源匹配 */
  key: string;
  /** 行唯一标识（首条的 source/id），同名不同源的行不会重复 */
  id: string;
  inLibrary: boolean;
  items: SearchItem[];
}

interface DownloadDialog {
  row: MergedRow;
  active: number;
  repo: RepoInfo | null;
  selected: Set<string>;
  /** 仓库里全部真实权重（非权重文件不进入下载清单） */
  allWeights: RemoteFile[];
  /** 默认展示的匹配权重：主权重 / 非量化版本，其余折叠 */
  matchedWeights: RemoteFile[];
  /** 是否展开「全部权重」 */
  showAllWeights: boolean;
  loading: boolean;
  creating: boolean;
  done: boolean;
  error: string;
}

interface SourceError {
  label: string;
  message: string;
}

const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  demo: 'Demo',
};

const HOT_KEYWORDS = ['qwen', 'flux', 'lora', 'sdxl', 'whisper', 'embedding'];
const PAGE_SIZE = 20;

/** 排序：原生 select，选项「按 X」句式 */
const SORT_OPTIONS = [
  { key: 'trending', label: '按综合' },
  { key: 'downloads', label: '按下载量' },
  { key: 'likes', label: '按点赞' },
  { key: 'recent', label: '按最新入库' },
];

/** 视图切换（segmented）：本地库 / 发现 */
const VIEW_OPTIONS = [
  { key: 'mine', label: '本地库' },
  { key: 'discover', label: '发现' },
];

/** 追加下一页时按 (source,id) 去重，保持先到先得。 */
function mergeUnique(prev: SearchItem[], next: SearchItem[]): SearchItem[] {
  const seen = new Set(prev.map((i) => `${i.source}:${i.id}`));
  const extra = next.filter((i) => !seen.has(`${i.source}:${i.id}`));
  return extra.length ? [...prev, ...extra] : prev;
}

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [FormsModule, BadgeComponent, FilterBarComponent, EmptyComponent, ModelCardComponent, PageHeaderComponent, PanelComponent],
  template: `
    <!-- 分层页头（VIS §3.7.7 定稿）：kicker 只标区，视图切换用 segmented -->
    <ui-page-header
      kicker="Models"
      title="发现模型"
      hint="跨源搜索合并为一个列表。"
      [viewOptions]="viewOptions"
      view="discover"
      (viewChange)="onViewChange($event)"
    />

    <!-- 一行筛选条（VIS §3.7.8 定稿）：搜索框 → 站点筛选 → 「筛选」浮层
         → 排序 → 视图切换 → 结果读数与清除全部。搜索改为停 300ms 自动发一次，
         不再要人点「搜索」按钮。 -->
    @if (rows.length > 0 || loading) {
      <ui-filter-bar
        [search]="q"
        searchPlaceholder="搜索模型关键词，如 qwen"
        [searchDebounceMs]="300"
        searchTestId="search-input"
        (searchChange)="onSearch($event)"
        [sites]="siteChips"
        [site]="source"
        (siteChange)="setSource($event)"
        [facets]="facetGroups"
        [facetSelected]="facetSelected"
        (facetChange)="onFacetChange($event)"
        [sortOptions]="sortOptions"
        [sort]="sort"
        (sortChange)="setSort($event)"
        [view]="view"
        (viewChange)="setView($event)"
        [count]="loading && rows.length === 0 ? null : rows.length + (done ? '' : '+')"
        [total]="hasFilter ? rawCount : null"
        unit="个模型"
        [hasFilter]="hasFilter"
        (clearAll)="clearAll()"
        [facts]="facts"
        [loading]="loading && rows.length === 0"
        [progress]="loading && rows.length ? '检索中…' : ''"
        refreshLabel="重新检索"
        (refresh)="searchNow()"
      />
    }

    @for (e of errors; track e.label) {
      <div class="notice err" role="alert">{{ e.label }} 搜索失败：{{ e.message }}</div>
    }

    <!-- 首次加载骨架：形状与海报卡一致，不要先给一个列表再跳成网格 -->
    @if (loading && rows.length === 0) {
      <div class="grid">
        @for (i of skeletons; track i) {
          <div class="skel-card">
            <div class="skeleton skel-line sk-w-40"></div>
            <div class="skeleton skel-line sk-w-80"></div>
            <div class="skeleton skel-line sk-w-60"></div>
          </div>
        }
      </div>
    }

    <!-- 网格视图 -->
    @if (view === 'grid' && rows.length > 0) {
      <div class="grid">
        @for (row of rows; track row.id) {
          <md-model-card
            [items]="row.items"
            [cover]="cache.cover(coverKey(row))"
            [inLibrary]="row.inLibrary"
            (download)="openDialog(row)"
          />
        }
      </div>
    }

    <!-- 列表视图 -->
    @if (view === 'list' && rows.length > 0) {
      <ui-panel title="搜索结果" [hint]="rows.length + ' 个模型'">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th class="col-source">来源</th>
                <th class="col-review">任务</th>
                <th class="col-size">下载量</th>
                <th class="col-size">点赞</th>
                <th class="col-size">更新</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows; track row.id) {
                <tr>
                  <td>
                    <div class="cell-name">{{ row.items[0].name }}</div>
                    <div class="mono muted cell-path">{{ row.items[0].author }}</div>
                  </td>
                  <td>
                    <div class="pill-row">
                      @for (it of row.items; track it.source) {
                        <a
                          class="pill pill-link"
                          [href]="it.url"
                          target="_blank"
                          rel="noreferrer"
                          [title]="'打开 ' + sourceLabel(it.source) + ' 上的原始仓库'"
                        >
                          {{ sourceLabel(it.source) }}
                        </a>
                      }
                    </div>
                  </td>
                  <td>
                    @if (row.items[0].task) {
                      <span class="pill">{{ taskLabel(row.items[0].task) }}</span>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>{{ fmtNum(maxDownloads(row)) }}</td>
                  <td>{{ fmtNum(maxLikes(row)) }}</td>
                  <td class="muted">{{ latestUpdate(row) }}</td>
                  <td>
                    <div class="toolbar">
                      @if (row.inLibrary) {
                        <ui-badge tone="green">已在库</ui-badge>
                      }
                      <button class="primary btn-xs" (click)="openDialog(row)">下载</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ui-panel>
    }

    @if (rows.length > 0 && !done) {
      <div class="mc-more">
        <button (click)="loadMore()" [disabled]="loading">{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    }

    <!-- 空状态 + 热门关键词 -->
    @if (!loading && rows.length === 0) {
      <ui-panel>
        <ui-empty title="没有找到匹配的模型" hint="换个关键词、切换下载源，或从下面这几个人人都搜的词开始。" />
        <div class="chip-row center">
          @for (kw of hotKeywords; track kw) {
            <button class="filter-chip" (click)="searchKeyword(kw)">{{ kw }}</button>
          }
        </div>
      </ui-panel>
    }

    <!-- 行内下载弹层（多来源可切换） -->
    @if (dlg) {
      <div class="modal-overlay" (click)="closeDialog()">
        <!-- 弹层三件套（VIS §7.2）：role=dialog + aria-modal + aria-labelledby，
             焦点陷阱用 core/a11y.ts 的 trapTab，Esc 关最顶层。 -->
        <div
          #downloadDialog
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="download-dialog-title"
          tabindex="-1"
          (click)="$event.stopPropagation()"
          (keydown.tab)="trapTab($event, downloadDialog)"
          (keydown.escape)="closeDialog()"
        >
          <div class="modal-head">
            <div class="modal-title">
              <strong class="mc-title" id="download-dialog-title">{{ activeItem()?.name }}</strong>
              <span class="muted">
                {{ sourceLabel(activeItem()?.source || '') }}
                @if (activeItem()?.author) {
                  · {{ activeItem()?.author }}
                }
              </span>
            </div>
            <span class="grow"></span>
            <button class="ghost btn-xs" (click)="closeDialog()" title="关闭">✕</button>
          </div>

          @if (dlg.row.items.length > 1) {
            <div class="toolbar mb">
              <span class="muted">下载来源</span>
              <div class="segmented">
                @for (it of dlg.row.items; track it.source) {
                  <button [class.active]="dlg.active === $index" (click)="switchSource($index)">
                    {{ sourceLabel(it.source) }}
                  </button>
                }
              </div>
            </div>
          }

          @if (dlg.done) {
            <ui-empty icon="✅" title="已创建下载任务" hint="文件正在后台下载，可到下载任务页查看进度。">
              <button class="primary" data-testid="dialog-goto-tasks" (click)="gotoTasks()">查看下载任务</button>
            </ui-empty>
          } @else {
            @if (dlg.loading) {
              <p class="muted">解析仓库文件中…</p>
            }
            @if (dlg.error) {
              <div class="notice err" role="alert">{{ dlg.error }}</div>
            }
            @if (dlg.repo) {
              <div class="toolbar mb">
                <span class="muted">保存位置（自动）</span>
                @if (dlgFolderPlan().length) {
                  <span class="pill-row">
                    @for (g of dlgFolderPlan(); track g.id) {
                      <span class="pill" [title]="g.id">{{ g.id }} · {{ g.count }}</span>
                    }
                  </span>
                } @else {
                  <span class="muted">按文件自动归类</span>
                }
              </div>

              @if (dlg.allWeights.length === 0) {
                <div class="notice">
                  这个仓库里没有可下载的权重文件。config / tokenizer / README 等非权重文件已隐藏。
                </div>
              } @else {
                @if (dlg.matchedWeights.length === 0 && !dlg.showAllWeights) {
                  <div class="notice">
                    这个仓库的权重是 Diffusers 分片格式（如 model-00001-of-00014），ComfyUI 不能直接加载，默认没有勾选。
                    可展开全部权重手动选择，或回发现页找同一模型的 Comfy-Org 单文件版本。
                    <button (click)="toggleAllWeights()">查看全部权重 ({{ dlg.allWeights.length }})</button>
                  </div>
                }
                <div class="toolbar mb">
                  <span class="muted">
                    {{ dlg.showAllWeights ? '全部权重' : '匹配权重' }} {{ currentFiles().length }} 个 ·
                    已选 {{ dlg.selected.size }} 个 / {{ fmtSize(dlgSize()) }}
                  </span>
                  <span class="grow"></span>
                  @if (dlg.allWeights.length > dlg.matchedWeights.length) {
                    <button (click)="toggleAllWeights()">
                      {{ dlg.showAllWeights ? '只看匹配权重' : '查看全部权重 (' + dlg.allWeights.length + ')' }}
                    </button>
                  }
                  <button (click)="toggleAllDlg()">{{ allVisibleSelected() ? '取消全选' : '全选' }}</button>
                </div>
                @if (currentFiles().length) {
                  <div class="table-wrap dlg-files" data-testid="dialog-files">
                    <table>
                      <tbody>
                        @for (f of currentFiles(); track f.path) {
                          <tr>
                            <td class="col-check">
                              <input
                                type="checkbox"
                                [checked]="dlg.selected.has(f.path)"
                                (change)="toggleDlgFile(f.path, $event)"
                              />
                            </td>
                            <td class="mono">{{ f.path }}</td>
                            <td class="col-size">{{ fmtSize(f.size) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
                <div class="toolbar mt">
                  <button
                    class="primary"
                    data-testid="dialog-create"
                    (click)="createTask()"
                    [disabled]="dlg.selected.size === 0 || dlg.creating"
                  >
                    {{ dlg.creating ? '创建中…' : '下载所选 · ' + fmtSize(dlgSize()) }}
                  </button>
                  <span class="muted">目录自动归类 · 策略：{{ dlgStrategy }}</span>
                </div>
              }
            }
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      /* 骨架用海报卡的形状，加载完不会从「一列文本」跳成「一格格海报」。
         高度取资产卡骨架登记的 min-height（235px，asset-card.css），
         与本地库同值 —— 骨架与卡片不等高，首屏落地时整墙会跳一次。 */
      .skel-card {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 7px;
        min-height: 235px;
        padding: 13px;
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: inset 0 0 0 1px var(--border);
        pointer-events: none;
      }

      .chip-row.center { justify-content: center; }

      /* 列表视图里来源徽章也是入口：点它直接去原始仓库。去掉下划线，
         箭头留在徽章文字里，不靠颜色表达「可点」。 */
      .src-badge { text-decoration: none; display: inline-flex; }

      .modal-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .modal-title .muted { font-size: 11.5px; }
      .modal { width: min(720px, 100%); }
    `,
  ],
})
export class DiscoverComponent implements OnInit, OnDestroy {
  q = '';
  source = 'all';
  sort = 'trending';
  task = '';
  view: 'grid' | 'list' = 'grid';
  showDemo = false;
  readonly sortOptions = SORT_OPTIONS;
  readonly viewOptions = VIEW_OPTIONS;

  rows: MergedRow[] = [];
  errors: SourceError[] = [];
  loading = false;
  done = false;

  sourceTabs: { key: string; label: string }[] = [];
  dlg: DownloadDialog | null = null;
  dlgStrategy = 'direct';

  @ViewChild('downloadDialog') downloadDialog?: ElementRef<HTMLElement>;

  /** 弹层的 Tab 焦点陷阱（core/a11y.ts 的通用件） */
  readonly trapTab = trapTab;

  readonly hotKeywords = HOT_KEYWORDS;
  readonly skeletons = [1, 2, 3, 4, 5];

  private rawItems: SearchItem[] = [];
  private page = 1;
  private libraryKeys = new Set<string>();
  private suppressParamSync = false;
  /** 封面批次号：重新搜索时自增，旧批次的回调直接丢弃 */
  private coverBatch = 0;
  /** 每次 fetchPage 自增，用来丢弃过期响应（连续改筛选时会有多条在飞） */
  private fetchToken = 0;
  /** 各来源的到达情况，按标签顺序拼成列表 */
  private perSource = new Map<string, { items: SearchItem[]; full: boolean; error: string }>();

  readonly cache = inject(DiscoverCacheService);

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private probe: ProbeService,
  ) {}

  ngOnInit(): void {
    // 探针结论决定哪些来源站可选（不可达 / 未探测的灰置不可点）
    this.probe.ensure();
    this.route.queryParams.subscribe((p) => {
      if (this.suppressParamSync) {
        this.suppressParamSync = false;
        return;
      }
      const q = p['q'] ?? '';
      const source = p['source'] ?? 'all';
      const sort = p['sort'] ?? 'trending';
      const task = p['task'] ?? '';
      const view = p['view'] === 'list' ? 'list' : 'grid';
      const changed =
        q !== this.q || source !== this.source || sort !== this.sort || task !== this.task || view !== this.view;
      if (!changed && this.sourceTabs.length) return;
      this.q = q;
      this.source = source;
      this.sort = sort;
      this.task = task;
      this.view = view;
      this.showDemo = p['demo'] === '1';
      this.bootstrap();
    });
  }

  ngOnDestroy(): void {
    this.coverBatch++; // 丢弃还在路上的封面回调
  }

  private bootstrap(): void {
    this.api.getSettings().subscribe((s) => {
      this.dlgStrategy = s.download?.strategy || s.default_strategy || 'direct';
      const tabs = Object.keys(s.sources || {})
        .filter((k) => (k === 'demo' ? this.showDemo : ['huggingface', 'modelscope', 'civitai'].includes(k)))
        .map((k) => ({ key: k, label: SOURCE_LABELS[k] || s.sources[k].label || k }));
      this.sourceTabs = [{ key: 'all', label: '全部' }, ...tabs];
      if (this.source !== 'all' && !s.sources?.[this.source]) {
        this.source = 'all';
      }
      this.applyFilters();
    });
    this.api.listLibrary({}).subscribe((models) => {
      this.libraryKeys = new Set(models.map((m) => `${m.source}/${m.repo_id}`));
    });
  }

  // ---------- 搜索触发 ----------

  /** 搜索框回填：筛选条停 300ms 触发一次，不用再点「搜索」 */
  onSearch(v: string): void {
    if (v === this.q) return;
    this.q = v;
    this.searchNow();
  }

  searchNow(): void {
    this.applyFilters();
  }

  /** 检索到的原始条数（合并前的总量）：有筛选时读数写成「42 / 128」 */
  get rawCount(): number {
    return this.rawItems.length;
  }

  /** 站点筛选（行内 chip 行）：来源站 + 探针门控 */
  get siteChips(): FilterSite[] {
    return this.sourceTabs.map((t) => ({
      key: t.key,
      label: t.key === 'all' ? '全部站点' : t.label,
      disabled: t.key === 'all' ? false : this.probe.isGated(t.key),
      tip: t.key === 'all' ? '' : this.probe.tip(t.key),
    }));
  }

  /** 「筛选」浮层里的分组：任务类型 */
  get facetGroups(): FilterFacetGroup[] {
    if (!this.taskChips.length) return [];
    return [
      {
        key: 'task',
        label: '任务类型',
        options: this.taskChips.map((c) => ({
          key: c.key,
          label: this.taskLabel(c.key),
          count: c.count,
        })),
      },
    ];
  }

  /** 浮层里已点亮的 chip */
  get facetSelected(): Record<string, string[]> {
    return { task: this.task ? [this.task] : [] };
  }

  onFacetChange(e: FilterFacetChange): void {
    if (e.group !== 'task') return;
    this.setTask(e.on ? e.key : '');
  }

  get hasFilter(): boolean {
    return !!this.q.trim() || this.source !== 'all' || !!this.task;
  }

  /** 清除全部筛选 */
  clearAll(): void {
    this.q = '';
    this.source = 'all';
    this.task = '';
    this.searchNow();
  }

  /** 视图切换：本地库 ↔ 发现 */
  onViewChange(key: string): void {
    if (key === 'mine') this.router.navigate(['/models']);
    else this.router.navigate(['/models/discover']);
  }

  searchKeyword(kw: string): void {
    this.q = kw;
    this.searchNow();
  }

  setSource(key: string): void {
    if (this.source === key) return;
    this.source = key;
    this.searchNow();
  }

  setSort(sort: string): void {
    if (this.sort === sort) return;
    this.sort = sort;
    this.searchNow();
  }

  setTask(task: string): void {
    if (this.task === task) return;
    this.task = task;
    this.searchNow();
  }

  setView(view: 'grid' | 'list'): void {
    this.view = view;
    this.syncUrl();
  }

  private applyFilters(): void {
    const key = this.searchKey();
    const hit = this.cache.getSearch(key);
    if (hit) {
      // 有缓存就先渲染，别让人对着骨架屏等三秒
      this.rawItems = hit.items;
      this.errors = hit.errors;
      this.done = hit.done;
      this.page = hit.page;
      // 关键：perSource 也要按来源分组回填。缓存里只有扁平的 items，
      // 不回填的话点「加载更多」时 prev 不存在，下一页会直接覆盖第一页。
      this.perSource.clear();
      for (const item of this.rawItems) {
        const group = this.perSource.get(item.source);
        if (group) group.items.push(item);
        else this.perSource.set(item.source, { items: [item], full: true, error: '' });
      }
      this.rows = this.buildRows(this.rawItems);
      this.loading = false;
      this.fetchCovers(this.rows);
      if (hit.fresh) return;
      this.fetchPage(1); // 过期了：先给旧结果，再后台刷新
      return;
    }
    this.page = 1;
    this.rawItems = [];
    this.rows = [];
    this.errors = [];
    this.done = false;
    this.fetchPage(1);
  }

  private searchKey(): string {
    return `${this.q.trim().toLowerCase()}|${this.source}|${this.sort}|${this.task}`;
  }

  /** 一组来源的稳定标识：只跟「哪些源、哪些仓库」有关，不含排序 */
  coverKey(row: MergedRow): string {
    return row.items
      .map((i) => `${i.source}:${i.id}`)
      .sort()
      .join('|');
  }

  /**
   * 封面补齐：先用兜底铭牌把页面铺满，图取回来再替换。
   *
   * **一次请求发完，不要分批串行**：分 4 批、每批等上一批回来再做，实测把
   * 56 组的冷启动从 4 s 拖到 16 s——每批都在等自己那组最慢的仓库。一把发完
   * 由服务端 16 路并发去取，尾部延迟只付一次。
   */
  private fetchCovers(rows: MergedRow[]): void {
    const batch = ++this.coverBatch;
    const pending = rows.filter((r) => !this.cache.hasCover(this.coverKey(r)));
    if (!pending.length) return;
    const groups = pending.slice(0, 60).map((r) => ({
      key: this.coverKey(r),
      items: r.items.map((i) => ({ source: i.source, id: i.id, image: i.image || '' })),
    }));
    this.api.covers(groups).subscribe({
      next: (res) => {
        if (batch !== this.coverBatch) return;
        for (const g of groups) this.cache.putCover(g.key, res.covers[g.key] || '');
      },
      // 取不到封面只是退回家族铭牌，不该冒错误提示
      error: () => {
        if (batch === this.coverBatch) for (const g of groups) this.cache.putCover(g.key, '');
      },
    });
  }

  loadMore(): void {
    this.fetchPage(this.page + 1);
  }

  // ---------- 并发搜索 + 跨源合并 ----------

  /**
   * 三源各发一条请求，**谁先回来谁先渲染**。
   *
   * 不用 forkJoin 等齐：Civitai 关键词搜索带 20 个模型的完整图集会返回几 MB，
   * 实测 5~12 s，而魔搭只要 1 s。等齐的话首屏要陪着最慢的那个站一起卡着，
   * 明明已经能看的卡片也显示不出来。
   *
   * 顺序仍然稳定：`rawItems` 按来源标签的固定顺序拼接，不按到达顺序，
   * 所以晚到的来源只会往下追加，不会把已有卡片顶走。
   */
  private fetchPage(page: number): void {
    const sources = this.source === 'all' ? this.enabledSources() : [this.source];
    if (!sources.length) {
      this.loading = false;
      return;
    }
    const token = ++this.fetchToken;
    if (page === 1) {
      this.perSource.clear();
      this.rawItems = [];
      this.rows = [];
    }
    this.loading = true;

    for (const key of sources) {
      this.api.search({ q: this.q, source: key, sort: this.sort, task: this.task, limit: PAGE_SIZE, page }).subscribe({
        next: (res) => {
          if (token !== this.fetchToken) return;
          const prev = this.perSource.get(key);
          // 翻页追加时按 (source,id) 去重：上游分页异常（例如 Civitai 曾忽略 page
          // 参数，三页返回同一批）会让同一张卡重复出现，合并这一步兜住它。
          const merged = page === 1 || !prev ? res.items : mergeUnique(prev.items, res.items);
          this.perSource.set(key, {
            items: merged,
            full: res.items.length >= PAGE_SIZE,
            error: '',
          });
          this.applyResults(page, token);
        },
        error: (err) => {
          if (token !== this.fetchToken) return;
          this.perSource.set(key, { items: [], full: false, error: errMsg(err, '搜索失败，请检查网络') });
          this.applyResults(page, token);
        },
      });
    }
  }

  /** 把已到达的来源拼成列表；每次有来源回来都跑一次。 */
  private applyResults(page: number, token: number): void {
    const order = ['huggingface', 'modelscope', 'civitai', 'demo'];
    const keys = [...this.perSource.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const expected = this.source === 'all' ? this.enabledSources() : [this.source];
    const allBack = expected.every((k) => this.perSource.has(k));

    this.rawItems = keys.flatMap((k) => this.perSource.get(k)?.items || []);
    this.errors = keys
      .filter((k) => !!this.perSource.get(k)?.error)
      .map((k) => ({ label: SOURCE_LABELS[k] || k, message: this.perSource.get(k)!.error }));
    // 还没回来的来源视为「可能还有下一页」，别提前把「加载更多」收起来
    this.done = allBack && expected.every((k) => !this.perSource.get(k)?.full);
    this.page = page;
    this.rows = this.buildRows(this.rawItems);
    // 只要有一家回来了就不再显示骨架屏——剩下的空位由后续来源补
    this.loading = false;
    this.syncUrl();
    this.fetchCovers(this.rows);

    if (page === 1 && allBack && !this.errors.length && token === this.fetchToken) {
      this.cache.putSearch(this.searchKey(), {
        items: this.rawItems,
        errors: this.errors,
        done: this.done,
        page: this.page,
      });
    }
  }

  private enabledSources(): string[] {
    return this.sourceTabs.filter((t) => t.key !== 'all').map((t) => t.key);
  }

  /** 归一化模型名作为跨源归并键 */
  private mergeKey(item: SearchItem): string {
    const raw = item.name || item.id.split('/').pop() || item.id;
    return raw
      .toLowerCase()
      .replace(/[（）()]/g, '')
      .replace(/[\s._\-/]+/g, '');
  }

  /** 短名/泛化名（如 lora、flux2）容易撞名，只对足够具体的名字做跨源合并 */
  private canMerge(key: string): boolean {
    return key.length >= 6;
  }

  private buildRows(items: SearchItem[]): MergedRow[] {
    const map = new Map<string, MergedRow>();
    const rows: MergedRow[] = [];
    for (const item of items) {
      const key = this.mergeKey(item);
      const row = map.get(key);
      // 同源同名视为不同模型（可能是不同作者的同名仓库），单起一行，绝不丢弃
      if (!row || !this.canMerge(key) || row.items.some((i) => i.source === item.source)) {
        const fresh: MergedRow = {
          key,
          id: `${item.source}/${item.id}`,
          inLibrary: false,
          items: [item],
        };
        rows.push(fresh);
        if (!row) map.set(key, fresh);
        continue;
      }
      row.items.push(item);
    }
    for (const row of rows) {
      row.inLibrary = row.items.some((i) => this.libraryKeys.has(`${i.source}/${i.id}`));
    }
    return this.sortRows(rows);
  }

  private sortRows(rows: MergedRow[]): MergedRow[] {
    // 综合：保留各站点返回的原始顺序，与官网默认排序一致
    if (this.sort === 'trending') return rows;
    return rows.sort((a, b) => {
      if (this.sort === 'likes') return this.maxLikes(b) - this.maxLikes(a);
      if (this.sort === 'recent') return this.latestUpdate(b).localeCompare(this.latestUpdate(a));
      return this.maxDownloads(b) - this.maxDownloads(a);
    });
  }

  // ---------- 派生展示 ----------

  /** 事实槽：当前结果里实际出现的来源数 + 已在库条数（只读，不抢筛选控制） */
  get facts(): CollectionFact[] {
    const sources = new Set(this.rows.flatMap((r) => r.items.map((i) => i.source))).size;
    const inLib = this.rows.filter((r) => r.inLibrary).length;
    return [
      { label: '合并', value: `${sources} 个来源`, title: '当前结果覆盖的来源数' },
      inLib
        ? { label: '已入库', value: String(inLib), tone: 'ok' as const }
        : { label: '已入库', value: '0' },
    ];
  }

  get taskChips(): { key: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const item of this.rawItems) {
      if (item.task) counts.set(item.task, (counts.get(item.task) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  maxDownloads(row: MergedRow): number {
    return Math.max(...row.items.map((i) => i.downloads || 0), 0);
  }

  maxLikes(row: MergedRow): number {
    return Math.max(...row.items.map((i) => i.likes || 0), 0);
  }

  latestUpdate(row: MergedRow): string {
    return row.items.reduce((max, i) => (i.updated_at > max ? i.updated_at : max), '').slice(0, 10);
  }

  // ---------- URL 同步 ----------

  private syncUrl(): void {
    const params: Record<string, string> = {};
    if (this.q) params['q'] = this.q;
    if (this.source !== 'all') params['source'] = this.source;
    if (this.sort !== 'trending') params['sort'] = this.sort;
    if (this.task) params['task'] = this.task;
    if (this.view !== 'grid') params['view'] = this.view;
    if (this.showDemo) params['demo'] = '1';
    this.suppressParamSync = true;
    this.router.navigate([], { queryParams: params, replaceUrl: true }).then(() => {
      this.suppressParamSync = false;
    });
  }

  // ---------- 行内下载弹层 ----------

  openDialog(row: MergedRow): void {
    rememberFocus();
    this.dlg = {
      row,
      active: 0,
      repo: null,
      selected: new Set(),
      allWeights: [],
      matchedWeights: [],
      showAllWeights: false,
      loading: true,
      creating: false,
      done: false,
      error: '',
    };
    this.loadRepo();
    // 焦点要跟着进弹层，否则键盘用户还得从页面顶部 Tab 过来（VIS §7.2）
    setTimeout(() => focusFirst(this.downloadDialog?.nativeElement));
  }

  activeItem(): SearchItem | null {
    return this.dlg ? this.dlg.row.items[this.dlg.active] : null;
  }

  switchSource(index: number): void {
    if (!this.dlg || this.dlg.active === index) return;
    this.dlg.active = index;
    this.dlg.repo = null;
    this.dlg.selected = new Set();
    this.dlg.allWeights = [];
    this.dlg.matchedWeights = [];
    this.dlg.showAllWeights = false;
    this.dlg.error = '';
    this.dlg.done = false;
    this.loadRepo();
  }

  private loadRepo(): void {
    const dialog = this.dlg;
    const item = this.activeItem();
    if (!dialog || !item) return;
    dialog.loading = true;
    dialog.error = '';
    this.api.resolve(item.source, item.id, '', item.task).subscribe({
      next: (repo) => {
        if (!this.dlg || this.dlg !== dialog || this.dlg.active !== dialog.active) return;
        const allWeights = weightFiles(repo.files);
        const matchedWeights = matchedWeightFiles(repo.files, repo.display_name || repo.repo_id);
        this.dlg.repo = repo;
        this.dlg.allWeights = allWeights;
        this.dlg.matchedWeights = matchedWeights;
        this.dlg.showAllWeights = false;
        // 默认只下匹配权重；config / tokenizer / README 等非权重文件不进入勾选集
        this.dlg.selected = new Set(matchedWeights.map((f) => f.path));
        this.dlg.loading = false;
      },
      error: (err) => {
        if (!this.dlg || this.dlg !== dialog) return;
        this.dlg.error = errMsg(err, '解析失败，请检查模型 ID / 网络 / token');
        this.dlg.loading = false;
      },
    });
  }

  closeDialog(): void {
    this.dlg = null;
    // 关掉之前先把焦点还回去（VIS §7.2 三件套的第三件）
    restoreFocus();
  }

  dlgSize(): number {
    if (!this.dlg?.repo) return 0;
    return this.dlg.repo.files
      .filter((f) => this.dlg!.selected.has(f.path))
      .reduce((sum, f) => sum + f.size, 0);
  }

  toggleDlgFile(path: string, event: Event): void {
    if (!this.dlg) return;
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.dlg.selected.add(path);
    else this.dlg.selected.delete(path);
  }

  currentFiles(): RemoteFile[] {
    if (!this.dlg) return [];
    return this.dlg.showAllWeights ? this.dlg.allWeights : this.dlg.matchedWeights;
  }

  allVisibleSelected(): boolean {
    const files = this.currentFiles();
    return files.length > 0 && files.every((f) => !!this.dlg?.selected.has(f.path));
  }

  toggleAllWeights(): void {
    if (!this.dlg) return;
    this.dlg.showAllWeights = !this.dlg.showAllWeights;
  }

  /** 自动归类结果：每个 ComfyUI 目录会落几个文件（只统计当前视图里的权重） */
  dlgFolderPlan(): { id: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const f of this.currentFiles()) {
      const key = f.folder || 'checkpoints';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({ id, count }));
  }

  toggleAllDlg(): void {
    const dialog = this.dlg;
    const files = this.currentFiles();
    if (!dialog || !files.length) return;
    if (files.every((f) => dialog.selected.has(f.path))) {
      for (const f of files) dialog.selected.delete(f.path);
    } else {
      for (const f of files) dialog.selected.add(f.path);
    }
  }

  createTask(): void {
    const item = this.activeItem();
    if (!this.dlg?.repo || !item) return;
    this.dlg.creating = true;
    this.dlg.error = '';
    this.api
      .createTask({
        source: item.source,
        repo_id: this.dlg.repo.repo_id,
        revision: this.dlg.repo.revision,
        files: [...this.dlg.selected],
        strategy: this.dlgStrategy,
        task: item.task,
      })
      .subscribe({
        next: () => {
          if (this.dlg) {
            this.dlg.creating = false;
            this.dlg.done = true;
            this.dlg.row.inLibrary = true;
            this.libraryKeys.add(`${item.source}/${item.id}`);
          }
        },
        error: (err) => {
          if (this.dlg) {
            this.dlg.creating = false;
            this.dlg.error = errMsg(err, '创建任务失败');
          }
        },
      });
  }

  gotoTasks(): void {
    this.router.navigate(['/downloads']);
  }

  // ---------- 展示辅助 ----------

  sourceLabel(key: string): string {
    return SOURCE_LABELS[key] || key;
  }

  taskLabel(task: string): string {
    return sourceTaskLabel(task);
  }

  fmtNum = fmtNum;
  fmtSize = fmtSize;
}
