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
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const NAV_BEGIN = '/* BEGIN nav-data */';
const NAV_END = '/* END nav-data */';

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const specVersion = () => {
  const head = fs.readFileSync(path.join(HERE, 'SiMuseor-VIS.md'), 'utf8').split('\n')[0];
  const m = head.match(/v(\d+\.\d+)/);
  return m ? 'v' + m[1] : '(未知版本)';
};

/* --------------------------------------------------------------------------
 * 页面壳：从一个现有页面里抽出 head / tail，供拆页与生成复用
 * -------------------------------------------------------------------------- */
function shellOf(src) {
  const wrapTag = '<div class="wrap">';
  const i = src.indexOf(wrapTag);
  const j = src.lastIndexOf('\n    </div>');
  if (i === -1 || j === -1) throw new Error('页面壳识别失败（缺 wrap 或收尾）');
  return {
    head: src.slice(0, i + wrapTag.length) + '\n',
    tail: src.slice(j),
  };
}

/* --------------------------------------------------------------------------
 * 章页 -> 节页（split）
 * -------------------------------------------------------------------------- */
function split() {
  const version = specVersion();
  const made = [];
  for (const [chap, dir] of Object.entries(CHAPTERS)) {
    const srcPath = path.join(REF, chap + '.html');
    if (!fs.existsSync(srcPath)) continue;
    const src = fs.readFileSync(srcPath, 'utf8');
    const { head, tail } = shellOf(src);
    const body = src.slice(head.length, src.length - tail.length);

    /* 章头（section + h2）留在章首页 */
    const firstH3 = body.indexOf('<h3 id="');
    if (firstH3 === -1) { console.log('  跳过（无 h3）' + chap); continue; }
    const chapterHead = body.slice(0, firstH3);
    const rest = body.slice(firstH3);

    /* 按 h3 切节 */
    const marks = [...rest.matchAll(/<h3 id="([^"]+)"/g)];
    const sections = [];
    for (let i = 0; i < marks.length; i++) {
      const id = marks[i][1];
      const start = marks[i].index;
      const end = i + 1 < marks.length ? marks[i + 1].index : rest.length;
      const chunk = rest.slice(start, end);
      const title = chunk.match(/<h3 id="[^"]+"[^>]*>([\s\S]*?)<\/h3>/)[1]
        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      sections.push({ id, title, chunk: chunk.replace(/\s+$/, '') });
    }

    /* 章标题（供章首页与导航用）—— 去掉 <span class="num"> 的编号前缀 */
    const h2 = chapterHead.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const chapterTitle = h2
      ? h2[1].replace(/<span class="num">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : chap;

    const outDir = path.join(REF, dir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const s of sections) {
      const page = head
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${s.title} · SiMuseor VIS</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="SiMuseor 视觉规范：${s.title}">`)
        .replace(/data-page="[^"]*"/, `data-page="${dir}/${s.id}"`)
        +
        `<div class="doc-head">\n` +
        `  <p class="kicker">SiMuseor · VIS ${version}</p>\n` +
        `  <h1>${s.title}</h1>\n` +
        `  <p class="doc-sub">${chapterTitle} · 本章共 ${sections.length} 节</p>\n` +
        `</div>\n` +
        s.chunk + '\n' + tail;
      fs.writeFileSync(path.join(outDir, s.id + '.html'), page, 'utf8');
      made.push({ chap, dir, id: s.id, title: s.title, chapterTitle });
    }
    console.log(`  ${chap}.html -> ${dir}/  ${sections.length} 节`);
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
      const h1 = t.match(/<h1>([\s\S]*?)<\/h1>/);
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
      ? (fs.readFileSync(idxPath, 'utf8').match(/<h1>([\s\S]*?)<\/h1>/) || [, dir])[1].replace(/\s+/g, ' ').trim()
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
    const list = ch.items.map((it) =>
      `    <a class="proto-index-card" href="${it.file}"><b>${it.label}</b><span>${it.title}</span><em>${ch.dir}/${it.file}</em></a>`
    ).join('\n');
    const toc = `  <!-- BEGIN toc -->\n  <h3 id="toc-${ch.dir}">本章目录</h3>\n  <div class="proto-index">\n${list}\n  </div>\n  <!-- END toc -->`;
    const i = idx.indexOf('<!-- BEGIN toc -->');
    const j = idx.indexOf('<!-- END toc -->');
    if (i === -1 || j === -1) { console.log('  !! 章首页缺目录标记: ' + ch.dir); continue; }
    const out = idx.slice(0, i) + toc + idx.slice(j + '<!-- END toc -->'.length);
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
  navLines.push(`    { type: 'link', page: 'cards', label: '资产卡片', icon: 'prototype' }`);

  const pBlock = `  var P = {
${pEntries.join('\n')}
  };

  var NAV = [
    { type: 'link', page: 'overview', label: '总览', icon: 'overview' },
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
  try {
    build();
    const shellNow = fs.readFileSync(SHELL, 'utf8');
    if (shellNow !== shellBak) problems.push('导航块与节页清单不一致 —— 跑 `node artifacts/vis/vis-manual.mjs build`');
    for (const ch of chapters) {
      const idx = path.join(REF, ch.dir, 'index.html');
      if (!fs.existsSync(idx)) { problems.push('缺章首页: ' + ch.dir + '/index.html'); continue; }
      const t = fs.readFileSync(idx, 'utf8');
      for (const it of ch.items) {
        if (!t.includes(`href="${it.file}"`)) {
          problems.push(`章首页目录缺项: ${ch.dir}/index.html -> ${it.file}`);
        }
      }    }
  } finally {
    fs.writeFileSync(SHELL, shellBak, 'utf8');
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

  console.log('章节 ' + chapters.length + ' / 节页 ' + chapters.reduce((a, c) => a + c.items.length, 0));
  if (!problems.length) { console.log('全部通过'); return 0; }
  console.log('\n问题 ' + problems.length + ' 个：');
  for (const p of problems) console.log('  [FAIL] ' + p);
  return 2;
}

const cmd = process.argv[2];
if (cmd === 'split') { split(); build(); }
else if (cmd === 'build') { build(); }
else if (cmd === 'check') { process.exit(check()); }
else {
  console.log('用法:');
  console.log('  node artifacts/vis/vis-manual.mjs split   把章页拆成「一节一页」（一次性迁移）');
  console.log('  node artifacts/vis/vis-manual.mjs build   生成章首页 + 重写导航块');
  console.log('  node artifacts/vis/vis-manual.mjs check   防漂移（只读）');
  process.exit(cmd ? 3 : 0);
}
