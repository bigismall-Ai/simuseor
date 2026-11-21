#!/usr/bin/env node
/* ============================================================================
 * VIS 原型页 · 生成与防漂移
 * ----------------------------------------------------------------------------
 *   node artifacts/vis/vis-proto.mjs build     从定义重新生成展示面
 *   node artifacts/vis/vis-proto.mjs check     防漂移 + 生命周期（只读）
 *
 * 【三层】
 *   类型层   artifacts/vis/prototypes/_types.mjs  —— 形状与渲染器
 *   定义层   artifacts/vis/prototypes/_defs.mjs   —— 数据（唯一手写处）
 *   展示面   artifacts/vis/prototypes/*.html      —— 生成物，勿手改
 *
 * 【check 做四件事】
 *   1. 漂移：重新渲染 → 与入库展示面逐字节比对。不一致 = 有人手改了生成物，
 *      或者改了定义忘了重新生成 —— 两种都是漂移，阻塞。
 *   2. 退役：status=retired 的原型，展示面文件必须已经不存在。
 *      还在 = 该删了（实验结束却留着，读者会以为候选还能改）。
 *   3. 野生文件：prototypes/ 下有 .html 但注册表里没有 = 绕过管线的手写页。
 *   4. 类覆盖：展示面用到的 class 必须在样式表里有定义（防止改名后静默失效）。
 *
 * 【退出码】
 *   0 = 全通过 / 1 = 仅提示 / 2 = 阻塞（漂移 / 退役未删 / 野生文件）
 * ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES } from './prototypes/_types.mjs';
import { PROTO_DEFS } from './prototypes/_defs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PROTO_DIR = path.join(HERE, 'prototypes');
const SPEC_MD = path.join(HERE, 'SiMuseor-VIS.md');
const CSS_FILES = [
  path.join(HERE, 'assets', 'vis.css'),
  path.join(PROTO_DIR, '_proto.css'),
];

const HR = '='.repeat(96);
const say = (s) => process.stdout.write(s + '\n');

/* --------------------------------------------------------------------------
 * 版本真值：VIS.md 标题行（展示面的版本标签从这儿取，不手写）
 * -------------------------------------------------------------------------- */
function specVersion() {
  const head = fs.readFileSync(SPEC_MD, 'utf8').split('\n')[0];
  const m = head.match(/v(\d+\.\d+)/);
  return m ? 'v' + m[1] : '(未读到版本)';
}

/* --------------------------------------------------------------------------
 * 渲染
 * -------------------------------------------------------------------------- */
function renderAll() {
  const version = specVersion();
  const out = [];
  for (const def of PROTO_DEFS) {
    if (def.status !== 'active') continue;
    const type = TYPES[def.type];
    if (!type) throw new Error(`原型 ${def.id} 的 type "${def.type}" 在 _types.mjs 里没有渲染器`);
    out.push({ def, html: type.render(def, { version }) });
  }
  return { version, out };
}

/* --------------------------------------------------------------------------
 * check
 * -------------------------------------------------------------------------- */
function check() {
  say(HR);
  say(' SiMuseor VIS · 原型页防漂移检查  (vis-proto.mjs)');
  say(' 生成时间: ' + new Date().toISOString());
  say(' 模式    : 只读（不写任何项目文件）');
  say(HR);
  say('');
  say('[1] 原型注册表（定义层 artifacts/vis/prototypes/_defs.mjs）');

  const { version, out } = renderAll();
  const active = new Map(out.map((o) => [o.def.file, o]));
  let block = 0;
  let warn = 0;

  for (const def of PROTO_DEFS) {
    const st = def.status === 'active' ? '[在架]' : '[已退役]';
    say('    ' + st + ' ' + def.id.padEnd(14) + def.file.padEnd(28) +
      (def.status === 'active'
        ? '退役条件: ' + (def.retireWhen || '(未声明)')
        : '退役于 ' + (def.retiredAt || '?') + ' · ' + (def.retireWhen || '')));
  }

  say('');
  say('[2] 漂移检查（重新渲染 ↔ 入库展示面，逐字节）');
  for (const { def, html } of out) {
    const p = path.join(HERE, def.file);
    if (!fs.existsSync(p)) {
      say('    [FAIL] ' + def.id + ' —— 展示面不存在：' + def.file + '（跑 build 生成）');
      block++;
      continue;
    }
    const disk = fs.readFileSync(p, 'utf8');
    if (disk === html) {
      say('    [PASS] ' + def.id.padEnd(14) + def.file + '  一致（' + html.length + ' 字符）');
    } else {
      const d = firstDiff(disk, html);
      say('    [FAIL] ' + def.id.padEnd(14) + def.file + '  **已漂移**');
      say('             入库 ' + disk.length + ' 字符 / 应为 ' + html.length + ' 字符');
      say('             首个差异 @' + d.at + '：入库「' + d.a + '」 vs 应为「' + d.b + '」');
      say('             处置：改了定义就重跑 `node artifacts/vis/vis-proto.mjs build`；');
      say('                   手改了生成物则 `git checkout` 还原后重跑 build。');
      block++;
    }
  }

  say('');
  say('[3] 生命周期（退役的原型必须已删展示面）');
  for (const def of PROTO_DEFS) {
    if (def.status !== 'retired') continue;
    const p = path.join(HERE, def.file);
    if (fs.existsSync(p)) {
      say('    [FAIL] ' + def.id + ' 已退役但展示面仍在：' + def.file);
      say('             退役于 ' + (def.retiredAt || '?') + '（' + (def.retireWhen || '') + '）');
      say('             处置：删除该文件，并从 shell.js 的 P/NAV 与总览页索引卡移除。');
      block++;
    } else {
      say('    [PASS] ' + def.id.padEnd(14) + def.file + '  已退役，文件确已删除');
    }
  }

  say('');
  say('[4] 野生文件（prototypes/ 下有 .html 但注册表没有）');
  const known = new Set(PROTO_DEFS.map((d) => path.basename(d.file)));
  const wild = fs.readdirSync(PROTO_DIR)
    .filter((f) => f.endsWith('.html') && !known.has(f));
  if (!wild.length) {
    say('    [PASS] 无野生页面');
  } else {
    for (const f of wild) {
      say('    [FAIL] ' + f + ' —— 不在注册表里，绕过了「定义 → 生成 → 校验」管线');
      block++;
    }
    say('             处置：在 _defs.mjs 补一份定义并重跑 build；确实是手写残留就删掉。');
  }

  say('');
  say('[5] 类覆盖（展示面用到的 class 必须在样式表里有定义）');
  const cssText = CSS_FILES.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const knownClasses = new Set((cssText.match(/\.[A-Za-z][\w-]*/g) || []).map((s) => s.slice(1)));
  /* shell.js 动态注入的类（导航 / 主题按钮等）也算已定义 */
  const shellJs = fs.readFileSync(path.join(HERE, 'assets', 'shell.js'), 'utf8');
  const shellClasses = new Set((shellJs.match(/class="([^"]+)"/g) || [])
    .map((s) => s.replace(/class="|"/g, '')).join(' ').split(/\s+/).filter(Boolean));
  for (const { def, html } of out) {
    const used = new Set((html.match(/class="([^"]+)"/g) || [])
      .map((s) => s.replace(/class="|"/g, '')).join(' ').split(/\s+/).filter(Boolean));
    /* 家族色类 f-* 是**开放集合**：只有拿到专属色板的家族才有定义，
       没定义 = 落中性兜底（VIS §s-16「未知就是未知，不猜」）。
       所以它不参与「必须已定义」判定，只单独列出。 */
    const fam = [...used].filter((c) => /^f-/.test(c));
    const famMissing = fam.filter((c) => !knownClasses.has(c));
    const rest = [...used].filter((c) => !/^f-/.test(c));
    const missing = rest.filter((c) => !knownClasses.has(c) && !shellClasses.has(c));
    if (!missing.length) {
      say('    [PASS] ' + def.id.padEnd(14) + rest.length + ' 个固定 class 全部有定义');
    } else {
      say('    [WARN] ' + def.id.padEnd(14) + '未定义的固定 class: ' + missing.join(', '));
      warn++;
    }
    if (fam.length) {
      say('           家族色类 ' + fam.length + ' 个（开放集合）' +
        (famMissing.length ? '：未定义 ' + famMissing.join(', ') + ' -> 落中性兜底（符合 §s-16）' : '：全部有专属色板'));
    }
  }

  say('');
  say(HR);
  say(' 阻塞项: ' + block + ' 个' + (block ? ' -> 退出码 2' : ''));
  say(' 提示项: ' + warn + ' 个（不阻塞）');
  say(' 版本真值: ' + version + '（取自 SiMuseor-VIS.md 标题行）');
  say(HR);
  return block ? 2 : (warn ? 1 : 0);
}

/** 找出首个差异位置（用于报告漂移） */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) {
    return { at: i, a: a.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, '\\n'), b: b.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, '\\n') };
  }
  return { at: n, a: '(末尾)', b: '(末尾)' };
}

/* --------------------------------------------------------------------------
 * build
 * -------------------------------------------------------------------------- */
function build() {
  const { version, out } = renderAll();
  say('版本真值: ' + version);
  for (const { def, html } of out) {
    const p = path.join(HERE, def.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    fs.writeFileSync(p, html, 'utf8');
    say((before === html ? '[未变] ' : '[写入] ') + def.file + '  ' + html.length + ' 字符');
  }
  say('\n完成。校验：node artifacts/vis/vis-proto.mjs check');
  return 0;
}

/* --------------------------------------------------------------------------
 * 入口
 * -------------------------------------------------------------------------- */
const cmd = process.argv[2];
if (cmd === 'build') {
  process.exit(build());
} else if (cmd === 'check') {
  process.exit(check());
} else {
  say('用法:');
  say('  node artifacts/vis/vis-proto.mjs build     从定义重新生成展示面');
  say('  node artifacts/vis/vis-proto.mjs check     防漂移 + 生命周期（只读）');
  process.exit(cmd ? 3 : 0);
}
