import { Component } from '@angular/core';
import { EmptyComponent } from '../../ui/empty.component';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 空状态（/vis/visual/empty）：空态 / 加载 / 错误 / 成功 / 提示。 */
@Component({
  selector: 'app-visual-empty',
  standalone: true,
  imports: [EmptyComponent, PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="空状态"
      hint="空态、加载、错误、成功与提示条的统一表达。"
    >
      <ui-panel kicker="Feedback" title="空 / 加载 / 错误">
        <div class="vis-cols">
          <ui-empty
            icon="◍"
            title="还没有模型"
            hint="去「发现」页挑一个，或把文件放进 models/ 目录。"
          >
            <button class="primary btn-xs" type="button">去发现页</button>
          </ui-empty>

          <div class="vis-stack">
            <div class="loading-line"><span class="dot-spin"></span><span>正在读取模型列表…</span></div>
            <div class="progress" style="width:100%"><div style="width:62%"></div></div>
            <div class="notice err">删除失败：目录被占用，关闭占用程序后重试</div>
            <div class="notice ok">已安装到实例 A</div>
            <div class="notice info">下载源已切换到 Hugging Face</div>
          </div>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualEmptyComponent {}
