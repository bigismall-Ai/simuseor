import { UiButtonComponent } from '../ui/button';
import { Component, TemplateRef, inject, viewChild } from '@angular/core';
import { MatDialog, UiMaterialModule } from '../ui/material';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

/** 模态框：16px 圆角、焦点圈闭；静态样张 + 真实 MatDialog。 */
@Component({
  selector: 'app-vis-modals',
  standalone: true,
  imports: [SectionBlockComponent, UiButtonComponent, UiMaterialModule, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="模态框"
      hint="确认类弹层用 16px 圆角与 440px 上限；破坏性操作把危险按钮放右侧。"
    >
      <ui-section title="静态样张" pill="Overlay">
          <div class="modal-stage">
            <div class="modal">
              <h3>删除下载任务？</h3>
              <p>已下载的分片会保留，任务记录从列表中移除。</p>
              <div class="modal-actions">
                <ui-button variant="secondary" type="button">取消</ui-button>
                <ui-button variant="danger" type="button">删除任务</ui-button>
              </div>
            </div>
          </div>
        </ui-section>

      <ui-section title="MatDialog" pill="Material 版本">
          <p class="hint">
            MatDialog 负责焦点圈闭、Esc 关闭与滚动锁定；内容表面仍用本项目的面板令牌。
          </p>
          <ui-button variant="primary" type="button" (click)="open()">打开对话框</ui-button>
        </ui-section>

      <ng-template #dialogTpl>
        <h2 mat-dialog-title>安装环境</h2>
        <mat-dialog-content>
          <p>将安装 ComfyUI v0.45.0 到 <span class="mono">envs/comfy-a</span>。</p>
          <p class="hint">安装过程中可以继续使用其他实例。</p>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
          <button mat-button mat-dialog-close type="button">取消</button>
          <button mat-flat-button type="button" [mat-dialog-close]="true">开始安装</button>
        </mat-dialog-actions>
      </ng-template>
    </app-visual-page>
  `,
})
export class VisModalsComponent {
  private readonly dialog = inject(MatDialog);
  private readonly dialogTpl = viewChild.required<TemplateRef<unknown>>('dialogTpl');

  open(): void {
    this.dialog.open(this.dialogTpl(), { width: '440px', autoFocus: 'first-tabbable' });
  }
}
