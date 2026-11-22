import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';

/**
 * 应用根：只负责挂 <router-outlet>。
 *
 * 布局不属于根——产品页与 VIS 参考页各有自己的外壳，由路由决定挂哪一套
 * （见 app.routes.ts 的顶层 layout 路由）。
 *
 * ThemeService 仍然在根注入：它把 data-theme 写到 <html> 上，
 * 这份状态是全局的，不能因为当前挂的是哪套外壳而漏掉（例如 VIS 页不开产品侧栏，
 * 但深色主题照样得生效）。
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {
  /** 只为在启动时实例化主题服务；模板不读它 */
  private readonly theme = inject(ThemeService);
}
