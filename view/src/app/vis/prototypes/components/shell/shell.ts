import { Component } from '@angular/core';
import { BreadcrumbComponent } from '../../../../ui/breadcrumb';
import { GridComponent } from '../../../../ui/grid';
import { InnerCardComponent } from '../../../../ui/inner-card';
import { PageComponent } from '../../../../ui/page';
import { RulesComponent } from '../../../../ui/rules';
import { SectionBlockComponent } from '../../../../ui/section-block';
import { TagComponent } from '../../../../ui/tag';
import { TextComponent } from '../../../../ui/text';
import { VisualPageComponent } from '../../../visual-page';
import type { CrumbItem } from '../../../../ui/breadcrumb';

/**
 * 原型组件：页面壳。
 *
 * 两件套分工：
 *   ui-page       —— 宽度与留白（内容区），不画表面；
 *   ui-breadcrumb —— 层级定位，最后一项是 aria-current，不可再点。
 * 页头不在这里重复，仍用 ui-page-header 叠在页面里。
 *
 * 示例框各自把 `--layout-content-max` 收窄，只为在 VIS 里看清「居中列 / 全幅」的区别；
 * 产品页不覆盖这个 token。
 */
@Component({
  selector: 'app-proto-shell',
  imports: [
    BreadcrumbComponent,
    GridComponent,
    InnerCardComponent,
    PageComponent,
    RulesComponent,
    SectionBlockComponent,
    TagComponent,
    TextComponent,
    VisualPageComponent,
  ],
  styleUrl: './shell.scss',
  template: `
    <app-visual-page
      title="页面壳"
      hint="内容区只管宽度与留白；面包屑只管层级。两者都不承担页头。"
    >
      <ui-section title="页面容器 · ui-page" pill="Page">
        <div class="frames">
          <ui-inner-card class="frame">
            <div class="frame-meta">
              <ui-tag size="sm" [mono]="true">normal</ui-tag>
              <span>--layout-content-max 居中 + --layout-gutter</span>
            </div>
            <ui-page class="narrow-canvas">
              <div page-head>
                <ui-breadcrumb [items]="crumbs3" />
              </div>
              <div class="body-demo">
                <ui-text>
                  默认内容宽，宽屏按 1480 / 1680 / 1880 / 2040 逐级放大；
                  左右留白始终是 --layout-gutter。
                </ui-text>
                <ui-grid>
                  @for (tile of tiles; track tile) {
                    <ui-inner-card class="tile">{{ tile }}</ui-inner-card>
                  }
                </ui-grid>
              </div>
            </ui-page>
          </ui-inner-card>

          <ui-inner-card class="frame">
            <div class="frame-meta">
              <ui-tag size="sm" [mono]="true">wide</ui-tag>
              <span>[wide]="true" · 铺满可用宽度</span>
            </div>
            <ui-page [wide]="true" [flushBottom]="true">
              <div page-head>
                <ui-breadcrumb [items]="crumbs3" />
              </div>
              <div class="body-demo wide-body">
                <ui-text>
                  全幅用于宽表格与多栏工作台：max-width 放开，
                  留白与顶部偏移仍然走 token。
                </ui-text>
              </div>
            </ui-page>
          </ui-inner-card>

          <ui-inner-card class="frame">
            <div class="frame-meta">
              <ui-tag size="sm" [mono]="true">gutter</ui-tag>
              <span>[gutter]="var(--ui-space-4)" · 贴边留白收窄</span>
            </div>
            <ui-page [gutter]="'var(--ui-space-4)'" [flushTop]="true">
              <div page-head>
                <ui-breadcrumb [items]="crumbs2" />
              </div>
              <div class="body-demo">
                <ui-text>
                  页面需要自己的横向节奏时只换 gutter，宽度与偏移仍跟随全局 token。
                </ui-text>
              </div>
            </ui-page>
          </ui-inner-card>
        </div>
        <ui-text variant="hint">
          顶部 / 底部偏移用 <code>flushTop</code> / <code>flushBottom</code> 单独关掉；
          页头继续放在 <code>ui-page</code> 里，用 <code>ui-page-header</code>，不复制标题区。
        </ui-text>
      </ui-section>

      <ui-section title="面包屑 · ui-breadcrumb" pill="Breadcrumb">
        <div class="crumbs">
          <div class="crumb-row">
            <ui-tag size="sm" [mono]="true">2 级</ui-tag>
            <ui-breadcrumb [items]="crumbs2" />
          </div>
          <div class="crumb-row">
            <ui-tag size="sm" [mono]="true">3 级</ui-tag>
            <ui-breadcrumb [items]="crumbs3" />
          </div>
          <div class="crumb-row">
            <ui-tag size="sm" [mono]="true">4 级</ui-tag>
            <ui-breadcrumb [items]="crumbs4" />
          </div>
          <div class="crumb-row">
            <ui-tag size="sm" [mono]="true">长标签</ui-tag>
            <ui-breadcrumb [items]="crumbsLong" />
          </div>
          <div class="crumb-row">
            <ui-tag size="sm" [mono]="true">无路由</ui-tag>
            <ui-breadcrumb [items]="crumbsPlain" />
          </div>
        </div>
        <ui-text variant="hint">
          最后一项用 <code>aria-current="page"</code> 且不渲染成链接；其余层级有
          <code>route</code> 才可点。长标签在中间截断成「前后各留 10 字」，
          完整值留在 <code>title</code> 里。
        </ui-text>
      </ui-section>

      <ui-section title="约束" pill="Rules" [plain]="true">
        <ui-rules>
          <li><b>ui-page 只做布局</b>：宽度、留白、居中；颜色、圆角、阴影一律不碰。</li>
          <li><b>页头不重复</b>：标题与主操作仍在 <code>ui-page-header</code>，<code>[page-head]</code> 只放面包屑这类窄条。</li>
          <li><b>wide 是例外</b>：只有全幅表格、多栏工作台才放开最大宽，默认不放开。</li>
          <li><b>面包屑一项职责</b>：表达层级；它不做跳转历史、不做标题、不做返回按钮。</li>
          <li><b>长度</b>：层级最多 4 级，再多说明信息架构有问题，而不是继续加「…」。</li>
        </ui-rules>
      </ui-section>
    </app-visual-page>
  `,
})
export class ProtoShellComponent {
  readonly tiles = ['资产列表', '筛选条', '详情栏'];

  readonly crumbs2: CrumbItem[] = [
    { label: '资源管理器', route: '/vis/prototypes/pages/resource-manager' },
    { label: '本机目录' },
  ];

  readonly crumbs3: CrumbItem[] = [
    { label: '设计区', route: '/vis/overview' },
    { label: '原型页面', route: '/vis/prototypes/pages/models' },
    { label: '模型库' },
  ];

  readonly crumbs4: CrumbItem[] = [
    { label: '设计区', route: '/vis/overview' },
    { label: '原型组件', route: '/vis/prototypes/components/structure' },
    { label: '外壳', route: '/vis/prototypes/components/sidebar' },
    { label: '页面壳' },
  ];

  readonly crumbsLong: CrumbItem[] = [
    { label: '设计区', route: '/vis/overview' },
    { label: 'FLUX.1-dev 全套权重与工作流归档（含分片、VAE 与文本编码器）' },
  ];

  readonly crumbsPlain: CrumbItem[] = [
    { label: '设计区' },
    { label: '视觉设计' },
    { label: '背景' },
  ];
}
