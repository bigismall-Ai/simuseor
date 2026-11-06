import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ComfyEnv, ComfyInstallEvent, ComfyInstallJob, ComfyPreview, ComfyStep } from '../core/types';
import { BadgeComponent, BadgeTone } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/** 后端标识 → 用户能看懂的说法 + 技术标签（技术词只放在副行） */
const BACKEND_LABELS: Record<string, { title: string; detail: string }> = {
  cuda: { title: 'NVIDIA 显卡加速', detail: 'CUDA' },
  rocm: { title: 'AMD 显卡加速', detail: 'ROCm' },
  directml: { title: 'AMD 显卡加速（性能受限）', detail: 'DirectML' },
  xpu: { title: 'Intel 显卡加速', detail: 'XPU' },
  mps: { title: 'Apple 芯片加速', detail: 'Metal' },
  cpu: { title: '仅 CPU，无加速', detail: 'CPU' },
};

@Component({
  selector: 'app-comfy',
  standalone: true,
  imports: [CommonModule, BadgeComponent, EmptyComponent, FieldComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header title="环境管理" hint="ComfyUI 独立运行在你的电脑上，与本站环境互不影响。" />

    <ui-panel title="ComfyUI">
      <div panel-actions>
        <ui-badge [tone]="tierTone">{{ tierLabel }}</ui-badge>
      </div>

      @if (error) {
        <div class="notice err">
          {{ error }}
          <button (click)="reload(true)">重试</button>
        </div>
      } @else if (env) {
        <p>{{ summary }}</p>

        @for (action of visibleActions; track action.title) {
          <div class="notice" [class.err]="action.level === 'block'">
            <strong>{{ action.title }}</strong>
            <div>{{ action.detail }}</div>
            @if (action.url) {
              <a [href]="action.url" target="_blank" rel="noreferrer">打开下载页 ↗</a>
            }
          </div>
        }

        <div class="toolbar">
          <button class="primary" (click)="openPreview()" [disabled]="!canInstall || busy">
            {{ busy ? '安装中…' : '开始安装' }}
          </button>
          <button (click)="reload(true)" [disabled]="loading">{{ loading ? '检测中…' : '重新检测' }}</button>
        </div>

        <details class="mt">
          <summary class="muted">设备详情</summary>
          <div class="form-grid mt">
            <ui-field label="显卡">
              <span>{{ gpuName }}</span>
              <div class="mono muted">{{ gpuDetail }}</div>
            </ui-field>
            <ui-field label="显存">
              <span>{{ vramLabel }}</span>
              <div class="muted">{{ vramNote }}</div>
            </ui-field>
            <ui-field label="系统">
              <span>{{ osLabel }}</span>
              <div class="mono muted">{{ device.arch }}</div>
            </ui-field>
            <ui-field label="Python">
              <span>{{ pythonLabel }}</span>
              <div class="mono muted" style="word-break: break-all">{{ pythonNote }}</div>
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
        </details>
      } @else {
        <div class="muted">正在检测本机环境…</div>
      }
    </ui-panel>

    <ui-panel title="已安装版本">
      @if (env && env.device.instances.length) {
        @for (instance of env.device.instances; track instance.name) {
          <div class="notice">
            <strong>{{ instance.name }}</strong>
            @if (instance.version) {
              <span class="muted">{{ instance.version }}</span>
            }
          </div>
        }
      } @else {
        <ui-empty title="还没有安装" hint="点击上方「开始安装」即可，检测到本机硬件后会自动选合适的版本。" />
      }
    </ui-panel>

    @if (preview) {
      <div class="modal-overlay" (click)="closePreview()">
        <div class="modal" style="max-height: 92vh" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <strong class="mc-title">{{ job ? '正在安装 ComfyUI' : '安装预演' }}</strong>
            <span class="grow"></span>
            <button class="ghost" (click)="closePreview()" [disabled]="installing" title="关闭">✕</button>
          </div>

          <div class="notice info">
            安装到 <span class="mono">{{ preview.spec.workspace }}</span><br />
            预计占用约 {{ preview.total_gb }} GB
          </div>

          <div class="dlg-files" style="padding: 8px 10px; max-height: calc(92vh - 230px)">
            @for (step of preview.steps; track step.key) {
              <div
                class="notice"
                [class.ok]="stepStatus(step.key) === 'done'"
                [class.err]="stepStatus(step.key) === 'failed'"
              >
                <strong>{{ step.title }}</strong>
                <span class="muted"> — {{ statusLabel(stepStatus(step.key)) }}</span>
                <div class="muted">{{ step.detail }}</div>
                @if (step.command) {
                  <details>
                    <summary class="muted">执行命令</summary>
                    <div class="mono muted" style="word-break: break-all">
                      $ {{ step.command.join(' ') }}
                    </div>
                  </details>
                }
              </div>
            }
          </div>

          @if (logs.length) {
            <details class="mt">
              <summary class="muted">执行日志（{{ logs.length }} 行）</summary>
              <div class="dlg-files mono" style="padding: 8px 10px; white-space: pre-wrap">{{ logs.join('\n') }}</div>
            </details>
          }

          <div class="toolbar mt">
            @if (job?.result) {
              <span class="muted">{{ job!.result!.message }}</span>
            }
            <span class="grow"></span>
            @if (!job) {
              <button (click)="closePreview()">取消</button>
              <button class="primary" (click)="startInstall()">确认安装</button>
            } @else if (job!.status === 'running') {
              <button disabled>安装中，请勿关闭页面…</button>
            } @else {
              <button class="primary" (click)="closePreview()">完成</button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class ComfyComponent implements OnInit, OnDestroy {
  env: ComfyEnv | null = null;
  loading = false;
  error = '';

  preview: ComfyPreview | null = null;
  job: ComfyInstallJob | null = null;
  installing = false;
  logs: string[] = [];
  stepState: Record<string, 'pending' | 'running' | 'done' | 'failed'> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.reload(false);
    this.restoreInstall();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  /** 弹层打开或安装进行中时，主按钮不该再被点 */
  get busy(): boolean {
    return this.installing || this.preview !== null;
  }

  /** 一句话结论：用户只想知道"能不能装" */
  get summary(): string {
    const plan = this.plan;
    const gpu = this.device.primary_gpu?.name;
    if (plan.tier === 'blocked') {
      return `当前无法安装：${plan.blocked_reason || '环境不满足要求'}`;
    }
    if (plan.tier === 'limited') {
      return `可以安装，但性能会受限${gpu ? `（${gpu}）` : ''}。`;
    }
    return `这台电脑可以启用显卡加速${gpu ? `（${gpu}）` : ''}，安装后即可使用。`;
  }

  /** 只展示需要用户处理的提示；info 级都是技术说明，收进详情里 */
  get visibleActions() {
    return this.plan.actions.filter((action) => action.level !== 'info');
  }

  get canInstall(): boolean {
    const plan = this.env?.plan;
    if (!plan) return false;
    // 不再要求本机有 Python——安装时会下载内置运行时
    return plan.tier !== 'blocked' && plan.disk_ok;
  }

  /** 页面刷新后接管仍在进行的安装任务 */
  private restoreInstall(): void {
    this.api.comfyCurrentInstall().subscribe({
      next: ({ job }) => {
        // 只接管正在跑的；已完成的任务不主动弹窗打扰
        if (!job || job.status !== 'running') return;
        this.job = job;
        this.preview = {
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
        this.stepState = Object.fromEntries(
          job.steps.map((step: ComfyStep) => [step.key, 'pending' as const]),
        );
        // 重放已有事件，把步骤状态和日志补回来
        this.applyEvents(job.events);
        this.installing = true;
        this.poll(job.id, job.total_events);
      },
    });
  }

  openPreview(): void {
    this.api.comfyPreview().subscribe({
      next: (preview) => {
        this.preview = preview;
        this.job = null;
        this.logs = [];
        this.stepState = Object.fromEntries(
          preview.steps.map((step: ComfyStep) => [step.key, 'pending' as const]),
        );
      },
      error: (err) => {
        this.error = err?.error?.detail || '无法生成安装计划';
      },
    });
  }

  closePreview(): void {
    if (this.installing) return;
    this.stopPolling();
    this.preview = null;
    this.job = null;
    this.logs = [];
    this.stepState = {};
    // 安装完成或取消后，设备与实例列表都可能变化
    this.reload(true);
  }

  startInstall(): void {
    if (!this.preview || this.installing) return;
    this.installing = true;
    this.api.comfyInstall(this.preview.spec.name).subscribe({
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
      if (event.type === 'step_start' && event.key) {
        this.stepState[event.key] = 'running';
      } else if (event.type === 'step_done' && event.key) {
        this.stepState[event.key] = event.ok ? 'done' : 'failed';
      } else if (event.type === 'log' && event.line) {
        this.logs.push(event.line);
        // pip 输出可能上万行，只留最近 500 行给界面
        if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
      }
    }
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reload(refresh: boolean): void {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.api.comfyEnv(refresh).subscribe({
      next: (env) => {
        this.env = env;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.detail || err?.message || '检测失败，请确认后端服务正常';
        this.loading = false;
      },
    });
  }

  get plan() {
    return this.env!.plan;
  }

  get device() {
    return this.env!.device;
  }

  get backend() {
    return BACKEND_LABELS[this.plan.backend] || { title: this.plan.backend, detail: this.plan.backend };
  }

  get tierTone(): BadgeTone {
    const tier = this.plan?.tier;
    if (tier === 'full') return 'green';
    if (tier === 'limited') return 'orange';
    if (tier === 'blocked') return 'red';
    return 'gray';
  }

  get tierLabel(): string {
    const tier = this.plan?.tier;
    if (tier === 'full') return '可启用显卡加速';
    if (tier === 'limited') return '可用，但有性能限制';
    if (tier === 'blocked') return '当前无法安装';
    return '检测中';
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
    if (!gpu?.vram_mb) return '未知';
    const gb = gpu.vram_mb / 1024;
    return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(0)} GB`;
  }

  get vramNote(): string {
    const gpu = this.device.primary_gpu;
    if (!gpu) return '';
    return gpu.vendor === 'apple' ? '统一内存，CPU 与 GPU 共用' : '独立显存';
  }

  get osLabel(): string {
    return this.device.os_version || this.device.os;
  }

  get pythonLabel(): string {
    if (this.plan.python_source === 'download') return `内置 ${this.plan.python_version}`;
    const usable = this.device.pythons.filter((item) => item.trusted);
    if (!usable.length) return `内置 ${this.plan.python_version}`;
    return usable.map((item) => item.version).join(' · ');
  }

  get pythonNote(): string {
    // 没有可用 Python 不再是问题：安装时会下载内置运行时
    if (this.plan.python_source === 'download') return '安装时自动下载便携版（约 48MB）';
    // 把解释器的真实路径显示出来——只显示版本号会让人误以为是自己装的
    const chosen = this.device.pythons.find(
      (item) => item.trusted && item.version.startsWith(this.plan.python_version),
    );
    return chosen ? chosen.path : `将使用 ${this.plan.python_version}`;
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
