import { Component, Input, output } from '@angular/core';
import { SearchItem, fmtNum } from '../core/types';
import { BadgeComponent } from './badge.component';

const SOURCE_TONES: Record<string, 'blue' | 'green' | 'orange' | 'gray'> = {
  huggingface: 'blue',
  modelscope: 'green',
  civitai: 'orange',
};

const TASK_LABELS: Record<string, string> = {
  'text-generation': '文生文',
  'text-to-image': '文生图',
  'text-to-video': '文生视频',
  'image-classification': '图像分类',
  'automatic-speech-recognition': '语音识别',
  'feature-extraction': '文本向量',
  'text-classification': '文本分类',
  translation: '翻译',
  summarization: '摘要',
  Checkpoint: 'Checkpoint',
  LORA: 'LoRA',
  TextualInversion: '文本反转',
  Controlnet: 'ControlNet',
  Upscaler: '放大模型',
};

/** 一个卡片代表同一个模型在多个来源的条目（items 至少 1 项） */
@Component({
  selector: 'md-model-card',
  standalone: true,
  imports: [BadgeComponent],
  template: `
    <div class="model-card">
      <div class="toolbar">
        @for (it of items; track it.source + '/' + it.id) {
          <a
            class="src-link"
            [href]="it.url"
            target="_blank"
            rel="noreferrer"
            [title]="'打开 ' + it.source + ' 的原始页面'"
          >
            <ui-badge [tone]="toneOf(it.source)">{{ it.source }} ↗</ui-badge>
          </a>
        }
        @if (primary && primary.task) {
          <ui-badge tone="gray">{{ taskLabel(primary.task) }}</ui-badge>
        }
        @if (inLibrary) {
          <ui-badge tone="green">已在库</ui-badge>
        }
        <span class="grow"></span>
      </div>
      <div class="mc-title" [title]="primary?.id">{{ primary?.name }}</div>
      <div class="muted mc-author">{{ authorText }}</div>
      @if (primary?.description) {
        <p class="mc-desc">{{ primary?.description }}</p>
      }
      <div class="mc-stats">
        <span title="下载量">⬇ {{ fmtNum(maxDownloads) }}</span>
        <span title="点赞">♥ {{ fmtNum(maxLikes) }}</span>
        @if (latestUpdate) {
          <span title="更新时间">↻ {{ latestUpdate.slice(0, 10) }}</span>
        }
      </div>
      @if (tags.length) {
        <div>
          @for (tag of tags.slice(0, 4); track tag) {
            <span class="chip">{{ tag }}</span>
          }
        </div>
      }
      <div class="actions">
        <button class="primary" (click)="download.emit()" data-testid="card-download">
          下载@if (items.length > 1) { <span class="mc-source-count">（{{ items.length }} 源可选）</span> }
        </button>
      </div>
    </div>
  `,
  styles: `
    .src-link { text-decoration: none; display: inline-flex; }
    .mc-source-count { font-size: 11px; opacity: 0.8; }
  `,
})
export class ModelCardComponent {
  @Input({ required: true }) items: SearchItem[] = [];
  @Input() inLibrary = false;
  readonly download = output<void>();

  get primary(): SearchItem | undefined {
    return this.items[0];
  }

  get authorText(): string {
    const authors = [...new Set(this.items.map((i) => i.author).filter((a) => !!a))];
    return authors.join(' · ');
  }

  get maxDownloads(): number {
    return Math.max(...this.items.map((i) => i.downloads || 0), 0);
  }

  get maxLikes(): number {
    return Math.max(...this.items.map((i) => i.likes || 0), 0);
  }

  get latestUpdate(): string {
    return this.items.reduce((max, i) => (i.updated_at > max ? i.updated_at : max), '');
  }

  get tags(): string[] {
    return [...new Set(this.items.flatMap((i) => i.tags || []))];
  }

  toneOf(source: string): 'blue' | 'green' | 'orange' | 'gray' {
    return SOURCE_TONES[source] || 'gray';
  }

  taskLabel(task: string): string {
    return TASK_LABELS[task] || task;
  }

  fmtNum = fmtNum;
}
