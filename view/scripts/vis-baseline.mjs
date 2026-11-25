#!/usr/bin/env node
/**
 * VIS 像素基线的版本台账。
 *
 * 基线图不进仓库：它们打包在 GitHub Release 的某个 tag 里。
 * 这个脚本只管理「当前指针指向哪一版」和「这一版是否真的存在于 Release」。
 *
 *   node scripts/vis-baseline.mjs status     # 查看指针、Release 是否存在、asset 大小
 *   node scripts/vis-baseline.mjs bump       # 版本号 +1 并改写 tests/e2e/vis-baseline.json
 *
 * 需要 GITHUB_TOKEN（或本机 credential helper 里的 github.com 凭据）才能查 Release。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const metaPath = resolve(root, '../tests/e2e/vis-baseline.json');
const repo = process.env.GITHUB_REPOSITORY || 'bigismall-Ai/simuseor';

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: root,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    const match = out.match(/password=(.+)/);
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

async function gh(pathname) {
  const auth = token();
  const res = await fetch(`https://api.github.com/repos/${repo}${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return res;
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const command = process.argv[2] ?? 'status';

if (command === 'bump') {
  const next = Number(meta.version ?? 1) + 1;
  const updated = {
    version: next,
    tag: `vis-baseline-v${next}`,
    asset: `vis-baseline-v${next}.tar.gz`,
  };
  writeFileSync(metaPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  console.log(`指针已改为 ${updated.tag}；跑 CI 的 update_baseline 生成并上传这一版。`);
  process.exit(0);
}

const res = await gh(`/releases/tags/${meta.tag}`);
if (res.status === 404) {
  console.log(`指针 ${meta.tag} 不存在于 Release。`);
  console.log(`先跑一次 workflow_dispatch（update_baseline=true）生成这一版。`);
  process.exit(0);
}
if (!res.ok) {
  console.error(`查询 Release 失败：${res.status}`);
  process.exit(1);
}

const release = await res.json();
const asset = release.assets.find((item) => item.name === meta.asset);
if (!asset) {
  console.log(`Release ${meta.tag} 存在，但 asset ${meta.asset} 缺失。`);
  process.exit(0);
}
console.log(`指针 ${meta.tag} 已就绪：${(asset.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`下载地址：${asset.browser_download_url}`);
