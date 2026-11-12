import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { DiscoverCacheService } from '../core/discover-cache.service';
import { RepoInfo, SearchItem, errMsg, fmtNum, fmtSize } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
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
  /** 落盘目录（ComfyUI 模型分类），由后端建议、用户可改 */
  folder: string;
  loading: boolean;
  creating: boolean;
  done: boolean;
  error: string;
}

/** ComfyUI 模型目录；顺序与后端 model_dirs.py 保持一致 */
const FOLDER_OPTIONS: { key: string; label: string }[] = [
  { key: 'checkpoints', label: 'checkpoints · 主模型' },
  { key: 'diffusion_models', label: 'diffusion_models · 扩散主干' },
  { key: 'text_encoders', label: 'text_encoders · 文本编码器' },
  { key: 'vae', label: 'vae · VAE' },
  { key: 'loras', label: 'loras · LoRA' },
  { key: 'controlnet', label: 'controlnet · ControlNet' },
  { key: 'upscale_models', label: 'upscale_models · 放大模型' },
  { key: 'embeddings', label: 'embeddings · TextualInversion' },
  { key: 'clip_vision', label: 'clip_vision · 视觉编码' },
  { key: 'style_models', label: 'style_models · 风格模型' },
  { key: 'model_patches', label: 'model_patches · 模型补丁' },
  { key: 'photomaker', label: 'photomaker · PhotoMaker' },
  { key: 'vae_approx', label: 'vae_approx · 预览 VAE' },
  { key: 'hypernetworks', label: 'hypernetworks · 超网络' },
  { key: 'gligen', label: 'gligen · GLIGEN' },
  { key: 'sams', label: 'sams · SAM 分割' },
  { key: 'ultralytics', label: 'ultralytics · YOLO 检测' },
  { key: 'rmbg', label: 'rmbg · 背景移除' },
  { key: 'audio_encoders', label: 'audio_encoders · 音频编码' },
  { key: 'configs', label: 'configs · 配置' },
  { key: 'diffusers', label: 'diffusers · Diffusers 目录' },
  { key: 'onnx', label: 'onnx · ONNX' },
  { key: 'workflows', label: 'workflows · 工作流' },
];

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
const PAGE_SIZE = 20;

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [FormsModule, BadgeComponent, EmptyComponent, ModelCardComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      kicker="Discover"
      title="模型发现"
      hint="跨源搜索合并为一个列表。同一模型在多个来源时，卡片上会并列标出来源，下载时再选走哪一边。"
    >
      <span class="head-count">{{ rows.length }}{{ done ? '' : '+' }} 个模型</span>
    </ui-page-header>

    <ui-panel>
      <div class="toolbar">
        <input
          class="grow"
          [(ngModel)]="q"
          placeholder="搜索模型关键词，如 qwen / lora / flux"
          (input)="onQInput()"
          (keyup.enter)="searchNow()"
          data-testid="search-input"
        />
        <button class="primary" (click)="searchNow()" [disabled]="loading" data-testid="search-btn">搜索</button>
      </div>

      <div class="toolbar mt">
        <div class="segmented">
          @for (t of sourceTabs; track t.key) {
            <button [class.active]="source === t.key" (click)="setSource(t.key)">{{ t.label }}</button>
          }
        </div>
        <span class="grow"></span>
        <div class="segmented">
          <button [class.active]="sort === 'trending'" (click)="setSort('trending')" title="按站点默认推荐">综合</button>
          <button [class.active]="sort === 'downloads'" (click)="setSort('downloads')" title="按下载量">下载量</button>
          <button [class.active]="sort === 'likes'" (click)="setSort('likes')" title="按点赞">点赞</button>
          <button [class.active]="sort === 'recent'" (click)="setSort('recent')" title="最新更新">最新</button>
        </div>
        <div class="segmented view-toggle">
          <button [class.active]="view === 'grid'" (click)="setView('grid')" title="网格视图">▦</button>
          <button [class.active]="view === 'list'" (click)="setView('list')" title="列表视图">☰</button>
        </div>
      </div>

      @if (taskChips.length > 1 || task) {
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

    @for (e of errors; track e.label) {
      <div class="notice err">{{ e.label }} 搜索失败：{{ e.message }}</div>
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
                    <div class="toolbar">
                      @for (it of row.items; track it.source) {
                        <a
                          class="src-badge"
                          [href]="it.url"
                          target="_blank"
                          rel="noreferrer"
                          [title]="'打开 ' + sourceLabel(it.source) + ' 上的原始仓库'"
                        >
                          <ui-badge [tone]="sourceTone(it.source)">{{ it.source }} ↗</ui-badge>
                        </a>
                      }
                    </div>
                  </td>
                  <td class="muted">{{ row.items[0].task ? taskLabel(row.items[0].task) : '-' }}</td>
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
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div class="modal-title">
              <strong class="mc-title">{{ activeItem()?.name }}</strong>
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
              <div class="notice err">{{ dlg.error }}</div>
            }
            @if (dlg.repo) {
              <div class="toolbar mb">
                <span class="muted">存放目录</span>
                <select [(ngModel)]="dlg.folder" data-testid="dialog-folder">
                  @for (f of folders; track f.key) {
                    <option [value]="f.key">{{ f.label }}</option>
                  }
                </select>
                <span class="muted mono">models/{{ dlg.folder }}/{{ dlg.repo.display_name }}</span>
              </div>
              <div class="toolbar mb">
                <span class="muted">
                  共 {{ dlg.repo.files.length }} 个文件 · 已选 {{ dlg.selected.size }} 个 /
                  {{ fmtSize(dlgSize()) }}
                </span>
                <span class="grow"></span>
                <button (click)="toggleAllDlg()">
                  {{ dlg.selected.size === dlg.repo.files.length ? '取消全选' : '全选' }}
                </button>
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
  styles: [
    `
      .head-count {
        font: 500 11px/1 "Cascadia Mono", Consolas, monospace;
        color: var(--faint);
        letter-spacing: 0.02em;
        font-variant-numeric: tabular-nums;
      }

      /* 骨架用海报卡的形状，加载完不会从「一列文本」跳成「一格格海报」 */
      .skel-card {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 7px;
        min-height: 202px;
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

      .view-toggle button { padding: 0 8px; letter-spacing: 0.02em; }

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

  rows: MergedRow[] = [];
  errors: SourceError[] = [];
  loading = false;
  done = false;

  sourceTabs: { key: string; label: string }[] = [];
  dlg: DownloadDialog | null = null;
  dlgStrategy = 'direct';

  readonly hotKeywords = HOT_KEYWORDS;
  readonly folders = FOLDER_OPTIONS;
  readonly skeletons = [1, 2, 3, 4, 5];

  private rawItems: SearchItem[] = [];
  private page = 1;
  private libraryKeys = new Set<string>();
  private debounceSub: Subscription | null = null;
  private suppressParamSync = false;
  /** 封面批次号：重新搜索时自增，旧批次的回调直接丢弃 */
  private coverBatch = 0;
  /** 每次 fetchPage 自增，用来丢弃过期响应（连续改筛选时会有多条在飞） */
  private fetchToken = 0;
  /** 各来源的到达情况，按标签顺序拼成列表 */
  private perSource = new Map<string, { items: SearchItem[]; full: boolean; error: string }>();

  readonly cache = inject(DiscoverCacheService);

  constructor(private api: ApiService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
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
    this.debounceSub?.unsubscribe();
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

  private applyFilters(): void {
    const key = this.searchKey();
    const hit = this.cache.getSearch(key);
    if (hit) {
      // 有缓存就先渲染，别让人对着骨架屏等三秒
      this.rawItems = hit.items;
      this.errors = hit.errors;
      this.done = hit.done;
      this.page = hit.page;
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
          this.perSource.set(key, {
            items: page === 1 || !prev ? res.items : [...prev.items, ...res.items],
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
    this.dlg = {
      row,
      active: 0,
      repo: null,
      selected: new Set(),
      folder: '',
      loading: true,
      creating: false,
      done: false,
      error: '',
    };
    this.loadRepo();
  }

  activeItem(): SearchItem | null {
    return this.dlg ? this.dlg.row.items[this.dlg.active] : null;
  }

  switchSource(index: number): void {
    if (!this.dlg || this.dlg.active === index) return;
    this.dlg.active = index;
    this.dlg.repo = null;
    this.dlg.selected = new Set();
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
        this.dlg.repo = repo;
        this.dlg.folder = repo.target_folder || 'checkpoints';
        this.dlg.selected = new Set(repo.files.map((f) => f.path));
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
        target_folder: this.dlg.folder,
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

  sourceTone(source: string): 'blue' | 'green' | 'orange' | 'gray' {
    if (source === 'huggingface') return 'blue';
    if (source === 'modelscope') return 'green';
    if (source === 'civitai') return 'orange';
    return 'gray';
  }

  taskLabel(task: string): string {
    return TASK_LABELS[task] || task;
  }

  fmtNum = fmtNum;
  fmtSize = fmtSize;
}
