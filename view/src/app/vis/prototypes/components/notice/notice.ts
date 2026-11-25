import { Component, signal } from '@angular/core';
import { UiButtonComponent } from '../../../../ui/button';
import { NoticeComponent } from '../../../../ui/notice';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { VisualPageComponent } from '../../../visual-page';
import { TextComponent } from '../../../../ui/text';
import { RulesComponent } from '../../../../ui/rules';

/**
 * 原型组件：行内提示。
 *
 * 只回答「影响一块区域、页面还能继续用」这一层；
 * 临时反馈走 Toast，需要决策走 Dialog。
 */
@Component({
  selector: 'app-proto-notice',
  imports: [
    RulesComponent,
    TextComponent,NoticeComponent, SectionBlockComponent, UiButtonComponent, VisualPageComponent],
  styleUrl: './notice.scss',
  template: `
    <app-visual-page
      title="行内提示"
      hint="四层反馈里的 L1：影响一块区域、页面仍然可用；不自动消失，也不抢焦点。"
    >
      <ui-section title="四种语气" pill="Tone">
        <div class="col">
          <ui-notice tone="info" icon="i" title="已切换到镜像">
            直连超时，下载自动改走 hf-mirror，速度 3.2 MB/s。
          </ui-notice>
          <ui-notice tone="ok" icon="✓" title="已安装到实例 A">
            ComfyUI 可以立即加载这个模型，不需要重启。
          </ui-notice>
          <ui-notice tone="warn" icon="!" title="本机显存可能不足">
            推荐组合预计 28.9 GB，显卡 16 GB。可以继续下载，运行时需要分层加载。
          </ui-notice>
          <ui-notice tone="error" icon="!" title="Hugging Face 需要登录">
            Token 无效或已过期。更新 Token 后重试，当前页面状态不会丢失。
          </ui-notice>
        </div>
      </ui-section>

      <ui-section title="可关闭与动作" pill="Actions">
        <div class="col">
          @if (dismissed() !== 'dismiss') {
            <ui-notice tone="info" icon="i" title="有新的源可用" [dismissible]="true" (dismiss)="dismissed.set('dismiss')">
              探针发现 Civitai 已恢复，可以重新选择来源。
            </ui-notice>
          }

          @if (dismissed() !== 'actions') {
            <ui-notice tone="error" icon="!" title="目录被占用" [dismissible]="true" (dismiss)="dismissed.set('actions')">
              关闭占用程序后重试。没有文件被删除。
              <div notice-actions>
                <ui-button variant="secondary" size="sm" type="button">重试</ui-button>
                <ui-button variant="ghost" size="sm" type="button">查看目录</ui-button>
              </div>
            </ui-notice>
          }

          @if (dismissed()) {
            <ui-button variant="secondary" size="sm" type="button" (click)="dismissed.set('')">
              恢复示例
            </ui-button>
          }
        </div>
      </ui-section>

      <ui-section title="单行" pill="Compact">
        <div class="col">
          <ui-notice tone="ok" icon="✓">下载源已切换到 Hugging Face。</ui-notice>
          <ui-notice tone="info" icon="i">上次探测在 3 分钟前，数据可能已过期。</ui-notice>
        </div>
        <ui-text variant="hint">
          单行只放一句事实；要解释「为什么 / 下一步」就加标题，不要堆成一段长文本。
        </ui-text>
      </ui-section>

      <ui-section title="分工" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>in-page notice</b>：影响一块区域、页面仍可用；位置在内容流里，不自动消失。</li>
          <li><b>toast</b>：临时结果，不阻断操作；由页面容器定位，3–6 秒自动收起。</li>
          <li><b>dialog</b>：需要用户做决定，或操作不可撤销。</li>
          <li><b>语气</b>：error 用 <code>role=alert</code>，其余用 <code>role=status</code>；颜色只表达严重程度。</li>
          <li><b>动作</b>：至多两个，放在正文下方；不要在主提示里塞第三个按钮。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoNoticeComponent {
  readonly dismissed = signal('');
}
