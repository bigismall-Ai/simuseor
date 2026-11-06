import { Component, Input } from '@angular/core';

@Component({
  selector: 'ui-panel',
  standalone: true,
  template: `
    <section class="panel">
      @if (title) {
        <div class="panel-head">
          <div class="panel-heading">
            <h2>{{ title }}</h2>
            @if (hint) {
              <p class="panel-hint">{{ hint }}</p>
            }
          </div>
          <div class="panel-actions">
            <ng-content select="[panel-actions]" />
          </div>
        </div>
      }
      <ng-content />
    </section>
  `,
})
export class PanelComponent {
  @Input() title = '';
  @Input() hint = '';
}
