import { Component } from '@angular/core';
import { LabelComponent } from '../../../../ui/label';

/** 原型组件：滚动条。导航 / 页面 / 表格横向共用一套样式，只改宽度。 */
@Component({
  selector: 'app-proto-scrollbar',
  standalone: true,
  imports: [
    LabelComponent],
  styleUrl: './scrollbar.scss',
  template: `
    <ui-label>滚动条</ui-label>

    <div class="sb-grid">
      <section class="sb-case">
        <p class="case-label">导航 · 6px · 贴右边缘</p>
        <div class="sb-rail ui-scrollbar" aria-label="导航滚动示例">
          @for (row of rows; track row) {
            <span class="rail-row" [class.active]="row === '输入框'">{{ row }}</span>
          }
        </div>
      </section>

      <section class="sb-case">
        <p class="case-label">页面 · 10px</p>
        <div class="sb-page ui-scrollbar" aria-label="页面滚动示例">
          <div class="page-row" role="presentation">
            <span>模型</span><span>来源</span><span>大小</span><span>状态</span>
          </div>
          @for (row of pageRows; track row) {
            <div class="page-row">
              <span>{{ row.name }}</span>
              <span>{{ row.source }}</span>
              <span>{{ row.size }}</span>
              <span>{{ row.status }}</span>
            </div>
          }
        </div>
      </section>

      <section class="sb-case span">
        <p class="case-label">表格 · 横向 10px</p>
        <div class="sb-table ui-scrollbar" aria-label="横向滚动示例">
          <div class="table-inner">
            <div class="table-row head">
              @for (col of columns; track col) {
                <span>{{ col }}</span>
              }
            </div>
            @for (row of pageRows; track row) {
              <div class="table-row">
                <span>{{ row.name }}</span><span>{{ row.source }}</span><span>{{ row.size }}</span>
                <span>{{ row.status }}</span><span>2026-11-20</span><span>{{ row.source }}</span>
                <span>sha256:8f3c…a1d2</span><span>models/diffusion_models</span>
              </div>
            }
          </div>
        </div>
      </section>
    </div>

    <ui-label>约束</ui-label>
    <ul class="sb-rules">
      <li><b>一套样式</b>：页面、导航和横向滚动都用 <code>.ui-scrollbar</code>，只改 <code>--scrollbar-size</code>。</li>
      <li><b>滚动条属于容器</b>：导航 / 页面保持全宽、无圆角卡框；横向滚动放在表格卡片里。</li>
      <li><b>导航</b> 6px、收起 4px；<b>页面</b> 10px；都贴容器右边缘。</li>
      <li><b>滑块</b>用 <code>--scrollbar-thumb</code>，悬停加深；轨道透明。</li>
      <li><b>Firefox</b> 走 <code>scrollbar-width / color</code>，Chromium / Safari 走 WebKit 伪元素。</li>
    </ul>
  `,
})
export class ProtoScrollbarComponent {
  readonly rows = [
    '总览',
    '标识',
    '色彩',
    '封面与纹样',
    '背景',
    '图标',
    '布局',
    '圆角',
    '按钮',
    '输入框',
    '胶囊',
    '表格',
    '空状态',
    '模态框',
    '卡片',
    '资产卡片',
    '侧边导航',
    '滚动条',
  ];

  readonly pageRows = [
    { name: 'flux1-dev.safetensors', source: 'Hugging Face', size: '23.8 GB', status: '已安装' },
    { name: 'RealVisXL_V4.0_lightning', source: 'Civitai', size: '6.5 GB', status: '已在库' },
    { name: 'ltx-video-0.9.7-distilled', source: 'Hugging Face', size: '5.2 GB', status: '已安装' },
    { name: 'wan22-t2v-14b', source: 'Civitai', size: '14.2 GB', status: '未登记' },
    { name: 'qwen-image-edit', source: 'ModelScope', size: '20.4 GB', status: '已安装' },
    { name: 'sdxl-inpaint', source: 'Civitai', size: '3.1 GB', status: '草稿' },
    { name: 'hunyuan-video-1.5', source: 'ModelScope', size: '8.4 GB', status: '已安装' },
    { name: 'cogvideox-5b', source: 'ModelScope', size: '10.4 GB', status: '已禁用' },
    { name: 'noobai-xl-vpred', source: 'Civitai', size: '6.9 GB', status: '已安装' },
    { name: 'kolors-v1.5', source: 'ModelScope', size: '8.1 GB', status: '已在库' },
    { name: 'lumina-image-v2', source: 'Hugging Face', size: '7.4 GB', status: '未登记' },
    { name: 'mochi-1-preview', source: 'Hugging Face', size: '22.0 GB', status: '已安装' },
    { name: 'pixart-sigma', source: 'ModelScope', size: '2.1 GB', status: '草稿' },
    { name: 'playground-v2.5', source: 'Civitai', size: '5.6 GB', status: '已安装' },
  ];

  readonly columns = ['模型', '来源', '大小', '状态', '更新时间', '作者', '校验', '路径'];
}
