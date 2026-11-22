import { Component, OnDestroy } from '@angular/core';
import { BadgeComponent } from '../../../ui/badge.component';
import { EmptyComponent } from '../../../ui/empty.component';
import { PageHeaderComponent } from '../../../ui/page-header.component';

/** 左侧位置树的一项。children 只有模型库有。 */
interface LocationNode {
  key: string;
  label: string;
  size: string;
  children?: { key: string; label: string; size: string }[];
}

type RowType = 'model' | 'folder' | 'stale' | 'workflow' | 'node' | 'io' | 'cache';

/** 文件列表的一行。sizeMb 只用于排序与批量汇总，展示仍用 sizeLabel。 */
interface FileRow {
  id: string;
  name: string;
  /** 所属根：models / workflows / nodes / io / cache */
  group: string;
  /** 具体目录：diffusion_models / loras / … */
  folderKey: string;
  type: RowType;
  typeText: string;
  sizeLabel: string;
  sizeMb: number;
  modified: string;
  linkText: string;
  linked: boolean;
  precision: string;
  checksum: string;
  cleanable?: boolean;
}

interface CleanItem {
  id: string;
  label: string;
  why: string;
  sizeLabel: string;
  sizeMb: number;
  checked: boolean;
}

/**
 * VIS 原型 · 资源管理器。
 *
 * 按目录浏览本机资产：左侧位置树、中间文件列表、右侧单文件详情。
 * 只演示交互，不接真实目录 API；删除只动本地样例数据。
 */
@Component({
  selector: 'app-resource-manager-prototype',
  standalone: true,
  imports: [BadgeComponent, EmptyComponent, PageHeaderComponent],
  template: `
    <div class="proto-page">
    <ui-page-header
      kicker="Assets · Resources"
      title="资源管理器"
      hint="按目录查看本机资产的实际落点、占用和可清理项。删除只动文件，不改模型库与工作流索引。"
    >
      <button class="btn" type="button" (click)="openFolder()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1.4 1.6H14V13H2z" /></svg>
        在文件管理器中打开
      </button>
      <button class="btn primary" type="button" [disabled]="scanning" (click)="rescan()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7M13.2 2.8v3.4h-3.4" /></svg>
        {{ scanning ? '扫描中…' : '重新扫描' }}
      </button>
    </ui-page-header>

    <section class="summary" aria-label="占用概览">
      <div class="stat">
        <span>总占用</span><b>386.4 GB</b>
        <div class="usage"><i></i></div>
      </div>
      <div class="stat"><span>模型权重</span><b>362.1 GB</b></div>
      <div class="stat"><span>工作流</span><b>1.2 GB</b></div>
      <div class="stat"><span>自定义节点</span><b>18.3 GB</b></div>
      <div class="stat ok">
        <span>磁盘可用</span><b>2.1 TB</b>
        <div class="usage ok"><i></i></div>
      </div>
    </section>

    @if (notice) {
      <div class="page-notice" [class.warn]="notice.tone === 'warn'" role="status">
        <span class="grow">{{ notice.text }}</span>
        @if (lastDeleted.length) {
          <button class="btn sm" type="button" (click)="undoDelete()">撤销</button>
        }
        <button class="x-btn" type="button" aria-label="关闭提示" (click)="notice = null">×</button>
      </div>
    }

    <div class="rm-layout">
      <aside class="panel tree-panel" aria-label="位置">
        <div class="panel-head">
          <h2>位置</h2>
          <span class="muted">5 个根</span>
        </div>
        <div class="tree">
          @for (root of locations; track root.key) {
            <button
              class="tree-item"
              type="button"
              [class.active]="activeKey === root.key"
              (click)="pickLocation(root.key)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1.4 1.6H14V13H2z" /></svg>
              <span class="label">{{ root.label }}</span>
              <span class="sz">{{ root.size }}</span>
            </button>
            @if (root.children) {
              <div class="tree-child">
                @for (child of root.children; track child.key) {
                  <button
                    class="tree-item child"
                    type="button"
                    [class.active]="activeKey === child.key"
                    (click)="pickLocation(child.key)"
                  >
                    <span class="label">{{ child.label }}</span>
                    <span class="sz">{{ child.size }}</span>
                  </button>
                }
              </div>
            }
          }
        </div>
        <p class="tree-note">路径来自 workspace/ 与 var/。模型与节点目录不建议手工移动，移动后索引会失效。</p>
      </aside>

      <section class="panel list-panel" aria-label="文件列表">
        <div class="toolbar">
          <div class="crumbs">
            <b>{{ breadcrumb.root }}</b>
            @if (breadcrumb.sub !== '全部') {
              <span>/</span><b>{{ breadcrumb.sub }}</b>
            }
          </div>

          <label class="search">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" /><path d="M10.3 10.3 13.6 13.6" />
            </svg>
            <input
              type="search"
              [value]="query"
              (input)="onQuery($event)"
              placeholder="筛选文件或路径"
              aria-label="筛选文件或路径"
            />
          </label>

          <button
            class="icon-btn"
            type="button"
            title="列表视图"
            aria-label="列表视图"
            [class.on]="view === 'list'"
            [attr.aria-pressed]="view === 'list'"
            (click)="view = 'list'"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
          </button>
          <button
            class="icon-btn"
            type="button"
            title="网格视图"
            aria-label="网格视图"
            [class.on]="view === 'grid'"
            [attr.aria-pressed]="view === 'grid'"
            (click)="view = 'grid'"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
            </svg>
          </button>
          <button
            class="icon-btn"
            type="button"
            [title]="sortDir === 'none' ? '按大小排序' : sortDir === 'desc' ? '从大到小 · 再点从小到大' : '从小到大 · 再点取消'"
            aria-label="按大小排序"
            [class.on]="sortDir !== 'none'"
            (click)="cycleSort()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 3v10M2 11l2 2 2-2M9 4h5M9 8h4M9 12h3" />
            </svg>
          </button>
        </div>

        @if (visibleRows.length) {
          @if (view === 'list') {
            <div class="table-wrap">
              <table class="files-table">
                <thead>
                  <tr>
                    <th class="col-check">
                      <input
                        type="checkbox"
                        aria-label="全选当前目录"
                        [checked]="allVisibleSelected"
                        [indeterminate]="someVisibleSelected"
                        (change)="toggleAll($event)"
                      />
                    </th>
                    <th>名称</th>
                    <th class="col-type">类型</th>
                    <th class="col-size">大小</th>
                    <th class="col-time">修改时间</th>
                    <th class="col-link">关联资产</th>
                    <th class="col-act" aria-label="行操作"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of visibleRows; track row.id) {
                    <tr
                      [class.sel]="selectedRow?.id === row.id"
                      (click)="selectRow(row)"
                    >
                      <td class="col-check">
                        <input
                          type="checkbox"
                          [checked]="selectedIds.has(row.id)"
                          [attr.aria-label]="'选择 ' + row.name"
                          (click)="$event.stopPropagation()"
                          (change)="toggleRow(row, $event)"
                        />
                      </td>
                      <td>
                        <span class="name">
                          @if (row.type === 'folder') {
                            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h5l1.4 1.6H14V13H2z" /></svg>
                          } @else {
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M4 1.8h6.2L13 4.6V14H4z" /><path d="M10 2v3h3" />
                            </svg>
                          }
                          <span class="nm-wrap">
                            <span class="nm" [title]="row.name">{{ row.name }}</span>
                            <span class="path">{{ row.folderKey }}/</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        @if (row.type === 'stale') {
                          <ui-badge tone="orange">可清理</ui-badge>
                        } @else {
                          <span class="pill" [class.tone-model]="row.type === 'model'" [class.tone-alt]="row.type === 'node' || row.type === 'workflow'">
                            {{ row.typeText }}
                          </span>
                        }
                      </td>
                      <td class="col-size">{{ row.sizeLabel }}</td>
                      <td class="col-time muted">{{ row.modified }}</td>
                      <td class="col-link">
                        @if (row.linked) {
                          <span class="pill">{{ row.linkText }}</span>
                        } @else {
                          <span class="faint">{{ row.linkText }}</span>
                        }
                      </td>
                      <td class="col-act">
                        <button
                          class="row-btn"
                          type="button"
                          [class.danger]="row.cleanable"
                          (click)="onRowAction(row, $event)"
                        >{{ row.cleanable ? '删除' : '打开' }}</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="grid-cards">
              @for (row of visibleRows; track row.id) {
                <button
                  type="button"
                  class="grid-card"
                  [class.sel]="selectedRow?.id === row.id"
                  (click)="selectRow(row)"
                >
                  <span class="gc-top">
                    <span class="gc-icon" aria-hidden="true">{{ row.type === 'folder' ? '▣' : '▤' }}</span>
                    <span class="gc-name">{{ row.name }}</span>
                  </span>
                  <span class="gc-meta">{{ row.typeText }} · {{ row.sizeLabel }}</span>
                  <span class="gc-foot">
                    @if (row.cleanable) {
                      <ui-badge tone="orange">可清理</ui-badge>
                    } @else if (row.linked) {
                      <ui-badge tone="gray">{{ row.linkText }}</ui-badge>
                    } @else {
                      <span class="faint">{{ row.linkText }}</span>
                    }
                    <span class="faint">{{ row.modified }}</span>
                  </span>
                </button>
              }
            </div>
          }
        } @else {
          <ui-empty
            icon="⌕"
            [title]="query ? '没有匹配「' + query + '」的文件' : '这个目录里还没有文件'"
            hint="换个关键词，或从左侧选择其他位置。"
          />
        }

        @if (selectedRows.length) {
          <div class="bulk">
            <span class="grow"><b>{{ selectedRows.length }}</b> 项已选 · {{ selectedTotalLabel }}</span>
            <button class="btn sm" type="button" (click)="deleteSelected()">移入回收站</button>
            <button class="btn sm ghost" type="button" (click)="clearSelection()">取消选择</button>
          </div>
        }
      </section>

      <aside class="panel detail-panel" aria-label="详情">
        <div class="panel-head">
          <h2>详情</h2>
          <span class="muted">单文件</span>
        </div>

        @if (selectedRow; as row) {
          <div class="detail">
            <h3>{{ row.name }}</h3>
            <p class="sub">workspace/{{ row.group }}/{{ row.folderKey }}/</p>

            <dl class="kv">
              <dt>大小</dt><dd>{{ row.sizeLabel }}</dd>
              <dt>类型</dt><dd>{{ row.typeText }} · {{ row.type === 'folder' ? '目录' : '文件' }}</dd>
              <dt>精度</dt><dd>{{ row.precision }}</dd>
              <dt>关联</dt><dd>{{ row.linkText }}</dd>
              <dt>校验</dt><dd class="mono">{{ row.checksum }}</dd>
            </dl>

            <div class="detail-actions">
              <button class="btn sm" type="button" (click)="openFolder()">在文件夹中显示</button>
              <button class="btn sm" type="button" (click)="copyPath()">{{ copied ? '已复制路径' : '复制路径' }}</button>
              <button class="btn sm danger-text" type="button" (click)="deleteRow(row)">移入回收站</button>
            </div>

            <hr class="sep" />

            <p class="clean-title">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 15 14H1z" /><path d="M8 6v4M8 12.2v.2" /></svg>
              可清理项
            </p>

            @if (cleaned) {
              <p class="clean-done">可清理项已清空，空间已释放。</p>
            } @else {
              @for (item of cleanItems; track item.id) {
                <label class="clean-row">
                  <input type="checkbox" [checked]="item.checked" (change)="toggleClean(item)" />
                  <span>{{ item.label }}</span>
                  <span class="why">{{ item.why }}</span>
                  <span class="sz">{{ item.sizeLabel }}</span>
                </label>
              }
              <div class="clean-total">
                <span>预计可释放</span><b>{{ cleanTotalLabel }}</b>
              </div>
              <button
                class="btn sm clean-btn"
                type="button"
                [disabled]="!cleanCheckedCount"
                (click)="cleanSelected()"
              >清理所选 · {{ cleanTotalLabel }}</button>
            }
          </div>
        } @else {
          <ui-empty icon="▤" title="没有选中文件" hint="在中间列表点一行，这里会显示落点、精度、引用与校验。" />
        }
      </aside>
    </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      /* VIS shell 的 .vis-main 不提供内边距，页面自管宽度与留白 */
      .proto-page {
        max-width: 1440px;
        margin: 0 auto;
        padding: 26px 28px 72px;
        width: 100%;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 14px;
      }
      .stat {
        min-width: 0;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow-sm);
      }
      .stat span { font-size: 11px; color: var(--muted); }
      .stat b {
        display: block;
        margin-top: 3px;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .stat.ok b { color: var(--ok); }
      .usage {
        margin-top: 5px;
        height: 4px;
        border-radius: 999px;
        background: var(--track);
        overflow: hidden;
      }
      .usage i {
        display: block;
        height: 100%;
        width: 82%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      }
      .usage.ok { background: var(--ok-soft); }
      .usage.ok i { width: 28%; background: var(--ok); }

      /* 页级提示：只用于「刚做完一件事」，不承担页面级错误 */
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
      .page-notice.warn { border-color: var(--border-strong); background: var(--warn-soft); }
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

      .rm-layout {
        display: grid;
        grid-template-columns: 212px minmax(0, 1fr) 280px;
        gap: 14px;
        align-items: start;
      }
      .panel {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 13px;
        border-bottom: 1px solid var(--border);
      }
      .panel-head h2 { margin: 0; font-size: 13px; font-weight: 600; }
      .panel-head .muted { margin-left: auto; font-size: 11px; color: var(--muted); }

      /* —— 位置树 —— */
      .tree { padding: 8px; }
      .tree-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: auto;
        min-height: 30px;
        padding: 0 8px;
        border: 0;
        border-radius: 7px;
        background: none;
        color: var(--text-2);
        justify-content: flex-start;
        text-align: left;
        font-size: 12px;
        font-weight: 400;
      }
      .tree-item:hover { background: var(--hover); color: var(--text); }
      .tree-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
      .tree-item svg {
        flex: none;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        opacity: 0.7;
      }
      .tree-item .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tree-item .sz {
        margin-left: auto;
        font-size: 10.5px;
        color: var(--faint);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
      .tree-child { margin-left: 15px; padding-left: 8px; border-left: 1px solid var(--border-soft); }
      .tree-item.child { min-height: 27px; padding-left: 7px; }
      .tree-note {
        margin: 10px 12px 12px;
        padding-top: 10px;
        border-top: 1px solid var(--border-soft);
        font-size: 10.5px;
        line-height: 1.5;
        color: var(--faint);
      }

      /* —— 工具栏 —— */
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--panel-2);
        flex-wrap: wrap;
      }
      .crumbs {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 11.5px;
        color: var(--muted);
        overflow: hidden;
      }
      .crumbs b {
        color: var(--text-2);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .crumbs span { color: var(--faint); }
      .search {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-left: auto;
        width: 220px;
        max-width: 100%;
        height: 30px;
        padding: 0 9px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--input-bg);
      }
      .search svg {
        flex: none;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--faint);
        stroke-width: 1.5;
      }
      .search input {
        width: 100%;
        height: auto;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: none;
        outline: 0;
        color: var(--text);
        font-size: 12px;
        box-shadow: none;
      }
      .search input::placeholder { color: var(--faint); }
      .icon-btn {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--panel);
        color: var(--muted);
      }
      .icon-btn:hover { background: var(--hover); color: var(--text); }
      .icon-btn.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); }
      .icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.4; }

      /* —— 表格 —— */
      .table-wrap { overflow: auto; }
      .files-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .files-table th {
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--panel-2);
        color: var(--muted);
        font-size: 10.5px;
        font-weight: 500;
        text-align: left;
        white-space: nowrap;
      }
      .files-table td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--border-soft);
        font-size: 12px;
        vertical-align: middle;
      }
      .files-table tbody tr { cursor: pointer; }
      .files-table tbody tr:hover td { background: var(--hover); }
      .files-table tbody tr.sel td { background: var(--accent-soft); }
      .files-table tbody tr:last-child td { border-bottom: 0; }
      .col-check { width: 30px; }
      .col-type { width: 70px; }
      .col-size { width: 70px; text-align: right; font-variant-numeric: tabular-nums; }
      .col-time { width: 86px; }
      .col-link { width: 92px; }
      .col-act { width: 52px; }
      .col-check input { width: 14px; height: 14px; accent-color: var(--accent); }

      .name { display: flex; align-items: center; gap: 9px; min-width: 0; }
      .name svg {
        flex: none;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: var(--muted);
        stroke-width: 1.4;
      }
      .nm-wrap { min-width: 0; }
      .nm, .path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nm { font-weight: 500; }
      .path {
        font-size: 10.5px;
        color: var(--faint);
        font-family: "Cascadia Mono", Consolas, monospace;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--pill-bg);
        color: var(--pill-ink);
        font-size: 10.5px;
        white-space: nowrap;
      }
      .pill.tone-model { background: var(--accent-soft); color: var(--accent); }
      .pill.tone-alt { background: var(--panel-3); color: var(--text-2); }
      .row-btn {
        height: auto;
        min-height: 24px;
        padding: 0 7px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted);
        font-size: 11px;
        font-weight: 500;
      }
      .row-btn:hover { background: var(--hover); color: var(--text); }
      .row-btn.danger { color: var(--err); }

      /* —— 网格视图 —— */
      .grid-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 10px;
        padding: 12px;
      }
      .grid-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 0;
        height: auto;
        padding: 11px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--panel);
        text-align: left;
        justify-content: flex-start;
        align-items: stretch;
      }
      .grid-card:hover { border-color: var(--border-strong); background: var(--hover); }
      .grid-card.sel { border-color: var(--accent-line); background: var(--accent-soft); }
      .gc-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .gc-icon { flex: none; color: var(--muted); font-size: 14px; }
      .gc-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
      .gc-meta { font-size: 10.5px; color: var(--muted); }
      .gc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; font-size: 10.5px; }

      .bulk {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 12px 12px;
        padding: 9px 12px;
        border: 1px solid var(--accent-line);
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
      }
      .bulk .grow { flex: 1; }

      /* —— 详情 —— */
      .detail { padding: 14px; }
      .detail h3 {
        margin: 0 0 2px;
        font-size: 14px;
        font-weight: 600;
        word-break: break-all;
      }
      .detail .sub {
        margin: 0 0 12px;
        color: var(--faint);
        font-size: 10.5px;
        font-family: "Cascadia Mono", Consolas, monospace;
        word-break: break-all;
      }
      .kv {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 5px 10px;
        margin: 0 0 14px;
        font-size: 11.5px;
      }
      .kv dt { color: var(--muted); }
      .kv dd { margin: 0; color: var(--text-2); word-break: break-all; }
      .detail-actions { display: flex; flex-direction: column; gap: 6px; }
      .mono { font-family: "Cascadia Mono", Consolas, monospace; }
      .sep { margin: 16px 0 12px; border: 0; border-top: 1px solid var(--border-soft); }
      .clean-title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 600;
      }
      .clean-title svg {
        flex: none;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--warn);
        stroke-width: 1.4;
      }
      .clean-row {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 0;
        border-bottom: 1px dashed var(--border-soft);
        font-size: 11px;
        color: var(--text-2);
        cursor: pointer;
      }
      .clean-row input { flex: none; width: 13px; height: 13px; accent-color: var(--accent); }
      .clean-row .why { color: var(--muted); font-size: 10px; }
      .clean-row .sz {
        margin-left: auto;
        color: var(--warn);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-size: 10.5px;
        white-space: nowrap;
      }
      .clean-total {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 9px;
        padding-top: 9px;
        border-top: 1px solid var(--border);
        font-size: 11.5px;
      }
      .clean-total b { color: var(--warn); font-size: 13px; }
      .clean-btn { width: 100%; margin-top: 9px; }
      .clean-done {
        margin: 0;
        padding: 9px 10px;
        border-radius: var(--radius-sm);
        background: var(--ok-soft);
        color: var(--ok);
        font-size: 11.5px;
      }
      .danger-text { color: var(--err); }
      .danger-text:hover { background: var(--err-soft); border-color: var(--err); color: var(--err); }

      /* 页头动作区里的按钮：全局 button 已提供基础样式，这里补图标与主次 */
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
      .btn svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
      }
      .btn.sm { min-height: 27px; padding: 0 9px; font-size: 11.5px; }
      .btn.ghost { border-color: transparent; background: none; color: var(--muted); }
      .btn.primary { border-color: var(--primary); background: var(--primary); color: var(--on-primary); }
      .btn.primary:hover { background: var(--primary); border-color: var(--accent); color: var(--on-primary); }

      .muted { color: var(--muted); }
      .faint { color: var(--faint); }

      @media (max-width: 1180px) {
        .summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .rm-layout { grid-template-columns: 200px minmax(0, 1fr); }
        .detail-panel { grid-column: 1 / -1; }
      }
      @media (max-width: 1024px) {
        .rm-layout { grid-template-columns: minmax(0, 1fr); }
        .detail-panel { grid-column: auto; }
      }
      @media (max-width: 820px) {
        .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .search { width: 100%; order: 5; margin-left: 0; }
      }
    `,
  ],
})
export class ResourceManagerPrototypeComponent implements OnDestroy {
  view: 'list' | 'grid' = 'list';
  query = '';
  activeKey = 'diffusion_models';
  sortDir: 'none' | 'asc' | 'desc' = 'none';
  selectedId = 'minimax-w4a8';
  selectedIds = new Set<string>();
  copied = false;
  scanning = false;
  cleaned = false;
  notice: { text: string; tone: 'ok' | 'warn' } | null = null;
  lastDeleted: { row: FileRow; index: number }[] = [];

  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  readonly locations: LocationNode[] = [
    {
      key: 'models',
      label: '模型库',
      size: '362 GB',
      children: [
        { key: 'checkpoints', label: 'checkpoints', size: '128 GB' },
        { key: 'diffusion_models', label: 'diffusion_models', size: '196 GB' },
        { key: 'loras', label: 'loras', size: '22 GB' },
        { key: 'vae', label: 'vae', size: '8 GB' },
        { key: 'text_encoders', label: 'text_encoders', size: '6 GB' },
      ],
    },
    { key: 'workflows', label: '工作流', size: '1.2 GB' },
    { key: 'nodes', label: '自定义节点', size: '18 GB' },
    { key: 'io', label: '输入 / 输出', size: '4.8 GB' },
    { key: 'cache', label: '下载缓存', size: '3.1 GB' },
  ];

  readonly cleanItems: CleanItem[] = [
    { id: 'aria2', label: '未完成下载残留', why: '.aria2', sizeLabel: '2.8 GB', sizeMb: 2867, checked: true },
    { id: 'dupes', label: '重复权重', why: '同 sha256', sizeLabel: '11.9 GB', sizeMb: 12186, checked: true },
    { id: 'orphan', label: '无引用训练文件', why: '3 个', sizeLabel: '184 MB', sizeMb: 184, checked: true },
  ];

  rows: FileRow[] = [
    {
      id: 'minimax-w4a8',
      name: 'minimax_h3_image_pruned_w4a8.safetensors',
      group: 'models',
      folderKey: 'diffusion_models',
      type: 'model',
      typeText: '模型',
      sizeLabel: '11.7 GB',
      sizeMb: 11981,
      modified: '11-22 14:22',
      linkText: '3 个工作流',
      linked: true,
      precision: 'W4A8',
      checksum: 'sha256 3f9a…c21e',
    },
    {
      id: 'flux-fp8',
      name: 'flux1-dev-fp8.safetensors',
      group: 'models',
      folderKey: 'diffusion_models',
      type: 'model',
      typeText: '模型',
      sizeLabel: '11.9 GB',
      sizeMb: 12186,
      modified: '11-21 09:04',
      linkText: '7 个工作流',
      linked: true,
      precision: 'FP8',
      checksum: 'sha256 8b21…40d7',
    },
    {
      id: 'qwen-q4',
      name: 'Q4_K_M/',
      group: 'models',
      folderKey: 'diffusion_models',
      type: 'folder',
      typeText: '文件夹',
      sizeLabel: '7.2 GB',
      sizeMb: 7373,
      modified: '11-20 18:11',
      linkText: '2 个工作流',
      linked: true,
      precision: '—',
      checksum: '目录 · 3 个文件',
    },
    {
      id: 'trainer-state',
      name: 'trainer_state.json',
      group: 'models',
      folderKey: 'diffusion_models',
      type: 'stale',
      typeText: '可清理',
      sizeLabel: '1.4 MB',
      sizeMb: 1.4,
      modified: '11-18 07:42',
      linkText: '未关联',
      linked: false,
      precision: '—',
      checksum: '—',
      cleanable: true,
    },
    {
      id: 'index-json',
      name: 'model.safetensors.index.json',
      group: 'models',
      folderKey: 'diffusion_models',
      type: 'stale',
      typeText: '可清理',
      sizeLabel: '112 KB',
      sizeMb: 0.109,
      modified: '11-17 21:30',
      linkText: '未关联',
      linked: false,
      precision: '—',
      checksum: '—',
      cleanable: true,
    },
    {
      id: 'sdxl-base',
      name: 'sdxl_base_1.0.safetensors',
      group: 'models',
      folderKey: 'checkpoints',
      type: 'model',
      typeText: '模型',
      sizeLabel: '6.9 GB',
      sizeMb: 7066,
      modified: '11-16 10:08',
      linkText: '4 个工作流',
      linked: true,
      precision: 'FP16',
      checksum: 'sha256 1c4e…9a02',
    },
    {
      id: 'detail-lora',
      name: 'detail_tweaker_xl.safetensors',
      group: 'models',
      folderKey: 'loras',
      type: 'model',
      typeText: '模型',
      sizeLabel: '184 MB',
      sizeMb: 184,
      modified: '11-15 16:40',
      linkText: '6 个工作流',
      linked: true,
      precision: 'FP16',
      checksum: 'sha256 77ab…12ff',
    },
    {
      id: 'minimax-vae',
      name: 'minimax_h3_image_vae_fp16.safetensors',
      group: 'models',
      folderKey: 'vae',
      type: 'model',
      typeText: '模型',
      sizeLabel: '1.1 GB',
      sizeMb: 1126,
      modified: '11-22 14:22',
      linkText: '3 个工作流',
      linked: true,
      precision: 'FP16',
      checksum: 'sha256 b9d0…7e41',
    },
    {
      id: 'qwen-te',
      name: 'qwen3.8_27b_minimax_h3_image_pe_w4a8_gptq.safetensors',
      group: 'models',
      folderKey: 'text_encoders',
      type: 'model',
      typeText: '模型',
      sizeLabel: '16.1 GB',
      sizeMb: 16486,
      modified: '11-22 14:22',
      linkText: '3 个工作流',
      linked: true,
      precision: 'W4A8',
      checksum: 'sha256 52cd…91b8',
    },
    {
      id: 'inpaint-workflow',
      name: 'sdxl-inpaint-workflow.json',
      group: 'workflows',
      folderKey: 'user',
      type: 'workflow',
      typeText: '工作流',
      sizeLabel: '3.1 MB',
      sizeMb: 3.1,
      modified: '11-19 14:02',
      linkText: '1 个画布',
      linked: true,
      precision: '—',
      checksum: '—',
    },
    {
      id: 'impact-pack',
      name: 'ComfyUI-Impact-Pack',
      group: 'nodes',
      folderKey: 'custom_nodes',
      type: 'node',
      typeText: '节点',
      sizeLabel: '18 MB',
      sizeMb: 18,
      modified: '11-18 07:42',
      linkText: '9 个节点',
      linked: true,
      precision: '—',
      checksum: 'git 8f21…c0d3',
    },
    {
      id: 'output-sheet',
      name: 'output_0042.png',
      group: 'io',
      folderKey: 'output',
      type: 'io',
      typeText: '输出',
      sizeLabel: '24 MB',
      sizeMb: 24,
      modified: '11-22 15:01',
      linkText: '未关联',
      linked: false,
      precision: '—',
      checksum: '—',
    },
    {
      id: 'partial-download',
      name: 'flux1-dev-fp8.safetensors.part',
      group: 'cache',
      folderKey: 'downloads',
      type: 'cache',
      typeText: '缓存',
      sizeLabel: '2.8 GB',
      sizeMb: 2867,
      modified: '11-21 09:01',
      linkText: '未关联',
      linked: false,
      precision: '—',
      checksum: '未完成',
      cleanable: true,
    },
  ];

  ngOnDestroy(): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    if (this.scanTimer) clearTimeout(this.scanTimer);
  }

  get breadcrumb(): { root: string; sub: string } {
    for (const root of this.locations) {
      if (root.key === this.activeKey) return { root: root.label, sub: '全部' };
      const child = root.children?.find((c) => c.key === this.activeKey);
      if (child) return { root: root.label, sub: child.label };
    }
    return { root: '模型库', sub: '全部' };
  }

  get visibleRows(): FileRow[] {
    const inRoot = this.locations.find((l) => l.key === this.activeKey);
    let list = this.rows.filter((row) =>
      inRoot ? row.group === inRoot.key : row.folderKey === this.activeKey,
    );

    const q = this.query.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        `${row.name} ${row.folderKey} ${row.typeText} ${row.linkText}`.toLowerCase().includes(q),
      );
    }

    if (this.sortDir === 'asc') list = list.slice().sort((a, b) => a.sizeMb - b.sizeMb);
    if (this.sortDir === 'desc') list = list.slice().sort((a, b) => b.sizeMb - a.sizeMb);
    return list;
  }

  get selectedRow(): FileRow | null {
    const rows = this.visibleRows;
    return rows.find((row) => row.id === this.selectedId) ?? rows[0] ?? null;
  }

  get selectedRows(): FileRow[] {
    return this.rows.filter((row) => this.selectedIds.has(row.id));
  }

  get selectedTotalLabel(): string {
    return this.fmtMb(this.selectedRows.reduce((sum, row) => sum + row.sizeMb, 0));
  }

  get allVisibleSelected(): boolean {
    const rows = this.visibleRows;
    return rows.length > 0 && rows.every((row) => this.selectedIds.has(row.id));
  }

  get someVisibleSelected(): boolean {
    return !this.allVisibleSelected && this.visibleRows.some((row) => this.selectedIds.has(row.id));
  }

  get cleanCheckedCount(): number {
    return this.cleanItems.filter((item) => item.checked).length;
  }

  get cleanTotalLabel(): string {
    return this.fmtMb(
      this.cleanItems.filter((item) => item.checked).reduce((sum, item) => sum + item.sizeMb, 0),
    );
  }

  pickLocation(key: string): void {
    this.activeKey = key;
    this.notice = null;
    this.lastDeleted = [];
    const first = this.visibleRows[0];
    this.selectedId = first ? first.id : '';
  }

  onQuery(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
  }

  cycleSort(): void {
    this.sortDir = this.sortDir === 'none' ? 'desc' : this.sortDir === 'desc' ? 'asc' : 'none';
  }

  selectRow(row: FileRow): void {
    this.selectedId = row.id;
    this.copied = false;
  }

  onRowAction(row: FileRow, event: Event): void {
    event.stopPropagation();
    if (row.cleanable) {
      this.deleteRow(row);
      return;
    }
    this.selectRow(row);
    this.notice = row.type === 'folder'
      ? { text: `已展开目录：workspace/${row.group}/${row.folderKey}/${row.name}`, tone: 'ok' }
      : { text: `已在文件夹中定位：${row.name}`, tone: 'ok' };
  }

  toggleRow(row: FileRow, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds);
    if (checked) next.add(row.id);
    else next.delete(row.id);
    this.selectedIds = next;
    this.selectedId = row.id;
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds);
    for (const row of this.visibleRows) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    this.selectedIds = next;
  }

  clearSelection(): void {
    this.selectedIds = new Set();
  }

  deleteSelected(): void {
    const picked = this.selectedRows;
    if (!picked.length) return;
    this.lastDeleted = picked
      .map((row) => ({ row, index: this.rows.findIndex((r) => r.id === row.id) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index);
    this.rows = this.rows.filter((row) => !this.selectedIds.has(row.id));
    this.selectedIds = new Set();
    this.selectFirstVisible();
    this.notice = {
      text: `已把 ${picked.length} 项移入回收站 · ${this.fmtMb(picked.reduce((sum, row) => sum + row.sizeMb, 0))}。删除只动文件，索引未改。`,
      tone: 'ok',
    };
  }

  deleteRow(row: FileRow): void {
    const index = this.rows.findIndex((r) => r.id === row.id);
    if (index < 0) return;
    this.lastDeleted = [{ row, index }];
    this.rows = this.rows.filter((r) => r.id !== row.id);
    this.selectedIds.delete(row.id);
    this.selectedIds = new Set(this.selectedIds);
    this.selectFirstVisible();
    this.notice = { text: `已移入回收站：${row.name}（可在资源管理器中恢复）`, tone: 'ok' };
  }

  undoDelete(): void {
    if (!this.lastDeleted.length) return;
    for (const { row, index } of this.lastDeleted) {
      this.rows.splice(Math.min(index, this.rows.length), 0, row);
    }
    this.rows = [...this.rows];
    this.selectedId = this.lastDeleted[0].row.id;
    this.lastDeleted = [];
    this.notice = { text: '已撤销，文件回到原位置。', tone: 'ok' };
  }

  private selectFirstVisible(): void {
    const first = this.visibleRows[0];
    this.selectedId = first ? first.id : '';
    this.copied = false;
  }

  openFolder(): void {
    const row = this.selectedRow;
    const where = row ? `workspace/${row.group}/${row.folderKey}` : `workspace/${this.breadcrumb.root}`;
    this.notice = { text: `已在文件管理器中打开 ${where}`, tone: 'ok' };
  }

  copyPath(): void {
    const row = this.selectedRow;
    if (!row) return;
    const path = `E:/Projects/model-downloader/workspace/${row.group}/${row.folderKey}/${row.name}`;
    try {
      navigator.clipboard?.writeText(path).catch(() => {});
    } catch {
      /* 剪贴板不可用时仍给出视觉确认，路径已在详情里可见 */
    }
    this.copied = true;
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => (this.copied = false), 1600);
  }

  rescan(): void {
    if (this.scanning) return;
    this.scanning = true;
    this.notice = null;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanning = false;
      this.notice = { text: '扫描完成：5 个根目录已更新，发现 3 类可清理项。', tone: 'ok' };
    }, 700);
  }

  toggleClean(item: CleanItem): void {
    item.checked = !item.checked;
  }

  cleanSelected(): void {
    if (!this.cleanCheckedCount) return;
    const label = this.cleanTotalLabel;
    const count = this.cleanCheckedCount;
    this.cleaned = true;
    this.notice = { text: `已清理 ${count} 项，释放 ${label}。`, tone: 'ok' };
  }

  fmtMb(mb: number): string {
    if (mb <= 0) return '0 B';
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 10) return `${Math.round(mb)} MB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.max(1, Math.round(mb * 1024))} KB`;
  }
}
