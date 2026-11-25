import { Component } from '@angular/core';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TextComponent } from '../ui/text';
import { VisualPageComponent } from './visual-page';

interface ThemeRow {
  name: string;
  token: string;
  light: string;
  dark: string;
  use: string;
}

/**
 * 主题 Token 对照：核心语义 token 的浅色 / 深色取值并排，值以文本给出。
 *
 * 这样不切主题也能核对两端取值；左侧色块跟随当前主题，只作参照。
 */
@Component({
  selector: 'app-vis-theme-tokens',
  imports: [RulesComponent, SectionBlockComponent, TableComponent, TextComponent, VisualPageComponent],
  styleUrl: './vis-tokens.scss',
  template: `
    <app-visual-page
      title="主题 Token"
      hint="同一批语义 token，两套主题各给一组值；页面只引用 token，不写死颜色。"
    >
      <ui-section title="表面" pill="Surface">
        <ui-text variant="lead">
          浅色走「晨雾底 + 玻璃白面板」，深色走「极光底 + 深海军蓝面板」。八个表面 token
          一一对应：页面底、侧栏、面板、抬升面、内嵌面、浮层、卡片实底、内描边。
        </ui-text>
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">浅色 · 晨雾</th>
                <th scope="col">深色 · 极光</th>
                <th scope="col">用在哪</th>
              </tr>
            </thead>
            <tbody>
              @for (row of surfaces; track row.token) {
                <tr>
                  <td class="mono">{{ row.token }}</td>
                  <td class="mono">{{ row.light }}</td>
                  <td class="mono">{{ row.dark }}</td>
                  <td>{{ row.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="文字与描边" pill="Ink">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">浅色 · 晨雾</th>
                <th scope="col">深色 · 极光</th>
                <th scope="col">用在哪</th>
              </tr>
            </thead>
            <tbody>
              @for (row of inks; track row.token) {
                <tr>
                  <td class="mono">{{ row.token }}</td>
                  <td class="mono">{{ row.light }}</td>
                  <td class="mono">{{ row.dark }}</td>
                  <td>{{ row.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="语义色" pill="Semantic">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">浅色 · 晨雾</th>
                <th scope="col">深色 · 极光</th>
                <th scope="col">用在哪</th>
              </tr>
            </thead>
            <tbody>
              @for (row of semantics; track row.token) {
                <tr>
                  <td class="mono">{{ row.token }}</td>
                  <td class="mono">{{ row.light }}</td>
                  <td class="mono">{{ row.dark }}</td>
                  <td>{{ row.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
        <ui-text variant="hint">
          语义色两端都从品牌色与氛围色混合得到：成功偏薄荷、警告偏蜜桃、危险两端都固定为赭石，
          深色不换色相，只靠透明度与文字色保证对比度。
        </ui-text>
      </ui-section>

      <ui-section title="当前主题取值" pill="Live">
        <ui-text variant="hint">
          下面每一块都直接渲染 <code>var(--ui-*)</code>，因此跟随当前主题；要核对另一套，
          用侧栏底部的主题切换按钮换过去。透明表面（rail / surface / raised / inset / border）
          叠在页面光晕上，颜色随背景变化，这是有意的。
        </ui-text>
        <div class="theme-pair">
          @for (swatch of swatches; track swatch.token) {
            <div class="tok-stack">
              <div
                [style.background]="'var(' + swatch.token + ')'"
                [style.height]="'var(--ui-space-8)'"
                [style.border-radius]="'var(--ui-radius-xs)'"
                style="border: 1px solid var(--ui-border-2)"
              ></div>
              <span class="mono" style="font-size: var(--ui-text-xs)">{{ swatch.token }}</span>
            </div>
          }
        </div>
      </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>只认语义</b>：页面引用 <code>--ui-bg / --ui-surface / --ui-raised / --ui-inset / --ui-text / --ui-muted / --ui-border / --ui-accent</code>，不引用调色板原值。</li>
          <li><b>两套同构</b>：浅色与深色只有取值不同，几何、圆角、字号、图层完全一致。</li>
          <li><b>透明表面有意</b>：rail / surface / raised / inset 都是半透明，叠在光晕上才有玻璃感；不要为了「纯色好算」改成实色。</li>
          <li><b>危险不换色相</b>：两端都用赭石，不用品红或蜜桃承担错误语义。</li>
          <li><b>色板不进页面</b>：<code>--ink-*</code> / <code>--aurora-*</code> 只在品牌层与封面用。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisThemeTokensComponent {
  readonly surfaces: ThemeRow[] = [
    {
      name: '页面底',
      token: '--ui-bg',
      light: '#e5e1ff',
      dark: '#0e1026',
      use: '页面底色，上面叠三团柔光',
    },
    {
      name: '侧栏 / 顶栏',
      token: '--ui-rail',
      light: 'rgb(255 255 255 / 0.42)',
      dark: 'color-mix(#111432 66%)',
      use: '侧边导航与顶栏',
    },
    {
      name: '面板',
      token: '--ui-surface',
      light: 'rgb(255 255 255 / 0.42)',
      dark: 'color-mix(#111432 78%)',
      use: '面板、状态卡、表格底',
    },
    {
      name: '抬升面',
      token: '--ui-raised',
      light: 'rgb(255 255 255 / 0.62)',
      dark: 'color-mix(#1a1e3a 88%)',
      use: '卡片、浮层内容、悬停行',
    },
    {
      name: '内嵌面',
      token: '--ui-inset',
      light: 'rgb(36 33 67 / 0.06)',
      dark: 'color-mix(#05071a 55%)',
      use: '表头、输入框、代码内嵌底',
    },
    {
      name: '浮层底',
      token: '--ui-overlay',
      light: '#fbfaff',
      dark: '#171b36',
      use: '弹层、菜单、select 面板',
    },
    {
      name: '卡片实底',
      token: '--ui-card-solid',
      light: '#f7f5ff',
      dark: '#1a1e3a',
      use: '区块卡、卡片蒙版底',
    },
    {
      name: '内描边',
      token: '--ui-inner-border',
      light: 'color-mix(文字 16%)',
      dark: 'color-mix(文字 16%)',
      use: '内层卡、列表分隔',
    },
  ];

  readonly inks: ThemeRow[] = [
    {
      name: '正文',
      token: '--ui-text',
      light: '#242143',
      dark: '#f6f4ff',
      use: '标题、正文、主操作文字',
    },
    {
      name: '次级正文',
      token: '--ui-text-2',
      light: '#3b375f',
      dark: '#d8d5ef',
      use: 'Toast / 提示条里的正文',
    },
    {
      name: '次级文字',
      token: '--ui-muted',
      light: '#625f86',
      dark: '#b9b7d6',
      use: '说明、表头、元信息',
    },
    {
      name: '边框',
      token: '--ui-border',
      light: 'rgb(255 255 255 / 0.68)',
      dark: 'rgb(255 255 255 / 0.16)',
      use: '卡、面板、表格外框',
    },
    {
      name: '弱边框',
      token: '--ui-border-2',
      light: 'rgb(255 255 255 / 0.45)',
      dark: 'rgb(255 255 255 / 0.08)',
      use: '内部分隔、标签描边',
    },
    {
      name: '主色',
      token: '--ui-primary',
      light: '#242143',
      dark: '#5658ff',
      use: '主按钮、选中项、焦点环',
    },
    {
      name: '主色前景',
      token: '--ui-on-primary',
      light: '#ffffff',
      dark: '#f6f4ff',
      use: '主按钮文字与图标',
    },
    {
      name: '强调',
      token: '--ui-accent',
      light: '#6b79ff',
      dark: '#5658ff',
      use: '链接、进度条起点、强调图标',
    },
  ];

  readonly semantics: ThemeRow[] = [
    {
      name: '危险',
      token: '--ui-error',
      light: '#b95e4e（赭石）',
      dark: '#b95e4e（赭石）',
      use: '删除、停止、错误边框与图标',
    },
    {
      name: '警告',
      token: '--warn',
      light: '蜜桃 50% + 文字',
      dark: '蜜桃 50% + 文字',
      use: '降级、待确认、非阻断提醒',
    },
    {
      name: '成功',
      token: '--ok',
      light: '薄荷 45% + 文字',
      dark: '薄荷 45% + 文字',
      use: '已完成、已安装、通路正常',
    },
  ];

  readonly swatches = [
    { token: '--ui-bg' },
    { token: '--ui-surface' },
    { token: '--ui-raised' },
    { token: '--ui-inset' },
    { token: '--ui-text' },
    { token: '--ui-muted' },
    { token: '--ui-border' },
    { token: '--ui-accent' },
    { token: '--ui-primary' },
    { token: '--ui-error' },
    { token: '--warn' },
    { token: '--ok' },
  ];
}
