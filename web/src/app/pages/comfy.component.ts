import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

@Component({
  selector: 'app-comfy',
  standalone: true,
  imports: [CommonModule, BadgeComponent, EmptyComponent, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      title="环境管理"
      hint="ComfyUI 环境独立安装在工作区，与后端 Python 环境完全隔离；模型仍挂载「模型库」的保存路径，不重复占用磁盘。"
    />

    <ui-panel title="ComfyUI" hint="安装、启动与目录入口统一在这里管理。">
      <div panel-actions>
        <ui-badge tone="gray">未安装</ui-badge>
      </div>
      <div class="toolbar">
        <button disabled>安装</button>
        <button disabled>启动</button>
        <button disabled>打开目录</button>
      </div>
    </ui-panel>

    <ui-panel title="设备" hint="安装前检测显卡、驱动、显存与 Python，据此决定装哪个加速版本。">
      <div class="form-grid">
        @for (item of deviceRows; track item.label) {
          <ui-field [label]="item.label">
            <span class="mono muted">{{ item.value }}</span>
          </ui-field>
        }
      </div>
      <div class="notice">检测接口尚未接入（GET /api/comfy/probe）。</div>
    </ui-panel>

    <ui-panel title="版本" hint="代码来源为 CNB 镜像，按标签检出；每个版本独立环境，可随时回滚。">
      <ui-empty title="还没有安装任何版本" />
    </ui-panel>
  `,
})
export class ComfyComponent {
  readonly deviceRows = [
    { label: '显卡', value: '待检测' },
    { label: '驱动版本', value: '待检测' },
    { label: '显存', value: '待检测' },
    { label: 'Python', value: '待检测' },
    { label: '磁盘可用', value: '待检测' },
  ];
}
