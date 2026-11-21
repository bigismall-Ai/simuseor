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

@Component({
  selector: 'app-downloads',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BadgeComponent,
    EmptyComponent,
    FieldComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <ui-page-header
      kicker="Downloads"
      title="下载任务"
      hint="解析仓库 → 自动挑权重 → aria2 下载。进度每秒刷新，断点续传由 .aria2 文件维护。"
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
        <div class="notice err">{{ error }}</div>
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
                      <th class="col-check"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)"></th>
                      <th>文件</th>
                      <th class="col-folder">目录</th>
                      <th class="col-size">大小</th>
                      <th class="col-progress">候选站点</th>
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

    <ui-panel title="下载任务" hint="模型与工作流都在这里排队（断点续传由 aria2 维护）；节点包是 git 仓库，安装进度在节点管理页看。">
      <div panel-actions class="segmented">
        @for (t of taskTabs; track t.key) {
          <button [class.active]="taskFilter === t.key" (click)="taskFilter = t.key">{{ t.label }}</button>
        }
      </div>

      @if (filteredTasks.length === 0) {
        <ui-empty [title]="'暂无' + activeTabLabel + '任务'" hint="上方解析并开始下载后，任务会出现在这里。" />
      }

      @for (task of filteredTasks; track task.id) {
        <div class="task">
          <div class="head">
            <span class="title">{{ task.repo_id }}</span>
            <ui-badge [tone]="statusTone(task.status)">{{ statusLabel(task.status) }}</ui-badge>
            @if (task.kind === 'workflow') {
              <ui-badge tone="blue">工作流</ui-badge>
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
                    <th>文件</th>
                    <th class="col-folder">目录</th>
                    <th class="col-progress">进度</th>
                    <th class="col-status">状态</th>
                    <th class="col-url">来源 URL</th>
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
  resolving = false;
  starting = false;
  error = '';
  showDemo = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoSource = '';
  private autoRepo = '';

  taskTabs = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '进行中' },
    { key: 'completed', label: '已完成' },
  ];

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe((p) => {
      this.showDemo = p['demo'] === '1';
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

  get filteredTasks(): Task[] {
    if (this.taskFilter === 'all') return this.tasks;
    if (this.taskFilter === 'active') {
      return this.tasks.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status));
    }
    return this.tasks.filter((t) => t.status === this.taskFilter);
  }

  get activeTabLabel(): string {
    const tab = this.taskTabs.find((t) => t.key === this.taskFilter);
    return tab && tab.key !== 'all' ? tab.label : '';
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
    this.revision = '';
    this.autoSource = '';
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
    this.api.resolve(this.source, this.repoId, this.revision).subscribe({
      next: (repo) => {
        this.repo = repo;
        this.allWeights = weightFiles(repo.files);
        this.matchedWeights = matchedWeightFiles(repo.files, repo.display_name || repo.repo_id);
        this.showAllWeights = false;
        // 默认只下匹配权重；config / tokenizer / README 等非权重文件不进入勾选集
        this.selected = new Set(this.matchedWeights.map((f) => f.path));
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
