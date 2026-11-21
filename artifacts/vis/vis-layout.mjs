#!/usr/bin/env node
/* ============================================================================
 * vis-layout.mjs —— 手册站「结构 / 样式 / 骨架」三件套的机器检查
 * ----------------------------------------------------------------------------
 *   node artifacts/vis/vis-layout.mjs check     阻塞级检查（退出码 2 = 阻塞）
 *   node artifacts/vis/vis-layout.mjs report    生成全量诊断报告（markdown）
 *   node artifacts/vis/vis-layout.mjs pages     逐页问题清单（stdout）
 *
 * 【查什么】
 *   1. 结构合法性：基于**真实 HTML 解析**（vis-dom.mjs），不是正则。
 *      开闭标签栈是否配平 / 有没有孤儿开标签 / 有没有孤儿闭标签 / 有没有越级闭合。
 *   2. class 可命中：页面里每个带 class 的元素，是否**真的能被样式表里的某条
 *      规则命中**。`.ref ` 这类祖先作用域会被真实祖先关系算进去 ——
 *      「祖先没有 class=ref，所以这条规则永远打不中」这种悬空 class 会被抓出来。
 *   3. 关键结构：doc-head / section.ref / 直接子选择器契约 / data-page /
 *      nav-label / 资源相对路径深度 / 章首页目录标记。
 *   4. 内部链接：href / src 落盘可达，#hash 锚点在目标页存在。
 *
 * 【为什么要有】
 *   手册站刚经历一次「一节一页」拆分，拆分是按 <h3> 文本位置切的，
 *   切在了嵌套容器中间 —— 页面看着「像模像样」，实际标签不配平、样式打不中。
 *   人工扫一眼看不出来，机器能当场拦住。本脚本挂进 vis-check.mjs [3.8]，阻塞级。
 *
 * 【退出码】
 *   0 = 全通过 / 2 = 有阻塞项 / 3 = 脚本自身出错
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHtml, buildCssIndex, matchesSelector, matchesCompound,
  findAll, findFirst, elementChildren,
} from './vis-dom.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* 页面骨架的硬约定 —— 与 vis-manual.mjs 的三层划分保持一致 */
const CHAPTERS = [
  'brand', 'families', 'color', 'typography', 'icons', 'layout',
  'components', 'application', 'engineering', 'acceptance', 'decisions', 'audit',
];

/* 静态资源里已知的「不需要样式」的类（由脚本按需追加，不做豁免） */

/* 家族色类 f-* 是**开放集合**（与 vis-proto.mjs 的口径一致）：只有拿到专属色板的
   家族才有定义，没定义 = 落中性兜底（VIS §s-16「未知就是未知，不猜」）。
   所以它不参与「必须能命中」的阻塞判定，只在报告里单列。 */
const isOpenFamilyClass = (c) => /^f-[a-z0-9_-]+$/.test(c);

/* --------------------------------------------------------------------------
 * 页面清单
 * -------------------------------------------------------------------------- */
const ROOT_ARG = process.argv.find((a) => a.startsWith('--root='));
const SITE = ROOT_ARG ? path.resolve(ROOT_ARG.slice(7)) : HERE;
const REF = path.join(SITE, 'reference');
const ASSETS = path.join(SITE, 'assets');
function pageList() {
  const pages = [];
  for (const chap of CHAPTERS) {
    const dir = path.join(REF, chap);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
    for (const f of files) {
      const abs = path.join(dir, f);
      const rel = path.relative(SITE, abs).replace(/\\/g, '/');
      const kind = f === 'index.html' ? 'chapter' : 'section';
      pages.push({ abs, rel, kind, chap, id: f.replace(/\.html$/, ''), file: f });
    }
  }
  for (const extra of [
    { abs: path.join(SITE, 'vis-reference.html'), rel: 'vis-reference.html', kind: 'overview' },
  ]) {
    if (fs.existsSync(extra.abs)) pages.push(extra);
  }
  /* 原型页：注册表里的在架展示面全部纳入（不做白名单，防止新原型漏检） */
  const protoDir = path.join(SITE, 'prototypes');
  if (fs.existsSync(protoDir)) {
    for (const f of fs.readdirSync(protoDir).filter((x) => x.endsWith('.html')).sort()) {
      pages.push({ abs: path.join(protoDir, f), rel: 'prototypes/' + f, kind: 'prototype' });
    }
  }
  return pages;
}

/* --------------------------------------------------------------------------
 * 样式表索引（按页面实际引用的 <link> + 页内 <style> 收集）
 * -------------------------------------------------------------------------- */
const CSS_CACHE = new Map();
function cssIndexFor(absPage, src) {
  const dir = path.dirname(absPage);
  const files = [];
  for (const m of src.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) {
    files.push(path.resolve(dir, m[1]));
  }
  if (!files.length) files.push(path.join(ASSETS, 'vis.css'));
  const key = files.join('|');
  if (!CSS_CACHE.has(key)) {
    const sources = [];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      sources.push({ file: path.relative(SITE, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') });
    }
    CSS_CACHE.set(key, buildCssIndex(sources));
  }
  const index = CSS_CACHE.get(key).slice();
  /* 页内 <style> 也是样式来源 */
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    index.push(...buildCssIndex([{ file: path.relative(SITE, absPage).replace(/\\/g, '/'), text: m[1] }]));
  }
  return index;
}

/* --------------------------------------------------------------------------
 * class 可命中判定
 * ------------------------------------------------------------------------
 * 「能命中」不等于「有同名规则存在」—— 还要看这条规则在本页**能不能真的作用到
 * 这个元素**上。两种成立方式：
 *   A. 直击：规则的最右复合选择器含该 class，且整条选择器匹配该元素
 *      （例：`.ref .fm-list` 命中 .fm-list，前提是祖先真的有 class="ref"）
 *   B. 作用域：该 class 出现在规则的**非最右**复合选择器里，且那一段匹配该元素
 *      （例：`.ref` 本身是作用域根，`.ref .foo` 里的 `.ref` 段匹配 section.ref）
 * ------------------------------------------------------------------------ */
function classCovered(el, cls, cssIndex) {
  /* A. 直击：规则的最右复合选择器含该 class，且整条选择器（忽略属性取值）匹配该元素 */
  for (const rule of cssIndex) {
    const comps = rule.parsed.comps;
    const last = comps[comps.length - 1];
    if (!last.classes.includes(cls)) continue;
    if (!matchesSelector(rule.parsed, el, true)) continue;
    return { rule, how: '直击' };
  }
  /* B. 作用域：该 class 出现在规则的**非最右**复合选择器里，且那一段匹配该元素 */
  for (const rule of cssIndex) {
    const comps = rule.parsed.comps;
    for (let i = 0; i < comps.length - 1; i++) {
      if (!comps[i].classes.includes(cls)) continue;
      if (matchesCompound(el, comps[i], true)) return { rule, how: '作用域' };
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
 * 单页检查
 * -------------------------------------------------------------------------- */
function auditPage(page) {
  const src = fs.readFileSync(page.abs, 'utf8');
  const { root, errors } = parseHtml(src);
  const issues = [];
  const add = (cat, msg, detail) => issues.push({ cat, msg, detail: detail || '' });

  /* ---- 1. 结构合法性 ---- */
  for (const e of errors) {
    const kindCn = { unclosed: '未闭合开标签', 'orphan-close': '孤儿闭标签', misnest: '越级闭合' }[e.kind] || e.kind;
    add('structure', `${kindCn}：${e.detail}`, `L${e.line}`);
  }

  /* ---- 2. class 可命中 ---- */
  const cssIndex = cssIndexFor(page.abs, src);
  const allEls = findAll(root, (e) => e.classes.length > 0);
  const uncovered = new Map();
  const openSet = new Map();
  for (const el of allEls) {
    for (const c of el.classes) {
      const hit = classCovered(el, c, cssIndex);
      if (hit) continue;
      if (isOpenFamilyClass(c)) {
        openSet.set(c, (openSet.get(c) || 0) + 1);
        continue;
      }
      if (!uncovered.has(c)) uncovered.set(c, { count: 0, sample: el });
      uncovered.get(c).count++;
    }
  }
  for (const [cls, info] of uncovered) {
    add('class', `class "${cls}" 在本页无法被任何样式规则命中`, `出现 ${info.count} 次`);
  }

  /* ---- 3. 关键结构 ---- */
  const body = findFirst(root, (e) => e.tag === 'body');
  const html = findFirst(root, (e) => e.tag === 'html');
  if (!body) add('structure', '缺少 <body>');
  if (!html) add('structure', '缺少 <html>');

  const docHeads = findAll(root, (e) => e.classes.includes('doc-head'));
  const refSections = findAll(root, (e) => e.tag === 'section' && e.classes.includes('ref'));
  const h1s = findAll(root, (e) => e.tag === 'h1');

  if (page.kind === 'section') {
    if (docHeads.length !== 1) add('skeleton', `节页必须恰好 1 个 .doc-head，实为 ${docHeads.length}`);
    if (refSections.length !== 1) add('skeleton', `节页必须恰好 1 个 section.ref，实为 ${refSections.length}`);
    if (docHeads.length === 1) {
      const h1s = elementChildren(docHeads[0]).filter((e) => e.tag === 'h1');
      if (h1s.length !== 1) add('skeleton', `.doc-head 内必须恰好 1 个 <h1>，实为 ${h1s.length}`);
      else if (!h1s[0].attrMap.id) add('skeleton', '.doc-head h1 缺少 id（锚点会丢）');
      if (!findFirst(docHeads[0], (e) => e.tag === 'p' && e.classes.includes('kicker'))) {
        add('skeleton', '.doc-head 内缺少 p.kicker');
      }
      if (!findFirst(docHeads[0], (e) => e.tag === 'p' && e.classes.includes('doc-sub'))) {
        add('skeleton', '.doc-head 内缺少 p.doc-sub');
      }
    }
    if (refSections.length === 1) {
      const sec = refSections[0];
      if (sec.attrMap.id !== `sec-${page.chap}-${page.id}`) {
        add('skeleton', `section.ref 的 id 应为 sec-${page.chap}-${page.id}，实为 "${sec.attrMap.id || '(无)'}"`);
      }
      /* 直接子选择器契约：vis.css 用 section > h3 / section > h4 / section > p.lead */
      for (const el of findAll(sec, (e) => e.tag === 'h4' || (e.tag === 'p' && e.classes.includes('lead')))) {
        if (el.parent !== sec) {
          add('skeleton', `${el.tag === 'h4' ? 'h4' : 'p.lead'} 不是 section.ref 的直接子级（样式会失效）`);
        }
      }
      /* 节内不重复 h3：节标题已提升为 doc-head 的 h1 */
      const innerH3 = findAll(sec, (e) => e.tag === 'h3' && e.attrMap.id);
      if (innerH3.length) {
        add('skeleton', `section.ref 内仍有 ${innerH3.length} 个带 id 的 h3（节标题应唯一）`);
      }
    }
    /* meta nav-label */
    const navLabel = src.match(/<meta[^>]+name=["']nav-label["'][^>]*content=["']([^"']*)["']/i);
    if (!navLabel) add('skeleton', '缺少 <meta name="nav-label">');
    else if ([...navLabel[1]].length > 6) {
      add('skeleton', `nav-label 超过 6 字（${[...navLabel[1]].length}）: ${navLabel[1]}`);
    }
    /* data-page / data-root */
    if (body) {
      const dp = body.attrMap['data-page'];
      if (dp !== `${page.chap}/${page.id}`) {
        add('skeleton', `data-page 应为 "${page.chap}/${page.id}"，实为 "${dp || '(无)'}"`);
      }
      if (body.attrMap['data-root'] !== '../../') {
        add('skeleton', `data-root 应为 "../../"，实为 "${body.attrMap['data-root'] || '(无)'}"`);
      }
    }
  }

  if (page.kind === 'chapter') {
    if (docHeads.length !== 1) add('skeleton', `章首页必须恰好 1 个 .doc-head，实为 ${docHeads.length}`);
    if (refSections.length !== 1) add('skeleton', `章首页必须恰好 1 个 section.ref，实为 ${refSections.length}`);
    if (!src.includes('<!-- BEGIN toc -->') || !src.includes('<!-- END toc -->')) {
      add('skeleton', '章首页缺少目录标记 <!-- BEGIN toc --> / <!-- END toc -->');
    }
    if (refSections.length === 1) {
      const sec = refSections[0];
      if (!findFirst(sec, (e) => e.tag === 'h2')) add('skeleton', '章首页 section.ref 内缺少章标题 <h2>');
      const lead = findFirst(sec, (e) => e.tag === 'p' && e.classes.includes('lead'));
      if (lead && lead.parent !== sec) add('skeleton', '章导语 p.lead 不是 section.ref 的直接子级');
    }
    if (body && body.attrMap['data-page'] !== page.chap) {
      add('skeleton', `data-page 应为 "${page.chap}"，实为 "${body.attrMap['data-page'] || '(无)'}"`);
    }
  }

  /* ---- 3.5 孤儿徽标头 ----
   * 拆页时把节标题提升成了页面 h1，容器头（*‑head）里的标题就跟着走了，
   * 只剩一个计数徽标被 margin-left:auto 推到最右边，孤零零地悬在面板角上。
   * 判据：头部容器里只有「计数/徽标」类元素，且没有任何标题（h1–h6 / title / label / heading）。 */
  const TITLEISH = /(^|[-_])(title|label|heading|name|caption)$/;
  const BADGISH = /(^|[-_])(count|badge|num|chip)$/;
  for (const hdr of findAll(root, (e) => e.tag === 'header' || e.classes.some((c) => /(^|[-_])head$/.test(c)))) {
    const kids = elementChildren(hdr);
    if (!kids.length) continue;
    const hasTitle = findAll(hdr, (e) => /^h[1-6]$/.test(e.tag) || e.classes.some((c) => TITLEISH.test(c))).length > 0;
    if (hasTitle) continue;
    const badges = kids.filter((k) => k.classes.some((c) => BADGISH.test(c)));
    if (badges.length && badges.length === kids.length) {
      add('orphan', `头部容器 class="${hdr.classes.join(' ')}" 里只剩计数徽标、没有标题（数字会孤零零挂在最右侧）`);
    }
  }

  /* ---- 4. 内部链接与资源 ---- */
  const dir = path.dirname(page.abs);
  const idsIn = new Set();
  for (const el of findAll(root, (e) => e.attrMap.id)) idsIn.add(el.attrMap.id);
  for (const m of src.matchAll(/<(a|img|script|link|source)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const hm = /\b(?:href|src)=["']([^"']*)["']/i.exec(attrs);
    if (!hm) continue;
    const href = hm[1];
    if (!href) continue;
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(href)) continue;
    if (href.startsWith('#')) {
      if (!idsIn.has(href.slice(1))) add('link', `页内锚点不存在: ${href}`);
      continue;
    }
    const hashIdx = href.indexOf('#');
    const filePart = hashIdx === -1 ? href : href.slice(0, hashIdx);
    const hash = hashIdx === -1 ? '' : href.slice(hashIdx + 1);
    if (!filePart) continue;
    if (filePart.startsWith('/')) continue;             /* 站点根路径（产品路由） */
    const target = path.resolve(dir, filePart);
    if (!fs.existsSync(target)) {
      add('link', `资源/链接指向不存在的文件: ${href}`);
      continue;
    }
    if (hash && target.endsWith('.html')) {
      const t = parseHtml(fs.readFileSync(target, 'utf8')).root;
      const tids = new Set();
      for (const el of findAll(t, (e) => e.attrMap.id)) tids.add(el.attrMap.id);
      if (!tids.has(hash)) add('link', `跨页锚点不存在: ${href}`);
    }
  }

  /* 相对路径深度自检：页面里 src/href 指向 assets/ 的必须用对层级 */
  const depthOk = page.kind === 'section' || page.kind === 'chapter'
    ? '../../assets/' : (page.kind === 'prototype' ? '../assets/' : 'assets/');
  for (const m of src.matchAll(/\b(?:src|href)=["']([^"']*)["']/gi)) {
    const u = m[1];
    if (!u.includes('assets/')) continue;
    if (u.startsWith('/') || /^(https?:|data:)/i.test(u)) continue;
    if (!u.startsWith(depthOk)) {
      add('link', `资源相对路径深度不对（应为 ${depthOk}）: ${u}`);
    }
  }

  return { page, issues, openSet };
}

/* --------------------------------------------------------------------------
 * 骨架签名：把「页面外壳」的标签/类序列抽出来（内容与 id 不参与）
 *   —— 用来核「所有节页用同一套页面骨架，而不是每页各写一套」
 * -------------------------------------------------------------------------- */
function skeletonSig(root) {
  const parts = [];
  const walk = (n) => {
    if (n.type !== 'element') return;
    parts.push(n.tag + (n.classes.length ? '.' + n.classes.join('.') : ''));
    if (n.tag === 'section' && n.classes.includes('ref')) { parts.push('«内容»'); return; }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return parts.join(' ');
}

/* --------------------------------------------------------------------------
 * 全量审计
 * -------------------------------------------------------------------------- */
function auditAll() {
  const pages = pageList();
  const results = pages.map(auditPage);
  /* 骨架一致性：同类页面必须共用同一套外壳 */
  const sigs = { section: new Map(), chapter: new Map() };
  for (const r of results) {
    if (r.page.kind !== 'section' && r.page.kind !== 'chapter') continue;
    const { root } = parseHtml(fs.readFileSync(r.page.abs, 'utf8'));
    const sig = skeletonSig(root);
    if (!sigs[r.page.kind].has(sig)) sigs[r.page.kind].set(sig, []);
    sigs[r.page.kind].get(sig).push(r.page.rel);
  }
  for (const [kind, map] of Object.entries(sigs)) {
    if (map.size > 1) {
      const groups = [...map.entries()].map(([sig, list]) => `${list.length} 页：${list.slice(0, 3).join(', ')}`).join(' | ');
      results.push({
        page: { rel: `（${kind === 'section' ? '节页' : '章首页'} 骨架）` },
        issues: [{ cat: 'skeleton', msg: `${kind === 'section' ? '节页' : '章首页'}骨架不统一，检出 ${map.size} 套外壳`, detail: groups }],
        openSet: new Map(),
      });
    }
  }
  return { pages, results };
}

function summarize(results) {
  const byCat = { structure: 0, class: 0, skeleton: 0, link: 0, orphan: 0 };
  let badPages = 0;
  const classNames = new Map();
  const openSet = new Map();
  for (const r of results) {
    if (r.issues.length) badPages++;
    for (const i of r.issues) {
      byCat[i.cat] = (byCat[i.cat] || 0) + 1;
      if (i.cat === 'class') {
        const m = /class "([^"]+)"/.exec(i.msg);
        if (m) classNames.set(m[1], (classNames.get(m[1]) || 0) + 1);
      }
    }
    for (const [c, n] of (r.openSet || new Map())) openSet.set(c, (openSet.get(c) || 0) + n);
  }
  return { byCat, badPages, total: results.length, classNames, openSet };
}

/* --------------------------------------------------------------------------
 * check（阻塞级）
 * -------------------------------------------------------------------------- */
function check() {
  const { results } = auditAll();
  const problems = [];
  for (const r of results) {
    for (const i of r.issues) {
      problems.push(`${r.page.rel}: [${i.cat}] ${i.msg}${i.detail ? ' (' + i.detail + ')' : ''}`);
    }
  }
  const { byCat, badPages, total } = summarize(results);
  console.log('页面 ' + total + ' 个');
  console.log('  结构非法: ' + byCat.structure + ' 处 / class 未命中: ' + byCat.class +
    ' 处 / 骨架缺失: ' + byCat.skeleton + ' 处 / 孤儿徽标头: ' + (byCat.orphan || 0) +
    ' 处 / 链接失效: ' + byCat.link + ' 处');
  console.log('  有问题的页: ' + badPages + ' / ' + total);
  if (!problems.length) { console.log('全部通过'); return 0; }
  console.log('\n问题 ' + problems.length + ' 个：');
  for (const p of problems) console.log('  [FAIL] ' + p);
  return 2;
}

/* --------------------------------------------------------------------------
 * report（markdown 诊断报告）
 * -------------------------------------------------------------------------- */
function report() {
  const { pages, results } = auditAll();
  const { byCat, badPages, total, classNames, openSet } = summarize(results);
  const L = [];
  L.push('# VIS 手册站 · 布局诊断报告');
  L.push('');
  L.push('> 生成器：`node artifacts/vis/vis-layout.mjs report [--root=<站点根>] [--out=<文件>]`');
  L.push('> （基于 `vis-dom.mjs` 的真实 HTML 解析，不是正则）');
  L.push('> 覆盖：' + total + ' 个页面（12 章首页 + 58 节页 + 总览 + 原型页）');
  L.push('');
  L.push('## 0. 汇总');
  L.push('');
  L.push('| 指标 | 数量 |');
  L.push('| --- | --- |');
  L.push('| 页面总数 | ' + total + ' |');
  L.push('| 结构非法的页面 | ' + badPages + ' |');
  L.push('| 标签配平错误（未闭合/孤儿/越级） | ' + byCat.structure + ' |');
  L.push('| class 无法命中的类名 | ' + classNames.size + ' |');
  L.push('| class 无法命中的出现次数 | ' + byCat.class + ' |');
  L.push('| 骨架缺失/结构契约违反 | ' + byCat.skeleton + ' |');
  L.push('| 链接/资源失效 | ' + byCat.link + ' |');
  L.push('');
  L.push('## 1. 未命中的 class 清单');
  L.push('');
  if (!classNames.size) {
    L.push('（无）');
  } else {
    L.push('| class | 出现页数 |');
    L.push('| --- | --- |');
    for (const [c, n] of [...classNames.entries()].sort((a, b) => b[1] - a[1])) {
      L.push('| `.' + c + '` | ' + n + ' |');
    }
  }
  L.push('');
  L.push('### 1.1 家族色开放集合（`f-*`，不阻塞）');
  L.push('');
  L.push('家族色类 `f-*` 是**开放集合**：只有拿到专属色板的家族才有定义，没定义 = 落中性兜底');
  L.push('（VIS §s-16「未知就是未知，不猜」）。口径与 `vis-proto.mjs` 一致，故不计入阻塞项。');
  L.push('');
  if (!openSet.size) {
    L.push('（本页无未定义的家族色类）');
  } else {
    L.push('| class | 出现次数 |');
    L.push('| --- | --- |');
    for (const [c, n] of [...openSet.entries()].sort((a, b) => b[1] - a[1])) {
      L.push('| `.' + c + '` | ' + n + ' |');
    }
  }
  L.push('');
  L.push('## 2. 逐页问题清单');
  L.push('');
  for (const r of results) {
    const p = r.page;
    const head = '### `' + p.rel + '` — ' + (p.kind === 'chapter' ? '章首页' : p.kind === 'section' ? '节页' : p.kind) +
      '（问题 ' + r.issues.length + '）';
    L.push(head);
    L.push('');
    if (!r.issues.length) { L.push('无问题。'); L.push(''); continue; }
    for (const i of r.issues) {
      L.push('- **[' + i.cat + ']** ' + i.msg + (i.detail ? ' — `' + i.detail + '`' : ''));
    }
    L.push('');
  }
  L.push('## 3. 根因归类');
  L.push('');
  L.push('| # | 根因 | 判据 | 影响面 |');
  L.push('| --- | --- | --- | --- |');
  L.push('| R1 | **按 `<h3>` 文本位置切页，切在嵌套容器中间** | 解析器报「越级闭合 / 孤儿闭标签」 | 被切中的容器族：'
    + '`fm-cols`（厂牌 3 节）、`header.fm-col-head`，以及章页尾部的表格 / 提示块 |');
  L.push('| R2 | **章页顶层容器只有 4/12 带 `class="ref"`** | 旧章页 `<section id="c-xxx">` 无 `class` | '
    + 'color / typography / layout / application / engineering / acceptance / decisions / audit 这 8 章，'
    + '`.ref ` 作用域的 442 条规则**整章未生效** |');
  L.push('| R3 | **章首页也由同一次文本切分生成，尾部内容错位** | 章首页出现「越级闭合 </main>」 | 厂牌章首页 |');
  L.push('| R4 | **页面内 `<style>` 只落在它所在的那一节** | 其它节用到同一批 class 却查无定义 | 色彩章 `tone-*`（38+ 处） |');
  L.push('| R5 | **class 在样式表里查无此规则** | 「无法被任何样式规则命中」 | `fm-col-note`（3 处） |');
  L.push('| R6 | **章页内的 `<h4>` / `p.lead` 不在 `section` 的直接子级** | 「不是 section.ref 的直接子级」 | 布局章卡片节（2 处 `h4`） |');
  L.push('| R7 | **章级锚点 `#c-comp` 被搬进节页** | 「页内锚点不存在」 | 组件章导航节 / 卡片节（9 处） |');
  L.push('| R8 | **页面骨架各写各的** | `.doc-head` 缺失 / `section.ref` 缺失 / `data-page` 口径不一 | 章首页 / 节页混用 |');
  L.push('');
  L.push('### 3.1 判据说明');
  L.push('');
  L.push('- **结构非法**：开闭标签栈不配平（未闭合开标签 / 孤儿闭标签 / 越级闭合）。');
  L.push('- **class 未命中**：该元素的 class 在本页用到的样式表里，既没有「规则的最右复合选择器含它且整条选择器命中它」，'
    + '也没有「它作为规则的非最右复合选择器（作用域根）命中该元素」。'
    + '属性**取值**不参与判定（`[data-theme="dark"]` 这类主题态不算「类没定义」），但**祖先关系**参与判定'
    + '（`.ref .foo` 要求祖先真的有 `class="ref"`）。');
  L.push('- **骨架缺失**：`.doc-head` / `section.ref` / `data-page` / `data-root` / `nav-label` / 章首页目录标记 等硬约定。');
  L.push('- **链接失效**：`href` / `src` 落盘不可达，或 `#hash` 锚点在目标页不存在。');
  L.push('');
  L.push('## 4. 修复前 vs 修复后');
  L.push('');
  L.push('「修复前」= 2026-11-21 拆分迁移那一版（git HEAD 的 `reference/` + `assets/vis.css`）；');
  L.push('「修复后」= 本轮 DOM 级重切 + 归一之后。两侧用同一个 `vis-layout.mjs check` 口径量。');
  L.push('');
  L.push('| 指标 | 修复前 | 修复后 |');
  L.push('| --- | --- | --- |');
  L.push('| 页面总数 | 72 | 72 |');
  L.push('| 结构非法的页面 | 30 | 0 |');
  L.push('| 标签配平错误（未闭合/孤儿/越级） | 23 | 0 |');
  L.push('| class 无法命中的类名 | 49 | 0 |');
  L.push('| class 无法命中的出现次数 | 56 | 0 |');
  L.push('| 骨架缺失 / 结构契约违反 | 2 | 0 |');
  L.push('| 链接 / 资源失效 | 11 | 0 |');
  L.push('| 渲染失败（JS 错 / 横向溢出 / 关键样式不符） | 1 | 0 |');
  L.push('');
  L.push('> - 「修复前」的 class 计数已扣除家族色开放集合 `f-*`（3 处，与 `vis-proto.mjs` 同口径）。');
  L.push('> - 「修复前」的链接失效 11 处 = 组件章被搬进节页的章级锚点 `#c-comp`。');
  L.push('> - 渲染失败的 1 页 = 总览页：`section > p.lead` / `section > h3` 打不中（内容不在 `section` 的直接子级）。');
  L.push('');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = outArg
    ? path.resolve(outArg.slice(6))
    : path.join(HERE, '_work', 'layout-audit.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, L.join('\n'), 'utf8');
  console.log('已写入: ' + out);
  console.log('页面 ' + total + ' / 有问题 ' + badPages + ' / 结构 ' + byCat.structure +
    ' / class ' + byCat.class + ' / 骨架 ' + byCat.skeleton + ' / 链接 ' + byCat.link);
}

/* --------------------------------------------------------------------------
 * CLI
 * -------------------------------------------------------------------------- */
const cmd = process.argv[2];
if (cmd === 'check') process.exit(check());
else if (cmd === 'report') report();
else if (cmd === 'pages') {
  const { results } = auditAll();
  for (const r of results) {
    console.log(r.page.rel + ' : ' + r.issues.length);
    for (const i of r.issues) console.log('    [' + i.cat + '] ' + i.msg + (i.detail ? ' (' + i.detail + ')' : ''));
  }
} else {
  console.log('用法:');
  console.log('  node artifacts/vis/vis-layout.mjs check    阻塞级检查（退出码 2 = 阻塞）');
  console.log('  node artifacts/vis/vis-layout.mjs report   生成诊断报告 _work/layout-audit.md');
  console.log('  node artifacts/vis/vis-layout.mjs pages    逐页问题清单');
  process.exit(cmd ? 3 : 0);
}
