import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { errMsg, type NodeJob } from './types';

/**
 * 节点安装任务的共享状态。
 *
 * 发现页和节点管理页都能发起安装，任务同一时间只有一个（后端会拦），
 * 所以进度、日志、轮询集中放这里，两个页面各自订阅完成事件刷新自己的列表。
 */
@Injectable({ providedIn: 'root' })
export class NodeInstallService {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 最近一次任务；null 表示没装过也没在装 */
  job: NodeJob | null = null;
  /** 正在安装的节点 id，用于在列表里定位那一行 */
  installingId = '';
  error = '';

  /** 安装结束（成功或失败）时发出，页面据此刷新已装列表 */
  readonly finished = new Subject<NodeJob>();

  /** 启动安装。同一时间只允许一个任务，正在装时直接返回 false。 */
  start(id: string): boolean {
    if (this.busy) return false;
    this.error = '';
    this.api.installNode(id).subscribe({
      next: (res) => {
        this.installingId = id;
        this.job = {
          id: res.id,
          node: id,
          name: '',
          status: 'running',
          stage: '准备',
          percent: 0,
          dir: '',
          error: '',
          logs: [],
          next: 0,
        };
        this.poll(res.id, 0);
      },
      error: (err: unknown) => {
        this.error = errMsg(err, '无法开始安装');
        this.finished.next({
          id: '', node: id, name: '', status: 'failed', stage: '', percent: 0,
          dir: '', error: this.error, logs: [], next: 0,
        });
      },
    });
    return true;
  }

  /** 刷新页面后接管仍在跑的任务（后端保留最近的任务记录）。 */
  resume(): void {
    if (this.busy) return;
    this.api.currentNodeJob().subscribe({
      next: (res) => {
        if (!res.job || res.job.status !== 'running') return;
        this.installingId = res.job.node;
        this.job = res.job;
        this.poll(res.job.id, res.job.next);
      },
      error: () => {
        // 接管失败没什么可做的，用户还可以重新点安装
      },
    });
  }

  get busy(): boolean {
    return !!this.job && this.job.status === 'running';
  }

  private poll(id: string, since: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.api.nodeJob(id, since).subscribe({
        next: (job) => {
          const logs = [...(this.job?.logs || []), ...job.logs].slice(-120);
          this.job = { ...job, logs };
          if (job.status === 'running') {
            this.poll(id, job.next);
            return;
          }
          this.timer = null;
          this.installingId = '';
          if (job.status === 'failed') this.error = job.error || '安装失败';
          this.finished.next(job);
        },
        error: (err: unknown) => {
          this.timer = null;
          this.installingId = '';
          this.error = errMsg(err, '无法获取安装进度');
          this.finished.next({
            id, node: this.job?.node || '', name: this.job?.name || '', status: 'failed',
            stage: '', percent: this.job?.percent || 0, dir: '', error: this.error, logs: [], next: 0,
          });
        },
      });
    }, 700);
  }

  /** 关掉已完成任务的日志条。 */
  dismiss(): void {
    if (this.busy) return;
    this.job = null;
    this.error = '';
    this.installingId = '';
  }
}
