import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ApiService } from '../core/api.service';
import {
  ComfyEnv,
  ComfyEnvCheck,
  ComfyInstallEvent,
  ComfyInstallJob,
  ComfyInstallKind,
  ComfyInstance,
  ComfyPhase,
  ComfyPreview,
  ComfyProgress,
  ComfyRuntime,
  ComfyStep,
  fmtSize,
} from '../core/types';
import { BadgeComponent, BadgeTone } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

const PHASE_LABELS: Record<ComfyPhase, string> = {
  download: '正在下载',
  unpack: '正在解压',
  clone: '正在拉取代码',
  resolve: '正在解析依赖',
  install: '正在安装依赖',
  done: '本步骤完成',
  idle: '准备中',
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

/** 探测结果还没回来时的占位，模板不必到处判空 */
const EMPTY_RUNTIME: ComfyRuntime = {
  ready: false,
  python_ready: false,
  python_version: '',
  python_source: 'cnb',
  python_cached: false,
  torch_ready: false,
  torch_version: null,
  torchvision_version: null,
  torchaudio_version: null,
  cuda_runtime: null,
  torch_channel: null,
  lock_ready: false,
  path: '',
};

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours
    ? `${hours}:${pad(minutes)}:${pad(value % 60)}`
    : `${pad(minutes)}:${pad(value % 60)}`;
}

@Component({
  selector: 'app-comfy',
  standalone: true,
  imports: [CommonModule, BadgeComponent, EmptyComponent, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header title="环境管理" hint="ComfyUI 独立运行在你的电脑上，与本站环境互不影响。" />

    <div class="env-layout">
      <div class="env-main">
        <ui-panel title="基础环境">
          <div panel-actions>
            <ui-badge [tone]="runtime.ready ? 'green' : 'orange'">
              {{ runtime.ready ? '已安装' : '未安装' }}
            </ui-badge>
          </div>

          @if (error) {
            <div class="notice err">
              {{ error }}
              <button (click)="reload(true)">重试</button>
            </div>
          } @else if (env) {
            <div class="env-list">
              <div class="env-list-row">
                <span class="env-name">Python</span>
                <strong>{{ runtime.python_ready ? runtime.python_version : '—' }}</strong>
                <span class="env-state" [class.ok]="runtime.python_ready">
                  {{ runtime.python_ready ? '已安装' : '待安装' }}
                </span>
              </div>
              <div class="env-list-row">
                <span class="env-name">PyTorch</span>
                <strong>{{ runtime.torch_version || '—' }}</strong>
                <span class="env-state" [class.ok]="runtime.torch_ready">
                  {{ runtime.torch_ready ? '已安装' : '待安装' }}
                </span>
              </div>
              <div class="env-list-row">
                <span class="env-name">CUDA 运行时</span>
                <strong>{{ cudaLabel }}</strong>
                <span class="env-state" [class.ok]="!!runtime.cuda_runtime">{{ cudaState }}</span>
              </div>
            </div>

            @if (checkResult) {
              <div class="check-box" [class.ok]="checkResult.ok">
                @if (checkResult.ok) {
                  <div>环境正常 · Python {{ checkResult.python }} · PyTorch {{ checkResult.torch }}</div>
                } @else {
                  @for (issue of checkResult.issues; track issue.code) {
                    <div class="check-row">
                      <div>
                        <strong>{{ issue.title }}</strong>
                        <div class="muted">{{ issue.detail }}</div>
                      </div>
                      @if (issue.fix === 'install') {
                        <button (click)="repair()">修复</button>
                      }
                    </div>
                  }
                }
              </div>
            }

            <!-- 互斥：没装只给「安装」；装好后「安装」换成「环境检测」（修复入口） -->
            <div class="toolbar env-actions">
              @if (!runtime.ready || (installing && installKind === 'environment')) {
                <button class="primary" (click)="openInstall('environment')" [disabled]="busy">
                  {{ installButtonLabel }}
                </button>
              } @else {
                <button (click)="runEnvCheck()" [disabled]="checking || loading || installing">
                  {{ checking ? '检测中…' : '环境检测' }}
                </button>
              }
            </div>
          } @else {
            <div class="muted">正在检测本机环境…</div>
          }
        </ui-panel>

        <ui-panel title="ComfyUI 实例">
          <div panel-actions>
            <button
              class="primary btn-xs"
              (click)="openInstall('instance')"
              [disabled]="!canInstallInstance || busyInstance"
              [title]="runtime.ready ? '创建新的 ComfyUI 实例' : '请先安装基础环境'"
            >
              安装实例
            </button>
          </div>
          @if (!runtime.ready) {
            <div class="env-note muted">基础环境未就绪，先在上面的卡片里安装。</div>
          }
          @if (instanceError) {
            <div class="notice err">{{ instanceError }}</div>
          }
          <!-- 安装转后台后仍然看得见：点这一行就能回到进度弹层，不用刷新页面 -->
          @if (installingInstance) {
            <div class="instance-row installing" (click)="showInstallDialog()">
              <div class="instance-meta">
                <strong>{{ installingName }}</strong>
                <span class="muted">{{ installStageText }}</span>
                <ui-badge tone="blue">{{ overallPercent }}%</ui-badge>
              </div>
              <button class="btn-xs" (click)="showInstallDialog(); $event.stopPropagation()">
                查看进度
              </button>
            </div>
          }
          @if (visibleInstances.length) {
            @for (instance of visibleInstances; track instance.name) {
              <div class="instance-row">
                <div class="instance-meta">
                  <strong>{{ instance.name }}</strong>
                  @if (instance.version) {
                    <span class="muted">ComfyUI {{ instance.version }}</span>
                  }
                  @if (instance.registered === false) {
                    <ui-badge tone="orange">未登记</ui-badge>
                  }
                </div>
                <button
                  class="danger"
                  [disabled]="isDeleting(instance.name)"
                  (click)="removeInstance(instance)"
                >
                  {{ isDeleting(instance.name) ? '删除中…' : '删除' }}
                </button>
              </div>
            }
          } @else if (!installingInstance) {
            <ui-empty title="还没有实例" hint="点击「安装实例」创建，依赖会复用基础环境。" />
          }
        </ui-panel>
      </div>

      <aside class="env-side">
        <ui-panel title="设备详情" hint="只读检测，不会改动本机已有的环境">
          @if (env) {
            <div class="form-grid">
              <ui-field label="显卡">
                <span>{{ gpuName }}</span>
              </ui-field>
              <ui-field label="显存">
                <span>{{ vramLabel }}</span>
                <div class="muted">{{ vramNote }}</div>
              </ui-field>
              <ui-field label="驱动 / 算力">
                <span class="mono">{{ gpuDetail || '—' }}</span>
              </ui-field>
              <ui-field label="系统">
                <span>{{ osLabel }}</span>
                <div class="mono muted">{{ device.arch }}</div>
              </ui-field>
              <ui-field label="内存">
                <span>{{ memoryLabel }}</span>
                <div class="muted">{{ memoryNote }}</div>
              </ui-field>
              <ui-field label="磁盘">
                <span>{{ diskLabel }}</span>
                <div class="muted">{{ diskNote }}</div>
              </ui-field>
              <ui-field label="检测时间">
                <span class="mono">{{ device.probed_at }}</span>
              </ui-field>
            </div>
            @if (otherGpus) {
              <p class="muted">其他显示适配器：{{ otherGpus }}</p>
            }
            @for (action of visibleActions; track action.title) {
              <div class="device-note muted">
                <strong>{{ action.title }}</strong>
                @if (action.level === 'block' && action.detail) {
                  <div>{{ action.detail }}</div>
                }
              </div>
            }
          } @else {
            <div class="muted">正在检测本机环境…</div>
          }
        </ui-panel>
      </aside>
    </div>

    @if (preview; as pv) {
      @if (dialogOpen) {
        <div class="modal-overlay" (click)="closeDialog()">
          <div class="modal" [class.install-modal]="installingView" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <strong class="mc-title">{{ dialogTitle }}</strong>
              <span class="grow"></span>
              @if (installingView) {
                <ui-badge [tone]="statusTone">{{ statusText }}</ui-badge>
              }
              <button
                class="ghost"
                (click)="closeDialog()"
                [title]="installing ? '安装会在后台继续' : '关闭'"
              >
                ✕
              </button>
            </div>

            @if (previewLoading) {
              <div class="preview-loading">
                <span class="dot-spin"></span>
                <div class="pl-title">正在生成安装计划…</div>
                <div class="pl-sub muted">读取本机硬件并挑选最快的下载源</div>
              </div>
            } @else if (installingView) {
              <!-- 左：实时进度；右：执行日志 -->
              <div class="install-grid">
                <section class="install-left">
                  <div class="progress-hero">
                    <div class="ring-wrap">
                      <svg class="ring" viewBox="0 0 120 120" [class.done]="jobFinished" [class.failed]="jobFailed">
                        <circle class="ring-track" cx="60" cy="60" r="52" />
                        <circle
                          class="ring-value"
                          cx="60"
                          cy="60"
                          r="52"
                          [attr.stroke-dasharray]="ringCircumference"
                          [attr.stroke-dashoffset]="ringOffset"
                        />
                      </svg>
                      <div class="ring-label">
                        <strong>{{ overallPercent }}<small>%</small></strong>
                        <span>总进度</span>
                      </div>
                    </div>
                    <div class="hero-text">
                      <div class="hero-stage">{{ phaseText }}</div>
                      <div class="hero-title">{{ currentTitle }}</div>
                      <div class="hero-sub muted" [title]="progressLabel">{{ progressLabel }}</div>
                    </div>
                  </div>

                  <div class="progress phase" [class.indeterminate]="phasePercent < 0 && running">
                    <div [style.width.%]="phaseBarWidth"></div>
                  </div>

                  <div class="metrics">
                    <div class="metric"><span>下载速度</span><strong>{{ speedText }}</strong></div>
                    <div class="metric"><span>已下载 / 总量</span><strong>{{ transferText }}</strong></div>
                    <div class="metric"><span>剩余时间</span><strong>{{ etaText }}</strong></div>
                    <div class="metric"><span>已用时</span><strong>{{ elapsedText }}</strong></div>
                  </div>

                  <div class="step-list">
                    @for (step of pv.steps; track step.key; let i = $index) {
                      <div
                        class="step-row"
                        [class.active]="isActive(step.key)"
                        [class.done]="stepStatus(step.key) === 'done'"
                        [class.failed]="stepStatus(step.key) === 'failed'"
                      >
                        <span class="step-dot">{{ stepStatus(step.key) === 'done' ? '✓' : i + 1 }}</span>
                        <span class="step-name">{{ step.title }}</span>
                        <span class="step-state">
                          {{ stepStatus(step.key) === 'pending' ? '' : statusLabel(stepStatus(step.key)) }}
                        </span>
                      </div>
                    }
                  </div>
                </section>

                <section class="install-right">
                  <div class="log-head">
                    <strong>执行日志</strong>
                    <span class="muted">{{ logs.length }} 行</span>
                    <span class="grow"></span>
                    @if (!autoScroll) {
                      <button class="ghost btn-xs" (click)="followLogs()">回到最新 ↓</button>
                    }
                    <span
                      class="log-live"
                      [class.paused]="!autoScroll"
                      [title]="autoScroll ? '实时跟随' : '已暂停跟随'"
                    ></span>
                  </div>
                  <div class="log-view" #logView (scroll)="onLogScroll()">
                    @for (line of logs; track $index) {
                      <div class="log-line" [ngClass]="logLevel(line)">{{ line }}</div>
                    }
                    @if (!logs.length) {
                      <div class="muted">等待输出…</div>
                    }
                  </div>
                </section>
              </div>
            } @else {
              <div class="preview-note">共 {{ pv.steps.length }} 个步骤 · 预计占用约 {{ pv.total_gb }} GB</div>
              <div class="preview-steps">
                @for (step of pv.steps; track step.key; let i = $index) {
                  <div class="preview-step">
                    <span class="idx">{{ i + 1 }}</span>
                    <span class="grow">{{ step.title }}</span>
                    <span class="muted">{{ step.estimated_gb ? step.estimated_gb + ' GB' : '' }}</span>
                  </div>
                }
              </div>
            }

            <div class="modal-foot">
              @if (job?.result; as res) {
                <span [class.err-text]="!res.ok">{{ res.message }}</span>
              } @else if (installing) {
                <span class="muted">安装进行中，关闭窗口不会中断任务。</span>
              }
              <span class="grow"></span>
              @if (!installingView) {
                <button (click)="closeDialog()">取消</button>
                <button class="primary" (click)="startInstall()" [disabled]="previewLoading">
                  {{ previewLoading ? '准备中…' : '确认安装' }}
                </button>
              } @else if (installing) {
                <button (click)="closeDialog()">后台运行</button>
              } @else {
                <button class="primary" (click)="closeDialog()">完成</button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class ComfyComponent implements OnInit, OnDestroy {
  env: ComfyEnv | null = null;
  loading = false;
  error = '';
  deleting = '';
  instanceError = '';

  preview: ComfyPreview | null = null;
  /** 弹层已打开、安装计划还在生成（探测硬件 / 挑下载源要几秒） */
  previewLoading = false;
  job: ComfyInstallJob | null = null;
  dialogOpen = false;
  installing = false;
  installKind: ComfyInstallKind = 'environment';
  repairMode = false;
  checkResult: ComfyEnvCheck | null = null;
  checking = false;
  logs: string[] = [];
  stepState: Record<string, 'pending' | 'running' | 'done' | 'failed'> = {};
  progress: ComfyProgress | null = null;
  currentStep: { key: string; title: string; index: number; total: number } | null = null;
  /** 后端折算好的总进度（只增不减）；-1 表示后端还没给，退回前端估算 */
  jobOverall = -1;
  startedAt = 0;
  nowTick = Math.floor(Date.now() / 1000);
  autoScroll = true;
  ringCircumference = RING_CIRCUMFERENCE;

  @ViewChild('logView') logView?: ElementRef<HTMLDivElement>;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 预演请求序号：连点或关掉弹层后，旧响应不许再写回界面 */
  private previewSeq = 0;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** 后端还有实例在删时自动轮询刷新，删除完成后让那一行自己消失 */
  private deletePoll: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.reload(false);
    this.restoreInstall();
    this.clock = setInterval(() => {
      if (this.installing) this.nowTick = Math.floor(Date.now() / 1000);
    }, 1000);
  }

  ngOnDestroy(): void {
    this.stopPolling();
    if (this.clock) clearInterval(this.clock);
    if (this.deletePoll) clearTimeout(this.deletePoll);
  }

  // ---------------- 弹层状态 ----------------
  get installingView(): boolean {
    return this.job !== null || this.installing;
  }

  get running(): boolean {
    return this.installing;
  }

  get jobFinished(): boolean {
    return !!this.job && this.job.status !== 'running';
  }

  get jobFailed(): boolean {
    return !!this.job && (this.job.status === 'failed' || this.job.result?.ok === false);
  }

  get dialogTitle(): string {
    const env = this.installKind === 'environment';
    if (!this.installingView) return env ? '安装基础环境' : '安装 ComfyUI 实例';
    if (this.jobFailed) return '安装失败';
    if (this.jobFinished) return '安装完成';
    return env ? '正在安装基础环境' : '正在安装 ComfyUI 实例';
  }

  get statusTone(): BadgeTone {
    if (this.jobFailed) return 'red';
    if (this.jobFinished) return 'green';
    return 'blue';
  }

  get statusText(): string {
    if (this.jobFailed) return '失败';
    if (this.jobFinished) return '已完成';
    return '进行中';
  }

  /** 弹层打开时主按钮禁用；安装转入后台后按钮变成「查看安装进度」 */
  get busy(): boolean {
    return this.dialogOpen || (!this.installing && !this.canInstall);
  }

  get busyInstance(): boolean {
    return this.dialogOpen || this.installing || !this.canInstall;
  }

  get canInstallInstance(): boolean {
    return this.runtime.ready && this.canInstall;
  }

  /** 正在安装的是「ComfyUI 实例」：实例卡里要能看见它 */
  get installingInstance(): boolean {
    return this.installing && this.installKind === 'instance';
  }

  get installingName(): string {
    return this.job?.name || this.preview?.spec?.name || '新实例';
  }

  /** 提示行上的第二行说明：正在干什么 */
  get installStageText(): string {
    if (this.jobFailed) return '安装失败';
    if (this.currentStep) return this.currentStep.title;
    return this.progress ? this.progressLabel : '准备中…';
  }

  /** 安装中的实例已经由提示行代表，列表里别再来一行同名的「未登记」 */
  get visibleInstances() {
    const list = this.env?.device.instances ?? [];
    if (!this.installingInstance) return list;
    const busy = this.installingName;
    return list.filter((item) => item.name !== busy);
  }

  /** 后台运行时点提示行/按钮，回到进度弹层（不重新发起安装） */
  showInstallDialog(): void {
    if (!this.installing) return;
    this.dialogOpen = true;
    this.scrollLogs();
  }

  get installButtonLabel(): string {
    if (this.installing) return this.dialogOpen ? '安装中…' : '查看安装进度';
    return '安装';
  }

  // ---------------- 实时进度 ----------------
  get overallPercent(): number {
    if (this.jobFinished) return 100;
    // 后端按步骤权重算的总进度最准：torch 下 2GB 和「建个目录」不该各占一格。
    // 任务收尾（写 instance.json 之类）时还没结束，先封顶 99%。
    if (this.jobOverall >= 0) return Math.min(99, Math.round(this.jobOverall));
    const total = this.currentStep?.total || this.preview?.steps.length || 0;
    if (!total) return 0;
    const index = Math.min(total, Math.max(1, this.currentStep?.index || 1));
    const stepPct = this.progress && this.progress.percent >= 0 ? Math.min(100, this.progress.percent) : 0;
    return Math.min(100, Math.round((((index - 1) + stepPct / 100) / total) * 100));
  }

  get ringOffset(): number {
    return RING_CIRCUMFERENCE * (1 - this.overallPercent / 100);
  }

  get phasePercent(): number {
    return this.progress?.percent ?? -1;
  }

  get phaseBarWidth(): number {
    return this.phasePercent < 0 ? 35 : this.phasePercent;
  }

  get phaseText(): string {
    if (this.jobFailed) return '安装未完成';
    if (this.jobFinished) return '全部完成';
    if (!this.progress) return this.currentStep ? '执行中' : '正在启动';
    return PHASE_LABELS[this.progress.phase] || '执行中';
  }

  get currentTitle(): string {
    return this.currentStep?.title || (this.installing ? '正在启动安装…' : '安装结束');
  }

  get progressLabel(): string {
    return this.progress?.label || '准备中…';
  }

  get speedText(): string {
    const speed = this.progress?.speed || 0;
    return speed > 0 ? `${fmtSize(speed)}/s` : '—';
  }

  get transferText(): string {
    const p = this.progress;
    return p && p.size > 0 ? `${fmtSize(p.done)} / ${fmtSize(p.size)}` : '—';
  }

  get etaText(): string {
    const eta = this.progress?.eta;
    return eta && eta > 0 ? formatDuration(Math.ceil(eta)) : '—';
  }

  get elapsedText(): string {
    return this.startedAt ? formatDuration(this.nowTick - this.startedAt) : '—';
  }

  logLevel(line: string): string {
    if (line.startsWith('!!') || /ERROR:|error:/i.test(line)) return 'err';
    if (line.startsWith('==')) return 'step';
    if (line.trimStart().startsWith('$')) return 'cmd';
    if (/Successfully installed|校验通过|已就绪|完成/.test(line)) return 'ok';
    if (/WARNING|warn/i.test(line)) return 'warn';
    return 'plain';
  }

  isActive(key: string): boolean {
    return this.running && this.currentStep?.key === key;
  }

  // ---------------- 基础环境与版本 ----------------
  get runtime(): ComfyRuntime {
    return this.env?.runtime ?? EMPTY_RUNTIME;
  }

  /** 只显示实测到的版本；未装时不能拿计划通道的推算值冒充已装版本 */
  get cudaLabel(): string {
    // 非 NVIDIA 方案下，即便共享环境里残留了 CUDA 版 torch 也不显示 CUDA 版本号，
    // 否则会出现「CUDA 13.0 / 仅 CPU，无加速」这种自相矛盾的组合。
    if (this.plan.backend !== 'cuda') return '不适用';
    return this.runtime.cuda_runtime || '—';
  }

  get cudaState(): string {
    if (this.plan.backend !== 'cuda') return '不适用';
    return this.runtime.cuda_runtime ? '已安装' : '待安装';
  }

  // ---------------- 环境检测 ----------------
  /** 环境检测：实测内置解释器与 PyTorch，并刷新版本列表。 */
  runEnvCheck(): void {
    if (this.checking) return;
    this.checking = true;
    this.checkResult = null;
    this.api.comfyEnvCheck().subscribe({
      next: (result) => {
        this.checkResult = result;
        this.checking = false;
        this.reload(true);
      },
      error: (err) => {
        this.checking = false;
        this.checkResult = {
          ok: false,
          python: null,
          torch: null,
          backend: null,
          accelerator: null,
          checked_at: '',
          issues: [
            {
              code: 'check-failed',
              title: '检测失败',
              detail: err?.error?.detail || '无法运行环境检测，请确认后端服务正常',
              fix: null,
            },
          ],
        };
      },
    });
  }

  /** 检测结果里的可修复项：强制重装 PyTorch，不能因目录还在就跳过。 */
  repair(): void {
    if (this.dialogOpen || this.installing) return;
    this.checkResult = null;
    this.openInstall('environment', true);
  }

  // ---------------- 主页面结论 ----------------
  /** 只展示需要用户处理的提示；info 级都是技术说明，收进详情里 */
  get visibleActions() {
    return this.plan.actions.filter((action) => action.level !== 'info');
  }

  get canInstall(): boolean {
    const plan = this.env?.plan;
    if (!plan) return false;
    return plan.tier !== 'blocked' && plan.disk_ok;
  }

  // ---------------- 弹层操作 ----------------
  /** 页面刷新后接管仍在进行的安装任务 */
  private restoreInstall(): void {
    this.api.comfyCurrentInstall().subscribe({
      next: ({ job }) => {
        if (!job || job.status !== 'running') return;
        this.job = job;
        this.installKind = job.kind || 'instance';
        this.repairMode = !!job.repair;
        this.preview = {
          kind: this.installKind,
          spec: job.spec ?? {
            name: job.name,
            workspace: job.workspace,
            comfy_dir: '',
            environment: '',
            python: '',
            channel: '',
          },
          steps: job.steps,
          total_gb: Math.round(job.steps.reduce((sum, step) => sum + step.estimated_gb, 0) * 10) / 10,
        };
        this.logs = [];
        this.startedAt = 0;
        this.progress = null;
        this.jobOverall = -1;
        this.currentStep = null;
        this.stepState = Object.fromEntries(
          job.steps.map((step: ComfyStep) => [step.key, 'pending' as const]),
        );
        this.applyEvents(job.events || []);
        this.installing = true;
        // 不在刷新后自动弹层：任务在后台跑着，卡片里已经能看到「安装中」，
        // 用户想看细节自己点那一条（或基础环境卡片的「查看安装进度」）。
        this.dialogOpen = false;
        this.poll(job.id, job.total_events ?? job.events?.length ?? 0);
      },
    });
  }

  /** 从哪张卡片点的，就只装哪一类内容：基础环境 / ComfyUI 实例互不捆绑。 */
  openInstall(kind: ComfyInstallKind, repair = false): void {
    if (this.installing) {
      this.showInstallDialog();
      return;
    }
    this.installKind = kind;
    this.repairMode = repair;
    this.job = null;
    this.logs = [];
    this.progress = null;
    this.jobOverall = -1;
    this.currentStep = null;
    this.startedAt = 0;
    this.autoScroll = true;
    this.instanceError = '';
    this.stepState = {};
    // 弹层立刻出现，步骤等接口回来再填：探测硬件 + 挑下载源要 1 秒以上，
    // 之前是先等接口再开弹层，用户会以为按钮没反应。
    this.preview = {
      kind,
      spec: { name: '', workspace: '', comfy_dir: '', environment: '', python: '', channel: '' },
      steps: [],
      total_gb: 0,
    };
    this.previewLoading = true;
    this.dialogOpen = true;

    const seq = ++this.previewSeq;
    this.api.comfyPreview('', '', kind, repair).subscribe({
      next: (preview) => {
        if (seq !== this.previewSeq) return;
        this.preview = preview;
        this.previewLoading = false;
        this.stepState = Object.fromEntries(
          preview.steps.map((step: ComfyStep) => [step.key, 'pending' as const]),
        );
      },
      error: (err) => {
        if (seq !== this.previewSeq) return;
        this.previewLoading = false;
        this.preview = null;
        this.dialogOpen = false;
        const message = err?.error?.detail || '无法生成安装计划';
        if (kind === 'instance') this.instanceError = message;
        else this.error = message;
      },
    });
  }

  closeDialog(): void {
    this.previewSeq += 1; // 还没回来的预演响应作废
    this.previewLoading = false;
    if (this.installing) {
      // 任务在服务后端跑，隐藏弹层即可，轮询继续
      this.dialogOpen = false;
      return;
    }
    this.stopPolling();
    this.preview = null;
    this.job = null;
    this.dialogOpen = false;
    this.repairMode = false;
    this.logs = [];
    this.stepState = {};
    this.progress = null;
    this.jobOverall = -1;
    this.currentStep = null;
    this.startedAt = 0;
    this.autoScroll = true;
    this.reload(true);
  }

  startInstall(): void {
    if (!this.preview || this.previewLoading || this.installing) return;
    this.installing = true;
    this.startedAt = Math.floor(Date.now() / 1000);
    this.nowTick = this.startedAt;
    this.currentStep = null;
    this.progress = null;
    this.jobOverall = -1;
    this.logs = [];
    this.autoScroll = true;
    this.api.comfyInstall(this.preview.spec.name, '', this.installKind, this.repairMode).subscribe({
      next: ({ id }) => this.poll(id, 0),
      error: (err) => {
        this.installing = false;
        this.error = err?.error?.detail || '启动安装失败';
      },
    });
  }

  stepStatus(key: string): string {
    return this.stepState[key] || 'pending';
  }

  statusLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: '待执行',
      running: '进行中',
      done: '已完成',
      failed: '失败',
    };
    return labels[state] || state;
  }

  private poll(id: string, since: number): void {
    this.api.comfyInstallJob(id, since).subscribe({
      next: (job) => {
        this.job = job;
        this.applyEvents(job.events);
        if (job.status === 'running') {
          this.timer = setTimeout(() => this.poll(id, job.total_events), 1200);
        } else {
          this.installing = false;
          this.stopPolling();
          // 装完要立刻看到新实例（或失败后的错误行），别等用户手动刷新
          this.reload(true);
        }
      },
      error: () => {
        this.installing = false;
        this.stopPolling();
      },
    });
  }

  private applyEvents(events: ComfyInstallEvent[]): void {
    for (const event of events) {
      if (!this.startedAt && event.at) this.startedAt = Math.floor(event.at);
      // 总进度由后端随事件下发，取最大值避免轮询乱序时数字倒退
      if (typeof event.overall === 'number') {
        this.jobOverall = Math.max(this.jobOverall, event.overall);
      }
      if (event.type === 'step_start' && event.key) {
        this.stepState[event.key] = 'running';
        this.currentStep = {
          key: event.key,
          title: event.title || '',
          index: event.index || 0,
          total: event.total || this.preview?.steps.length || 0,
        };
        this.progress = null;
      } else if (event.type === 'step_done' && event.key) {
        this.stepState[event.key] = event.ok ? 'done' : 'failed';
      } else if (event.type === 'log' && event.line) {
        this.logs.push(event.line);
      } else if (event.type === 'progress') {
        this.progress = {
          phase: event.phase || 'idle',
          label: event.label || '',
          done: event.done || 0,
          size: event.size || 0,
          percent: event.percent ?? -1,
          speed: event.speed || 0,
          eta: event.eta ?? null,
        };
      }
    }
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    this.scrollLogs();
  }

  onLogScroll(): void {
    const el = this.logView?.nativeElement;
    if (!el) return;
    this.autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  followLogs(): void {
    this.autoScroll = true;
    this.scrollLogs();
  }

  private scrollLogs(): void {
    if (!this.autoScroll || !this.dialogOpen) return;
    setTimeout(() => {
      const el = this.logView?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 本地点击中的 + 后端报告正在删的（刷新页面后靠它恢复「删除中…」状态） */
  isDeleting(name: string): boolean {
    return this.deleting === name || (this.env?.deleting_instances?.includes(name) ?? false);
  }

  /** 删除实例目录；二次确认里说清影响范围，避免误以为会删掉共享环境或模型。 */
  removeInstance(instance: ComfyInstance): void {
    const label = instance.registered === false ? '残留目录' : '实例';
    if (
      !confirm(
        `确定删除${label}「${instance.name}」？\n\n该目录里的 ComfyUI 代码与配置会被移除；共享运行环境和已下载的模型不受影响。`,
      )
    ) {
      return;
    }
    this.deleting = instance.name;
    this.instanceError = '';
    this.api.comfyDeleteInstance(instance.name).subscribe({
      next: () => {
        this.deleting = '';
        if (this.env) {
          this.env.device.instances = this.env.device.instances.filter(
            (item) => item.name !== instance.name,
          );
        }
        this.reload(true);
      },
      error: (err) => {
        this.deleting = '';
        if (err?.status === 404) {
          // 目录已经不在了（多半是上次删除请求在刷新页面后被后端删完）：
          // 不当错误报，直接刷新列表把这行过期数据清掉。
          this.reload(true);
          return;
        }
        this.instanceError =
          err?.error?.detail ||
          (err?.status ? `删除失败（HTTP ${err.status}），请查看后端日志` : '删除失败，请稍后重试');
      },
    });
  }

  reload(refresh: boolean): void {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.api.comfyEnv(refresh).subscribe({
      next: (env) => {
        this.env = env;
        this.loading = false;
        this.watchDeleting();
      },
      error: (err) => {
        this.error = err?.error?.detail || err?.message || '检测失败，请确认后端服务正常';
        this.loading = false;
      },
    });
  }

  /** 后端报告有实例正在删除时，每 2 秒刷新一次直到删完（那一行自动消失） */
  private watchDeleting(): void {
    if (this.deletePoll) {
      clearTimeout(this.deletePoll);
      this.deletePoll = null;
    }
    if (!this.env?.deleting_instances?.length) return;
    this.deletePoll = setTimeout(() => {
      if (!this.loading) this.reload(false);
    }, 2000);
  }

  /** 探测结果还没回来时给空对象，避免模板里到处判空 */
  get plan(): ComfyEnv['plan'] {
    return this.env?.plan ?? ({} as ComfyEnv['plan']);
  }

  get device(): ComfyEnv['device'] {
    return this.env?.device ?? ({} as ComfyEnv['device']);
  }

  get gpuName(): string {
    return this.device.primary_gpu?.name || '未检测到独立显卡';
  }

  get gpuDetail(): string {
    const gpu = this.device.primary_gpu;
    if (!gpu) return '';
    const parts: string[] = [];
    if (gpu.driver_version) parts.push(`驱动 ${gpu.driver_version}`);
    if (gpu.compute_cap) parts.push(`算力 ${gpu.compute_cap}`);
    return parts.join(' · ');
  }

  get vramLabel(): string {
    const gpu = this.device.primary_gpu;
    if (!gpu?.vram_mb) return this.device.unified_memory ? this.memoryLabel : '未知';
    const gb = gpu.vram_mb / 1024;
    return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(0)} GB`;
  }

  get vramNote(): string {
    if (!this.device.primary_gpu) return '';
    if (this.device.unified_memory || this.device.primary_gpu.memory_shared) {
      return '与系统内存共用，无独立显存';
    }
    return '独立显存';
  }

  get memoryLabel(): string {
    const gb = this.device.memory_gb;
    return gb ? `${Math.round(gb)} GB` : '未知';
  }

  get memoryNote(): string {
    return this.device.unified_memory ? '显卡与 CPU 共用（统一内存）' : '系统内存';
  }

  get osLabel(): string {
    return this.device.os_version || this.device.os;
  }

  get diskLabel(): string {
    const disks = this.device.disks;
    if (!disks.length) return '未检测到磁盘信息';
    const best = disks.reduce((a, b) => (b.free_gb > a.free_gb ? b : a));
    return `${best.path} 可用 ${best.free_gb.toFixed(1)} GB`;
  }

  get diskNote(): string {
    return `安装环境约需 ${this.plan.disk_required_gb} GB`;
  }

  get otherGpus(): string {
    return this.device.gpus
      .filter((gpu) => gpu.name !== this.device.primary_gpu?.name)
      .map((gpu) => gpu.name)
      .join('、');
  }
}
