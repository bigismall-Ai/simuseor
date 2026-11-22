import { Routes } from '@angular/router';
import { ComfyComponent } from './pages/comfy.component';
import { DiscoverComponent } from './pages/discover.component';
import { DownloadsComponent } from './pages/downloads.component';
import { LibraryComponent } from './pages/library.component';
import { NodeLibraryComponent } from './pages/node-library.component';
import { NodesComponent } from './pages/nodes.component';
import { ResourceManagerComponent } from './pages/resource-manager.component';
import { SettingsComponent } from './pages/settings.component';
import { WorkflowEditorComponent } from './pages/workflow-editor.component';
import { WorkflowsComponent } from './pages/workflows.component';
import { SiteShellComponent } from './shell/site-shell.component';
import { VIS_ROUTES } from './vis/vis.routes';

/**
 * 路由命名规则：`/{资源}` 是「我有的」，`/{资源}/discover` 是「去找」。
 *
 * 三类资产用同一套形状，侧栏点哪里、地址栏就是哪个资源——之前是
 * /library + /discover（模型）、/nodes + /nodes/installed（节点，发现和管理还反着）、
 * /comfy（环境管理），同一层的三个概念三套命名，看地址猜不出页面。
 *
 * 顶层是**布局**：产品页面全部挂在 SiteShellComponent 下（左侧导航 + 内容区），
 * VIS 参考页自带外壳，由 VIS_ROUTES 直接挂在顶层——两套布局互不嵌套。
 */
export const routes: Routes = [
  // 首页落在工作流：它是这个产品的主资产，下载任务只是把资产运进来的管道
  { path: '', pathMatch: 'full', redirectTo: 'workflows' },

  // ---------------- 站点外壳：产品页面 ----------------
  {
    path: '',
    component: SiteShellComponent,
    children: [
      // 工作流：资产页与发现页共用一个组件，靠路由 data 决定落哪一段
      { path: 'workflows', component: WorkflowsComponent, data: { tab: 'mine' } },
      { path: 'workflows/discover', component: WorkflowsComponent, data: { tab: 'discover' } },
      // 编辑器是全屏工作区：画布 / UI JSON / API 三视图，保存写回共享目录
      { path: 'workflows/edit', component: WorkflowEditorComponent },

      // 模型：/models 是模型库（已落盘的），/models/discover 是发现
      { path: 'models', component: LibraryComponent },
      { path: 'models/discover', component: DiscoverComponent },

      // 节点：/nodes 是节点管理（已装、启停、卸载），/nodes/discover 是发现
      { path: 'nodes', component: NodeLibraryComponent },
      { path: 'nodes/discover', component: NodesComponent },

      // 基础设施
      { path: 'downloads', component: DownloadsComponent },
      { path: 'resources', component: ResourceManagerComponent },
      { path: 'environments', component: ComfyComponent },
      { path: 'settings', component: SettingsComponent },

      // 旧地址重定向：改名后书签、外部链接、已发出的通知仍然能落到对应页面
      { path: 'library', redirectTo: 'models' },
      { path: 'discover', redirectTo: 'models/discover' },
      { path: 'nodes/installed', redirectTo: 'nodes' },
      { path: 'comfy', redirectTo: 'environments' },
    ],
  },

  // ---------------- VIS 外壳：参考页自带布局 ----------------
  // 展开在顶层，不进 SiteShell 的 children——否则原型页会被套进产品侧栏。
  ...VIS_ROUTES,

  { path: '**', redirectTo: 'workflows' },
];
