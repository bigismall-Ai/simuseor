import { Component, input } from '@angular/core';

/**
 * 页面内容容器：只负责宽度与留白，不画表面、不排版文字。
 *
 * 三件事：
 *   - 宽度：默认 `--layout-content-max` 居中；`wide` 放开到 100%（全幅表格 / 多栏工作台）。
 *   - 留白：左右 `gutter`（默认 `--layout-gutter`），上下 `--layout-top` / `--layout-bottom`；
 *     需要贴边时用 `flushTop` / `flushBottom` 单独关掉。
 *   - 页前槽：`[page-head]` 放面包屑、返回行这类窄条，**不放页头**——
 *     标题与主操作仍由 `ui-page-header` 负责，两者不重叠。
 *
 * 与 VIS 外壳的 `.page-shell` 区别：那是设计区自己的布局；产品页用这个组件，
 * 几何全部来自 `--layout-*` token，页面不再各写一套 padding。
 */
@Component({
  selector: 'ui-page',
  template: `
    <div
      class="page"
      [class.wide]="wide()"
      [class.flush-top]="flushTop()"
      [class.flush-bottom]="flushBottom()"
      [style.--page-gutter]="gutter()"
    >
      <div class="page-head">
        <ng-content select="[page-head]" />
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .page {
      width: 100%;
      max-width: var(--layout-content-max);
      margin: 0 auto;
      padding:
        var(--layout-top)
        var(--page-gutter, var(--layout-gutter))
        var(--layout-bottom);
    }

    .page.wide {
      max-width: none;
    }

    .page.flush-top {
      padding-top: 0;
    }

    .page.flush-bottom {
      padding-bottom: 0;
    }

    .page-head {
      margin-bottom: var(--ui-space-4);
    }

    /* 页前槽为空时不占位（含空白文本节点的情况） */
    .page-head:empty,
    .page-head:not(:has(*)) {
      display: none;
    }
  `,
})
export class PageComponent {
  /** 放开最大宽，铺满可用宽度（全幅表格、多栏工作台） */
  readonly wide = input(false);
  /** 左右留白；默认读 `--layout-gutter`，需要时传具体 token */
  readonly gutter = input('var(--layout-gutter)');
  /** 顶部不留白：内容自带吸顶条或整幅画布时用 */
  readonly flushTop = input(false);
  /** 底部不留白：后面紧跟页脚 / 固定操作栏时用 */
  readonly flushBottom = input(false);
}
