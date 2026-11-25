import { Component, input } from '@angular/core';

/**
 * 工具条：筛选行 / 视图切换行的统一外壳。
 *
 * 只负责排列（flex + gap + 换行）与可选表面，控件仍由页面组合。
 * `toolbar-start` / `toolbar-end` 用于把主次操作推到两端。
 */
@Component({
  selector: 'ui-toolbar',
  template: `
    <div
      class="toolbar"
      [class.wrap]="wrap()"
      [class.has-surface]="surface()"
      [attr.role]="role() || null"
      [attr.aria-label]="ariaLabel() || null"
    >
      <ng-content select="[toolbar-start]" />
      <ng-content />
      <div class="end">
        <ng-content select="[toolbar-end]" />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
    }

    .toolbar.wrap {
      flex-wrap: wrap;
    }

    .toolbar.has-surface {
      padding: var(--ui-space-2) var(--ui-space-3);
      border: 1px solid var(--ui-border-2);
      border-radius: var(--ui-radius-list);
      background: var(--ui-raised);
    }

    .end {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      margin-left: auto;
    }
  `,
})
export class ToolbarComponent {
  readonly wrap = input(true);
  readonly surface = input(false);
  readonly role = input('');
  readonly ariaLabel = input('');
}
