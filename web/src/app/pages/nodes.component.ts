import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errMsg, fmtNum, NodeItem } from '../core/types';
import { NodeInstallService } from '../core/node-install.service';
import { BadgeComponent } from '../ui/badge.component';
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

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    BadgeComponent,
    EmptyComponent,
    NodeCardComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <ui-page-header
      kicker="Nodes · Discover"
      title="发现节点"
      hint="清单来自 ComfyUI-Manager，代码按清单里的仓库地址从 GitHub 克隆到 workspace/custom_nodes，所有实例共用，删实例不会丢。"
    >
      <button routerLink="/nodes">节点管理</button>
    </ui-page-header>

    <ui-panel>
      <div class="toolbar">
        <input
          class="grow"
          [(ngModel)]="q"
          (keyup.enter)="search()"
          placeholder="搜扩展名或节点名，如 impact / sam / controlnet，留空看规模最大的"
          data-testid="node-search"
        />
        <button class="primary" (click)="search()" [disabled]="loading">搜索</button>
        <button (click)="refreshCatalog()" [disabled]="refreshing" title="重新拉取 ComfyUI-Manager 清单">
          {{ refreshing ? '刷新中…' : '刷新清单' }}
        </button>
      </div>

      <div class="nd-filters">
        <div class="chip-row">
          <button class="filter-chip" [class.active]="!category" (click)="setCategory('')">全部</button>
          @for (c of topCategories; track c.id) {
            <button class="filter-chip" [class.active]="category === c.id" (click)="setCategory(c.id)">
              {{ c.label }}
              <span class="chip-count">{{ c.count }}</span>
            </button>
          }
          @if (moreCategories.length) {
            <button class="filter-chip" (click)="showAllCategories = !showAllCategories">
              更多 {{ moreCategories.length }} {{ showAllCategories ? '▴' : '▾' }}
            </button>
          }
          @if (showAllCategories) {
            @for (c of moreCategories; track c.id) {
              <button class="filter-chip" [class.active]="category === c.id" (click)="setCategory(c.id)">
                {{ c.label }}
                <span class="chip-count">{{ c.count }}</span>
              </button>
            }
          }
        </div>
      </div>

      @if (errorText) {
        <div class="notice err">{{ errorText }}</div>
      }
      @if (notice) {
        <div class="notice ok">{{ notice }}</div>
      }
      @if (loading && !items.length) {
        <div class="notice info">正在读取节点清单…</div>
      }
      <div class="nd-sum">
        @if (!loading && items.length) {
          <span>共 {{ fmtNum(total) }} 个扩展 · 其中 {{ installedCount }} 个已安装</span>
        }
        <div class="nd-sort">
          @for (s of sorts; track s.key) {
            <button class="filter-chip" [class.active]="sort === s.key" (click)="setSort(s.key)">
              {{ s.label }}
            </button>
          }
        </div>
      </div>
    </ui-panel>

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
            <div class="notice err">{{ install.job.error }}</div>
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
  private sub?: Subscription;

  readonly sorts = SORTS;
  q = '';
  category = '';
  categories: { id: string; label: string; count: number }[] = [];
  showAllCategories = false;
  sort = 'nodes';
  items: NodeItem[] = [];
  loading = false;
  refreshing = false;
  done = true;
  page = 1;
  total = 0;
  installedCount = 0;
  notice = '';
  errorText = '';

  ngOnInit(): void {
    this.load(1);
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

  /** 分类按数量降序：先给最常见的 8 个，其余折进「更多」 */
  get topCategories(): { id: string; label: string; count: number }[] {
    return [...this.categories].sort((a, b) => b.count - a.count).slice(0, 8);
  }

  get moreCategories(): { id: string; label: string; count: number }[] {
    return [...this.categories].sort((a, b) => b.count - a.count).slice(8);
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
}
