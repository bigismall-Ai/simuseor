import { Component } from '@angular/core';
import { LibraryCardComponent } from '../../ui/library-card';
import { ModelCardComponent } from '../../ui/model-card';
import { WorkflowCardComponent } from '../../ui/workflow-card';
import { LIBRARY_MODELS, SEARCH_ITEMS, WORKFLOWS } from '../visual-data';

/**
 * 原型组件：资产卡片。
 *
 * 直接渲染产品侧真实组件，不是静态样张：
 * 本地库卡（md-library-card）、发现卡（md-model-card）、工作流卡四态（app-workflow-card）。
 */
@Component({
  selector: 'app-proto-cards',
  standalone: true,
  imports: [LibraryCardComponent, ModelCardComponent, WorkflowCardComponent],
  styleUrl: './cards.scss',
  template: `
    <div class="card-set">
      <p class="set-label">本地库</p>
      <div class="card-grid">
        @for (model of libraryModels; track model.id) {
          <md-library-card [model]="model" [cover]="coverFor($index)" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">发现</p>
      <div class="card-grid">
        @for (item of searchItems; track item.id) {
          <md-model-card [items]="[item]" [cover]="$index === 0 ? '/samples/shot-4.jpg' : ''" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">工作流</p>
      <div class="card-grid">
        @for (workflow of workflows; track workflow.name) {
          <app-workflow-card [it]="workflow" />
        }
      </div>
    </div>
  `,
})
export class ProtoCardsComponent {
  readonly libraryModels = LIBRARY_MODELS;
  readonly searchItems = SEARCH_ITEMS;
  readonly workflows = WORKFLOWS;

  coverFor(index: number): string {
    return index === 0 ? '/samples/shot-2.jpg' : '';
  }
}
