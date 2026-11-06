import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'md-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('light');

  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial: Theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    this.apply(initial, false);
  }

  toggle(): void {
    this.apply(this.theme() === 'dark' ? 'light' : 'dark', true);
  }

  private apply(theme: Theme, persist: boolean): void {
    this.theme.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) localStorage.setItem(STORAGE_KEY, theme);
  }
}
