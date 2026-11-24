import { Component } from '@angular/core';
import { ProtoCardDesignComponent } from './components/card-design/card-design';
import { HubCardComponent } from '../../ui/hub-card';
import { LibraryCardComponent } from '../../ui/library-card';
import { ModelCardComponent } from '../../ui/model-card';
import { NodeCardComponent } from '../../ui/node-card';
import { TableComponent } from '../../ui/table';
import type { NodeCardItem } from '../../ui/node-card';
import { WorkflowCardComponent } from '../../ui/workflow-card';
import { LIBRARY_MODELS, SEARCH_ITEMS, WORKFLOWS } from '../visual-data';
import type { WorkflowItem } from '../../core/types';

/**
 * 原型组件：资产卡片。
 *
 * 直接渲染产品侧真实组件，不是静态样张：
 * 本地库卡、发现卡、本地工作流卡、发现工作流卡、节点包卡。
 */
@Component({
  selector: 'app-proto-cards',
  imports: [
    HubCardComponent,
    ProtoCardDesignComponent,
    LibraryCardComponent,
    ModelCardComponent,
    NodeCardComponent,
    TableComponent,
    WorkflowCardComponent,
  ],
  styleUrl: './cards.scss',
  template: `
    <p class="set-label">资产矩阵</p>
    <p class="set-lead">
      2 个状态 × 3 种资产。每格直接渲染产品组件，组件名标在卡下；共用层与差异层拆在下面。
    </p>

    <div class="matrix-wrap">
      <div class="matrix">
        <span class="m-corner" aria-hidden="true"></span>
        <span class="m-col">模型</span>
        <span class="m-col">工作流</span>
        <span class="m-col">节点</span>

        <span class="m-row">本地</span>
        <div class="m-cell">
          <md-library-card [model]="libraryModels[0]" cover="/samples/shot-2.jpg" />
          <code>md-library-card</code>
        </div>
        <div class="m-cell">
          <app-workflow-card [it]="workflows[0]" />
          <code>app-workflow-card</code>
        </div>
        <div class="m-cell">
          <md-node-card [item]="localNode" mode="library" />
          <code>md-node-card · mode=library</code>
        </div>

        <span class="m-row">发现</span>
        <div class="m-cell">
          <md-model-card [items]="[searchItems[0]]" cover="/samples/shot-4.jpg" />
          <code>md-model-card</code>
        </div>
        <div class="m-cell">
          <md-hub-card [item]="hubWorkflows[0]" />
          <code>md-hub-card</code>
        </div>
        <div class="m-cell">
          <md-node-card [item]="nodePacks[1]" mode="discover" />
          <code>md-node-card · mode=discover</code>
        </div>
      </div>
    </div>

    <p class="set-label">共用与差异</p>
    <ui-table>
      <table>
        <thead>
          <tr>
            <th scope="col">层</th>
            <th scope="col">共用</th>
            <th scope="col">按资产变</th>
            <th scope="col">按状态变</th>
          </tr>
        </thead>
        <tbody>
          @for (row of layers; track row.layer) {
            <tr>
              <td>{{ row.layer }}</td>
              <td>{{ row.shared }}</td>
              <td>{{ row.byKind }}</td>
              <td>{{ row.byState }}</td>
            </tr>
          }
        </tbody>
      </table>
    </ui-table>

    <p class="matrix-note">
      模型与工作流当前是「本地 / 发现各一个组件」，节点已收敛成「一个组件 + mode」。
      建议后续把前两者也并成 mode，少维护一份外壳；这轮先不动数据契约。
    </p>

    <!-- 结构与状态：从原「卡片」页并进来，保持一处维护 -->
    <app-proto-card-design />
  `,
})
export class ProtoCardsComponent {
  readonly libraryModels = LIBRARY_MODELS;
  readonly searchItems = SEARCH_ITEMS;
  readonly workflows = WORKFLOWS;

  readonly hubWorkflows: WorkflowItem[] = [
    {
      id: 'hub-wan22',
      name: 'Wan2.2 图生视频',
      author: 'Comfy-Org',
      source: 'huggingface',
      description: '把单张图扩成 5 秒视频的官方工作流。',
      downloads: 18400,
      likes: 962,
      tags: ['视频', '图生视频'],
      task: '视频',
      url: 'https://huggingface.co/Comfy-Org/workflows',
      updated_at: '2026-11-18',
      files: ['wan2.2-i2v.json', 'wan2.2-t2v.json'],
      file_count: 2,
      thumbnail: '/samples/shot-5.jpg',
      requires: ['wan2_2_t2v_14b.safetensors'],
    },
    {
      id: 'hub-flux-krea',
      name: 'FLUX.1 Krea · 文生图',
      author: 'Krea',
      source: 'comfyhub',
      description: '带 Krea 风格权重的文生图工作流。',
      downloads: 7200,
      likes: 418,
      tags: ['文生图'],
      task: '文生图',
      url: 'https://comfyhub.example/flux-krea',
      updated_at: '2026-11-12',
      files: ['flux-krea-txt2img.json'],
      file_count: 1,
      thumbnail: '/samples/shot-6.jpg',
    },
    {
      id: 'hub-upscale',
      name: '4× 放大 · 通用',
      author: 'community',
      source: 'github',
      description: 'UltraSharp 权重 + 分块放大，适合 4K 输出。',
      downloads: 3100,
      likes: 205,
      tags: ['放大'],
      task: '放大',
      url: 'https://github.com/example/comfy-workflows',
      updated_at: '2026-10-30',
      files: ['upscale-4x.json'],
      file_count: 1,
    },
  ];

  readonly nodePacks: NodeCardItem[] = [
    {
      id: 'manager',
      name: 'ComfyUI-Manager',
      author: 'ltdrdata',
      repo: 'https://github.com/ltdrdata/ComfyUI-Manager',
      category: '管理工具',
      description: '节点、模型与依赖的统一管理面板。',
      node_count: 0,
      nodes: [],
      installable: true,
      install_type: 'git',
      installed: true,
    },
    {
      id: 'impact',
      name: 'ComfyUI-Impact-Pack',
      author: 'ltdrdata',
      repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
      category: '检测与修复',
      description: '脸部修复、遮罩与检测节点集合。',
      node_count: 128,
      nodes: ['FaceDetailer', 'SAMLoader', 'MaskDetailer'],
      installable: true,
      install_type: 'git',
      installed: false,
      needs: ['segment-anything'],
    },
    {
      id: 'videhelper',
      name: 'ComfyUI-VideoHelperSuite',
      author: 'Kosinkadink',
      repo: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
      category: '视频',
      description: '视频读写、帧插值与合帧节点。',
      node_count: 24,
      nodes: ['VHS_LoadVideo', 'VHS_VideoCombine'],
      installable: true,
      install_type: 'git',
      installed: true,
    },
  ];

  readonly localNode: NodeCardItem = {
    ...this.nodePacks[0],
    installed: true,
    tracked: true,
    dir: '/extensions/ComfyUI-Manager',
    requirements: true,
    commit: 'a1b2c3d',
  };

  readonly layers = [
    { layer: '外壳', shared: '圆角 / 阴影 / 描边 / 网格位置', byKind: '—', byState: '—' },
    { layer: '封面', shared: 'app-cover-plate', byKind: '纹样 / 家族色 / 节点铭牌', byState: '有图 / 无图' },
    { layer: '身份行', shared: 'ui-card-mark + 两行 + ui-card-kebab', byKind: '第一行内容', byState: '—' },
    { layer: '标题 / 详情', shared: 'ui-card-body', byKind: '标题与 meta', byState: '—' },
    { layer: '状态槽', shared: '.acard-slot 几何', byKind: '左右字段', byState: '磁盘 vs 下载' },
    { layer: '标签', shared: 'ui-badge（sm）', byKind: '文件类型 / 分组 / 节点类', byState: '—' },
    { layer: '动作行', shared: 'ui-card-origin + .acard-primary', byKind: '主按钮文案', byState: '打开 / 下载 / 安装' },
    { layer: '菜单', shared: 'ui-card-kebab + ui-card-menu', byKind: '条目内容', byState: '删除 / 运行 / 卸载' },
  ];

  coverFor(index: number): string {
    return index === 0 ? '/samples/shot-2.jpg' : '';
  }
}
