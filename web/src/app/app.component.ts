import { Component, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';

/**
 * 应用外壳：左侧固定一列，内容区独立滚动。
 *
 * 侧栏只放「去哪」，不放任何状态或提示——状态属于页面本身。这样切换页面时
 * 左边永远静止，用户的视线只需要在右边重新定位。
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">MD</span>
          <span class="brand-text">
            Model Downloader
            <small>Local Studio</small>
          </span>
        </div>

        <nav class="nav">
          <p class="nav-group">模型</p>
          <a class="nav-item" routerLink="/downloads" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 2v8m0 0 3-3m-3 3-3-3M3 13h10" />
            </svg>
            <span>下载任务</span>
          </a>
          <a class="nav-item" routerLink="/discover" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <span>模型发现</span>
          </a>
          <a class="nav-item" routerLink="/library" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3h10v10H3zM5 6h6M5 9h6" />
            </svg>
            <span>模型库</span>
          </a>
          <a class="nav-item" routerLink="/workflows" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="4" height="3" rx="0.6" />
              <rect x="10.5" y="10.5" width="4" height="3" rx="0.6" />
              <circle cx="11" cy="4" r="1.6" />
              <path d="M5.5 4h4M3.5 5.5v3.5a1.5 1.5 0 0 0 1.5 1.5h3M12.5 6v3.2" />
            </svg>
            <span>工作流发现</span>
          </a>

          <p class="nav-group">运行环境</p>
          <a class="nav-item" routerLink="/comfy" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.6" />
              <circle cx="12.5" cy="4" r="1.6" />
              <circle cx="12.5" cy="12" r="1.6" />
              <path d="M5 8h3.2M10.6 4.6 8.2 7M10.6 11.4 8.2 9" />
            </svg>
            <span>环境管理</span>
          </a>
          <span class="nav-item is-disabled" title="后续版本提供">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2h5v5H2zM9 9h5v5H9zM2 9h5v5H2zM9 2h5v5H9z" />
            </svg>
            <span>工作台</span>
            <em>规划中</em>
          </span>
        </nav>

        <div class="sidebar-foot">
          <a class="nav-item" routerLink="/settings" routerLinkActive="active">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 5h12M2 11h12" />
              <circle cx="6" cy="5" r="1.8" />
              <circle cx="10.5" cy="11" r="1.8" />
            </svg>
            <span>设置</span>
          </a>

          <button
            type="button"
            class="theme-toggle"
            (click)="theme.toggle()"
            [attr.title]="theme.theme() === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          >
            @if (theme.theme() === 'dark') {
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
              </svg>
              <span>浅色模式</span>
            } @else {
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M14 9.5A6 6 0 1 1 6.5 2a5 5 0 0 0 7.5 7.5z" />
              </svg>
              <span>深色模式</span>
            }
            <kbd>T</kbd>
          </button>
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
export class AppComponent {
  constructor(public theme: ThemeService) {}

  /**
   * T 键切换主题（侧栏上那个 kbd 提示就是它）。
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
