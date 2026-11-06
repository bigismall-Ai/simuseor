import { Routes } from '@angular/router';
import { ComfyComponent } from './pages/comfy.component';
import { DiscoverComponent } from './pages/discover.component';
import { DownloadsComponent } from './pages/downloads.component';
import { LibraryComponent } from './pages/library.component';
import { SettingsComponent } from './pages/settings.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'downloads' },
  { path: 'downloads', component: DownloadsComponent },
  { path: 'discover', component: DiscoverComponent },
  { path: 'library', component: LibraryComponent },
  { path: 'comfy', component: ComfyComponent },
  { path: 'settings', component: SettingsComponent },
  { path: '**', redirectTo: 'downloads' },
];
