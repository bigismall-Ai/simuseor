import { Component } from '@angular/core';
import type { BadgeTone } from '../ui/badge';
import { BadgeComponent } from '../ui/badge';
import { ListCardComponent } from '../ui/list-card';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { VisualPageComponent } from './visual-page';

interface SampleRow {
  name: string;
  source: string;
  size: string;
  status: string;
  tone: BadgeTone;
}

interface SampleListRow {
  name: string;
  detail: string;
  size: string;
}

/** 表格与列表：共用 ui-table / ui-list-card 外壳，页面只写列与行。 */
@Component({
  selector: 'app-vis-tables',
  imports: [
    BadgeComponent,
    ListCardComponent,
    SectionBlockComponent,
    TableComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="表格与列表"
      hint="表格与列表共用同一套外壳；表头、行高与数字对齐由 ui-table 统一，状态列用 badge。"
    >
      <ui-section title="表格" pill="ui-table">
        <ui-table>
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
              @for (row of rows; track row.name) {
                <tr>
                  <td>{{ row.name }}</td>
                  <td>{{ row.source }}</td>
                  <td class="col-size mono">{{ row.size }}</td>
                  <td><ui-badge [tone]="row.tone">{{ row.status }}</ui-badge></td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
        <p class="hint table-note">
          表头铺一档底色、用次级文字；数字列右对齐并走等宽字体；行间用斑马底，不画横线。
        </p>
      </ui-section>

      <ui-section title="文档密度" pill="density=docs">
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">读法</th>
                <th scope="col">默认（控制台）</th>
                <th scope="col">docs</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>字号</td>
                <td>11.5px 紧凑</td>
                <td>12.5px 阅读</td>
              </tr>
              <tr>
                <td>表头</td>
                <td>铺一档底色、次级文字</td>
                <td>透明底、正文色</td>
              </tr>
              <tr>
                <td>行分隔</td>
                <td>斑马底</td>
                <td>单条细线</td>
              </tr>
            </tbody>
          </table>
        </ui-table>
        <p class="hint table-note">
          文档页用 <code>density="docs"</code>：单元格上下留足 16px，行间只画一条细线，
          悬停轻微提亮；控制台页面保持默认密度。
        </p>
      </ui-section>

      <ui-section title="列表卡" pill="ui-list-card">
        <ui-list-card>
          @for (row of listRows; track row.name) {
            <div class="demo-row">
              <b>{{ row.name }}</b>
              <span>{{ row.detail }}</span>
              <span class="mono">{{ row.size }}</span>
            </div>
          }
        </ui-list-card>
        <p class="hint table-note">
          不是表格的两三列信息用列表卡，行高与表格一致；需要对齐的数字仍然放最右。
        </p>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisTablesComponent {
  readonly rows: SampleRow[] = [
    { name: 'FLUX.1-dev', source: 'Hugging Face', size: '23.8 GB', status: '已安装', tone: 'green' },
    { name: 'SDXL Base 1.0', source: 'ModelScope', size: '6.9 GB', status: '已在库', tone: 'blue' },
    { name: 'Wan2.2 T2V', source: 'Hugging Face', size: '14.2 GB', status: '未登记', tone: 'gray' },
    { name: 'CogVideoX-5B', source: 'ModelScope', size: '10.4 GB', status: '已禁用', tone: 'orange' },
    { name: 'Qwen-Image-Edit', source: 'Hugging Face', size: '20.1 GB', status: '错误', tone: 'red' },
  ];

  readonly listRows: SampleListRow[] = [
    { name: 'models/diffusion_models', detail: '128 个文件', size: '362.1 GB' },
    { name: 'models/text_encoders', detail: '24 个文件', size: '48.6 GB' },
    { name: 'models/vae', detail: '9 个文件', size: '6.2 GB' },
  ];
}
