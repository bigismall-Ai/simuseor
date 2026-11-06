import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppSettings, LibraryModel, RepoInfo, SearchItem, Task } from './types';

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

  resolve(source: string, repoId: string, revision: string): Observable<RepoInfo> {
    return this.http.post<RepoInfo>(`${this.base}/resolve`, { source, repo_id: repoId, revision });
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

  createTask(body: {
    source: string;
    repo_id: string;
    revision: string;
    files: string[];
    strategy: string;
    save_dir?: string;
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
}
