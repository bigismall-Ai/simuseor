/**
 * 保守优化管线。
 *
 * 与 SVGO 的区别：不合并 path、不改命令字母、不重命名 id、不做 move/convert 变换，
 * 只做「语义等价且可解释」的清洗。每一步都产出可读报告，便于人工与 LLM 审阅。
 *
 * 其中 `inline-css` 针对 Illustrator 导出：把 `<style>` 里的类选择器展开成元素属性，
 * 这是让 LLM 能按元素读写颜色/描边的关键一步。
 */

import {
  allElements,
  formatNumberList,
  formatPathData,
  isNumericAttribute,
  normalizeAttrValue,
  type CanonicalOptions,
} from './svg-doc';

export type PassId =
  | 'inline-css'
  | 'expand-style'
  | 'round-numbers'
  | 'compact-path'
  | 'strip-editor'
  | 'strip-unsafe'
  | 'remove-comments'
  | 'remove-empty'
  | 'remove-unused-defs'
  | 'assign-ids'
  | 'stable-ids'
  | 'strip-title';

export interface PassInfo {
  id: PassId;
  title: string;
  desc: string;
  /** 会改动结构（新增/删除元素或属性），不是纯格式化。 */
  structural: boolean;
}

export const PASSES: PassInfo[] = [
  {
    id: 'inline-css',
    title: '内联 <style> 类选择器',
    desc: '把 .cls-N 规则展开为元素属性，移除 style 与 class —— LLM 才能按元素直接改色。',
    structural: false,
  },
  {
    id: 'expand-style',
    title: '展开 style="" 属性',
    desc: '把行内 style 声明提升为可读的呈现属性（保留无法搬运的声明）。',
    structural: false,
  },
  {
    id: 'round-numbers',
    title: '统一小数精度',
    desc: '按当前精度四舍五入所有数值，槽位与格式固定。',
    structural: false,
  },
  {
    id: 'compact-path',
    title: '压缩 path 数据',
    desc: '只规范 d/points 的空白与数字写法（M10 20L30 40），不动命令结构。',
    structural: false,
  },
  {
    id: 'strip-editor',
    title: '清理编辑器元数据',
    desc: '删除 metadata、data-name、inkscape/sodipodi/illustrator 属性与「图层」id。',
    structural: true,
  },
  {
    id: 'strip-unsafe',
    title: '移除不安全内容',
    desc: '删除 script/foreignObject/on* 与 javascript: 链接。',
    structural: true,
  },
  {
    id: 'remove-comments',
    title: '删除注释',
    desc: 'XML 注释对渲染无影响，且会打断 LLM 的上下文。',
    structural: true,
  },
  {
    id: 'remove-empty',
    title: '删除空容器',
    desc: '清理没有子元素与文本的 <g>/<defs>/<clipPath> 等。',
    structural: true,
  },
  {
    id: 'remove-unused-defs',
    title: '删除未引用的 defs',
    desc: '没有任何 url(#id)/href="#id" 引用的渐变、蒙版、裁剪与 symbol。',
    structural: true,
  },
  {
    id: 'assign-ids',
    title: '补齐元素 id（位置编号）',
    desc: '按文档顺序补 id，适合临时定点；重排后会变，长期请用「稳定 id」。',
    structural: true,
  },
  {
    id: 'stable-ids',
    title: '稳定 id',
    desc: '把编辑器随机 id / 位置编号换成语义名或几何哈希，并同步改写 url(#…)、href 等引用；重排不再改变 id。',
    structural: true,
  },
  {
    id: 'strip-title',
    title: '删除 title/desc',
    desc: '可访问性文本；如需保留请勿勾选。语义部件组下的 <title> 会保留。',
    structural: true,
  },
];

export const SAFE_PASSES: PassId[] = [
  'inline-css',
  'expand-style',
  'round-numbers',
  'compact-path',
  'strip-editor',
  'strip-unsafe',
  'remove-comments',
  'remove-empty',
  'remove-unused-defs',
];

/** 固定执行顺序，避免用户勾选顺序影响结果。 */
const PASS_ORDER: PassId[] = PASSES.map((p) => p.id);

export interface PassReport {
  id: PassId;
  title: string;
  changes: number;
  notes: string[];
}

export interface OptimizeOptions {
  precision: number;
}

export interface OptimizeResult {
  reports: PassReport[];
  changes: number;
}

interface PassOutcome {
  changes: number;
  notes?: string[];
}

export function runPasses(root: Element, ids: PassId[], options: OptimizeOptions): OptimizeResult {
  const wanted = new Set(ids);
  const reports: PassReport[] = [];
  for (const id of PASS_ORDER) {
    if (!wanted.has(id)) continue;
    const info = PASSES.find((p) => p.id === id);
    if (!info) continue;
    const outcome = runPass(root, id, options);
    reports.push({
      id,
      title: info.title,
      changes: outcome.changes,
      notes: outcome.notes ?? [],
    });
  }
  return { reports, changes: reports.reduce((n, r) => n + r.changes, 0) };
}

function runPass(root: Element, id: PassId, options: OptimizeOptions): PassOutcome {
  switch (id) {
    case 'inline-css':
      return inlineCss(root);
    case 'expand-style':
      return expandStyleAttrs(root);
    case 'round-numbers':
      return roundNumbers(root, options);
    case 'compact-path':
      return compactPaths(root, options);
    case 'strip-editor':
      return stripEditor(root);
    case 'strip-unsafe':
      return stripUnsafe(root);
    case 'remove-comments':
      return removeComments(root);
    case 'remove-empty':
      return removeEmpty(root);
    case 'remove-unused-defs':
      return removeUnusedDefs(root);
    case 'assign-ids':
      return assignIds(root);
    case 'stable-ids':
      return stableIds(root);
    case 'strip-title':
      return stripTitle(root);
  }
}

/* ------------------------------------------------------------------ */
/* CSS                                                                 */
/* ------------------------------------------------------------------ */

const PRESENTATION_PROPS = new Set([
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
  'clip-rule',
  'color',
  'stop-color',
  'stop-opacity',
  'paint-order',
  'vector-effect',
  'mix-blend-mode',
  'display',
  'visibility',
]);

interface CssRule {
  tag: string | null;
  id: string | null;
  classes: string[];
  spec: number;
  order: number;
  props: Array<[string, string]>;
}

interface CssParse {
  rules: CssRule[];
  skipped: string[];
}

function parseCss(css: string): CssParse {
  const skipped: string[] = [];
  const clean = css
    .replace(/<!--|-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (!clean) return { rules: [], skipped };
  if (/@(?:media|supports|layer|container|import|font-face|keyframes|page|namespace)/i.test(clean)) {
    skipped.push('包含 @ 规则，整体跳过');
    return { rules: [], skipped };
  }

  const rules: CssRule[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let order = 0;
  for (const match of clean.matchAll(ruleRe)) {
    const selectorText = match[1].trim();
    const body = match[2].trim();
    const selectors = selectorText.split(',').map((s) => s.trim()).filter(Boolean);
    const parsed = selectors.map(parseSelector);
    if (parsed.some((s) => s === null)) {
      skipped.push(`选择器不支持：${selectorText}`);
      continue;
    }

    const props: Array<[string, string]> = [];
    for (const decl of body.split(';')) {
      const part = decl.trim();
      if (!part) continue;
      const i = part.indexOf(':');
      if (i < 0) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      let value = part.slice(i + 1).trim();
      if (!PRESENTATION_PROPS.has(prop)) {
        skipped.push(`属性不支持：${prop}`);
        continue;
      }
      if (/!important/i.test(value) || /var\(/i.test(value)) {
        skipped.push(`值不支持：${prop}: ${value}`);
        continue;
      }
      value = value.replace(/\s+/g, ' ');
      props.push([prop, value]);
    }
    if (props.length === 0) continue;

    for (const sel of parsed) {
      if (!sel) continue;
      rules.push({ ...sel, order, props });
      order += 1;
    }
  }
  return { rules, skipped };
}

function parseSelector(sel: string): Omit<CssRule, 'order' | 'props'> | null {
  if (!sel || /[>+~:[\](),*]/.test(sel)) return null;
  if (/\s/.test(sel)) return null;
  const tag = /^[a-zA-Z][\w-]*/.exec(sel)?.[0]?.toLowerCase() ?? null;
  const id = /#([\w-]+)/.exec(sel)?.[1] ?? null;
  const classes = Array.from(sel.matchAll(/\.([\w-]+)/g)).map((m) => m[1]);
  const rest = sel
    .replace(/^[a-zA-Z][\w-]*/, '')
    .replace(/#[\w-]+/g, '')
    .replace(/\.[\w-]+/g, '');
  if (rest) return null;
  const spec = (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0);
  return { tag, id, classes, spec };
}

function matchesRule(el: Element, rule: Omit<CssRule, 'order' | 'props'>): boolean {
  if (rule.tag && el.localName.toLowerCase() !== rule.tag) return false;
  if (rule.id && el.getAttribute('id') !== rule.id) return false;
  if (rule.classes.length > 0) {
    const own = new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
    if (!rule.classes.every((c) => own.has(c))) return false;
  }
  return true;
}

function inlineCss(root: Element): PassOutcome {
  const styleEls = allElements(root).filter((el) => el.localName === 'style');
  if (styleEls.length === 0) return { changes: 0 };

  const css = styleEls.map((el) => el.textContent ?? '').join('\n');
  const { rules, skipped } = parseCss(css);
  if (rules.length === 0) {
    return { changes: 0, notes: skipped.slice(0, 3) };
  }

  let changes = 0;
  for (const el of allElements(root)) {
    const best = new Map<string, { spec: number; order: number; value: string }>();
    for (const rule of rules) {
      if (!matchesRule(el, rule)) continue;
      for (const [prop, value] of rule.props) {
        const cur = best.get(prop);
        if (!cur || rule.spec > cur.spec || (rule.spec === cur.spec && rule.order >= cur.order)) {
          best.set(prop, { spec: rule.spec, order: rule.order, value });
        }
      }
    }
    for (const [prop, entry] of best) {
      if (el.getAttribute(prop) !== entry.value) {
        el.setAttribute(prop, entry.value);
        changes += 1;
      }
    }
  }

  if (skipped.length === 0) {
    for (const el of styleEls) el.remove();
    let removedClasses = 0;
    for (const el of allElements(root)) {
      if (el.hasAttribute('class')) {
        el.removeAttribute('class');
        removedClasses += 1;
      }
    }
    return {
      changes: changes + removedClasses + styleEls.length,
      notes: [
        `${rules.length} 条声明内联，删除 ${styleEls.length} 个 <style>、${removedClasses} 个 class`,
      ],
    };
  }

  return {
    changes,
    notes: [`已内联 ${rules.length} 条声明；${skipped.length} 项无法搬运，保留 <style>`],
  };
}

function expandStyleAttrs(root: Element): PassOutcome {
  let changes = 0;
  const notes: string[] = [];
  const hasStylesheet = allElements(root).some((el) => el.localName === 'style');
  for (const el of allElements(root)) {
    const raw = el.getAttribute('style');
    if (!raw) continue;
    // style="" 的优先级高于 class 规则；搬到呈现属性后会输给 class，画面就变了。
    if (hasStylesheet && el.hasAttribute('class')) {
      notes.push('保留 style：元素同时带 class，搬移会改变优先级');
      continue;
    }
    const props: Array<[string, string]> = [];
    let unsupported = false;
    for (const decl of raw.split(';')) {
      const part = decl.trim();
      if (!part) continue;
      const i = part.indexOf(':');
      if (i < 0) {
        unsupported = true;
        continue;
      }
      const prop = part.slice(0, i).trim().toLowerCase();
      const value = part.slice(i + 1).trim();
      if (!PRESENTATION_PROPS.has(prop) || /!important|var\(/i.test(value)) {
        unsupported = true;
        continue;
      }
      props.push([prop, value]);
    }
    if (props.length === 0 || unsupported) {
      if (unsupported) notes.push(`保留 style：${truncate(raw, 40)}`);
      continue;
    }
    for (const [prop, value] of props) el.setAttribute(prop, value);
    el.removeAttribute('style');
    changes += 1;
  }
  return { changes, notes: notes.slice(0, 3) };
}

/* ------------------------------------------------------------------ */
/* 数值                                                                */
/* ------------------------------------------------------------------ */

function numericOptions(precision: number, compact: boolean): CanonicalOptions {
  return { precision, compact, indent: '  ', keepComments: false };
}

function roundNumbers(root: Element, options: OptimizeOptions): PassOutcome {
  const opts = numericOptions(options.precision, false);
  let changes = 0;
  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      if (!isNumericAttribute(attr.name)) continue;
      const next = normalizeAttrValue(attr.name, attr.value, opts);
      if (next !== attr.value) {
        el.setAttribute(attr.name, next);
        changes += 1;
      }
    }
  }
  return { changes };
}

function compactPaths(root: Element, options: OptimizeOptions): PassOutcome {
  let changes = 0;
  for (const el of allElements(root)) {
    const d = el.getAttribute('d');
    if (d !== null) {
      const next = formatPathData(d, options.precision, true);
      if (next !== d) {
        el.setAttribute('d', next);
        changes += 1;
      }
    }
    const points = el.getAttribute('points');
    if (points !== null) {
      const next = formatNumberList(points, options.precision, true);
      if (next !== points) {
        el.setAttribute('points', next);
        changes += 1;
      }
    }
  }
  return { changes };
}

/* ------------------------------------------------------------------ */
/* 清理                                                                */
/* ------------------------------------------------------------------ */

const EDITOR_PREFIXES = ['inkscape:', 'sodipodi:', 'illustrator:', 'i:', 'graph:'];
const EDITOR_TAGS = new Set(['metadata', 'namedview', 'pgf']);
const LAYER_ID = /^(?:_*图层.*|Layer[\s_-]?\d+|Ebene[\s_-]?\d+|Capa[\s_-]?\d+|Calque[\s_-]?\d+|Livello[\s_-]?\d+)$/i;

export function referencedIds(root: Element): Set<string> {
  const refs = new Set<string>();
  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      for (const m of attr.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) refs.add(m[1]);
      if ((attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#')) {
        refs.add(attr.value.slice(1));
      }
      if (attr.name === 'begin') {
        for (const m of attr.value.matchAll(/([^\s.;]+)\./g)) refs.add(m[1]);
      }
    }
    // <style> 里的 url(#id) 也是引用；漏掉会把仍在使用的渐变/蒙版删掉。
    if (el.localName === 'style') {
      for (const m of (el.textContent ?? '').matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) refs.add(m[1]);
    }
  }
  return refs;
}

/**
 * 语义标注不属于编辑器元数据：`data-role` / `data-label` / `data-synonyms` /
 * `aria-label` / `data-locked` / `data-required` 由 svg-semantics 维护，
 * 这里只清理 `data-name`、编辑器命名空间属性与「图层」id，不要扩展成删所有 data-*。
 */
function stripEditor(root: Element): PassOutcome {
  let changes = 0;
  for (const el of allElements(root)) {
    if (el !== root && EDITOR_TAGS.has(el.localName)) {
      el.remove();
      changes += 1;
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (name === 'data-name' || name === 'enable-background') {
        el.removeAttribute(name);
        changes += 1;
        continue;
      }
      if (EDITOR_PREFIXES.some((p) => name.startsWith(p))) {
        el.removeAttribute(name);
        changes += 1;
      }
    }
  }

  const refs = referencedIds(root);
  for (const el of allElements(root)) {
    const id = el.getAttribute('id');
    if (!id || !LAYER_ID.test(id) || refs.has(id)) continue;
    // 语义部件组的 id 是计划 / 补丁的寻址锚点，即使形似图层名也保留。
    if (el.hasAttribute('data-role') || el.hasAttribute('data-label')) continue;
    el.removeAttribute('id');
    changes += 1;
  }

  for (const prefix of EDITOR_PREFIXES) {
    const nsAttr = `xmlns:${prefix.slice(0, -1)}`;
    const prefixUsed = allElements(root).some((el) =>
      Array.from(el.attributes).some((a) => a.name.startsWith(prefix)) ||
      el.tagName.startsWith(prefix),
    );
    if (!prefixUsed) {
      for (const el of allElements(root)) {
        if (el.hasAttribute(nsAttr)) {
          el.removeAttribute(nsAttr);
          changes += 1;
        }
      }
    }
  }

  return { changes };
}

const UNSAFE_TAGS = new Set(['script', 'foreignobject', 'handler', 'listener', 'iframe']);

function stripUnsafe(root: Element): PassOutcome {
  let changes = 0;
  for (const el of allElements(root)) {
    if (UNSAFE_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      changes += 1;
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        changes += 1;
        continue;
      }
      if ((attr.name === 'href' || attr.name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
        changes += 1;
      }
    }
  }
  return { changes };
}

function removeComments(root: Element): PassOutcome {
  let changes = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const doomed: Comment[] = [];
  let node = walker.nextNode();
  while (node) {
    doomed.push(node as Comment);
    node = walker.nextNode();
  }
  for (const c of doomed) {
    c.remove();
    changes += 1;
  }
  return { changes };
}

const CONTAINER_TAGS = new Set(['g', 'defs', 'symbol', 'marker', 'clippath', 'mask', 'pattern']);

function removeEmpty(root: Element): PassOutcome {
  let changes = 0;
  let again = true;
  while (again) {
    again = false;
    for (const el of allElements(root)) {
      if (el === root) continue;
      if (!CONTAINER_TAGS.has(el.localName.toLowerCase())) continue;
      // 语义部件组可能暂时为空（等待补丁填入形状），保留以免计划失去锚点。
      if (el.hasAttribute('data-role') || el.hasAttribute('data-label')) continue;
      if (el.children.length === 0 && !(el.textContent ?? '').trim()) {
        el.remove();
        changes += 1;
        again = true;
      }
    }
  }
  return { changes };
}

const DEF_TAGS = new Set([
  'lineargradient',
  'radialgradient',
  'pattern',
  'clippath',
  'mask',
  'filter',
  'symbol',
  'marker',
]);

function removeUnusedDefs(root: Element): PassOutcome {
  let changes = 0;
  const notes: string[] = [];
  const candidates = new Set<Element>();
  for (const el of allElements(root)) {
    if (!el.getAttribute('id')) continue;
    if (DEF_TAGS.has(el.localName.toLowerCase()) || el.closest('defs')) candidates.add(el);
  }
  if (candidates.size === 0) return { changes: 0 };

  let again = true;
  while (again) {
    again = false;
    const refs = referencedIds(root);
    for (const el of candidates) {
      if (!el.isConnected || !el.parentNode) {
        candidates.delete(el);
        continue;
      }
      const id = el.getAttribute('id');
      if (!id || refs.has(id)) continue;
      notes.push(`删除 #${id}（<${el.localName}>）`);
      el.remove();
      candidates.delete(el);
      changes += 1;
      again = true;
    }
  }
  return { changes, notes: notes.slice(0, 5) };
}

const ID_TARGETS = new Set([
  'g',
  'path',
  'polygon',
  'polyline',
  'rect',
  'circle',
  'ellipse',
  'line',
  'image',
  'text',
  'use',
]);

function assignIds(root: Element): PassOutcome {
  const used = new Set<string>();
  for (const el of allElements(root)) {
    const id = el.getAttribute('id');
    if (id) used.add(id);
  }
  const counters = new Map<string, number>();
  let changes = 0;
  for (const el of allElements(root)) {
    if (el === root || el.hasAttribute('id')) continue;
    if (!ID_TARGETS.has(el.localName)) continue;
    const tag = el.localName;
    let n = counters.get(tag) ?? 0;
    let id = '';
    do {
      n += 1;
      id = `${tag}-${n}`;
    } while (used.has(id));
    counters.set(tag, n);
    used.add(id);
    el.setAttribute('id', id);
    changes += 1;
  }
  return { changes, notes: changes ? [`新增 ${changes} 个 id`] : [] };
}

function stripTitle(root: Element): PassOutcome {
  let changes = 0;
  for (const el of allElements(root)) {
    if (el.localName !== 'title' && el.localName !== 'desc') continue;
    // 语义部件下的 <title> 是 label / 无障碍名称的备份，不随批量清理删除。
    if (el.localName === 'title' && el.closest('[data-role], [data-label]')) continue;
    el.remove();
    changes += 1;
  }
  return { changes };
}

const STABLE_ID_TARGETS = new Set([
  'g',
  'path',
  'polygon',
  'polyline',
  'rect',
  'circle',
  'ellipse',
  'line',
  'image',
  'text',
  'use',
  'linearGradient',
  'radialGradient',
  'clipPath',
  'mask',
  'pattern',
  'filter',
  'symbol',
  'marker',
]);

const STABLE_CONTAINER_TAGS = new Set([
  'g',
  'clipPath',
  'mask',
  'pattern',
  'symbol',
  'marker',
  'filter',
]);

const HASH_PREFIX: Record<string, string> = {
  g: 'group',
  linearGradient: 'grad',
  radialGradient: 'grad',
  clipPath: 'clip',
  image: 'image',
  polygon: 'facet',
  polyline: 'line',
  svg: 'artboard',
};

/** 编辑器/位置编号；小写 layer-2 是稳定 id，不在此列。 */
const UNSTABLE_ID_PATTERNS = [
  /^(?:clip|paint|filter|pattern|mask|image)\d+[_-]\d+/i,
  /^SVGID[_-]?\d+/i,
  /^_*图层.*$/,
  /^Layer[\s_-]*\d+.*$/,
  /^(?:路径|Path|Group|组)[\s_-]*\d+.*$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^(?:rect|circle|ellipse|path|polygon|polyline|g|image|text|use)[-_]\d+$/,
];

export function isUnstableId(id: string, singleLetterIds = 0): boolean {
  if (UNSTABLE_ID_PATTERNS.some((pattern) => pattern.test(id))) return true;
  // SVGO 会把 id 压成 a/b/c…；只有在文档里成规模出现时才认定是压缩产物。
  return singleLetterIds >= 3 && /^[a-z]$/.test(id);
}

function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

function elementSignature(el: Element): string {
  const path = el.getAttribute('d');
  if (path) return `${el.localName}:${formatPathData(path, 2, false)}`;
  const points = el.getAttribute('points');
  if (points) return `${el.localName}:${formatNumberList(points, 2, false)}`;
  const attrs = Array.from(el.attributes)
    .filter((attr) => attr.name !== 'id' && !attr.name.startsWith('data-'))
    .map((attr) => `${attr.name}=${attr.value}`)
    .sort()
    .join('|');
  const children = Array.from(el.children)
    .map((child) => `${child.localName}:${elementSignature(child)}`)
    .join(',');
  return `${el.localName}:${attrs}|${children}`;
}

function slugName(raw: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const slug = trimmed
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (/^[a-z][a-z0-9-]*$/.test(slug) && slug.length >= 2) return slug;
  const numeric = /(\d+)\s*$/.exec(trimmed)?.[1];
  return numeric ? `layer-${numeric}` : '';
}

function stableBase(el: Element): string {
  const named = slugName(el.getAttribute('data-name'));
  if (named) return named;
  return `${HASH_PREFIX[el.localName] ?? el.localName.toLowerCase()}-${shortHash(elementSignature(el))}`;
}

/** 把随机/位置 id 换成语义名或几何哈希，并改写所有引用。 */
function stableIds(root: Element): PassOutcome {
  const elements = allElements(root);
  const singleLetterIds = elements.filter((el) => /^[a-z]$/.test(el.getAttribute('id') ?? '')).length;
  const unstable = (el: Element) => {
    // 语义部件组的 id 是人工/计划指定的锚点，不参与稳定化重命名。
    if (el.hasAttribute('data-role') || el.hasAttribute('data-label')) return false;
    const id = el.getAttribute('id');
    return !!id && isUnstableId(id, singleLetterIds);
  };

  const used = new Set<string>();
  for (const el of elements) {
    const id = el.getAttribute('id');
    if (id && !unstable(el)) used.add(id);
  }

  const plans: Array<{ el: Element; old: string | null; next: string }> = [];
  const reserve = (el: Element, base?: string) => {
    const prefix = HASH_PREFIX[el.localName] ?? el.localName.toLowerCase();
    let id = base || `${prefix}-${shortHash(elementSignature(el))}`;
    let n = 2;
    while (used.has(id)) {
      id = `${base || prefix}-${n}`;
      n += 1;
    }
    used.add(id);
    plans.push({ el, old: el.getAttribute('id'), next: id });
  };

  if (unstable(root) || !root.getAttribute('id')) {
    reserve(root, 'artboard');
  }

  // 先给叶子形状命名，再给容器命名，避免容器的签名依赖尚未命名的子节点。
  for (const el of elements) {
    if (el === root) continue;
    if (!STABLE_ID_TARGETS.has(el.localName) || STABLE_CONTAINER_TAGS.has(el.localName)) continue;
    if (el.getAttribute('id') && !unstable(el)) continue;
    reserve(el);
  }
  for (const el of elements) {
    if (el === root) continue;
    if (!STABLE_CONTAINER_TAGS.has(el.localName)) continue;
    if (el.getAttribute('id') && !unstable(el)) continue;
    reserve(el);
  }

  if (plans.length === 0) return { changes: 0 };

  const rename = new Map<string, string>();
  for (const plan of plans) {
    if (plan.old && plan.old !== plan.next) rename.set(plan.old, plan.next);
  }

  let changes = rewriteReferences(root, rename);
  for (const plan of plans) {
    plan.el.setAttribute('id', plan.next);
    changes += 1;
  }

  const notes = plans.slice(0, 5).map((plan) => `${plan.old ?? '(无)'} → ${plan.next}`);
  if (plans.length > 5) notes.push(`… 共 ${plans.length} 个`);
  return { changes, notes };
}

function rewriteReferences(root: Element, rename: Map<string, string>): number {
  if (rename.size === 0) return 0;
  let changes = 0;

  const url = (value: string): string =>
    value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, quote: string, id: string) => {
      const next = rename.get(id);
      return next ? `url(${quote}#${next}${quote})` : match;
    });

  for (const el of allElements(root)) {
    for (const attr of Array.from(el.attributes)) {
      let value = attr.value;
      const name = attr.name;
      if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
        const next = rename.get(value.slice(1));
        if (next) value = `#${next}`;
      } else if (name === 'aria-labelledby' || name === 'aria-describedby') {
        value = value
          .split(/\s+/)
          .map((id) => rename.get(id) ?? id)
          .join(' ');
      } else if (name === 'begin' || name === 'end') {
        value = value.replace(/^([^.\s]+)\./, (match, id: string) => {
          const next = rename.get(id);
          return next ? `${next}.` : match;
        });
      } else if (value.includes('url(#')) {
        value = url(value);
      }
      if (value !== attr.value) {
        el.setAttribute(name, value);
        changes += 1;
      }
    }

    if (el.localName === 'style') {
      const css = el.textContent ?? '';
      let next = css.replace(/url\(\s*#([\w-]+)\s*\)/g, (match, id: string) => {
        const target = rename.get(id);
        return target ? `url(#${target})` : match;
      });
      // 只改选择器里的 #id，不碰 fill:#fff 这类颜色值。
      next = next.replace(/(^|[\s,{}])#([A-Za-z_][\w-]*)/g, (match, lead: string, id: string) => {
        const target = rename.get(id);
        return target ? `${lead}#${target}` : match;
      });
      if (next !== css) {
        el.textContent = next;
        changes += 1;
      }
    }
  }
  return changes;
}

function truncate(value: string, n: number): string {
  return value.length > n ? `${value.slice(0, n - 1)}…` : value;
}
