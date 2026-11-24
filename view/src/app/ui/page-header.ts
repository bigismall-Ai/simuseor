import { Component, input, output } from '@angular/core';
import { SegmentedComponent } from './segmented';

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
  imports: [SegmentedComponent],
  template: `
    <header class="ui-page-header">
      <div class="ui-page-heading">
        @if (kicker()) {
          <p class="ui-page-kicker">{{ kicker() }}</p>
        }
        <div class="ph-title-row">
          <h1>{{ title() }}</h1>
          @if (viewOptions().length) {
            <ui-segmented
              [options]="viewOptions()"
              [value]="view()"
              (valueChange)="viewChange.emit($event)"
              label="视图切换"
            />
          }
        </div>
        @if (hint()) {
          <p class="ui-page-hint">{{ hint() }}</p>
        }
      </div>
      <div class="ui-page-actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }

    .ui-page-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .ui-page-heading {
      min-width: 0;
    }

    .ui-page-kicker {
      margin: 0 0 5px;
      color: var(--ui-muted);
      font-size: var(--ui-text-xs);
      font-weight: 600;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    .ui-page-heading h1 {
      margin: 0;
      font-size: var(--ui-text-xl);
      font-weight: 600;
      letter-spacing: -0.022em;
      line-height: 1.2;
    }

    .ui-page-hint {
      max-width: 74ch;
      margin: 6px 0 0;
      color: var(--ui-muted);
      font-size: var(--ui-text-md);
    }

    .ui-page-actions {
      display: flex;
      gap: var(--ui-space-2);
      align-items: center;
    }

    /* 标题行：标题与 segmented 同一行（原型 .ph-title-row） */
    .ph-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* 视图切换 */
    .ui-page-actions:empty {
      display: none;
    }
  `,
})
export class PageHeaderComponent {
  readonly title = input('');
  readonly hint = input('');
  readonly kicker = input('');
  /** 视图切换：本地库 / 发现。没有第二个视图的页不传。 */
  readonly viewOptions = input<PageViewOption[]>([]);
  /** 当前视图的 key */
  readonly view = input('');
  readonly viewChange = output<string>();
}
