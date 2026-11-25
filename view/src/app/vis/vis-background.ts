import { Component, computed, inject } from '@angular/core';
import { ThemeService } from '../core/theme.service';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';
import { RulesComponent } from '../ui/rules';
import { ListCardComponent } from '../ui/list-card';

interface Layer {
  token: string;
  name: string;
  hex: string;
  use: string;
}

/** 背景层：浅色与深色的页面 / 侧栏 / 面板 / 卡片 / 内嵌 / 浮层。 */
@Component({
  selector: 'app-vis-background',
  standalone: true,
  imports: [
    ListCardComponent,
    RulesComponent,
    TextComponent,SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="背景"
      hint="背景不是一种颜色，而是从页面、侧栏到面板、卡片与浮层的多层表面。"
    >
      <ui-section title="body 背景" pill="Page">
          <ui-text variant="hint">
            <code>html</code> 保持透明，避免双层底色叠色；<code>body</code> 同时承担底色与光晕，
            光晕固定，不随内容滚动。
          </ui-text>
          <pre class="code-block"><code>{{ bodyCss }}</code></pre>
          <div class="body-preview" aria-label="body 背景预览"></div>
        </ui-section>

      <ui-section title="当前背景层" pill="Surface">
          <div class="bg-grid single">
            <ui-list-card class="bg-list-card">
              <div class="bg-list-head">
                <b>{{ isDark() ? '极光视界' : '晨雾朦胧' }}</b>
                <span>{{ isDark() ? 'Aurora UI' : 'Glass' }}</span>
              </div>
              @for (layer of layers(); track layer.token) {
                <div class="bg-layer">
                  <span
                    class="bg-swatch"
                    [style.background]="'var(' + layer.token + ')'"
                    aria-hidden="true"
                  ></span>
                  <div class="bg-meta">
                    <b>{{ layer.name }}</b>
                    <small>{{ layer.token }}</small>
                  </div>
                  <span class="bg-use">{{ layer.use }}</span>
                  <code>≈ {{ layer.hex }}</code>
                </div>
              }
            </ui-list-card>
          </div>
        </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
          <ui-rules>
            <li><b>body 背景</b>只铺一次：<code>body</code> 用 <code>--ui-bg</code> 打底、<code>--ui-glow</code> 叠光晕，<code>html</code> 保持透明；浅色是晨雾 <code>#E5E1FF</code> 加桃 / 紫 / 薄荷三团柔光，深色是极光底加蓝 / 品红 / 薄荷光带。</li>
            <li><b>侧栏 / 顶栏</b>用 rail：浅色是 42% 玻璃白，深色是深海军蓝；都配 <code>backdrop-filter</code>。</li>
            <li><b>面板</b>用 surface；<b>卡片与浮层</b>用 raised；<b>表头、输入框、代码块</b>用 inset。</li>
            <li>浅色面板是半透明的，必须叠在彩色底上才有“玻璃”质感；不要给单个面板铺实心纸色。</li>
            <li>不用纯白 <code>#FFF</code> 或纯黑 <code>#000</code>；浅色文字用墨紫 <code>#242143</code>，深色文字用雪青 <code>#F6F4FF</code>。</li>
            <li>分隔只靠 1px 玻璃边或一档色差，不用大面积阴影填缝。</li>
          </ui-rules>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisBackgroundComponent {
  private readonly theme = inject(ThemeService);

  readonly bodyCss = `html {
  background: transparent;
}

body {
  background-color: var(--ui-bg);
  background-image: var(--ui-glow);
  background-attachment: fixed;
}`;
  readonly isDark = computed(() => this.theme.theme() === 'dark');

  readonly inkLayers: Layer[] = [
    { token: '--ui-bg', name: 'body 背景', hex: '#E5E1FF', use: 'body 底色 + 光晕' },
    { token: '--ui-rail', name: '玻璃侧栏', hex: '#F0EEFF', use: '导航 / 顶栏' },
    { token: '--ui-surface', name: '玻璃面板', hex: '#F0EEFF', use: 'panel / 卡片组' },
    { token: '--ui-raised', name: '较实玻璃', hex: '#F5F4FF', use: '资产卡 / 浮层' },
    { token: '--ui-inset', name: '墨紫内嵌', hex: '#D9D5F4', use: '表头 / 输入 / 代码' },
    { token: '--ui-overlay', name: '浮层', hex: '#FBFAFF', use: 'dialog / menu' },
  ];

  readonly auroraLayers: Layer[] = [
    { token: '--ui-bg', name: 'body 背景', hex: '#0E1026', use: 'body 底色 + 光晕' },
    { token: '--ui-rail', name: '侧栏', hex: '#10122E', use: '导航 / 顶栏' },
    { token: '--ui-surface', name: '面板', hex: '#10132F', use: 'panel / 卡片组' },
    { token: '--ui-raised', name: '卡片', hex: '#181C38', use: '资产卡 / 浮层' },
    { token: '--ui-inset', name: '内嵌', hex: '#090B1F', use: '表头 / 输入 / 代码' },
    { token: '--ui-overlay', name: '浮层', hex: '#171B36', use: 'dialog / menu' },
  ];

  readonly layers = computed(() => (this.isDark() ? this.auroraLayers : this.inkLayers));
}
