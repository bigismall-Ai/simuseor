import { Component } from '@angular/core';
import { CardMarkComponent } from '../../../../ui/card-mark';
import { LibraryCardComponent } from '../../../../ui/library-card';
import { ModelCardComponent } from '../../../../ui/model-card';
import { TableComponent } from '../../../../ui/table';
import { WorkflowCardComponent } from '../../../../ui/workflow-card';
import type { SearchItem } from '../../../../core/types';
import { LIBRARY_MODELS, SEARCH_ITEMS, WORKFLOWS } from '../../../visual-data';

/**
 * 原型组件：卡片设计。
 *
 * 三张真实资产卡并排，⋯ 菜单用 `menuPinned` 定格展开 ——
 * 大小、布局、按钮、菜单都来自同一套 `asset-card.css`，这里只加标注。
 */
@Component({
  selector: 'app-proto-card-design',
  imports: [
    CardMarkComponent,
    LibraryCardComponent,
    ModelCardComponent,
    TableComponent,
    WorkflowCardComponent,
  ],
  styleUrl: './card-design.scss',
  template: `
    <p class="set-label">三种卡片 · 同一套骨架</p>
    <p class="set-lead">
      本地库卡 / 发现卡 / 工作流卡共用同一份外壳与动作行；这里把三张卡的 ⋯ 菜单定格展开，
      便于逐个对齐按钮、菜单与信息层级。
    </p>

    <div class="card-row">
      <div class="card-cell">
        <p class="cell-label">本地库卡</p>
        <md-library-card
          [model]="library"
          cover="/samples/shot-2.jpg"
          [menuPinned]="true"
        />
        <p class="cell-menu"><b>⋯ 菜单</b>删除模型</p>
      </div>

      <div class="card-cell">
        <p class="cell-label">发现卡</p>
        <md-model-card
          [items]="[discover]"
          cover="/samples/shot-4.jpg"
          [menuPinned]="true"
        />
        <p class="cell-menu"><b>⋯ 菜单</b>原站链接（Hugging Face / Civitai）</p>
      </div>

      <div class="card-cell">
        <p class="cell-label">工作流卡</p>
        <app-workflow-card [it]="workflow" [menuPinned]="true" />
        <p class="cell-menu"><b>⋯ 菜单</b>运行 / 在编辑器中打开 / 删除工作流</p>
      </div>
    </div>

    <p class="set-label">身份行 · 厂牌位</p>
    <div class="ident-demo">
      <ui-card-mark model="flux1-dev.safetensors" />
      <span class="ident-text">
        <b>FLUX</b>
        <span>black-forest-labs</span>
      </span>
      <span class="ident-tip">32 × 32，与 /vis/prototypes/components/families 同一个 ui-card-mark</span>
    </div>

    <p class="set-label">结构六层</p>
    <ol class="spec-list">
      <li><b>① 封面</b><span>家族色 + 点阵 + 家族码水印；有真实照片时铺图并隐藏纹样。</span></li>
      <li><b>② 身份行</b><span>32 × 32 厂牌位（ui-card-mark）+ 右侧两行：名称在上、作者/来源在下。</span></li>
      <li><b>③ 原站</b><span>右上角固定出口；本地导入与本地工作流没有原站时留空。</span></li>
      <li><b>④ 状态槽</b><span>左状态 · 细线 · 右大小；本地库看磁盘，发现看下载，工作流看文件体积。</span></li>
      <li><b>⑤ 分类标签</b><span>恰好一枚，用 ui-badge（sm）表达文件类型 / 分组 / 节点类。</span></li>
      <li><b>⑥ 动作行</b><span>⋯ 在左并弹出菜单，唯一主按钮在右；危险动作收进菜单。</span></li>
    </ol>

    <p class="set-label">尺寸与 token</p>
    <ui-table>
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
    </ui-table>

    <p class="set-note">
      遮罩比上一版更透（86% → 72% → 34%），并在顶部多铺 2px，避免在照片上切出硬边。
      卡片圆角跟随列表，统一 16px。
    </p>
  `,
})
export class ProtoCardDesignComponent {
  readonly library = LIBRARY_MODELS[1];
  readonly discover: SearchItem = {
    ...SEARCH_ITEMS[0],
    url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
  };
  readonly workflow = WORKFLOWS[0];

  readonly tokens = [
    { token: '--card-radius', value: '16px', use: '卡片与列表一致' },
    { token: '--card-mark-size', value: '32px', use: '身份行厂牌位' },
    { token: '--card-title-size', value: '13px', use: '卡片标题' },
    { token: '--card-meta-size', value: '11px', use: '类别 / 规格' },
    { token: '--card-tag-size', value: '9.5px', use: 'ui-badge sm 标签' },
    { token: '--card-action-height', value: '28px', use: '主按钮与 ⋯' },
    { token: '--card-shadow', value: '--ui-shadow', use: '卡面阴影' },
  ];
}
