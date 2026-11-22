import { Component, EventEmitter, Input, Output } from '@angular/core';

/** 视图切换里的一项（本地库 / 发现）。 */
export interface PageViewOption {
  key: string;
  label: string;
}

/**
 * 页头（VIS §3.7.7 定稿 · 分层页头）。
 *
 * 四区：
 *   ① kicker       —— 只标「区」（Models / Workflows / Nodes），不拼视图名
 *   ② title + 视图切换 —— 标题说这页是什么；「本地库 / 发现」是控件，用 segmented 表达
 *   ③ hint         —— 至多一句、≤40 字，只说这页是干什么的
 *   ④ 主操作区     —— 至多一主一次，同排右对齐；无操作则整区留空
 *
 * 视觉参考：artifacts/vis/prototypes/page-header.html「定稿 · 分层页头」。
 */
@Component({
  selector: 'ui-page-header',
  standalone: true,
  template: `
    <header class="ui-page-header">
      <div class="ui-page-heading">
        @if (kicker) {
          <p class="ui-page-kicker">{{ kicker }}</p>
        }
        <div class="ph-title-row">
          <h1>{{ title }}</h1>
          @if (viewOptions.length) {
            <div class="segmented" role="group" aria-label="视图切换">
              @for (o of viewOptions; track o.key) {
                <button
                  type="button"
                  [class.active]="o.key === view"
                  [attr.aria-pressed]="o.key === view"
                  (click)="viewChange.emit(o.key)"
                >{{ o.label }}</button>
              }
            </div>
          }
        </div>
        @if (hint) {
          <p class="ui-page-hint">{{ hint }}</p>
        }
      </div>
      <div class="ui-page-actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: [
    `
      /* 标题行：标题与 segmented 同一行（原型 .ph-title-row） */
      .ph-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      /* ④ 动作区：本页没有动作时整区留空，不留占位 */
      .ui-page-actions:empty { display: none; }
    `,
  ],
})
export class PageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() hint = '';
  @Input() kicker = '';
  /** 视图切换：本地库 / 发现。没有第二个视图的页不传。 */
  @Input() viewOptions: PageViewOption[] = [];
  /** 当前视图的 key */
  @Input() view = '';
  @Output() viewChange = new EventEmitter<string>();
}
