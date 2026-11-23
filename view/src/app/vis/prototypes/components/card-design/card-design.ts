import { Component } from '@angular/core';
import { LibraryCardComponent } from '../../../../ui/library-card';
import { LIBRARY_MODELS } from '../../../visual-data';

/**
 * 原型组件：卡片设计。
 *
 * 用真实资产卡做标本，旁边标六层结构与尺寸；不另写一套卡。
 */
@Component({
  selector: 'app-proto-card-design',
  standalone: true,
  imports: [LibraryCardComponent],
  styleUrl: './card-design.scss',
  template: `
    <p class="set-label">卡片</p>

    <div class="spec-grid">
      <div class="spec-stage">
        <md-library-card [model]="model" cover="/samples/shot-2.jpg" />
        <span class="spec-hint">hover / focus 展开详情</span>
      </div>

      <ol class="spec-list">
        <li><b>① 封面</b><span>家族色渐变 + 点阵 + 家族码水印；有图时铺图并隐藏纹样。</span></li>
        <li><b>② 身份行</b><span>32 × 32 标识块，右侧家族 / 作者两行。</span></li>
        <li><b>③ 原站</b><span>右上角固定出口，本地导入无原站时留空。</span></li>
        <li><b>④ 状态槽</b><span>左状态 · 细线 · 右大小；本地库看磁盘，发现看下载 / 点赞。</span></li>
        <li><b>⑤ 分类标签</b><span>只放一枚：文件类型或工作流分组。</span></li>
        <li><b>⑥ 动作行</b><span>⋯ 在左，唯一主按钮在右；危险动作收进菜单。</span></li>
      </ol>
    </div>

    <p class="set-label">尺寸与 token</p>
    <div class="spec-table">
      <table>
        <thead>
          <tr><th scope="col">Token</th><th scope="col">值</th><th scope="col">用途</th></tr>
        </thead>
        <tbody>
          @for (row of tokens; track row.token) {
            <tr>
              <td class="mono">{{ row.token }}</td>
              <td class="mono">{{ row.value }}</td>
              <td>{{ row.use }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ProtoCardDesignComponent {
  readonly model = LIBRARY_MODELS[0];

  readonly tokens = [
    { token: '--card-radius', value: '24px', use: '卡片圆角' },
    { token: '--card-mark-size', value: '32px', use: '身份行标识块' },
    { token: '--card-title-size', value: '13px', use: '卡片标题' },
    { token: '--card-meta-size', value: '11px', use: '类别 / 规格' },
    { token: '--card-action-height', value: '28px', use: '主按钮高度' },
    { token: '--card-shadow', value: '--ui-shadow', use: '卡面阴影' },
  ];
}
