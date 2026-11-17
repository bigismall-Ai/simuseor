import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { sourceLabel } from '../core/source-links';
import { LibraryFacet, LibraryFacets, LibraryModel, errMsg, fmtBytes } from '../core/types';
import { EmptyComponent } from '../ui/empty.component';
import { LibraryCardComponent } from '../ui/library-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';

type FacetKey = 'folder' | 'task' | 'source';
type SortKey = 'name' | 'created' | 'folder' | 'size';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'created', label: '最新入库' },
  { key: 'folder', label: '类别' },
  { key: 'size', label: '大小' },
];

/**
 * 模型库：左（产品导航，由外壳提供）+ 中（卡片流）+ 右（筛选栏）。
 *
 * 页面级筛选不能占掉产品导航的位置 —— 「我在产品的哪」和「我在这一页挑什么」
 * 是两个层级。所以左侧永远是 app.component 的全局导航，筛选收在右侧栏。
 *
 * 分类与排序都依赖**现算**的结果（数据库里没有这两列），所以筛选和排序在
 * 内存里做：一次拉全量，之后搜索/筛选/排序都不再打后端。
 */
@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EmptyComponent, LibraryCardComponent, PageHeaderComponent],
  template: `
    <div class="lib-body">
      <div class="lib-main">
        <ui-page-header
          kicker="Models"
          title="模型库"
          hint="你的模型资产：装了什么、占多大、能不能跑。"
        >
          <button type="button" (click)="scan()" [disabled]="scanning">
            {{ scanning ? '扫描中…' : '扫描入库' }}
          </button>
          <button type="button" class="primary" routerLink="/models/discover">发现模型</button>
        </ui-page-header>

        <!-- 首次加载时不显示「0 个模型」：那会被读成「库是空的」，
             而实际只是在等接口。骨架卡已经说明了正在加载。 -->
        @if (models.length > 0 || !loading) {
          <div class="lib-summary">
            <span><b>{{ visible.length }}</b> 个模型</span>
            <span class="sep">·</span>
            <span>占用 <b>{{ fmtBytes(visibleSize) }}</b></span>
          </div>
        }

        @if (message) {
          <div class="notice" [ngClass]="messageOk ? 'ok' : 'err'">{{ message }}</div>
        }

        @if (loading && models.length === 0) {
          <div class="mgrid">
            @for (i of skeletons; track i) {
              <div class="skel-card">
                <div class="skeleton skel-line sk-w-40"></div>
                <div class="skeleton skel-line sk-w-70"></div>
                <div class="skeleton skel-line sk-w-50"></div>
              </div>
            }
          </div>
        } @else if (!loading && visible.length === 0) {
          <ui-empty
            [title]="models.length ? '没有匹配的模型' : '库里还没有模型'"
            [hint]="models.length ? '换个关键词，或把右侧筛选的分面重置一下。' : '下载完成后会自动出现在这里，或用上面的「扫描入库」导入已有目录。'"
          />
        } @else if (visible.length > 0) {
          <div class="mgrid">
            @for (m of visible; track m.id) {
              <md-library-card
                [model]="m"
                [cover]="coverOf(m)"
                [vramGb]="gpuVramGb"
                (remove)="remove(m)"
                (use)="findWorkflow(m)"
                (redownload)="redownload(m)"
              />
            }
          </div>
        }
      </div>
    </div>

    <!-- 默认收起：只在右缘露出一枚「筛选」浮标 -->
    @if (!railOpen) {
      <button
        type="button"
        class="rail-fab"
        (click)="railOpen = true"
        title="打开筛选"
        aria-label="打开筛选"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 3h12l-4.6 5.6V13l-2.8 1.4V8.6z" />
        </svg>
        <span>筛选</span>
      </button>
    }

    <!-- 悬浮面板：半透明 + 背景模糊，展开时盖在卡片上，不改变列表宽度 -->
    <aside class="rail" [class.open]="railOpen" aria-label="筛选">
      <div class="rail-head">
        <span class="rail-title">筛选</span>
        <button
          type="button"
          class="rail-toggle"
          (click)="railOpen = false"
          title="收起筛选"
          aria-label="收起筛选"
        >×</button>
      </div>

      <div class="rail-body">
            <div class="side-search">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" />
                <path d="M10.4 10.4 14 14" />
              </svg>
              <input [(ngModel)]="q" placeholder="搜索名称或路径" data-testid="lib-search" />
            </div>

            <div class="side-sort">
              <span class="side-label">排序</span>
              <select [(ngModel)]="sort" data-testid="lib-sort">
                @for (o of sortOptions; track o.key) {
                  <option [value]="o.key">{{ o.label }}</option>
                }
              </select>
            </div>

            @for (f of facetDims; track f.key) {
              <div class="facet">
                <div class="facet-head">
                  <span class="facet-title">{{ f.title }}</span>
                  <button type="button" class="facet-clear" (click)="resetFacet(f.key)">重置</button>
                </div>
                <div class="facet-list">
                  @for (item of f.items; track item.id) {
                    <label class="fx">
                      <input
                        type="checkbox"
                        [checked]="isFacetOn(f.key, item.id)"
                        (change)="toggleFacet(f.key, item.id, $event)"
                      />
                      <span class="fx-label" [title]="item.label">{{ item.label }}</span>
                      <span class="fx-count">{{ item.count }}</span>
                      <span class="fx-size">{{ item.sizeText }}</span>
                    </label>
                  }
                </div>
              </div>
            }
          </div>
      </aside>
  `,
  styles: [
    `
      .lib-body {
        min-width: 0;
      }
      .lib-main {
        min-width: 0;
      }

      /* ---- 右侧筛选：默认收起，展开时是浮在卡片上的半透明面板 ---- */
      .rail {
        position: fixed;
        top: 16px;
        right: 16px;
        bottom: 16px;
        z-index: 40;
        width: 236px;
        display: flex;
        flex-direction: column;
        padding: 14px 14px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: color-mix(in oklab, var(--panel) 82%, transparent);
        backdrop-filter: blur(18px) saturate(1.15);
        -webkit-backdrop-filter: blur(18px) saturate(1.15);
        box-shadow: var(--shadow-lg);
        opacity: 0;
        visibility: hidden;
        transform: translateX(calc(100% + 24px));
        transition: opacity 0.16s ease, transform 0.2s ease, visibility 0.2s;
      }
      .rail.open {
        opacity: 1;
        visibility: visible;
        transform: none;
      }

      /* 收起时右缘露出的浮标 */
      .rail-fab {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 30;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 40px;
        padding: 0 10px 0 12px;
        border: 1px solid var(--border);
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: color-mix(in oklab, var(--panel) 86%, transparent);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: var(--text-2);
        font-size: 12px;
        font-weight: 500;
        box-shadow: var(--shadow-md);
        cursor: pointer;
      }
      .rail-fab:hover {
        background: var(--panel);
        color: var(--text);
        border-color: var(--border-strong);
      }
      .rail-fab svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linejoin: round;
      }

      .rail-head {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .rail-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--faint);
      }
      .rail-toggle {
        width: 22px;
        height: 22px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--panel);
        color: var(--muted);
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        display: grid;
        place-items: center;
      }
      .rail-toggle:hover { border-color: var(--border-strong); color: var(--text); }

      .rail-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin-right: -4px;
        padding-right: 4px;
      }

      .side-search { position: relative; margin-bottom: 12px; }
      .side-search svg {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--faint);
        stroke-width: 1.5;
        pointer-events: none;
      }
      .side-search input {
        width: 100%;
        height: 32px;
        padding: 0 10px 0 30px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--panel-2);
        color: var(--text);
        font: inherit;
        font-size: 12.5px;
      }

      .side-sort { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
      .side-label {
        flex: none;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--faint);
      }
      .side-sort select {
        flex: 1;
        min-width: 0;
        height: 28px;
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-2);
        font: inherit;
        font-size: 12px;
        padding: 0 6px;
      }

      .facet { margin-bottom: 18px; }
      .facet-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .facet-title { font-size: 11px; font-weight: 600; color: var(--muted); }
      .facet-clear {
        height: auto;
        padding: 0;
        border: 0;
        background: none;
        color: var(--faint);
        font: inherit;
        font-size: 10.5px;
        cursor: pointer;
      }
      .facet-clear:hover { color: var(--accent); background: none; }

      .fx {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 4px 6px;
        border-radius: 6px;
        cursor: pointer;
      }
      .fx:hover { background: var(--hover); }
      .fx input { width: 13px; height: 13px; flex: none; cursor: pointer; }
      .fx-label {
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        color: var(--text-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fx-count { font-size: 10.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
      .fx-size {
        font-size: 10.5px;
        color: var(--faint);
        font-variant-numeric: tabular-nums;
        min-width: 52px;
        text-align: right;
      }

      /* ---- 主区 ---- */
      .lib-summary {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 2px 12px;
        font-size: 12px;
        color: var(--text-2);
        border-bottom: 1px solid var(--border-soft);
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .lib-summary b { font-weight: 600; font-variant-numeric: tabular-nums; }
      .lib-summary .sep { color: var(--border-strong); }
      /* 提示条下面直接是卡片墙，补一段下边距，别贴着第一排 */
      .notice { margin-bottom: 14px; }

      .mgrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
        gap: 14px;
        align-items: start;
      }

      /* 骨架用海报卡的形状，加载完不会从「一列文本」跳成「一格格海报」 */
      .skel-card {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 7px;
        height: 194px;
        padding: 11px;
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: inset 0 0 0 1px var(--border);
        pointer-events: none;
      }

      @media (max-width: 1200px) {
        .mgrid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
      }
    `,
  ],
})
export class LibraryComponent implements OnInit {
  models: LibraryModel[] = [];
  /** 真实封面：key = `${source}:${repo_id}` */
  covers: Record<string, string> = {};

  q = '';
  sort: SortKey = 'created';
  readonly sortOptions = SORT_OPTIONS;
  readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

  /** 选中的分面值。全选是默认，清空即「一条都不匹配」 */
  private selFolder = new Set<string>();
  private selTask = new Set<string>();
  private selSource = new Set<string>();
  /** 已经见过的分面值：用来区分「新出现的桶」和「用户主动取消的桶」 */
  private knownFolder = new Set<string>();
  private knownTask = new Set<string>();
  private knownSource = new Set<string>();
  private facets: LibraryFacets | null = null;
  private facetsLoaded = false;

  gpu: { vramMb?: number } | null = null;
  loading = false;
  scanning = false;
  message = '';
  messageOk = true;
  /** 默认收起；展开时是悬浮面板 */
  railOpen = false;

  constructor(private api: ApiService, private router: Router) {}

  /** 悬浮面板：Esc 收起，别让人只能去点右上角的 × */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.railOpen) this.railOpen = false;
  }

  ngOnInit(): void {
    this.api.libraryGpu().subscribe({
      next: (g) => (this.gpu = g),
      error: () => (this.gpu = null),
    });
    this.load();
  }

  // ---------- 数据 ----------

  load(): void {
    this.loading = true;
    this.api.listLibrary({}).subscribe({
      next: (models) => {
        this.models = models;
        this.loading = false;
        this.fetchCovers(models);
      },
      error: () => {
        this.loading = false;
      },
    });
    this.api.libraryFacets().subscribe({
      next: (f) => {
        this.facets = f;
        this.facetsLoaded = true;
        this.syncFacets();
      },
      error: () => {
        // 分面取不到就退化成「不筛选」，不能因此把列表也弄空
        this.facetsLoaded = false;
      },
    });
  }

  /**
   * 分面刷新时同步选中集合：
   *  - 第一次到达：全选
   *  - 之后（扫描/删除后）：保留用户的选择，但**新出现的桶自动选中** ——
   *    否则刚扫描进来的新目录不在已选集合里，卡片会莫名其妙地消失；
   *  - 已经不存在的桶从两边一起清掉，避免选中集合里留下永远不匹配的 id。
   */
  private syncFacets(): void {
    if (!this.facets) return;
    const sync = (known: Set<string>, selected: Set<string>, items: LibraryFacet[]) => {
      const ids = new Set(items.map((i) => i.id));
      for (const id of ids) {
        if (!known.has(id)) {
          known.add(id);
          selected.add(id);
        }
      }
      for (const id of [...known]) {
        if (!ids.has(id)) {
          known.delete(id);
          selected.delete(id);
        }
      }
    };
    sync(this.knownFolder, this.selFolder, this.facets.folder);
    sync(this.knownTask, this.selTask, this.facets.task);
    sync(this.knownSource, this.selSource, this.facets.source);
  }

  /**
   * 真实封面：一次请求发完，不要分批串行。
   * 取不到只是退回家族铭牌，不该冒错误提示。
   */
  private fetchCovers(models: LibraryModel[]): void {
    const groups = models
      .filter(
        (m) =>
          m.repo_id &&
          m.source !== 'imported' &&
          m.source !== 'templates' &&
          m.source !== 'demo',
      )
      .slice(0, 80)
      .map((m) => ({
        key: `${m.source}:${m.repo_id}`,
        items: [{ source: m.source, id: m.repo_id, image: '' }],
      }));
    if (!groups.length) return;
    this.api.covers(groups).subscribe({
      next: (res) => {
        for (const g of groups) this.covers[g.key] = res.covers[g.key] || '';
      },
      error: () => {},
    });
  }

  coverOf(m: LibraryModel): string {
    return this.covers[`${m.source}:${m.repo_id}`] || '';
  }

  // ---------- 筛选 / 排序 ----------

  get facetDims(): { key: FacetKey; title: string; items: LibraryFacet[] }[] {
    if (!this.facets) return [];
    return [
      { key: 'folder', title: '存放类型', items: this.facets.folder },
      { key: 'task', title: '任务类型', items: this.facets.task },
      {
        key: 'source',
        title: '来源',
        items: this.facets.source.map((s) => ({ ...s, label: sourceLabel(s.id) })),
      },
    ];
  }

  private setOf(key: FacetKey): Set<string> {
    return key === 'folder' ? this.selFolder : key === 'task' ? this.selTask : this.selSource;
  }

  isFacetOn(key: FacetKey, id: string): boolean {
    return this.setOf(key).has(id);
  }

  toggleFacet(key: FacetKey, id: string, event: Event): void {
    const set = this.setOf(key);
    if ((event.target as HTMLInputElement).checked) set.add(id);
    else set.delete(id);
  }

  /** 重置 = 把这一维的全部值重新选中（清空即一条都不匹配，不是「全部」） */
  resetFacet(key: FacetKey): void {
    const dim = this.facetDims.find((d) => d.key === key);
    if (!dim) return;
    const set = new Set(dim.items.map((i) => i.id));
    if (key === 'folder') this.selFolder = set;
    else if (key === 'task') this.selTask = set;
    else this.selSource = set;
  }

  get visible(): LibraryModel[] {
    const q = this.q.trim().toLowerCase();
    let list = this.models;
    if (q) {
      list = list.filter((m) =>
        `${m.name} ${m.local_path} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q),
      );
    }
    if (this.facetsLoaded) {
      list = list.filter(
        (m) =>
          this.selFolder.has(m.folder || '') &&
          this.selTask.has(m.task || '') &&
          this.selSource.has(m.source || ''),
      );
    }
    return this.sortList(list);
  }

  private sortList(list: LibraryModel[]): LibraryModel[] {
    const arr = list.slice();
    switch (this.sort) {
      case 'name':
        arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
        break;
      case 'folder':
        arr.sort(
          (a, b) =>
            (a.folderLabel || '').localeCompare(b.folderLabel || '', 'zh') ||
            (a.name || '').localeCompare(b.name || '', 'zh'),
        );
        break;
      case 'size':
        arr.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
        break;
      default:
        arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        break;
    }
    return arr;
  }

  get visibleSize(): number {
    return this.visible.reduce((sum, m) => sum + (m.size_bytes || 0), 0);
  }

  get gpuVramGb(): number {
    return (this.gpu?.vramMb ?? 0) / 1024;
  }

  // ---------- 动作 ----------

  /** 扫描入库：原生目录选择框选根目录，每个子文件夹算一个模型 */
  scan(): void {
    if (this.scanning) return;
    // 目录选择框是后端弹出的原生窗口，可能挂很久；先锁住按钮，避免点出两个框
    this.scanning = true;
    this.api.browseFolder('').subscribe({
      next: (res) => {
        if (!res.path) {
          this.scanning = false;
          return;
        }
        this.api.scanLibrary(res.path).subscribe({
          next: (r) => {
            this.scanning = false;
            this.message =
              `扫描完成，新增 ${r.created} 个模型` +
              (r.matched ? `，识别来源 ${r.matched} 个` : '');
            this.messageOk = true;
            this.load();
          },
          error: (err) => {
            this.scanning = false;
            this.message = errMsg(err, '扫描失败');
            this.messageOk = false;
          },
        });
      },
      error: (err) => {
        this.scanning = false;
        this.message = errMsg(err, '无法打开目录选择框');
        this.messageOk = false;
      },
    });
  }

  remove(m: LibraryModel): void {
    if (!confirm(`从模型库删除「${m.name}」记录？（不会删除磁盘文件）`)) return;
    this.api.deleteLibrary(m.id).subscribe(() => this.load());
  }

  /** 找适配工作流：去工作流发现页，用模型名预填检索 */
  findWorkflow(m: LibraryModel): void {
    this.router.navigate(['/workflows/discover'], { queryParams: { q: m.name } });
  }

  /** 残缺条目的下一步是补救：去发现页按名字重新找 */
  redownload(m: LibraryModel): void {
    this.router.navigate(['/models/discover'], { queryParams: { q: m.name } });
  }

  fmtBytes = fmtBytes;
}
