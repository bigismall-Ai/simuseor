import { Component } from '@angular/core';
import { InnerCardComponent } from '../ui/inner-card';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TextComponent } from '../ui/text';
import { VisualPageComponent } from './visual-page';

interface LayerRow {
  token: string;
  value: number;
  name: string;
  use: string;
}

/**
 * 层级与阴影：6 层 z-index 与两档阴影。
 *
 * 层级图里的叠放顺序就是 token 的数值顺序；页面里不再写 999 / 9999。
 */
@Component({
  selector: 'app-vis-elevation',
  imports: [
    InnerCardComponent,
    RulesComponent,
    SectionBlockComponent,
    TableComponent,
    TextComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-tokens.scss',
  template: `
    <app-visual-page
      title="层级与阴影"
      hint="六层 z-index 决定谁盖住谁；两档阴影只表达离页面的距离，不做发光。"
    >
      <ui-section title="叠放顺序" pill="z-index">
        <ui-text variant="lead">
          卡片从下往上依次是导航、吸底、Toast、遮罩、弹层、Material 浮层。数值是 token，
          页面里只写 <code>z-index: var(--ui-z-*)</code>，不写 999 或 9999。
        </ui-text>
        <div class="z-stage" role="img" aria-label="六层 z-index 叠放示意图">
          @for (layer of layers; track layer.token; let i = $index) {
            <ui-inner-card
              class="z-card"
              [style.z-index]="'var(--ui-z-' + layer.key + ')'"
              [style.top]="'calc(var(--ui-space-7) * ' + i + ')'"
              [style.left]="'calc(var(--ui-space-6) * ' + i + ')'"
            >
              <span class="tok-inline" style="font-size: var(--ui-text-sm)">
                <b>{{ layer.name }}</b>
                <span class="mono" style="font-size: var(--ui-text-xs)">
                  {{ layer.token }} · {{ layer.value }}
                </span>
              </span>
            </ui-inner-card>
          }
        </div>
        <ui-text variant="hint">
          最上面的是 Material 浮层（菜单、select 面板、snackbar），它必须盖住自己的弹层；
          Toast 在遮罩之下，弹层打开时不会被 Toast 挡住视线，但也不会压在遮罩上。
        </ui-text>
      </ui-section>

      <ui-section title="六层定义" pill="Layers">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">值</th>
                <th scope="col">层</th>
                <th scope="col">典型元素</th>
              </tr>
            </thead>
            <tbody>
              @for (layer of layers; track layer.token) {
                <tr>
                  <td class="mono">{{ layer.token }}</td>
                  <td class="mono">{{ layer.value }}</td>
                  <td>{{ layer.name }}</td>
                  <td>{{ layer.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="阴影" pill="Elevation">
        <ui-text variant="hint">
          两档就够了：<code>--ui-shadow</code> 给卡片、面板、区块这些「贴在页面上」的表面，
          <code>--ui-shadow-md</code> 给弹层、菜单、Toast 这些「浮在页面上」的表面。
          浅色用纸面投影，深色换成更深的黑投影；不拿主题色发光。
        </ui-text>
        <div class="tok-cols">
          <ui-inner-card style="box-shadow: var(--ui-shadow)">
            <div class="tok-stack" [style.padding]="'var(--ui-space-4)'">
              <span class="mono" style="font-size: var(--ui-text-sm)">--ui-shadow</span>
              <span style="font-size: var(--ui-text-sm); color: var(--ui-muted)">
                卡片 / 面板 / 区块 / 内层卡
              </span>
            </div>
          </ui-inner-card>
          <ui-inner-card style="box-shadow: var(--ui-shadow-md)">
            <div class="tok-stack" [style.padding]="'var(--ui-space-4)'">
              <span class="mono" style="font-size: var(--ui-text-sm)">--ui-shadow-md</span>
              <span style="font-size: var(--ui-text-sm); color: var(--ui-muted)">
                弹层 / 菜单 / Toast / 浮层内容
              </span>
            </div>
          </ui-inner-card>
        </div>
        <ui-text variant="hint">
          第三档 <code>--ui-shadow-hover</code> 只用于悬停抬升，不作为静态表面。
          阴影的层次由组件选，页面不再自己叠 <code>box-shadow</code>。
        </ui-text>
      </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>只用六层</b>：<code>--ui-z-nav/sticky/toast/overlay/dialog/material</code>，不新增层级。</li>
          <li><b>不写魔数</b>：页面里出现 <code>z-index: 999</code> 就是漂移，守卫会拦。</li>
          <li><b>遮罩必须夹在中间</b>：弹层在遮罩之上，Toast 在遮罩之下。</li>
          <li><b>Material 最高</b>：菜单、select 面板、snackbar 走 <code>--ui-z-material</code>。</li>
          <li><b>两档阴影</b>：贴页面的表面用 <code>--ui-shadow</code>，浮起来的表面用 <code>--ui-shadow-md</code>。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisElevationComponent {
  readonly layers: (LayerRow & { key: string })[] = [
    {
      key: 'nav',
      token: '--ui-z-nav',
      value: 10,
      name: '导航',
      use: '侧栏、顶栏、面包屑条',
    },
    {
      key: 'sticky',
      token: '--ui-z-sticky',
      value: 20,
      name: '吸底',
      use: '表头、工具条、行内吸底操作',
    },
    {
      key: 'toast',
      token: '--ui-z-toast',
      value: 60,
      name: 'Toast',
      use: '非阻断提示，页面容器定位',
    },
    {
      key: 'overlay',
      token: '--ui-z-overlay',
      value: 80,
      name: '遮罩',
      use: '弹层背后的 scrim',
    },
    {
      key: 'dialog',
      token: '--ui-z-dialog',
      value: 90,
      name: '弹层',
      use: 'ui-dialog / MatDialog 面板',
    },
    {
      key: 'material',
      token: '--ui-z-material',
      value: 1000,
      name: 'Material',
      use: '菜单、select 面板、snackbar',
    },
  ];
}
