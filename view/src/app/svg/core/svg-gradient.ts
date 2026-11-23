/** 渐变读取与编辑。所有函数都作用在一个可丢弃的文档克隆上。 */

import { SVG_NS } from './svg-doc';

export type GradientKind = 'linear' | 'radial';
export type GradientDirection = 'h' | 'v' | 'd';

export interface GradientStop {
  offset: number;
  color: string;
  opacity: string;
}

export interface GradientInfo {
  id: string;
  kind: GradientKind;
  stops: GradientStop[];
  direction: GradientDirection;
}

export function listGradients(root: Element): GradientInfo[] {
  const out: GradientInfo[] = [];
  for (const el of Array.from(root.querySelectorAll('linearGradient, radialGradient'))) {
    const id = el.getAttribute('id');
    if (!id) continue;
    out.push({
      id,
      kind: el.localName === 'radialGradient' ? 'radial' : 'linear',
      stops: readStops(el),
      direction: readDirection(el),
    });
  }
  return out;
}

export function findGradient(root: Element, id: string): GradientInfo | null {
  return listGradients(root).find((g) => g.id === id) ?? null;
}

function readStops(gradient: Element): GradientStop[] {
  return Array.from(gradient.children)
    .filter((child) => child.localName === 'stop')
    .map((stop) => ({
      offset: parseOffset(stop.getAttribute('offset') ?? '0'),
      color: stop.getAttribute('stop-color') ?? styleValue(stop, 'stop-color') ?? '#000000',
      opacity: stop.getAttribute('stop-opacity') ?? styleValue(stop, 'stop-opacity') ?? '1',
    }));
}

function styleValue(el: Element, name: string): string | null {
  const style = el.getAttribute('style');
  if (!style) return null;
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function parseOffset(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) return clamp(Number(trimmed.slice(0, -1)) / 100);
  return clamp(Number(trimmed));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function readDirection(el: Element): GradientDirection {
  const x1 = Number(el.getAttribute('x1') ?? 0);
  const y1 = Number(el.getAttribute('y1') ?? 0);
  const x2 = Number(el.getAttribute('x2') ?? 1);
  const y2 = Number(el.getAttribute('y2') ?? 0);
  if (Math.abs(y2 - y1) > Math.abs(x2 - x1)) return 'v';
  if (Math.abs(y2 - y1) > 0.01 && Math.abs(x2 - x1) > 0.01) return 'd';
  return 'h';
}

function ensureDefs(root: Element): Element {
  const existing = Array.from(root.children).find((child) => child.localName === 'defs');
  if (existing) return existing;
  const doc = root.ownerDocument;
  const defs = doc.createElementNS(SVG_NS, 'defs');
  root.insertBefore(defs, root.firstChild);
  return defs;
}

function uniqueId(root: Element, prefix: string): string {
  const used = new Set<string>();
  for (const el of Array.from(root.querySelectorAll('[id]'))) {
    const id = el.getAttribute('id');
    if (id) used.add(id);
  }
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export function createGradient(
  root: Element,
  stops: GradientStop[],
  kind: GradientKind = 'linear',
  direction: GradientDirection = 'h',
): string {
  const defs = ensureDefs(root);
  const doc = root.ownerDocument;
  const id = uniqueId(root, 'grad');
  const gradient = doc.createElementNS(SVG_NS, kind === 'radial' ? 'radialGradient' : 'linearGradient');
  gradient.setAttribute('id', id);
  applyDirection(gradient, direction);
  defs.appendChild(gradient);
  writeStops(gradient, stops);
  return id;
}

export function setStops(root: Element, id: string, stops: GradientStop[]): void {
  const gradient = findById(root, id);
  if (!gradient) return;
  writeStops(gradient, stops);
}

export function setDirection(root: Element, id: string, direction: GradientDirection): void {
  const gradient = findById(root, id);
  if (!gradient) return;
  applyDirection(gradient, direction);
}

function findById(root: Element, id: string): Element | null {
  for (const el of Array.from(root.querySelectorAll('[id]'))) {
    if (el.getAttribute('id') === id) return el;
  }
  return null;
}

function applyDirection(gradient: Element, direction: GradientDirection): void {
  const coords: Record<GradientDirection, [number, number, number, number]> = {
    h: [0, 0, 1, 0],
    v: [0, 0, 0, 1],
    d: [0, 0, 1, 1],
  };
  const [x1, y1, x2, y2] = coords[direction];
  gradient.setAttribute('x1', String(x1));
  gradient.setAttribute('y1', String(y1));
  gradient.setAttribute('x2', String(x2));
  gradient.setAttribute('y2', String(y2));
}

function writeStops(gradient: Element, stops: GradientStop[]): void {
  for (const child of Array.from(gradient.children)) {
    if (child.localName === 'stop') child.remove();
  }
  const doc = gradient.ownerDocument;
  for (const stop of [...stops].sort((a, b) => a.offset - b.offset)) {
    const el = doc.createElementNS(SVG_NS, 'stop');
    el.setAttribute('offset', String(Math.round(clamp(stop.offset) * 1000) / 1000));
    el.setAttribute('stop-color', stop.color);
    const opacity = Number(stop.opacity);
    if (Number.isFinite(opacity) && opacity < 1) {
      el.setAttribute('stop-opacity', String(clamp(opacity)));
    }
    gradient.appendChild(el);
  }
}

/** 给 UI 用的 CSS 预览（只是近似，与浏览器渐变算法无关）。 */
export function gradientCss(info: GradientInfo): string {
  const stops = info.stops.length
    ? info.stops
    : [
        { offset: 0, color: '#d9d2c4', opacity: '1' },
        { offset: 1, color: '#8f887c', opacity: '1' },
      ];
  const list = stops
    .map((stop) => `${stop.color} ${Math.round(clamp(stop.offset) * 100)}%`)
    .join(', ');
  if (info.kind === 'radial') return `radial-gradient(circle, ${list})`;
  const angle = info.direction === 'v' ? 180 : info.direction === 'd' ? 135 : 90;
  return `linear-gradient(${angle}deg, ${list})`;
}
