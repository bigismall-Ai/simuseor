import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { LocalWorkflow, WorkflowItem, errMsg, fmtNum, fmtSize } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { CoverPlateComponent } from '../ui/cover-plate.component';
import { FamilyMarkComponent } from '../ui/family-mark.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

const PAGE_SIZE = 12;

const SOURCES = [
  { key: 'all', label: '全部来源' },
  { key: 'templates', label: 'ComfyUI 官方模板' },
  { key: 'huggingface', label: 'Hugging Face' },
  { key: 'modelscope', label: 'ModelScope' },
  { key: 'civitai', label: 'Civitai' },
  { key: 'github', label: 'GitHub' },
];

const SOURCE_LABELS: Record<string, string> = {
  templates: 'ComfyUI 官方模板',
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  github: 'GitHub',
};

const SOURCE_TONES: Record<string, 'blue' | 'green' | 'orange' | 'gray'> = {
  templates: 'green',
  huggingface: 'blue',
  modelscope: 'green',
  civitai: 'orange',
  github: 'gray',
};

const SORTS = [
  { key: 'downloads', label: '热门' },
  { key: 'latest', label: '最新' },
];

@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [FormsModule, RouterLink, BadgeComponent, CoverPlateComponent, EmptyComponent, FamilyMarkComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      [kicker]="tab === 'discover' ? 'Workflows · Discover' : 'Workflows'"
      [title]="tab === 'discover' ? '发现工作流' : '工作流'"
      [hint]="
        tab === 'discover'
          ? '从 ComfyUI 官方模板、Hugging Face、Civitai 抓取，下载到工作流库，所有实例共用。'
          : '本机工作流库，所有 ComfyUI 实例共用。'
      "
    />

    @if (tab === 'mine') {
      @if (localError) {
        <div class="notice err">{{ localError }}</div>
      }

      @if (!localLoading && !local.length) {
        <ui-panel>
          <ui-empty
            title="还没有本地工作流"
            hint="从「发现工作流」下载一份，或在 ComfyUI 里保存一条，就会出现在这里。"
          >
            <button class="primary btn-xs" routerLink="/workflows/discover">去发现工作流</button>
          </ui-empty>
        </ui-panel>
      } @else {
        <ui-panel>
          <div class="lw-bar">
            <span class="lw-count">{{ localLoading ? '读取中…' : local.length + ' 个工作流' }}</span>
            @if (localDir) {
              <span class="lw-dir mono" [title]="localDir">{{ localDir }}</span>
            }
            <button class="btn-xs" (click)="loadLocal()" [disabled]="localLoading">刷新</button>
          </div>

          <div class="lw-head">
            <span>名称</span>
            <span class="lw-num">节点</span>
            <span class="lw-num">大小</span>
            <span class="lw-right">修改</span>
            <span></span>
          </div>

          <div class="lw-list">
            @for (it of local; track it.path) {
              <div class="lw-row">
                <div class="lw-body">
                  <p class="lw-name" [title]="it.path">
                    <ui-family-mark class="lw-mark" [model]="it.main_model || ''" />
                    {{ it.name }}
                    @if (it.format === 'api') {
                      <span class="lw-tag">API</span>
                    }
                  </p>
                  @if (it.folder && it.folder !== it.name) {
                    <p class="lw-sub">{{ it.folder }}</p>
                  }
                </div>
                <span class="lw-num">{{ it.nodes }}</span>
                <span class="lw-num">{{ fmtSize(it.size) }}</span>
                <time class="lw-time">{{ ago(it.mtime) }}</time>
                <button class="btn-xs lw-open" (click)="reveal(it)" title="在文件管理器中定位">定位</button>
              </div>
            }
          </div>
        </ui-panel>
      }
    } @else {

    <ui-panel>
      <div class="toolbar">
        <input
          class="grow"
          [(ngModel)]="q"
          (keyup.enter)="search()"
          placeholder="搜索工作流，如 flux / wan / minimax，留空看热门"
          data-testid="wf-search"
        />
        <button class="primary" (click)="search()" [disabled]="loading">搜索</button>
      </div>

      <div class="wf-filters">
        <div class="chip-row">
          @for (s of sources; track s.key) {
            <button class="filter-chip" [class.active]="source === s.key" (click)="setSource(s.key)">
              {{ s.label }}
            </button>
          }
        </div>
        <div class="wf-sort">
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
        <div class="notice ok">
          {{ notice }}
          <a routerLink="/downloads">查看下载任务 →</a>
        </div>
      }
      @if (sourceErrors.length) {
        <div class="notice err">
          @for (e of sourceErrors; track e.label) {
            <div>{{ e.label }}：{{ e.message }}</div>
          }
        </div>
      }
      @if (loading && !items.length) {
        <div class="notice info">正在检索各站工作流…</div>
      }
    </ui-panel>

    @if (!loading && !items.length && !errorText) {
      <ui-empty title="没有找到工作流" hint="换个关键词，或切换来源再试。" />
    }

    <div class="wf-list">
      @for (it of items; track it.source + '/' + it.id) {
        <article class="wf-row">
          <app-cover-plate class="wf-thumb" size="wide" [model]="plateOf(it)" />

          <div class="wf-body">
            <div class="wf-head">
              <h3 class="wf-title" [title]="it.id">{{ it.name }}</h3>
              <ui-badge [tone]="toneOf(it.source)">{{ labelOf(it.source) }}</ui-badge>
              <a class="mc-link" [href]="it.url" target="_blank" rel="noreferrer">来源 ↗</a>
            </div>
            <div class="wf-meta">
              @if (it.author) {
                <span>{{ it.author }}</span>
              }
              @if (it.updated_at) {
                <span>↻ {{ it.updated_at }}</span>
              }
              <span>↓ {{ fmtNum(it.downloads) }}</span>
              <span>{{ it.file_count }} 个文件</span>
            </div>
            @if (it.description) {
              <p class="wf-desc">{{ it.description }}</p>
            }
            @if ((it.requires?.length || 0) + it.tags.length > 0) {
              <div class="wf-tags">
                @for (r of it.requires || []; track r) {
                  <span class="wf-req">{{ r }}</span>
                }
                @for (t of it.tags.slice(0, 4); track t) {
                  <span class="wf-tag">{{ t }}</span>
                }
              </div>
            }
            <p class="wf-files" [title]="it.files.join('\n')">{{ previewFiles(it) }}</p>
          </div>

          <div class="wf-actions">
            <button
              class="primary btn-xs"
              (click)="download(it)"
              [disabled]="busy === keyOf(it)"
              title="下载到工作流库，所有 ComfyUI 实例共用"
              [attr.data-testid]="'wf-download-' + it.source"
            >
              @if (busy === keyOf(it)) { 正在创建… } @else { 下载到工作流库 }
            </button>
          </div>
        </article>
      }
    </div>

    @if (items.length && !done) {
      <div class="mc-more">
        <button (click)="loadMore()" [disabled]="loading">{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    }
    }
  `,
  styles: `
    /* 列表上方一条读数：共几条、目录在哪、刷新。目录用等宽字截断，路径长也不换行 */
    .lw-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 9px;
      border-bottom: 1px solid var(--border-soft);
      font-size: 11.5px;
    }
    .lw-count { color: var(--text-2); font-weight: 500; font-variant-numeric: tabular-nums; }
    .lw-dir {
      min-width: 0;
      flex: 1;
      color: var(--muted);
      font-size: 10.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lw-bar button { margin-left: auto; }

    /* 列头与行共用同一套列宽：数字右对齐成一列，扫读时才不用一行行找 */
    .lw-head,
    .lw-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 52px 78px 76px 52px;
      align-items: center;
      gap: 12px;
    }
    .lw-head {
      padding: 8px 2px 7px;
      font-size: 10.5px;
      color: var(--muted);
      letter-spacing: 0.02em;
    }
    .lw-row {
      padding: 9px 2px;
      border-top: 1px solid var(--border-soft);
    }
    .lw-row:hover { background: var(--panel-2); }
    .lw-body { min-width: 0; }
    .lw-name {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lw-tag {
      flex: none;
      padding: 0 4px;
      border-radius: var(--radius-xs);
      background: var(--chip);
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .lw-sub {
      margin: 2px 0 0;
      font-size: 10.5px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lw-num {
      font-size: 11.5px;
      color: var(--text-2);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .lw-right { text-align: right; }
    .lw-time {
      font-size: 11px;
      color: var(--muted);
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .lw-open { justify-self: end; }

    .wf-filters {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .wf-sort {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }
    .wf-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* 缩略图列宽度固定：一列图宽窄不一会让右边界跳，整列看起来是歪的 */
    .wf-row {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr) auto;
      gap: 14px;
      padding: 12px 14px 12px 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .wf-row:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-sm);
    }
    .wf-thumb {
      align-self: start;
      border-radius: 8px;
      overflow: hidden;
    }

    .wf-body { min-width: 0; }

    .wf-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wf-title {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.35;
      max-width: 70%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wf-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 5px;
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .wf-meta span + span::before {
      content: '·';
      margin-right: 8px;
      opacity: 0.45;
    }

    .wf-desc {
      margin: 7px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .wf-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
    }
    .wf-req {
      max-width: 240px;
      padding: 0 6px;
      border-radius: var(--radius-xs);
      background: var(--warn-soft);
      color: var(--warn);
      font-size: 10.5px;
      line-height: 17px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-tag {
      font-size: 10.5px;
      line-height: 17px;
      color: var(--muted);
    }

    .wf-files {
      margin: 8px 0 0;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 10.5px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wf-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      justify-content: center;
      min-width: 96px;
    }

    @media (max-width: 760px) {
      .wf-row { grid-template-columns: 92px minmax(0, 1fr); }
      .wf-thumb { width: 92px; height: 72px; }
      .wf-actions {
        grid-column: 1 / -1;
        flex-direction: row;
      }
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  readonly sources = SOURCES;
  readonly sorts = SORTS;
  /** 视图由路由决定：/workflows 是我的工作流，/workflows/discover 是发现 */
  tab: 'mine' | 'discover' = 'mine';
  local: LocalWorkflow[] = [];
  localDir = '';
  localLoading = false;
  localError = '';
  q = '';
  source = 'all';
  sort = 'downloads';
  items: WorkflowItem[] = [];
  loading = false;
  done = true;
  page = 1;
  busy = '';
  notice = '';
  errorText = '';
  sourceErrors: { label: string; message: string }[] = [];

  ngOnInit(): void {
    // 两个路径共用同一个组件实例，切换时组件不会重建，所以视图由路由的 data 驱动
    this.route.data.subscribe((data) => {
      const next: 'mine' | 'discover' = data['tab'] === 'discover' ? 'discover' : 'mine';
      this.tab = next;
      if (next === 'discover') {
        if (!this.items.length) this.load(1);
      } else if (!this.local.length) {
        this.loadLocal();
      }
    });
  }

  loadLocal(): void {
    this.localLoading = true;
    this.localError = '';
    this.api.localWorkflows().subscribe({
      next: (res) => {
        this.local = res.items;
        this.localDir = res.dir;
        this.localLoading = false;
      },
      error: (err) => {
        this.localLoading = false;
        this.localError = errMsg(err, '读取本地工作流失败');
      },
    });
  }

  reveal(item: LocalWorkflow): void {
    this.api.openLocalWorkflow(item.path).subscribe({
      error: (err) => (this.localError = errMsg(err, '打开文件位置失败')),
    });
  }

  /** 列表里的时间读「多久以前」比读绝对时间有用：它回答的是「这条是不是刚动的」 */
  ago(seconds: number): string {
    const diff = Math.floor(Date.now() / 1000) - seconds;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  fmtSize = fmtSize;

  search(): void {
    this.load(1);
  }

  setSource(source: string): void {
    this.source = source;
    this.load(1);
  }

  setSort(sort: string): void {
    this.sort = sort;
    this.load(1);
  }

  loadMore(): void {
    this.load(this.page + 1);
  }

  private load(page: number): void {
    this.loading = true;
    this.errorText = '';
    this.notice = '';
    this.api
      .searchWorkflows({ q: this.q.trim(), source: this.source, sort: this.sort, limit: PAGE_SIZE, page })
      .subscribe({
        next: (res) => {
          const existing = new Set(this.items.map((i) => `${i.source}/${i.id}`));
          const incoming =
            page === 1 ? res.items : res.items.filter((i) => !existing.has(`${i.source}/${i.id}`));
          this.items = page === 1 ? res.items : [...this.items, ...incoming];
          this.sourceErrors = Object.entries(res.errors || {}).map(([key, message]) => ({
            label: SOURCE_LABELS[key] || key,
            message,
          }));
          this.done = res.done || (page > 1 && incoming.length === 0);
          this.page = page;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.errorText = errMsg(err, '工作流检索失败，请检查网络');
        },
      });
  }

  download(item: WorkflowItem): void {
    this.busy = this.keyOf(item);
    this.notice = '';
    this.errorText = '';
    this.api
      .resolveWorkflow(item.source, item.id)
      .pipe(
        switchMap((repo) =>
          this.api
            .createTask({
              source: item.source,
              repo_id: repo.repo_id,
              revision: repo.revision || '',
              files: repo.files.map((f) => f.path),
              strategy: '',
              target_folder: 'workflows',
              task: 'Workflows',
            })
            .pipe(map(() => repo)),
        ),
      )
      .subscribe({
        next: (repo) => {
          this.busy = '';
          this.notice = `已创建下载任务：${repo.files.length} 个工作流文件 → 工作流库（压缩包会自动解开）`;
        },
        error: (err) => {
          this.busy = '';
          this.errorText = errMsg(err, '工作流下载失败');
        },
      });
  }

  keyOf(item: WorkflowItem): string {
    return `${item.source}/${item.id}`;
  }

  /**
   * 传给铭牌的最小字段集。有缩略图就铺图，没有就按名字生成构图——
   * 旧版这里是一个 🧩 emoji，一屏十几个一样的方块，完全无法区分。
   */
  plateOf(item: WorkflowItem) {
    return { name: item.name, tags: item.tags, image: item.thumbnail };
  }

  previewFiles(item: WorkflowItem): string {
    const shown = item.files.slice(0, 2).join(' · ');
    return item.file_count > 2 ? `${shown} … 共 ${item.file_count} 个` : shown;
  }

  labelOf(source: string): string {
    return SOURCE_LABELS[source] || source;
  }

  toneOf(source: string): 'blue' | 'green' | 'orange' | 'gray' {
    return SOURCE_TONES[source] || 'gray';
  }

  fmtNum = fmtNum;
}
