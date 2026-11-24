import { Component, signal } from '@angular/core';
import { BadgeComponent } from '../ui/badge';
import { ChipComponent } from '../ui/chip';
import { SectionBlockComponent } from '../ui/section-block';
import { SegmentedComponent } from '../ui/segmented';
import type { SegmentedOption } from '../ui/segmented';
import { VisualPageComponent } from './visual-page';

/** 胶囊：badge 表达状态（语义色），chip 表达筛选（可点），pill 表达分类（只读中性）。 */
@Component({
  selector: 'app-vis-pills',
  imports: [
    BadgeComponent,
    ChipComponent,
    SectionBlockComponent,
    SegmentedComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="胶囊"
      hint="badge 只读状态，chip 可点筛选，pill 只读分类；分类标签一律中性，避免一墙红黄绿。"
    >
      <ui-section title="筛选与分类" pill="Filter">
        <div class="row">
          <span class="row-label">Filter chip</span>
          <ui-chip [active]="filter() === 'all'" (picked)="filter.set('all')" [count]="128">
            全部
          </ui-chip>
          <ui-chip [active]="filter() === 'installed'" (picked)="filter.set('installed')">
            已安装
          </ui-chip>
          <ui-chip [active]="filter() === 'selected'" (picked)="filter.set('selected')">
            已选中
          </ui-chip>
          <ui-chip [disabled]="true" [count]="0">不可用</ui-chip>
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
          <ui-badge tone="gray">未登记</ui-badge>
          <ui-badge tone="blue">已在库</ui-badge>
          <ui-badge tone="green">已安装</ui-badge>
          <ui-badge tone="orange">已禁用</ui-badge>
          <ui-badge tone="red">错误</ui-badge>
        </div>

        <div class="row">
          <span class="row-label">Segmented</span>
          <ui-segmented [options]="views" [(value)]="view" label="安装状态" />
        </div>
      </ui-section>

      <ui-section title="选哪一个" pill="Rules" [plain]="true">
        <ul class="rules">
          <li><b>Badge</b>：只读状态，必须带语义色；不要给分类用红黄绿。</li>
          <li><b>Chip</b>：可点的筛选，最多一行；带计数放右侧，等宽字体。</li>
          <li><b>Pill</b>：只读分类，一律中性；超过 5 个收成「+N」。</li>
          <li><b>Segmented</b>：少量互斥视图（≤3 项）；再多就换 chip 行。</li>
        </ul>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisPillsComponent {
  readonly filter = signal('all');
  readonly view = signal('installed');

  readonly views: SegmentedOption[] = [
    { key: 'all', label: '全部' },
    { key: 'installed', label: '已安装' },
    { key: 'missing', label: '未安装' },
  ];
}
