import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-empty',
  standalone: true,
  template: `
    <div class="empty-state">
      @if (icon) {
        <div class="empty-icon">{{ icon }}</div>
      }
      <p class="empty-title">{{ title }}</p>
      @if (hint) {
        <p class="empty-hint">{{ hint }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyComponent {
  @Input() icon = '';
  @Input({ required: true }) title = '';
  @Input() hint = '';
}
