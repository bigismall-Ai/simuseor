import { Component } from '@angular/core';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 模态框（/vis/visual/modals）：唯一使用 16px 圆角的弹层。 */
@Component({
  selector: 'app-visual-modals',
  standalone: true,
  imports: [PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page title="模态框" hint="弹层是唯一用 16px 圆角的地方（VIS §6.2 登记例外 1）。">
      <ui-panel kicker="Components" title="弹层（静态样张）">
        <p class="vis-hint">
          弹层是唯一用 16px 圆角的地方（VIS §6.2 登记例外 1）。
          这张是静态样张，不是真的模态 —— 焦点陷阱与 Esc 行为要进产品页验证。
        </p>
        <div class="vis-modal-stage">
          <div class="modal-overlay">
            <div class="modal">
              <div class="modal-head"><span class="mc-title">安装环境</span></div>
              <p style="margin:0 0 12px;font-size:12.5px;color:var(--muted)">
                这是一张静态样张，不是真的模态 —— 弹层的焦点陷阱与 Esc 行为要进产品页验证。
              </p>
              <div class="modal-foot">
                <button class="primary" type="button">开始安装</button>
                <button type="button">取消</button>
              </div>
            </div>
          </div>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualModalsComponent {}
