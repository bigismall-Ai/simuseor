export interface SourceConfig {
  label: string;
  token: string;
  proxy_enabled: boolean;
  full_catalog?: boolean;
  mirror?: string;
  use_mirror?: boolean;
}

export interface AppSettings {
  app: { host: string; port: number };
  aria2: { rpc_port: number; rpc_secret: string; connections: number; split: number; max_concurrent: number };
  default_strategy: string;
  download: { save_dir: string; strategy: string };
  proxy: { host: string; port: number | string };
  sources: Record<string, SourceConfig>;
}

/** host/port 拼成代理 URL；host 可自带 scheme（socks5:// 等）。 */
export function proxyUrl(proxy?: { host?: string; port?: number | string } | null): string {
  const host = (proxy?.host || '').trim();
  if (!host) return '';
  const base = host.includes('://') ? host : `http://${host}`;
  const port = String(proxy?.port ?? '').trim();
  return port ? `${base}:${port}` : base;
}

export interface RemoteFile {
  path: string;
  size: number;
  candidates: string[];
  /** 该文件自己的 ComfyUI 目标目录（分体仓库里每个组件不同） */
  folder?: string;
}

export interface RepoInfo {
  repo_id: string;
  display_name: string;
  revision: string;
  source: string;
  files: RemoteFile[];
  /** 后端建议的 ComfyUI 模型目录（checkpoints / loras / ...） */
  target_folder?: string;
}

export interface TaskFile {
  id: string;
  path: string;
  size: number;
  done_bytes: number;
  status: string;
  url?: string;
  candidates: string[];
  error?: string;
  /** 该文件自己的 ComfyUI 目录与绝对落点（老任务为空，回退到 task.target_dir） */
  folder?: string;
  target_dir?: string;
}

export interface Task {
  id: string;
  source: string;
  repo_id: string;
  revision: string;
  strategy: string;
  status: string;
  target_dir: string;
  total_bytes: number;
  done_bytes: number;
  created_at: string;
  /** 下载的是工作流包还是模型权重：两者共用 aria2 任务表，靠落点区分 */
  kind?: 'workflow' | 'model' | string;
  files: TaskFile[];
  error?: string;
}

export interface LibraryFile {
  id: string;
  path: string;
  size: number;
}

export interface LibraryModel {
  id: string;
  name: string;
  repo_id: string;
  source: string;
  local_path: string;
  size_bytes: number;
  file_count: number;
  tags: string[];
  created_at: string;
  files: LibraryFile[];
  /** 权重规格与本机可跑性（后端 describe_model 算出来的） */
  precision?: string;
  params?: string;
  hasWeights?: boolean;
  isDemo?: boolean;
  /** 存放类型：models/ 后的目录名 = 物理事实（后端现算，不落库） */
  folder?: string;
  folderLabel?: string;
  /** 任务类型：拿来干什么 = 使用意图（文件名 + 源站 tags 推断） */
  task?: string;
  taskLabel?: string;
  vram?: {
    level: string;
    text: string;
    hint: string;
  };
  needGb?: number;
}

export interface SearchItem {
  id: string;
  name: string;
  author: string;
  source: string;
  description: string;
  downloads: number;
  likes: number;
  tags: string[];
  task: string;
  url: string;
  updated_at: string;
  /** 可选缩略图。目前只有 Civitai 会给，HF / ModelScope 没有；缺省走生成封面 */
  image?: string;
}

export interface WorkflowItem extends SearchItem {
  /** 该仓库里的工作流文件（.json / .zip） */
  files: string[];
  file_count: number;
  /** 缩略图（模板 / Civitai / GitHub 可能有） */
  thumbnail?: string;
  /** 依赖的底模 / 自定义节点 */
  requires?: string[];
}

/** 本地工作流（共享目录 workspace/userdata/default/workflows 里的文件） */
export interface LocalWorkflow {
  name: string;
  /** 侧车键：相对共享目录的路径（含子目录），命名/分组与封面缓存都按它索引 */
  key?: string;
  path: string;
  /** 相对共享目录的子目录，根目录为空串 */
  folder: string;
  size: number;
  /** unix 秒 */
  mtime: number;
  nodes: number;
  format: 'ui' | 'api' | string;
  /** 主模型文件名 —— 家族徽标靠它。语法坏掉的文件也可能有（文本兜底） */
  main_model?: string;
  /** 全部模型槽位 */
  model_slots?: WorkflowModelSlot[];
  /** 模型依赖比对结果 */
  deps?: { have: WorkflowModelDep[]; missing: WorkflowModelDep[] };
  /** 节点包依赖比对结果 */
  node_deps?: { have: WorkflowNodeDep[]; missing: WorkflowNodeDep[]; unknown: string[] };
  /** 解析失败时的错误文本（format === 'broken' 时才有） */
  error?: string;
  /** 显示名（用户自定义优先，回落文件名） */
  title?: string;
  /** 分组（用户自定义） */
  group?: string;
  /** 工作流级封面图的 URL：本地自带出图优先，其次社区真实样图；空则用家族铭牌兜底 */
  cover?: string;
}

export interface WorkflowModelSlot {
  file: string;
  /** 加载它的节点类型，如 UNETLoader / VAELoader */
  node: string;
  /** 目标目录，如 diffusion_models / vae */
  directory: string;
  /** 下载直链（有就说明这是官方登记过的模型） */
  url: string;
}

export interface WorkflowModelDep extends WorkflowModelSlot {
  /** 命中时文件实际所在目录 */
  found_dir?: string;
}

export interface WorkflowNodeDep {
  /** 仓库归一键，如 ltdrdata/comfyui-impact-pack */
  id: string;
  name: string;
  author: string;
  repo: string;
  node_count: number;
  installable: boolean;
  /** 这个包提供了工作流用到的哪几个节点类型 */
  covers: string[];
}

export interface WorkflowInstance {
  name: string;
  path: string;
  workflows_dir: string;
  count: number;
}

export function fmtNum(n: number): string {
  if (!n && n !== 0) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function fmtSize(bytes: number): string {
  if (!bytes && bytes !== 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return i === 0 ? `${value}${units[i]}` : `${value.toFixed(2)} ${units[i]}`;
}

export function pct(done: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function errMsg(err: unknown, fallback: string): string {
  const e = err as { error?: { detail?: unknown } } | null;
  const detail = e?.error?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => d?.msg || JSON.stringify(d)).join('; ');
  }
  return fallback;
}

// ---------------- ComfyUI 环境（/api/comfy/env） ----------------
export interface ComfyGpu {
  vendor: string;
  name: string;
  driver_version: string;
  vram_mb: number | null;
  compute_cap: string | null;
  source: string;
  is_discrete: boolean;
  /** 核显 / APU：与 CPU 共用系统内存，没有独立显存 */
  memory_shared?: boolean;
}

export interface ComfyPython {
  version: string;
  path: string;
  source: string;
  /** 是否为可长期依赖的解释器；应用自带的运行时为 false */
  trusted: boolean;
}

export interface ComfyDisk {
  path: string;
  total_gb: number;
  free_gb: number;
}

export interface ComfyInstance {
  name: string;
  /** 用户起的可读名；为空时界面回落显示 name */
  alias?: string | null;
  path: string;
  version: string | null;
  python: string | null;
  port: number | null;
  created_at: string | null;
  /** false = 没有 instance.json 的安装残留目录，可清理 */
  registered?: boolean;
}

/** 实例的运行状态（/api/comfy/instances/{name}/status） */
export interface ComfyInstanceState {
  name: string;
  state: 'stopped' | 'starting' | 'running';
  port: number | null;
  url: string;
  pid?: number;
  /** 非 0 表示进程自己退出了，日志里能看到原因 */
  exit_code?: number;
  log?: string;
}

/** 当前正在运行的实例；同一时间最多一个 */
export interface ComfyRunningInstance {
  name: string;
  port: number;
  url: string;
}

export interface ComfyDevice {
  os: string;
  os_version: string;
  os_build: string;
  arch: string;
  is_wsl: boolean;
  /** 系统内存总量；统一内存机器据此判断能加载多大模型 */
  memory_gb: number | null;
  /** 显卡与 CPU 共用同一份内存（Apple Silicon / APU / GB10 等） */
  unified_memory: boolean;
  gpus: ComfyGpu[];
  primary_gpu: ComfyGpu | null;
  pythons: ComfyPython[];
  disks: ComfyDisk[];
  instances: ComfyInstance[];
  warnings: string[];
  probed_at: string;
}

export interface ComfyAction {
  level: 'info' | 'warn' | 'block';
  title: string;
  detail: string;
  url: string | null;
}

export interface ComfyPlan {
  tier: 'full' | 'limited' | 'blocked';
  backend: string;
  torch_channel: string;
  python_version: string;
  python_available: boolean;
  /** system：用本机 Python；download：安装时下载内置运行时 */
  python_source: 'system' | 'download';
  disk_ok: boolean;
  disk_required_gb: number;
  actions: ComfyAction[];
  warnings: string[];
  blocked_reason: string | null;
}

/** 共享基础环境 instances/.environment 的实装状态（只读探测的结果） */
export interface ComfyRuntime {
  ready: boolean;
  python_ready: boolean;
  python_version: string;
  python_source: string;
  python_cached: boolean;
  torch_ready: boolean;
  torch_version: string | null;
  torchvision_version: string | null;
  torchaudio_version: string | null;
  cuda_runtime: string | null;
  torch_channel: string | null;
  lock_ready: boolean;
  path: string;
}

export interface ComfyEnv {
  device: ComfyDevice;
  plan: ComfyPlan;
  runtime: ComfyRuntime;
  /** 后端正在删除的实例名（删除是慢操作，刷新页面后状态从这里恢复） */
  deleting_instances?: string[];
  /** 当前正在运行的实例；null / 缺省表示一个都没跑 */
  running_instance?: ComfyRunningInstance | null;
}

export interface ComfyStep {
  key: string;
  title: string;
  detail: string;
  command: string[] | null;
  estimated_gb: number;
}

/** 基础环境 / ComfyUI 实例是两类独立安装任务，各自只在自己的卡片里触发。 */
export type ComfyInstallKind = 'environment' | 'instance' | 'full';

export interface ComfyEnvIssue {
  code: string;
  title: string;
  detail: string;
  fix: 'install' | null;
}

/** 「环境检测」的实测结果：启动内置解释器 import torch，不是只读文件探测。 */
export interface ComfyEnvCheck {
  ok: boolean;
  python: string | null;
  torch: string | null;
  backend: string | null;
  accelerator: boolean | null;
  issues: ComfyEnvIssue[];
  checked_at: string;
}

export interface ComfyPreview {
  kind: ComfyInstallKind;
  spec: {
    name: string;
    workspace: string;
    comfy_dir: string;
    environment: string;
    python: string;
    channel: string;
    /** 选定的 ComfyUI 版本 tag，空表示最新 master */
    tag?: string;
  };
  steps: ComfyStep[];
  total_gb: number;
}

/** 可安装的 ComfyUI 版本（对应上游 git tag）。 */
export interface ComfyVersion {
  tag: string;
  sha: string;
  prerelease: boolean;
}

export interface ComfyVersions {
  tags: ComfyVersion[];
  /** 从哪个端拿到的：mirror / github；空表示没拿到 */
  source: string;
  cached: boolean;
}

export type ComfyPhase = 'download' | 'unpack' | 'clone' | 'resolve' | 'install' | 'done' | 'idle';

/** 后端按 250ms 推送的真实进度（字节数、速度、ETA）。 */
export interface ComfyProgress {
  phase: ComfyPhase;
  label: string;
  done: number;
  size: number;
  /** -1 表示总量未知，前端显示无限进度条 */
  percent: number;
  /** 字节/秒 */
  speed: number;
  eta: number | null;
  /** 后端按步骤权重折算的总进度（0-100），优先于前端本地估算 */
  overall?: number;
}

export interface ComfyInstallEvent {
  type: 'step_start' | 'step_done' | 'log' | 'step_plan' | 'progress';
  key?: string;
  title?: string;
  line?: string;
  message?: string;
  ok?: boolean;
  index?: number;
  total?: number;
  phase?: ComfyPhase;
  label?: string;
  done?: number;
  size?: number;
  percent?: number;
  speed?: number;
  eta?: number | null;
  /** 后端算好的总进度（0-100），每个事件都带，便于刷新接管后不掉进度 */
  overall?: number;
  at: number;
}

export interface ComfyInstallJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  kind: ComfyInstallKind;
  repair?: boolean;
  name: string;
  workspace: string;
  spec: ComfyPreview['spec'] | null;
  steps: ComfyStep[];
  result: { ok: boolean; message: string; log_path: string; instance: ComfyInstance | null } | null;
  total_events: number;
  events: ComfyInstallEvent[];
}

// ---------------- 自定义节点（/api/nodes） ----------------
export interface NodeItem {
  id: string;
  name: string;
  author: string;
  repo: string;
  source: string;
  description: string;
  tags: string[];
  /** 该扩展提供的节点类名（清单截前 10 个用于展示） */
  nodes: string[];
  node_count: number;
  install_type: string;
  /** 只有 git-clone 类型才允许一键安装 */
  installable: boolean;
  /** 与其它扩展重名的节点，装之前值得看一眼 */
  preemptions: string[];
  /** 额外依赖：pip 包 / 系统包 */
  needs: string[];
  mirror?: string;
  installed?: boolean;
}

export interface NodeJobLog {
  at: number;
  line: string;
}

export interface NodeJob {
  id: string;
  node: string;
  name: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  percent: number;
  dir: string;
  error: string;
  logs: NodeJobLog[];
  next: number;
}

export interface InstalledNode {
  name: string;
  dir: string;
  path: string;
  disabled: boolean;
  repo: string;
  id: string;
  title: string;
  description: string;
  node_count: number;
  nodes: string[];
  /** 是否能在清单里查到（自建 / 手工 clone 的节点查不到） */
  tracked: boolean;
  requirements: boolean;
  commit: string;
  size: number;
}

export interface NodeStats {
  catalog: number;
  installed: number;
  disabled: number;
  node_classes: number;
  core_nodes: number;
  dir: string;
  runtime: string;
}

export interface MissingProvider {
  id: string;
  name: string;
  author: string;
  repo: string;
  node_count: number;
  installable: boolean;
  covers: string[];
  files?: number;
}

export interface MissingWorkflow {
  name: string;
  file: string;
  path: string;
  used: number;
  missing: number;
  providers: MissingProvider[];
  unknown: string[];
}

export interface NodeMissingReport {
  workflows: MissingWorkflow[];
  providers: MissingProvider[];
  scanned: number;
  missing_files: number;
  core_nodes: number;
  installed_nodes: number;
}
