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
import { fmtNum, fmtSize } from '../core/types';
import { CoverPlateComponent } from '../ui/cover-plate.component';
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
    CoverPlateComponent,
  ],
  template: `
    <header class="lab-head">
      <div>
        <p class="lab-kicker">对照实验 A</p>
        <h1>模型发现 <span class="lab-chip">PrimeNG 19</span></h1>
        <p class="lab-lede">
          所有按钮、标签、表格、弹层、分段控件都由组件库提供，页面只写栅格。
          封面是一整块背景：有真实缩略图就铺图，没有就按 name / tags 生成构图——
          左上角是厂牌标 + 厂牌名 + 规格，右上角是文件形态，正文压在渐变蒙版上。
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
        <article class="lab-card" [class.on-shot]="!!m.image">
          <app-cover-plate class="lab-plate" [model]="m" />

          <div class="lab-body">
            <h2 class="lab-name">{{ m.name }}</h2>
            <p class="lab-meta">{{ m.source }} · {{ m.author }} · {{ m.size }}</p>

            <div class="lab-actions">
              <p-button label="下载" size="small" (onClick)="open(m)" />
              <p-button label="详情" size="small" [text]="true" severity="secondary" />
              <span class="lab-stat">{{ fmtNum(m.downloads) }} 下载</span>
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
      封面只读稳定字段：tags 定家族色（9 桶）× name 的哈希定构图变体（5 种），两者相乘才够一屏不重样；
      扩展名定形态角标，name 里的参数量与量化定规格。取不到的字段直接不显示，
      也不按家族常见规模估算——估出来的「参数 3B」会跟真实文件对不上号，比留白更糟。
      下载量与更新时间不参与：它们会变，封面一变，识别价值就归零。
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

      /* 卡片不再有「封面 + 正文」两段：铭牌整块铺在卡片下面当背景，
         正文绝对定位不了，靠 margin-top:auto 贴底，卡片高度由内容决定。
         这样卡片高度从 330 上下掉到 200 以内，而且换任何张图都不会塌。 */
      .lab-card {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 198px;
        overflow: hidden;
        border-radius: 12px;
        background: var(--panel);
        transition: box-shadow 0.15s ease;
      }
      .lab-card:hover {
        box-shadow: 0 6px 18px -10px rgb(0 0 0 / 0.35);
      }

      /* 边框改成内描边（::after），不用 border：
         border 画在盒子外侧，背景图只能铺到 padding box，两者之间永远隔着 1px。
         浅色边框压在照片上会被读成「图没贴边」，深色照片上尤其明显。
         内描边落在内容的边缘上、跟着圆角走，图和边才是同一条线。 */
      .lab-card::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--border);
        pointer-events: none;
        z-index: 2;
      }
      .lab-card:hover::after {
        box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border) 40%, var(--accent));
      }
      /* 照片卡片的描边换成半透明黑：浅灰压在图上像没对齐，黑边才像照片自己的边 */
      .lab-card.on-shot::after {
        box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.16);
      }
      .lab-card.on-shot:hover::after {
        box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.28);
      }
      .lab-plate {
        position: absolute;
        inset: 0;
        border-radius: inherit;
      }

      .lab-body {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: auto;
        /* 顶部 44px 是留给铭牌那一行厂牌名 + 形态角标的，正文永不压上去 */
        padding: 44px 14px 13px;
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* 有封面的卡片：正文翻白。铭牌已经把 --plate-* 换成白色一组，
         正文在卡片作用域里，所以这里也得跟着翻一遍。
         再加一道极轻的投影：蒙版是渐变，遇到高调照片（大面积亮背景）压不住，
         而投影只影响 1-2px 的笔画边缘，不改变整体明度。 */
      .lab-card.on-shot .lab-name {
        color: #fff;
        text-shadow: 0 1px 3px rgb(0 0 0 / 0.55);
      }
      .lab-card.on-shot .lab-meta {
        color: rgb(255 255 255 / 0.8);
        text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
      }
      :host ::ng-deep .lab-card.on-shot .p-button-text.p-button-secondary {
        color: #fff;
      }
      :host ::ng-deep .lab-card.on-shot .p-button-text.p-button-secondary:hover {
        background: rgb(255 255 255 / 0.14);
        color: #fff;
      }

      .lab-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 3px;
      }
      /* 下载量挪到按钮行右端：meta 行再加一项就必然截断，而这一行右侧本来就是空的 */
      .lab-stat {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .lab-card.on-shot .lab-stat {
        color: rgb(255 255 255 / 0.7);
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
