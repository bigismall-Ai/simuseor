import { Component, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { MatDialog, UiMaterialModule } from '../ui/material';
import { UiButtonComponent } from '../ui/button';
import { DialogComponent } from '../ui/dialog';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';
import { RulesComponent } from '../ui/rules';

/**
 * 模态框：一个 VIS 页面统一三种形态。
 *
 *   ui-dialog  —— 原生 <dialog>：焦点圈闭 / top layer / Esc 由浏览器提供
 *   MatDialog  —— 需要 Material 的既有能力（拖拽、复杂内容）时
 *   静态表面    —— 只用于展示规格，不做交互
 */
@Component({
  selector: 'app-vis-modals',
  imports: [
    RulesComponent,
    TextComponent,
    DialogComponent,
    SectionBlockComponent,
    UiButtonComponent,
    UiMaterialModule,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="模态框"
      hint="一个表面规格，两种承载：页面内 ui-dialog 与生产用 MatDialog；破坏性动作永远在右侧。"
    >
      <ui-section title="页面内弹层" pill="ui-dialog">
        <div class="modal-stage">
          <ui-button variant="danger" type="button" (click)="confirmOpen.set(true)">
            打开删除确认
          </ui-button>
        </div>
        <p class="hint table-note">
          基于原生 <code>&lt;dialog&gt;</code> + <code>showModal()</code>：焦点圈闭、top layer、Esc 由浏览器提供；
          组件只补焦点首落点、关闭后还给触发按钮、锁页面滚动。
        </p>
      </ui-section>

      <ui-section title="生产用 MatDialog" pill="Material">
        <ui-text variant="hint">
          MatDialog 负责完整焦点圈闭与滚动锁定；内容表面仍用同一套面板令牌，两边的外观应一致。
        </ui-text>
        <ui-button variant="primary" type="button" (click)="open()">打开安装对话框</ui-button>
      </ui-section>

      <ui-section title="规格与规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>宽度</b>：440px 上限，内容再长就分步，不把弹层拖成全屏。</li>
          <li><b>动作</b>：最多一主一次，右对齐；破坏性操作放最右，用 danger。</li>
          <li><b>关闭</b>：Esc 与点遮罩都关；不可逆确认可以把 <code>dismissible</code> 设 false。</li>
          <li><b>选择</b>：默认用 <code>ui-dialog</code>（原生 dialog，焦点圈闭与 Esc 已具备）；只有需要 Material 既有能力时才换 MatDialog。</li>
        </ui-rules>
      </ui-section>

      <ui-dialog [(open)]="confirmOpen" title="删除下载任务？" [destructive]="true">
        已下载的分片会保留，任务记录从列表中移除。
        <div dialog-actions>
          <ui-button variant="secondary" type="button" data-autofocus (click)="confirmOpen.set(false)">
            取消
          </ui-button>
          <ui-button variant="danger" type="button" (click)="confirmOpen.set(false)">
            删除任务
          </ui-button>
        </div>
      </ui-dialog>

      <ng-template #dialogTpl>
        <h2 mat-dialog-title>安装环境</h2>
        <mat-dialog-content>
          <p>将安装 ComfyUI v0.45.0 到 <span class="mono">envs/comfy-a</span>。</p>
          <ui-text variant="hint">安装过程中可以继续使用其他实例。</ui-text>
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
  readonly confirmOpen = signal(false);

  private readonly dialog = inject(MatDialog);
  private readonly dialogTpl = viewChild.required<TemplateRef<unknown>>('dialogTpl');

  open(): void {
    this.dialog.open(this.dialogTpl(), { width: '440px', autoFocus: 'first-tabbable' });
  }
}
