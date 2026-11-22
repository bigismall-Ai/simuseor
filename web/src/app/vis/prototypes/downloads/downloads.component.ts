import { Component, OnDestroy } from '@angular/core';
import { BadgeComponent } from '../../../ui/badge.component';
import { EmptyComponent } from '../../../ui/empty.component';
import { PageHeaderComponent } from '../../../ui/page-header.component';

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
  selector: 'app-downloads-prototype',
  standalone: true,
  imports: [BadgeComponent, EmptyComponent, PageHeaderComponent],
  template: `
    <div class="proto-page">
      <ui-page-header
        kicker="Assets · Downloads"
        title="下载"
        hint="从可用来源取回权重，通路由探针自动选择。"
      >
        <button class="btn" type="button" (click)="openDownloadDir()">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1.4 1.6H14V13H2z" /></svg>
          打开下载目录
        </button>
      </ui-page-header>

      @if (notice) {
        <div class="page-notice" role="status">
          <span class="grow">{{ notice }}</span>
          <button class="x-btn" type="button" aria-label="关闭提示" (click)="notice = ''">×</button>
        </div>
      }

      <section class="sources" aria-label="来源状态">
        @for (source of sources; track source.key) {
          <button
            type="button"
            class="source"
            [class.on]="selectedSourceKey === source.key"
            [class.degraded]="source.state === 'degraded'"
            [class.down]="source.state === 'down'"
            [disabled]="source.state === 'down'"
            [title]="source.tip"
            [attr.aria-pressed]="selectedSourceKey === source.key"
            (click)="pickSource(source)"
          >
            <span class="dot" aria-hidden="true"></span>
            {{ source.label }}
            <em>{{ source.speed }}</em>
          </button>
        }
      </section>

      <section class="panel" aria-label="新建下载">
        <div class="panel-head">
          <h2>新建下载</h2>
          <span class="muted">来源不可达时不出现在可选列表</span>
        </div>
        <div class="composer">
          <div class="composer-row">
            <label class="field">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.4" /><path d="M10.3 10.3 13.6 13.6" />
              </svg>
              <input
                type="text"
                [value]="repoId"
                (input)="onRepoInput($event)"
                aria-label="模型 ID"
                placeholder="组织/仓库，如 Comfy-Org/MiniMax-H3-Image"
              />
            </label>
            <button class="btn primary" type="button" [disabled]="resolving || !repoId.trim()" (click)="resolveRepo()">
              {{ resolving ? '解析中…' : '解析' }}
            </button>
          </div>

          @if (repoError) {
            <p class="composer-error" role="alert">{{ repoError }}</p>
          }

          @if (resolved && !repoError) {
            <div class="resolved">
              <div class="repo-line">
                <b>{{ resolvedName }}</b>
                <ui-badge tone="blue">{{ sourceName }}</ui-badge>
                <span class="muted mono">{{ repoId }}</span>
              </div>

              <div class="fit">
                <b>推荐 W4A8 单文件组合</b>
                <span class="fit-note">RTX 4080 SUPER · 16 GB 显存 · 预计 28.9 GB</span>
                <span class="grow"></span>
                <ui-badge tone="orange">需分层加载</ui-badge>
              </div>

              <div class="weights">
                @for (weight of visibleWeights; track weight.id) {
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
                    {{ showAllWeights ? '只看推荐组合' : '查看全部权重 (' + weights.length + ')' }}
                  </button>
                </div>
              </div>

              <div class="auto-folders">
                <span>自动归类</span>
                @for (group of autoFolders; track group.folder) {
                  <span class="pill mono">{{ group.folder }} · {{ group.count }}</span>
                } @empty {
                  <span class="faint">还没有勾选权重</span>
                }
              </div>

              <div class="action-row">
                <button class="btn primary" type="button" [disabled]="!selectedSizeMb" (click)="startDownload()">
                  {{ downloadLabel }}
                </button>
                <button class="btn" type="button" (click)="customSelect()">自定义选择</button>
                <span class="grow"></span>
                <span class="strategy">
                  @if (strategyLocked) {
                    自动 · <b>{{ strategyText }}</b>
                    <button class="link-btn" type="button" (click)="unlockStrategy()">解锁</button>
                  } @else {
                    通路
                    <select [value]="strategyChoice" (change)="setStrategy($event)" aria-label="下载通路">
                      @for (option of strategyOptions; track option.key) {
                        <option [value]="option.key">{{ option.label }}</option>
                      }
                    </select>
                    <button class="link-btn" type="button" (click)="restoreAuto()">恢复自动</button>
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
              [class.on]="tab === 'all'"
              [attr.aria-selected]="tab === 'all'"
              (click)="tab = 'all'"
            >全部 <b>{{ allCount }}</b></button>
            <button
              class="tab"
              type="button"
              role="tab"
              [class.on]="tab === 'active'"
              [attr.aria-selected]="tab === 'active'"
              (click)="tab = 'active'"
            >进行中 <b>{{ activeCount }}</b></button>
            <button
              class="tab"
              type="button"
              role="tab"
              [class.on]="tab === 'done'"
              [attr.aria-selected]="tab === 'done'"
              (click)="tab = 'done'"
            >已完成 <b>{{ doneCount }}</b></button>
          </div>

          <label class="field task-search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" /><path d="M10.3 10.3 13.6 13.6" />
            </svg>
            <input
              type="search"
              [value]="taskQuery"
              (input)="onTaskQuery($event)"
              placeholder="搜索任务"
              aria-label="搜索任务"
            />
          </label>
        </div>

        <div class="task-list">
          @for (task of shownActive; track task.id) {
            <div class="task">
              <div class="task-main">
                <div class="task-name">
                  <b>{{ task.name }}</b>
                  <span class="pill">{{ task.source }}</span>
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
                <div class="progress" role="progressbar" [attr.aria-valuenow]="pct(task)" aria-valuemin="0" aria-valuemax="100">
                  <i [style.width.%]="pct(task)"></i>
                </div>
              </div>
              <div class="task-side">
                <div class="stat">
                  <b>{{ pct(task) }}%</b>
                  <span>已完成</span>
                </div>
                <button class="btn sm" type="button" (click)="togglePause(task)">
                  {{ task.state === 'paused' ? '继续' : '暂停' }}
                </button>
                <button class="btn sm ghost" type="button" (click)="cancelTask(task)">取消</button>
              </div>
            </div>
          }

          @for (task of shownDone; track task.id) {
            <div class="done-row">
              <span class="nm">
                <b>{{ task.name }}</b>
                <span>{{ task.subtitle }}</span>
              </span>
              <ui-badge tone="green">已完成</ui-badge>
              <span class="faint mono">{{ task.finishedAt }}</span>
              <span class="done-actions">
                <button type="button" (click)="openTaskDir(task)">打开目录</button>
                <button type="button" (click)="removeTask(task)">删除记录</button>
              </span>
            </div>
          }

          @if (!shownActive.length && !shownDone.length) {
            <ui-empty
              icon="⌕"
              [title]="taskQuery ? '没有匹配「' + taskQuery + '」的任务' : '这个分组里还没有任务'"
              hint="换个关键词，或切换到「全部」查看所有任务。"
            />
          }
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      /* VIS shell 的 .vis-main 不提供内边距，页面自管宽度与留白 */
      .proto-page {
        max-width: 1320px;
        margin: 0 auto;
        padding: 26px 28px 72px;
        width: 100%;
      }

      .page-notice {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding: 9px 12px;
        border: 1px solid var(--accent-line);
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
        color: var(--text-2);
        font-size: 12px;
      }
      .page-notice .grow { flex: 1; min-width: 0; }
      .x-btn {
        flex: none;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--muted);
        font-size: 15px;
        line-height: 1;
      }

      /* —— 来源条 —— */
      .sources { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
      .source {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        color: var(--text-2);
        font-size: 11.5px;
        box-shadow: var(--shadow-sm);
      }
      .source .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 3px var(--ok-soft);
      }
      .source.degraded .dot { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
      .source.down { opacity: 0.48; cursor: not-allowed; }
      .source.down .dot { background: var(--faint); box-shadow: none; }
      .source em {
        font-style: normal;
        color: var(--muted);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 10.5px;
      }
      .source:not(:disabled):hover { border-color: var(--accent-line); background: var(--accent-soft); }
      .source.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); }

      /* —— 面板 —— */
      .panel {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .panel + .panel { margin-top: 14px; }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 11px 14px;
        border-bottom: 1px solid var(--border);
      }
      .panel-head h2 { margin: 0; font-size: 13.5px; font-weight: 600; }
      .panel-head .muted { margin-left: auto; font-size: 11px; color: var(--muted); }
      .composer { padding: 14px; }

      .composer-row { display: flex; gap: 9px; align-items: center; }
      .field {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--input-bg);
      }
      .field svg {
        flex: none;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--faint);
        stroke-width: 1.5;
      }
      .field input {
        min-width: 0;
        width: 100%;
        height: auto;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: none;
        outline: 0;
        color: var(--text);
        font-size: 12.5px;
        box-shadow: none;
      }
      .field input::placeholder { color: var(--faint); }
      .composer-row .field { flex: 1; }
      .composer-error {
        margin: 8px 0 0;
        color: var(--err);
        font-size: 11.5px;
      }

      .resolved { margin-top: 14px; border-top: 1px solid var(--border-soft); padding-top: 14px; }
      .repo-line { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .repo-line b { font-size: 15px; font-weight: 600; }
      .repo-line .muted { font-size: 11.5px; }

      .fit {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 11px 0 12px;
        padding: 10px 12px;
        border: 1px solid var(--accent-line);
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 11.5px;
      }
      .fit b { font-weight: 600; }
      .fit .grow { flex: 1; }
      .fit-note { color: var(--muted); }

      .weights { border: 1px solid var(--border-soft); border-radius: var(--radius-sm); overflow: hidden; }
      .weight-row {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) 84px 76px;
        gap: 8px;
        align-items: center;
        padding: 8px 11px;
        border-bottom: 1px solid var(--border-soft);
        font-size: 11.5px;
        cursor: pointer;
      }
      .weight-row:hover { background: var(--hover); }
      .weight-row input { width: 14px; height: 14px; accent-color: var(--accent); }
      .weight-row .nm { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .weight-row .nm b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        font-size: 12px;
      }
      .weight-row .nm span {
        color: var(--faint);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 10.5px;
      }
      .weight-row .sz {
        text-align: right;
        font-family: "Cascadia Mono", Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
      .weight-row .tag { text-align: right; }
      .more { padding: 8px 11px; border-top: 1px dashed var(--border-soft); }
      .more button {
        height: auto;
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent);
        font-size: 11.5px;
      }
      .more button:hover { background: none; text-decoration: underline; }

      .auto-folders {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        margin: 12px 0;
        font-size: 11.5px;
        color: var(--muted);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 8px;
        border-radius: 999px;
        background: var(--pill-bg);
        color: var(--pill-ink);
        font-size: 10.5px;
        white-space: nowrap;
      }
      .pill.mono { font-family: "Cascadia Mono", Consolas, monospace; }

      .action-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding-top: 4px;
      }
      .action-row .grow { flex: 1; }
      .strategy { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--muted); }
      .strategy b { color: var(--text-2); font-weight: 500; }
      .strategy select {
        width: auto;
        height: 30px;
        padding: 0 8px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--input-bg);
        color: var(--text);
        font-size: 11.5px;
      }
      .link-btn {
        height: auto;
        padding: 0;
        border: 0;
        background: none;
        color: var(--accent);
        font-size: 11px;
      }
      .link-btn:hover { background: none; text-decoration: underline; }

      /* —— 任务 —— */
      .task-toolbar {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
        background: var(--panel-2);
        flex-wrap: wrap;
      }
      .tabs { display: flex; gap: 4px; }
      .tab {
        min-height: 27px;
        height: auto;
        padding: 0 10px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: none;
        color: var(--muted);
        font-size: 11.5px;
      }
      .tab:hover { background: var(--hover); color: var(--text); }
      .tab.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
      .tab b { margin-left: 4px; font-weight: 500; opacity: 0.8; }
      .task-search { margin-left: auto; width: 210px; height: 30px; }

      .task-list { padding: 0 14px 14px; }
      .task {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 260px;
        gap: 16px;
        padding: 14px 0;
        border-bottom: 1px solid var(--border-soft);
      }
      .task:last-child { border-bottom: 0; }
      .task-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .task-name b { font-size: 13.5px; font-weight: 600; }
      .task-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 3px;
        font-size: 11px;
        color: var(--muted);
      }
      .task-meta .mono { font-size: 10.5px; }
      .progress {
        margin-top: 11px;
        height: 6px;
        border-radius: 999px;
        background: var(--track);
        overflow: hidden;
      }
      .progress i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      }
      .task-side { display: flex; align-items: center; gap: 10px; justify-content: flex-end; }
      .task-side .stat { text-align: right; }
      .task-side .stat b {
        display: block;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .task-side .stat span { font-size: 10.5px; color: var(--muted); }

      .done-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 88px 104px 142px;
        gap: 10px;
        align-items: center;
        padding: 9px 0;
        border-bottom: 1px solid var(--border-soft);
        font-size: 11.5px;
      }
      .done-row:last-child { border-bottom: 0; }
      .done-row .nm { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .done-row .nm b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        font-size: 12px;
      }
      .done-row .nm span {
        color: var(--faint);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 10.5px;
      }
      .done-actions { display: flex; gap: 4px; justify-content: flex-end; }
      .done-actions button {
        height: auto;
        padding: 3px 5px;
        border: 0;
        background: none;
        color: var(--muted);
        font-size: 11px;
      }
      .done-actions button:hover { background: none; color: var(--accent); }

      .mono { font-family: "Cascadia Mono", Consolas, monospace; }
      .muted { color: var(--muted); }
      .faint { color: var(--faint); }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--panel);
        color: var(--text-2);
        font-size: 12.5px;
        font-weight: 500;
        height: auto;
      }
      .btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; }
      .btn.sm { min-height: 27px; padding: 0 9px; font-size: 11.5px; }
      .btn.ghost { border-color: transparent; background: none; color: var(--muted); }
      .btn.primary { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
      .btn.primary:hover { background: var(--primary); border-color: var(--accent); color: var(--on-primary); }
      .composer-row .btn.primary { min-height: 34px; padding: 0 16px; }

      @media (max-width: 900px) {
        .task { grid-template-columns: 1fr; gap: 10px; }
        .task-side { justify-content: flex-start; }
        .done-row { grid-template-columns: minmax(0, 1fr) 88px 104px; }
        .done-actions { grid-column: 1 / -1; justify-content: flex-start; }
        .task-search { width: 100%; margin-left: 0; }
      }
    `,
  ],
})
export class DownloadsPrototypeComponent implements OnDestroy {
  readonly sources: SourceItem[] = [
    { key: 'hf', label: 'Hugging Face', state: 'ok', speed: '直连 5.2', tip: '探针可用 · 直连 5.2 MB/s' },
    { key: 'ms', label: 'ModelScope', state: 'ok', speed: '直连 6.8', tip: '探针可用 · 直连 6.8 MB/s' },
    { key: 'civitai', label: 'Civitai', state: 'down', speed: '不可达', tip: '探针不可达：三条通路均超时' },
    { key: 'github', label: 'GitHub', state: 'ok', speed: '直连 3.4', tip: '探针可用 · 直连 3.4 MB/s' },
    { key: 'comfyhub', label: 'ComfyHub', state: 'degraded', speed: '未探测', tip: '尚未探测 · 首次使用时会自动测速' },
  ];

  readonly weights: WeightRow[] = [
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
  ];

  readonly strategyOptions = [
    { key: 'auto', label: '自动（最快可用）' },
    { key: 'direct', label: '直连' },
    { key: 'mirror', label: '镜像' },
    { key: 'proxy', label: '代理' },
  ];

  tasks: TaskItem[] = [
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
  ];

  selectedSourceKey = 'hf';
  repoId = 'Comfy-Org/MiniMax-H3-Image';
  resolvedName = 'MiniMax-H3-Image';
  resolved = true;
  resolving = false;
  repoError = '';
  showAllWeights = false;
  strategyLocked = true;
  strategyChoice = 'auto';
  tab: 'all' | 'active' | 'done' = 'all';
  taskQuery = '';
  notice = '';

  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  get sourceName(): string {
    return this.sources.find((s) => s.key === this.selectedSourceKey)?.label ?? 'Hugging Face';
  }

  get strategyText(): string {
    if (this.strategyChoice === 'auto') return '直连 5.2 MB/s';
    return this.strategyOptions.find((o) => o.key === this.strategyChoice)?.label ?? '直连';
  }

  get visibleWeights(): WeightRow[] {
    return this.showAllWeights ? this.weights : this.weights.filter((w) => w.recommended);
  }

  get selectedWeights(): WeightRow[] {
    return this.weights.filter((w) => w.selected);
  }

  get selectedSizeMb(): number {
    return this.selectedWeights.reduce((sum, w) => sum + w.sizeMb, 0);
  }

  get downloadLabel(): string {
    const hasExtra = this.weights.some((w) => w.selected && !w.recommended);
    return `${hasExtra ? '下载所选组合' : '下载推荐组合'} · ${this.fmtSize(this.selectedSizeMb)}`;
  }

  get autoFolders(): { folder: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const weight of this.selectedWeights) {
      counts.set(weight.folder, (counts.get(weight.folder) ?? 0) + 1);
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count }));
  }

  get allCount(): number {
    return this.tasks.length;
  }

  get activeCount(): number {
    return this.tasks.filter((t) => t.state !== 'done').length;
  }

  get doneCount(): number {
    return this.tasks.filter((t) => t.state === 'done').length;
  }

  get searchedTasks(): TaskItem[] {
    const q = this.taskQuery.trim().toLowerCase();
    if (!q) return this.tasks;
    return this.tasks.filter((t) =>
      `${t.name} ${t.source} ${t.subtitle ?? ''}`.toLowerCase().includes(q),
    );
  }

  get shownActive(): TaskItem[] {
    if (this.tab === 'done') return [];
    return this.searchedTasks.filter((t) => t.state !== 'done');
  }

  get shownDone(): TaskItem[] {
    if (this.tab === 'active') return [];
    return this.searchedTasks.filter((t) => t.state === 'done');
  }

  pickSource(source: SourceItem): void {
    if (source.state === 'down') return;
    this.selectedSourceKey = source.key;
    this.notice = source.state === 'degraded'
      ? `${source.label} 尚未探测，首次下载时会自动测速。`
      : `已选择来源：${source.label} · ${source.speed} MB/s`;
  }

  onRepoInput(event: Event): void {
    this.repoId = (event.target as HTMLInputElement).value;
    this.repoError = '';
  }

  resolveRepo(): void {
    const id = this.repoId.trim();
    if (!id) {
      this.repoError = '模型 ID 不能为空。';
      return;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) {
      this.repoError = '模型 ID 需要「组织/仓库」两段，例如 Comfy-Org/MiniMax-H3-Image。';
      return;
    }
    this.repoError = '';
    this.resolving = true;
    if (this.resolveTimer) clearTimeout(this.resolveTimer);
    this.resolveTimer = setTimeout(() => {
      this.resolving = false;
      this.resolved = true;
      this.resolvedName = id.split('/').pop() || id;
      this.notice = `解析完成：${this.resolvedName} · 8 个权重文件，已自动推荐 3 个。`;
    }, 500);
  }

  toggleWeight(weight: WeightRow): void {
    weight.selected = !weight.selected;
  }

  toggleAllWeights(): void {
    this.showAllWeights = !this.showAllWeights;
  }

  customSelect(): void {
    this.showAllWeights = true;
    this.notice = '已展开全部权重，可按需勾选；非推荐项需要先转换才能被 ComfyUI 直接加载。';
  }

  unlockStrategy(): void {
    this.strategyLocked = false;
  }

  setStrategy(event: Event): void {
    this.strategyChoice = (event.target as HTMLSelectElement).value;
  }

  restoreAuto(): void {
    this.strategyChoice = 'auto';
    this.strategyLocked = true;
  }

  startDownload(): void {
    if (!this.selectedSizeMb) return;
    const task: TaskItem = {
      id: `t-${Date.now()}`,
      name: this.resolvedName,
      source: this.sourceName,
      state: 'active',
      doneMb: 0,
      totalMb: this.selectedSizeMb,
      speed: '准备中',
      remaining: '等待开始',
      files: this.selectedWeights.length,
    };
    this.tasks = [task, ...this.tasks];
    this.tab = 'all';
    this.notice = `已创建下载任务：${task.name} · ${this.fmtSize(task.totalMb)} · ${task.files} 个文件。`;
  }

  togglePause(task: TaskItem): void {
    task.state = task.state === 'paused' ? 'active' : 'paused';
    this.notice = task.state === 'paused' ? `已暂停：${task.name}` : `继续下载：${task.name}`;
  }

  cancelTask(task: TaskItem): void {
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    this.notice = `已取消并移除任务：${task.name}`;
  }

  removeTask(task: TaskItem): void {
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    this.notice = `已删除下载记录：${task.name}（文件仍在磁盘上）`;
  }

  openTaskDir(task: TaskItem): void {
    this.notice = `已在文件管理器中打开 ${task.name} 的下载目录。`;
  }

  openDownloadDir(): void {
    this.notice = '已在文件管理器中打开 workspace/downloads/。';
  }

  onTaskQuery(event: Event): void {
    this.taskQuery = (event.target as HTMLInputElement).value;
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
