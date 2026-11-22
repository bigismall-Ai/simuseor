/* 临时自检脚本：用 file:// 打开 roadmap.html，检查 JS 错误 / 外链 / 横向溢出 / 截图。 */
let chromium;
for (const p of ['playwright', 'playwright-core',
                 '/Users/moc/.local/lib/node_modules/zcode-app-cli/node_modules/playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* try next */ }
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }
const path = require('path');

(async () => {
  const file = process.argv[2];
  const outdir = process.argv[3];
  const url = 'file:///' + file.replace(/\\/g, '/');
  const result = { url, errors: [], failed_requests: [], external_requests: [], shots: [] };

  const browser = await chromium.launch({
    executablePath: process.env.PW_EXE,
    args: ['--allow-file-access-from-files']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') result.errors.push('console: ' + m.text()); });
  page.on('pageerror', e => result.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => result.failed_requests.push(r.url()));
  page.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) result.external_requests.push(u); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);

  result.images = await page.evaluate(() => {
    const a = [...document.images];
    return { total: a.length, broken: a.filter(i => !i.complete || i.naturalWidth === 0).length };
  });
  result.sections = await page.evaluate(() =>
    [...document.querySelectorAll('main section')].map(s => ({ id: s.id, h: s.offsetHeight })));
  result.nav_targets = await page.evaluate(() =>
    [...document.querySelectorAll('.nav a')].map(a => a.getAttribute('href')));
  result.svg_count = await page.evaluate(() => document.querySelectorAll('svg').length);
  result.body_height = await page.evaluate(() => document.body.scrollHeight);

  // 横向溢出检查（多个视口宽度）
  result.overflow = {};
  for (const w of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(350);
    result.overflow[w] = await page.evaluate(() => {
      const de = document.documentElement;
      const offenders = [];
      document.querySelectorAll('main *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 1) {
          offenders.push({ tag: el.tagName, cls: el.className && String(el.className).slice(0, 40),
                           id: el.id || null, right: Math.round(r.right) });
        }
      });
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
               hasHorizontalScroll: de.scrollWidth > de.clientWidth,
               offenders: offenders.slice(0, 8) };
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // 首屏截图 + 结论页截图 + 全页
  await page.screenshot({ path: path.join(outdir, 'roadmap-first-screen.png') });
  const c = page.locator('#conclusion');
  await c.screenshot({ path: path.join(outdir, 'roadmap-conclusion.png') });
  await page.screenshot({ path: path.join(outdir, 'roadmap-fullpage.png'), fullPage: true });

  // 交互：主题切换 + 资产矩阵筛选（原有交互仍可用？）
  await page.click('#themeBtn'); await page.waitForTimeout(250);
  result.theme_after_click = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn'); await page.waitForTimeout(200);
  const filterBtns = await page.locator('[data-filter]').count();
  result.asset_filter_buttons = filterBtns;
  if (filterBtns > 0) {
    await page.locator('[data-filter]').first().click();
    await page.waitForTimeout(250);
    result.asset_rows_visible = await page.evaluate(() =>
      [...document.querySelectorAll('#assetMatrix tbody tr')].filter(r => r.style.display !== 'none').length);
  }
  // 首屏是否先呈现结论页
  result.first_screen_top = await page.evaluate(() => {
    const s = document.getElementById('conclusion');
    const r = s.getBoundingClientRect();
    return { conclusion_top_px: Math.round(r.top + window.scrollY), conclusion_visible_in_first_viewport: r.top < 900 };
  });

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
