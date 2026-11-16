/**
 * 家族发现 —— 从魔搭组织清单里找出「我们还不认识、但社区在活跃」的厂牌。
 *
 * **这不是资产源。** 魔搭的头像是组织自传头像（位图，深底反白/浅底彩色混着，
 * 还有默认占位图），描摹成 SVG 属重绘 —— 实测质量见 artifacts/families-assets.md。
 *
 * 那它有什么用？**它是「有哪些厂牌在开源社区活跃」的权威枚举。**
 * 实测 3,893 个组织里有 krea、Lightricks、Wan-AI、HiDream-ai 这些名字 ——
 * 说明这些厂牌确实在活跃，值得进我们的家族表。
 *
 * 发现 ≠ 采用。采用还是要走官网（official）或 lobehub（community）。
 *
 * 用法：
 *   node scripts/discover-families-ms.mjs              # 列出我们缺的候选
 *   node scripts/discover-families-ms.mjs --all        # 列出全部组织
 *   node scripts/discover-families-ms.mjs --save       # 落盘到 var/data/family_candidates_ms.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'web/src/app/core/family-sources.json');
const OUT = path.join(ROOT, 'var/data/family_candidates_ms.json');

const API = 'https://modelscope.cn/api/v1/dolphin/organizations';
const PAGE = 100;
const MAX_PAGE = 60;

const args = process.argv.slice(2);

/** 我们已经认识的家族（从登记表读，不硬编码） */
const known = new Set(
  JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).families.map((f) => f.id),
);

/**
 * 魔搭的组织列表接口是 **PUT**（不是 GET），body 是 {PageNumber, PageSize}。
 * 需要带会话 cookie，所以走 fetch 时带上 UA。
 */
async function fetchPage(pn) {
  const res = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'model-downloader/family-assets' },
    body: JSON.stringify({ PageNumber: pn, PageSize: PAGE }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const list = j?.Data?.Organizations || j?.Data?.Suggests || [];
  return Array.isArray(list) ? list : [];
}

function norm(o) {
  return {
    name: o.Name || o.name || '',
    path: o.Path || o.PathName || o.Name || '',
    avatar: o.Avatar || '',
    models: o.ModelCnt ?? o.Models ?? 0,
    datasets: o.DatasetCnt ?? 0,
    spaces: o.SpaceCnt ?? 0,
  };
}

async function listAll() {
  const out = [];
  for (let pn = 1; pn <= MAX_PAGE; pn++) {
    let list;
    try {
      list = await fetchPage(pn);
    } catch (e) {
      console.error(`第 ${pn} 页失败：${e.message}`);
      break;
    }
    if (!list.length) break;
    for (const o of list) out.push(norm(o));
    if (list.length < PAGE) break;
  }
  return out;
}

/**
 * 候选筛选：只看「有实质产出」的组织（模型数 >= 5），
 * 且排除明显不是厂牌的（个人号、社区合集、镜像）。
 *
 * 排除规则是**经验判断**，不是硬标准 —— 所以这个输出是「给人看的候选清单」，
 * 不是自动采纳列表。
 */
const EXCLUDE = [
  /mirror/i, /collection/i, /community/i, /-lora$/i, /gguf/i,
  /lab$/i, /labs$/i, /research$/i, /team$/i, /org$/i,
];

function isCandidate(o) {
  if (o.models < 5) return false;
  if (EXCLUDE.some((re) => re.test(o.name) || re.test(o.path))) return false;
  // 名字里带空格的通常是人名或合集，不是厂牌
  if (/\s/.test(o.name)) return false;
  return true;
}

const all = await listAll();
console.log(`魔搭组织总数：${all.length}`);

if (args.includes('--all')) {
  for (const o of all) {
    console.log(`  ${(o.name || o.path).padEnd(30).slice(0, 30)} ${String(o.models).padStart(5)} 模型  ${o.path}`);
  }
} else {
  const cands = all.filter(isCandidate);
  console.log(`\n有实质产出且像厂牌的候选（模型数 ≥ 5）：${cands.length}\n`);
  // 已知家族标出来，方便对照
  const knownHit = cands.filter((o) => known.has((o.path || '').toLowerCase()) || known.has((o.name || '').toLowerCase()));
  console.log(`其中我们已认识：${knownHit.map((o) => o.name || o.path).join('、') || '（无）'}\n`);
  for (const o of cands) {
    const mark = known.has((o.path || '').toLowerCase()) || known.has((o.name || '').toLowerCase()) ? '✓' : ' ';
    console.log(`  ${mark} ${(o.name || o.path).padEnd(26).slice(0, 26)} ${String(o.models).padStart(5)} 模型  ${o.path}`);
  }
}

if (args.includes('--save')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ fetchedAt: new Date().toISOString(), total: all.length, organizations: all }, null, 1),
    'utf8',
  );
  console.log(`\n已落盘：${path.relative(ROOT, OUT)}`);
}
