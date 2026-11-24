import { Component, input, output } from '@angular/core';

/**
 * 卡片右上角的 ⋯ 按钮。
 *
 * 只负责按钮本身与表面（照片 / 普通卡面两套配色）；
 * 菜单由 `ui-card-menu` 渲染，开合状态由卡片持有。
 */
@Component({
  selector: 'ui-card-kebab',
  template: `
    <button
      class="acard-kebab"
      type="button"
      aria-haspopup="menu"
      aria-label="更多操作"
      title="更多操作"
      [attr.aria-expanded]="expanded()"
      [attr.data-testid]="testId() || null"
      (click)="toggled.emit($event)"
    >
      ⋯
    </button>
  `,
  styles: `
    :host {
      display: contents;
    }

    .acard-kebab {
      display: grid;
      place-items: center;
      flex: none;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      backdrop-filter: blur(6px);
    }

    .acard-kebab:hover {
      background: var(--hover);
    }

    :host-context(.acard.on-shot) .acard-kebab {
      border-color: rgb(255 255 255 / 0.4);
      background: rgb(255 255 255 / 0.16);
      color: #fff;
    }

    :host-context(.acard.on-shot) .acard-kebab:hover {
      background: rgb(255 255 255 / 0.26);
      border-color: rgb(255 255 255 / 0.56);
    }

    :host-context(.acard) .acard-kebab:focus-visible {
      outline: 2px solid var(--ui-primary);
      outline-offset: 2px;
    }
  `,
})
export class CardKebabComponent {
  readonly expanded = input(false);
  readonly testId = input('');
  readonly toggled = output<MouseEvent>();
}
