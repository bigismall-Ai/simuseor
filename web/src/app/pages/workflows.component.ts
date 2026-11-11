import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { WorkflowInstance, WorkflowItem, errMsg, fmtNum } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';

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
  imports: [FormsModule, RouterLink, BadgeComponent, EmptyComponent, PageHeaderComponent],
  template: `
    <ui-page-header
      title="工作流发现"
      hint="以工作流为单位浏览：缩略图、依赖模型、文件清单。可下载到 models/workflows，或直接导入本地 ComfyUI 实例"
    />

    <div class="panel">
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
      <div class="chip-row">
        @for (s of sources; track s.key) {
          <button class="filter-chip" [class.active]="source === s.key" (click)="setSource(s.key)">
            {{ s.label }}
          </button>
        }
        <span class="wf-sep"></span>
        @for (s of sorts; track s.key) {
          <button class="filter-chip" [class.active]="sort === s.key" (click)="setSort(s.key)">
            {{ s.label }}
          </button>
        }
      </div>

      @if (instances.length) {
        <div class="toolbar wf-import-bar">
          <span class="muted">导入目标实例</span>
          <select class="wf-instance" [(ngModel)]="instance" data-testid="wf-instance">
            @for (ins of instances; track ins.name) {
              <option [value]="ins.name">{{ ins.name }}（已有 {{ ins.count }} 个工作流）</option>
            }
          </select>
        </div>
      }

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
    </div>

    @if (!loading && !items.length && !errorText) {
      <ui-empty icon="🧩" title="没有找到工作流" hint="换个关键词，或切换来源再试" />
    }

    <div class="wf-list">
      @for (it of items; track it.source + '/' + it.id) {
        <article class="wf-row">
          <div class="wf-thumb-box">
            @if (it.thumbnail) {
              <img
                class="wf-thumb"
                [src]="it.thumbnail"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                (error)="it.thumbnail = ''"
              />
            } @else {
              <div class="wf-thumb wf-thumb-empty">🧩</div>
            }
          </div>

          <div class="wf-body">
            <div class="wf-head">
              <h3 class="wf-title" [title]="it.id">{{ it.name }}</h3>
              <ui-badge [tone]="toneOf(it.source)">{{ labelOf(it.source) }}</ui-badge>
              <a class="mc-link" [href]="it.url" target="_blank" rel="noreferrer">来源 ↗</a>
            </div>
            <div class="muted wf-meta">
              {{ it.author }}
              @if (it.updated_at) {
                <span> · ↻ {{ it.updated_at }}</span>
              }
              <span> · ⬇ {{ fmtNum(it.downloads) }}</span>
              <span> · {{ it.file_count }} 个文件</span>
            </div>
            @if (it.description) {
              <p class="wf-desc">{{ it.description }}</p>
            }
            @if ((it.requires?.length || 0) + it.tags.length > 0) {
              <div class="wf-tags">
                @for (r of it.requires || []; track r) {
                  <span class="wf-req">{{ r }}</span>
                }
                @for (t of it.tags; track t) {
                  <span class="wf-tag">{{ t }}</span>
                }
              </div>
            }
            <p class="wf-files" [title]="it.files.join('\n')">{{ previewFiles(it) }}</p>
          </div>

          <div class="wf-actions">
            <button
              class="primary"
              (click)="download(it)"
              [disabled]="busy === keyOf(it)"
              [attr.data-testid]="'wf-download-' + it.source"
            >
              @if (busy === keyOf(it)) { 正在创建… } @else { 下载 }
            </button>
            <button
              class="ghost"
              (click)="importTo(it)"
              [disabled]="!instance || busy === 'import:' + keyOf(it)"
              [title]="instance ? '复制到实例的 user/default/workflows' : '本机没有可用 ComfyUI 实例'"
              [attr.data-testid]="'wf-import-' + it.source"
            >
              @if (busy === 'import:' + keyOf(it)) { 导入中… } @else { 导入 ComfyUI }
            </button>
          </div>
        </article>
      }
    </div>

    @if (items.length && !done) {
      <div class="actions">
        <button class="ghost" (click)="loadMore()" [disabled]="loading">加载更多</button>
      </div>
    }
  `,
  styles: `
    .wf-sep {
      width: 1px;
      height: 18px;
      background: var(--border);
      margin: 0 6px;
    }
    .wf-import-bar {
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 6px;
      font-size: 12px;
    }
    .wf-instance {
      width: 260px;
      max-width: 46vw;
    }
    .wf-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .wf-row {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr) auto;
      gap: 14px;
      padding: 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
    }
    .wf-thumb-box {
      display: flex;
      align-items: center;
    }
    .wf-thumb {
      width: 132px;
      height: 88px;
      border-radius: 8px;
      object-fit: cover;
      background: var(--panel-2);
      border: 1px solid var(--border-soft);
    }
    .wf-thumb-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      color: var(--muted);
    }
    .wf-body {
      min-width: 0;
    }
    .wf-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wf-title {
      margin: 0;
      font-size: 15px;
      line-height: 1.35;
      max-width: 72%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-meta {
      margin-top: 4px;
      font-size: 12px;
    }
    .wf-desc {
      margin: 6px 0 0;
      font-size: 13px;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .wf-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 7px;
    }
    .wf-req {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--warn-soft);
      color: var(--warn);
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-tag {
      font-size: 11px;
      color: var(--muted);
      line-height: 18px;
    }
    .wf-files {
      margin: 7px 0 0;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      justify-content: center;
      min-width: 110px;
    }
    @media (max-width: 760px) {
      .wf-row {
        grid-template-columns: 84px minmax(0, 1fr);
      }
      .wf-thumb {
        width: 84px;
        height: 84px;
      }
      .wf-actions {
        grid-column: 1 / -1;
        flex-direction: row;
      }
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private api = inject(ApiService);

  readonly sources = SOURCES;
  readonly sorts = SORTS;
  q = '';
  source = 'all';
  sort = 'downloads';
  items: WorkflowItem[] = [];
  instances: WorkflowInstance[] = [];
  instance = '';
  loading = false;
  done = true;
  page = 1;
  busy = '';
  notice = '';
  errorText = '';
  sourceErrors: { label: string; message: string }[] = [];

  ngOnInit(): void {
    this.loadInstances();
    this.load(1);
  }

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

  private loadInstances(): void {
    this.api.listWorkflowInstances().subscribe({
      next: (res) => {
        this.instances = res.items || [];
        this.instance = this.instances[0]?.name || '';
      },
      error: () => {
        this.instances = [];
      },
    });
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
          this.notice = `已创建下载任务：${repo.files.length} 个工作流文件 → models/workflows`;
        },
        error: (err) => {
          this.busy = '';
          this.errorText = errMsg(err, '工作流下载失败');
        },
      });
  }

  importTo(item: WorkflowItem): void {
    if (!this.instance) return;
    this.busy = 'import:' + this.keyOf(item);
    this.notice = '';
    this.errorText = '';
    this.api.importWorkflow(item.source, item.id, this.instance).subscribe({
      next: (res) => {
        this.busy = '';
        this.notice = `已导入 ${res.files.length} 个工作流到 ${res.instance}：user/default/workflows`;
        this.loadInstances();
      },
      error: (err) => {
        this.busy = '';
        this.errorText = errMsg(err, '导入 ComfyUI 失败');
      },
    });
  }

  keyOf(item: WorkflowItem): string {
    return `${item.source}/${item.id}`;
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
