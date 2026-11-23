import { Component } from '@angular/core';
import { UiMaterialModule } from '../ui/material';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

/** 胶囊：badge 表达状态（语义色），pill 表达分类（一律中性）。 */
@Component({
  selector: 'app-vis-pills',
  standalone: true,
  imports: [SectionBlockComponent, UiMaterialModule, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="胶囊"
      hint="badge 表达状态，pill 表达分类；分类标签一律中性，避免一墙红黄绿。"
    >
      <ui-section title="筛选与分类" pill="Filter">
          <div class="row">
            <span class="row-label">Filter chip</span>
            <button class="filter-chip" type="button">全部</button>
            <button class="filter-chip" type="button">已安装</button>
            <button class="filter-chip active" type="button">已选中</button>
            <button class="filter-chip" type="button">全部 <span class="chip-count">128</span></button>
          </div>

          <div class="row">
            <span class="row-label">Pill</span>
            <span class="pill">文生图</span>
            <span class="pill">LoRA</span>
            <span class="pill">VAE</span>
            <span class="pill-outlined">HF</span>
            <span class="pill">+4</span>
          </div>

          <div class="row">
            <span class="row-label">Badge</span>
            <span class="badge gray">未登记</span>
            <span class="badge blue">已在库</span>
            <span class="badge green">已安装</span>
            <span class="badge orange">已禁用</span>
            <span class="badge red">错误</span>
          </div>

          <div class="row">
            <span class="row-label">Segmented</span>
            <div class="segmented">
              <button type="button">全部</button>
              <button type="button" class="active">已安装</button>
              <button type="button">未安装</button>
            </div>
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisPillsComponent {}
