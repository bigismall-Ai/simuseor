import { Component } from '@angular/core';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { SourceChipComponent } from '../../../../ui/source-chip';
import { ToastComponent } from '../../../../ui/toast';
import { VisualPageComponent } from '../../../visual-page';
import { TextComponent } from '../../../../ui/text';
import { RulesComponent } from '../../../../ui/rules';

/**
 * 原型组件：反馈与来源。
 *
 * 两个面层组件共用按钮语言的玻璃表面：
 *   ui-toast        —— 非阻断提示，位置由页面容器决定
 *   ui-source-chip  —— 来源通路选择，状态点表达健康度
 */
@Component({
  selector: 'app-proto-feedback',
  imports: [
    RulesComponent,
    TextComponent,SectionBlockComponent, SourceChipComponent, ToastComponent, VisualPageComponent],
  styleUrl: './feedback.scss',
  template: `
    <app-visual-page
      title="提示与来源"
      hint="Toast 只承载非阻断提示；来源胶囊把通路健康度和选择状态放在一个控件里。"
    >
      <ui-section title="来源胶囊" pill="Source chip">
        <div class="chip-row">
          <ui-source-chip label="Hugging Face" detail="直连 5.2" [active]="true" />
          <ui-source-chip label="ModelScope" detail="直连 6.8" />
          <ui-source-chip label="GitHub" detail="直连 3.4" state="degraded" />
          <ui-source-chip label="Civitai" detail="不可达" state="down" tip="探针不可达：三条通路均超时" />
          <ui-source-chip label="ComfyHub" detail="未探测" />
        </div>
        <ui-text variant="hint">
          状态点只表达通路健康度：绿=直连可用、橙=降级、灰=不可达。不可达时整颗灰置并禁用，
          原因只放 title，不印在页面上。
        </ui-text>
      </ui-section>

      <ui-section title="Toast 表面" pill="Non-blocking">
        <div class="toast-col">
          <ui-toast>已选择来源：ModelScope · 直连 6.8 MB/s</ui-toast>
          <ui-toast tone="ok" title="已复制路径">workspace/models/diffusion_models/</ui-toast>
          <ui-toast tone="error" title="复制失败" [dismissible]="true">
            剪贴板权限被浏览器拒绝。可手动选择路径。
          </ui-toast>
        </div>
      </ui-section>

      <ui-section title="定位与节奏" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>不负责定位</b>：位置交给页面容器（右下角栈 / 底部居中 dock），组件只做表面。</li>
          <li><b>语气</b>：error 用 role=alert，其余用 role=status；成功 3 秒、错误 6 秒后自动收起。</li>
          <li><b>不承载决策</b>：需要用户确认的事走弹层，不用 Toast。</li>
          <li><b>同时最多三条</b>：再多就说明流程本身该改。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoFeedbackComponent {}
