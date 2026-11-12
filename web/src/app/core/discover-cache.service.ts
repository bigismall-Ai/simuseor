import { Injectable } from '@angular/core';
import { SearchItem } from './types';

export interface CachedSearch {
  items: SearchItem[];
  errors: { label: string; message: string }[];
  done: boolean;
  page: number;
  ts: number;
}

/** 搜索结果多久算「新鲜」：这个时间内重新进页面不再打网络，直接复用 */
const FRESH_MS = 3 * 60_000;
/** 超过这个时间就整条丢掉，避免换了一天还看到昨天的榜单 */
const KEEP_MS = 30 * 60_000;
/** 封面映射最多留这么多条：一张卡一个 key，56 张一页也够存好几轮查询了 */
const MAX_COVERS = 600;

const LS_KEY = 'md.discover.v1';
/**
 * 落盘体积上限。搜索结果是正文级别的数据（含描述、标签），一页 56 条大约 60~90 KB，
 * 留 1.5 MB 相当于十几组查询，远超 `searches` 的 16 组上限；真超了就先丢封面再丢旧查询，
 * 无论如何不让一次写入撞到 localStorage 的 5 MB 配额。
 */
const LS_MAX = 1_500_000;

/**
 * 发现页缓存：内存 + localStorage 两级。
 *
 * 为什么要单独一个 service：发现页是路由组件，离开就销毁，`ngOnInit` 里再搜一遍
 * 意味着每次点导航都要等三秒多。这里把「搜索结果」和「封面映射」放在 root 单例里，
 * 重新进页面先拿缓存渲染，再决定要不要后台刷新。
 *
 * 为什么要落 localStorage：只放内存的话，**刷新页面（F5）、新开标签、关掉浏览器再回来**
 * 这三条路径都读不到，而这恰好是最常见的动作——用户看到的就是「每次进来都要重新搜」。
 * 落盘后哪怕服务重启，只要还在 30 分钟内，首屏依然是直接出内容。
 *
 * 只存派生数据（列表字段 + 封面 URL），不存 token 之类敏感信息；带版本号，
 * 结构一变旧数据自动作废，不需要写迁移。
 */
@Injectable({ providedIn: 'root' })
export class DiscoverCacheService {
  private searches = new Map<string, CachedSearch>();
  /** 组 key → 封面 URL。空串表示「问过了，没有」，避免反复请求不存在的封面 */
  private covers = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hydrate();
    // 关页面时补一次同步写，否则最后一条结果可能还在防抖窗口里
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushNow());
    }
  }

  getSearch(key: string): (CachedSearch & { fresh: boolean }) | null {
    const hit = this.searches.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > KEEP_MS) {
      this.searches.delete(key);
      return null;
    }
    return { ...hit, fresh: Date.now() - hit.ts < FRESH_MS };
  }

  putSearch(key: string, data: Omit<CachedSearch, 'ts'>): void {
    this.searches.set(key, { ...data, ts: Date.now() });
    // 有界：发现页最多留十几个组合，再多就是历史噪音
    while (this.searches.size > 16) {
      const oldest = [...this.searches.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      this.searches.delete(oldest[0]);
    }
    this.scheduleFlush();
  }

  /** 已经问过（无论有没有图）就别再问 */
  hasCover(key: string): boolean {
    return this.covers.has(key);
  }

  cover(key: string): string {
    return this.covers.get(key) || '';
  }

  putCover(key: string, url: string): void {
    this.covers.set(key, url);
    // Map 保持插入顺序，超了就丢最早那条（老查询的封面，基本不会再滚回去看）
    while (this.covers.size > MAX_COVERS) {
      const first = this.covers.keys().next();
      if (first.done) break;
      this.covers.delete(first.value);
    }
    this.scheduleFlush();
  }

  // ---------- 持久化 ----------

  private hydrate(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LS_KEY);
    } catch {
      return; // 隐私模式 / 禁用存储：退化成本次会话的内存缓存
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        v?: number;
        searches?: [string, CachedSearch][];
        covers?: [string, string][];
      };
      if (data.v !== 1) return;
      const now = Date.now();
      for (const [k, v] of data.searches || []) {
        if (v && Array.isArray(v.items) && now - v.ts < KEEP_MS) this.searches.set(k, v);
      }
      for (const [k, v] of data.covers || []) this.covers.set(k, v);
    } catch {
      // 坏数据（手改过 / 上个版本残留）直接丢，不要让它卡住首屏
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 封面是一张一张回来的，逐条写盘会打爆主线程，攒 400ms 再写 */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 400);
  }

  private flushNow(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof localStorage === 'undefined') return;
    const now = Date.now();
    const searches = [...this.searches.entries()].filter(([, v]) => now - v.ts < KEEP_MS);
    let covers = [...this.covers.entries()];

    const write = (): boolean => {
      const body = JSON.stringify({ v: 1, searches, covers });
      if (body.length > LS_MAX) return false;
      localStorage.setItem(LS_KEY, body);
      return true;
    };

    try {
      if (write()) return;
      // 超限：先牺牲封面（重新取一次图比重新搜一遍便宜），再不行就只留最近几组查询
      covers = [];
      if (write()) return;
      searches.splice(0, Math.max(0, searches.length - 4));
      write();
    } catch {
      // 配额满 / 隐私模式：静默放弃持久化，内存缓存照常工作
    }
  }
}
