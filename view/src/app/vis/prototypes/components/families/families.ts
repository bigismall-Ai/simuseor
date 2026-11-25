import { Component } from '@angular/core';
import { FAMILIES } from '../../../../core/cover';
import { CardMarkComponent } from '../../../../ui/card-mark';
import { ModelCardComponent } from '../../../../ui/model-card';
import { SEARCH_ITEMS } from '../../../visual-data';
import { TextComponent } from '../../../../ui/text';
import { LabelComponent } from '../../../../ui/label';

/**
 * 原型组件：厂牌资产。
 *
 * 所有厂牌位都走同一个 ui-card-mark：官方 logo / 反白 logo / 家族码 /
 * 发布方缩写 / 工作流图标，不再让每张卡自己拼标识块。
 * 这一页同时给出「在卡内」的完整形态，避免只在白底上看图标。
 */
@Component({
  selector: 'app-proto-families',
  imports: [
    LabelComponent,
    TextComponent,
    CardMarkComponent,
    ModelCardComponent,
  ],
  styleUrl: './families.scss',
  template: `
    <ui-label>身份行 · 卡内表现</ui-label>
    <ui-text variant="lead">
      厂牌位固定 32 × 32，右侧两行：名称在上、作者 / 来源在下。三种卡面各取一次样，
      组件、尺寸、对齐都相同，厂牌底始终是同一块 80% 底色。
    </ui-text>

    <div class="ident-row">
      <div class="ident-strip on-paper">
        <ui-card-mark model="flux1-dev.safetensors" />
        <span class="ident-text">
          <b>FLUX</b>
          <span>black-forest-labs</span>
        </span>
        <span class="ident-note">浅色卡面</span>
      </div>

      <div class="ident-strip on-photo">
        <ui-card-mark model="flux1-dev.safetensors" />
        <span class="ident-text">
          <b>FLUX</b>
          <span>black-forest-labs</span>
        </span>
        <span class="ident-note">照片封面</span>
      </div>

      <div class="ident-strip on-dark">
        <ui-card-mark model="flux1-dev.safetensors" />
        <span class="ident-text">
          <b>FLUX</b>
          <span>black-forest-labs</span>
        </span>
        <span class="ident-note">深色主题</span>
      </div>
    </div>

    <ui-label>真实卡片刻</ui-label>
    <div class="card-slice">
      <md-model-card [items]="[flux]" cover="/samples/shot-4.jpg" />
      <div class="slice-note">
        <b>同一个组件</b>
        <span>卡里的厂牌位与上面三块都来自 <code>ui-card-mark</code>，没有第二份标识块实现。</span>
      </div>
    </div>

    <ui-label>官方厂牌</ui-label>
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

    <ui-label>兜底形式</ui-label>
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

    <ui-label>尺寸与约束</ui-label>
    <div class="spec">
      <div class="spec-cell">
        <b>32 × 32</b>
        <span>厂牌位</span>
      </div>
      <div class="spec-cell">
        <b>24 × 24</b>
        <span>官方资产，不裁切、不改色</span>
      </div>
      <div class="spec-cell">
        <b>8px</b>
        <span>厂牌位圆角</span>
      </div>
      <div class="spec-cell">
        <b>80%</b>
        <span>厂牌底固定透明度的底色，照片上也不换</span>
      </div>
    </div>

    <ul class="mark-rules">
      <li>所有厂牌位统一 32 × 32；官方资产 24 × 24，不裁切、不改色。</li>
      <li>深色主题自动换反白资产；照片上不特殊处理，仍用同一块 80% 底色，避免厂牌在图上「消失」。</li>
      <li>没有资产时退家族码；认不出家族才退发布方缩写或工作流图标。</li>
      <li>同一张卡上只出现一次厂牌位，身份行不再重复。</li>
    </ul>
  `,
})
export class ProtoFamiliesComponent {
  readonly families = FAMILIES.filter((family) => family.logo || family.code !== '—');
  readonly flux = SEARCH_ITEMS[0];
}
