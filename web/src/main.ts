import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    // PrimeNG 需要 Angular 动画；对照实验页的弹层/波纹依赖它
    provideAnimationsAsync(),
    // 这里没有 providePrimeNG：PrimeNG 的主题运行时（primeng/config →
    // primeng/base → @primeuix/styled）连同 Aura preset 一起约 66 KB，
    // 只要在 main.ts 静态引用它，就等于每张产品页面都为对照实验页付费。
    // 主题改到 lab 路由上按需装载，见 app.routes.ts 的 ensurePrimeNgTheme。
  ],
}).catch((err) => console.error(err));
