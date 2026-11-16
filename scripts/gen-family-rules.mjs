/**
 * 家族识别规则同步：从前端 cover.ts 生成后端可读的一份。
 *
 * 为什么要有这个：
 *  前端 `core/cover.ts` 的 FAMILIES 是家族识别的**唯一权威**（顺序敏感、正则最全）。
 *  后端 `library_meta.py` 也需要同一套规则来算显存系数。两边各写一份，就必然漂移 ——
 *  事实上已经漂了：前端扩到 17 个家族时，后端还停在 9 条，新增的 7 个
 *  （krea / zimage / hidream / ernie / noobai / illustrious / chroma）
 *  全部落到了默认显存系数上，注释还写着「必须与前端保持一致」。
 *
 * 做法：cover.ts 保持权威不动（TS 正则字面量保真，不用在 JSON 里手抄转义），
 *  由这个脚本把规则抽出来，生成 `backend/app/family_rules.py`。
 *  校验见 `tests/family-table-sync.mjs` —— 生成物与源不一致就报错。
 *
 * 用法：
 *   node scripts/gen-family-rules.mjs          # 生成/更新 backend/app/family_rules.py
 *   node scripts/gen-family-rules.mjs --check  # 只校验，不写文件
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const ROOT = 'E:/Projects/model-downloader';
const COVER = path.join(ROOT, 'web/src/app/core/cover.ts');
const OUT = path.join(ROOT, 'backend/app/family_rules.py');

/**
 * 从 cover.ts 抽出 (id, 正则源码)。
 *
 * 正则字面量里可能有转义的斜杠 `\/`，所以不能简单地按 `/` 切。
 * `other` 的 test 是 `/$^/` —— 永不匹配，等于「认不出来」，不进后端规则表。
 */
export function extractRules(coverSrc) {
  const out = [];
  const re = /id:\s*'([^']+)'([\s\S]*?)test:\s*\/((?:[^\\/]|\\.)*)\/([gimsuy]*)/g;
  let m;
  while ((m = re.exec(coverSrc))) {
    const [, id, , pattern, flags] = m;
    if (id === 'other') continue;
    if (!flags.includes('i')) {
      throw new Error(`家族 ${id} 的 test 没带 i 标志，后端统一按 re.I 匹配，会不一致`);
    }
    out.push({ id, pattern });
  }
  return out;
}

/** Python 原始字符串（给正则用）。模式里若同时出现两种引号，退回双引号形式。 */
function pyRaw(pattern) {
  if (pattern.includes("'") && pattern.includes('"')) {
    throw new Error(`正则里同时有单双引号，无法安全转成 Python 原始字符串：${pattern}`);
  }
  const q = pattern.includes("'") ? '"' : "'";
  return `r${q}${pattern}${q}`;
}

/** 家族 id 是普通标识符，用普通字符串即可。 */
function pyStr(s) {
  if (s.includes("'") && s.includes('"')) {
    throw new Error(`家族 id 里同时有单双引号：${s}`);
  }
  const q = s.includes("'") ? '"' : "'";
  return `${q}${s}${q}`;
}

export function render(rules) {
  const body = rules.map((r) => `    (${pyStr(r.id)}, ${pyRaw(r.pattern)}),`).join('\n');
  return `"""家族识别规则 —— **自动生成，勿手改**。

由 scripts/gen-family-rules.mjs 从 web/src/app/core/cover.ts 的 FAMILIES 抽取。
前端那份是唯一权威；改家族识别请改 cover.ts，然后重新生成：

    node scripts/gen-family-rules.mjs

校验（提交前 / CI）：

    node tests/family-table-sync.mjs

**顺序敏感**：具体家族必须排在通用家族前面 —— 匹配按顺序取第一个命中。
前端正则都带 i 标志，后端统一用 re.I 匹配，两边行为一致。
"""

from __future__ import annotations

FAMILY_RULES: tuple[tuple[str, str], ...] = (
${body}
)
`;
}

// 主模块守卫 —— 被 tests/family-table-sync.mjs import 时只提供函数，
// 绝不能顺手把生成物重写掉：校验脚本的价值在于「发现漂移」，
// 如果它自己就能修好，那漂移就永远不会被任何人看见。
const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const coverSrc = fs.readFileSync(COVER, 'utf8');
  const rules = extractRules(coverSrc);
  const target = render(rules);

  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== target) {
      console.error('✗ backend/app/family_rules.py 与 cover.ts 不一致 —— 跑 node scripts/gen-family-rules.mjs');
      process.exit(1);
    }
    console.log(`✓ 家族规则同步（${rules.length} 条）`);
  } else {
    fs.writeFileSync(OUT, target, 'utf8');
    console.log(`✓ 已生成 backend/app/family_rules.py（${rules.length} 条规则）`);
    for (const r of rules) console.log(`    ${r.id.padEnd(12)} ${r.pattern}`);
  }
}
