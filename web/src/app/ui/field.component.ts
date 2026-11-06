import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-field',
  standalone: true,
  template: `
    <div class="field">
      @if (label) {
        <label>{{ label }}</label>
      }
      <ng-content />
    </div>
  `,
})
export class FieldComponent {
  @Input() label = '';
}
