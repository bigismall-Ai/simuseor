/**
 * 家族表一致性检查。
 *
 * 家族识别必须只有一份逻辑。前端 `core/cover.ts` 的 FAMILIES 是权威，
 * 后端 `family_rules.py` 是它的生成物（scripts/gen-family-rules.mjs）。
 * 这份检查保证：
 *
 *  1. 生成物与源一致 —— 有人改了 cover.ts 却忘了重新生成，当场报错
 *  2. 顺序一致 —— 家族识别是「按顺序取第一个命中」，顺序错了结果就不同
 *  3. 显存系数缺口可见 —— 没有专属系数的家族走默认值，属实报出来，不藏
 *
 * 跑法：node tests/family-table-sync.mjs
 */
import fs from 'fs';
import path from 'path';
import { extractRules, render } from '../scripts/gen-family-rules.mjs';

const ROOT = 'E:/Projects/model-downloader';
const COVER = path.join(ROOT, 'web/src/app/core/cover.ts');
const RULES_PY = path.join(ROOT, 'backend/app/family_rules.py');
const META_PY = path.join(ROOT, 'backend/app/library_meta.py');

const errors = [];
const warns = [];
const log = [];

// 1) 生成物与源一致
const coverSrc = fs.readFileSync(COVER, 'utf8');
const rules = extractRules(coverSrc);
const expected = render(rules);

if (!fs.existsSync(RULES_PY)) {
  errors.push('缺少 backend/app/family_rules.py —— 跑 node scripts/gen-family-rules.mjs');
} else {
  const cur = fs.readFileSync(RULES_PY, 'utf8');
  if (cur !== expected) {
    errors.push('backend/app/family_rules.py 与 cover.ts 不一致 —— 跑 node scripts/gen-family-rules.mjs');
  } else {
    log.push(`家族规则同步 ✓（${rules.length} 条，与 cover.ts 逐字一致）`);
  }
}

// 2) 后端真的用了生成表，而不是还留着手抄的旧表
const metaSrc = fs.readFileSync(META_PY, 'utf8');
if (!/from\s+\.family_rules\s+import\s+FAMILY_RULES/.test(metaSrc)) {
  errors.push('backend/app/library_meta.py 没有 import FAMILY_RULES —— 可能还留着手抄的规则表');
} else if (/rules\s*=\s*\[\s*\(\s*["']/.test(metaSrc)) {
  errors.push('backend/app/library_meta.py 里还有内联的规则表字面量 —— 应删掉，统一走生成表');
} else {
  log.push('后端已改为使用生成表 ✓（无内联旧表）');
}

// 3) 显存系数缺口
const m = /VRAM_FACTOR\s*=\s*\{([\s\S]*?)\}/.exec(metaSrc);
if (!m) {
  errors.push('backend/app/library_meta.py 里找不到 VRAM_FACTOR');
} else {
  const have = new Set([...m[1].matchAll(/["']([a-z0-9_]+)["']\s*:/g)].map((x) => x[1]));
  const missing = rules.map((r) => r.id).filter((id) => !have.has(id));
  if (missing.length) {
    // 系数是经验值不是实测值 —— 没有依据就不编，只把缺口摆出来
    warns.push(`以下家族没有专属显存系数，走默认值 1.6：${missing.join(', ')}`);
  } else {
    log.push('显存系数覆盖完整 ✓');
  }
}

// 4) 家族集合与来源登记表一致（两边都得有，不能只加一边）
const REG = path.join(ROOT, 'web/src/app/core/family-sources.json');
if (fs.existsSync(REG)) {
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const regIds = new Set(reg.families.map((f) => f.id));
  const coverIds = new Set([...coverSrc.matchAll(/id:\s*'([^']+)'/g)].map((x) => x[1]));
  for (const id of coverIds) {
    if (!regIds.has(id)) errors.push(`[${id}] cover.ts 里有，但 family-sources.json 没登记来源`);
  }
  for (const id of regIds) {
    if (!coverIds.has(id)) errors.push(`[${id}] family-sources.json 里有，但 cover.ts 里没有这个家族`);
  }
  log.push(`家族集合与登记表一致 ✓（${coverIds.size} 个）`);
} else {
  errors.push('缺少 web/src/app/core/family-sources.json');
}

console.log(log.join('\n'));
if (warns.length) {
  console.log('');
  warns.forEach((w) => console.log('⚠ ' + w));
}
if (errors.length) {
  console.log('\n✗ 家族表一致性检查失败：');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('\n✓ 家族表一致性检查通过');
