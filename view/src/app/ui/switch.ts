import { Component, input, model } from '@angular/core';

/**
 * 开关：立即生效的二态设置。
 *
 * 和 `ui-checkbox` 分工：开关用于改完就生效的设置项（跟随系统主题、自动校验），
 * 需要再点「保存」确认的多选用 checkbox。轨道 34px 高、10px 圆角，只换 token。
 */
@Component({
  selector: 'ui-switch',
  template: `
    <label
      class="wrap"
      [class.sm]="size() === 'sm'"
      [class.disabled]="disabled()"
    >
      <input
        class="native"
        type="checkbox"
        role="switch"
        [checked]="checked()"
        [disabled]="disabled()"
        [attr.aria-label]="ariaLabel() || null"
        (change)="onChange($event)"
      />
      <span class="track" aria-hidden="true"><span class="knob"></span></span>
      @if (label()) {
        <span class="lbl">{{ label() }}</span>
      }
    </label>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .wrap {
      --switch-h: var(--ui-h-md);
      --switch-w: var(--ui-switch-w);
      --switch-knob: var(--ui-switch-knob);

      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-2);
      cursor: pointer;
    }

    .wrap.sm {
      --switch-h: var(--ui-h-sm);
      --switch-w: var(--ui-switch-w-sm);
      --switch-knob: var(--ui-switch-knob-sm);
    }

    /* 原生 checkbox 只保留语义与焦点，视觉全部由 track / knob 承担 */
    .native {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      opacity: 0;
      font-family: var(--ui-font-body);
      overflow: hidden;
      white-space: nowrap;
      clip-path: inset(50%);
    }

    .track {
      position: relative;
      flex: none;
      width: var(--switch-w);
      height: var(--switch-h);
      /* 描边用内阴影：不占布局宽度，滑块位移才和轨道宽度对得上 */
      border-radius: var(--ui-radius-md);
      background: var(--ui-panel-3);
      box-shadow: inset 0 0 0 1px var(--ui-border);
      transition:
        background 0.18s ease,
        box-shadow 0.18s ease;
    }

    .knob {
      position: absolute;
      top: 50%;
      left: var(--ui-space-1);
      width: var(--switch-knob);
      height: var(--switch-knob);
      border-radius: var(--ui-radius-sm);
      background: var(--ui-muted);
      transform: translateY(-50%);
      transition:
        transform 0.18s ease,
        background 0.18s ease;
    }

    .native:checked + .track {
      background: var(--ui-primary);
      box-shadow: inset 0 0 0 1px var(--ui-primary);
    }

    .native:checked + .track .knob {
      background: var(--ui-on-primary);
      transform: translate(
        calc(var(--switch-w) - var(--switch-knob) - var(--ui-space-2)),
        -50%
      );
    }

    .native:focus-visible + .track {
      box-shadow:
        inset 0 0 0 1px var(--ui-border),
        var(--ui-ring);
    }

    .lbl {
      color: var(--ui-text);
      font-family: var(--ui-font-body);
      font-size: var(--ui-text-md);
      line-height: 1.4;
    }

    .disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .disabled .track {
      cursor: not-allowed;
    }
  `,
})
export class SwitchComponent {
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly label = input('');
  /** 没有可见标签时（设置行里由左侧文案说明）用它给开关一个可访问名。 */
  readonly ariaLabel = input('');
  readonly size = input<'md' | 'sm'>('md');

  onChange(event: Event): void {
    this.checked.set((event.target as HTMLInputElement).checked);
  }
}
