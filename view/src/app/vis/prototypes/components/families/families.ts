import { Component } from '@angular/core';
import { FAMILIES } from '../../../../core/cover';
import { CardMarkComponent } from '../../../../ui/card-mark';

/**
 * 原型组件：厂牌资产。
 *
 * 所有厂牌位都走同一个 ui-card-mark：官方 logo / 反白 logo / 家族码 /
 * 发布方缩写 / 工作流图标，不再让每张卡自己拼标识块。
 */
@Component({
  selector: 'app-proto-families',
  standalone: true,
  imports: [CardMarkComponent],
  styleUrl: './families.scss',
  template: `
    <p class="set-label">官方厂牌</p>
    <div class="mark-grid">
      @for (family of families; track family.id) {
        <div class="mark-item">
          <ui-card-mark
            [logo]="family.logo || ''"
            [logoDark]="family.logoDark || ''"
            [code]="family.code"
            [scale]="family.logoScale || 1"
            [title]="family.id"
          />
          <b>{{ family.id }}</b>
          <small>{{ family.code }}</small>
        </div>
      }
    </div>

    <p class="set-label">兜底形式</p>
    <div class="mark-grid fallback">
      <div class="mark-item">
        <ui-card-mark code="HF" tone="blue" title="发布方缩写" />
        <b>发布方缩写</b>
        <small>未登记家族时使用</small>
      </div>
      <div class="mark-item">
        <ui-card-mark code="QWEN" title="家族码" />
        <b>家族码</b>
        <small>没有官方资产时使用</small>
      </div>
      <div class="mark-item">
        <ui-card-mark icon="workflow" title="未知家族" />
        <b>工作流图标</b>
        <small>主模型无法识别</small>
      </div>
      <div class="mark-item">
        <ui-card-mark code="CM" title="节点扩展" />
        <b>节点缩写</b>
        <small>节点类代表名</small>
      </div>
    </div>

    <p class="set-label">约束</p>
    <ul class="mark-rules">
      <li>所有厂牌位统一 32 × 32；官方资产 24 × 24，不裁切、不改色。</li>
      <li>有反白资产时深色主题自动换；没有反白资产保留原色，不用 CSS 反转。</li>
      <li>没有资产时退家族码；认不出家族才退发布方缩写或工作流图标。</li>
      <li>同一张卡上只出现一次厂牌位，身份行不再重复。</li>
    </ul>
  `,
})
export class ProtoFamiliesComponent {
  readonly families = FAMILIES.filter((family) => family.logo || family.code !== '—');
}
