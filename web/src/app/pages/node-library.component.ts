import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errMsg, fmtNum, InstalledNode, MissingProvider, NodeMissingReport, NodeStats } from '../core/types';
import { NodeInstallService } from '../core/node-install.service';
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

/** 排序：原生 select，选项「按 X」句式 */
const SORT_OPTIONS = [
  { key: 'name', label: '按名称' },
  { key: 'nodes', label: '按节点数' },
  { key: 'size', label: '按大小' },
];

/** 视图切换（segmented）：本地库 / 发现 */
const VIEW_OPTIONS = [
  { key: 'mine', label: '本地库' },
  { key: 'discover', label: '发现' },
];

@Component({
  selector: 'app-node-library',
  standalone: true,
  imports: [FormsModule, FilterBarComponent, EmptyComponent, NodeCardComponent, PageHeaderComponent, PanelComponent],
  template: `
    <!-- 分层页头（VIS §3.7.7 定稿）：kicker 只标区，视图切换用 segmented，
         本地页只留一个主操作，「去发现」由视图切换承担。 -->
    <ui-page-header
      kicker="Nodes"
      title="节点管理"
      hint="已装的节点包：提供了什么、缺哪些文件。"
      [viewOptions]="viewOptions"
      view="mine"
      (viewChange)="onViewChange($event)"
    >
      <button type="button" class="primary" (click)="check()" [disabled]="checking || loading">
        {{ checking ? '检测中…' : '检测缺失' }}
        @if (report?.missing_files) {
          <b class="ps-badge is-warn">{{ report?.missing_files }}</b>
        }
      </button>
    </ui-page-header>

    @if (installed.length || loading) {
      <!-- 一行筛选条（VIS §3.7.8 定稿）：搜索框 → 「筛选」浮层（启用状态）
           → 排序 → 结果读数与清除全部。已装节点没有来源站维度，行内不放站点 chip。 -->
      <ui-filter-bar
        [search]="q"
        searchPlaceholder="搜索已装扩展或目录"
        (searchChange)="q = $event"
        [facets]="facetGroups"
        [facetSelected]="facetSelected"
        (facetChange)="onFacetChange($event)"
        [sortOptions]="sortOptions"
        [sort]="sort"
        (sortChange)="setSort($event)"
        [count]="loading && !installed.length ? null : visibleInstalled.length"
        [total]="hasFilter ? installed.length : null"
        unit="个已安装"
        [hasFilter]="hasFilter"
        (clearAll)="clearAll()"
        [facts]="listFacts"
        [loading]="loading"
        [progress]="loading && installed.length ? '读取中…' : ''"
        refreshLabel="重新读取已装节点"
        (refresh)="load()"
      />
    }

    @if (checking || report || errorText || notice) {
      <ui-panel
        title="缺节点检测"
        hint="扫工作流库，把用到的节点和已装的扩展比一遍；装完新节点需要重启实例才生效。"
      >
      @if (checking) {
        <div class="notice info">正在扫描工作流并比对节点…</div>
      }
      @if (errorText) {
        <div class="notice err" role="alert">{{ errorText }}</div>
      }
      @if (notice) {
        <div class="notice ok">{{ notice }}</div>
      }

      @if (!report && !checking) {
        <p class="nl-hint">
          还没检测。点「检测缺失」会对 {{ stats?.installed ? '全部' : '' }}工作流跑一遍依赖比对，
          告诉你缺哪些扩展、能一键装哪个。
        </p>
      }

      @if (report) {
        @if (!report.missing_files) {
          <div class="notice ok">
            扫了 {{ report.scanned }} 个工作流，节点都齐了（可追踪 {{ fmtNum(report.installed_nodes) }} 个节点类）。
          </div>
        } @else {
          <div class="notice info">
            {{ report.scanned }} 个工作流里有 {{ report.missing_files }} 个缺节点，
            一共能对应 {{ report.providers.length }} 个扩展。
          </div>

          @if (report.providers.length) {
            <div class="nl-providers">
              @for (p of report.providers; track p.id) {
                <div class="nl-provider">
                  <div class="nl-provider-main">
                    <strong>{{ p.name }}</strong>
                    <span class="nl-provider-meta">
                      {{ p.files || 0 }} 个工作流需要 · 提供 {{ p.node_count }} 个节点
                    </span>
                    <span class="nl-provider-covers" [title]="p.covers.join('、')">
                      缺 {{ p.covers.slice(0, 3).join('、') }}{{ p.covers.length > 3 ? ' 等' : '' }}
                    </span>
                  </div>
                  @if (install.installingId === p.id && install.job?.status === 'running') {
                    <span class="nl-provider-pct">{{ install.job?.percent }}%</span>
                  } @else if (!p.installable) {
                    <span class="nl-provider-pct">不支持一键装</span>
                  } @else {
                    <button class="primary btn-xs" (click)="installProvider(p)" [disabled]="install.busy">
                      安装
                    </button>
                  }
                </div>
              }
            </div>
          }

          <details class="nl-details">
            <summary>按工作流看明细（{{ report.workflows.length }}）</summary>
            @for (wf of report.workflows; track wf.file) {
              <div class="nl-wf">
                <div class="nl-wf-head">
                  <span class="nl-wf-name" [title]="wf.file">{{ wf.file }}</span>
                  <span class="nl-wf-count">用 {{ wf.used }} 缺 {{ wf.missing }}</span>
                </div>
                <div class="nl-wf-body">
                  @for (p of wf.providers; track p.id) {
                    <span class="nl-chip">{{ p.name }}</span>
                  }
                  @for (name of wf.unknown; track name) {
                    <span class="nl-chip is-unknown" [title]="'清单没收录这个节点名，装好对应扩展后会自动识别'">
                      {{ name }}
                    </span>
                  }
                </div>
              </div>
            }
          </details>
        }
      }
      </ui-panel>
    }

    @if (!loading && !installed.length) {
      <ui-panel>
        <ui-empty
          title="还没装任何节点"
          hint="去「发现节点」挑需要的扩展；也可以把手工 clone 的仓库放进 workspace/custom_nodes。"
        />
      </ui-panel>
    } @else if (visibleInstalled.length) {
      <div class="nl-list">
        @for (it of visibleInstalled; track it.dir) {
          <md-node-card
            mode="library"
            [item]="it"
            [busy]="busy === it.dir"
            (toggle)="toggle(it)"
            (remove)="remove(it)"
          />
        }
      </div>
    } @else if (!loading) {
      <ui-panel>
        <ui-empty
          title="没有匹配的节点"
          hint="换个关键词，或把状态筛选切回「全部」。"
        />
      </ui-panel>
    }
  `,
  styles: `
    .nl-providers {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .nl-provider {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .nl-provider-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .nl-provider-main strong { font-size: 12.5px; }
    .nl-provider-meta { font-size: 10.5px; color: var(--muted); }
    .nl-provider-covers {
      font-size: 10.5px;
      color: var(--warn);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nl-provider-pct {
      font-size: 12px;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }

    .nl-details {
      margin-top: 12px;
      font-size: 12px;
    }
    .nl-details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 11.5px;
      padding: 4px 0;
    }
    .nl-details summary:hover { color: var(--text); }

    .nl-wf {
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .nl-wf-head {
      display: flex;
      gap: 10px;
      align-items: baseline;
      min-width: 0;
    }
    .nl-wf-name {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 11px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nl-wf-count {
      margin-left: auto;
      font-size: 10.5px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .nl-wf-body {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 5px;
    }
    .nl-chip {
      font-size: 10.5px;
      line-height: 17px;
      padding: 0 6px;
      border-radius: var(--radius-xs);
      background: var(--warn-soft);
      color: var(--warn);
    }
    .nl-chip.is-unknown {
      background: var(--panel-3);
      color: var(--muted);
    }

    /* 已装列表：一张扩展一张卡（与发现页同一套骨架，只换状态槽与主按钮） */
    .nl-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
      gap: 12px;
    }

    @media (max-width: 760px) {
      .nl-list { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    }
  `,
})
export class NodeLibraryComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  install = inject(NodeInstallService);
  private sub?: Subscription;

  installed: InstalledNode[] = [];
  stats: NodeStats | null = null;
  report: NodeMissingReport | null = null;
  loading = false;
  checking = false;
  busy = '';
  notice = '';
  errorText = '';

  /* ---- 列表顶部：搜索 / 状态 / 排序 ---- */
  q = '';
  statusFilter: 'all' | 'on' | 'off' = 'all';
  sort: 'name' | 'nodes' | 'size' = 'name';
  readonly sortOptions = SORT_OPTIONS;
  readonly viewOptions = VIEW_OPTIONS;
  private router = inject(Router);

  get disabledCount(): number {
    return this.installed.filter((i) => i.disabled).length;
  }

  /** 「筛选」浮层里的分组：启用状态 */
  get facetGroups(): FilterFacetGroup[] {
    return [
      {
        key: 'status',
        label: '启用状态',
        options: [
          { key: 'on', label: '已启用', count: this.installed.length - this.disabledCount },
          { key: 'off', label: '已禁用', count: this.disabledCount },
        ],
      },
    ];
  }

  get facetSelected(): Record<string, string[]> {
    return { status: this.statusFilter === 'all' ? [] : [this.statusFilter] };
  }

  onFacetChange(e: FilterFacetChange): void {
    if (e.group !== 'status') return;
    this.statusFilter = e.on ? (e.key as 'on' | 'off') : 'all';
  }

  setSort(key: string): void {
    this.sort = key as 'name' | 'nodes' | 'size';
  }

  /** 清除全部筛选 */
  clearAll(): void {
    this.q = '';
    this.statusFilter = 'all';
  }

  /** 视图切换：本地库 ↔ 发现 */
  onViewChange(key: string): void {
    if (key === 'discover') this.router.navigate(['/nodes/discover']);
    else this.router.navigate(['/nodes']);
  }

  /** 已装扩展提供的节点数（禁用的不算，它们不会被加载） */
  get availableNodes(): number {
    return this.installed.filter((i) => !i.disabled).reduce((sum, i) => sum + (i.node_count || 0), 0);
  }

  get hasFilter(): boolean {
    return !!this.q.trim() || this.statusFilter !== 'all';
  }

  /** 当前搜索结果：搜索 → 状态 → 排序，与工作流库同一套口径 */
  get visibleInstalled(): InstalledNode[] {
    const q = this.q.trim().toLowerCase();
    let rows = this.installed;
    if (q) {
      rows = rows.filter((it) =>
        `${it.title || ''} ${it.name} ${it.dir || ''} ${it.id || ''}`.toLowerCase().includes(q),
      );
    }
    if (this.statusFilter !== 'all') {
      rows = rows.filter((it) => (this.statusFilter === 'off' ? it.disabled : !it.disabled));
    }
    return rows.slice().sort((a, b) => {
      if (this.sort === 'nodes') return (b.node_count || 0) - (a.node_count || 0);
      if (this.sort === 'size') return (b.size || 0) - (a.size || 0);
      return (a.title || a.name).localeCompare(b.title || b.name, 'zh');
    });
  }

  /** 事实槽：可用节点类 + 清单规模；「已禁用」只在状态 chip 里报一次 */
  get listFacts(): CollectionFact[] {
    const nodes = this.visibleInstalled
      .filter((i) => !i.disabled)
      .reduce((sum, i) => sum + (i.node_count || 0), 0);
    return [
      { label: '可用节点类', value: this.fmtInt(nodes), title: '当前结果里启用中的扩展提供的节点类数' },
      { label: '清单规模', value: this.fmtInt(this.stats?.catalog ?? 0), title: 'ComfyUI-Manager 清单里的扩展总数' },
    ];
  }

  ngOnInit(): void {
    this.load();
    this.install.resume();
    this.sub = this.install.finished.subscribe((job) => {
      if (job.status === 'done') {
        this.notice = `已安装 ${job.name || job.node}，重启实例后生效`;
        this.load();
        if (this.report) this.check();
      } else if (job.status === 'failed') {
        this.errorText = job.error || '安装失败';
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.api.installedNodes().subscribe({
      next: (res) => {
        this.installed = res.items;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.errorText = errMsg(err, '读取已装节点失败');
      },
    });
    this.api.nodeStats().subscribe({
      next: (res) => (this.stats = res),
      error: () => {
        // 统计只是辅助信息，失败就不显示数字，不打断主流程
      },
    });
  }

  check(): void {
    this.checking = true;
    this.errorText = '';
    this.notice = '';
    this.api.missingNodes().subscribe({
      next: (res) => {
        this.report = res;
        this.checking = false;
      },
      error: (err) => {
        this.checking = false;
        this.errorText = errMsg(err, '检测失败');
      },
    });
  }

  installProvider(p: MissingProvider): void {
    if (!this.install.start(p.id)) {
      this.errorText = '已有节点正在安装，请等它完成';
    }
  }

  toggle(item: InstalledNode): void {
    this.busy = item.dir;
    this.errorText = '';
    this.api.toggleNode(item.dir).subscribe({
      next: () => {
        this.busy = '';
        this.load();
      },
      error: (err) => {
        this.busy = '';
        this.errorText = errMsg(err, '切换启用状态失败');
      },
    });
  }

  remove(item: InstalledNode): void {
    const label = item.disabled ? '已禁用' : '启用中';
    if (
      !confirm(
        `确定卸载「${item.title}」（${item.dir}，${label}）？\n\n` +
          '会删掉这个扩展的全部代码；模型、工作流和其它节点不受影响。' +
          (item.disabled ? '' : '\n如果实例正在运行，会先停止它。'),
      )
    ) {
      return;
    }
    this.busy = item.dir;
    this.errorText = '';
    this.api.removeNode(item.dir, true).subscribe({
      next: () => {
        this.busy = '';
        this.notice = `已卸载 ${item.title}`;
        this.load();
        if (this.report) this.check();
      },
      error: (err) => {
        this.busy = '';
        this.errorText = errMsg(err, '卸载失败');
      },
    });
  }

  fmtNum = fmtNum;
  readonly fmtInt = (n: number) => (n || 0).toLocaleString('en-US');
}
