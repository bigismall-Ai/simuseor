import { Component, input } from '@angular/core';

@Component({
  selector: 'app-visual-page',
  standalone: true,
  template: `
    <div class="vis-page">
      <ng-content />
    </div>
  `,
  styles: `
    :host { display: block; }
    .vis-page {
      width: 100%;
      margin: 22px 0 0;
      padding: 0;
    }
  `,
})
export class VisualPageComponent {
  readonly title = input.required<string>();
  /** 保留 hint 入参以兼容现有页面，页头不再展示。 */
  readonly hint = input('');
}
