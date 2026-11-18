import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-empty',
  standalone: true,
  template: `
    <div class="ui-empty">
      @if (icon) {
        <div class="ui-empty-icon">{{ icon }}</div>
      }
      <p class="ui-empty-title">{{ title }}</p>
      @if (hint) {
        <p class="ui-empty-hint">{{ hint }}</p>
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
