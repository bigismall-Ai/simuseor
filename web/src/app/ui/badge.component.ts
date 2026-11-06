import { NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

export type BadgeTone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

@Component({
  selector: 'ui-badge',
  standalone: true,
  imports: [NgClass],
  template: `<span class="badge" [ngClass]="tone"><ng-content /></span>`,
})
export class BadgeComponent {
  @Input() tone: BadgeTone = 'gray';
}
