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
  proxy: { url: string };
  sources: Record<string, SourceConfig>;
}

export interface RemoteFile {
  path: string;
  size: number;
  candidates: string[];
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
  favorite: number | boolean;
  review_state: string;
  notes: string;
  created_at: string;
  files: LibraryFile[];
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
}

export interface WorkflowItem extends SearchItem {
  /** 该仓库里的工作流文件（.json / .zip） */
  files: string[];
  file_count: number;
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
}

export interface ComfyPython {
  version: string;
  path: string;
  source: string;
}

export interface ComfyDisk {
  path: string;
  total_gb: number;
  free_gb: number;
}

export interface ComfyInstance {
  name: string;
  path: string;
  version: string | null;
  python: string | null;
  port: number | null;
  created_at: string | null;
}

export interface ComfyDevice {
  os: string;
  os_version: string;
  os_build: string;
  arch: string;
  is_wsl: boolean;
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
  disk_ok: boolean;
  disk_required_gb: number;
  actions: ComfyAction[];
  warnings: string[];
  blocked_reason: string | null;
}

export interface ComfyEnv {
  device: ComfyDevice;
  plan: ComfyPlan;
}

export interface ComfyStep {
  key: string;
  title: string;
  detail: string;
  command: string[] | null;
  estimated_gb: number;
}

export interface ComfyPreview {
  spec: {
    name: string;
    workspace: string;
    comfy_dir: string;
    venv_dir: string;
    python: string;
    channel: string;
  };
  steps: ComfyStep[];
  total_gb: number;
}

export interface ComfyInstallEvent {
  type: 'step_start' | 'step_done' | 'log' | 'step_plan';
  key?: string;
  title?: string;
  line?: string;
  message?: string;
  ok?: boolean;
  index?: number;
  total?: number;
  at: number;
}

export interface ComfyInstallJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  name: string;
  workspace: string;
  spec: ComfyPreview['spec'] | null;
  steps: ComfyStep[];
  result: { ok: boolean; message: string; log_path: string; instance: ComfyInstance | null } | null;
  total_events: number;
  events: ComfyInstallEvent[];
}
