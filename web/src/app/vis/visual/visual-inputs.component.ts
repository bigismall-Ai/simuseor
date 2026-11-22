import { Component } from '@angular/core';
import { FieldComponent } from '../../ui/field.component';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 输入框（/vis/visual/inputs）：默认 / 有值 / 只读 / 禁用 / 单选框。 */
@Component({
  selector: 'app-visual-inputs',
  standalone: true,
  imports: [FieldComponent, PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="输入框"
      hint="单控件用全局 input；图标 + 输入 + 清除这类复合壳，焦点环画在整只壳上。"
    >
      <ui-panel kicker="Components" title="输入框 —— 全部状态">
        <div class="vis-row">
          <span class="vis-row-label">默认</span>
          <ui-field label="下载源">
            <input type="text" placeholder="搜索模型关键词，如 qwen / lora / flux" />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">有值</span>
          <ui-field label="模型名">
            <input type="text" value="flux1-dev" />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">readonly</span>
          <ui-field label="已安装路径">
            <input type="text" value="/models/flux1-dev.safetensors" readonly />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">disabled</span>
          <ui-field label="环境名">
            <input type="text" value="默认实例" disabled />
          </ui-field>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">单选块</span>
          <label class="radio-row"><input type="radio" name="vis-radio" checked /><span>已选中</span></label>
          <label class="radio-row"><input type="radio" name="vis-radio" /><span>未选中</span></label>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualInputsComponent {}
