import { UiButtonComponent } from '../ui/button';
import { Component } from '@angular/core';
import { UiMaterialModule } from '../ui/material';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

/** 空状态：空 / 加载 / 错误 / 成功 / 提示。 */
@Component({
  selector: 'app-vis-empty',
  standalone: true,
  imports: [SectionBlockComponent, UiButtonComponent, UiMaterialModule, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page title="空状态" hint="空态、加载、错误、成功与提示条的统一表达。">
      <ui-section title="集合为空" pill="Empty">
          <div class="empty">
            <span class="empty-mark" aria-hidden="true">◍</span>
            <b>还没有模型</b>
            <p>去「发现」页挑一个，或把文件放进 models/ 目录。</p>
            <div class="empty-actions">
              <ui-button variant="primary" type="button">去发现页</ui-button>
              <ui-button variant="secondary" type="button">扫描本地目录</ui-button>
            </div>
          </div>
        </ui-section>

      <ui-section title="加载与反馈" pill="Feedback">
          <div class="stack">
            <div class="loading-line"><span class="dot-spin"></span><span>正在读取模型列表…</span></div>
            <div class="progress"><div style="width: 62%"></div></div>
            <div class="notice err" role="alert">删除失败：目录被占用，关闭占用程序后重试</div>
            <div class="notice ok">已安装到实例 A</div>
            <div class="notice info">下载源已切换到 Hugging Face</div>
          </div>
        </ui-section>

      <ui-section title="搜索无匹配" pill="No result">
          <div class="empty compact">
            <span class="empty-mark" aria-hidden="true">⌕</span>
            <b>没有匹配「flux dev」的结果</b>
            <p>换个关键词，或清除筛选条件。</p>
            <div class="empty-actions">
              <ui-button variant="secondary" type="button">清除全部筛选</ui-button>
            </div>
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisEmptyComponent {}
