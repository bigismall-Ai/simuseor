import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-page-header',
  standalone: true,
  template: `
    <header class="page-header">
      <div class="page-heading">
        <h1>{{ title }}</h1>
        @if (hint) {
          <p class="page-hint">{{ hint }}</p>
        }
      </div>
      <div class="page-actions">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() hint = '';
}
