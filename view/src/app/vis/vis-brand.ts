import { Component, computed, inject } from '@angular/core';
import { ThemeService } from '../core/theme.service';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { VisualPageComponent } from './visual-page';
import { InnerCardComponent } from '../ui/inner-card';

interface MarkVariant {
  key: string;
  name: string;
  file: string;
  size: string;
  use: string;
}

/** 标识：MIN / MID / MAX 三种展翅 + black-line / white-line 线稿。 */
@Component({
  selector: 'app-vis-brand',
  standalone: true,
  imports: [
    InnerCardComponent,SectionBlockComponent, TableComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="标识"
      hint="MIN / MID / MAX 三种展翅，加 black-line / white-line 两种线稿，共 5 个 SVG 资产。"
    >
      <div class="brand-page">
        <ui-section title="组合标" pill="Brand">
            <div class="lockup-row">
              <ui-inner-card class="brand-lockup">
                <span class="brand-logo" aria-hidden="true">
                  <img src="/brand/cicada-max.svg" alt="" />
                </span>
                <span class="wordmark">
                  SiMuseor
                  <small>剧集导演台</small>
                </span>
              </ui-inner-card>

              <p class="lockup-note">
                蝉形只做辅助图形，不进入页头、空状态、弹层与错误态。字标固定
                <b>Barlow Condensed 400 / 20px</b>，副标走中文 UI 字体且不加字距。
              </p>
            </div>
          </ui-section>

        <ui-section title="三种展翅" pill="5 个 SVG 资产">
            <div class="mark-list">
              @for (v of variants; track v.key) {
                <article class="mark-row">
                  <ui-inner-card class="variant-art">
                    <img [src]="v.file" [alt]="v.name" />
                  </ui-inner-card>
                  <div class="variant-meta">
                    <b>{{ v.name }}</b>
                    <span>{{ v.size }}</span>
                    <small>{{ v.use }}</small>
                  </div>
                </article>
              }

              <article class="mark-row">
                <ui-inner-card class="line-art-card">
                  <img
                    [src]="isDark() ? '/brand/cicada-white-line.svg' : '/brand/cicada-black-line.svg'"
                    [alt]="(isDark() ? 'white-line' : 'black-line') + ' 线稿'"
                  />
                </ui-inner-card>
                <div class="variant-meta">
                  <b>{{ isDark() ? 'white-line' : 'black-line' }}</b>
                  <span>{{ isDark() ? '单色线稿 · 深色主题' : '单色线稿 · 浅色主题' }}</span>
                  <small>{{ isDark() ? '用于深色封面、终端与视频片头' : '用于文档、印章、低彩印刷' }}</small>
                </div>
              </article>
            </div>
          </ui-section>

        <ui-section title="尺寸与用途" pill="Usage"><ui-table>
<table>
              <thead>
                <tr>
                  <th scope="col">资产</th>
                  <th scope="col">画布</th>
                  <th scope="col">建议尺寸</th>
                  <th scope="col">用途</th>
                </tr>
              </thead>
              <tbody>
                @for (row of usage; track row.asset) {
                  <tr>
                    <td class="mono">{{ row.asset }}</td>
                    <td class="mono">{{ row.canvas }}</td>
                    <td>{{ row.size }}</td>
                    <td>{{ row.use }}</td>
                  </tr>
                }
              </tbody>
            </table>
</ui-table>
        </ui-section>
      </div>
    </app-visual-page>
  `,
})
export class VisBrandComponent {
  private readonly theme = inject(ThemeService);
  readonly isDark = computed(() => this.theme.theme() === 'dark');

  readonly variants: MarkVariant[] = [
    {
      key: 'min',
      name: 'MIN',
      file: '/brand/cicada-min.svg',
      size: '309 × 641',
      use: '16–32px',
    },
    {
      key: 'mid',
      name: 'MID',
      file: '/brand/cicada-mid.svg',
      size: '889 × 641',
      use: '40–96px',
    },
    {
      key: 'max',
      name: 'MAX',
      file: '/brand/cicada-max.svg',
      size: '1385 × 643',
      use: '120px+',
    },
  ];

  readonly usage = [
    { asset: 'cicada-min.svg', canvas: '309 × 641', size: '16 / 24 / 32', use: 'favicon、侧栏小标' },
    { asset: 'cicada-mid.svg', canvas: '889 × 641', size: '40 / 48 / 64', use: '卡片角标、紧凑页头' },
    { asset: 'cicada-max.svg', canvas: '1385 × 643', size: '96 / 128 / 256', use: '组合标、启动画面' },
    { asset: 'cicada-black-line.svg', canvas: '1405 × 671', size: '任意等比', use: '浅色底单色线稿' },
    { asset: 'cicada-white-line.svg', canvas: '1405 × 671', size: '任意等比', use: '深色底单色线稿' },
  ];
}
