import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/api.service';
import { ComfyEnv } from '../core/types';
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
    <ui-page-header
      title="环境管理"
      hint="ComfyUI 独立安装在工作区，与后端 Python 环境完全隔离；模型仍挂在「模型库」的保存路径，不重复占磁盘。"
    />

    <ui-panel title="ComfyUI" hint="先检测本机硬件，据此决定装哪个加速版本。">
      <div panel-actions>
        <ui-badge [tone]="tierTone">{{ tierLabel }}</ui-badge>
        <button (click)="reload(true)" [disabled]="loading">{{ loading ? '检测中…' : '重新检测' }}</button>
      </div>

      @if (error) {
        <div class="notice err">
          {{ error }}
          <button class="inline" (click)="reload(true)">重试</button>
        </div>
      } @else if (env) {
        <div class="form-grid">
          <ui-field label="加速方式">
            <span>{{ backend.title }}</span>
            <div class="mono muted">{{ backend.detail }} · {{ plan.torch_channel }}</div>
          </ui-field>
          <ui-field label="Python">
            <span>{{ plan.python_version }}</span>
            <div class="muted">{{ plan.python_available ? '本机已有可用版本' : '需要先安装' }}</div>
          </ui-field>
          <ui-field label="磁盘空间">
            <span>{{ plan.disk_ok ? '足够安装' : '空间不足' }}</span>
            <div class="muted">需要约 {{ plan.disk_required_gb }} GB</div>
          </ui-field>
        </div>

        @for (action of plan.actions; track action.title) {
          <div class="notice" [class.err]="action.level === 'block'" [class.info]="action.level === 'info'">
            <strong>{{ action.title }}</strong>
            <div>{{ action.detail }}</div>
            @if (action.url) {
              <a [href]="action.url" target="_blank" rel="noreferrer">打开下载页 ↗</a>
            }
          </div>
        }

        @if (plan.blocked_reason) {
          <div class="notice err">当前无法安装：{{ plan.blocked_reason }}</div>
        }

        <div class="toolbar">
          <button class="primary" disabled>开始安装</button>
          <button disabled>启动</button>
          <div class="muted">安装与启动将在下一版本接入</div>
        </div>
      } @else {
        <div class="muted">正在检测本机环境…</div>
      }
    </ui-panel>

    <ui-panel title="设备" hint="只读检测，不会安装或修改任何东西。">
      @if (env) {
        <div class="form-grid">
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
            <div class="muted">{{ pythonNote }}</div>
          </ui-field>
          <ui-field label="磁盘">
            <span>{{ diskLabel }}</span>
            <div class="muted">{{ diskNote }}</div>
          </ui-field>
          <ui-field label="检测时间">
            <span class="mono">{{ device.probed_at }}</span>
          </ui-field>
        </div>

        @if (device.warnings.length) {
          <div class="notice">
            @for (warning of device.warnings; track warning) {
              <div>{{ warning }}</div>
            }
          </div>
        }
        @if (otherGpus) {
          <p class="muted">其他显示适配器：{{ otherGpus }}</p>
        }
      } @else {
        <div class="muted">待检测</div>
      }
    </ui-panel>

    <ui-panel title="版本" hint="代码来源为 CNB 镜像，按标签检出；每个版本独立环境，可随时回滚。">
      @if (env && env.device.instances.length) {
        @for (instance of env.device.instances; track instance.name) {
          <div class="notice info">
            <strong>{{ instance.name }}</strong>
            <div class="mono muted">
              {{ instance.version || '未知版本' }} · Python {{ instance.python || '?' }} ·
              {{ instance.port ? '端口 ' + instance.port : '未分配端口' }}
            </div>
          </div>
        }
      } @else {
        <ui-empty title="还没有安装任何版本" hint="确认上方方案后即可开始安装" />
      }
    </ui-panel>
  `,
})
export class ComfyComponent implements OnInit {
  env: ComfyEnv | null = null;
  loading = false;
  error = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.reload(false);
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
    const list = this.device.pythons;
    if (!list.length) return '未检测到 Python';
    return list.map((item) => item.version).join(' · ');
  }

  get pythonNote(): string {
    return this.plan.python_available ? `将使用 ${this.plan.python_version}` : `需要安装 ${this.plan.python_version}`;
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
