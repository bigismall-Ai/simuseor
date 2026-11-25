import { Component, input, output } from '@angular/core';
import { ModelCardComponent } from './model-card';
import type { LibraryModel } from '../core/types';

/**
 * @deprecated 兼容别名：本地库卡片已并入 `md-model-card`（`mode="library"`）。
 *
 * 保留这个选择器只有一个原因：已有 E2E 与外部调用点按 `md-library-card` 命中
 * 本地库卡片。新代码一律写 `<md-model-card mode="library" [item]="…" />`；
 * 本组件只做透传，不持有自己的模板、样式与口径 —— 调用点全部迁移后可整块删除。
 */
@Component({
  selector: 'md-library-card',
  imports: [ModelCardComponent],
  template: `
    <md-model-card
      mode="library"
      [item]="model()"
      [cover]="cover()"
      [vramGb]="vramGb()"
      (remove)="remove.emit()"
      (use)="use.emit()"
      (redownload)="redownload.emit()"
      (open)="open.emit()"
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class LibraryCardComponent {
  readonly model = input.required<LibraryModel>();
  /** 后端解析出的真实封面；取不到就退回家族色构图 */
  readonly cover = input('');
  /** 本机独显显存（GB）；状态槽的浮层说明要用 */
  readonly vramGb = input(0);

  readonly remove = output<void>();
  readonly use = output<void>();
  readonly redownload = output<void>();
  /** 本地导入条目没有远端仓库：主操作改为打开目录，而不是去发现页瞎搜 */
  readonly open = output<void>();
}
