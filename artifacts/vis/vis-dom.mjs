#!/usr/bin/env node
/* ============================================================================
 * vis-dom.mjs —— VIS 手册站的最小 HTML / CSS 解析库（Node 零依赖）
 * ----------------------------------------------------------------------------
 * 【为什么要有它】
 *   手册站的页面骨架、样式作用域（`.ref ` 前缀 442 条）、直接子选择器
 *   （`section > h3` / `section > p.lead`）全是**结构敏感**的。
 *   用正则查 HTML 判不出「标签配平」，也判不出「这个 class 在本页能不能命中」——
 *   那两件事都必须先有真正的 DOM 树。
 *
 * 【提供什么】
 *   parseHtml(src)            解析成 DOM 树 + 结构错误清单（配平 / 孤儿 / 越级闭合）
 *   parseSelector(text)       选择器 -> 结构化
 *   matchesSelector(sel, el)  在真实 DOM 上做「能不能命中」判定
 *   parseCss(src)             解析 CSS -> 规则列表（@media 内联展开）
 *   serialize(node)           DOM -> HTML 文本（迁移时拼页面用）
 *
 * 【HTML5 细节】
 *   - 空元素（img / br / meta …）不产生闭标签
 *   - 原始文本元素（script / style / textarea / title）按原文吞到闭合标签
 *   - 可省略结束标签的元素（p / li / td / tr …）按 HTML5 规则隐式闭合
 *   - 自闭合写法 `<path/>` 视为已闭合
 *
 * 【CSS 细节】
 *   - 选择器里的伪类/伪元素按「可能命中」处理（静态分析不做交互态判定）
 *   - `:not()` / `:has()` 的参数按可忽略处理
 * ============================================================================ */

/* 空元素 */
const VOID_TAGS = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'embed', 'frame', 'hr', 'img',
  'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/* 原始文本元素：内容按原文吞到对应闭合标签 */
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/* 可省略结束标签的元素：遇到下表中的开始标签时被隐式关闭 */
const IMPLIED = {
  p: ['p'],
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
  optgroup: ['option', 'optgroup'],
  tr: ['td', 'th', 'tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  thead: ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'],
  tbody: ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'],
  tfoot: ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'],
};

/* --------------------------------------------------------------------------
 * HTML
 * -------------------------------------------------------------------------- */

export function parseHtml(src) {
  const errors = [];
  const root = { type: 'root', tag: null, attrs: [], attrMap: {}, children: [], parent: null, line: 1 };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const push = (n) => { n.parent = top(); top().children.push(n); };
  let i = 0;
  let line = 1;
  const countLines = (s) => { for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) line++; };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim()) push({ type: 'text', text, line });
      countLines(text);
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) push({ type: 'text', text, line });
      countLines(text);
    }
    i = lt;

    /* 注释 */
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end === -1 ? src.length : end + 3;
      push({ type: 'comment', text: src.slice(i, stop), line });
      countLines(src.slice(i, stop));
      i = stop;
      continue;
    }
    /* doctype / 声明 */
    if (src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      const stop = end === -1 ? src.length : end + 1;
      push({ type: 'doctype', text: src.slice(i, stop), line });
      countLines(src.slice(i, stop));
      i = stop;
      continue;
    }
    /* 结束标签 */
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      const stop = end === -1 ? src.length : end + 1;
      const raw = src.slice(i + 2, end === -1 ? src.length : end);
      const tag = raw.trim().split(/[\s/]/)[0].toLowerCase();
      countLines(src.slice(i, stop));
      i = stop;
      if (!tag) continue;
      /* 找栈里最近的可匹配元素 */
      let k = -1;
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === tag) { k = s; break; }
      }
      if (k >= 0) {
        /* 越级闭合：k 与栈顶之间被强行关掉了 */
        const implied = [];
        for (let s = stack.length - 1; s > k; s--) implied.push(stack[s].tag);
        if (implied.length) {
          errors.push({
            kind: 'misnest', tag, line,
            detail: `</${tag}> 越级闭合，途中被强行关闭: ${implied.join(' > ')}`,
          });
        }
        stack.length = k;
        continue;
      }
      /* 没有可匹配元素：看是不是「可省略结束标签」的隐式闭合 */
      const cur = top();
      if (cur && cur.type === 'element' && IMPLIED[tag] && IMPLIED[tag].includes(cur.tag)) {
        stack.pop();
        continue;
      }
      errors.push({ kind: 'orphan-close', tag, line, detail: `孤立的结束标签 </${tag}>` });
      continue;
    }

    /* 开始标签 */
    const m = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(src.slice(i));
    if (!m) {
      /* 裸的 '<' 当文本 */
      push({ type: 'text', text: '<', line });
      i++;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = i + m[0].length;
    const attrs = [];
    let selfClose = false;
    /* 属性 */
    while (j < src.length) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '>') { j++; break; }
      if (src.startsWith('/>', j)) { selfClose = true; j += 2; break; }
      if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
      const am = /^([^\s=/>]+)/.exec(src.slice(j));
      if (!am) { j++; continue; }
      const name = am[1];
      j += name.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      let value = '';
      let quote = '"';
      if (src[j] === '=') {
        j++;
        while (j < src.length && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          quote = q;
          const end = src.indexOf(q, j + 1);
          const stop = end === -1 ? src.length : end;
          value = src.slice(j + 1, stop);
          j = stop + 1;
        } else {
          const vm = /^[^\s>]*/.exec(src.slice(j));
          value = vm ? vm[0] : '';
          j += value.length;
        }
      }
      attrs.push({ name, value, quote });
    }
    const attrMap = {};
    for (const a of attrs) if (!(a.name in attrMap)) attrMap[a.name] = a.value;
    const el = {
      type: 'element', tag, attrs, attrMap, children: [], parent: null, line,
      classes: (attrMap.class || '').split(/\s+/).filter(Boolean),
    };
    push(el);
    countLines(src.slice(i, j));
    const openStart = i;
    i = j;

    if (VOID_TAGS.has(tag) || selfClose) continue;

    if (RAW_TAGS.has(tag)) {
      const closeRe = new RegExp('</' + tag + '\\s*>', 'i');
      const rest = src.slice(i);
      const cm = closeRe.exec(rest);
      const text = cm ? rest.slice(0, cm.index) : rest;
      if (text) el.children.push({ type: 'text', text, parent: el, line });
      countLines(text);
      if (cm) {
        countLines(rest.slice(0, cm.index + cm[0].length));
        i += cm.index + cm[0].length;
      } else {
        i = src.length;
      }
      continue;
    }

    /* 可省略结束标签的元素：开始标签触发隐式闭合 */
    const impliedTags = IMPLIED[tag];
    if (impliedTags) {
      while (stack.length > 1) {
        const cur = top();
        if (cur.type === 'element' && impliedTags.includes(cur.tag)) stack.pop();
        else break;
      }
    }
    stack.push(el);
    void openStart;
  }

  /* 文件结束时仍未关闭 */
  for (let s = stack.length - 1; s >= 1; s--) {
    const el = stack[s];
    errors.push({
      kind: 'unclosed', tag: el.tag, line: el.line,
      detail: `未闭合的 <${el.tag}>` + (el.attrMap.id ? ` (id="${el.attrMap.id}")` : ''),
    });
  }
  return { root, errors };
}

/* --------------------------------------------------------------------------
 * DOM 工具
 * -------------------------------------------------------------------------- */
export function elementChildren(node) {
  return node.children.filter((c) => c.type === 'element');
}
export function walk(node, fn) {
  for (const c of node.children) {
    if (c.type === 'element') { fn(c); walk(c, fn); }
  }
}
export function findAll(node, pred) {
  const out = [];
  walk(node, (el) => { if (pred(el)) out.push(el); });
  return out;
}
export function findFirst(node, pred) {
  let hit = null;
  walk(node, (el) => { if (!hit && pred(el)) hit = el; });
  return hit;
}
export function prevElementSibling(el) {
  if (!el.parent) return null;
  const sibs = elementChildren(el.parent);
  const idx = sibs.indexOf(el);
  return idx > 0 ? sibs[idx - 1] : null;
}
export function ancestors(el) {
  const out = [];
  let p = el.parent;
  while (p && p.type === 'element') { out.push(p); p = p.parent; }
  return out;
}

export function cloneNode(node) {
  if (node.type === 'element') {
    const el = {
      type: 'element', tag: node.tag,
      attrs: node.attrs.map((a) => ({ ...a })),
      attrMap: { ...node.attrMap },
      children: [], parent: null, line: node.line,
      classes: node.classes.slice(),
    };
    for (const c of node.children) {
      const cc = cloneNode(c);
      cc.parent = el;
      el.children.push(cc);
    }
    return el;
  }
  return { type: node.type, text: node.text, parent: null, line: node.line };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escAttr(v) {
  return String(v).replace(/[&<>"]/g, (c) => ESC[c]);
}
export function serialize(node) {
  if (node.type === 'text') return node.text;
  if (node.type === 'comment') return node.text;
  if (node.type === 'doctype') return node.text;
  if (node.type === 'root') return node.children.map(serialize).join('');
  const attrs = node.attrs.map((a) => (a.value === ''
    ? ' ' + a.name
    : ' ' + a.name + '=' + a.quote + escAttr(a.value) + a.quote)).join('');
  if (VOID_TAGS.has(node.tag)) return '<' + node.tag + attrs + '>';
  const inner = node.children.map(serialize).join('');
  return '<' + node.tag + attrs + '>' + inner + '</' + node.tag + '>';
}

/* --------------------------------------------------------------------------
 * CSS
 * -------------------------------------------------------------------------- */
function stripCssComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      const stop = end === -1 ? src.length : end + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (const ch of src.slice(i, stop)) out += ch === '\n' ? '\n' : ' ';
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* 解析 CSS -> 规则列表（@media / @supports 内联展开） */
export function parseCss(src) {
  const rules = [];
  const errors = [];
  const s = stripCssComments(src);
  let i = 0;
  let line = 1;
  const countLines = (t) => { for (const ch of t) if (ch === '\n') line++; };

  const findBlockEnd = (from) => {
    let depth = 0;
    let j = from;
    while (j < s.length) {
      const c = s[j];
      if (c === '"' || c === "'") {
        const end = s.indexOf(c, j + 1);
        j = end === -1 ? s.length : end + 1;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return j; }
      j++;
    }
    return -1;
  };

  const walkBlock = (from, to) => {
    let j = from;
    while (j < to) {
      while (j < to && /\s/.test(s[j])) j++;
      if (j >= to) break;
      if (s[j] === '}') { j++; continue; }
      const braceAt = (() => {
        let k = j, depth = 0, inStr = null;
        while (k < to) {
          const c = s[k];
          if (inStr) { if (c === inStr) inStr = null; k++; continue; }
          if (c === '"' || c === "'") { inStr = c; k++; continue; }
          if (c === '(') { depth++; k++; continue; }
          if (c === ')') { depth--; k++; continue; }
          if (c === '{') return k;
          if (c === ';' && depth === 0) return -2;   /* @规则无块 */
          k++;
        }
        return -1;
      })();
      if (braceAt === -2) { j++; continue; }
      if (braceAt === -1) break;
      const prelude = s.slice(j, braceAt).trim();
      const blockEnd = findBlockEnd(braceAt);
      const body = s.slice(braceAt + 1, blockEnd === -1 ? to : blockEnd);
      const ruleLine = line;
      countLines(s.slice(j, braceAt + 1));
      if (/^@(media|supports|layer|container|scope)\b/i.test(prelude)) {
        walkBlock(braceAt + 1, blockEnd === -1 ? to : blockEnd);
      } else if (/^@/.test(prelude)) {
        /* @keyframes / @font-face / @page / @property —— 不产生选择器 */
      } else if (prelude) {
        for (const sel of splitTop(prelude, ',')) {
          const t = sel.trim();
          if (t) rules.push({ selector: t, decls: body, line: ruleLine });
        }
      }
      countLines(body);
      j = blockEnd === -1 ? to : blockEnd + 1;
    }
  };

  walkBlock(0, s.length);
  return { rules, errors };
}

function splitTop(text, sep) {
  const out = [];
  let depth = 0, buf = '', inStr = null;
  for (const c of text) {
    if (inStr) { buf += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; buf += c; continue; }
    if (c === '(' || c === '[') { depth++; buf += c; continue; }
    if (c === ')' || c === ']') { depth--; buf += c; continue; }
    if (c === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out;
}

/* --------------------------------------------------------------------------
 * 选择器
 * -------------------------------------------------------------------------- */
export function parseCompound(text) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const s = text;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '*') { i++; continue; }
    if (ch === '#') {
      const m = /^#([\w-]+)/.exec(s.slice(i));
      if (!m) { i++; continue; }
      c.id = m[1]; i += m[0].length; continue;
    }
    if (ch === '.') {
      const m = /^\.([\w-]+)/.exec(s.slice(i));
      if (!m) { i++; continue; }
      c.classes.push(m[1]); i += m[0].length; continue;
    }
    if (ch === '[') {
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') { depth--; if (depth === 0) break; }
      }
      const inner = s.slice(i + 1, j);
      const am = /^\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*))\s*(i|I)?)?\s*$/.exec(inner);
      if (am) {
        const value = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[5] !== undefined ? am[5] : ''));
        c.attrs.push({ name: am[1].toLowerCase(), op: am[2] || null, value, ci: !!am[6] });
      }
      i = j + 1;
      continue;
    }
    if (ch === ':') {
      i++;
      if (s[i] === ':') {
        i++;
        const m = /^[\w-]+/.exec(s.slice(i));
        i += m ? m[0].length : 0;
        continue;
      }
      const m = /^[\w-]+/.exec(s.slice(i));
      const name = m ? m[0].toLowerCase() : '';
      i += m ? m[0].length : 0;
      if (s[i] === '(') {
        let depth = 0, j = i;
        for (; j < s.length; j++) {
          if (s[j] === '(') depth++;
          else if (s[j] === ')') { depth--; if (depth === 0) break; }
        }
        i = j + 1;
      }
      c.pseudos.push(name);
      continue;
    }
    const m = /^[A-Za-z][\w-]*/.exec(s.slice(i));
    if (m) { c.tag = m[0].toLowerCase(); i += m[0].length; continue; }
    i++;
  }
  return c;
}

export function parseSelector(text) {
  const comps = [];
  const combinators = [];
  let buf = '';
  let pending = null;
  let i = 0;
  const push = () => {
    const t = buf.trim();
    buf = '';
    if (t) { comps.push(parseCompound(t)); combinators.push(pending); }
    pending = null;
  };
  const s = text;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (!buf.trim()) { i = j; continue; }
      if (s[j] === '>' || s[j] === '+' || s[j] === '~') { push(); pending = s[j]; i = j + 1; continue; }
      push(); pending = ' '; i = j; continue;
    }
    if (ch === '>' || ch === '+' || ch === '~') { push(); pending = ch; i++; continue; }
    buf += ch; i++;
  }
  push();
  return { comps, combinators };
}

function attrMatches(el, a, relaxed) {
  const v = el.attrMap[a.name];
  if (v === undefined) return false;
  if (!a.op) return true;
  /* relaxed：只要求属性存在，不看取值（主题态 / 运行时取值不算「类没定义」） */
  if (relaxed) return true;
  const lv = a.ci ? String(v).toLowerCase() : String(v);
  const rv = a.ci ? String(a.value).toLowerCase() : String(a.value);
  switch (a.op) {
    case '=': return lv === rv;
    case '~=': return lv.split(/\s+/).includes(rv);
    case '|=': return lv === rv || lv.startsWith(rv + '-');
    case '^=': return rv !== '' && lv.startsWith(rv);
    case '$=': return rv !== '' && lv.endsWith(rv);
    case '*=': return rv !== '' && lv.includes(rv);
    default: return false;
  }
}

export function matchesCompound(el, c, relaxed) {
  if (!el || el.type !== 'element') return false;
  if (c.tag && c.tag !== '*' && el.tag !== c.tag) return false;
  if (c.id && el.attrMap.id !== c.id) return false;
  for (const cl of c.classes) if (!el.classes.includes(cl)) return false;
  for (const a of c.attrs) if (!attrMatches(el, a, relaxed)) return false;
  for (const p of c.pseudos) {
    if (p === 'root' && el.tag !== 'html') return false;
  }
  return true;
}

function matchFrom(el, comps, combinators, idx, relaxed) {
  if (!matchesCompound(el, comps[idx], relaxed)) return false;
  if (idx === 0) return true;
  const comb = combinators[idx];
  const parent = el.parent;
  if (comb === ' ') {
    let a = parent;
    while (a && a.type === 'element') {
      if (matchFrom(a, comps, combinators, idx - 1, relaxed)) return true;
      a = a.parent;
    }
    return false;
  }
  if (comb === '>') {
    return parent && parent.type === 'element' ? matchFrom(parent, comps, combinators, idx - 1, relaxed) : false;
  }
  if (comb === '+') {
    const p = prevElementSibling(el);
    return p ? matchFrom(p, comps, combinators, idx - 1, relaxed) : false;
  }
  if (comb === '~') {
    let p = prevElementSibling(el);
    while (p) {
      if (matchFrom(p, comps, combinators, idx - 1, relaxed)) return true;
      p = prevElementSibling(p);
    }
    return false;
  }
  return false;
}

/* relaxed = true 时忽略属性**取值**（主题态等运行时取值不算「类没定义」） */
export function matchesSelector(sel, el, relaxed) {
  const { comps, combinators } = sel;
  if (!comps.length) return false;
  return matchFrom(el, comps, combinators, comps.length - 1, relaxed);
}

/* CSS 索引：把规则编译成可匹配的选择器列表 */
export function buildCssIndex(cssSources) {
  const index = [];
  for (const { file, text } of cssSources) {
    const { rules } = parseCss(text);
    for (const r of rules) {
      let parsed;
      try { parsed = parseSelector(r.selector); } catch { continue; }
      if (!parsed.comps.length) continue;
      index.push({ file, selector: r.selector, line: r.line, parsed });
    }
  }
  return index;
}

/* 元素能否被某条规则命中（静态判定：伪类按「可能命中」处理） */
export function isCovered(el, cssIndex) {
  for (const rule of cssIndex) {
    const last = rule.parsed.comps[rule.parsed.comps.length - 1];
    /* 快速排除：右端复合选择器里的 class / id 不符就不必再算 */
    if (last.classes.length && !last.classes.every((c) => el.classes.includes(c))) continue;
    if (last.id && el.attrMap.id !== last.id) continue;
    if (last.tag && last.tag !== '*' && el.tag !== last.tag) continue;
    if (matchesSelector(rule.parsed, el)) return rule;
  }
  return null;
}
