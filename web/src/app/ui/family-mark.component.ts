import { Component, Input } from '@angular/core';
import { FamilySpec, resolveFamily } from '../core/cover';

/**
 * 家族厂标：官方 symbol，没有资产就退家族码。
 *
 * 家族判定复用 core/cover.ts 的 FAMILIES 表（模型发现页同一份）——
 * 后端只给主模型文件名，判定在前端做，两处永远一致。
 *
 * 规矩照旧：
 * - 有官方资产就用资产，不改色、不拉伸（官方标识不是装饰）
 * - 没有资产就用家族码文字，不自绘几何冒充官方标
 * - 认不出家族就什么都不画 —— 未知就是未知，留空比画个含义不明的符号诚实
 */
@Component({
  selector: 'ui-family-mark',
  standalone: true,
  template: `
    @if (spec && (spec.logo || spec.code)) {
      @if (spec.logo) {
        <img
          class="fm-logo"
          [src]="src"
          [alt]="spec.id"
          [title]="title"
          [style.--fm-scale]="spec.logoScale || 1"
        />
      } @else {
        <span class="fm-code" [title]="title">{{ spec.code }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-items: center;
    }
    .fm-logo {
      width: 18px;
      height: 18px;
      object-fit: contain;
      transform: scale(var(--fm-scale, 1));
    }
    .fm-code {
      display: inline-flex;
      align-items: center;
      height: 16px;
      padding: 0 5px;
      border-radius: 5px;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text-2);
      background: var(--panel-3);
      border: 1px solid var(--border-soft);
      white-space: nowrap;
    }
  `,
})
export class FamilyMarkComponent {
  /** 主模型文件名（工作流场景）或模型名（发现页场景） */
  @Input() model = '';

  @Input() set dark(value: boolean) {
    this.isDark = value;
  }

  isDark = false;

  get spec(): FamilySpec | null {
    if (!this.model) return null;
    return resolveFamily({ name: this.model });
  }

  /** 深色主题用反白版资产，不用 CSS filter 反转（那等于改色） */
  get src(): string {
    const spec = this.spec;
    if (!spec) return '';
    if (this.isDark && spec.logoDark) return spec.logoDark;
    return spec.logo || '';
  }

  get title(): string {
    const spec = this.spec;
    if (!spec) return '';
    return spec.logo ? `${spec.id} 官方标识` : `${spec.code} 家族`;
  }
}
