import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ProbePath, ProbeStatus, SourceProbe } from './types';

/**
 * 源探针结论的读取与门控（筛选区口径见 VIS §3.7.8）。
 *
 * 结论由后端给出（GET /api/probe，进程内缓存、不落盘）：
 *   ok / degraded → 可选；down → **不作为可选项提供**，
 *   在筛选区里灰置、点不动，原因只进 hover 提示气泡，不印在页面上。
 *
 * **unknown 不门控**（规格 §3.1）：第一次打开应用、还没探过时所有源都还在。
 * 门控只认后端返回的 `gated` 字段 —— 它已经处理了 down / always_enabled
 * 两个条件，前端不再自己拿 verdict 重算一遍。
 *
 * 设置页重新测试连通性 / 保存设置后会把最新结论写回这里（apply），
 * 所有消费方（发现 / 下载 / 库 / 工作流）通过 signal 一起刷新，
 * 不会出现「设置页说不可用、发现页还亮着」的旧读数。
 */
@Injectable({ providedIn: 'root' })
export class ProbeService {
  private map = new Map<string, SourceProbe>();
  /** 探针能力是否可用（后端已提供 /api/probe）。不可用 → 不门控。 */
  private deployed = false;
  private loading = false;
  private loaded = false;
  /** 请求序号：invalidate / apply 之后，旧请求的响应不许再写回。 */
  private req = 0;
  /** 结论版本号：消费方读它，设置页写回时自动触发重新渲染。 */
  private readonly rev = signal(0);

  constructor(private api: ApiService) {}

  /** 拉一次结论；同一会话只拉一次。设置页可用 apply / refresh 覆盖。 */
  ensure(): void {
    if (this.loaded || this.loading) return;
    this.fetch();
  }

  /** 强制重新拉一轮（设置页保存设置后调用）。 */
  refresh(): void {
    this.fetch();
  }

  /** 把设置页已经拿到的结论直接写回共享状态，避免第二次请求。 */
  apply(status: ProbeStatus | null): void {
    this.req++;
    this.loaded = true;
    this.loading = false;
    this.deployed = !!status;
    this.map.clear();
    for (const s of status?.sources || []) this.map.set(s.source, s);
    this.rev.update((v) => v + 1);
  }

  /** 设置改了但还没来得及重探：先作废旧结论，下一次 ensure 会重新拉。 */
  invalidate(): void {
    this.req++;
    this.map.clear();
    this.deployed = false;
    this.loaded = false;
    this.loading = false;
    this.rev.update((v) => v + 1);
  }

  /** 该站是否在筛选区灰置。只认后端 `gated`（down 且未 always_enabled）。 */
  isGated(source: string): boolean {
    this.rev();
    if (!this.deployed) return false;
    return !!this.map.get(source)?.gated;
  }

  /** hover 气泡里写什么（原因不印在页面上）。没有门控就没有提示。 */
  tip(source: string): string {
    this.rev();
    const s = this.map.get(source);
    if (!s || !s.gated) return '';
    if (s.verdict === 'down') {
      const why = this.reasonOf(s);
      return why ? `探针不可达：${why}` : '探针不可达';
    }
    return '';
  }

  private fetch(): void {
    if (this.loading) return;
    this.loading = true;
    const token = ++this.req;
    this.api.getProbeStatus().subscribe({
      next: (res) => {
        if (token !== this.req) return;
        this.loading = false;
        this.loaded = true;
        this.deployed = true;
        this.map.clear();
        for (const s of res?.sources || []) this.map.set(s.source, s);
        this.rev.update((v) => v + 1);
      },
      error: () => {
        if (token !== this.req) return;
        this.loading = false;
        this.loaded = true;
        this.deployed = false;
        this.map.clear();
        this.rev.update((v) => v + 1);
      },
    });
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
