import { Component, input } from '@angular/core';

/**
 * VIS 页面区块：标题在卡外、内容在卡内。
 *
 * 统一 section-block / section-head / section-pill / section-body 的标记，
 * 页面不再手写这套结构；列表与纯文字通过 :has / plain 自动去掉外层卡。
 */
@Component({
  selector: 'ui-section',
  standalone: true,
  template: `
    <section class="section-block">
      <div class="section-head">
        <h2>{{ title() }}</h2>
        @if (pill()) {
          <span class="section-pill">{{ pill() }}</span>
        }
      </div>
      <div class="section-body" [class.plain]="plain()">
        <ng-content />
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .section-block {
      margin-bottom: 28px;
    }

    :host(:last-child) .section-block {
      margin-bottom: 0;
    }

    :host-context(.icon-spec-grid) .section-block,
    :host-context(.layout-split) .section-block {
      margin-bottom: 0;
    }

    .section-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 10px;
    }

    .section-head h2 {
      margin: 0;
      font-size: var(--ui-text-lg);
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .section-pill {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 9px;
      border: 1px solid var(--ui-border-2);
      border-radius: var(--ui-radius-pill);
      background: var(--ui-raised);
      color: var(--ui-muted);
      font: 600 9.5px/1 var(--ui-font-mono);
      letter-spacing: 0.06em;
    }

    .section-body {
      padding: var(--ui-space-5) var(--ui-space-6);
      border: 1px solid var(--ui-border);
      border-radius: var(--ui-radius-card);
      background: var(--ui-card-solid);
      box-shadow: var(--ui-shadow);
    }

    /* 列表 / 表格 / 规则清单不套外层卡；文字区用 plain 显式关掉 */
    :host ::ng-deep .section-body:has(ui-table),
    :host ::ng-deep .section-body:has(ui-list-card),
    :host ::ng-deep .section-body:has(.color-rules),
    .section-body.plain {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
  `,
})
export class SectionBlockComponent {
  readonly title = input.required<string>();
  readonly pill = input('');
  /** 纯文字 / 规则区：不套外层卡 */
  readonly plain = input(false);
}
