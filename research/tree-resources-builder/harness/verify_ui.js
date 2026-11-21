/* 无网络环境下的报告渲染与交互验证（Playwright，file:// 打开）。 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const report = process.argv[2];
  const shots = process.argv[3];
  const url = 'file:///' + report.replace(/\\/g, '/');
  const result = { url, errors: [], failed_requests: [], external_requests: [], shots: [] };
  const browser = await chromium.launch(
    process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') result.errors.push('console: ' + m.text()); });
  page.on('pageerror', e => result.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => result.failed_requests.push(r.url()));
  page.on('request', r => {
    const u = r.url();
    if (!/^(file|data|blob):/.test(u)) result.external_requests.push(u);
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);

  result.images = await page.evaluate(() => {
    const a = [...document.images];
    return { total: a.length, broken: a.filter(i => !i.complete || i.naturalWidth === 0).length };
  });
  result.sections = await page.evaluate(() =>
    [...document.querySelectorAll('main section')].map(s => ({ id: s.id, height: s.offsetHeight })));
  result.svg_count = await page.evaluate(() => document.querySelectorAll('svg').length);
  result.body_height = await page.evaluate(() => document.body.scrollHeight);

  // 1) 矩阵交互
  await page.click('#matrix tbody tr:nth-child(2) td:nth-child(3)');
  result.matrix_click_info = (await page.textContent('#cellInfo')).slice(0, 120);
  await page.fill('#mFilter', '载具');
  await page.waitForTimeout(250);
  result.filtered_rows = await page.evaluate(() =>
    [...document.querySelectorAll('#matrix tbody tr')].filter(r => r.style.display !== 'none').length);
  await page.fill('#mFilter', '');
  await page.waitForTimeout(200);

  // 2) 主题切换
  await page.click('#themeBtn');
  await page.waitForTimeout(300);
  result.theme_after_click = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn');
  await page.waitForTimeout(300);

  // 3) 章节截图（作为渲染证据）
  const targets = ['summary', 'somax', 'coverage', 'maturity', 'arch', 'tradeoff', 'artifacts', 'shot', 'plan'];
  for (const id of targets) {
    const el = page.locator('#' + id);
    if (await el.count()) {
      const p = path.join(shots, id + '.png');
      await el.screenshot({ path: p });
      result.shots.push(path.basename(p));
    }
  }
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error('VERIFY_FAIL', e); process.exit(1); });
