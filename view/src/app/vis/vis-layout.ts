import { Component } from '@angular/core';
import { GridComponent } from '../ui/grid';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { VisualPageComponent } from './visual-page';

/** 布局：页面骨架、两栏拆分与全局 layout token。 */
@Component({
  selector: 'app-vis-layout',
  standalone: true,
  imports: [GridComponent, SectionBlockComponent, TableComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page title="布局">
      <ui-section title="页面骨架" pill="Shell">
          <div class="layout-demo">
            <div class="layout-demo-nav">
              <b>导航</b>
              <span>--layout-nav</span>
              <small>224px</small>
            </div>
            <div class="layout-demo-main">
              <div class="layout-demo-head">
                <b>页头 / 面包屑</b>
                <span>--layout-top</span>
              </div>
              <div class="layout-demo-body">
                <b>内容区</b>
                <span>--layout-content-max · --layout-gutter</span>
              </div>
            </div>
          </div>
        </ui-section>

      <ui-section title="两栏" pill="Split">
          <div class="split-demos">
            <div class="split-demo-block">
              <span class="split-label">MIN · 360px</span>
              <div class="layout-split layout-split-demo split-min">
                <div class="layout-pane inner-card">
                  <b>左栏 360</b>
                  <span>--layout-split-left-min</span>
                  <small>最小宽度</small>
                </div>
                <div class="layout-pane inner-card">
                  <b>右栏</b>
                  <span>1fr</span>
                  <small>填充剩余空间</small>
                </div>
              </div>
            </div>

            <div class="split-demo-block">
              <span class="split-label">MAX · 420px</span>
              <div class="layout-split layout-split-demo">
                <div class="layout-pane inner-card">
                  <b>左栏 420</b>
                  <span>--layout-split-left</span>
                  <small>最大宽度</small>
                </div>
                <div class="layout-pane inner-card">
                  <b>右栏</b>
                  <span>1fr</span>
                  <small>填充剩余空间</small>
                </div>
              </div>
            </div>

            <div class="split-demo-block">
              <span class="split-label">等分 · 1fr / 1fr</span>
              <div class="layout-split-even">
                <div class="layout-pane inner-card">
                  <b>左栏</b>
                  <span>1fr</span>
                  <small>对等分栏</small>
                </div>
                <div class="layout-pane inner-card">
                  <b>右栏</b>
                  <span>1fr</span>
                  <small>对等分栏</small>
                </div>
              </div>
            </div>

            <div class="split-demo-block">
              <span class="split-label">固定右 · 1fr / 300–360px</span>
              <div class="layout-split-end">
                <div class="layout-pane inner-card">
                  <b>内容</b>
                  <span>1fr</span>
                  <small>主区自适应</small>
                </div>
                <div class="layout-pane inner-card">
                  <b>详情</b>
                  <span>--layout-split-right</span>
                  <small>360px</small>
                </div>
              </div>
            </div>
          </div>
        </ui-section>

      <ui-section title="三栏" pill="Three">
          <div class="split-demo-block">
            <span class="split-label">导航 208 / 内容 1fr / 详情 262</span>
            <div class="layout-three">
              <div class="layout-pane inner-card">
                <b>导航</b>
                <span>--layout-three-left</span>
                <small>208px</small>
              </div>
              <div class="layout-pane inner-card">
                <b>内容</b>
                <span>1fr</span>
                <small>主工作区</small>
              </div>
              <div class="layout-pane inner-card">
                <b>详情</b>
                <span>--layout-three-right</span>
                <small>262px</small>
              </div>
            </div>
          </div>
        </ui-section>

      <ui-section title="上下" pill="Stack">
          <div class="split-demo-block">
            <span class="split-label">页头 / 内容 / 页脚</span>
            <div class="layout-stack">
              <div class="layout-pane inner-card compact">
                <b>页头</b>
                <span>标题 · 视图切换 · 主操作</span>
              </div>
              <div class="layout-pane inner-card compact">
                <b>内容</b>
                <span>表格 / 卡片 / 表单</span>
              </div>
              <div class="layout-pane inner-card compact">
                <b>页脚</b>
                <span>状态 · 计数 · 辅助操作</span>
              </div>
            </div>
          </div>
        </ui-section>

      <ui-section title="网格" pill="Grid">
          <div class="split-demo-block">
            <span class="split-label">卡片 · minmax(250px, 1fr)</span>
            <ui-grid max="1fr">
              @for (item of gridItems; track item) {
                <div class="layout-pane inner-card">
                  <b>卡片 {{ item }}</b>
                  <span>--layout-grid-min</span>
                  <small>250px 起</small>
                </div>
              }
            </ui-grid>
          </div>
        </ui-section>

      <ui-section title="变量" pill="Tokens">
          <ui-table>
<table>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">值</th>
                  <th scope="col">用途</th>
                </tr>
              </thead>
              <tbody>
                @for (t of tokens; track t.token) {
                  <tr>
                    <td class="mono">{{ t.token }}</td>
                    <td class="mono">{{ t.value }}</td>
                    <td>{{ t.use }}</td>
                  </tr>
                }
              </tbody>
            </table>
</ui-table>
        </ui-section>

      <ui-section title="说明" pill="Notes" [plain]="true">
          <ul class="color-rules">
            <li><b>变量驱动</b>：侧栏宽度、内容最大宽度、页面留白全部用 <code>--layout-*</code> 控制，改一处即可全局变化。</li>
            <li><b>两栏</b>：固定左（360–420px + 1fr）、等分（1fr + 1fr）、固定右（1fr + 300–360px）。</li>
            <li><b>三栏</b>：导航 208px + 内容 1fr + 详情 262px，适合资源管理器这类主从结构。</li>
            <li><b>上下 / 网格</b>：窄屏或线性流程用上下堆叠；卡片区用 minmax(250px, 1fr) 自动换列。</li>
            <li><b>断点</b>：以上分栏在 1100px 以下统一折成单栏；侧栏 224px ↔ 64px。</li>
            <li><b>背景不算卡片</b>：页面与侧栏属于背景层，只有栏目卡和内层卡计入层级。</li>
            <li><b>最多两层</b>：section 卡（不透明）→ inner-card（透明 + 描边 + 阴影），到此为止。</li>
            <li><b>列表独立</b>：表格 / 列表用 list-card，直接放进 section-body，不再套 section 卡。</li>
            <li><b>文字不单独成卡</b>：说明与规则使用 section-body.plain，并集中在页面最后。</li>
          </ul>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisLayoutComponent {
  readonly gridItems = [1, 2, 3, 4];

  readonly tokens = [
    { token: '--layout-nav', value: '224px', use: '展开侧栏宽度' },
    { token: '--layout-nav-collapsed', value: '64px', use: '收起侧栏宽度' },
    { token: '--layout-content-max', value: '1320px', use: '内容最大宽度' },
    { token: '--layout-gutter', value: '30px', use: '页面左右留白' },
    { token: '--layout-top', value: '26px', use: '页面顶部留白' },
    { token: '--layout-bottom', value: '48px', use: '页面底部留白' },
    { token: '--layout-split-left', value: '420px', use: '两栏固定左：左栏宽度' },
    { token: '--layout-split-left-min', value: '360px', use: '两栏固定左：左栏最小宽度' },
    { token: '--layout-split-right', value: '360px', use: '两栏固定右：右栏宽度' },
    { token: '--layout-split-right-min', value: '300px', use: '两栏固定右：右栏最小宽度' },
    { token: '--layout-split-gap', value: '32px', use: '分栏间距' },
    { token: '--layout-three-left', value: '208px', use: '三栏导航宽度' },
    { token: '--layout-three-right', value: '262px', use: '三栏详情宽度' },
    { token: '--layout-grid-min', value: '250px', use: '卡片网格最小列宽' },
  ];
}
