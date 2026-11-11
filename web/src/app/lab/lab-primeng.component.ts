import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { fmtNum, fmtSize } from '../core/types';
import { CoverPlateComponent } from './cover-plate.component';
import { LAB_FILES, LAB_MODELS, LabFile, LabModel } from './fixtures';

/**
 * 对照实验 A：模型发现页，全部组件交互交给 PrimeNG 19，只写布局。
 * 目的：看「组件体系接管视觉」之后，观感的一致性和厚度能到什么水平。
 */
@Component({
  selector: 'app-lab-primeng',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    InputTextModule,
    SelectButtonModule,
    TableModule,
    TagModule,
    CoverPlateComponent,
  ],
  template: `
    <header class="lab-head">
      <div>
        <p class="lab-kicker">对照实验 A</p>
        <h1>模型发现 <span class="lab-chip">PrimeNG 19</span></h1>
        <p class="lab-lede">
          所有按钮、标签、表格、弹层、分段控件都由组件库提供，页面只写栅格。
          封面不再按 id 哈希取色，而是按家族表解析 name / tags，生成「家族色相 + 品牌槽位 + 家族码 + 形态角标」。
        </p>
      </div>
      <a class="lab-switch" routerLink="/lab/tailwind">切换到 Tailwind 版 →</a>
    </header>

    <section class="lab-bar">
      <input pInputText [(ngModel)]="q" placeholder="搜索模型 / 作者 / 标签" class="lab-search" />
      <p-selectbutton
        [options]="sourceOptions"
        [(ngModel)]="source"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
      />
      <span class="lab-grow"></span>
      <p-button label="搜索" icon="pi pi-search" (onClick)="noop()" />
    </section>

    <div class="lab-grid">
      @for (m of items; track m.id) {
        <article class="lab-card">
          <app-cover-plate [model]="m" />

          <div class="lab-body">
            <h2 class="lab-name">{{ m.name }}</h2>
            <p class="lab-meta">{{ m.author }} · {{ m.size }} · {{ fmtNum(m.downloads) }} 下载</p>

            <div class="lab-tags">
              <p-tag [value]="m.source" severity="secondary" />
              <p-tag [value]="m.fileType" [severity]="m.fileType === 'gguf' ? 'success' : 'info'" />
            </div>

            <div class="lab-actions">
              <p-button label="下载" size="small" (onClick)="open(m)" />
              <p-button label="详情" size="small" [text]="true" severity="secondary" />
            </div>
          </div>
        </article>
      }
    </div>

    <p-dialog
      [(visible)]="dlg"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '680px' }"
      [header]="selected?.name || '选择文件'"
    >
      <p class="lab-dlg-hint">
        {{ selected?.source }} · {{ selected?.author }} · 勾选要下载的文件
      </p>

      <p-table [value]="files" dataKey="path" [tableStyle]="{ width: '100%' }">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 3rem"></th>
            <th>文件</th>
            <th style="width: 7rem; text-align: right">大小</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-f>
          <tr>
            <td><p-checkbox [(ngModel)]="f.picked" [binary]="true" /></td>
            <td class="lab-file">{{ f.path }}</td>
            <td class="lab-size">{{ fmtSize(f.size) }}</td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template pTemplate="footer">
        <p-button label="取消" [text]="true" severity="secondary" (onClick)="dlg = false" />
        <p-button [label]="'下载所选（' + pickedCount() + '）'" (onClick)="dlg = false" />
      </ng-template>
    </p-dialog>

    <p class="lab-foot">
      封面只读三个稳定字段：tags 定家族色相（9 桶）、name 的变体段定字牌、扩展名与量化标记定角标。
      下载量与更新时间刻意不参与——它们会变，封面一变，识别价值就归零。
    </p>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .lab-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 18px;
      }
      .lab-kicker {
        margin: 0 0 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.6px;
        color: var(--muted);
      }
      .lab-head h1 {
        margin: 0;
        font-size: 21px;
        font-weight: 650;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .lab-chip {
        font: 500 11px/1 ui-monospace, monospace;
        padding: 3px 7px;
        border-radius: 5px;
        background: #eef2ff;
        color: #4338ca;
      }
      .lab-lede {
        margin: 5px 0 0;
        font-size: 12.5px;
        color: var(--muted);
        max-width: 62ch;
      }
      .lab-switch {
        font-size: 12.5px;
        color: var(--accent);
        text-decoration: none;
        white-space: nowrap;
      }
      .lab-switch:hover {
        text-decoration: underline;
      }

      .lab-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px;
        margin-bottom: 16px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
      }
      .lab-grow {
        flex: 1;
      }
      :host ::ng-deep .lab-search {
        width: 280px;
      }
      /* 分段控件默认会占满弹性容器，收紧到内容宽度；高度与输入框对齐 */
      :host ::ng-deep .p-selectbutton {
        width: auto;
        flex: none;
      }
      :host ::ng-deep .p-selectbutton .p-togglebutton {
        flex: 0 0 auto;
      }
      :host ::ng-deep .p-inputtext {
        height: 2.25rem;
      }

      .lab-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
        gap: 14px;
      }
      .lab-card {
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
      }
      .lab-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        padding: 12px 14px 14px;
      }
      .lab-name {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .lab-meta {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .lab-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .lab-actions {
        display: flex;
        gap: 8px;
        margin-top: auto;
        padding-top: 8px;
      }

      .lab-dlg-hint {
        margin: 0 0 10px;
        font-size: 12.5px;
        color: var(--muted);
      }
      .lab-file {
        font-family: ui-monospace, monospace;
        font-size: 12px;
        word-break: break-all;
      }
      .lab-size {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .lab-foot {
        margin: 18px 0 0;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--muted);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 10px;
      }
    `,
  ],
})
export class LabPrimeNgComponent {
  readonly models = LAB_MODELS;
  readonly files: LabFile[] = LAB_FILES.map((f) => ({ ...f }));

  q = '';
  source = '';
  dlg = false;
  selected: LabModel | null = null;

  readonly sourceOptions = [
    { label: '全部来源', value: '' },
    { label: 'Hugging Face', value: 'huggingface' },
    { label: 'ModelScope', value: 'modelscope' },
    { label: 'Civitai', value: 'civitai' },
  ];

  get items(): LabModel[] {
    const q = this.q.trim().toLowerCase();
    return this.models.filter((m) => {
      if (this.source && !m.source.toLowerCase().replace(' ', '').includes(this.source)) return false;
      if (!q) return true;
      return (m.name + m.author + m.tags.join(' ')).toLowerCase().includes(q);
    });
  }

  readonly fmtNum = fmtNum;
  readonly fmtSize = fmtSize;

  pickedCount(): number {
    return this.files.filter((f) => f.picked).length;
  }

  open(m: LabModel): void {
    this.selected = m;
    this.dlg = true;
  }

  noop(): void {
    /* 实验页不接后端 */
  }
}
