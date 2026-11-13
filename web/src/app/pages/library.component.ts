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
      hint="问自己三个问题：这个模型还在用吗（收藏）、试过没有（评审）、属于什么（标签）。"
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
        <ui-field label="评审状态">
          <select [(ngModel)]="filterReview">
            <option value="">全部</option>
            <option value="untried">未试用</option>
            <option value="keep">保留</option>
            <option value="discard">弃用</option>
          </select>
        </ui-field>
        <ui-field label="收藏">
          <div class="check-row">
            <input type="checkbox" [(ngModel)]="filterFavorite">
            <span>只看收藏</span>
          </div>
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
        <span>收藏</span>
        <strong>{{ favCount }}</strong>
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
                <th class="col-check"></th>
                <th>模型</th>
                <th class="col-source">来源</th>
                <th class="col-size">大小</th>
                <th class="col-count">文件</th>
                <th>标签</th>
                <th class="col-review">评审</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (m of models; track m.id) {
                <tr>
                  <td>
                    <button class="favorite-btn" (click)="toggleFavorite(m)" title="收藏">
                      {{ isFav(m) ? '★' : '☆' }}
                    </button>
                  </td>
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
                  <td>
                    <select [ngModel]="m.review_state" (ngModelChange)="setReview(m, $event)">
                      <option value="untried">未试用</option>
                      <option value="keep">保留</option>
                      <option value="discard">弃用</option>
                    </select>
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
        color: var(--faint);
      }
      .stat strong {
        font: 620 15px/1.1 "Cascadia Mono", Consolas, monospace;
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
  filterReview = '';
  filterFavorite = false;
  scanPath = '';
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
    this.load();
  }

  get totalSize(): number {
    return this.models.reduce((sum, m) => sum + (m.size_bytes || 0), 0);
  }

  get favCount(): number {
    return this.models.filter((m) => this.isFav(m)).length;
  }

  load(): void {
    this.loading = true;
    this.api
      .listLibrary({ q: this.q, source: this.filterSource, review: this.filterReview, favorite: this.filterFavorite })
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
    this.filterReview = '';
    this.filterFavorite = false;
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

  isFav(m: LibraryModel): boolean {
    return !!m.favorite;
  }

  toggleFavorite(m: LibraryModel): void {
    this.api.patchLibrary(m.id, { favorite: !this.isFav(m) }).subscribe(() => this.load());
  }

  setReview(m: LibraryModel, value: string): void {
    this.api.patchLibrary(m.id, { review_state: value }).subscribe(() => this.load());
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
