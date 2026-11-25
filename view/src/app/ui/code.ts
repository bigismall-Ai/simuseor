import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { KbdComponent } from './kbd';
import { UiIconModule } from './material';

/**
 * 代码块：深浅色主题下都是深色面板。
 *
 * 结构固定为「标题栏 + 可滚动正文」：标题栏放标题 / 语言和复制按钮，
 * 正文最高 `--ui-code-max-h`（400px），超出后纵向滚动，长行横向滚动。
 *
 * 复制按钮带 `Ctrl/⌘+C` 提示；≤640 窄窗只留按钮，提示隐藏。
 * 用法：`<ui-code title="install.sh" lang="bash" [code]="snippet" />`
 */
@Component({
  selector: 'ui-code',
  imports: [KbdComponent, UiIconModule],
  host: {
    // `lang` 输入是代码语言标签（bash / json），不是 HTML 的 lang 属性：
    // 不要让它落成 `lang="bash"`，否则会被当成无效语言标记。
    '[attr.lang]': 'null',
  },
  template: `
    <div class="panel">
      @if (title() || lang() || copyable()) {
        <div class="head">
          <span class="title">
            @if (title()) {
              <b>{{ title() }}</b>
            }
            @if (lang()) {
              <span class="lang">{{ lang() }}</span>
            }
          </span>
          @if (copyable()) {
            <button
              class="copy"
              type="button"
              [attr.aria-label]="copied() ? '已复制代码' : '复制代码'"
              (click)="copy()"
            >
              <mat-icon
                [svgIcon]="'app:' + (copied() ? 'check' : 'copy')"
                aria-hidden="true"
              ></mat-icon>
              <span class="copy-text">{{ copied() ? '已复制' : '复制' }}</span>
              @if (hint()) {
                <span class="hint"><ui-kbd [keys]="hintKeys()" /></span>
              }
            </button>
          }
        </div>
      }
      <div class="body ui-scrollbar" [style.maxHeight]="maxHeight()">
        <pre><code>{{ code() }}</code></pre>
      </div>
      <span class="sr" role="status">{{ copied() ? '代码已复制到剪贴板' : '' }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .panel {
      overflow: hidden;
      border: 1px solid var(--ui-code-line);
      border-radius: var(--ui-code-radius);
      background: var(--ui-code-bg);
      box-shadow: var(--ui-shadow);
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ui-space-2);
      min-height: var(--ui-code-head-h);
      padding: 0 var(--ui-space-2) 0 var(--ui-space-4);
      border-bottom: 1px solid var(--ui-code-line);
      background: var(--ui-code-head-bg);
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--ui-space-2);
      min-width: 0;
      color: var(--ui-code-ink);
      font-size: var(--ui-text-sm);
    }

    .title b {
      overflow: hidden;
      font-weight: var(--ui-weight-semibold);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .lang {
      flex: none;
      color: var(--ui-code-muted);
      font: 500 var(--ui-text-xs)/1 var(--ui-font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .copy {
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-1);
      height: var(--ui-h-sm);
      padding: 0 var(--ui-space-2);
      border: 1px solid transparent;
      border-radius: var(--ui-radius-xs);
      background: none;
      color: var(--ui-code-muted);
      font: 500 var(--ui-text-xs)/1 var(--ui-font-body);
      cursor: pointer;
      transition:
        background 0.15s ease,
        color 0.15s ease,
        border-color 0.15s ease;
    }

    .copy:hover {
      border-color: var(--ui-code-line);
      background: rgb(255 255 255 / 0.06);
      color: var(--ui-code-ink);
    }

    .copy:focus-visible {
      outline: 2px solid var(--ui-accent);
      outline-offset: -2px;
    }

    .copy mat-icon {
      width: var(--icon-inline);
      height: var(--icon-inline);
      color: inherit;
    }

    .hint {
      display: inline-flex;
      align-items: center;
      margin-left: var(--ui-space-1);
      --kbd-bg: rgb(255 255 255 / 0.07);
      --kbd-line: rgb(255 255 255 / 0.16);
      --kbd-ink: var(--ui-code-muted);
      --kbd-shadow: 0 -1px 0 rgb(0 0 0 / 0.5) inset;
    }

    .body {
      overflow: auto;
      overscroll-behavior: contain;
    }

    pre {
      margin: 0;
      padding: var(--ui-space-3) var(--ui-space-4);
      color: var(--ui-code-ink);
      font: 400 var(--ui-code-size)/1.7 var(--ui-font-mono);
      tab-size: 2;
    }

    code {
      white-space: pre;
    }

    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /* 标题栏提示属于「鼠标 / 键盘辅助」，窄窗只保留复制按钮 */
    @media (max-width: 640px) {
      .hint,
      .copy-text {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .copy {
        transition: none;
      }
    }
  `,
})
export class CodeComponent {
  readonly title = input('');
  readonly lang = input('');
  readonly code = input('');
  readonly copyable = input(true);
  /** 正文最大高度；默认取 `--ui-code-max-h`。 */
  readonly maxHeight = input('var(--ui-code-max-h)');
  /** 是否显示 Ctrl/⌘+C 提示；只在复制按钮存在时有意义。 */
  readonly hint = input(true);

  readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);

  readonly hintKeys = computed(() => [this.isApple() ? '⌘' : 'Ctrl', 'C']);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  async copy(): Promise<void> {
    const text = this.code();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板被拒绝时不假装成功，交给 aria-live 保持静默即可
      return;
    }
    this.copied.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 1500);
  }

  private isApple(): boolean {
    return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  }
}
