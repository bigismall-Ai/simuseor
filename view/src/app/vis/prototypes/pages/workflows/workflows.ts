import { Component, computed, signal } from '@angular/core';
import { BadgeComponent } from '../../../../ui/badge';
import { ChipComponent } from '../../../../ui/chip';
import { EmptyComponent } from '../../../../ui/empty';
import { GridComponent } from '../../../../ui/grid';
import { InputComponent } from '../../../../ui/input';
import { NoticeComponent } from '../../../../ui/notice';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { PanelComponent } from '../../../../ui/panel';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { SegmentedComponent } from '../../../../ui/segmented';
import { TableComponent } from '../../../../ui/table';
import { UiButtonComponent } from '../../../../ui/button';
import { UiMaterialModule } from '../../../../ui/material';
import { WorkflowCardComponent } from '../../../../ui/workflow-card';
import { ProtoShellComponent } from '../../proto-shell';
import { WORKFLOWS } from '../../../visual-data';
import type { LocalWorkflow } from '../../../../core/types';

type WorkflowTask = 'txt2img' | 'img2img' | 'video' | 'upscale';

/** 运行状态与资产状态分开：缺模型是「资产不完整」，失败是「上次运行挂了」。 */
type WorkflowRun = 'ready' | 'missing' | 'running' | 'failed';

interface WorkflowEntry extends LocalWorkflow {
  task: WorkflowTask;
  run: WorkflowRun;
  /** 最近一次运行 / 正在运行的描述 */
  lastRun: string;
  /** 运行中才有：0–100 */
  progress?: number;
  /** 失败原因或运行备注 */
  runNote?: string;
}

/** visual-data 里的四条顺序：wan22-t2v / flux1-dev / qwen-txt2img / broken-workflow。 */
const [VIDEO_BASE, FLUX_BASE, QWEN_BASE, BROKEN_BASE] = WORKFLOWS;

/**
 * VIS 原型 · 工作流页。
 *
 * 卡片网格 + 列表两种看法共用同一份筛选与选中状态；运行状态不写进卡片，
 * 而是压在卡片下方的一条状态带里，避免和「缺依赖」混成一个「异常」。
 * 数据写在组件里，不接后端。
 */
@Component({
  selector: 'app-proto-workflows',
  imports: [
    ProtoShellComponent,
    PageHeaderComponent,
    SectionBlockComponent,
    PanelComponent,
    BadgeComponent,
    EmptyComponent,
    ChipComponent,
    GridComponent,
    NoticeComponent,
    SegmentedComponent,
    TableComponent,
    UiButtonComponent,
    InputComponent,
    WorkflowCardComponent,
    UiMaterialModule,
  ],
  styleUrl: './workflows.scss',
  template: `
    <app-proto-shell active="workflows" title="工作流" hint="本地工作流的状态、依赖与运行记录">
      <div class="page">
        <ui-page-header
          kicker="WORKFLOWS · LIBRARY"
          title="工作流"
          hint="本地工作流：看它依赖什么、缺什么、上次跑得怎么样。"
        >
          <ui-button variant="secondary" type="button" (click)="importWorkflow()">
            <mat-icon svgIcon="app:download" aria-hidden="true" />
            导入工作流
          </ui-button>
          <ui-button variant="primary" type="button" (click)="createWorkflow()">
            <mat-icon svgIcon="app:plus" aria-hidden="true" />
            新建
          </ui-button>
        </ui-page-header>

        @if (feedback()) {
          <div class="feedback">
            <ui-notice tone="info" icon="i" [dismissible]="true" (dismiss)="feedback.set('')">
              {{ feedback() }}
            </ui-notice>
          </div>
        }

        <div class="viewbar">
          <ui-segmented
            [options]="statusOptions()"
            [value]="view()"
            (valueChange)="setView($event)"
            label="工作流状态筛选"
          />
          <div class="viewbar-right">
            <span class="viewbar-label">显示方式</span>
            <ui-segmented
              [options]="modeOptions"
              [value]="mode()"
              (valueChange)="setMode($event)"
              label="显示方式"
            />
          </div>
        </div>

        <div class="filters" role="group" aria-label="筛选与排序">
          <ui-input
            class="search"
            size="sm"
            ariaLabel="搜索工作流"
            [value]="query()"
            (valueChange)="setQuery($event)"
            placeholder="搜索名称、基础模型或分组"
          >
            <svg input-leading viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" />
              <path d="M10.3 10.3 13.6 13.6" />
            </svg>
          </ui-input>

          <div class="type-chips" role="group" aria-label="按任务类型筛选">
            @for (option of taskOptions; track option.key) {
              <ui-chip
                [active]="typeFilter() === option.key"
                [count]="taskCount(option.key)"
                (picked)="pickTask(option.key)"
              >
                {{ option.label }}
              </ui-chip>
            }
          </div>

          <div class="sort">
            <span class="sort-label" aria-hidden="true">排序</span>
            <ui-segmented
              [options]="sortOptions"
              [value]="sortKey()"
              (valueChange)="setSort($event)"
              label="排序方式"
            />
          </div>
        </div>

        <div class="layout">
          <div class="main">
            @if (mode() === 'grid') {
              <ui-section title="本地工作流" [pill]="sectionPill()" [plain]="true">
                @if (filtered().length) {
                  <ui-grid>
                    @for (wf of filtered(); track wf.name) {
                      <div
                        class="wf-item"
                        [class.on]="selectedName() === wf.name"
                        (click)="select(wf)"
                      >
                        <app-workflow-card
                          [it]="wf"
                          (primary)="onPrimary($event)"
                          (action)="onCardAction($event)"
                        />

                        <div class="wf-strip">
                          <ui-badge [tone]="runTone(wf.run)">{{ runLabel(wf.run) }}</ui-badge>
                          <span class="wf-when">{{ wf.lastRun }}</span>
                          <span class="grow"></span>
                          @if (selectedName() === wf.name) {
                            <ui-badge tone="blue">已选中</ui-badge>
                          }
                          <ui-button
                            variant="ghost"
                            size="xs"
                            type="button"
                            [label]="'查看 ' + (wf.title || wf.name) + ' 的摘要'"
                            (click)="pick(wf, $event)"
                          >
                            摘要
                          </ui-button>
                        </div>

                        @if (wf.run === 'running') {
                          <div
                            class="wf-progress"
                            role="progressbar"
                            [attr.aria-label]="(wf.title || wf.name) + ' 运行进度'"
                            [attr.aria-valuenow]="wf.progress ?? 0"
                            aria-valuemin="0"
                            aria-valuemax="100"
                          >
                            <i [style.width.%]="wf.progress ?? 0"></i>
                          </div>
                        }
                      </div>
                    }
                  </ui-grid>
                } @else {
                  <ui-empty
                    icon="⌕"
                    [title]="emptyTitle()"
                    hint="放宽筛选，或导入一个工作流文件。"
                  />
                }
              </ui-section>
            } @else {
              <ui-section title="本地工作流" [pill]="sectionPill()">
                @if (filtered().length) {
                  <ui-table>
                    <table class="wf-table" aria-label="本地工作流列表">
                      <thead>
                        <tr>
                          <th scope="col">名称</th>
                          <th scope="col">基础模型</th>
                          <th scope="col">节点数</th>
                          <th scope="col">状态</th>
                          <th scope="col">最近运行</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (wf of filtered(); track wf.name) {
                          <tr [class.on]="selectedName() === wf.name">
                            <td>
                              <span class="wf-name">
                                <button
                                  type="button"
                                  class="name-link"
                                  [attr.aria-pressed]="selectedName() === wf.name"
                                  (click)="select(wf)"
                                >
                                  {{ wf.title || wf.name }}
                                </button>
                                <span class="wf-sub">{{ wf.group || '未分组' }}</span>
                              </span>
                            </td>
                            <td class="mono">{{ wf.main_model || '本地工作流' }}</td>
                            <td class="num">{{ wf.nodes }}</td>
                            <td>
                              <span class="wf-state">
                                <ui-badge [tone]="runTone(wf.run)">{{ runLabel(wf.run) }}</ui-badge>
                                @if (selectedName() === wf.name) {
                                  <ui-badge tone="blue">已选中</ui-badge>
                                }
                              </span>
                            </td>
                            <td class="muted">{{ wf.lastRun }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </ui-table>
                } @else {
                  <ui-empty
                    icon="⌕"
                    [title]="emptyTitle()"
                    hint="放宽筛选，或导入一个工作流文件。"
                  />
                }
              </ui-section>
            }
          </div>

          <aside class="aside" aria-label="当前选中的工作流">
            <ui-panel kicker="Selection" title="当前选中的工作流">
              @if (selected(); as wf) {
                <ng-container ngProjectAs="[panel-actions]">
                  <div panel-actions>
                    <ui-badge [tone]="runTone(wf.run)">{{ runLabel(wf.run) }}</ui-badge>
                    @if (!selectedVisible()) {
                      <ui-badge tone="gray">不在当前筛选</ui-badge>
                    }
                  </div>
                </ng-container>

                <div class="sel">
                  <div class="sel-name">
                    <b>{{ wf.title || wf.name }}</b>
                    <span class="mono">{{ wf.path }}</span>
                  </div>

                  <dl class="sel-facts">
                    <div>
                      <dt>基础模型</dt>
                      <dd class="mono">{{ wf.main_model || '本地工作流' }}</dd>
                    </div>
                    <div>
                      <dt>节点</dt>
                      <dd>{{ wf.nodes }}</dd>
                    </div>
                    <div>
                      <dt>依赖模型</dt>
                      <dd>{{ depTotal(wf) }}</dd>
                    </div>
                    <div>
                      <dt>缺几个</dt>
                      <dd [class.warn]="missingTotal(wf) > 0">{{ missingSummary(wf) }}</dd>
                    </div>
                    <div>
                      <dt>最近运行</dt>
                      <dd>{{ wf.lastRun }}</dd>
                    </div>
                  </dl>

                  @if (wf.runNote) {
                    <p class="sel-note">{{ wf.runNote }}</p>
                  }

                  @if (wf.run === 'running') {
                    <div
                      class="wf-progress"
                      role="progressbar"
                      [attr.aria-label]="(wf.title || wf.name) + ' 运行进度'"
                      [attr.aria-valuenow]="wf.progress ?? 0"
                      aria-valuemin="0"
                      aria-valuemax="100"
                    >
                      <i [style.width.%]="wf.progress ?? 0"></i>
                    </div>
                  }

                  <div class="sel-acts">
                    @if (wf.run === 'missing') {
                      <ui-button variant="primary" type="button" (click)="fixSelected()">
                        补齐依赖
                      </ui-button>
                    } @else {
                      <ui-button
                        variant="primary"
                        type="button"
                        [disabled]="wf.run === 'running' || wf.run === 'failed'"
                        (click)="runSelected()"
                      >
                        运行
                      </ui-button>
                    }
                    <ui-button variant="secondary" type="button" (click)="editSelected()">
                      打开编辑器
                    </ui-button>
                  </div>

                  <p class="sel-hint">点卡片或列表行切换选中；这里只做原型，不跳转。</p>
                </div>
              } @else {
                <ui-empty title="还没有工作流" hint="导入一个工作流后会在这里显示摘要。" />
              }
            </ui-panel>
          </aside>
        </div>

        <ui-section title="这页的规则" [plain]="true">
          <ol class="rules">
            <li>
              <b>卡片只说资产。</b>卡片负责「这是什么、缺什么依赖」，运行状态放在卡片下方的
              状态带里，不往卡片里再塞一个徽标。
            </li>
            <li>
              <b>缺模型和运行失败是两件事。</b>缺模型是资产不完整（橙），运行失败是上一次执行
              出错（红），运行中是蓝；同一个「异常」词不混用。
            </li>
            <li>
              <b>「已就绪」包含运行中。</b>依赖齐全就有资格运行，正在跑不改变资产状态；
              失败的文件只出现在「全部」里。
            </li>
            <li>
              <b>筛选不改变选中。</b>选中的工作流被筛掉时，右栏保留并标注「不在当前筛选」，
              免得用户以为自己点丢了。
            </li>
            <li>
              <b>卡片 / 列表共用一套状态。</b>切换视图不丢搜索、类型、排序与选中；两种视图
              只是同一份数据的两种密度。
            </li>
            <li>
              <b>空结果留在内容区。</b>筛选条始终保留，用户可以在原地放宽条件，而不是回到页首。
            </li>
          </ol>
        </ui-section>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoWorkflowsComponent {
  readonly taskOptions: { key: WorkflowTask; label: string }[] = [
    { key: 'txt2img', label: '文生图' },
    { key: 'img2img', label: '图生图' },
    { key: 'video', label: '视频' },
    { key: 'upscale', label: '放大' },
  ];

  readonly sortOptions = [
    { key: 'recent', label: '最近修改' },
    { key: 'name', label: '名称' },
    { key: 'nodes', label: '节点数' },
  ];

  readonly modeOptions = [
    { key: 'grid', label: '卡片' },
    { key: 'list', label: '列表' },
  ];

  readonly catalog: WorkflowEntry[] = [
    {
      ...VIDEO_BASE,
      title: 'Wan 2.2 · 文生视频',
      model_slots: [
        {
          file: 'wan2.2-t2v.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'wan2.2-t2v.safetensors',
            node: 'UNETLoader',
            directory: 'diffusion_models',
            url: '',
            found_dir: 'diffusion_models',
          },
        ],
        missing: [],
      },
      task: 'video',
      run: 'ready',
      lastRun: '今天 14:22 · 42 秒',
    },
    {
      ...FLUX_BASE,
      title: 'FLUX.1 dev · 文生图',
      model_slots: [
        {
          file: 'flux1-dev.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'flux1-dev.safetensors',
            node: 'UNETLoader',
            directory: 'diffusion_models',
            url: '',
            found_dir: 'diffusion_models',
          },
        ],
        missing: [],
      },
      task: 'txt2img',
      run: 'running',
      lastRun: '运行中 · 2 分 41 秒',
      progress: 62,
    },
    {
      ...QWEN_BASE,
      title: 'Qwen Image · 文生图',
      model_slots: [
        {
          file: 'qwen-image.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      task: 'txt2img',
      run: 'missing',
      lastRun: '昨天 21:06 · 缺依赖',
      runNote: '缺 1 个模型：qwen-image.safetensors → diffusion_models。',
    },
    {
      ...BROKEN_BASE,
      task: 'img2img',
      run: 'failed',
      lastRun: '11-23 19:40 · 解析失败',
      runNote: '文件本身坏了：JSON 语法错误，第 12 行缺少逗号。修好文件后重新导入。',
    },
    {
      name: 'wan22-i2v.json',
      title: 'Wan 2.2 · 图生视频',
      path: '/workflows/wan22-i2v.json',
      folder: '',
      size: 19824640,
      mtime: 1764213000,
      nodes: 14,
      format: 'ui',
      main_model: 'wan2.2-i2v.safetensors',
      group: '视频',
      cover: '/samples/shot-4.jpg',
      model_slots: [
        {
          file: 'wan2.2-i2v.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'wan2.2-i2v.safetensors',
            node: 'UNETLoader',
            directory: 'diffusion_models',
            url: '',
            found_dir: 'diffusion_models',
          },
        ],
        missing: [],
      },
      node_deps: { have: [], missing: [], unknown: [] },
      task: 'img2img',
      run: 'ready',
      lastRun: '今天 11:08 · 1 分 36 秒',
    },
    {
      name: 'sdxl-inpaint.json',
      title: 'SDXL · 局部重绘',
      path: '/workflows/sdxl-inpaint.json',
      folder: '重绘',
      size: 3162112,
      mtime: 1763990400,
      nodes: 11,
      format: 'ui',
      main_model: 'sdxl_base_1.0.safetensors',
      group: '图生图',
      model_slots: [
        {
          file: 'sdxl_base_1.0.safetensors',
          node: 'CheckpointLoaderSimple',
          directory: 'checkpoints',
          url: '',
        },
        {
          file: 'controlnet_tile_sdxl.safetensors',
          node: 'ControlNetLoader',
          directory: 'controlnet',
          url: '',
        },
        {
          file: 'ip-adapter_sdxl.safetensors',
          node: 'IPAdapterModelLoader',
          directory: 'ipadapter',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'sdxl_base_1.0.safetensors',
            node: 'CheckpointLoaderSimple',
            directory: 'checkpoints',
            url: '',
            found_dir: 'checkpoints',
          },
        ],
        missing: [
          {
            file: 'controlnet_tile_sdxl.safetensors',
            node: 'ControlNetLoader',
            directory: 'controlnet',
            url: '',
          },
          {
            file: 'ip-adapter_sdxl.safetensors',
            node: 'IPAdapterModelLoader',
            directory: 'ipadapter',
            url: '',
          },
        ],
      },
      node_deps: {
        have: [],
        missing: [
          {
            id: 'ltdrdata/comfyui-impact-pack',
            name: 'ComfyUI Impact Pack',
            author: 'ltdrdata',
            repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
            node_count: 86,
            installable: true,
            covers: ['ImpactSAMLoader', 'FaceDetailer'],
          },
        ],
        unknown: [],
      },
      task: 'img2img',
      run: 'missing',
      lastRun: '11-22 09:30 · 缺依赖',
      runNote: '缺 2 个模型与 1 个节点包；补齐后即可载入画布。',
    },
    {
      name: 'flux-krea-txt2img.json',
      title: 'FLUX.1 Krea · 文生图',
      path: '/workflows/flux-krea-txt2img.json',
      folder: '',
      size: 8421376,
      mtime: 1764124800,
      nodes: 9,
      format: 'ui',
      main_model: 'flux1-krea-dev.safetensors',
      group: '文生图',
      cover: '/samples/shot-5.jpg',
      model_slots: [
        {
          file: 'flux1-krea-dev.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'flux1-krea-dev.safetensors',
            node: 'UNETLoader',
            directory: 'diffusion_models',
            url: '',
            found_dir: 'diffusion_models',
          },
        ],
        missing: [],
      },
      node_deps: { have: [], missing: [], unknown: [] },
      task: 'txt2img',
      run: 'ready',
      lastRun: '昨天 22:15 · 31 秒',
    },
    {
      name: 'ltx-video-i2v.json',
      title: 'LTX Video · 图生视频',
      path: '/workflows/ltx-video-i2v.json',
      folder: '视频',
      size: 5242880,
      mtime: 1764300000,
      nodes: 16,
      format: 'ui',
      main_model: 'ltx-video-0.9.7-distilled.safetensors',
      group: '视频',
      cover: '/samples/shot-6.jpg',
      model_slots: [
        {
          file: 'ltx-video-0.9.7-distilled.safetensors',
          node: 'UNETLoader',
          directory: 'diffusion_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: 'ltx-video-0.9.7-distilled.safetensors',
            node: 'UNETLoader',
            directory: 'diffusion_models',
            url: '',
            found_dir: 'diffusion_models',
          },
        ],
        missing: [],
      },
      node_deps: { have: [], missing: [], unknown: [] },
      task: 'video',
      run: 'running',
      lastRun: '运行中 · 3 分 05 秒',
      progress: 38,
    },
    {
      name: 'upscale-4x.json',
      title: '4× 放大 · 通用',
      path: '/workflows/upscale-4x.json',
      folder: '工具',
      size: 2101248,
      mtime: 1763827200,
      nodes: 5,
      format: 'ui',
      main_model: '4x-UltraSharp.safetensors',
      group: '放大',
      model_slots: [
        {
          file: '4x-UltraSharp.safetensors',
          node: 'UpscaleModelLoader',
          directory: 'upscale_models',
          url: '',
        },
      ],
      deps: {
        have: [
          {
            file: '4x-UltraSharp.safetensors',
            node: 'UpscaleModelLoader',
            directory: 'upscale_models',
            url: '',
            found_dir: 'upscale_models',
          },
        ],
        missing: [],
      },
      node_deps: { have: [], missing: [], unknown: [] },
      task: 'upscale',
      run: 'ready',
      lastRun: '11-21 16:04 · 18 秒',
    },
  ];

  readonly query = signal('');
  readonly typeFilter = signal('all');
  readonly sortKey = signal('recent');
  readonly view = signal('all');
  readonly mode = signal('grid');
  readonly selectedName = signal(this.catalog[0].name);
  readonly feedback = signal('');

  readonly statusOptions = computed(() => {
    const ready = this.catalog.filter((wf) => wf.run === 'ready' || wf.run === 'running').length;
    const missing = this.catalog.filter((wf) => wf.run === 'missing').length;
    return [
      { key: 'all', label: `全部 · ${this.catalog.length}` },
      { key: 'ready', label: `已就绪 · ${ready}` },
      { key: 'missing', label: `缺模型 · ${missing}` },
    ];
  });

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const type = this.typeFilter();
    const view = this.view();
    const list = this.catalog.filter((wf) => {
      if (type !== 'all' && wf.task !== type) return false;
      if (view === 'ready' && wf.run !== 'ready' && wf.run !== 'running') return false;
      if (view === 'missing' && wf.run !== 'missing') return false;
      if (!q) return true;
      const haystack = `${wf.name} ${wf.title ?? ''} ${wf.main_model ?? ''} ${wf.group ?? ''}`;
      return haystack.toLowerCase().includes(q);
    });

    const sort = this.sortKey();
    return [...list].sort((a, b) => {
      if (sort === 'name') {
        return (a.title ?? a.name).localeCompare(b.title ?? b.name, 'zh-Hans-CN');
      }
      if (sort === 'nodes') return b.nodes - a.nodes;
      return b.mtime - a.mtime;
    });
  });

  readonly selected = computed<WorkflowEntry | null>(
    () => this.catalog.find((wf) => wf.name === this.selectedName()) ?? null,
  );

  readonly selectedVisible = computed(() =>
    this.filtered().some((wf) => wf.name === this.selectedName()),
  );

  readonly sectionPill = computed(() => `${this.filtered().length} / ${this.catalog.length}`);

  readonly emptyTitle = computed(() => {
    const q = this.query().trim();
    if (q) return `没有匹配「${q}」的工作流`;
    if (this.typeFilter() !== 'all') return '这个类型下还没有工作流';
    if (this.view() === 'missing') return '没有缺依赖的工作流';
    if (this.view() === 'ready') return '还没有可运行的工作流';
    return '工作流目录是空的';
  });

  setView(value: string): void {
    this.view.set(value);
  }

  setMode(value: string): void {
    this.mode.set(value);
  }

  setSort(value: string): void {
    this.sortKey.set(value);
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  pickTask(key: string): void {
    this.typeFilter.update((current) => (current === key ? 'all' : key));
  }

  select(wf: WorkflowEntry): void {
    this.selectedName.set(wf.name);
  }

  pick(wf: WorkflowEntry, event: MouseEvent): void {
    event.stopPropagation();
    this.select(wf);
  }

  taskCount(key: string): number {
    return this.catalog.filter((wf) => wf.task === key).length;
  }

  runLabel(run: WorkflowRun): string {
    switch (run) {
      case 'ready':
        return '就绪';
      case 'missing':
        return '缺模型';
      case 'running':
        return '运行中';
      case 'failed':
        return '失败';
    }
  }

  runTone(run: WorkflowRun): 'green' | 'orange' | 'blue' | 'red' {
    switch (run) {
      case 'ready':
        return 'green';
      case 'missing':
        return 'orange';
      case 'running':
        return 'blue';
      case 'failed':
        return 'red';
    }
  }

  depTotal(wf: WorkflowEntry): number {
    const models = (wf.deps?.have.length ?? 0) + (wf.deps?.missing.length ?? 0);
    return models || (wf.model_slots?.length ?? 0);
  }

  missingTotal(wf: WorkflowEntry): number {
    return (wf.deps?.missing.length ?? 0) + (wf.node_deps?.missing.length ?? 0);
  }

  missingSummary(wf: WorkflowEntry): string {
    const models = wf.deps?.missing.length ?? 0;
    const nodes = wf.node_deps?.missing.length ?? 0;
    if (!models && !nodes) return '无缺失';
    const parts: string[] = [];
    if (models) parts.push(`${models} 模型`);
    if (nodes) parts.push(`${nodes} 节点包`);
    return `缺 ${parts.join(' · ')}`;
  }

  onPrimary(event: { item: LocalWorkflow; act: 'fix' | 'use' | 'edit' }): void {
    this.selectedName.set(event.item.name);
    if (event.act === 'fix') {
      this.feedback.set(`补齐依赖：${event.item.name}（原型不发起下载）。`);
      return;
    }
    this.feedback.set(`打开编辑器：${event.item.name}（原型不跳转）。`);
  }

  onCardAction(event: { item: LocalWorkflow; act: 'run' | 'edit' | 'delete' }): void {
    const name = event.item.title || event.item.name;
    this.feedback.set(
      event.act === 'run'
        ? `已把「${name}」加入队列（原型不发真实任务）。`
        : event.act === 'edit'
          ? `打开编辑器：${name}（原型不跳转）。`
          : `删除工作流「${name}」（原型不删除文件）。`,
    );
  }

  importWorkflow(): void {
    this.feedback.set('导入工作流会打开本地文件选择，这里只演示入口。');
  }

  createWorkflow(): void {
    this.feedback.set('新建会打开空白编辑器，这里只演示入口。');
  }

  runSelected(): void {
    const wf = this.selected();
    if (!wf) return;
    this.feedback.set(`已把「${wf.title || wf.name}」加入队列（原型不发真实任务）。`);
  }

  fixSelected(): void {
    const wf = this.selected();
    if (!wf) return;
    this.feedback.set(`补齐依赖：${wf.title || wf.name}（原型不发起下载）。`);
  }

  editSelected(): void {
    const wf = this.selected();
    if (!wf) return;
    this.feedback.set(`打开编辑器：${wf.title || wf.name}（原型不跳转）。`);
  }
}
