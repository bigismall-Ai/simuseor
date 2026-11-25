import { Routes } from '@angular/router';
import { VisBackgroundComponent } from './vis-background';
import { VisBrandComponent } from './vis-brand';
import { VisButtonsComponent } from './vis-buttons';
import { VisColorComponent } from './vis-color';
import { VisCoverComponent } from './vis-cover';
import { VisEmptyComponent } from './vis-empty';
import { VisIconsComponent } from './vis-icons';
import { VisLayoutComponent } from './vis-layout';
import { VisInputsComponent } from './vis-inputs';
import { VisModalsComponent } from './vis-modals';
import { VisOverviewComponent } from './vis-overview';
import { VisPillsComponent } from './vis-pills';
import { VisRadiusComponent } from './vis-radius';
import { VisRegistryComponent } from './vis-registry';
import { VisShellComponent } from './vis-shell';
import { ComponentApiPage } from './component-api';
import { VisTablesComponent } from './vis-tables';
import { VisTypographyComponent } from './vis-typography';
import { VisSpacingComponent } from './vis-spacing';
import { VisElevationComponent } from './vis-elevation';
import { VisMotionComponent } from './vis-motion';
import { VisThemeTokensComponent } from './vis-theme-tokens';
import { ProtoCardsComponent } from './prototypes/cards';
import { ProtoCodeComponent } from './prototypes/components/code/code';
import { ProtoFamiliesComponent } from './prototypes/components/families/families';
import { ProtoFeedbackComponent } from './prototypes/components/feedback/feedback';
import { ProtoNoticeComponent } from './prototypes/components/notice/notice';
import { ProtoPageHeaderComponent } from './prototypes/components/page-header/page-header';
import { ProtoScrollbarComponent } from './prototypes/components/scrollbar/scrollbar';
import { ProtoShellComponent } from './prototypes/components/shell/shell';
import { ProtoStructureComponent } from './prototypes/components/structure/structure';
import { ProtoSidebarComponent } from './prototypes/components/sidebar/sidebar';
import { ProtoTocComponent } from './prototypes/components/toc/toc';
import { ProtoDownloadsComponent } from './prototypes/pages/downloads/downloads';
import { ProtoErrorStatesComponent } from './prototypes/pages/error-states/error-states';
import { ProtoSettingsComponent } from './prototypes/pages/settings/settings';
import { ProtoSourceProbeComponent } from './prototypes/pages/source-probe/source-probe';
import { ProtoModelsComponent } from './prototypes/pages/models/models';
import { ProtoWorkflowsComponent } from './prototypes/pages/workflows/workflows';
import { ProtoNodesComponent } from './prototypes/pages/nodes/nodes';
import { ProtoResourceManagerComponent } from './prototypes/resource-manager';

export const VIS_ROUTES: Routes = [
  {
    path: '',
    component: VisShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: VisOverviewComponent, title: 'VIS · 总览' },
      { path: 'brand', component: VisBrandComponent, title: 'VIS · 标识' },
      { path: 'color', component: VisColorComponent, title: 'VIS · 色彩' },
      { path: 'cover', component: VisCoverComponent, title: 'VIS · 封面与纹样' },
      { path: 'background', component: VisBackgroundComponent, title: 'VIS · 背景' },
      { path: 'layout', component: VisLayoutComponent, title: 'VIS · 布局' },
      { path: 'icons', component: VisIconsComponent, title: 'VIS · 图标' },
      { path: 'buttons', component: VisButtonsComponent, title: 'VIS · 按钮' },
      { path: 'inputs', component: VisInputsComponent, title: 'VIS · 输入框' },
      { path: 'radius', component: VisRadiusComponent, title: 'VIS · 圆角' },
      { path: 'typography', component: VisTypographyComponent, title: 'VIS · 字体与排版' },
      { path: 'spacing', component: VisSpacingComponent, title: 'VIS · 间距' },
      { path: 'elevation', component: VisElevationComponent, title: 'VIS · 层级与阴影' },
      { path: 'motion', component: VisMotionComponent, title: 'VIS · 动效' },
      { path: 'theme-tokens', component: VisThemeTokensComponent, title: 'VIS · 主题 Token' },
      { path: 'pills', component: VisPillsComponent, title: 'VIS · 胶囊' },
      { path: 'empty', component: VisEmptyComponent, title: 'VIS · 空状态' },
      { path: 'tables', component: VisTablesComponent, title: 'VIS · 表格' },
      { path: 'registry', component: VisRegistryComponent, title: 'VIS · 组件注册表' },
      { path: 'components/:selector', component: ComponentApiPage, title: 'VIS · 组件 API' },
      { path: 'modals', component: VisModalsComponent, title: 'VIS · 模态框' },
      { path: 'cards', redirectTo: 'prototypes/components/cards', pathMatch: 'full' },
      { path: 'prototypes/cards', redirectTo: 'prototypes/components/cards', pathMatch: 'full' },
      { path: 'prototypes/resource-manager', redirectTo: 'prototypes/pages/resource-manager', pathMatch: 'full' },
      { path: 'prototypes/downloads', redirectTo: 'prototypes/pages/downloads', pathMatch: 'full' },
      { path: 'prototypes/error-states', redirectTo: 'prototypes/pages/error-states', pathMatch: 'full' },
      { path: 'prototypes/settings', redirectTo: 'prototypes/pages/settings', pathMatch: 'full' },
      { path: 'prototypes/source-probe', redirectTo: 'prototypes/pages/source-probe', pathMatch: 'full' },
      {
        path: 'prototypes/components/cards',
        component: ProtoCardsComponent,
        title: 'VIS 原型组件 · 资产卡片',
      },
      {
        path: 'prototypes/components/card-design',
        redirectTo: 'prototypes/components/cards',
      },
      {
        path: 'prototypes/components/sidebar',
        component: ProtoSidebarComponent,
        title: 'VIS 原型组件 · 侧边导航',
      },
      {
        path: 'prototypes/components/structure',
        component: ProtoStructureComponent,
        title: 'VIS · 结构件',
      },
      {
        path: 'prototypes/components/scrollbar',
        component: ProtoScrollbarComponent,
        title: 'VIS 原型组件 · 滚动条',
      },
      {
        path: 'prototypes/components/page-header',
        component: ProtoPageHeaderComponent,
        title: 'VIS 原型组件 · 页头',
      },
      {
        path: 'prototypes/components/shell',
        component: ProtoShellComponent,
        title: 'VIS 原型组件 · 页面壳',
      },
      {
        path: 'prototypes/components/toc',
        component: ProtoTocComponent,
        title: 'VIS 原型组件 · 目录',
      },
      {
        path: 'prototypes/components/notice',
        component: ProtoNoticeComponent,
        title: 'VIS 原型组件 · 行内提示',
      },
      {
        path: 'prototypes/components/feedback',
        component: ProtoFeedbackComponent,
        title: 'VIS 原型组件 · 提示与来源',
      },
      {
        path: 'prototypes/components/families',
        component: ProtoFamiliesComponent,
        title: 'VIS 原型组件 · 厂牌',
      },
      {
        path: 'prototypes/components/code',
        component: ProtoCodeComponent,
        title: 'VIS 原型组件 · 代码与搜索',
      },
      {
        path: 'prototypes/pages/models',
        data: { bare: true },
        component: ProtoModelsComponent,
        title: 'VIS 原型页面 · 模型库',
      },
      {
        path: 'prototypes/pages/workflows',
        data: { bare: true },
        component: ProtoWorkflowsComponent,
        title: 'VIS 原型页面 · 工作流',
      },
      {
        path: 'prototypes/pages/nodes',
        data: { bare: true },
        component: ProtoNodesComponent,
        title: 'VIS 原型页面 · 自定义节点',
      },
      {
        path: 'prototypes/pages/resource-manager',
        data: { bare: true },
        component: ProtoResourceManagerComponent,
        title: 'VIS 原型页面 · 资源管理器',
      },
      {
        path: 'prototypes/pages/downloads',
        data: { bare: true },
        component: ProtoDownloadsComponent,
        title: 'VIS 原型页面 · 下载',
      },
      {
        path: 'prototypes/pages/error-states',
        data: { bare: true },
        component: ProtoErrorStatesComponent,
        title: 'VIS 原型页面 · 错误与反馈',
      },
      {
        path: 'prototypes/pages/settings',
        data: { bare: true },
        component: ProtoSettingsComponent,
        title: 'VIS 原型页面 · 设置',
      },
      {
        path: 'prototypes/pages/source-probe',
        data: { bare: true },
        component: ProtoSourceProbeComponent,
        title: 'VIS 原型页面 · 源探针',
      },
    ],
  },
];
