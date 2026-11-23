#!/usr/bin/env node
/**
 * 扫描 public/ 下的 SVG 资产，生成 /svg-index.json 供 SVG 工作台使用。
 *
 *   node scripts/svg-index.mjs        （或 npm run svg:index）
 *
 * 只扫描白名单目录，跳过 `_` 开头的目录（草稿/候选），避免把临时产物带进列表。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const GROUPS = [
  { id: 'brand', label: '品牌标识', order: 0 },
  { id: 'families', label: '第三方家族标', order: 1 },
];

const BRAND_ORDER = ['cicada-min', 'cicada-mid', 'cicada-max', 'cicada-black-line', 'cicada-white-line', 'favicon'];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function sortKey(asset) {
  const group = GROUPS.find((g) => g.id === asset.group)?.order ?? 99;
  if (asset.group === 'brand') {
    const i = BRAND_ORDER.indexOf(asset.name.replace(/-dark$/, ''));
    return `${group}-${String(i < 0 ? 99 : i).padStart(2, '0')}-${asset.name}`;
  }
  return `${group}-${asset.name}`;
}

const assets = [];
for (const group of GROUPS) {
  let files = [];
  try {
    files = await walk(path.join(publicDir, group.id));
  } catch {
    continue;
  }
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.svg')) continue;
    const rel = path.relative(publicDir, file).split(path.sep).join('/');
    const buf = await readFile(file);
    const text = buf.toString('utf8');
    const viewBox = /viewBox\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null;
    const name = path.basename(file, '.svg');
    assets.push({
      path: `/${rel}`,
      group: group.id,
      groupLabel: group.label,
      name,
      label: name,
      variant: /-dark$/.test(name) ? 'dark' : /-light$/.test(name) ? 'light' : '',
      bytes: buf.length,
      sha1: createHash('sha1').update(buf).digest('hex').slice(0, 10),
      viewBox,
    });
  }
}

assets.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const index = {
  groups: GROUPS.map(({ id, label }) => ({ id, label })),
  assets,
};

await writeFile(path.join(publicDir, 'svg-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`svg-index.json: ${assets.length} assets, ${assets.reduce((n, a) => n + a.bytes, 0)} bytes`);
