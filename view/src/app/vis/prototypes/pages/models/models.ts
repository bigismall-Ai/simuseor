import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { fmtBytes } from '../../../../core/types';
import { sourceLabel } from '../../../../core/source-links';
import { LIBRARY_MODELS, SEARCH_ITEMS } from '../../../visual-data';
import { BadgeComponent } from '../../../../ui/badge';
import { UiButtonComponent } from '../../../../ui/button';
import { EmptyComponent } from '../../../../ui/empty';
import { FilterBarComponent } from '../../../../ui/filter-bar';
import { GridComponent } from '../../../../ui/grid';
import { LibraryCardComponent } from '../../../../ui/library-card';
import { UiMaterialModule } from '../../../../ui/material';
import { ModelCardComponent } from '../../../../ui/model-card';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { TableComponent } from '../../../../ui/table';
import { ProtoShellComponent } from '../../proto-shell';
import type { BadgeTone } from '../../../../ui/badge';
import type {
  FilterFacetChange,
  FilterFacetGroup,
  FilterSite,
  FilterSortOption,
  CollectionFact,
} from '../../../../ui/filter-bar';
import type { PageViewOption } from '../../../../ui/page-header';
import type { LibraryModel, SearchItem } from '../../../../core/types';

type Scope = 'library' | 'discover';
type Layout = 'grid' | 'list';
type SortKey = 'recent' | 'name' | 'size';
type CategoryKey = 'image' | 'video' | 'lora' | 'vae';
type FormatKey = 'safetensors' | 'gguf' | 'ckpt';

/** 两个视图共用的一套行契约：筛选 / 排序 / 表格都只认这几个字段。 */
interface RowBase {
  key: string;
  name: string;
  /** 来源站 key（huggingface / modelscope / github / civitai / imported） */
  sourceKey: string;
  category: CategoryKey;
  format: FormatKey;
  sizeBytes: number;
  /** ISO 时间，排序按字符串比；展示时再缩写 */
  updatedAt: string;
  status: string;
  statusTone: BadgeTone;
}

interface LibraryRow extends RowBase {
  model: LibraryModel;
}

interface DiscoverRow extends RowBase {
  item: SearchItem;
  inLibrary: boolean;
}

interface LibrarySeed {
  model: LibraryModel;
  category: CategoryKey;
  format: FormatKey;
  updatedAt: string;
}

interface DiscoverSeed {
  item: SearchItem;
  category: CategoryKey;
  format: FormatKey;
  sizeBytes: number;
  updatedAt: string;
  inLibrary: boolean;
}

const CATEGORY_OPTIONS: readonly { key: CategoryKey; label: string }[] = [
  { key: 'image', label: '文生图' },
  { key: 'video', label: '视频' },
  { key: 'lora', label: 'LoRA' },
  { key: 'vae', label: 'VAE' },
];

const FORMAT_OPTIONS: readonly { key: FormatKey; label: string }[] = [
  { key: 'safetensors', label: 'safetensors' },
  { key: 'gguf', label: 'gguf' },
  { key: 'ckpt', label: 'ckpt' },
];

const SORT_OPTIONS: FilterSortOption[] = [
  { key: 'recent', label: '最近使用' },
  { key: 'name', label: '名称' },
  { key: 'size', label: '体积' },
];

/** 站点候选项与探针口径一致：Civitai 不可达时灰置，原因只在 hover 气泡里。 */
const DISCOVER_SITES: readonly FilterSite[] = [
  { key: 'huggingface', label: 'Hugging Face', title: 'Hugging Face' },
  { key: 'modelscope', label: 'ModelScope', title: 'ModelScope' },
  { key: 'github', label: 'GitHub', title: 'GitHub' },
  {
    key: 'civitai',
    label: 'Civitai',
    title: 'Civitai',
    disabled: true,
    tip: '探针不可达：直连与代理均超时',
  },
];

/** 本地库：复用 VIS 假数据，补齐卡片要的类别 / 存放目录与筛选要的格式。 */
const LIBRARY_SEEDS: readonly LibrarySeed[] = [
  {
    model: {
      ...LIBRARY_MODELS[0],
      repo_id: 'SG161222/RealVisXL_V4.0',
      source: 'civitai',
      size_bytes: 6_871_947_673,
      precision: 'fp16',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'checkpoints',
      folderLabel: '主模型',
    },
    category: 'image',
    format: 'safetensors',
    updatedAt: '2026-11-21T09:04',
  },
  {
    model: {
      ...LIBRARY_MODELS[1],
      repo_id: 'Lightricks/LTX-Video',
      source: 'huggingface',
      precision: 'fp16',
      task: 'text-to-video',
      taskLabel: '文生视频',
      folder: 'diffusion_models',
      folderLabel: '扩散模型',
    },
    category: 'video',
    format: 'safetensors',
    updatedAt: '2026-10-28T20:15',
  },
  {
    model: {
      id: 'flux1-dev-fp8',
      name: 'flux1-dev-fp8.safetensors',
      repo_id: 'Comfy-Org/flux1-dev',
      source: 'huggingface',
      local_path: '/models/diffusion_models/flux1-dev-fp8.safetensors',
      size_bytes: 12_186_000_000,
      file_count: 1,
      tags: ['文生图', 'FLUX'],
      created_at: '2026-11-18',
      files: [],
      precision: 'fp8',
      params: '12B',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'diffusion_models',
      folderLabel: '扩散模型',
    },
    category: 'image',
    format: 'safetensors',
    updatedAt: '2026-11-19T14:02',
  },
  {
    model: {
      id: 'minimax-h3-vae',
      name: 'minimax_h3_image_vae_fp16.safetensors',
      repo_id: 'Comfy-Org/MiniMax-H3-Image',
      source: 'huggingface',
      local_path: '/models/vae/minimax_h3_image_vae_fp16.safetensors',
      size_bytes: 1_126_000_000,
      file_count: 1,
      tags: ['文生图', 'MiniMax'],
      created_at: '2026-11-17',
      files: [],
      precision: 'fp16',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'vae',
      folderLabel: 'VAE',
    },
    category: 'vae',
    format: 'safetensors',
    updatedAt: '2026-11-17T20:10',
  },
  {
    model: {
      id: 'detail-tweaker-xl',
      name: 'detail_tweaker_xl.safetensors',
      repo_id: 'TwoShot/detail-tweaker',
      source: 'civitai',
      local_path: '/models/loras/detail_tweaker_xl.safetensors',
      size_bytes: 184_000_000,
      file_count: 1,
      tags: ['文生图', '细节'],
      created_at: '2026-11-16',
      files: [],
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'loras',
      folderLabel: 'LoRA',
    },
    category: 'lora',
    format: 'safetensors',
    updatedAt: '2026-11-16T16:40',
  },
  {
    model: {
      id: 'v1-5-pruned',
      name: 'v1-5-pruned-emaonly.ckpt',
      repo_id: 'runwayml/stable-diffusion-v1-5',
      source: 'huggingface',
      local_path: '/models/checkpoints/v1-5-pruned-emaonly.ckpt',
      size_bytes: 4_265_000_000,
      file_count: 1,
      tags: ['文生图', 'SD1.5'],
      created_at: '2026-11-02',
      files: [],
      precision: 'fp16',
      params: '0.9B',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'checkpoints',
      folderLabel: '主模型',
    },
    category: 'image',
    format: 'ckpt',
    updatedAt: '2026-11-02T11:26',
  },
  {
    model: {
      id: 'flux-dev-gguf',
      name: 'flux1-dev-Q4_K_S.gguf',
      repo_id: '',
      source: 'imported',
      local_path: '/models/diffusion_models/flux1-dev-Q4_K_S.gguf',
      size_bytes: 6_800_000_000,
      file_count: 1,
      tags: ['文生图', 'FLUX'],
      created_at: '2026-11-22',
      files: [],
      params: 'Q4_K_S',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'diffusion_models',
      folderLabel: '扩散模型',
    },
    category: 'image',
    format: 'gguf',
    updatedAt: '2026-11-22T08:31',
  },
  {
    model: {
      id: 'sdxl-base-broken',
      name: 'sd_xl_base_1.0.ckpt',
      repo_id: 'stabilityai/stable-diffusion-xl-base-1.0',
      source: 'huggingface',
      local_path: '/models/checkpoints/sd_xl_base_1.0.ckpt',
      size_bytes: 6_940_000_000,
      file_count: 1,
      tags: ['文生图', 'SDXL'],
      created_at: '2026-10-30',
      files: [],
      params: '3.5B',
      task: 'text-to-image',
      taskLabel: '文生图',
      folder: 'checkpoints',
      folderLabel: '主模型',
      vram: {
        level: 'broken',
        text: '权重损坏 · 文件头解析失败',
        hint: '重新下载可修复；本地文件先不要删',
      },
    },
    category: 'image',
    format: 'ckpt',
    updatedAt: '2026-10-30T22:05',
  },
];

/** 发现：两个来源复用 VIS 假数据，其余补到 4 个站点 / 4 个类别 / 3 种格式都有样本。 */
const DISCOVER_SEEDS: readonly DiscoverSeed[] = [
  {
    item: {
      ...SEARCH_ITEMS[0],
      source: 'huggingface',
      tags: ['text-to-image', 'FLUX'],
      task: 'text-to-image',
      url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
      updated_at: '2026-11-10',
    },
    category: 'image',
    format: 'safetensors',
    sizeBytes: 23_840_000_000,
    updatedAt: '2026-11-10T18:20',
    inLibrary: false,
  },
  {
    item: {
      ...SEARCH_ITEMS[1],
      source: 'modelscope',
      tags: ['text-to-video', 'WAN'],
      task: 'text-to-video',
      url: 'https://modelscope.cn/models/Wan-AI/Wan2.2-T2V',
      updated_at: '2026-11-08',
    },
    category: 'video',
    format: 'safetensors',
    sizeBytes: 14_200_000_000,
    updatedAt: '2026-11-08T09:42',
    inLibrary: false,
  },
  {
    item: {
      id: 'juggernaut-xl-v9',
      name: 'juggernautXL_v9.safetensors',
      author: 'RunDiffusion',
      source: 'civitai',
      description: '通用写实底模',
      downloads: 96_200,
      likes: 3_100,
      tags: ['text-to-image', 'SDXL'],
      task: 'Checkpoint',
      url: 'https://civitai.com/models/133005',
      updated_at: '2026-11-05',
    },
    category: 'image',
    format: 'safetensors',
    sizeBytes: 7_100_000_000,
    updatedAt: '2026-11-05T13:12',
    inLibrary: false,
  },
  {
    item: {
      id: 'detail-tweaker-xl',
      name: 'detail_tweaker_xl.safetensors',
      author: 'TwoShot',
      source: 'civitai',
      description: '细节增强 LoRA',
      downloads: 42_800,
      likes: 1_640,
      tags: ['text-to-image', '细节'],
      task: 'LORA',
      url: 'https://civitai.com/models/124347',
      updated_at: '2026-11-02',
    },
    category: 'lora',
    format: 'safetensors',
    sizeBytes: 184_000_000,
    updatedAt: '2026-11-02T17:55',
    inLibrary: true,
  },
  {
    item: {
      id: 'mm-sd-v15-v2',
      name: 'mm_sd_v15_v2.ckpt',
      author: 'guoyww',
      source: 'github',
      description: 'AnimateDiff 动作模块',
      downloads: 21_400,
      likes: 860,
      tags: ['text-to-video', 'AnimateDiff'],
      task: 'Motion Module',
      url: 'https://github.com/guoyww/animatediff',
      updated_at: '2026-10-27',
    },
    category: 'video',
    format: 'ckpt',
    sizeBytes: 1_700_000_000,
    updatedAt: '2026-10-27T10:30',
    inLibrary: false,
  },
  {
    item: {
      id: 'sdxl-vae-fp16',
      name: 'sdxl-vae-fp16.safetensors',
      author: 'stabilityai',
      source: 'huggingface',
      description: 'SDXL 官方 VAE',
      downloads: 58_400,
      likes: 540,
      tags: ['text-to-image', 'VAE'],
      task: 'text-to-image',
      url: 'https://huggingface.co/stabilityai/sdxl-vae',
      updated_at: '2026-10-22',
    },
    category: 'vae',
    format: 'safetensors',
    sizeBytes: 335_000_000,
    updatedAt: '2026-10-22T08:06',
    inLibrary: false,
  },
  {
    item: {
      id: 'flux-dev-gguf',
      name: 'flux1-dev-Q4_K_S.gguf',
      author: 'city96',
      source: 'huggingface',
      description: 'FLUX.1 dev GGUF 量化',
      downloads: 31_900,
      likes: 410,
      tags: ['text-to-image', 'GGUF'],
      task: 'text-to-image',
      url: 'https://huggingface.co/city96/FLUX.1-dev-gguf',
      updated_at: '2026-11-19',
    },
    category: 'image',
    format: 'gguf',
    sizeBytes: 6_800_000_000,
    updatedAt: '2026-11-19T21:18',
    inLibrary: true,
  },
  {
    item: {
      id: 'realvis-xl-v4',
      name: 'RealVisXL_V4.0_lightning.safetensors',
      author: 'SG161222',
      source: 'civitai',
      description: '写实向 SDXL 底模',
      downloads: 143_000,
      likes: 5_200,
      tags: ['text-to-image', 'SDXL'],
      task: 'Checkpoint',
      url: 'https://civitai.com/models/139562',
      updated_at: '2026-11-21',
    },
    category: 'image',
    format: 'safetensors',
    sizeBytes: 6_871_947_673,
    updatedAt: '2026-11-21T09:04',
    inLibrary: true,
  },
];

function libraryStatus(model: LibraryModel): { status: string; tone: BadgeTone } {
  const level = model.vram?.level;
  if (level === 'broken') return { status: '权重损坏', tone: 'red' };
  if (level === 'missing') return { status: '权重缺失', tone: 'orange' };
  return { status: '在库', tone: 'green' };
}

function fmtWhen(iso: string): string {
  const [date = '', time = ''] = iso.split('T');
  const [, month = '', day = ''] = date.split('-');
  return `${month}-${day} ${time}`.trim();
}

/**
 * VIS 原型 · 模型库。
 *
 * 本地库与发现共用一条筛选条、一套卡片和一套列表：
 *   - 页头的 segmented 只换数据集（本地库 / 发现）；
 *   - 搜索、站点、类别 / 格式分面、排序、网格 / 列表在两视图间保持同一位置；
 *   - Civitai 按探针结论灰置，不提供可选入口，原因只进 hover 气泡。
 *
 * 数据来自 visual-data 的假数据并补齐字段；不接后端、不发请求。
 */
@Component({
  selector: 'app-proto-models',
  imports: [
    ProtoShellComponent,
    PageHeaderComponent,
    FilterBarComponent,
    GridComponent,
    SectionBlockComponent,
    BadgeComponent,
    EmptyComponent,
    TableComponent,
    UiButtonComponent,
    UiMaterialModule,
    LibraryCardComponent,
    ModelCardComponent,
  ],
  styleUrl: './models.scss',
  template: `
    <app-proto-shell active="models" title="模型库" hint="本地库与发现共用一套筛选与卡片">
      <div class="page">
        <ui-page-header
          kicker="MODELS · LIBRARY"
          title="模型库"
          hint="本机已入库与在线可发现，共用一套筛选与读法。"
          [viewOptions]="viewOptions"
          [view]="scope()"
          (viewChange)="onScope($event)"
        >
          <ui-button variant="secondary" type="button">
            <mat-icon svgIcon="app:folder-open" aria-hidden="true" />
            导入模型
          </ui-button>
          <ui-button variant="primary" type="button" [disabled]="refreshing()" (click)="refresh()">
            <mat-icon svgIcon="app:refresh" aria-hidden="true" />
            {{ refreshing() ? '刷新中…' : '刷新' }}
          </ui-button>
        </ui-page-header>

        <ui-filter-bar
          [facts]="facts()"
          [loading]="refreshing()"
          [refreshLabel]="refreshLabel()"
          (refresh)="refresh()"
          [search]="search()"
          searchPlaceholder="搜索模型名称或来源"
          (searchChange)="search.set($event)"
          [sites]="sites()"
          [site]="activeSite()"
          (siteChange)="site.set($event)"
          [facets]="facets()"
          [facetSelected]="facetSelected()"
          (facetChange)="onFacetChange($event)"
          [sortOptions]="sortOptions"
          [sort]="sort()"
          (sortChange)="onSort($event)"
          [view]="layout()"
          (viewChange)="layout.set($event)"
          [count]="refreshing() ? null : resultCount()"
          [total]="scopeTotal()"
          unit="个模型"
          [hasFilter]="hasFilter()"
          (clearAll)="clearAll()"
        />

        <ui-section [title]="sectionTitle()" [pill]="sectionPill()" [plain]="true">
          @if (resultCount()) {
            @if (layout() === 'grid') {
              @if (scope() === 'library') {
                <ui-grid>
                  @for (row of libraryShown(); track row.key) {
                    <md-library-card
                      [model]="row.model"
                      [cover]="$index === 0 ? '/samples/shot-2.jpg' : ''"
                      [vramGb]="16"
                    />
                  }
                </ui-grid>
              } @else {
                <ui-grid>
                  @for (row of discoverShown(); track row.key) {
                    <md-model-card
                      [items]="[row.item]"
                      [cover]="$index === 0 ? '/samples/shot-4.jpg' : ''"
                      [inLibrary]="row.inLibrary"
                    />
                  }
                </ui-grid>
              }
            } @else {
              <ui-table>
                <table class="models-table" aria-label="模型列表">
                  <thead>
                    <tr>
                      <th scope="col" class="t-name">名称</th>
                      <th scope="col" class="t-source">来源</th>
                      <th scope="col" class="t-size">大小</th>
                      <th scope="col" class="t-status">状态</th>
                      <th scope="col" class="t-time">修改时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of tableRows(); track row.key) {
                      <tr>
                        <td class="t-name"><b [title]="row.name">{{ row.name }}</b></td>
                        <td class="t-source">{{ row.source }}</td>
                        <td class="t-size">{{ row.size }}</td>
                        <td class="t-status">
                          <ui-badge [tone]="row.tone">{{ row.status }}</ui-badge>
                        </td>
                        <td class="t-time">{{ row.updatedAt }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </ui-table>
            }
          } @else {
            <div class="grid-empty">
              <ui-empty
                icon="⌕"
                [title]="emptyTitle()"
                hint="换个关键词，或在「筛选」里放开类别与格式。"
              >
                @if (hasFilter()) {
                  <ui-button class="empty-clear" variant="secondary" type="button" (click)="clearAll()">
                    清除全部筛选
                  </ui-button>
                }
              </ui-empty>
            </div>
          }
        </ui-section>

        <ui-section title="这页的规则" pill="Rules" [plain]="true">
          <ul class="rules">
            <li>
              <b>一套筛选，两个数据集</b>：「本地库 / 发现」只在页头切换；搜索、站点、分面、排序、
              网格 / 列表的位置不动，换视图不用重新找控件。
            </li>
            <li>
              <b>站点管「从哪儿找」，分面管「找什么样的」</b>：站点留在条上一直可见；
              类别与格式收进「筛选」浮层，选中数量回到按钮上的徽标。
            </li>
            <li>
              <b>Civitai 灰置，不消失</b>：探针不可达时它仍是可见的灰 chip，点不动、不发请求；
              原因只放 hover 气泡，页面上不铺诊断信息。
            </li>
            <li>
              <b>读数只在两处</b>：筛选条右端是「当前可见 / 全量」，分面里的数字是各组候选量；
              卡片与表格不再各报一次总数。
            </li>
            <li>
              <b>列表五列固定</b>：名称、来源、大小、状态、修改时间；卡片与列表是同一批行，
              切视图不改变筛选结果，只换密度。
            </li>
            <li>
              <b>本轮边界</b>：卡片上的导入 / 下载 / 删除只做形态，不执行；页面里的体积、
              时间与站点计数都是示意值，不向后端或站点发请求。
            </li>
          </ul>
        </ui-section>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoModelsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly viewOptions: PageViewOption[] = [
    { key: 'library', label: '本地库' },
    { key: 'discover', label: '发现' },
  ];

  readonly sortOptions = SORT_OPTIONS;

  readonly scope = signal<Scope>('library');
  readonly layout = signal<Layout>('grid');
  readonly sort = signal<SortKey>('recent');
  readonly search = signal('');
  readonly site = signal('all');
  readonly facetSelected = signal<Record<string, string[]>>({});
  readonly refreshing = signal(false);

  /** 本地库只有「本机」一个站点，始终点亮；发现里 '' 等价于全部站点。 */
  readonly activeSite = computed(() => (this.scope() === 'library' ? 'local' : this.site()));

  private readonly libraryRows: readonly LibraryRow[] = LIBRARY_SEEDS.map((seed) => {
    const status = libraryStatus(seed.model);
    return {
      key: seed.model.id,
      name: seed.model.name,
      sourceKey: seed.model.source,
      category: seed.category,
      format: seed.format,
      sizeBytes: seed.model.size_bytes,
      updatedAt: seed.updatedAt,
      status: status.status,
      statusTone: status.tone,
      model: seed.model,
    };
  });

  private readonly discoverRows: readonly DiscoverRow[] = DISCOVER_SEEDS.map((seed) => ({
    key: seed.item.id,
    name: seed.item.name,
    sourceKey: seed.item.source,
    category: seed.category,
    format: seed.format,
    sizeBytes: seed.sizeBytes,
    updatedAt: seed.updatedAt,
    status: seed.inLibrary ? '已在库' : '可下载',
    statusTone: seed.inLibrary ? 'green' : 'blue',
    item: seed.item,
    inLibrary: seed.inLibrary,
  }));

  /** 分面计数基于「搜索 + 站点」之后、类别/格式之前的一层。 */
  private readonly facetBase = computed<readonly RowBase[]>(() => {
    const rows: readonly RowBase[] =
      this.scope() === 'library' ? this.libraryRows : this.discoverRows;
    return rows.filter((row) => this.matchesSearch(row) && this.matchesSite(row));
  });

  readonly sites = computed<FilterSite[]>(() => {
    if (this.scope() === 'library') {
      const count = this.libraryRows.filter((row) => this.matchesSearch(row)).length;
      return [{ key: 'local', label: '本机', count, title: '本机 workspace/models' }];
    }
    const rows = this.discoverRows.filter((row) => this.matchesSearch(row));
    return DISCOVER_SITES.map((site) => ({
      ...site,
      count: rows.filter((row) => row.sourceKey === site.key).length,
    }));
  });

  readonly facets = computed<FilterFacetGroup[]>(() => {
    const rows = this.facetBase();
    return [
      {
        key: 'category',
        label: '类别',
        options: CATEGORY_OPTIONS.map((option) => ({
          key: option.key,
          label: option.label,
          count: rows.filter((row) => row.category === option.key).length,
        })),
      },
      {
        key: 'format',
        label: '格式',
        options: FORMAT_OPTIONS.map((option) => ({
          key: option.key,
          label: option.label,
          count: rows.filter((row) => row.format === option.key).length,
        })),
      },
    ];
  });

  readonly facts = computed<CollectionFact[]>(() => {
    const rows = this.facetBase();
    const size = fmtBytes(rows.reduce((sum, row) => sum + row.sizeBytes, 0));
    if (this.scope() === 'library') {
      const broken = rows.filter((row) => row.statusTone !== 'green').length;
      return [
        { label: '范围', value: '本机', title: '扫描 workspace/models 下的权重文件' },
        { label: '占用', value: size, title: '当前搜索与站点范围内的本地占用' },
        {
          label: '缺损',
          value: `${broken} 个`,
          tone: broken ? 'warn' : 'ok',
          title: '权重缺失或损坏的条目',
        },
      ];
    }
    const stored = this.discoverRows.filter(
      (row) => row.inLibrary && this.matchesSearch(row) && this.matchesSite(row),
    ).length;
    return [
      {
        label: '范围',
        value: '4 个站点',
        title: 'Hugging Face / ModelScope / GitHub / Civitai',
      },
      { label: '候选体积', value: size, title: '当前搜索与站点范围内声明的文件大小合计' },
      { label: '已入库', value: `${stored} 个`, title: '这批候选里已经在本机的条目' },
    ];
  });

  readonly libraryShown = computed<LibraryRow[]>(() =>
    this.scope() === 'library'
      ? this.sortRows(this.libraryRows.filter((row) => this.matchesAll(row)))
      : [],
  );

  readonly discoverShown = computed<DiscoverRow[]>(() =>
    this.scope() === 'discover'
      ? this.sortRows(this.discoverRows.filter((row) => this.matchesAll(row)))
      : [],
  );

  readonly resultCount = computed(() =>
    this.scope() === 'library' ? this.libraryShown().length : this.discoverShown().length,
  );

  readonly scopeTotal = computed(() =>
    this.scope() === 'library' ? this.libraryRows.length : this.discoverRows.length,
  );

  readonly hasFilter = computed(() => {
    const facet = Object.values(this.facetSelected()).some((keys) => keys.length > 0);
    if (this.scope() === 'library') return this.search().trim() !== '' || facet;
    return this.search().trim() !== '' || this.site() !== 'all' || facet;
  });

  readonly tableRows = computed(() => {
    const rows: readonly RowBase[] =
      this.scope() === 'library' ? this.libraryShown() : this.discoverShown();
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      source: sourceLabel(row.sourceKey),
      size: fmtBytes(row.sizeBytes),
      status: row.status,
      tone: row.statusTone,
      updatedAt: fmtWhen(row.updatedAt),
    }));
  });

  readonly sectionTitle = computed(() =>
    this.scope() === 'library' ? '已入库模型' : '发现结果',
  );

  readonly sectionPill = computed(() => `${this.resultCount()} 个`);

  readonly refreshLabel = computed(() =>
    this.scope() === 'library' ? '重新扫描本地库' : '重新拉取发现列表',
  );

  readonly emptyTitle = computed(() => {
    const q = this.search().trim();
    if (q) return `没有匹配「${q}」的模型`;
    return this.scope() === 'library' ? '本地库还没有符合条件的模型' : '这些站点还没有符合条件的模型';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
    });
  }

  onScope(key: string): void {
    if (key !== 'library' && key !== 'discover') return;
    if (key === this.scope()) return;
    this.scope.set(key);
    this.search.set('');
    this.site.set('all');
    this.facetSelected.set({});
  }

  onSort(key: string): void {
    if (key === 'recent' || key === 'name' || key === 'size') this.sort.set(key);
  }

  onFacetChange(change: FilterFacetChange): void {
    this.facetSelected.update((current) => {
      const keys = current[change.group] ?? [];
      const next = change.on ? [...keys, change.key] : keys.filter((key) => key !== change.key);
      const out = { ...current };
      if (next.length) out[change.group] = next;
      else delete out[change.group];
      return out;
    });
  }

  clearAll(): void {
    this.search.set('');
    this.site.set('all');
    this.facetSelected.set({});
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshing.set(false);
    }, 650);
  }

  private matchesAll(row: RowBase): boolean {
    return this.matchesSearch(row) && this.matchesSite(row) && this.matchesFacets(row);
  }

  private matchesSearch(row: RowBase): boolean {
    const q = this.search().trim().toLowerCase();
    if (!q) return true;
    return `${row.name} ${sourceLabel(row.sourceKey)}`.toLowerCase().includes(q);
  }

  private matchesSite(row: RowBase): boolean {
    const site = this.site();
    if (!site || site === 'all' || site === 'local') return true;
    return row.sourceKey === site;
  }

  private matchesFacets(row: RowBase): boolean {
    const selected = this.facetSelected();
    const categories = selected['category'] ?? [];
    if (categories.length && !categories.includes(row.category)) return false;
    const formats = selected['format'] ?? [];
    if (formats.length && !formats.includes(row.format)) return false;
    return true;
  }

  private sortRows<T extends RowBase>(rows: readonly T[]): T[] {
    const key = this.sort();
    return [...rows].sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
      if (key === 'size') return b.sizeBytes - a.sizeBytes;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
}
