import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LibraryModel, errMsg, fmtNum, fmtSize } from '../core/types';
import { BadgeComponent } from '../ui/badge.component';
import { CoverPlateComponent } from '../ui/cover-plate.component';
import { EmptyComponent } from '../ui/empty.component';
import { FieldComponent } from '../ui/field.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BadgeComponent,
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
                  <td><ui-badge tone="blue">{{ m.source }}</ui-badge></td>
                  <td class="mono">{{ fmtSize(m.size_bytes) }}</td>
                  <td class="mono muted">{{ m.file_count }}</td>
                  <td class="cell-tags">
                    <input [value]="tagsText(m)" (blur)="saveTags(m, $event)" placeholder="逗号分隔">
                  </td>
                  <td class="cell-vram">
                    <span class="vram-flag" [class]="vramClass(m)" [title]="vramTip(m)">
                      @for (k of [1, 2, 3]; track k) {
                        <i [class.on]="k <= vramFilled(m)"></i>
                      }
                      @if (vramPct(m) !== null) {
                        <em>{{ vramPct(m) }}%</em>
                      }
                    </span>
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
      .col-vram { width: 92px; }
      .cell-vram { white-space: nowrap; }
      .vram-flag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      /* 未填充的槽 = 透明 + 细描边（不是灰底）——
         灰底填充看起来像「满格」，就分不出 1 格和 3 格了。
         「上色」由模板直接给前 N 格加 .on 类 —— 不用 nth-child，
         那依赖元素在父节点里的位置，模板里插个 <em> 就全错位（实测踩到）。 */
      .vram-flag i {
        width: 5px;
        height: 9px;
        border-radius: 1.5px;
        display: block;
        background: transparent;
        box-shadow: inset 0 0 0 1px var(--border-strong);
      }
      .vram-flag i.on {
        box-shadow: none;
        background: currentColor;
      }
      .vram-flag em {
        font-style: normal;
        font-size: 10.5px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--text-2);
      }
      /* 溢出尾：>100% 时第三格后面多一个三角 */
      .v-err i.on:nth-child(3) { position: relative; }
      .v-err i.on:nth-child(3)::after {
        content: '';
        position: absolute;
        left: 6px;
        top: 1px;
        width: 0;
        height: 0;
        border-left: 4px solid var(--err);
        border-top: 3.5px solid transparent;
        border-bottom: 3.5px solid transparent;
      }
      .v-ok { color: var(--ok); }
      .v-warn { color: var(--warn); }
      .v-err { color: var(--err); }
      /* 无法判定：空心描边 —— 实心=有结论，空心=没结论 */
      .v-na i {
        background: transparent;
        box-shadow: inset 0 0 0 1px var(--border-strong);
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

  /** 填几格：绿 1~2 格 / 黄 3 格满 / 红 3 格满 + 溢出 */
  vramFilled(m: LibraryModel): number {
    const pct = this.vramPct(m);
    if (pct === null) return 0;
    if (pct > 100) return 3;
    if (pct > 67) return 3;
    return pct > 33 ? 2 : 1;
  }

  /** 三等分：绿 1~2 格 / 黄 3 格满 / 红 3 格满 + 溢出 */
  vramClass(m: LibraryModel): string {
    const pct = this.vramPct(m);
    if (pct === null) return 'v-na';
    if (pct > 100) return 'v-err';
    if (pct > 67) return 'v-warn';
    return 'v-ok';
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

  saveTags(m: LibraryModel, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const tags = raw
      .split(/[，,]/)
      .map((t) => t.trim())
      .filter((t) => !!t);
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
