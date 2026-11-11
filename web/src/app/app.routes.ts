import { Routes } from '@angular/router';
import { ComfyComponent } from './pages/comfy.component';
import { DiscoverComponent } from './pages/discover.component';
import { DownloadsComponent } from './pages/downloads.component';
import { LibraryComponent } from './pages/library.component';
import { SettingsComponent } from './pages/settings.component';
import { WorkflowsComponent } from './pages/workflows.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'downloads' },
  { path: 'downloads', component: DownloadsComponent },
  { path: 'discover', component: DiscoverComponent },
  { path: 'workflows', component: WorkflowsComponent },
  { path: 'library', component: LibraryComponent },
  { path: 'comfy', component: ComfyComponent },
  { path: 'settings', component: SettingsComponent },
  // 设计对照实验：两套组件体系各做一页，仅用于评估，不属于产品导航
  { path: 'lab/primeng', loadComponent: () => import('./lab/lab-primeng.component').then((m) => m.LabPrimeNgComponent) },
  { path: 'lab/tailwind', loadComponent: () => import('./lab/lab-tailwind.component').then((m) => m.LabTailwindComponent) },
  { path: '**', redirectTo: 'downloads' },
];
