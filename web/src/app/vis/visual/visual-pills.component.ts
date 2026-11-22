import { Component } from '@angular/core';
import { BadgeComponent } from '../../ui/badge.component';
import { PanelComponent } from '../../ui/panel.component';
import { VisualPageComponent } from './visual-page.component';

/** 胶囊（/vis/visual/pills）：filter chip / 分类 pill / 状态 badge / 分段控件。 */
@Component({
  selector: 'app-visual-pills',
  standalone: true,
  imports: [BadgeComponent, PanelComponent, VisualPageComponent],
  styleUrls: ['./visual-samples.css'],
  template: `
    <app-visual-page
      title="胶囊"
      hint="badge 表达状态（语义色），pill 表达分类（一律中性）。"
    >
      <ui-panel kicker="Components" title="chip / 胶囊 / 徽章">
        <p class="vis-hint">
          §3.7.2：<b>.badge = 状态</b>（带语义色），<b>.pill = 分类</b>（一律中性）。
          分类标签常并列很多个，用语义色会变成一墙红黄绿。
        </p>

        <div class="vis-row">
          <span class="vis-row-label">filter chip</span>
          <span class="filter-chip">全部</span>
          <span class="filter-chip">已安装</span>
          <span class="filter-chip active">已选中</span>
          <span class="filter-chip">全部 <span class="chip-count">128</span></span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">chip</span>
          <span class="chip">文生图</span>
          <span class="chip">LoRA</span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">pill</span>
          <span class="pill">文生图</span>
          <span class="pill">LoRA</span>
          <span class="pill">VAE</span>
          <span class="pill-outlined">HF</span>
          <span class="pill pill-count">+4</span>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">徽章</span>
          <ui-badge tone="gray">未登记</ui-badge>
          <ui-badge tone="blue">已在库</ui-badge>
          <ui-badge tone="green">已安装</ui-badge>
          <ui-badge tone="orange">已禁用</ui-badge>
          <ui-badge tone="red">错误</ui-badge>
        </div>
        <div class="vis-row">
          <span class="vis-row-label">分段控件</span>
          <div class="segmented">
            <button type="button">全部</button>
            <button type="button" class="active">已安装</button>
            <button type="button">未安装</button>
          </div>
        </div>
      </ui-panel>
    </app-visual-page>
  `,
})
export class VisualPillsComponent {}
