import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/**
 * 视觉设计总览（/vis/visual/overview）。
 *
 * 只做分类入口：每个分类一页，组件与产品同源；不再把所有样张堆在一页。
 */
@Component({
  selector: 'app-visual-overview',
  standalone: true,
  imports: [RouterLink, PanelComponent, VisualPageComponent],
  template: `
    <app-visual-page
      title="视觉设计总览"
      hint="按分类拆开的视觉参考；样张直接渲染 ui/ 下的真实组件。"
    >
      <p class="vis-note">
        本区属 <strong>VIS 设计区 · 视觉设计</strong>，与「原型设计」并列。
        分类页共用同一套 token 与组件，改动会同时体现在站点里。
      </p>

      <div class="visual-cat-grid">
        @for (c of categories; track c.route) {
          <a class="visual-cat" [routerLink]="c.route">
            <span class="visual-cat-kicker">{{ c.kicker }}</span>
            <b>{{ c.label }}</b>
            <span class="visual-cat-desc">{{ c.desc }}</span>
            <span class="visual-cat-go">打开 →</span>
          </a>
        }
      </div>

      <ui-panel kicker="Rules" title="这一区的三条规则">
        <ul class="visual-rules">
          <li><b>同源：</b>按钮、输入、表格、模态框、卡片都直接渲染 <code>ui/</code> 下的真实组件，不是静态截图。</li>
          <li><b>分页：</b>一个分类一个页面，左栏只列分类，不再用锚点把十件事塞进一页。</li>
          <li><b>两套主题：</b>页头右上角可切换明暗；色彩页同时展示浅色水墨留白与深色极光界面两套色板。</li>
        </ul>
      </ui-panel>
    </app-visual-page>
  `,
  styles: [
    `
      .visual-cat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .visual-cat {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 128px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        color: var(--text);
        text-decoration: none;
        transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
      }
      .visual-cat:hover {
        border-color: var(--accent-line);
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
      }
      .visual-cat-kicker {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .visual-cat b { font-size: 15px; font-weight: 600; }
      .visual-cat-desc { font-size: 11.5px; line-height: 1.55; color: var(--muted); }
      .visual-cat-go { margin-top: auto; padding-top: 6px; font-size: 11.5px; font-weight: 600; color: var(--accent); }

      .visual-rules {
        margin: 0;
        padding-left: 18px;
        font-size: 12px;
        line-height: 1.75;
        color: var(--muted);
      }
      .visual-rules b { color: var(--text-2); font-weight: 600; }
      .visual-rules code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 11.5px; color: var(--text-2); }
    `,
  ],
})
export class VisualOverviewComponent {
  readonly categories = [
    { label: '标识', kicker: 'Brand', route: '/vis/visual/brand', desc: '组合标、favicon 与「蝉形只出现在两处」的边界。' },
    { label: '色彩', kicker: 'Foundations', route: '/vis/visual/color', desc: '浅色水墨留白 / 深色极光界面两套色板与角色表。' },
    { label: '按钮', kicker: 'Components', route: '/vis/visual/buttons', desc: '默认、主操作、危险、禁用、加载与尺寸。' },
    { label: '输入框', kicker: 'Components', route: '/vis/visual/inputs', desc: '默认、有值、只读、禁用、单选框，以及复合壳的焦点。' },
    { label: '圆角', kicker: 'Layout', route: '/vis/visual/radius', desc: '12 / 8 / 5 三档圆角与三档阴影。' },
    { label: '胶囊', kicker: 'Components', route: '/vis/visual/pills', desc: 'filter chip、分类 pill、状态 badge 与分段控件。' },
    { label: '空状态', kicker: 'Feedback', route: '/vis/visual/empty', desc: '空态、加载、错误、成功与提示条的统一表达。' },
    { label: '表格', kicker: 'Components', route: '/vis/visual/tables', desc: '列表视图与文件表共用的表格样式。' },
    { label: '模态框', kicker: 'Components', route: '/vis/visual/modals', desc: '唯一使用 16px 圆角的弹层，静态样张。' },
    { label: '卡片', kicker: 'Components', route: '/vis/visual/cards', desc: '工作流卡四态、模型发现卡与模型库卡的真实组件。' },
  ];
}
