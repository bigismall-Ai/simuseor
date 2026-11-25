import { Component, signal } from '@angular/core';
import { UiButtonComponent } from '../../../../ui/button';
import { NoticeComponent } from '../../../../ui/notice';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { VisualPageComponent } from '../../../visual-page';
import { TextComponent } from '../../../../ui/text';
import { RulesComponent } from '../../../../ui/rules';
import { UiMaterialModule } from '../../../../ui/material';

/**
 * 原型组件：行内提示 / Callout。
 *
 * 只回答「影响一块区域、页面还能继续用」这一层；
 * 临时反馈走 Toast，需要决策走 Dialog。
 * inline 是紧凑横条；callout 是区块级说明，能放标题、嵌套列表、code 与动作。
 */
@Component({
  selector: 'app-proto-notice',
  imports: [
    RulesComponent,
    TextComponent,
    NoticeComponent,
    SectionBlockComponent,
    UiButtonComponent,
    UiMaterialModule,
    VisualPageComponent,
  ],
  styleUrl: './notice.scss',
  template: `
    <app-visual-page
      title="行内提示 / Callout"
      hint="四层反馈里的 L1：影响一块区域、页面仍然可用；不自动消失，也不抢焦点。"
    >
      <ui-section title="四种语气 · inline" pill="Tone">
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

      <ui-section title="四种语气 · callout" pill="Variant = callout">
        <div class="col">
          <ui-notice variant="callout" tone="info" title="镜像通路正在接管下载">
            <p>
              直连超时后自动改走 <code>hf-mirror</code>，当前速度 3.2 MB/s。
              镜像只代理文件，不改变仓库 ID 与校验和。
            </p>
          </ui-notice>
          <ui-notice variant="callout" tone="ok" title="已安装到实例 A">
            <p>ComfyUI 可以立即加载这个模型，不需要重启；旧版本仍在，可随时切回。</p>
          </ui-notice>
          <ui-notice variant="callout" tone="warn" title="本机显存可能不足">
            <p>推荐组合预计 28.9 GB，显卡 16 GB。可以继续下载，运行时需要分层加载。</p>
          </ui-notice>
          <ui-notice variant="callout" tone="error" title="Hugging Face 需要登录">
            <p>Token 无效或已过期。更新 Token 后重试，当前页面状态不会丢失。</p>
          </ui-notice>
        </div>
        <ui-text variant="hint">
          callout 未给 <code>icon</code> 时按语气取默认字形；图标井固定 26×26，井内图标 18px。
        </ui-text>
      </ui-section>

      <ui-section title="图标井" pill="Icon well">
        <div class="col">
          <ui-notice variant="callout" tone="info" title="用投影的自有 SVG">
            <span notice-icon>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.5 6.5h5l1.8 2.2h10.2V19H3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              </svg>
            </span>
            投影 <code>[notice-icon]</code> 后井内换成 SVG，单字符默认字形自动让位。
          </ui-notice>
          <ui-notice variant="callout" tone="ok" title="用 Material 图标">
            <span notice-icon><mat-icon svgIcon="app:check-circle" aria-hidden="true" /></span>
            <code>mat-icon</code> 与自有 SVG 走同一套约束：井 26、图标 18、颜色取语气色。
          </ui-notice>
        </div>
      </ui-section>

      <ui-section title="长内容 · 嵌套列表 / code / 链接" pill="Rich content">
        <div class="col">
          <ui-notice variant="callout" tone="warn" title="三个文件无法校验，已保留在暂存区">
            <p>
              远端没有提供 <strong>SHA-256</strong>，本机只记录了文件大小。校验失败不会删除已有文件，
              可以稍后重新校验。
            </p>
            <ul>
              <li><code>model-00001-of-00003.safetensors</code> · 9.8 GB · 大小一致</li>
              <li><code>model-00002-of-00003.safetensors</code> · 9.6 GB · 大小一致</li>
              <li><code>model-00003-of-00003.safetensors</code> · 1.2 GB · 大小一致</li>
            </ul>
            <p>
              处理方式见 <a href="#notice-rules">校验与重试规则</a>，或在
              <a href="#notice-rules">设置 · 下载策略</a> 里关闭强制校验；
              下一条演示 info 语气下 <code>code</code> 胶囊里的链接对比度。
            </p>
          </ui-notice>
          <ui-notice variant="callout" tone="info" title="镜像地址已生效">
            <p>
              当前仓库走 <code><a href="#notice-rules">huggingface.co → hf-mirror.com</a></code>，
              <strong>不会改变文件内容</strong>，只替换下载入口。
            </p>
          </ui-notice>
        </div>
        <ui-text variant="hint">
          嵌套列表缩进 22，行高 1.6；<code>code</code> 用内嵌胶囊，粘贴到正文里不另起一块。
        </ui-text>
      </ui-section>

      <ui-section title="动作与关闭 · 焦点归还" pill="Actions">
        <div class="col">
          @if (dismissed() !== 'dismiss') {
            <ui-notice
              variant="callout"
              tone="info"
              title="有新的源可用"
              [dismissible]="true"
              (dismiss)="dismissed.set('dismiss')"
            >
              探针发现 Civitai 已恢复，可以重新选择来源。
            </ui-notice>
          }

          @if (dismissed() !== 'actions') {
            <ui-notice
              variant="callout"
              tone="error"
              title="目录被占用"
              [dismissible]="true"
              (dismiss)="dismissed.set('actions')"
            >
              关闭占用程序后重试。没有文件被删除。
              <div notice-actions>
                <ui-button variant="secondary" size="sm" type="button">重试</ui-button>
                <ui-button variant="ghost" size="sm" type="button">查看目录</ui-button>
              </div>
            </ui-notice>
          }

          <ui-notice variant="callout" tone="ok" title="动作也可以用 notice-action">
            新写法把单颗按钮放进 <code>notice-action</code>，与 <code>notice-actions</code> 同排。
            <div notice-action>
              <ui-button variant="secondary" size="sm" type="button">打开模型库</ui-button>
            </div>
          </ui-notice>

          <div class="col-actions">
            <ui-button
              variant="secondary"
              size="sm"
              type="button"
              (click)="focusOpen.set(true)"
            >
              打开焦点示例
            </ui-button>
            @if (dismissed()) {
              <ui-button variant="secondary" size="sm" type="button" (click)="dismissed.set('')">
                恢复示例
              </ui-button>
            }
          </div>

          @if (focusOpen()) {
            <ui-notice
              variant="callout"
              tone="warn"
              title="从这里关闭，焦点会回到触发按钮"
              [dismissible]="true"
              (dismiss)="focusOpen.set(false)"
            >
              指针点 × 或键盘 Enter 关闭后，焦点都应回到上方那颗「打开焦点示例」按钮，
              而不是掉回页面开头。
            </ui-notice>
          }
        </div>
        <ui-text variant="hint">
          焦点只还给「提示外部」的最近焦点元素：指针点 × 或键盘 Enter 关闭都回到触发按钮，
          不会掉回页面开头，也不会把焦点送给提示内部的其他控件。
        </ui-text>
      </ui-section>

      <ui-section title="单行" pill="Compact">
        <div class="col">
          <ui-notice tone="ok" icon="✓">下载源已切换到 Hugging Face。</ui-notice>
          <ui-notice tone="info" icon="i">上次探测在 3 分钟前，数据可能已过期。</ui-notice>
        </div>
        <ui-text variant="hint">
          单行只放一句事实；要解释「为什么 / 下一步」就加标题或换 callout，不要堆成一段长文本。
        </ui-text>
      </ui-section>

      <ui-section id="notice-rules" title="分工" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>in-page notice</b>：影响一块区域、页面仍可用；位置在内容流里，不自动消失。</li>
          <li><b>inline / callout</b>：一句话用 inline；要标题、列表、code 或动作就用 callout。</li>
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
  readonly focusOpen = signal(false);
}
