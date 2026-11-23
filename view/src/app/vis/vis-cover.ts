import { Component } from '@angular/core';
import { CoverPlateComponent } from '../ui/cover-plate';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

/**
 * 视觉设计：封面与纹样。
 *
 * 封面不是图片占位，而是可复用的家族色 / 纹样 / 家族码构图；
 * 这里直接渲染产品侧的 app-cover-plate，避免另画一套。
 */
@Component({
  selector: 'app-vis-cover',
  standalone: true,
  imports: [CoverPlateComponent, SectionBlockComponent, VisualPageComponent],
  styleUrl: './vis-cover.scss',
  template: `
    <app-visual-page title="封面与纹样">
      <ui-section title="家族封面" pill="Family">
        <div class="cover-grid">
          @for (item of families; track item.name) {
            <figure class="cover-demo">
              <app-cover-plate [model]="item" />
              <figcaption>{{ item.name }}</figcaption>
            </figure>
          }
        </div>
      </ui-section>

      <ui-section title="纹样变体" pill="Motif">
        <div class="cover-grid motifs">
          @for (variant of motifs; track variant) {
            <figure class="cover-demo">
              <app-cover-plate [model]="motifModel" [motif]="variant" ratio="fill" [showMotif]="true" />
              <figcaption>mo-{{ variant }}</figcaption>
            </figure>
          }
        </div>
      </ui-section>

      <ui-section title="照片封面" pill="Photo">
        <div class="cover-grid">
          <figure class="cover-demo">
            <app-cover-plate [model]="photoModel" />
            <figcaption>真实图压在蒙版下</figcaption>
          </figure>
          <figure class="cover-demo">
            <app-cover-plate [model]="photoModel" [motif]="2" />
            <figcaption>同图 · 纹样已隐藏</figcaption>
          </figure>
        </div>
      </ui-section>

      <ui-section title="说明" pill="Notes" [plain]="true">
        <ul class="color-rules">
          <li><b>统一来源</b>：封面、纹样与家族码全部来自 <code>app-cover-plate</code>，卡片不再自绘封面。</li>
          <li><b>两种状态</b>：没有真实图时用家族色 + 纹样 + 家族码兜底；有图时铺图并隐藏纹样。</li>
          <li><b>卡片封面</b>使用点阵 + 家族码水印；列表缩略图保留原纹样，不缩放同一套构图。</li>
          <li><b>颜色</b>只取家族色板；同一家族在浅色 / 深色主题各有一套底与文字色。</li>
        </ul>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisCoverComponent {
  readonly families = [
    { name: 'FLUX.1-dev', tags: ['FLUX'] },
    { name: 'RealVisXL V4', tags: ['SDXL'] },
    { name: 'Qwen-Image-Edit', tags: ['Qwen'] },
    { name: 'Wan2.2 T2V', tags: ['WAN'] },
    { name: 'HunyuanVideo', tags: ['Hunyuan'] },
    { name: 'unrecognized-model', tags: [] },
  ];

  readonly motifModel = { name: 'FLUX.1-dev', tags: ['FLUX'] };
  readonly photoModel = {
    name: 'FLUX.1-dev',
    tags: ['FLUX'],
    image: '/samples/shot-4.jpg',
  };

  readonly motifs = [0, 1, 2, 3, 4];
}
