import { Component } from '@angular/core';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 圆角（/vis/visual/radius）：12 / 8 / 5 三档，附三档阴影。 */
@Component({
  selector: 'app-visual-radius',
  standalone: true,
  imports: [PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="圆角"
      hint="面板 / 卡片用 12，按钮 / 输入 / 导航项用 8，chip / badge / 骨架用 5。"
    >
      <ui-panel kicker="Layout" title="圆角 / 阴影">
        <h3 class="vis-sub">圆角三档（§6.2）</h3>
        <div class="vis-radios">
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius)">12px</div>
            <span>面板、模型卡、任务条</span>
          </div>
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius-sm)">8px</div>
            <span>按钮、输入、导航项</span>
          </div>
          <div class="vis-radio">
            <div class="vis-radio-box" style="border-radius:var(--radius-xs)">5px</div>
            <span>chip、badge、骨架</span>
          </div>
        </div>

        <h3 class="vis-sub">阴影三档（§6.3）</h3>
        <div class="vis-shadows">
          <div class="vis-shadow" style="box-shadow:var(--shadow-sm)"><span>--shadow-sm</span></div>
          <div class="vis-shadow" style="box-shadow:var(--shadow-md)"><span>--shadow-md</span></div>
          <div class="vis-shadow" style="box-shadow:var(--shadow-lg)"><span>--shadow-lg</span></div>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualRadiusComponent {}
