import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { focusFirst, rememberFocus, restoreFocus } from '../core/a11y';
import { ThemeService, type ThemePref } from '../core/theme.service';

/** 「实例资产」这一支下的页面。精确匹配——`/nodes/discover` 属于资产，不能被 `/nodes` 捡走 */
const ASSET_PATHS = ['/workflows', '/models', '/nodes', '/resources', '/downloads'];
const OPEN_KEY = 'md-nav-assets';

/**
 * 站点外壳：左侧固定一列，内容区独立滚动。
 *
 * 侧栏只放「去哪」，不放任何状态或提示——状态属于页面本身。这样切换页面时
 * 左边永远静止，用户的视线只需要在右边重新定位。
 *
 * 导航分两组：**实例资产**（工作流 / 模型 / 节点 / 资源管理器 / 下载，含可折叠的子项）、
 * **基础设置**（环境与设置）。外观选择收在底部的弹出框里。
 *
 * 这是**产品页面**的布局。VIS 参考页有自己的外壳，两者互不嵌套，
 * 各自作为顶层路由挂载（见 app.routes.ts）。
 */
@Component({
  selector: 'app-site-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  // 全局 styles.css 里已有 .shell / .sidebar 等既有语汇，这里只把宿主撑成块级，
  // 免得自定义元素默认的 inline 在骨架外面多出一层匿名块
  styles: [':host { display: block; }'],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <!-- 蝉形是辅助图形，字标才是主视觉（VIS v2.0 §2.0.2）。
               明暗两版靠 CSS 切换显隐，不在 TS 里读主题。 -->
          <span class="brand-mark" aria-hidden="true">
            <img class="logo-light" src="/brand/cicada-max.svg" alt="" />
            <img class="logo-dark" src="/brand/cicada-max-dark.svg" alt="" />
          </span>
          <span class="brand-wordmark">
            SiMuseor
            <small class="brand-sub">剧集导演台</small>
          </span>
        </div>

        <nav class="nav">
          <!-- 一级项：只负责开合，本身不是目的地；五个二级项才是入口 -->
          <button
            type="button"
            class="nav-item nav-parent"
            [class.open]="assetsOpen()"
            [class.on]="assetsActive()"
            [attr.aria-expanded]="assetsOpen()"
            aria-controls="nav-assets"
            (click)="toggleAssets()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 1.8 14 5 8 8.2 2 5z" />
              <path d="M2 8l6 3.2L14 8M2 11l6 3.2L14 11" />
            </svg>
            <span>实例资产</span>
            <svg class="nav-caret" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>

          @if (assetsOpen()) {
            <div class="nav-sub" id="nav-assets" role="group" aria-label="实例资产">
              <a class="nav-sub-item" routerLink="/workflows" routerLinkActive="active" ariaCurrentWhenActive="page">工作流</a>
              <a class="nav-sub-item" routerLink="/models" routerLinkActive="active" ariaCurrentWhenActive="page">模型</a>
              <a class="nav-sub-item" routerLink="/nodes" routerLinkActive="active" ariaCurrentWhenActive="page">节点</a>
              <a class="nav-sub-item" routerLink="/resources" routerLinkActive="active" ariaCurrentWhenActive="page">资源管理器</a>
              <a class="nav-sub-item" routerLink="/downloads" routerLinkActive="active" ariaCurrentWhenActive="page">下载</a>
            </div>
          }

          <p class="nav-group">基础设置</p>
          <a class="nav-item" routerLink="/environments" routerLinkActive="active" ariaCurrentWhenActive="page">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.6" />
              <circle cx="12.5" cy="4" r="1.6" />
              <circle cx="12.5" cy="12" r="1.6" />
              <path d="M5 8h3.2M10.6 4.6 8.2 7M10.6 11.4 8.2 9" />
            </svg>
            <span>环境管理</span>
          </a>
          <a class="nav-item" routerLink="/settings" routerLinkActive="active" ariaCurrentWhenActive="page">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 5h12M2 11h12" />
              <circle cx="6" cy="5" r="1.8" />
              <circle cx="10.5" cy="11" r="1.8" />
            </svg>
            <span>设置</span>
          </a>
        </nav>

        <div class="sidebar-foot">
          <div class="appearance">
            <button
              type="button"
              class="theme-toggle"
              (click)="toggleTheme()"
              [attr.aria-expanded]="themeMenu()"
              aria-haspopup="dialog"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.6" />
                <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none" />
              </svg>
              <span>外观</span>
              <em>{{ prefLabel() }}</em>
            </button>

            @if (themeMenu()) {
              <!-- 非模态弹层：命名交给可见标题，焦点进出由 toggleTheme 管（VIS §7.2） -->
              <div #themePop class="theme-pop" role="dialog" aria-labelledby="theme-pop-title">
                <p class="tp-title" id="theme-pop-title">外观</p>
                @for (opt of themeOptions; track opt.value) {
                  <button
                    type="button"
                    class="tp-opt"
                    [class.on]="theme.pref() === opt.value"
                    (click)="theme.setPref(opt.value)"
                  >
                    <span class="tp-swatch" [attr.data-tone]="opt.tone"></span>
                    <span class="tp-name">{{ opt.label }}</span>
                    @if (theme.pref() === opt.value) {
                      <svg class="tp-check" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
                      </svg>
                    }
                  </button>
                }
                <p class="tp-hint"><kbd>T</kbd> 随时切换明暗</p>
              </div>
            }
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="container">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class SiteShellComponent {
  private readonly router = inject(Router);

  /** 默认展开；收起后记住，下次进来保持原样 */
  readonly assetsOpen = signal(localStorage.getItem(OPEN_KEY) !== '0');
  readonly themeMenu = signal(false);
  @ViewChild('themePop') themePop?: ElementRef<HTMLElement>;
  /** 当前地址，用来判断「实例资产」这一支是否处于激活态 */
  private readonly url = signal('');

  readonly themeOptions: { value: ThemePref; label: string; tone: string }[] = [
    { value: 'light', label: '浅色', tone: 'light' },
    { value: 'dark', label: '深色', tone: 'dark' },
    { value: 'system', label: '跟随系统', tone: 'system' },
  ];

  constructor(public theme: ThemeService) {
    this.url.set(this.router.url);
    if (this.inAssets(this.router.url)) this.setAssets(true, false);
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      this.url.set(event.urlAfterRedirects);
      // 进了「实例资产」下的页面就展开，否则用户会看到「人在这页、侧栏却没有亮项」
      if (this.inAssets(event.urlAfterRedirects)) this.setAssets(true, false);
    });
  }

  prefLabel(): string {
    const pref = this.theme.pref();
    return pref === 'system' ? '跟随系统' : pref === 'dark' ? '深色' : '浅色';
  }

  assetsActive(): boolean {
    return this.inAssets(this.url());
  }

  toggleAssets(): void {
    this.setAssets(!this.assetsOpen());
  }

  /**
   * persist=false 用于路由驱动的展开：为了让人看见自己在哪一支而临时打开，
   * 不改用户存下来的偏好，否则「收起」这个选择会被下一次导航悄悄抹掉。
   */
  setAssets(open: boolean, persist = true): void {
    if (persist) localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    if (this.assetsOpen() !== open) this.assetsOpen.set(open);
  }

  private inAssets(url: string): boolean {
    const path = url.split('?')[0].replace(/\/+$/, '') || '/';
    return ASSET_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  }

  /** 弹出框点外面就收，点框内任意位置都不算外面 */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.themeMenu()) return;
    const inside = event.composedPath().some((el) => el instanceof HTMLElement && el.classList.contains('appearance'));
    if (!inside) this.themeMenu.set(false);
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (!this.themeMenu()) return;
    this.themeMenu.set(false);
    // 焦点还在被销毁的弹层里，必须还回触发按钮，否则键盘用户会掉到 body 上
    restoreFocus();
  }

  /**
   * 外观弹层开关：打开时焦点进去，关闭时（Esc）还回来。
   *
   * 走外面点的关闭不还焦点 —— 焦点已经跟着用户的点击走到别处了，抢回来是添乱。
   */
  toggleTheme(): void {
    if (this.themeMenu()) {
      this.themeMenu.set(false);
      return;
    }
    rememberFocus();
    this.themeMenu.set(true);
    setTimeout(() => focusFirst(this.themePop?.nativeElement));
  }

  /**
   * T 键切换主题（弹出框里那枚 kbd 提示就是它）。
   * 焦点在输入控件里时不拦截——在搜索框里打 "t" 必须只是打一个 t。
   */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 't' && event.key !== 'T') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
    this.theme.toggle();
  }
}
