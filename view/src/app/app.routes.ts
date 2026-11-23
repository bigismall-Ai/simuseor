import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'vis' },
  { path: 'vis', loadChildren: () => import('./vis/vis.routes').then((m) => m.VIS_ROUTES) },
  { path: 'svg', loadChildren: () => import('./svg/svg.routes').then((m) => m.SVG_ROUTES) },
  { path: '**', redirectTo: 'vis' },
];
