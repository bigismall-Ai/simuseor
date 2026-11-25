import { AfterViewInit, Component, ElementRef, inject, input } from '@angular/core';

let seq = 0;

/**
 * 表单字段：一行说明 + 控件（控件由调用方投影进来）。
 *
 * 标签必须真的和控件关联——视觉上挨着不算。以前 `<label>` 没有 `for`，
 * 点标签不会聚焦输入框，屏幕阅读器也只念到一个孤立的「下载源」。
 * 这里自动给投影进来的第一个控件补 id 并挂到 label 上：调用点有 20 处，
 * 手写 id 一定会漏。
 */
@Component({
  selector: 'ui-field',
  template: `
    <div class="ui-field">
      @if (label()) {
        <!-- label 的 for 由 ngAfterViewInit 补上（投影控件拿不到静态 id），静态分析看不到 -->
        <!-- eslint-disable-next-line @angular-eslint/template/label-has-associated-control -->
        <label class="field-label">{{ label() }}</label>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .ui-field {
      min-width: 0;
    }

    .ui-field .field-label {
      display: block;
      margin-bottom: var(--ui-field-label-gap);
      color: var(--ui-muted);
      font-size: var(--ui-text-sm);
      font-weight: 500;
      letter-spacing: 0.01em;
    }
  `,
})
export class FieldComponent implements AfterViewInit {
  readonly label = input('');

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  ngAfterViewInit(): void {
    const root = this.host.nativeElement;
    // 只认我们自己渲的那个 label：投影内容里还有单选/复选的 <label>，
    // 它们是包着 input 的隐式关联，不该被塞一个 for
    const label = root.querySelector('label.field-label');
    const control = root.querySelector<HTMLElement>('input, select, textarea');
    if (!label || !control) return;
    if (!control.id) control.id = `fld-${++seq}`;
    label.setAttribute('for', control.id);
  }
}
