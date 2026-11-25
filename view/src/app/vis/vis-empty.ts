import { Component } from '@angular/core';
import { UiButtonComponent } from '../ui/button';
import { EmptyComponent } from '../ui/empty';
import { NoticeComponent } from '../ui/notice';
import { SectionBlockComponent } from '../ui/section-block';
import { SkeletonComponent } from '../ui/skeleton';
import { VisualPageComponent } from './visual-page';
import { TextComponent } from '../ui/text';
import { RulesComponent } from '../ui/rules';

/** 空状态与行内反馈：ui-empty / ui-notice 的实际表现。 */
@Component({
  selector: 'app-vis-empty',
  imports: [
    RulesComponent,
    TextComponent,
    EmptyComponent,
    NoticeComponent,
    SectionBlockComponent,
    SkeletonComponent,
    UiButtonComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page title="空状态" hint="空态、加载、错误与成功都用共享组件表达，不再每页拼一套。">
      <ui-section title="集合为空" pill="ui-empty">
        <ui-empty icon="◍" title="还没有模型" hint="去「发现」页挑一个，或把文件放进 models/ 目录。">
          <div class="empty-actions">
            <ui-button variant="primary" type="button">去发现页</ui-button>
            <ui-button variant="secondary" type="button">扫描本地目录</ui-button>
          </div>
        </ui-empty>
      </ui-section>

      <ui-section title="加载与反馈" pill="ui-notice">
        <div class="stack">
          <div class="loading-line"><span class="dot-spin"></span><span>正在读取模型列表…</span></div>
          <div class="progress"><div style="width: 62%"></div></div>
          <ui-notice tone="error" icon="!" title="删除失败">
            目录被占用，关闭占用程序后重试。没有文件被删除。
          </ui-notice>
          <ui-notice tone="ok" icon="✓" title="已安装">已安装到实例 A。</ui-notice>
          <ui-notice tone="info" icon="i">下载源已切换到 Hugging Face。</ui-notice>
        </div>
      </ui-section>

      <ui-section title="加载骨架" pill="ui-skeleton">
        <div class="stack">
          <ui-skeleton [lines]="3" label="正在读取模型列表" />
          <div class="progress"><div style="width: 34%"></div></div>
        </div>
        <ui-text variant="hint">
          首屏首次加载用骨架；已经有内容时只做局部刷新，用进度条或行内提示，不要整块重画。
        </ui-text>
      </ui-section>

      <ui-section title="搜索无匹配" pill="No result">
        <ui-empty icon="⌕" title="没有匹配「flux dev」的结果" hint="换个关键词，或清除筛选条件。">
          <div class="empty-actions">
            <ui-button variant="secondary" type="button">清除全部筛选</ui-button>
          </div>
        </ui-empty>
      </ui-section>

      <ui-section title="层级" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>集合为空</b>：给一个主操作，说清下一步；不要只写「暂无数据」。</li>
          <li><b>搜索无匹配</b>：保留当前筛选条件，给「清除筛选」而不是「新建」。</li>
          <li><b>行内提示</b>：影响一块区域、页面仍可用；要用户做决定就走 ui-dialog。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisEmptyComponent {}
