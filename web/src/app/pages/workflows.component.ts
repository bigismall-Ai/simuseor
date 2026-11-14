import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { focusFirst, trapTab } from '../core/a11y';
import { LocalWorkflow, WorkflowItem, WorkflowModelDep, WorkflowNodeDep, errMsg, fmtNum, fmtSize } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { CoverPlateComponent } from '../ui/cover-plate.component';
import { FamilyMarkComponent } from '../ui/family-mark.component';
import { WorkflowCardComponent } from '../ui/workflow-card.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

const PAGE_SIZE = 12;

/** 封面管理弹层的状态。单独抽出来，异步回调里能拿到一个稳定的引用。 */
type CoverManager = {
  item: LocalWorkflow;
  key: string;
  url: string;
  customUrl: string;
  failed: boolean;
  busy: boolean;
  error: string;
};

const SOURCES = [
  { key: 'all', label: '全部来源' },
  { key: 'templates', label: 'ComfyUI 官方模板' },
  { key: 'comfyhub', label: 'ComfyHub' },
  { key: 'huggingface', label: 'Hugging Face' },
  { key: 'modelscope', label: 'ModelScope' },
  { key: 'civitai', label: 'Civitai' },
  { key: 'github', label: 'GitHub' },
];

const SOURCE_LABELS: Record<string, string> = {
  templates: 'ComfyUI 官方模板',
  comfyhub: 'ComfyHub',
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  github: 'GitHub',
};

const SOURCE_TONES: Record<string, 'blue' | 'green' | 'orange' | 'gray'> = {
  templates: 'green',
  comfyhub: 'blue',
  huggingface: 'blue',
  modelscope: 'green',
  civitai: 'orange',
  github: 'gray',
};

const SORTS = [
  { key: 'downloads', label: '热门' },
  { key: 'latest', label: '最新' },
];

/** 我的工作流的排序选项：点按钮弹出来选，不再点一下换一个。 */
const LOCAL_SORTS: Array<{ key: 'mtime' | 'nodes' | 'name'; label: string }> = [
  { key: 'mtime', label: '最近修改' },
  { key: 'nodes', label: '按节点数' },
  { key: 'name', label: '按名称' },
];

@Component({
  selector: 'app-workflows',
  // Esc 逐层退出（菜单 → 编辑 → 删除 → 抽屉）：键盘用户不该被弹层困住
  host: {
    '(document:keydown.escape)': 'onEsc()',
    '(document:click)': 'closeSortMenu()',
  },
  standalone: true,
  imports: [FormsModule, RouterLink, BadgeComponent, CoverPlateComponent, EmptyComponent, FamilyMarkComponent, PageHeaderComponent, PanelComponent, WorkflowCardComponent],
  template: `
    <ui-page-header
      [kicker]="tab === 'discover' ? 'Workflows · Discover' : 'Workflows'"
      [title]="tab === 'discover' ? '发现工作流' : '工作流'"
      [hint]="tab === 'discover' ? '官方模板 / ComfyHub / HF / ModelScope / Civitai / GitHub' : ''"
    />

    @if (tab === 'mine') {
      <!-- 动作结果走右下角悬浮 toast，不在页面里插一段会顶走列表的文字 -->
      @if (!localLoading && !local.length) {
        <ui-panel>
          <ui-empty
            title="还没有本地工作流"
            hint="从「发现工作流」下载一份，或在 ComfyUI 里保存一条，就会出现在这里。"
          >
            <button class="primary btn-xs" routerLink="/workflows/discover">去发现工作流</button>
          </ui-empty>
        </ui-panel>
      } @else {
        <div class="lw-bar">
          <span class="lw-count" [title]="localDir">
            {{ localLoading ? '读取中…' : filtered.length + ' / ' + local.length + ' 个工作流' }}
          </span>
          <div class="lw-actions">
            <button class="btn-xs lw-act" (click)="openGroupManager()" title="分组管理"
                    data-testid="lw-groups-manage">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 5.1a1.4 1.4 0 0 1 1.4-1.4h2.7l1.3 1.5h5.2A1.4 1.4 0 0 1 14 6.6v5.7a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 12.3z" />
              </svg>
              分组管理
            </button>
            <button class="btn-xs lw-act" (click)="loadLocal()" [disabled]="localLoading" title="刷新">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M13.2 7.4a5.3 5.3 0 1 0-.3 2.6" /><path d="M13.3 3.6v3.9H9.4" />
              </svg>
              刷新
            </button>
          </div>
        </div>

        <!-- 分组筛选：独立一行。分组名来自侧车里设的名称，一条都没分组时整行不出现
             —— 空的分组栏只会让人以为哪里坏了。 -->
        @if (groupNames.length) {
          <div class="wf-groups" role="group" aria-label="按分组筛选" data-testid="lw-groups">
            <span class="wf-glabel">分组</span>
            <div class="wf-chips">
              <button class="wf-chip" [class.on]="groupFilter === null" (click)="setGroup(null)">
                全部<b>{{ allCount }}</b>
              </button>
              @for (g of groupNames; track g.name) {
                <button class="wf-chip" [class.on]="groupFilter === g.name" (click)="setGroup(g.name)">
                  {{ g.name }}<b>{{ groupCount(g.name) }}</b>
                </button>
              }
              @if (ungroupedCount) {
                <button class="wf-chip" [class.on]="groupFilter === UNGROUPED" (click)="setGroup(UNGROUPED)">
                  未分组<b>{{ groupCount(UNGROUPED) }}</b>
                </button>
              }
            </div>
          </div>
        }

        <!-- 工具栏：视图切换 → 搜索 → 状态筛选 → 排序。视图放最前，切的是整个列表的呈现。 -->
        <div class="wf-tools">
          <div class="wf-chips" role="group" aria-label="视图切换">
            <button class="wf-chip" [class.on]="view === 'card'" (click)="setView('card')">卡片</button>
            <button class="wf-chip" [class.on]="view === 'list'" (click)="setView('list')">列表</button>
          </div>
          <input
            class="grow"
            [(ngModel)]="localQ"
            placeholder="搜索名称、原文件名或分组"
            data-testid="lw-search"
          />
          <div class="wf-chips">
            @for (s of statusFilters; track s.key) {
              <button class="wf-chip" [class.on]="statusFilter === s.key" (click)="setStatus(s.key)">
                {{ s.label }}<b>{{ countOf(s.key) }}</b>
              </button>
            }
          </div>
          <!-- 排序不再点一下换一个：展开一个选择，当前项有对勾 -->
          <div class="wf-sort-wrap">
            <button class="wf-chip" [class.on]="sortMenu" (click)="toggleSortMenu($event)"
                    data-testid="lw-sort" aria-haspopup="menu" [attr.aria-expanded]="sortMenu" title="排序方式">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                <path d="M3 4.2h10M3 8h7M3 11.8h4" />
              </svg>
              {{ sortLabel }}
              <svg class="caret" viewBox="0 0 16 16" width="10" height="10" fill="none"
                   stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <path d="m4.4 6.4 3.6 3.4 3.6-3.4" />
              </svg>
            </button>
            @if (sortMenu) {
              <div class="wf-sort-menu" role="menu" data-testid="lw-sort-menu">
                @for (s of localSorts; track s.key) {
                  <button role="menuitem" [class.on]="sortKey === s.key" (click)="setSortKey(s.key)">
                    <span>{{ s.label }}</span>
                    @if (sortKey === s.key) {
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                        <path d="M3.2 8.4 6.4 11.6 12.8 5.2" />
                      </svg>
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>

        @if (!filtered.length) {
          <ui-panel>
            <ui-empty
              title="没有符合条件的工作流"
              hint="换个关键词或筛选条件试试；也可能是这个分组下还没有工作流。"
            />
          </ui-panel>
        } @else if (view === 'card') {
          <div class="wf-grid" data-testid="lw-grid">
            @for (it of filtered; track it.path) {
              <app-workflow-card
                [it]="it"
                (primary)="onPrimary($event)"
                (more)="onMore($event)"
              />
            }
          </div>
        } @else {
          <ui-panel>
            <div class="lw-list">
              @for (it of filtered; track it.path) {
                <div class="lw-row" [class.broken]="stateOf(it) === 'broken'">
                  <!-- 缩略图：卡片有封面，列表也得有，否则同一份资产在两个视图里认不出是同一件 -->
                  <span class="lw-thumb">
                    @if (it.cover && stateOf(it) !== 'broken') {
                      <img [src]="it.cover" alt="" referrerpolicy="no-referrer" loading="lazy" />
                    } @else if (stateOf(it) === 'broken') {
                      <span class="lw-thumb-err">!</span>
                    } @else {
                      <ui-family-mark [model]="it.main_model || ''" />
                    }
                  </span>

                  <div class="lw-body">
                    <p class="lw-name" [title]="it.path">{{ it.title || it.name }}</p>
                    <p class="lw-sub">
                      @if (it.group) {
                        <span class="lw-grp">{{ it.group }}</span>
                      }
                      <span>{{ it.nodes }} 节点 · {{ fmtSize(it.size) }} · {{ ago(it.mtime) }}</span>
                    </p>
                  </div>

                  <!-- 徽标与主按钮：和卡片同一套四态映射，不另立一套 -->
                  <span class="lw-badge" [attr.data-tone]="badgeOf(it).tone" [title]="badgeOf(it).tip">
                    {{ badgeOf(it).text }}
                  </span>
                  @if (it.format === 'ui' || it.format === 'api') {
                    <span class="lw-fmt" [class.api]="it.format === 'api'">
                      {{ it.format === 'api' ? 'API' : 'UI' }}
                    </span>
                  }
                  <button
                    class="lw-primary"
                    [class.ghost]="actOf(it) === 'edit'"
                    (click)="onPrimary({ item: it, act: actOf(it) })"
                  >
                    {{ actLabel(it) }}
                  </button>
                  <button
                    class="lw-kebab"
                    type="button"
                    aria-haspopup="menu"
                    aria-label="更多操作"
                    title="更多操作"
                    (click)="openMoreFromList(it, $event)"
                  >
                    ⋯
                  </button>
                </div>
              }
            </div>
          </ui-panel>
        }
      }
    } @else {

    <ui-panel>
      <div class="toolbar">
        <input
          class="grow"
          [(ngModel)]="q"
          (keyup.enter)="search()"
          placeholder="搜索工作流，如 flux / wan / minimax，留空看热门"
          data-testid="wf-search"
        />
        <button class="primary" (click)="search()" [disabled]="loading">搜索</button>
      </div>

      <div class="wf-filters">
        <div class="chip-row">
          @for (s of sources; track s.key) {
            <button class="filter-chip" [class.active]="source === s.key" (click)="setSource(s.key)">
              {{ s.label }}
            </button>
          }
        </div>
        <div class="wf-sort">
          @for (s of sorts; track s.key) {
            <button class="filter-chip" [class.active]="sort === s.key" (click)="setSort(s.key)">
              {{ s.label }}
            </button>
          }
        </div>
      </div>

      @if (errorText) {
        <div class="notice err">{{ errorText }}</div>
      }
      @if (sourceErrors.length) {
        <div class="notice err">
          @for (e of sourceErrors; track e.label) {
            <div>{{ e.label }}：{{ e.message }}</div>
          }
        </div>
      }
      @if (loading && !items.length) {
        <div class="notice info">正在检索各站工作流…</div>
      }
    </ui-panel>

    @if (!loading && !items.length && !errorText) {
      <ui-empty title="没有找到工作流" hint="换个关键词，或切换来源再试。" />
    }

    <div class="wf-list">
      @for (it of items; track it.source + '/' + it.id) {
        <article class="wf-row">
          <app-cover-plate class="wf-thumb" size="wide" [model]="plateOf(it)" />

          <div class="wf-body">
            <div class="wf-head">
              <h3 class="wf-title" [title]="it.id">{{ it.name }}</h3>
              <ui-badge [tone]="toneOf(it.source)">{{ labelOf(it.source) }}</ui-badge>
              <a class="mc-link" [href]="it.url" target="_blank" rel="noreferrer">来源 ↗</a>
            </div>
            <div class="wf-meta">
              @if (it.author) {
                <span>{{ it.author }}</span>
              }
              @if (it.updated_at) {
                <span>↻ {{ it.updated_at }}</span>
              }
              <span>↓ {{ fmtNum(it.downloads) }}</span>
              <span>{{ it.file_count }} 个文件</span>
            </div>
            @if (it.description) {
              <p class="wf-desc">{{ it.description }}</p>
            }
            @if ((it.requires?.length || 0) + it.tags.length > 0) {
              <div class="wf-tags">
                @for (r of it.requires || []; track r) {
                  <span class="wf-req">{{ r }}</span>
                }
                @for (t of it.tags.slice(0, 4); track t) {
                  <span class="wf-tag">{{ t }}</span>
                }
              </div>
            }
            <p class="wf-files" [title]="it.files.join('\n')">{{ previewFiles(it) }}</p>
          </div>

          <div class="wf-actions">
            <button
              class="primary btn-xs"
              (click)="download(it)"
              [disabled]="busy === keyOf(it)"
              title="下载到工作流库，所有 ComfyUI 实例共用"
              [attr.data-testid]="'wf-download-' + it.source"
            >
              @if (busy === keyOf(it)) { 正在创建… } @else { 下载到工作流库 }
            </button>
          </div>
        </article>
      }
    </div>

    @if (items.length && !done) {
      <div class="mc-more">
        <button (click)="loadMore()" [disabled]="loading">{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    }
    }

    <!-- 补齐依赖抽屉：模型与节点包两段，输入图不在这里（它属于「使用工作流」的前置检查） -->
    @if (drawerOf) {
      <div class="dr-mask" (click)="closeDrawer()"></div>
      <aside #drawerBox class="dr" role="dialog" aria-modal="true" aria-label="补齐依赖"
             tabindex="-1" (keydown.tab)="trapTab($event, drawerBox)">
        <header class="dr-head">
          <div>
            <p class="dr-kicker">补齐依赖</p>
            <h2 class="dr-title">{{ drawerOf.title || drawerOf.name }}</h2>
          </div>
          <button class="btn-xs" (click)="closeDrawer()">关闭</button>
        </header>
        <div class="dr-body">
          <section class="dr-sec">
            <div class="dr-sec-head">
              <h3>缺失模型</h3>
              <span class="dr-sec-count">{{ drawerModels.length }} 项</span>
            </div>
            @if (!drawerModels.length) {
              <p class="dr-empty">没有缺失的模型</p>
            }
            @for (m of drawerModels; track m.file) {
              <div class="dr-row">
                <span class="dr-icon warn">↓</span>
                <div class="dr-main">
                  <p class="dr-name" [title]="m.file">{{ m.file }}</p>
                  <p class="dr-sub">{{ m.directory || '目录未知' }}<span> · </span>{{ m.node || '未知节点' }}</p>
                </div>
                <button class="btn-xs" (click)="revealModel(m)" title="在模型库里找同族文件">去找</button>
              </div>
            }
          </section>

          <section class="dr-sec">
            <div class="dr-sec-head">
              <h3>缺失节点包</h3>
              <span class="dr-sec-count">{{ drawerPkgs.length }} 项</span>
            </div>
            @if (!drawerPkgs.length) {
              <p class="dr-empty">节点包都已装好</p>
            }
            @for (pkg of drawerPkgs; track pkg.id) {
              <div class="dr-row">
                <span class="dr-icon warn">↓</span>
                <div class="dr-main">
                  <p class="dr-name" [title]="pkg.name">{{ pkg.name }}</p>
                  <p class="dr-sub">{{ pkg.author || '未知作者' }} · 提供「{{ pkg.covers[0] }}」</p>
                </div>
                <button class="btn-xs" (click)="installPkg(pkg)" [disabled]="busy === pkg.id">
                  {{ busy === pkg.id ? '安装中…' : '安装' }}
                </button>
              </div>
            }
            @if (drawerUnknown.length) {
              <p class="dr-empty" [title]="drawerUnknown.join('、')">
                另有 {{ drawerUnknown.length }} 个节点类型在扩展开源清单里查不到（可能是私有节点或刚发布）：
                {{ drawerUnknown[0] }}{{ drawerUnknown.length > 1 ? ' 等' : '' }}
              </p>
            }
          </section>
        </div>
        <footer class="dr-foot">
          <span class="dr-note">模型走下载任务，节点包装到共享目录</span>
          <div class="dr-ops">
            <button class="btn-xs" (click)="closeDrawer()">稍后</button>
            <button class="primary btn-xs" (click)="installAll(drawerOf)" [disabled]="!drawerPkgs.length">
              补齐节点包
            </button>
          </div>
        </footer>
      </aside>
    }

    <!-- ⋯ 溢出菜单：低频动作都在这里，卡片上只留一个主按钮 -->
    @if (menuOf) {
      <div class="wf-menu-mask" (click)="closeMenu()"></div>
      <div class="wf-menu" role="menu" [style.left.px]="menuAt.x" [style.top.px]="menuAt.y">
        <button role="menuitem" (click)="openCoverManager(menuOf)">变更封面</button>
        <button role="menuitem" (click)="openRename(menuOf)">重命名</button>
        <button role="menuitem" (click)="openGroupManager()">分组管理</button>
        <span class="wf-menu-sep"></span>
        <button role="menuitem" (click)="openEditor(menuOf)"
                [title]="menuOf.format === 'ui' ? '在 ComfyUI 画布中打开' : 'API / 损坏文件无法载入画布，将用默认程序打开'">
          在画布中打开
        </button>
        <button role="menuitem" (click)="reveal(menuOf); closeMenu()">打开文件夹</button>
        <button role="menuitem" class="danger" (click)="askDelete(menuOf)">删除</button>
      </div>
    }

    <!-- 重命名与分组：只改显示名，原文件名默认保留（ComfyUI 也要读它） -->
    @if (editing) {
      <div class="wf-modal-mask" (click)="closeEditor()"></div>
      <div #editBox class="wf-modal" role="dialog" aria-modal="true" aria-label="重命名与分组"
           tabindex="-1" (keydown.tab)="trapTab($event, editBox)">
        <h2>重命名 / 分组</h2>
        <p class="wf-modal-sub" [title]="editing.item.path">{{ editing.item.title || editing.item.name }}</p>
        <label class="wf-field">
          <span>显示名称</span>
          <input [(ngModel)]="editing.title" maxlength="80" placeholder="留空则回落文件名" />
        </label>
        <label class="wf-field">
          <span>分组</span>
          <!-- 用真正的 select 而不是 datalist：原生 datalist 要点一下才弹、
               输入过滤时会把已有组藏掉，管理框里改名后选项还常常是旧的。 -->
          <div class="wf-group-row">
            <select [(ngModel)]="editing.group" data-testid="lw-edit-group">
              <option value="">未分组</option>
              @for (g of groupNames; track g.name) {
                <option [value]="g.name">{{ g.name }}（{{ g.count }}）</option>
              }
              @if (editing.group && !hasGroup(editing.group)) {
                <option [value]="editing.group">{{ editing.group }}（已不存在）</option>
              }
            </select>
            <button class="btn-xs" type="button" (click)="openGroupManager(true)"
                    data-testid="lw-group-manager-link">分组管理</button>
          </div>
        </label>
        <label class="wf-check">
          <input type="checkbox" [(ngModel)]="editing.rename" />
          <span>同时重命名文件</span>
        </label>
        <div class="wf-modal-ops">
          <button class="btn-xs" (click)="closeEditor()">取消</button>
          <button class="primary btn-xs" (click)="saveMeta()">保存</button>
        </div>
      </div>
    }

    <!-- 删除二次确认：删的是共享目录里的文件，不是列表里的一行 -->
    @if (pendingDelete) {
      <div class="wf-modal-mask" (click)="pendingDelete = null"></div>
      <div #delBox class="wf-modal narrow" role="alertdialog" aria-modal="true" aria-label="删除工作流"
           tabindex="-1" (keydown.tab)="trapTab($event, delBox)">
        <h2>删除这条工作流？</h2>
        <p class="wf-modal-sub">
          「{{ pendingDelete.title || pendingDelete.name }}」将从共享目录删除。
        </p>
        <div class="wf-modal-ops">
          <button class="btn-xs" (click)="pendingDelete = null">取消</button>
          <button class="primary btn-xs" (click)="confirmDelete()">删除</button>
        </div>
      </div>
    }

    <!-- 分组管理：新建 / 改名 / 删除都在这里，变更分组的弹层不掺和改名 -->
    @if (groupMgr) {
      <div class="wf-modal-mask stack" (click)="closeGroupManager()"></div>
      <div #groupBox class="wf-modal wide stack" role="dialog" aria-modal="true" aria-label="分组管理"
           tabindex="-1" (keydown.tab)="trapTab($event, groupBox)" data-testid="lw-group-manager">
        <h2>分组管理</h2>
        <div class="gm-add">
          <input [(ngModel)]="groupMgr.draft" maxlength="24" placeholder="新分组名"
                 data-testid="gm-new-name" (keydown.enter)="createGroupFromManager()" />
          <button class="btn-xs" (click)="createGroupFromManager()" data-testid="gm-add">新建分组</button>
        </div>

        <div class="gm-list">
          @for (g of groupNames; track g.name) {
            <div class="gm-row" [attr.data-group]="g.name">
              @if (groupMgr.renaming === g.name) {
                <input class="gm-rename" [(ngModel)]="groupMgr.renameDraft" maxlength="24"
                       data-testid="gm-rename-input" (keydown.enter)="confirmRenameGroup()" />
                <button class="btn-xs" (click)="groupMgr.renaming = null">取消</button>
                <button class="primary btn-xs" (click)="confirmRenameGroup()" data-testid="gm-rename-save">保存</button>
              } @else if (groupMgr.pendingDelete === g.name) {
                <span class="gm-name gm-warn">删除「{{ g.name }}」？这 {{ g.count }} 条会变成未分组</span>
                <button class="btn-xs" (click)="groupMgr.pendingDelete = null">取消</button>
                <button class="primary btn-xs" (click)="confirmDeleteGroup()" data-testid="gm-delete-save">确认删除</button>
              } @else {
                <span class="gm-name">{{ g.name }}<b>{{ g.count }}</b></span>
                <button class="btn-xs" (click)="startRenameGroup(g.name)"
                        [attr.data-testid]="'gm-rename-' + g.name">改名</button>
                <button class="btn-xs danger" (click)="startDeleteGroup(g.name)"
                        [attr.data-testid]="'gm-delete-' + g.name">删除</button>
              }
            </div>
          } @empty {
            <p class="gm-empty">还没有分组，先在上面新建一个。</p>
          }
        </div>

        @if (groupMgr.error) { <p class="gm-error">{{ groupMgr.error }}</p> }
        <div class="wf-modal-ops">
          <button class="btn-xs" (click)="closeGroupManager()" data-testid="gm-close">关闭</button>
        </div>
      </div>
    }

    <!-- 封面管理：抽一张 / 自定义 / 恢复自动都在一个地方，⋯ 菜单只留一个入口 -->
    @if (coverMgr) {
      <div class="wf-modal-mask stack" (click)="closeCoverManager()"></div>
      <div #coverBox class="wf-modal wide stack cm" role="dialog" aria-modal="true" aria-label="封面管理"
           tabindex="-1" (keydown.tab)="trapTab($event, coverBox)" data-testid="lw-cover-manager">
        <h2>封面管理</h2>
        <p class="wf-modal-sub mono" [title]="coverMgr.item.path">{{ coverMgr.item.title || coverMgr.item.name }}</p>

        <div class="cm-preview" data-testid="cm-preview">
          @if (coverMgr.url && !coverMgr.failed) {
            <img [src]="coverMgr.url" alt="当前封面预览" referrerpolicy="no-referrer"
                 (error)="coverMgr.failed = true" />
          } @else {
            <div class="cm-preview-empty">
              <ui-family-mark [model]="coverMgr.item.main_model || ''" />
              <span>{{ coverMgr.failed ? '图片加载失败' : '暂无封面' }}</span>
            </div>
          }
        </div>
        <div class="cm-actions">
          <button class="primary btn-xs" (click)="redealFromManager()" [disabled]="coverMgr.busy"
                  data-testid="cm-redeal">{{ coverMgr.busy ? '正在换…' : '换一张' }}</button>
          @if (isPinnedKey(coverMgr.key)) {
            <button class="btn-xs" (click)="resetFromManager()" [disabled]="coverMgr.busy"
                    data-testid="cm-reset">恢复自动封面</button>
          }
        </div>

        <div class="cm-custom">
          <p class="cm-label">自定义封面</p>
          <div class="cm-url-row">
            <input [(ngModel)]="coverMgr.customUrl" placeholder="粘贴图片地址 https://…"
                   data-testid="cm-url" (keydown.enter)="applyCustomUrl()" />
            <button class="btn-xs" (click)="applyCustomUrl()" [disabled]="coverMgr.busy"
                    data-testid="cm-url-apply">使用</button>
          </div>
          <label class="cm-file">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                   (change)="onCoverFile($event)" data-testid="cm-file" />
            <span>或上传本地图片</span>
          </label>
        </div>

        @if (coverMgr.error) { <p class="cm-error">{{ coverMgr.error }}</p> }
        <div class="wf-modal-ops">
          <button class="btn-xs" (click)="closeCoverManager()" data-testid="cm-close">关闭</button>
        </div>
      </div>
    }

    <!-- 动作反馈：悬浮、可关闭、自动消失，不在页面流里插一段会顶走列表的文字 -->
    @if (toast) {
      <div class="wf-toast" [class.err]="toast.tone === 'err'" role="status" data-testid="wf-toast">
        <span class="wf-toast-dot"></span>
        <span class="wf-toast-text">{{ toast.text }}</span>
        @if (tab === 'discover') {
          <a routerLink="/downloads">查看任务 →</a>
        }
        <button type="button" class="wf-toast-close" aria-label="关闭提示" title="关闭提示"
                data-testid="wf-toast-close" (click)="dismissToast()">×</button>
      </div>
    }
  `,
  styles: `
    /* 列表上方一条读数：共几条、目录在哪、刷新。目录用等宽字截断，路径长也不换行 */
    /* ---- 卡片视图工具栏 ---- */
    .wf-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
      flex-wrap: wrap;
    }
    .wf-tools input {
      flex: 1;
      min-width: 170px;
      height: 32px;
      padding: 0 11px;
      border: 1px solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--panel);
      color: var(--text);
      font: inherit;
      font-size: 12.5px;
    }
    .wf-tools input::placeholder { color: var(--muted); }
    .wf-chips {
      display: flex;
      gap: 2px;
      padding: 3px;
      background: var(--panel-3);
      border-radius: var(--radius-sm);
    }
    .wf-chip {
      height: 24px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--radius-xs);
      background: none;
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .wf-chip:hover { color: var(--text); }
    .wf-chip.on {
      background: var(--panel);
      color: var(--accent);
      font-weight: 600;
      box-shadow: inset 0 0 0 1px var(--accent-line);
    }
    /* 数字用小标签，别再像一个跟在名字后面的裸数字 */
    .wf-chip b {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 17px;
      height: 16px;
      padding: 0 4px;
      border-radius: var(--radius-xs);
      background: var(--panel);
      box-shadow: inset 0 0 0 1px var(--border-strong);
      color: var(--text);
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .wf-chip.on b {
      background: var(--accent-line);
      color: var(--accent);
      box-shadow: none;
    }
    /* 排序按钮独立于 chip 组，给它自己的边框与下拉层 */
    .wf-sort-wrap { position: relative; z-index: 45; flex: none; }
    .wf-sort-wrap > .wf-chip {
      height: 29px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--panel);
      padding: 0 9px;
      color: var(--text-2);
    }
    .wf-sort-wrap > .wf-chip:hover,
    .wf-sort-wrap > .wf-chip.on { border-color: var(--border-strong); color: var(--text); }
    .wf-sort-wrap > .wf-chip.on { box-shadow: inset 0 0 0 1px var(--accent-line); }
    .wf-sort-wrap > .wf-chip svg.caret { opacity: 0.6; }
    .wf-sort-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      min-width: 148px;
      padding: 4px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: 0 16px 34px -22px rgb(0 0 0 / 0.55);
    }
    .wf-sort-menu button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      padding: 7px 9px;
      border: 0;
      border-radius: var(--radius-xs);
      background: none;
      color: var(--text-2);
      font: inherit;
      font-size: 12.5px;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }
    .wf-sort-menu button:hover { background: var(--panel-3); color: var(--text); }
    .wf-sort-menu button.on { color: var(--accent); font-weight: 600; }

    /* ---- 分组筛选：独立一行，分组多了横向滚，不换行把工具栏顶下去 ---- */
    .wf-groups {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 12px 0 -4px;
      min-width: 0;
    }
    .wf-glabel {
      flex: none;
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 500;
    }
    .wf-groups .wf-chips {
      /* 不拉伸到满宽：分组名长短不一，chip 贴着内容排，多了才横向滚 */
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .wf-groups .wf-chip { flex: none; }

    /* ---- 卡片栅格：4 列，窄屏自动降列 ---- */
    .wf-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(238px, 1fr));
      gap: 13px;
      align-items: start;
    }

    /* ---- 依赖抽屉 ---- */
    .dr-mask {
      position: fixed;
      inset: 0;
      z-index: 40;
      background: rgb(0 0 0 / 0.34);
    }
    :host-context([data-theme='dark']) .dr-mask { background: rgb(0 0 0 / 0.58); }
    .dr {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 452px;
      max-width: 92vw;
      z-index: 41;
      display: flex;
      flex-direction: column;
      background: var(--panel);
      border-left: 1px solid var(--border);
    }
    /* tabindex=-1 是为了让焦点能落到弹层上，这圈描边只对纯键盘用户有意义 */
    .dr:focus,
    .wf-modal:focus { outline: none; }
    .dr-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px 13px;
      border-bottom: 1px solid var(--border-soft);
    }
    .dr-kicker {
      margin: 0;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .dr-title {
      margin: 3px 0 0;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dr-body { flex: 1; overflow-y: auto; padding: 4px 18px 18px; }
    .dr-sec { padding: 14px 0 4px; border-bottom: 1px solid var(--border-soft); }
    .dr-sec:last-child { border-bottom: 0; }
    .dr-sec-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .dr-sec-head h3 { margin: 0; font-size: 12.5px; font-weight: 600; }
    .dr-sec-count { font-size: 11px; color: var(--muted); white-space: nowrap; }
    .dr-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border-soft);
    }
    .dr-row:first-of-type { border-top: 0; }
    .dr-icon {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: var(--radius-xs);
      display: grid;
      place-items: center;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
    }
    .dr-icon.warn { background: var(--warn); }
    .dr-icon.mute { background: var(--muted); }
    .dr-main { flex: 1; min-width: 0; }
    .dr-name {
      margin: 0;
      font-size: 12.5px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dr-sub {
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dr-empty { margin: 2px 0 0; padding: 4px 0; font-size: 11.5px; color: var(--muted); }
    .dr-foot {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      border-top: 1px solid var(--border-soft);
      background: var(--panel-2);
    }
    .dr-note {
      flex: 1;
      min-width: 0;
      font-size: 11px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dr-ops { display: flex; gap: 8px; flex: none; }

    /* ---- ⋯ 溢出菜单：贴着按钮弹出，点空白处收起 ---- */
    .wf-menu-mask {
      position: fixed;
      inset: 0;
      z-index: 44;
    }
    .wf-menu {
      position: fixed;
      z-index: 45;
      min-width: 168px;
      padding: 4px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: 0 16px 34px -22px rgb(0 0 0 / 0.55);
    }
    .wf-menu button {
      display: block;
      width: 100%;
      padding: 7px 9px;
      border: 0;
      border-radius: var(--radius-xs);
      background: none;
      color: var(--text-2);
      font: inherit;
      font-size: 12.5px;
      text-align: left;
      cursor: pointer;
    }
    .wf-menu button:hover { background: var(--panel-3); color: var(--text); }
    .wf-menu button:disabled { opacity: 0.5; cursor: default; }
    .wf-menu button:disabled:hover { background: none; color: var(--text-2); }
    .wf-menu button.danger { color: var(--err); }
    .wf-menu button.danger:hover { background: var(--err-soft); }
    .wf-menu-sep {
      display: block;
      height: 1px;
      margin: 4px 6px;
      background: var(--border-soft);
    }

    /* ---- 重命名 / 删除对话框 ---- */
    .wf-modal-mask {
      position: fixed;
      inset: 0;
      z-index: 46;
      background: rgb(0 0 0 / 0.34);
    }
    :host-context([data-theme='dark']) .wf-modal-mask { background: rgb(0 0 0 / 0.6); }
    .wf-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 47;
      width: 420px;
      max-width: calc(100vw - 32px);
      transform: translate(-50%, -50%);
      padding: 16px 18px 14px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 24px 60px -30px rgb(0 0 0 / 0.6);
    }
    .wf-modal.narrow { width: 360px; }
    .wf-modal h2 {
      margin: 0 0 4px;
      font-size: 14px;
      font-weight: 600;
    }
    .wf-modal-sub {
      margin: 0 0 12px;
      font-size: 11.5px;
      line-height: 1.6;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-modal-sub.mono { font-family: "Cascadia Mono", Consolas, monospace; font-size: 10.5px; }
    .wf-modal-sub.wrap { white-space: normal; line-height: 1.7; }
    .wf-field {
      display: block;
      margin-bottom: 10px;
    }
    .wf-field span {
      display: block;
      margin-bottom: 4px;
      font-size: 11px;
      color: var(--muted);
    }
    .wf-field input {
      width: 100%;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 12.5px;
    }
    .wf-check {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 2px 0 14px;
      font-size: 11.5px;
      color: var(--muted);
      cursor: pointer;
    }
    .wf-modal-ops {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* ---- 分组管理 / 变更分组里的轻量动作 ---- */
    .wf-modal.wide { width: 480px; }
    .gm-add { display: flex; gap: 8px; margin-bottom: 10px; }
    .gm-add input,
    .gm-rename {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 12.5px;
    }
    .gm-list { max-height: 260px; overflow-y: auto; margin-bottom: 8px; }
    .gm-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 2px;
      border-bottom: 1px solid var(--border);
    }
    .gm-row:last-child { border-bottom: 0; }
    .gm-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12.5px;
      color: var(--text);
    }
    .gm-name b {
      margin-left: 7px;
      font-weight: 500;
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .gm-warn { color: var(--err); white-space: normal; }
    .gm-row .btn-xs.danger { color: var(--err); }
    .gm-empty, .gm-error { margin: 6px 0; font-size: 11.5px; color: var(--muted); }
    .gm-error { color: var(--err); }

    /* 从「变更分组」里叠开分组管理时，两层弹层都在：上面那层要完整盖住下面 */
    .wf-modal-mask.stack { z-index: 48; }
    .wf-modal.stack { z-index: 49; }

    /* 分组下拉用真 select，旁边给一个去管理框的入口 */
    .wf-group-row { display: flex; align-items: center; gap: 8px; }
    .wf-group-row select {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 8px;
      border: 1px solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 12.5px;
    }
    .wf-group-row .btn-xs { flex: none; }

    /* ---- 封面管理 ---- */
    .wf-modal.cm { width: 520px; }
    .cm-preview {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 10;
      max-height: 260px;
      overflow: hidden;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .cm-preview::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px var(--border);
      pointer-events: none;
    }
    .cm-preview img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .cm-preview-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 100%;
      color: var(--muted);
      font-size: 11.5px;
    }
    .cm-actions { display: flex; gap: 8px; margin-bottom: 14px; }
    .cm-actions .btn-xs { flex: none; }
    .cm-custom { padding-top: 12px; border-top: 1px solid var(--border); }
    .cm-label { margin: 0 0 8px; font-size: 11.5px; color: var(--muted); }
    .cm-url-row { display: flex; gap: 8px; }
    .cm-url-row input {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 12.5px;
    }
    .cm-url-row .btn-xs { flex: none; }
    .cm-file {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 9px;
      font-size: 11.5px;
      color: var(--muted);
      cursor: pointer;
    }
    .cm-file input { width: auto; max-width: 190px; font-size: 11px; }
    .cm-error { margin: 8px 0 0; font-size: 11.5px; color: var(--err); }

    /* ---- 悬浮提示：不占文档流，点 × 或等几秒自己走 ---- */
    .wf-toast {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 80;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(420px, calc(100vw - 44px));
      padding: 10px 10px 10px 14px;
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      font-size: 12px;
      box-shadow: 0 18px 48px -24px rgb(0 0 0 / 0.55);
      animation: wf-toast-in 180ms ease-out;
    }
    .wf-toast::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 1px var(--border);
      pointer-events: none;
    }
    .wf-toast-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
    .wf-toast.err .wf-toast-dot { background: var(--err); }
    .wf-toast-text { flex: 1; min-width: 0; line-height: 1.5; }
    .wf-toast a { flex: none; color: var(--primary); font-size: 11.5px; text-decoration: none; }
    .wf-toast a:hover { text-decoration: underline; }
    .wf-toast-close {
      flex: none;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--muted);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .wf-toast-close:hover { background: var(--panel-3); color: var(--text); }
    /* 只做位移、不做淡入：淡入会让刚出现的一瞬截图/实际观感都发灰 */
    @keyframes wf-toast-in {
      from { transform: translateY(8px); }
      to { transform: none; }
    }

    .lw-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 9px;
      border-bottom: 1px solid var(--border);
      font-size: 11.5px;
    }
    .lw-count { color: var(--text-2); font-weight: 500; font-variant-numeric: tabular-nums; }
    .lw-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
    .lw-act {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      white-space: nowrap;
    }
    .lw-act svg { width: 13px; height: 13px; flex: none; }

    /* 列表行：与卡片同构 —— 缩略图 → 名称/规格 → 徽标 → 格式 → 唯一主按钮 → ⋯。
       用 flex 而不是 grid：文本列给固定宽度会在标题长短不一时刻意留白，
       这里只有操作区对齐（固定在右端），其余按内容自然排。 */
    .lw-row {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 9px 2px;
      border-top: 1px solid var(--border);
    }
    .lw-row:first-child { border-top: 0; }
    .lw-row:hover { background: var(--hover); }

    .lw-thumb {
      flex: none;
      width: 44px;
      height: 30px;
      border-radius: var(--radius-xs);
      overflow: hidden;
      display: grid;
      place-items: center;
      background: var(--panel-3);
    }
    .lw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .lw-thumb-err { color: var(--err); font-size: 13px; font-weight: 700; }

    .lw-body { flex: 1; min-width: 0; }
    .lw-name {
      margin: 0;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.45;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lw-sub {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 2px 0 0;
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lw-grp {
      flex: none;
      display: inline-flex;
      align-items: center;
      height: 16px;
      padding: 0 5px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      color: var(--text-2);
      font-size: 10px;
      font-weight: 600;
    }

    /* 徽标用语义色浅底：列表是平铺的，不需要卡片那种压图用的深底 */
    .lw-badge {
      flex: none;
      padding: 2px 8px;
      border-radius: var(--radius-xs);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .lw-badge[data-tone='warn'] { color: var(--warn); background: var(--warn-soft); }
    .lw-badge[data-tone='note'] { color: var(--warn); background: var(--warn-soft); }
    .lw-badge[data-tone='err'] { color: var(--err); background: var(--err-soft); }
    .lw-badge[data-tone='muted'] { color: var(--text-2); background: var(--panel-3); }

    .lw-fmt {
      flex: none;
      padding: 2px 5px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    .lw-fmt.api { color: var(--warn); }

    .lw-primary {
      flex: none;
      height: 26px;
      padding: 0 10px;
      border: 1px solid var(--primary);
      border-radius: var(--radius-sm);
      background: var(--primary);
      color: var(--on-primary);
      font: inherit;
      font-size: 11.5px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .lw-primary.ghost {
      background: var(--panel);
      border-color: var(--border);
      color: var(--text-2);
    }
    .lw-primary.ghost:hover { border-color: var(--border-strong); color: var(--text); }

    .lw-kebab {
      flex: none;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--panel);
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
    }
    .lw-kebab:hover { border-color: var(--border-strong); color: var(--text); }

    /* 窄屏先让徽标让位：动作按钮比状态文字更不可省 */
    @media (max-width: 820px) {
      .lw-badge { display: none; }
    }

    .wf-filters {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .wf-sort {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }
    .wf-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* 缩略图列宽度固定：一列图宽窄不一会让右边界跳，整列看起来是歪的 */
    .wf-row {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr) auto;
      gap: 14px;
      padding: 12px 14px 12px 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .wf-row:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-sm);
    }
    .wf-thumb {
      align-self: start;
      border-radius: 8px;
      overflow: hidden;
    }

    .wf-body { min-width: 0; }

    .wf-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wf-title {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.35;
      max-width: 70%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wf-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 5px;
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .wf-meta span + span::before {
      content: '·';
      margin-right: 8px;
      opacity: 0.45;
    }

    .wf-desc {
      margin: 7px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .wf-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
    }
    .wf-req {
      max-width: 240px;
      padding: 0 6px;
      border-radius: var(--radius-xs);
      background: var(--warn-soft);
      color: var(--warn);
      font-size: 10.5px;
      line-height: 17px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf-tag {
      font-size: 10.5px;
      line-height: 17px;
      color: var(--muted);
    }

    .wf-files {
      margin: 8px 0 0;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 10.5px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wf-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      justify-content: center;
      min-width: 96px;
    }

    @media (max-width: 760px) {
      .wf-row { grid-template-columns: 92px minmax(0, 1fr); }
      .wf-thumb { width: 92px; height: 72px; }
      .wf-actions {
        grid-column: 1 / -1;
        flex-direction: row;
      }
    }
  `,
})
export class WorkflowsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly sources = SOURCES;
  readonly sorts = SORTS;
  readonly localSorts = LOCAL_SORTS;
  /** 视图由路由决定：/workflows 是我的工作流，/workflows/discover 是发现 */
  tab: 'mine' | 'discover' = 'mine';
  local: LocalWorkflow[] = [];

  /* ---- 卡片视图的筛选与视图状态 ---- */
  localQ = '';
  statusFilter: 'all' | 'missing' | 'ready' | 'broken' = 'all';
  /** 分组筛选：null = 不过滤；UNGROUPED = 只看没分组的 */
  groupFilter: string | null = null;
  readonly UNGROUPED = '__ungrouped__';
  view: 'card' | 'list' = 'card';
  /** 排序方式：由下拉选择决定，偏好里持久化 */
  sortKey: 'mtime' | 'nodes' | 'name' = 'mtime';
  sortMenu = false;
  readonly statusFilters = [
    { key: 'all' as const, label: '全部' },
    { key: 'missing' as const, label: '缺依赖' },
    { key: 'ready' as const, label: '就绪' },
    { key: 'broken' as const, label: '无法解析' },
  ];
  /** 依赖抽屉：当前展开的那条 */
  drawerOf: LocalWorkflow | null = null;
  /** ⋯ 溢出菜单：点在哪张卡上、弹在哪个坐标 */
  menuOf: LocalWorkflow | null = null;
  menuAt = { x: 0, y: 0 };
  /** 重命名与分组对话框 */
  editing: { item: LocalWorkflow; title: string; group: string; rename: boolean } | null = null;
  /** 删除二次确认 */
  pendingDelete: LocalWorkflow | null = null;
  /** 分组管理弹层：新建 / 改名 / 删除都收在这里 */
  groupMgr: {
    draft: string;
    renaming: string | null;
    renameDraft: string;
    pendingDelete: string | null;
    error: string;
    /** 从「变更分组」打开时，关闭后要回到编辑框并刷新下拉 */
    fromEditor: boolean;
    dirty: boolean;
  } | null = null;
  /** 显式创建的分组（可能是空组，条目里汇总不出来） */
  definedGroups: string[] = [];
  /** 手动钉过封面的工作流键 —— 封面管理框里才显示「恢复自动封面」 */
  pinnedKeys: string[] = [];
  /** 封面管理弹层：预览 / 换一张 / 自定义 / 恢复自动 */
  coverMgr: CoverManager | null = null;

  /* 弹层焦点管理：打开时焦点进入弹层，Tab 在弹层内环绕，Esc 逐层退出 */
  @ViewChild('drawerBox') drawerBox?: ElementRef<HTMLElement>;
  @ViewChild('editBox') editBox?: ElementRef<HTMLElement>;
  @ViewChild('delBox') delBox?: ElementRef<HTMLElement>;
  @ViewChild('groupBox') groupBox?: ElementRef<HTMLElement>;
  @ViewChild('coverBox') coverBox?: ElementRef<HTMLElement>;
  readonly trapTab = trapTab;
  localDir = '';
  localLoading = false;
  q = '';
  source = 'all';
  sort = 'downloads';
  items: WorkflowItem[] = [];
  loading = false;
  done = true;
  page = 1;
  busy = '';
  errorText = '';
  sourceErrors: { label: string; message: string }[] = [];

  /* 动作反馈：悬浮 toast。业务代码照旧写 this.notice / this.localError，
     由 setter 转成一条可关闭的提示，不再在页面流里插文字。 */
  toast: { text: string; tone: 'ok' | 'err' } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private _notice = '';
  private _localError = '';
  get notice(): string { return this._notice; }
  set notice(text: string) {
    this._notice = text;
    if (text) this.showToast(text, 'ok');
  }
  get localError(): string { return this._localError; }
  set localError(text: string) {
    this._localError = text;
    if (text) this.showToast(text, 'err');
  }

  private showToast(text: string, tone: 'ok' | 'err'): void {
    this.toast = { text, tone };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), tone === 'ok' ? 4500 : 8000);
  }

  dismissToast(): void {
    this.toast = null;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  /** 检索请求序号：切源/搜索/翻页时旧请求可能后到，不能让它覆盖当前结果 */
  private reqSeq = 0;

  ngOnDestroy(): void {
    this.dismissToast();
  }

  ngOnInit(): void {
    this.restorePrefs();
    // 两个路径共用同一个组件实例，切换时组件不会重建，所以视图由路由的 data 驱动
    this.route.data.subscribe((data) => {
      const next: 'mine' | 'discover' = data['tab'] === 'discover' ? 'discover' : 'mine';
      this.tab = next;
      if (next === 'discover') {
        if (!this.items.length) this.load(1);
      } else if (!this.local.length) {
        this.loadLocal();
      }
    });
  }

  /* ================= 卡片视图：筛选 / 排序 / 视图 ================= */

  /** 一条工作流当前处于四态里的哪一个。与卡片组件的判定必须一致。 */
  stateOf(it: LocalWorkflow): 'broken' | 'api' | 'missing' | 'ready' {
    if (it.format === 'broken') return 'broken';
    if (it.format === 'api') return 'api';
    return this.missingOf(it) > 0 ? 'missing' : 'ready';
  }

  missingOf(it: LocalWorkflow): number {
    return (it.deps?.missing?.length || 0) + (it.node_deps?.missing?.length || 0);
  }

  get filtered(): LocalWorkflow[] {
    let rows = this.searched().filter((it) => this.inGroup(it));
    if (this.statusFilter !== 'all') {
      rows = rows.filter((it) => this.stateOf(it) === this.statusFilter);
    }
    const key = this.sortKey;
    return rows.slice().sort((a, b) => {
      if (key === 'nodes') return (b.nodes || 0) - (a.nodes || 0);
      if (key === 'name') return (a.title || a.name).localeCompare(b.title || b.name, 'zh');
      return (b.mtime || 0) - (a.mtime || 0);
    });
  }

  /** 搜索命中的那一批：分组与状态两个筛选面都在它上面求交集 */
  private searched(): LocalWorkflow[] {
    const q = this.localQ.trim().toLowerCase();
    if (!q) return this.local;
    return this.local.filter((it) =>
      `${it.title || ''} ${it.name} ${it.group || ''} ${it.main_model || ''}`.toLowerCase().includes(q),
    );
  }

  private groupOf(it: LocalWorkflow): string {
    return (it.group || '').trim();
  }

  private inGroup(it: LocalWorkflow): boolean {
    if (this.groupFilter === null) return true;
    const g = this.groupOf(it);
    return this.groupFilter === this.UNGROUPED ? !g : g === this.groupFilter;
  }

  /**
   * 分组清单。
   *
   * 主体仍从条目自身的 group 汇总，不用后端那份 meta 汇总 —— 侧车里可能留着已经
   * 删掉的文件的旧键，那会数出一个点进去是空的组。唯一的例外是用户在「分组管理」
   * 里显式建的空组：那是真实意图，也要列出来。
   */
  get groupNames(): { name: string; count: number }[] {
    const acc = new Map<string, number>();
    for (const it of this.local) {
      const g = this.groupOf(it);
      if (g) acc.set(g, (acc.get(g) || 0) + 1);
    }
    for (const name of this.definedGroups) {
      if (!acc.has(name)) acc.set(name, 0);
    }
    return [...acc]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  get ungroupedCount(): number {
    return this.local.filter((it) => !this.groupOf(it)).length;
  }

  /**
   * 分组 chip 上的数字：叠加搜索与状态，但不叠加分组本身
   * —— 每个筛选面只回答「在其他条件下我这儿还剩几条」。
   */
  groupCount(name: string): number {
    const rows = this.searched().filter(
      (it) => this.statusFilter === 'all' || this.stateOf(it) === this.statusFilter,
    );
    if (name === this.UNGROUPED) return rows.filter((it) => !this.groupOf(it)).length;
    return rows.filter((it) => this.groupOf(it) === name).length;
  }

  /** 「全部」chip：与各分组 chip 同口径，叠搜索与状态但不叠分组 */
  get allCount(): number {
    return this.searched().filter(
      (it) => this.statusFilter === 'all' || this.stateOf(it) === this.statusFilter,
    ).length;
  }

  setGroup(name: string | null): void {
    this.groupFilter = name;
    this.savePrefs();
  }

  /** 分组名没了（改名/删除/改分组）就别把筛选卡在一个不存在的组上 */
  private reconcileGroup(): void {
    if (this.groupFilter === null) return;
    const f = this.groupFilter;
    const alive = f === this.UNGROUPED ? this.ungroupedCount > 0 : this.groupNames.some((g) => g.name === f);
    if (!alive) this.groupFilter = null;
  }

  countOf(key: 'all' | 'missing' | 'ready' | 'broken'): number {
    const rows = this.searched().filter((it) => this.inGroup(it));
    if (key === 'all') return rows.length;
    return rows.filter((it) => this.stateOf(it) === key).length;
  }

  setStatus(key: 'all' | 'missing' | 'ready' | 'broken'): void {
    this.statusFilter = key;
    this.savePrefs();
  }

  setView(view: 'card' | 'list'): void {
    this.view = view;
    this.savePrefs();
  }

  get sortLabel(): string {
    return LOCAL_SORTS.find((s) => s.key === this.sortKey)?.label || '排序';
  }

  /** 按钮自身要阻止冒泡，否则 document 上的关闭监听会把它刚打开的菜单立刻收掉 */
  toggleSortMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.sortMenu = !this.sortMenu;
  }

  closeSortMenu(): void {
    this.sortMenu = false;
  }

  setSortKey(key: 'mtime' | 'nodes' | 'name'): void {
    this.sortKey = key;
    this.sortMenu = false;
    this.savePrefs();
  }

  /** 一条工作流有多少依赖（模型槽位 + 节点包），与卡片上的计数同口径 */
  depsTotalOf(it: LocalWorkflow): number {
    const models = it.model_slots?.length || 0;
    const pkgs = (it.node_deps?.have?.length || 0) + (it.node_deps?.missing?.length || 0);
    return models + pkgs;
  }

  /**
   * 列表徽标：与卡片封面上的徽标一一对应。
   *
   * 卡片用红底/中性底压在图上，列表是平铺的，所以改用语义色浅底 ——
   * 但**说什么**必须完全一致，否则同一件资产在两个视图里给出两种结论。
   */
  badgeOf(it: LocalWorkflow): { text: string; tone: 'err' | 'warn' | 'muted' | 'note'; tip: string } {
    const state = this.stateOf(it);
    if (state === 'broken') {
      return { text: '无法解析', tone: 'err', tip: it.error || '文件解析失败' };
    }
    if (state === 'api') {
      return { text: 'API 格式', tone: 'note', tip: '只有节点与连线，没有坐标，载不进画布' };
    }
    if (state === 'ready') {
      return { text: `${it.nodes} 节点 · ${this.depsTotalOf(it)} 依赖`, tone: 'muted', tip: '依赖齐全' };
    }
    const parts: string[] = [];
    const m = it.deps?.missing?.length || 0;
    const p = it.node_deps?.missing?.length || 0;
    const un = it.node_deps?.unknown?.length || 0;
    if (m) parts.push(`缺 ${m} 模型`);
    if (p) parts.push(`${p} 节点包`);
    if (un) parts.push(`${un} 待确认`);
    return { text: parts.join(' · '), tone: 'warn', tip: '点「补齐依赖」处理' };
  }

  /** 四态 → 唯一动作，与卡片的映射表同源 */
  actOf(it: LocalWorkflow): 'fix' | 'use' | 'edit' {
    const state = this.stateOf(it);
    if (state === 'broken' || state === 'api') return 'edit';
    return state === 'missing' ? 'fix' : 'use';
  }

  actLabel(it: LocalWorkflow): string {
    const act = this.actOf(it);
    if (act === 'edit') return '用编辑器打开';
    return act === 'fix' ? '补齐依赖' : '使用工作流';
  }

  /** 列表里的 ⋯ 也要贴着按钮弹菜单，所以同样要点击坐标 */
  openMoreFromList(it: LocalWorkflow, event: MouseEvent): void {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.onMore({ item: it, x: rect.right, y: rect.bottom });
  }

  /* ---- 卡片上的唯一下一步 ---- */

  onPrimary(ev: { item: LocalWorkflow; act: 'fix' | 'use' | 'edit' }): void {
    if (ev.act === 'fix') {
      this.openDrawer(ev.item);
      return;
    }
    if (ev.act === 'use') {
      this.useWorkflow(ev.item);
      return;
    }
    this.openEditor(ev.item);
  }

  /**
   * 使用工作流：确保实例在跑，打开画布。
   *
   * ComfyUI 0.45 的前端没有「按名字打开某条工作流」的深链（画布是 SPA 根路由，
   * 路由表里只有 / 与登录相关路径），所以这里能自动做的是把环境准备好；
   * 工作流本身已经在 `--user-directory` 指向的共享目录里，画布左侧即可看到。
   */
  useWorkflow(it: LocalWorkflow): void {
    this.notice = '正在准备 ComfyUI 实例…';
    this.api.useLocalWorkflow(it.path).subscribe({
      next: (res) => {
        window.open(res.url, '_blank', 'noopener');
        this.notice = res.instance
          ? `已打开实例 ${res.instance} 的画布；工作流「${it.title || it.name}」在左侧「工作流」里`
          : `已打开画布；工作流「${it.title || it.name}」在左侧「工作流」里`;
      },
      error: (err) => {
        this.notice = '';
        this.localError = errMsg(err, '启动实例失败');
      },
    });
  }

  /**
   * 用编辑器打开。
   *
   * UI 格式进画布（那才是能改节点连线的编辑器）；API 格式与语法错误的文件
   * 画布根本载不进去，只能交给系统默认程序 —— 后者是唯一能真正修复坏 JSON 的路。
   */
  openEditor(it: LocalWorkflow): void {
    this.closeMenu();
    if (it.format === 'ui') {
      this.useWorkflow(it);
      return;
    }
    this.api.openLocalWorkflow(it.path, 'edit').subscribe({
      next: () => (this.notice = `已用默认程序打开「${it.name}」`),
      error: (err) => (this.localError = errMsg(err, '打开文件失败')),
    });
  }

  onMore(ev: { item: LocalWorkflow; x: number; y: number }): void {
    this.menuOf = ev.item;
    // 贴边时往回收，别让菜单跑出视口
    this.menuAt = {
      x: Math.max(8, Math.min(ev.x - 168, window.innerWidth - 184)),
      y: Math.max(8, Math.min(ev.y + 4, window.innerHeight - 214)),
    };
  }

  closeMenu(): void {
    this.menuOf = null;
  }

  /** 缺的模型：跳到模型发现页并带上文件名，那边会自动搜 */
  revealModel(m: WorkflowModelDep): void {
    this.drawerOf = null;
    this.router.navigate(['/models/discover'], { queryParams: { q: m.file } });
  }

  openRename(it: LocalWorkflow): void {
    this.closeMenu();
    this.editing = { item: it, title: it.title || '', group: it.group || '', rename: false };
    setTimeout(() => focusFirst(this.editBox?.nativeElement));
  }

  saveMeta(): void {
    const ed = this.editing;
    if (!ed) return;
    this.api
      .setLocalWorkflowMeta({
        path: ed.item.path,
        title: ed.title.trim(),
        group: ed.group.trim(),
        rename_file: ed.rename,
      })
      .subscribe({
        next: (res) => {
          this.editing = null;
          // 分组已在后端自动落成真实目录，顺带说一句结果，不用再让用户点整理
          const where = res.folder ? ` · 已归入「${res.folder}」` : '';
          this.notice = `${res.file ? `已重命名为「${res.file}」` : '已保存'}${where}`;
          this.loadLocal();
        },
        error: (err) => (this.localError = errMsg(err, '保存失败')),
      });
  }

  askDelete(it: LocalWorkflow): void {
    this.closeMenu();
    this.pendingDelete = it;
    setTimeout(() => focusFirst(this.delBox?.nativeElement));
  }

  /** 打开补齐依赖抽屉。焦点要跟着进去，否则键盘用户还得从页面顶部 Tab 过来 */
  openDrawer(it: LocalWorkflow): void {
    this.drawerOf = it;
    setTimeout(() => focusFirst(this.drawerBox?.nativeElement));
  }

  confirmDelete(): void {
    const it = this.pendingDelete;
    if (!it) return;
    this.api.deleteLocalWorkflow(it.path).subscribe({
      next: () => {
        this.pendingDelete = null;
        this.notice = `已删除「${it.title || it.name}」`;
        this.loadLocal();
      },
      error: (err) => {
        this.pendingDelete = null;
        this.localError = errMsg(err, '删除失败');
      },
    });
  }

  /* ================= 分组管理 ================= */

  /** 显式创建的分组在后端，条目里汇总不出来（可能是空组）。失败不打扰用户。 */
  private loadGroups(): void {
    this.api.listWorkflowGroups().subscribe({
      next: (res) => (this.definedGroups = res.defined || []),
      error: () => undefined,
    });
  }

  /** select 里若还挂着一个已经被删掉的组名，补一个占位选项免得值凭空消失 */
  hasGroup(name: string): boolean {
    return this.groupNames.some((g) => g.name === name);
  }

  openGroupManager(fromEditor = false): void {
    if (!fromEditor) this.closeMenu();
    this.groupMgr = {
      draft: '', renaming: null, renameDraft: '', pendingDelete: null, error: '',
      fromEditor, dirty: false,
    };
    setTimeout(() => focusFirst(this.groupBox?.nativeElement));
  }

  closeGroupManager(): void {
    const mgr = this.groupMgr;
    if (!mgr) return;
    this.groupMgr = null;
    if (!mgr.fromEditor) return;
    // 从「变更分组」叠开来的：关闭后回到原来那条工作流的编辑框，
    // 下拉候选（新建/改名/删除过的组）与选中值都必须是新的。
    this.loadLocal(() => this.syncEditorGroup());
    setTimeout(() => focusFirst(this.editBox?.nativeElement));
  }

  private syncEditorGroup(): void {
    const ed = this.editing;
    if (!ed) return;
    const key = ed.item.key || ed.item.path;
    const fresh = this.local.find((x) => (x.key || x.path) === key || x.path === ed.item.path);
    if (fresh) ed.item = fresh;
    // 组被删了、或组名已经不在清单里，就回落到这条工作流当前的真实分组
    if (ed.group && !this.hasGroup(ed.group)) ed.group = fresh ? this.groupOf(fresh) : '';
  }

  /** 上面还叠着管理框时，点编辑框的遮罩不该把编辑框一起关掉 */
  closeEditor(): void {
    if (this.groupMgr || this.coverMgr) return;
    this.editing = null;
  }

  createGroupFromManager(): void {
    const mgr = this.groupMgr;
    if (!mgr) return;
    const name = mgr.draft.trim();
    if (!name) {
      mgr.error = '先写个分组名';
      return;
    }
    this.api.createWorkflowGroup(name).subscribe({
      next: (res) => {
        this.definedGroups = res.defined || [];
        mgr.draft = '';
        mgr.error = '';
        mgr.dirty = true;
        this.notice = `已新建分组「${name}」`;
      },
      error: (err) => (mgr.error = errMsg(err, '新建分组失败')),
    });
  }

  startRenameGroup(name: string): void {
    if (!this.groupMgr) return;
    this.groupMgr.renaming = name;
    this.groupMgr.renameDraft = name;
    this.groupMgr.pendingDelete = null;
    this.groupMgr.error = '';
  }

  confirmRenameGroup(): void {
    const mgr = this.groupMgr;
    if (!mgr || !mgr.renaming) return;
    const old = mgr.renaming;
    const name = mgr.renameDraft.trim();
    if (!name || name === old) {
      mgr.renaming = null;
      return;
    }
    this.api.renameWorkflowGroup(old, name).subscribe({
      next: () => {
        mgr.renaming = null;
        mgr.error = '';
        mgr.dirty = true;
        this.definedGroups = this.definedGroups.map((n) => (n === old ? name : n));
        if (this.groupFilter === old) this.groupFilter = name;
        // 编辑框可能就开着、且选中的正是这个组：别让它关掉管理框后还挂着旧名字
        if (this.editing) {
          if (this.editing.group === old) this.editing.group = name;
          if ((this.editing.item.group || '') === old) {
            this.editing.item = { ...this.editing.item, group: name };
          }
        }
        this.savePrefs();
        this.notice = `分组「${old}」已改名为「${name}」，目录已同步`;
        this.loadLocal();
      },
      error: (err) => (mgr.error = errMsg(err, '改名失败')),
    });
  }

  startDeleteGroup(name: string): void {
    if (!this.groupMgr) return;
    this.groupMgr.pendingDelete = name;
    this.groupMgr.renaming = null;
    this.groupMgr.error = '';
  }

  confirmDeleteGroup(): void {
    const mgr = this.groupMgr;
    if (!mgr || !mgr.pendingDelete) return;
    const name = mgr.pendingDelete;
    this.api.deleteWorkflowGroup(name).subscribe({
      next: () => {
        mgr.pendingDelete = null;
        mgr.error = '';
        mgr.dirty = true;
        this.definedGroups = this.definedGroups.filter((n) => n !== name);
        if (this.groupFilter === name) this.groupFilter = null;
        if (this.editing && this.editing.group === name) this.editing.group = '';
        this.savePrefs();
        this.notice = `已删除分组「${name}」，文件已回到根目录`;
        this.loadLocal();
      },
      error: (err) => (mgr.error = errMsg(err, '删除分组失败')),
    });
  }

  /* ================= 封面管理 ================= */

  isPinnedKey(key: string): boolean {
    return this.pinnedKeys.includes(key);
  }

  /** 封面管理框里说明「这张图是哪来的」，别让用户猜为什么改不动 */
  openCoverManager(it: LocalWorkflow): void {
    this.closeMenu();
    this.coverMgr = {
      item: it,
      key: it.key || it.path,
      url: it.cover || '',
      customUrl: '',
      failed: false,
      busy: false,
      error: '',
    };
    setTimeout(() => focusFirst(this.coverBox?.nativeElement));
  }

  closeCoverManager(): void {
    this.coverMgr = null;
  }

  /** 抽到 / 自定义成功之后，列表、卡片、弹层预览三处一起换，别只改一处 */
  private applyCover(key: string, url: string): void {
    if (!this.pinnedKeys.includes(key)) this.pinnedKeys = [...this.pinnedKeys, key];
    this.local = this.local.map((x) =>
      (x.key || x.path) === key ? { ...x, cover: url } : x,
    );
    const mgr = this.coverMgr;
    if (mgr) {
      mgr.url = url;
      mgr.failed = false;
      mgr.busy = false;
      mgr.error = '';
      mgr.item = { ...mgr.item, cover: url };
    }
  }

  redealFromManager(): void {
    const mgr = this.coverMgr;
    if (!mgr || mgr.busy) return;
    mgr.busy = true;
    mgr.error = '';
    this.api
      .refreshWorkflowCover({
        key: mgr.key,
        name: mgr.item.title || mgr.item.name,
        model: mgr.item.main_model || '',
        current: mgr.url,
      })
      .subscribe({
        next: (res) => {
          if (this.coverMgr !== mgr) return;
          mgr.busy = false;
          if (!res.cover) {
            mgr.error = '没找到别的可用封面，先保留原图';
            return;
          }
          this.applyCover(mgr.key, res.cover);
          this.notice = '已换一张封面，这条会被钉住';
        },
        error: (err) => {
          if (this.coverMgr !== mgr) return;
          mgr.busy = false;
          mgr.error = errMsg(err, '换封面失败');
        },
      });
  }

  applyCustomUrl(): void {
    const mgr = this.coverMgr;
    if (!mgr || mgr.busy) return;
    const url = mgr.customUrl.trim();
    if (!url) {
      mgr.error = '先粘贴一张图片的地址';
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      mgr.error = '图片地址要以 http:// 或 https:// 开头';
      return;
    }
    this.saveCustomCover({ key: mgr.key, url }, mgr);
  }

  onCoverFile(event: Event): void {
    const mgr = this.coverMgr;
    if (!mgr || mgr.busy) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      mgr.error = '图片超过 8MB，请压缩后再传';
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (this.coverMgr !== mgr) return;
      this.saveCustomCover({ key: mgr.key, data: String(reader.result || '') }, mgr);
    };
    reader.onerror = () => {
      if (this.coverMgr !== mgr) return;
      mgr.error = '读文件失败，请换一张试试';
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  private saveCustomCover(
    body: { key: string; url?: string; data?: string },
    mgr: CoverManager,
  ): void {
    mgr.busy = true;
    mgr.error = '';
    this.api.customWorkflowCover(body).subscribe({
      next: (res) => {
        if (this.coverMgr !== mgr) return;
        this.applyCover(mgr.key, res.cover);
        mgr.customUrl = '';
        this.notice = '已设为自定义封面';
      },
      error: (err) => {
        if (this.coverMgr !== mgr) return;
        mgr.busy = false;
        mgr.error = errMsg(err, '设置自定义封面失败');
      },
    });
  }

  resetFromManager(): void {
    const mgr = this.coverMgr;
    if (!mgr || mgr.busy) return;
    mgr.busy = true;
    mgr.error = '';
    this.api.resetWorkflowCover(mgr.key).subscribe({
      next: () => {
        this.pinnedKeys = this.pinnedKeys.filter((k) => k !== mgr.key);
        this.coverMgr = null;
        this.notice = '已恢复自动封面';
        this.loadLocal();
      },
      error: (err) => {
        if (this.coverMgr !== mgr) return;
        mgr.busy = false;
        mgr.error = errMsg(err, '恢复自动封面失败');
      },
    });
  }

  /** Esc 逐层退出：菜单 → 封面管理 / 分组管理 → 编辑 → 删除 → 整理 → 抽屉 */
  onEsc(): void {
    if (this.sortMenu) {
      this.sortMenu = false;
      return;
    }
    if (this.menuOf) {
      this.closeMenu();
      return;
    }
    if (this.coverMgr) {
      this.closeCoverManager();
      return;
    }
    if (this.groupMgr) {
      this.closeGroupManager();
      return;
    }
    if (this.editing) {
      this.editing = null;
      return;
    }
    if (this.pendingDelete) {
      this.pendingDelete = null;
      return;
    }
    if (this.drawerOf) this.closeDrawer();
  }

  /* ---- 偏好持久化：视图 / 排序 / 筛选 ---- */

  private readonly prefsKey = 'md.wf.prefs';

  private restorePrefs(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(this.prefsKey) || '{}');
      if (raw.view === 'card' || raw.view === 'list') this.view = raw.view;
      if (['mtime', 'nodes', 'name'].includes(raw.sortKey)) this.sortKey = raw.sortKey;
      if (['all', 'missing', 'ready', 'broken'].includes(raw.statusFilter)) {
        this.statusFilter = raw.statusFilter;
      }
      if (raw.groupFilter === null || typeof raw.groupFilter === 'string') {
        this.groupFilter = raw.groupFilter;
      }
    } catch {
      // 坏数据就用默认值，别让整个页面起不来
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(
        this.prefsKey,
        JSON.stringify({
          view: this.view,
          sortKey: this.sortKey,
          statusFilter: this.statusFilter,
          groupFilter: this.groupFilter,
        }),
      );
    } catch {
      // 隐私模式下写不进去，忽略
    }
  }

  /** 装一个节点包：走后端已有的安装通道 */
  installPkg(pkg: WorkflowNodeDep): void {
    if (!pkg.installable) {
      this.notice = `「${pkg.name}」不支持一键安装，需要手动处理`;
      return;
    }
    this.busy = pkg.id;
    this.api.installNode(pkg.id).subscribe({
      next: () => {
        this.busy = '';
        this.notice = `「${pkg.name}」安装任务已开始，装完刷新即可`;
      },
      error: (err) => {
        this.busy = '';
        this.localError = err?.error?.detail || '节点包安装失败';
      },
    });
  }

  /** 一键补齐：只装节点包。模型要走下载任务，不在这里假装装好 */
  installAll(it: LocalWorkflow): void {
    const pkgs = this.drawerPkgs.filter((p) => p.installable);
    if (!pkgs.length) {
      this.notice = '没有可一键安装的节点包';
      return;
    }
    this.busy = pkgs[0].id;
    let done = 0;
    pkgs.forEach((pkg) => {
      this.api.installNode(pkg.id).subscribe({
        next: () => {
          done += 1;
          if (done === pkgs.length) {
            this.busy = '';
            this.notice = `${pkgs.length} 个节点包已开始安装；模型仍需去模型库补齐`;
          }
        },
        error: () => {
          done += 1;
          if (done === pkgs.length) this.busy = '';
        },
      });
    });
  }

  closeDrawer(): void {
    this.drawerOf = null;
  }

  /** 抽屉里的缺失模型 / 节点包，供模板遍历 */
  get drawerModels(): WorkflowModelDep[] {
    return this.drawerOf?.deps?.missing || [];
  }

  get drawerPkgs(): WorkflowNodeDep[] {
    return this.drawerOf?.node_deps?.missing || [];
  }

  get drawerUnknown(): string[] {
    return this.drawerOf?.node_deps?.unknown || [];
  }

  /* ================= 数据加载 ================= */

  loadLocal(after?: () => void): void {
    this.localLoading = true;
    this.localError = '';
    this.api.localWorkflows().subscribe({
      next: (res) => {
        this.local = res.items;
        this.localDir = res.dir;
        this.localLoading = false;
        this.reconcileGroup();
        this.loadGroups();
        this.loadCovers();
        after?.();
      },
      error: (err) => {
        this.localLoading = false;
        this.localError = errMsg(err, '读取本地工作流失败');
      },
    });
  }

  /**
   * 批量取封面：自带出图的条目也传（标 has_local），后端只在手动钉过时覆盖它。
   *
   * 单独一批请求、失败也不报错：封面是锦上添花，取不到就用家族铭牌兜底，
   * 不该因为它把整个列表变成错误态。后端按 key 缓存 7 天，第二次进页面是毫秒级。
   */
  private loadCovers(): void {
    const need = this.local.filter((it) => it.format !== 'broken');
    if (!need.length) return;
    this.api
      .workflowCovers(
        need.map((it) => ({
          key: it.key || it.path,
          name: it.title || it.name,
          model: it.main_model || '',
          has_local: !!it.cover,
        })),
      )
      .subscribe({
        next: (res) => {
          this.pinnedKeys = res.pinned || [];
          if (!Object.keys(res.covers || {}).length) return;
          this.local = this.local.map((it) => {
            const url = res.covers[it.key || it.path];
            return url && url !== it.cover ? { ...it, cover: url } : it;
          });
        },
        error: () => undefined,
      });
  }

  reveal(item: LocalWorkflow): void {
    this.api.openLocalWorkflow(item.path).subscribe({
      error: (err) => (this.localError = errMsg(err, '打开文件位置失败')),
    });
  }

  /** 列表里的时间读「多久以前」比读绝对时间有用：它回答的是「这条是不是刚动的」 */
  ago(seconds: number): string {
    const diff = Math.floor(Date.now() / 1000) - seconds;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  fmtSize = fmtSize;

  search(): void {
    this.load(1);
  }

  setSource(source: string): void {
    this.source = source;
    this.load(1);
  }

  setSort(sort: string): void {
    this.sort = sort;
    this.load(1);
  }

  loadMore(): void {
    this.load(this.page + 1);
  }

  private load(page: number): void {
    // 「全部来源」要并发等 6 个源，比只查一个源慢得多；刚点完 ComfyHub 再收到
    // 旧的 all 响应，会把 46 条混合结果盖回「ComfyHub」这个选中的 chip 上。
    const seq = ++this.reqSeq;
    this.loading = true;
    this.errorText = '';
    this.notice = '';
    this.api
      .searchWorkflows({ q: this.q.trim(), source: this.source, sort: this.sort, limit: PAGE_SIZE, page })
      .subscribe({
        next: (res) => {
          if (seq !== this.reqSeq) return;
          const existing = new Set(this.items.map((i) => `${i.source}/${i.id}`));
          const incoming =
            page === 1 ? res.items : res.items.filter((i) => !existing.has(`${i.source}/${i.id}`));
          this.items = page === 1 ? res.items : [...this.items, ...incoming];
          this.sourceErrors = Object.entries(res.errors || {}).map(([key, message]) => ({
            label: SOURCE_LABELS[key] || key,
            message,
          }));
          this.done = res.done || (page > 1 && incoming.length === 0);
          this.page = page;
          this.loading = false;
        },
        error: (err) => {
          if (seq !== this.reqSeq) return;
          this.loading = false;
          this.errorText = errMsg(err, '工作流检索失败，请检查网络');
        },
      });
  }

  download(item: WorkflowItem): void {
    this.busy = this.keyOf(item);
    this.notice = '';
    this.errorText = '';
    this.api
      .resolveWorkflow(item.source, item.id)
      .pipe(
        switchMap((repo) =>
          this.api
            .createTask({
              source: item.source,
              repo_id: repo.repo_id,
              revision: repo.revision || '',
              files: repo.files.map((f) => f.path),
              strategy: '',
              target_folder: 'workflows',
              task: 'Workflows',
            })
            .pipe(map(() => repo)),
        ),
      )
      .subscribe({
        next: (repo) => {
          this.busy = '';
          this.notice = `已创建下载任务：${repo.files.length} 个工作流文件 → 工作流库（压缩包会自动解开）`;
        },
        error: (err) => {
          this.busy = '';
          this.errorText = errMsg(err, '工作流下载失败');
        },
      });
  }

  keyOf(item: WorkflowItem): string {
    return `${item.source}/${item.id}`;
  }

  /**
   * 传给铭牌的最小字段集。有缩略图就铺图，没有就按名字生成构图——
   * 旧版这里是一个 🧩 emoji，一屏十几个一样的方块，完全无法区分。
   */
  plateOf(item: WorkflowItem) {
    return { name: item.name, tags: item.tags, image: item.thumbnail };
  }

  previewFiles(item: WorkflowItem): string {
    const shown = item.files.slice(0, 2).join(' · ');
    return item.file_count > 2 ? `${shown} … 共 ${item.file_count} 个` : shown;
  }

  labelOf(source: string): string {
    return SOURCE_LABELS[source] || source;
  }

  toneOf(source: string): 'blue' | 'green' | 'orange' | 'gray' {
    return SOURCE_TONES[source] || 'gray';
  }

  fmtNum = fmtNum;
}
