/**
 * 发布方（publisher）—— 与「家族 / 厂牌」分开的第二身份维度。
 *
 * FAMILIES 回答「这是哪条模型线」（FLUX / SDXL / WAN…），但发现页大量模型
 * 根本没有登记家族（魔搭抽样 76% 落 other）。这时能回答「谁发的」的只有
 * 仓库 id 的 org 段或 author。这里不画品牌标、不做随机配色，只给 1–3 个字符
 * 的缩写，让它成为一个诚实的「发布方」标识，而不是伪造的厂牌 logo。
 */
export interface Publisher {
  /** 稳定 key：org 段小写 */
  key: string;
  /** 展示名：author 优先，缺省用 org 原文 */
  label: string;
  /** 22px 槽位里的 1–3 字符缩写 */
  abbr: string;
}

export function publisherOf(model: { id?: string; author?: string }): Publisher | null {
  const id = (model.id || '').trim();
  const orgFromId = id.includes('/') ? id.split('/')[0].trim() : '';
  const org = orgFromId || (model.author || '').trim();
  if (!org) return null;
  const abbr = abbrOf(org);
  if (!abbr) return null;
  return {
    key: org.toLowerCase(),
    label: (model.author || '').trim() || org,
    abbr,
  };
}

/**
 * 发布方筛选键：与后端 `/library/facets` 的 publisher 桶保持同一口径。
 * 没有 repo_id 的本地导入条目统一落空串（后端标记为「未登记」）。
 */
export function publisherKeyOf(repoId?: string): string {
  const id = (repoId || '').trim();
  return id.includes('/') ? id.split('/')[0].trim().toLowerCase() : '';
}

/**
 * 缩写规则：
 * - 纯 ASCII：按 `- _ .` 与驼峰拆词；≥2 词取各词首字母（最多 3 个）；
 *   单 token ≤3 字符全取，否则取前 2 个 —— 22px 里 3 个字符已是上限。
 * - 非 ASCII（中文发布方）：只取首字，避免在方槽里挤成一条。
 */
function abbrOf(org: string): string {
  const ascii = org.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!ascii) return [...org][0] || '';
  const tokens = ascii
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length >= 2) {
    return tokens
      .slice(0, 3)
      .map((t) => t[0])
      .join('')
      .toUpperCase();
  }
  const one = tokens[0];
  return (one.length <= 3 ? one : one.slice(0, 2)).toUpperCase();
}
