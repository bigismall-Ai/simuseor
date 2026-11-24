import { Component, input } from '@angular/core';

/**
 * 卡片动作行左侧的「在原站打开」图标。
 *
 * 原站入口不再占右上角（那里留给 ⋯），改成动作行里的一个小图标，
 * 视觉与 ⋯ 同一套表面（普通卡面 / 照片卡面两种配色）。
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
        [attr.aria-label]="label()"
        [attr.title]="label()"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5H2.5v7h7v-2" />
          <path d="M6.5 2.5h3v3M9.5 2.5 5 7" />
        </svg>
      </a>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .acard-origin-link {
      display: grid;
      place-items: center;
      flex: none;
      width: 22px;
      height: 22px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      cursor: pointer;
      backdrop-filter: blur(6px);
    }

    .acard-origin-link:hover {
      background: var(--hover);
    }

    svg {
      width: 11px;
      height: 11px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    :host-context(.acard.on-shot) .acard-origin-link {
      border-color: rgb(255 255 255 / 0.4);
      background: rgb(255 255 255 / 0.16);
      color: #fff;
    }

    :host-context(.acard.on-shot) .acard-origin-link:hover {
      background: rgb(255 255 255 / 0.26);
      border-color: rgb(255 255 255 / 0.56);
    }
  `,
})
export class CardOriginComponent {
  readonly href = input('');
  readonly label = input('在原站打开');
}
