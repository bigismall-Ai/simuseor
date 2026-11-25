import fs from 'node:fs';
import path from 'node:path';

/**
 * 类名白名单：VIS 模板里出现的每一个 class 必须先在白名单登记。
 *
 * 白名单只解决“准入”，不解决“这个类画了什么”：
 *   - 已有类名由 `WRITE_CLASS_WHITELIST=1 node scripts/card-guard.mjs` 生成一次，之后按名单冻结；
 *   - 新增类名必须先加进 `scripts/class-whitelist.json`，再写进模板；
 *   - 白名单里的类仍然受 `style-guard` 的布局属性约束。
 *
 * 这样 `.sb-table`、`.table-row`、`.my-pretty-card` 这类“新造一个名字”的写法
 * 在模板阶段就会失败，不再靠黑名单追。
 */

const LIST_PATH = 'scripts/class-whitelist.json';
const ALLOWED_PATTERNS = [
  /^layout-/, // 纯布局工具类
  /^vis-/, // VIS 页面命名空间
];

/** 品牌层允许的全局工具类（不是页面视觉原语） */
const BRAND_UTILITIES = new Set(['mono','hint','table-note']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** 从模板里抽静态 class 词：class="..."、class='...'、[class]="'a b' + ..." */
export function collectClassTokens(text) {
  const tokens = new Set();

  const push = (value) => {
    const cleaned = value
      .replace(/\{\{[\s\S]*?\}\}/g, ' ')
      .replace(/[\r\n\t]+/g, ' ');
    for (const raw of cleaned.split(/\s+/)) {
      const token = raw.trim();
      if (!token) continue;
      if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token)) tokens.add(token);
    }
  };

  for (const match of text.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) push(match[1]);
  for (const match of text.matchAll(/\bclass\s*=\s*'([^']*)'/g)) push(match[1]);
  // [class]="'toggle-chip ghost detail-btn' + (...)" —— 只取里面的字符串字面量
  for (const match of text.matchAll(/\[class\]\s*=\s*"([^"]*)"/g)) {
    for (const literal of match[1].matchAll(/'([^']*)'/g)) push(literal[1]);
  }

  return tokens;
}

export function classGuard(root) {
  const visDir = path.join(root, 'src/app/vis');
  if (!fs.existsSync(visDir)) return [];

  const listPath = path.join(root, LIST_PATH);
  const update = process.env.WRITE_CLASS_WHITELIST === '1';

  const files = walk(visDir).filter((file) => file.endsWith('.ts') || file.endsWith('.html'));
  const byToken = new Map();

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const token of collectClassTokens(text)) {
      const prev = byToken.get(token) ?? [];
      prev.push(rel);
      byToken.set(token, prev);
    }
  }

  const ordered = Object.fromEntries(
    [...byToken.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  );

  if (update) {
    fs.writeFileSync(listPath, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    console.log(`class-guard: 已写入 ${Object.keys(ordered).length} 个类名白名单。`);
    return [];
  }

  if (!fs.existsSync(listPath)) {
    return [`${LIST_PATH} 不存在；先运行 WRITE_CLASS_WHITELIST=1 node scripts/card-guard.mjs`];
  }

  const whitelist = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  const allowed = new Set(Object.keys(whitelist));
  const violations = [];

  for (const [token, usedIn] of byToken) {
    if (allowed.has(token)) continue;
    if (BRAND_UTILITIES.has(token)) continue;
    if (ALLOWED_PATTERNS.some((pattern) => pattern.test(token))) continue;
    violations.push(
      `${usedIn[0]}  class 不在白名单: "${token}"（新类名先加进 ${LIST_PATH}，并用组件或布局类）`,
    );
  }

  return violations;
}
