import { Routes } from '@angular/router';
import { ComfyComponent } from './pages/comfy.component';
import { DiscoverComponent } from './pages/discover.component';
import { DownloadsComponent } from './pages/downloads.component';
import { LibraryComponent } from './pages/library.component';
import { NodeLibraryComponent } from './pages/node-library.component';
import { NodesComponent } from './pages/nodes.component';
import { SettingsComponent } from './pages/settings.component';
import { WorkflowsComponent } from './pages/workflows.component';

export const routes: Routes = [
  // 首页落在工作流：它是这个产品的主资产，下载任务只是把资产运进来的管道
  { path: '', pathMatch: 'full', redirectTo: 'workflows' },
  { path: 'downloads', component: DownloadsComponent },
  { path: 'discover', component: DiscoverComponent },
  { path: 'workflows', component: WorkflowsComponent, data: { tab: 'mine' } },
  // 发现工作流与我的工作流共用一个组件，靠路由 data 决定落哪一段；
  // 拆成两个路径是为了侧栏能各自高亮，也让「发现」有可分享的地址
  { path: 'workflows/discover', component: WorkflowsComponent, data: { tab: 'discover' } },
  { path: 'library', component: LibraryComponent },
  { path: 'nodes', component: NodesComponent },
  { path: 'nodes/installed', component: NodeLibraryComponent },
  { path: 'comfy', component: ComfyComponent },
  { path: 'settings', component: SettingsComponent },
  // 设计对照实验：两套组件体系各做一页，仅用于评估，不属于产品导航
  { path: 'lab/primeng', loadComponent: () => import('./lab/lab-primeng.component').then((m) => m.LabPrimeNgComponent) },
  { path: 'lab/tailwind', loadComponent: () => import('./lab/lab-tailwind.component').then((m) => m.LabTailwindComponent) },
  { path: '**', redirectTo: 'workflows' },
];
