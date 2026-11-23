import { Component, input } from '@angular/core';

/** 页面面包屑：只负责显示当前路由层级，外框与间距由外壳控制。 */
@Component({
  selector: 'app-page-crumb',
  standalone: true,
  template: `<nav class="crumb" aria-label="面包屑">{{ label() }}</nav>`,
  styles: `
    :host {
      display: block;
    }

    .crumb {
      color: var(--ui-muted);
      font: 600 10px/1.4 var(--ui-font-mono);
      letter-spacing: .08em;
    }
  `,
})
export class PageCrumbComponent {
  readonly label = input.required<string>();
}
