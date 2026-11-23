import { Injectable, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { APP_ICONS } from './icons';

/** 把项目自有 SVG 注册到 MatIcon 的 `app` 命名空间。 */
@Injectable({ providedIn: 'root' })
export class IconRegistryService {
  private readonly registry = inject(MatIconRegistry);
  private readonly sanitizer = inject(DomSanitizer);
  private registered = false;

  register(): void {
    if (this.registered) {
      return;
    }
    this.registered = true;

    for (const icon of APP_ICONS) {
      this.registry.addSvgIconLiteralInNamespace(
        'app',
        icon.name,
        this.sanitizer.bypassSecurityTrustHtml(icon.svg),
      );
    }
  }
}
