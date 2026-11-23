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

    :host-context(.icon-spec-grid) .section-block,
    :host-context(.layout-split) .section-block {
      margin-bottom: 0;
    }
  `,
})
export class SectionBlockComponent {
  readonly title = input.required<string>();
  readonly pill = input('');
  /** 纯文字 / 规则区：不套外层卡 */
  readonly plain = input(false);
}
