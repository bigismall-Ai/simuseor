import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
/** 用户选择：具体两档，或跟随系统 */
export type ThemePref = Theme | 'system';

const STORAGE_KEY = 'md-theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * 主题：用户存的是「偏好」（浅色 / 深色 / 跟随系统），实际生效的是解析后的两档。
 *
 * 以前只有两态，未设置时按系统一次性决定、之后不再跟随——系统在日落时切深色，
 * 应用还停在浅色。现在把「跟随系统」当成一个正式选项存下来，系统变化时实时跟上。
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** 用户选择 */
  readonly pref = signal<ThemePref>('system');
  /** 实际生效（模板只看这个） */
  readonly theme = signal<Theme>('light');

  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    this.pref.set(saved === 'light' || saved === 'dark' ? saved : 'system');
    this.sync();
    darkQuery().addEventListener('change', () => {
      if (this.pref() === 'system') this.sync();
    });
  }

  setPref(pref: ThemePref): void {
    this.pref.set(pref);
    localStorage.setItem(STORAGE_KEY, pref);
    this.sync();
  }

  /** T 键与旧调用点：在明暗之间翻转，并把偏好落成具体值 */
  toggle(): void {
    this.setPref(this.theme() === 'dark' ? 'light' : 'dark');
  }

  private sync(): void {
    const pref = this.pref();
    const resolved: Theme = pref === 'system' ? (darkQuery().matches ? 'dark' : 'light') : pref;
    this.theme.set(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }
}
