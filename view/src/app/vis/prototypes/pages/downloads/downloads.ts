import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '../../../../ui/badge';
import { EmptyComponent } from '../../../../ui/empty';
import { PageHeaderComponent } from '../../../../ui/page-header';
import { SourceChipComponent } from '../../../../ui/source-chip';
import { ToastComponent } from '../../../../ui/toast';
import { UiButtonComponent } from '../../../../ui/button';
import { InputComponent } from '../../../../ui/input';
import { UiMaterialModule } from '../../../../ui/material';
import { ProtoShellComponent } from '../../proto-shell';
import { TagComponent } from '../../../../ui/tag';
import { ListRowComponent } from '../../../../ui/list-row';
import { ProgressComponent } from '../../../../ui/progress';

type SourceState = 'ok' | 'degraded' | 'down';

interface SourceItem {
  key: string;
  label: string;
  state: SourceState;
  speed: string;
  tip: string;
}

interface WeightRow {
  id: string;
  name: string;
  folder: string;
  sizeLabel: string;
  sizeMb: number;
  recommended: boolean;
  selected: boolean;
  note: string;
}

type TaskState = 'active' | 'paused' | 'done';
type StrategyKey = 'auto' | 'direct' | 'mirror' | 'proxy';
type TaskTab = 'all' | 'active' | 'done';

interface TaskItem {
  id: string;
  name: string;
  source: string;
  state: TaskState;
  doneMb: number;
  totalMb: number;
  speed: string;
  remaining: string;
  files: number;
  /** 已完成行的副标题（模型 / 工作流 / 节点 · 大小） */
  subtitle?: string;
  finishedAt?: string;
}

/**
 * VIS 原型 · 下载页。
 *
 * 来源门控、解析推荐组合、权重折叠、通路解锁与任务分层。
 * 数据写在组件里，不接后端。
 */
@Component({
  selector: 'app-proto-downloads',
  imports: [
    ListRowComponent,
    ProgressComponent,
    TagComponent,
    ProtoShellComponent,
    PageHeaderComponent,
    BadgeComponent,
    EmptyComponent,
    SourceChipComponent,
    ToastComponent,
    UiButtonComponent,
    InputComponent,
    UiMaterialModule,
  ],
  styleUrl: './downloads.scss',
  template: `
    <app-proto-shell active="downloads" title="下载" hint="来源、解析与任务队列">
      <div class="page">
        <ui-page-header
          kicker="Assets · Downloads"
          title="下载"
          hint="从可用来源取回权重，通路由探针自动选择。"
        >
          <ui-button variant="secondary" type="button" (click)="openDownloadDir()">
            <mat-icon svgIcon="app:folder-open" />
            打开下载目录
          </ui-button>
        </ui-page-header>

        @if (notice()) {
          <div class="toast-dock">
            <ui-toast [dismissible]="true" [duration]="4200" (dismiss)="notice.set('')">
              {{ notice() }}
            </ui-toast>
          </div>
        }

        <section class="sources" aria-label="来源状态">
          @for (source of sources; track source.key) {
            <ui-source-chip
              [label]="source.label"
              [detail]="source.speed"
              [state]="source.state"
              [active]="selectedSourceKey() === source.key"
              [tip]="source.tip"
              (picked)="pickSource(source)"
            />
          }
        </section>

        <section class="panel" aria-label="新建下载">
          <div class="panel-head">
            <h2>新建下载</h2>
            <span class="muted">来源不可达时不出现在可选列表</span>
          </div>
          <div class="composer">
            <div class="composer-row">
              <ui-input
                class="composer-input"
                ariaLabel="模型 ID"
                [value]="repoId()"
                (valueChange)="onRepoInput($event)"
                placeholder="组织/仓库，如 Comfy-Org/MiniMax-H3-Image"
              >
                <svg input-leading viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.4" />
                  <path d="M10.3 10.3 13.6 13.6" />
                </svg>
              </ui-input>
              <ui-button variant="primary" type="button" [disabled]="resolving() || !repoId().trim()" (click)="resolveRepo()">
                {{ resolving() ? '解析中…' : '解析' }}
              </ui-button>
            </div>

            @if (repoError()) {
              <p class="composer-error" role="alert">{{ repoError() }}</p>
            }

            @if (resolved() && !repoError()) {
              <div class="resolved">
                <div class="repo-line">
                  <b>{{ resolvedName() }}</b>
                  <ui-badge tone="blue">{{ sourceName() }}</ui-badge>
                  <span class="muted mono">{{ repoId() }}</span>
                </div>

                <div class="fit">
                  <b>推荐 W4A8 单文件组合</b>
                  <span class="fit-note">RTX 4080 SUPER · 16 GB 显存 · 预计 28.9 GB</span>
                  <span class="grow"></span>
                  <ui-badge tone="orange">需分层加载</ui-badge>
                </div>

                <div class="weights">
                  @for (weight of visibleWeights(); track weight.id) {
                    <label class="weight-row">
                      <input
                        type="checkbox"
                        [checked]="weight.selected"
                        (change)="toggleWeight(weight)"
                        [attr.aria-label]="'选择 ' + weight.name"
                      />
                      <span class="nm">
                        <b>{{ weight.name }}</b>
                        <span>{{ weight.folder }}</span>
                      </span>
                      <span class="sz">{{ weight.sizeLabel }}</span>
                      <span class="tag">
                        @if (weight.recommended) {
                          <ui-badge tone="green">推荐</ui-badge>
                        } @else {
                          <ui-badge tone="orange">{{ weight.note }}</ui-badge>
                        }
                      </span>
                    </label>
                  }
                  <div class="more">
                    <button type="button" (click)="toggleAllWeights()">
                      {{
                        showAllWeights()
                          ? '只看推荐组合'
                          : '查看全部权重 (' + weights().length + ')'
                      }}
                    </button>
                  </div>
                </div>

                <div class="auto-folders">
                  <span>自动归类</span>
                  @for (group of autoFolders(); track group.folder) {
                    <ui-tag [mono]="true">{{ group.folder }} · {{ group.count }}</ui-tag>
                  } @empty {
                    <span class="faint">还没有勾选权重</span>
                  }
                </div>

                <div class="action-row">
                  <ui-button variant="primary" type="button" [disabled]="!selectedSizeMb()" (click)="startDownload()">
                    {{ downloadLabel() }}
                  </ui-button>
                  <ui-button variant="secondary" type="button" (click)="customSelect()">
                    自定义选择
                  </ui-button>
                  <span class="grow"></span>
                  <span class="strategy">
                    @if (strategyLocked()) {
                      自动 · <b>{{ strategyText() }}</b>
                      <ui-button variant="secondary" type="button" (click)="unlockStrategy()">解锁</ui-button>
                    } @else {
                      通路
                      <select
                        [value]="strategyChoice()"
                        (change)="setStrategy($event)"
                        aria-label="下载通路"
                      >
                        @for (option of strategyOptions; track option.key) {
                          <option [value]="option.key">{{ option.label }}</option>
                        }
                      </select>
                      <ui-button variant="secondary" type="button" (click)="restoreAuto()">恢复自动</ui-button>
                    }
                  </span>
                </div>
              </div>
            }
          </div>
        </section>

        <section class="panel" aria-label="下载任务">
          <div class="task-toolbar">
            <div class="tabs" role="tablist" aria-label="任务状态">
              <button
                class="tab"
                type="button"
                role="tab"
                [class.on]="tab() === 'all'"
                [attr.aria-selected]="tab() === 'all'"
                (click)="tab.set('all')"
              >
                全部 <b>{{ allCount() }}</b>
              </button>
              <button
                class="tab"
                type="button"
                role="tab"
                [class.on]="tab() === 'active'"
                [attr.aria-selected]="tab() === 'active'"
                (click)="tab.set('active')"
              >
                进行中 <b>{{ activeCount() }}</b>
              </button>
              <button
                class="tab"
                type="button"
                role="tab"
                [class.on]="tab() === 'done'"
                [attr.aria-selected]="tab() === 'done'"
                (click)="tab.set('done')"
              >
                已完成 <b>{{ doneCount() }}</b>
              </button>
            </div>

            <ui-input
              class="task-search"
              size="sm"
              ariaLabel="搜索任务"
              [value]="taskQuery()"
              (valueChange)="onTaskQuery($event)"
              placeholder="搜索任务"
            >
              <svg input-leading viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.4" />
                <path d="M10.3 10.3 13.6 13.6" />
              </svg>
            </ui-input>
          </div>

          <div class="task-list">
            @for (task of shownActive(); track task.id) {
              <ui-list-row sideWidth="260px">
                <div rowMain class="task-main">
                  <div class="task-name">
                    <b>{{ task.name }}</b>
                    <ui-tag>{{ task.source }}</ui-tag>
                    <ui-badge [tone]="task.state === 'paused' ? 'orange' : 'green'">
                      {{ task.state === 'paused' ? '已暂停' : '下载中' }}
                    </ui-badge>
                  </div>
                  <div class="task-meta">
                    <span>{{ fmtSize(task.doneMb) }} / {{ fmtSize(task.totalMb) }}</span>
                    <span class="mono">{{ task.speed }}</span>
                    <span>{{ task.remaining }}</span>
                    <span>{{ task.files }} 个文件</span>
                  </div>
                  <ui-progress
                    class="task-progress"
                    [value]="pct(task)"
                    [label]="task.name + ' 下载进度'"
                  />
                </div>
                <div rowSide class="task-side">
                  <div class="stat">
                    <b>{{ pct(task) }}%</b>
                    <span>已完成</span>
                  </div>
                  <ui-button variant="secondary" size="sm" type="button" (click)="togglePause(task)">
                    {{ task.state === 'paused' ? '继续' : '暂停' }}
                  </ui-button>
                  <ui-button variant="ghost" size="sm" type="button" (click)="cancelTask(task)">
                    取消
                  </ui-button>
                </div>
              </ui-list-row>
            }

            @for (task of shownDone(); track task.id) {
              <div class="done-row">
                <span class="nm">
                  <b>{{ task.name }}</b>
                  <span>{{ task.subtitle }}</span>
                </span>
                <ui-badge tone="green">已完成</ui-badge>
                <span class="faint mono">{{ task.finishedAt }}</span>
                <span class="done-actions">
                  <ui-button variant="ghost" size="xs" type="button" (click)="openTaskDir(task)">
                    打开目录
                  </ui-button>
                  <ui-button variant="ghost" size="xs" type="button" (click)="removeTask(task)">
                    删除记录
                  </ui-button>
                </span>
              </div>
            }

            @if (!shownActive().length && !shownDone().length) {
              <ui-empty
                icon="⌕"
                [title]="emptyTitle()"
                hint="换个关键词，或切换到「全部」查看所有任务。"
              />
            }
          </div>
        </section>
      </div>
    </app-proto-shell>
  `,
})
export class ProtoDownloadsComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly sources: SourceItem[] = [
    { key: 'hf', label: 'Hugging Face', state: 'ok', speed: '直连 5.2', tip: '探针可用 · 直连 5.2 MB/s' },
    { key: 'ms', label: 'ModelScope', state: 'ok', speed: '直连 6.8', tip: '探针可用 · 直连 6.8 MB/s' },
    { key: 'civitai', label: 'Civitai', state: 'down', speed: '不可达', tip: '探针不可达：三条通路均超时' },
    { key: 'github', label: 'GitHub', state: 'ok', speed: '直连 3.4', tip: '探针可用 · 直连 3.4 MB/s' },
    { key: 'comfyhub', label: 'ComfyHub', state: 'degraded', speed: '未探测', tip: '尚未探测 · 首次使用时会自动测速' },
  ];

  readonly weights = signal<WeightRow[]>([
    {
      id: 'w4a8',
      name: 'minimax_h3_image_pruned_w4a8.safetensors',
      folder: 'diffusion_models/',
      sizeLabel: '11.7 GB',
      sizeMb: 11981,
      recommended: true,
      selected: true,
      note: '推荐',
    },
    {
      id: 'te-w4a8',
      name: 'qwen3.8_27b_minimax_h3_image_pe_w4a8_gptq.safetensors',
      folder: 'text_encoders/',
      sizeLabel: '16.1 GB',
      sizeMb: 16486,
      recommended: true,
      selected: true,
      note: '推荐',
    },
    {
      id: 'vae-fp16',
      name: 'minimax_h3_image_vae_fp16.safetensors',
      folder: 'vae/',
      sizeLabel: '1.1 GB',
      sizeMb: 1126,
      recommended: true,
      selected: true,
      note: '推荐',
    },
    {
      id: 'bf16',
      name: 'minimax_h3_image_pruned_bf16.safetensors',
      folder: 'diffusion_models/',
      sizeLabel: '37.5 GB',
      sizeMb: 38400,
      recommended: false,
      selected: false,
      note: '需转换',
    },
    {
      id: 'int8',
      name: 'minimax_h3_image_pruned_int8_convrot.safetensors',
      folder: 'diffusion_models/',
      sizeLabel: '19.5 GB',
      sizeMb: 19968,
      recommended: false,
      selected: false,
      note: '需转换',
    },
    {
      id: 'te-9b',
      name: 'qwen3.5_9b_w4a8_gptq.safetensors',
      folder: 'text_encoders/',
      sizeLabel: '6.8 GB',
      sizeMb: 6963,
      recommended: false,
      selected: false,
      note: '需转换',
    },
    {
      id: 'te-int8',
      name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
      folder: 'text_encoders/',
      sizeLabel: '25.3 GB',
      sizeMb: 25907,
      recommended: false,
      selected: false,
      note: '需转换',
    },
    {
      id: 'te-nvfp4',
      name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      folder: 'text_encoders/',
      sizeLabel: '14.6 GB',
      sizeMb: 14950,
      recommended: false,
      selected: false,
      note: '需转换',
    },
  ]);

  readonly strategyOptions: { key: StrategyKey; label: string }[] = [
    { key: 'auto', label: '自动（最快可用）' },
    { key: 'direct', label: '直连' },
    { key: 'mirror', label: '镜像' },
    { key: 'proxy', label: '代理' },
  ];

  readonly tasks = signal<TaskItem[]>([
    {
      id: 't-flux',
      name: 'FLUX.1-dev',
      source: 'Hugging Face',
      state: 'active',
      doneMb: 12698,
      totalMb: 24371,
      speed: '5.2 MB/s',
      remaining: '剩余 37 分钟',
      files: 3,
    },
    {
      id: 't-minimax',
      name: 'MiniMax-H3-Image',
      source: 'Hugging Face',
      state: 'active',
      doneMb: 8294,
      totalMb: 29594,
      speed: '3.8 MB/s',
      remaining: '剩余 1 小时 31 分',
      files: 3,
    },
    {
      id: 'd-flux-fp8',
      name: 'flux1-dev-fp8.safetensors',
      source: 'Hugging Face',
      state: 'done',
      doneMb: 12186,
      totalMb: 12186,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: 'FLUX.1-dev · 11.9 GB',
      finishedAt: '11-21 09:04',
    },
    {
      id: 'd-qwen',
      name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      source: 'Hugging Face',
      state: 'done',
      doneMb: 14950,
      totalMb: 14950,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: 'MiniMax-H3-Image · 14.6 GB',
      finishedAt: '11-20 18:11',
    },
    {
      id: 'd-workflow',
      name: 'sdxl-inpaint-workflow.json',
      source: 'GitHub',
      state: 'done',
      doneMb: 3.1,
      totalMb: 3.1,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: '工作流 · 3.1 MB',
      finishedAt: '11-19 14:02',
    },
    {
      id: 'd-impact',
      name: 'ComfyUI-Impact-Pack',
      source: 'GitHub',
      state: 'done',
      doneMb: 18,
      totalMb: 18,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: '节点 · 18 MB',
      finishedAt: '11-18 07:42',
    },
    {
      id: 'd-vae',
      name: 'minimax_h3_image_vae_fp16.safetensors',
      source: 'Hugging Face',
      state: 'done',
      doneMb: 1126,
      totalMb: 1126,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: 'MiniMax-H3-Image · 1.1 GB',
      finishedAt: '11-17 20:10',
    },
    {
      id: 'd-te',
      name: 'qwen3.8_27b_minimax_h3_image_pe_w4a8_gptq.safetensors',
      source: 'Hugging Face',
      state: 'done',
      doneMb: 16486,
      totalMb: 16486,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: 'MiniMax-H3-Image · 16.1 GB',
      finishedAt: '11-17 19:55',
    },
    {
      id: 'd-lora',
      name: 'detail_tweaker_xl.safetensors',
      source: 'ModelScope',
      state: 'done',
      doneMb: 184,
      totalMb: 184,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: '自定义 LoRA · 184 MB',
      finishedAt: '11-16 16:40',
    },
    {
      id: 'd-sdxl',
      name: 'sdxl_base_1.0.safetensors',
      source: 'Hugging Face',
      state: 'done',
      doneMb: 7066,
      totalMb: 7066,
      speed: '',
      remaining: '',
      files: 1,
      subtitle: 'SDXL · 6.9 GB',
      finishedAt: '11-16 10:08',
    },
  ]);

  readonly selectedSourceKey = signal('hf');
  readonly repoId = signal('Comfy-Org/MiniMax-H3-Image');
  readonly resolvedName = signal('MiniMax-H3-Image');
  readonly resolved = signal(true);
  readonly resolving = signal(false);
  readonly repoError = signal('');
  readonly showAllWeights = signal(false);
  readonly strategyLocked = signal(true);
  readonly strategyChoice = signal<StrategyKey>('auto');
  readonly tab = signal<TaskTab>('all');
  readonly taskQuery = signal('');
  readonly notice = signal('');

  private resolveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly sourceName = computed(
    () => this.sources.find((s) => s.key === this.selectedSourceKey())?.label ?? 'Hugging Face',
  );

  readonly strategyText = computed(() => {
    if (this.strategyChoice() === 'auto') return '直连 5.2 MB/s';
    return (
      this.strategyOptions.find((o) => o.key === this.strategyChoice())?.label ?? '直连'
    );
  });

  readonly visibleWeights = computed(() =>
    this.showAllWeights()
      ? this.weights()
      : this.weights().filter((w) => w.recommended),
  );

  readonly selectedWeights = computed(() => this.weights().filter((w) => w.selected));

  readonly selectedSizeMb = computed(() =>
    this.selectedWeights().reduce((sum, w) => sum + w.sizeMb, 0),
  );

  readonly downloadLabel = computed(() => {
    const hasExtra = this.weights().some((w) => w.selected && !w.recommended);
    return `${hasExtra ? '下载所选组合' : '下载推荐组合'} · ${this.fmtSize(this.selectedSizeMb())}`;
  });

  readonly autoFolders = computed(() => {
    const counts = new Map<string, number>();
    for (const weight of this.selectedWeights()) {
      counts.set(weight.folder, (counts.get(weight.folder) ?? 0) + 1);
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count }));
  });

  readonly allCount = computed(() => this.tasks().length);
  readonly activeCount = computed(() => this.tasks().filter((t) => t.state !== 'done').length);
  readonly doneCount = computed(() => this.tasks().filter((t) => t.state === 'done').length);

  readonly searchedTasks = computed(() => {
    const q = this.taskQuery().trim().toLowerCase();
    if (!q) return this.tasks();
    return this.tasks().filter((t) =>
      `${t.name} ${t.source} ${t.subtitle ?? ''}`.toLowerCase().includes(q),
    );
  });

  readonly shownActive = computed(() => {
    if (this.tab() === 'done') return [];
    return this.searchedTasks().filter((t) => t.state !== 'done');
  });

  readonly shownDone = computed(() => {
    if (this.tab() === 'active') return [];
    return this.searchedTasks().filter((t) => t.state === 'done');
  });

  readonly emptyTitle = computed(() =>
    this.taskQuery() ? `没有匹配「${this.taskQuery()}」的任务` : '这个分组里还没有任务',
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.resolveTimer) clearTimeout(this.resolveTimer);
    });
  }

  pickSource(source: SourceItem): void {
    if (source.state === 'down') return;
    this.selectedSourceKey.set(source.key);
    this.notice.set(
      source.state === 'degraded'
        ? `${source.label} 尚未探测，首次下载时会自动测速。`
        : `已选择来源：${source.label} · ${source.speed} MB/s`,
    );
  }

  onRepoInput(value: string): void {
    this.repoId.set(value);
    this.repoError.set('');
  }

  resolveRepo(): void {
    const id = this.repoId().trim();
    if (!id) {
      this.repoError.set('模型 ID 不能为空。');
      return;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) {
      this.repoError.set('模型 ID 需要「组织/仓库」两段，例如 Comfy-Org/MiniMax-H3-Image。');
      return;
    }
    this.repoError.set('');
    this.resolving.set(true);
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.resolveTimer = setTimeout(() => {
      this.resolving.set(false);
      this.resolved.set(true);
      const name = id.split('/').pop() || id;
      this.resolvedName.set(name);
      this.notice.set(`解析完成：${name} · 8 个权重文件，已自动推荐 3 个。`);
    }, 500);
  }

  toggleWeight(weight: WeightRow): void {
    this.weights.update((list) =>
      list.map((w) => (w.id === weight.id ? { ...w, selected: !w.selected } : w)),
    );
  }

  toggleAllWeights(): void {
    this.showAllWeights.update((v) => !v);
  }

  customSelect(): void {
    this.showAllWeights.set(true);
    this.notice.set('已展开全部权重，可按需勾选；非推荐项需要先转换才能被 ComfyUI 直接加载。');
  }

  unlockStrategy(): void {
    this.strategyLocked.set(false);
  }

  setStrategy(event: Event): void {
    this.strategyChoice.set((event.target as HTMLSelectElement).value as StrategyKey);
  }

  restoreAuto(): void {
    this.strategyChoice.set('auto');
    this.strategyLocked.set(true);
  }

  startDownload(): void {
    if (!this.selectedSizeMb()) return;
    const task: TaskItem = {
      id: `t-${Date.now()}`,
      name: this.resolvedName(),
      source: this.sourceName(),
      state: 'active',
      doneMb: 0,
      totalMb: this.selectedSizeMb(),
      speed: '准备中',
      remaining: '等待开始',
      files: this.selectedWeights().length,
    };
    this.tasks.update((list) => [task, ...list]);
    this.tab.set('all');
    this.notice.set(
      `已创建下载任务：${task.name} · ${this.fmtSize(task.totalMb)} · ${task.files} 个文件。`,
    );
  }

  togglePause(task: TaskItem): void {
    const next: TaskState = task.state === 'paused' ? 'active' : 'paused';
    this.tasks.update((list) =>
      list.map((t) => (t.id === task.id ? { ...t, state: next } : t)),
    );
    this.notice.set(next === 'paused' ? `已暂停：${task.name}` : `继续下载：${task.name}`);
  }

  cancelTask(task: TaskItem): void {
    this.tasks.update((list) => list.filter((t) => t.id !== task.id));
    this.notice.set(`已取消并移除任务：${task.name}`);
  }

  removeTask(task: TaskItem): void {
    this.tasks.update((list) => list.filter((t) => t.id !== task.id));
    this.notice.set(`已删除下载记录：${task.name}（文件仍在磁盘上）`);
  }

  openTaskDir(task: TaskItem): void {
    this.notice.set(`已在文件管理器中打开 ${task.name} 的下载目录。`);
  }

  openDownloadDir(): void {
    this.notice.set('已在文件管理器中打开 workspace/downloads/。');
  }

  onTaskQuery(value: string): void {
    this.taskQuery.set(value);
  }

  pct(task: TaskItem): number {
    if (!task.totalMb) return 0;
    return Math.min(100, Math.round((task.doneMb / task.totalMb) * 100));
  }

  fmtSize(mb: number): string {
    if (mb <= 0) return '0 B';
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 10) return `${Math.round(mb)} MB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.max(1, Math.round(mb * 1024))} KB`;
  }
}
