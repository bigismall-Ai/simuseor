import { Component } from '@angular/core';
import { GridComponent } from '../ui/grid';
import { InnerCardComponent } from '../ui/inner-card';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TextComponent } from '../ui/text';
import { VisualPageComponent } from './visual-page';

interface SpaceStep {
  step: number;
  name: string;
  value: string;
  use: string;
}

/**
 * 间距：4 基数、只有 8 档的刻度，以及 padding / gap 的用法样张。
 *
 * 样张里的方块边就是 token 本身，肉眼能对上数值；页面不写中间值。
 */
@Component({
  selector: 'app-vis-spacing',
  imports: [
    GridComponent,
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
      title="间距"
      hint="4 基数、只有 8 档：4 / 8 / 12 / 16 / 20 / 24 / 32 / 48。没有 6、10、14、18、22。"
    >
      <ui-section title="刻度" pill="Scale">
        <ui-text variant="lead">
          每个方块就是一个间距 token 的边长。8 档之外不再新增中间值：需要更松就跳下一档，
          需要更紧就回到上一档，页面不写 <code>margin: 6px</code> 这种手调。
        </ui-text>
        <div class="spacing-scale">
          @for (s of steps; track s.step) {
            <div class="spacing-step">
              <div
                [style.width]="'var(--ui-space-' + s.step + ')'"
                [style.height]="'var(--ui-space-' + s.step + ')'"
                style="background: var(--ui-panel-3); border-radius: var(--ui-radius-xs)"
              ></div>
              <span class="mono" style="font-size: var(--ui-text-xs)">space-{{ s.step }}</span>
              <span class="mono" style="font-size: var(--ui-text-xs); color: var(--ui-muted)">
                {{ s.value }}
              </span>
            </div>
          }
        </div>
      </ui-section>

      <ui-section title="档位与用途" pill="Tokens">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">值</th>
                <th scope="col">典型用途</th>
              </tr>
            </thead>
            <tbody>
              @for (s of steps; track s.step) {
                <tr>
                  <td class="mono">--ui-space-{{ s.step }}</td>
                  <td class="mono">{{ s.value }}</td>
                  <td>{{ s.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="内边距" pill="Padding">
        <ui-text variant="hint">
          容器自己决定内容离边多远：卡片内 12–16，面板内 20，页面区块之间 32。下面四个
          内层卡的外框一样，只有内边距按 token 换档。
        </ui-text>
        <div class="pad-demo">
          @for (p of paddings; track p.step) {
            <ui-inner-card [style.padding]="'var(--ui-space-' + p.step + ')'">
              <div class="tok-stack">
                <span class="mono" style="font-size: var(--ui-text-xs)">--ui-space-{{ p.step }} · {{ p.value }}</span>
                <span style="font-size: var(--ui-text-sm)">{{ p.use }}</span>
              </div>
            </ui-inner-card>
          }
        </div>
      </ui-section>

      <ui-section title="间隙" pill="Gap">
        <ui-text variant="hint">
          同级元素之间只用 <code>gap</code>，不用逐个元素写 margin。列表越密 gap 越小，
          卡片网格用 16 起，区块之间用 32。
        </ui-text>
        <div class="tok-stack">
          @for (g of gaps; track g.step) {
            <div class="tok-stack" [style.gap]="'var(--ui-space-' + g.step + ')'">
              <span class="mono" style="font-size: var(--ui-text-xs); color: var(--ui-muted)">
                gap: --ui-space-{{ g.step }} · {{ g.value }} · {{ g.use }}
              </span>
              <div class="tok-inline" [style.gap]="'var(--ui-space-' + g.step + ')'">
                <ui-inner-card [style.padding]="'var(--ui-space-2)'">
                  <span style="font-size: var(--ui-text-xs)">A</span>
                </ui-inner-card>
                <ui-inner-card [style.padding]="'var(--ui-space-2)'">
                  <span style="font-size: var(--ui-text-xs)">B</span>
                </ui-inner-card>
                <ui-inner-card [style.padding]="'var(--ui-space-2)'">
                  <span style="font-size: var(--ui-text-xs)">C</span>
                </ui-inner-card>
              </div>
            </div>
          }
        </div>
      </ui-section>

      <ui-section title="页面区块间距" pill="Grid" [plain]="true">
        <ui-grid min="220px" max="1fr" gap="var(--ui-space-4)">
          @for (s of [1, 2, 3, 4, 5, 6]; track s) {
            <ui-inner-card [style.padding]="'var(--ui-space-3)'">
              <div class="tok-stack">
                <span class="mono" style="font-size: var(--ui-text-xs)">grid min 220 / max 1fr</span>
                <span style="font-size: var(--ui-text-sm)">卡片 {{ s }}</span>
              </div>
            </ui-inner-card>
          }
        </ui-grid>
        <ui-text variant="hint">
          <code>ui-grid</code> 的列宽跟 <code>--layout-grid-min</code> 走，间距固定
          <code>--ui-space-4</code>；3440 带宽屏上变的是列数，不是间距。
        </ui-text>
      </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>八档封顶</b>：<code>--ui-space-1..8</code> 之外不写数值；缺档说明布局该换结构。</li>
          <li><b>内边距</b>：卡片内容 12–16，面板 20，页面区块外 32，页头下 20。</li>
          <li><b>间隙</b>：列表行 8、表单字段 12、卡片网格 16、区块之间 32。</li>
          <li><b>不要 margin 叠罗汉</b>：同级间距统一交给父级 <code>gap</code>，只给「与父级无关」的外边距。</li>
          <li><b>断点不缩间距</b>：窄窗只改列数与留白，刻度本身不变。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisSpacingComponent {
  readonly steps: SpaceStep[] = [
    { step: 1, name: '4', value: '4px', use: '图标与文字的缝隙、徽标内缩' },
    { step: 2, name: '8', value: '8px', use: '按钮内 gap、列表行内间距、标签之间' },
    { step: 3, name: '12', value: '12px', use: '卡片内边距、表单字段之间、callout 内缩' },
    { step: 4, name: '16', value: '16px', use: '卡片内边距上限、网格列间距、页头下' },
    { step: 5, name: '20', value: '20px', use: '面板内边距、页头与内容之间' },
    { step: 6, name: '24', value: '24px', use: '区块内边距、表格左右内缩' },
    { step: 7, name: '32', value: '32px', use: '区块之间、两栏之间的距离' },
    { step: 8, name: '48', value: '48px', use: '页面底部留白、空状态上下留白' },
  ];

  readonly paddings = [
    { step: 2, value: '8px', use: '紧凑行内卡' },
    { step: 3, value: '12px', use: '常规卡片' },
    { step: 4, value: '16px', use: '宽松卡片 / 表格单元' },
    { step: 6, value: '24px', use: '面板 / 区块' },
  ];

  readonly gaps = [
    { step: 2, value: '8px', use: '列表行 / 标签组' },
    { step: 3, value: '12px', use: '表单字段 / 工具栏' },
    { step: 4, value: '16px', use: '卡片网格' },
    { step: 7, value: '32px', use: '区块之间' },
  ];
}
