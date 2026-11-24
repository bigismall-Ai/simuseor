import { Component, computed, input } from '@angular/core';

/**
 * 骨架屏：首屏首次加载时占位。
 *
 * 只做一种形态（若干横条 + 末行短一些），不做卡片/表格/头像全家桶；
 * 局部刷新与长任务仍用进度条或行内提示。
 */
@Component({
  selector: 'ui-skeleton',
  template: `
    <div class="skeleton" role="status" [attr.aria-label]="label()">
      @for (w of widths(); track $index) {
        <span class="bar" aria-hidden="true" [style.height.px]="barHeight()" [style.width.%]="w"></span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .skeleton {
      display: grid;
      gap: var(--ui-space-2);
    }

    .bar {
      display: block;
      border-radius: var(--ui-radius-pill);
      background: linear-gradient(
        90deg,
        var(--ui-panel-3) 0%,
        color-mix(in srgb, var(--ui-panel-3) 45%, transparent) 40%,
        var(--ui-panel-3) 80%
      );
      background-size: 240% 100%;
      animation: skeleton-wave 1.4s ease-in-out infinite;
    }

    @keyframes skeleton-wave {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: -60% 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
        background: var(--ui-panel-3);
      }
    }
  `,
})
export class SkeletonComponent {
  readonly lines = input(3);
  readonly barHeight = input(12);
  readonly label = input('正在加载');

  readonly widths = computed(() => {
    const n = Math.max(1, this.lines());
    return Array.from({ length: n }, (_, i) => {
      if (n === 1) return 100;
      if (i === n - 1) return 68;
      if (i === n - 2) return 88;
      return 100;
    });
  });
}
