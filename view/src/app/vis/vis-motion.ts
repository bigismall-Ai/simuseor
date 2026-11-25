import { Component, signal } from '@angular/core';
import { UiButtonComponent } from '../ui/button';
import { ProgressComponent } from '../ui/progress';
import { RulesComponent } from '../ui/rules';
import { SectionBlockComponent } from '../ui/section-block';
import { TableComponent } from '../ui/table';
import { TextComponent } from '../ui/text';
import { ToastComponent } from '../ui/toast';
import { VisualPageComponent } from './visual-page';

/**
 * 动效：三档时长 + 一条缓动，用真实组件演示。
 *
 * 动效只表达「状态变了」，不做装饰；所有组件在 reduced-motion 下都要立即到位。
 */
@Component({
  selector: 'app-vis-motion',
  imports: [
    ProgressComponent,
    RulesComponent,
    SectionBlockComponent,
    TableComponent,
    TextComponent,
    ToastComponent,
    UiButtonComponent,
    VisualPageComponent,
  ],
  styleUrl: './vis-tokens.scss',
  template: `
    <app-visual-page
      title="动效"
      hint="fast 0.14 / base 0.18 / slow 0.34，缓动统一 ease；减少动效时立即到位。"
    >
      <ui-section title="时长与缓动" pill="Tokens">
        <ui-text variant="lead">
          时长分三档：颜色与透明度这类「小变化」走 fast，表面与阴影这类「结构变化」走 base，
          展开 / 收起这类「尺寸变化」走 slow。缓动只有一条 <code>--ui-ease</code>，
          需要物理感的折叠另用 MUI 的标准曲线。
        </ui-text>
        <ui-table density="docs">
          <table>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">值</th>
                <th scope="col">用在哪</th>
              </tr>
            </thead>
            <tbody>
              @for (row of durations; track row.token) {
                <tr>
                  <td class="mono">{{ row.token }}</td>
                  <td class="mono">{{ row.value }}</td>
                  <td>{{ row.use }}</td>
                </tr>
              }
            </tbody>
          </table>
        </ui-table>
      </ui-section>

      <ui-section title="实样" pill="Live">
        <div class="motion-demo">
          <div class="motion-cell">
            <span class="mono" style="font-size: var(--ui-text-xs)">进度条 · 0.2s</span>
            <ui-progress [value]="progress()" label="演示进度" />
            <div class="tok-inline">
              <ui-button variant="secondary" size="sm" (click)="step()">加 25%</ui-button>
              <ui-button variant="ghost" size="sm" (click)="reset()">归零</ui-button>
            </div>
            <span style="font-size: var(--ui-text-sm); color: var(--ui-muted)">
              宽度走 0.2s ease；值变化时不跳动，也不做回弹。
            </span>
          </div>

          <div class="motion-cell">
            <span class="mono" style="font-size: var(--ui-text-xs)">Toast · 0.22s 进场</span>
            @if (toast()) {
              <ui-toast tone="ok" title="已复制路径" [dismissible]="true" (dismiss)="toast.set(false)">
                workspace/models/diffusion_models/
              </ui-toast>
            } @else {
              <ui-button variant="secondary" size="sm" (click)="toast.set(true)">显示 Toast</ui-button>
            }
            <span style="font-size: var(--ui-text-sm); color: var(--ui-muted)">
              进场 0.22s ease-out，退场与自动收起不延迟操作；成功 3s、错误 6s。
            </span>
          </div>

          <div class="motion-cell">
            <span class="mono" style="font-size: var(--ui-text-xs)">按钮悬停 · 0.18s</span>
            <div class="tok-inline">
              <ui-button variant="primary">开始下载</ui-button>
              <ui-button variant="secondary">选择文件夹…</ui-button>
            </div>
            <span style="font-size: var(--ui-text-sm); color: var(--ui-muted)">
              背景、描边、阴影、文字色同一条 base 时长，hover 与 focus 不会一快一慢。
            </span>
          </div>
        </div>
      </ui-section>

      <ui-section title="减少动效" pill="Reduced motion">
        <div class="tok-stack">
          <ui-text variant="lead">
            <code>prefers-reduced-motion: reduce</code> 下，所有过渡与循环动画都改成
            <code>none</code>：进度条直接跳到新宽度，骨架屏换成静态底色，
            Toast 直接出现。焦点环、选中态、颜色仍然立刻可见，不靠动画传达状态。
          </ui-text>
          <ui-table density="docs">
            <table>
              <thead>
                <tr>
                  <th scope="col">组件</th>
                  <th scope="col">常规</th>
                  <th scope="col">减少动效</th>
                </tr>
              </thead>
              <tbody>
                @for (row of reduced; track row.name) {
                  <tr>
                    <td>{{ row.name }}</td>
                    <td>{{ row.normal }}</td>
                    <td>{{ row.reduced }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </ui-table>
        </div>
      </ui-section>

      <ui-section title="规则" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>三档封顶</b>：时长只用 <code>--ui-duration-fast/base/slow</code>，不写 0.15 / 0.16 / 0.2 的散值。</li>
          <li><b>一条缓动</b>：常规过渡统一 <code>var(--ui-ease)</code>；只有折叠这类大位移才用标准曲线。</li>
          <li><b>不做装饰</b>：没有入场漂浮、没有呼吸光、没有无限循环（骨架屏与 spinner 除外）。</li>
          <li><b>动画不延迟操作</b>：退场期间点击立即生效，不等动画结束。</li>
          <li><b>reduced-motion 必须覆盖</b>：新增带过渡的组件要同时写 <code>@media (prefers-reduced-motion: reduce)</code>。</li>
          <li><b>状态不靠动画</b>：颜色、描边、图标、文案先表达状态，动画只做辅助。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class VisMotionComponent {
  readonly progress = signal(40);
  readonly toast = signal(false);

  readonly durations = [
    { token: '--ui-duration-fast', value: '0.14s', use: '悬停底色、图标色、导航项、TOC 链接' },
    { token: '--ui-duration-base', value: '0.18s', use: '按钮、来源胶囊、输入框描边与阴影' },
    { token: '--ui-duration-slow', value: '0.34s', use: '卡片折叠展开、高度与位移' },
    { token: '--ui-ease', value: 'ease', use: '以上三档共用' },
    { token: '（组件内）', value: '0.2s / 0.22s', use: '进度条宽度、Toast 进场；随组件定义' },
    { token: '（组件内）', value: '1.4s infinite', use: '骨架屏微光循环，reduced-motion 下停止' },
  ];

  readonly reduced = [
    { name: 'ui-progress', normal: '宽度 0.2s ease', reduced: '无过渡，直接到位' },
    { name: 'ui-skeleton', normal: '1.4s 微光循环', reduced: '静态底色' },
    { name: 'ui-card-body', normal: '高度 / 位移 0.34s', reduced: '直接展开，无过渡' },
    { name: 'ui-search', normal: '浮层 0.15s', reduced: '无过渡' },
    { name: 'ui-toc', normal: '链接与迷你条 0.14s', reduced: '无过渡，滚动也立即跳转' },
  ];

  step(): void {
    this.progress.update((value) => (value >= 100 ? 25 : Math.min(100, value + 25)));
  }

  reset(): void {
    this.progress.set(0);
  }
}
