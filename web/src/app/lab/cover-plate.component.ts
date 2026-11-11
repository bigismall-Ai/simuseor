import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { CoverInput, CoverMeta, coverMeta } from '../core/cover';

/**
 * 兜底封面铭牌。四层结构，自下而上：
 *   1. 家族底色（唯一色相来源）
 *   2. 家族纹样 watermark（自绘，仅作肌理，永不使用官方标）
 *   3. 品牌槽位 + 家族码 + 变体行（身份层）
 *   4. 形态角标（量化 / 文件形态）
 *
 * 品牌槽位是 20px 固定格：有官方资产显示 <img>，没有则显示同名自绘标记，
 * 两种状态占同样的位置和尺寸，所以资产补齐时版式不跳。
 * 官方标只在这个槽位出现，绝不放大做背景 —— 一旦出血裁切，它就不再是「指称该模型」，
 * 而是「拿它装饰界面」，那才是真正越界的地方。
 *
 * 颜色写成 9 个家族类 × 明暗两套，不用行内 color-mix：
 * 组件里绑定 CSS 自定义属性在部分 Angular 版本上会被裁剪，静态类更稳。
 */
@Component({
  selector: 'app-cover-plate',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      [class]="cls"
      role="img"
      [attr.aria-label]="meta.code + ' ' + meta.variant + ' ' + meta.chip"
    >
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
        @if (meta.filled) {
          <path [attr.d]="meta.mark" fill="currentColor" stroke="none" />
        } @else {
          <path
            [attr.d]="meta.mark"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
      </svg>

      <div class="top">
        <span class="brand">
          @if (meta.logo) {
            <img class="logo-light" [src]="meta.logo" [alt]="meta.code" />
            @if (meta.logoDark) {
              <img class="logo-dark" [src]="meta.logoDark" alt="" aria-hidden="true" />
            }
          } @else {
            <svg viewBox="0 0 24 24" aria-hidden="true">
              @if (meta.filled) {
                <path [attr.d]="meta.mark" fill="currentColor" stroke="none" />
              } @else {
                <path
                  [attr.d]="meta.mark"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              }
            </svg>
          }
        </span>
        <span class="code">{{ meta.code }}</span>
        @if (meta.chip) {
          <span class="chip">{{ meta.chip }}</span>
        }
      </div>

      <div class="bottom">
        <span class="variant">{{ meta.variant }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .plate {
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        aspect-ratio: 4 / 3;
        padding: 12px;
        overflow: hidden;
        isolation: isolate;
        background: var(--plate-bg);
        color: var(--plate-ink);
      }

      .mark {
        position: absolute;
        right: -26px;
        bottom: -30px;
        width: 148px;
        height: 148px;
        color: var(--plate-mark);
        opacity: 0.085;
        pointer-events: none;
        z-index: 0;
      }

      .top,
      .bottom {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .top {
        justify-content: flex-start;
        gap: 10px;
      }

      /* 品牌槽位：20px 固定格。有资产放官方标，没有放自绘标记，位置尺寸完全一致。
         尺寸写死像素而不是 100%：项目全局样式里有对 svg 的宽度规则会覆盖百分比，
         实测百分比会退化成 4px。 */
      .brand {
        flex: none;
        display: block;
        width: 18px;
        height: 18px;
        color: var(--plate-strong);
      }
      .brand svg,
      .brand img {
        display: block;
        width: 18px;
        height: 18px;
        object-fit: contain;
      }
      .brand .logo-dark {
        display: none;
      }
      :host-context([data-theme='dark']) .brand .logo-light {
        display: none;
      }
      :host-context([data-theme='dark']) .brand .logo-dark {
        display: block;
      }

      .code {
        flex: 1;
        min-width: 0;
        font: 500 20px/1 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace;
        letter-spacing: 0.04em;
        color: var(--plate-strong);
      }

      .chip {
        flex: none;
        padding: 2px 5px;
        border: 1px solid var(--plate-edge);
        border-radius: 4px;
        font: 400 10.5px/1.35 'Cascadia Mono', Consolas, 'JetBrains Mono', monospace;
        letter-spacing: 0.02em;
        color: var(--plate-ink);
        opacity: 0.85;
        white-space: nowrap;
      }

      .variant {
        font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
        font-size: 11.5px;
        line-height: 1.3;
        letter-spacing: 0;
        color: var(--plate-ink);
        opacity: 0.82;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* 行内小尺寸：只留家族码，变体一起收掉 */
      .plate.row {
        aspect-ratio: auto;
        width: 76px;
        height: 56px;
        padding: 7px 8px;
      }
      .plate.row .mark {
        width: 60px;
        height: 60px;
        right: -12px;
        bottom: -14px;
      }
      .plate.row .brand {
        width: 15px;
        height: 15px;
      }
      .plate.row .brand svg,
      .plate.row .brand img {
        width: 15px;
        height: 15px;
      }
      .plate.row .top {
        gap: 5px;
      }
      .plate.row .code {
        font-size: 13px;
      }
      .plate.row .chip,
      .plate.row .variant {
        display: none;
      }

      /* 家族色板：9 桶 × 明暗两套。色相在这里定死，不再按 id 哈希 */
      .f-flux {
        --plate-bg: #f1eefc;
        --plate-ink: #574f8c;
        --plate-strong: #3c3489;
        --plate-mark: #8f86d6;
        --plate-edge: #c9c2ee;
        --plate-strength: #6a60c4;
        --plate-strength-weak: #d8d2f2;
      }
      .f-wan {
        --plate-bg: #e1f5ee;
        --plate-ink: #2f7563;
        --plate-strong: #085041;
        --plate-mark: #59b79f;
        --plate-edge: #a9dcca;
        --plate-strength: #1d9e75;
        --plate-strength-weak: #c6e9dc;
      }
      .f-sdxl {
        --plate-bg: #fbeaf0;
        --plate-ink: #95516b;
        --plate-strong: #72243e;
        --plate-mark: #d78aa6;
        --plate-edge: #eec3d3;
        --plate-strength: #c2587e;
        --plate-strength-weak: #f0d3de;
      }
      .f-sd15 {
        --plate-bg: #f1f3f4;
        --plate-ink: #5b6165;
        --plate-strong: #41474a;
        --plate-mark: #a3abaf;
        --plate-edge: #d5dade;
        --plate-strength: #78828a;
        --plate-strength-weak: #e2e6e9;
      }
      .f-pony {
        --plate-bg: #fbebf6;
        --plate-ink: #8a4a74;
        --plate-strong: #6d2a55;
        --plate-mark: #d18cb8;
        --plate-edge: #edc6de;
        --plate-strength: #b75c94;
        --plate-strength-weak: #f0d5e7;
      }
      .f-hunyuan {
        --plate-bg: #e7f0fa;
        --plate-ink: #3a6291;
        --plate-strong: #14487a;
        --plate-mark: #8cb4de;
        --plate-edge: #bcd4ec;
        --plate-strength: #3d7fb8;
        --plate-strength-weak: #cfe0f0;
      }
      .f-ltx {
        --plate-bg: #ecf4e3;
        --plate-ink: #55703a;
        --plate-strong: #3a5a1e;
        --plate-mark: #9dbe7c;
        --plate-edge: #cbdcb4;
        --plate-strength: #6f9440;
        --plate-strength-weak: #dbe8c9;
      }
      .f-qwen {
        --plate-bg: #f7efdd;
        --plate-ink: #8b6421;
        --plate-strong: #633806;
        --plate-mark: #d3a862;
        --plate-edge: #e8cfa1;
        --plate-strength: #b8822b;
        --plate-strength-weak: #efdcbd;
      }
      .f-other {
        --plate-bg: #f2f1ed;
        --plate-ink: #6b6a63;
        --plate-strong: #57564f;
        --plate-mark: #b3b2aa;
        --plate-edge: #dcdad3;
        --plate-strength: #8a8981;
        --plate-strength-weak: #e5e4de;
      }

      :host-context([data-theme='dark']) .mark {
        opacity: 0.13;
      }

      :host-context([data-theme='dark']) .f-flux {
        --plate-bg: #1e1b33;
        --plate-ink: #c3bcfa;
        --plate-strong: #ded9ff;
        --plate-mark: #8f86d6;
        --plate-edge: #3c3568;
        --plate-strength: #a79ef0;
        --plate-strength-weak: #2e2a4d;
      }
      :host-context([data-theme='dark']) .f-wan {
        --plate-bg: #10241f;
        --plate-ink: #8fdfca;
        --plate-strong: #bdf2e2;
        --plate-mark: #59b79f;
        --plate-edge: #24473d;
        --plate-strength: #62c9ab;
        --plate-strength-weak: #1b3a32;
      }
      :host-context([data-theme='dark']) .f-sdxl {
        --plate-bg: #2a1620;
        --plate-ink: #f2adc3;
        --plate-strong: #ffd2e0;
        --plate-mark: #d78aa6;
        --plate-edge: #4d2b38;
        --plate-strength: #dd7d9c;
        --plate-strength-weak: #3b2029;
      }
      :host-context([data-theme='dark']) .f-sd15 {
        --plate-bg: #1b1d1e;
        --plate-ink: #a8b0b4;
        --plate-strong: #d3d9dc;
        --plate-mark: #a3abaf;
        --plate-edge: #33383a;
        --plate-strength: #8e979c;
        --plate-strength-weak: #262a2c;
      }
      :host-context([data-theme='dark']) .f-pony {
        --plate-bg: #281626;
        --plate-ink: #f3b6df;
        --plate-strong: #ffd6ee;
        --plate-mark: #d18cb8;
        --plate-edge: #482a42;
        --plate-strength: #d47fb4;
        --plate-strength-weak: #3a2035;
      }
      :host-context([data-theme='dark']) .f-hunyuan {
        --plate-bg: #131f2c;
        --plate-ink: #9dcbf3;
        --plate-strong: #cce6ff;
        --plate-mark: #8cb4de;
        --plate-edge: #27394c;
        --plate-strength: #6aa8dd;
        --plate-strength-weak: #1d2d3d;
      }
      :host-context([data-theme='dark']) .f-ltx {
        --plate-bg: #1b2313;
        --plate-ink: #b4d68a;
        --plate-strong: #d9efbb;
        --plate-mark: #9dbe7c;
        --plate-edge: #33421f;
        --plate-strength: #8fbb5c;
        --plate-strength-weak: #26301a;
      }
      :host-context([data-theme='dark']) .f-qwen {
        --plate-bg: #232220;
        --plate-ink: #eec48a;
        --plate-strong: #ffdfae;
        --plate-mark: #d3a862;
        --plate-edge: #453216;
        --plate-strength: #d6a155;
        --plate-strength-weak: #33260f;
      }
      :host-context([data-theme='dark']) .f-other {
        --plate-bg: #1d1d1b;
        --plate-ink: #b0afa6;
        --plate-strong: #d7d6cd;
        --plate-mark: #b3b2aa;
        --plate-edge: #34342f;
        --plate-strength: #96958c;
        --plate-strength-weak: #282825;
      }
    `,
  ],
})
export class CoverPlateComponent implements OnChanges {
  @Input({ required: true }) model!: CoverInput;
  @Input() size: 'card' | 'row' = 'card';

  meta: CoverMeta = coverMeta({ name: '' });

  get cls(): string {
    return `plate f-${this.meta.family}${this.size === 'row' ? ' row' : ''}`;
  }

  ngOnChanges(): void {
    this.meta = coverMeta(this.model);
  }
}
