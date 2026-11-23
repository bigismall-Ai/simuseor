import { Component } from '@angular/core';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

interface SampleRow {
  name: string;
  source: string;
  size: string;
  status: string;
  tone: string;
}

/** 表格：原生表格的表头 / 行高 / 数字对齐与斑马行。 */
@Component({
  selector: 'app-vis-tables',
  standalone: true,
  imports: [SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="表格"
      hint="列表视图与文件表共用表头、行高与数字对齐；状态列用 badge，不用颜色铺满整行。"
    >
      <ui-section title="表格" pill="Table">
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
                @for (row of rows; track row.name) {
                  <tr>
                    <td>{{ row.name }}</td>
                    <td>{{ row.source }}</td>
                    <td class="col-size mono">{{ row.size }}</td>
                    <td><span class="badge" [class]="'badge ' + row.tone">{{ row.status }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="hint table-note">
            表头铺一档底色、用次级文字；数字列右对齐并走等宽字体；行间用斑马底，不画横线。
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
}
