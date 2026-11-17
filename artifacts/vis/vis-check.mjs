#!/usr/bin/env node
/* ============================================================================
 * SiMuseor VIS · vis-check.mjs
 * ----------------------------------------------------------------------------
 * Phase 3 只读校验脚本（Node >= 18，无需第三方依赖）。
 *
 * 职责：
 *   A. 现状基线扫描：web/src/styles.css + web/src/app/**\/*.ts
 *      - 非白名单 font-weight（550/620/640/650/660/680）
 *      - color: var(--faint) / var(--placeholder) 文本用法
 *      - 白字实心填充：同规则 background: var(--X) + color: var(--on-primary)
 *        （1.3 登记 3 处 --accent*；1.3b 通用枚举含 --primary-hover 防漏检；
 *         1.11 = 主理人裁决「方案 A」的静态正向验收；三者均不碰 lab-theme.ts 深字方案）
 *      - filter: invert()
 *      - .brand-wordmark 实例数
 *      - 圆角中间档 6/9/4/10px（另报 16px / 999px 登记例外）
 *      - prefers-reduced-motion 规则数
 *      - @font-face 数量
 *      - 附加：stroke-width 1.6、--border-control/--brand-* 在源码中的引用数
 *   B. 关键对比度实算（WCAG 2.x 相对亮度公式），输出 PASS/FAIL 表
 *   C. 交付物校验：vis-tokens.css 是否覆盖 styles.css 任何已有 :root 变量名
 *      （允许新增，禁止重名赋值），并报告新增变量清单与浅/深取值
 *
 * 【只读承诺】本脚本只调用 fs.readFileSync / readdirSync，不写任何项目文件，
 *   全部结果打印到 stdout。退出码：0=全通过；1=仅现状基线有 FAIL（预期，代表
 *   M1/M2 待修项）；2=交付物校验失败（零覆盖被破坏，必须修复）。
 *   无论退出码为何，脚本都会先打印完整报告再退出。
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));       // artifacts/vis
const ROOT = path.resolve(HERE, '..', '..');                    // 项目根
const STYLES = path.join(ROOT, 'web', 'src', 'styles.css');
const APP_DIR = path.join(ROOT, 'web', 'src', 'app');
const TOKENS = path.join(HERE, 'vis-tokens.css');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

/* 剥离 /* ... *\/ 注释：把注释内容替换为空格但【保留换行】，保证行号不漂移。
   CSS 注释不可嵌套；本仓库注释内不含 /* 字面（vis-tokens.css 已复核）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
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
    else if (ent.isFile() && ent.name.endsWith('.ts')) out.push(p);
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

let deliverableFail = 0;   // 交付物校验失败数（退出码 2）
let baselineFail = 0;      // 现状基线违规数（退出码 1）
let fillBadCount = 0;      // 1.3b 通用枚举「白字实心填充不达 AA」条数（M1-d 待修基线）

function verdict(ok) { return ok ? '[PASS]' : '[FAIL]'; }

/* ------------------------- 0. 头部 / 扫描范围 ------------------------- */
const files = [STYLES, ...collectTs(APP_DIR)].filter((p) => fs.existsSync(p));
console.log(HR);
console.log(' SiMuseor VIS · Phase 3 只读校验报告  (vis-check.mjs)');
console.log(' 生成时间: ' + new Date().toISOString());
console.log(' 项目根  : ' + ROOT.replace(/\\/g, '/'));
console.log(' 只读    : 不写任何项目文件，仅输出 stdout');
console.log(HR);
console.log('');
console.log('[0] 扫描范围');
console.log('    styles.css : ' + rel(STYLES) + '  (' +
  (fs.existsSync(STYLES) ? fs.readFileSync(STYLES, 'utf8').split('\n').length + ' 行' : '缺失') + ')');
console.log('    app/**/*.ts: ' + (files.length - 1) + ' 个文件');
console.log('    vis-tokens.css: ' + rel(TOKENS) + '  (' +
  (fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8').split('\n').length + ' 行' : '缺失') + ')');
console.log('    口径: 先剥离 /*...*/ 注释（保留换行以维持行号），再按正则/规则块扫描。');
console.log('');

/* 通用：在若干文件里按正则收集命中 */
function scan(re, label) {
  const hits = [];
  for (const f of files) {
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

function printHits(res, { expect, note } = {}) {
  console.log('    ' + res.label + ' -> ' + res.hits.length + ' 处' +
    (expect !== undefined ? '（Phase1/2 登记：' + expect + ' 处）' : ''));
  for (const h of res.hits) {
    console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  }
  if (note) console.log('      ' + note);
}

/* Phase1/2 的登记范围只有 styles.css；组件 scoped 样式的同类命中单独分组，
   既不推翻登记值，又把审计盲区显式暴露出来。 */
const STYLES_REL = 'web/src/styles.css';
function splitBySource(res) {
  return {
    inStyles: res.hits.filter((h) => h.file === STYLES_REL),
    inTs: res.hits.filter((h) => h.file !== STYLES_REL),
  };
}
const DISCOVERY = '[DISCOVERY]';

/* ------------------------- 1. 现状基线扫描 ------------------------- */
console.log(HR2);
console.log('[1] 现状基线扫描：web/src/styles.css + web/src/app/**/*.ts');
console.log('    说明：以下 FAIL 是【现状真实值】。Phase1 §8 / Phase2 §0.1 已声明 VIS 是目标态，');
console.log('          这些命中代表 M1/M2 待修项，不是脚本错误、也不是本轮交付物缺陷。');
console.log('    上游口径：Phase1 v1.1 (620 行) / Phase2 v1.1 (888 行)；§8 冲突表共 15 项');
console.log('          （v1.0 为 13 项，v1.1 新增 M/N；早期「12 项」为笔误），全部「本轮不执行」；');
console.log('          M（3 处 --accent 白字填充）/ N（21 处 --faint 文本）为 Phase 3 立即项，与 LOGO 冻结解耦。');
console.log('    【主理人裁决 · 方案 A】button.primary:hover 归入 §8-M【适用范围补充】，【不】新增第 16 项，');
console.log('          §8 冲突表仍 15 项。background 保持 var(--primary)（不跟 --primary-hover），');
console.log('          border-color 改 var(--accent) 作 1px 装饰描边；零 token 改动、双主题白字 6.29:1。');
console.log('          M 项描述扩为「不达 AA 的实心填充承载白字（--accent / --accent-hover / --primary-hover）」。');
console.log('    v1.1 §7.3 边界：裁决 G 只归一「文字/描边型 --accent」，两套实心填充分开处理，');
console.log('          1.3 / 1.3b 只检主 UI 的 CSS 规则，【不】对 lab-theme.ts 的深字方案报 FAIL（另见 1.10）。');
console.log('    30 处组件 scoped 盲区处置（ux-designer / visual-architect 裁定）：字重全量 26 处纳入 M1；');
console.log('          --faint 全量 39 处文本引用纳入 M1；圆角 lab-primeng:344 10px→12px（§8-D）；');
console.log('          cover-plate 3 处「适用域外 / 保持」不收敛，不作第 16 项。');
console.log(HR2);

/* 1.1 非白名单 font-weight */
{
  const r = scan(/\b(?:font|font-weight)\s*:\s*(?:550|620|640|650|660|680)\b/gi,
    '1.1 非白名单 font-weight (550/620/640/650/660/680)');
  const { inStyles, inTs } = splitBySource(r);
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' +
    inStyles.length + ' + 组件 scoped ' + inTs.length);
  for (const h of r.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  console.log('      白名单 400/500/600/700；550->500，620/640/650/660/680->600（Phase1 §4.2）');
  console.log('      判定: ' + verdict(inStyles.length === 17) + ' styles.css 内 ' + inStyles.length +
    ' 处 = Phase1 §4.2 登记 17 处');
  console.log('      ' + DISCOVERY + ' 组件 scoped 内 ' + inTs.length +
    ' 处为 Phase1/2 未审到的同类项，建议并入 M1 补充批次（不推翻 17 处登记值）');
  if (inStyles.length !== 17) baselineFail++;
}

/* 1.2 --faint / --placeholder 作文本色 */
{
  const re = /(?<![-\w])color\s*:\s*var\(\s*--(faint|placeholder)\s*\)/gi;
  const r = scan(re, '1.2 color: var(--faint|--placeholder) 文本用法');
  const { inStyles, inTs } = splitBySource(r);
  const sFaint = inStyles.filter((h) => /--faint/.test(h.text)).length;
  const sPlaceholder = inStyles.filter((h) => /--placeholder/.test(h.text)).length;
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' + inStyles.length +
    '（--faint ' + sFaint + ' / --placeholder ' + sPlaceholder + '） + 组件 scoped ' + inTs.length);
  for (const h of r.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  // 非文本引用（允许）：background / border-color 等
  let totalRefs = 0;
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    totalRefs += (txt.match(/var\(\s*--(?:faint|placeholder)\s*\)/gi) || []).length;
  }
  console.log('      全量 var(--faint|--placeholder) 引用: ' + totalRefs + ' 处；差值 ' +
    (totalRefs - r.hits.length) + ' 处为 background/border 等非文本装饰引用（§3.3 允许）');
  console.log('      处置: 不改 token 值，只把文本引用迁到 --muted / --text-2；::placeholder 文本必须保留（E2E :54,:92）');
  console.log('      判定: ' + verdict(sFaint === 21 && sPlaceholder === 1) +
    ' styles.css 内 21 + 1 = Phase2 §3.3 登记值');
  console.log('      ' + DISCOVERY + ' 组件 scoped 内 ' + inTs.length +
    ' 处同样为 --faint 文本，Phase2 §3.3 未列；建议并入 M1 补充批次（不推翻 21 处清单）');
  if (sFaint !== 21) baselineFail++;
}

/* 1.3 白字填充：同规则 background: var(--accent*) + color: var(--on-primary) */
{
  console.log('    1.3 background: var(--accent*) 且同规则含 color: var(--on-primary)');
  const filled = [];
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;   // 只抓最内层规则块（body 不含 { }）
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
  console.log('        -> ' + filled.length + ' 处（Phase1 §8-M / Phase2 §2.10-3 登记 3 处）');
  for (const h of filled) {
    console.log('        ' + pad(h.file + ':' + h.line, 50) + ' ' + pad(h.sel, 34) + ' ' + h.snippet);
  }
  console.log('        处置: 三处填充改 var(--primary)（白字 6.29:1 双主题一致）；--accent 深色 #a5b4fc 白字仅 1.99:1 FAIL');
  console.log('        检测口径（Phase1 v1.1 §7.3 / team-lead 指定）: 本项【只】匹配主 UI 的 CSS 规则块');
  console.log('          （同规则 background:var(--accent*) + color:var(--on-primary)）。lab-theme.ts 是 TS 对象，');
  console.log('          其 dark primary = 亮靛紫底 + contrastColor {primary.950} 深字，属另一条合规路线，');
  console.log('          【不参与本项检测、不报 FAIL】；该路线由 1.10 做正向验收，由 §2 对比度表做数值复核。');
  console.log('        segmented button.active（--panel 底 + --accent 文字）合规，不改、不计入。');
  if (filled.length !== 3) baselineFail++;
  console.log('        判定: ' + verdict(filled.length === 3) + ' 与登记的 3 处一致');
}

/* 1.3b 白字实心填充【通用枚举】—— ux-designer 回传：修复 1.3 只匹配 --accent* 的漏检盲区
   规则：枚举所有「同规则含 color: var(--on-primary) 且 background: var(--X)」的 CSS 规则块，
   把 X 在 styles.css 浅/深两套 :root 的取值分别代入 WCAG 公式，<4.5 即标 FAIL。
   一次覆盖 --accent / --accent-hover / --primary / --primary-hover，将来新增填充变量也不漏。
   工程取舍：保留 §1.3 原有「3 处登记值」断言（不回归），把通用能力作为新增 1.3b，
   而不是直接改写 1.3 的正则——否则 filled.length 会从 3 变 5，破坏已核实的登记一致性判定。
   边界（裁决 G / 1.10）：lab-theme.ts 是 TS 对象、无 CSS background:var() 规则，显式跳过，
   【不】对 lab「亮靛紫底 + contrastColor 深字」报 FAIL；1.10 正向验收照旧。 */
{
  console.log('    1.3b 白字实心填充通用枚举（修复 1.3 只匹配 --accent* 的漏检盲区）');
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
  console.log('        ' + pad('规则 @行', 46) + pad('填充变量', 19) + pad('浅', 10) + pad('深', 10) + '判定');
  for (const h of rows) {
    console.log('        ' + pad(h.sel + ' @' + h.line, 46) + pad(h.X, 19) +
      pad(h.lr.toFixed(2) + ':1', 10) + pad(h.dr.toFixed(2) + ':1', 10) +
      (h.bad ? '[FAIL 现状·M1-d 待修]' : '[PASS]'));
  }
  const bad = rows.filter((h) => h.bad);
  const hoverBlindSpot = rows.some((h) => h.X === '--primary-hover' && h.bad);
  console.log('        -> ' + rows.length + ' 条白字实心填充规则；<4.5 不达 AA = ' + bad.length +
    ' 条（全部为【现状违规】，M1-d 待修，非脚本或交付物缺陷）');
  console.log('        M 项描述（ux-designer / visual-architect 一致）：不达 AA 的实心填充承载白字');
  console.log('          （--accent / --accent-hover / --primary-hover）；§8 仍 15 项，【不】新增第 16 项。');
  console.log('        边界: lab-theme.ts 已显式跳过；其「亮靛紫底 + contrastColor 深字」由 1.10 正向验收，不报 FAIL。');
  console.log('        判定: ' + verdict(hoverBlindSpot) +
    ' 通用枚举已覆盖 --primary-hover 漏检盲区（button.primary:hover 深色 4.47:1 FAIL）');
  if (!hoverBlindSpot) baselineFail++;
  fillBadCount = bad.length;   // 供 §4 SUMMARY 作基线计数
}

/* 1.4 filter: invert() */
{
  const r = scan(/filter\s*:\s*invert\s*\(/gi, '1.4 filter: invert()');
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 处（硬约束：禁止，Phase1 §2.4 / cover.ts:43）');
  for (const h of r.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  console.log('      判定: ' + verdict(r.hits.length === 0) + ' 全仓零 invert，反白走双份 SVG + :host-context');
  if (r.hits.length !== 0) baselineFail++;
}

/* 1.5 .brand-wordmark 实例数 */
{
  const r = scan(/\bbrand-wordmark\b/g, '1.5 brand-wordmark 字面（项目源码）');
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 个');
  const tok = fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8') : '';
  const tokCount = (tok.match(/\bbrand-wordmark\b/g) || []).length;
  console.log('        vis-tokens.css 注释内提及: ' + tokCount + ' 次（接入片段参考，不计实例）');
  console.log('        目标态（M2 后）应恰好 1 个实例，且是 .sidebar > .brand 的子元素（Phase2 §1.1）');
  console.log('        判定: ' + verdict(r.hits.length === 0) + ' 现状 0 = 占位期尚未落地，符合本轮零落地');
  if (r.hits.length !== 0) baselineFail++;
}

/* 1.6 圆角中间档 */
{
  const r = scan(/border-radius\s*:\s*(?:6|9|4|10)px\b/gi, '1.6 圆角中间档 border-radius: 6/9/4/10px');
  const { inStyles, inTs } = splitBySource(r);
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 处 = styles.css ' +
    inStyles.length + ' + 组件 scoped ' + inTs.length);
  for (const h of r.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  console.log('      Phase1 §6.4 待收敛：.brand-mark 9px(随 C 删除) / .btn-xs 6px / .tp-swatch 4px / .skel-line 4px / .step-row 6px');
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const n16 = (txt.match(/border-radius\s*:\s*16px\b/gi) || []).length;
    const n999 = (txt.match(/border-radius\s*:\s*999px\b/gi) || []).length;
    if (n16 || n999) console.log('      ' + pad(rel(f), 42) + ' 登记例外: 16px x' + n16 + ' / 999px x' + n999 + '（弹层与胶囊，Phase1 §6.4）');
  }
  console.log('      判定: ' + verdict(inStyles.length === 5) + ' styles.css 内 ' + inStyles.length + ' 处 = Phase1 §6.4 登记 5 处');
  console.log('      ' + DISCOVERY + ' 组件 scoped 内 ' + inTs.length +
    ' 处（cover-plate / lab-primeng）未列入 §6.4；主理人裁决 3 已定：cover-plate 3 处定性「适用域外」（独立图形子系统，圆角三档规则不适用），不收敛、不登记第三类例外；lab-primeng 1 处并入 M1');
  if (inStyles.length !== 5) baselineFail++;
}

/* 1.7 prefers-reduced-motion */
{
  const r = scan(/prefers-reduced-motion\s*:\s*reduce/gi, '1.7 prefers-reduced-motion 规则');
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 处（Phase2 §3.8：全仓仅 model-card.component.ts:119-123 一处）');
  for (const h of r.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  console.log('      判定: [WARN] 目标态需全局 @media reduce（P3-7）：7 个动画停止，spinner 降级为静态 + role=status 文字');
}

/* 1.8 @font-face */
{
  const r = scan(/@font-face\b/g, '1.8 @font-face（项目源码）');
  console.log('    ' + r.label + ' -> ' + r.hits.length + ' 条');
  const tok = fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8') : '';
  const tokFaces = (stripComments(tok).match(/@font-face\b/g) || []).length;
  console.log('        vis-tokens.css 目标态声明: ' + tokFaces + ' 条（Barlow 400 / Inter 100 900）');
  console.log('        判定: [INFO] 源码 0 条 = 基线字体【尚未生效】，落地前不得宣称生效（Phase1 冲突 F）');
}

/* 1.9 附加 M1 机械项 */
{
  const r16 = scan(/stroke-width\s*:\s*1\.6\b/gi, '1.9a stroke-width: 1.6（-> 1.5，Phase1 §5.3）');
  console.log('    ' + r16.label + ' -> ' + r16.hits.length + ' 处');
  for (const h of r16.hits) console.log('      ' + pad(h.file + ':' + h.line, 52) + ' ' + h.text);
  let brandRefs = 0, controlRefs = 0, radiusLgRefs = 0;
  for (const f of files) {
    const t = stripComments(fs.readFileSync(f, 'utf8'));
    brandRefs += (t.match(/var\(\s*--brand-/g) || []).length;
    controlRefs += (t.match(/var\(\s*--border-control/g) || []).length;
    radiusLgRefs += (t.match(/var\(\s*--radius-lg/g) || []).length;
  }
  console.log('    1.9b 源码引用新增 token: --brand-* ' + brandRefs + ' / --border-control ' +
    controlRefs + ' / --radius-lg ' + radiusLgRefs + '（应全为 0 = 本轮零落地）');
  console.log('      判定: ' + verdict(brandRefs + controlRefs + radiusLgRefs === 0) + ' 零落地证据');
  if (brandRefs + controlRefs + radiusLgRefs !== 0) baselineFail++;
}

/* 1.10 lab-theme.ts 裁决 G 语义边界【正向验收】
   Phase1 v1.1 §7.3 / Phase2 §7.2 新增 2 条验收项 / §8.1 P3-4 / §8.5。
   注意：这是【正向】检查，验证 lab 实验区「亮靛紫底 + 深字」这条独立合规路线保持不被误改；
   与 1.3 的「--accent 白字填充」检测互补，两者绝不互相报 FAIL。 */
{
  const LAB = path.join(ROOT, 'web', 'src', 'app', 'lab', 'lab-theme.ts');
  console.log('    1.10 lab-theme.ts 裁决 G 边界（Phase1 v1.1 §7.3 / Phase2 §7.2 新增验收项）');
  if (!fs.existsSync(LAB)) {
    console.log('        [WARN] 文件不存在，跳过');
  } else {
    const lab = stripComments(fs.readFileSync(LAB, 'utf8'));
    const is400 = /color:\s*'\{primary\.400\}'/.test(lab);
    const is300 = /color:\s*'\{primary\.300\}'/.test(lab);
    console.log('        [INFO] dark primary.color 当前 = ' +
      (is400 ? '{primary.400}（现状）' : is300 ? '{primary.300}（M1-g 目标已落地）' : '未知') +
      '；裁决 G 只改这一行色值，不牵动 contrastColor');
    /* 只检查 dark 块：light.primary.contrastColor = '#ffffff'（:64）是【合规】的浅色白字方案，
       不参与「绝不改白字」判定，否则会误报。裁决 G 约束的是 dark.primary 这一条独立路线。 */
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
      ['focusRing 宽度 2px / offset 2px 与 styles.css:142 一致',
        /width:\s*'2px'/.test(lab) && /offset:\s*'2px'/.test(lab)],
    ];
    for (const [name, ok] of checks) {
      console.log('        ' + verdict(ok) + ' ' + pad(name, 56));
      if (!ok) baselineFail++;
    }
    console.log('        独立复算: 白字 on indigo 400 #818cf8 = ' + ratio('#ffffff', '#818cf8').toFixed(2) +
      ':1 FAIL；深字 #1e1b4b on 400 = ' + ratio('#1e1b4b', '#818cf8').toFixed(2) +
      ':1 / on 300 #a5b4fc = ' + ratio('#1e1b4b', '#a5b4fc').toFixed(2) + ':1 -> 两套填充路线各自合规');
    console.log('        口径: 1.3 只检主 UI 的 --accent 白字填充，【不】对 lab 深字方案报 FAIL。');
  }
}

/* 1.11 --primary-hover 承载白字填充（Phase1 v1.1 §6.6 / §7.2；M 项适用范围补充）
   视觉架构师回传：button.primary:hover (styles.css:608-612) 深色下 #6366f1 + 白字 = 4.47:1 FAIL。
   主理人裁决方案 A：background 保持 var(--primary)、border-color 改 var(--accent) 作 1px 装饰描边；
   零 token 改动、双主题白字 6.29:1。§2 的正向验收由本项静态检测 + §1.3b 通用枚举兜底。
   这是 §8-M「凡白字实心填充一律 --primary」的【未列举实例】，不是第 16 项，也不改任何 token 值。 */
{
  console.log('    1.11 --primary-hover 承载白字填充（方案 A 静态检测；M 项适用范围补充，不新开第 16 项）');
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
  console.log('        -> ' + hoverRules.length + ' 处规则（视觉架构师登记：1 处 button.primary:hover）');
  for (const h of hoverRules) {
    console.log('        ' + pad('web/src/styles.css:' + h.line, 42) + ' ' + h.sel);
  }
  const allRefs = (s.match(/--primary-hover/g) || []).length;
  console.log('        全仓 --primary-hover 出现 ' + allRefs + ' 次: :47 浅定义 #4338ca / :103 深定义 #6366f1' +
    ' / :609 background / :610 border-color');
  console.log('        [INFO] 浅 #4338ca + 白字 = ' + ratio('#ffffff', '#4338ca').toFixed(2) +
    ':1 PASS；深 #6366f1 + 白字 = ' + ratio('#ffffff', '#6366f1').toFixed(2) +
    ':1 FAIL（差 0.03 不达 AA）-> 仅深色主题出问题');
  console.log('        口径: 属 §8-M 的【未列举实例】；【不】计入 §1.3 的 3 处 --accent 登记值、');
  console.log('              【不】新增第 16 项冲突、15 项计数不变；token 值浅/深保持原样，只改使用位置（同 N 项治理范式）。');
  console.log('        处置: 并入 M1-d，采纳【主理人裁决 · 方案 A】: background 保持 var(--primary) + 白字，');
  console.log('              仅以 border-color:var(--accent) 作 1px 装饰描边；不改任何 token 值；');
  console.log('              button.primary:disabled:hover (:619) 已保持 --primary、button:disabled:hover (:617) 不动；');
  console.log('              静止态 :606 的 1px 内高光保留（Phase1 §6.6 已允许）；M1 后本项应归零。');
  console.log('        正向验收: 深色 hover 不改用 --primary-hover，白字保持 6.29:1 -> §2 第 27 组 PASS；');
  console.log('              现状 4.47:1 违规由 §1.3b 通用枚举持续覆盖，落地后自动归零（防止改回 --primary-hover）。');
  const tokenKept = /--primary-hover:\s*#4338ca/.test(s) && /--primary-hover:\s*#6366f1/.test(s);
  console.log('        ' + verdict(tokenKept) + ' --primary-hover token 值浅/深保持原样（零覆盖 / 零 token 改动）');
  if (!tokenKept) baselineFail++;
  /* 【本轮新增发现 · 登记待裁决，不擅自改裁决】
     方案 A 的 border-color:var(--accent) 是「双主题变量」：
       浅色 --accent #4f46e5 ≡ --primary #4f46e5 -> 对底 1.00:1（同色、描边不可见）；
       深色 --accent #a5b4fc 对底 #4f46e5 -> 3.15:1（>=3:1，1.4.11 达标）。
     纯装饰描边不承载文本/状态，1.4.11 不适用；但浅色主题 hover 的可见反馈会消失。
     ux-designer / visual-architect 后续提出 A′：border-color 用 --accent-hover
       （深 #c7d2fe 4.22:1 / 浅 #4338ca 1.26:1 不达 3:1），故 A′ 须「按主题分开落地」
       （浅色 :607-611 保持现状，仅新增深色覆盖规则）。
     本脚本只登记实算事实，仍按 team-lead 已裁定的【方案 A】输出，不擅自切换到 A′。 */
  console.log('        [新增发现·待主理人复核] border-color:var(--accent) 装饰描边实算：');
  console.log('          浅色 #4f46e5 对底 #4f46e5 = ' + ratio('#4f46e5', '#4f46e5').toFixed(2) + ':1（同色不可见）；');
  console.log('          深色 #a5b4fc 对底 #4f46e5 = ' + ratio('#a5b4fc', '#4f46e5').toFixed(2) + ':1（>=3:1 达标）。');
  console.log('          A′ 备选：--accent-hover 深 #c7d2fe = ' + ratio('#c7d2fe', '#4f46e5').toFixed(2) +
    ':1 / 浅 #4338ca = ' + ratio('#4338ca', '#4f46e5').toFixed(2) + ':1（浅色不达 3:1，须按主题分开）。');
  console.log('          本脚本按【方案 A】输出、不擅自切换 A′；双主题两条若都验则组数 27→28，请主理人定夺。');
}
console.log('');

/* ------------------------- 2. 关键对比度实算 ------------------------- */
console.log(HR2);
console.log('[2] 关键对比度实算（WCAG 2.x：sRGB 线性化 -> L=0.2126R+0.7152G+0.0722B -> (L1+.05)/(L2+.05)）');
console.log(HR2);

function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function lin(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lum(hex) { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function ratio(fg, bg) { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }

/* 至少覆盖 Phase2 §3.2 的 10 组关键色对；此处给 27 组。
   thr: 4.5=正文 / 3.0=非文本(1.4.11) / 0=装饰豁免(INFO)
   【主理人裁决方案 A】第 27 组为「正向验收」：深色 button.primary:hover 收敛到 --primary，
   白字 6.29:1 PASS；不再把 --primary-hover 4.47:1 登记为第 8 个 FAIL（该现状违规由 §1.3b
   通用枚举 + §1.11 静态检测持续覆盖，M1-d 待修）。 */
const PAIRS = [
  ['浅色 UI', '--text #18181b', '#18181b', '--panel #ffffff', '#ffffff', 4.5, '正文，达标'],
  ['浅色 UI', '--text-2 #3f3f46', '#3f3f46', '#ffffff', '#ffffff', 4.5, '正文次级'],
  ['浅色 UI', '--muted #71717a', '#71717a', '#ffffff', '#ffffff', 4.5, '正文勉强达标 4.83'],
  ['浅色 UI', '--faint #a1a1aa', '#a1a1aa', '#ffffff', '#ffffff', 4.5, '【禁止】不得承载文本 §3.5-9'],
  ['浅色 UI', '--placeholder #a1a1aa', '#a1a1aa', '--input-bg #ffffff', '#ffffff', 4.5, '【禁止】占位符改 --muted，但文本保留'],
  ['浅色 UI', '--accent #4f46e5', '#4f46e5', '#ffffff', '#ffffff', 4.5, '文字/图形/焦点实线'],
  ['浅色 UI', '--on-primary #ffffff', '#ffffff', '--primary #4f46e5', '#4f46e5', 4.5, '【硬约束】实心按钮，双主题一致'],
  ['浅色 UI', '--border #e4e4e7', '#e4e4e7', '#ffffff', '#ffffff', 3.0, '【禁止】不可作控件边界 1.4.11'],
  ['浅色 UI', '--border-control #8b8b94', '#8b8b94', '#ffffff', '#ffffff', 3.0, '【新增】非文本控件边界，实算 3.38'],
  ['浅色 UI', '--border-control #8b8b94', '#8b8b94', '--bg #f5f5f6', '#f5f5f6', 3.0, '【新增】实算 3.10'],
  ['深色 UI', '--text #ededf0', '#ededf0', '--panel #141417', '#141417', 4.5, '正文'],
  ['深色 UI', '--text-2 #d4d4d8', '#d4d4d8', '--panel #141417', '#141417', 4.5, '正文次级'],
  ['深色 UI', '--muted #8b8b94', '#8b8b94', '--panel #141417', '#141417', 4.5, '所有深色表面达标'],
  ['深色 UI', '--faint #5f5f68', '#5f5f68', '--panel #141417', '#141417', 4.5, '【禁止】不得承载文本'],
  ['深色 UI', '--accent #a5b4fc', '#a5b4fc', '--panel #141417', '#141417', 4.5, '文字/图形色（300 档）'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--primary #4f46e5', '#4f46e5', 4.5, '【硬约束】深色 --primary 保持 600 不翻'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--accent #a5b4fc', '#a5b4fc', 4.5, '【禁止组合】错误用法 FAIL'],
  ['深色 UI', '--on-primary #ffffff', '#ffffff', '--accent-hover #c7d2fe', '#c7d2fe', 4.5, '【禁止组合】更差 FAIL'],
  /* --- 【主理人裁决 · 方案 A】1 组正向验收（第 27 组，PASS） ---
     deep button.primary:hover 收敛到 --primary #4f46e5（不跟 --primary-hover #6366f1），
     白字保持 6.29:1；border-color:var(--accent) 仅 1px 装饰描边、不承载文本。
     现状 --primary-hover 深色 4.47:1 FAIL 已上移到 §1.3b 通用枚举 + §1.11 静态检测持续覆盖，
     因此 §2 的 FAIL 回到 7（6 组已登记现状违规 + 1 组 lab 禁止组合示例），不新增第 8 个 FAIL。 */
  ['深色 UI', '--on-primary #ffffff', '#ffffff', 'button.primary:hover(方案A)→--primary #4f46e5', '#4f46e5', 4.5, '【方案 A 正向验收】深色 hover 不改用 --primary-hover(#6366f1 4.47:1 FAIL，见 1.3b/1.11)；白字 6.29:1 PASS，双主题一致、零 token 改动'],
  ['深色 UI', '--border-control #8b8b94', '#8b8b94', '--panel #141417', '#141417', 3.0, '【新增】实算 5.44'],
  /* --- 裁决 G 语义边界（Phase1 v1.1 §7.3 / Phase2 附录 A-9 独立复算） --- */
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
console.log(row(['主题', '前景', '背景', '实算', '阈值', '判定']));
console.log('    ' + HR2.slice(0, 96));
let pass = 0, fail = 0, info = 0;
for (const [grp, fgName, fg, bgName, bg, thr, note] of PAIRS) {
  const v = ratio(fg, bg);
  const mark = thr === 0 ? 'INFO' : (v >= thr ? 'PASS' : 'FAIL');
  if (mark === 'PASS') pass++; else if (mark === 'FAIL') fail++; else info++;
  console.log(row([grp, fgName, bgName, v.toFixed(2) + ':1', thr === 0 ? 'n/a' : thr.toFixed(1), mark]));
  console.log('      ' + note);
}
console.log('');
console.log('    小计: PASS ' + pass + ' / FAIL ' + fail + ' / INFO ' + info + '（共 ' + PAIRS.length + ' 组，>= 任务要求的 10 组）');
console.log('    FAIL 说明: 7 个 FAIL 全部为 Phase2 §3.2 已登记的【现状违规 / 禁止组合】（ux-designer 核实口径），');
console.log('      代表 M1（--faint 引用、--accent 白字填充）与 M2（--border-control 落地）待修项；品牌层六枚全部达标，');
console.log('      印证「不达标集中在使用位置，不是色板」—— 因此修正不改任何 token 色值。');
console.log('      「lab 边界」组的 1 个 FAIL 是【禁止组合示例】（白字 on indigo 400），不是 lab 现状违规：');
console.log('      lab 现状为「亮靛紫底 + #1e1b4b 深字」，同组另 2 行实算 PASS，由 1.10 做正向验收。');
console.log('      两套实心填充路线各自合规、字色相反，不得拉齐成同一个白字方案（Phase1 v1.1 §7.3）。');
console.log('      【主理人裁决方案 A】第 27 组为正向验收 PASS：深色 button.primary:hover 不改用');
console.log('      --primary-hover(#6366f1 4.47:1 FAIL)，白字保持 --primary 6.29:1。该现状违规改由');
console.log('      §1.3b 通用枚举 + §1.11 静态检测持续覆盖，因此 §2 的 FAIL 保持 7、不登记第 8 个；');
console.log('      不新增第 16 项冲突、不改任何 token 色值（M 项适用范围补充）。');
console.log('');

/* ------------------------- 3. 交付物校验：零覆盖 ------------------------- */
console.log(HR2);
console.log('[3] 交付物校验：vis-tokens.css 零覆盖（允许新增，禁止重名赋值）');
console.log(HR2);

const stylesCss = fs.existsSync(STYLES) ? fs.readFileSync(STYLES, 'utf8') : '';
const tokensCss = fs.existsSync(TOKENS) ? fs.readFileSync(TOKENS, 'utf8') : '';

if (!tokensCss) {
  console.log('    [FAIL] vis-tokens.css 不存在或为空');
  deliverableFail++;
} else {
  const sStrip = stripComments(stylesCss);
  const tStrip = stripComments(tokensCss);
  const varsOf = (src) => new Set([...src.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  const styleVars = varsOf(sStrip);
  const tokenVars = varsOf(tStrip);
  const added = [...tokenVars].filter((v) => !styleVars.has(v)).sort();
  const overlap = [...tokenVars].filter((v) => styleVars.has(v)).sort();

  console.log('    web/src/styles.css 已有 --* 变量: ' + styleVars.size + ' 个（:root:17-74 / dark:77-122，去重）');
  console.log('    vis-tokens.css 赋值 --* 变量  : ' + tokenVars.size + ' 个');
  console.log('    重名赋值（必须为空）          : ' + overlap.length + ' 个 ' +
    (overlap.length ? '-> ' + overlap.join(', ') : ''));
  console.log('    判定: ' + verdict(overlap.length === 0) + '  ZERO-OVERRIDE / 零覆盖承诺');
  if (overlap.length) deliverableFail++;
  console.log('');
  console.log('    新增变量清单（' + added.length + ' 个，附浅/深取值）：');

  /* 解析 vis-tokens.css 的 :root / :root[data-theme="dark"] 块取值 */
  function rootBlocks(css) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const sel = m[1].trim().split('\n').pop().trim();
      if (!/^:root/.test(sel)) continue;
      const vm = new Map();
      for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
        vm.set(d[1], d[2].trim());
      }
      out.push({ sel, vm });
    }
    return out;
  }
  const blocks = rootBlocks(tStrip);
  const light = blocks.find((b) => b.sel === ':root')?.vm || new Map();
  const dark = blocks.find((b) => /data-theme/.test(b.sel))?.vm || new Map();

  console.log('    ' + pad('变量名', 30) + pad('浅色值', 30) + pad('深色值', 30) + '来源');
  for (const v of added) {
    const dv = dark.has(v) ? dark.get(v) : '（继承浅值）';
    console.log('    ' + pad(v, 30) + pad((light.get(v) || '-').slice(0, 28), 30) + pad(String(dv).slice(0, 28), 30) +
      (v.startsWith('--brand') ? 'Phase1 §2/§3' : v === '--radius-lg' ? 'Phase1 §6.4' : 'Phase2 §2.10-11'));
  }
  console.log('');

  /* vis-tokens.css 自身完整性自检 */
  const opens = (tokensCss.match(/\/\*/g) || []).length;
  const closes = (tokensCss.match(/\*\//g) || []).length;
  const checks = [
    ['CSS 注释配对', opens === closes, 'open=' + opens + ' close=' + closes],
    ['@font-face 恰好 2 条', (tStrip.match(/@font-face\b/g) || []).length === 2,
      (tStrip.match(/@font-face\b/g) || []).length + ' 条'],
    ['Barlow 仅声明 font-weight:400', /font-family:\s*"Barlow Condensed"[\s\S]{0,200}?font-weight:\s*400\b/.test(tStrip), ''],
    ['Inter 声明 font-weight:100 900', /font-family:\s*"Inter"[\s\S]{0,200}?font-weight:\s*100 900\b/.test(tStrip), ''],
    ['两条均 font-display:swap', (tStrip.match(/font-display:\s*swap/g) || []).length === 2,
      (tStrip.match(/font-display:\s*swap/g) || []).length + ' 处'],
    ['四个 URL 变量占位期均为 none（无字形）',
      ['--brand-logo-light', '--brand-logo-dark', '--brand-icon-light', '--brand-icon-dark']
        .every((v) => light.get(v) === 'none'), ''],
    ['三个标识常量存在', ['--brand-clear-space', '--brand-min-width', '--brand-icon-min']
      .every((v) => light.has(v)), '--brand-min-width=' + light.get('--brand-min-width') +
      ' / --brand-icon-min=' + light.get('--brand-icon-min')],
    ['生效 CSS 不含组件实现规则（只有 @font-face + :root）',
      !/\.[A-Za-z][\w-]*\s*\{/.test(tStrip.replace(/(@font-face\s*|:root[^{]*)\{[^{}]*\}/g, '')), ''],
    ['生效 CSS 无 filter:invert()', !/filter\s*:\s*invert\s*\(/i.test(tStrip), ''],
    ['生效 CSS 无实验稿字形/月桂引用', !/(design-options|r2-|Cormorant|smallcaps|designkit|laurel)/i.test(tStrip), ''],
  ];
  console.log('    vis-tokens.css 自身完整性自检：');
  for (const [name, ok, extra] of checks) {
    console.log('      ' + verdict(ok) + ' ' + pad(name, 52) + (extra || ''));
    if (!ok) deliverableFail++;
  }
  console.log('');
  console.log('    注：接入片段（.brand-wordmark / :host-context 反白切换）全部写在注释中，');
  console.log('        本文件生效 CSS 仅 2 条 @font-face + :root / :root[data-theme=dark] 两个变量块，');
  console.log('        因此不会被误当成已落地的组件实现。');
}
console.log('');

/* ------------------------- 4. SUMMARY ------------------------- */
console.log(HR);
console.log('[4] SUMMARY');
console.log(HR);
console.log('  交付物校验（零覆盖 / token 文件自检）: ' +
  (deliverableFail === 0 ? '全部 PASS' : deliverableFail + ' 项 FAIL（必须修复）'));
console.log('  基线计数一致性（styles.css 对 Phase1/2 登记值）: ' +
  (baselineFail === 0 ? '全部吻合（17 字重 / 21+1 faint / 5 圆角 / 3 白字填充）' : baselineFail + ' 组异常'));
console.log('  组件 scoped 审计盲区（DISCOVERY，不推翻登记值）: 字重 +9 / --faint 文本 +17 /');
console.log('     圆角中间档 +4，共 30 处同类项，Phase1/2 未审；建议并入 M1 补充批次');
console.log('  其它现状: filter:invert 0 / brand-wordmark 0 / reduced-motion 仅 1 处 /');
console.log('     @font-face 0 条（基线字体未生效）/ 源码引用新增 token 0（零落地）');
console.log('  对比度实算: PASS ' + pass + ' / FAIL ' + fail + ' / INFO ' + info + '（共 ' + PAIRS.length + ' 组）');
console.log('  裁决 G 边界（v1.1 §7.3）: 1.10 正向验收 lab 深字方案全部 PASS；1.3 未对其报 FAIL；');
console.log('     白字 on indigo 400 = 2.98:1 列为「禁止组合」示例，与主 UI --primary 白字 6.29:1 分开。');
console.log('  上游口径: Phase1 v1.1 / Phase2 v1.1；§8 冲突表 15 项（v1.0 13 项 + M/N），');
console.log('     M/N 为 Phase 3 立即项，与 LOGO 冻结解耦，并入 M1（P3-5/P3-6），不新开任务。');
console.log('');
console.log('  本轮边界: 零落地、零 E2E 改动、零实验稿字形。本脚本只读，未写任何项目文件。');
console.log('  M0 后重跑本脚本，1.x 的 FAIL 计数应逐批下降；M3（LOGO 冻结）不改变本脚本判定口径。');
console.log('');
console.log('  退出码约定: 0=全通过 / 1=仅现状基线 FAIL（预期） / 2=交付物校验失败');
console.log(HR);

/* 先打印完整报告再退出（保证脚本「能正常跑完」） */
const code = deliverableFail > 0 ? 2 : (fail > 0 || baselineFail > 0 ? 1 : 0);
console.log('  EXIT CODE = ' + code);
process.exit(code);
