import { Component } from '@angular/core';
import { UiButtonComponent } from '../ui/button';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { VisualPageComponent } from './visual-page';

/** 按钮：主 / 次 / 弱 / 危险四层语义，玻璃表面 + 1px 描边 + 轻投影。 */
@Component({
  selector: 'app-vis-buttons',
  standalone: true,
  imports: [UiButtonComponent, SectionBlockComponent, TableComponent, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="按钮"
      hint="主 / 次 / 弱 / 危险四层语义；玻璃表面、1px 描边、内高光与轻投影，深浅色同构。"
    >
      <ui-section title="层级" pill="Actions">
        <div class="row">
          <span class="row-label">Primary</span>
          <ui-button variant="primary">开始下载</ui-button>
          <ui-button variant="primary" [disabled]="true">准备中…</ui-button>
        </div>

        <div class="row">
          <span class="row-label">Secondary</span>
          <ui-button variant="secondary">选择文件夹…</ui-button>
          <ui-button variant="secondary" [disabled]="true">不可用</ui-button>
        </div>

        <div class="row">
          <span class="row-label">Ghost</span>
          <ui-button variant="ghost">取消</ui-button>
          <ui-button variant="ghost">查看详情</ui-button>
        </div>

        <div class="row">
          <span class="row-label">Danger</span>
          <ui-button variant="danger">删除任务</ui-button>
          <ui-button variant="danger-ghost">移除记录</ui-button>
        </div>

        <div class="row">
          <span class="row-label">Icon</span>
          <ui-button variant="ghost" size="icon" label="刷新">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.3-3M4 15a8 8 0 0 0 14.3 3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </ui-button>
          <ui-button variant="secondary" size="icon" label="更多操作">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="5" cy="12" r="1.7" fill="currentColor" />
              <circle cx="12" cy="12" r="1.7" fill="currentColor" />
              <circle cx="19" cy="12" r="1.7" fill="currentColor" />
            </svg>
          </ui-button>
        </div>

        <div class="row">
          <span class="row-label">Small</span>
          <ui-button variant="primary" size="sm">解析文件</ui-button>
          <ui-button variant="secondary" size="sm">全选</ui-button>
          <ui-button variant="ghost" size="sm">展开</ui-button>
        </div>
      </ui-section>

      <ui-section title="按钮宽度与组合" pill="Layout">
        <div class="action-row">
          <ui-button variant="ghost">取消</ui-button>
          <ui-button variant="secondary">保存草稿</ui-button>
          <ui-button variant="primary">保存并运行</ui-button>
        </div>
        <div class="action-row">
          <ui-button variant="primary" [block]="true">安装到实例 A</ui-button>
        </div>
      </ui-section>

      <ui-section title="色彩语义" pill="Semantics" [plain]="true">
        <div class="notes-stack">
          <ui-table>
<table>
              <thead>
                <tr>
                  <th scope="col">语义</th>
                  <th scope="col">颜色</th>
                  <th scope="col">令牌</th>
                  <th scope="col">用途</th>
                </tr>
              </thead>
              <tbody>
                @for (s of semantics; track s.name) {
                  <tr>
                    <td>{{ s.name }}</td>
                    <td>
                      <span [class]="'semantic-chip ' + s.tone" aria-hidden="true"></span>{{ s.color }}
                    </td>
                    <td class="mono">{{ s.token }}</td>
                    <td>{{ s.use }}</td>
                  </tr>
                }
              </tbody>
            </table>
</ui-table>
          <ul class="color-rules">
            <li><b>统一表面</b>：所有按钮都是 1px 描边 + 内高光 + 轻投影 + 胶囊圆角；深浅色只换 token，不换结构。</li>
            <li><b>层级</b>：主操作实心渐变，次操作玻璃面，弱操作无底；危险操作才用赭石。</li>
            <li><b>组合</b>：同一组只能有一个主操作；动作不超过三个，其余收进菜单。</li>
            <li><b>状态</b>：不可用只降低不透明度并去掉投影，不改变语义颜色。</li>
          </ul>
        </div>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisButtonsComponent {
  readonly semantics = [
    {
      name: '主操作',
      color: '墨紫渐变 / 极光蓝渐变',
      token: '--ui-primary',
      tone: 'primary',
      use: '提交、开始、确认；每个视图最多一个',
    },
    {
      name: '次操作',
      color: '玻璃白 / 深海蓝',
      token: '--ui-surface',
      tone: 'secondary',
      use: '选择、保存草稿等辅助动作',
    },
    {
      name: '弱操作',
      color: '透明',
      token: 'transparent',
      tone: 'ghost',
      use: '取消、返回、查看详情',
    },
    {
      name: '危险',
      color: '赭石',
      token: '--ui-error',
      tone: 'danger',
      use: '删除、停止、清空；不与主操作并排',
    },
    {
      name: '危险弱操作',
      color: '赭石文字',
      token: '--ui-error',
      tone: 'danger-ghost',
      use: '移除记录等次级危险动作',
    },
    {
      name: '不可用',
      color: '降低不透明度',
      token: 'opacity 42%',
      tone: 'disabled',
      use: '只表示暂不可用，不承载语义',
    },
  ];
}
