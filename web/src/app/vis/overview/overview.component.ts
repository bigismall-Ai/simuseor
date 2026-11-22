import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { PanelComponent } from '../../ui/panel.component';
import prototypes from '../prototypes/manifest.json';

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
 * VIS 总览页（/vis/overview）。
 *
 * 只做一件事：说清 VIS 设计区分成「视觉设计」与「原型设计」两支，
 * 并给出各自的入口。原型清单直接读 manifest，与左侧导航同源。
 */
@Component({
  selector: 'app-vis-overview',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent, PanelComponent],
  template: `
    <div class="vis-overview">
      <ui-page-header
        kicker="VIS"
        title="设计区总览"
        hint="视觉规范与原型设计的入口；这里的组件与产品同源。"
      />

      <div class="vis-entry-grid">
        <a class="vis-entry" routerLink="/vis/visual/overview">
          <p class="vis-entry-kicker">Visual</p>
          <h2>视觉设计</h2>
          <p class="vis-entry-desc">
            标识、色彩、按钮、输入框、圆角、胶囊、空状态、表格、模态框、卡片 ——
            一个分类一页，直接渲染 <code>ui/</code> 下的真实组件。
          </p>
          <span class="vis-entry-go">打开视觉设计总览 →</span>
        </a>

        <a class="vis-entry" routerLink="/vis/prototypes/resource-manager">
          <p class="vis-entry-kicker">Prototypes</p>
          <h2>原型设计</h2>
          <p class="vis-entry-desc">
            资源管理器、下载页、错误提示、设置页与源探针五个页面，
            用同一套 token 与组件拼出完整流程。
          </p>
          <span class="vis-entry-go">从资源管理器开始 →</span>
        </a>
      </div>

      <ui-panel
        kicker="Prototypes"
        title="原型页面"
        hint="五个页面共用同一个外壳与数据口径；入口固定在左侧导航。"
      >
        <ul class="vis-proto-list">
          @for (p of prototypes; track p.id) {
            <li>
              <a class="vis-proto" [routerLink]="p.route">
                <span class="vis-proto-name">{{ p.title }}</span>
                <span class="vis-proto-desc">{{ p.desc }}</span>
                <span class="vis-proto-route">{{ p.route }}</span>
              </a>
            </li>
          }
        </ul>
      </ui-panel>
    </div>
  `,
  styles: `
    :host {
      display: block;
      max-width: 1240px;
      margin: 0 auto;
      padding: 26px 28px 72px;
    }

    .vis-entry-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 22px;
    }
    .vis-entry {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 20px 22px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      text-decoration: none;
      color: var(--text);
      transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
    }
    .vis-entry:hover {
      border-color: var(--accent-line);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
    .vis-entry-kicker {
      margin: 0;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .vis-entry h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.3;
    }
    .vis-entry-desc {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.65;
      color: var(--muted);
    }
    .vis-entry-desc code {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 11.5px;
      color: var(--text-2);
    }
    .vis-entry-go {
      margin-top: auto;
      padding-top: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
    }

    .vis-proto-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
    }
    .vis-proto {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 12px;
      padding: 11px 14px;
      background: var(--panel-2);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm);
      text-decoration: none;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .vis-proto:hover {
      background: var(--hover);
      border-color: var(--border-strong);
    }
    .vis-proto-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }
    .vis-proto-desc {
      grid-column: 1 / -1;
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--muted);
    }
    .vis-proto-route {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 10.5px;
      color: var(--faint);
      align-self: center;
    }

    @media (max-width: 860px) {
      :host { padding: 20px 16px 56px; }
    }
  `,
})
export class VisOverviewComponent {
  readonly prototypes = prototypes as VisPrototypeEntry[];
}
