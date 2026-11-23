import { Component } from '@angular/core';
import { APP_ICONS, ICON_GROUPS } from '../ui/icons';
import { UiMaterialModule } from '../ui/material';
import { VisualPageComponent } from './visual-page';
import { SectionBlockComponent } from '../ui/section-block';

/** 图标：项目自有 24px 描边图标集与 MatIcon 使用方式。 */
@Component({
  selector: 'app-vis-icons',
  standalone: true,
  imports: [UiMaterialModule, SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page title="图标">
      <ui-section title="图标集" [pill]="iconCount + ' 个'">
          @for (group of groups; track group.title) {
            <h3 class="icon-group-title">{{ group.title }}</h3>
            <div class="icon-grid">
              @for (icon of group.icons; track icon.name) {
                <div class="icon-cell">
                  <mat-icon [svgIcon]="'app:' + icon.name"></mat-icon>
                  <span>{{ icon.label }}</span>
                  <code>{{ icon.name }}</code>
                </div>
              }
            </div>
          }
      </ui-section>

      <div class="icon-spec-grid">
        <ui-section title="尺寸" pill="Size">
            <div class="icon-size-row">
              @for (size of sizes; track size) {
                <div class="icon-size">
                  <mat-icon [class]="'icon-' + size" svgIcon="app:download"></mat-icon>
                  <b>{{ size }}</b>
                  <small>{{ sizeHint(size) }}</small>
                </div>
              }
            </div>
        </ui-section>

        <ui-section title="颜色" pill="Color">
            <div class="icon-color-row">
              <div class="icon-color">
                <mat-icon svgIcon="app:check-circle"></mat-icon>
                <span>默认</span>
              </div>
              <div class="icon-color muted">
                <mat-icon svgIcon="app:clock"></mat-icon>
                <span>次级</span>
              </div>
              <div class="icon-color accent">
                <mat-icon svgIcon="app:star"></mat-icon>
                <span>强调</span>
              </div>
              <div class="icon-color danger">
                <mat-icon svgIcon="app:alert"></mat-icon>
                <span>危险</span>
              </div>
            </div>
        </ui-section>
      </div>

      <ui-section title="规范与用法" pill="Usage" [plain]="true">
          <div class="notes-stack">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">项目</th>
                    <th scope="col">规范</th>
                  </tr>
                </thead>
                <tbody>
                  @for (rule of rules; track rule.name) {
                    <tr>
                      <td>{{ rule.name }}</td>
                      <td>{{ rule.text }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <pre class="code-block"><code>{{ usage }}</code></pre>
            <p class="hint">
              装饰性图标加 <code>aria-hidden="true"</code>；有语义的图标放进可访问名明确的按钮，
              图标本身不再重复播报。
            </p>
          </div>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisIconsComponent {
  readonly groups = ICON_GROUPS;
  readonly iconCount = APP_ICONS.length;
  readonly sizes = [16, 20, 24, 32, 48];

  readonly rules = [
    { name: '网格', text: '24 × 24，视觉安全区 2px' },
    { name: '描边', text: '1.6px，端点与转角都用 round' },
    { name: '风格', text: '不混用填充图标与描边图标' },
    { name: '颜色', text: 'currentColor，不在 SVG 内写死颜色' },
    { name: '尺寸', text: '16 / 20 / 24 / 32 / 48，按 4 的倍数取' },
  ];

  readonly usage = `<mat-icon svgIcon="app:download" aria-hidden="true"></mat-icon>

<button type="button" aria-label="下载">
  <mat-icon svgIcon="app:download"></mat-icon>
</button>`;

  sizeHint(size: number): string {
    if (size <= 16) return '行内 / 紧凑';
    if (size <= 20) return '工具栏';
    if (size <= 24) return '默认';
    return '强调 / 空态';
  }
}
