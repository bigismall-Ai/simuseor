import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GridComponent } from '../ui/grid';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

interface OverviewLink {
  label: string;
  desc: string;
  route: string;
}

interface OverviewGroup {
  title: string;
  pill: string;
  kicker: string;
  items: OverviewLink[];
}

@Component({
  selector: 'app-vis-overview',
  standalone: true,
  imports: [GridComponent, SectionBlockComponent, RouterLink, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="设计区总览"
      hint="视觉设计按分类拆页；样张直接渲染产品将使用的 native / Material 组件。"
    >
      @for (group of groups; track group.title) {
        <ui-section [title]="group.title" [pill]="group.pill">
          <ui-grid min="220px" max="1fr" gap="var(--ui-space-3)">
            @for (item of group.items; track item.route) {
              <a class="sample-card" [routerLink]="item.route">
                <span class="mono">{{ group.kicker }}</span>
                <b>{{ item.label }}</b>
                <span>{{ item.desc }}</span>
              </a>
            }
          </ui-grid>
        </ui-section>
      }
    </app-visual-page>
  `,
})
export class VisOverviewComponent {
  /** 与 NAV_TREE 的分类一一对应：每个路由只在总览出现一次。 */
  readonly groups: OverviewGroup[] = [
    {
      title: '视觉设计 · 基础',
      pill: 'Foundation',
      kicker: 'FOUNDATION',
      items: [
        { label: '标识', desc: '组合标与图标落位', route: '/vis/brand' },
        { label: '色彩', desc: '晨雾朦胧 / 极光视界两套色板与角色映射', route: '/vis/color' },
        { label: '图标', desc: '24px 描边图标集与 MatIcon 用法', route: '/vis/icons' },
        { label: '圆角', desc: '28px 面板 / 24px 卡片 / 16px 列表 / 999px 胶囊', route: '/vis/radius' },
      ],
    },
    {
      title: '视觉设计 · 版式',
      pill: 'Layout',
      kicker: 'LAYOUT',
      items: [
        { label: '布局', desc: '页面骨架、两栏拆分与 --layout-* 变量', route: '/vis/layout' },
        { label: '背景', desc: '页面 / 侧栏 / 面板 / 卡片 / 内嵌五级层与光晕', route: '/vis/background' },
        { label: '封面与纹样', desc: '家族色封面、纹样变体与照片蒙版', route: '/vis/cover' },
      ],
    },
    {
      title: '视觉设计 · 动作',
      pill: 'Action',
      kicker: 'ACTION',
      items: [
        { label: '按钮', desc: '纯色动作按钮 + Material 按钮样张', route: '/vis/buttons' },
      ],
    },
    {
      title: '视觉设计 · 输入',
      pill: 'Inputs',
      kicker: 'INPUTS',
      items: [
        { label: '输入框', desc: 'Material form-field / input / select / checkbox', route: '/vis/inputs' },
        { label: '胶囊', desc: 'chip / pill / badge 的语义边界', route: '/vis/pills' },
        { label: '模态框', desc: '16px 圆角、焦点圈闭、MatDialog 样张', route: '/vis/modals' },
      ],
    },
    {
      title: '视觉设计 · 数据展示',
      pill: 'Data display',
      kicker: 'DATA DISPLAY',
      items: [
        { label: '表格', desc: '列表视图与文件表共用表头、行高、数字对齐', route: '/vis/tables' },
        { label: '空状态', desc: '集合为空 / 搜索无匹配 / 筛选后为空', route: '/vis/empty' },
      ],
    },
    {
      title: '原型组件 · 导航',
      pill: 'Navigation',
      kicker: 'NAVIGATION',
      items: [
        { label: '侧边导航', desc: '展开 224 / 收起 64 与分组折叠', route: '/vis/prototypes/components/sidebar' },
        { label: '页头', desc: 'kicker / 标题 / hint / 操作的分层页头', route: '/vis/prototypes/components/page-header' },
        { label: '目录', desc: '全文目录、窄窗速览条与滚动监听', route: '/vis/prototypes/components/toc' },
        { label: '滚动条', desc: '导航 6px / 页面 10px 的统一滚动条', route: '/vis/prototypes/components/scrollbar' },
      ],
    },
    {
      title: '原型组件 · 表面',
      pill: 'Surfaces',
      kicker: 'SURFACES',
      items: [
        { label: '资产卡片', desc: '模型 / 发现 / 工作流共用的真实组件', route: '/vis/prototypes/components/cards' },
        { label: '页面壳', desc: '内容宽与留白、面包屑层级', route: '/vis/prototypes/components/shell' },
        { label: '结构件', desc: '区块、面板与字段三层骨架', route: '/vis/prototypes/components/structure' },
        { label: '厂牌', desc: '官方 logo、家族码与兜底缩写', route: '/vis/prototypes/components/families' },
      ],
    },
    {
      title: '原型组件 · 反馈',
      pill: 'Feedback',
      kicker: 'FEEDBACK',
      items: [
        { label: '行内提示', desc: '四层反馈里的 L1 提示条', route: '/vis/prototypes/components/notice' },
        { label: '提示与来源', desc: 'Toast 表面与来源胶囊', route: '/vis/prototypes/components/feedback' },
      ],
    },
    {
      title: '原型组件 · 内容',
      pill: 'Content',
      kicker: 'CONTENT',
      items: [
        { label: '代码与搜索', desc: '深色代码面板、快捷键与搜索浮层', route: '/vis/prototypes/components/code' },
      ],
    },
    {
      title: '页面',
      pill: 'Pages',
      kicker: 'PAGE',
      items: [
        { label: '模型库', desc: '本地库 / 发现共用一套筛选与卡片', route: '/vis/prototypes/pages/models' },
        { label: '工作流', desc: '依赖、缺模型与运行状态', route: '/vis/prototypes/pages/workflows' },
        { label: '自定义节点', desc: '节点包安装、更新与依赖', route: '/vis/prototypes/pages/nodes' },
        { label: '资源管理器', desc: '目录、模型、引用关系与背景层落地', route: '/vis/prototypes/pages/resource-manager' },
        { label: '下载', desc: '来源状态、任务队列、仓库解析与权重选择', route: '/vis/prototypes/pages/downloads' },
        { label: '错误与反馈', desc: '空态 / 加载 / 错误 / 重试的统一层级', route: '/vis/prototypes/pages/error-states' },
        { label: '设置', desc: '外观、路径与运行偏好', route: '/vis/prototypes/pages/settings' },
        { label: '源探针', desc: '下载源可达性与测速', route: '/vis/prototypes/pages/source-probe' },
      ],
    },
    {
      title: '工具',
      pill: 'Tools',
      kicker: 'TOOL',
      items: [
        { label: '组件注册表', desc: '已注册组件、变体、Token 与展示页', route: '/vis/registry' },
        { label: 'SVG 工作台', desc: '语义标注、差异与导出', route: '/svg' },
      ],
    },
  ];
}
