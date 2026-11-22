import { Component } from '@angular/core';
import { BadgeComponent } from '../../ui/badge.component';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 表格（/vis/visual/tables）：列表视图与文件表共用。 */
@Component({
  selector: 'app-visual-tables',
  standalone: true,
  imports: [BadgeComponent, PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page title="表格" hint="列表视图与文件表共用一套表头 / 行高 / 数字对齐。">
      <ui-panel kicker="Components" title="表格">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">模型</th>
                <th scope="col">来源</th>
                <th scope="col" class="col-size">大小</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="cell-name">flux1-dev.safetensors</td>
                <td>Hugging Face</td>
                <td class="col-size">11.9 GB</td>
                <td><ui-badge tone="green">已安装</ui-badge></td>
              </tr>
              <tr>
                <td class="cell-name">wan22-t2v.safetensors</td>
                <td>ModelScope</td>
                <td class="col-size">24.5 GB</td>
                <td><ui-badge tone="gray">未登记</ui-badge></td>
              </tr>
              <tr>
                <td class="cell-name">sd15-pruned.safetensors</td>
                <td>Civitai</td>
                <td class="col-size">4.1 GB</td>
                <td><ui-badge tone="orange">已禁用</ui-badge></td>
              </tr>
            </tbody>
          </table>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualTablesComponent {}
