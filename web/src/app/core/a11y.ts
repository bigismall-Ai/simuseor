/**
 * 无障碍小工具：弹层里的焦点管理与 Tab 环绕。
 *
 * 为什么需要：弹层打开后如果焦点还在背后的页面上，键盘用户 Tab 十几次都进不去，
 * 屏幕阅读器也读不到「现在是哪个对话框」。原生 `<dialog>` 自带这层行为，
 * 但我们用的是 div + position:fixed（样式可控），所以要自己补。
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 可见性判断：`offsetParent === null` 会漏掉 position:fixed 的元素，所以两者都看。 */
function visible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return el.offsetParent !== null || style.position === 'fixed';
}

export function focusFirst(root: HTMLElement | null | undefined): void {
  if (!root) return;
  const target = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visible) ?? root;
  target.focus?.({ preventScroll: true });
}

/**
 * 把 Tab 关在容器里。绑到容器的 `(keydown.tab)` 上即可，不要绑到 document ——
 * 那样会拦掉页面上其它地方的正常 Tab。
 */
export function trapTab(event: Event, root: HTMLElement | null | undefined): void {
  const key = (event as KeyboardEvent).key;
  if (!root || key !== 'Tab') return;
  const shift = (event as KeyboardEvent).shiftKey;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !root.contains(active);
  if (shift && (outside || active === first)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!shift && (outside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}
