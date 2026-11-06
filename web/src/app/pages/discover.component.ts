import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AppSettings, RepoInfo, SearchItem, errMsg, fmtNum, fmtSize } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { ModelCardComponent } from '../ui/model-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

interface SourceGroup {
  key: string;
  label: string;
  items: SearchItem[];
  page: number;
  loading: boolean;
  done: boolean;
  error: string;
}

interface SingleResult {
  items: SearchItem[];
  page: number;
  loading: boolean;
  done: boolean;
  error: string;
}

interface DownloadDialog {
  item: SearchItem;
  repo: RepoInfo | null;
  selected: Set<string>;
  loading: boolean;
  creating: boolean;
  done: boolean;
  error: string;
}

const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  demo: 'Demo',
};

const TASK_LABELS: Record<string, string> = {
  'text-generation': '文生文',
  'text-to-image': '文生图',
  'text-to-video': '文生视频',
  'image-classification': '图像分类',
  'automatic-speech-recognition': '语音识别',
  'feature-extraction': '文本向量',
  'text-classification': '文本分类',
  translation: '翻译',
  summarization: '摘要',
  Checkpoint: 'Checkpoint',
  LORA: 'LoRA',
  TextualInversion: '文本反转',
  Controlnet: 'ControlNet',
  Upscaler: '放大模型',
};

const HOT_KEYWORDS = ['qwen', 'flux', 'lora', 'sdxl', 'whisper', 'embedding'];
const GROUP_PAGE_SIZE = 8;
const SINGLE_PAGE_SIZE = 20;

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BadgeComponent,
    EmptyComponent,
    ModelCardComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <ui-page-header title="模型发现" hint="跨源搜索 → 任务类型筛选 → 行内勾选文件创建下载；状态保存在地址栏，可刷新可分享。" />

    <ui-panel>
      <div class="toolbar mb">
        <input
          class="grow"
          [(ngModel)]="q"
          placeholder="搜索模型关键词，如 qwen / lora / flux"
          (input)="onQInput()"
          (keyup.enter)="searchNow()"
          data-testid="search-input"
        />
        <button class="primary" (click)="searchNow()" [disabled]="anyLoading" data-testid="search-btn">搜索</button>
      </div>

      <div class="toolbar">
        <div class="segmented">
          @for (t of sourceTabs; track t.key) {
            <button [class.active]="source === t.key" (click)="setSource(t.key)">{{ t.label }}</button>
          }
        </div>
        <span class="grow"></span>
        <div class="segmented">
          <button [class.active]="sort === 'downloads'" (click)="setSort('downloads')" title="按下载量">⬇ 下载量</button>
          <button [class.active]="sort === 'likes'" (click)="setSort('likes')" title="按点赞">♥ 点赞</button>
          <button [class.active]="sort === 'recent'" (click)="setSort('recent')" title="最新更新">↻ 最新</button>
        </div>
        <div class="segmented">
          <button [class.active]="view === 'grid'" (click)="setView('grid')" title="网格视图">▦</button>
          <button [class.active]="view === 'list'" (click)="setView('list')" title="列表视图">☰</button>
        </div>
      </div>

      @if (taskChips.length > 1) {
        <div class="chip-row mt">
          <button class="filter-chip" [class.active]="task === ''" (click)="setTask('')">全部类型</button>
          @for (c of taskChips; track c.key) {
            <button class="filter-chip" [class.active]="task === c.key" (click)="setTask(c.key)">
              {{ taskLabel(c.key) }} <span class="chip-count">{{ c.count }}</span>
            </button>
          }
        </div>
      }
    </ui-panel>

    <!-- 首次加载骨架 -->
    @if (anyLoading && totalItems === 0) {
      <div class="grid">
        @for (i of skeletons; track i) {
          <div class="model-card skel-card">
            <div class="skeleton skel-line w-40"></div>
            <div class="skeleton skel-line w-80"></div>
            <div class="skeleton skel-line"></div>
            <div class="skeleton skel-line w-60"></div>
          </div>
        }
      </div>
    }

    <!-- 网格视图 -->
    @if (totalItems > 0 && view === 'grid') {
      @if (source === 'all') {
        @for (g of groups; track g.key) {
          <ui-panel [title]="g.label">
            <div panel-actions class="toolbar">
              @if (g.loading) {
                <span class="muted">搜索中…</span>
              } @else {
                <span class="muted">{{ g.items.length }} 个结果</span>
              }
            </div>
            @if (g.error) {
              <div class="notice err">{{ g.label }} 搜索失败：{{ g.error }}</div>
            }
            @if (g.items.length) {
              <div class="grid">
                @for (item of g.items; track item.source + '/' + item.id) {
                  <md-model-card [item]="item" [inLibrary]="inLibrary(item)" (download)="openDialog(item)" />
                }
              </div>
              @if (!g.done) {
                <div class="mc-more">
                  <button (click)="loadMoreGroup(g)" [disabled]="g.loading">
                    {{ g.loading ? '加载中…' : '加载更多' }}
                  </button>
                </div>
              }
            }
          </ui-panel>
        }
      } @else {
        <ui-panel [title]="sourceLabel(source)">
          <div panel-actions class="toolbar">
            @if (single.loading) {
              <span class="muted">搜索中…</span>
            } @else {
              <span class="muted">{{ single.items.length }} 个结果</span>
            }
          </div>
          @if (single.error) {
            <div class="notice err">{{ single.error }}</div>
          }
          @if (single.items.length) {
            <div class="grid">
              @for (item of single.items; track item.source + '/' + item.id) {
                <md-model-card [item]="item" [inLibrary]="inLibrary(item)" (download)="openDialog(item)" />
              }
            </div>
            @if (!single.done) {
              <div class="mc-more">
                <button (click)="loadMoreSingle()" [disabled]="single.loading">
                  {{ single.loading ? '加载中…' : '加载更多' }}
                </button>
              </div>
            }
          }
        </ui-panel>
      }
    }

    <!-- 列表视图 -->
    @if (totalItems > 0 && view === 'list') {
      <ui-panel [title]="source === 'all' ? '全部来源' : sourceLabel(source)">
        <div panel-actions class="toolbar">
          <span class="muted">{{ totalItems }} 个结果</span>
        </div>
        @if (source === 'all') {
          @for (g of groups; track g.key) {
            @if (g.error) {
              <div class="notice err">{{ g.label }} 搜索失败：{{ g.error }}</div>
            }
            @if (g.items.length) {
              <h3 class="list-group-title">{{ g.label }}（{{ g.items.length }}）</h3>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th class="col-review">任务</th>
                      <th class="col-size">下载量</th>
                      <th class="col-size">点赞</th>
                      <th class="col-size">更新</th>
                      <th class="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (item of g.items; track item.source + '/' + item.id) {
                      <tr>
                        <td>
                          <div class="cell-name">{{ item.name }}</div>
                          <div class="mono muted cell-path">{{ item.author }}</div>
                        </td>
                        <td class="muted">{{ item.task ? taskLabel(item.task) : '-' }}</td>
                        <td>{{ fmtNum(item.downloads) }}</td>
                        <td>{{ fmtNum(item.likes) }}</td>
                        <td class="muted">{{ item.updated_at ? shortDate(item.updated_at) : '-' }}</td>
                        <td>
                          <div class="toolbar">
                            @if (inLibrary(item)) {
                              <ui-badge tone="green">已在库</ui-badge>
                            }
                            <button class="primary" (click)="openDialog(item)">下载</button>
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        } @else {
          @if (single.error) {
            <div class="notice err">{{ single.error }}</div>
          }
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>模型</th>
                  <th class="col-review">任务</th>
                  <th class="col-size">下载量</th>
                  <th class="col-size">点赞</th>
                  <th class="col-size">更新</th>
                  <th class="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                @for (item of single.items; track item.source + '/' + item.id) {
                  <tr>
                    <td>
                      <div class="cell-name">{{ item.name }}</div>
                      <div class="mono muted cell-path">{{ item.author }}</div>
                    </td>
                    <td class="muted">{{ item.task ? taskLabel(item.task) : '-' }}</td>
                    <td>{{ fmtNum(item.downloads) }}</td>
                    <td>{{ fmtNum(item.likes) }}</td>
                    <td class="muted">{{ item.updated_at ? shortDate(item.updated_at) : '-' }}</td>
                    <td>
                      <div class="toolbar">
                        @if (inLibrary(item)) {
                          <ui-badge tone="green">已在库</ui-badge>
                        }
                        <button class="primary" (click)="openDialog(item)">下载</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (single.items.length && !single.done) {
            <div class="mc-more">
              <button (click)="loadMoreSingle()" [disabled]="single.loading">
                {{ single.loading ? '加载中…' : '加载更多' }}
              </button>
            </div>
          }
        }
      </ui-panel>
    }

    <!-- 空状态 + 热门关键词 -->
    @if (!anyLoading && totalItems === 0) {
      <ui-panel>
        <ui-empty icon="📭" title="没有找到匹配的模型" hint="试试其他关键词、切换下载源，或从热门关键词开始：" />
        <div class="chip-row">
          @for (kw of hotKeywords; track kw) {
            <button class="filter-chip" (click)="searchKeyword(kw)">{{ kw }}</button>
          }
        </div>
      </ui-panel>
    }

    <!-- 行内下载弹层 -->
    @if (dlg) {
      <div class="modal-overlay" (click)="closeDialog()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <strong class="mc-title">{{ dlg.item.name }}</strong>
            <ui-badge tone="blue">{{ dlg.item.source }}</ui-badge>
            <span class="grow"></span>
            <button class="ghost" (click)="closeDialog()" title="关闭">✕</button>
          </div>

          @if (dlg.done) {
            <ui-empty icon="✅" title="已创建下载任务" hint="文件正在后台下载，可到下载任务页查看进度。">
              <button class="primary" data-testid="dialog-goto-tasks" (click)="gotoTasks()">查看下载任务</button>
            </ui-empty>
          } @else {
            @if (dlg.loading) {
              <p class="muted">解析仓库文件中…</p>
            }
            @if (dlg.error) {
              <div class="notice err">{{ dlg.error }}</div>
            }
            @if (dlg.repo) {
              <div class="toolbar mb">
                <span class="muted">
                  共 {{ dlg.repo.files.length }} 个文件 · 已选 {{ dlg.selected.size }} 个 /
                  {{ fmtSize(dlgSize()) }}
                </span>
                <span class="grow"></span>
                <button (click)="toggleAllDlg()">{{ dlg.selected.size === dlg.repo.files.length ? '取消全选' : '全选' }}</button>
              </div>
              <div class="table-wrap dlg-files" data-testid="dialog-files">
                <table>
                  <tbody>
                    @for (f of dlg.repo.files; track f.path) {
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
              <div class="toolbar mt">
                <button
                  class="primary"
                  data-testid="dialog-create"
                  (click)="createTask()"
                  [disabled]="dlg.selected.size === 0 || dlg.creating"
                >
                  {{ dlg.creating ? '创建中…' : '创建下载任务' }}
                </button>
                <span class="muted">策略：{{ dlgStrategy }}</span>
              </div>
            }
          }
        </div>
      </div>
    }
  `,
  styles: `
    .list-group-title {
      margin: 14px 0 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }
  `,
})
export class DiscoverComponent implements OnInit, OnDestroy {
  q = '';
  source = 'all';
  sort = 'downloads';
  task = '';
  view: 'grid' | 'list' = 'grid';
  showDemo = false;

  groups: SourceGroup[] = [];
  single: SingleResult = { items: [], page: 1, loading: false, done: false, error: '' };

  sourceTabs: { key: string; label: string }[] = [];
  settings: AppSettings | null = null;
  private libraryKeys = new Set<string>();

  dlg: DownloadDialog | null = null;
  dlgStrategy = 'direct';

  readonly hotKeywords = HOT_KEYWORDS;
  readonly skeletons = [1, 2, 3, 4, 5, 6];

  private debounceSub: Subscription | null = null;
  private suppressParamSync = false;

  constructor(private api: ApiService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe((p) => {
      if (this.suppressParamSync) {
        this.suppressParamSync = false;
        return;
      }
      const q = p['q'] ?? '';
      const source = p['source'] ?? 'all';
      const sort = p['sort'] ?? 'downloads';
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
    this.debounceSub?.unsubscribe();
  }

  /** 初始化源列表 / 设置 / 模型库索引，然后执行首次搜索 */
  private bootstrap(): void {
    this.api.getSettings().subscribe((s) => {
      this.settings = s;
      this.dlgStrategy = s.download?.strategy || s.default_strategy || 'direct';
      const tabs = Object.keys(s.sources || {})
        .filter((k) => k !== 'demo' || this.showDemo)
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

  onQInput(): void {
    this.debounceSub?.unsubscribe();
    this.debounceSub = timer(300).subscribe(() => this.searchNow());
  }

  searchNow(): void {
    this.debounceSub?.unsubscribe();
    this.applyFilters();
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

  /** 重置分页并重新搜索所有源 */
  private applyFilters(): void {
    if (this.source === 'all') {
      this.groups = this.enabledSources().map((key) => ({
        key,
        label: SOURCE_LABELS[key] || key,
        items: [],
        page: 1,
        loading: true,
        done: false,
        error: '',
      }));
      for (const g of this.groups) this.fetchGroup(g, 1);
    } else {
      this.single = { items: [], page: 1, loading: true, done: false, error: '' };
      this.fetchSingle(1);
    }
    this.syncUrl();
  }

  private enabledSources(): string[] {
    if (!this.sourceTabs.length) return [];
    return this.sourceTabs.filter((t) => t.key !== 'all').map((t) => t.key);
  }

  private fetchGroup(group: SourceGroup, page: number): void {
    group.loading = true;
    group.error = '';
    this.api
      .search({
        q: this.q,
        source: group.key,
        sort: this.sort,
        task: this.task,
        limit: GROUP_PAGE_SIZE,
        page,
      })
      .subscribe({
        next: (res) => {
          if (page === 1) group.items = res.items;
          else group.items = [...group.items, ...res.items];
          group.page = page;
          group.done = res.items.length < GROUP_PAGE_SIZE;
          group.loading = false;
        },
        error: (err) => {
          group.error = errMsg(err, '搜索失败');
          group.loading = false;
          group.done = true;
        },
      });
  }

  private fetchSingle(page: number): void {
    this.single.loading = true;
    this.single.error = '';
    this.api
      .search({
        q: this.q,
        source: this.source,
        sort: this.sort,
        task: this.task,
        limit: SINGLE_PAGE_SIZE,
        page,
      })
      .subscribe({
        next: (res) => {
          this.single.items = page === 1 ? res.items : [...this.single.items, ...res.items];
          this.single.page = page;
          this.single.done = res.items.length < SINGLE_PAGE_SIZE;
          this.single.loading = false;
          const errs = Object.entries(res.errors || {});
          if (errs.length && this.single.items.length === 0) {
            this.single.error = errs.map(([k, v]) => `${SOURCE_LABELS[k] || k}：${v}`).join('；');
          }
        },
        error: (err) => {
          this.single.error = errMsg(err, '搜索失败，请检查网络');
          this.single.loading = false;
          this.single.done = true;
        },
      });
  }

  loadMoreGroup(group: SourceGroup): void {
    this.fetchGroup(group, group.page + 1);
  }

  loadMoreSingle(): void {
    this.fetchSingle(this.single.page + 1);
  }

  // ---------- 派生状态 ----------

  get anyLoading(): boolean {
    if (this.dlg?.loading || this.dlg?.creating) return true;
    if (this.source === 'all') return this.groups.some((g) => g.loading);
    return this.single.loading;
  }

  get totalItems(): number {
    if (this.source === 'all') return this.groups.reduce((n, g) => n + g.items.length, 0);
    return this.single.items.length;
  }

  /** 从当前结果聚合任务类型 chips */
  get taskChips(): { key: string; count: number }[] {
    const counts = new Map<string, number>();
    const all =
      this.source === 'all' ? this.groups.flatMap((g) => g.items) : this.single.items;
    for (const item of all) {
      if (item.task) counts.set(item.task, (counts.get(item.task) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  inLibrary(item: SearchItem): boolean {
    return this.libraryKeys.has(`${item.source}/${item.id}`);
  }

  // ---------- URL 同步 ----------

  private syncUrl(): void {
    const params: Record<string, string> = {};
    if (this.q) params['q'] = this.q;
    if (this.source !== 'all') params['source'] = this.source;
    if (this.sort !== 'downloads') params['sort'] = this.sort;
    if (this.task) params['task'] = this.task;
    if (this.view !== 'grid') params['view'] = this.view;
    if (this.showDemo) params['demo'] = '1';
    this.suppressParamSync = true;
    this.router.navigate([], { queryParams: params, replaceUrl: true }).then(() => {
      this.suppressParamSync = false;
    });
  }

  // ---------- 行内下载弹层 ----------

  openDialog(item: SearchItem): void {
    this.dlg = { item, repo: null, selected: new Set(), loading: true, creating: false, done: false, error: '' };
    this.api.resolve(item.source, item.id, '').subscribe({
      next: (repo) => {
        if (!this.dlg || this.dlg.item !== item) return;
        this.dlg.repo = repo;
        this.dlg.selected = new Set(repo.files.map((f) => f.path));
        this.dlg.loading = false;
      },
      error: (err) => {
        if (!this.dlg) return;
        this.dlg.error = errMsg(err, '解析失败，请检查模型 ID / 网络 / token');
        this.dlg.loading = false;
      },
    });
  }

  closeDialog(): void {
    this.dlg = null;
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

  toggleAllDlg(): void {
    if (!this.dlg?.repo) return;
    if (this.dlg.selected.size === this.dlg.repo.files.length) this.dlg.selected.clear();
    else this.dlg.selected = new Set(this.dlg.repo.files.map((f) => f.path));
  }

  createTask(): void {
    if (!this.dlg?.repo) return;
    this.dlg.creating = true;
    this.dlg.error = '';
    this.api
      .createTask({
        source: this.dlg.item.source,
        repo_id: this.dlg.repo.repo_id,
        revision: this.dlg.repo.revision,
        files: [...this.dlg.selected],
        strategy: this.dlgStrategy,
      })
      .subscribe({
        next: () => {
          if (this.dlg) {
            this.dlg.creating = false;
            this.dlg.done = true;
            this.libraryKeys.add(`${this.dlg.item.source}/${this.dlg.item.id}`);
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
    return TASK_LABELS[task] || task;
  }

  shortDate(value: string): string {
    return value ? value.slice(0, 10) : '';
  }

  fmtNum = fmtNum;
  fmtSize = fmtSize;
}
