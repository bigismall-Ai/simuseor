import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { SvgBox, SvgPick } from './core/svg-types';
import type { ParsedPath, SimplePoint } from './core/svg-path';
import { moveAnchor, parsePath, parsePoints, serializePath, serializePoints } from './core/svg-path';

const NS = 'http://www.w3.org/2000/svg';
const PICK_ATTRS = [
  'id',
  'fill',
  'stroke',
  'stroke-width',
  'fill-rule',
  'opacity',
  'transform',
  'class',
  'd',
  'points',
  'href',
];

type Background = 'checker' | 'light' | 'dark';
export type SvgTool = 'select' | 'pen';

interface PenNode {
  x: number;
  y: number;
  out: SimplePoint | null;
  in: SimplePoint | null;
}

interface ElementDrag {
  kind: 'element';
  el: Element;
  target: string;
  start: SimplePoint;
  startClient: SimplePoint;
  originalTransform: string;
}

interface PathDrag {
  kind: 'path';
  el: Element;
  target: string;
  start: SimplePoint;
  offset: SimplePoint;
  inverse: DOMMatrix | null;
  original: string;
  model: ParsedPath;
  anchorIndex: number;
}

interface PointsDrag {
  kind: 'points';
  el: Element;
  target: string;
  start: SimplePoint;
  offset: SimplePoint;
  inverse: DOMMatrix | null;
  original: string;
  points: SimplePoint[];
  anchorIndex: number;
}

type Drag = ElementDrag | PathDrag | PointsDrag;

/**
 * SVG 舞台：渲染、缩放、选中、拖拽、锚点、钢笔。
 * 所有编辑结果通过 output 交给上层走补丁管线，这里只做即时反馈。
 */
@Component({
  selector: 'app-svg-stage',
  template: `
    <div class="stage" [class.is-checker]="background() === 'checker'" [class.is-light]="background() === 'light'" [class.is-dark]="background() === 'dark'" [class.is-pen]="tool() === 'pen'">
      <div class="zoom-bar">
        <button type="button" title="缩小" (click)="zoomBy(1 / 1.25)">−</button>
        <button type="button" class="pct" title="适应窗口" (click)="fit()">{{ zoomLabel() }}</button>
        <button type="button" title="放大" (click)="zoomBy(1.25)">+</button>
        <span class="sep"></span>
        <button type="button" title="按 viewBox 用户单位 1:1" (click)="actual()">1:1</button>
        <span class="sep"></span>
        <button type="button" title="切换底色" (click)="cycleBackground()">{{ backgroundLabel() }}</button>
        <button type="button" title="显示选中框" [class.on]="showBox()" (click)="showBox.set(!showBox())">框</button>
      </div>

      <div
        class="viewport"
        #viewport
        [style.cursor]="effectiveCursor()"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerCancel($event)"
        (pointerleave)="onLeave()"
        (dblclick)="onDoubleClick($event)"
      >
        <div class="zoom" [style.width.px]="base().width * zoom()" [style.height.px]="base().height * zoom()">
          <div
            class="doc"
            #doc
            [style.width.px]="base().width"
            [style.height.px]="base().height"
            [style.transform]="'scale(' + zoom() + ')'"
          ></div>
        </div>
      </div>

      <div class="hover-tag" [class.hidden]="!hoverLabel()" [style.transform]="'translate(' + cursor().x + 'px,' + cursor().y + 'px)'">
        {{ hoverLabel() }}
      </div>

      <p class="stage-hint">{{ hint() }}</p>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; min-height: 0; }
    .stage {
      position: relative;
      height: 100%;
      min-height: 0;
      border-radius: var(--ui-radius-card);
      border: 1px solid var(--ui-border-2);
      overflow: hidden;
      background: color-mix(in srgb, var(--ui-text) 8%, var(--ui-bg));
    }
    .stage.is-checker .doc {
      background-color: var(--ink-paper);
      background-image:
        linear-gradient(45deg, color-mix(in srgb, var(--ink-ink) 8%, transparent) 25%, transparent 25%),
        linear-gradient(-45deg, color-mix(in srgb, var(--ink-ink) 8%, transparent) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--ink-ink) 8%, transparent) 75%),
        linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--ink-ink) 8%, transparent) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
    .stage.is-light .doc { background: var(--ink-paper); }
    .stage.is-dark .doc { background: var(--ink-ink); }
    .stage.is-pen .viewport { cursor: crosshair; }

    .zoom-bar {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--ui-overlay) 88%, transparent);
      border: 1px solid var(--ui-border-2);
      box-shadow: var(--ui-shadow);
      backdrop-filter: blur(8px);
    }
    .zoom-bar button {
      min-width: 26px;
      height: 24px;
      padding: 0 7px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--ui-text);
      font: 500 11px/1 var(--ui-font-mono);
      cursor: pointer;
    }
    .zoom-bar button:hover { background: var(--ui-panel-3); }
    .zoom-bar button.on { background: var(--ui-text); color: var(--ui-bg); }
    .zoom-bar .pct { min-width: 54px; }
    .zoom-bar .sep { width: 1px; height: 14px; margin: 0 2px; background: var(--ui-border-2); }

    .viewport {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      overflow: auto;
      padding: 46px 24px 34px;
      cursor: default;
      touch-action: none;
      user-select: none;
    }
    .zoom { position: relative; flex: none; }
    .doc { position: absolute; top: 0; left: 0; transform-origin: top left; }

    .hover-tag {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 4;
      padding: 2px 7px;
      border-radius: 6px;
      background: var(--ui-text);
      color: var(--ui-bg);
      font: 500 10.5px/1.5 var(--ui-font-mono);
      pointer-events: none;
      white-space: nowrap;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hover-tag.hidden { display: none; }

    .stage-hint {
      position: absolute;
      right: 12px;
      bottom: 9px;
      margin: 0;
      color: var(--ui-muted);
      font-size: 10.5px;
      pointer-events: none;
    }
  `,
})
export class SvgStageComponent implements OnDestroy {
  readonly svgText = input.required<string>();
  readonly selection = input<SvgPick | null>(null);
  readonly tool = input<SvgTool>('select');
  readonly penColor = input('#b95e4e');

  readonly picked = output<SvgPick | null>();
  readonly moved = output<{ target: string; dx: number; dy: number }>();
  readonly geometry = output<{ target: string; kind: 'points' | 'path'; value: string }>();
  readonly pathCreated = output<{ d: string }>();

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly docHost = viewChild<ElementRef<HTMLDivElement>>('doc');

  readonly zoom = signal(1);
  readonly background = signal<Background>('light');
  readonly showBox = signal(true);
  readonly base = signal({ width: 640, height: 420 });
  readonly cursor = signal({ x: 0, y: 0 });
  readonly hoverLabel = signal('');
  readonly pointerMode = signal<'default' | 'move' | 'grab' | 'grabbing'>('default');

  private svgEl: SVGSVGElement | null = null;
  private overlay: SVGSVGElement | null = null;
  private hoverRect: SVGRectElement | null = null;
  private selRect: SVGRectElement | null = null;
  private selected: Element | null = null;
  private anchorGroup: SVGGElement | null = null;
  private penGroup: SVGGElement | null = null;
  private drag: Drag | null = null;
  private penNodes: PenNode[] = [];
  private penDrag: { index: number } | null = null;
  private penCursor: SimplePoint | null = null;
  private observer: ResizeObserver | null = null;
  private pan: { x: number; y: number; left: number; top: number } | null = null;
  private spaceDown = false;

  readonly effectiveCursor = computed<'default' | 'move' | 'grab' | 'grabbing' | 'crosshair'>(() =>
    this.tool() === 'pen' ? 'crosshair' : this.pointerMode(),
  );

  readonly zoomLabel = (): string => {
    const vb = this.svgEl?.viewBox.baseVal;
    const base = this.base();
    const actual = vb && vb.width > 0 && base.width > 0 ? (this.zoom() * base.width) / vb.width : this.zoom();
    return `${Math.round(actual * 100)}%`;
  };
  readonly hint = (): string =>
    this.tool() === 'pen'
      ? '钢笔：点击加点 · 按下拖动拉手柄 · Enter 结束 · 点首点闭合 · Esc 取消'
      : '拖拽移动 · 选中后拖锚点 · 右侧面板改颜色/渐变';

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.spaceDown = false;
      if (!this.drag && !this.pan) this.pointerMode.set('default');
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      this.spaceDown = true;
      if (!this.drag && !this.pan) this.pointerMode.set('grab');
    }
    if (this.tool() !== 'pen') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.finishPen(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelPen();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.penNodes.pop();
      this.penDrag = null;
      this.drawPen();
    }
  };

  constructor() {
    effect(() => {
      const text = this.svgText();
      const host = this.docHost()?.nativeElement;
      if (!host) return;
      this.render(host, text);
    });

    effect(() => {
      this.selection();
      const tool = this.tool();
      if (tool !== 'pen' && this.penNodes.length > 0) {
        this.penNodes = [];
        this.penDrag = null;
        this.penCursor = null;
        this.drawPen();
      }
      this.applySelection();
      this.rebuildAnchors();
    });

    effect(() => {
      const vp = this.viewport()?.nativeElement;
      if (!vp) return;
      this.observer?.disconnect();
      this.observer = new ResizeObserver(() => this.updateBase());
      this.observer.observe(vp);
      this.updateBase();
    });

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }

  zoomBy(factor: number): void {
    this.zoom.set(Math.min(12, Math.max(0.1, this.zoom() * factor)));
  }

  fit(): void {
    this.zoom.set(1);
  }

  actual(): void {
    const vb = this.svgEl?.viewBox.baseVal;
    const base = this.base();
    if (!vb || vb.width <= 0 || base.width <= 0) return;
    this.zoom.set(Math.min(8, Math.max(0.1, vb.width / base.width)));
  }

  cycleBackground(): void {
    const order: Background[] = ['checker', 'light', 'dark'];
    const i = order.indexOf(this.background());
    this.background.set(order[(i + 1) % order.length]);
  }

  /** 当前内容的用户坐标包围盒（含 viewBox 外的内容）。 */
  contentBBox(): SvgBox | null {
    const svg = this.svgEl;
    if (!svg) return null;
    try {
      const box = svg.getBBox();
      if (box.width <= 0 || box.height <= 0) return null;
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    } catch {
      return null;
    }
  }

  backgroundLabel(): string {
    const map: Record<Background, string> = { checker: '格', light: '浅', dark: '深' };
    return map[this.background()];
  }

  onPointerDown(ev: PointerEvent): void {
    const doc = this.docHost()?.nativeElement;
    if (!doc) return;

    // 中键 / 空格 + 左键：平移画布。
    const vp = this.viewport()?.nativeElement;
    if (vp && (ev.button === 1 || (this.spaceDown && ev.button === 0))) {
      this.pan = { x: ev.clientX, y: ev.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      this.pointerMode.set('grabbing');
      this.capture(ev);
      ev.preventDefault();
      return;
    }

    if (this.tool() === 'pen') {
      ev.preventDefault();
      const point = this.toUser(ev);
      if (!point) return;
      if (this.penNodes.length >= 3 && this.near(point, this.penNodes[0])) {
        this.finishPen(true);
        return;
      }
      const last = this.penNodes[this.penNodes.length - 1];
      if (last && this.nearPixels(point, last, 3)) return;
      this.penNodes.push({ x: point.x, y: point.y, out: null, in: null });
      this.penDrag = { index: this.penNodes.length - 1 };
      this.penCursor = point;
      this.capture(ev);
      this.drawPen();
      return;
    }

    const pick = this.pickAt(ev);
    if (!pick || pick.el === this.svgEl) {
      // 点空白 / 点画布背景 = 取消选择，而不是选中根 <svg>。
      this.selected = null;
      this.hideRect(this.selRect);
      this.rebuildAnchors();
      this.picked.emit(null);
      return;
    }

    this.selected = pick.el;
    this.applySelection();
    this.picked.emit(pick.info);
    this.pointerMode.set('grabbing');

    const start = this.toUser(ev);
    if (!start) return;
    this.drag = {
      kind: 'element',
      el: pick.el,
      target: pick.info.selector,
      start,
      startClient: { x: ev.clientX, y: ev.clientY },
      originalTransform: pick.el.getAttribute('transform') ?? '',
    };
    this.capture(ev);
  }

  onPointerMove(ev: PointerEvent): void {
    const vp = this.viewport()?.nativeElement;
    if (vp) {
      const rect = vp.getBoundingClientRect();
      this.cursor.set({ x: ev.clientX - rect.left + 14, y: ev.clientY - rect.top + 12 });
    }

    if (this.pan) {
      const vp = this.viewport()?.nativeElement;
      if (vp) {
        vp.scrollLeft = this.pan.left - (ev.clientX - this.pan.x);
        vp.scrollTop = this.pan.top - (ev.clientY - this.pan.y);
      }
      return;
    }

    if (this.tool() === 'pen') {
      this.updatePenMove(ev);
      return;
    }

    if (this.drag) {
      this.updateDrag(ev);
      return;
    }

    const pick = this.pickAt(ev);
    const leaf = pick && pick.el !== this.svgEl ? pick.el : null;
    this.hoverLabel.set(leaf && pick ? `<${pick.info.tag}${pick.info.id ? ` #${pick.info.id}` : ''}>` : '');
    this.drawRect(this.hoverRect, leaf, true);
    this.pointerMode.set(this.spaceDown ? 'grab' : leaf ? 'move' : 'default');
  }

  onPointerUp(ev: PointerEvent): void {
    if (this.pan) {
      this.pan = null;
      this.release(ev);
      this.pointerMode.set('default');
      return;
    }

    if (this.tool() === 'pen' && this.penDrag) {
      this.penDrag = null;
      this.release(ev);
      this.drawPen();
      return;
    }

    const drag = this.drag;
    if (!drag) {
      this.pointerMode.set('default');
      return;
    }
    this.drag = null;
    this.release(ev);
    this.pointerMode.set('default');

    if (drag.kind === 'element') {
      const point = this.toUser(ev) ?? drag.start;
      const dx = round(point.x - drag.start.x);
      const dy = round(point.y - drag.start.y);
      const screenDistance = Math.hypot(ev.clientX - drag.startClient.x, ev.clientY - drag.startClient.y);
      if (screenDistance > 3 && (Math.abs(dx) + Math.abs(dy) > 0.01)) {
        this.moved.emit({ target: drag.target, dx, dy });
      } else {
        this.restoreTransform(drag);
      }
      this.drawRect(this.selRect, drag.el, false);
      return;
    }

    if (drag.kind === 'path') {
      const value = serializePath(drag.model, 3);
      if (value !== drag.original) {
        this.geometry.emit({ target: drag.target, kind: 'path', value });
      }
      return;
    }

    const value = serializePoints(drag.points, 3);
    if (value !== drag.original) {
      this.geometry.emit({ target: drag.target, kind: 'points', value });
    }
  }

  onPointerCancel(ev: PointerEvent): void {
    if (this.pan) {
      this.pan = null;
      this.release(ev);
      this.pointerMode.set('default');
      return;
    }

    if (this.penDrag) {
      this.penDrag = null;
      this.release(ev);
      this.drawPen();
      return;
    }

    const drag = this.drag;
    this.drag = null;
    this.release(ev);
    if (!drag) return;
    if (drag.kind === 'element') this.restoreTransform(drag);
    if (drag.kind === 'path') drag.el.setAttribute('d', drag.original);
    if (drag.kind === 'points') drag.el.setAttribute('points', drag.original);
  }

  onDoubleClick(ev: MouseEvent): void {
    if (this.tool() === 'pen') {
      ev.preventDefault();
      this.finishPen(false);
      return;
    }
    // 双击叶子 → 选中最近的 <g>，和图层树的直觉一致。
    const pick = this.pickAt(ev as unknown as PointerEvent);
    const start = pick?.el ?? this.selected;
    if (!start || start === this.svgEl) return;
    let el: Element | null = start;
    while (el && el !== this.svgEl && el.localName !== 'g') el = el.parentElement;
    if (!el || el === this.svgEl) return;
    this.selected = el;
    // 交给父组件的 selection input 统一生效，避免这里先用旧 selection 回滚。
    this.picked.emit(this.describe(el));
  }

  onLeave(): void {
    if (this.drag || this.penDrag || this.pan) return;
    this.pointerMode.set('default');
    if (this.tool() === 'pen') {
      this.penCursor = null;
      this.drawPen();
      return;
    }
    this.hoverLabel.set('');
    this.hideRect(this.hoverRect);
  }

  private updateDrag(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const point = this.toUser(ev);
    if (!point) return;

    if (drag.kind === 'element') {
      const dx = round(point.x - drag.start.x);
      const dy = round(point.y - drag.start.y);
      const move = `translate(${dx} ${dy})`;
      drag.el.setAttribute('transform', drag.originalTransform ? `${move} ${drag.originalTransform}` : move);
      this.drawRect(this.selRect, drag.el, false);
      return;
    }

    const local = drag.inverse ? matrixPoint(drag.inverse, point) : point;

    if (drag.kind === 'path') {
      moveAnchor(
        drag.model,
        drag.anchorIndex,
        round(local.x + drag.offset.x),
        round(local.y + drag.offset.y),
      );
      drag.el.setAttribute('d', serializePath(drag.model, 3));
      this.drawRect(this.selRect, drag.el, false);
      this.rebuildAnchors();
      return;
    }

    const moved = {
      x: round(local.x + drag.offset.x),
      y: round(local.y + drag.offset.y),
    };
    const lastIndex = drag.points.length - 1;
    const closed =
      drag.points.length > 2 &&
      drag.points[0].x === drag.points[lastIndex].x &&
      drag.points[0].y === drag.points[lastIndex].y;
    drag.points[drag.anchorIndex] = moved;
    // polygon 常常把首点重复写在末尾；拖首点时同步闭合点，避免接缝裂开。
    if (closed && drag.anchorIndex === 0) drag.points[lastIndex] = { ...moved };
    drag.el.setAttribute('points', serializePoints(drag.points, 3));
    this.drawRect(this.selRect, drag.el, false);
    this.rebuildAnchors();
  }

  private restoreTransform(drag: ElementDrag): void {
    if (drag.originalTransform) drag.el.setAttribute('transform', drag.originalTransform);
    else drag.el.removeAttribute('transform');
  }

  private capture(ev: PointerEvent): void {
    const vp = this.viewport()?.nativeElement;
    if (vp && vp.setPointerCapture) {
      try {
        vp.setPointerCapture(ev.pointerId);
      } catch {
        // 忽略：某些浏览器在失焦后会拒绝捕获。
      }
    }
  }

  private release(ev: PointerEvent): void {
    const vp = this.viewport()?.nativeElement;
    if (vp && vp.releasePointerCapture) {
      try {
        vp.releasePointerCapture(ev.pointerId);
      } catch {
        // 忽略。
      }
    }
  }

  private toUser(ev: MouseEvent | PointerEvent): SimplePoint | null {
    const svg = this.svgEl;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }

  private render(host: HTMLDivElement, text: string): void {
    host.innerHTML = text;
    const svg = host.querySelector('svg');
    if (!svg) return;
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    // 编辑时让 viewBox 外的内容可见；导出边界由 overlay 的虚线标出。
    svg.style.overflow = 'visible';
    this.svgEl = svg as SVGSVGElement;
    this.overlay = this.buildOverlay(this.svgEl);
    host.appendChild(this.overlay);
    this.hoverLabel.set('');
    this.drawPen();
    this.updateBase();
    this.applySelection();
    this.rebuildAnchors();
  }

  private buildOverlay(svg: SVGSVGElement): SVGSVGElement {
    const overlay = document.createElementNS(NS, 'svg');
    overlay.setAttribute('viewBox', svg.getAttribute('viewBox') ?? '0 0 100 100');
    overlay.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.overflow = 'visible';

    const artboard = document.createElementNS(NS, 'rect');
    const vb = svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      artboard.setAttribute('x', String(vb.x));
      artboard.setAttribute('y', String(vb.y));
      artboard.setAttribute('width', String(vb.width));
      artboard.setAttribute('height', String(vb.height));
      artboard.setAttribute('fill', 'none');
      artboard.style.stroke = 'var(--ui-muted)';
      artboard.style.strokeWidth = '1';
      artboard.setAttribute('stroke-dasharray', '4 4');
      artboard.setAttribute('vector-effect', 'non-scaling-stroke');
      artboard.setAttribute('opacity', '0.4');
      artboard.setAttribute('data-role', 'artboard');
    }

    const hover = document.createElementNS(NS, 'rect');
    hover.setAttribute('fill', 'none');
    hover.style.stroke = 'var(--ui-primary)';
    hover.style.strokeWidth = '1';
    hover.setAttribute('stroke-dasharray', '3 3');
    hover.setAttribute('vector-effect', 'non-scaling-stroke');
    hover.setAttribute('opacity', '0');

    const sel = document.createElementNS(NS, 'rect');
    sel.setAttribute('fill', 'none');
    sel.style.stroke = 'var(--ink-accent)';
    sel.style.strokeWidth = '1.5';
    sel.setAttribute('vector-effect', 'non-scaling-stroke');
    sel.setAttribute('opacity', '0');

    const anchors = document.createElementNS(NS, 'g');
    anchors.setAttribute('data-role', 'anchors');

    const pen = document.createElementNS(NS, 'g');
    pen.setAttribute('data-role', 'pen');

    if (artboard.hasAttribute('width')) overlay.append(artboard);
    overlay.append(hover, sel, anchors, pen);
    this.hoverRect = hover;
    this.selRect = sel;
    this.anchorGroup = anchors;
    this.penGroup = pen;
    return overlay;
  }

  private updateBase(): void {
    const vp = this.viewport()?.nativeElement;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const availW = Math.max(60, rect.width - 48);
    const availH = Math.max(60, rect.height - 80);
    const vb = this.svgEl?.viewBox.baseVal;
    const ratio = vb && vb.width > 0 && vb.height > 0 ? vb.width / vb.height : 1.5;
    let width = availW;
    let height = width / ratio;
    if (height > availH) {
      height = availH;
      width = height * ratio;
    }
    this.base.set({ width: Math.round(width), height: Math.round(height) });
  }

  private applySelection(): void {
    const want = this.selection();
    if (!want) {
      this.selected = null;
      this.hideRect(this.selRect);
      return;
    }
    const el = this.findBySelector(want.selector);
    this.selected = el;
    this.drawRect(this.selRect, el, false);
  }

  private findBySelector(selector: string): Element | null {
    const svg = this.svgEl;
    if (!svg) return null;
    if (selector === 'svg') return svg;
    if (selector.startsWith('#')) return this.findById(selector.slice(1));
    const rest = selector.replace(/^svg\s*>\s*/, '');
    try {
      return svg.querySelector(`:scope > ${rest}`);
    } catch {
      return null;
    }
  }

  private findById(id: string): Element | null {
    if (!this.svgEl) return null;
    for (const el of Array.from(this.svgEl.querySelectorAll('[id]'))) {
      if (el.getAttribute('id') === id) return el;
    }
    return null;
  }

  private pickAt(ev: PointerEvent): { el: Element; info: SvgPick } | null {
    const svg = this.svgEl;
    if (!svg) return null;
    const el = ev.target as Element | null;
    if (!el || el === this.overlay) return null;
    if (!svg.contains(el)) return null;
    return { el, info: this.describe(el) };
  }

  private describe(el: Element): SvgPick {
    const attrs: [string, string][] = [];
    for (const name of PICK_ATTRS) {
      const value = el.getAttribute(name);
      if (value === null || value === '') continue;
      attrs.push([name, value.length > 64 ? `${value.slice(0, 61)}…` : value]);
    }
    const id = el.getAttribute('id');
    const isRoot = el === this.svgEl;
    return {
      tag: el.localName,
      id,
      selector: id ? `#${id}` : isRoot ? 'svg' : this.structuralPath(el),
      attrs,
    };
  }

  private structuralPath(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== this.svgEl) {
      const tag = cur.localName;
      const siblings = cur.parentElement
        ? Array.from(cur.parentElement.children).filter((c) => c.localName === tag)
        : [];
      const index = siblings.indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      cur = cur.parentElement;
    }
    return `svg > ${parts.join(' > ')}`;
  }

  private drawRect(rect: SVGRectElement | null, el: Element | null, isHover: boolean): void {
    if (!rect) return;
    if (!el || (!isHover && !this.showBox())) {
      this.hideRect(rect);
      return;
    }
    const box = this.boxOf(el);
    if (!box) {
      this.hideRect(rect);
      return;
    }
    rect.setAttribute('x', String(box.x));
    rect.setAttribute('y', String(box.y));
    rect.setAttribute('width', String(Math.max(0, box.width)));
    rect.setAttribute('height', String(Math.max(0, box.height)));
    rect.setAttribute('opacity', '1');
  }

  private hideRect(rect: SVGRectElement | null): void {
    rect?.setAttribute('opacity', '0');
  }

  private boxOf(el: Element): SvgBox | null {
    const svg = this.svgEl;
    if (!svg) return null;
    if (el === svg) {
      const vb = svg.viewBox.baseVal;
      if (!vb || vb.width <= 0) return null;
      return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    }
    const graphics = el as SVGGraphicsElement;
    if (typeof graphics.getBBox !== 'function') return null;
    const rootCtm = svg.getScreenCTM();
    const elCtm = graphics.getScreenCTM();
    if (!rootCtm || !elCtm) return null;
    let bbox: DOMRect;
    try {
      bbox = graphics.getBBox();
    } catch {
      return null;
    }
    const m = rootCtm.inverse().multiply(elCtm);
    const points: [number, number][] = [
      [bbox.x, bbox.y],
      [bbox.x + bbox.width, bbox.y],
      [bbox.x, bbox.y + bbox.height],
      [bbox.x + bbox.width, bbox.y + bbox.height],
    ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /* ---------------- 锚点 ---------------- */

  private rebuildAnchors(): void {
    const group = this.anchorGroup;
    if (!group) return;
    group.replaceChildren();
    const el = this.selected;
    if (this.tool() !== 'select' || !el || el === this.svgEl) return;

    const scale = this.userScale();
    const size = 4.5 / scale;
    const stroke = 1.4 / scale;
    const target = this.targetOf(el);
    const matrix = this.elementMatrix(el);
    const inverse = matrix ? safeInverse(matrix) : null;
    const display = (point: SimplePoint): SimplePoint =>
      matrix ? matrixPoint(matrix, point) : point;

    if (el.localName === 'polygon' || el.localName === 'polyline') {
      const points = parsePoints(el.getAttribute('points') ?? '');
      if (!points) return;
      const lastIndex = points.length - 1;
      const closed =
        points.length > 2 &&
        points[0].x === points[lastIndex].x &&
        points[0].y === points[lastIndex].y;
      points.forEach((point, index) => {
        if (closed && index === lastIndex) return;
        const shown = display(point);
        group.appendChild(
          this.anchorShape(shown.x, shown.y, size, stroke, false, (ev) => {
            const start = this.toUser(ev);
            if (!start) return;
            const local = inverse ? matrixPoint(inverse, start) : start;
            this.drag = {
              kind: 'points',
              el,
              target,
              start,
              offset: { x: points[index].x - local.x, y: points[index].y - local.y },
              inverse,
              original: el.getAttribute('points') ?? '',
              points: points.map((p) => ({ ...p })),
              anchorIndex: index,
            };
            this.capture(ev);
          }),
        );
      });
      return;
    }

    if (el.localName === 'path') {
      const model = parsePath(el.getAttribute('d') ?? '');
      if (!model) return;
      model.anchors.forEach((anchor, index) => {
        const control = anchor.role !== 'point';
        const shown = display(anchor);
        group.appendChild(
          this.anchorShape(shown.x, shown.y, size * (control ? 0.8 : 1), stroke, control, (ev) => {
            const start = this.toUser(ev);
            if (!start) return;
            const local = inverse ? matrixPoint(inverse, start) : start;
            this.drag = {
              kind: 'path',
              el,
              target,
              start,
              offset: { x: anchor.x - local.x, y: anchor.y - local.y },
              inverse,
              original: el.getAttribute('d') ?? '',
              model,
              anchorIndex: index,
            };
            this.capture(ev);
          }),
        );
      });
    }
  }

  private anchorShape(
    x: number,
    y: number,
    size: number,
    stroke: number,
    control: boolean,
    onDown: (ev: PointerEvent) => void,
  ): SVGElement {
    const group = document.createElementNS(NS, 'g');
    const hit = document.createElementNS(NS, 'circle');
    hit.setAttribute('cx', String(x));
    hit.setAttribute('cy', String(y));
    hit.setAttribute('r', String(size * 2.4));
    hit.setAttribute('fill', 'transparent');
    hit.style.pointerEvents = 'all';
    group.appendChild(hit);

    let shape: SVGElement;
    if (control) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(x - size / 2));
      rect.setAttribute('y', String(y - size / 2));
      rect.setAttribute('width', String(size));
      rect.setAttribute('height', String(size));
      shape = rect;
    } else {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', String(size));
      shape = circle;
    }
    shape.style.fill = 'var(--ui-overlay)';
    shape.style.stroke = 'var(--ink-accent)';
    shape.style.strokeWidth = String(stroke);
    shape.style.pointerEvents = 'none';
    group.appendChild(shape);

    group.style.cursor = 'grab';
    group.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      onDown(ev);
    });
    return group;
  }

  private userScale(): number {
    const svg = this.svgEl;
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (!vb || vb.width <= 0 || rect.width <= 0) return 1;
    return rect.width / vb.width;
  }

  private elementMatrix(el: Element): DOMMatrix | null {
    const svg = this.svgEl;
    if (!svg) return null;
    const rootCtm = svg.getScreenCTM();
    const elCtm = (el as SVGGraphicsElement).getScreenCTM?.();
    if (!rootCtm || !elCtm) return null;
    return rootCtm.inverse().multiply(elCtm);
  }

  private targetOf(el: Element): string {
    const id = el.getAttribute('id');
    return id ? `#${id}` : this.structuralPath(el);
  }

  /* ---------------- 钢笔 ---------------- */

  private drawPen(): void {
    const group = this.penGroup;
    if (!group) return;
    group.replaceChildren();
    if (this.tool() !== 'pen' || this.penNodes.length === 0) return;

    const scale = this.userScale();
    const color = this.penColor();
    const strokeWidth = 1 / Math.max(scale, 0.001);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', this.buildPenPath(false));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    group.appendChild(path);

    for (const node of this.penNodes) {
      for (const handle of [node.in, node.out]) {
        if (!handle) continue;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', String(node.x));
        line.setAttribute('y1', String(node.y));
        line.setAttribute('x2', String(handle.x));
        line.setAttribute('y2', String(handle.y));
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', String(strokeWidth));
        line.setAttribute('opacity', '0.55');
        group.appendChild(line);

        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', String(handle.x));
        dot.setAttribute('cy', String(handle.y));
        dot.setAttribute('r', String(2.2 / Math.max(scale, 0.001)));
        dot.setAttribute('fill', color);
        dot.setAttribute('opacity', '0.8');
        group.appendChild(dot);
      }

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', String(node.x));
      dot.setAttribute('cy', String(node.y));
      dot.setAttribute('r', String(3.6 / Math.max(scale, 0.001)));
      dot.style.fill = 'var(--ui-overlay)';
      dot.setAttribute('stroke', color);
      dot.setAttribute('stroke-width', String(strokeWidth * 1.2));
      group.appendChild(dot);
    }

    if (this.penCursor && !this.penDrag) {
      const last = this.penNodes[this.penNodes.length - 1];
      const control = last.out ?? { x: last.x, y: last.y };
      const rubber = document.createElementNS(NS, 'path');
      rubber.setAttribute(
        'd',
        `M${last.x} ${last.y} C${control.x} ${control.y} ${this.penCursor.x} ${this.penCursor.y} ${this.penCursor.x} ${this.penCursor.y}`,
      );
      rubber.setAttribute('fill', 'none');
      rubber.setAttribute('stroke', color);
      rubber.setAttribute('stroke-width', '1');
      rubber.setAttribute('stroke-dasharray', '4 3');
      rubber.setAttribute('vector-effect', 'non-scaling-stroke');
      rubber.setAttribute('opacity', '0.55');
      group.appendChild(rubber);
    }
  }

  private updatePenMove(ev: PointerEvent): void {
    const point = this.toUser(ev);
    if (!point) return;
    if (!this.penDrag) {
      this.penCursor = point;
      this.drawPen();
      return;
    }
    const node = this.penNodes[this.penDrag.index];
    if (!node) return;
    const minDistance = 2 / Math.max(this.userScale(), 0.001);
    if (Math.hypot(point.x - node.x, point.y - node.y) > minDistance) {
      node.out = { x: point.x, y: point.y };
      node.in = { x: 2 * node.x - point.x, y: 2 * node.y - point.y };
    } else {
      node.out = null;
      node.in = null;
    }
    this.drawPen();
  }

  /** 由节点和手柄生成 d：有手柄的段用 C，没有的用 L。 */
  private buildPenPath(close: boolean): string {
    const nodes = this.penNodes;
    if (nodes.length === 0) return '';
    const n = (value: number) => round(value);
    const segment = (a: PenNode, b: PenNode): string => {
      if (a.out || b.in) {
        const c1 = a.out ?? { x: a.x, y: a.y };
        const c2 = b.in ?? { x: b.x, y: b.y };
        return ` C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`;
      }
      return ` L${n(b.x)} ${n(b.y)}`;
    };

    let d = `M${n(nodes[0].x)} ${n(nodes[0].y)}`;
    for (let i = 1; i < nodes.length; i += 1) {
      d += segment(nodes[i - 1], nodes[i]);
    }
    if (close) {
      d += `${segment(nodes[nodes.length - 1], nodes[0])} Z`;
    }
    return d;
  }

  private finishPen(close: boolean): void {
    if (this.penNodes.length < 2) {
      this.cancelPen();
      return;
    }
    this.pathCreated.emit({ d: this.buildPenPath(close) });
    this.penNodes = [];
    this.penDrag = null;
    this.penCursor = null;
    this.drawPen();
  }

  private cancelPen(): void {
    this.penNodes = [];
    this.penDrag = null;
    this.penCursor = null;
    this.drawPen();
  }

  private near(a: SimplePoint, b: SimplePoint): boolean {
    return this.nearPixels(a, b, 6);
  }

  private nearPixels(a: SimplePoint, b: SimplePoint, pixels: number): boolean {
    const scale = this.userScale();
    const threshold = pixels / Math.max(scale, 0.001);
    return Math.hypot(a.x - b.x, a.y - b.y) <= threshold;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeInverse(matrix: DOMMatrix): DOMMatrix | null {
  try {
    return matrix.inverse();
  } catch {
    return null;
  }
}

function matrixPoint(matrix: DOMMatrix, point: SimplePoint): SimplePoint {
  const out = new DOMPoint(point.x, point.y).matrixTransform(matrix);
  return { x: out.x, y: out.y };
}
