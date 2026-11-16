/**
 * 从 lobehub 的 @lobehub/icons 抓「社区维护的规范化 symbol」进候选区。
 *
 * 为什么要它：
 *   官网有矢量 SVG 的家族，我们直接用官网的（official 档）。
 *   但有一批家族官网**只有字标或只有位图**（krea 只有 "Krea" 文字、
 *   ltx 官网对脚本 403、hunyuan 的字标与本地圆标不是同一份），
 *   我们只能留白。lobehub 维护了这些厂的 24×24 单色 symbol，
 *   能把留白的那部分补上。
 *
 * 为什么它是「community」档而不是「official」档：
 *   lobehub 的 Mono 是 `fill="currentColor"` 的**规范化重绘**，
 *   不是厂商交付的原始矢量。几何可能与官方标有出入。
 *   所以它只能进候选区，由人确认「几何是否忠于官方」后才 --promote。
 *
 * 只做「抓取 → 候选区」，绝不直接写 web/public/。
 * 用法：
 *   node scripts/fetch-lobehub-assets.mjs --list
 *   node scripts/fetch-lobehub-assets.mjs krea ltx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { BRAND_OF, brandOf, grabBrandSvg } from './lib/lobehub.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAND = path.join(ROOT, 'var/tmp/family-candidates');
const REGISTRY = path.join(ROOT, 'web/src/app/core/family-sources.json');

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const rows = [];
  for (const [id, brand] of Object.entries(BRAND_OF)) {
    const fam = reg.families.find((f) => f.id === id);
    const cur = fam?.source?.kind || '-';
    rows.push(`${id.padEnd(10)} lobehub=${brand.padEnd(12)} 我们当前=${cur}`);
  }
  console.log(rows.join('\n'));
  process.exit(0);
}

const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('用法：node scripts/fetch-lobehub-assets.mjs --list | <familyId>...');
  process.exit(1);
}

fs.mkdirSync(CAND, { recursive: true });
let n = 0;
for (const id of targets) {
  const brand = brandOf(id);
  if (!brand) {
    console.error(`✗ ${id} 没有对应的 lobehub 品牌名`);
    continue;
  }
  try {
    const svg = await grabBrandSvg(brand);
    const dest = path.join(CAND, `${id}.svg`);
    fs.writeFileSync(dest, svg);
    n++;
    console.log(`✓ ${id} ← ${brand}（${svg.split('\n').length - 2} 个 path）`);
    console.log(`  → ${path.relative(ROOT, dest)}（候选区，未启用）`);
  } catch (e) {
    console.error(`✗ ${id} ← ${brand}：${e.message}`);
  }
}
console.log(n ? `\n确认几何是否忠于官方后：node scripts/fetch-family-assets.mjs --promote <id>` : '');
