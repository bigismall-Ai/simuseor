import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AppSettings,
  ComfyEnv,
  ComfyEnvCheck,
  ComfyInstallJob,
  ComfyInstallKind,
  ComfyInstanceState,
  ComfyPreview,
  ComfyVersions,
  LibraryModel,
  LocalWorkflow,
  NodeItem,
  NodeJob,
  NodeMissingReport,
  NodeStats,
  InstalledNode,
  RepoInfo,
  SearchItem,
  Task,
  WorkflowInstance,
  WorkflowItem,
} from './types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  health(): Observable<{ status: string; web: boolean }> {
    return this.http.get<{ status: string; web: boolean }>(`${this.base}/health`);
  }

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.base}/settings`);
  }

  saveSettings(settings: AppSettings): Observable<AppSettings> {
    return this.http.put<AppSettings>(`${this.base}/settings`, settings);
  }

  resolve(source: string, repoId: string, revision: string, task = ''): Observable<RepoInfo> {
    return this.http.post<RepoInfo>(`${this.base}/resolve`, { source, repo_id: repoId, revision, task });
  }

  /**
   * 取封面。按「魔搭 → HF → Civitai」的顺序在服务端逐级取，取到即停。
   * 传 `image` 的条目（目前只有 Civitai）省一次详情请求。
   */
  covers(
    groups: { key: string; items: { source: string; id: string; image?: string }[] }[]
  ): Observable<{ covers: Record<string, string> }> {
    return this.http.post<{ covers: Record<string, string> }>(`${this.base}/covers`, { groups });
  }

  search(params: {
    q?: string;
    source?: string;
    sort?: string;
    task?: string;
    limit?: number;
    page?: number;
  }): Observable<{ items: SearchItem[]; total: number; errors?: Record<string, string> }> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.source) httpParams = httpParams.set('source', params.source);
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    if (params.task) httpParams = httpParams.set('task', params.task);
    httpParams = httpParams.set('limit', String(params.limit ?? 20));
    httpParams = httpParams.set('page', String(params.page ?? 1));
    return this.http.get<{ items: SearchItem[]; total: number; errors?: Record<string, string> }>(
      `${this.base}/search`,
      { params: httpParams },
    );
  }

  searchWorkflows(params: {
    q?: string;
    source?: string;
    limit?: number;
    page?: number;
    sort?: string;
  }): Observable<{ items: WorkflowItem[]; errors: Record<string, string>; done: boolean }> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.source) httpParams = httpParams.set('source', params.source);
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    httpParams = httpParams.set('limit', String(params.limit ?? 12));
    httpParams = httpParams.set('page', String(params.page ?? 1));
    return this.http.get<{ items: WorkflowItem[]; errors: Record<string, string>; done: boolean }>(
      `${this.base}/workflows`,
      { params: httpParams },
    );
  }

  resolveWorkflow(source: string, repoId: string): Observable<RepoInfo> {
    return this.http.post<RepoInfo>(`${this.base}/workflows/resolve`, { source, repo_id: repoId });
  }

  /** 「我的工作流」：共享目录里的本地文件，按修改时间倒序。 */
  localWorkflows(): Observable<{ dir: string; total: number; items: LocalWorkflow[] }> {
    return this.http.get<{ dir: string; total: number; items: LocalWorkflow[] }>(
      `${this.base}/workflows/local`,
    );
  }

  openLocalWorkflow(path: string): Observable<{ opened: string }> {
    return this.http.post<{ opened: string }>(`${this.base}/workflows/local/open`, { path });
  }

  listWorkflowInstances(): Observable<{ items: WorkflowInstance[] }> {
    return this.http.get<{ items: WorkflowInstance[] }>(`${this.base}/workflows/instances`);
  }

  importWorkflow(
    source: string,
    repoId: string,
    instance: string,
  ): Observable<{ instance: string; dir: string; files: string[] }> {
    return this.http.post<{ instance: string; dir: string; files: string[] }>(
      `${this.base}/workflows/import`,
      { source, repo_id: repoId, instance },
    );
  }

  createTask(body: {
    source: string;
    repo_id: string;
    revision: string;
    files: string[];
    strategy: string;
    save_dir?: string;
    target_folder?: string;
    task?: string;
  }): Observable<Task> {
    return this.http.post<Task>(`${this.base}/tasks`, body);
  }

  listTasks(): Observable<Task[]> {
    return this.http.get<Task[]>(`${this.base}/tasks`);
  }

  pauseTask(id: string): Observable<Task> {
    return this.http.post<Task>(`${this.base}/tasks/${id}/pause`, {});
  }

  resumeTask(id: string): Observable<Task> {
    return this.http.post<Task>(`${this.base}/tasks/${id}/resume`, {});
  }

  cancelTask(id: string): Observable<Task> {
    return this.http.post<Task>(`${this.base}/tasks/${id}/cancel`, {});
  }

  deleteTask(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/tasks/${id}`);
  }

  listLibrary(params: { q?: string; source?: string; review?: string; favorite?: boolean }): Observable<LibraryModel[]> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.source) httpParams = httpParams.set('source', params.source);
    if (params.review) httpParams = httpParams.set('review', params.review);
    if (params.favorite) httpParams = httpParams.set('favorite', 'true');
    return this.http.get<LibraryModel[]>(`${this.base}/library`, { params: httpParams });
  }

  patchLibrary(id: string, body: Record<string, unknown>): Observable<LibraryModel> {
    return this.http.patch<LibraryModel>(`${this.base}/library/${id}`, body);
  }

  deleteLibrary(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/library/${id}`);
  }

  scanLibrary(path: string): Observable<{ created: number; ids: string[] }> {
    return this.http.post<{ created: number; ids: string[] }>(`${this.base}/library/scan`, { path });
  }

  openLibrary(id: string): Observable<{ opened: string }> {
    return this.http.post<{ opened: string }>(`${this.base}/library/${id}/open`, {});
  }

  testProxy(url: string): Observable<{ proxy: { ok: boolean; status?: number; error?: string; latency_ms: number }; direct: { ok: boolean; status?: number; error?: string; latency_ms: number } }> {
    return this.http.post<any>(`${this.base}/proxy/test`, { url });
  }

  browseFolder(path: string): Observable<{ path: string | null; error?: string }> {
    return this.http.post<{ path: string | null; error?: string }>(`${this.base}/browse-folder`, { path });
  }

  /** ComfyUI 设备探测 + 安装方案。refresh=true 跳过服务端 60 秒缓存。 */
  comfyEnv(refresh = false): Observable<ComfyEnv> {
    const params = refresh ? new HttpParams().set('refresh', 'true') : undefined;
    return this.http.get<ComfyEnv>(`${this.base}/comfy/env`, { params });
  }

  /** 环境检测：实测内置解释器与 PyTorch，返回可修复的问题列表。 */
  comfyEnvCheck(): Observable<ComfyEnvCheck> {
    return this.http.post<ComfyEnvCheck>(`${this.base}/comfy/env/check`, null);
  }

  /** 可安装的 ComfyUI 版本列表（镜像优先，后端缓存一小时）。 */
  comfyVersions(): Observable<ComfyVersions> {
    return this.http.get<ComfyVersions>(`${this.base}/comfy/versions`);
  }

  /** 安装预演：只返回该类型任务的步骤，不写盘。 */
  comfyPreview(
    name = '', tag = '', kind: ComfyInstallKind = 'environment', repair = false, alias = '',
  ): Observable<ComfyPreview> {
    let params = new HttpParams().set('kind', kind);
    if (repair) params = params.set('repair', 'true');
    if (name) params = params.set('name', name);
    if (tag) params = params.set('tag', tag);
    if (alias) params = params.set('alias', alias);
    return this.http.post<ComfyPreview>(`${this.base}/comfy/install/preview`, null, { params });
  }

  /** 启动真实安装，返回任务 id。 */
  comfyInstall(
    name = '', tag = '', kind: ComfyInstallKind = 'environment', repair = false, alias = '',
  ): Observable<{ id: string }> {
    let params = new HttpParams().set('kind', kind);
    if (repair) params = params.set('repair', 'true');
    if (name) params = params.set('name', name);
    if (tag) params = params.set('tag', tag);
    if (alias) params = params.set('alias', alias);
    return this.http.post<{ id: string }>(`${this.base}/comfy/install`, null, { params });
  }

  /** 轮询安装进度；since 为已收到的事件数，用于增量拉取。 */
  comfyInstallJob(id: string, since = 0): Observable<ComfyInstallJob> {
    return this.http.get<ComfyInstallJob>(`${this.base}/comfy/install/${id}?since=${since}`);
  }

  /** 当前可接管的安装任务（刷新页面后恢复进度用）。 */
  comfyCurrentInstall(): Observable<{ job: ComfyInstallJob | null }> {
    return this.http.get<{ job: ComfyInstallJob | null }>(`${this.base}/comfy/install/current`);
  }

  /** 删除自有实例目录；共享运行环境和已下载模型不受影响。 */
  comfyDeleteInstance(name: string): Observable<{ deleted: string }> {
    return this.http.delete<{ deleted: string }>(`${this.base}/comfy/instances/${encodeURIComponent(name)}`);
  }

  /** 改实例显示名。目录名不可改（那是磁盘路径），别名写在 instance.json 里。 */
  comfyRenameInstance(name: string, alias: string): Observable<{ name: string; alias: string }> {
    return this.http.patch<{ name: string; alias: string }>(
      `${this.base}/comfy/instances/${encodeURIComponent(name)}`, { alias },
    );
  }

  /** 启动实例；同一时间只允许一个实例运行，已有别的在跑时返回 409。 */
  comfyStartInstance(name: string): Observable<ComfyInstanceState> {
    return this.http.post<ComfyInstanceState>(
      `${this.base}/comfy/instances/${encodeURIComponent(name)}/start`, null,
    );
  }

  /** 停止实例。 */
  comfyStopInstance(name: string): Observable<ComfyInstanceState> {
    return this.http.post<ComfyInstanceState>(
      `${this.base}/comfy/instances/${encodeURIComponent(name)}/stop`, null,
    );
  }

  /** 实例运行状态：stopped / starting / running。 */
  comfyInstanceState(name: string): Observable<ComfyInstanceState> {
    return this.http.get<ComfyInstanceState>(
      `${this.base}/comfy/instances/${encodeURIComponent(name)}/status`,
    );
  }

  // ---------------- 自定义节点 ----------------
  searchNodes(params: {
    q?: string;
    sort?: string;
    scope?: string;
    limit?: number;
    page?: number;
  }): Observable<{ items: NodeItem[]; total: number; done: boolean; installed_count: number }> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    if (params.scope) httpParams = httpParams.set('scope', params.scope);
    httpParams = httpParams.set('limit', String(params.limit ?? 20));
    httpParams = httpParams.set('page', String(params.page ?? 1));
    return this.http.get<{ items: NodeItem[]; total: number; done: boolean; installed_count: number }>(
      `${this.base}/nodes`,
      { params: httpParams },
    );
  }

  nodeStats(): Observable<NodeStats> {
    return this.http.get<NodeStats>(`${this.base}/nodes/stats`);
  }

  /** 强制重拉 ComfyUI-Manager 的两份清单（平时 24 小时自动刷新）。 */
  refreshNodes(): Observable<{ fetched: boolean; count?: number }> {
    return this.http.post<{ fetched: boolean; count?: number }>(`${this.base}/nodes/refresh`, null);
  }

  installedNodes(): Observable<{ items: InstalledNode[] }> {
    return this.http.get<{ items: InstalledNode[] }>(`${this.base}/nodes/installed`);
  }

  installNode(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/nodes/install`, { id });
  }

  nodeJob(id: string, since = 0): Observable<NodeJob> {
    return this.http.get<NodeJob>(`${this.base}/nodes/job/${id}?since=${since}`);
  }

  currentNodeJob(): Observable<{ job: NodeJob | null }> {
    return this.http.get<{ job: NodeJob | null }>(`${this.base}/nodes/job`);
  }

  toggleNode(dir: string): Observable<{ dir: string; disabled: boolean }> {
    return this.http.post<{ dir: string; disabled: boolean }>(
      `${this.base}/nodes/installed/${encodeURIComponent(dir)}/toggle`, null,
    );
  }

  removeNode(dir: string, stop = false): Observable<{ deleted: string }> {
    const params = stop ? new HttpParams().set('stop', 'true') : undefined;
    return this.http.delete<{ deleted: string }>(
      `${this.base}/nodes/installed/${encodeURIComponent(dir)}`, { params },
    );
  }

  /** 扫工作流库，列出缺哪些节点、各由哪个扩展提供。 */
  missingNodes(): Observable<NodeMissingReport> {
    return this.http.get<NodeMissingReport>(`${this.base}/nodes/missing`);
  }
}
