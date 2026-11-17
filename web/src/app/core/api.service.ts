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
  FamilyScanStatus,
  FamilyScanTrigger,
  LibraryModel,
  LibraryFacets,
  LocalWorkflow,
  NodeItem,
  NodeJob,
  NodeMissingReport,
  NodeStats,
  InstalledNode,
  RepoInfo,
  SearchItem,
  Task,
  WorkflowFile,
  WorkflowInstance,
  WorkflowItem,
  WorkflowObjectInfo,
  WorkflowSaveResult,
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

  /** 编辑器：读工作流原文与解析结果（坏 JSON 也会返回 raw）。 */
  readWorkflowFile(path: string): Observable<WorkflowFile> {
    return this.http.get<WorkflowFile>(`${this.base}/workflows/file`, {
      params: new HttpParams().set('path', path),
    });
  }

  /** 编辑器：校验后覆盖原文件，后端会先留一份 .bak。 */
  saveWorkflowFile(
    path: string,
    data: Record<string, unknown>,
    mtime: number | null,
  ): Observable<WorkflowSaveResult> {
    return this.http.put<WorkflowSaveResult>(`${this.base}/workflows/file`, { path, data, mtime });
  }

  /** 画布节点库：本机实例 /object_info，实例没开时返回磁盘缓存。 */
  workflowObjectInfo(refresh = false): Observable<WorkflowObjectInfo> {
    let params = new HttpParams();
    if (refresh) params = params.set('refresh', 'true');
    return this.http.get<WorkflowObjectInfo>(`${this.base}/workflows/object-info`, { params });
  }

  openLocalWorkflow(path: string, mode: 'reveal' | 'edit' = 'reveal'): Observable<{ opened: string }> {
    return this.http.post<{ opened: string }>(`${this.base}/workflows/local/open`, { path, mode });
  }

  /** 使用工作流：确保有实例在跑，拿到画布地址。 */
  useLocalWorkflow(path: string): Observable<{ url: string; instance: string; name: string }> {
    return this.http.post<{ url: string; instance: string; name: string }>(
      `${this.base}/workflows/local/use`,
      { path },
    );
  }

  /** 批量取远程封面。本地自带出图的条目也传（用 has_local 标出），后端只在钉过图时才覆盖。 */
  workflowCovers(
    items: Array<{ key: string; name: string; model: string; has_local?: boolean }>,
  ): Observable<{ covers: Record<string, string>; pinned?: string[]; custom?: string[] }> {
    return this.http.post<{ covers: Record<string, string>; pinned?: string[]; custom?: string[] }>(
      `${this.base}/workflows/covers`,
      { items },
    );
  }

  /** 换一张封面：避开当前图重新抽，并把结果钉在这条工作流上。 */
  refreshWorkflowCover(body: {
    key: string;
    name: string;
    model: string;
    current: string;
  }): Observable<{ key: string; cover: string; pinned: boolean }> {
    return this.http.post<{ key: string; cover: string; pinned: boolean }>(
      `${this.base}/workflows/covers/refresh`,
      body,
    );
  }

  /** 封面管理画廊：一次给一批候选，只发图不改当前封面；offset 用来换一批。 */
  workflowCoverCandidates(body: {
    key: string;
    name: string;
    model: string;
    current: string;
    offset: number;
  }): Observable<{ key: string; covers: string[] }> {
    return this.http.post<{ key: string; covers: string[] }>(
      `${this.base}/workflows/covers/candidates`,
      body,
    );
  }

  /** 画廊里点选一张：钉住选中的 URL，后端只认本次发过的候选。 */
  chooseWorkflowCover(body: {
    key: string;
    url: string;
  }): Observable<{ key: string; cover: string; pinned: boolean; source: string }> {
    return this.http.post<{ key: string; cover: string; pinned: boolean; source: string }>(
      `${this.base}/workflows/covers/choose`,
      body,
    );
  }

  /** 自定义封面：外链 URL 或浏览器读出的 base64 data URI，二选一。 */
  customWorkflowCover(body: {
    key: string;
    url?: string;
    data?: string;
  }): Observable<{ key: string; cover: string; pinned: boolean; source: string }> {
    return this.http.post<{ key: string; cover: string; pinned: boolean; source: string }>(
      `${this.base}/workflows/covers/custom`,
      body,
    );
  }

  resetWorkflowCover(key: string): Observable<{ key: string; pinned: boolean }> {
    return this.http.post<{ key: string; pinned: boolean }>(`${this.base}/workflows/covers/reset`, { key });
  }

  listWorkflowGroups(): Observable<{ groups: Array<{ name: string; count: number }>; defined: string[] }> {
    return this.http.get<{ groups: Array<{ name: string; count: number }>; defined: string[] }>(
      `${this.base}/workflows/groups`,
    );
  }

  createWorkflowGroup(name: string): Observable<{ groups: Array<{ name: string; count: number }>; defined: string[] }> {
    return this.http.post<{ groups: Array<{ name: string; count: number }>; defined: string[] }>(
      `${this.base}/workflows/groups`,
      { name },
    );
  }

  renameWorkflowGroup(old: string, name: string): Observable<{ old: string; name: string; renamed: number; moved: number }> {
    return this.http.patch<{ old: string; name: string; renamed: number; moved: number }>(
      `${this.base}/workflows/groups`,
      { old, name },
    );
  }

  deleteWorkflowGroup(name: string): Observable<{ name: string; cleared: number }> {
    return this.http.delete<{ name: string; cleared: number }>(`${this.base}/workflows/groups`, {
      params: { name },
    });
  }

  setLocalWorkflowMeta(body: {
    path: string;
    title: string;
    group: string;
    rename_file: boolean;
  }): Observable<{
    title: string; group: string; file: string; key: string;
    moved?: boolean; folder?: string;
  }> {
    return this.http.patch<{
      title: string; group: string; file: string; key: string;
      moved?: boolean; folder?: string;
    }>(`${this.base}/workflows/local/meta`, body);
  }

  deleteLocalWorkflow(path: string): Observable<{ deleted: string; key: string }> {
    return this.http.delete<{ deleted: string; key: string }>(`${this.base}/workflows/local`, {
      params: { path },
    });
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

  listLibrary(params: { q?: string; source?: string }): Observable<LibraryModel[]> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.source) httpParams = httpParams.set('source', params.source);
    return this.http.get<LibraryModel[]>(`${this.base}/library`, { params: httpParams });
  }

  /** 本机独显显存 —— 权重压力标志的分母 */
  libraryGpu(): Observable<{ name: string; vramMb: number; vramGb: number; vramText: string }> {
    return this.http.get<{ name: string; vramMb: number; vramGb: number; vramText: string }>(
      `${this.base}/library/gpu`
    );
  }

  /** 筛选分面：存放类型 / 任务类型 / 来源，各带条数与占用体积 */
  libraryFacets(): Observable<LibraryFacets> {
    return this.http.get<LibraryFacets>(`${this.base}/library/facets`);
  }

  patchLibrary(id: string, body: Record<string, unknown>): Observable<LibraryModel> {
    return this.http.patch<LibraryModel>(`${this.base}/library/${id}`, body);
  }

  deleteLibrary(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/library/${id}`);
  }

  scanLibrary(path: string): Observable<{ created: number; ids: string[]; matched?: number }> {
    return this.http.post<{ created: number; ids: string[]; matched?: number }>(
      `${this.base}/library/scan`,
      { path },
    );
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
    category?: string;
    limit?: number;
    page?: number;
  }): Observable<{
    items: NodeItem[];
    total: number;
    done: boolean;
    installed_count: number;
    categories?: { id: string; label: string; count: number }[];
  }> {
    let httpParams = new HttpParams();
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.sort) httpParams = httpParams.set('sort', params.sort);
    if (params.scope) httpParams = httpParams.set('scope', params.scope);
    if (params.category) httpParams = httpParams.set('category', params.category);
    httpParams = httpParams.set('limit', String(params.limit ?? 20));
    httpParams = httpParams.set('page', String(params.page ?? 1));
    return this.http.get<{
      items: NodeItem[];
      total: number;
      done: boolean;
      installed_count: number;
      categories?: { id: string; label: string; count: number }[];
    }>(
      `${this.base}/nodes`,
      { params: httpParams },
    );
  }

  folders(): Observable<{ id: string; label: string }[]> {
    return this.http.get<{ id: string; label: string }[]>(`${this.base}/folders`);
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

  /**
   * 触发厂标资产巡检。
   *
   * 搭车调用：发现页搜索时顺带调一次，后端按 24 小时节流，一天最多真跑一次。
   * 巡检只报告上游有没有改版，**永远不会替换正式资产** —— 换不换由人决定。
   */
  triggerFamilyScan(force = false): Observable<FamilyScanTrigger> {
    const url = force ? `${this.base}/families/scan?force=true` : `${this.base}/families/scan`;
    return this.http.post<FamilyScanTrigger>(url, {});
  }

  /** 厂标资产巡检状态：上次什么时候跑的、哪些家族需要人看。 */
  familyScanStatus(): Observable<FamilyScanStatus> {
    return this.http.get<FamilyScanStatus>(`${this.base}/families/scan`);
  }
}
