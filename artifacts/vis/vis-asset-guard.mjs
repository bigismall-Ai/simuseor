#!/usr/bin/env node
/* ============================================================================
 * SiMuseor VIS · vis-asset-guard.mjs
 * ----------------------------------------------------------------------------
 * VIS 视觉资产（SVG）守门员：规范化 + 指纹 + 规格断言 + 差异报告。
 *
 * 【定位】
 *   「SVG 是唯一图片资产真值」这条技术路线需要一个可机检的契约。
 *   vis-check.mjs 管的是「设计层 token / CSS 规范」，本工具管的是
 *   「落到磁盘上的 SVG 资产本身」：能不能被规范化（无语义漂移）、
 *   能不能被指纹（谁改了什么）、合不合规格（断言）、差异怎么报（报告）。
 *
 * 【子命令】
 *   normalize   规范化 SVG 文本（属性顺序 / 缩进 / path d 断行 / style 规则排序）
 *   fingerprint 指纹台账（原始字节 sha256 + 规范化文本 sha256）
 *   assert      规格断言（viewBox / 主体占位 / 描边档 / 面片数 / 对比度）
 *   report      汇总 Markdown 报告（含违规项与跳过项）
 *
 * 【只读承诺】
 *   默认只读：只调用 fs.readFileSync / readdirSync / git ls-files，结果打到 stdout。
 *   唯一会写资产的路径是 `normalize --write --file <path>`：先备份 <file>.bak
 *   再原地覆盖。本工具【不会】"修复"资产、不会删除属性、不会改属性值。
 *   --write 必须配合 --file（拒绝整目录批量覆盖），避免误伤并行改版中的资产。
 *
 * 【零依赖】
 *   仅用 Node 内置模块。Playwright 是可选增强：从 ../../tests/node_modules
 *   显式解析（artifacts/vis/ 下没有 node_modules）。解析不到 / 浏览器起不来
 *   -> 相关断言标记 SKIPPED，其余照跑，绝不崩溃、绝不联网。
 *   显式降级开关：VIS_ASSET_GUARD_NO_PLAYWRIGHT=1（CI 无浏览器时用）。
 *
 * 【退出码】（与 vis-check.mjs 对齐，同一套棘轮语言）
 *   0 = 全通过
 *   1 = 仅提示（违规项【等于】棘轮基线，旧债仍在，不阻塞）
 *   2 = 违规（【超出】棘轮基线，阻塞）
 *   3 = 脚本自身出错
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // artifacts/vis
const ROOT = path.resolve(HERE, '..', '..');                  // 项目根
const ASSET_DIR_REL = path.join('artifacts', 'vis', 'assets', 'cicada', 'svg');
const ASSET_DIR = path.join(ROOT, ASSET_DIR_REL);

/* ==========================================================================
 * 0. 规格常量表
 * --------------------------------------------------------------------------
 * 所有阈值集中在这里，便于后续调整而不动逻辑。
 * ========================================================================== */
const SPEC = {
  version: '1.0.0',
  tool: 'vis-asset-guard',

  /* a. viewBox：必须存在且是 4 个合法数字（宽高 > 0） */
  viewBox: { required: true },

  /* b. 主体占位比：内容包围盒面积 / viewBox 面积 */
  occupancy: { min: 0.25, max: 1.0 },

  /* c. 描边档：若资产使用 stroke，则 stroke-width 档位数不得超过 maxTiers，
   *    且每档必须 > 0。未使用描边的纯色面片资产不判违规（只报 INFO）。 */
  stroke: { maxTiers: 3, minWidth: 0.25 },

  /* c2. 深浅成对：除 exempt 名单外，X.svg 必须有 X-dark.svg */
  pairing: {
    exempt: [
      'favicon',            // 多主题图标（内嵌 base64 PNG，无浅/深之分）
      'cicada-max-lineart', // 线稿版单主题
      'cicada-max-lineart-b',
    ],
  },

  /* d. 面片数合理区间 */
  facets: {
    minElements: 1,
    maxElements: 5000,
    maxPaths: 2000,
    maxGradients: 500,
    maxStyleRules: 500,
  },

  /* e. 对比度：fill 色 vs 同文件背景色的 WCAG 对比度。
   *    判定口径：
   *      阻塞项 = 【主色】（面积最大的 fill，即剪影主色）低于阈值 -> 资产在背景上站不住
   *      提示项 = 内部装饰面片的低对比色，逐条列出但不阻塞（面片本就是同族细节）
   *    背景色判定顺序：
   *      ① 资产自带整幅背景 rect -> 用它
   *      ② 否则按文件名主题取 background.{light|dark}
   *      ③ 若主色本身是亮色（相对亮度 >= lightInkLuminance），说明这是「浅墨反白」
   *         资产，实际使用场景是深色底 -> 背景取深色 */
  contrast: {
    minRatio: 3.0,
    blocking: true,       // false = 只报不阻塞
    lightInkLuminance: 0.5,
    /* 品牌标记豁免：
     *   WCAG 1.4.11（非文本对比度）明确免除 logo / 品牌标识；
     *   且品牌色是主理人冻结的裁决结果，工具无权推翻。
     *   豁免后仍按实测值报 INFO（给人看），但不参与退出码。 */
    brandMarkExempt: [
      'cicada-max',
      'cicada-mid',
      'cicada-min',
      'cicada-max-lineart',
      'cicada-max-lineart-b',
      'favicon',
    ],
  },

  /* 背景色：取自 artifacts/vis/vis-tokens.css 的品牌纸色
   *   --brand-paper         #f8f6f1（浅）
   *   --brand-paper-reverse #15151a（深）
   * 若资产自带整幅背景 rect，则优先用资产自己的背景色。 */
  background: {
    light: '#f8f6f1',
    dark: '#15151a',
  },

  /* f. 棘轮基线（RATCHET）—— 与 vis-check.mjs 同一套语言。
   *    已知债务按「断言 id | 资产路径」精确登记，数量【只降不升】：
   *      等于基线 -> 退出码 1（仅提示，不阻塞）
   *      超  基线 -> 退出码 2（阻塞）
   *    没有棘轮的守门员会永远红，没人会看它。
   */
  ratchet: {
    /* A5：蝉形深浅两版当前是同一份文件（另一工作流改版中，深浅版尚未分化） */
    'A5|artifacts/vis/assets/cicada/svg/cicada-max.svg': 1,
    'A5|artifacts/vis/assets/cicada/svg/cicada-mid.svg': 1,
    'A5|artifacts/vis/assets/cicada/svg/cicada-min.svg': 1,
  },

  /* 规范化：属性顺序表（未列出的属性按字母序排在后面） */
  attrOrder: [
    'id', 'class', 'x', 'y', 'width', 'height', 'viewBox', 'd',
    'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'style',
  ],
  indent: '  ',
};

/* ==========================================================================
 * 1. 通用工具
 * ========================================================================== */
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const short = (h, n = 12) => String(h).slice(0, n);

function die(msg, code = 3) {
  process.stderr.write('  [ERROR] ' + msg + '\n');
  process.exit(code);
}

/* ==========================================================================
 * 2. XML 解析（够用即可：容错、保留原始属性值与引号风格）
 * ========================================================================== */
const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

function parseXml(src) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let i = 0;
  const push = (node) => stack[stack.length - 1].children.push(node);

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      push({ type: 'text', value: src.slice(i) });
      break;
    }
    if (lt > i) push({ type: 'text', value: src.slice(i, lt) });

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      const stop = end === -1 ? src.length : end + 3;
      push({ type: 'comment', value: src.slice(lt, stop) });
      i = stop; continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      push({ type: 'text', value: src.slice(lt + 9, end === -1 ? src.length : end) });
      i = end === -1 ? src.length : end + 3; continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      const stop = end === -1 ? src.length : end + 2;
      push({ type: 'pi', value: src.slice(lt, stop) });
      i = stop; continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      const stop = end === -1 ? src.length : end + 1;
      push({ type: 'doctype', value: src.slice(lt, stop) });
      i = stop; continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end === -1 ? src.length : end).trim();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) { stack.length = s; break; }
      }
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const tag = parseStartTag(src, lt);
    push(tag.node);
    if (!tag.selfClosing) stack.push(tag.node);
    i = tag.end;
  }
  return root;
}

function parseStartTag(src, lt) {
  let i = lt + 1;
  let name = '';
  while (i < src.length && !/[\s/>]/.test(src[i])) { name += src[i]; i++; }
  const attrs = [];
  let selfClosing = false;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '/') { selfClosing = true; i++; continue; }
    if (src[i] === '>') { i++; break; }
    if (i >= src.length) break;
    let an = '';
    while (i < src.length && !/[\s=/>]/.test(src[i])) { an += src[i]; i++; }
    if (!an) { i++; continue; }
    while (i < src.length && /\s/.test(src[i])) i++;
    let av = null;
    let quote = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        quote = q;
        const end = src.indexOf(q, i + 1);
        av = src.slice(i + 1, end === -1 ? src.length : end);
        i = end === -1 ? src.length : end + 1;
      } else {
        let s = '';
        while (i < src.length && !/[\s>]/.test(src[i])) { s += src[i]; i++; }
        av = s;
      }
    }
    attrs.push({ name: an, value: av, quote });
  }
  return { node: { type: 'element', name, attrs, children: [], selfClosing }, selfClosing, end: i };
}

const decodeEntities = (s) => String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const textOf = (el) => (el.children || [])
  .filter((c) => c.type === 'text')
  .map((c) => c.value)
  .join('');

/* ==========================================================================
 * 3. CSS（<style> 块）规则拆分与排序
 * ========================================================================== */
function splitCssRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const ob = css.indexOf('{', i);
    if (ob === -1) break;
    const cb = css.indexOf('}', ob);
    if (cb === -1) break;
    rules.push({ sel: css.slice(i, ob), body: css.slice(ob + 1, cb) });
    i = cb + 1;
  }
  return rules;
}

function splitDecls(body) {
  return String(body)
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const cssRuleKey = (sel) => String(sel).split(',')[0].replace(/\s+/g, ' ').trim();

/* 规则排序：按选择器名字母序（首个选择器为主键，全串为次序键，原始次序兜底） */
function sortCssRules(rules) {
  return rules
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => {
      const ka = cssRuleKey(a.r.sel);
      const kb = cssRuleKey(b.r.sel);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      const sa = cssRuleKey(a.r.sel) === a.r.sel ? a.r.sel : a.r.sel.replace(/\s+/g, ' ').trim();
      const sb = cssRuleKey(b.r.sel) === b.r.sel ? b.r.sel : b.r.sel.replace(/\s+/g, ' ').trim();
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return a.idx - b.idx;
    })
    .map((x) => x.r);
}

/* ==========================================================================
 * 4. 规范化
 * --------------------------------------------------------------------------
 * 规范化只做四件事，且逐项自我保证「不改语义」：
 *   ① 属性顺序（自定义顺序表 + 字母序兜底）
 *   ② 统一 2 空格缩进，每个属性独占一行
 *   ③ path 的 d 按命令断行
 *   ④ <style> 块内规则按选择器名字母序排序
 * 不删属性 / 不改属性值 / 不动命名空间与 id 引用 / 不动 viewBox。
 * ========================================================================== */
function splitPathData(d) {
  const src = String(d == null ? '' : d).trim();
  if (!src) return [];
  const segs = [];
  let cur = null;
  for (const ch of src) {
    if (CMD_RE.test(ch)) {
      if (cur) segs.push(cur);
      cur = { cmd: ch, args: '' };
    } else if (cur) {
      cur.args += ch;
    } else {
      cur = { cmd: '', args: ch };
    }
  }
  if (cur) segs.push(cur);
  return segs.map((s) => ({ cmd: s.cmd, args: s.args.trim() }));
}

function orderAttrs(attrs) {
  const order = SPEC.attrOrder;
  const idx = (n) => {
    const k = order.indexOf(n);
    return k === -1 ? order.length : k;
  };
  return attrs
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const d = idx(x.a.name) - idx(y.a.name);
      if (d !== 0) return d;
      if (x.a.name !== y.a.name) return x.a.name < y.a.name ? -1 : 1;
      return x.i - y.i;
    })
    .map((x) => x.a);
}

function attrLines(attr, depth) {
  const ind = SPEC.indent.repeat(depth);
  if (attr.value === null) return [ind + attr.name];
  const q = attr.quote === "'" ? "'" : '"';
  if (attr.name === 'd') {
    const segs = splitPathData(attr.value);
    if (segs.length > 1) {
      const body = segs.map((s) => s.cmd + s.args).join('\n' + ind + '   ');
      return [ind + 'd=' + q + body + q];
    }
  }
  return [ind + attr.name + '=' + q + attr.value + q];
}

function styleBlockLines(el, depth) {
  const ind = SPEC.indent.repeat(depth);
  const css = textOf(el);
  const rules = sortCssRules(splitCssRules(css));
  const out = [];
  for (const rule of rules) {
    const sel = rule.sel.replace(/\s+/g, ' ').trim();
    const decls = splitDecls(rule.body);
    if (!decls.length) {
      out.push(ind + sel + ' {');
      out.push(ind + '}');
      continue;
    }
    out.push(ind + sel + ' {');
    for (const d of decls) out.push(ind + SPEC.indent + d + ';');
    out.push(ind + '}');
  }
  return out;
}

function serializeElement(el, depth, out) {
  const ind = SPEC.indent.repeat(depth);
  const attrs = orderAttrs(el.attrs);
  const kids = (el.children || []).filter(
    (c) => !(c.type === 'text' && !c.value.trim())
  );
  const elemKids = kids.filter((c) => c.type === 'element');
  const otherKids = kids.filter((c) => c.type !== 'text' && c.type !== 'element');
  const textKids = kids.filter((c) => c.type === 'text');

  /* <style>：内容保留，块内规则按选择器名字母序排序 */
  if (el.name === 'style') {
    if (!attrs.length) {
      out.push(ind + '<style>');
    } else {
      out.push(ind + '<style');
      for (const a of attrs) out.push(...attrLines(a, depth + 1));
      out.push(ind + '>');
    }
    out.push(...styleBlockLines(el, depth + 1));
    out.push(ind + '</style>');
    return;
  }

  /* 无子节点 */
  if (!kids.length) {
    if (!attrs.length) { out.push(ind + '<' + el.name + ' />'); return; }
    out.push(ind + '<' + el.name);
    for (const a of attrs) out.push(...attrLines(a, depth + 1));
    out.push(ind + '/>');
    return;
  }

  /* 纯文本子节点 */
  if (!elemKids.length && !otherKids.length) {
    const text = textKids.map((t) => t.value.trim()).join('');
    if (!attrs.length) { out.push(ind + '<' + el.name + '>' + text + '</' + el.name + '>'); return; }
    out.push(ind + '<' + el.name);
    for (const a of attrs) out.push(...attrLines(a, depth + 1));
    out.push(ind + '>' + text + '</' + el.name + '>');
    return;
  }

  /* 有元素子节点 */
  if (!attrs.length) {
    out.push(ind + '<' + el.name + '>');
  } else {
    out.push(ind + '<' + el.name);
    for (const a of attrs) out.push(...attrLines(a, depth + 1));
    out.push(ind + '>');
  }
  for (const c of kids) serializeNode(c, depth + 1, out);
  out.push(ind + '</' + el.name + '>');
}

function serializeNode(node, depth, out) {
  if (node.type === 'element') { serializeElement(node, depth, out); return; }
  if (node.type === 'text') {
    const t = node.value.trim();
    if (!t) return;   // 纯空白文本节点只影响排版，规范化时丢弃
    out.push(SPEC.indent.repeat(depth) + t);
    return;
  }
  out.push(SPEC.indent.repeat(depth) + node.value);
}

function serializeDoc(doc) {
  const out = [];
  for (const c of doc.children) serializeNode(c, 0, out);
  return out.join('\n') + '\n';
}

/* ---- 语义指纹：用于证明「规范化不改语义」 ------------------------------ */
function digestAttrValue(name, value) {
  if (value === null) return '';
  const v = decodeEntities(value);
  if (name === 'd') {
    return splitPathData(v).map((s) => s.cmd + '|' + s.args).join(';');
  }
  return v.replace(/\s+/g, ' ').trim();
}

function styleDigest(el) {
  const rules = splitCssRules(textOf(el)).map((r) => (
    cssRuleKey(r.sel) + '{' + splitDecls(r.body).map((d) => d.replace(/\s+/g, ' ').trim()).join(';') + '}'
  ));
  rules.sort();
  return rules.join('|');
}

function semanticDigest(doc) {
  const h = crypto.createHash('sha256');
  const walk = (n) => {
    if (n.type === 'element') {
      h.update('<' + n.name);
      const attrs = n.attrs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const a of attrs) h.update('|' + a.name + '=' + digestAttrValue(a.name, a.value));
      h.update('>');
      if (n.name === 'style') {
        h.update('#style{' + styleDigest(n) + '}');
      } else {
        for (const c of n.children || []) {
          if (c.type === 'text') { if (c.value.trim()) h.update('#' + c.value.trim()); }
          else walk(c);
        }
      }
      h.update('</' + n.name + '>');
    } else if (n.type === 'comment' || n.type === 'pi' || n.type === 'doctype') {
      h.update('~' + n.value);
    }
  };
  for (const c of doc.children) walk(c);
  return h.digest('hex');
}

/** 规范化：返回 { text, semanticSafe } */
function normalizeSvgText(text) {
  const doc = parseXml(text);
  const before = semanticDigest(doc);
  const out = serializeDoc(doc);
  const after = semanticDigest(parseXml(out));
  return { text: out, semanticSafe: before === after, before, after };
}

/* ==========================================================================
 * 5. 资产发现
 * --------------------------------------------------------------------------
 * 目标集合 = git 已跟踪的 svg 且当前工作区存在。
 * 被另一工作流删掉的文件会被跳过，并在报告里说明（不"修复"）。
 * ========================================================================== */
function listTrackedAssets() {
  const tracked = [];
  try {
    const out = execFileSync('git', ['ls-files', '--', ASSET_DIR_REL], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p && p.toLowerCase().endsWith('.svg')) tracked.push(p);
    }
  } catch (e) {
    /* git 不可用 -> 退回目录扫描 */
    if (fs.existsSync(ASSET_DIR)) {
      for (const name of fs.readdirSync(ASSET_DIR)) {
        if (name.toLowerCase().endsWith('.svg')) tracked.push(ASSET_DIR_REL + '/' + name);
      }
    }
  }
  tracked.sort();
  const present = [];
  const missing = [];
  for (const p of tracked) {
    const abs = path.join(ROOT, p);
    if (fs.existsSync(abs)) present.push({ rel: p, abs });
    else missing.push({ rel: p, reason: 'git 已跟踪但工作区文件不存在（被另一工作流删除）' });
  }
  return { tracked, present, missing };
}

/* ==========================================================================
 * 6. SVG 分析（元素统计 / 颜色 / 描边 / viewBox）
 * ========================================================================== */
function parseColor(raw) {
  if (raw === null || raw === undefined) return null;
  const v = decodeEntities(String(raw)).trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor' ||
      v === 'inherit' || v === 'initial' || v === 'unset' || v.startsWith('url(')) return null;
  if (v[0] === '#') {
    const hex = v.slice(1);
    if (hex.length === 3) return '#' + hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) return '#' + hex;
    if (hex.length === 8) {
      if (hex.slice(6) === 'ff') return '#' + hex.slice(0, 6);
      return null;  // 带 alpha，背景合成不确定 -> 不参与对比度
    }
    return null;
  }
  const m = /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const conv = (x) => (x.endsWith('%') ? Math.round(parseFloat(x) * 2.55) : Math.round(parseFloat(x)));
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 1) return null;
    }
    const hex = [conv(m[1]), conv(m[2]), conv(m[3])]
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
    return '#' + hex;
  }
  return null;
}

function analyzeSvg(abs, text) {
  const doc = parseXml(text);
  const svg = (doc.children || []).find((c) => c.type === 'element' && c.name === 'svg');
  const tags = {};
  const fills = new Set();
  const strokeWidths = new Set();
  const classFills = new Map();   // class -> fill hex
  const styleRules = [];
  let styleBlocks = 0;

  const walk = (n) => {
    if (n.type !== 'element') {
      for (const c of n.children || []) walk(c);
      return;
    }
    tags[n.name] = (tags[n.name] || 0) + 1;
    for (const a of n.attrs) {
      if (a.name === 'fill') {
        const c = parseColor(a.value);
        if (c) fills.add(c);
      }
      if (a.name === 'stroke-width') {
        const v = decodeEntities(String(a.value)).trim();
        if (v && /^[0-9.]+$/.test(v)) strokeWidths.add(parseFloat(v));
      }
      if (a.name === 'class') {
        const cls = decodeEntities(String(a.value)).trim();
        for (const one of cls.split(/\s+/)) {
          if (one && !classFills.has(one)) classFills.set(one, null);
        }
      }
    }
    if (n.name === 'style') {
      styleBlocks++;
      for (const r of splitCssRules(textOf(n))) {
        const decls = splitDecls(r.body);
        styleRules.push({ sel: cssRuleKey(r.sel), decls });
        for (const d of decls) {
          const m = /^(fill|stroke-width)\s*:\s*(.+)$/i.exec(d);
          if (!m) continue;
          if (m[1].toLowerCase() === 'fill') {
            const c = parseColor(m[2]);
            if (c) {
              fills.add(c);
              for (const one of r.sel.split(',').map((s) => s.replace(/^\s*\./, '').trim())) {
                if (one && !one.includes(' ')) classFills.set(one, c);
              }
            }
          } else {
            const v = m[2].trim();
            if (/^[0-9.]+$/.test(v)) strokeWidths.add(parseFloat(v));
          }
        }
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(doc);

  /* viewBox */
  let viewBox = null;
  let vbSource = '';
  if (svg) {
    const a = (svg.attrs || []).find((x) => x.name === 'viewBox');
    if (a) {
      vbSource = decodeEntities(String(a.value)).trim();
      const nums = vbSource.split(/[\s,]+/).filter(Boolean).map(Number);
      if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
        viewBox = { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
      }
    }
  }

  const elementCount = Object.values(tags).reduce((a, b) => a + b, 0);
  const bgRect = findBackgroundRect(svg, viewBox, classFills);

  /* 主色 = 面积最大的 fill（剪影主色）；面积算不出时退化为「用得最多的 fill」。
   * 面积口径：polygon（鞋带公式）/ rect / circle / ellipse 的用户单位面积，
   * path 的面积不做贝塞尔积分（按 0 计），仅计入元素个数。 */
  const areaByColor = new Map();
  const countByColor = new Map();
  const addArea = (color, area) => {
    if (!color) return;
    areaByColor.set(color, (areaByColor.get(color) || 0) + area);
    countByColor.set(color, (countByColor.get(color) || 0) + 1);
  };
  const areaWalk = (n) => {
    if (n.type !== 'element') {
      for (const c of n.children || []) areaWalk(c);
      return;
    }
    const color = resolveFill(n, classFills);
    addArea(color, elementArea(n));
    for (const c of n.children || []) areaWalk(c);
  };
  areaWalk(doc);

  let dominant = null;
  let dominantBy = null;
  for (const [c, ar] of areaByColor) {
    if (ar > 0 && (!dominant || ar > areaByColor.get(dominant))) { dominant = c; dominantBy = 'area'; }
  }
  if (!dominant) {
    for (const [c, ct] of countByColor) {
      if (!dominant || ct > countByColor.get(dominant)) { dominant = c; dominantBy = 'count'; }
    }
  }

  return {
    doc,
    svg,
    tags,
    elementCount,
    viewBox,
    viewBoxSource: vbSource,
    fills: [...fills].sort(),
    strokeWidths: [...strokeWidths].sort((a, b) => a - b),
    styleBlocks,
    styleRuleCount: styleRules.length,
    styleRules,
    bgRect,
    dominant,
    dominantBy,
    areaByColor,
    countByColor,
  };
}

/** 元素的 fill：属性优先，其次按 class 查 <style> 里的 fill 规则 */
function resolveFill(el, classFills) {
  const a = (el.attrs || []).find((x) => x.name === 'fill');
  if (a) {
    const c = parseColor(a.value);
    if (c) return c;
  }
  const ca = (el.attrs || []).find((x) => x.name === 'class');
  if (ca) {
    for (const one of decodeEntities(String(ca.value)).trim().split(/\s+/)) {
      const c = classFills.get(one);
      if (c) return c;
    }
  }
  return null;
}

/** 可精确计算的用户单位面积（path 返回 0） */
function elementArea(el) {
  const attr = (n) => {
    const a = (el.attrs || []).find((x) => x.name === n);
    if (!a) return NaN;
    return parseFloat(decodeEntities(String(a.value)).trim());
  };
  if (el.name === 'polygon' || el.name === 'polyline') {
    const p = attr('points');
    if (!Number.isFinite(p)) return 0;
    const nums = decodeEntities(String((el.attrs || []).find((x) => x.name === 'points').value))
      .trim().split(/[\s,]+/).map(Number);
    if (nums.length < 6 || nums.some((n) => !Number.isFinite(n))) return 0;
    let acc = 0;
    for (let i = 0; i < nums.length; i += 2) {
      const j = (i + 2) % nums.length;
      acc += nums[i] * nums[j + 1] - nums[j] * nums[i + 1];
    }
    return Math.abs(acc / 2);
  }
  if (el.name === 'rect') {
    const w = attr('width');
    const h = attr('height');
    return Number.isFinite(w) && Number.isFinite(h) ? Math.abs(w * h) : 0;
  }
  if (el.name === 'circle') {
    const r = attr('r');
    return Number.isFinite(r) ? Math.PI * r * r : 0;
  }
  if (el.name === 'ellipse') {
    const rx = attr('rx');
    const ry = attr('ry');
    return Number.isFinite(rx) && Number.isFinite(ry) ? Math.PI * rx * ry : 0;
  }
  return 0;
}

/** 整幅背景 rect：宽高覆盖 >= 98% viewBox 面积且 fill 可解析 */
function findBackgroundRect(svg, viewBox, classFills) {
  if (!svg || !viewBox) return null;
  const num = (v) => {
    const n = parseFloat(decodeEntities(String(v || '')).trim());
    return Number.isFinite(n) ? n : null;
  };
  let best = null;
  const walk = (n) => {
    if (n.type !== 'element') {
      for (const c of n.children || []) walk(c);
      return;
    }
    if (n.name === 'rect') {
      const a = Object.fromEntries((n.attrs || []).map((x) => [x.name, x.value]));
      const w = num(a.width);
      const h = num(a.height);
      const x = num(a.x) || 0;
      const y = num(a.y) || 0;
      if (w && h && w * h >= 0.98 * viewBox.width * viewBox.height) {
        let fill = parseColor(a.fill);
        if (!fill && a.class) {
          for (const one of String(a.class).split(/\s+/)) {
            if (classFills.get(one)) { fill = classFills.get(one); break; }
          }
        }
        if (fill && (!best || w * h > best.area)) best = { fill, area: w * h };
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(svg);
  return best;
}

/* ==========================================================================
 * 7. 颜色对比度（WCAG 2.1）
 * ========================================================================== */
function relLum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ==========================================================================
 * 8. Playwright（可选）：主体占位比
 * --------------------------------------------------------------------------
 * artifacts/vis/ 下没有 node_modules -> 从 ../../tests/node_modules 显式解析。
 * 解析不到 / 浏览器起不来 -> 标记 SKIPPED，其余断言照跑。
 * ========================================================================== */
function loadPlaywright() {
  /* 显式降级开关：CI 无浏览器时用 VIS_ASSET_GUARD_NO_PLAYWRIGHT=1 强制跳过 */
  if (process.env.VIS_ASSET_GUARD_NO_PLAYWRIGHT) {
    return { disabled: '按 VIS_ASSET_GUARD_NO_PLAYWRIGHT=1 显式跳过 Playwright 依赖' };
  }
  const candidates = [
    path.join(ROOT, 'tests', 'package.json'),
    path.join(ROOT, 'package.json'),
  ];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    try {
      const req = createRequire(base);
      const pw = req('playwright');
      if (pw && pw.chromium) return pw;
    } catch (e) { /* 换下一个候选 */ }
  }
  return null;
}

async function measureOccupancies(items) {
  const pw = loadPlaywright();
  if (pw && pw.disabled) {
    return { results: new Map(), skipped: pw.disabled };
  }
  if (!pw) {
    return { results: new Map(), skipped: 'Playwright 不可解析（tests/node_modules 缺失或未安装 playwright）' };
  }
  let browser = null;
  try {
    browser = await pw.chromium.launch({ channel: 'msedge' });
  } catch (e1) {
    try {
      browser = await pw.chromium.launch();
    } catch (e2) {
      return { results: new Map(), skipped: '浏览器启动失败（msedge 与 bundled chromium 均不可用）：' + e2.message.split('\n')[0] };
    }
  }
  const results = new Map();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (const it of items) {
    try {
      const svgText = fs.readFileSync(it.abs, 'utf8');
      await page.setContent(
        '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' +
        svgText + '</body></html>',
        { waitUntil: 'load', timeout: 15000 }
      );
      const res = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        if (!svg) return { error: '页面内没有 svg 元素' };
        let vb = null;
        try {
          const b = svg.viewBox.baseVal;
          vb = { x: b.x, y: b.y, width: b.width, height: b.height };
        } catch (e) { vb = null; }
        try {
          const bb = svg.getBBox();
          return { bbox: { x: bb.x, y: bb.y, width: bb.width, height: bb.height }, viewBox: vb };
        } catch (e) {
          return { error: 'getBBox() 失败: ' + e.message };
        }
      });
      results.set(it.rel, res);
    } catch (e) {
      results.set(it.rel, { error: String(e.message || e) });
    }
  }
  await page.close();
  await browser.close();
  return { results, skipped: null };
}

/* ==========================================================================
 * 9. 断言
 * --------------------------------------------------------------------------
 * 违规 -> 退出码 2；通过 -> 0；脚本自身出错 -> 3。
 * ========================================================================== */
function themeOf(relPath) {
  const base = path.basename(relPath).replace(/\.svg$/i, '');
  return /-dark$/i.test(base) ? 'dark' : 'light';
}

function assetKey(relPath) {
  return path.basename(relPath).replace(/\.svg$/i, '');
}

function analyzeAll(present) {
  return present.map((it) => {
    const text = fs.readFileSync(it.abs, 'utf8');
    const raw = fs.readFileSync(it.abs);
    const info = analyzeSvg(it.abs, text);
    const norm = normalizeSvgText(text);
    return {
      rel: it.rel,
      abs: it.abs,
      text,
      bytes: raw.length,
      rawSha256: sha256(raw),
      normSha256: sha256(Buffer.from(norm.text, 'utf8')),
      normBytes: Buffer.byteLength(norm.text, 'utf8'),
      normalized: norm.text,
      semanticSafe: norm.semanticSafe,
      theme: themeOf(it.rel),
      key: assetKey(it.rel),
      info,
    };
  });
}

/* ==========================================================================
 * 9.5 棘轮（RATCHET）—— 与 vis-check.mjs 同一套语言
 * --------------------------------------------------------------------------
 * 已知债务按「断言 id | 资产路径」精确登记，数量只降不升：
 *   等于基线 -> 退出码 1（仅提示，不阻塞）
 *   超  基线 -> 退出码 2（阻塞）
 * ========================================================================== */
function ratchetKey(v) {
  return v.id + '|' + v.asset;
}

function ratchetEvaluate(violations) {
  const actual = {};
  for (const v of violations) {
    const k = ratchetKey(v);
    actual[k] = (actual[k] || 0) + 1;
  }
  const base = SPEC.ratchet || {};
  const over = [];    // 超基线 -> 阻塞
  const within = [];  // 等于基线 -> 仅提示
  const under = [];   // 低于基线 -> 可收紧
  for (const [k, n] of Object.entries(actual)) {
    const b = base[k] || 0;
    if (n > b) over.push({ key: k, actual: n, base: b });
    else within.push({ key: k, actual: n, base: b });
  }
  for (const [k, b] of Object.entries(base)) {
    const a = actual[k] || 0;
    if (a < b) under.push({ key: k, actual: a, base: b });
  }
  return { actual, over, within, under };
}

/** 退出码：0=全通过 / 1=等于基线仅提示 / 2=超基线阻塞 */
function ratchetExitCode(violations) {
  const r = ratchetEvaluate(violations);
  if (r.over.length) return 2;
  if (violations.length) return 1;
  return 0;
}

function runAssertions(assets, occupancy, allAssets) {
  const scope = allAssets && allAssets.length ? allAssets : assets;
  const violations = [];
  const skipped = [];
  const notes = [];
  const V = (id, asset, msg) => violations.push({ id, asset, msg });
  const S = (id, asset, msg) => skipped.push({ id, asset, msg });

  /* --- a. viewBox --- */
  for (const a of assets) {
    const vb = a.info.viewBox;
    if (!a.info.svg) {
      V('A1', a.rel, '根元素不是 <svg>');
      continue;
    }
    if (!vb) {
      V('A1', a.rel, 'viewBox 缺失或不是合法的 4 个数字（读到: ' + (a.info.viewBoxSource || '(无)') + '）');
    } else if (!(vb.width > 0 && vb.height > 0)) {
      V('A1', a.rel, 'viewBox 宽高必须 > 0（' + vb.width + 'x' + vb.height + '）');
    }
  }

  /* --- b. 主体占位比 --- */
  if (occupancy.skipped) {
    for (const a of assets) S('A2', a.rel, '主体占位比：' + occupancy.skipped);
  } else {
    for (const a of assets) {
      const res = occupancy.results.get(a.rel);
      if (!res || res.error) {
        S('A2', a.rel, '主体占位比：测量失败（' + ((res && res.error) || '无结果') + '）');
        continue;
      }
      const bb = res.bbox;
      /* 用浏览器实测的 viewBox（float32 后的真实画布）做参照，避免源文件十进制
       * 与渲染值之间的微小差异把占比顶到 100% 之上 */
      const vb = res.viewBox || a.info.viewBox;
      if (!vb || !vb.width || !vb.height) {
        S('A2', a.rel, '主体占位比：无 viewBox / 尺寸为 0');
        continue;
      }
      /* 「内容在 viewBox 内的包围盒」= 把包围盒裁剪到画布内再算面积比；
       * 溢出部分不计入分母口径，但会在明细里报出原始包围盒。 */
      const cx0 = Math.max(bb.x, vb.x);
      const cy0 = Math.max(bb.y, vb.y);
      const cx1 = Math.min(bb.x + bb.width, vb.x + vb.width);
      const cy1 = Math.min(bb.y + bb.height, vb.y + vb.height);
      const cw = Math.max(0, cx1 - cx0);
      const ch = Math.max(0, cy1 - cy0);
      const ratio = (cw * ch) / (vb.width * vb.height);
      const overflow = (bb.width * bb.height) > (vb.width * vb.height) * 1.001;
      a.occupancy = { ratio, bbox: bb, viewBox: vb, overflow };
      if (overflow) {
        notes.push({
          id: 'A2',
          asset: a.rel,
          msg: '内容包围盒超出 viewBox（原始 ' + bb.width.toFixed(1) + 'x' + bb.height.toFixed(1) +
            ' vs 画布 ' + vb.width.toFixed(1) + 'x' + vb.height.toFixed(1) + '），占位比已按裁剪后计算',
        });
      }
      const EPS = 1e-6;
      if (ratio < SPEC.occupancy.min - EPS || ratio > SPEC.occupancy.max + EPS) {
        V('A2', a.rel, '主体占位比 ' + (ratio * 100).toFixed(1) + '% 超出区间 [' +
          (SPEC.occupancy.min * 100).toFixed(0) + '%, ' + (SPEC.occupancy.max * 100).toFixed(0) + '%]');
      }
    }
  }

  /* --- c. 描边档 --- */
  for (const a of assets) {
    const sw = a.info.strokeWidths;
    a.strokeTiers = sw;
    if (!sw.length) {
      notes.push({ id: 'A3', asset: a.rel, msg: '无描边档（纯色面片资产，未使用 stroke）' });
      continue;
    }
    if (sw.length > SPEC.stroke.maxTiers) {
      V('A3', a.rel, '描边档位过多：' + sw.length + ' 档（上限 ' + SPEC.stroke.maxTiers + '）-> ' + sw.join(', '));
    }
    for (const w of sw) {
      if (w < SPEC.stroke.minWidth) {
        V('A3', a.rel, '描边宽度过小：stroke-width=' + w + '（下限 ' + SPEC.stroke.minWidth + '）');
      }
    }
  }

  /* --- c2. 深浅成对 + c3. 深浅内容不得完全相同 ---
   * 成对关系按【全量资产清单】判定，不受 --file 限定影响（否则单文件检查会误报）。 */
  const byKey = new Map(scope.map((a) => [a.key, a]));
  for (const a of assets) {
    if (a.theme === 'dark') continue;
    if (SPEC.pairing.exempt.includes(a.key)) {
      notes.push({ id: 'A4', asset: a.rel, msg: '豁免深浅成对（SPEC.pairing.exempt）' });
      continue;
    }
    const darkKey = a.key + '-dark';
    const dark = byKey.get(darkKey);
    if (!dark) {
      V('A4', a.rel, '缺少深浅配对资产：' + darkKey + '.svg');
      continue;
    }
    if (dark.normSha256 === a.normSha256) {
      V('A5', a.rel, '深浅两版内容完全相同（规范化指纹一致）：' + a.key + '.svg == ' + darkKey + '.svg');
    }
  }

  /* --- d. 面片数 --- */
  for (const a of assets) {
    const t = a.info.tags;
    a.facets = {
      elements: a.info.elementCount,
      path: t.path || 0,
      polygon: t.polygon || 0,
      polyline: t.polyline || 0,
      circle: t.circle || 0,
      ellipse: t.ellipse || 0,
      rect: t.rect || 0,
      line: t.line || 0,
      linearGradient: t.linearGradient || 0,
      radialGradient: t.radialGradient || 0,
      styleRules: a.info.styleRuleCount,
    };
    if (a.info.elementCount < SPEC.facets.minElements || a.info.elementCount > SPEC.facets.maxElements) {
      V('A6', a.rel, '元素总数越界：' + a.info.elementCount);
    }
    if (a.facets.path > SPEC.facets.maxPaths) {
      V('A6', a.rel, 'path 数越界：' + a.facets.path);
    }
    if (a.facets.linearGradient + a.facets.radialGradient > SPEC.facets.maxGradients) {
      V('A6', a.rel, '渐变数越界：' + (a.facets.linearGradient + a.facets.radialGradient));
    }
    if (a.facets.styleRules > SPEC.facets.maxStyleRules) {
      V('A6', a.rel, '<style> 规则数越界：' + a.facets.styleRules);
    }
    if (!a.semanticSafe) {
      V('A7', a.rel, '规范化自检失败：规范化前后语义指纹不一致（normalizer 不安全）');
    }
  }

  /* --- e. 对比度 --- */
  for (const a of assets) {
    /* 背景色判定：整幅背景 rect > 文件名主题 > 「浅墨反白」资产用深底 */
    const dom = a.info.dominant;
    const domLum = dom ? relLum(dom) : 0;
    let bg;
    let bgSource;
    if (a.info.bgRect) {
      bg = a.info.bgRect.fill;
      bgSource = '资产自带整幅背景 rect';
    } else if (dom && domLum >= SPEC.contrast.lightInkLuminance) {
      bg = SPEC.background.dark;
      bgSource = 'SPEC.background.dark（主色 ' + dom + ' 是浅墨反白资产，实际落深底）';
    } else {
      bg = SPEC.background[a.theme];
      bgSource = 'SPEC.background.' + a.theme + '（按文件名主题判定）';
    }
    a.background = bg;
    a.backgroundSource = bgSource;
    const rows = [];
    for (const c of a.info.fills) {
      const ratio = contrastRatio(c, bg);
      rows.push({ color: c, ratio, dominant: c === dom });
    }
    rows.sort((x, y) => x.ratio - y.ratio);
    a.contrastRows = rows;
    a.minContrast = rows.length ? rows[0] : null;
    a.dominant = dom;
    a.dominantRatio = dom ? contrastRatio(dom, bg) : null;
    const bad = rows.filter((r) => r.ratio < SPEC.contrast.minRatio);
    a.lowContrast = bad;
    if (!rows.length) {
      notes.push({ id: 'A8', asset: a.rel, msg: '无 fill 色可参与对比度计算（该资产不带纯色面片）' });
      continue;
    }
    /* 阻塞项只有主色（剪影在背景上站不站得住）；其余低对比面片只提示 */
    const badDom = bad.find((r) => r.color === dom);
    if (badDom && SPEC.contrast.blocking) {
      if (SPEC.contrast.brandMarkExempt.includes(a.key)) {
        /* 品牌标记：WCAG 1.4.11 免除 logo，且品牌色由主理人冻结 -> 报 INFO 不阻塞 */
        notes.push({
          id: 'A8',
          asset: a.rel,
          msg: '品牌标记对比度豁免（WCAG 1.4.11 免除 logo；品牌色由主理人冻结）—— 实测主色 ' +
            dom + ' ' + badDom.ratio.toFixed(2) + ':1（背景 ' + bg + '，阈值 ' +
            SPEC.contrast.minRatio + ':1）',
        });
      } else {
        V('A8', a.rel, '主色 ' + dom + ' 对比度 ' + badDom.ratio.toFixed(2) + ':1 低于 ' +
          SPEC.contrast.minRatio + ':1（背景 ' + bg + '）-> 剪影在背景上站不住');
      }
    }
    const others = bad.filter((r) => r.color !== dom);
    if (others.length) {
      notes.push({
        id: 'A8',
        asset: a.rel,
        msg: '另有 ' + others.length + ' 个内部面片色低于 ' + SPEC.contrast.minRatio + ':1（不阻塞）：' +
          others.map((r) => r.color + ' ' + r.ratio.toFixed(2) + ':1').join(', '),
      });
    }
  }

  return { violations, skipped, notes };
}

/* ==========================================================================
 * 10. 子命令实现
 * ========================================================================== */
function resolveFileArg(p) {
  if (path.isAbsolute(p)) return p;
  const fromCwd = path.resolve(process.cwd(), p);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromRoot = path.resolve(ROOT, p);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return fromCwd;
}

function cmdNormalize(argv) {
  const files = [];
  let write = false;
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') files.push(resolveFileArg(argv[++i] || ''));
    else if (a.startsWith('--file=')) files.push(resolveFileArg(a.slice(7)));
    else if (a === '--write') write = true;
    else if (a === '--out') outPath = path.resolve(process.cwd(), argv[++i] || '');
    else if (a.startsWith('--out=')) outPath = path.resolve(process.cwd(), a.slice(6));
    else die('未知参数: ' + a);
  }

  if (write && !files.length) {
    die('--write 必须配合 --file <path>（拒绝整目录批量覆盖）；先 --out 导出再人工替换');
  }

  /* --file 指定时：stdout 只输出规范化后的 SVG 文本（纯输出，便于 diff / 幂等比对） */
  if (files.length) {
    for (const abs of files) {
      if (!fs.existsSync(abs)) die('文件不存在: ' + abs);
      const text = fs.readFileSync(abs, 'utf8');
      const res = normalizeSvgText(text);
      if (!res.semanticSafe) {
        process.stderr.write('  [ERROR] 规范化会改变语义，已中止（拒绝写入）: ' + abs + '\n');
        process.exit(3);
      }
      if (write) {
        if (res.text === text) {
          process.stderr.write('  [SKIP] 已是规范化形态，无需写入: ' + rel(abs) + '\n');
        } else {
          fs.copyFileSync(abs, abs + '.bak');
          fs.writeFileSync(abs, res.text, 'utf8');
          process.stderr.write('  [WRITE] 已规范化并备份: ' + rel(abs) + '  (备份 ' + rel(abs) + '.bak)\n');
        }
      }
      if (outPath) {
        fs.writeFileSync(outPath, res.text, 'utf8');
        process.stderr.write('  [OUT] 已写入 ' + rel(outPath) + '\n');
      } else if (!write) {
        process.stdout.write(res.text);
      }
    }
    process.exit(0);
  }

  /* 未指定文件：对全部受检资产做只读规范化预览 */
  const { present } = listTrackedAssets();
  const lines = [];
  lines.push('='.repeat(96));
  lines.push(' SiMuseor VIS · 资产规范化预览（只读，不写任何文件）  (' + SPEC.tool + ' v' + SPEC.version + ')');
  lines.push(' 资产目录: ' + ASSET_DIR_REL.replace(/\\/g, '/'));
  lines.push('='.repeat(96));
  for (const it of present) {
    const text = fs.readFileSync(it.abs, 'utf8');
    const res = normalizeSvgText(text);
    const changed = res.text !== text;
    lines.push('  ' + (res.semanticSafe ? '[SAFE]' : '[UNSAFE]') + ' ' + rel(it.abs).padEnd(58) +
      (changed ? '需要规范化' : '已规范化') +
      '  原始 ' + short(sha256(Buffer.from(text, 'utf8'))) +
      ' -> 规范化 ' + short(sha256(Buffer.from(res.text, 'utf8'))));
  }
  lines.push('');
  lines.push('  提示: 原地覆盖请显式使用 --write --file <path>（会先备份 <file>.bak）。');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

function cmdFingerprint(argv) {
  const files = [];
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') files.push(resolveFileArg(argv[++i] || ''));
    else if (a.startsWith('--file=')) files.push(resolveFileArg(a.slice(7)));
    else if (a === '--out') outPath = path.resolve(process.cwd(), argv[++i] || '');
    else if (a.startsWith('--out=')) outPath = path.resolve(process.cwd(), a.slice(6));
    else die('未知参数: ' + a);
  }

  const list = files.length
    ? files.map((abs) => ({ rel: rel(abs), abs }))
    : listTrackedAssets().present;

  const assets = [];
  for (const it of list) {
    if (!fs.existsSync(it.abs)) continue;
    const raw = fs.readFileSync(it.abs);
    const text = raw.toString('utf8');
    const res = normalizeSvgText(text);
    assets.push({
      path: it.rel,
      bytes: raw.length,
      rawSha256: sha256(raw),
      normalizedBytes: Buffer.byteLength(res.text, 'utf8'),
      normalizedSha256: sha256(Buffer.from(res.text, 'utf8')),
      semanticSafe: res.semanticSafe,
      needsNormalize: res.text !== text,
    });
  }
  assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const payload = {
    tool: SPEC.tool,
    version: SPEC.version,
    assetDir: ASSET_DIR_REL.replace(/\\/g, '/'),
    assets,
    missing: listTrackedAssets().missing.map((m) => ({ path: m.rel, reason: m.reason })),
  };
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    process.stderr.write('  [OUT] 指纹台账已写入 ' + rel(outPath) + '\n');
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

async function cmdAssert(argv) {
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') files.push(resolveFileArg(argv[++i] || ''));
    else if (a.startsWith('--file=')) files.push(resolveFileArg(a.slice(7)));
    else die('未知参数: ' + a);
  }
  const inventory = listTrackedAssets();
  const present = files.length
    ? files.map((abs) => ({ rel: rel(abs), abs }))
    : inventory.present;
  for (const it of present) {
    if (!fs.existsSync(it.abs)) die('文件不存在: ' + it.abs);
  }
  const assets = analyzeAll(present);
  /* 成对关系按全量清单判定：--file 限定时也要看得到配对资产 */
  const allAssets = files.length ? analyzeAll(inventory.present) : assets;
  const occ = await measureOccupancies(present);
  const res = runAssertions(assets, occ, allAssets);

  const HR = '='.repeat(96);
  const HR2 = '-'.repeat(96);
  const L = [];
  L.push(HR);
  L.push(' SiMuseor VIS · 资产规格断言  (' + SPEC.tool + ' v' + SPEC.version + ')');
  L.push(' 生成时间: ' + new Date().toISOString());
  L.push(' 资产目录: ' + ASSET_DIR_REL.replace(/\\/g, '/'));
  L.push(' 受检资产: ' + assets.length + ' 个' + (files.length ? '（--file 限定）' : '（全部 git 已跟踪且存在的 svg）'));
  L.push(' 模式    : 只读（不写任何项目文件）');
  L.push(HR);
  L.push('');
  L.push('[1] 资产清单');
  for (const a of assets) {
    L.push('    ' + a.rel.padEnd(58) + a.theme.padEnd(6) + '元素 ' + String(a.info.elementCount).padStart(4));
  }
  if (inventory.missing.length) {
    L.push('    -- 以下 git 已跟踪但工作区不存在（已跳过，不修复）：');
    for (const m of inventory.missing) L.push('       ' + m.rel + '  (' + m.reason + ')');
  }
  L.push('');
  L.push(HR2);
  L.push('[2] 规格断言');
  const byId = {};
  for (const v of res.violations) (byId[v.id] = byId[v.id] || []).push(v);
  const skipById = {};
  for (const s of res.skipped) (skipById[s.id] = skipById[s.id] || []).push(s);
  const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
  const titles = {
    A1: 'viewBox 存在且合法',
    A2: '主体占位比在区间内',
    A3: '描边档位一致',
    A4: '深浅版本成对存在',
    A5: '深浅版本内容不同',
    A6: '面片数在合理区间',
    A7: '规范化语义自检',
    A8: 'fill 色对比度 >= ' + SPEC.contrast.minRatio + ':1',
  };
  const rat = ratchetEvaluate(res.violations);
  const overKeys = new Set(rat.over.map((o) => o.key));
  for (const id of ids) {
    const vs = byId[id] || [];
    const ss = skipById[id] || [];
    const blocking = vs.filter((v) => overKeys.has(ratchetKey(v)));
    const status = blocking.length ? '[FAIL]' : (vs.length ? '[WARN]' : (ss.length ? '[SKIP]' : '[PASS]'));
    L.push('    ' + status + ' ' + (id + ' ' + titles[id]).padEnd(34) +
      (vs.length ? vs.length + ' 项违规' + (blocking.length
        ? '（其中 ' + blocking.length + ' 项超基线，阻塞）'
        : '（等于棘轮基线，仅提示）')
        : (ss.length ? ss.length + ' 项跳过' : '通过')));
    for (const v of vs) L.push('         - ' + v.asset + ': ' + v.msg);
    if (vs.length === 0) for (const s of ss) L.push('         - ' + s.asset + ': ' + s.msg);
  }
  L.push('');
  L.push(HR2);
  L.push('[3] 逐资产明细');
  for (const a of assets) {
    const f = a.facets || {};
    L.push('    ' + a.rel);
    L.push('      viewBox      : ' + (a.info.viewBoxSource || '(缺失)') +
      '   元素 ' + a.info.elementCount +
      '   path ' + f.path + ' / polygon ' + f.polygon + ' / 渐变 ' + (f.linearGradient + f.radialGradient) +
      ' / style 规则 ' + f.styleRules);
    L.push('      描边档       : ' + (a.strokeTiers && a.strokeTiers.length
      ? a.strokeTiers.length + ' 档 [' + a.strokeTiers.join(', ') + ']' : '0 档（未使用描边）'));
    L.push('      主体占位     : ' + (a.occupancy
      ? (a.occupancy.ratio * 100).toFixed(1) + '%  bbox ' +
        a.occupancy.bbox.width.toFixed(1) + 'x' + a.occupancy.bbox.height.toFixed(1)
      : 'SKIPPED（缺 Playwright / 测量失败）'));
    L.push('      背景色       : ' + (a.background || '(无)') + '  来源: ' + (a.backgroundSource || '-'));
    L.push('      主色         : ' + (a.dominant || '(无)') +
      (a.dominantRatio !== null && a.dominantRatio !== undefined
        ? '  对比度 ' + a.dominantRatio.toFixed(2) + ':1  （主色判定依据: ' + (a.info.dominantBy || '-') + '）'
        : ''));
    L.push('      最低对比度   : ' + (a.minContrast
      ? a.minContrast.color + ' ' + a.minContrast.ratio.toFixed(2) + ':1（共 ' + a.contrastRows.length + ' 色）'
      : 'n/a'));
    L.push('      指纹         : 原始 ' + short(a.rawSha256) + ' / 规范化 ' + short(a.normSha256));
  }
  L.push('');
  L.push(HR);
  L.push('[4] SUMMARY');
  L.push(HR);
  L.push('  违规项: ' + res.violations.length + ' 个' +
    (rat.over.length ? '（超棘轮基线，阻塞，退出码 2）'
      : (res.violations.length ? '（等于棘轮基线，仅提示，退出码 1）' : '（无）')));
  L.push('  棘轮     : 基线 ' + Object.keys(SPEC.ratchet || {}).length + ' 条 / 超基线 ' + rat.over.length +
    ' 条 / 等于基线 ' + rat.within.length + ' 条 / 可收紧 ' + rat.under.length + ' 条');
  for (const o of rat.over) L.push('    [OVER]    ' + o.key + '  实际 ' + o.actual + ' > 基线 ' + o.base);
  for (const u of rat.under) L.push('    [TIGHTEN] ' + u.key + '  实际 ' + u.actual + ' < 基线 ' + u.base + '（可收紧基线）');
  L.push('  跳过项: ' + res.skipped.length + ' 个（缺 Playwright / 测量失败）');
  L.push('  提示项: ' + res.notes.length + ' 个（不参与退出码）');
  for (const n of res.notes) L.push('    [INFO] ' + n.asset + ': ' + n.msg);
  L.push('');
  L.push('  退出码约定: 0=全通过 / 1=等于棘轮基线仅提示 / 2=超棘轮基线（阻塞） / 3=脚本自身出错');
  L.push(HR);
  const text = L.join('\n') + '\n';
  process.stdout.write(text);

  const code = ratchetExitCode(res.violations);
  process.stdout.write('  EXIT CODE = ' + code + '\n');
  process.exit(code);
}

async function cmdReport(argv) {
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') outPath = path.resolve(process.cwd(), argv[++i] || '');
    else if (a.startsWith('--out=')) outPath = path.resolve(process.cwd(), a.slice(6));
    else die('未知参数: ' + a);
  }

  const inventory = listTrackedAssets();
  const assets = analyzeAll(inventory.present);
  const occ = await measureOccupancies(inventory.present);
  const res = runAssertions(assets, occ, assets);
  const rat = ratchetEvaluate(res.violations);
  const overKeys = new Set(rat.over.map((o) => o.key));

  const byAsset = new Map();
  for (const v of res.violations) {
    if (!byAsset.has(v.asset)) byAsset.set(v.asset, []);
    byAsset.get(v.asset).push(v);
  }

  const M = [];
  M.push('# VIS 资产守门员报告');
  M.push('');
  M.push('- 工具: `' + SPEC.tool + '` v' + SPEC.version);
  M.push('- 资产目录: `' + ASSET_DIR_REL.replace(/\\/g, '/') + '`');
  M.push('- 生成时间: ' + new Date().toISOString());
  M.push('- 跟踪资产 ' + inventory.tracked.length + ' 个 / 当前存在 ' + inventory.present.length +
    ' 个 / 已删除跳过 ' + inventory.missing.length + ' 个');
  M.push('- 主体占位比测量: ' + (occ.skipped ? '**不可用**（' + occ.skipped + '）' : 'Playwright 渲染测量'));
  M.push('');
  M.push('## 资产明细');
  M.push('');
  M.push('| 资产 | 主题 | viewBox | 主体占位 | 面片(path/渐变/style 规则) | 描边档 | 主色 | 最低对比度 | 原始 sha256 | 规范化 sha256 | 状态 |');
  M.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of assets) {
    const f = a.facets || {};
    const vs = byAsset.get(a.rel) || [];
    const occCell = a.occupancy ? (a.occupancy.ratio * 100).toFixed(1) + '%' : 'SKIPPED';
    M.push('| `' + path.basename(a.rel) + '` | ' + a.theme +
      ' | ' + (a.info.viewBoxSource || '(缺失)') +
      ' | ' + occCell +
      ' | ' + f.path + ' / ' + (f.linearGradient + f.radialGradient) + ' / ' + f.styleRules +
      ' | ' + (a.strokeTiers && a.strokeTiers.length ? a.strokeTiers.length + ' 档' : '0 档') +
      ' | `' + (a.dominant || '-') + '`' +
      ' | ' + (a.minContrast ? a.minContrast.color + ' ' + a.minContrast.ratio.toFixed(2) + ':1' : 'n/a') +
      ' | `' + short(a.rawSha256) + '`' +
      ' | `' + short(a.normSha256) + '`' +
      ' | ' + (vs.length
        ? (vs.some((v) => overKeys.has(ratchetKey(v)))
          ? '❌ ' + vs.length + ' 项违规（超基线）'
          : '⚠️ ' + vs.length + ' 项违规（等于基线）')
        : '✅ PASS') + ' |');
  }
  M.push('');
  M.push('## 对比度明细（背景色 ' + '按主题取 vis-tokens.css 的 --brand-paper / --brand-paper-reverse' + '）');
  M.push('');
  for (const a of assets) {
    if (!a.contrastRows || !a.contrastRows.length) {
      M.push('- `' + path.basename(a.rel) + '` — 无 fill 色可计算（背景 ' + (a.background || 'n/a') + '）');
      continue;
    }
    M.push('- `' + path.basename(a.rel) + '` — 背景 `' + a.background + '`（' + (a.backgroundSource || '-') + '），主色 `' +
      (a.dominant || '-') + '`，共 ' + a.contrastRows.length + ' 个 fill 色');
    const bad = a.contrastRows.filter((r) => r.ratio < SPEC.contrast.minRatio);
    if (!bad.length) {
      M.push('  - 全部 ≥ ' + SPEC.contrast.minRatio + ':1');
    } else {
      for (const r of bad) {
        M.push('  - `' + r.color + '` ' + r.ratio.toFixed(2) + ':1' +
          (r.dominant ? ' **（主色，阻塞）**' : '（内部面片，仅提示）'));
      }
    }
  }
  M.push('');
  M.push('## 违规项');
  M.push('');
  M.push('> 棘轮口径：**等于基线仅提示（退出码 1），超基线才阻塞（退出码 2）**。');
  M.push('> 基线 ' + Object.keys(SPEC.ratchet || {}).length + ' 条 / 超基线 ' + rat.over.length +
    ' 条 / 等于基线 ' + rat.within.length + ' 条 / 可收紧 ' + rat.under.length + ' 条');
  if (rat.over.length) {
    M.push('>');
    for (const o of rat.over) M.push('> - **[超基线]** `' + o.key + '` 实际 ' + o.actual + ' > 基线 ' + o.base);
  }
  if (rat.under.length) {
    M.push('>');
    for (const u of rat.under) M.push('> - **[可收紧]** `' + u.key + '` 实际 ' + u.actual + ' < 基线 ' + u.base);
  }
  M.push('');
  if (!res.violations.length) {
    M.push('（无）');
  } else {
    for (const v of res.violations) {
      const over = overKeys.has(ratchetKey(v));
      M.push('- **' + v.id + '** `' + v.asset + '` — ' + v.msg +
        (over ? ' **（超基线，阻塞）**' : '（等于基线，仅提示）'));
    }
  }
  M.push('');
  M.push('## 跳过项（缺 Playwright 等）');
  M.push('');
  M.push('- 依赖 Playwright 的断言: **A2 主体占位比**（渲染后量 `getBBox()`）—— 当前状态: ' +
    (occ.skipped ? '**不可用**，以下资产的相关断言已跳过' : '**可用**，已全部测量'));
  if (!res.skipped.length) {
    M.push('- （无）本次运行没有资产被跳过。');
  } else {
    const seen = new Set();
    for (const s of res.skipped) {
      const key = s.id + '|' + s.msg;
      if (seen.has(key)) continue;
      seen.add(key);
      M.push('- **' + s.id + '** `' + s.asset + '` — ' + s.msg);
    }
  }
  M.push('');
  M.push('## 提示项（不参与退出码）');
  M.push('');
  if (!res.notes.length) {
    M.push('（无）');
  } else {
    for (const n of res.notes) M.push('- **' + n.id + '** `' + n.asset + '` — ' + n.msg);
  }
  M.push('');
  M.push('## 已删除的受跟踪资产（跳过，不修复）');
  M.push('');
  if (!inventory.missing.length) {
    M.push('（无）');
  } else {
    for (const m of inventory.missing) M.push('- `' + m.rel + '` — ' + m.reason);
  }
  M.push('');

  const md = M.join('\n');
  if (outPath) {
    fs.writeFileSync(outPath, md, 'utf8');
    process.stderr.write('  [OUT] 报告已写入 ' + rel(outPath) + '\n');
  } else {
    process.stdout.write(md);
  }
  const code = ratchetExitCode(res.violations);
  process.stderr.write('  EXIT CODE = ' + code + '\n');
  process.exit(code);
}

/* ==========================================================================
 * 11. 入口
 * ========================================================================== */
export {
  parseXml, serializeDoc, semanticDigest, normalizeSvgText, splitPathData,
  analyzeSvg, contrastRatio, listTrackedAssets, analyzeAll, runAssertions,
  measureOccupancies, ratchetEvaluate, ratchetExitCode, ratchetKey,
  SPEC, ASSET_DIR_REL, ROOT,
};

const USAGE = [
  '用法:',
  '  node vis-asset-guard.mjs normalize [--file <path>] [--write] [--out <path>]',
  '  node vis-asset-guard.mjs fingerprint [--file <path>] [--out <path>]',
  '  node vis-asset-guard.mjs assert [--file <path>]',
  '  node vis-asset-guard.mjs report [--out <path>]',
  '',
  '退出码: 0=通过 / 1=等于棘轮基线仅提示 / 2=超棘轮基线（阻塞） / 3=脚本自身出错',
].join('\n');

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'normalize': return cmdNormalize(rest);
    case 'fingerprint': return cmdFingerprint(rest);
    case 'assert': return cmdAssert(rest);
    case 'report': return cmdReport(rest);
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    default:
      die('未知子命令: ' + cmd + '\n' + USAGE);
  }
}

const isMain = !!process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((e) => {
    process.stderr.write('  [ERROR] 脚本自身出错: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(3);
  });
}
