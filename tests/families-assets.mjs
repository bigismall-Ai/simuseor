/**
 * 厂牌资产一致性检查。
 *
 * 三条规则：
 *  1. cover.ts 里声明了 logo 的家族，磁盘上必须有对应文件（否则运行时是破图）
 *  2. 磁盘上的 svg 必须能被浏览器解析（XML 合法 + 能渲染出非空图形）
 *  3. 深色主题有反白版的家族，logoDark 指向的文件也必须存在
 *
 * 资产是**逐家确认**过的（各家的品牌规范不同），所以这份检查的价值在于
 * 「新增家族时别忘了放文件」和「别把官方色改掉了」。
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = 'E:/Projects/model-downloader';
const PUB = path.join(ROOT, 'web/public');
const coverSrc = fs.readFileSync(path.join(ROOT, 'web/src/app/core/cover.ts'), 'utf8');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const errors = [];
const log = [];

// 从 cover.ts 里抠出每个家族块的 id / logo / logoDark
const blocks = [...coverSrc.matchAll(/id:\s*'([^']+)'([\s\S]*?)\n  \},/g)];
const families = [];
for (const [, id, body] of blocks) {
  const logo = /logo:\s*'([^']+)'/.exec(body)?.[1] || null;
  const logoDark = /logoDark:\s*'([^']+)'/.exec(body)?.[1] || null;
  families.push({ id, logo, logoDark });
}
log.push(`家族 ${families.length} 个：${families.map((f) => f.id).join(', ')}`);

// 1) 声明了就要有文件
for (const f of families) {
  for (const [k, rel] of [['logo', f.logo], ['logoDark', f.logoDark]]) {
    if (!rel) continue;
    const abs = path.join(PUB, rel);
    if (!fs.existsSync(abs)) errors.push(`[${f.id}] ${k} 指向的文件不存在：${rel}`);
  }
}

// 2) 磁盘上的 svg 都要能渲染
const onDisk = fs.readdirSync(path.join(PUB, 'families'))
  .filter((n) => n.endsWith('.svg') && !n.startsWith('_'));

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 3 });

for (const name of onDisk) {
  const rel = `families/${name}`;
  const abs = path.join(PUB, rel);
  // XML 合法性（允许前导 XML 声明 / 注释 / 空白）
  const src = fs.readFileSync(abs, 'utf8');
  if (!/<svg[\s>]/i.test(src)) {
    errors.push(`[${rel}] 里面找不到 <svg> 元素`);
    continue;
  }
  // 能否渲染出非空图形
  const ink = await p.evaluate(async ({ rel, src }) => {
    const blob = new Blob([src], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => null);
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let painted = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
    URL.revokeObjectURL(url);
    return painted;
  }, { rel, src });
  if (ink === 0) errors.push(`[${rel}] 渲染出来是空的（路径没画上 / viewBox 不对）`);
  else log.push(`[${rel}] 墨水覆盖 ${(ink / 4096 * 100).toFixed(1)}%`);
}
await b.close();

// 3) 反白版必须成对（浅色版有而深色版缺 → 深色主题会拿浅色版，官方黑标压深底）
for (const f of families) {
  if (f.logo && !f.logoDark) {
    const isBlack = /flux|sd15|sdxl/.test(f.id);
    if (isBlack) errors.push(`[${f.id}] 有浅色版但没有深色版（${f.logo}）—— 官方黑标在深色底上认不出`);
    else log.push(`[${f.id}] 无深色版 —— 官方资产本身是彩色/渐变，OK`);
  }
}

// 4) 来源登记完整性
//
// 资产文件本身没有「从哪来」的信息，光看图看不出是官网抓的、Simple Icons 抄的、还是谁手画的。
// 登记表 web/src/app/core/family-sources.json 是唯一的来源凭据 —— 没登记的资产就是野生资产，
// 没人知道它的出处，也就没人能判断它合不合规、该不该更新。
const REG = path.join(ROOT, 'web/src/app/core/family-sources.json');
if (!fs.existsSync(REG)) {
  errors.push('缺少来源登记表 web/src/app/core/family-sources.json');
} else {
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const regFams = new Map(reg.families.map((f) => [f.id, f]));

  // 4a) cover.ts 里的每个家族都要登记来源
  for (const f of families) {
    if (!regFams.has(f.id)) errors.push(`[${f.id}] 未在 web/src/app/core/family-sources.json 登记来源`);
  }
  // 4b) 登记表里的家族必须在 cover.ts 里存在（否则是登记残留）
  for (const id of regFams.keys()) {
    if (!families.find((f) => f.id === id)) errors.push(`[${id}] 登记表里有，但 cover.ts 里没有这个家族`);
  }
  // 4c) 登记的资产必须在磁盘上、且指纹一致
  const registered = new Set();
  for (const [id, f] of regFams) {
    for (const a of f.assets || []) {
      registered.add(a.path);
      const abs = path.join(PUB, a.path);
      // 候选区在 .gitignore 里（web/public/**/_candidates/），新 clone 上本来就没有 →
      // 缺失只记警告，不算失败
      const isCandidate = a.path.includes('/_candidates/');
      if (!fs.existsSync(abs)) {
        const msg = `[${id}] 登记的资产不存在：${a.path}`;
        if (isCandidate) log.push(`⚠ ${msg}（候选区不入库，属正常）`);
        else errors.push(msg);
        continue;
      }
      if (!a.sha256) {
        errors.push(`[${id}] ${a.path} 缺登记指纹 → node scripts/fetch-family-assets.mjs --approve ${id}`);
      } else if (a.sha256 !== sha256(fs.readFileSync(abs))) {
        errors.push(`[${id}] ${a.path} 与登记指纹不符（资产被手改过但没登记）→ node scripts/fetch-family-assets.mjs --approve ${id}`);
      }
    }
  }
  // 4d) 野生资产：磁盘上有、登记表里没有
  for (const name of onDisk) {
    if (!registered.has(`families/${name}`)) errors.push(`[families/${name}] 野生资产 —— 不在 family-sources.json 里登记`);
  }
  const candDir = path.join(PUB, 'families/_candidates');
  if (fs.existsSync(candDir)) {
    for (const name of fs.readdirSync(candDir).filter((n) => n.endsWith('.svg'))) {
      if (!registered.has(`families/_candidates/${name}`)) {
        errors.push(`[_candidates/${name}] 野生候选 —— 不在 family-sources.json 里登记`);
      }
    }
  }
  log.push(`来源登记 ${regFams.size} 个家族，已登记资产 ${registered.size} 份`);
}

// 5) 家族色板齐全
//
// 色板是 CSS 里的 `.f-{id}` 规则（明暗各一套），不在任何一张表里 —— 所以加家族时最容易漏。
// 漏了的后果不是报错，是「有 logo 却没底色」：卡片拿不到家族色，
// 落回默认底，看起来像另一个家族。minimax 当年就漏过一次。
const PLATE_CSS = path.join(ROOT, 'web/src/app/ui/cover-plate.component.ts');
if (!fs.existsSync(PLATE_CSS)) {
  errors.push('缺少 web/src/app/ui/cover-plate.component.ts（家族色板所在）');
} else {
  const css = fs.readFileSync(PLATE_CSS, 'utf8');
  for (const f of families) {
    // 一套色板 = 浅色一条 + 深色一条。深色那条的写法是
    // `:host-context([data-theme='dark']) .f-{id} {`，它同样匹配 `\.f-{id}\s*\{` ——
    // 所以浅色不能单独用「有没有匹配」判断，否则深色规则会把它顶掉。
    // 改成数出现次数：至少两条才算齐。
    const all = (css.match(new RegExp(`\\.f-${f.id}\\s*\\{`, 'g')) || []).length;
    const dark = new RegExp(`\\[data-theme='dark'\\][^{]*\\.f-${f.id}\\s*\\{`).test(css);
    if (!dark) errors.push(`[${f.id}] 缺深色色板 .f-${f.id}`);
    if (all < 2) errors.push(`[${f.id}] 缺浅色色板 .f-${f.id} —— 有 logo 却没底色`);
  }
  log.push(`家族色板 ${families.length} 套（浅色 + 深色）✓`);
}

console.log(log.join('\n'));
if (errors.length) {
  console.log('\n✗ 厂牌资产检查失败：');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('\n✓ 厂牌资产检查通过');
