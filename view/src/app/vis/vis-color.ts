import { TableComponent } from '../ui/table';
import { Component, computed, inject } from '@angular/core';
import { ThemeService } from '../core/theme.service';
import { AURORA_COLORS, COLOR_ROLES, INK_COLORS } from './visual-data';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

@Component({
  selector: 'app-vis-color',
  standalone: true,
  imports: [SectionBlockComponent, TableComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page title="色彩">
      <div class="layout-split">
        <ui-section title="{{ themeName() }}" pill="{{ themeLabel() }}">
            <div class="color-list">
              @for (c of colors(); track c.token) {
                <article class="color-row">
                  <div class="color-card inner-card" [style.background]="c.hex">
                    <span
                      class="color-rgb-badge"
                      [class.on-light]="badgeTone(c.hex) === 'on-light'"
                      [class.on-dark]="badgeTone(c.hex) === 'on-dark'"
                    >{{ rgb(c.hex) }}</span>
                  </div>
                  <div class="color-meta">
                    <b>{{ c.name }}</b>
                    <span>{{ c.role }}</span>
                    <div class="color-tokens">
                      <code class="token-badge">{{ c.token }}</code>
                      <span class="token-badge">{{ c.hex }}</span>
                    </div>
                  </div>
                </article>
              }
            </div>
          </ui-section>

        <ui-section title="角色" pill="Roles">
            <ui-table>
<table class="color-roles">
                  <thead>
                    <tr>
                      <th>角色</th>
                      <th>{{ themeName() }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of colorRoles; track r.role) {
                      <tr><td>{{ r.role }}</td><td>{{ isDark() ? r.aurora : r.ink }}</td></tr>
                    }
                  </tbody>
                </table>
</ui-table>

            <div class="color-rules-block">
              <h3 class="rules-title">规则 <span>Rules</span></h3>
              <ul class="color-rules">
                @if (isDark()) {
                  <li><b>深色：</b>极光底铺页面，深海军蓝做玻璃面板；极光蓝只给主操作/选中，品红与薄荷只做氛围和辅助强调，不做正文、不做危险。</li>
                } @else {
                  <li><b>浅色：</b>晨雾底铺页面，玻璃白面板承载内容；墨紫做正文与主操作，雾紫做次级文字，赭石只做危险与少量强调；蜜桃 / 紫雾 / 薄荷只做页面光晕。</li>
                }
                <li><b>危险：</b>两套主题都用赭石，不让品红或蜜桃承担错误语义。</li>
                <li><b>对比度：</b>浅色墨紫 / 玻璃白、深色雪青 / 极光底承载正文；雾紫与玻璃边框不承载正文。</li>
              </ul>
            </div>
          </ui-section>
      </div>
    </app-visual-page>
  `,
})
export class VisColorComponent {
  private readonly theme = inject(ThemeService);
  readonly isDark = computed(() => this.theme.theme() === 'dark');
  readonly themeName = computed(() => (this.isDark() ? '极光视界' : '晨雾朦胧'));
  readonly themeLabel = computed(() => (this.isDark() ? 'Aurora UI' : 'Glass'));
  readonly colors = computed(() => (this.isDark() ? this.auroraColors : this.inkColors));

  readonly inkColors = INK_COLORS;
  readonly auroraColors = AURORA_COLORS;
  readonly colorRoles = COLOR_ROLES;

  rgb(hex: string): string {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return `RGB ${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
  }

  badgeTone(hex: string): 'on-light' | 'on-dark' {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return r * 0.299 + g * 0.587 + b * 0.114 > 148 ? 'on-light' : 'on-dark';
  }
}
