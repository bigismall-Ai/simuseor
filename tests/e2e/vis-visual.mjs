import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import * as tar from 'tar';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * VIS 全页面像素回归。
 *
 * 基线存放在 GitHub Release 的单个 tar.gz 里，仓库只提交版本指针；
 * 本地没有 token 时退回 tests/e2e/vis-baseline 目录，方便开发时先看图。
 *
 *   node e2e/vis-visual.mjs            比较当前构建
 *   node e2e/vis-visual.mjs --update   重新生成基线并上传（需要 GITHUB_TOKEN）
 */
const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'view/dist/view/browser');
const outDir = join(import.meta.dirname, '../artifacts/vis-shots');
const localBaseline = join(import.meta.dirname, 'vis-baseline');
const baselineMeta = JSON.parse(
  readFileSync(join(import.meta.dirname, 'vis-baseline.json'), 'utf8'),
);
const update = process.argv.includes('--update');
const bootstrap = process.env.VIS_BASELINE_BOOTSTRAP === '1';
const ghRepo = process.env.GITHUB_REPOSITORY || 'bigismall-Ai/simuseor';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const port = Number(process.env.VIS_PORT || 4399);

const pages = [
  ['overview', '/vis/overview'],
  ['brand', '/vis/brand'],
  ['color', '/vis/color'],
  ['cover', '/vis/cover'],
  ['background', '/vis/background'],
  ['layout', '/vis/layout'],
  ['icons', '/vis/icons'],
  ['buttons', '/vis/buttons'],
  ['inputs', '/vis/inputs'],
  ['radius', '/vis/radius'],
  ['pills', '/vis/pills'],
  ['empty', '/vis/empty'],
  ['tables', '/vis/tables'],
  ['registry', '/vis/registry'],
  ['modals', '/vis/modals'],
  ['cards', '/vis/prototypes/components/cards'],
  ['sidebar', '/vis/prototypes/components/sidebar'],
  ['structure', '/vis/prototypes/components/structure'],
  ['scrollbar', '/vis/prototypes/components/scrollbar'],
  ['page-header', '/vis/prototypes/components/page-header'],
  ['notice', '/vis/prototypes/components/notice'],
  ['feedback', '/vis/prototypes/components/feedback'],
  ['families', '/vis/prototypes/components/families'],
  ['models', '/vis/prototypes/pages/models'],
  ['workflows', '/vis/prototypes/pages/workflows'],
  ['nodes', '/vis/prototypes/pages/nodes'],
  ['resource-manager', '/vis/prototypes/pages/resource-manager'],
  ['downloads', '/vis/prototypes/pages/downloads'],
  ['error-states', '/vis/prototypes/pages/error-states'],
  ['settings', '/vis/prototypes/pages/settings'],
  ['source-probe', '/vis/prototypes/pages/source-probe'],
];

const widths = [1440, 3440];
const themes = ['light', 'dark'];

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

async function gh(pathname, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${ghRepo}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function downloadBaseline(dest) {
  if (!token) return false;
  const res = await gh(`/releases/tags/${baselineMeta.tag}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`读取基线 Release 失败：${res.status}`);
  const release = await res.json();
  const asset = release.assets.find((item) => item.name === baselineMeta.asset);
  if (!asset) return false;

  const file = join(tmpdir(), baselineMeta.asset);
  const assetRes = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!assetRes.ok) throw new Error(`下载基线失败：${assetRes.status}`);
  writeFileSync(file, Buffer.from(await assetRes.arrayBuffer()));
  mkdirSync(dest, { recursive: true });
  await tar.x({ file, cwd: dest });
  return true;
}

async function uploadBaseline(archive) {
  if (!token) {
    console.log('没有 GITHUB_TOKEN，基线只写到本地目录。');
    return;
  }
  let res = await gh(`/releases/tags/${baselineMeta.tag}`);
  let release;
  if (res.status === 404) {
    res = await gh('/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag_name: baselineMeta.tag,
        name: baselineMeta.tag,
        body: 'VIS 全页面像素基线（由 CI 生成）',
      }),
    });
    if (!res.ok) throw new Error(`创建 Release 失败：${res.status}`);
  }
  release = await res.json();

  for (const asset of release.assets) {
    if (asset.name === baselineMeta.asset) {
      await gh(`/releases/assets/${asset.id}`, { method: 'DELETE' });
    }
  }

  const body = readFileSync(archive);
  const upload = await fetch(
    `https://uploads.github.com/repos/${ghRepo}/releases/${release.id}/assets?name=${encodeURIComponent(baselineMeta.asset)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/gzip',
      },
      body,
    },
  );
  if (!upload.ok) throw new Error(`上传基线失败：${upload.status} ${await upload.text()}`);
  console.log(`基线已上传：${baselineMeta.tag}/${baselineMeta.asset}`);
}

async function capture(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const browser = await chromium.launch();
  const failures = [];

  for (const width of widths) {
    for (const theme of themes) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));

      for (const [name, route] of pages) {
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded' });
        if (theme === 'dark') {
          await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        }
        await page.addStyleTag({
          content: '*,*::before,*::after{animation:none!important;transition:none!important}',
        });
        await page.waitForTimeout(600);
        const file = join(targetDir, String(width), theme, `${name}.png`);
        mkdirSync(join(targetDir, String(width), theme), { recursive: true });
        await page.screenshot({ path: file, fullPage: true });
      }

      if (errors.length) failures.push(`${width}/${theme}: ${errors.slice(0, 3).join(' | ')}`);
      await page.close();
    }
  }

  await browser.close();
  server.close();
  return failures;
}

function compare(actualDir, expectedDir) {
  const failures = [];
  for (const width of widths) {
    for (const theme of themes) {
      for (const [name] of pages) {
        const expected = join(expectedDir, String(width), theme, `${name}.png`);
        const actual = join(actualDir, String(width), theme, `${name}.png`);
        const label = `${width}/${theme}/${name}`;
        if (!existsSync(expected)) {
          failures.push(`${label}: 基线缺失`);
          continue;
        }
        const a = PNG.sync.read(readFileSync(expected));
        const b = PNG.sync.read(readFileSync(actual));
        if (a.width !== b.width || a.height !== b.height) {
          failures.push(`${label}: 尺寸 ${a.width}×${a.height} → ${b.width}×${b.height}`);
          continue;
        }
        const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
        const ratio = diff / (a.width * a.height);
        if (ratio > 0.0025) failures.push(`${label}: 像素差异 ${(ratio * 100).toFixed(2)}%`);
      }
    }
  }
  return failures;
}

const shots = join(outDir, 'current');
const baselineDir = join(tmpdir(), `vis-baseline-${Date.now()}`);

if (update) {
  console.log('生成基线截图…');
  const failures = await capture(shots);
  if (failures.length) {
    console.error('页面控制台报错，基线未生成：');
    for (const line of failures) console.error('  ' + line);
    process.exit(1);
  }
  const archive = join(tmpdir(), baselineMeta.asset);
  await tar.c({ gzip: true, file: archive, cwd: shots }, ['.']);
  rmSync(localBaseline, { recursive: true, force: true });
  cpSync(shots, localBaseline, { recursive: true });
  await uploadBaseline(archive);
  console.log(`基线已生成：${pages.length} 页 × ${widths.length} 宽度 × ${themes.length} 主题`);
  process.exit(0);
}

console.log('采集当前页面…');
const failures = await capture(shots);
if (failures.length) {
  console.error('页面控制台报错：');
  for (const line of failures) console.error('  ' + line);
  process.exit(1);
}

let hasBaseline = false;
if (token) {
  hasBaseline = await downloadBaseline(baselineDir);
} else if (existsSync(localBaseline)) {
  cpSync(localBaseline, baselineDir, { recursive: true });
  hasBaseline = true;
}

if (!hasBaseline) {
  if (bootstrap) {
    console.log('远端没有基线，按 bootstrap 生成第一版…');
    const archive = join(tmpdir(), baselineMeta.asset);
    await tar.c({ gzip: true, file: archive, cwd: shots }, ['.']);
    rmSync(localBaseline, { recursive: true, force: true });
    cpSync(shots, localBaseline, { recursive: true });
    await uploadBaseline(archive);
    console.log('第一版基线已建立。');
    process.exit(0);
  }
  console.error('没有找到基线。先运行：node e2e/vis-visual.mjs --update');
  process.exit(1);
}

const diffs = compare(shots, baselineDir);
if (diffs.length) {
  console.error(`像素回归失败（${diffs.length} 处）：`);
  for (const line of diffs.slice(0, 40)) console.error('  ' + line);
  console.error('确认是有意改动后运行：cd tests && npm run vis:update');
  process.exit(1);
}

console.log(`vis-visual: ${pages.length} 页 × ${widths.length} 宽度 × ${themes.length} 主题，像素一致。`);
