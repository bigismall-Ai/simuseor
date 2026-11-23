import { Component, computed, inject, input } from '@angular/core';
import { resolveFamily } from '../core/cover';
import { ThemeService } from '../core/theme.service';

/**
 * 卡片厂牌位：所有资产卡共用同一个 32×32 标识块。
 *
 * 优先级：显式 logo → 家族解析出的 logo → 家族码 / 显式码 → 工作流图标。
 * 不再由每张卡各自拼 `span.acard-mark` 的嵌套结构。
 */
@Component({
  selector: 'ui-card-mark',
  host: {
    class: 'acard-mark',
    '[attr.data-tone]': 'tone() || null',
    '[attr.title]': 'title()',
  },
  template: `
    @if (resolvedLogo()) {
      <img
        [class]="useDarkLogo() ? 'logo-dark' : 'logo-light'"
        [src]="useDarkLogo() ? resolvedLogoDark() : resolvedLogo()"
        [alt]="code() || '厂牌'"
        [style.--logo-scale]="scale()"
      />
    } @else if (resolvedCode()) {
      <span class="mark-code">{{ resolvedCode() }}</span>
    } @else if (icon() === 'workflow') {
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="6" r="2.1" />
        <circle cx="18" cy="12" r="2.1" />
        <circle cx="6" cy="18" r="2.1" />
        <path d="M8 7.2 16 10.8M8 16.8 16 13.2" />
      </svg>
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      width: var(--card-mark-size, 32px);
      height: var(--card-mark-size, 32px);
      overflow: hidden;
      border-radius: var(--card-mark-radius, 8px);
      background: color-mix(in oklab, var(--ui-card-solid) 94%, transparent);
      box-shadow: inset 0 0 0 1px var(--ui-inner-border);
      color: var(--ui-text);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .02em;
      line-height: 1;
    }

    :host-context(.acard.on-shot) {
      background: rgb(10 12 18 / .42);
      box-shadow: none;
      color: #fff;
    }

    :host-context(.acard.is-broken) {
      background: var(--ui-card-solid);
    }

    img {
      width: 24px;
      height: 24px;
      object-fit: contain;
      transform: scale(var(--logo-scale, 1));
    }

    svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .mark-code {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      padding: 0 2px;
      overflow: hidden;
      color: inherit;
      font: 600 10px/1 var(--ui-font-mono);
      letter-spacing: .02em;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    :host([data-tone='blue']) { color: color-mix(in srgb, var(--ui-accent) 72%, var(--ui-text)); }
    :host([data-tone='green']) { color: color-mix(in srgb, var(--aurora-mint) 55%, var(--ui-text)); }
    :host([data-tone='orange']) { color: color-mix(in srgb, var(--ink-accent) 72%, var(--ui-text)); }
    :host([data-tone='gray']) { color: var(--ui-muted); }
  `,
})
export class CardMarkComponent {
  /** 主模型文件名；用于解析家族 logo / 码 */
  readonly model = input('');
  readonly logo = input('');
  readonly logoDark = input('');
  readonly code = input('');
  readonly title = input('');
  readonly tone = input('');
  readonly icon = input<'workflow' | ''>('');
  readonly scale = input(1);
  /** 压在真实照片上时置 true：有反白资产就换反白版 */
  readonly onShot = input(false);

  private readonly theme = inject(ThemeService);

  private readonly spec = computed(() => (this.model() ? resolveFamily({ name: this.model() }) : null));

  readonly resolvedLogo = computed(() => this.logo() || this.spec()?.logo || '');
  readonly resolvedLogoDark = computed(() => this.logoDark() || this.spec()?.logoDark || '');
  readonly hasDark = computed(() => !!this.resolvedLogoDark());

  readonly useDarkLogo = computed(
    () => this.hasDark() && (this.onShot() || this.theme.theme() === 'dark'),
  );

  readonly resolvedCode = computed(() => {
    const code = this.code() || this.spec()?.code || '';
    return code === '—' ? '' : code;
  });
}
