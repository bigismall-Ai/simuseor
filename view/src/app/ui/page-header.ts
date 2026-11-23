import { Component, input, output } from '@angular/core';

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
  template: `
    <header class="ui-page-header">
      <div class="ui-page-heading">
        @if (kicker()) {
          <p class="ui-page-kicker">{{ kicker() }}</p>
        }
        <div class="ph-title-row">
          <h1>{{ title() }}</h1>
          @if (viewOptions().length) {
            <div class="segmented" role="group" aria-label="视图切换">
              @for (o of viewOptions(); track o.key) {
                <button
                  type="button"
                  [class.active]="o.key === view()"
                  [attr.aria-pressed]="o.key === view()"
                  (click)="viewChange.emit(o.key)"
                >
                  {{ o.label }}
                </button>
              }
            </div>
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
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    .ui-page-heading h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.022em;
      line-height: 1.2;
    }

    .ui-page-hint {
      max-width: 74ch;
      margin: 6px 0 0;
      color: var(--ui-muted);
      font-size: 12.5px;
    }

    .ui-page-actions {
      display: flex;
      gap: 8px;
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
    .segmented {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      border: 1px solid var(--ui-border-2);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-panel-3);
    }

    .segmented button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 24px;
      padding: 0 11px;
      border: none;
      border-radius: var(--ui-radius-pill);
      background: none;
      color: var(--ui-muted);
      font-size: 11.5px;
      font-weight: 500;
      box-shadow: none;
      cursor: pointer;
    }

    .segmented button:hover {
      background: color-mix(in oklab, var(--ui-panel) 60%, transparent);
      color: var(--ui-text);
    }

    .segmented button.active {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
      font-weight: 500;
    }

    .segmented button.active:hover {
      background: var(--ui-primary);
      color: var(--ui-on-primary);
    }

    /* ④ 动作区：本页没有动作时整区留空，不留占位 */
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
