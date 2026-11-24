import { Component, input } from '@angular/core';

/**
 * 卡片底部信息区：标题 + 可展开的详情。
 *
 * 详情默认只露标题，hover / focus / 键盘展开；设计页用 `.card-expanded`
 * 定格展开。卡片的 meta / 状态槽 / 标签 / 动作行都由调用方投影进来。
 */
@Component({
  selector: 'ui-card-body',
  host: {
    class: 'acard-body',
  },
  template: `
    @if (title()) {
      <h3 [class]="'acard-name ' + titleClass()" [title]="title()">{{ title() }}</h3>
    }
    <div class="acard-details">
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: auto;
      padding: 9px 10px 10px;
    }

    .acard-name {
      margin: 0;
      font-size: var(--card-title-size);
      font-weight: 600;
      line-height: 1.38;
      letter-spacing: -0.008em;
      color: var(--card-scrim-ink);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .acard-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      transform: translateY(5px);
      transition:
        max-height 0.34s cubic-bezier(0.4, 0, 0.2, 1),
        opacity 0.2s ease,
        transform 0.34s cubic-bezier(0.4, 0, 0.2, 1);
    }

    :host-context(.acard:hover) .acard-details,
    :host-context(.acard:focus-within) .acard-details {
      max-height: 130px;
      opacity: 1;
      transform: none;
    }

    /* 设计页 / 截图：与 hover 相同，且不裁切内部菜单 */
    :host-context(.card-expanded) .acard-details {
      max-height: none;
      overflow: visible;
      opacity: 1;
      transform: none;
    }

    @media (hover: none) {
      .acard-details {
        max-height: none;
        overflow: visible;
        opacity: 1;
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .acard-details {
        transition: none;
      }
    }
  `,
})
export class CardBodyComponent {
  readonly title = input('');
  /** 卡内已有的标题类名（mname / wc-name / card-name），保留给 E2E 与页面样式 */
  readonly titleClass = input('');
}
