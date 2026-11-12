import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errMsg, fmtNum, fmtSize, InstalledNode, MissingProvider, NodeMissingReport, NodeStats } from '../core/types';
import { NodeInstallService } from '../core/node-install.service';
import { BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

@Component({
  selector: 'app-node-library',
  standalone: true,
  imports: [RouterLink, BadgeComponent, EmptyComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header
      kicker="Nodes"
      title="节点管理"
      hint="节点装在 workspace/custom_nodes，所有实例共享；禁用只改目录后缀，代码还在，随时能开回来。"
    >
      <button routerLink="/nodes">浏览节点包</button>
    </ui-page-header>

    <div class="nl-stats">
      <div class="nl-stat">
        <span>已安装</span>
        <strong>{{ stats?.installed ?? installed.length }}</strong>
      </div>
      <div class="nl-stat">
        <span>已禁用</span>
        <strong>{{ stats?.disabled ?? disabledCount }}</strong>
      </div>
      <div class="nl-stat">
        <span>可用节点</span>
        <strong>{{ fmtNum(availableNodes) }}</strong>
      </div>
      <div class="nl-stat">
        <span>清单规模</span>
        <strong>{{ fmtNum(stats?.catalog ?? 0) }}</strong>
      </div>
    </div>

    <ui-panel
      title="缺节点检测"
      hint="扫工作流库，把用到的节点和已装的扩展比一遍；装完新节点需要重启实例才生效。"
    >
      <div panel-actions>
        <button class="primary btn-xs" (click)="check()" [disabled]="checking || loading">
          {{ checking ? '检测中…' : '开始检测' }}
        </button>
      </div>

      @if (errorText) {
        <div class="notice err">{{ errorText }}</div>
      }
      @if (notice) {
        <div class="notice ok">{{ notice }}</div>
      }

      @if (!report && !checking) {
        <p class="nl-hint">
          还没检测。点「开始检测」会对 {{ stats?.installed ? '全部' : '' }}工作流跑一遍依赖比对，
          告诉你缺哪些扩展、能一键装哪个。
        </p>
      }

      @if (report) {
        @if (!report.missing_files) {
          <div class="notice ok">
            扫了 {{ report.scanned }} 个工作流，节点都齐了（可追踪 {{ fmtNum(report.installed_nodes) }} 个节点类）。
          </div>
        } @else {
          <div class="notice info">
            {{ report.scanned }} 个工作流里有 {{ report.missing_files }} 个缺节点，
            一共能对应 {{ report.providers.length }} 个扩展。
          </div>

          @if (report.providers.length) {
            <div class="nl-providers">
              @for (p of report.providers; track p.id) {
                <div class="nl-provider">
                  <div class="nl-provider-main">
                    <strong>{{ p.name }}</strong>
                    <span class="nl-provider-meta">
                      {{ p.files || 0 }} 个工作流需要 · 提供 {{ p.node_count }} 个节点
                    </span>
                    <span class="nl-provider-covers" [title]="p.covers.join('、')">
                      缺 {{ p.covers.slice(0, 3).join('、') }}{{ p.covers.length > 3 ? ' 等' : '' }}
                    </span>
                  </div>
                  @if (install.installingId === p.id && install.job?.status === 'running') {
                    <span class="nl-provider-pct">{{ install.job?.percent }}%</span>
                  } @else if (!p.installable) {
                    <span class="nl-provider-pct">不支持一键装</span>
                  } @else {
                    <button class="primary btn-xs" (click)="installProvider(p)" [disabled]="install.busy">
                      安装
                    </button>
                  }
                </div>
              }
            </div>
          }

          <details class="nl-details">
            <summary>按工作流看明细（{{ report.workflows.length }}）</summary>
            @for (wf of report.workflows; track wf.file) {
              <div class="nl-wf">
                <div class="nl-wf-head">
                  <span class="nl-wf-name" [title]="wf.file">{{ wf.file }}</span>
                  <span class="nl-wf-count">用 {{ wf.used }} 缺 {{ wf.missing }}</span>
                </div>
                <div class="nl-wf-body">
                  @for (p of wf.providers; track p.id) {
                    <span class="nl-chip">{{ p.name }}</span>
                  }
                  @for (name of wf.unknown; track name) {
                    <span class="nl-chip is-unknown" [title]="'清单没收录这个节点名，装好对应扩展后会自动识别'">
                      {{ name }}
                    </span>
                  }
                </div>
              </div>
            }
          </details>
        }
      }
    </ui-panel>

    <ui-panel title="已安装" [hint]="loading ? '读取中…' : installed.length + ' 个扩展'">
      <div panel-actions>
        <button class="btn-xs" (click)="load()" [disabled]="loading">刷新</button>
      </div>

      @if (!loading && !installed.length) {
        <ui-empty
          title="还没装任何节点"
          hint="去「发现节点」挑需要的扩展；也可以把手工 clone 的仓库放进 workspace/custom_nodes。"
        />
      }

      @if (installed.length) {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>扩展</th>
                <th class="nl-col-node">节点</th>
                <th class="nl-col-commit">版本</th>
                <th class="nl-col-size">大小</th>
                <th class="nl-col-state">状态</th>
                <th class="nl-col-act">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (it of installed; track it.dir) {
                <tr>
                  <td>
                    <div class="nl-name" [title]="it.repo || it.path">{{ it.title }}</div>
                    <div class="nl-sub">
                      <span class="nl-dir">{{ it.dir }}</span>
                      @if (!it.tracked) {
                        <ui-badge tone="gray">清单未收录</ui-badge>
                      }
                      @if (it.requirements) {
                        <span class="nl-dep" title="该扩展带 requirements.txt，安装时已走同一条依赖通道">带依赖</span>
                      }
                    </div>
                  </td>
                  <td class="nl-col-node">{{ it.node_count || '—' }}</td>
                  <td class="nl-col-commit">{{ it.commit || '—' }}</td>
                  <td class="nl-col-size">{{ fmtSize(it.size) }}</td>
                  <td class="nl-col-state">
                    @if (it.disabled) {
                      <ui-badge tone="orange">已禁用</ui-badge>
                    } @else {
                      <ui-badge tone="green">启用中</ui-badge>
                    }
                  </td>
                  <td class="nl-col-act">
                    <button class="btn-xs" (click)="toggle(it)" [disabled]="busy === it.dir">
                      {{ it.disabled ? '启用' : '禁用' }}
                    </button>
                    @if (it.repo) {
                      <a class="btn-xs nl-link" [href]="it.repo" target="_blank" rel="noreferrer">仓库</a>
                    }
                    <button class="btn-xs nl-danger" (click)="remove(it)" [disabled]="busy === it.dir">
                      {{ busy === it.dir ? '处理中…' : '卸载' }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </ui-panel>
  `,
  styles: `
    .nl-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .nl-stat {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nl-stat span { font-size: 11px; color: var(--muted); }
    .nl-stat strong {
      font-size: 18px;
      font-weight: 620;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }

    .nl-hint {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--muted);
    }

    .nl-providers {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .nl-provider {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .nl-provider-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .nl-provider-main strong { font-size: 12.5px; }
    .nl-provider-meta { font-size: 10.5px; color: var(--faint); }
    .nl-provider-covers {
      font-size: 10.5px;
      color: var(--warn);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nl-provider-pct {
      font-size: 12px;
      color: var(--accent);
      font-variant-numeric: tabular-nums;
    }

    .nl-details {
      margin-top: 12px;
      font-size: 12px;
    }
    .nl-details summary {
      cursor: pointer;
      color: var(--muted);
      font-size: 11.5px;
      padding: 4px 0;
    }
    .nl-details summary:hover { color: var(--text); }

    .nl-wf {
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .nl-wf-head {
      display: flex;
      gap: 10px;
      align-items: baseline;
      min-width: 0;
    }
    .nl-wf-name {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 11px;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nl-wf-count {
      margin-left: auto;
      font-size: 10.5px;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .nl-wf-body {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 5px;
    }
    .nl-chip {
      font-size: 10.5px;
      line-height: 17px;
      padding: 0 6px;
      border-radius: var(--radius-xs);
      background: var(--warn-soft);
      color: var(--warn);
    }
    .nl-chip.is-unknown {
      background: var(--panel-3);
      color: var(--faint);
    }

    .nl-name { font-size: 12.5px; font-weight: 550; }
    .nl-sub {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 3px;
      flex-wrap: wrap;
    }
    .nl-dir {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 10.5px;
      color: var(--faint);
    }
    .nl-dep { font-size: 10.5px; color: var(--faint); }

    .nl-col-node, .nl-col-commit, .nl-col-size { width: 76px; font-variant-numeric: tabular-nums; }
    .nl-col-commit { width: 92px; font-family: "Cascadia Mono", Consolas, monospace; font-size: 11px; }
    .nl-col-state { width: 82px; }
    .nl-col-act { width: 172px; white-space: nowrap; }
    .nl-col-act .btn-xs { margin-right: 4px; }

    .nl-link {
      display: inline-flex;
      align-items: center;
      color: var(--muted);
      text-decoration: none;
    }
    .nl-link:hover { color: var(--text); }
    .nl-danger { color: var(--muted); }
    .nl-danger:hover:not(:disabled) { color: var(--err); border-color: var(--err); }

    @media (max-width: 760px) {
      .nl-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .nl-col-commit, .nl-col-size { display: none; }
    }
  `,
})
export class NodeLibraryComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  install = inject(NodeInstallService);
  private sub?: Subscription;

  installed: InstalledNode[] = [];
  stats: NodeStats | null = null;
  report: NodeMissingReport | null = null;
  loading = false;
  checking = false;
  busy = '';
  notice = '';
  errorText = '';

  get disabledCount(): number {
    return this.installed.filter((i) => i.disabled).length;
  }

  /** 已装扩展提供的节点数（禁用的不算，它们不会被加载） */
  get availableNodes(): number {
    return this.installed.filter((i) => !i.disabled).reduce((sum, i) => sum + (i.node_count || 0), 0);
  }

  ngOnInit(): void {
    this.load();
    this.install.resume();
    this.sub = this.install.finished.subscribe((job) => {
      if (job.status === 'done') {
        this.notice = `已安装 ${job.name || job.node}，重启实例后生效`;
        this.load();
        if (this.report) this.check();
      } else if (job.status === 'failed') {
        this.errorText = job.error || '安装失败';
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.api.installedNodes().subscribe({
      next: (res) => {
        this.installed = res.items;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.errorText = errMsg(err, '读取已装节点失败');
      },
    });
    this.api.nodeStats().subscribe({
      next: (res) => (this.stats = res),
      error: () => {
        // 统计只是辅助信息，失败就不显示数字，不打断主流程
      },
    });
  }

  check(): void {
    this.checking = true;
    this.errorText = '';
    this.notice = '';
    this.api.missingNodes().subscribe({
      next: (res) => {
        this.report = res;
        this.checking = false;
      },
      error: (err) => {
        this.checking = false;
        this.errorText = errMsg(err, '检测失败');
      },
    });
  }

  installProvider(p: MissingProvider): void {
    if (!this.install.start(p.id)) {
      this.errorText = '已有节点正在安装，请等它完成';
    }
  }

  toggle(item: InstalledNode): void {
    this.busy = item.dir;
    this.errorText = '';
    this.api.toggleNode(item.dir).subscribe({
      next: () => {
        this.busy = '';
        this.load();
      },
      error: (err) => {
        this.busy = '';
        this.errorText = errMsg(err, '切换启用状态失败');
      },
    });
  }

  remove(item: InstalledNode): void {
    const label = item.disabled ? '已禁用' : '启用中';
    if (
      !confirm(
        `确定卸载「${item.title}」（${item.dir}，${label}）？\n\n` +
          '会删掉这个扩展的全部代码；模型、工作流和其它节点不受影响。' +
          (item.disabled ? '' : '\n如果实例正在运行，会先停止它。'),
      )
    ) {
      return;
    }
    this.busy = item.dir;
    this.errorText = '';
    this.api.removeNode(item.dir, true).subscribe({
      next: () => {
        this.busy = '';
        this.notice = `已卸载 ${item.title}`;
        this.load();
        if (this.report) this.check();
      },
      error: (err) => {
        this.busy = '';
        this.errorText = errMsg(err, '卸载失败');
      },
    });
  }

  fmtNum = fmtNum;
  fmtSize = fmtSize;
}
