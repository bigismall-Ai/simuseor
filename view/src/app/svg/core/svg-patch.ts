/**
 * LLM 补丁协议：只接受定点操作，不接受「整文件重写」。
 *
 * 目标寻址支持 `#id`、`svg`（根），以及工作台「生成补丁」产出的结构选择器
 * （`svg > g:nth-of-type(2) > path:nth-of-type(3)`）。没有 id 的元素请先跑 assign-ids。
 * 每个 op 独立校验，失败只记录不中断，最终返回机器可读的 issues。
 *
 * 新 op 的边界：
 * - 锚点索引统一按 `collectAnchors()` 的顺序（每条命令的 point/c1/c2 都占一个索引）；
 * - `group` 只做结构重排，不写 transform，因此不会改变任何坐标；
 * - `ungroup` 只接受无 transform 的组，组身上的其它表现属性（fill/opacity 等）不会继承。
 */

import { SVG_NS, SvgDocument, allElements, formatNumber } from './svg-doc';
import { createGradient, setDirection, setStops } from './svg-gradient';
import {
  moveAnchor as movePathAnchor,
  parsePath,
  parsePoints,
  serializePath,
  serializePoints,
} from './svg-path';
import type { GradientDirection, GradientStop } from './svg-gradient';

export type PatchOpName =
  | 'setAttr'
  | 'removeAttr'
  | 'translate'
  | 'remove'
  | 'reorder'
  | 'add'
  | 'replacePath'
  | 'moveAnchor'
  | 'moveHandle'
  | 'setGradient'
  | 'group'
  | 'ungroup';

export interface PatchStop {
  offset: number;
  color: string;
  opacity?: string;
}

export interface PatchOp {
  op: PatchOpName | string;
  target?: string;
  /** group：要归入新 <g> 的元素，按数组顺序排列。 */
  targets?: string[];
  attr?: string;
  value?: string | number | null;
  dx?: number;
  dy?: number;
  position?: 'first' | 'last' | 'before' | 'after';
  ref?: string;
  parent?: string;
  svg?: string;
  index?: number;
  d?: string;
  /** moveAnchor / moveHandle：锚点索引（collectAnchors 顺序）。 */
  anchor?: number;
  x?: number;
  y?: number;
  /** setGradient：把渐变挂到哪个通道。 */
  channel?: 'fill' | 'stroke';
  /** setGradient：色标，2–8 个。 */
  stops?: PatchStop[];
  /** setGradient：渐变方向；省略则新建时用 h、更新时保持原样。 */
  direction?: GradientDirection;
  /** group / setGradient：新元素 id；setGradient 下已有同 id 渐变则复用。 */
  id?: string;
  /** group：写入 data-role。 */
  role?: string;
}

export type IssueCode =
  | 'unknown-op'
  | 'target-not-found'
  | 'invalid-value'
  | 'unsafe-attr'
  | 'bad-fragment'
  | 'duplicate-id'
  | 'cycle'
  | 'invalid-anchor'
  | 'invalid-gradient'
  | 'invalid-group';

export interface PatchIssue {
  index: number;
  op: string;
  target: string | null;
  code: IssueCode;
  message: string;
}

export interface PatchOutcome {
  text: string;
  applied: number;
  issues: PatchIssue[];
  changed: boolean;
}

const UNSAFE_ATTR = /^on|^style$|^href$|^xlink:href$/i;

const ID_RE = /^[A-Za-z_][\w.:-]*$/;

export function applyPatch(
  source: SvgDocument,
  ops: PatchOp[],
  options: { precision?: number } = {},
): PatchOutcome {
  const doc = source.clone();
  const issues: PatchIssue[] = [];
  const precision = options.precision ?? 2;
  let applied = 0;

  ops.forEach((op, index) => {
    const report = (code: IssueCode, message: string) => {
      issues.push({ index, op: String(op?.op), target: op?.target ?? null, code, message });
    };

    if (!op || typeof op !== 'object') {
      report('bad-fragment', '操作必须是对象');
      return;
    }

    switch (op.op) {
      case 'setAttr': {
        if (!op.attr) return report('invalid-value', '缺少 attr');
        if (UNSAFE_ATTR.test(op.attr)) return report('unsafe-attr', `不允许修改 ${op.attr}`);
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (op.value === null || op.value === '') el.removeAttribute(op.attr);
        else el.setAttribute(op.attr, String(op.value));
        applied += 1;
        return;
      }

      case 'removeAttr': {
        if (!op.attr) return report('invalid-value', '缺少 attr');
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        el.removeAttribute(op.attr);
        applied += 1;
        return;
      }

      case 'translate': {
        const dx = Number(op.dx ?? 0);
        const dy = Number(op.dy ?? 0);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          return report('invalid-value', 'dx/dy 必须是数字');
        }
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        const old = el.getAttribute('transform') ?? '';
        const leading = /^translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)\s*/.exec(old);
        if (leading) {
          const nx = Number(leading[1]) + dx;
          const ny = Number(leading[2] ?? 0) + dy;
          const rest = old.slice(leading[0].length);
          el.setAttribute(
            'transform',
            `translate(${formatNumber(nx, 3)} ${formatNumber(ny, 3)})${rest ? ` ${rest}` : ''}`,
          );
        } else {
          const move = `translate(${formatNumber(dx, 3)} ${formatNumber(dy, 3)})`;
          el.setAttribute('transform', old ? `${move} ${old}` : move);
        }
        applied += 1;
        return;
      }

      case 'remove': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (el === doc.root) return report('invalid-value', '不能删除根 <svg>');
        el.remove();
        applied += 1;
        return;
      }

      case 'reorder': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        const parent = el.parentElement;
        if (!parent) return report('invalid-value', '目标没有父节点');
        if (op.position === 'first') parent.insertBefore(el, parent.firstElementChild);
        else if (op.position === 'last') parent.appendChild(el);
        else if (op.position === 'before' || op.position === 'after') {
          const ref = resolveTarget(doc, op.ref);
          if (!ref) return report('target-not-found', `找不到参考节点 ${op.ref}`);
          if (ref.parentElement !== parent) return report('invalid-value', '参考节点不在同一层');
          if (ref === el) return report('cycle', '不能相对自身排序');
          parent.insertBefore(el, op.position === 'before' ? ref : ref.nextSibling);
        } else {
          return report('invalid-value', 'position 必须是 first/last/before/after');
        }
        applied += 1;
        return;
      }

      case 'add': {
        if (!op.svg) return report('invalid-value', '缺少 svg 片段');
        const parent = resolveTarget(doc, op.parent ?? 'svg');
        if (!parent) return report('target-not-found', `找不到父节点 ${op.parent ?? 'svg'}`);
        const nodes = parseFragment(op.svg);
        if (!nodes || nodes.length === 0) return report('bad-fragment', '片段不是合法 XML');
        const host = doc.root.ownerDocument;
        let index = Number.isFinite(op.index)
          ? Math.max(0, Number(op.index))
          : parent.children.length;
        for (const candidate of nodes) {
          const node = host.importNode(candidate, true);
          const before = parent.children[index] ?? null;
          parent.insertBefore(node, before);
          index += 1;
        }
        applied += 1;
        return;
      }

      case 'replacePath': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (!el.hasAttribute('d')) return report('invalid-value', '目标不是 <path>');
        if (typeof op.d !== 'string' || !op.d.trim()) return report('invalid-value', '缺少 d');
        el.setAttribute('d', op.d.trim());
        applied += 1;
        return;
      }

      case 'moveAnchor': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        const anchor = toIndex(op.anchor);
        const x = toNumber(op.x);
        const y = toNumber(op.y);
        if (anchor === null) return report('invalid-anchor', 'anchor 必须是非负整数索引');
        if (x === null || y === null) return report('invalid-value', 'x/y 必须是数字');

        if (el.localName === 'path') {
          const parsed = parsePath(el.getAttribute('d') ?? '');
          if (!parsed) return report('invalid-value', 'path 的 d 无法解析');
          if (anchor >= parsed.anchors.length) {
            return report(
              'invalid-anchor',
              `锚点索引 ${anchor} 越界（共 ${parsed.anchors.length} 个锚点）`,
            );
          }
          movePathAnchor(parsed, anchor, x, y);
          el.setAttribute('d', serializePath(parsed, precision));
          applied += 1;
          return;
        }

        if (el.localName === 'polygon' || el.localName === 'polyline') {
          const points = parsePoints(el.getAttribute('points') ?? '');
          if (!points) return report('invalid-value', '目标 points 无法解析');
          if (anchor >= points.length) {
            return report('invalid-anchor', `点索引 ${anchor} 越界（共 ${points.length} 个点）`);
          }
          points[anchor] = { x, y };
          el.setAttribute('points', serializePoints(points, precision));
          applied += 1;
          return;
        }

        return report(
          'invalid-anchor',
          `<${el.localName}> 不支持锚点编辑（只支持 path/polygon/polyline）`,
        );
      }

      case 'moveHandle': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (el.localName !== 'path') {
          return report('invalid-anchor', `moveHandle 只支持 <path>，目标是 <${el.localName}>`);
        }
        const anchor = toIndex(op.anchor);
        const x = toNumber(op.x);
        const y = toNumber(op.y);
        if (anchor === null) return report('invalid-anchor', 'anchor 必须是非负整数索引');
        if (x === null || y === null) return report('invalid-value', 'x/y 必须是数字');
        const parsed = parsePath(el.getAttribute('d') ?? '');
        if (!parsed) return report('invalid-value', 'path 的 d 无法解析');
        const entry = parsed.anchors[anchor];
        if (!entry) {
          return report(
            'invalid-anchor',
            `锚点索引 ${anchor} 越界（共 ${parsed.anchors.length} 个锚点）`,
          );
        }
        if (entry.role === 'point') {
          return report('invalid-anchor', `锚点 ${anchor} 是顶点（role=point），请用 moveAnchor`);
        }
        movePathAnchor(parsed, anchor, x, y);
        el.setAttribute('d', serializePath(parsed, precision));
        applied += 1;
        return;
      }

      case 'setGradient': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (op.channel !== 'fill' && op.channel !== 'stroke') {
          return report('invalid-value', 'channel 必须是 fill 或 stroke');
        }
        const parsed = readStopList(op.stops);
        if (!parsed.ok) return report('invalid-gradient', parsed.message);
        if (op.direction !== undefined && !isDirection(op.direction)) {
          return report('invalid-value', 'direction 必须是 h/v/d');
        }
        const direction: GradientDirection = isDirection(op.direction) ? op.direction : 'h';

        const requested = readOptionalId(op.id);
        if (requested.error) return report('invalid-value', requested.error);

        let id: string;
        if (requested.id) {
          const existing = findElementById(doc, requested.id);
          if (existing) {
            if (!isGradientElement(existing)) {
              return report(
                'invalid-gradient',
                `#${requested.id} 已存在且不是 <linearGradient>/<radialGradient>`,
              );
            }
            setStops(doc.root, requested.id, parsed.stops);
            if (op.direction !== undefined) setDirection(doc.root, requested.id, direction);
            id = requested.id;
          } else {
            id = createNamedGradient(doc, requested.id, parsed.stops, direction);
          }
        } else {
          id = createGradient(doc.root, parsed.stops, 'linear', direction);
        }

        el.setAttribute(op.channel, `url(#${id})`);
        applied += 1;
        return;
      }

      case 'group': {
        if (!Array.isArray(op.targets) || op.targets.length === 0) {
          return report('invalid-group', 'targets 至少需要 1 个目标');
        }
        const targets: Element[] = [];
        for (const spec of op.targets) {
          if (typeof spec !== 'string' || !spec.trim()) {
            return report('invalid-group', 'targets 的每一项都必须是非空选择器字符串');
          }
          const el = resolveTarget(doc, spec);
          if (!el) return report('target-not-found', `找不到 ${spec}`);
          if (el === doc.root) return report('invalid-group', '不能把根 <svg> 分组');
          if (!targets.includes(el)) targets.push(el);
        }

        const parent = targets[0].parentElement;
        if (!parent) return report('invalid-group', '目标没有父节点');
        if (targets.some((el) => el.parentElement !== parent)) {
          return report('invalid-group', '所有目标必须在同一父节点下');
        }
        for (let i = 0; i < targets.length; i += 1) {
          for (let j = 0; j < targets.length; j += 1) {
            if (i !== j && targets[i].contains(targets[j])) {
              return report('invalid-group', '目标之间存在嵌套，不能放进同一个组');
            }
          }
        }

        // 目标必须连续：跨过非目标兄弟会把它们留在组外，重叠图形的层叠顺序会变。
        const siblings = Array.from(parent.children);
        const positions = targets.map((el) => siblings.indexOf(el)).sort((a, b) => a - b);
        const span = siblings.slice(positions[0], positions[positions.length - 1] + 1);
        if (span.some((node) => !targets.includes(node))) {
          return report('invalid-group', '目标之间夹着非目标节点；分组会改变层叠顺序，请先用 reorder 把它们排到一起');
        }

        const requested = readOptionalId(op.id);
        if (requested.error) return report('invalid-value', requested.error);
        if (requested.id && findElementById(doc, requested.id)) {
          return report('duplicate-id', `id 已存在：${requested.id}`);
        }
        const id = requested.id ?? uniqueId(doc, 'group');

        let role = '';
        if (op.role !== undefined && op.role !== null) {
          if (typeof op.role !== 'string' || !op.role.trim()) {
            return report('invalid-value', 'role 必须是非空字符串');
          }
          role = op.role.trim();
        }

        const group = doc.root.ownerDocument.createElementNS(SVG_NS, 'g');
        group.setAttribute('id', id);
        if (role) group.setAttribute('data-role', role);
        parent.insertBefore(group, targets[0]);
        for (const el of targets) group.appendChild(el);
        applied += 1;
        return;
      }

      case 'ungroup': {
        const el = resolveTarget(doc, op.target);
        if (!el) return report('target-not-found', `找不到 ${op.target}`);
        if (el === doc.root) return report('invalid-group', '不能拆解根 <svg>');
        if (el.localName !== 'g') {
          return report('invalid-group', `目标不是 <g>，而是 <${el.localName}>`);
        }
        if ((el.getAttribute('transform') ?? '').trim()) {
          return report('invalid-group', '暂不支持带 transform 的组；请先清除 transform 再拆解');
        }
        if (el.hasAttribute('data-role') || el.hasAttribute('data-label')) {
          return report('invalid-group', '这是语义部件组；拆解会丢失语义，请先清除 data-role/data-label 或改名');
        }
        const inherited = [
          'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity',
          'fill-rule', 'clip-path', 'mask', 'filter', 'class', 'style', 'display', 'visibility',
        ].filter((name) => el.hasAttribute(name));
        if (inherited.length > 0) {
          return report('invalid-group', `组上有呈现属性（${inherited.join(', ')}）；拆解会丢失，请先内联到子元素`);
        }
        const groupId = el.getAttribute('id');
        if (groupId && isIdReferenced(doc, groupId)) {
          return report('invalid-group', `组 id #${groupId} 仍被引用；先改写或删除引用再拆解`);
        }
        const parent = el.parentElement;
        if (!parent) return report('invalid-group', '目标没有父节点');
        for (const node of Array.from(el.childNodes)) parent.insertBefore(node, el);
        el.remove();
        applied += 1;
        return;
      }

      default:
        return report('unknown-op', `未知操作 ${String(op.op)}`);
    }
  });

  const dup = findDuplicateId(doc);
  if (dup) {
    issues.push({
      index: -1,
      op: 'validate',
      target: `#${dup}`,
      code: 'duplicate-id',
      message: `补丁后出现重复 id：${dup}`,
    });
  }

  return {
    text: doc.canonical({ precision: options.precision ?? 2 }),
    applied,
    issues,
    changed: applied > 0,
  };
}

const STRUCTURAL =
  /^svg\s*>\s*(?:[a-zA-Z][\w-]*(?::nth-of-type\(\d+\))?)(?:\s*>\s*[a-zA-Z][\w-]*(?::nth-of-type\(\d+\))?)*$/;

export function resolveTarget(doc: SvgDocument, target: string | undefined): Element | null {
  if (!target || target === 'svg' || target === 'root') return doc.root;
  const trimmed = target.trim();
  if (trimmed.startsWith('#')) {
    const id = trimmed.slice(1);
    for (const el of allElements(doc.root)) {
      if (el.getAttribute('id') === id) return el;
    }
    return null;
  }
  // 允许工作台「生成补丁」产出的结构选择器：svg > g:nth-of-type(2) > path:nth-of-type(3)
  if (!STRUCTURAL.test(trimmed)) return null;
  const rest = trimmed.replace(/^svg\s*>\s*/, '');
  try {
    return doc.root.querySelector(`:scope > ${rest}`);
  } catch {
    return null;
  }
}

function parseFragment(svg: string): Element[] | null {
  const hasSvgRoot = /<svg[\s>]/i.test(svg);
  const wrapped = hasSvgRoot ? svg : `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  const parsed = new DOMParser().parseFromString(wrapped, 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) return null;
  const root = parsed.documentElement;
  if (!root) return null;
  return hasSvgRoot ? [root] : Array.from(root.children);
}

function isIdReferenced(doc: SvgDocument, id: string): boolean {
  const needle = `#${id}`;
  for (const el of allElements(doc.root)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes(needle)) return true;
      if (attr.name === 'begin' || attr.name === 'end') {
        if (attr.value.startsWith(`${id}.`)) return true;
      }
      if (attr.name === 'aria-labelledby' || attr.name === 'aria-describedby') {
        if (attr.value.split(/\s+/).includes(id)) return true;
      }
    }
    if (el.localName === 'style' && (el.textContent ?? '').includes(needle)) return true;
  }
  return false;
}

function findDuplicateId(doc: SvgDocument): string | null {
  const seen = new Set<string>();
  for (const el of allElements(doc.root)) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

function findElementById(doc: SvgDocument, id: string): Element | null {
  for (const el of allElements(doc.root)) {
    if (el.getAttribute('id') === id) return el;
  }
  return null;
}

function uniqueId(doc: SvgDocument, prefix: string): string {
  const used = new Set<string>();
  for (const el of allElements(doc.root)) {
    const id = el.getAttribute('id');
    if (id) used.add(id);
  }
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function isGradientElement(el: Element): boolean {
  return el.localName === 'linearGradient' || el.localName === 'radialGradient';
}

/** 复用 createGradient 的 defs/唯一 id 逻辑，再把自动 id 改成调用方指定的 id。 */
function createNamedGradient(
  doc: SvgDocument,
  id: string,
  stops: GradientStop[],
  direction: GradientDirection,
): string {
  const generated = createGradient(doc.root, stops, 'linear', direction);
  const el = findElementById(doc, generated);
  if (!el) return generated;
  el.setAttribute('id', id);
  return id;
}

type StopResult = { ok: true; stops: GradientStop[] } | { ok: false; message: string };

function readStopList(value: PatchStop[] | undefined): StopResult {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    return { ok: false, message: 'stops 需要 2–8 个色标' };
  }
  const stops: GradientStop[] = [];
  for (const stop of value) {
    if (!stop || typeof stop !== 'object') {
      return { ok: false, message: '每个色标必须是 { offset, color } 对象' };
    }
    const offset = toNumber(stop.offset);
    if (offset === null || offset < 0 || offset > 1) {
      return { ok: false, message: `offset 必须在 0..1：${String(stop.offset)}` };
    }
    const color = typeof stop.color === 'string' ? stop.color.trim() : '';
    if (!color) return { ok: false, message: '色标缺少 color' };
    const opacity =
      stop.opacity === undefined || stop.opacity === null ? 1 : toNumber(stop.opacity);
    if (opacity === null || opacity < 0 || opacity > 1) {
      return { ok: false, message: 'opacity 必须在 0..1' };
    }
    stops.push({ offset, color, opacity: String(opacity) });
  }
  return { ok: true, stops };
}

function readOptionalId(value: unknown): { id: string | null; error: string | null } {
  if (value === undefined || value === null) return { id: null, error: null };
  if (typeof value !== 'string' || !value.trim()) {
    return { id: null, error: 'id 必须是非空字符串' };
  }
  const id = value.trim();
  if (!ID_RE.test(id)) return { id: null, error: `id 不合法：${id}` };
  return { id, error: null };
}

function isDirection(value: unknown): value is GradientDirection {
  return value === 'h' || value === 'v' || value === 'd';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toIndex(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

export const PATCH_EXAMPLE = `[
  { "op": "setAttr", "target": "#g-3", "attr": "fill", "value": "#b95e4e" },
  { "op": "translate", "target": "#path-12", "dx": -4, "dy": 0 },
  { "op": "reorder", "target": "#bg", "position": "first" }
]`;

/** 给 LLM 的完整协议示例：每种 op 一条，可直接作为补丁草稿。 */
const PATCH_SPEC_OPS: PatchOp[] = [
  { op: 'setAttr', target: '#path-3', attr: 'fill', value: '#b95e4e' },
  { op: 'removeAttr', target: '#path-3', attr: 'stroke' },
  { op: 'translate', target: '#g-7', dx: -4, dy: 0 },
  { op: 'reorder', target: '#bg', position: 'first' },
  { op: 'reorder', target: '#cloud-2', position: 'before', ref: '#cloud-1' },
  {
    op: 'add',
    parent: '#body',
    index: 0,
    svg: '<path id="new-1" d="M0 0 L10 10 Z" fill="#222c28"/>',
  },
  { op: 'remove', target: '#old-2' },
  { op: 'replacePath', target: '#path-3', d: 'M0 0 C4 0 8 4 8 8 L0 8 Z' },
  { op: 'moveAnchor', target: '#path-3', anchor: 0, x: 2, y: 1 },
  { op: 'moveHandle', target: '#path-3', anchor: 1, x: 6, y: 2 },
  {
    op: 'setGradient',
    target: '#g-7',
    channel: 'fill',
    id: 'sky',
    direction: 'v',
    stops: [
      { offset: 0, color: '#dce9f2' },
      { offset: 1, color: '#8fb8cf', opacity: '0.9' },
    ],
  },
  { op: 'group', targets: ['#path-3', '#path-4'], id: 'wings', role: 'decoration' },
  { op: 'ungroup', target: '#legacy-group' },
];

export const PATCH_SPEC: string = JSON.stringify(PATCH_SPEC_OPS, null, 2);
