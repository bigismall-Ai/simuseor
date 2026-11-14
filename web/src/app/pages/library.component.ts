import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LibraryModel, errMsg, fmtNum, fmtSize } from '../core/types';
import { CoverPlateComponent } from '../ui/cover-plate.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

/** 来源显示名。`imported` 是本地扫描入库，不在 settings.sources 里 */
const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  demo: 'Demo',
  imported: '本地导入',
  templates: '官方模板',
};

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CoverPlateComponent,
    EmptyComponent,
    FieldComponent,
    PageHeaderComponent,
    PanelComponent,
  ],
  template: `
    <ui-page-header
      kicker="Models"
      title="模型库"
      hint="本地已下载的模型。按存放类型或任务类型筛选，也可以搜名称与标签。"
    />

    <ui-panel>
      <div class="form-grid">
        <ui-field label="搜索（名称 / repo / 标签）">
          <input [(ngModel)]="q" placeholder="关键词" (keyup.enter)="load()">
        </ui-field>
        <ui-field label="来源">
          <select [(ngModel)]="filterSource">
            @for (o of sourceOptions; track o.key) {
              <option [value]="o.key">{{ o.label }}</option>
            }
          </select>
        </ui-field>
      </div>

      <div class="toolbar mt">
        <button class="primary" (click)="load()">查询</button>
        <button (click)="reset()">重置</button>
        <span class="grow"></span>
        <input class="grow w-320" [(ngModel)]="scanPath" placeholder="导入目录（每个子文件夹=一个模型）">
        <button (click)="scan()">扫描入库</button>
      </div>

      @if (message) {
        <div class="notice" [ngClass]="messageOk ? 'ok' : 'err'">{{ message }}</div>
      }
    </ui-panel>

    <!-- 三个数字回答「库有多大、占多少盘」。放在列表上方，翻页前先看一眼 -->
    <div class="stat-strip">
      <div class="stat">
        <span>模型数</span>
        <strong>{{ models.length }}</strong>
      </div>
      <div class="stat">
        <span>占用空间</span>
        <strong>{{ fmtSize(totalSize) }}</strong>
      </div>
      <div class="stat">
        <span>本机显存</span>
        <strong>{{ gpuText }}</strong>
      </div>
    </div>

    <ui-panel title="模型列表" [hint]="loading ? '加载中…' : models.length + ' 个模型'">
      @if (!loading && models.length === 0) {
        <ui-empty
          title="库里还没有模型"
          hint="下载完成后会自动出现在这里，或用上面的「扫描入库」导入已有目录。"
        />
      }

      @if (models.length > 0) {
        <div class="table-wrap lib-table">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th class="col-source">来源</th>
                <th>类型</th>
                <th class="col-size">大小</th>
                <th class="col-count">文件</th>
                <th>标签</th>
                <th class="col-vram">本机可跑</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (m of models; track m.id) {
                <tr>
                  <td>
                    <div class="name-cell">
                      <app-cover-plate class="thumb" size="mini" [model]="m" />
                      <div class="name-text">
                        <div class="cell-name">{{ m.name }}</div>
                        <div class="mono muted cell-path">{{ m.local_path }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <!-- 来源显示中文名，不显示 huggingface / imported 这类内部 key -->
                    <span class="pill">{{ sourceLabel(m.source) }}</span>
                  </td>
                  <td>
                    @if (m.taskLabel) {
                      <span class="pill">{{ m.taskLabel }}</span>
                    }
                  </td>
                  <td class="mono">{{ fmtSize(m.size_bytes) }}</td>
                  <td class="mono muted">{{ m.file_count }}</td>
                  <td class="cell-tags">
                    <!-- 标签用胶囊展示，跟卡片上的分类标签同一套规格；
                         点一下才展开输入框 —— 表格里常年摆一个输入框，
                         看着像没做完的表单，而且抢了模型名的注意力。 -->
                    @if (editingTagId === m.id) {
                      <input
                        class="tag-edit"
                        [value]="tagsText(m)"
                        (blur)="saveTags(m, $event)"
                        (keydown.enter)="saveTags(m, $event)"
                        placeholder="逗号分隔"
                        data-testid="tag-edit"
                      />
                    } @else {
                      <button
                        type="button"
                        class="tag-chips"
                        (click)="editTags(m)"
                        [title]="m.tags.length ? '编辑标签' : '添加标签'"
                        data-testid="tag-edit-open"
                      >
                        @if (m.tags.length) {
                          @for (t of m.tags; track t) {
                            <span class="pill">{{ t }}</span>
                          }
                        } @else {
                          <span class="pill pill-count">＋ 标签</span>
                        }
                      </button>
                    }
                  </td>
                  <td class="cell-vram">
                    @if (vramPct(m) !== null) {
                      <span class="vram-gauge" [style.--fill]="vramFill(m) + '%'"
                            [title]="vramTip(m)"></span>
                    }
                  </td>
                  <td>
                    <div class="toolbar">
                      <button class="btn-xs" (click)="open(m)">打开目录</button>
                      <button class="btn-xs danger" (click)="remove(m)">删除</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </ui-panel>
  `,
  styles: [
    `
      /* 权重压力标志：三等分 + 百分比
         绿 1~2 格（≤67%）· 黄 3 格满（67%~100%）· 红 3 格满+溢出（>100%）
         三等分而不是五等分：模型权重是重资产，真实分布是「要么几乎不占
         （VAE/Embedding 占 0%），要么占一大半」—— 五等分会把大批 0% 全挤在第一格。 */
      .col-vram { width: 74px; }
      /* 垂直居中 —— 标志是上下两层，不居中的话会比同行其它单元格高一截 */
      .cell-vram { white-space: nowrap; vertical-align: middle; }
      /* 上下结构：格子在上、百分比在下，外面套一块**与压力同色**的底。
         底衬不透明 —— 半透明底压在封面上会跟背景图混，颜色就不纯了。
         纯红 #FF0000 只用在「满格」这个图形上（图形对比度门槛 3:1），
         底衬用同色系浅红 —— 纯红铺满一屏几十张卡会变成警告墙。 */
      /* 填充式渐变条：灰底 + 按 --fill 裁切的绿→黄→红渐变。
         渐变铺满整条再用 clip-path 裁出左侧填充段 ——
         用 background-size 压缩会把整条渐变塞进那一小段（错）。
         **不给数字** —— needGb = weightGb × factor 是经验系数，
         实际占用因 offload / attention 实现 / 量化方式而差很多。 */
      /* 填充式渐变条 + 斜纹质感（跟权重缺失的斜纹是同一套语言）。
         纯色填充太「平」，斜纹才跟卡片整体质感一致。 */
      .vram-gauge {
        position: relative;
        display: block;
        width: 62px;
        height: 9px;
        background: var(--border-strong);
      }
      .vram-gauge::before {
        content: '';
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(-45deg,
            rgb(255 255 255 / 0.22) 0 3px, transparent 3px 7px),
          linear-gradient(to right,
            #15803d 0%, #15803d 26%,
            #b45309 56%, #b45309 74%,
            #ff0000 100%);
        clip-path: inset(0 calc(100% - var(--fill)) 0 0);
      }

      .stat-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 14px;
      }
      .stat {
        flex: 1 1 150px;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 13px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
      }
      .stat span {
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .stat strong {
        font: 600 15px/1.1 "Cascadia Mono", Consolas, monospace;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }

      /* 名字前放一枚 40×30 的家族指纹：一屏几十行时，颜色比读文字更快认出「这批都是 SDXL」 */
      .name-cell {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .thumb { flex: none; }
      .name-text { min-width: 0; }

      .lib-table th:first-child,
      .lib-table td:first-child { padding-left: 4px; }
      .lib-table td { padding-top: 8px; padding-bottom: 8px; }

      /* 标签列：平时是胶囊组，点一下换成输入框。
         整组包在一个 button 里是为了让「空标签」也有可点的地方 ——
         否则没标签的模型在这一列完全没入口。 */
      .cell-tags { min-width: 120px; }
      .tag-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
        text-align: left;
        max-width: 100%;
      }
      .tag-chips:hover .pill { background: var(--pill-bg-hover); color: var(--pill-ink-hover); }
      .tag-edit {
        width: 100%;
        min-width: 120px;
        height: 24px;
        padding: 0 8px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--input-bg);
        color: var(--text);
        font: inherit;
        font-size: 12px;
      }
    `,
  ],
})
export class LibraryComponent implements OnInit {
  models: LibraryModel[] = [];
  q = '';
  filterSource = '';
  scanPath = '';
  /** 本机独显信息 —— 权重压力标志的分母 */
  gpu: { vramMb?: number; name?: string } | null = null;
  message = '';
  messageOk = true;
  loading = false;
  sourceOptions: { key: string; label: string }[] = [];
  showDemo = false;

  private shortLabel: Record<string, string> = {
    huggingface: 'Hugging Face',
    modelscope: 'ModelScope',
    civitai: 'Civitai',
    demo: 'Demo',
  };

  /**
   * 来源显示名。
   *
   * 除了四个已知来源，还有 `imported`（本地扫描入库）这一路，
   * 之前表格里直接显示 `imported` 这个内部 key —— 看着像没做完的。
   */
  sourceLabel(source: string): string {
    return this.shortLabel[source] || SOURCE_LABELS[source] || source;
  }

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.showDemo = this.route.snapshot.queryParamMap.get('demo') === '1';
    this.api.getSettings().subscribe((s) => {
      this.sourceOptions = [
        { key: '', label: '全部' },
        ...Object.keys(s.sources || {})
          .filter((k) => k !== 'demo' || this.showDemo)
          .map((k) => ({ key: k, label: this.shortLabel[k] || s.sources[k].label || k })),
        { key: 'imported', label: '导入' },
      ];
    });
    this.api.libraryGpu().subscribe({
      next: (g) => (this.gpu = g),
      error: () => (this.gpu = null),
    });
    this.load();
  }

  get totalSize(): number {
    return this.models.reduce((sum, m) => sum + (m.size_bytes || 0), 0);
  }

  /** 本机独显显存 —— 权重压力标志的分母就是它 */
  get gpuText(): string {
    return this.gpuVramGb > 0 ? `${this.gpuVramGb.toFixed(0)} GB` : '未检测到';
  }

  get gpuVramGb(): number {
    const mb = (this.gpu as { vramMb?: number } | null)?.vramMb ?? 0;
    return mb / 1024;
  }

  load(): void {
    this.loading = true;
    this.api
      .listLibrary({ q: this.q, source: this.filterSource })
      .subscribe({
        next: (models) => {
          this.models = models;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  reset(): void {
    this.q = '';
    this.filterSource = '';
    this.load();
  }

  scan(): void {
    if (!this.scanPath) return;
    this.api.scanLibrary(this.scanPath).subscribe({
      next: (res) => {
        this.message = `扫描完成，新增 ${res.created} 个模型`;
        this.messageOk = true;
        this.load();
      },
      error: (err) => {
        this.message = errMsg(err, '扫描失败');
        this.messageOk = false;
      },
    });
  }

  /** 权重压力标志：占本机显存的百分比（无权重则 null） */
  vramPct(m: LibraryModel): number | null {
    if (!m.hasWeights || m.isDemo) return null;
    const need = m.needGb ?? 0;
    const gb = this.gpuVramGb;
    if (!gb || need <= 0) return null;
    return Math.round((need / gb) * 100);
  }

  /** 填充百分比（0~100）。超过 100% 就填满 —— 条子表达不了更多。 */
  vramFill(m: LibraryModel): number {
    const pct = this.vramPct(m);
    if (pct === null) return 0;
    return Math.max(0, Math.min(pct, 100));
  }

  vramTip(m: LibraryModel): string {
    const pct = this.vramPct(m);
    const need = m.needGb ?? 0;
    if (pct === null) return m.vram?.hint || '没有权重信息';
    return `预计需要 ${need} GB · 本机 ${this.gpuVramGb.toFixed(0)} GB（${pct}%）`;
  }

  tagsText(m: LibraryModel): string {
    return (m.tags || []).join(', ');
  }

  /** 正在编辑标签的模型 id（同一时刻只开一个，避免表格里一堆输入框） */
  editingTagId = '';

  editTags(m: LibraryModel): void {
    this.editingTagId = m.id;
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('[data-testid="tag-edit"]');
      el?.focus();
      el?.select();
    });
  }

  saveTags(m: LibraryModel, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const tags = raw
      .split(/[，,]/)
      .map((t) => t.trim())
      .filter((t) => !!t);
    this.editingTagId = '';
    this.api.patchLibrary(m.id, { tags }).subscribe(() => this.load());
  }

  open(m: LibraryModel): void {
    this.api.openLibrary(m.id).subscribe({
      next: () => {},
      error: (err) => {
        this.message = errMsg(err, '打开失败');
        this.messageOk = false;
      },
    });
  }

  remove(m: LibraryModel): void {
    if (!confirm(`从模型库删除「${m.name}」记录？（不会删除磁盘文件）`)) return;
    this.api.deleteLibrary(m.id).subscribe(() => this.load());
  }

  fmtSize = fmtSize;
  fmtNum = fmtNum;
}
