/**
 * 厂牌资产：拉取 / 漂移检测 / 提升。
 *
 * 解决的问题：官方改标了没人知道。以前资产是「一次性抓来就冻住」的文件，
 * 既没有来源记录，也没有办法知道线上那份是不是已经变了。
 *
 * 三条原则：
 *  1. **绝不自动覆盖正式资产。** 拉下来的新版本一律先进 _candidates/，
 *     报告「上游已变更」，由人确认后再 --promote。上游一次改版就让全站卡片封面
 *     同时变样、且没人说得清为什么，是比「资产旧了一点」严重得多的事故。
 *  2. **来源登记是唯一的凭据。** 抓哪、用什么颜色、官方规范在哪，都在
 *     web/src/app/core/family-sources.json 里。不在表里的资产 = 野生资产，校验脚本会报错。
 *  3. **指纹存在表里。** sha256 记录「人工批准过的版本」，
 *     所以「有人手改了资产但没登记」是能被发现的。
 *
 * 用法：
 *   node scripts/fetch-family-assets.mjs                     拉取所有可自动抓取的来源 + 漂移报告
 *   node scripts/fetch-family-assets.mjs --offline           只比对磁盘与登记指纹（无网络，给 CI 用）
 *   node scripts/fetch-family-assets.mjs --fetch <id> <url>  人工提供官网地址 → 抓进候选区
 *   node scripts/fetch-family-assets.mjs --promote <id>      候选区 → 正式资产，并写入新指纹
 *   node scripts/fetch-family-assets.mjs --approve <id>      把磁盘上现有资产登记为已批准
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'node:url';

// 从脚本自身位置推导仓库根 —— 硬编码绝对路径换台机器/CI 就崩。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 登记表放在 web/src/app/core/ —— 必须进版本库。
// （artifacts/ 与 .workbuddy/ 都在 .gitignore 里，权威数据放那儿会在换机器/clone 时丢失）
const REGISTRY = path.join(ROOT, 'web/src/app/core/family-sources.json');
const PUB = path.join(ROOT, 'web/public');
// 暂存区放 var/tmp/，**不放 web/public/** —— public 里的东西会被打进发布包并对外提供，
// 而这里的候选是「还没启用」的中间态，不该出现在站点上。
// （family-sources.json 里登记的 candidate 是例外：那是刻意留存的资产，位置仍在 public。）
const CAND = path.join(ROOT, 'var/tmp/family-candidates');

const args = process.argv.slice(2);
/**
 * 指纹 = 归一化行尾后的 sha256。
 *
 * 为什么归一化：行尾不是「资产被手改」—— 图形一模一样。
 * Windows 上任何一次保存都会把 LF 变成 CRLF，指纹随之改变，
 * 门禁就会天天报「资产被手改过」。假报警比漏报警更坏：
 * 报警一旦成了习惯，人就会开始无视它。
 *
 * 真正抓「手改」的是这一对：归一化指纹对内容变化敏感，
 * 语义签名（几何 path + 配色）对图形变化敏感 —— 两者互补。
 */
const sha256 = (buf) => {
  const norm = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha256').update(norm).digest('hex');
};

/**
 * 语义签名：几何 + 配色，忽略字节级噪音。
 *
 * 为什么不能直接比 sha256 —— 实测 Simple Icons CDN 会把颜色段原样回显，
 * 请求 FFFFFF 回来的是 `#FFFFFF`，而我们本地存的是 `#ffffff`。
 * 字节差一个字节，渲染出来完全一样，却会被报成「官方改版」。
 *
 * 签名只取真正影响成像的东西：viewBox、path 几何、填充/描边色、渐变色标。
 * 色值统一小写后再比。签名相同 = 画面相同，不该惊动人。
 */
function signature(buf) {
  const s = buf.toString('utf8');
  const viewBoxes = [...s.matchAll(/viewBox="([^"]+)"/g)].map((m) => m[1]);
  const paths = [...s.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  const colors = [...s.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,8})"/g)].map((m) => m[1].toLowerCase());
  const stops = [...s.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const json = JSON.stringify({ viewBoxes, paths, colors, stops });
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function saveRegistry(reg) {
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n', 'utf8');
}

function findFamily(reg, id) {
  const f = reg.families.find((x) => x.id === id);
  if (!f) {
    console.error(`✗ 登记表里没有家族「${id}」。已知：${reg.families.map((x) => x.id).join(', ')}`);
    process.exit(1);
  }
  return f;
}

/** 登记表的 assets 条目 -> 磁盘绝对路径 */
const absOf = (rel) => path.join(PUB, rel);

/**
 * 抓一个来源。
 * simple-icons: cdn.simpleicons.org/{slug} 或 /{slug}/{color}（颜色段不带 #）
 * official:     直接 GET 给定 URL
 */
async function grab(source, overrideUrl) {
  let url = overrideUrl;
  if (!url) {
    if (source.kind === 'simple-icons') {
      if (!source.slug) return { url: null, error: 'source.slug 缺失' };
      url = source.color
        ? `https://cdn.simpleicons.org/${source.slug}/${source.color}`
        : `https://cdn.simpleicons.org/${source.slug}`;
    } else if (source.kind === 'official') {
      return { url: null, error: '官方来源未登记可抓地址（需人工提供）' };
    } else {
      return { url: null, error: `来源类型 ${source.kind} 不支持自动抓取` };
    }
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'model-downloader/family-assets' } });
    clearTimeout(timer);
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const body = Buffer.from(await res.arrayBuffer());
    if (!body.length) return { url, error: '空响应' };
    if (source.kind === 'simple-icons' || url.endsWith('.svg')) {
      const head = body.subarray(0, 400).toString('utf8');
      if (!/<svg[\s>]/i.test(head)) return { url, error: '响应里没有 <svg> 元素' };
    }
    return { url, body };
  } catch (e) {
    return { url, error: e.name === 'AbortError' ? '超时' : e.message };
  }
}

/** 家族的两个变体各自对应的抓取参数 */
function variantsOf(fam) {
  const s = fam.source || {};
  return [
    { variant: 'light', color: s.color, rel: fam.assets.find((a) => a.variant === 'light')?.path },
    { variant: 'dark', color: s.colorDark, rel: fam.assets.find((a) => a.variant === 'dark')?.path },
  ].filter((v) => v.rel);
}

function candidatePath(fam, variant) {
  const base = fam.assets.find((a) => a.variant === variant)?.path || `families/${fam.id}.svg`;
  const file = path.basename(base);
  return path.join(CAND, file);
}

/** 磁盘上的资产指纹 vs 登记里批准的指纹 */
function fingerprint(fam) {
  const out = [];
  for (const a of fam.assets || []) {
    const abs = absOf(a.path);
    if (!fs.existsSync(abs)) {
      // 候选区（_candidates/）本来就不进版本库 —— 干净检出里没有它是正常的，
      // 不能算「与登记不符」，否则离线自检永远返回失败。
      const isCandidate = a.path.includes('_candidates');
      out.push({
        path: a.path,
        variant: a.variant,
        state: isCandidate ? '候选缺失（不入库）' : '缺失',
        disk: null,
        approved: a.sha256 || null,
      });
      continue;
    }
    const disk = sha256(fs.readFileSync(abs));
    const approved = a.sha256 || null;
    out.push({
      path: a.path,
      variant: a.variant,
      state: !approved ? '未登记指纹' : approved === disk ? '已批准' : '与登记不符（资产被手改过）',
      disk,
      approved,
      sig: signature(fs.readFileSync(abs)),
      approvedSig: a.sig || null,
    });
  }
  return out;
}

async function cmdFetchAll(reg, offline, reportPath) {
  let drift = 0;
  let ok = 0;
  let pending = 0;
  const famStates = [];
  console.log('── 家族资产来源核查 ──\n');
  for (const fam of reg.families) {
    const fps = fingerprint(fam);
    const src = fam.source || {};
    const head = `${fam.id.padEnd(9)} ${src.kind.padEnd(13)}`;

    if (offline) {
      const bad = fps.filter(
        (f) => f.state !== '已批准' && f.state !== '未登记指纹' && f.state !== '候选缺失（不入库）',
      );
      const missing = fps.filter((f) => f.state === '缺失');
      const unreg = fps.filter((f) => f.state === '未登记指纹');
      const mark = missing.length || bad.length ? '✗' : unreg.length ? '○' : '✓';
      console.log(`${mark} ${head} ${fps.map((f) => `${f.variant}:${f.state}`).join('  ')}`);
      if (bad.length || missing.length) drift++;
      famStates.push({
        id: fam.id,
        kind: src.kind,
        state: missing.length || bad.length ? 'mismatch' : unreg.length ? 'pending' : 'upToDate',
        variants: fps.map((f) => ({ variant: f.variant, state: f.state })),
      });
      continue;
    }

    if (src.kind === 'none') {
      console.log(`— ${head} 无官方资产 → 保持留白`);
      famStates.push({ id: fam.id, kind: src.kind, state: 'noAsset', variants: [] });
      continue;
    }
    if (src.kind === 'manual') {
      console.log(`— ${head} 人工资产（${fam.assets.length ? '候选区 ' + fam.assets.map((a) => a.path).join(',') : '无'}）→ 不自动抓取`);
      famStates.push({ id: fam.id, kind: src.kind, state: 'manual', variants: [] });
      continue;
    }

    const vs = variantsOf(fam);
    let line = `${head} `;
    const varStates = [];
    for (const v of vs) {
      // 官网来源可能浅/深两版是两个地址（ERNIE 的白色版和彩色版就是两个文件）；
      // 只登记了 url 的家族，两版都抓同一个地址。
      const override = src.kind === 'simple-icons' ? null : v.variant === 'dark' ? (src.urlDark || src.url) : src.url;
      const res = await grab({ ...src, color: v.color }, override);
      if (res.error) {
        // 「官方地址本来就没登记」是**已知状态**，不是抓取故障。
        // 两者混在一起报出去，巡检就会天天喊「4 个家族异常」—— 喊久了就是噪音。
        const knownNoUrl = src.kind === 'official' && !src.url;
        line += `${v.variant}: ${knownNoUrl ? '无官方地址（属实）' : `取不到（${res.error}）`}  `;
        varStates.push({
          variant: v.variant,
          state: knownNoUrl ? 'noSourceUrl' : 'unreachable',
          detail: res.error,
        });
        continue;
      }
      fs.mkdirSync(CAND, { recursive: true });
      fs.writeFileSync(candidatePath(fam, v.variant), res.body);
      const cand = sha256(res.body);
      const candSig = signature(res.body);
      const asset = fam.assets.find((a) => a.variant === v.variant);
      if (!asset?.sig) {
        // 首次登记：磁盘上的资产还没批准过指纹，不能说「上游变了」
        line += `${v.variant}: 未登记指纹 → 待批准  `;
        pending++;
        varStates.push({ variant: v.variant, state: 'pending' });
      } else if (asset.sig === candSig) {
        line += `${v.variant}: 已是最新  `;
        ok++;
        varStates.push({ variant: v.variant, state: 'upToDate' });
      } else {
        line += `${v.variant}: 上游已变更（几何/配色）→ 待确认  `;
        drift++;
        varStates.push({ variant: v.variant, state: 'drifted' });
      }
    }
    console.log(line + (src.kind === 'official' && !src.url ? '（官方地址需人工提供）' : ''));
    famStates.push({
      id: fam.id,
      kind: src.kind,
      // 聚合优先级：漂移 > 抓不到 > 无地址 > 待登记 > 已是最新。
      // 漏掉任何一档都会把「没检查到」误报成「没问题」。
      state: varStates.some((v) => v.state === 'drifted')
        ? 'drifted'
        : varStates.some((v) => v.state === 'unreachable')
          ? 'unreachable'
          : varStates.some((v) => v.state === 'noSourceUrl')
            ? 'noSourceUrl'
            : varStates.some((v) => v.state === 'pending')
              ? 'pending'
              : 'upToDate',
      variants: varStates,
    });
  }

  if (reportPath) {
    const summary = {
      upToDate: 0,
      drifted: 0,
      pending: 0,
      unreachable: 0,
      noSourceUrl: 0,
      noAsset: 0,
      manual: 0,
    };
    for (const f of famStates) {
      if (f.state in summary) summary[f.state]++;
      else if (f.state === 'mismatch') summary.drifted++;
    }
    const payload = {
      scannedAt: new Date().toISOString(),
      offline: !!offline,
      summary: { families: famStates.length, ...summary },
      // 需要人看的只有漂移和抓取失败；noSourceUrl / noAsset / manual 都是已知状态。
      attention: famStates
        .filter((f) => f.state === 'drifted' || f.state === 'unreachable')
        .map((f) => ({ id: f.id, kind: f.kind, state: f.state, variants: f.variants })),
      families: famStates,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  console.log('');
  if (offline) {
    console.log(drift ? `✗ ${drift} 个家族与登记不符` : '✓ 磁盘资产与登记一致');
    return drift ? 1 : 0;
  }
  if (ok) console.log(`${ok} 项已是最新`);
  if (pending) console.log(`${pending} 项待登记指纹（--approve <id>）`);
  console.log(drift
    ? `⚠ ${drift} 项上游有变化 —— 候选已写入 ${path.relative(ROOT, CAND)}/，人工确认后：node scripts/fetch-family-assets.mjs --promote <id>`
    : '✓ 没有需要更新的资产');
  return 0;
}

async function cmdFetchOne(reg, id, url) {
  const fam = findFamily(reg, id);
  const res = await grab({ ...fam.source, color: fam.source?.color }, url);
  if (res.error) {
    console.error(`✗ 取不到：${res.error}`);
    process.exit(1);
  }
  fs.mkdirSync(CAND, { recursive: true });
  const dest = candidatePath(fam, 'light');
  fs.writeFileSync(dest, res.body);
  console.log(`✓ 已抓取 ${url}\n  → ${path.relative(ROOT, dest)}（候选区，未启用）`);
  console.log(`  确认后：node scripts/fetch-family-assets.mjs --promote ${id}`);
}

function cmdPromote(reg, id) {
  const fam = findFamily(reg, id);
  let n = 0;
  for (const a of fam.assets || []) {
    const candName = path.basename(a.path);
    const cand = path.join(CAND, candName);
    if (!fs.existsSync(cand)) continue;
    const body = fs.readFileSync(cand);
    fs.mkdirSync(path.dirname(absOf(a.path)), { recursive: true });
    fs.writeFileSync(absOf(a.path), body);
    a.sha256 = sha256(body);
    a.sig = signature(body);
    n++;
  }
  if (!n) {
    console.error(`✗ ${id} 的候选区里没有对应文件。先跑：node scripts/fetch-family-assets.mjs --fetch ${id} <url>`);
    process.exit(1);
  }
  saveRegistry(reg);
  console.log(`✓ ${id}：${n} 份资产已启用，登记表指纹已更新`);
  console.log('  下一步：cd tests && node families-assets.mjs');
}

function cmdApprove(reg, id) {
  const fam = findFamily(reg, id);
  let n = 0;
  for (const a of fam.assets || []) {
    const abs = absOf(a.path);
    if (!fs.existsSync(abs)) continue;
    const body = fs.readFileSync(abs);
    a.sha256 = sha256(body);
    a.sig = signature(body);
    n++;
  }
  if (!n) {
    console.error(`✗ ${id} 在磁盘上找不到已登记的资产`);
    process.exit(1);
  }
  saveRegistry(reg);
  console.log(`✓ ${id}：${n} 份资产已登记为「已批准」`);
}

const reg = loadRegistry();

// --report <path>：把结构化结果写成 JSON。
// 人读终端输出，程序读这份文件 —— 不去解析终端文本，输出格式一改就静默出错。
const reportIdx = args.indexOf('--report');
let reportPath = null;
if (reportIdx >= 0) {
  const raw = args[reportIdx + 1];
  if (!raw || raw.startsWith('--')) {
    console.error('✗ --report 需要一个文件路径');
    process.exit(1);
  }
  reportPath = path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

if (args[0] === '--offline') {
  process.exit(await cmdFetchAll(reg, true, reportPath));
} else if (args[0] === '--fetch') {
  await cmdFetchOne(reg, args[1], args[2]);
} else if (args[0] === '--promote') {
  cmdPromote(reg, args[1]);
} else if (args[0] === '--approve') {
  cmdApprove(reg, args[1]);
} else {
  process.exit(await cmdFetchAll(reg, false, reportPath));
}
