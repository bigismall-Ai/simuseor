import { Component, computed, input } from '@angular/core';

/**
 * 进度条：只表达 0–100 的完成度，不承担状态文案。
 *
 * 页面不再各写 `.progress / .bar`；宽度、颜色、圆角与 aria 都在这里。
 */
@Component({
  selector: 'ui-progress',
  template: `
    <div
      class="track"
      role="progressbar"
      [class.sm]="size() === 'sm'"
      [attr.aria-label]="label() || null"
      [attr.aria-valuenow]="value()"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <i [style.width.%]="width()"></i>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .track.sm {
      --ui-progress-height: 3px;
    }

    .track {
      height: var(--ui-progress-height, 6px);
      overflow: hidden;
      border-radius: var(--ui-radius-pill);
      background: var(--track);
    }

    i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--ui-accent), var(--ui-primary));
      transition: width 0.2s ease;
    }

    @media (prefers-reduced-motion: reduce) {
      i {
        transition: none;
      }
    }
  `,
})
export class ProgressComponent {
  readonly value = input(0);
  /** 无障碍名称：通常写「哪个任务的进度」 */
  readonly label = input('');
  /** sm = 3px，用于卡片 / 行内；默认 6px */
  readonly size = input<'md' | 'sm'>('md');

  readonly width = computed(() => Math.min(100, Math.max(0, this.value())));
}
