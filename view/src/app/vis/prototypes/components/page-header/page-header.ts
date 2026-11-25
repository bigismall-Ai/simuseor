import { UiButtonComponent } from '../../../../ui/button';
import { Component, signal } from '@angular/core';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { UiMaterialModule } from '../../../../ui/material';
import { LabelComponent } from '../../../../ui/label';

/**
 * 原型组件：页面页头。
 *
 * 只保留一套分层页头：kicker / 标题 / 一句说明 / 右侧主操作；
 * 视图切换放在标题行，不另起一行工具条。
 */
@Component({
  selector: 'app-proto-page-header',
  standalone: true,
  imports: [
    LabelComponent,
    PageHeaderComponent,
    UiButtonComponent,
    UiMaterialModule,
  ],
  styleUrl: './page-header.scss',
  template: `
    <ui-label>标准页头</ui-label>
    <div class="demo">
      <ui-page-header
        kicker="ASSETS · RESOURCES"
        title="资源管理器"
        hint="按目录查看本机资产的实际落点、占用和可清理项。"
      >
        <ui-button variant="secondary" type="button">在文件中打开</ui-button>
        <ui-button variant="primary" type="button">重新扫描</ui-button>
      </ui-page-header>
      <div class="demo-body" aria-hidden="true"></div>
    </div>

    <ui-label>带视图切换</ui-label>
    <div class="demo">
      <ui-page-header
        kicker="MODELS · LIBRARY"
        title="模型库"
        hint="本地库与发现共用同一套卡片和筛选。"
        [viewOptions]="views"
        [view]="view()"
        (viewChange)="view.set($event)"
      >
        <ui-button variant="secondary" type="button">导入模型</ui-button>
        <ui-button variant="primary" type="button">刷新</ui-button>
      </ui-page-header>
      <div class="demo-body" aria-hidden="true"></div>
    </div>

    <ui-label>无操作页头</ui-label>
    <div class="demo">
      <ui-page-header
        kicker="SETTINGS"
        title="设置"
        hint="外观、路径与运行偏好。"
      />
    </div>

    <ui-label>约束</ui-label>
    <ul class="ph-rules">
      <li><b>四区</b>：kicker、标题（可带 segmented）、一句 hint、右侧主操作。</li>
      <li><b>标题</b> 22px / 600，不用展示型衬线大字；页头不放大。</li>
      <li><b>操作</b>最多一主一次，右对齐；没有操作时整区不占位。</li>
      <li><b>视图切换</b>同排放在标题右侧，不再单独做一条工具条。</li>
    </ul>
  `,
})
export class ProtoPageHeaderComponent {
  readonly view = signal('local');
  readonly views = [
    { key: 'local', label: '本地库' },
    { key: 'discover', label: '发现' },
  ];
}
