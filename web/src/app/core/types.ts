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
