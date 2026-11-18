#!/usr/bin/env node
/* ============================================================================
 * SiMuseor VIS · vis-check.mjs
 * ----------------------------------------------------------------------------
 * VIS 视觉规范校验脚本（Node >= 18，零第三方依赖）。
 *
 * 【判定语义（v2 · 本轮重写）】
 *   v1 的 §1 是「现状快照比对」——通过条件是「违规数 == Phase1/2 登记的历史值」。
 *   这导致「把违规修好了」反而让门禁变红（修好 styles.css 的 17 处字重后，
 *   登记值 17 不再成立 -> FAIL）。门禁应当回答的是「现在合不合规」。
 *   v2 把 §1 拆成四类，每类有明确语义：
 *
 *   1. 合规判定（COMPLIANCE）—— 违规数必须为 0 / 目标态必须精确成立。
 *      不合规 -> 阻塞（退出码 2）。这些项当前都已达标，作用是回归护栏。
 *   2. 棘轮（RATCHET）—— 已知债务按「文件 + 值」精确登记。数量【只降不升】：
 *      超过登记值 = 新增违规 -> 阻塞（退出码 2）；等于登记值 = 旧债仍在 ->
 *      仅提示（退出码 1）；低于登记值 = 有收敛 -> PASS 并报出收敛量。
 *      这是「不放宽判据」与「不让流水线长期红」之间的唯一诚实解法。
 *   3. 落地进度（PROGRESS）—— M2-d 之后 token 已被引用，「引用数 > 0」即视为
 *      已落地。不作合规判定，只报进度。
 *   4. 现状快照（INFO）—— 纯登记，不判定。
 *
 *   1.10 / 1.11 保持 v1 的 PASS 型正向断言不变（1.10 = 裁决 G 边界不被误改；
 *   1.11 = --primary-hover token 值未被偷改）。
 *
 * 【校验对象】
 *   v1 只读 artifacts/vis/vis-tokens.css（18 个变量）——那是设计层交付物。
 *   真正接入构建的是 web/src/vis-tokens.css（web/angular.json:29-33 styles
 *   数组第三项，136 个赋值变量，三层 primitive/semantic/component）。
 *   v2 两份都查，各报告，并交叉校验两者的解析后字面值一致。
 *
 * 【新增 1.12 硬编码色值】
 *   扫描 web/src/app 下所有 .ts 里的裸 hex / rgb() / rgba()，区分
 *   「组件 scoped 样式块内」与「TS 字面量」两类，豁免清单显式列出并附理由。
 *
 * 【退出码】
 *   0 = 全通过（无旧债、无违规）
 *   1 = 有现状基线类 FAIL（旧债仍在，仅提示，不阻塞）
 *   2 = 有合规类 FAIL（新违规 / 合规项不达标，阻塞）
 *   3 = 脚本自身出错
 *
 * 【只读承诺】
 *   默认只读：只调用 fs.readFileSync / readdirSync，全部结果打印到 stdout。
 *   唯一例外是显式开关 --write-report：把同一份 stdout 报告写到
 *   artifacts/vis/vis-check-report.txt。除此之外不写任何项目文件。
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // artifacts/vis
const ROOT = path.resolve(HERE, '..', '..');                  // 项目根

const STYLES = path.join(ROOT, 'web', 'src', 'styles.css');
const APP_DIR = path.join(ROOT, 'web', 'src', 'app');
/* 设计层交付物：artifacts/vis/vis-tokens.css */
const TOKENS_DESIGN = path.join(HERE, 'vis-tokens.css');
/* 真正接入构建的生效层：web/src/vis-tokens.css */
const TOKENS_EFFECTIVE = path.join(HERE, '..', '..', 'web', 'src', 'vis-tokens.css');
const REPORT_FILE = path.join(HERE, 'vis-check-report.txt');

const WRITE_REPORT = process.argv.slice(2).includes('--write-report');

/* --------------------------------------------------------------------------
 * 硬编码色值豁免清单（1.12）
 * 每条必须写清理由；报告会完整列出，让审查者看得见被放过了什么。
 * ------------------------------------------------------------------------ */
const COLOR_EXEMPT = [
  {
    path: 'web/src/app/core/model-tone.ts',
    re: /^web\/src\/app\/core\/model-tone\.ts$/,
    reason: '家族色唯一出处。该文件刻意存双套色（浅/深各一份），由调用方只给 '
      + '--t-* / --t-*-d，由 CSS 映射到 --plate-*；深色主题因此能整体切换。'
      + '文件头 :11-26 写明「这里只给两套色，映射交给 CSS」。'
      + '这是「色板即数据」的设计，不是绕过 token 的硬编码。',
  },
  {
    path: 'web/src/app/lab/**',
    re: /^web\/src\/app\/lab\//,
    reason: '选型对照实验页。app.routes.ts:83 注释：「设计对照实验：两套组件体系'
      + '各做一页，仅用于评估，不属于产品导航」。这些页面刻意不消费 VIS token，'
      + '否则就失去了对照实验的意义（要对比的就是「不用 token 的裸 PrimeNG/Tailwind」）。',
  },
  /* cover.ts 已核实：其 7 处 hex 全在注释里（官方品牌色讨论，如 Qwen 官方紫
     #6950EF、ERNIE 深端 #0439B5），剥离注释后命中数为 0 —— 因此【不】豁免，
     保持受检；将来若有人在里面写真实色值，会被本项当场抓住。 */
];

/* --------------------------------------------------------------------------
 * 棘轮基线表（现状债务登记）
 * 键：'<相对路径>|<归一化的值>'；值：当前登记处数。
 * 语义：实际值 <= 登记值 -> 不阻塞（等于=旧债仍在，低于=有收敛）；
 *       实际值 > 登记值  -> 新增违规，阻塞。
 * 登记依据：本轮改动前的实测结果（见 artifacts/vis/vis-check-report.txt 历史）。
 * ------------------------------------------------------------------------ */
const BASELINE_1_1_SCOPED = {
  'web/src/app/pages/workflow-editor.component.ts|font-weight:650': 5,
  'web/src/app/pages/workflow-editor.component.ts|font-weight:550': 5,
  'web/src/app/ui/library-card.component.ts|font-weight:650': 1,
};
const BASELINE_1_2_SCOPED = {
  'web/src/app/pages/library.component.ts|--faint': 5,
  'web/src/app/pages/workflow-editor.component.ts|--faint': 15,
  'web/src/app/ui/library-card.component.ts|--faint': 2,
  'web/src/app/ui/workflow-card.component.ts|--faint': 1,
};
const BASELINE_1_6_SCOPED = {
  'web/src/app/lab/lab-primeng.component.ts|border-radius:10px': 1,
  'web/src/app/pages/library.component.ts|border-radius:10px': 1,
  'web/src/app/pages/library.component.ts|border-radius:6px': 2,
  'web/src/app/pages/workflow-editor.component.ts|border-radius:4px': 3,
  'web/src/app/pages/workflow-editor.component.ts|border-radius:9px': 2,
  'web/src/app/pages/workflow-editor.component.ts|border-radius:10px': 1,
  'web/src/app/pages/workflow-editor.component.ts|border-radius:6px': 6,
  'web/src/app/ui/cover-plate.component.ts|border-radius:6px': 2,
  'web/src/app/ui/cover-plate.component.ts|border-radius:4px': 1,
  'web/src/app/ui/library-card.component.ts|border-radius:6px': 1,
  'web/src/app/ui/library-card.component.ts|border-radius:4px': 1,
};
const BASELINE_1_3 = {
  'web/src/app/pages/workflows.component.ts|.cm-cell-tag': 1,
};
const BASELINE_1_3B = {
  'web/src/app/pages/workflows.component.ts|.cm-cell-tag': 1,
};
const BASELINE_1_9A = {
  'web/src/app/pages/workflow-editor.component.ts|stroke-width:1.6': 1,
};
const BASELINE_1_12_SCOPED = {
  'web/src/app/pages/workflow-editor.component.ts|#fee2e2': 1,
  'web/src/app/pages/workflow-editor.component.ts|#fef2f2': 2,
  'web/src/app/pages/workflow-editor.component.ts|#fff': 2,
  'web/src/app/pages/workflow-editor.component.ts|rgb(0 0 0 / 0.35)': 1,
  'web/src/app/pages/workflow-editor.component.ts|rgb(0 0 0 / 0.4)': 1,
  'web/src/app/pages/workflow-editor.component.ts|rgb(0 0 0 / 0.55)': 1,
  'web/src/app/pages/workflows.component.ts|#fff': 1,
  'web/src/app/pages/workflows.component.ts|rgb(0 0 0 / 0.34)': 2,
  'web/src/app/pages/workflows.component.ts|rgb(0 0 0 / 0.55)': 3,
  'web/src/app/pages/workflows.component.ts|rgb(0 0 0 / 0.58)': 1,
  'web/src/app/pages/workflows.component.ts|rgb(0 0 0 / 0.6)': 2,
  'web/src/app/ui/cover-plate.component.ts|#000': 8,
  'web/src/app/ui/cover-plate.component.ts|#232321': 1,
  'web/src/app/ui/cover-plate.component.ts|#57564f': 1,
  'web/src/app/ui/cover-plate.component.ts|#6b6a63': 1,
  'web/src/app/ui/cover-plate.component.ts|#b0afa6': 1,
  'web/src/app/ui/cover-plate.component.ts|#b3b2aa': 2,
  'web/src/app/ui/cover-plate.component.ts|#d7d6cd': 1,
  'web/src/app/ui/cover-plate.component.ts|#f2f1ed': 1,
  'web/src/app/ui/cover-plate.component.ts|#fff': 2,
  'web/src/app/ui/cover-plate.component.ts|#ffffff': 1,
  'web/src/app/ui/cover-plate.component.ts|rgb(0 0 0 / 0.5)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(255, 255, 255, 0.18)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(255, 255, 255, 0.28)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(255, 255, 255, 0.76)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(255, 255, 255, 0.94)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(8, 10, 16, 0)': 2,
  'web/src/app/ui/cover-plate.component.ts|rgba(8, 10, 16, 0.52)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(8, 10, 16, 0.66)': 1,
  'web/src/app/ui/cover-plate.component.ts|rgba(8, 10, 16, 0.94)': 1,
  'web/src/app/ui/family-mark.component.ts|rgb(0 0 0 / 0.28)': 1,
  'web/src/app/ui/library-card.component.ts|#000': 8,
  'web/src/app/ui/library-card.component.ts|#15803d': 2,
  'web/src/app/ui/library-card.component.ts|#17101d': 1,
  'web/src/app/ui/library-card.component.ts|#b45309': 2,
  'web/src/app/ui/library-card.component.ts|#eab308': 2,
  'web/src/app/ui/library-card.component.ts|#ff0000': 3,
  'web/src/app/ui/library-card.component.ts|#fff': 6,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.1)': 2,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.18)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.42)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.5)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.55)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(0 0 0 / 0.74)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(234 179 8 / 0.5)': 2,
  'web/src/app/ui/library-card.component.ts|rgb(255 0 0 / 0.5)': 2,
  'web/src/app/ui/library-card.component.ts|rgb(255 255 255 / 0.18)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(255 255 255 / 0.22)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(255 255 255 / 0.24)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(255 255 255 / 0.28)': 1,
  'web/src/app/ui/library-card.component.ts|rgb(255 255 255 / 0.78)': 2,
  'web/src/app/ui/model-card.component.ts|#fff': 2,
  'web/src/app/ui/model-card.component.ts|rgb(0 0 0 / 0.16)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(0 0 0 / 0.5)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(255 255 255 / 0.14)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(255 255 255 / 0.24)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(255 255 255 / 0.28)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(255 255 255 / 0.8)': 1,
  'web/src/app/ui/model-card.component.ts|rgb(255 255 255 / 0.88)': 1,
  'web/src/app/ui/workflow-card.component.ts|#fff': 5,
  'web/src/app/ui/workflow-card.component.ts|rgb(0 0 0 / 0.42)': 2,
  'web/src/app/ui/workflow-card.component.ts|rgb(0 0 0 / 0.5)': 1,
  'web/src/app/ui/workflow-card.component.ts|rgb(0 0 0 / 0.58)': 1,
  'web/src/app/ui/workflow-card.component.ts|rgb(0 0 0 / 0.6)': 1,
  'web/src/app/ui/workflow-card.component.ts|rgb(217 119 6 / 0.86)': 1,
  'web/src/app/ui/workflow-card.component.ts|rgb(220 38 38 / 0.58)': 1,
  'web/src/app/ui/workflow-card.component.ts|rgb(255 255 255 / 0.74)': 1,
};
const BASELINE_1_12_LITERAL = {
  'web/src/app/pages/workflow-editor.component.ts|#0284c7': 1,
  'web/src/app/pages/workflow-editor.component.ts|#059669': 1,
  'web/src/app/pages/workflow-editor.component.ts|#4f46e5': 1,
  'web/src/app/pages/workflow-editor.component.ts|#6366f1': 1,
  'web/src/app/pages/workflow-editor.component.ts|#71717a': 1,
  'web/src/app/pages/workflow-editor.component.ts|#8b5cf6': 1,
  'web/src/app/pages/workflow-editor.component.ts|#d97706': 1,
};

/* --------------------------------------------------------------------------
 * 输出缓冲：先攒进内存，最后一次性打印（--write-report 时同一份内容写文件）
 * ------------------------------------------------------------------------ */
const OUT = [];
function say(line) { OUT.push(String(line)); }

/* --------------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------------ */
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

/* 剥离注释：块注释 + 行注释，替换为空格但【保留换行】，保证行号不漂移。
   CSS 注释不可嵌套；TS 行注释的起始 // 必须不在字符串/URL 里，故排除
   前一个字符为 : " ' ` \ 的情况（'https://' 之类不算注释）。 */
function stripComments(src) {
  let r = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  r = r.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return r;
}

/* 归一化色值文本，使基线表与实际值可逐字比较 */
function normColor(v) {
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t.startsWith('#') ? t.toLowerCase() : t.toLowerCase();
}

/* 解析 web/src/styles.css 两套 :root 的变量值，供 §1.3b 通用白字填充对比度计算。
   只读；dark 未声明的变量回退到 light 值（与 CSS 继承行为一致）。 */
function styleRootVars() {
  const s = stripComments(fs.readFileSync(STYLES, 'utf8'));
  const out = { light: new Map(), dark: new Map() };
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const sel = m[1].trim().split('\n').pop().trim();
    if (!/^:root/.test(sel)) continue;
    const bucket = /data-theme/.test(sel) ? out.dark : out.light;
    for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
      bucket.set(d[1], d[2].trim());
    }
  }
  return out;
}

function collectTs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectTs(p, out);
    else if (ent.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/* 显示宽度（东亚全角算 2），用于表格对齐 */
function dw(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe10 && c <= 0xfe19) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd)));
    n += wide ? 2 : 1;
  }
  return n;
}
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - dw(String(s))));
const HR = '='.repeat(100);
const HR2 = '-'.repeat(100);

function verdict(ok) { return ok ? '[PASS]' : '[FAIL]'; }

/* --------------------------------------------------------------------------
 * 计数桶
 *   complianceFail —— 合规类违规 / 棘轮新增违规 -> 退出码 2（阻塞）
 *   debtCount      —— 已登记的旧债仍在 -> 退出码 1（不阻塞，仅提示）
 * ------------------------------------------------------------------------ */
let complianceFail = 0;
let regressionFail = 0;
let debtCount = 0;
let deliverableFail = 0;

/* 棘轮判定：actual / baseline 都是 { 'file|value': n } 形态
   返回 { regression, debt, improvement } */
function ratchet(actual, baseline) {
  let regression = 0, debt = 0, improvement = 0;
  for (const [k, n] of Object.entries(actual)) {
    const b = baseline[k] || 0;
    if (n > b) regression += n - b;
    else { debt += n; improvement += b - n; }
  }
  for (const [k, b] of Object.entries(baseline)) {
    if (!(k in actual)) improvement += b;
  }
  return { regression, debt, improvement };
}

/* 把 actual 变成棘轮用的 { 'file|value': n } */
function tally(items) {
  const m = {};
  for (const it of items) m[it.key] = (m[it.key] || 0) + 1;
  return m;
}

/* 打印一次棘轮判定结果 */
function reportRatchet(label, kind, actual, baseline, detailLines) {
  const r = ratchet(actual, baseline);
  const total = Object.values(actual).reduce((a, b) => a + b, 0);
  const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
  say('        现状 ' + total + ' 处 / 登记基线 ' + baseTotal + ' 处');
  if (r.regression > 0) {
    say('        判定: ' + verdict(false) + ' 新增违规 ' + r.regression +
      ' 处（超过登记基线）-> 阻塞');
    for (const l of detailLines) say('        ' + l);
    complianceFail += r.regression;
    regressionFail += r.regression;
    /* 旧债仍要计入总数，否则 SUMMARY 的旧债计数会随新增违规而缩水 */
    debtCount += r.debt;
  } else if (r.debt > 0) {
    say('        判定: ' + verdict(true) + ' 无新增违规；已登记旧债 ' + r.debt +
      ' 处仍在（只降不升，不阻塞）');
    if (r.improvement > 0) say('        较基线收敛 ' + r.improvement + ' 处');
    for (const l of detailLines) say('        ' + l);
    debtCount += r.debt;
  } else {
    say('        判定: ' + verdict(true) + ' 无新增违规；已登记旧债已全部清零');
    if (r.improvement > 0) say('        较基线收敛 ' + r.improvement + ' 处');
  }
  return r;
}

/* ==========================================================================
 * 0. 头部 / 扫描范围
 * ========================================================================== */
const files = [STYLES, ...collectTs(APP_DIR)].filter((p) => fs.existsSync(p));
const cssFiles = [STYLES, TOKENS_EFFECTIVE].filter((p) => fs.existsSync(p));

say(HR);
say(' SiMuseor VIS · 视觉规范校验报告  (vis-check.mjs v2 · 合规判定版)');
say(' 生成时间: ' + new Date().toISOString());
say(' 项目根  : ' + ROOT.replace(/\\/g, '/'));
say(' 模式    : ' + (WRITE_REPORT ? '只读 + --write-report（写 artifacts/vis/vis-check-report.txt）' : '只读（不写任何项目文件）'));
say(HR);
say('');
say('[0] 扫描范围');
say('    styles.css          : ' + rel(STYLES) + '  (' +
  (fs.existsSync(STYLES) ? fs.readFileSync(STYLES, 'utf8').split('\n').length + ' 行' : '缺失') + ')');
say('    app/**/*.ts         : ' + (files.length - 1) + ' 个文件');
say('    token 文件（设计层）: ' + rel(TOKENS_DESIGN) + '  (' +
  (fs.existsSync(TOKENS_DESIGN) ? fs.readFileSync(TOKENS_DESIGN, 'utf8').split('\n').length + ' 行' : '缺失') + ')');
say('    token 文件（生效层）: ' + rel(TOKENS_EFFECTIVE) + '  (' +
  (fs.existsSync(TOKENS_EFFECTIVE) ? fs.readFileSync(TOKENS_EFFECTIVE, 'utf8').split('\n').length + ' 行' : '缺失') + ')');
say('    口径: 先剥离 /*...*/ 与 //... 注释（保留换行以维持行号），再按正则/规则块扫描。');
say('');
say('    判定语义分类：');
say('      [合规判定] 违规数必须 0 / 目标态必须精确成立 —— 不达标即阻塞（退出码 2）');
say('      [棘轮]     已知债务按「文件+值」精确登记，只降不升 —— 超基线阻塞（2），等于基线仅提示（1）');
say('      [落地进度] 引用数 > 0 即视为已落地 —— 只报进度，不判定');
say('      [现状快照] 纯登记，不判定');
say('');

/* 通用：在若干文件里按正则收集命中 */
function scan(re, label, scope = files) {
  const hits = [];
  for (const f of scope) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(txt)) !== null) {
      hits.push({
        file: rel(f),
        line: lineAt(txt, m.index),
        text: m[0].replace(/\s+/g, ' ').trim().slice(0, 78),
      });
    }
  }
  return { label, hits };
}

const STYLES_REL = 'web/src/styles.css';
function splitBySource(res) {
  return {
    inStyles: res.hits.filter((h) => h.file === STYLES_REL),
    inTs: res.hits.filter((h) => h.file !== STYLES_REL),
  };
}
const DISCOVERY = '[DISCOVERY]';

/* ==========================================================================
 * 1. 现状扫描 / 合规判定
 * ========================================================================== */
say(HR2);
say('[1] 现状扫描：web/src/styles.css + web/src/app/**/*.ts');
say('    上游口径：Phase1 v1.1 / Phase2 v1.1；§8 冲突表 15 项（v1.0 13 项 + M/N）。');
say('    【主理人裁决 · 方案 A】button.primary:hover 归入 §8-M【适用范围补充】，');
say('          §8 冲突表仍 15 项。background 保持 var(--primary)，border-color 改 var(--accent)');
say('          作 1px 装饰描边；零 token 改动、双主题白字 6.29:1。');
say('    【裁决 G 边界】1.3 / 1.3b 只检主 UI 的 CSS 规则，不对 lab-theme.ts 的深字方案报 FAIL');
say('          （另见 1.10 正向验收）。');
say(HR2);

/* --------------------------------------------------------------------------
 * 1.1 非白名单 font-weight
 *   styles.css 内 -> 合规判定（必须 0）
 *   组件 scoped 内 -> 棘轮（登记基线 11 处）
 * ------------------------------------------------------------------------ */
{
  const r = scan(/\b(?:font|font-weight)\s*:\s*(550|620|640|650|660|680)\b/gi,
    '1.1 非白名单 font-weight (550/620/640/650/660/680)');
  const { inStyles, inTs } = splitBySource(r);
  say('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' +
    inStyles.length + ' + 组件 scoped ' + inTs.length);
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  say('      白名单 400/500/600/700；550->500，620/640/650/660/680->600（Phase1 §4.2）');
  say('      [合规判定] styles.css 内 ' + inStyles.length + ' 处（必须 0）');
  if (inStyles.length === 0) {
    say('      判定: ' + verdict(true) + ' styles.css 内零非白名单字重');
  } else {
    say('      判定: ' + verdict(false) + ' styles.css 内 ' + inStyles.length + ' 处非白名单字重 -> 阻塞');
    complianceFail += inStyles.length;
  }
  say('      [棘轮] 组件 scoped 内 ' + inTs.length + ' 处（登记基线 11 处，只降不升）');
  const items = inTs.map((h) => ({ key: h.file + '|font-weight:' + /(\d+)/.exec(h.text)[1], hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.1r', 'ratchet', actual, BASELINE_1_1_SCOPED, detail);
}

/* --------------------------------------------------------------------------
 * 1.2 --faint / --placeholder 作文本色
 *   styles.css 内 -> 合规判定（必须 0 / 0）
 *   组件 scoped 内 -> 棘轮（登记基线 23 处）
 * ------------------------------------------------------------------------ */
{
  const re = /(?<![-\w])color\s*:\s*var\(\s*--(faint|placeholder)\s*\)/gi;
  const r = scan(re, '1.2 color: var(--faint|--placeholder) 文本用法');
  const { inStyles, inTs } = splitBySource(r);
  const sFaint = inStyles.filter((h) => /--faint/.test(h.text)).length;
  const sPlaceholder = inStyles.filter((h) => /--placeholder/.test(h.text)).length;
  say('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' + inStyles.length +
    '（--faint ' + sFaint + ' / --placeholder ' + sPlaceholder + '） + 组件 scoped ' + inTs.length);
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  let totalRefs = 0;
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    totalRefs += (txt.match(/var\(\s*--(?:faint|placeholder)\s*\)/gi) || []).length;
  }
  say('      全量 var(--faint|--placeholder) 引用: ' + totalRefs + ' 处；差值 ' +
    (totalRefs - r.hits.length) + ' 处为 background/border 等非文本装饰引用（§3.3 允许）');
  say('      处置: 不改 token 值，只把文本引用迁到 --muted / --text-2；::placeholder 文本必须保留（E2E :54,:92）');
  say('      [合规判定] styles.css 内 --faint ' + sFaint + ' 处 / --placeholder ' + sPlaceholder +
    ' 处（两者都必须 0）');
  if (sFaint === 0 && sPlaceholder === 0) {
    say('      判定: ' + verdict(true) + ' styles.css 内零 --faint / --placeholder 文本用法');
  } else {
    say('      判定: ' + verdict(false) + ' styles.css 内仍有 ' + (sFaint + sPlaceholder) +
      ' 处文本用法 -> 阻塞');
    complianceFail += sFaint + sPlaceholder;
  }
  say('      [棘轮] 组件 scoped 内 ' + inTs.length + ' 处（登记基线 23 处，只降不升）');
  const items = inTs.map((h) => ({ key: h.file + '|' + (/--(faint|placeholder)/i.exec(h.text)[0]), hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.2r', 'ratchet', actual, BASELINE_1_2_SCOPED, detail);
}

/* --------------------------------------------------------------------------
 * 1.3 白字填充：同规则 background: var(--accent*) + color: var(--on-primary)
 *   -> 棘轮（登记基线 1 处；合规目标是 0）
 * ------------------------------------------------------------------------ */
{
  say('    1.3 background: var(--accent*) 且同规则含 color: var(--on-primary)');
  const filled = [];
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(txt)) !== null) {
      const body = m[2];
      const sel = m[1].trim().split('\n').pop().trim().slice(0, 60);
      if (/background\s*:\s*var\(\s*--accent(?:-hover)?\s*\)/i.test(body) &&
        /color\s*:\s*var\(\s*--on-primary\s*\)/i.test(body)) {
        filled.push({ file: rel(f), line: lineAt(txt, m.index + m[1].length), sel,
          snippet: body.replace(/\s+/g, ' ').trim().slice(0, 70) });
      }
    }
  }
  say('        -> ' + filled.length + ' 处（合规目标 0 处；登记基线 1 处）');
  for (const h of filled) {
    say('        ' + pad(h.file + ':' + h.line, 50) + ' ' + pad(h.sel, 34) + ' ' + h.snippet);
  }
  say('        处置: 该填充改 var(--primary)（白字 6.29:1 双主题一致）；--accent 深色 #a5b4fc 白字仅 1.99:1 FAIL');
  say('        检测口径: 本项只匹配主 UI 的 CSS 规则块。lab-theme.ts 是 TS 对象，其 dark primary =');
  say('          亮靛紫底 + contrastColor {primary.950} 深字，属另一条合规路线，不参与本项检测；');
  say('          该路线由 1.10 做正向验收，由 §2 对比度表做数值复核。');
  say('        segmented button.active（--panel 底 + --accent 文字）合规，不改、不计入。');
  const items = filled.map((h) => ({ key: h.file + '|' + h.sel, hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.3', 'ratchet', actual, BASELINE_1_3, detail);
}

/* --------------------------------------------------------------------------
 * 1.3b 白字实心填充通用枚举
 *   -> 棘轮（登记基线 1 条不达 AA）
 * ------------------------------------------------------------------------ */
{
  say('    1.3b 白字实心填充通用枚举（修复 1.3 只匹配 --accent* 的漏检盲区）');
  const ROOTV = styleRootVars();
  const onPriL = ROOTV.light.get('--on-primary') || '#ffffff';
  const onPriD = ROOTV.dark.get('--on-primary') || onPriL;
  const hexOf = (v) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : null);
  const rows = [];
  for (const f of files) {
    if (f.endsWith('lab-theme.ts')) continue;               // 裁决 G 边界：TS 对象不参与
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(txt)) !== null) {
      const body = m[2];
      if (!/color\s*:\s*var\(\s*--on-primary\s*\)/i.test(body)) continue;
      const bg = body.match(/background(?:-color)?\s*:\s*var\(\s*(--[A-Za-z0-9_-]+)\s*\)/i);
      if (!bg) continue;
      const X = bg[1];
      const lv = hexOf(ROOTV.light.get(X)), dv = hexOf(ROOTV.dark.get(X) || ROOTV.light.get(X));
      if (!lv || !dv) continue;
      const lr = ratio(onPriL, lv), dr = ratio(onPriD, dv);
      rows.push({ file: rel(f), line: lineAt(txt, m.index + m[1].length),
        sel: m[1].trim().split('\n').pop().trim().slice(0, 40),
        X, lr, dr, bad: Math.min(lr, dr) < 4.5 });
    }
  }
  say('        ' + pad('规则 @行', 46) + pad('填充变量', 19) + pad('浅', 10) + pad('深', 10) + '判定');
  for (const h of rows) {
    say('        ' + pad(h.sel + ' @' + h.line, 46) + pad(h.X, 19) +
      pad(h.lr.toFixed(2) + ':1', 10) + pad(h.dr.toFixed(2) + ':1', 10) +
      (h.bad ? '[FAIL 旧债·待修]' : '[PASS]'));
  }
  const bad = rows.filter((h) => h.bad);
  say('        -> ' + rows.length + ' 条白字实心填充规则；<4.5 不达 AA = ' + bad.length +
    ' 条（登记基线 1 条）');
  say('        M 项描述（ux-designer / visual-architect 一致）：不达 AA 的实心填充承载白字');
  say('          （--accent / --accent-hover / --primary-hover）；§8 仍 15 项，不新增第 16 项。');
  say('        边界: lab-theme.ts 已显式跳过；其「亮靛紫底 + contrastColor 深字」由 1.10 正向验收，不报 FAIL。');
  const items = bad.map((h) => ({ key: h.file + '|' + h.sel, hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.3b', 'ratchet', actual, BASELINE_1_3B, detail);
}

/* --------------------------------------------------------------------------
 * 1.4 filter: invert() —— 合规判定（硬约束，必须 0）
 * ------------------------------------------------------------------------ */
{
  const r = scan(/filter\s*:\s*invert\s*\(/gi, '1.4 filter: invert()');
  say('    ' + r.label + ' -> ' + r.hits.length + ' 处（硬约束：禁止，Phase1 §2.4 / cover.ts:43）');
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  say('      [合规判定] 全仓必须 0');
  if (r.hits.length === 0) {
    say('      判定: ' + verdict(true) + ' 全仓零 invert，反白走双份 SVG + :host-context');
  } else {
    say('      判定: ' + verdict(false) + ' ' + r.hits.length + ' 处 invert -> 阻塞');
    complianceFail += r.hits.length;
  }
}

/* --------------------------------------------------------------------------
 * 1.5 .brand-wordmark 实例数 —— 合规判定（目标态：模板恰好 1 个实例）
 *   v1 判的是「字面数 === 0」（占位期零落地）；M2 已落地，语义应改为「恰好 1 个实例」。
 * ------------------------------------------------------------------------ */
{
  const r = scan(/\bbrand-wordmark\b/g, '1.5 brand-wordmark 字面（项目源码）');
  say('    ' + r.label + ' -> ' + r.hits.length + ' 个');
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  /* 模板实例：TS 模板里的 class="brand-wordmark" */
  const tsFiles = files.filter((f) => f !== STYLES);
  let instances = 0;
  const instDetail = [];
  for (const f of tsFiles) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of txt.matchAll(/class\s*=\s*["'][^"']*\bbrand-wordmark\b[^"']*["']/g)) {
      instances++;
      instDetail.push(rel(f) + ':' + lineAt(txt, m.index));
    }
  }
  /* CSS 规则：styles.css / vis-tokens.css 里 .brand-wordmark 选择器 */
  let rules = 0;
  const ruleDetail = [];
  for (const f of cssFiles) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of txt.matchAll(/\.brand-wordmark\b/g)) {
      rules++;
      ruleDetail.push(rel(f) + ':' + lineAt(txt, m.index));
    }
  }
  say('        模板实例（TS class="brand-wordmark"）: ' + instances + ' 个' +
    (instDetail.length ? ' -> ' + instDetail.join(', ') : ''));
  say('        CSS 规则（.brand-wordmark 选择器）  : ' + rules + ' 个' +
    (ruleDetail.length ? ' -> ' + ruleDetail.join(', ') : ''));
  say('        目标态（Phase2 §1.1）：全站 .brand-wordmark 有且仅有 1 个实例，且是 .sidebar > .brand 的子元素');
  say('      [合规判定] 模板实例必须恰好 1 个');
  if (instances === 1) {
    say('      判定: ' + verdict(true) + ' 模板实例恰好 1 个（M2 已落地）');
  } else {
    say('      判定: ' + verdict(false) + ' 模板实例 ' + instances + ' 个（应为 1）-> 阻塞');
    complianceFail++;
  }
}

/* --------------------------------------------------------------------------
 * 1.6 圆角中间档 —— styles.css 内合规判定；组件 scoped 内棘轮
 * ------------------------------------------------------------------------ */
{
  const r = scan(/border-radius\s*:\s*(6|9|4|10)px\b/gi, '1.6 圆角中间档 border-radius: 6/9/4/10px');
  const { inStyles, inTs } = splitBySource(r);
  say('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' +
    inStyles.length + ' + 组件 scoped ' + inTs.length);
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  say('      Phase1 §6.4 待收敛：.brand-mark 9px(随 C 删除) / .btn-xs 6px / .tp-swatch 4px / .skel-line 4px / .step-row 6px');
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const n16 = (txt.match(/border-radius\s*:\s*16px\b/gi) || []).length;
    const n999 = (txt.match(/border-radius\s*:\s*999px\b/gi) || []).length;
    if (n16 || n999) say('      ' + pad(rel(f), 42) + ' 登记例外: 16px x' + n16 + ' / 999px x' + n999 + '（弹层与胶囊，Phase1 §6.4）');
  }
  say('      [合规判定] styles.css 内 ' + inStyles.length + ' 处（必须 0）');
  if (inStyles.length === 0) {
    say('      判定: ' + verdict(true) + ' styles.css 内零圆角中间档');
  } else {
    say('      判定: ' + verdict(false) + ' styles.css 内 ' + inStyles.length + ' 处圆角中间档 -> 阻塞');
    complianceFail += inStyles.length;
  }
  say('      [棘轮] 组件 scoped 内 ' + inTs.length + ' 处（登记基线 21 处，只降不升）');
  say('      ' + DISCOVERY + ' cover-plate 3 处定性「适用域外」（独立图形子系统，圆角三档规则不适用）；');
  say('                lab-primeng 1 处并入 M1。');
  const items = inTs.map((h) => ({ key: h.file + '|border-radius:' + /(\d+)px/.exec(h.text)[1] + 'px', hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.6r', 'ratchet', actual, BASELINE_1_6_SCOPED, detail);
}

/* --------------------------------------------------------------------------
 * 1.7 prefers-reduced-motion —— 现状快照，不判定
 * ------------------------------------------------------------------------ */
{
  const r = scan(/prefers-reduced-motion\s*:\s*reduce/gi, '1.7 prefers-reduced-motion 规则');
  say('    ' + r.label + ' -> ' + r.hits.length + ' 处');
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  say('      [现状快照] 目标态需全局 @media reduce（P3-7）：7 个动画停止，spinner 降级为静态 + role=status 文字');
}

/* --------------------------------------------------------------------------
 * 1.8 @font-face —— 现状快照，不判定
 * ------------------------------------------------------------------------ */
{
  const r = scan(/@font-face\b/g, '1.8 @font-face（项目源码，不含 token 文件）');
  say('    ' + r.label + ' -> ' + r.hits.length + ' 条');
  for (const h of r.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  const facesOf = (p) => {
    if (!fs.existsSync(p)) return 0;
    return (stripComments(fs.readFileSync(p, 'utf8')).match(/@font-face\b/g) || []).length;
  };
  say('        生效层 web/src/vis-tokens.css 生效 @font-face: ' + facesOf(TOKENS_EFFECTIVE) +
    ' 条（Barlow Condensed 400；Inter 按 M0 暂缓裁决以注释块保留，未生效）');
  say('        设计层 artifacts/vis/vis-tokens.css 生效 @font-face: ' + facesOf(TOKENS_DESIGN) + ' 条');
  say('      [现状快照] 源码 0 条 = 字体声明集中在 token 文件，非组件内联；落地前不得宣称生效（Phase1 冲突 F）');
}

/* --------------------------------------------------------------------------
 * 1.9a stroke-width: 1.6 —— 棘轮（登记基线 1 处）
 * 1.9b 新增 token 引用 —— 落地进度（引用数 > 0 即视为已落地）
 * ------------------------------------------------------------------------ */
{
  const r16 = scan(/stroke-width\s*:\s*1\.6\b/gi, '1.9a stroke-width: 1.6（-> 1.5，Phase1 §5.3）');
  say('    ' + r16.label + ' -> ' + r16.hits.length + ' 处（合规目标 0 处；登记基线 1 处）');
  for (const h of r16.hits) say('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  const items = r16.hits.map((h) => ({ key: h.file + '|stroke-width:1.6', hit: h }));
  const actual = tally(items);
  const detail = Object.entries(actual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.9a', 'ratchet', actual, BASELINE_1_9A, detail);

  let brandRefs = 0, controlRefs = 0, radiusLgRefs = 0;
  const brandDetail = [], controlDetail = [], radiusDetail = [];
  for (const f of files) {
    const t = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of t.matchAll(/var\(\s*(--brand-[A-Za-z0-9_-]+)/g)) {
      brandRefs++; brandDetail.push(rel(f) + ':' + lineAt(t, m.index) + ' ' + m[1]);
    }
    for (const m of t.matchAll(/var\(\s*(--border-control)/g)) {
      controlRefs++; controlDetail.push(rel(f) + ':' + lineAt(t, m.index) + ' ' + m[1]);
    }
    for (const m of t.matchAll(/var\(\s*(--radius-lg)/g)) {
      radiusLgRefs++; radiusDetail.push(rel(f) + ':' + lineAt(t, m.index) + ' ' + m[1]);
    }
  }
  say('    1.9b 新增 token 在源码中的引用（落地进度）');
  say('      --brand-*        引用 ' + brandRefs + ' 处  ' +
    (brandRefs > 0 ? '[已落地]' : '[未接线]'));
  for (const d of brandDetail) say('        ' + d);
  say('      --border-control 引用 ' + controlRefs + ' 处  ' +
    (controlRefs > 0 ? '[已落地]' : '[未接线]'));
  for (const d of controlDetail) say('        ' + d);
  say('      --radius-lg      引用 ' + radiusLgRefs + ' 处  ' +
    (radiusLgRefs > 0 ? '[已落地]' : '[未接线]'));
  for (const d of radiusDetail) say('        ' + d);
  say('      口径: M2-d 之后「引用数 > 0」即视为已落地（v1 判「=== 0 = 零落地证据」已过时）。');
  say('      [落地进度] 只报进度，不判定、不阻塞。');
}

/* --------------------------------------------------------------------------
 * 1.10 lab-theme.ts 裁决 G 语义边界【正向验收】—— 保持 v1 不变
 * ------------------------------------------------------------------------ */
{
  const LAB = path.join(ROOT, 'web', 'src', 'app', 'lab', 'lab-theme.ts');
  say('    1.10 lab-theme.ts 裁决 G 边界（Phase1 v1.1 §7.3 / Phase2 v1.2 新增验收项）');
  if (!fs.existsSync(LAB)) {
    say('        [WARN] 文件不存在，跳过');
  } else {
    const lab = stripComments(fs.readFileSync(LAB, 'utf8'));
    const is400 = /color:\s*'\{primary\.400\}'/.test(lab);
    const is300 = /color:\s*'\{primary\.300\}'/.test(lab);
    say('        [INFO] dark primary.color 当前 = ' +
      (is400 ? '{primary.400}（现状）' : is300 ? '{primary.300}（M1-g 目标已落地）' : '未知') +
      '；裁决 G 只改这一行色值，不牵动 contrastColor');
    const dIdx = lab.indexOf('dark: {');
    const darkSeg = dIdx >= 0 ? lab.slice(dIdx, dIdx + 500) : '';
    const checks = [
      ['dark.primary.contrastColor 保持 {primary.950} 深字',
        /contrastColor:\s*'\{primary\.950\}'/.test(darkSeg)],
      ['dark 块未被误改成白字 contrastColor（绝不改白字）',
        !/contrastColor:\s*'#fff(?:fff)?'/i.test(darkSeg)],
      ['light.primary.contrastColor #ffffff 为合规浅色方案（不判 FAIL）',
        /contrastColor:\s*'#ffffff'/i.test(lab)],
      ['dialog.root.borderRadius 保持 16px（Phase1 §6.4 例外 1）',
        /borderRadius:\s*'16px'/.test(lab)],
      ['focusRing 宽度 2px / offset 2px 与 styles.css 一致',
        /width:\s*'2px'/.test(lab) && /offset:\s*'2px'/.test(lab)],
    ];
    for (const [name, ok] of checks) {
      say('        ' + verdict(ok) + ' ' + pad(name, 56));
      if (!ok) { complianceFail++; say('        ^ 合规类违规 -> 阻塞'); }
    }
    say('        独立复算: 白字 on indigo 400 #818cf8 = ' + ratio('#ffffff', '#818cf8').toFixed(2) +
      ':1 FAIL；深字 #1e1b4b on 400 = ' + ratio('#1e1b4b', '#818cf8').toFixed(2) +
      ':1 / on 300 #a5b4fc = ' + ratio('#1e1b4b', '#a5b4fc').toFixed(2) + ':1 -> 两套填充路线各自合规');
    say('        口径: 1.3 只检主 UI 的 --accent 白字填充，不对 lab 深字方案报 FAIL。');
  }
}

/* --------------------------------------------------------------------------
 * 1.11 --primary-hover 承载白字填充 —— 保持 v1 不变（PASS 型正向验收）
 * ------------------------------------------------------------------------ */
{
  say('    1.11 --primary-hover 承载白字填充（方案 A 静态检测；M 项适用范围补充，不新开第 16 项）');
  const s = stripComments(fs.readFileSync(STYLES, 'utf8'));
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const hoverRules = [];
  while ((m = ruleRe.exec(s)) !== null) {
    const body = m[2];
    if (/background\s*:\s*var\(\s*--primary-hover\s*\)/i.test(body) &&
      /color\s*:\s*var\(\s*--on-primary\s*\)/i.test(body)) {
      hoverRules.push({
        line: lineAt(s, m.index + m[1].length),
        sel: m[1].trim().split('\n').pop().trim().slice(0, 50),
      });
    }
  }
  say('        -> ' + hoverRules.length + ' 处规则（方案 A 落地后应恰好 0 处：hover 不再承载白字填充）');
  for (const h of hoverRules) {
    say('        ' + pad('web/src/styles.css:' + h.line, 42) + ' ' + h.sel);
  }
  const allRefs = (s.match(/--primary-hover/g) || []).length;
  say('        styles.css 内 --primary-hover 出现 ' + allRefs + ' 次（浅定义 / 深定义 / 可能的 background / border-color）');
  say('        [INFO] 浅 #4338ca + 白字 = ' + ratio('#ffffff', '#4338ca').toFixed(2) +
    ':1 PASS；深 #6366f1 + 白字 = ' + ratio('#ffffff', '#6366f1').toFixed(2) +
    ':1 FAIL（差 0.03 不达 AA）-> 仅深色主题出问题');
  say('        口径: 属 §8-M 的【未列举实例】；不计入 §1.3 的登记值、不新增第 16 项冲突；');
  say('              token 值浅/深保持原样，只改使用位置（同 N 项治理范式）。');
  say('        正向验收: 深色 hover 不改用 --primary-hover，白字保持 6.29:1 -> §2 第 27 组 PASS；');
  say('              现状 4.47:1 违规由 §1.3b 通用枚举持续覆盖，落地后自动归零（防止改回 --primary-hover）。');
  const tokenKept = /--primary-hover:\s*#4338ca/.test(s) && /--primary-hover:\s*#6366f1/.test(s);
  say('        ' + verdict(tokenKept) + ' --primary-hover token 值浅/深保持原样（零覆盖 / 零 token 改动）');
  if (!tokenKept) { complianceFail++; say('        ^ 合规类违规 -> 阻塞'); }
  say('        [新增发现·待主理人复核] border-color:var(--accent) 装饰描边实算：');
  say('          浅色 #4f46e5 对底 #4f46e5 = ' + ratio('#4f46e5', '#4f46e5').toFixed(2) + ':1（同色不可见）；');
  say('          深色 #a5b4fc 对底 #4f46e5 = ' + ratio('#a5b4fc', '#4f46e5').toFixed(2) + ':1（>=3:1 达标）。');
  say('          A′ 备选：--accent-hover 深 #c7d2fe = ' + ratio('#c7d2fe', '#4f46e5').toFixed(2) +
    ':1 / 浅 #4338ca = ' + ratio('#4338ca', '#4f46e5').toFixed(2) + ':1（浅色不达 3:1，须按主题分开）。');
  say('          本脚本按【方案 A】输出、不擅自切换 A′；双主题两条若都验则组数 27→28，请主理人定夺。');
}

/* --------------------------------------------------------------------------
 * 1.12 硬编码色值（新增）
 *   范围：web/src/app 下所有 .ts —— 组件 scoped 样式块 + TS 字面量
 *   判定：棘轮（登记基线 scoped 110 处 / literal 7 处，只降不升）
 * ------------------------------------------------------------------------ */
{
  say('    1.12 硬编码色值（新增）：web/src/app/**/*.ts 内的裸 hex / rgb() / rgba()');
  say('      口径: 组件 scoped 样式块（styles: `...`）与 TS 字面量分开统计，两类各自棘轮。');
  say('      豁免清单（显式白名单，附理由）:');
  for (const ex of COLOR_EXEMPT) {
    say('        - ' + ex.path);
    say('          理由: ' + ex.reason);
  }
  say('        - web/src/app/core/cover.ts');
  say('          理由: 【未豁免】已核实其 7 处 hex 全在注释里（官方品牌色讨论：Qwen 官方紫 #6950EF、');
  say('                ERNIE 深端 #0439B5 等），剥离注释后命中数为 0，因此保持受检 —— 将来若在');
  say('                此写入真实色值会被当场抓住。');

  /* 定位 styles 属性后的反引号模板字面量区间 */
  function styleTemplates(src) {
    const out = [];
    const re = /\bstyles\s*:\s*/g;
    let mm;
    while ((mm = re.exec(src)) !== null) {
      let i = mm.index + mm[0].length;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '[') {
        i++;
        while (i < src.length) {
          while (i < src.length && /[\s,]/.test(src[i])) i++;
          if (src[i] !== '`') break;
          const s = i; i++;
          while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
          out.push([s, i + 1]); i++;
        }
      } else if (src[i] === '`') {
        const s = i; i++;
        while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
        out.push([s, i + 1]);
      }
    }
    return out;
  }

  const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
  const RGB_RE = /\brgba?\s*\([^)]*\)/g;
  const scopedItems = [];
  const literalItems = [];
  const exemptHits = [];
  for (const f of collectTs(APP_DIR)) {
    const raw = fs.readFileSync(f, 'utf8');
    const r = rel(f);
    const ex = COLOR_EXEMPT.find((x) => x.re.test(r));
    const t = stripComments(raw);
    const spans = styleTemplates(t);
    const inSpan = new Uint8Array(t.length);
    for (const [s, e] of spans) for (let i = s; i < e; i++) inSpan[i] = 1;
    for (const m of [...t.matchAll(HEX_RE), ...t.matchAll(RGB_RE)]) {
      const val = normColor(m[0]);
      const line = lineAt(t, m.index);
      if (ex) { exemptHits.push({ file: r, line, val, exempt: ex.path }); continue; }
      if (inSpan[m.index]) scopedItems.push({ key: r + '|' + val, file: r, line, val });
      else literalItems.push({ key: r + '|' + val, file: r, line, val });
    }
  }

  say('');
  say('      [豁免命中明细]（' + exemptHits.length + ' 处，不计入违规）');
  const exByFile = {};
  for (const h of exemptHits) (exByFile[h.file] ||= []).push(h);
  for (const [f, list] of Object.entries(exByFile).sort()) {
    say('        ' + f + '  ' + list.length + ' 处');
  }

  say('');
  say('      [组件 scoped 样式块内] ' + scopedItems.length + ' 处');
  for (const it of scopedItems) {
    say('        ' + pad(it.file + ':' + it.line, 52) + ' ' + it.val);
  }
  say('      [TS 字面量] ' + literalItems.length + ' 处');
  for (const it of literalItems) {
    say('        ' + pad(it.file + ':' + it.line, 52) + ' ' + it.val);
  }

  const scopedActual = tally(scopedItems);
  const literalActual = tally(literalItems);
  const scopedDetail = Object.entries(scopedActual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.12-scoped', 'ratchet', scopedActual, BASELINE_1_12_SCOPED, scopedDetail);
  const literalDetail = Object.entries(literalActual).map(([k, n]) => k + ' x' + n);
  reportRatchet('1.12-literal', 'ratchet', literalActual, BASELINE_1_12_LITERAL, literalDetail);
}
say('');

/* ==========================================================================
 * 2. 关键对比度实算
 * ========================================================================== */
say(HR2);
say('[2] 关键对比度实算（WCAG 2.x：sRGB 线性化 -> L=0.2126R+0.7152G+0.0722B -> (L1+.05)/(L2+.05)）');
say(HR2);

function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lin(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum(hex) { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(fg, bg) { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }

const PAIRS = [
  ['浅色 UI', '--text #18181b', '#18181b', '--panel #ffffff', '#ffffff', 4.5, '正文，达标'],
  ['浅色 UI', '--text-2 #3f3f46', '#3f3f46', '#ffffff', '#ffffff', 4.5, '正文次级'],
  ['浅色 UI', '--muted #71717a', '#71717a', '#ffffff', '#ffffff', 4.5, '正文勉强达标 4.83'],
  ['浅色 UI', '--faint #a1a1aa', '#a1a1aa', '--ffffff', '#ffffff', 4.5, '【禁止】不得承载文本 §3.5-9'],
  ['浅色 UI', '--placeholder #a1a1aa', '#a1a1aa', '--input-bg #ffffff', '#ffffff', 4.5, '【禁止】占位符改 --muted，但文本保留'],
  ['浅色 UI', '--accent #4f46e5', '#4f46e5', '--ffffff', '#ffffff', 4.5, '文字/图形/焦点实线'],
  ['浅色 UI', '--on-primary #ffffff', '#ffffff', '--primary #4f46e5', '#4f46e5', 4.5, '【硬约束】实心按钮，双主题一致'],
  ['浅色 UI', '--border #e4e4e7', '#e4e4e7', '--ffffff', '#ffffff', 3.0, '【禁止】不可作控件边界 1.4.11'],
  ['浅色 UI', '--border-control #8b8b94', '#8b8b94', '--ffffff', '#ffffff', 3.0, '【新增】非文本控件边界，实算 3.38'],
  ['浅色 UI', '--border-control #8b8b94', '#8b8b94', '--bg #f5f5f6', '#f5f5f6', 3.0, '【新增】实算 3.10'],
  ['深色 UI', '--text #ededf0', '#ededf0', '--panel #141417', '#141417', 4.5, '正文'],
  ['深色 UI', '--text-2 #d4d4d8', '#d4d4d8', '--panel #141417', '#141417', 4.5, '正文次级'],
  ['深色 UI', '--muted #8b8b94', '#8b8b94', '--panel #141417', '#141417', 4.5, '所有深色表面达标'],
  ['深色 UI', '--faint #5f5f68', '#5f5f68', '--panel #141417', '#141417', 4.5, '【禁止】不得承载文本'],
  ['深色 UI', '--accent #a5b4fc', '#a5b4fc', '--panel #141417', '#141417', 4.5, '文字/图形色（300 档）'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--primary #4f46e5', '#4f46e5', 4.5, '【硬约束】深色 --primary 保持 600 不翻'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--accent #a5b4fc', '#a5b4fc', 4.5, '【禁止组合】错误用法 FAIL'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--accent-hover #c7d2fe', '#c7d2fe', 4.5, '【禁止组合】更差 FAIL'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', 'button.primary:hover(方案A)→--primary #4f46e5', '#4f46e5', 4.5, '【方案 A 正向验收】深色 hover 不改用 --primary-hover(#6366f1 4.47:1 FAIL，见 1.3b/1.11)；白字 6.29:1 PASS，双主题一致、零 token 改动'],
  ['深色 UI', '--border-control #8b8b94', '#8b8b94', '--panel #141417', '#141417', 3.0, '【新增】实算 5.44'],
  ['lab 边界', '--on-primary #ffffff', '#ffffff', 'indigo 400 #818cf8', '#818cf8', 4.5, '【禁止组合】白字 on 400 FAIL；不得把 lab primary 改白字'],
  ['lab 边界', 'contrastColor #1e1b4b', '#1e1b4b', 'indigo 400 #818cf8', '#818cf8', 4.5, '【合规路线】lab 亮底 + 深字，实算 5.36；1.3 不对此报 FAIL'],
  ['lab 边界', 'contrastColor #1e1b4b', '#1e1b4b', 'indigo 300 #a5b4fc', '#a5b4fc', 4.5, '【合规路线】M1-g 归一后目标，实算 8.02；contrastColor 保持不变'],
  ['品牌层', '--brand-ink #1b1b1e', '#1b1b1e', '--brand-paper #f8f6f1', '#f8f6f1', 4.5, '字标，实算 15.91'],
  ['品牌层', '--brand-muted #6d6a64', '#6d6a64', '--brand-paper #f8f6f1', '#f8f6f1', 4.5, '辅助文字，实算 4.99'],
  ['品牌层', '--brand-ink-reverse #f1ede4', '#f1ede4', '--brand-paper-reverse #15151a', '#15151a', 4.5, '反白，实算 15.57'],
  ['品牌层', '--brand-line #dedbd3', '#dedbd3', '--brand-paper #f8f6f1', '#f8f6f1', 0, '仅 1px 装饰细线，非文本（豁免）'],
];

const COL = [10, 34, 30, 9, 7, 8];
function row(cells) { return '    ' + cells.map((c, i) => pad(c, COL[i])).join(' '); }
say(row(['主题', '前景', '背景', '实算', '阈值', '判定']));
say('    ' + HR2.slice(0, 96));
let pass = 0, fail = 0, info = 0;
for (const [grp, fgName, fg, bgName, bg, thr, note] of PAIRS) {
  const v = ratio(fg, bg);
  const mark = thr === 0 ? 'INFO' : (v >= thr ? 'PASS' : 'FAIL');
  if (mark === 'PASS') pass++; else if (mark === 'FAIL') fail++; else info++;
  say(row([grp, fgName, bgName, v.toFixed(2) + ':1', thr === 0 ? 'n/a' : thr.toFixed(1), mark]));
  say('      ' + note);
}
say('');
say('    小计: PASS ' + pass + ' / FAIL ' + fail + ' / INFO ' + info + '（共 ' + PAIRS.length + ' 组，>= 任务要求的 10 组）');
say('    FAIL 说明: 7 个 FAIL 全部为 Phase2 §3.2 已登记的【现状违规 / 禁止组合】（ux-designer 核实口径），');
say('      代表 M1（--faint 引用、--accent 白字填充）与 M2（--border-control 落地）待修项；品牌层六枚全部达标，');
say('      印证「不达标集中在使用位置，不是色板」—— 因此修正不改任何 token 色值。');
say('      「lab 边界」组的 1 个 FAIL 是【禁止组合示例】（白字 on indigo 400），不是 lab 现状违规：');
say('      lab 现状为「亮靛紫底 + #1e1b4b 深字」，同组另 2 行实算 PASS，由 1.10 做正向验收。');
say('      两套实心填充路线各自合规、字色相反，不得拉齐成同一个白字方案（Phase1 v1.1 §7.3）。');
say('      【主理人裁决方案 A】第 27 组为正向验收 PASS：深色 button.primary:hover 不改用');
say('      --primary-hover(#6366f1 4.47:1 FAIL)，白字保持 --primary 6.29:1。该现状违规改由');
say('      §1.3b 通用枚举 + §1.11 静态检测持续覆盖，因此 §2 的 FAIL 保持 7、不登记第 8 个；');
say('      不新增第 16 项冲突、不改任何 token 色值（M 项适用范围补充）。');
say('      [现状快照] 本节不参与退出码判定（其违规项已由 §1 的合规判定/棘轮覆盖）。');
say('');

/* ==========================================================================
 * 3. 交付物校验 —— 两份 token 文件各自校验
 * ========================================================================== */
say(HR2);
say('[3] 交付物校验：两份 token 文件');
say('    3A = 设计层 artifacts/vis/vis-tokens.css（Phase1/2 交付物，18 个赋值变量）');
say('    3B = 生效层 web/src/vis-tokens.css（真正接入构建，136 个赋值变量，三层结构）');
say(HR2);

const stylesCss = fs.existsSync(STYLES) ? fs.readFileSync(STYLES, 'utf8') : '';
const varsOf = (src) => new Set([...src.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));

function rootBlocks(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim().split('\n').pop().trim();
    if (!/^:root/.test(sel)) continue;
    const vm = new Map();
    for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) vm.set(d[1], d[2].trim());
    out.push({ sel, vm });
  }
  return out;
}

/* 解析 var() 链，得到最终字面值。
   fallback：primitive 层（--pri-*）是主题无关的、只在 :root 声明一次，
   因此深色块里引用 --pri-* 时必须回退到浅色 map 查值（与 CSS 继承一致）。 */
function resolveVal(map, name, depth = 0, fallback = null) {
  if (depth > 10) return null;
  let v = map.get(name);
  if (v === undefined && fallback) v = fallback.get(name);
  if (v === undefined) return null;
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(v);
  if (m) return resolveVal(map, m[1], depth + 1, fallback);
  return v;
}

function tokenReport(title, file, kind) {
  say('');
  say('  ' + title + ' —— ' + rel(file));
  if (!fs.existsSync(file)) {
    say('    [FAIL] 文件不存在');
    deliverableFail++;
    return null;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const t = stripComments(raw);
  const styleVars = varsOf(stripComments(stylesCss));
  const tokenVars = varsOf(t);
  const overlap = [...tokenVars].filter((v) => styleVars.has(v)).sort();
  const added = [...tokenVars].filter((v) => !styleVars.has(v)).sort();
  const blocks = rootBlocks(t);
  const light = blocks.find((b) => b.sel === ':root')?.vm || new Map();
  const dark = blocks.find((b) => /data-theme/.test(b.sel))?.vm || new Map();

  say('    赋值 --* 变量: ' + tokenVars.size + ' 个（浅 :root ' + light.size +
    ' / 深 :root[data-theme=dark] ' + dark.size + '）');
  say('    [3.1 零覆盖] 与 web/src/styles.css 赋值变量名的交集: ' + overlap.length + ' 个 ' +
    (overlap.length ? '-> ' + overlap.join(', ') : ''));
  say('    判定: ' + verdict(overlap.length === 0) + ' ZERO-OVERRIDE / 零覆盖承诺');
  if (overlap.length) deliverableFail++;

  const opens = (raw.match(/\/\*/g) || []).length;
  const closes = (raw.match(/\*\//g) || []).length;
  const checks = [];
  checks.push(['CSS 注释配对', opens === closes, 'open=' + opens + ' close=' + closes]);

  if (kind === 'design') {
    /* 设计层：Inter 与 Barlow 均要求生效 */
    const faces = (t.match(/@font-face\b/g) || []).length;
    checks.push(['@font-face 恰好 2 条（Barlow + Inter 均生效）', faces === 2, faces + ' 条']);
    checks.push(['Barlow 仅声明 font-weight:400',
      /font-family:\s*"Barlow Condensed"[\s\S]{0,200}?font-weight:\s*400\b/.test(t), '']);
    checks.push(['Inter 声明 font-weight:100 900',
      /font-family:\s*"Inter"[\s\S]{0,200}?font-weight:\s*100 900\b/.test(t), '']);
    const swaps = (t.match(/font-display:\s*swap/g) || []).length;
    checks.push(['两条均 font-display:swap', swaps === 2, swaps + ' 处']);
  } else {
    /* 生效层：M0 暂缓裁决 —— Inter 以注释块保留、尚未生效 */
    const faces = (t.match(/@font-face\b/g) || []).length;
    checks.push(['@font-face 恰好 1 条生效（Barlow Condensed 400）', faces === 1, faces + ' 条生效']);
    const interCommented = /@font-face\s*\{[^}]*font-family:\s*"Inter"[^}]*font-weight:\s*100 900/s.test(raw);
    checks.push(['Inter 声明以注释块保留、未生效（M0 暂缓 · 主理人裁决 2）', interCommented, '']);
    checks.push(['Barlow 仅声明 font-weight:400',
      /font-family:\s*"Barlow Condensed"[\s\S]{0,200}?font-weight:\s*400\b/.test(t), '']);
    const swaps = (t.match(/font-display:\s*swap/g) || []).length;
    checks.push(['生效 font-display:swap 恰好 1 处（Barlow）', swaps === 1, swaps + ' 处']);
    /* 三层结构（生效层专有） */
    const priL = [...light.keys()].filter((k) => k.startsWith('--pri-'));
    const semL = [...light.keys()].filter((k) => k.startsWith('--sem-'));
    const cmpL = [...light.keys()].filter((k) => k.startsWith('--cmp-'));
    const priWithVar = priL.filter((k) => /var\(/i.test(light.get(k) || ''));
    checks.push(['primitive 层存在且不含 var()（不可再分）',
      priL.length > 0 && priWithVar.length === 0,
      '--pri-* ' + priL.length + ' 个，含 var() 的 ' + priWithVar.length + ' 个']);
    const semBad = semL.filter((k) => {
      const v = light.get(k) || '';
      if (!/var\(/i.test(v)) return false;
      return [...v.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1])
        .some((r) => !r.startsWith('--pri-'));
    });
    checks.push(['semantic 层只引用 --pri-*（不链式引用其它 semantic）',
      semL.length > 0 && semBad.length === 0,
      '--sem-* ' + semL.length + ' 个，越界 ' + semBad.length + ' 个']);
    checks.push(['component 层本轮不赋值（--cmp-* = 0，符合文件头声明）',
      cmpL.length === 0, '--cmp-* ' + cmpL.length + ' 个']);
    const semD = [...dark.keys()].filter((k) => k.startsWith('--sem-'));
    const missing = semL.filter((k) => !semD.includes(k));
    const colorMissing = missing.filter((k) => {
      const v = light.get(k) || '';
      const res = resolveVal(light, k) || v;
      return /^#[0-9a-fA-F]{3,8}$/i.test(res);
    });
    checks.push(['深色 semantic 缺的仅限非颜色 token（半径/宽度可继承）',
      colorMissing.length === 0,
      '缺 ' + missing.length + ' 个（颜色类 ' + colorMissing.length + ' 个）']);
  }

  checks.push(['四个 URL 变量占位期均为 none（无字形）',
    ['--brand-logo-light', '--brand-logo-dark', '--brand-icon-light', '--brand-icon-dark']
      .every((v) => light.get(v) === 'none'), '']);
  checks.push(['三个标识常量存在',
    ['--brand-clear-space', '--brand-min-width', '--brand-icon-min'].every((v) => light.has(v)),
    '--brand-min-width=' + light.get('--brand-min-width') +
    ' / --brand-icon-min=' + light.get('--brand-icon-min')]);
  checks.push(['生效 CSS 不含组件实现规则（只有 @font-face + :root）',
    !/\.[A-Za-z][\w-]*\s*\{/.test(t.replace(/(@font-face\s*|:root[^{]*)\{[^{}]*\}/g, '')), '']);
  checks.push(['生效 CSS 无 filter:invert()', !/filter\s*:\s*invert\s*\(/i.test(t), '']);
  checks.push(['生效 CSS 无实验稿字形/月桂引用',
    !/(design-options|r2-|Cormorant|smallcaps|designkit|laurel)/i.test(t), '']);

  say('    自身完整性自检：');
  for (const [name, ok, extra] of checks) {
    say('      ' + verdict(ok) + ' ' + pad(name, 52) + (extra || ''));
    if (!ok) deliverableFail++;
  }
  return { light, dark, tokenVars, added };
}

const designInfo = tokenReport('3A 设计层', TOKENS_DESIGN, 'design');
const effectiveInfo = tokenReport('3B 生效层', TOKENS_EFFECTIVE, 'effective');

/* ---- 3C 交叉校验：设计层的 18 个名字必须在生效层存在，且解析后字面值一致 ---- */
say('');
say('  3C 交叉校验：设计层 18 个变量名 vs 生效层');
if (!designInfo || !effectiveInfo) {
  say('    [FAIL] 文件缺失，无法交叉校验');
  deliverableFail++;
} else {
  const missing = [...designInfo.tokenVars].filter((v) => !effectiveInfo.tokenVars.has(v));
  say('    设计层变量名在生效层缺失: ' + missing.length + ' 个 ' +
    (missing.length ? '-> ' + missing.join(', ') : ''));
  say('    判定: ' + verdict(missing.length === 0) + ' 设计层交付物已在生效层落地');
  if (missing.length) deliverableFail++;

  let diffs = 0;
  for (const v of designInfo.tokenVars) {
    const dL = resolveVal(designInfo.light, v, 0, designInfo.light);
    const dD = resolveVal(designInfo.dark, v, 0, designInfo.light);
    const eL = resolveVal(effectiveInfo.light, v, 0, effectiveInfo.light);
    const eD = resolveVal(effectiveInfo.dark, v, 0, effectiveInfo.light);
    if (dL !== eL || dD !== eD) {
      diffs++;
      say('      [DIFF] ' + v + ': 设计层(浅 ' + dL + ' / 深 ' + dD +
        ') vs 生效层(浅 ' + eL + ' / 深 ' + eD + ')');
    }
  }
  say('    解析后字面值不一致: ' + diffs + ' 个（var() 链已展开）');
  say('    判定: ' + verdict(diffs === 0) + ' 两层 token 语义一致');
  if (diffs) deliverableFail++;
}
say('');
say('    注：接入片段（.brand-wordmark / :host-context 反白切换）全部写在注释中，');
say('        因此 token 文件不会被误当成已落地的组件实现。');
say('');

/* ==========================================================================
 * 4. SUMMARY
 * ========================================================================== */
say(HR);
say('[4] SUMMARY');
say(HR);
say('  合规判定（违规必须 0 / 目标态精确成立）: ' +
  (complianceFail - regressionFail === 0 ? '全部 PASS' : (complianceFail - regressionFail) + ' 项 FAIL（阻塞，退出码 2）'));
say('  棘轮超基线（新增违规，只降不升）: ' +
  (regressionFail === 0 ? '无新增违规' : regressionFail + ' 处新增（阻塞，退出码 2）'));
say('  棘轮旧债（已登记、仍在）: ' +
  (debtCount === 0 ? '无旧债残留' : debtCount + ' 处（仅提示，退出码 1）'));
say('  交付物校验（两份 token 文件 + 交叉校验）: ' +
  (deliverableFail === 0 ? '全部 PASS' : deliverableFail + ' 项 FAIL（阻塞，退出码 2）'));
say('  对比度实算: PASS ' + pass + ' / FAIL ' + fail + ' / INFO ' + info + '（共 ' + PAIRS.length + ' 组，不参与退出码）');
say('');
say('  §1 判定语义分类一览：');
say('    1.1  styles.css 字重 = 合规判定(0)  |  组件 scoped = 棘轮(基线 11)');
say('    1.2  styles.css --faint/--placeholder = 合规判定(0/0)  |  组件 scoped = 棘轮(基线 23)');
say('    1.3  --accent 白字填充 = 棘轮(基线 1)');
say('    1.3b 白字填充通用枚举 AA = 棘轮(基线 1)');
say('    1.4  filter:invert = 合规判定(0)');
say('    1.5  .brand-wordmark 实例 = 合规判定(恰好 1)');
say('    1.6  styles.css 圆角中间档 = 合规判定(0)  |  组件 scoped = 棘轮(基线 21)');
say('    1.7  prefers-reduced-motion = 现状快照');
say('    1.8  @font-face = 现状快照');
say('    1.9a stroke-width:1.6 = 棘轮(基线 1)');
say('    1.9b 新增 token 引用 = 落地进度(>0 即已落地)');
say('    1.10 lab 裁决 G 正向验收 = 合规判定(PASS 型，不变)');
say('    1.11 --primary-hover token 值 = 合规判定(PASS 型，不变)');
say('    1.12 硬编码色值 = 棘轮(scoped 基线 110 / literal 基线 7)');
say('');
say('  退出码约定: 0=全通过 / 1=仅现状基线 FAIL（旧债仍在，不阻塞） /');
say('              2=合规类 FAIL（新违规或合规项不达标，阻塞） / 3=脚本自身出错');
say(HR);

/* --------------------------------------------------------------------------
 * 退出码：合规类 > 交付物 > 旧债 > 全通过
 * ------------------------------------------------------------------------ */
let code = 0;
if (complianceFail > 0 || deliverableFail > 0) code = 2;
else if (debtCount > 0) code = 1;
say('  EXIT CODE = ' + code);

/* --------------------------------------------------------------------------
 * 输出 + 可选写报告
 * ------------------------------------------------------------------------ */
const text = OUT.join('\n') + '\n';
process.stdout.write(text);

if (WRITE_REPORT) {
  try {
    fs.writeFileSync(REPORT_FILE, text, 'utf8');
    process.stdout.write('  已写入报告: ' + rel(REPORT_FILE) + '\n');
  } catch (e) {
    process.stdout.write('  写入报告失败: ' + e.message + '\n');
    process.exit(3);
  }
}

process.exit(code);
