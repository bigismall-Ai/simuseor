import { Component } from '@angular/core';
import { CardBodyComponent } from '../../ui/card-body';
import { CardKebabComponent } from '../../ui/card-kebab';
import { CardMarkComponent } from '../../ui/card-mark';
import { CardOriginComponent } from '../../ui/card-origin';
import { CardMenuComponent } from '../../ui/card-menu';
import type { CardMenuItem } from '../../ui/card-menu';
import { HubCardComponent } from '../../ui/hub-card';
import { LibraryCardComponent } from '../../ui/library-card';
import { ModelCardComponent } from '../../ui/model-card';
import { NodeCardComponent } from '../../ui/node-card';
import { TableComponent } from '../../ui/table';
import type { NodeCardItem } from '../../ui/node-card';
import { WorkflowCardComponent } from '../../ui/workflow-card';
import { LIBRARY_MODELS, SEARCH_ITEMS, WORKFLOWS } from '../visual-data';
import type { SearchItem, WorkflowItem } from '../../core/types';

/**
 * 原型组件：资产卡片。
 *
 * 直接渲染产品侧真实组件，不是静态样张：
 * 本地库卡、发现卡、本地工作流卡、发现工作流卡、节点包卡。
 */
@Component({
  selector: 'app-proto-cards',
  imports: [
    CardBodyComponent,
    CardKebabComponent,
    CardMarkComponent,
    CardMenuComponent,
    CardOriginComponent,
    HubCardComponent,
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
      <table class="layers">
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

    <p class="set-label">展开态 · hover / focus</p>
    <p class="set-lead">
      hover 或键盘 focus 后，acard-body 向上展开：类别、状态槽、分类标签、动作行（原站图标 + 主按钮）。
      下面是同一套展开结果的静态样张，不依赖鼠标。
    </p>
    <div class="card-row card-expanded">
      <div class="card-cell">
        <p class="cell-label">本地库卡</p>
        <md-library-card [model]="specLibrary" cover="/samples/shot-2.jpg" />
        <p class="cell-menu">类别 · 在库 · 大小 · 文件类型 · 原站图标</p>
      </div>
      <div class="card-cell">
        <p class="cell-label">发现卡</p>
        <md-model-card [items]="[specDiscover]" cover="/samples/shot-4.jpg" />
        <p class="cell-menu">类别 · 下载/点赞 · 分类 · 原站图标</p>
      </div>
      <div class="card-cell">
        <p class="cell-label">工作流卡</p>
        <app-workflow-card [it]="specWorkflow" />
        <p class="cell-menu">格式 · 状态 · 分组 · 主按钮</p>
      </div>
    </div>

    <p class="set-label">⋯ 弹出菜单 · 独立组件</p>
    <p class="set-lead">
      三种卡片的菜单都渲染同一个 <code>ui-card-menu</code>，只是条目不同；
      下面是去掉定位后的静态样张。
    </p>
    <div class="menu-row">
      @for (menu of menus; track menu.title) {
        <div class="menu-cell">
          <p class="cell-label">{{ menu.title }}</p>
          <div class="menu-stage">
            <ui-card-menu [items]="menu.items" [static]="true" />
          </div>
          <p class="cell-menu">{{ menu.note }}</p>
        </div>
      }
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

    <p class="set-label">动作零件 · ⋯ / 原站 / 信息区</p>
    <p class="set-lead">
      三件套单独渲染也能用：信息区（ui-card-body）、右上角更多（ui-card-kebab）、
      动作行左侧原站入口（ui-card-origin）。卡片里只是把它们放进固定槽位。
    </p>
    <div class="part-row">
      <div class="part-stage">
        <ui-card-kebab />
        <ui-card-origin label="Hugging Face" href="https://huggingface.co" />
        <ui-card-origin label="本地" />
      </div>
      <div class="part-stage part-body card-expanded">
        <ui-card-body title="FLUX.1-dev">
          <span class="part-meta">black-forest-labs · safetensors</span>
          <span class="part-meta">23.8 GB · 在库</span>
        </ui-card-body>
      </div>
    </div>

    <p class="set-label">结构六层</p>
    <ol class="spec-list">
      <li><b>① 封面</b><span>家族色 + 点阵 + 家族码水印；有真实照片时铺图并隐藏纹样。</span></li>
      <li><b>② 身份行</b><span>32 × 32 厂牌位（ui-card-mark）+ 右侧两行：名称在上、作者/来源在下。</span></li>
      <li><b>③ 原站</b><span>动作行左侧的小图标；右上角只留给 ⋯。没有原站时留空。</span></li>
      <li><b>④ 状态槽</b><span>左状态 · 细线 · 右大小；本地库看磁盘，发现看下载，工作流看文件体积。</span></li>
      <li><b>⑤ 分类标签</b><span>恰好一枚，用 ui-badge（sm）表达文件类型 / 分组 / 节点类。</span></li>
      <li><b>⑥ 动作行</b><span>原站标签在左、唯一主按钮在右；右上角 ⋯ 的菜单承载次要与危险动作。</span></li>
    </ol>

    <p class="set-label">尺寸与 token</p>
    <ui-table>
      <table class="tokens">
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
      遮罩只留一道：有封面图时用封面自带的中性黑渐变，文字翻白；没有照片时不叠任何蒙版，
      家族色直接做底色，不再被洗成白色。卡片圆角跟随列表，统一 16px。
    </p>
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

  readonly specLibrary = LIBRARY_MODELS[1];
  readonly specDiscover: SearchItem = {
    ...SEARCH_ITEMS[0],
    url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
  };
  readonly specWorkflow = WORKFLOWS[0];

  readonly menus: { title: string; note: string; items: CardMenuItem[] }[] = [
    {
      title: '本地库卡',
      note: '破坏性操作单独一档，用 danger 标色。',
      items: [{ key: 'remove', label: '删除模型', danger: true }],
    },
    {
      title: '发现卡',
      note: '每个来源一条外链，原站入口不只放在右上角。',
      items: [{ key: 'hf', label: 'Hugging Face', href: 'https://huggingface.co/black-forest-labs/FLUX.1-dev' }],
    },
    {
      title: '工作流卡',
      note: '运行在最上，删除在最下并标红。',
      items: [
        { key: 'run', label: '运行' },
        { key: 'edit', label: '在编辑器中打开' },
        { key: 'delete', label: '删除工作流', danger: true },
      ],
    },
  ];

  readonly tokens = [
    { token: '--card-radius', value: '16px', use: '卡片与列表一致' },
    { token: '--card-mark-size', value: '32px', use: '身份行厂牌位' },
    { token: '--card-title-size', value: '13px', use: '卡片标题' },
    { token: '--card-meta-size', value: '11px', use: '类别 / 规格' },
    { token: '--card-tag-size', value: '9.5px', use: 'ui-badge sm 标签' },
    { token: '--card-action-height', value: '28px', use: '主按钮与 ⋯' },
    { token: '--card-shadow', value: '--ui-shadow', use: '卡面阴影' },
  ];

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
