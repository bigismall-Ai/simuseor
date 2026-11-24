import { Component } from '@angular/core';
import { HubCardComponent } from '../../ui/hub-card';
import { LibraryCardComponent } from '../../ui/library-card';
import { ModelCardComponent } from '../../ui/model-card';
import { NodeCardComponent } from '../../ui/node-card';
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
    LibraryCardComponent,
    ModelCardComponent,
    NodeCardComponent,
    WorkflowCardComponent,
  ],
  styleUrl: './cards.scss',
  template: `
    <div class="card-set">
      <p class="set-label">本地库</p>
      <div class="card-grid">
        @for (model of libraryModels; track model.id) {
          <md-library-card [model]="model" [cover]="coverFor($index)" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">发现</p>
      <div class="card-grid">
        @for (item of searchItems; track item.id) {
          <md-model-card [items]="[item]" [cover]="$index === 0 ? '/samples/shot-4.jpg' : ''" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">工作流 · 本地</p>
      <div class="card-grid">
        @for (workflow of workflows; track workflow.name) {
          <app-workflow-card [it]="workflow" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">工作流 · 发现</p>
      <div class="card-grid">
        @for (hub of hubWorkflows; track hub.id) {
          <md-hub-card [item]="hub" />
        }
      </div>
    </div>

    <div class="card-set">
      <p class="set-label">节点包</p>
      <div class="card-grid">
        @for (node of nodePacks; track node.id) {
          <md-node-card [item]="node" />
        }
      </div>
    </div>
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

  coverFor(index: number): string {
    return index === 0 ? '/samples/shot-2.jpg' : '';
  }
}
