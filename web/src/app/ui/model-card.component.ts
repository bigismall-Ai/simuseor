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

@Component({
  selector: 'md-model-card',
  standalone: true,
  imports: [BadgeComponent],
  template: `
    <div class="model-card">
      <div class="toolbar">
        <ui-badge [tone]="tone">{{ item.source }}</ui-badge>
        @if (item.task) {
          <ui-badge tone="gray">{{ taskLabel(item.task) }}</ui-badge>
        }
        @if (inLibrary) {
          <ui-badge tone="green">已在库</ui-badge>
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
        <span title="下载量">⬇ {{ fmtNum(item.downloads) }}</span>
        <span title="点赞">♥ {{ fmtNum(item.likes) }}</span>
        @if (item.updated_at) {
          <span title="更新时间">↻ {{ shortDate(item.updated_at) }}</span>
        }
      </div>
      @if (item.tags.length) {
        <div>
          @for (tag of item.tags.slice(0, 4); track tag) {
            <span class="chip">{{ tag }}</span>
          }
        </div>
      }
      <div class="actions">
        <button class="primary" (click)="download.emit()" data-testid="card-download">下载</button>
      </div>
    </div>
  `,
})
export class ModelCardComponent {
  @Input({ required: true }) item!: SearchItem;
  @Input() inLibrary = false;
  readonly download = output<void>();

  get tone(): 'blue' | 'green' | 'orange' | 'gray' {
    return SOURCE_TONES[this.item.source] || 'gray';
  }

  taskLabel(task: string): string {
    return TASK_LABELS[task] || task;
  }

  shortDate(value: string): string {
    return value ? value.slice(0, 10) : '';
  }

  fmtNum = fmtNum;
}
