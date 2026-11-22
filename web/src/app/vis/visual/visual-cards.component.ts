import { Component } from '@angular/core';
import { LibraryCardComponent } from '../../ui/library-card.component';
import { ModelCardComponent } from '../../ui/model-card.component';
import { PanelComponent } from '../../ui/panel.component';
import { WorkflowCardComponent } from '../../ui/workflow-card.component';
import { VisualPageComponent } from './visual-page.component';
import { LIBRARY_MODELS, SEARCH_ITEMS, WORKFLOWS } from './visual-data';

/** 卡片（/vis/visual/cards）：工作流四态、模型发现卡、模型库卡。 */
@Component({
  selector: 'app-visual-cards',
  standalone: true,
  imports: [
    LibraryCardComponent,
    ModelCardComponent,
    PanelComponent,
    WorkflowCardComponent,
    VisualPageComponent,
  ],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="卡片"
      hint="模型 / 工作流 / 节点共用一套资产卡骨架；这里直接渲染真实组件。"
    >
      <ui-panel kicker="Components" title="真实组件">
        <p class="vis-hint">
          下面是<b>真实组件</b>：<code>md-model-card</code> / <code>md-library-card</code> /
          <code>app-workflow-card</code>。数据是本页造的假数据，但组件与样式是真的。
        </p>

        <h3 class="vis-sub">工作流卡 —— 四种态</h3>
        <div class="vis-cards">
          @for (wf of workflows; track wf.name) {
            <app-workflow-card [it]="wf" />
          }
        </div>

        <h3 class="vis-sub">模型卡（md-model-card）</h3>
        <div class="vis-cards">
          @for (m of searchItems; track m.id) {
            <md-model-card [items]="[m]" />
          }
        </div>

        <h3 class="vis-sub">模型库卡（md-library-card）</h3>
        <div class="vis-cards">
          @for (m of libraryModels; track m.id) {
            <md-library-card [model]="m" />
          }
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualCardsComponent {
  readonly searchItems = SEARCH_ITEMS;
  readonly libraryModels = LIBRARY_MODELS;
  readonly workflows = WORKFLOWS;
}
