import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { ProbePath, ProbeStatus, SourceProbe } from './types';

/**
 * 源探针结论的读取与门控（筛选区口径见 VIS §3.7.8）。
 *
 * 结论由后端给出（GET /api/probe，进程内缓存、不落盘）：
 *   ok / degraded → 可选；down / unknown → **不作为可选项提供**，
 *   在筛选区里灰置、点不动，原因只进 hover 提示气泡，不印在页面上。
 *
 * 后端还没提供该接口时（404 / 网络不通）一律不门控 ——
 * 否则第一次打开应用、还没探过时，所有站都灰掉，那不叫门控，叫把产品藏起来。
 * 探针上线后自动切换到「按结论门控」，页面代码不用改。
 */
@Injectable({ providedIn: 'root' })
export class ProbeService {
  private map = new Map<string, SourceProbe>();
  /** 探针能力是否可用（后端已提供 /api/probe）。不可用 → 不门控。 */
  private deployed = false;
  private loading = false;
  private loaded = false;

  constructor(private api: ApiService) {}

  /** 拉一次结论；同一会话只拉一次。 */
  ensure(): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    this.api.getProbeStatus().subscribe({
      next: (res) => {
        this.loading = false;
        this.loaded = true;
        this.deployed = true;
        for (const s of res?.sources || []) this.map.set(s.source, s);
      },
      error: () => {
        this.loading = false;
        this.loaded = true;
        this.deployed = false;
      },
    });
  }

  /** 该站是否在筛选区灰置（探针不可达 / 未探测）。 */
  isGated(source: string): boolean {
    if (!this.deployed) return false;
    const s = this.map.get(source);
    if (!s) return false;
    return s.verdict === 'down' || s.verdict === 'unknown';
  }

  /** hover 气泡里写什么（原因不印在页面上）。 */
  tip(source: string): string {
    const s = this.map.get(source);
    if (!s) return '';
    if (s.verdict === 'down') {
      const why = this.reasonOf(s);
      return why ? `探针不可达：${why}` : '探针不可达';
    }
    if (s.verdict === 'unknown') return '尚未探测';
    return '';
  }

  /** 三条通路里第一条不通的人话原因 */
  private reasonOf(s: SourceProbe): string {
    for (const key of ['direct', 'mirror', 'proxy'] as ProbePath[]) {
      const p = s.paths?.[key];
      if (p && (p.state === 'blocked' || p.state === 'unknown') && p.reason_text) {
        return p.reason_text;
      }
    }
    return s.path_text || '';
  }
}
