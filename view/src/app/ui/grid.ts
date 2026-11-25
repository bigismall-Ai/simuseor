import { Component, computed, input } from '@angular/core';

/**
 * 卡片网格：页面上所有「一排卡片」的唯一布局件。
 *
 * 只负责列宽、间距与换行，不碰卡片内部：
 *   min  列最小宽，窄于它才换列（默认 --layout-grid-min）
 *   max  列最大宽，宽屏上卡片不会被拉大（默认 --card-max）
 *   gap  列间距（默认 --ui-space-4）
 *
 * 自定义卡片的流程页不再各写一套 `grid-template-columns`。
 */
@Component({
  selector: 'ui-grid',
  template: `
    <div
      class="grid"
      [style.grid-template-columns]="template()"
      [style.gap]="gap()"
    >
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .grid {
      display: grid;
      justify-content: start;
      align-items: start;
    }

    @media (max-width: 768px) {
      .grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
    }
  `,
})
export class GridComponent {
  readonly min = input('var(--layout-grid-min)');
  readonly max = input('var(--card-max)');
  readonly gap = input('var(--ui-space-4)');

  readonly template = computed(
    () => `repeat(auto-fill, minmax(${this.min()}, ${this.max()}))`,
  );
}
