/* ============================================================================
 * VIS 资产守门员验证脚本
 * ----------------------------------------------------------------------------
 * 用 @playwright/test 的 expect 做最小断言：
 *   1. 工具能跑通（report 不崩溃、退出码 0 / 1 / 2）
 *   2. assert 对已知资产返回 0 / 1 / 2
 *   2b. 棘轮语义：等于基线 -> 1（仅提示），超基线 -> 2（阻塞），无违规 -> 0
 *   3. normalize 幂等（连续两次输出完全相同；且对已规范化输出再规范化仍相同）
 *   4. normalize（不带 --write）后原始文件未被修改
 *   5. normalize --write 在临时副本上可规范化、且 .bak 能原样还原
 *   6. 指纹台账写入 artifacts/vis/asset-ledger.json
 *
 * 只读承诺：本脚本【不会】改动 artifacts/vis/assets/ 下的任何真实资产。
 * --write 的往返验证全部在系统临时目录的副本上做。
 *
 * 用法：node tests/vis-asset-guard.mjs
 * 退出码：0=全通过 / 1=有断言失败
 * ============================================================================ */

import { expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ratchetEvaluate, ratchetExitCode, SPEC } from '../artifacts/vis/vis-asset-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOL = path.join(ROOT, 'artifacts', 'vis', 'vis-asset-guard.mjs');
const SVG_DIR = path.join(ROOT, 'artifacts', 'vis', 'assets', 'cicada', 'svg');
const LEDGER = path.join(ROOT, 'artifacts', 'vis', 'asset-ledger.json');
const SAMPLE = path.join(SVG_DIR, 'cicada-max.svg');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function run(args) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

/* ---- 迷你断言框架（用 @playwright/test 的 expect） ------------------------ */
let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log('  [PASS] ' + name);
    passed++;
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).split('\n')[0];
    console.log('  [FAIL] ' + name);
    console.log('         ' + msg);
    failed++;
    failures.push({ name, msg });
  }
}

/** 工具退出码语义：0=通过 / 1=等于棘轮基线仅提示 / 2=超棘轮基线 / 3=脚本自身出错 */
const OK_CODES = [0, 1, 2];

console.log('='.repeat(88));
console.log(' VIS 资产守门员验证  (tests/vis-asset-guard.mjs)');
console.log(' 工具: ' + path.relative(ROOT, TOOL).replace(/\\/g, '/'));
console.log('='.repeat(88));

/* ---- 前置：工具与样本资产存在 ------------------------------------------- */
check('工具文件存在', () => {
  expect(fs.existsSync(TOOL)).toBe(true);
});
check('样本资产存在', () => {
  expect(fs.existsSync(SAMPLE)).toBe(true);
});

if (!fs.existsSync(TOOL) || !fs.existsSync(SAMPLE)) {
  console.log('\n前置条件不满足，终止。');
  process.exit(1);
}

/* ---- 记录真实资产指纹（验证全程未被改动） ------------------------------- */
function snapshotAssets() {
  const map = new Map();
  if (!fs.existsSync(SVG_DIR)) return map;
  for (const name of fs.readdirSync(SVG_DIR)) {
    if (!name.toLowerCase().endsWith('.svg')) continue;
    const p = path.join(SVG_DIR, name);
    if (!fs.statSync(p).isFile()) continue;
    map.set(name, sha256(fs.readFileSync(p)));
  }
  return map;
}
const assetsBefore = snapshotAssets();

/* ==========================================================================
 * 1. 工具能跑通
 * ========================================================================== */
let reportRun = null;
check('report 子命令跑通（退出码 0 / 1 / 2，不崩溃）', () => {
  const r = run(['report']);
  reportRun = r;
  expect(r.status).not.toBe(3);
  expect(OK_CODES).toContain(r.status);
  expect(r.stdout).toContain('# VIS 资产守门员报告');
});

check('report 输出含资产明细表与违规/跳过分节', () => {
  expect(reportRun.stdout).toContain('## 资产明细');
  expect(reportRun.stdout).toContain('## 违规项');
  expect(reportRun.stdout).toContain('## 跳过项');
});

check('report 覆盖到 cicada-max.svg', () => {
  expect(reportRun.stdout).toContain('cicada-max.svg');
});

/* ==========================================================================
 * 2. assert 对已知资产返回 0 或 2
 * ========================================================================== */
check('assert 子命令跑通（退出码 0 / 1 / 2）', () => {
  const r = run(['assert']);
  expect(r.status).not.toBe(3);
  expect(OK_CODES).toContain(r.status);
  expect(r.stdout).toContain('资产规格断言');
});

check('assert 对单个已知资产返回 0 / 1 / 2', () => {
  const r = run(['assert', '--file', path.relative(ROOT, SAMPLE)]);
  expect(r.status).not.toBe(3);
  expect(OK_CODES).toContain(r.status);
  expect(r.stdout).toContain('cicada-max.svg');
});

/* ==========================================================================
 * 2b. 棘轮（RATCHET）—— 与 vis-check.mjs 同一套语义
 * ========================================================================== */
check('棘轮基线已登记 A5 三条（深浅两版同内容）', () => {
  const keys = Object.keys(SPEC.ratchet || {});
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((k) => k.startsWith('A5|')).length).toBe(3);
});

check('等于基线时退出码 = 1（仅提示，不阻塞）', () => {
  const vs = Object.keys(SPEC.ratchet).map((k) => {
    const [id, asset] = k.split('|');
    return { id, asset };
  });
  expect(ratchetExitCode(vs)).toBe(1);
});

check('超基线时退出码 = 2（阻塞）', () => {
  const vs = Object.keys(SPEC.ratchet).map((k) => {
    const [id, asset] = k.split('|');
    return { id, asset };
  });
  /* 同一 key 多一条 -> 超基线 */
  vs.push({ id: 'A5', asset: Object.keys(SPEC.ratchet)[0].split('|')[1] });
  expect(ratchetExitCode(vs)).toBe(2);
});

check('无违规时退出码 = 0', () => {
  expect(ratchetExitCode([])).toBe(0);
});

check('棘轮可区分「超基线」与「可收紧」', () => {
  const r = ratchetEvaluate([{ id: 'A5', asset: 'x.svg' }]);
  expect(r.over.length).toBe(1);
  expect(r.under.length).toBe(Object.keys(SPEC.ratchet).length);
});

check('report 输出含棘轮口径与基线统计', () => {
  expect(reportRun.stdout).toContain('棘轮');
  expect(reportRun.stdout).toContain('基线');
});

check('品牌标记对比度按 WCAG 1.4.11 豁免为 INFO（不阻塞）', () => {
  expect(reportRun.stdout).toContain('品牌标记对比度豁免');
});

/* ==========================================================================
 * 3. normalize 幂等 + 原始文件未被修改
 * ========================================================================== */
const relSample = path.relative(ROOT, SAMPLE).replace(/\\/g, '/');
const sampleBefore = sha256(fs.readFileSync(SAMPLE));

let norm1 = '';
let norm2 = '';
check('normalize 连续两次输出完全相同（幂等）', () => {
  const r1 = run(['normalize', '--file', relSample]);
  expect(r1.status).toBe(0);
  norm1 = r1.stdout;
  const r2 = run(['normalize', '--file', relSample]);
  expect(r2.status).toBe(0);
  norm2 = r2.stdout;
  expect(norm1.length).toBeGreaterThan(100);
  expect(norm2).toBe(norm1);
});

check('normalize 输出是合法 SVG（保留 viewBox / xmlns / id）', () => {
  expect(norm1).toContain('viewBox="0 0 1384.67 643.45"');
  expect(norm1).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(norm1).toContain('id="_图层_2"');
});

check('normalize 不断行语义：元素/属性数量不变', () => {
  const src = fs.readFileSync(SAMPLE, 'utf8');
  const count = (t, re) => (t.match(re) || []).length;
  expect(count(norm1, /<path\b/g)).toBe(count(src, /<path\b/g));
  expect(count(norm1, /<polygon\b/g)).toBe(count(src, /<polygon\b/g));
  expect(count(norm1, /class="cls-/g)).toBe(count(src, /class="cls-/g));
});

check('normalize 后原始文件未被修改', () => {
  expect(sha256(fs.readFileSync(SAMPLE))).toBe(sampleBefore);
});

check('normalize 对已规范化输出再跑仍相同（真幂等）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-guard-idem-'));
  try {
    const p = path.join(tmp, 'cicada-max.svg');
    fs.writeFileSync(p, norm1, 'utf8');
    const r = run(['normalize', '--file', p]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(norm1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 4. normalize --write 的往返（临时副本，不碰真实资产）
 * ========================================================================== */
check('normalize --write 覆盖副本并可用 .bak 还原', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-guard-write-'));
  try {
    const p = path.join(tmp, 'cicada-max.svg');
    const original = fs.readFileSync(SAMPLE);
    fs.writeFileSync(p, original);

    const r = run(['normalize', '--file', p, '--write']);
    expect(r.status).toBe(0);

    const bak = p + '.bak';
    expect(fs.existsSync(bak)).toBe(true);
    expect(sha256(fs.readFileSync(bak))).toBe(sha256(original));

    const after = fs.readFileSync(p, 'utf8');
    expect(after).not.toBe(original.toString('utf8'));
    expect(after).toContain('viewBox="0 0 1384.67 643.45"');

    /* 用 .bak 还原 */
    fs.copyFileSync(bak, p);
    expect(sha256(fs.readFileSync(p))).toBe(sha256(original));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('normalize --write 不带 --file 时拒绝执行（防批量覆盖）', () => {
  const r = run(['normalize', '--write']);
  expect(r.status).toBe(3);
  expect(r.stderr).toContain('--write');
});

/* ==========================================================================
 * 5. 指纹台账
 * ========================================================================== */
check('fingerprint --out 写出 artifacts/vis/asset-ledger.json', () => {
  const r = run(['fingerprint', '--out', LEDGER]);
  expect(r.status).toBe(0);
  expect(fs.existsSync(LEDGER)).toBe(true);
});

check('指纹台账结构稳定可排序（字段齐全 + 按路径排序）', () => {
  const j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  expect(j.tool).toBe('vis-asset-guard');
  expect(Array.isArray(j.assets)).toBe(true);
  expect(j.assets.length).toBeGreaterThan(0);
  const paths = j.assets.map((a) => a.path);
  expect([...paths].sort()).toEqual(paths);
  for (const a of j.assets) {
    expect(a.path).toMatch(/\.svg$/);
    expect(a.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof a.bytes).toBe('number');
    expect(a.semanticSafe).toBe(true);
  }
  expect(paths).toContain('artifacts/vis/assets/cicada/svg/cicada-max.svg');
});

check('指纹台账记录了「被另一工作流删除」的受跟踪资产', () => {
  const j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  expect(Array.isArray(j.missing)).toBe(true);
  expect(j.missing.length).toBeGreaterThan(0);
  expect(j.missing[0].path).toMatch(/\.svg$/);
});

check('指纹台账可重复生成且字节稳定（无时间戳）', () => {
  const first = fs.readFileSync(LEDGER, 'utf8');
  const r = run(['fingerprint', '--out', LEDGER]);
  expect(r.status).toBe(0);
  expect(fs.readFileSync(LEDGER, 'utf8')).toBe(first);
});

/* ==========================================================================
 * 6. 真实资产全程未被改动
 * ========================================================================== */
check('真实资产目录在整个验证过程中未被修改', () => {
  const after = snapshotAssets();
  expect([...after.keys()].sort()).toEqual([...assetsBefore.keys()].sort());
  for (const [name, h] of assetsBefore) {
    expect(after.get(name)).toBe(h);
  }
});

/* ==========================================================================
 * SUMMARY
 * ========================================================================== */
console.log('');
console.log('='.repeat(88));
console.log(' SUMMARY: ' + passed + ' passed / ' + failed + ' failed');
if (failed) {
  console.log(' 失败项:');
  for (const f of failures) console.log('   - ' + f.name + ': ' + f.msg);
}
console.log(' 退出码: 0=全通过 / 1=有断言失败');
console.log('='.repeat(88));
process.exit(failed ? 1 : 0);
