import { EnvironmentInjector, inject } from '@angular/core';
import { CanActivateFn, Routes } from '@angular/router';
import { ComfyComponent } from './pages/comfy.component';
import { DiscoverComponent } from './pages/discover.component';
import { DownloadsComponent } from './pages/downloads.component';
import { LibraryComponent } from './pages/library.component';
import { NodeLibraryComponent } from './pages/node-library.component';
import { NodesComponent } from './pages/nodes.component';
import { SettingsComponent } from './pages/settings.component';
import { WorkflowEditorComponent } from './pages/workflow-editor.component';
import { WorkflowsComponent } from './pages/workflows.component';

/**
 * PrimeNG 主题按需装载：只有真的进 /lab/primeng 时才把主题运行时和 Aura preset 拉下来。
 *
 * 为什么不能留在 main.ts：providePrimeNG 一旦出现在根级 providers 里，
 * primeng/config → primeng/base → @primeuix/styled 这条链就进首屏 chunk（约 66 KB），
 * 而 Aura preset 又被 main 静态引着——每张产品页面都在为一张对照实验页付费。
 *
 * 为什么用 guard 而不是路由级 providers：路由级 providers 里的 APP_INITIALIZER
 * 不会再执行（应用早就初始化完了），PrimeNG 的主题得有一个「此刻真正生效」的时机。
 * guard 早于组件实例化，组件 ngOnInit 加载样式时主题已经就绪，不会出现无样式的一帧。
 *
 * 两个包都必须是动态 import —— 任何一处静态引用都会把它们拽回首屏。
 */
const ensurePrimeNgTheme: CanActivateFn = async () => {
  const injector = inject(EnvironmentInjector);
  const [{ PrimeNG }, { LabPreset }] = await Promise.all([
    import('primeng/config'),
    import('./lab/lab-theme'),
  ]);
  const theme = {
    preset: LabPreset,
    options: {
      // 跟随项目现有的深色实现（ThemeService 写在 <html data-theme> 上）
      darkModeSelector: ':root[data-theme="dark"]',
    },
  };
  const primeNg = injector.get(PrimeNG);
  primeNg.setConfig({ theme });
  // PrimeNG 的 theme signal 靠 effect 异步落地，effect 还没 flush 时组件就读不到主题。
  // 这里同步落一次：Theme 是 @primeuix/styled 里的单例，组件 ngOnInit 读的就是它。
  primeNg.onThemeChange(theme);
  return true;
};

/**
 * 路由命名规则：`/{资源}` 是「我有的」，`/{资源}/discover` 是「去找」。
 *
 * 三类资产用同一套形状，侧栏点哪里、地址栏就是哪个资源——之前是
 * /library + /discover（模型）、/nodes + /nodes/installed（节点，发现和管理还反着）、
 * /comfy（环境管理），同一层的三个概念三套命名，看地址猜不出页面。
 */
export const routes: Routes = [
  // 首页落在工作流：它是这个产品的主资产，下载任务只是把资产运进来的管道
  { path: '', pathMatch: 'full', redirectTo: 'workflows' },

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
  { path: 'environments', component: ComfyComponent },
  { path: 'settings', component: SettingsComponent },

  // 旧地址重定向：改名后书签、外部链接、已发出的通知仍然能落到对应页面
  { path: 'library', redirectTo: 'models' },
  { path: 'discover', redirectTo: 'models/discover' },
  { path: 'nodes/installed', redirectTo: 'nodes' },
  { path: 'comfy', redirectTo: 'environments' },

  // 设计对照实验：两套组件体系各做一页，仅用于评估，不属于产品导航
  // canActivate 负责把 PrimeNG 主题装上——guard 早于组件实例化，样式不会晚一拍
  {
    path: 'lab/primeng',
    canActivate: [ensurePrimeNgTheme],
    loadComponent: () => import('./lab/lab-primeng.component').then((m) => m.LabPrimeNgComponent),
  },
  { path: 'lab/tailwind', loadComponent: () => import('./lab/lab-tailwind.component').then((m) => m.LabTailwindComponent) },
  { path: '**', redirectTo: 'workflows' },
];
