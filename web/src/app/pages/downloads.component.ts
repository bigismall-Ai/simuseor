import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AppSettings, RemoteFile, RepoInfo, Task, errMsg, fmtSize, pct, proxyUrl } from '../core/types';
import { matchedWeightFiles, weightFiles } from '../core/weight-files';
import { BadgeTone, BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';
import {
  CollectionFact,
  FilterBarComponent,
  FilterFacetChange,
  FilterFacetGroup,
  FilterSite,
} from '../ui/filter-bar.component';
import { ProbeService } from '../core/probe.service';

@Component({
  selector: 'app-downloads',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BadgeComponent,
    EmptyComponent,
    FieldComponent,
    FilterBarComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <ui-page-header
      kicker="Downloads"
      title="下载任务"
      hint="解析仓库 → 自动挑权重 → aria2 下载，断点续传由 .aria2 文件维护。"
    />

    <ui-panel kicker="New task" title="新建下载" hint="填模型 ID 即可解析；默认只列真实权重并自动归类，其他权重可展开。">
      <div class="form-grid">
        <ui-field label="下载源">
          <select [(ngModel)]="source" (ngModelChange)="onSourceChange()">
            @for (s of visibleSourceKeys; track s) {
              <option [value]="s">{{ settings?.sources?.[s]?.label || s }}</option>
            }
          </select>
        </ui-field>
        <ui-field label="模型 ID">
          <input class="repo-input" [(ngModel)]="repoId" placeholder="如 microsoft/Phi-3-mini-4k-instruct">
        </ui-field>
        <ui-field label="Revision（可选）">
          <input [(ngModel)]="revision" placeholder="main / master / tag">
        </ui-field>
        <ui-field label="下载策略">
          <select [(ngModel)]="strategy">
            <option value="direct">direct - aria2 直连</option>
            <option value="mirror">mirror - 多站点分片</option>
            <option value="sdk">sdk - 官方下载 SDK</option>
          </select>
        </ui-field>
        <ui-field label="保存目录（可选，留空用设置值）">
          <div class="toolbar">
            <input class="grow mono" [(ngModel)]="saveDir" [placeholder]="currentSaveDir()">
            <button (click)="browseSaveDir()">选择文件夹…</button>
          </div>
        </ui-field>
      </div>

      <div class="toolbar mt">
        <button class="primary" (click)="resolveRepo()" [disabled]="resolving || !repoId">
          {{ resolving ? '解析中…' : '解析文件' }}
        </button>
        <span class="muted net-note">{{ proxySummary() }}</span>
      </div>

      @if (error) {
        <!-- 错误态要能被读屏播报：role="alert" 是 VIS §7.2 的 E 态要求 -->
        <div class="notice err" role="alert">{{ error }}</div>
      }

      @if (repo) {
        <div class="mt">
          <div class="repo-bar">
            <div class="repo-id">
              <strong>{{ repo.display_name }}</strong>
              <ui-badge tone="blue">{{ repo.source }}</ui-badge>
              <span class="muted">{{ visibleFiles().length }} 个权重</span>
            </div>
            <span class="grow"></span>
            <span class="pill-row">
              @for (g of folderPlan; track g.id) {
                <span class="pill" [title]="g.id">{{ g.id }} · {{ g.count }}</span>
              }
            </span>
            @if (allWeights.length > matchedWeights.length) {
              <button (click)="toggleAllWeights()">
                {{ showAllWeights ? '只看匹配权重' : '查看全部权重 (' + allWeights.length + ')' }}
              </button>
            }
            <span class="muted picked">已选 {{ selectedCount() }} 个 · {{ fmtSize(selectedSize()) }}</span>
            <button class="primary" (click)="startDownload()" [disabled]="selectedCount() === 0 || starting">
              {{ starting ? '创建中…' : '开始下载' }}
            </button>
          </div>

          @if (restoreNote === 'exact') {
            <div class="notice ok mt">
              已按上次下载恢复 {{ restoreCount }} 个文件并勾选；确认无误后点「开始下载」。
            </div>
          } @else if (restoreNote === 'partial') {
            <div class="notice mt">
              原仓库当前只找到 {{ restoreCount }} / {{ restoreWanted }} 个原文件，已勾选找到的部分；
              缺失项可能已被仓库移除或改过 revision。
            </div>
          } @else if (restoreNote === 'fallback') {
            <div class="notice info mt">
              原文件已不在当前仓库版本里，已按默认匹配权重重新勾选；请确认后再下载。
            </div>
          }

          @if (allWeights.length === 0) {
            <div class="notice mt">
              这个仓库里没有可下载的权重文件。config / tokenizer / README 等非权重文件已隐藏。
            </div>
          } @else {
            @if (matchedWeights.length === 0 && !showAllWeights) {
              <div class="notice mt">
                这个仓库的权重是 Diffusers 分片格式（如 model-00001-of-00014），ComfyUI 不能直接加载，默认没有勾选。
                可展开全部权重手动选择，或回发现页找同一模型的 Comfy-Org 单文件版本。
                <button (click)="toggleAllWeights()">查看全部权重 ({{ allWeights.length }})</button>
              </div>
            }
            @if (visibleFiles().length) {
              <div class="table-wrap mt file-table">
                <table>
                  <thead>
                    <tr>
                      <th class="col-check" scope="col"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)"></th>
                      <th scope="col">文件</th>
                      <th class="col-folder" scope="col">目录</th>
                      <th class="col-size" scope="col">大小</th>
                      <th class="col-progress" scope="col">候选站点</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (file of visibleFiles(); track file.path) {
                      <tr>
                        <td><input type="checkbox" [checked]="isSelected(file.path)" (change)="toggleOne(file.path, $event)"></td>
                        <td>
                          <div class="mono">{{ file.path }}</div>
                          <div class="mono muted cell-path">
                            @for (c of file.candidates.slice(0, 2); track c) {
                              <span>{{ hostOf(c) }}</span>@if (!$last) { · }
                            }
                            @if (file.candidates.length > 2) { +{{ file.candidates.length - 2 }} }
                          </div>
                        </td>
                        <td><span class="pill">{{ file.folder || '—' }}</span></td>
                        <td class="muted">{{ fmtSize(file.size) }}</td>
                        <td class="muted">{{ file.candidates.length }} 个</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </div>
      }
    </ui-panel>

    <!-- 一行筛选条（VIS §3.7.8 定稿）：搜索框 → 站点筛选（来源站）
         → 「筛选」浮层（任务状态）→ 排序 → 结果读数与清除全部。 -->
    <ui-filter-bar
      [search]="taskQ"
      searchPlaceholder="搜索任务，如模型 ID 或仓库名"
      (searchChange)="taskQ = $event"
      [sites]="taskSites"
      [site]="taskSite"
      (siteChange)="taskSite = $event"
      [facets]="taskFacets"
      [facetSelected]="taskFacetSelected"
      (facetChange)="onTaskFacetChange($event)"
      [sortOptions]="taskSortOptions"
      [sort]="taskSort"
      (sortChange)="setTaskSort($event)"
      [count]="filteredTasks.length"
      [total]="hasTaskFilter ? tasks.length : null"
      unit="个任务"
      [hasFilter]="hasTaskFilter"
      (clearAll)="clearTaskFilters()"
      [facts]="taskFacts"
      refreshLabel="刷新任务列表"
      (refresh)="refreshTasks()"
    />

    <ui-panel title="下载任务" hint="模型与工作流都在这里排队（断点续传由 aria2 维护）；节点包是 git 仓库，安装进度在节点管理页看。">
      @if (filteredTasks.length === 0) {
        @if (tasks.length === 0) {
          <ui-empty title="还没有下载任务" hint="上方解析并开始下载后，任务会出现在这里。" />
        } @else if (taskQ.trim()) {
          <ui-empty [title]="'没有找到匹配「' + taskQ.trim() + '」的任务'" hint="换个关键词，或清掉搜索词看全部。" />
        } @else {
          <ui-empty title="这些筛选条件下没有任务" hint="放宽其中一个条件试试，或者一次全清。" />
        }
      }

      @for (task of filteredTasks; track task.id) {
        <div class="task">
          <div class="head">
            <span class="title">{{ task.repo_id }}</span>
            <ui-badge [tone]="statusTone(task.status)">{{ statusLabel(task.status) }}</ui-badge>
            @if (task.kind === 'workflow') {
              <!-- 「工作流」是任务**分类**不是状态：按 VIS §3.7.2 用中性胶囊，不占语义色 -->
              <span class="pill">工作流</span>
            }
            <span class="mono muted">{{ task.strategy }}</span>
            <span class="meta">{{ fmtSize(task.done_bytes) }} / {{ fmtSize(task.total_bytes) }}</span>
            <div class="actions">
              @if (task.status === 'downloading' || task.status === 'pending') {
                <button class="btn-xs" (click)="pause(task)">暂停</button>
                <button class="btn-xs danger" (click)="cancel(task)">取消</button>
              }
              @if (task.status === 'paused') {
                <button class="btn-xs primary" (click)="resume(task)">继续</button>
                <button class="btn-xs danger" (click)="cancel(task)">取消</button>
              }
              @if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
                <button class="btn-xs danger" (click)="remove(task)">删除记录</button>
              }
            </div>
          </div>

          <div class="progress-row">
            <div class="progress" [ngClass]="task.status">
              <div [style.width.%]="pct(task.done_bytes, task.total_bytes)"></div>
            </div>
            <span class="task-pct">{{ pct(task.done_bytes, task.total_bytes) }}%</span>
          </div>

          <div class="task-dir mono">{{ task.target_dir }}</div>
          <details class="files">
            <summary>文件明细（{{ task.files.length }}）</summary>
            <div class="table-wrap mt">
              <table>
                <thead>
                  <tr>
                    <th scope="col">文件</th>
                    <th class="col-folder" scope="col">目录</th>
                    <th class="col-progress" scope="col">进度</th>
                    <th class="col-status" scope="col">状态</th>
                    <th class="col-url" scope="col">来源 URL</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of task.files; track f.id) {
                    <tr>
                      <td class="mono">{{ f.path }}</td>
                      <td><span class="pill">{{ f.folder || '—' }}</span></td>
                      <td class="mono muted">{{ fmtSize(f.done_bytes) }} / {{ fmtSize(f.size) }}</td>
                      <td><ui-badge [tone]="statusTone(f.status)">{{ statusLabel(f.status) }}</ui-badge></td>
                      <td class="mono muted" [title]="f.url || ''">{{ hostOf(f.url) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        </div>
      }
    </ui-panel>
  `,
  styles: [
    `
      /* 模型 ID 是本页唯一需要手打的字段，用等宽字体，斜杠和大小写才看得准 */
      .repo-input {
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 12px;
      }
      .net-note { font-size: 11.5px; }

      /* 保存目录要同时放路径和按钮，独占两格才不会把按钮挤成一小截 */
      .form-grid ui-field:last-child { grid-column: span 2; }
      @media (max-width: 720px) {
        .form-grid ui-field:last-child { grid-column: auto; }
      }

      .repo-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 9px 12px;
        background: var(--panel-2);
        border: 1px solid var(--border-soft);
        border-radius: var(--radius-sm);
      }
      .repo-id {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }
      .repo-id strong { font-size: 12.5px; font-weight: 600; word-break: break-all; }
      .picked { font-variant-numeric: tabular-nums; font-size: 11.5px; }

      .file-table {
        border: 1px solid var(--border-soft);
        border-radius: var(--radius-sm);
        padding: 0 2px;
      }
      .file-table th:first-child,
      .file-table td:first-child { padding-left: 12px; }

      /* 进度条独占一行，右端跟一个百分比：只有条没有数字，长任务看不出是不是卡住了 */
      .progress-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 11px;
      }
      .progress-row .progress { flex: 1; margin-top: 0; }
      .task-pct {
        flex: none;
        width: 32px;
        text-align: right;
        font: 500 10.5px/1 "Cascadia Mono", Consolas, monospace;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }

      .task-dir {
        margin-top: 8px;
        font-size: 10.5px;
        color: var(--muted);
        word-break: break-all;
      }
    `,
  ],
})
export class DownloadsComponent implements OnInit, OnDestroy {
  settings: AppSettings | null = null;
  sourceKeys: string[] = [];
  source = 'huggingface';
  repoId = '';
  revision = '';
  strategy = 'direct';
  saveDir = '';
  repo: RepoInfo | null = null;
  /** 仓库里全部真实权重（非权重文件不进入下载清单） */
  allWeights: RemoteFile[] = [];
  /** 默认展示的匹配权重：主权重 / 非量化版本，其余折叠 */
  matchedWeights: RemoteFile[] = [];
  showAllWeights = false;
  selected = new Set<string>();
  tasks: Task[] = [];
  taskFilter = 'all';
  /** 任务列表的搜索词（按模型 ID / 落盘目录找） */
  taskQ = '';
  /** 站点筛选（来源站）：'' = 全部站点 */
  taskSite = '';
  /** 任务排序 */
  taskSort = 'created';
  readonly taskSortOptions = [
    { key: 'created', label: '按创建时间' },
    { key: 'size', label: '按总大小' },
  ];
  resolving = false;
  starting = false;
  error = '';
  showDemo = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoSource = '';
  // autoRepo / autoRevision / autoFiles 只在 URL 自动解析时使用；手工操作不会碰它们
  private autoRepo = '';
  private autoRevision = '';
  /** 「重新下载」带过来的原文件路径：解析完成后精确勾回 */
  private autoFiles: string[] = [];
  /** exact = 原文件全部勾回；partial = 只找回一部分；fallback = 原文件不在当前仓库 */
  restoreNote: '' | 'exact' | 'partial' | 'fallback' = '';
  restoreCount = 0;
  restoreWanted = 0;

  constructor(private api: ApiService, private route: ActivatedRoute, private probe: ProbeService) {}

  ngOnInit(): void {
    // 探针结论决定哪些来源站可选（不可达 / 未探测的灰置不可点）
    this.probe.ensure();
    this.route.queryParams.subscribe((p) => {
      this.showDemo = p['demo'] === '1';
      this.autoFiles = this.readFilesParam(p['files']);
      this.autoRevision = typeof p['revision'] === 'string' ? p['revision'] : '';
      this.restoreNote = '';
      this.restoreCount = 0;
      if (p['source'] && p['repo_id']) {
        this.autoSource = p['source'];
        this.autoRepo = p['repo_id'];
        this.tryAutoResolve();
      }
    });
    this.api.getSettings().subscribe((s) => {
      this.settings = s;
      this.sourceKeys = Object.keys(s.sources || {}).filter((k) => k !== 'demo');
      if (!this.autoSource) {
        this.onSourceChange();
      }
      this.tryAutoResolve();
    });
    this.refreshTasks();
    this.timer = setInterval(() => this.refreshTasks(), 1500);
  }

  /** 当前表格里展示的权重：默认匹配权重，展开后是全部权重 */
  visibleFiles(): RemoteFile[] {
    return this.showAllWeights ? this.allWeights : this.matchedWeights;
  }

  toggleAllWeights(): void {
    this.showAllWeights = !this.showAllWeights;
  }

  /** 解析结果里每个目标目录各几个文件（分体仓库会显示多枚） */
  get folderPlan(): { id: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const f of this.visibleFiles()) {
      const key = f.folder || 'checkpoints';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({ id, count }));
  }

  get visibleSourceKeys(): string[] {
    return this.showDemo ? [...this.sourceKeys, 'demo'] : this.sourceKeys;
  }

  /** 叠了搜索与来源、但没叠状态的任务（状态 chip 上的数字按这个口径算） */
  private taskBase(): Task[] {
    const q = this.taskQ.trim().toLowerCase();
    let list = this.tasks;
    if (q) {
      list = list.filter((t) =>
        `${t.repo_id} ${t.target_dir || ''} ${t.source}`.toLowerCase().includes(q),
      );
    }
    if (this.taskSite) list = list.filter((t) => t.source === this.taskSite);
    return list;
  }

  get filteredTasks(): Task[] {
    let list = this.taskBase();
    if (this.taskFilter === 'active') {
      list = list.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status));
    } else if (this.taskFilter !== 'all') {
      list = list.filter((t) => t.status === this.taskFilter);
    }
    return this.sortTasks(list);
  }

  private sortTasks(list: Task[]): Task[] {
    const arr = list.slice();
    if (this.taskSort === 'size') {
      arr.sort((a, b) => (b.total_bytes || 0) - (a.total_bytes || 0));
    } else {
      arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }
    return arr;
  }

  setTaskSort(key: string): void {
    this.taskSort = key;
  }

  /** 站点筛选（行内 chip 行）：可下载的来源站 ＋ 探针门控 */
  get taskSites(): FilterSite[] {
    const list: FilterSite[] = [{ key: '', label: '全部站点' }];
    for (const k of this.visibleSourceKeys) {
      list.push({
        key: k,
        label: this.settings?.sources?.[k]?.label || k,
        disabled: this.probe.isGated(k),
        tip: this.probe.tip(k),
      });
    }
    return list;
  }

  /** 「筛选」浮层里的分组：任务状态 */
  get taskFacets(): FilterFacetGroup[] {
    const base = this.taskBase();
    const count = (key: string) => {
      if (key === 'active') {
        return base.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status)).length;
      }
      return base.filter((t) => t.status === key).length;
    };
    return [
      {
        key: 'status',
        label: '任务状态',
        options: [
          { key: 'active', label: '进行中', count: count('active') },
          { key: 'completed', label: '已完成', count: count('completed') },
          { key: 'failed', label: '失败', count: count('failed') },
          { key: 'canceled', label: '已取消', count: count('canceled') },
        ],
      },
    ];
  }

  get taskFacetSelected(): Record<string, string[]> {
    return { status: this.taskFilter === 'all' ? [] : [this.taskFilter] };
  }

  onTaskFacetChange(e: FilterFacetChange): void {
    if (e.group !== 'status') return;
    this.taskFilter = e.on ? e.key : 'all';
  }

  get hasTaskFilter(): boolean {
    return !!this.taskQ.trim() || !!this.taskSite || this.taskFilter !== 'all';
  }

  /** 清除全部筛选 */
  clearTaskFilters(): void {
    this.taskQ = '';
    this.taskSite = '';
    this.taskFilter = 'all';
  }

  /** 事实槽：任务分布（只读聚合） */
  get taskFacts(): CollectionFact[] {
    const base = this.taskBase();
    const active = base.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status)).length;
    const done = base.filter((t) => t.status === 'completed').length;
    const failed = base.filter((t) => t.status === 'failed').length;
    return [
      { label: '进行中', value: String(active), title: '正在下载或排队中的任务' },
      { label: '已完成', value: String(done), title: '已经下完的任务' },
      failed
        ? { label: '失败', value: String(failed), tone: 'err' as const, title: '下载失败的任务' }
        : { label: '失败', value: '0', title: '当前没有失败的任务' },
    ];
  }

  /** `files` 可能是重复参数（string[]）或逗号分隔（string），两种都收 */
  private readFilesParam(v: unknown): string[] {
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
    }
    if (typeof v === 'string') {
      return v.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return [];
  }

  private tryAutoResolve(): void {
    if (!this.autoSource || !this.autoRepo || !this.settings) return;
    if (!this.settings.sources?.[this.autoSource]) {
      this.autoSource = '';
      return;
    }
    this.source = this.autoSource;
    this.strategy = this.settings.download?.strategy || this.settings.default_strategy || 'direct';
    this.repoId = this.autoRepo;
    // 重新下载要回到当初的版本（HF commit / 分支，Civitai modelVersionId）
    this.revision = this.autoRevision;
    this.autoSource = '';
    this.autoRevision = '';
    this.resolveRepo();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onSourceChange(): void {
    this.strategy = this.settings?.download?.strategy || this.settings?.default_strategy || 'direct';
    this.repo = null;
    this.allWeights = [];
    this.matchedWeights = [];
    this.showAllWeights = false;
    this.selected.clear();
    this.error = '';
    this.restoreNote = '';
    this.restoreCount = 0;
    this.restoreWanted = 0;
  }

  currentSaveDir(): string {
    return this.settings?.download?.save_dir || '';
  }

  browseSaveDir(): void {
    this.api.browseFolder(this.saveDir || this.currentSaveDir()).subscribe({
      next: (res) => {
        if (res.path) this.saveDir = res.path;
        else if (res.error) this.error = res.error;
      },
      error: () => {
        this.error = '无法打开目录选择框';
      },
    });
  }

  proxySummary(): string {
    const cfg = this.settings?.sources?.[this.source];
    if (!cfg) return '';
    const url = proxyUrl(this.settings?.proxy);
    return cfg.proxy_enabled ? `代理已启用：${url}` : '代理已禁用（该源直连）';
  }

  resolveRepo(): void {
    this.resolving = true;
    this.error = '';
    this.restoreNote = '';
    this.restoreCount = 0;
    this.api.resolve(this.source, this.repoId, this.revision).subscribe({
      next: (repo) => {
        this.repo = repo;
        this.allWeights = weightFiles(repo.files);
        this.matchedWeights = matchedWeightFiles(repo.files, repo.display_name || repo.repo_id);
        this.showAllWeights = false;
        // 默认只下匹配权重；config / tokenizer / README 等非权重文件不进入勾选集
        this.selected = new Set(this.matchedWeights.map((f) => f.path));

        // 「重新下载」：按库里记的仓库路径精确勾回当初那一批文件
        if (this.autoFiles.length) {
          const wanted = this.autoFiles.length;
          const available = new Set(this.allWeights.map((f) => f.path));
          const exact = this.autoFiles.filter((p) => available.has(p));
          this.restoreWanted = wanted;
          if (exact.length) {
            this.selected = new Set(exact);
            // 原文件如果不属于默认「匹配权重」，自动展开全部权重，保证勾选可见
            const visible = new Set(this.matchedWeights.map((f) => f.path));
            this.showAllWeights = exact.some((p) => !visible.has(p));
            this.restoreNote = exact.length === wanted ? 'exact' : 'partial';
            this.restoreCount = exact.length;
          } else {
            // 仓库已变 / 原文件改名：不假装匹配上，退回默认匹配权重并明说
            this.restoreNote = 'fallback';
          }
          this.autoFiles = [];
        }
        this.resolving = false;
      },
      error: (err) => {
        this.error = errMsg(err, '解析失败，请检查模型 ID / 网络 / token');
        this.resolving = false;
      },
    });
  }

  isSelected(path: string): boolean {
    return this.selected.has(path);
  }

  toggleOne(path: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selected.add(path);
    else this.selected.delete(path);
  }

  allSelected(): boolean {
    const files = this.visibleFiles();
    return files.length > 0 && files.every((f) => this.selected.has(f.path));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const files = this.visibleFiles();
    if (checked) {
      for (const f of files) this.selected.add(f.path);
    } else {
      for (const f of files) this.selected.delete(f.path);
    }
  }

  selectedCount(): number {
    return this.selected.size;
  }

  selectedSize(): number {
    if (!this.repo) return 0;
    return this.repo.files.filter((f) => this.selected.has(f.path)).reduce((sum, f) => sum + f.size, 0);
  }

  startDownload(): void {
    if (!this.repo) return;
    this.starting = true;
    this.error = '';
    this.api
      .createTask({
        source: this.source,
        repo_id: this.repo.repo_id,
        revision: this.repo.revision,
        files: [...this.selected],
        strategy: this.strategy,
        save_dir: this.saveDir,
      })
      .subscribe({
        next: () => {
          this.starting = false;
          this.refreshTasks();
        },
        error: (err) => {
          this.error = errMsg(err, '创建任务失败');
          this.starting = false;
        },
      });
  }

  refreshTasks(): void {
    this.api.listTasks().subscribe((tasks) => (this.tasks = tasks));
  }

  pause(task: Task): void {
    this.api.pauseTask(task.id).subscribe(() => this.refreshTasks());
  }

  resume(task: Task): void {
    this.api.resumeTask(task.id).subscribe(() => this.refreshTasks());
  }

  cancel(task: Task): void {
    this.api.cancelTask(task.id).subscribe(() => this.refreshTasks());
  }

  remove(task: Task): void {
    this.api.deleteTask(task.id).subscribe(() => this.refreshTasks());
  }

  fmtSize = fmtSize;
  pct = pct;

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: '排队中',
      downloading: '下载中',
      queued: '排队',
      active: '下载中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      canceled: '已取消',
    };
    return map[status] || status;
  }

  statusTone(status: string): BadgeTone {
    if (status === 'completed') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'paused') return 'orange';
    if (status === 'downloading' || status === 'active') return 'blue';
    return 'gray';
  }

  hostOf(url?: string): string {
    if (!url) return '-';
    if (url.startsWith('demo://')) return 'demo';
    try {
      return new URL(url).host;
    } catch {
      return url.slice(0, 18);
    }
  }
}
