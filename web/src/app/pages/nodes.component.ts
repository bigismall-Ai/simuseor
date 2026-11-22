import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errMsg, fmtNum, NodeItem, NodeStats } from '../core/types';
import { NodeInstallService } from '../core/node-install.service';
import { BadgeComponent } from '../ui/badge.component';
import {
  CollectionFact,
  FilterBarComponent,
  FilterFacetChange,
  FilterFacetGroup,
} from '../ui/filter-bar.component';
import { EmptyComponent } from '../ui/empty.component';
import { NodeCardComponent } from '../ui/node-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

const PAGE_SIZE = 20;

/** 分类由后端给出（多源自 ComfyUI-Manager 清单推断），前端不写死 */

const SORTS = [
  { key: 'nodes', label: '按节点数' },
  { key: 'name', label: '按名称' },
];

/** 视图切换（segmented）：本地库 / 发现 */
const VIEW_OPTIONS = [
  { key: 'mine', label: '本地库' },
  { key: 'discover', label: '发现' },
];

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [
    FormsModule,
    BadgeComponent,
    FilterBarComponent,
    EmptyComponent,
    NodeCardComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <!-- 分层页头（VIS §3.7.7 定稿）：kicker 只标区，视图切换用 segmented -->
    <ui-page-header
      kicker="Nodes"
      title="发现节点"
      hint="搜节点扩展，装上就能用。"
      [viewOptions]="viewOptions"
      view="discover"
      (viewChange)="onViewChange($event)"
    />

    @if (items.length || loading) {
      <!-- 一行筛选条（VIS §3.7.8 定稿）：搜索框 → 「筛选」浮层（类型）
           → 排序 → 结果读数与清除全部。清单只来自 ComfyUI-Manager 一个源，
           行内不放站点 chip。 -->
      <ui-filter-bar
        [search]="q"
        searchPlaceholder="搜扩展名或节点名，如 impact / sam / controlnet"
        [searchDebounceMs]="300"
        searchTestId="node-search"
        (searchChange)="onSearch($event)"
        [facets]="facetGroups"
        [facetSelected]="facetSelected"
        (facetChange)="onFacetChange($event)"
        [sortOptions]="sorts"
        [sort]="sort"
        (sortChange)="setSort($event)"
        [count]="loading && !items.length ? null : fmtInt(total)"
        [total]="null"
        unit="个扩展"
        [hasFilter]="hasFilter"
        (clearAll)="clearAll()"
        [facts]="facts"
        [loading]="loading && !items.length"
        [progress]="refreshing ? '刷新清单中…' : loading && items.length ? '加载中…' : ''"
        refreshLabel="重新拉取 ComfyUI-Manager 清单"
        (refresh)="refreshCatalog()"
      />
    }

    @if (errorText) {
      <div class="notice err" role="alert">{{ errorText }}</div>
    }
    @if (notice) {
      <div class="notice ok">{{ notice }}</div>
    }

    <!-- 安装进度和日志：任务只有一个，放在列表上方，翻页也不会跟丢 -->
    @if (install.job) {
      <ui-panel class="nd-job-panel">
        <div class="nd-job">
          <div class="nd-job-head">
            <strong>{{ install.job.name || install.job.node }}</strong>
            <ui-badge [tone]="jobTone()">{{ install.job.stage }}</ui-badge>
            <span class="nd-job-pct">{{ install.job.percent }}%</span>
            @if (install.job.status !== 'running') {
              <button class="btn-xs nd-dismiss" (click)="install.dismiss()">收起</button>
            }
          </div>
          <div class="nd-bar"><span [style.width.%]="install.job.percent"></span></div>
          @if (install.job.logs.length) {
            <div class="nd-log">
              @for (line of tailLogs(); track $index) {
                <div>{{ line.line }}</div>
              }
            </div>
          }
          @if (install.job.error) {
            <div class="notice err" role="alert">{{ install.job.error }}</div>
          }
          @if (install.job.status === 'done') {
            <div class="notice ok">
              安装完成{{ install.job.dir ? '（目录 ' + install.job.dir + '）' : '' }}，重启实例后生效。
            </div>
          }
        </div>
      </ui-panel>
    }

    @if (!loading && !items.length && !errorText) {
      <ui-empty title="没有找到节点" hint="换个关键词，或点「刷新清单」重新拉取。" />
    }

    <!-- 列表：一行扩展 → 一张资产卡（骨架与模型卡 / 工作流卡共用） -->
    <div class="nd-list">
      @for (it of items; track it.id) {
        <md-node-card
          [item]="it"
          [installing]="install.installingId === it.id && install.job?.status === 'running'"
          [percent]="install.job?.percent ?? 0"
          [stage]="install.job?.stage ?? ''"
          [busy]="install.busy || loading"
          (install)="installItem(it)"
        />
      }
    </div>

    @if (items.length && !done) {
      <div class="mc-more">
        <button (click)="loadMore()" [disabled]="loading">{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    }
  `,
  styles: `
    .nd-filters {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .nd-sort {
      display: flex;
      gap: 6px;
    }
    .nd-sum {
      margin-top: 10px;
      font-size: 11.5px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 30px;
    }
    .nd-sum .nd-sort {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }

    /* 列表：一行扩展 → 一张卡。列宽给个下限，窄屏自动收成一列。 */
    .nd-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
      gap: 12px;
    }

    .nd-job-panel { margin-bottom: 0; }
    .nd-job-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nd-job-head strong { font-size: 13px; }
    .nd-job-pct {
      margin-left: auto;
      font-size: 12.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .nd-dismiss { margin-left: 6px; }

    .nd-bar {
      height: 4px;
      border-radius: 999px;
      background: var(--panel-3);
      overflow: hidden;
      margin: 10px 0 0;
    }
    .nd-bar span {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 0.4s ease;
    }

    .nd-log {
      margin-top: 8px;
      max-height: 132px;
      overflow-y: auto;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 10.5px;
      line-height: 1.7;
      color: var(--muted);
      background: var(--panel-2);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
    }

    @media (max-width: 760px) {
      .nd-list { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    }
  `,
})
export class NodesComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  install = inject(NodeInstallService);
  private router = inject(Router);
  private sub?: Subscription;

  readonly sorts = SORTS;
  q = '';
  category = '';
  categories: { id: string; label: string; count: number }[] = [];
  readonly viewOptions = VIEW_OPTIONS;
  sort = 'nodes';
  items: NodeItem[] = [];
  loading = false;
  refreshing = false;
  done = true;
  page = 1;
  total = 0;
  installedCount = 0;
  stats: NodeStats | null = null;
  notice = '';
  errorText = '';

  /** 事实槽：节点类总量（清单统计）+ 已安装数；刷新走状态条右端 */
  get facts(): CollectionFact[] {
    return [
      {
        label: '节点类',
        value: this.stats ? this.fmtInt(this.stats.node_classes) : '—',
        title: 'ComfyUI-Manager 清单里的节点类总数',
      },
      {
        label: '已安装',
        value: this.fmtInt(this.installedCount),
        tone: this.installedCount ? 'ok' : undefined,
        title: '当前清单里已安装的扩展数',
      },
    ];
  }

  ngOnInit(): void {
    this.load(1);
    this.api.nodeStats().subscribe({
      next: (res) => (this.stats = res),
      error: () => (this.stats = null),
    });
    this.install.resume();
    // 装完 / 装失败都要重新取一次：已装标记与「未安装」筛选都依赖它
    this.sub = this.install.finished.subscribe((job) => {
      this.notice = job.status === 'done' ? `已安装 ${job.name || job.node}` : '';
      this.load(this.page);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  search(): void {
    this.load(1);
  }

  /** 分类按数量降序：浮层里整组列出，多的往下排 */
  get sortedCategories(): { id: string; label: string; count: number }[] {
    return [...this.categories].sort((a, b) => b.count - a.count);
  }

  /** 「筛选」浮层里的分组：扩展类型 */
  get facetGroups(): FilterFacetGroup[] {
    if (!this.categories.length) return [];
    return [
      {
        key: 'category',
        label: '类型',
        options: this.sortedCategories.map((c) => ({
          key: c.id,
          label: c.label,
          count: c.count,
        })),
      },
    ];
  }

  get facetSelected(): Record<string, string[]> {
    return { category: this.category ? [this.category] : [] };
  }

  onFacetChange(e: FilterFacetChange): void {
    if (e.group !== 'category') return;
    this.setCategory(e.on ? e.key : '');
  }

  /** 搜索框回填：停 300ms 自动检索一次 */
  onSearch(v: string): void {
    if (v === this.q) return;
    this.q = v;
    this.search();
  }

  get hasFilter(): boolean {
    return !!this.q.trim() || !!this.category;
  }

  /** 清除全部筛选 */
  clearAll(): void {
    this.q = '';
    this.category = '';
    this.load(1);
  }

  /** 视图切换：本地库 ↔ 发现 */
  onViewChange(key: string): void {
    if (key === 'mine') this.router.navigate(['/nodes']);
    else this.router.navigate(['/nodes/discover']);
  }

  setCategory(category: string): void {
    this.category = category;
    this.load(1);
  }

  setSort(sort: string): void {
    this.sort = sort;
    this.load(1);
  }

  loadMore(): void {
    this.load(this.page + 1);
  }

  refreshCatalog(): void {
    this.refreshing = true;
    this.errorText = '';
    this.api.refreshNodes().subscribe({
      next: (res) => {
        this.refreshing = false;
        this.notice = res.count ? `清单已更新：${fmtNum(res.count)} 个扩展` : '清单已是最近 24 小时的版本';
        this.load(1);
      },
      error: (err) => {
        this.refreshing = false;
        this.errorText = errMsg(err, '刷新清单失败，请检查网络');
      },
    });
  }

  installItem(item: NodeItem): void {
    this.notice = '';
    this.errorText = '';
    if (!this.install.start(item.id)) {
      this.errorText = '已有节点正在安装，请等它完成';
    }
  }

  tailLogs() {
    const logs = this.install.job?.logs || [];
    return logs.slice(-6);
  }

  jobTone(): 'blue' | 'green' | 'red' | 'gray' {
    const status = this.install.job?.status;
    if (status === 'done') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'running') return 'blue';
    return 'gray';
  }

  private load(page: number): void {
    this.loading = true;
    this.errorText = '';
    this.api
      .searchNodes({
        q: this.q.trim(),
        sort: this.sort,
        category: this.category,
        limit: PAGE_SIZE,
        page,
      })
      .subscribe({
        next: (res) => {
          const existing = new Set(this.items.map((i) => i.id));
          const incoming = page === 1 ? res.items : res.items.filter((i) => !existing.has(i.id));
          this.items = page === 1 ? res.items : [...this.items, ...incoming];
          this.total = res.total;
          this.installedCount = res.installed_count || 0;
          if (res.categories?.length) this.categories = res.categories;
          this.done = res.done || (page > 1 && incoming.length === 0);
          this.page = page;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.errorText = errMsg(err, '节点检索失败，请检查网络');
        },
      });
  }

  fmtNum = fmtNum;
  /** 节点规模用千分位，不缩写：6,045 比 6.0k 更能说明「这是多大的清单」 */
  readonly fmtInt = (n: number) => (n || 0).toLocaleString('en-US');
}
