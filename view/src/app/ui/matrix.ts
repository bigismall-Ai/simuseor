import { Component, input } from '@angular/core';

/**
 * 矩阵布局：一行列标题 + 每行左侧行标题 + 内容格。
 *
 * 卡片矩阵、对照表都用它，页面不再自己写 44px 标签列与 grid 模板。
 * 行标题由组件生成并显式落在第一列；投影进来的格子（建议外层包一个
 * `[matrix-cell]` 元素）自动排进第 2 列起的剩余位置。
 */
@Component({
  selector: 'ui-matrix',
  template: `
    <div
      class="matrix"
      [style.grid-template-columns]="
        '44px repeat(' + columns().length + ', minmax(var(--layout-grid-min), var(--card-max)))'
      "
    >
      <span class="m-corner" aria-hidden="true"></span>
      @for (column of columns(); track column) {
        <span class="m-col">{{ column }}</span>
      }
      @for (row of rows(); track row; let i = $index) {
        <span class="m-row" [style.grid-row]="i + 2">{{ row }}</span>
      }
      <div class="m-cells">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .matrix {
      display: grid;
      gap: 14px 18px;
      justify-content: start;
      align-items: start;
    }

    .m-corner,
    .m-col,
    .m-row {
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      font-weight: 600;
    }

    .m-col {
      padding-top: 2px;
    }

    .m-row {
      padding-top: 12px;
    }

    /* 让投影进来的格子直接参与外层网格，不额外多一层 */
    .m-cells {
      display: contents;
    }
  `,
})
export class MatrixComponent {
  /** 列标题，数量决定网格列数 */
  readonly columns = input.required<string[]>();
  /** 行标题，渲染在第一列并与内容格对齐 */
  readonly rows = input.required<string[]>();
}
