import { Component } from '@angular/core';
import { LabelComponent } from '../ui/label';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TextComponent } from '../ui/text';
import { VisualPageComponent } from './visual-page';

/**
 * 字体与排版：5 档字号、行高配对、等宽与正文、正文阅读宽、标题层级。
 *
 * 页面只用 ui-text / ui-label / ui-rules / ui-table 现成组件，
 * 样张字号与行高全部引用 --ui-text-* 与对应行高，不新造字号。
 */
@Component({
  selector: 'app-vis-typography',
  imports: [
    LabelComponent,
    RulesComponent,
    SectionBlockComponent,
    TableComponent,
    TextComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-tokens.scss',
  template: `
    <app-visual-page
      title="字体与排版"
      hint="五档字号配固定行高：小字紧、正文松、标题更紧；正文宽度上限 72ch。"
    >
      <ui-section title="字号阶梯" pill="Scale">
        <ui-text variant="lead">
          全站只有五档字号，页面不再自造 13 / 15 / 9.5 这类中间值。每一档都绑定一条行高，
          同一档在卡片、表格、说明文字里保持一致。
        </ui-text>
        <div class="tok-stack">
          @for (step of steps; track step.key) {
            <div class="scale-row">
              <span class="scale-sample mono" [style.font-size]="'var(--ui-text-' + step.key + ')'">
                {{ step.token }}
              </span>
              <span
                class="scale-sample"
                [style.font-size]="'var(--ui-text-' + step.key + ')'"
                [style.line-height]="step.line"
              >
                模型库 · 视觉设计 · Aa 0123
              </span>
              <span
                class="scale-sample"
                [style.font-size]="'var(--ui-text-' + step.key + ')'"
                [style.line-height]="step.line"
              >
                {{ step.size }}px · 行高 {{ step.line }}
              </span>
            </div>
          }
        </div>
      </ui-section>

      <ui-section title="行高配对" pill="Line height">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">档位</th>
                <th scope="col">Token</th>
                <th scope="col">字号</th>
                <th scope="col">行高</th>
                <th scope="col">用途</th>
              </tr>
            </thead>
            <tbody>
              @for (step of steps; track step.key) {
                <tr>
                  <td>{{ step.name }}</td>
                  <td class="mono">{{ step.token }}</td>
                  <td class="mono">{{ step.size }}px</td>
                  <td class="mono">{{ step.line }}</td>
                  <td>{{ step.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
        <ui-text variant="hint">
          行高按「读得越久越松」排：一行标签与 kicker 收在 1.4 以内，正文 1.5–1.65，
          规则清单 1.75 留给长段阅读，页面标题 1.2 让 22px 不撑开页头。
        </ui-text>
      </ui-section>

      <ui-section title="等宽与正文" pill="Mono vs body">
        <div class="tok-cols">
          <div class="tok-stack">
            <ui-label>正文 · --ui-font-body</ui-label>
            <p style="font-family: var(--ui-font-body); font-size: var(--ui-text-md)">
              按目录查看本机资产的实际落点、占用和可清理项，切换视图不会改变排序。
            </p>
            <ui-text variant="hint">
              Inter / 微软雅黑 / 系统无衬线；承载所有说明文字、标题与表单。
            </ui-text>
          </div>
          <div class="tok-stack">
            <ui-label>等宽 · --ui-font-mono</ui-label>
            <p class="mono" style="font-size: var(--ui-text-md)">
              workspace/models/diffusion_models/FLUX.1-dev
            </p>
            <ui-text variant="hint">
              只给路径、Token、尺寸、计数与 tab 数字；不和正文混排成段。
            </ui-text>
          </div>
        </div>
        <ui-text variant="hint">
          第三套字体 <code>--ui-font-display</code>（衬线）留给封面字标与文档大标题，
          产品界面里不再出现。
        </ui-text>
      </ui-section>

      <ui-section title="正文阅读宽" pill="72ch">
        <ui-text variant="lead">
          这段引言就是 <code>ui-text</code> 的默认样张：它的宽度上限是
          <code>--layout-prose-measure</code>（72ch ≈ 38 个汉字），超过就换行，
          不跟着 2040px 的内容区一起拉长。正文越宽，眼睛回行的距离越长，
          3440 带鱼屏上尤其明显。
        </ui-text>
        <ui-text variant="hint">
          72ch 只约束段落与规则清单；表格、卡片网格、表格说明不套这条上限。
        </ui-text>
      </ui-section>

      <ui-section title="标题层级" pill="Hierarchy" [plain]="true">
        <div class="tok-stack">
          <ui-label>① 页面标题 · h1 · 22 / 1.2 / 600</ui-label>
          <p
            aria-hidden="true"
            style="font-size: var(--ui-text-xl); font-weight: 600; line-height: 1.2; margin: 0"
          >
            资源管理器
          </p>
          <ui-label>② 区块标题 · h2 · 14 / 1.4 / 600（ui-section 自带）</ui-label>
          <p
            aria-hidden="true"
            style="font-size: var(--ui-text-lg); font-weight: 600; line-height: 1.4; margin: 0"
          >
            页面骨架
          </p>
          <ui-label>③ 区块内小标题 · h3 · 14 / 1.4 / 600（ui-label）</ui-label>
          <ui-label>④ KICKER · 10.5 / 1.4 / 600 · 0.11em</ui-label>
          <p
            class="mono"
            aria-hidden="true"
            style="font-size: var(--ui-text-xs); letter-spacing: 0.11em; margin: 0"
          >
            MODELS · LIBRARY
          </p>
          <ui-text variant="hint">
            h2 与 ui-label 同为 14px，不靠字号区分，而靠位置与间距：h2 在卡外、负责分区，
            h3 在卡内、负责一段说明。再往下一级用加粗行内文字，不再新增字号。
          </ui-text>
        </div>
      </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>五档封顶</b>：字号只用 <code>--ui-text-xs/sm/md/lg/xl</code>，需要强调就加粗或换色，不改字号。</li>
          <li><b>行高跟随档位</b>：同一档在不同组件里保持同一条行高，避免表格比正文更松。</li>
          <li><b>等宽不承段</b>：Token、路径、数字用等宽；说明句一律用正文字体。</li>
          <li><b>正文 72ch</b>：段落与规则清单最宽 72ch；卡片与表格不受限。</li>
          <li><b>不放大标题</b>：页头 22px 封顶，不用展示型大字。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisTypographyComponent {
  readonly steps = [
    {
      key: 'xs',
      name: '微',
      token: '--ui-text-xs',
      size: '10.5',
      line: '1.4',
      use: 'kicker / 表头 / 徽标 / Token 标签',
    },
    {
      key: 'sm',
      name: '小',
      token: '--ui-text-sm',
      size: '11.5',
      line: '1.65',
      use: '引言与规则清单 / 列表副行 / 表格默认',
    },
    {
      key: 'md',
      name: '常规',
      token: '--ui-text-md',
      size: '12.5',
      line: '1.5',
      use: '正文段落 / 页头提示 / Toast 与弹层正文',
    },
    {
      key: 'lg',
      name: '大',
      token: '--ui-text-lg',
      size: '14',
      line: '1.4',
      use: '区块标题 / 小标题 / 面板标题',
    },
    {
      key: 'xl',
      name: '超大',
      token: '--ui-text-xl',
      size: '22',
      line: '1.2',
      use: '页面标题（唯一一处）',
    },
  ];
}
