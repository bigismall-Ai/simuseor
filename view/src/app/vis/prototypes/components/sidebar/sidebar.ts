import { Component } from '@angular/core';
import { UiIconModule } from '../../../../ui/material';
import { NAV_TREE, flattenNav } from '../../../vis-nav';
import { LabelComponent } from '../../../../ui/label';
import type { NavRowItem } from '../../../../ui/nav-tree';

/**
 * 原型组件：侧边导航。
 *
 * 展示 224px 展开与 64px 收起两种形态。导航数据直接取 NAV_TREE，
 * 样式与真实 VIS 外壳同源：全高、贴视口边缘、无卡片外框。
 */
@Component({
  selector: 'app-proto-sidebar',
  standalone: true,
  imports: [
    LabelComponent,
    UiIconModule,
  ],
  styleUrl: './sidebar.scss',
  template: `
    <ui-label>侧边导航</ui-label>

    <div class="rail-grid">
      <section class="rail-case">
        <p class="case-label">展开 · 224px</p>
        <div class="rail">
          <div class="rail-brand">
            <span class="rail-mark">VIS</span>
            <span class="rail-name">设计区<small>视觉与原型</small></span>
          </div>

          <nav class="rail-nav ui-scrollbar" aria-label="展开导航示例">
            @for (row of expandedRows; track row.key) {
              @if (row.subheader) {
                <p class="rail-section">{{ row.label }}</p>
              } @else if (row.group) {
                <p class="rail-group" [style.padding-left.px]="8 + row.depth * 13">{{ row.label }}</p>
              } @else {
                <span
                  class="rail-item"
                  [class.active]="row.route === activeRoute"
                  [style.padding-left.px]="12 + row.depth * 13"
                >
                  <mat-icon class="rail-icon" [svgIcon]="'app:' + row.icon" aria-hidden="true"></mat-icon>
                  {{ row.label }}
                </span>
              }
            }
          </nav>

          <div class="rail-foot">
            <mat-icon class="rail-icon" svgIcon="app:moon" aria-hidden="true"></mat-icon>
            深色模式
          </div>
        </div>
      </section>

      <section class="rail-case">
        <p class="case-label">收起 · 64px</p>
        <div class="rail collapsed">
          <div class="rail-brand">
            <span class="rail-mark">VIS</span>
          </div>

          <nav class="rail-nav ui-scrollbar" aria-label="收起导航示例">
            @for (item of collapsedItems; track item.key) {
              <span class="rail-item" [class.active]="item.route === activeRoute">
                <mat-icon class="rail-icon" [svgIcon]="'app:' + item.icon" aria-hidden="true"></mat-icon>
              </span>
            }
          </nav>

          <div class="rail-foot">
            <mat-icon class="rail-icon" svgIcon="app:moon" aria-hidden="true"></mat-icon>
          </div>
        </div>
      </section>
    </div>

    <ui-label>约束</ui-label>
    <ul class="rail-rules">
      <li>展开 224px，收起 64px；收起后只保留图标，分组标题隐藏。</li>
      <li>侧栏贴视口边缘、全高显示，不是圆角卡片；圆角只属于内容卡。</li>
      <li>滚动条贴右边缘：展开 6px，收起 4px，轨道透明。</li>
      <li>导航项 34px 高；一级分组 11.5px，二级分组 10.5px。</li>
      <li>当前项使用 raised 底 + 内描边，不使用左侧色条。</li>
    </ul>
  `,
})
export class ProtoSidebarComponent {
  readonly activeRoute = '/vis/prototypes/components/sidebar';

  readonly expandedRows = flattenNav(NAV_TREE, new Set(), false).map<NavRowItem>((row) => ({
    key: row.node.key,
    label: row.node.label,
    route: row.node.route,
    icon: row.node.icon,
    subheader: !!row.node.subheader,
    group: !!row.node.children?.length && !row.node.subheader,
    depth: row.depth,
    open: row.open,
  }));

  readonly collapsedItems = flattenNav(NAV_TREE, new Set(), true).map<NavRowItem>((row) => ({
    key: row.node.key,
    label: row.node.label,
    route: row.node.route,
    icon: row.node.icon,
    depth: 0,
  }));
}
