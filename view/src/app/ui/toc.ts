import { Component, DestroyRef, inject, input, output, signal, afterNextRender, computed } from '@angular/core';

/** 目录条目：`hash` 是页面内标题的 id（不带 #）。 */
export interface TocItem {
  text: string;
  hash: string;
  children?: TocItem[];
}

export type TocVariant = 'full' | 'mini';

interface TocRow {
  item: TocItem;
  /** 0 = 一级标题，1 = 二级，2 = 三级及以下 */
  level: number;
}

/**
 * 滚动监听阈值（MUI 文档目录口径）：
 *   - 顶部 200px 内仍算第一节；
 *   - 阅读线在容器顶部往下 `clientHeight / 8` 处，标题越过它即算当前项；
 *   - 距底 50px 内直接取最后一节，短尾巴不会永远选不中。
 */
const SPY_LINE = 200;
const SPY_BOTTOM = 50;
/** 滚动监听节流。 */
const SPY_THROTTLE = 166;
/** 点击后锁定 1s，避免平滑滚动过程中的中间状态覆盖选中项。 */
const CLICK_LOCK = 1000;

function flattenToc(items: readonly TocItem[], level = 0): TocRow[] {
  return items.flatMap((item) => [
    { item, level: Math.min(level, 2) },
    ...(item.children?.length ? flattenToc(item.children, level + 1) : []),
  ]);
}

/**
 * 页内目录：右栏全文目录（full）与窄窗速览条（mini）。
 *
 * 只做两件事：渲染条目、监听滚动同步当前项。锚点标题由页面自己写
 * （`id` 与 `TocItem.hash` 对应），组件不扫描渲染结构。
 *
 * 滚动容器默认是文档；传 `root`（CSS 选择器）可监听嵌套滚动容器，
 * 例如演示页里自带滚动的文章区。
 */
@Component({
  selector: 'ui-toc',
  host: {
    '[class.preview]': 'preview()',
  },
  template: `
    @if (variant() === 'mini') {
      <nav class="mini" [attr.aria-label]="label()">
        <ul>
          @for (row of rows(); track row.item.hash) {
            <li>
              <a
                [href]="'#' + row.item.hash"
                [attr.data-level]="row.level"
                [attr.aria-label]="row.item.text"
                [attr.title]="row.item.text"
                [attr.aria-current]="row.item.hash === active() ? 'location' : null"
                [class.on]="row.item.hash === active()"
                (click)="navigate(row.item, $event)"
              >
                <span class="bar" aria-hidden="true"></span>
              </a>
            </li>
          }
        </ul>
      </nav>
    } @else {
      <nav
        class="toc ui-scrollbar"
        [attr.aria-label]="label()"
        [style.top]="stickyTop()"
        [style.max-height]="maxHeight()"
      >
        <ul>
          @for (row of rows(); track row.item.hash) {
            <li>
              <a
                [href]="'#' + row.item.hash"
                [attr.data-level]="row.level"
                [attr.aria-current]="row.item.hash === active() ? 'location' : null"
                [class.on]="row.item.hash === active()"
                (click)="navigate(row.item, $event)"
              >
                {{ row.item.text }}
              </a>
            </li>
          }
        </ul>
      </nav>
    }
  `,
  styles: `
    :host {
      display: block;
      --toc-active-ink: color-mix(in srgb, var(--ui-accent) 60%, var(--ui-text));
    }

    .toc {
      position: sticky;
      width: var(--layout-toc);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-right: var(--ui-space-2);
      --scrollbar-size: 6px;
    }

    .toc ul,
    .mini ul {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .toc a {
      display: block;
      padding: var(--ui-space-2) var(--ui-space-3) var(--ui-space-2) var(--layout-toc-indent-1);
      border-left: 1px solid transparent;
      color: var(--ui-muted);
      font-size: var(--ui-text-md);
      font-weight: var(--ui-weight-medium);
      line-height: 1.45;
      text-decoration: none;
      transition: color 0.14s ease, border-color 0.14s ease;
    }

    .toc a[data-level='1'] {
      padding-left: var(--layout-toc-indent-2);
    }

    .toc a[data-level='2'] {
      padding-left: var(--layout-toc-indent-3);
    }

    .toc a:hover {
      border-left-color: var(--ui-inner-border);
      color: var(--ui-text);
    }

    .toc a.on {
      border-left-color: var(--ui-accent);
      color: var(--toc-active-ink);
      font-weight: var(--ui-weight-semibold);
    }

    .toc a:focus-visible,
    .mini a:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }

    /* 窄窗速览：只显示宽度条，靠 aria-label / title 读标题 */
    .mini {
      display: none;
      position: sticky;
      top: 20vh;
      width: 24px;
      padding: var(--ui-space-2) 0;
    }

    .mini ul {
      align-items: flex-start;
      gap: var(--ui-space-1);
    }

    .mini a {
      display: flex;
      align-items: center;
      width: 24px;
      height: 24px;
      text-decoration: none;
    }

    .mini .bar {
      display: block;
      height: 3px;
      border-radius: var(--ui-radius-pill);
      background: var(--ui-muted);
      opacity: 0.5;
      transition: width 0.14s ease, background 0.14s ease, opacity 0.14s ease;
    }

    .mini a[data-level='0'] .bar {
      width: 24px;
    }

    .mini a[data-level='1'] .bar {
      width: 16px;
    }

    .mini a[data-level='2'] .bar {
      width: 8px;
    }

    .mini a:hover .bar {
      opacity: 0.85;
    }

    .mini a.on .bar {
      background: var(--ui-accent);
      opacity: 1;
    }

    /* 只在 768–1024 显示速览条；更宽交给完整目录栏，更窄让正文独占宽度 */
    @media (min-width: 768px) and (max-width: 1024px) {
      .mini {
        display: flex;
      }
    }

    /* VIS 样张 / 设计预览：绕过断点强制可见 */
    :host(.preview) .mini {
      display: flex;
    }

    @media (prefers-reduced-motion: reduce) {
      .toc a,
      .mini .bar {
        transition: none;
      }
    }
  `,
})
export class TocComponent {
  readonly items = input<TocItem[]>([]);
  /** 外部选中项；非空时覆盖内部滚动监听结果。 */
  readonly activeHash = input('');
  /** 吸顶偏移，默认对齐标题 scroll-margin。 */
  readonly stickyTop = input('var(--ui-scroll-offset)');
  /** 滚动容器选择器；留空 = 文档。 */
  readonly root = input('');
  /** 导航可访问名。 */
  readonly label = input('本页目录');
  readonly variant = input<TocVariant>('full');
  /** 样张专用：不受 768–1024 断点限制，始终显示速览条。 */
  readonly preview = input(false);
  /** 点击条目后发出对应 hash，供外部同步 activeHash。 */
  readonly navigated = output<string>();

  readonly rows = computed(() => flattenToc(this.items()));
  readonly active = computed(() => this.activeHash() || this.internalActive());
  readonly maxHeight = computed(
    () => `calc(100vh - ${this.stickyTop()} - var(--ui-space-6))`,
  );

  private readonly internalActive = signal('');
  private readonly destroyRef = inject(DestroyRef);
  private bound = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private fallback: ReturnType<typeof setTimeout> | undefined;
  private lastSpy = 0;
  private lockUntil = 0;
  /** 点击后的选中项：用户自己滚动之前一直保留，避免贴底的目标被兜底规则抢走。 */
  private clicked: string | null = null;

  constructor() {
    afterNextRender(() => this.bind());
    this.destroyRef.onDestroy(() => this.unbind());
  }

  navigate(item: TocItem, event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = this.findTarget(item.hash);
    if (!target) return;

    event.preventDefault();
    this.clicked = item.hash;
    this.internalActive.set(item.hash);
    // 锁 1s：平滑滚动的中间位置不应把选中项来回拨
    this.lockUntil = performance.now() + CLICK_LOCK;
    this.navigated.emit(item.hash);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.scrollTo(target, reduced ? 'auto' : 'smooth');
  }

  /**
   * 只滚一个容器：文档或 `root` 指定的嵌套滚动区。
   *
   * 不用 `scrollIntoView`——它会同时滚动所有可滚祖先（外层页面一起被带走），
   * 锚点在长文档里会因此对不齐阅读位置。
   */
  private scrollTo(target: HTMLElement, behavior: ScrollBehavior): void {
    const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const scroller = this.resolveRoot();
    const host = scroller ?? window;
    const start = scroller ? scroller.scrollTop : window.scrollY;

    const top = scroller
      ? Math.max(
          0,
          target.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop -
            margin,
        )
      : Math.max(0, target.getBoundingClientRect().top + window.scrollY - margin);

    host.scrollTo({ top, behavior });

    // 平滑滚动在后台标签 / 省电模式里可能被丢弃；一帧后没动就直接跳到位
    if (behavior === 'auto') return;
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = setTimeout(() => {
      this.fallback = undefined;
      const now = scroller ? scroller.scrollTop : window.scrollY;
      if (Math.abs(now - start) < 1 && Math.abs(now - top) > 1) host.scrollTo({ top });
    }, 150);
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    // scroll 不冒泡，但捕获阶段能收到嵌套滚动容器的滚动
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onScroll, { passive: true });
    // 用户自己动手（滚轮 / 指针 / 键盘）时交还选中权
    window.addEventListener('wheel', this.release, { passive: true });
    window.addEventListener('pointerdown', this.release, { passive: true });
    window.addEventListener('touchstart', this.release, { passive: true });
    window.addEventListener('keydown', this.release);
    this.spy();
  }

  private unbind(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    window.removeEventListener('wheel', this.release);
    window.removeEventListener('pointerdown', this.release);
    window.removeEventListener('touchstart', this.release);
    window.removeEventListener('keydown', this.release);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = undefined;
  }

  private readonly release = (): void => {
    this.clicked = null;
  };

  private readonly onScroll = (): void => {
    if (this.timer) return;
    const wait = Math.max(0, SPY_THROTTLE - (performance.now() - this.lastSpy));
    if (wait === 0) {
      this.lastSpy = performance.now();
      this.spy();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.lastSpy = performance.now();
      this.spy();
    }, wait);
  };

  private spy(): void {
    if (performance.now() < this.lockUntil) return;

    const rows = this.rows();
    if (!rows.length) return;

    // 点击后选中项钉住：贴底的目标滚不到位时，不让兜底规则立刻抢走它
    if (this.clicked) {
      if (rows.some((row) => row.item.hash === this.clicked)) {
        if (this.internalActive() !== this.clicked) this.internalActive.set(this.clicked);
        return;
      }
      this.clicked = null;
    }

    const scroller = this.resolveRoot();
    const hashes = rows.map((row) => row.item.hash);
    const elements = hashes.map((hash) => this.findTarget(hash));

    let scrollTop: number;
    let viewport: number;
    let scrollHeight: number;
    let origin: number;

    if (scroller) {
      scrollTop = scroller.scrollTop;
      viewport = scroller.clientHeight;
      scrollHeight = scroller.scrollHeight;
      origin = scroller.getBoundingClientRect().top;
    } else {
      scrollTop = window.scrollY;
      viewport = window.innerHeight;
      scrollHeight = document.documentElement.scrollHeight;
      origin = 0;
    }

    // MUI 文档目录的三个阈值：
    //   ① scrollTop < 200：还在开头，认第一节；
    //   ② 标题相对容器顶部 <= clientHeight / 8：该标题已越过阅读线，取最后一个；
    //   ③ 距底 50px 内：认最后一节（短尾巴不会永远选不中）。
    let current = hashes[0];

    if (scrollTop >= SPY_LINE) {
      for (const [index, element] of elements.entries()) {
        if (!element) continue;
        if (element.getBoundingClientRect().top - origin <= viewport / 8) {
          current = hashes[index];
        }
      }
    }

    if (scrollHeight - (scrollTop + viewport) <= SPY_BOTTOM) {
      current = hashes[hashes.length - 1];
    }

    if (current !== this.internalActive()) this.internalActive.set(current);
  }

  private resolveRoot(): HTMLElement | null {
    const selector = this.root().trim();
    return selector ? document.querySelector<HTMLElement>(selector) : null;
  }

  private findTarget(hash: string): HTMLElement | null {
    const id = hash.replace(/^#/, '');
    const scroller = this.resolveRoot();
    if (scroller) {
      return scroller.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    }
    return document.getElementById(id);
  }
}
