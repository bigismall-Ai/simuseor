import { Component } from '@angular/core';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 按钮（/vis/visual/buttons）：全部状态与尺寸。 */
@Component({
  selector: 'app-visual-buttons',
  standalone: true,
  imports: [PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page title="按钮" hint="8 态里的默认 / hover / focus-visible / active / disabled / loading / error。">
      <ui-panel kicker="Components" title="按钮 —— 全部状态">
        <p class="vis-hint">
          hover 与 focus 请<b>真的把鼠标移上去 / 用 Tab 键走一遍</b> —— 这一页是真实交互，不是静态样张。<br />
          按钮回归纯色：无渐变、无图案、无外边框；只保留大圆角、实色与阴影。
          目前只作用于本页样张，产品全局尚未切换。
        </p>

        <div class="btn-specimen">
          <div class="vis-row">
            <span class="vis-row-label">默认</span>
            <button type="button">默认</button>
            <button class="primary" type="button">主操作</button>
            <button class="ghost" type="button">文字按钮</button>
            <button class="danger" type="button">危险</button>
          </div>
          <div class="vis-row">
            <span class="vis-row-label">disabled</span>
            <button type="button" disabled>禁用</button>
            <button class="primary" type="button" disabled>主操作</button>
            <button class="ghost" type="button" disabled>文字按钮</button>
          </div>
          <div class="vis-row">
            <span class="vis-row-label">loading</span>
            <button class="primary" type="button" disabled>加载中…</button>
            <button type="button" disabled>处理中…</button>
          </div>
          <div class="vis-row">
            <span class="vis-row-label">error</span>
            <button class="danger" type="button">重试</button>
          </div>
          <div class="vis-row">
            <span class="vis-row-label">尺寸</span>
            <button class="primary" type="button">默认 36px</button>
            <button class="primary btn-xs" type="button">小号 30px</button>
          </div>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualButtonsComponent {}
