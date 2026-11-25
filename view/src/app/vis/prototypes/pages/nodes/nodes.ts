import type { BadgeTone } from '../../../../ui/badge';
import type { SegmentedOption } from '../../../../ui/segmented';
import type { NodeCardItem } from '../../../../ui/node-card';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ProtoShellComponent } from '../../proto-shell';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { UiButtonComponent } from '../../../../ui/button';
import { BadgeComponent } from '../../../../ui/badge';
import { EmptyComponent } from '../../../../ui/empty';
import { GridComponent } from '../../../../ui/grid';
import { NoticeComponent } from '../../../../ui/notice';
import { SegmentedComponent } from '../../../../ui/segmented';
import { ChipComponent } from '../../../../ui/chip';
import { InputComponent } from '../../../../ui/input';
import { TableComponent } from '../../../../ui/table';
import { PanelComponent } from '../../../../ui/panel';
import { ToastComponent } from '../../../../ui/toast';
import { NodeCardComponent } from '../../../../ui/node-card';
import { UiMaterialModule } from '../../../../ui/material';

/** 包从哪来：GitHub 仓库、Comfy Registry、本地 zip。 */
type PackSource = 'github' | 'registry' | 'zip';
type SourceFilter = 'all' | PackSource;
type PackTab = 'all' | 'installed' | 'available' | 'updates';
type SortKey = 'recommended' | 'name' | 'nodes';

/** 节点包 = 共享卡片的字段 + 这页自己用来排表 / 排序的字段。 */
interface PackItem extends NodeCardItem {
  id: string;
  /** 当前版本（git 包是 tag 或短 commit） */
  version: string;
  /** 有更新时的新版本 */
  latest?: string;
  source: PackSource;
  hasUpdate: boolean;
  /** 仓库体积，安装阶段的进度读数用它 */
  sizeMb?: number;
}

interface InstallProgress {
  percent: number;
  stage: string;
}

interface InstalledRow {
  pack: PackItem;
  status: string;
  tone: BadgeTone;
  sourceLabel: string;
  depText: string;
  depTitle: string;
}

interface DepCheck {
  name: string;
  range: string;
  installed: boolean;
  note: string;
}

const SOURCE_LABEL: Record<PackSource, string> = {
  github: 'GitHub',
  registry: 'Comfy Registry',
  zip: '本地 zip',
};

/**
 * VIS 原型 · 自定义节点。
 *
 * 一个页面对应三件事：发现节点包、安装（含安装中进度）、管理已安装清单。
 * 数据与计时器都在组件里，不接后端；安装进度是模拟的，完成即改状态。
 */
@Component({
  selector: 'app-proto-nodes',
  imports: [
    ProtoShellComponent,
    PageHeaderComponent,
    SectionBlockComponent,
    UiButtonComponent,
    BadgeComponent,
    EmptyComponent,
    GridComponent,
    NoticeComponent,
    SegmentedComponent,
    ChipComponent,
    InputComponent,
    TableComponent,
    PanelComponent,
    ToastComponent,
    NodeCardComponent,
    UiMaterialModule,
  ],
  styleUrl: './nodes.scss',
  template: `
    <app-proto-shell active="nodes" title="自定义节点" hint="发现、安装与更新节点包">
      <div class="page">
        <ui-page-header
          kicker="NODES · PACKS"
          title="自定义节点"
          hint="从 GitHub、Comfy Registry 或本地 zip 装包，装完统一管理。"
        >
          <ui-button
            variant="secondary"
            type="button"
            [disabled]="checking()"
            (click)="checkUpdates()"
          >
            <mat-icon svgIcon="app:refresh" aria-hidden="true" />
            {{ checking() ? '检查中…' : '检查更新' }}
          </ui-button>
          <ui-button variant="primary" type="button">
            <mat-icon svgIcon="app:plus" aria-hidden="true" />
            安装节点包
          </ui-button>
        </ui-page-header>

        @if (toast(); as message) {
          <div class="toast-dock">
            <ui-toast tone="ok" [dismissible]="true" (dismiss)="toast.set('')">
              {{ message }}
            </ui-toast>
          </div>
        }

        <div class="pack-toolbar">
          <ui-segmented
            [options]="tabs"
            [value]="tab()"
            (valueChange)="setTab($event)"
            label="安装状态"
          />
          <span class="toolbar-count">{{ summary() }}</span>
        </div>

        <div class="filters">
          <ui-input
            class="search"
            size="sm"
            ariaLabel="搜索节点包"
            placeholder="搜索节点包 / 节点类 / 作者"
            [value]="query()"
            (valueChange)="query.set($event)"
          >
            <svg input-leading viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" />
              <path d="M10.3 10.3 13.6 13.6" />
            </svg>
          </ui-input>

          <div class="filter-sources" role="group" aria-label="按来源筛选">
            @for (filter of sourceFilters; track filter.key) {
              <ui-chip
                [active]="source() === filter.key"
                [count]="countForSource(filter.key)"
                (picked)="source.set(filter.key)"
                >{{ filter.label }}</ui-chip
              >
            }
          </div>

          <span class="grow"></span>

          <span class="sort">
            <span class="sort-label" aria-hidden="true">排序</span>
            <select aria-label="排序方式" (change)="setSort($event)">
              @for (option of sortOptions; track option.key) {
                <option [value]="option.key" [selected]="option.key === sort()">
                  {{ option.label }}
                </option>
              }
            </select>
          </span>
        </div>

        <ui-section title="节点包" [pill]="cards().length + ' 个'">
          @if (cards().length) {
            <ui-grid min="280px">
              @for (card of cards(); track card.pack.id) {
                <md-node-card
                  [item]="card.pack"
                  mode="discover"
                  [installing]="!!card.progress"
                  [percent]="card.progress?.percent ?? 0"
                  [stage]="card.progress?.stage ?? ''"
                  [busy]="busyPack() === card.pack.id"
                  (install)="startInstall(card.pack)"
                />
              }
            </ui-grid>
          } @else {
            <ui-empty icon="⌕" [title]="emptyTitle()" hint="换个关键词、换一个来源，或切回「全部」状态。">
              <div class="empty-actions">
                <ui-button variant="secondary" type="button" (click)="resetFilters()">
                  清除筛选
                </ui-button>
              </div>
            </ui-empty>
          }
        </ui-section>

        @if (depPack(); as dep) {
          <div class="dep-block">
            <ui-notice
              tone="warn"
              icon="!"
              [title]="dep.name + ' 缺少 ' + (dep.needs?.length ?? 0) + ' 个运行依赖'"
            >
              节点包已经装好，但 ComfyUI 启动时会跳过相关节点；补装依赖后不需要重装节点包。
              <div notice-actions>
                <ui-button
                  variant="secondary"
                  size="sm"
                  type="button"
                  (click)="depsOpen.set(!depsOpen())"
                >
                  {{ depsOpen() ? '收起依赖' : '查看依赖' }}
                </ui-button>
                <ui-button variant="ghost" size="sm" type="button" (click)="installDeps()">
                  补装缺失依赖
                </ui-button>
              </div>
            </ui-notice>

            @if (depsOpen()) {
              <ui-panel
                class="dep-panel"
                kicker="Dependencies"
                title="依赖清单"
                [hint]="'Python 环境 · ' + dep.name"
              >
                <div class="dep-list">
                  @for (check of depChecks; track check.name) {
                    <div class="dep-row">
                      <span class="dep-name">{{ check.name }}</span>
                      <span class="dep-range">{{ check.range }}</span>
                      <span class="dep-note">{{ check.note }}</span>
                      <ui-badge [tone]="check.installed ? 'green' : 'orange'">
                        {{ check.installed ? '已装' : '缺失' }}
                      </ui-badge>
                    </div>
                  }
                </div>
                <div class="dep-foot">
                  <ui-button variant="secondary" size="sm" type="button" (click)="installDeps()">
                    安装缺失依赖
                  </ui-button>
                  <span>只补 Python 包，不重装节点包，也不改仓库版本。</span>
                </div>
              </ui-panel>
            }
          </div>
        }

        <ui-section title="已安装" [pill]="installedRows().length + ' 个'">
          <ui-table>
            <table aria-label="已安装的节点包">
              <thead>
                <tr>
                  <th scope="col">节点包</th>
                  <th scope="col">版本</th>
                  <th scope="col">来源</th>
                  <th scope="col">依赖</th>
                  <th scope="col">状态</th>
                </tr>
              </thead>
              <tbody>
                @for (row of installedRows(); track row.pack.id) {
                  <tr>
                    <td>
                      <span class="pack-cell">
                        <b>{{ row.pack.name }}</b>
                        <span>{{ row.pack.author }}</span>
                      </span>
                    </td>
                    <td class="mono">
                      @if (row.pack.hasUpdate) {
                        <span class="ver-old">{{ row.pack.version }}</span>
                        <span class="ver-arrow" aria-hidden="true">→</span>
                        <span class="ver-new">{{ row.pack.latest }}</span>
                      } @else {
                        {{ row.pack.version }}
                      }
                    </td>
                    <td>{{ row.sourceLabel }}</td>
                    <td>
                      @if (row.depText) {
                        <span class="dep-warn" [title]="row.depTitle">{{ row.depText }}</span>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      <span class="status-cell">
                        <ui-badge [tone]="row.tone">{{ row.status }}</ui-badge>
                        @if (row.pack.hasUpdate) {
                          <ui-button
                            variant="ghost"
                            size="xs"
                            type="button"
                            [label]="'更新 ' + row.pack.name"
                            (click)="applyUpdate(row.pack)"
                            >更新</ui-button
                          >
                        }
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </ui-table>
        </ui-section>

        <ui-section title="这页的规则" pill="Rules" [plain]="true">
          <ul class="rules">
            <li>
              <b>一个包只有一条状态</b>：未安装 / 安装中 / 已安装 / 可更新 / 缺依赖 互斥，卡片只报当下的事实。
            </li>
            <li>
              <b>安装是唯一会改磁盘的主操作</b>：点下去按钮立刻锁住，进度与阶段在卡上原位推进，走到 100% 才换成「查看」。
            </li>
            <li>
              <b>缺依赖只标在已安装的包上</b>：没装的包谈不上缺，依赖会随安装一起进来；补装依赖不重装节点包。
            </li>
            <li>
              <b>可更新不等于自动升级</b>：只在已安装清单里给一个「更新」动作，升级前先看清来去两个版本号。
            </li>
            <li>
              <b>来源不同、动作一致</b>：GitHub / Comfy Registry / 本地 zip 只在筛选与清单里分开标，主操作永远只有一个「安装」。
            </li>
            <li>
              <b>筛选不藏信息</b>：状态、来源、搜索叠加后没有结果时给清空入口，而不是把整块内容藏掉。
            </li>
          </ul>
        </ui-section>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoNodesComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs: SegmentedOption[] = [
    { key: 'all', label: '全部' },
    { key: 'installed', label: '已安装' },
    { key: 'available', label: '可安装' },
    { key: 'updates', label: '更新可用' },
  ];

  readonly sourceFilters: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: '全部来源' },
    { key: 'github', label: 'GitHub' },
    { key: 'registry', label: 'Comfy Registry' },
    { key: 'zip', label: '本地 zip' },
  ];

  readonly sortOptions: { key: SortKey; label: string }[] = [
    { key: 'recommended', label: '推荐排序' },
    { key: 'name', label: '名称 A–Z' },
    { key: 'nodes', label: '节点类数' },
  ];

  readonly depChecks: DepCheck[] = [
    { name: 'insightface', range: '>=0.7.3', installed: false, note: '人脸检测与识别' },
    { name: 'onnxruntime', range: '>=1.18.0', installed: true, note: '推理后端' },
    { name: 'opencv-python', range: '>=4.9', installed: true, note: '图像预处理' },
  ];

  readonly packs = signal<PackItem[]>([
    {
      id: 'manager',
      name: 'ComfyUI-Manager',
      author: 'ltdrdata',
      repo: 'https://github.com/ltdrdata/ComfyUI-Manager',
      category: '管理工具',
      description: '节点、模型与依赖的统一管理面板，缺失节点可以一键补齐。',
      tags: ['manager', 'panel'],
      nodes: [],
      node_count: 0,
      install_type: 'git',
      installable: true,
      needs: [],
      installed: true,
      version: 'v3.34.2',
      source: 'github',
      hasUpdate: false,
      sizeMb: 18,
    },
    {
      id: 'impact',
      name: 'ComfyUI-Impact-Pack',
      author: 'ltdrdata',
      repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
      category: '人脸与检测',
      description: '人脸检测、SAM 分割与细节修复的节点合集，工作流里出现频率最高的一组。',
      tags: ['face', 'segmentation'],
      nodes: ['ImpactFaceDetailer', 'ImpactSAMLoader', 'ImpactWildcardProcessor'],
      node_count: 72,
      install_type: 'git',
      installable: true,
      needs: ['insightface'],
      installed: true,
      version: 'v8.12.0',
      source: 'github',
      hasUpdate: false,
      requirements: true,
      sizeMb: 64,
    },
    {
      id: 'vhs',
      name: 'ComfyUI-VideoHelperSuite',
      author: 'Kosinkadink',
      repo: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite',
      category: '视频合成',
      description: '视频加载、切片与合成节点，帧序列工作流的基础件。',
      tags: ['video', 'ffmpeg'],
      nodes: ['VHS_LoadVideo', 'VHS_VideoCombine', 'VHS_SplitImages'],
      node_count: 14,
      install_type: 'git',
      installable: true,
      needs: [],
      installed: true,
      version: 'v1.7.4',
      latest: 'v1.7.9',
      source: 'github',
      hasUpdate: true,
      requirements: true,
      sizeMb: 42,
    },
    {
      id: 'ipadapter',
      name: 'ComfyUI_IPAdapter_plus',
      author: 'cubiq',
      repo: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus',
      category: '风格参考',
      description: '参考图驱动的风格与人物迁移，支持多种 IPAdapter 权重。',
      tags: ['ipadapter', 'reference'],
      nodes: ['IPAdapterModelLoader', 'IPAdapterAdvanced', 'IPAdapterFaceID'],
      node_count: 11,
      install_type: 'git',
      installable: true,
      needs: [],
      installed: true,
      version: 'a1f2c3d',
      latest: '9d4b7e0',
      source: 'github',
      hasUpdate: true,
      requirements: true,
      sizeMb: 9,
    },
    {
      id: 'supir',
      name: 'ComfyUI-SUPIR',
      author: 'kijai',
      repo: 'https://github.com/kijai/ComfyUI-SUPIR',
      category: '超分辨率',
      description: 'SUPIR 放大节点，配合 SDXL 权重做细节重建。',
      tags: ['upscale', 'supir'],
      nodes: ['SUPIR_Upscale', 'SUPIR_model_loader'],
      node_count: 8,
      install_type: 'git',
      installable: true,
      needs: [],
      installed: true,
      version: 'v1.1.2',
      source: 'github',
      hasUpdate: false,
      requirements: true,
      sizeMb: 26,
    },
    {
      id: 'wanvideo',
      name: 'ComfyUI-WanVideoWrapper',
      author: 'kijai',
      repo: 'https://github.com/kijai/ComfyUI-WanVideoWrapper',
      category: '视频生成',
      description: 'Wan 2.x 视频模型的加载与采样封装，长镜头按块渲染。',
      tags: ['wan', 'video'],
      nodes: ['WanVideoModelLoader', 'WanVideoSampler', 'WanVideoTextEncode'],
      node_count: 46,
      install_type: 'git',
      installable: true,
      needs: [],
      installed: false,
      version: 'v1.3.0',
      source: 'github',
      hasUpdate: false,
      requirements: true,
      sizeMb: 54,
    },
    {
      id: 'audio',
      name: 'ComfyUI-AudioX',
      author: 'Comfy-Org',
      category: '音频',
      description: '音频加载、重采样与音画对齐节点，由 Comfy Registry 发布。',
      tags: ['audio', 'sync'],
      nodes: ['AudioXLoader', 'AudioXAlign'],
      node_count: 6,
      install_type: 'registry',
      installable: true,
      needs: [],
      installed: false,
      version: 'v0.9.1',
      source: 'registry',
      hasUpdate: false,
      sizeMb: 38,
    },
    {
      id: 'daemon',
      name: 'ComfyUI-Detail-Daemon',
      author: 'Jonseed',
      category: '细节增强',
      description: '按步数动态调节 CFG 的细节增强节点，可以和任意采样器组合。',
      tags: ['detail', 'cfg'],
      nodes: ['DetailDaemonSamplerNode', 'DetailDaemonGraphSigmasNode'],
      node_count: 3,
      install_type: 'registry',
      installable: true,
      needs: [],
      installed: false,
      version: 'v1.2.0',
      source: 'registry',
      hasUpdate: false,
      sizeMb: 1,
    },
    {
      id: 'sdxl-batch',
      name: 'sdxl-batch-tools',
      author: '本地导入',
      category: '批处理',
      description: '从本地 zip 装入的批处理节点，含批量放大与命名模板。',
      tags: ['batch', 'local'],
      nodes: ['SDXLBatchUpscale', 'SDXLBatchRename'],
      node_count: 2,
      install_type: 'zip',
      installable: true,
      needs: [],
      installed: false,
      version: 'v0.4.0',
      source: 'zip',
      hasUpdate: false,
      sizeMb: 3,
    },
    {
      id: 'rife',
      name: 'ComfyUI-Frame-Interpolation',
      author: 'Fannovel16',
      repo: 'https://github.com/Fannovel16/ComfyUI-Frame-Interpolation',
      category: '补帧',
      description: 'RIFE / FILM 补帧节点，视频工作流常用。',
      tags: ['interpolation', 'rife'],
      nodes: ['RIFE VFI', 'FILM VFI'],
      node_count: 9,
      install_type: 'git',
      installable: true,
      needs: ['cupy'],
      installed: false,
      version: 'v2.6.1',
      source: 'github',
      hasUpdate: false,
      requirements: true,
      sizeMb: 12,
    },
  ]);

  readonly tab = signal<PackTab>('all');
  readonly source = signal<SourceFilter>('all');
  readonly sort = signal<SortKey>('recommended');
  readonly query = signal('');
  readonly checking = signal(false);
  readonly depsOpen = signal(false);
  readonly toast = signal('');

  /** 正在安装的包：id → 进度。卡片的 installing / percent / stage 都从这里来。 */
  private readonly installs = signal<Record<string, InstallProgress>>({});

  /** 依赖处理中的包（卡片 busy）：这里固定给缺依赖的 Impact Pack。 */
  readonly busyPack = signal('impact');

  private readonly tickers = new Map<string, ReturnType<typeof setInterval>>();
  private checkTimer: ReturnType<typeof setTimeout> | null = null;

  /** 提示自动收起；新提示会重新计时。 */
  private readonly toastEffect = effect((onCleanup) => {
    if (!this.toast()) return;
    const timer = setTimeout(() => this.toast.set(''), 4200);
    onCleanup(() => clearTimeout(timer));
  });

  /** 状态 → 过滤结果。四个状态互斥，不叠加。 */
  private readonly tabbed = computed(() => {
    const list = this.packs();
    switch (this.tab()) {
      case 'installed':
        return list.filter((pack) => pack.installed);
      case 'available':
        return list.filter((pack) => !pack.installed);
      case 'updates':
        return list.filter((pack) => pack.installed && pack.hasUpdate);
      default:
        return list;
    }
  });

  private readonly filtered = computed(() => {
    const keyword = this.query().trim().toLowerCase();
    const source = this.source();
    let list = this.tabbed();
    if (source !== 'all') list = list.filter((pack) => pack.source === source);
    if (keyword) list = list.filter((pack) => searchText(pack).includes(keyword));
    return list;
  });

  private readonly visiblePacks = computed(() => {
    const list = [...this.filtered()];
    switch (this.sort()) {
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'nodes':
        return list.sort((a, b) => (b.node_count ?? 0) - (a.node_count ?? 0));
      default:
        return list;
    }
  });

  /** 卡片视图：包 + 它当前的安装进度（没在装就是 undefined）。 */
  readonly cards = computed(() => {
    const progress = this.installs();
    return this.visiblePacks().map((pack) => ({ pack, progress: progress[pack.id] }));
  });

  readonly installedRows = computed<InstalledRow[]>(() =>
    this.packs()
      .filter((pack) => pack.installed)
      .map((pack) => {
        const missing = pack.needs?.length ?? 0;
        const status = pack.hasUpdate ? '可更新' : missing ? '缺依赖' : '已启用';
        const tone: BadgeTone = pack.hasUpdate ? 'blue' : missing ? 'orange' : 'green';
        const depText = missing ? `缺 ${missing} 项` : '';
        return {
          pack,
          status,
          tone,
          sourceLabel: SOURCE_LABEL[pack.source],
          depText,
          depTitle: pack.needs?.join('、') ?? '',
        };
      }),
  );

  readonly depPack = computed(
    () => this.packs().find((pack) => pack.installed && (pack.needs?.length ?? 0) > 0) ?? null,
  );

  readonly summary = computed(() => {
    const list = this.packs();
    const installed = list.filter((pack) => pack.installed).length;
    const updates = list.filter((pack) => pack.installed && pack.hasUpdate).length;
    return `${list.length} 个节点包 · ${installed} 个已安装 · ${updates} 个可更新`;
  });

  readonly emptyTitle = computed(() =>
    this.query().trim() ? `没有匹配「${this.query().trim()}」的节点包` : '这个筛选下还没有节点包',
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.tickers.forEach((timer) => clearInterval(timer));
      this.tickers.clear();
      if (this.checkTimer) clearTimeout(this.checkTimer);
    });

    // 原型演示：进页面时已有一个包在装（进度会自己走完，完成即进已安装清单）。
    const seeded = this.packs().find((pack) => pack.id === 'audio');
    if (seeded) this.startInstall(seeded, 34);
  }

  setTab(value: string): void {
    this.tab.set(value as PackTab);
  }

  setSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as SortKey);
  }

  countForSource(key: SourceFilter): number {
    const list = this.tabbed();
    return key === 'all' ? list.length : list.filter((pack) => pack.source === key).length;
  }

  resetFilters(): void {
    this.query.set('');
    this.source.set('all');
    this.tab.set('all');
  }

  /** 检查更新只是视觉反馈：不真的访问仓库。 */
  checkUpdates(): void {
    if (this.checking()) return;
    this.checking.set(true);
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checking.set(false);
      const updates = this.packs().filter((pack) => pack.installed && pack.hasUpdate).length;
      this.toast.set(`检查完成：${updates} 个节点包有更新可用。`);
    }, 800);
  }

  applyUpdate(pack: PackItem): void {
    this.packs.update((list) =>
      list.map((item) =>
        item.id === pack.id
          ? { ...item, version: item.latest ?? item.version, hasUpdate: false }
          : item,
      ),
    );
    this.toast.set(`${pack.name} 已更新到 ${pack.latest ?? pack.version}。`);
  }

  installDeps(): void {
    const dep = this.depPack();
    if (!dep) return;
    const names = dep.needs ?? [];
    this.packs.update((list) =>
      list.map((item) => (item.id === dep.id ? { ...item, needs: [] } : item)),
    );
    if (this.busyPack() === dep.id) this.busyPack.set('');
    this.depsOpen.set(false);
    this.toast.set(`依赖已补装：${names.join('、')} · 重启 ComfyUI 后生效。`);
  }

  startInstall(pack: PackItem, from = 2): void {
    if (pack.installed || this.installs()[pack.id]) return;
    this.installs.update((map) => ({
      ...map,
      [pack.id]: { percent: from, stage: this.stageOf(pack, from) },
    }));
    const timer = setInterval(() => this.tickInstall(pack.id), 520);
    this.tickers.set(pack.id, timer);
  }

  private tickInstall(id: string): void {
    const current = this.installs()[id];
    const pack = this.packs().find((item) => item.id === id);
    if (!current || !pack) {
      this.stopTicker(id);
      return;
    }
    const percent = Math.min(100, current.percent + 6);
    if (percent >= 100) {
      this.finishInstall(pack);
      return;
    }
    this.installs.update((map) => ({
      ...map,
      [id]: { percent, stage: this.stageOf(pack, percent) },
    }));
  }

  private finishInstall(pack: PackItem): void {
    this.stopTicker(pack.id);
    this.installs.update((map) => {
      const next = { ...map };
      delete next[pack.id];
      return next;
    });
    this.packs.update((list) =>
      list.map((item) => (item.id === pack.id ? { ...item, installed: true } : item)),
    );
    this.toast.set(`${pack.name} 安装完成 · 重启 ComfyUI 后可用。`);
  }

  private stopTicker(id: string): void {
    const timer = this.tickers.get(id);
    if (!timer) return;
    clearInterval(timer);
    this.tickers.delete(id);
  }

  /** 安装阶段：和真实安装脚本的步骤对齐（拉取 → 依赖 → 落盘）。 */
  private stageOf(pack: PackItem, percent: number): string {
    if (percent < 22) return '连接来源';
    if (percent < 62) {
      const total = pack.sizeMb ?? 40;
      const done = Math.max(1, Math.round((total * percent) / 100));
      return `下载文件 · ${done}/${total} MB`;
    }
    if (percent < 85) return '检查 Python 依赖';
    return '写入 nodes/ 目录';
  }
}

/** 搜索面：名字、作者、分类、标签、节点类名与描述都参与匹配。 */
function searchText(pack: PackItem): string {
  return [
    pack.name,
    pack.author ?? '',
    pack.category ?? '',
    ...(pack.tags ?? []),
    ...(pack.nodes ?? []),
    pack.description ?? '',
  ]
    .join(' ')
    .toLowerCase();
}
