import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ProbeService } from '../core/probe.service';
import { publisherKeyOf } from '../core/publisher';
import { sourceLabel } from '../core/source-links';
import { LibraryFacet, LibraryFacets, LibraryModel, errMsg, fmtBytes } from '../core/types';
import {
  CollectionFact,
  FilterBarComponent,
  FilterFacetChange,
  FilterFacetGroup,
  FilterSite,
} from '../ui/filter-bar.component';
import { EmptyComponent } from '../ui/empty.component';
import { LibraryCardComponent } from '../ui/library-card.component';
import { PageHeaderComponent } from '../ui/page-header.component';

type FacetKey = 'folder' | 'task' | 'publisher';
type SortKey = 'name' | 'created' | 'folder' | 'size';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '按名称' },
  { key: 'created', label: '按最新入库' },
  { key: 'folder', label: '按类别' },
  { key: 'size', label: '按大小' },
];

/** 视图切换（segmented）：本地库 / 发现 */
const VIEW_OPTIONS = [
  { key: 'mine', label: '本地库' },
  { key: 'discover', label: '发现' },
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
  imports: [CommonModule, FormsModule, FilterBarComponent, EmptyComponent, LibraryCardComponent, PageHeaderComponent],
  template: `
    <div class="lib-body">
      <div class="lib-main">
        <!-- 分层页头（VIS §3.7.7 定稿）：kicker 只标区，视图切换用 segmented，
             本地页只留一个主操作 —— 「去发现」由视图切换承担（同一件事一个入口）。 -->
        <ui-page-header
          kicker="Models"
          title="模型库"
          hint="你的模型资产：装了什么、占多大、能不能跑。"
          [viewOptions]="viewOptions"
          view="mine"
          (viewChange)="onViewChange($event)"
        >
          <button type="button" class="primary" (click)="scan()" [disabled]="scanning">
            {{ scanning ? '扫描中…' : '扫描入库' }}
          </button>
        </ui-page-header>

        <!-- 一行筛选条（VIS §3.7.8 定稿）：搜索框 → 站点筛选 → 「筛选」浮层
             → 排序 → 结果读数与清除全部。分面从右侧浮层搬进「筛选」浮层，
             侧栏不再保留第二处筛选入口。 -->
        @if (models.length > 0 || loading) {
          <ui-filter-bar
            [search]="q"
            searchPlaceholder="搜索名称或路径"
            (searchChange)="q = $event"
            [sites]="siteChips"
            [site]="site"
            (siteChange)="setSite($event)"
            [facets]="facetGroups"
            [facetSelected]="facetSelected"
            (facetChange)="onFacetChange($event)"
            [sortOptions]="sortOptions"
            [sort]="sort"
            (sortChange)="setSort($event)"
            [count]="loading && !models.length ? null : visible.length"
            [total]="hasFilter ? models.length : null"
            unit="个模型"
            [hasFilter]="hasFilter"
            (clearAll)="clearAll()"
            [facts]="facts"
            [loading]="loading"
            refreshLabel="重新读取模型库"
            (refresh)="load()"
          />
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
                (open)="openFolder(m)"
              />
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .lib-body {
        min-width: 0;
      }
      .lib-main {
        min-width: 0;
      }

      /* ---- 主区 ---- */
      /* 提示条下面直接是卡片墙，补一段下边距，别贴着第一排 */
      .notice { margin-bottom: 14px; }

      .mgrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
        gap: 14px;
        align-items: start;
      }

      /* 骨架用海报卡的形状，加载完不会从「一列文本」跳成「一格格海报」。
         高度取资产卡骨架登记的 min-height（235px，asset-card.css），
         两页同值 —— 骨架与卡片不等高，首屏落地时整墙会跳一次。 */
      .skel-card {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 7px;
        min-height: 235px;
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

  /**
   * 选中的分面值：**收窄语义**（空集 = 这一维不筛）。
   * 「筛选」浮层里的 chip 点亮 = 只看这一档；全灭 = 全部都看。
   */
  private selFolder = new Set<string>();
  private selTask = new Set<string>();
  private selPublisher = new Set<string>();
  /** 站点筛选（来源站）：'' = 全部站点 */
  site = '';
  /** 视图切换（本地库 / 发现） */
  readonly viewOptions = VIEW_OPTIONS;
  private facets: LibraryFacets | null = null;
  private facetsLoaded = false;

  gpu: { vramMb?: number } | null = null;
  loading = false;
  scanning = false;
  message = '';
  messageOk = true;
  constructor(private api: ApiService, private router: Router, private probe: ProbeService) {}

  ngOnInit(): void {
    // 探针结论决定哪些来源站可选（不可达 / 未探测的灰置不可点）
    this.probe.ensure();
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
      },
      error: () => {
        // 分面取不到就退化成「不筛选」，不能因此把列表也弄空
        this.facetsLoaded = false;
      },
    });
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

  /** 「筛选」浮层里的分组：存放类型 / 任务类型 / 发布方。来源站留在行内当站点筛选。 */
  get facetGroups(): FilterFacetGroup[] {
    if (!this.facets) return [];
    const toOptions = (items: LibraryFacet[]) =>
      items.map((i) => ({ key: i.id, label: i.label, count: i.count }));
    return [
      { key: 'folder', label: '存放类型', options: toOptions(this.facets.folder) },
      { key: 'task', label: '任务类型', options: toOptions(this.facets.task) },
      { key: 'publisher', label: '发布方', options: toOptions(this.facets.publisher) },
    ];
  }

  /** 浮层里已点亮的 chip：group key → 选中的 option key */
  get facetSelected(): Record<string, string[]> {
    return {
      folder: [...this.selFolder],
      task: [...this.selTask],
      publisher: [...this.selPublisher],
    };
  }

  private setOf(key: string): Set<string> {
    if (key === 'folder') return this.selFolder;
    if (key === 'task') return this.selTask;
    return this.selPublisher;
  }

  onFacetChange(e: FilterFacetChange): void {
    const set = this.setOf(e.group);
    if (e.on) set.add(e.key);
    else set.delete(e.key);
  }

  /** 站点筛选（行内 chip 行）：来源站 + 探针门控。 */
  get siteChips(): FilterSite[] {
    const list: FilterSite[] = [{ key: '', label: '全部站点' }];
    for (const s of this.facets?.source || []) {
      list.push({
        key: s.id,
        label: sourceLabel(s.id),
        count: s.count,
        disabled: this.probe.isGated(s.id),
        tip: this.probe.tip(s.id),
      });
    }
    return list;
  }

  setSite(key: string): void {
    this.site = key;
  }

  setSort(key: string): void {
    this.sort = key as SortKey;
  }

  get visible(): LibraryModel[] {
    const q = this.q.trim().toLowerCase();
    let list = this.models;
    if (q) {
      list = list.filter((m) =>
        `${m.name} ${m.repo_id || ''} ${m.local_path} ${(m.tags || []).join(' ')}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (this.site) {
      list = list.filter((m) => (m.source || '') === this.site);
    }
    if (this.facetsLoaded) {
      list = list.filter(
        (m) =>
          this.inSel(this.selFolder, m.folder || '') &&
          this.inSel(this.selTask, m.task || '') &&
          this.inSel(this.selPublisher, publisherKeyOf(m.repo_id)),
      );
    }
    return this.sortList(list);
  }

  /** 收窄语义：这一维没选中任何东西 = 不筛 */
  private inSel(set: Set<string>, key: string): boolean {
    return set.size === 0 || set.has(key);
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

  /** 有搜索词、选了来源站，或任一维分面被收窄 —— 只有这时读数才写成「42 / 128」 */
  get hasFilter(): boolean {
    return (
      !!this.q.trim() ||
      !!this.site ||
      this.selFolder.size > 0 ||
      this.selTask.size > 0 ||
      this.selPublisher.size > 0
    );
  }

  /** 视图切换：本地库 ↔ 发现 */
  onViewChange(key: string): void {
    if (key === 'discover') this.router.navigate(['/models/discover']);
    else this.router.navigate(['/models']);
  }

  /** 清除全部筛选：搜索词、站点、分面一起清 */
  clearAll(): void {
    this.q = '';
    this.site = '';
    this.selFolder.clear();
    this.selTask.clear();
    this.selPublisher.clear();
  }

  /** 当前结果里权重缺失 / 损坏的条目数 —— 只读事实，不是筛选项 */
  get visibleMissing(): number {
    return this.visible.filter((m) => {
      const lvl = m.vram?.level;
      return lvl === 'broken' || lvl === 'missing';
    }).length;
  }

  get facts(): CollectionFact[] {
    const missing = this.visibleMissing;
    return [
      { label: '占用', value: fmtBytes(this.visibleSize), title: '当前结果在磁盘上的占用' },
      missing
        ? { label: '权重缺失', value: String(missing), tone: 'err' as const, title: '目录里没有权重文件，下载不完整' }
        : { label: '权重缺失', value: '0', title: '当前结果没有残缺条目' },
    ];
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

  /**
   * 残缺条目的下一步是补救：优先回到**同一个仓库 / 同一个版本 / 同一批文件**，
   * 而不是回发现页按名字重搜 —— 同名模型可能有多个版本，搜出来未必是当初下载的那一个。
   *
   * 下载页已有 `source + repo_id` 的自动解析；再带上 `revision` 与 `files`
   * （library_files 里存的就是仓库内相对路径），下载页会把原文件精确勾回来。
   * 本地导入 / Demo 没有远端仓库，才退回按名字发现。
   */
  redownload(m: LibraryModel): void {
    const remote = ['huggingface', 'modelscope', 'civitai'].includes(m.source) && !!m.repo_id;
    if (!remote) {
      // 卡片对本地导入条目已经不再显示「重新下载」，这里只做防御：
      // 没有原站仓库就没有「原来那一个」，不去发现页拿目录名瞎搜。
      this.message = '本地导入条目没有原站仓库，无法按原文件重下；请从「发现模型」选择同名模型。';
      this.messageOk = false;
      return;
    }
    const params: Record<string, string | string[]> = {
      source: m.source,
      repo_id: m.repo_id,
      redownload: '1',
    };
    if (m.revision) params['revision'] = m.revision;
    const files = (m.files || []).map((f) => f.path).filter(Boolean);
    if (files.length) params['files'] = files;
    this.router.navigate(['/downloads'], { queryParams: params });
  }

  /** 本地导入的残缺条目：主操作是打开目录查看 / 清理，而不是去发现页搜 */
  openFolder(m: LibraryModel): void {
    this.api.openLibrary(m.id).subscribe({
      error: (err) => {
        this.message = errMsg(err, '打开目录失败');
        this.messageOk = false;
      },
    });
  }

  fmtBytes = fmtBytes;
}
