/**
 * 厂标资产归一化 —— 体检（--check）与规整（--apply）。
 *
 * 为什么不用「巡检」那套：
 *   巡检是「抓上游比对」，可 17 个家族里只有 3 个有可自动抓的地址，其余要么是
 *   JS 渲染只能人肉在浏览器里取、要么官方根本没有矢量资产。靠它发现问题，
 *   等于把维护交给运气。厂标属于**我们自己维护的资产**：来源登记一次，之后
 *   规整、校验、换版都由人做，脚本只负责把「不合规」指出来。
 *
 * 归一化只做几何，不动颜色、不动路径：
 *   把 viewBox 统一到 24×24 的画布，内容按长边缩放进 24 并居中，短边留白。
 *   各家官方导出的 viewBox 差异极大（实测 24、31、48×57.14、1101），不统一的话
 *   同一个方槽里字标的实际高度能差一倍，只能靠 logoScale 逐家补偿。
 *
 * 用法：
 *   node scripts/normalize-family-assets.mjs --check
 *   node scripts/normalize-family-assets.mjs --apply
 *   node scripts/normalize-family-assets.mjs --apply --out var/tmp/fam-preview
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'web/public');
const FAMILIES_DIR = path.join(PUB, 'families');
const REGISTRY = path.join(ROOT, 'web/src/app/core/family-sources.json');
const CANVAS = 24;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const outIdx = args.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? path.resolve(ROOT, args[outIdx + 1] || '') : null;
const BACKUP_DIR = path.join(ROOT, 'var/tmp/family-normalize-backup');

const sha256 = (buf) =>
  crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');

// 阻断项：会让运行时报错或让资产来路不明，必须当场修
const problems = [];
// 进度项：还没归一 / 缺深色版，属于「待办」而不是「坏了」，不阻断门禁
const notices = [];
const rows = [];

// ---------- 解析 ----------
function readSvg(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /<svg\b([^>]*)>/i.exec(text);
  if (!m) return null;
  const attrs = {};
  for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
  const vb = (attrs.viewBox || '').trim();
  const nums = vb.split(/[\s,]+/).map(Number);
  const body = text.slice(m.index + m[0].length, text.lastIndexOf('</svg>'));
  return { text, rootTag: m[0], attrs, viewBox: nums.length === 4 ? nums : null, body };
}

function normalized(rootAttrs, viewBox, body) {
  const [minX, minY, w, h] = viewBox;
  if (!(w > 0 && h > 0)) return null;
  const s = CANVAS / Math.max(w, h);
  const tx = (CANVAS - w * s) / 2 - minX * s;
  const ty = (CANVAS - h * s) / 2 - minY * s;
  const keep = Object.entries(rootAttrs)
    .filter(([k]) => !['width', 'height', 'viewBox'].includes(k))
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  // 只加一层 <g>：defs / 渐变 / path 全部原样搬进来，颜色一个字节都不改。
  return `<svg ${keep} viewBox="0 0 ${CANVAS} ${CANVAS}">
  <g transform="translate(${round(tx)} ${round(ty)}) scale(${round(s, 6)})">${body}</g>
</svg>
`;
}

const round = (n, d = 4) => Number(n.toFixed(d));

// ---------- 主流程 ----------
const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const declared = new Map();
for (const fam of registry.families) {
  for (const asset of fam.assets || []) declared.set(path.basename(asset.path), { fam: fam.id, asset });
}

const files = fs
  .readdirSync(FAMILIES_DIR)
  .filter((n) => n.endsWith('.svg') && !n.startsWith('_'));

const pairs = new Map();
for (const name of files) {
  const id = name.replace(/-dark\.svg$/, '').replace(/\.svg$/, '');
  const entry = pairs.get(id) || { id, light: null, dark: null };
  if (name.endsWith('-dark.svg')) entry.dark = name;
  else entry.light = name;
  pairs.set(id, entry);

  // 规则 1：必须在登记表里（否则就是「放了文件但没人知道它从哪来」）
  if (!declared.has(name)) problems.push(`[${name}] 不在登记表 family-sources.json 里`);

  const svg = readSvg(path.join(FAMILIES_DIR, name));
  if (!svg) {
    problems.push(`[${name}] 解析不出 <svg>`);
    continue;
  }
  // 规则 2：必须有 viewBox（固定 width/height 的资产无法自适应方槽）
  if (!svg.viewBox) {
    problems.push(`[${name}] 缺少合法 viewBox`);
    continue;
  }

  const [x, y, w, h] = svg.viewBox;
  const already = Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(w - CANVAS) < 1e-9 && Math.abs(h - CANVAS) < 1e-9;
  const ratio = w / h;
  rows.push({ name, viewBox: svg.viewBox.join(' '), ratio, already });

  // 规则 3：指纹与登记表一致（改了资产但没重新 --approve 就是这里拦）
  const meta = declared.get(name);
  if (meta && meta.asset.sha256) {
    const actual = sha256(fs.readFileSync(path.join(FAMILIES_DIR, name)));
    if (actual !== meta.asset.sha256) {
      problems.push(`[${name}] 指纹与登记表不符（改完资产要重新 --approve）`);
    }
  }

  if (APPLY && !already) {
    const next = normalized(svg.attrs, svg.viewBox, svg.body);
    if (!next) {
      problems.push(`[${name}] viewBox 宽高无效，无法归一`);
      continue;
    }
    const targetDir = OUT_DIR || FAMILIES_DIR;
    if (!OUT_DIR) {
      // 原文件先备份，改坏了能一键还原（备份放 var/tmp，不进版本库）
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(path.join(FAMILIES_DIR, name), path.join(BACKUP_DIR, name));
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, name), next, 'utf8');
  }
}

// 规则 4：明暗配对。缺深色版不算错 —— qwen 是按「不改官方色」拍板删掉反白版的，
// 但必须是有意的：双方都不在登记表里标 noDark 就提示出来，让人确认一次。
for (const { id, light, dark } of pairs.values()) {
  if (light && !dark) {
    const fam = registry.families.find((f) => f.id === id);
    const marked = Boolean((fam?.source || {}).noDark);
    if (!marked) notices.push(`[${id}] 只有浅色版 ${light}；若刻意不要反白版，请在 source.noDark 写明原因`);
  }
  if (dark && !light) problems.push(`[${id}] 只有深色版 ${dark}，缺浅色版`);
}

// ---------- 输出 ----------
const pad = (s, n) => String(s).padEnd(n);
console.log(`厂标资产 ${files.length} 个 / ${pairs.size} 个家族`);
console.log(`${pad('文件', 20)}${pad('viewBox', 22)}${pad('宽高比', 9)}归一`);
for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${pad(r.name, 20)}${pad(r.viewBox, 22)}${pad(r.ratio.toFixed(2), 9)}${r.already ? '✔' : '✗'}`);
}

const pending = rows.filter((r) => !r.already).length;
if (pending) {
  console.log(`\n待办：${pending}/${rows.length} 个资产还没归一到 ${CANVAS}×${CANVAS} 画布。`);
  if (!APPLY) console.log('规整：node scripts/normalize-family-assets.mjs --apply（会改写资产，改完要重新 --approve 指纹）');
}

if (notices.length) {
  console.log(`\n待确认 ${notices.length} 项（不阻断）：`);
  for (const n of notices) console.log(`  · ${n}`);
}

if (problems.length) {
  console.log(`\n✗ 阻断问题 ${problems.length} 项：`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ 没有阻断问题（登记表、指纹、命名、viewBox 均一致）。');
}
