#!/usr/bin/env node
/* ============================================================================
 * VIS 手册站 · 分章拆页与导航同步
 * ----------------------------------------------------------------------------
 *   node artifacts/vis/vis-manual.mjs split     把章页拆成「一节一页」（一次性迁移）
 *   node artifacts/vis/vis-manual.mjs build     生成章首页 + 重写 shell.js 的导航块
 *   node artifacts/vis/vis-manual.mjs check     防漂移（只读）
 *
 * 【为什么要拆】
 *   二级导航项此前是**章页里的锚点**。拆成「一节一页」后：二级项 = 自己的 URL，
 *   可直接分享、可直接收藏；章首页 = 该章的目录；导航不再依赖锚点。
 *
 * 【三层】
 *   节页    artifacts/vis/reference/<章>/<节id>.html   手写内容（唯一手写处）
 *   章首页  artifacts/vis/reference/<章>/index.html    **生成物**
 *   导航块  artifacts/vis/assets/shell.js 的 NAV        **生成物**
 *
 * 【check 查四件】
 *   1. 漂移：重新生成章首页 + 导航块 → 与入库文件逐字节比对
 *   2. 双向覆盖：导航里的每个节页都存在；每个节页都在导航里
 *   3. 野生文件：reference/ 下有 .html 但不在导航里
 *   4. 章首页与节页目录一致
 *
 * 【split 的边界规则（v2 · DOM 级）】
 *   旧的一次性迁移是**按 <h3> 文本位置切**的 —— 很多章页的 <h3> 嵌在容器里
 *   （<div class="fm-cols"><section class="fm-col"><header class="fm-col-head"><h3>…），
 *   于是切在了嵌套容器中间，产生大量孤儿标签。现在改成：
 *   · 唯一真值来源 = git 里的旧章页（OLD_REV，结构完整、样式正确）
 *   · 用 vis-dom.mjs 真解析成 DOM，再按**顶层内容块**分组
 *   · 一组 = 恰好含一个 <h3 id> 的自闭合片段；容器不跨组切断
 *   · 节标题提升为页面主标题 <h1 id>（保留原 id 与富文本），节内不再重复 h3
 *   · 内容放在 section.ref 的**直接子级**（vis.css 的直接子选择器依赖这一点）
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseHtml, cloneNode, findAll, findFirst, elementChildren } from './vis-dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REF = path.join(HERE, 'reference');
const SHELL = path.join(HERE, 'assets', 'shell.js');

/* 章 -> 目录名（与旧章页文件名对应） */
const CHAPTERS = {
  brand: 'brand', families: 'families', color: 'color', typography: 'typography',
  icons: 'icons', layout: 'layout', components: 'components',
  application: 'application', engineering: 'engineering',
  acceptance: 'acceptance', decisions: 'decisions', audit: 'audit',
};

/* 章 -> 导航图标（对应 shell.js 的 ICONS 键） */
const CHAPTER_ICONS = {
  brand: 'brand', families: 'family', color: 'color', typography: 'typography',
  icons: 'icons', layout: 'layout', components: 'components',
  application: 'app', engineering: 'settings', acceptance: 'check',
  decisions: 'gavel', audit: 'audit',
};

/* 章 -> 一级导航短名（页面标题可以长，导航不行；<=6 字） */
const CHAPTER_NAV_LABELS = {
  audit: '审计',
};

/* 二级导航短标签（<=6 字）—— 页面自己在 <meta name="nav-label"> 里声明，
   这里是 split 时的**真值来源**，保证重跑 split 得到同一套标签。 */
const SECTION_NAV_LABELS = {
  'color/s-11': '原始层', 'color/s-12': '语义层', 'color/s-13': '组件层',
  'color/s-14': '纸墨层', 'color/s-15': '对比度', 'color/s-16': '色域',
  'color/s-17': '约束表', 'color/s-18': '国际锚点', 'color/s-19': '渐变层',
  'brand/s-51': '组合标', 'brand/s-52': '纸墨', 'brand/s-53': '蝉形',
  'brand/s-54': '图标档', 'brand/s-55': '禁用',
  'families/s-fam-default': '默认标', 'families/s-fam-official': '官方标',
  'families/s-fam-redraw': '重绘',
  'typography/s-21': '字体', 'typography/s-22': '字号',
  'typography/s-23': '字重', 'typography/s-24': '字距',
  'icons/s-icon-grid': '图标集', 'icons/s-icon-size': '尺寸',
  'layout/s-41': '圆角', 'layout/s-42': '间距', 'layout/s-43': '阴影',
  'layout/s-44': '栅格', 'layout/s-45': '色板', 'layout/s-46': '卡片',
  'components/s-31': '按钮', 'components/s-32': '输入框', 'components/s-33': '胶囊',
  'components/s-34': '徽章', 'components/s-35': '面板', 'components/s-36': '页头',
  'components/s-37': '卡片', 'components/s-38': '模型卡', 'components/s-39': '空状态',
  'components/s-310': '表格', 'components/s-311': '导航', 'components/s-312': '弹层',
  'application/s-71': '品牌落位', 'application/s-72': '状态机',
  'application/s-73': '无障碍', 'application/s-74': '响应式',
  'application/s-75': '文案', 'application/s-76': 'E2E清单',
  'engineering/s-81': 'token层', 'engineering/s-82': '实跑报告',
  'engineering/s-83': '迁移', 'engineering/s-84': '交付物',
  'acceptance/s-91': '验收清单', 'acceptance/s-92': '冻结同步',
  'decisions/s-101': '裁决记录', 'decisions/s-a1': '迭代档案',
  'decisions/s-b1': '三条教训', 'decisions/s-c1': '版本记录',
  'audit/s-61': '口径声明',
};

/* split 的真值来源：git 里结构完整的 12 个旧章页
   （a164f7c = 「左侧导航改两级…补齐 4 个缺失分章」—— 拆分迁移之前的最后一版） */
const OLD_REV = 'a164f7ca7eefebfcbfc571a3de1fd43daadd799e';

const NAV_BEGIN = '/* BEGIN nav-data */';
const NAV_END = '/* END nav-data */';

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const specVersion = () => {
  const head = fs.readFileSync(path.join(HERE, 'SiMuseor-VIS.md'), 'utf8').split('\n')[0];
  const m = head.match(/v(\d+\.\d+)/);
  return m ? 'v' + m[1] : '(未知版本)';
};

/* --------------------------------------------------------------------------
 * DOM 小工具
 * -------------------------------------------------------------------------- */
const isElement = (n) => n.type === 'element';
const meaningful = (n) => isElement(n) || (n.type === 'text' && n.text.trim() !== '');

/* 只取「有内容」的子节点（丢掉块级之间的纯空白） */
function kidsOf(node) {
  return node.children.filter(meaningful);
}

/* 文本内容（去标签） */
function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  return node.children.map(textOf).join('');
}

/* 节点在树里是否还挂着（detach 之后 parent 会被摘掉） */
function attachedTo(node, root) {
  let p = node.parent;
  while (p) { if (p === root) return true; p = p.parent; }
  return false;
}

/* 从树上摘掉一个节点；空掉的祖先一并摘掉，但**不越过 stopAt** */
function detach(target, stopAt) {
  const parent = target.parent;
  if (!parent) return null;
  const idx = parent.children.indexOf(target);
  if (idx >= 0) parent.children.splice(idx, 1);
  let p = parent;
  while (p && isElement(p) && p !== stopAt && p.children.filter(meaningful).length === 0) {
    const gp = p.parent;
    if (!gp) break;
    const i = gp.children.indexOf(p);
    if (i >= 0) gp.children.splice(i, 1);
    p = gp;
  }
  return parent;
}

/* 只留外壳（属性），不保留子节点 */
function shellOf2(el) {
  return {
    type: 'element', tag: el.tag,
    attrs: el.attrs.map((a) => ({ ...a })),
    attrMap: { ...el.attrMap },
    children: [], parent: null, line: el.line,
    classes: el.classes.slice(),
  };
}

/* 从一组节点构成的树里摘掉 target（空掉的祖先一并摘掉，但不越过根） */
function detachInTree(roots, target) {
  const stack = roots.slice();
  while (stack.length) {
    const c = stack.shift();
    if (!isElement(c)) continue;
    for (let i = 0; i < c.children.length; i++) {
      const ch = c.children[i];
      if (ch === target) {
        c.children.splice(i, 1);
        let p = c;
        while (p && roots.indexOf(p) < 0 && p.children.filter(meaningful).length === 0) {
          const gp = p.parent;
          if (!gp) break;
          const j = gp.children.indexOf(p);
          if (j >= 0) gp.children.splice(j, 1);
          p = gp;
        }
        return true;
      }
      stack.push(ch);
    }
  }
  return false;
}

/* 节点自身 + 后代里的带 id 的 h3 */
function h3sIn(node) {
  if (!isElement(node)) return [];
  const out = [];
  if (node.tag === 'h3' && node.attrMap.id) out.push(node);
  for (const e of findAll(node, (x) => x.tag === 'h3' && x.attrMap.id)) out.push(e);
  return out;
}

/* --------------------------------------------------------------------------
 * 分组：把章页 section 的子节点切成「每组恰好一个 h3」的自闭合片段
 * -------------------------------------------------------------------------- */
function groupLevel(nodes) {
  const groups = [];
  const pending = [];
  let cur = null;
  for (const node of nodes) {
    const hs = h3sIn(node);
    if (!hs.length) {
      if (cur) cur.nodes.push(node);
      else pending.push(node);
      continue;
    }
    if (hs.length === 1) {
      cur = { h3: hs[0], nodes: [node] };
      groups.push(cur);
      continue;
    }
    /* 一个容器里塞了多个 h3 —— 把它**就地拆开**：每个组拿一份「瘦身后的容器」，
       容器内的子节点是「搬」过去的（不复制），h3 的对象身份得以保留 */
    const sub = groupLevel(kidsOf(node));
    for (const g of sub.groups) {
      const wrapper = shellOf2(node);
      for (const n of g.nodes) {
        n.parent = wrapper;
        wrapper.children.push(n);
      }
      groups.push({ h3: g.h3, nodes: [wrapper] });
    }
    if (sub.pending.length && groups.length) {
      /* 容器内第一个 h3 之前的内容 -> 归到第一组 */
      const first = groups[groups.length - sub.groups.length];
      first.nodes = [...sub.pending, ...first.nodes];
    }
    cur = groups[groups.length - 1] || null;
  }
  return { groups, pending };
}

/* --------------------------------------------------------------------------
 * 「只剩计数徽标的头部容器」收拾
 *   拆页时节标题提升成了页面 h1，容器头（*-head）里的标题就跟着走了，
 *   只剩一个计数徽标被 margin-left:auto 推到最右侧，孤零零悬在面板角上。
 *   处置：把这种头摘掉，计数并进 doc-sub（不放回页面里当第二个标题）。
 * -------------------------------------------------------------------------- */
const TITLEISH = /(^|[-_])(title|label|heading|name|caption)$/;
const BADGISH = /(^|[-_])(count|badge|num|chip)$/;

function isHeaderish(el) {
  return el.tag === 'header' || el.classes.some((c) => /(^|[-_])head$/.test(c));
}

function harvestOrphanHeads(nodes) {
  let badge = '';
  const visit = (n) => {
    for (const c of n.children.slice()) {
      if (c.type !== 'element') continue;
      if (isHeaderish(c)) {
        const kids = elementChildren(c);
        const hasTitle = findAll(c, (e) => /^h[1-6]$/.test(e.tag) || e.classes.some((x) => TITLEISH.test(x))).length > 0;
        const badges = kids.filter((k) => k.classes.some((x) => BADGISH.test(x)));
        if (!hasTitle && badges.length && badges.length === kids.length) {
          badge = badges.map((b) => textOf(b).trim()).filter(Boolean).join(' ');
          const parent = c.parent;
          if (parent) {
            const i = parent.children.indexOf(c);
            if (i >= 0) parent.children.splice(i, 1);
          }
          continue;
        }
      }
      visit(c);
    }
  };
  for (const n of nodes) visit(n);
  return badge;
}

/* --------------------------------------------------------------------------
 * 序列化（带可读缩进）
 * -------------------------------------------------------------------------- */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/* 「行容器」：其子节点各自独占一行（其余元素的内容保持行内，不动） */
const LINE_BREAK = new Set(['html', 'head', 'body', 'div', 'section', 'article', 'aside',
  'header', 'footer', 'nav', 'main', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody',
  'tfoot', 'form', 'figure', 'details', 'fieldset', 'blockquote']);

/* 「折行容器」：内容整体挪到下一行，闭标签独占一行（段落 / 标题这类散文块） */
const WRAPPED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption', 'dd', 'dt']);

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/* 文本节点：去掉首尾空行，续行按公共缩进归一（相对缩进保留，绝对缩进交给序列化器） */
function normText(text) {
  const raw = text.split('\n');
  let a = 0, b = raw.length - 1;
  while (a < b && !raw[a].trim()) a++;
  while (b > a && !raw[b].trim()) b--;
  const lines = raw.slice(a, b + 1);
  if (lines.length <= 1) return lines[0] || '';
  const cont = lines.slice(1).filter((l) => l.trim()).map((l) => (/^[ \t]*/.exec(l)[0]).length);
  const min = cont.length ? Math.min(...cont) : 0;
  return lines.map((l, i) => (i === 0 ? l : (l.trim() ? l.slice(min) : ''))).join('\n');
}

/* 返回：首行不带缩进，其余行按 depth 绝对缩进 */
function ser(node, depth) {
  if (node.type === 'text') {
    const t = normText(node.text);
    return t.split('\n').map((l, i) => (i === 0 ? l : (l.trim() ? '  '.repeat(depth) + l : l))).join('\n');
  }
  if (node.type === 'comment' || node.type === 'doctype') return node.text;
  const attrs = node.attrs.map((a) => (a.value === ''
    ? ' ' + a.name
    : ' ' + a.name + '=' + a.quote + escAttr(a.value) + a.quote)).join('');
  if (VOID_TAGS.has(node.tag)) return '<' + node.tag + attrs + '>';
  const kids = node.children.filter((c) => !(c.type === 'text' && c.text.trim() === ''));

  if (WRAPPED.has(node.tag)) {
    const inner = kids.map((c) => ser(c, depth + 1)).join('');
    if (!inner.trim()) return '<' + node.tag + attrs + '></' + node.tag + '>';
    const body = inner.split('\n')
      .map((l, i) => (i === 0 ? '  '.repeat(depth + 1) + l.replace(/^[ \t]+/, '') : l)).join('\n');
    return '<' + node.tag + attrs + '>\n' + body + '\n' + '  '.repeat(depth) + '</' + node.tag + '>';
  }
  const isBlock = LINE_BREAK.has(node.tag);
  if (!isBlock) {
    const inner = kids.map((c) => ser(c, depth)).join('');
    return '<' + node.tag + attrs + '>' + inner + '</' + node.tag + '>';
  }
  const body = kids.map((c) => ser(c, depth + 1))
    .map((p) => p.split('\n')
      .map((l, i) => (i === 0 ? '  '.repeat(depth + 1) + l.replace(/^[ \t]+/, '') : l)).join('\n'))
    .join('\n');
  return '<' + node.tag + attrs + '>\n' + body + '\n' + '  '.repeat(depth) + '</' + node.tag + '>';
}

function serializeBlock(nodes) {
  return nodes.map((n) => ser(n, 0)).join('\n');
}

/* 给一块内容加整体缩进 */
function indentLines(text, pad) {
  return text.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}

/* --------------------------------------------------------------------------
 * 链接改写
 *   · 章页在 reference/，节页在 reference/<章>/ —— 深度 +1（../assets -> ../../assets）
 *   · 章级锚点（#c-xxx）随章页一起被搬进节页，节页里没有这个锚点 -> 改指章首页
 * -------------------------------------------------------------------------- */
function rewriteLinks(node) {
  if (!isElement(node)) return;
  for (const a of node.attrs) {
    if (a.name !== 'src' && a.name !== 'href') continue;
    const v = a.value;
    if (!v) continue;
    /* 章级锚点（#c-xxx）随章页一起被搬进节页，节页里没有这个锚点 -> 改指章首页 */
    if (/^#c-/.test(v)) { a.value = 'index.html'; continue; }
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/|#)/i.test(v)) continue;
    if (!v.startsWith('../')) continue;
    a.value = '../' + v;
  }
  for (const c of node.children) rewriteLinks(c);
}

/* 章节内多余的 .ref 包裹层：外层 section.ref 已经提供了作用域，拆掉它，
   让 h4 / p.lead 回到 section.ref 的直接子级（vis.css 的直接子选择器依赖这一点） */
function flattenRefWrapper(nodes) {
  const out = [];
  for (const n of nodes) {
    if (isElement(n) && n.classes.includes('ref') && n.tag !== 'section') {
      const kids = kidsOf(n);
      for (const k of kids) k.parent = n.parent;
      out.push(...flattenRefWrapper(kids));
      continue;
    }
    out.push(n);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 页面骨架（所有节页 / 章首页共用同一套）
 * -------------------------------------------------------------------------- */
const PAGE_SHELL = (opts) => `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · SiMuseor VIS</title>
${opts.navLabel ? `<meta name="nav-label" content="${opts.navLabel}">\n` : ''}<meta name="description" content="SiMuseor 视觉规范：${opts.desc || opts.title}">
<link rel="stylesheet" href="${opts.depth}assets/vis.css">
</head>
<body data-page="${opts.dataPage}" data-root="${opts.depth}">
<div class="app-shell">
  <aside class="app-side">
    <div class="app-brand">
      <span class="brand-mark"><img src="${opts.depth}assets/cicada/svg/cicada-mid.svg" alt="" /></span>
      <span class="brand-wordmark">SiMuseor<small class="brand-sub">视觉规范 VIS ${opts.version}</small></span>
    </div>
    <nav class="app-nav" id="app-nav" aria-label="主导航"></nav>
    <div class="app-side-foot">
      <button class="btn-toggle" id="theme-btn" type="button" aria-label="切换明暗主题">切换主题</button>
      <small>VIS ${opts.version} · 2026</small>
    </div>
  </aside>
  <main class="app-main">
    <div class="wrap">
`;

function pageTail(depth) {
  return `    </div>
  </main>
</div>
<script src="${depth}assets/shell.js"></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------------------
 * split：按 DOM 边界重切
 * -------------------------------------------------------------------------- */
function gitShow(rev, file) {
  const r = spawnSync('git', ['-C', ROOT, 'show', `${rev}:${file}`], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git show ${rev}:${file} 失败：${(r.stderr || '').trim()}`);
  return r.stdout;
}

function split(rev) {
  const version = specVersion();
  const made = [];
  const cssOut = path.join(HERE, '_work', '_chapter-css');
  fs.mkdirSync(cssOut, { recursive: true });

  for (const [chap, dir] of Object.entries(CHAPTERS)) {
    const src = gitShow(rev, `artifacts/vis/reference/${chap}.html`);
    const { root } = parseHtml(src);
    const wrap = findFirst(root, (e) => e.classes.includes('wrap'));
    if (!wrap) throw new Error(chap + '.html 找不到 .wrap');
    const chapterSec = kidsOf(wrap).find((n) => isElement(n) && n.tag === 'section');
    if (!chapterSec) throw new Error(chap + '.html 找不到章级 <section>');

    /* 章标题（h2）+ 编号（.num） */
    const h2 = findFirst(chapterSec, (e) => e.tag === 'h2');
    const numEl = h2 ? findFirst(h2, (e) => e.classes.includes('num')) : null;
    const numText = numEl ? textOf(numEl).trim() : '';
    const chapterTitle = h2 ? textOf(h2).replace(textOf(numEl || {}), '').trim() : chap;

    /* 章页里内嵌的 <style>：抽出来（它属于整章，多节共用），不留在页面里 */
    const styleEls = findAll(chapterSec, (e) => e.tag === 'style');
    if (styleEls.length) {
      const css = styleEls.map((s) => s.children.map((c) => c.text || '').join('')).join('\n');
      fs.writeFileSync(path.join(cssOut, `${chap}.css`), css, 'utf8');
      for (const s of styleEls) detach(s, chapterSec);
    }

    /* 章头之后的内容 -> 分组 */
    const head = kidsOf(chapterSec).filter((n) => n !== h2);
    const { groups, pending } = groupLevel(head);
    if (!groups.length) { console.log('  跳过（无 h3）' + chap); continue; }

    /* 章级内容（第一个 h3 之前的）-> 章首页 */
    const chapterLead = pending.filter(meaningful);

    const outDir = path.join(REF, dir);
    fs.mkdirSync(outDir, { recursive: true });

    for (const g of groups) {
      const id = g.h3.attrMap.id;
      const h1Inner = g.h3.children.map((c) => ser(c, 0)).join('');
      const title = textOf(g.h3).replace(/\s+/g, ' ').trim();

      /* 节标题提升为页面主标题 -> 节内不再重复 h3 */
      const h3Idx = g.nodes.indexOf(g.h3);
      if (h3Idx >= 0) g.nodes.splice(h3Idx, 1);
      else detachInTree(g.nodes, g.h3);
      const blocks = flattenRefWrapper(g.nodes).map((n) => {
        rewriteLinks(n);
        return n;
      });
      /* 收拾「只剩计数徽标」的头部容器，计数并进 doc-sub */
      const badge = harvestOrphanHeads(blocks);
      const subExtra = badge ? ` · 本节 ${badge} 项` : '';

      const label = SECTION_NAV_LABELS[`${dir}/${id}`] || title.slice(0, 6);
      const page = PAGE_SHELL({
        title, desc: title, navLabel: label, depth: '../../',
        dataPage: `${dir}/${id}`, version,
      }) +
      `<div class="doc-head">
  <p class="kicker">SiMuseor · VIS ${version}</p>
  <h1 id="${id}">${h1Inner}</h1>
  <p class="doc-sub">${numText} ${chapterTitle} · 本章共 ${groups.length} 节${subExtra}</p>
</div>

<section id="sec-${dir}-${id}" class="ref">
${indentLines(serializeBlock(blocks), '  ')}
</section>
` + pageTail('../../');

      fs.writeFileSync(path.join(outDir, id + '.html'), page, 'utf8');
      made.push({ chap, dir, id, title, chapterTitle });
    }

    /* 章首页：章标题 + 章导语 + 目录（目录由 build 生成） */
    const idx = PAGE_SHELL({
      title: chapterTitle, desc: chapterTitle, depth: '../../',
      dataPage: dir, version,
    }) +
    `<div class="doc-head">
  <p class="kicker">SiMuseor · VIS ${version}</p>
  <h1>${chapterTitle}</h1>
  <p class="doc-sub">本章共 ${groups.length} 节 · 每节一页</p>
</div>

<section id="sec-${dir}" class="ref">
${h2 ? indentLines(ser(h2, 0), '  ') : ''}
${indentLines(serializeBlock(chapterLead), '  ')}
  <!-- BEGIN toc -->
  <!-- END toc -->
</section>
` + pageTail('../../');

    fs.writeFileSync(path.join(outDir, 'index.html'), idx, 'utf8');
    console.log(`  ${chap}.html -> ${dir}/  ${groups.length} 节`);
  }
  console.log(`\n拆出 ${made.length} 个节页`);
  return made;
}

/* --------------------------------------------------------------------------
 * 扫描现有的节页（唯一真值来源）
 * -------------------------------------------------------------------------- */
function scanSections() {
  const out = [];
  for (const [chap, dir] of Object.entries(CHAPTERS)) {
    const d = path.join(REF, dir);
    if (!fs.existsSync(d)) continue;
    const files = fs.readdirSync(d).filter((f) => f.endsWith('.html') && f !== 'index.html').sort();
    const items = files.map((f) => {
      const t = fs.readFileSync(path.join(d, f), 'utf8');
      const h1 = t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      const nav = t.match(/<meta name="nav-label" content="([^"]*)"/);
      return {
        file: f,
        title: h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : f,
        /* 短导航标签：页面自己声明（<meta name="nav-label">），<=6 字；
           没声明就退回标题前 6 字 —— 宁可截断也不让导航变长 */
        label: nav ? nav[1].trim() : (h1 ? h1[1].replace(/<[^>]+>/g, '').trim().slice(0, 6) : f),
      };
    });
    const idxPath = path.join(d, 'index.html');
    const chapterTitle = fs.existsSync(idxPath)
      ? (fs.readFileSync(idxPath, 'utf8').match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, dir])[1].replace(/\s+/g, ' ').trim()
      : dir;
    out.push({ chap, dir, chapterTitle, items });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 生成：章首页 + 导航块
 * -------------------------------------------------------------------------- */
function build() {
  const version = specVersion();
  const chapters = scanSections();

  /* 章首页：章标题与导语是**手写内容**（保留），只重生成目录（标记区间） */
  for (const ch of chapters) {
    const d = path.join(REF, ch.dir);
    const idxPath = path.join(d, 'index.html');
    if (!fs.existsSync(idxPath)) continue;
    const idx = fs.readFileSync(idxPath, 'utf8');
    /* 目录用文件自己的换行符（站点里 HTML 是 CRLF，工具脚本是 LF） */
    const eol = idx.includes('\r\n') ? '\r\n' : '\n';
    const list = ch.items.map((it) =>
      `    <a class="proto-index-card" href="${it.file}"><b>${it.label}</b><span>${it.title}</span><em>${ch.dir}/${it.file}</em></a>`
    ).join(eol);
    /* 标记行缩进必须**原样保留**：
       旧写法 `idx.slice(0, i) + toc` 会把标记前的原有缩进留着、toc 里又带 2 个空格 ——
       每 build 一次就多 2 格，**生成不幂等**（拆页/建目录的地基就是幂等，见 VIS §3.13）。
       这里改成：按行首切、缩进从原文取出来再写回去。 */
    const lineStart = (s, pos) => s.lastIndexOf('\n', pos) + 1;
    const i = idx.indexOf('<!-- BEGIN toc -->');
    const j = idx.indexOf('<!-- END toc -->');
    if (i === -1 || j === -1) { console.log('  !! 章首页缺目录标记: ' + ch.dir); continue; }
    const iLine = lineStart(idx, i);
    const jLine = lineStart(idx, j);
    const indentBegin = idx.slice(iLine, i);
    const indentEnd = idx.slice(jLine, j);
    const toc = [
      indentBegin + '<!-- BEGIN toc -->',
      `  <h3 id="toc-${ch.dir}">本章目录</h3>`,
      '  <div class="proto-index">',
      list,
      '  </div>',
      indentEnd + '<!-- END toc -->',
    ].join(eol);
    const out = idx.slice(0, iLine) + toc + idx.slice(j + '<!-- END toc -->'.length);
    fs.writeFileSync(idxPath, out, 'utf8');
  }

  /* 导航块：P 映射 + NAV（一级 = 章，二级 = 各节页） */
  const pEntries = [
    `    overview: 'vis-reference.html',`,
    `    cards: 'prototypes/cards.html',`,
  ];
  const navLines = [];
  for (const ch of chapters) {
    pEntries.push(`    '${ch.dir}': 'reference/${ch.dir}/index.html',`);
    for (const it of ch.items) {
      const key = it.file.replace(/\.html$/, '');
      pEntries.push(`    '${ch.dir}/${key}': 'reference/${ch.dir}/${it.file}',`);
    }
  }
  for (const ch of chapters) {
    const items = ch.items.map((it) =>
      `        { page: '${ch.dir}/${it.file.replace(/\.html$/, '')}', label: ${JSON.stringify(it.label)} }`
    ).join(',\n');
    navLines.push(`    {
      type: 'group', key: '${ch.dir}', page: '${ch.dir}', label: ${JSON.stringify(CHAPTER_NAV_LABELS[ch.dir] || ch.chapterTitle)}, icon: '${CHAPTER_ICONS[ch.dir] || 'overview'}', keys: ['${ch.dir}'],
      items: [
${items},
      ],
    }`);
  }
  /* 原型页入口排在「总览」之后（而不是 12 个章之后）——
   * 它不是规范的第 13 章（VIS §3.12 生命周期口径），但排在最后就等于「找不到了」。
   * 标签自带「原型」二字，读者一眼知道它不在规范分章里。 */
  const pBlock = `  var P = {
${pEntries.join('\n')}
  };

  var NAV = [
    { type: 'link', page: 'overview', label: '总览', icon: 'overview' },
    { type: 'link', page: 'cards', label: '资产卡片原型', icon: 'prototype' },
${navLines.join(',\n')}
  ];
  `;

  const shell = fs.readFileSync(SHELL, 'utf8');
  const i = shell.indexOf(NAV_BEGIN);
  const j = shell.indexOf(NAV_END);
  if (i === -1 || j === -1) throw new Error('shell.js 里找不到导航块标记');
  const block = `${NAV_BEGIN}\n${pBlock}`;
  const out = shell.slice(0, i) + block + shell.slice(j);
  fs.writeFileSync(SHELL, out, 'utf8');
  console.log(`生成 ${chapters.length} 个章首页 + 导航块（${chapters.reduce((a, c) => a + c.items.length, 0)} 个二级项）`);
}

/* --------------------------------------------------------------------------
 * check
 * -------------------------------------------------------------------------- */
function check() {
  const chapters = scanSections();
  const problems = [];
  const shell = fs.readFileSync(SHELL, 'utf8');

  /* 1. 导航里声明的每个页面都必须存在（按生成的 P 映射解析路径） */
  const pMap = {};
  const pBlock = shell.slice(shell.indexOf('var P = {'), shell.indexOf('};', shell.indexOf('var P = {')));
  for (const m of pBlock.matchAll(/'([^']+)':\s*'([^']+)'|([A-Za-z_][\w]*):\s*'([^']+)'/g)) {
    pMap[m[1] || m[3]] = m[2] || m[4];
  }
  const navPages = [...shell.matchAll(/page: '([^']+)'/g)].map((m) => m[1]);
  for (const p of navPages) {
    const target = pMap[p];
    if (!target) { problems.push('导航项在 P 映射里没有对应路径: ' + p); continue; }
    const abs = path.join(HERE, target);
    if (!fs.existsSync(abs)) problems.push('导航指向不存在的页面: ' + target);
  }

  /* 2. 每个节页都必须在导航里 */
  const navSet = new Set(navPages);
  for (const ch of chapters) {
    for (const it of ch.items) {
      const key = ch.dir + '/' + it.file.replace(/\.html$/, '');
      if (!navSet.has(key)) problems.push(`节页未进导航: ${key}`);
    }
  }

  /* 3. 野生文件：reference/ 下有 .html 但不在导航里 */
  const walk = (dir, base = '') => fs.readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    const r = base + f;
    if (fs.statSync(full).isDirectory()) return walk(full, r + '/');
    return f.endsWith('.html') ? [r] : [];
  });
  for (const r of walk(REF)) {
    const key = r.replace(/\.html$/, '').replace(/\/index$/, '');
    if (!navSet.has(key)) problems.push('野生页面（不在导航里）: reference/' + r);
  }

  /* 4. 章首页与节页目录一致（漂移） */
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'vis-manual-'));
  const shellBak = fs.readFileSync(SHELL, 'utf8');
  const idxBak = new Map();
  try {
    for (const ch of chapters) {
      const p = path.join(REF, ch.dir, 'index.html');
      if (fs.existsSync(p)) idxBak.set(p, fs.readFileSync(p, 'utf8'));
    }
    build();
    const shellNow = fs.readFileSync(SHELL, 'utf8');
    if (shellNow !== shellBak) problems.push('导航块与节页清单不一致 —— 跑 `node artifacts/vis/vis-manual.mjs build`');
    for (const ch of chapters) {
      const idx = path.join(REF, ch.dir, 'index.html');
      if (!fs.existsSync(idx)) { problems.push('缺章首页: ' + ch.dir + '/index.html'); continue; }
      const t = fs.readFileSync(idx, 'utf8');
      /* 章首页也是**生成物**：必须与重新生成的结果逐字节相同。
         旧写法只查「目录里有没有这个 href」，生成物自己漂了也发现不了
         —— 后果是每 build 一次 toc 标记就多 2 格空格，文件一天天变形。 */
      if (idxBak.has(idx) && t !== idxBak.get(idx)) {
        problems.push(`章首页与重新生成的结果不一致（生成物漂移）: ${ch.dir}/index.html —— 跑 \`node artifacts/vis/vis-manual.mjs build\``);
      }
      for (const it of ch.items) {
        if (!t.includes(`href="${it.file}"`)) {
          problems.push(`章首页目录缺项: ${ch.dir}/index.html -> ${it.file}`);
        }
      }
    }
  } finally {
    fs.writeFileSync(SHELL, shellBak, 'utf8');
    for (const [p, t] of idxBak) fs.writeFileSync(p, t, 'utf8');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* 5. 导航标签长度：二级项 <= 6 字 */
  const navLabels = [];
  for (const m of shell.matchAll(/label:\s*(?:'([^']*)'|"([^"]*)")/g)) {
    navLabels.push(m[1] !== undefined ? m[1] : m[2]);
  }
  for (const l of navLabels) {
    if ([...l].length > 6) problems.push(`导航标签超过 6 字（${[...l].length}）: ${l}`);
  }

  /* 6. 原型页入口必须在「总览」之后紧邻 —— 排在 12 个章之后就等于「找不到了」 */
  const navArr = shell.slice(shell.indexOf('var NAV = ['), shell.indexOf('];', shell.indexOf('var NAV = [')));
  const topLevel = [...navArr.matchAll(/type:\s*'link',\s*page:\s*'([^']+)'/g)].map((m) => m[1]);
  if (topLevel.length) {
    if (topLevel[0] !== 'overview') {
      problems.push(`导航第一个一级项应为 overview，实为 ${topLevel[0]}`);
    }
    if (topLevel[1] !== 'cards') {
      problems.push(`原型页入口应紧跟在「总览」之后（topLevel[1]=cards），实为 ${topLevel[1] || '(无)'} —— 排在章之后等于找不到了`);
    }
  }

  console.log('章节 ' + chapters.length + ' / 节页 ' + chapters.reduce((a, c) => a + c.items.length, 0));
  if (!problems.length) { console.log('全部通过'); return 0; }
  console.log('\n问题 ' + problems.length + ' 个：');
  for (const p of problems) console.log('  [FAIL] ' + p);
  return 2;
}

const cmd = process.argv[2];
const revArg = process.argv.find((a) => a.startsWith('--rev='));
if (cmd === 'split') { split(revArg ? revArg.slice(6) : OLD_REV); build(); }
else if (cmd === 'build') { build(); }
else if (cmd === 'check') { process.exit(check()); }
else {
  console.log('用法:');
  console.log('  node artifacts/vis/vis-manual.mjs split   把章页拆成「一节一页」（一次性迁移，可加 --rev=<git rev>）');
  console.log('  node artifacts/vis/vis-manual.mjs build   生成章首页 + 重写导航块');
  console.log('  node artifacts/vis/vis-manual.mjs check   防漂移（只读）');
  process.exit(cmd ? 3 : 0);
}
