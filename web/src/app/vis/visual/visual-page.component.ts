import { Component, Input } from '@angular/core';
import { ThemeService } from '../../core/theme.service';
import { PageHeaderComponent } from '../../ui/page-header.component';

/**
 * 视觉设计分页外壳（/vis/visual/*）。
 *
 * 每个分类页只填自己的样张；页头、主题切换和内容区宽度由这里统一，
 * 避免「每个分类页各写一遍页头」再次漂移。
 */
@Component({
  selector: 'app-visual-page',
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <div class="vis-ref">
      <ui-page-header [kicker]="kicker" [title]="title" [hint]="hint">
        <button class="btn-toggle" type="button" (click)="toggle()">切换到{{ next() }}主题</button>
      </ui-page-header>
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* 色彩页和按钮样张用的两套主题色板：声明在外壳上，所有分类页共享 */
      .vis-ref {
        --ink-paper: #ece8de;
        --ink-ink: #222c28;
        --ink-moss: #68756c;
        --ink-accent: #b95e4e;
        --ink-stone: #c6c0b4;
        --aurora-bg: #0e1026;
        --aurora-panel: #0d1026;
        --aurora-primary: #5658ff;
        --aurora-magenta: #e45cff;
        --aurora-mint: #54e8d1;
        --aurora-text: #f6f4ff;
        --aurora-border: rgb(255 255 255 / 0.18);

        max-width: 1240px;
        margin: 0 auto;
        padding: 26px 28px 72px;
      }

      .btn-toggle {
        height: 30px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--panel);
        color: var(--text-2);
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        text-decoration: none;
      }
      .btn-toggle:hover {
        background: var(--hover);
        border-color: var(--border-strong);
        color: var(--text);
      }

      @media (max-width: 860px) {
        .vis-ref { padding: 20px 16px 56px; }
      }
    `,
  ],
})
export class VisualPageComponent {
  @Input() kicker = 'VIS · 视觉设计';
  @Input({ required: true }) title = '';
  @Input() hint = '';

  constructor(private theme: ThemeService) {}

  toggle(): void {
    this.theme.toggle();
  }

  next(): string {
    return this.theme.theme() === 'dark' ? '浅色' : '深色';
  }
}
