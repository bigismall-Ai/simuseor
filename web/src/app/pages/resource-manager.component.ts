import { Component } from '@angular/core';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/**
 * 资源管理器（占位）。
 *
 * 最终形态是本地文件管理器：浏览 workspace 下的模型、工作流、自定义节点、
 * 输入输出目录，看占用并处理可清理项。交互原型在 Angular
 * `/vis/prototypes/resource-manager`，评审通过后接入真实目录 API。
 */
@Component({
  selector: 'app-resource-manager',
  standalone: true,
  imports: [EmptyComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      kicker="Assets · Resources"
      title="资源管理器"
      hint="按目录浏览本机的模型、工作流与节点文件，查看占用并处理可清理项。"
    />

    <ui-panel>
      <ui-empty
        title="资源管理器正在重构"
        hint="本地文件管理器原型在 /vis/prototypes/resource-manager。确认后接入真实目录与占用统计。"
      />
    </ui-panel>
  `,
})
export class ResourceManagerComponent {}
