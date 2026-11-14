import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errMsg, fmtNum, NodeItem } from '../core/types';
import { NodeInstallService } from '../core/node-install.service';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

const PAGE_SIZE = 20;

const SCOPES = [
  { key: 'all', label: '全部' },
  { key: 'available', label: '未安装' },
  { key: 'installed', label: '已安装' },
];

const SORTS = [
  { key: 'nodes', label: '按节点数' },
  { key: 'name', label: '按名称' },
];

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [FormsModule, RouterLink, BadgeComponent, EmptyComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      kicker="Nodes · Discover"
      title="发现节点"
      hint="自定义节点就是 ComfyUI 的扩展能力：装到 workspace/custom_nodes，所有实例共用，删实例不会丢。"
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
          @for (s of scopes; track s.key) {
            <button class="filter-chip" [class.active]="scope === s.key" (click)="setScope(s.key)">
              {{ s.label }}
              @if (s.key === 'installed' && installedCount) {
                <span class="chip-count">{{ installedCount }}</span>
              }
            </button>
          }
        </div>
        <div class="nd-sort">
          @for (s of sorts; track s.key) {
            <button class="filter-chip" [class.active]="sort === s.key" (click)="setSort(s.key)">
              {{ s.label }}
            </button>
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
      @if (!loading && items.length) {
        <div class="nd-sum">
          共 {{ fmtNum(total) }} 个扩展 · 其中 {{ installedCount }} 个已安装
        </div>
      }
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

    <div class="nd-list">
      @for (it of items; track it.id) {
        <article class="nd-row" [class.is-installed]="it.installed">
          <div class="nd-tile">
            <strong>{{ it.node_count || '—' }}</strong>
            <span>节点</span>
          </div>

          <div class="nd-body">
            <div class="nd-head">
              <h3 class="nd-title" [title]="it.name">{{ it.name }}</h3>
              @if (it.installed) {
                <ui-badge tone="green">已安装</ui-badge>
              }
              @if (!it.installable) {
                <ui-badge tone="gray">{{ it.install_type }} 安装</ui-badge>
              }
              <a class="mc-link" [href]="it.repo" target="_blank" rel="noreferrer">仓库 ↗</a>
            </div>
            <div class="nd-meta">
              <span>{{ it.author }}</span>
              <span>{{ fmtNum(it.node_count) }} 个节点</span>
              @if (it.tags.length) {
                <span>{{ it.tags.join(' / ') }}</span>
              }
            </div>
            @if (it.description) {
              <p class="nd-desc">{{ it.description }}</p>
            }
            @if (it.nodes.length) {
              <div class="nd-chips">
                @for (name of it.nodes.slice(0, 4); track name) {
                  <span class="nd-chip">{{ name }}</span>
                }
                @if (it.node_count > 4) {
                  <span class="nd-more">+{{ it.node_count - 4 }}</span>
                }
              </div>
            }
            @if (it.needs.length) {
              <p class="nd-needs">额外依赖：{{ it.needs.join(', ') }}</p>
            }
            @if (it.preemptions.length) {
              <p class="nd-needs">与其它扩展重名：{{ it.preemptions.join(', ') }}</p>
            }
          </div>

          <div class="nd-actions">
            @if (install.installingId === it.id && install.job?.status === 'running') {
              <span class="nd-progress">{{ install.job?.percent }}%</span>
              <span class="nd-stage">{{ install.job?.stage }}</span>
            } @else if (!it.installable) {
              <span class="nd-done">不支持一键装</span>
            } @else if (!it.installed) {
              <button
                class="primary btn-xs"
                (click)="installItem(it)"
                [disabled]="install.busy || loading"
                [attr.data-testid]="'node-install-' + it.id"
              >
                安装
              </button>
            }
          </div>
        </article>
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
      margin-left: auto;
    }
    .nd-sum {
      margin-top: 10px;
      font-size: 11.5px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }

    .nd-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* 方块只放「这个扩展有多少节点」：清单里没有 star 也没有更新时间，
       拿节点数当规模信号，比一行无序的标签有用 */
    .nd-row {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      gap: 14px;
      padding: 12px 14px 12px 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .nd-row:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-sm);
    }
    .nd-row.is-installed {
      background: linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--panel);
    }

    .nd-tile {
      width: 56px;
      height: 56px;
      border-radius: 8px;
      background: var(--panel-3);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
    }
    .nd-tile strong {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .nd-tile span {
      font-size: 10px;
      color: var(--muted);
    }

    .nd-body { min-width: 0; }

    .nd-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .nd-title {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.35;
      max-width: 66%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nd-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 4px;
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .nd-meta span + span::before {
      content: '·';
      margin-right: 8px;
      opacity: 0.45;
    }

    .nd-desc {
      margin: 6px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .nd-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 7px;
    }
    .nd-chip {
      font-size: 10.5px;
      line-height: 17px;
      padding: 0 6px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      color: var(--muted);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nd-more {
      font-size: 10.5px;
      line-height: 17px;
      color: var(--muted);
    }

    .nd-needs {
      margin: 6px 0 0;
      font-size: 10.5px;
      color: var(--warn);
    }

    .nd-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
      gap: 4px;
      min-width: 84px;
    }
    .nd-progress {
      font-size: 13px;
      font-weight: 600;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }
    .nd-stage {
      font-size: 10.5px;
      color: var(--muted);
      text-align: right;
      max-width: 110px;
    }
    .nd-done {
      font-size: 11.5px;
      color: var(--muted);
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
      .nd-row { grid-template-columns: 44px minmax(0, 1fr); }
      .nd-tile { width: 44px; height: 44px; }
      .nd-tile strong { font-size: 14px; }
      .nd-actions {
        grid-column: 1 / -1;
        flex-direction: row;
        align-items: center;
        justify-content: flex-end;
      }
    }
  `,
})
export class NodesComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  install = inject(NodeInstallService);
  private sub?: Subscription;

  readonly scopes = SCOPES;
  readonly sorts = SORTS;
  q = '';
  scope = 'all';
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

  setScope(scope: string): void {
    this.scope = scope;
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
      .searchNodes({ q: this.q.trim(), sort: this.sort, scope: this.scope, limit: PAGE_SIZE, page })
      .subscribe({
        next: (res) => {
          const existing = new Set(this.items.map((i) => i.id));
          const incoming = page === 1 ? res.items : res.items.filter((i) => !existing.has(i.id));
          this.items = page === 1 ? res.items : [...this.items, ...incoming];
          this.total = res.total;
          this.installedCount = res.installed_count || 0;
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
