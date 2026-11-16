#!/usr/bin/env node
/**
 * 厂标资产提交前门禁。
 *
 * 装法：bash scripts/install-hooks.sh
 * 临时跳过：SKIP=1 git commit -m "..."
 *
 * 两道检查，性质不同：
 *
 *  1. 家族表一致性 —— 纯 Node、零依赖、秒级。拦的是「改了 cover.ts 的家族正则，
 *     忘了跑 gen-family-rules.mjs 重新生成」。**必跑**：它没有任何正当的失败理由。
 *
 *  2. 厂牌资产校验 —— 需要 Chromium（要真渲染 SVG 算墨水覆盖率，光验 XML 不够）。
 *     拦的是「手改资产没在登记表登记」「加了家族忘补色板」「塞了野生资产」。
 *     **依赖缺失时跳过而不是失败** —— 开发机没装浏览器不该挡住提交。
 *
 * 刻意不做的事：这里不检查「上游有没有改版」。那要联网，而且换不换是设计判断，
 * 该由人决定（见 scripts/fetch-family-assets.mjs 的 --promote）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (process.env.SKIP === '1') {
  console.log('[门禁] SKIP=1，已跳过');
  process.exit(0);
}

/** 暂存区里是否有涉及厂标资产的文件 —— 没有就别跑重检查。 */
function stagedFiles() {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) return null; // 不是 git 仓库或 git 不可用 → 交给别的检查
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

const TOUCHES_ASSETS = [
  /^web\/public\/families\//,
  /^web\/src\/app\/core\/cover\.ts$/,
  /^web\/src\/app\/core\/family-sources\.json$/,
  /^web\/src\/app\/ui\/cover-plate\.component\.ts$/,
  /^backend\/app\/family_rules\.py$/,
  /^backend\/app\/library_meta\.py$/,
  /^scripts\/(fetch-family-assets|gen-family-rules)\.mjs$/,
  /^tests\/(families-assets|family-table-sync)\.mjs$/,
];

function run(label, script) {
  console.log(`\n[门禁] ${label}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  });
  return r.status === 0;
}

/** Chromium 在不在 —— 不在就跳过资产校验，而不是让提交失败。 */
function chromiumReady() {
  try {
    const pw = path.join(ROOT, 'tests/node_modules/playwright');
    if (!fs.existsSync(pw)) return false;
    const { chromium } = require(path.join(pw, 'index.js'));
    const exe = chromium.executablePath();
    return Boolean(exe) && fs.existsSync(exe);
  } catch {
    return false;
  }
}

const staged = stagedFiles();
const touched = staged ? staged.some((f) => TOUCHES_ASSETS.some((re) => re.test(f))) : true;

let ok = true;

// 1) 家族表一致性 —— 永远跑
if (!run('家族表一致性', 'tests/family-table-sync.mjs')) {
  console.error('\n[门禁] ✗ 家族表与生成物不一致。');
  console.error('       若你改了 web/src/app/core/cover.ts 的家族正则，跑：');
  console.error('         node scripts/gen-family-rules.mjs');
  ok = false;
}

// 2) 厂牌资产校验 —— 只在相关文件变更时跑
if (touched) {
  if (chromiumReady()) {
    if (!run('厂牌资产校验', 'tests/families-assets.mjs')) {
      console.error('\n[门禁] ✗ 厂标资产校验未通过（详见上方输出）。');
      ok = false;
    }
  } else {
    console.log('\n[门禁] 跳过厂牌资产校验：未检测到 Chromium（tests/node_modules/playwright）。');
    console.log('       CI 上会跑这条；本地想跑：cd tests && npm install && npx playwright install chromium');
  }
} else {
  console.log('\n[门禁] 暂存区没有厂标相关改动，跳过资产校验。');
}

if (!ok) {
  console.error('\n[门禁] 提交被拦下。确实要绕过：SKIP=1 git commit -m "..."');
  process.exit(1);
}
console.log('\n[门禁] ✓ 通过');
