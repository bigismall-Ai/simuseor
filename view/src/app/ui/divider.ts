import { Component, input } from '@angular/core';

/**
 * 分隔线：1px 细线，只用描边 token。
 *
 * 默认横向、通栏；`vertical` 用于把一排动作拆成两组，
 * `inset` 让横线两端各缩进一档（`--ui-space-6`），用于列表里的分组线。
 *
 * 纯装饰，不带语义，因此对辅助技术隐藏。
 */
@Component({
  selector: 'ui-divider',
  host: {
    '[class.vertical]': 'vertical()',
    '[class.inset]': 'inset()',
  },
  template: `<span class="line" aria-hidden="true"></span>`,
  styles: `
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      flex: 0 1 auto;
    }

    :host(.vertical) {
      display: inline-flex;
      width: auto;
      flex: none;
      align-self: stretch;
    }

    .line {
      display: block;
      width: 100%;
      height: 1px;
      background: var(--ui-inner-border);
    }

    :host(.vertical) .line {
      width: 1px;
      height: 100%;
      min-height: var(--ui-h-compact);
    }

    :host(.inset) .line {
      margin: 0 var(--ui-space-6);
      width: auto;
    }

    :host(.inset.vertical) .line {
      margin: var(--ui-space-2) 0;
      width: 1px;
      height: auto;
    }
  `,
})
export class DividerComponent {
  /** 竖线：用于同一行里区分两组动作。 */
  readonly vertical = input(false);
  /** 两端缩进：横向时左右各留一档，竖向时上下各留一档。 */
  readonly inset = input(false);
}
