import { Component, input } from '@angular/core';

/**
 * 设置行：左侧说明、右侧控件。
 *
 * 用于「一个开关 / 一个输入 / 一个选择」这种设置项；
 * 复杂编辑面板仍用 `ui-panel` + `ui-field` 组合。
 */
@Component({
  selector: 'ui-setting-row',
  template: `
    <div class="setting-row" [class.is-stack]="stack()">
      <div class="text">
        <ng-content select="[settingText]" />
      </div>
      <div class="control">
        <ng-content select="[settingControl]" />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ui-space-4);
      padding: var(--ui-space-3) 0;
      border-bottom: 1px solid var(--ui-border-2);
    }

    :host(:last-child) .setting-row {
      border-bottom: 0;
    }

    .setting-row.is-stack {
      flex-direction: column;
      align-items: flex-start;
    }

    .text {
      min-width: 0;
    }

    .control {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      flex: none;
    }
  `,
})
export class SettingRowComponent {
  /** 窄容器 / 多行说明时改为上下排列 */
  readonly stack = input(false);
}
