import { Component } from '@angular/core';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

/** 圆角与阴影：面板 28 / 卡片 24 / 列表 16 / 按钮 18 / 胶囊 999。 */
@Component({
  selector: 'app-vis-radius',
  standalone: true,
  imports: [SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="圆角"
      hint="面板 28px，卡片 24px，列表 16px，按钮 18px，胶囊 999px。"
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
              <b>卡片</b>
              <span>资产卡 / 浮层内容</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-list)">16px</div>
              <b>列表</b>
              <span>表格 / 列表卡片</span>
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
          <p class="hint">
            浅色用纸面投影，深色用更深的黑投影；两者都只做“离页面的距离”，不做发光。
          </p>
          <div class="shadow-grid">
            <div class="shadow-box" style="box-shadow: var(--ui-shadow)"><span>--ui-shadow</span></div>
            <div class="shadow-box" style="box-shadow: var(--ui-shadow-md)"><span>--ui-shadow-md</span></div>
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisRadiusComponent {}
