import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of, timeout } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SearchItem, errMsg, fmtNum } from '../core/types';
import { BadgeTone, BadgeComponent } from '../ui/badge.component';
import { EmptyComponent } from '../ui/empty.component';
import { PageHeaderComponent } from '../ui/page-header.component';
import { PanelComponent } from '../ui/panel.component';

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [CommonModule, FormsModule, BadgeComponent, EmptyComponent, PageHeaderComponent, PanelComponent],
  template: `
    <ui-page-header title="模型发现" hint="跨源搜索 Hugging Face / ModelScope / Civitai，选中后直接去下载。" />

    <ui-panel>
      <div class="toolbar mb">
        <input
          class="grow"
          [(ngModel)]="q"
          placeholder="搜索模型关键词，如 qwen / lora / flux"
          (keyup.enter)="search()"
          data-testid="search-input"
        />
        <button class="primary" (click)="search()" [disabled]="loading" data-testid="search-btn">
          {{ loading ? '搜索中…' : '搜索' }}
        </button>
      </div>

      <div class="toolbar">
        <div class="segmented">
          @for (t of sourceTabs; track t.key) {
            <button [class.active]="source === t.key" (click)="setSource(t.key)">{{ t.label }}</button>
          }
        </div>
        <span class="grow"></span>
        <select class="w-160" [(ngModel)]="sort" (ngModelChange)="search()">
          <option value="downloads">按下载量</option>
          <option value="likes">按点赞</option>
          <option value="recent">最新更新</option>
        </select>
      </div>

      @if (error) {
        <div class="notice err">{{ error }}</div>
      }
    </ui-panel>

    @if (loading && items.length === 0) {
      <ui-panel>
        <ui-empty icon="🔍" title="正在搜索模型…" />
      </ui-panel>
    }
    @if (!loading && items.length === 0 && searched) {
      <ui-panel>
        <ui-empty icon="📭" title="没有找到匹配的模型" hint="试试其他关键词或切换下载源。" />
      </ui-panel>
    }

    <div class="grid">
      @for (item of items; track item.source + '/' + item.id) {
        <div class="model-card">
          <div class="toolbar">
            <ui-badge [tone]="sourceTone(item.source)">{{ item.source }}</ui-badge>
            @if (item.task) {
              <ui-badge tone="gray">{{ item.task }}</ui-badge>
            }
            <span class="grow"></span>
            <a class="mc-link" [href]="item.url" target="_blank" rel="noreferrer">原始页面 ↗</a>
          </div>
          <div class="mc-title" [title]="item.id">{{ item.name }}</div>
          <div class="muted mc-author">{{ item.author }}</div>
          @if (item.description) {
            <p class="mc-desc">{{ item.description }}</p>
          }
          <div class="mc-stats">
            <span>⬇ {{ fmtNum(item.downloads) }}</span>
            <span>♥ {{ fmtNum(item.likes) }}</span>
          </div>
          @if (item.tags.length) {
            <div>
              @for (tag of item.tags.slice(0, 4); track tag) {
                <span class="chip">{{ tag }}</span>
              }
            </div>
          }
          <div class="actions">
            <button class="primary" (click)="goDownload(item)" data-testid="card-download">下载</button>
          </div>
        </div>
      }
    </div>

    @if (items.length > 0) {
      <div class="mc-more">
        <button (click)="loadMore()" [disabled]="loading">{{ loading ? '加载中…' : '加载更多' }}</button>
      </div>
    }
  `,
})
export class DiscoverComponent implements OnInit {
  q = '';
  source = 'all';
  sort = 'downloads';
  items: SearchItem[] = [];
  page = 1;
  loading = false;
  searched = false;
  error = '';
  showDemo = false;

  sourceTabs: { key: string; label: string }[] = [];

  private shortLabel: Record<string, string> = {
    huggingface: 'Hugging Face',
    modelscope: 'ModelScope',
    civitai: 'Civitai',
    demo: 'Demo',
  };

  constructor(private api: ApiService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.showDemo = this.route.snapshot.queryParamMap.get('demo') === '1';
    this.api.getSettings().subscribe((s) => {
      const tabs = Object.keys(s.sources || {})
        .filter((k) => k !== 'demo' || this.showDemo)
        .map((k) => ({ key: k, label: this.shortLabel[k] || s.sources[k].label || k }));
      this.sourceTabs = [{ key: 'all', label: '全部' }, ...tabs];
    });
    this.search();
  }

  setSource(key: string): void {
    this.source = key;
    this.search();
  }

  search(): void {
    this.page = 1;
    this.items = [];
    this.fetch();
  }

  loadMore(): void {
    this.page += 1;
    this.fetch(true);
  }

  private fetch(append = false): void {
    this.loading = true;
    this.error = '';
    this.api
      .search({ q: this.q, source: this.source, sort: this.sort, limit: 12, page: this.page })
      .pipe(
        timeout(30000),
        catchError((err) => {
          this.error = errMsg(err, '搜索超时，请检查网络后重试');
          this.loading = false;
          this.searched = true;
          return of(null);
        }),
      )
      .subscribe({
        next: (res) => {
          if (!res) return;
          const merged = append ? [...this.items, ...res.items] : res.items;
          const seen = new Set<string>();
          this.items = merged.filter((i) => {
            const key = `${i.source}/${i.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          this.loading = false;
          this.searched = true;
          const errs = Object.values(res.errors || {});
          if (errs.length && this.items.length === 0) {
            this.error = errs.join('; ');
          }
        },
        error: (err) => {
          this.error = errMsg(err, '搜索失败，请检查网络');
          this.loading = false;
          this.searched = true;
        },
      });
  }

  goDownload(item: SearchItem): void {
    this.router.navigate(['/downloads'], {
      queryParams: { source: item.source, repo_id: item.id },
    });
  }

  sourceTone(source: string): BadgeTone {
    if (source === 'huggingface') return 'blue';
    if (source === 'modelscope') return 'green';
    if (source === 'civitai') return 'orange';
    return 'gray';
  }

  fmtNum = fmtNum;
}
