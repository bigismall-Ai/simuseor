import { Component } from '@angular/core';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';

/** 圆角与阴影：面板 28 / 区块 24 / 卡片与列表 16 / 按钮 18 / 胶囊 999。 */
@Component({
  selector: 'app-vis-radius',
  standalone: true,
  imports: [
    TextComponent,SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="圆角"
      hint="面板 28px，区块 24px，卡片与列表同为 16px，按钮 18px，胶囊 999px。"
    >
      <ui-section title="圆角五档" pill="Radius">
          <div class="radius-grid">
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-panel)">28px</div>
              <b>面板</b>
              <span>panel / 页面区块 / 内容卡</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-card)">24px</div>
              <b>区块</b>
              <span>section 内容卡 / 浮层内容</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--card-radius)">16px</div>
              <b>卡片 · 列表</b>
              <span>资产卡 / 表格 / 列表卡</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-button)">18px</div>
              <b>按钮</b>
              <span>flat / tonal / text / icon</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-pill)">999px</div>
              <b>胶囊</b>
              <span>chip、pill、badge、搜索框</span>
            </div>
          </div>
        </ui-section>

      <ui-section title="阴影" pill="Elevation">
          <ui-text variant="hint">
            浅色用纸面投影，深色用更深的黑投影；两者都只做“离页面的距离”，不做发光。
          </ui-text>
          <div class="shadow-grid">
            <div class="shadow-box" style="box-shadow: var(--ui-shadow)"><span>--ui-shadow</span></div>
            <div class="shadow-box" style="box-shadow: var(--ui-shadow-md)"><span>--ui-shadow-md</span></div>
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisRadiusComponent {}
