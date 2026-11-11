import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { LabPreset } from './app/lab/lab-theme';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    // PrimeNG 需要 Angular 动画；对照实验页的弹层/波纹依赖它
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: LabPreset,
        options: {
          // 跟随项目现有的深色实现（ThemeService 写在 <html data-theme> 上）
          darkModeSelector: ':root[data-theme="dark"]',
        },
      },
    }),
  ],
}).catch((err) => console.error(err));
