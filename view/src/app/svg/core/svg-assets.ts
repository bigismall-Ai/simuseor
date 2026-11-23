/** 资产索引：由 `npm run svg:index` 扫描 public/ 生成。 */

export interface SvgAsset {
  path: string;
  group: string;
  groupLabel: string;
  name: string;
  label: string;
  variant: string;
  bytes: number;
  sha1: string;
  viewBox: string | null;
}

export interface SvgIndex {
  groups: Array<{ id: string; label: string }>;
  assets: SvgAsset[];
}

const EMPTY: SvgIndex = { groups: [], assets: [] };

export async function loadSvgIndex(): Promise<SvgIndex> {
  try {
    const res = await fetch('/svg-index.json', { cache: 'no-store' });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as SvgIndex;
    if (!Array.isArray(data.assets)) return EMPTY;
    return data;
  } catch {
    return EMPTY;
  }
}

export async function loadSvgAsset(path: string): Promise<string> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`加载失败：${path} (${res.status})`);
  return res.text();
}

export interface LoadedAsset {
  text: string;
  bytes: Uint8Array;
}

/** 读原始字节 + 文本：写回清单的 CRC 必须按磁盘字节算，不能被 BOM 影响。 */
export async function loadSvgAssetBytes(path: string): Promise<LoadedAsset> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`加载失败：${path} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { text: new TextDecoder('utf-8').decode(bytes), bytes };
}
