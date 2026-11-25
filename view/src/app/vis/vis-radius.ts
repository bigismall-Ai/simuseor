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
      hint="面板 24px，卡片 16px，列表 12px，控件 10px，小件 6 / 8px，胶囊 999px。"
    >
      <ui-section title="圆角五档" pill="Radius">
          <div class="radius-grid">
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-panel)">24px</div>
              <b>面板</b>
              <span>dialog / 大容器</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-card)">16px</div>
              <b>卡片 · 区块</b>
              <span>资产卡 / section 内容 / 内层卡</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-list)">12px</div>
              <b>列表</b>
              <span>表格 / 列表卡 / 工具栏</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-md)">10px</div>
              <b>控件</b>
              <span>输入框 / 菜单 / 按钮容器</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-pill)">999px</div>
              <b>胶囊</b>
              <span>chip、pill、badge、搜索框</span>
            </div>
          </div>
        </ui-section>

      <ui-section title="小件圆角" pill="Small">
          <div class="radius-grid">
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-xs)">6px</div>
              <b>小件</b>
              <span>菜单项 / 卡片角标 / kbd</span>
            </div>
            <div class="radius-item">
              <div class="radius-box" style="border-radius: var(--ui-radius-sm)">8px</div>
              <b>控件内件</b>
              <span>厂牌位 / 图标按钮 / 小徽标</span>
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
