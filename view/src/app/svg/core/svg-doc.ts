/**
 * SVG 文档内核：解析、确定性序列化、统计、digest。
 *
 * 设计口径（见 /svg 工作台右栏「提示词」页）：
 * - canonical 文本是**唯一可编辑真值**：固定属性序、固定小数精度、幂等；
 * - 不做 SVGO 式重写（不合并 path、不改 id、不转换命令字母），保证 LLM 的 diff 与补丁定位稳定；
 * - 数值只做四舍五入与空白规范化，语义不变。
 */

import { collectSemanticParts } from './svg-semantics';
import type { SemanticPartInfo } from './svg-semantics';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

export interface CanonicalOptions {
  /** 数值保留小数位，0–4。 */
  precision: number;
  /** 紧凑化 path/points 的空白（`M10 20L30 40`）。 */
  compact: boolean;
  indent: string;
  keepComments: boolean;
}

export const CANONICAL_DEFAULTS: CanonicalOptions = {
  precision: 2,
  compact: false,
  indent: '  ',
  keepComments: false,
};

export interface ParseFailure {
  message: string;
  line: number | null;
  column: number | null;
}

export type ParseResult = { ok: true; doc: SvgDocument } | { ok: false; error: ParseFailure };

export interface SvgStats {
  bytes: number;
  elements: number;
  paths: number;
  groups: number;
  ids: number;
  classRefs: number;
  styleBlocks: number;
  cssRules: number;
  pathBytes: number;
  numbers: number;
  maxDecimals: number;
  images: number;
  embeddedRasterBytes: number;
  masks: number;
  clipPaths: number;
  gradients: number;
  texts: number;
  unsafe: number;
  viewBox: string | null;
  tags: { tag: string; count: number }[];
}

export interface DigestNode {
  tag: string;
  id: string | null;
  classes: string[];
  attrs: [string, string][];
  childCount: number;
  shownChildren: number;
  note: string;
  children: DigestNode[];
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function parseErrorDocument(input: string): ParseFailure {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(input, 'image/svg+xml');
  } catch (err) {
    return { message: String((err as Error)?.message ?? err), line: null, column: null };
  }
  const node = parsed.getElementsByTagName('parsererror')[0] ?? parsed.querySelector('parsererror');
  const raw = (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const line = /line\s+(\d+)/i.exec(raw)?.[1];
  const column = /column\s+(\d+)/i.exec(raw)?.[1];
  return {
    message: raw || '不是合法的 XML：检查未闭合标签、未转义的 & 或重复属性。',
    line: line ? Number(line) : null,
    column: column ? Number(column) : null,
  };
}

export class SvgDocument {
  constructor(readonly root: SVGSVGElement) {}

  static parse(text: string): ParseResult {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
      return { ok: false, error: parseErrorDocument(text) };
    }
    return { ok: true, doc: new SvgDocument(root as unknown as SVGSVGElement) };
  }

  clone(): SvgDocument {
    return new SvgDocument(this.root.cloneNode(true) as unknown as SVGSVGElement);
  }

  canonical(options: Partial<CanonicalOptions> = {}): string {
    return serializeSvg(this.root, { ...CANONICAL_DEFAULTS, ...options });
  }

  stats(sourceBytes?: number): SvgStats {
    return collectStats(this.root, sourceBytes ?? 0);
  }

  viewBox(): [number, number, number, number] | null {
    const raw = this.root.getAttribute('viewBox');
    if (!raw) return null;
    const nums = raw
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (nums.length !== 4 || nums[2] <= 0 || nums[3] <= 0) return null;
    return [nums[0], nums[1], nums[2], nums[3]];
  }

  /** 所有带 id 的元素，用于补丁定位与冲突检测。 */
  elementsWithId(): Element[] {
    return allElements(this.root).filter((el) => el.hasAttribute('id'));
  }

  findById(id: string): Element | null {
    return this.root.querySelector(`[id="${cssEscape(id)}"]`);
  }
}

export function parseSvg(text: string): ParseResult {
  return SvgDocument.parse(text);
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll('*'))];
}

/* ------------------------------------------------------------------ */
/* 数值与属性格式化                                                     */
/* ------------------------------------------------------------------ */

const PATH_ATTRS = new Set(['d']);
const NUMERIC_LIST_ATTRS = new Set([
  'points',
  'viewBox',
  'stroke-dasharray',
  'values',
  'keyPoints',
]);
const NUMERIC_ATTRS = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'dx',
  'dy',
  'fx',
  'fy',
  'fr',
  'stroke-width',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'font-size',
  'letter-spacing',
  'word-spacing',
  'offset',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stop-opacity',
  'flood-opacity',
  'startOffset',
]);
const COLOR_ATTRS = new Set([
  'fill',
  'stroke',
  'stop-color',
  'color',
  'flood-color',
  'lighting-color',
]);

/** 需要按数值/数值列表规范化的属性。 */
export function isNumericAttribute(name: string): boolean {
  return (
    PATH_ATTRS.has(name) ||
    NUMERIC_LIST_ATTRS.has(name) ||
    NUMERIC_ATTRS.has(name) ||
    name === 'transform'
  );
}

const ATTR_ORDER = [
  'id',
  'class',
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'display',
  'visibility',
  'paint-order',
  'vector-effect',
  'style',
];

function attrRank(name: string): number {
  if (name === 'xmlns' || name.startsWith('xmlns:')) return -1;
  const i = ATTR_ORDER.indexOf(name);
  return i < 0 ? 1000 : i;
}

export function formatNumber(value: number, precision: number, compact = false): string {
  if (!Number.isFinite(value)) return String(value);
  const p = Math.max(0, Math.min(6, precision));
  const factor = Math.pow(10, p);
  let n = Math.round(value * factor) / factor;
  if (Object.is(n, -0)) n = 0;
  if (Math.abs(n) >= 1e21) return String(n);
  let s = n.toFixed(p);
  if (p > 0) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (s === '' || s === '-' || s === '-0') s = '0';
  if (compact) {
    s = s.replace(/^0\./, '.').replace(/^-0\./, '-.');
  }
  return s;
}

const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const NUMBER_AT = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/;

const PATH_PARAM_COUNT: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

export interface PathToken {
  kind: 'cmd' | 'number' | 'flag';
  value: string;
}

/**
 * 按 SVG 语法切分 path 数据。
 *
 * 关键点：arc 的第 4、5 个参数是单字符 flag（只能 0/1），不能当普通数字读。
 * 否则 `a16.88 16.88 0 00-2.71` 里的 `00` 会被当成一个数，参数整体错位。
 */
export function tokenizePath(d: string): PathToken[] | null {
  const tokens: PathToken[] = [];
  let index = 0;
  let command = '';
  let param = 0;

  const skipSeparator = () => {
    while (index < d.length && (d[index] === ',' || /\s/.test(d[index]))) index += 1;
  };

  while (index < d.length) {
    skipSeparator();
    if (index >= d.length) break;
    const ch = d[index];

    if (/[a-zA-Z]/.test(ch)) {
      const lower = ch.toLowerCase();
      if (!(lower in PATH_PARAM_COUNT)) return null;
      command = ch;
      param = 0;
      tokens.push({ kind: 'cmd', value: ch });
      index += 1;
      if (lower === 'z') command = '';
      continue;
    }

    if (!command) return null;
    const lower = command.toLowerCase();
    const count = PATH_PARAM_COUNT[lower];
    if (count === 0) return null;

    if (lower === 'a' && (param === 3 || param === 4)) {
      if (ch !== '0' && ch !== '1') return null;
      tokens.push({ kind: 'flag', value: ch });
      index += 1;
      param += 1;
      if (param >= count) param = 0;
      continue;
    }

    const match = NUMBER_AT.exec(d.slice(index));
    if (!match) return null;
    const raw = match[0];
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    tokens.push({ kind: 'number', value: String(value) });
    index += raw.length;
    param += 1;
    if (param >= count) {
      param = 0;
      if (lower === 'm') command = command === 'M' ? 'L' : 'l';
    }
  }

  return tokens;
}

export function formatPathData(raw: string, precision: number, compact: boolean): string {
  const tokens = tokenizePath(raw);
  if (!tokens || tokens.length === 0) return raw.trim();

  let out = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind === 'cmd') {
      out += token.value;
      continue;
    }
    const text =
      token.kind === 'flag' ? token.value : formatNumber(Number(token.value), precision, compact);
    if (!out) {
      out = text;
      continue;
    }
    const prev = tokens[i - 1];
    if (prev.kind === 'cmd') {
      out += text;
      continue;
    }
    // 只在「前一个完整数字 + 当前负数」时省掉分隔符；其余一律留空格，避免歧义。
    const glue = compact && prev.kind === 'number' && text.startsWith('-');
    out += `${glue ? '' : ' '}${text}`;
  }
  return out;
}

export function formatNumberList(raw: string, precision: number, compact: boolean): string {
  const nums = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return raw.trim();
  return nums.map((n) => formatNumber(n, precision, compact)).join(' ');
}

export function formatTransform(raw: string, precision: number): string {
  return raw
    .replace(NUMBER_RE, (m) => formatNumber(Number(m), precision, false))
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function normalizeColor(raw: string): string {
  const v = raw.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  let hex = v.slice(1).toLowerCase();
  if (hex.length === 6 && hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) {
    hex = `${hex[0]}${hex[2]}${hex[4]}`;
  }
  return `#${hex}`;
}

function normalizeStyle(raw: string): string {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(':');
      if (i < 0) return part;
      return `${part.slice(0, i).trim()}:${part.slice(i + 1).trim()}`;
    })
    .join(';');
}

export function normalizeAttrValue(name: string, value: string, options: CanonicalOptions): string {
  const { precision, compact } = options;
  if (PATH_ATTRS.has(name)) return formatPathData(value, precision, compact);
  if (name === 'transform') return formatTransform(value, precision);
  if (NUMERIC_LIST_ATTRS.has(name)) return formatNumberList(value, precision, compact);
  if (NUMERIC_ATTRS.has(name)) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? formatNumber(n, precision, compact) : value.trim();
  }
  if (COLOR_ATTRS.has(name)) return normalizeColor(value);
  if (name === 'style') return normalizeStyle(value);
  if (name === 'points') return formatNumberList(value, precision, compact);
  return value.trim().replace(/\s+/g, ' ');
}

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

const RAW_TEXT_TAGS = new Set(['style', 'script']);

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rootExtras(root: Element): [string, string][] {
  const extras: [string, string][] = [];
  if (!root.hasAttribute('xmlns')) extras.push(['xmlns', SVG_NS]);
  const usesXlink = allElements(root).some((el) =>
    Array.from(el.attributes).some((a) => a.name.startsWith('xlink:')),
  );
  if (usesXlink && !root.hasAttribute('xmlns:xlink')) extras.push(['xmlns:xlink', XLINK_NS]);
  return extras;
}

function attributesOf(
  el: Element,
  options: CanonicalOptions,
  extras: [string, string][] = [],
): string {
  const entries: [string, string][] = [];
  for (const attr of Array.from(el.attributes)) {
    entries.push([attr.name, normalizeAttrValue(attr.name, attr.value, options)]);
  }
  if (extras.length) entries.push(...extras);
  entries.sort((a, b) => {
    const d = attrRank(a[0]) - attrRank(b[0]);
    return d !== 0 ? d : a[0].localeCompare(b[0]);
  });
  return entries.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');
}

function textOf(el: Element): string {
  const raw = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE)
    .map((n) => n.nodeValue ?? '')
    .join('');
  if (!raw.trim()) return '';
  return RAW_TEXT_TAGS.has(el.localName) ? raw.trim() : raw.trim();
}

export function serializeSvg(root: Element, options: CanonicalOptions): string {
  const out: string[] = [];
  serializeElement(root, options, 0, out, rootExtras(root));
  return `${out.join('\n')}\n`;
}

function serializeElement(
  el: Element,
  options: CanonicalOptions,
  depth: number,
  out: string[],
  extras: [string, string][] = [],
): void {
  const pad = options.indent.repeat(depth);
  const open = `${pad}<${el.tagName}${attributesOf(el, options, extras)}`;
  const children = Array.from(el.children);
  const text = textOf(el);

  if (children.length === 0 && !text) {
    out.push(`${open}/>`);
    return;
  }
  if (children.length === 0 && text) {
    out.push(
      `${open}>${RAW_TEXT_TAGS.has(el.localName) ? escapeText(text) : escapeText(text)}</${el.tagName}>`,
    );
    return;
  }
  if (text) {
    const inline: string[] = [];
    serializeInline(el, options, inline);
    out.push(`${open}>${inline.join('')}</${el.tagName}>`);
    return;
  }

  out.push(`${open}>`);
  for (const child of children) {
    serializeElement(child, options, depth + 1, out);
  }
  if (options.keepComments) {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.COMMENT_NODE) continue;
      const body = (node.nodeValue ?? '').trim();
      if (body) out.push(`${options.indent.repeat(depth + 1)}<!-- ${body} -->`);
    }
  }
  out.push(`${pad}</${el.tagName}>`);
}

function serializeInline(el: Element, options: CanonicalOptions, out: string[]): void {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const v = node.nodeValue ?? '';
      if (v.trim()) out.push(escapeText(v.replace(/\s+/g, ' ')));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    const open = `<${child.tagName}${attributesOf(child, options)}`;
    const children = Array.from(child.children);
    if (children.length === 0 && !textOf(child)) {
      out.push(`${open}/>`);
      continue;
    }
    out.push(`${open}>`);
    serializeInline(child, options, out);
    out.push(`</${child.tagName}>`);
  }
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export function collectStats(root: Element, sourceBytes = 0): SvgStats {
  const elements = allElements(root);
  const tagMap = new Map<string, number>();
  let paths = 0;
  let groups = 0;
  let ids = 0;
  let classRefs = 0;
  let styleBlocks = 0;
  let cssRules = 0;
  let pathBytes = 0;
  let images = 0;
  let embeddedRasterBytes = 0;
  let masks = 0;
  let clipPaths = 0;
  let gradients = 0;
  let texts = 0;
  let unsafe = 0;
  let numbers = 0;
  let maxDecimals = 0;

  const scanNumbers = (value: string) => {
    for (const m of value.match(NUMBER_RE) ?? []) {
      numbers += 1;
      const dot = m.indexOf('.');
      if (dot < 0) continue;
      const frac = m.slice(dot + 1).replace(/[eE].*$/, '');
      maxDecimals = Math.max(maxDecimals, frac.length);
    }
  };

  for (const el of elements) {
    const tag = el.localName;
    tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    if (tag === 'path') paths += 1;
    else if (tag === 'g') groups += 1;
    else if (tag === 'style') {
      styleBlocks += 1;
      cssRules += (el.textContent ?? '').split('{').length - 1;
    } else if (tag === 'image') {
      images += 1;
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      if (href.startsWith('data:')) embeddedRasterBytes += href.length;
    } else if (tag === 'mask') masks += 1;
    else if (tag === 'clipPath') clipPaths += 1;
    else if (tag === 'linearGradient' || tag === 'radialGradient') gradients += 1;
    else if (tag === 'text' || tag === 'tspan') texts += 1;
    else if (tag === 'script' || tag === 'foreignObject') unsafe += 1;

    if (el.hasAttribute('id')) ids += 1;
    const cls = el.getAttribute('class');
    if (cls) classRefs += cls.split(/\s+/).filter(Boolean).length;

    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'd' || attr.name === 'points') pathBytes += byteLength(attr.value);
      if (/^on/i.test(attr.name)) unsafe += 1;
      if (attr.name === 'href' && /^\s*javascript:/i.test(attr.value)) unsafe += 1;
      if (
        attr.name === 'd' ||
        attr.name === 'points' ||
        attr.name === 'transform' ||
        attr.name === 'viewBox'
      ) {
        scanNumbers(attr.value);
      }
    }
  }

  return {
    bytes: sourceBytes,
    elements: elements.length,
    paths,
    groups,
    ids,
    classRefs,
    styleBlocks,
    cssRules,
    pathBytes,
    numbers,
    maxDecimals,
    images,
    embeddedRasterBytes,
    masks,
    clipPaths,
    gradients,
    texts,
    unsafe,
    viewBox: root.getAttribute('viewBox'),
    tags: Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}

/* ------------------------------------------------------------------ */
/* Digest：给 LLM 的结构缩略视图（不含 path 数据）                       */
/* ------------------------------------------------------------------ */

const DIGEST_KEY_ATTRS = [
  'fill',
  'stroke',
  'stroke-width',
  'fill-rule',
  'transform',
  'opacity',
  'clip-path',
  'mask',
  'filter',
  'href',
  'gradientUnits',
  'stop-color',
  'offset',
  'data-role',
  'data-label',
  'aria-label',
];

export function buildDigest(el: Element, depth = 0, maxDepth = 4, maxChildren = 12): DigestNode {
  const tag = el.localName;
  const id = el.getAttribute('id');
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const attrs: [string, string][] = [];
  for (const name of DIGEST_KEY_ATTRS) {
    const v = el.getAttribute(name);
    if (v !== null) attrs.push([name, truncate(v, 48)]);
  }
  if (el.localName === 'svg' && el.hasAttribute('viewBox')) {
    attrs.unshift(['viewBox', el.getAttribute('viewBox') ?? '']);
  }
  const note = digestNote(el);

  const children = Array.from(el.children);
  const shown = depth >= maxDepth ? [] : children.slice(0, maxChildren);
  return {
    tag,
    id,
    classes,
    attrs,
    childCount: children.length,
    shownChildren: shown.length,
    note,
    children: shown.map((c) => buildDigest(c, depth + 1, maxDepth, maxChildren)),
  };
}

function digestNote(el: Element): string {
  const tag = el.localName;
  if (tag === 'path') {
    const d = el.getAttribute('d') ?? '';
    const points = (d.match(/[a-zA-Z]/g) ?? []).length;
    return `d ${points} 段 / ${byteLength(d)} B`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = el.getAttribute('points') ?? '';
    return `${Math.floor(pts.trim().split(/[\s,]+/).length / 2)} 点`;
  }
  if (tag === 'style') {
    const css = el.textContent ?? '';
    return `${css.split('{').length - 1} 条规则 / ${byteLength(css)} B`;
  }
  if (tag === 'image') {
    const href = el.getAttribute('href') ?? '';
    return href.startsWith('data:') ? `内嵌位图 ${Math.round(href.length / 1024)} kB` : '外链位图';
  }
  if (tag === 'linearGradient' || tag === 'radialGradient') {
    return `${el.children.length} 个 stop`;
  }
  return el.children.length ? `${el.children.length} 子元素` : '';
}

function truncate(v: string, n: number): string {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

/** digest 中语义部件段的最大行数（含标题与截断提示），避免长图撑爆 token。 */
const MAX_SEMANTIC_LINES = 60;

function semanticPartLine(part: SemanticPartInfo): string {
  const bits = [`#${part.id}`, part.role];
  if (part.label) bits.push(part.label);
  bits.push(`${part.childCount} 子元素`);
  if (part.locked) bits.push('锁定');
  return `  · ${bits.join(' · ')}`;
}

function semanticSection(root: Element): string[] {
  const parts = collectSemanticParts(root);
  if (parts.length === 0) return [];
  const budget = MAX_SEMANTIC_LINES - 1;
  const truncated = parts.length > budget;
  const shown = parts.slice(0, truncated ? Math.max(0, budget - 1) : budget);
  const lines = [`收集到的语义部件（${parts.length}）`];
  for (const part of shown) lines.push(semanticPartLine(part));
  if (truncated) {
    lines.push(`  · … 另有 ${parts.length - shown.length} 个部件未列出`);
  }
  return lines;
}

export function digestText(
  root: Element,
  stats: SvgStats,
  maxDepth = 4,
  maxChildren = 12,
  includeSemantics = true,
): string {
  const lines: string[] = [];
  const vb = root.getAttribute('viewBox');
  const head = [
    `<svg>${vb ? ` viewBox="${vb}"` : ''}`,
    `${stats.elements} 元素`,
    `${stats.paths} path`,
    `${stats.bytes} B`,
  ];
  if (stats.ids === 0) head.push('⚠ 0 个 id');
  lines.push(head.join('  ·  '));
  lines.push('');

  if (includeSemantics) {
    const semantics = semanticSection(root);
    if (semantics.length > 0) {
      lines.push(...semantics);
      lines.push('');
    }
  }

  const walk = (node: DigestNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    const branch = isRoot ? '' : isLast ? '└─ ' : '├─ ';
    const parts = [`<${node.tag}>`];
    if (node.id) parts.push(`#${node.id}`);
    if (node.classes.length) parts.push(`.${node.classes.join('.')}`);
    for (const [k, v] of node.attrs) parts.push(`${k}="${v}"`);
    if (node.note) parts.push(`— ${node.note}`);
    if (node.childCount > node.shownChildren) {
      parts.push(`(+${node.childCount - node.shownChildren})`);
    }
    lines.push(`${prefix}${branch}${parts.join(' ')}`);

    const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`;
    node.children.forEach((child, i) => {
      walk(child, childPrefix, i === node.children.length - 1, false);
    });
    if (node.childCount > node.shownChildren) {
      lines.push(`${childPrefix}└─ … 另有 ${node.childCount - node.shownChildren} 个同级`);
    }
  };

  const tree = buildDigest(root, 0, maxDepth, maxChildren);
  tree.children.forEach((child, i) => {
    walk(child, '', i === tree.children.length - 1, false);
  });
  if (tree.childCount > tree.shownChildren) {
    lines.push(`└─ … 另有 ${tree.childCount - tree.shownChildren} 个顶层节点`);
  }
  return lines.join('\n');
}

export function digestJson(root: Element, maxDepth = 4, maxChildren = 12): unknown {
  return buildDigest(root, 0, maxDepth, maxChildren);
}

/** 供 UI 显示的数值摘要。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
