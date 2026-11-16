/**
 * lobehub 社区资产（@lobehub/icons）的抓取与提取。
 *
 * 单独一个模块的原因：fetch-family-assets.mjs（巡检）和
 * fetch-lobehub-assets.mjs（手动抓候选）都要用同一份提取逻辑 ——
 * 两份实现必然漂移，这正是家族表改 codegen 要消灭的问题，这里同理。
 *
 * lobehub 的特殊之处：它**没有独立的 .svg 文件**，
 * SVG 的 path 写在 .tsx / .mjs 源码里（`src/<Brand>/components/Mono.tsx`），
 * 所以只能从源码里抠。这是拿到几何的唯一办法。
 */
import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 锁版本：不锁的话上游改版会让「同一个资产」悄悄变形。 */
export const PKG = '@lobehub/icons@6.15.2';
export const BASE = `https://unpkg.com/${PKG}/es`;
/** 巡检脚本要显示「来源地址」，拼出来用。 */
export const LOBEHUB_BASE = BASE;

/** 我们关心的家族 → lobehub 的品牌目录名。 */
export const BRAND_OF = {
  krea: 'Krea',
  ltx: 'Lightricks',
  sd15: 'Stability',
  sdxl: 'Stability',
  flux: 'Flux',
  qwen: 'Qwen',
  minimax: 'Minimax',
  hunyuan: 'Hunyuan',
  ernie: 'Baidu',
  ideogram: 'Ideogram',
  recraft: 'Recraft',
  wan: 'Wan',
  zimage: 'ZImage',
  hidream: 'HiDream',
};

export function brandOf(id) {
  return BRAND_OF[id] || null;
}

/**
 * 从 lobehub 的组件源码里抠出标准 SVG。
 *
 * 抽的是 `viewBox` + 所有 `d` + `<title>`，
 * 保留 `fill="currentColor"`（单色 symbol，靠 CSS 继承颜色）。
 */
export function extractSvg(src) {
  const vb = src.match(/viewBox:\s*"([^"]+)"/);
  const paths = [...src.matchAll(/d:\s*"([^"]+)"/g)].map((m) => m[1]);
  const title = src.match(/children:\s*"([^"]*)"/);
  if (!vb || !paths.length) throw new Error('源码里没有 viewBox/path');
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb[1]}" width="24" height="24" fill="currentColor" fill-rule="evenodd">`,
  ];
  if (title) lines.push(`  <title>${title[1]}</title>`);
  for (const d of paths) lines.push(`  <path d="${d}"/>`);
  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

/** 抓某个品牌的 Mono 组件源码。 */
export async function fetchBrandSource(brand) {
  const url = `${BASE}/${brand}/components/Mono.mjs`;
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'model-downloader/family-assets' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** 一步到位：抓源码 → 抠 SVG。 */
export async function grabBrandSvg(brand) {
  return extractSvg(await fetchBrandSource(brand));
}
