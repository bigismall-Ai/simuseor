import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * VIS 视觉冒烟：用构建产物起一个静态服务，逐页截图并检查控制台错误。
 *
 * 不是像素级回归（还没有基线图），先拦住「页面白屏 / 组件炸了 / 控制台报错」。
 * 截图落在 tests/artifacts/vis-shots，CI 里作为失败时的现场。
 */
const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'view/dist/view/browser');
const outDir = join(import.meta.dirname, '../artifacts/vis-shots');
const port = Number(process.env.VIS_PORT || 4399);

if (!existsSync(dist)) {
  console.error('先构建 view：cd view && npm run build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

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

const pages = [
  { name: 'overview', path: '/vis/overview' },
  { name: 'registry', path: '/vis/registry' },
  { name: 'cards', path: '/vis/prototypes/components/cards' },
  { name: 'layout', path: '/vis/layout' },
  { name: 'error-states', path: '/vis/prototypes/pages/error-states' },
];

const widths = [1440, 3440];

mkdirSync(outDir, { recursive: true });
await new Promise((ok) => server.listen(port, '127.0.0.1', ok));

const browser = await chromium.launch();
const failures = [];

for (const width of widths) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    for (const target of pages) {
      await page.goto(`http://127.0.0.1:${port}${target.path}`, { waitUntil: 'networkidle' });
      if (theme === 'dark') {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      }
      await page.waitForTimeout(500);
      const file = join(outDir, `${target.name}-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
    }

    if (errors.length) failures.push(`${width}/${theme}: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error('VIS 冒烟失败：');
  for (const line of failures) console.error('  ' + line);
  process.exit(1);
}

console.log(`vis-smoke: ${pages.length} 页 × ${widths.length} 宽度 × 2 主题，控制台无错误。`);
