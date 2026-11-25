import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * 定制类 VIS 页面冒烟：字体 / 间距 / 层级 / 动效 / 主题 Token。
 *
 * 像素回归要先更新基线才有这五页，这里先做「能不能打开、双主题双宽度有没有报错」的检查：
 *   node e2e/vis-tokens-smoke.mjs
 * 需要先 `cd view && npm run build`。
 */
const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'view/dist/view/browser');
const port = Number(process.env.VIS_PORT || 4416);
const ROUTES = ['/vis/typography', '/vis/spacing', '/vis/elevation', '/vis/motion', '/vis/theme-tokens'];
const WIDTHS = [1440, 3440];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

if (!existsSync(dist)) {
  console.error('先构建 view：cd view && npm run build');
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = join(dist, url);
  if (!existsSync(file) || url.endsWith('/')) file = join(dist, 'index.html');
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
const browser = await chromium.launch();
const failures = [];

for (const width of WIDTHS) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    for (const route of ROUTES) {
      await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded' });
      if (theme === 'dark') {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      }
      await page.waitForTimeout(320);
      const state = await page.evaluate(() => {
        const horizontalOverflow = document.body.scrollWidth - document.documentElement.clientWidth;
        const clipped = [...document.querySelectorAll('.section-body')]
          .filter((el) => el.scrollHeight > el.clientHeight + 2)
          .map((el) => el.querySelector('h2')?.textContent ?? '?');
        return { horizontalOverflow, clipped };
      });
      console.log(
        `${width}/${theme} ${route} overflowX=${state.horizontalOverflow} clipped=${state.clipped.join(',') || 'none'}`,
      );
      if (state.horizontalOverflow > 0 || state.clipped.length) {
        failures.push(`${width}/${theme} ${route}: 横向溢出 ${state.horizontalOverflow} / 裁切 ${state.clipped.join(',')}`);
      }
    }

    if (errors.length) failures.push(`${width}/${theme}: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error('定制类页面冒烟失败：');
  for (const line of failures) console.error('  ' + line);
  process.exit(1);
}
console.log(`定制类页面冒烟通过：${ROUTES.length} 页 × ${WIDTHS.length} 宽度 × 双主题，控制台无错误`);
