import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import prototypes from './prototypes/manifest.json';

/** 原型条目：与 prototypes/manifest.json 的字段一一对应。 */
interface VisPrototypeEntry {
  id: string;
  route: string;
  navLabel: string;
  title: string;
  desc: string;
  status: string;
}

/**
 * VIS 设计区外壳（/vis/*）。
 *
 * 与产品外壳的关系：产品侧栏只放「资产与设置」，VIS 是另一套工作区
 * （视觉参考 + 原型设计），因此这里自带一列导航，不复用 `.sidebar`。
 *
 * 布局：VIS 路由挂在顶层，不与产品页面共享外壳（见 app.routes.ts），
 * 因此这里只负责一次性摆好「侧栏 + 内容」两栏，不再覆盖任何产品侧栏。
 *
 * 导航数据来自 prototypes/manifest.json：新增原型只改 manifest，
 * 这里与总览页会一起长出来。
 */
@Component({
  selector: 'app-vis-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <aside class="vis-sidebar">
      <a class="vis-brand" routerLink="/vis/overview" aria-label="VIS 设计区总览">
        <span class="vis-brand-badge" aria-hidden="true">VIS</span>
        <span class="vis-brand-text">
          设计区
          <small>视觉与原型</small>
        </span>
      </a>

      <nav class="vis-nav" aria-label="VIS 设计区导航">
        <p class="vis-nav-group">设计区</p>
        <a
          class="vis-nav-item"
          routerLink="/vis/overview"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >设计区总览</a>
        <p class="vis-nav-group">视觉设计</p>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/overview"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >总览</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/brand"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >标识</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/color"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >色彩</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/buttons"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >按钮</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/inputs"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >输入框</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/radius"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >圆角</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/pills"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >胶囊</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/empty"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >空状态</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/tables"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >表格</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/modals"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >模态框</a>
        <a
          class="vis-nav-item"
          routerLink="/vis/visual/cards"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
        >卡片</a>

        <p class="vis-nav-group">原型设计</p>
        @for (p of prototypes; track p.id) {
          <a
            class="vis-nav-item"
            [routerLink]="p.route"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >{{ p.navLabel }}</a>
        }
      </nav>

      <div class="vis-sidebar-foot">
        <a class="vis-back" routerLink="/workflows">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13 8H3M7 4 3 8l4 4" />
          </svg>
          <span>返回站点</span>
        </a>
      </div>
    </aside>

    <main class="vis-main">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: flex;
      min-height: 100vh;
      background: var(--bg);
    }

    .vis-sidebar {
      position: sticky;
      top: 0;
      align-self: flex-start;
      flex: 0 0 var(--sidebar-w);
      width: var(--sidebar-w);
      height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 16px 12px 12px;
      overflow-y: auto;
      background: linear-gradient(
        100deg,
        var(--panel) 0%,
        color-mix(in oklab, var(--panel) 94%, transparent) 54%,
        color-mix(in oklab, var(--panel) 58%, transparent) 88%,
        transparent 100%
      );
      border-right: 1px solid color-mix(in oklab, var(--border) 40%, transparent);
    }

    /* 品牌位：VIS 用独立的方形标记，不占全站唯一的那份 .brand-wordmark */
    .vis-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 2px 6px 16px;
      text-decoration: none;
      color: var(--text);
    }
    .vis-brand-badge {
      flex: none;
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      border: 1px solid var(--accent-line);
      color: var(--accent);
      font-family: "Barlow Condensed", "Segoe UI", system-ui, sans-serif;
      font-size: 15px;
      font-weight: 500;
      letter-spacing: 0.06em;
    }
    .vis-brand-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      color: var(--text);
    }
    .vis-brand-text small {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.4;
      color: var(--muted);
    }

    .vis-nav {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .vis-nav-group {
      margin: 16px 8px 6px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .vis-nav-group:first-child { margin-top: 0; }

    .vis-nav-item {
      display: flex;
      align-items: center;
      height: 32px;
      padding: 0 9px;
      border-radius: var(--radius-sm);
      color: var(--muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .vis-nav-item:hover { background: var(--hover); color: var(--text); }
    .vis-nav-item.active {
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }
    .vis-nav-item.vis-nav-child {
      padding-left: 24px;
      font-size: 12.5px;
      color: var(--muted);
    }

    .vis-sidebar-foot {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid var(--border-soft);
    }
    .vis-back {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 9px;
      border-radius: var(--radius-sm);
      color: var(--muted);
      text-decoration: none;
      font-size: 12.5px;
      font-weight: 500;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .vis-back:hover { background: var(--hover); color: var(--text); }
    .vis-back svg {
      flex: none;
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .vis-main {
      flex: 1;
      min-width: 0;
    }

    /* 窄屏：导航变成顶部一条，内容继续在下方滚动 */
    @media (max-width: 860px) {
      :host { flex-direction: column; }
      .vis-sidebar {
        position: static;
        flex: none;
        width: 100%;
        height: auto;
        max-height: 40vh;
        padding: 10px 12px 8px;
        border-right: 0;
        border-bottom: 1px solid color-mix(in oklab, var(--border) 40%, transparent);
      }
      .vis-brand { padding-bottom: 8px; }
      .vis-nav {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
      }
      .vis-nav-group {
        flex-basis: 100%;
        margin: 8px 8px 4px;
      }
      .vis-nav-group:first-child { margin-top: 4px; }
      .vis-nav-item { height: 30px; }
      .vis-sidebar-foot {
        margin-top: 8px;
        padding-top: 8px;
      }
    }
  `,
})
export class VisShellComponent {
  readonly prototypes = prototypes as VisPrototypeEntry[];
}
