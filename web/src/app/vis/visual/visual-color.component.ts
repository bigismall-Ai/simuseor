import { Component } from '@angular/core';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';
import { AURORA_COLORS, COLOR_ROLES, INK_COLORS } from './visual-data';

/** 色彩（/vis/visual/color）：浅色水墨留白 / 深色极光界面两套色板。 */
@Component({
  selector: 'app-visual-color',
  standalone: true,
  imports: [PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="色彩"
      hint="两套主题只做「底色 / 面板 / 文字 / 主操作 / 危险 / 强调」六类角色。"
    >
      <ui-panel kicker="Foundations" title="水墨留白 / 极光界面">
        <p class="vis-hint">
          强调色只给可点、选中与进度，不铺大面积；两套主题不混用。
        </p>

        <div class="color-grid">
          <section class="color-theme ink">
            <header>
              <b>浅色 · 水墨留白</b>
              <span>Ink Wash</span>
            </header>
            <div class="swatches">
              @for (c of inkColors; track c.token) {
                <div class="swatch-card">
                  <span class="swatch" [style.background]="c.hex" [style.color]="c.text">{{ c.hex }}</span>
                  <b>{{ c.name }}</b>
                  <small>{{ c.role }}</small>
                </div>
              }
            </div>
          </section>

          <section class="color-theme aurora">
            <header>
              <b>深色 · 极光界面</b>
              <span>Aurora UI</span>
            </header>
            <div class="swatches">
              @for (c of auroraColors; track c.token) {
                <div class="swatch-card">
                  <span class="swatch" [style.background]="c.hex" [style.color]="c.text">{{ c.hex }}</span>
                  <b>{{ c.name }}</b>
                  <small>{{ c.role }}</small>
                </div>
              }
            </div>
          </section>
        </div>

        <table class="color-roles">
          <thead>
            <tr><th>角色</th><th>浅色 · 水墨留白</th><th>深色 · 极光界面</th></tr>
          </thead>
          <tbody>
            @for (r of colorRoles; track r.role) {
              <tr><td>{{ r.role }}</td><td>{{ r.ink }}</td><td>{{ r.aurora }}</td></tr>
            }
          </tbody>
        </table>

        <ul class="color-rules">
          <li><b>浅色：</b>宣纸做页面底，墨做正文与主操作；苔只做次级文字，石灰只做分隔/边框，赭石只做危险与少量强调。</li>
          <li><b>深色：</b>极光底做页面底，深海军蓝做面板；极光蓝只给主操作/选中，品红与薄荷只做氛围和辅助强调，不做正文、不做危险。</li>
          <li><b>危险：</b>两套主题都用赭石，不让品红承担错误语义。</li>
          <li><b>对比度：</b>浅色墨/纸、深色雪青/极光底承载正文；苔色与石灰不承载正文。</li>
        </ul>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualColorComponent {
  readonly inkColors = INK_COLORS;
  readonly auroraColors = AURORA_COLORS;
  readonly colorRoles = COLOR_ROLES;
}
