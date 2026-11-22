import { Component } from '@angular/core';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/**
 * 标识（/vis/visual/brand）。
 *
 * 口径：VIS §2.0 —— 蝉形是辅助图形，只出现在 favicon 与侧栏组合标两处；
 * 页头 / 空状态 / 弹层 / 错误态都不许进。
 */
@Component({
  selector: 'app-visual-brand',
  standalone: true,
  imports: [PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="标识"
      hint="字标是主视觉，蝉形是辅助图形；蝉形只在 favicon 与侧栏组合标出现。"
    >
      <ui-panel kicker="Brand" title="组合标">
        <p class="vis-hint">
          VIS §2.0：蝉形是<b>辅助图形</b>，只出现在 favicon 与侧栏组合标两处 ——
          页头 / 空状态 / 弹层 / 错误态都不许进。
        </p>
        <div class="vis-brand">
          <span class="brand-mark" aria-hidden="true">
            <img class="logo-light" src="/brand/cicada-max.svg" alt="" />
            <img class="logo-dark" src="/brand/cicada-max-dark.svg" alt="" />
          </span>
          <span class="lv-wordmark">
            SiMuseor
            <small class="lv-sub">剧集导演台</small>
          </span>
        </div>
        <div class="vis-fav">
          <img src="/brand/png/favicon-16.png" alt="favicon 16px" width="16" height="16" />
          <img src="/brand/png/favicon-32.png" alt="favicon 32px" width="32" height="32" />
          <img src="/brand/png/favicon-48.png" alt="favicon 48px" width="48" height="48" />
          <img src="/brand/png/favicon-64.png" alt="favicon 64px" width="64" height="64" />
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualBrandComponent {}
