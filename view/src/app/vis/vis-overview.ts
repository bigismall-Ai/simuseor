import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SectionBlockComponent } from '../ui/section-block';
import { VisualPageComponent } from './visual-page';

@Component({
  selector: 'app-vis-overview',
  standalone: true,
  imports: [SectionBlockComponent, RouterLink, VisualPageComponent],
  styleUrl: './vis-samples.scss',
  template: `
    <app-visual-page
      title="设计区总览"
      hint="视觉设计按分类拆页；样张直接渲染产品将使用的 native / Material 组件。"
    >
      <ui-section title="设计区" pill="Overview">
          <div class="card-grid">
            @for (c of categories; track c.route) {
              <a class="sample-card" [routerLink]="c.route">
                <span class="mono">{{ c.kicker }}</span>
                <b>{{ c.label }}</b>
                <span>{{ c.desc }}</span>
              </a>
            }
          </div>
        </ui-section>
    </app-visual-page>
  `,
})
export class VisOverviewComponent {
  readonly categories = [
    { kicker: 'BRAND', label: '标识', desc: '组合标与图标落位', route: '/vis/brand' },
    { kicker: 'BRAND', label: '色彩', desc: '晨雾朦胧 / 极光视界两套色板与角色映射', route: '/vis/color' },
    { kicker: 'BRAND', label: '封面与纹样', desc: '家族色封面、纹样变体与照片蒙版', route: '/vis/cover' },
    { kicker: 'BRAND', label: '背景', desc: '页面 / 侧栏 / 面板 / 卡片 / 内嵌五级层与光晕', route: '/vis/background' },
    { kicker: 'BRAND', label: '图标', desc: '24px 描边图标集与 MatIcon 用法', route: '/vis/icons' },
    { kicker: 'BRAND', label: '布局', desc: '页面骨架、两栏拆分与 --layout-* 变量', route: '/vis/layout' },
    { kicker: 'BRAND', label: '圆角', desc: '28px 面板 / 24px 卡片 / 16px 列表 / 999px 胶囊', route: '/vis/radius' },
    { kicker: 'COMPONENT', label: '按钮', desc: '纯色动作按钮 + Material 按钮样张', route: '/vis/buttons' },
    { kicker: 'COMPONENT', label: '输入框', desc: 'Material form-field / input / select / checkbox', route: '/vis/inputs' },
    { kicker: 'COMPONENT', label: '胶囊', desc: 'chip / pill / badge 的语义边界', route: '/vis/pills' },
    { kicker: 'COMPONENT', label: '表格', desc: '列表视图与文件表共用表头、行高、数字对齐', route: '/vis/tables' },
    { kicker: 'COMPONENT', label: '空状态', desc: '集合为空 / 搜索无匹配 / 筛选后为空', route: '/vis/empty' },
    { kicker: 'COMPONENT', label: '模态框', desc: '16px 圆角、焦点圈闭、MatDialog 样张', route: '/vis/modals' },
    { kicker: 'PROTOTYPE · 外壳', label: '侧边导航', desc: '展开 224 / 收起 64 与分组折叠', route: '/vis/prototypes/components/sidebar' },
    { kicker: 'PROTOTYPE · 外壳', label: '页头', desc: 'kicker / 标题 / hint / 操作的分层页头', route: '/vis/prototypes/components/page-header' },
    { kicker: 'PROTOTYPE · 内容', label: '行内提示', desc: '四层反馈里的 L1 提示条', route: '/vis/prototypes/components/notice' },
    { kicker: 'PROTOTYPE · 内容', label: '提示与来源', desc: 'Toast 表面与来源胶囊', route: '/vis/prototypes/components/feedback' },
    { kicker: 'PROTOTYPE · 外壳', label: '滚动条', desc: '导航 6px / 页面 10px 的统一滚动条', route: '/vis/prototypes/components/scrollbar' },
    { kicker: 'PROTOTYPE · 内容', label: '资产卡片', desc: '模型 / 发现 / 工作流共用的真实组件', route: '/vis/prototypes/components/cards' },
    { kicker: 'PROTOTYPE · 内容', label: '厂牌', desc: '官方 logo、家族码与兜底缩写', route: '/vis/prototypes/components/families' },
    { kicker: 'PAGE', label: '模型库', desc: '本地库 / 发现共用一套筛选与卡片', route: '/vis/prototypes/pages/models' },
    { kicker: 'PAGE', label: '工作流', desc: '依赖、缺模型与运行状态', route: '/vis/prototypes/pages/workflows' },
    { kicker: 'PAGE', label: '自定义节点', desc: '节点包安装、更新与依赖', route: '/vis/prototypes/pages/nodes' },
    { kicker: 'PAGE', label: '资源管理器', desc: '目录、模型、引用关系与背景层落地', route: '/vis/prototypes/pages/resource-manager' },
    { kicker: 'PAGE', label: '下载', desc: '来源状态、任务队列、仓库解析与权重选择', route: '/vis/prototypes/pages/downloads' },
    { kicker: 'PAGE', label: '错误与反馈', desc: '空态 / 加载 / 错误 / 重试的统一层级', route: '/vis/prototypes/pages/error-states' },
    { kicker: 'PAGE', label: '设置', desc: '外观、路径与运行偏好', route: '/vis/prototypes/pages/settings' },
    { kicker: 'PAGE', label: '源探针', desc: '下载源可达性与测速', route: '/vis/prototypes/pages/source-probe' },
    { kicker: 'TOOL', label: '组件注册表', desc: '已注册组件、变体、Token 与展示页', route: '/vis/registry' },
  ];
}
