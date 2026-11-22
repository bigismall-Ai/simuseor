import { Routes } from '@angular/router';
import { VisOverviewComponent } from './overview/overview.component';
import { VisShellComponent } from './vis-shell.component';

/**
 * VIS 设计区路由（/vis）。
 *
 * 顶层由 app.routes.ts 展开 `...VIS_ROUTES`；这里自带 `vis` 段，
 * 父级不要把它再包进 `path: 'vis'` 的 children 里。
 *
 * 「视觉设计」按分类拆成一页一类：总览 / 标识 / 色彩 / 按钮 / 输入框 /
 * 圆角 / 胶囊 / 空状态 / 表格 / 模态框 / 卡片。
 * 旧地址 `/vis/visual` 重定向到总览，书签不失效。
 */
export const VIS_ROUTES: Routes = [
  {
    path: 'vis',
    component: VisShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: VisOverviewComponent },

      { path: 'visual', pathMatch: 'full', redirectTo: 'visual/overview' },
      {
        path: 'visual/overview',
        loadComponent: () =>
          import('./visual/visual-overview.component').then((m) => m.VisualOverviewComponent),
      },
      {
        path: 'visual/brand',
        loadComponent: () =>
          import('./visual/visual-brand.component').then((m) => m.VisualBrandComponent),
      },
      {
        path: 'visual/color',
        loadComponent: () =>
          import('./visual/visual-color.component').then((m) => m.VisualColorComponent),
      },
      {
        path: 'visual/buttons',
        loadComponent: () =>
          import('./visual/visual-buttons.component').then((m) => m.VisualButtonsComponent),
      },
      {
        path: 'visual/inputs',
        loadComponent: () =>
          import('./visual/visual-inputs.component').then((m) => m.VisualInputsComponent),
      },
      {
        path: 'visual/radius',
        loadComponent: () =>
          import('./visual/visual-radius.component').then((m) => m.VisualRadiusComponent),
      },
      {
        path: 'visual/pills',
        loadComponent: () =>
          import('./visual/visual-pills.component').then((m) => m.VisualPillsComponent),
      },
      {
        path: 'visual/empty',
        loadComponent: () =>
          import('./visual/visual-empty.component').then((m) => m.VisualEmptyComponent),
      },
      {
        path: 'visual/tables',
        loadComponent: () =>
          import('./visual/visual-tables.component').then((m) => m.VisualTablesComponent),
      },
      {
        path: 'visual/modals',
        loadComponent: () =>
          import('./visual/visual-modals.component').then((m) => m.VisualModalsComponent),
      },
      {
        path: 'visual/cards',
        loadComponent: () =>
          import('./visual/visual-cards.component').then((m) => m.VisualCardsComponent),
      },

      {
        path: 'prototypes/resource-manager',
        loadComponent: () =>
          import('./prototypes/resource-manager/resource-manager.component').then(
            (m) => m.ResourceManagerPrototypeComponent,
          ),
      },
      {
        path: 'prototypes/downloads',
        loadComponent: () =>
          import('./prototypes/downloads/downloads.component').then(
            (m) => m.DownloadsPrototypeComponent,
          ),
      },
      {
        path: 'prototypes/error-states',
        loadComponent: () =>
          import('./prototypes/error-states/error-states.component').then(
            (m) => m.ErrorStatesPrototypeComponent,
          ),
      },
      {
        path: 'prototypes/settings',
        loadComponent: () =>
          import('./prototypes/settings/settings.component').then(
            (m) => m.SettingsPrototypeComponent,
          ),
      },
      {
        path: 'prototypes/source-probe',
        loadComponent: () =>
          import('./prototypes/source-probe/source-probe.component').then(
            (m) => m.SourceProbePrototypeComponent,
          ),
      },
    ],
  },
];
