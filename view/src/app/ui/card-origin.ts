import { Component, input } from '@angular/core';

/**
 * 卡片动作行左侧的原站入口。
 *
 * 前面是站点名（HF / ModelScope / GitHub / 本地），后面是外链图标；
 * 没有远端地址时渲染成同尺寸的静态标签，保证每张卡的动作行结构一致。
 */
@Component({
  selector: 'ui-card-origin',
  template: `
    @if (href()) {
      <a
        class="acard-origin-link"
        [href]="href()"
        target="_blank"
        rel="noreferrer"
        [attr.aria-label]="'打开 ' + label() + ' 上的原始页面'"
        [attr.title]="'打开 ' + label() + ' 上的原始页面'"
      >
        <span class="lbl">{{ label() }}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5H2.5v7h7v-2" />
          <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
        </svg>
      </a>
    } @else {
      <span class="acard-origin-link is-static" [attr.title]="'来源：' + label()">
        <span class="lbl">{{ label() }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .acard-origin-link {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex: none;
      height: 22px;
      padding: 0 7px;
      border: 1px solid var(--ui-inner-border);
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--ui-card-solid) 80%, transparent);
      color: var(--ui-text);
      text-decoration: none;
      cursor: pointer;
      backdrop-filter: blur(6px);
    }

    .acard-origin-link:hover {
      background: color-mix(in srgb, var(--ui-card-solid) 92%, transparent);
    }

    .acard-origin-link.is-static {
      color: var(--ui-muted);
      cursor: default;
    }

    .acard-origin-link.is-static:hover {
      background: color-mix(in srgb, var(--ui-card-solid) 80%, transparent);
    }

    .lbl {
      max-width: 108px;
      overflow: hidden;
      font-family: var(--ui-font-mono);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.04em;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    svg {
      width: 9px;
      height: 9px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class CardOriginComponent {
  readonly href = input('');
  readonly label = input('本地');
}
