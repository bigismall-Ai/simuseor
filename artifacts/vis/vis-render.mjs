#!/usr/bin/env node
/* ============================================================================
 * vis-render.mjs —— 手册站「渲染验收」（真实浏览器实跑）
 * ----------------------------------------------------------------------------
 *   node artifacts/vis/vis-render.mjs [--root=<站点根>] [--shots <目录>] [--json <文件>]
 *
 * 【为什么要有】
 *   vis-layout check 核的是**结构与样式契约**（标签配平 / class 能否命中 /
 *   骨架齐全 / 链接可达）—— 它读源码。读源码看不出「浏览器实际把它画成了什么样」。
 *   本脚本用 Chromium 逐页实跑，量**计算样式**（getComputedStyle）：
 *
 *   · 无 JS 错（pageerror / console error / 资源请求失败）
 *   · 无横向溢出（scrollWidth <= innerWidth）
 *   · 关键计算样式正确：
 *       .doc-head h1        22px
 *       section             margin-bottom 56px
 *       section > h3       14px
 *       section > h4       12px
 *       section > p.lead   12.5px
 *   · 左侧导航真的渲染出来了（shell.js 跑通）
 *
 * 【退出码】
 *   0 = 全部通过 / 2 = 有页面不达标 / 3 = 脚本自身出错（浏览器起不来等）
 *
 * 【依赖】
 *   Playwright（仓库内 `tests/node_modules/playwright`）+ Chromium。
 *   浏览器路径可用环境变量 `VIS_CHROME` 覆盖；否则依次尝试
 *   Playwright 自带 Chromium → 本机 ms-playwright 缓存。
 *
 * 【为什么单独一个脚本，不进 vis-check】
 *   vis-check 是**纯静态、零依赖、秒级**的门禁，CI 每次都跑；
 *   本脚本要起浏览器跑 72 页，耗时分钟级 —— 属于「发布前 / 改样式后跑一次」
 *   的重检查，不是每次提交都跑。
 * ============================================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---- Playwright（仓库内；找不到就给出明确提示而不是崩栈） ---- */
let chromium;
try {
  ({ chromium } = await import('../../tests/node_modules/playwright/index.mjs'));
} catch (e) {
  console.error('找不到 Playwright：期望路径 tests/node_modules/playwright');
  console.error('（在仓库根跑 `npm --prefix tests i playwright` 或 `npx playwright install chromium`）');
  console.error(String(e && e.message ? e.message : e));
  process.exit(3);
}

/* ---- 参数 ---- */
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const siteRoot = path.resolve(rootArg ? rootArg.slice(7) : HERE);
const shotsArg = process.argv.indexOf('--shots');
const shotDir = shotsArg > 0 ? path.resolve(process.argv[shotsArg + 1]) : null;
const jsonArg = process.argv.indexOf('--json');
const jsonOut = jsonArg > 0 ? path.resolve(process.argv[jsonArg + 1]) : null;

/* 从仓库根起服务：页面里 ../../../../web/public/... 这类跨目录相对路径要能取到 */
function repoRootOf(dir) {
  let d = dir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(dir, '..', '..');
}
const root = repoRootOf(siteRoot);
const PREFIX = '/' + path.relative(root, siteRoot).replace(/\\/g, '/');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = PREFIX + '/vis-reference.html';
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const abs = path.join(root, p);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;

/* ---- 页面清单：12 章首页 + 58 节页 + 总览 + 原型页 ---- */
const pages = [];
for (const chap of fs.readdirSync(path.join(siteRoot, 'reference'))) {
  const dir = path.join(siteRoot, 'reference', chap);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html')).sort()) {
    pages.push(PREFIX + '/reference/' + chap + '/' + f);
  }
}
pages.push(PREFIX + '/vis-reference.html');
pages.push(PREFIX + '/prototypes/cards.html');

/* ---- 浏览器：VIS_CHROME → Playwright 自带 → 本机 ms-playwright 缓存 ---- */
function chromePath() {
  const cands = [];
  if (process.env.VIS_CHROME) cands.push(process.env.VIS_CHROME);
  try { cands.push(chromium.executablePath()); } catch { /* 没装就跳过 */ }
  cands.push('C:/Users/Moc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe');
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}
const exe = chromePath();
if (!exe) {
  console.error('找不到 Chromium。用环境变量 VIS_CHROME 指向可执行文件，或跑 `npx playwright install chromium`。');
  server.close();
  process.exit(3);
}

let browser;
try {
  browser = await chromium.launch({ executablePath: exe });
} catch (e) {
  console.error('Chromium 起不来：' + String(e && e.message ? e.message : e));
  server.close();
  process.exit(3);
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const results = [];

for (const p of pages) {
  const page = await ctx.newPage();
  const jsErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => consoleErrors.push('请求失败: ' + r.url() + ' (' + (r.failure()?.errorText || '') + ')'));

  let metrics = null;
  let navErr = null;
  try {
    const resp = await page.goto(base + p, { waitUntil: 'load', timeout: 20000 });
    if (!resp || !resp.ok()) navErr = 'HTTP ' + (resp ? resp.status() : '无响应');
    await page.waitForTimeout(120);
    metrics = await page.evaluate(() => {
      const px = (el, prop) => (el ? parseFloat(getComputedStyle(el)[prop]) : null);
      const sec = document.querySelector('section.ref');
      const h4 = document.querySelector('section.ref > h4');
      const lead = document.querySelector('section.ref > p.lead');
      const h3 = document.querySelector('section.ref > h3');
      const h1 = document.querySelector('.doc-head h1');
      const navItems = document.querySelectorAll('.app-nav a, .app-nav .nav-group').length;

      /* 手册站自己的侧栏 —— 必须等于它发布的导航规格（VIS §4.1 / §5 登记）
       * 一级可点项 = 产品 .nav-item；二级节项 = 产品 .nav-sub-item
       * 只量**可见**元素（折叠起来的二级项 rect 高度为 0，量它没有意义），
       * 并把「选中态」与「常态」分开 —— 选中态本来就该是 600 字重。 */
      const visible = (sel) => [...document.querySelectorAll(sel)]
        .find((el) => el.getBoundingClientRect().height > 0) || null;
      const sideBox = (sel) => {
        const el = visible(sel);
        if (!el) return null;
        const c = getComputedStyle(el);
        return {
          h: Math.round(el.getBoundingClientRect().height * 100) / 100,
          pad: c.padding, radius: c.borderRadius,
          fs: c.fontSize, fw: c.fontWeight,
          color: c.color, bg: c.backgroundColor,
        };
      };
      /* 产品导航演示（组件章 §s-311）—— 组标题必须等于产品真实样子 */
      const demoGroup = document.querySelector('.ref .nav-group');
      const demoGroupStyle = demoGroup ? (() => {
        const c = getComputedStyle(demoGroup);
        return { fs: c.fontSize, fw: c.fontWeight, tt: c.textTransform, pad: c.padding, display: c.display };
      })() : null;

      return {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        navItems,
        docH1: px(h1, 'fontSize'),
        secMb: px(sec, 'marginBottom'),
        h4: px(h4, 'fontSize'),
        lead: px(lead, 'fontSize'),
        h3: px(h3, 'fontSize'),
        docHeadCount: document.querySelectorAll('.doc-head').length,
        h1Count: document.querySelectorAll('.doc-head h1').length,
        title: (document.querySelector('.doc-head h1') || {}).textContent || '',
        sideTop: sideBox('.app-nav > a:not(.on)'),
        sideTopOn: sideBox('.app-nav > a.on'),
        sideChapter: sideBox('.app-nav .nav-group .nav-lead:not(.on)'),
        sideSub: sideBox('.app-nav .nav-items a.sub:not(.on)'),
        demoGroup: demoGroupStyle,
      };
    });
  } catch (e) {
    navErr = String(e.message || e);
  }
  if (shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    const name = p.replace(/^\//, '').replace(/\//g, '__').replace(/\.html$/, '') + '.png';
    await page.screenshot({ path: path.join(shotDir, name), fullPage: false }).catch(() => {});
  }
  await page.close();

  const problems = [];
  if (navErr) problems.push('页面打不开: ' + navErr);
  if (jsErrors.length) problems.push('JS 异常 ' + jsErrors.length + ' 条: ' + jsErrors[0]);
  if (consoleErrors.length) problems.push('console/资源错误 ' + consoleErrors.length + ' 条: ' + consoleErrors[0]);
  if (metrics) {
    if (metrics.scrollW > metrics.innerW + 1) {
      problems.push('横向溢出: scrollWidth=' + metrics.scrollW + ' > innerWidth=' + metrics.innerW);
    }
    if (metrics.navItems === 0) problems.push('左侧导航没渲染出来');
    const isProto = p.endsWith('/prototypes/cards.html');
    if (!isProto && metrics.docHeadCount !== 1) problems.push('.doc-head 数量=' + metrics.docHeadCount);
    if (!isProto && metrics.h1Count !== 1) problems.push('.doc-head h1 数量=' + metrics.h1Count);
    if (!isProto && metrics.docH1 !== 22) problems.push('.doc-head h1 font-size=' + metrics.docH1 + '（应 22px）');
    if (!isProto && metrics.secMb !== 56) problems.push('section margin-bottom=' + metrics.secMb + '（应 56px）');
    if (metrics.h4 !== null && metrics.h4 !== 12) problems.push('section > h4 font-size=' + metrics.h4 + '（应 12px）');
    if (metrics.lead !== null && metrics.lead !== 12.5) problems.push('section > p.lead font-size=' + metrics.lead + '（应 12.5px）');
    if (metrics.h3 !== null && metrics.h3 !== 14) problems.push('section > h3 font-size=' + metrics.h3 + '（应 14px）');

    /* ---- 手册站自身合规：侧栏必须等于它发布的导航规格 ----
     * 规范发布 32px / 0 9px / 8px / 13px·500（一级）+ 29px / 0 9px / 8px / 12.5px（二级），
     * 手册站自己的侧栏也必须长这样 —— 不然就是「规范一套、自己一套」。 */
    const SPEC = {
      sideTop: { h: 32, pad: '0px 9px', radius: '8px', fs: '13px', fw: '500' },
      sideChapter: { h: 32, fs: '13px', fw: '500' },
      sideSub: { h: 29, pad: '0px 9px', radius: '8px', fs: '12.5px', fw: '500' },
    };
    for (const [key, label] of [['sideTop', '侧栏一级项'], ['sideChapter', '侧栏章头'], ['sideSub', '侧栏二级项']]) {
      const got = metrics[key];
      if (!got) continue;
      for (const [prop, want] of Object.entries(SPEC[key])) {
        if (got[prop] !== want) {
          problems.push(`${label} ${prop}=${got[prop]}（应 ${want}，手册站必须等于自己发布的导航规格）`);
        }
      }
    }
    /* 选中态口径：--accent-soft 底 + --accent 字 + 600（与产品 .nav-item.active 同源） */
    if (metrics.sideTopOn && metrics.sideTopOn.fw !== '600') {
      problems.push(`侧栏选中项 font-weight=${metrics.sideTopOn.fw}（应 600）`);
    }
    /* 产品导航演示的组标题：必须等于产品真实样子（10px/600/uppercase/无内边距） */
    if (metrics.demoGroup) {
      const d = metrics.demoGroup;
      if (d.fs !== '10px') problems.push('产品导航演示·组标题 font-size=' + d.fs + '（应 10px）');
      if (d.fw !== '600') problems.push('产品导航演示·组标题 font-weight=' + d.fw + '（应 600）');
      if (d.tt !== 'uppercase') problems.push('产品导航演示·组标题 text-transform=' + d.tt + '（应 uppercase）');
      if (d.pad !== '0px') problems.push('产品导航演示·组标题 padding=' + d.pad + '（应 0px —— 被手册站侧栏规则污染了？）');
    }
  }
  results.push({ page: p, problems, metrics });
}

await browser.close();
server.close();

const bad = results.filter((r) => r.problems.length);
console.log('渲染验收: ' + siteRoot);
console.log('  页面 ' + results.length + ' / 有问题 ' + bad.length);
console.log('  JS 错页: ' + results.filter((r) => r.problems.some((x) => x.includes('JS 异常'))).length +
  ' / 横向溢出页: ' + results.filter((r) => r.problems.some((x) => x.includes('横向溢出'))).length +
  ' / 样式不符页: ' + results.filter((r) => r.problems.some((x) => x.includes('font-size') || x.includes('margin-bottom'))).length +
  ' / 导航未渲染页: ' + results.filter((r) => r.problems.some((x) => x.includes('导航'))).length);
for (const r of bad) console.log('  [FAIL] ' + r.page + ' :: ' + r.problems.join(' | '));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2), 'utf8');
process.exit(bad.length ? 2 : 0);
