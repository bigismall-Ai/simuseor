import { Component, Input, inject } from '@angular/core';
import { FamilySpec, resolveFamily } from '../core/cover';
import { ThemeService } from '../core/theme.service';

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
      <span class="fm" [class.plate]="plate">
        @if (showLogo) {
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
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-items: center;
    }
    .fm {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    /*
     * 压在封面图上的厂标必须有底衬：官方资产是纯黑（浅色主题）或纯白
     * （深色主题），直接落在深色照片上，黑色标就"消失"了。
     * 底衬用 --panel 自动随主题翻转 —— 白底配黑标、深底配白标，
     * 两套组合都不改资产颜色。
     */
    .fm.plate {
      height: 22px;
      min-width: 22px;
      padding: 0 5px;
      border-radius: var(--radius-xs);
      background: var(--panel);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.28);
    }
    .fm-logo {
      width: 18px;
      height: 18px;
      object-fit: contain;
      transform: scale(var(--fm-scale, 1));
    }
    /* 有底衬时收一点，logoScale 放大后也不会顶到圆角 */
    .fm.plate .fm-logo {
      width: 16px;
      height: 16px;
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
    /* 有底衬时不再叠第二层底 */
    .fm.plate .fm-code {
      height: auto;
      padding: 0;
      border: 0;
      background: none;
      font-size: 10px;
    }
  `,
})
export class FamilyMarkComponent {
  /** 主模型文件名（工作流场景）或模型名（发现页场景） */
  @Input() model = '';

  /** 压在图上时置 true：加一层随主题翻转的底衬 */
  @Input() plate = false;

  /** 手动指定深色资产；不传就跟当前主题走（绝大多数场景不传） */
  @Input() set dark(value: boolean) {
    this.isDark = value;
  }

  isDark = false;

  private theme = inject(ThemeService);

  get spec(): FamilySpec | null {
    if (!this.model) return null;
    return resolveFamily({ name: this.model });
  }

  /**
   * 深色主题用反白版资产，不用 CSS filter 反转（那等于改色：qwen 的紫会被翻成黄）。
   *
   * 主题必须从 ThemeService 读 —— 之前靠外部传 `dark` 输入，结果没人传，
   * 深色主题下装着黑标的深色底衬 = 厂标直接消失。
   */
  private get darkNow(): boolean {
    return this.isDark || this.theme.theme() === 'dark';
  }

  get src(): string {
    const spec = this.spec;
    if (!spec) return '';
    if (this.darkNow && spec.logoDark) return spec.logoDark;
    return spec.logo || '';
  }

  /**
   * 深色主题下没有反白资产时，宁可用家族码也别用黑标 ——
   * 黑标压在深色底衬上等于什么都没画（hunyuan 目前就没有 -dark）。
   */
  get showLogo(): boolean {
    const spec = this.spec;
    if (!spec || !spec.logo) return false;
    return !this.darkNow || !!spec.logoDark;
  }

  get title(): string {
    const spec = this.spec;
    if (!spec) return '';
    return this.showLogo ? `${spec.id} 官方标识` : `${spec.code} 家族`;
  }
}
