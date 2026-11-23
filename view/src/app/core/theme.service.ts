import { Injectable, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark';

const KEY = 'simuseor-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemePref>(this.initial());

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: ThemePref): void {
    this.theme.set(theme);
    localStorage.setItem(KEY, theme);
    this.apply(theme);
  }

  private initial(): ThemePref {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(theme: ThemePref): void {
    document.documentElement.dataset['theme'] = theme;
  }
}
