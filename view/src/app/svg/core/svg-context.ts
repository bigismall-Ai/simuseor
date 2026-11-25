/**
 * LLM 上下文包：把硬约束、语义部件、画布 digest、选中元素与补丁协议拼成一份
 * 可直接粘贴给模型的 Markdown。
 *
 * 设计口径：
 * - 顺序按重要性排：硬约束 → 语义 → 结构 → 选中 → 协议 → 任务 → 源码；
 * - 源码放最后且可整体省略，长内容按字符预算截断，避免 path / 大图吃光 token；
 * - 只做文本拼装，不读写 DOM，也不依赖 Angular。
 */

import { digestText } from './svg-doc';
import type { SvgStats } from './svg-doc';
import { findPartsByPhrase } from './svg-semantics';
import type { SemanticPartInfo } from './svg-semantics';

export interface ContextOptions {
  root: Element;
  stats: SvgStats;
  parts: SemanticPartInfo[];
  selection?: {
    tag: string;
    id: string | null;
    selector: string;
    attrs: [string, string][];
  } | null;
  constraints?: {
    palette?: string[];
    locked?: string[];
    whitelist?: string[];
    notes?: string[];
  };
  includeSource?: boolean;
  source?: string;
  maxDigestChars?: number;
  maxSourceChars?: number;
}

const DEFAULT_MAX_DIGEST_CHARS = 6000;
const DEFAULT_MAX_SOURCE_CHARS = 12000;

const OP_EXAMPLES = [
  '{ "op": "setAttr",     "target": "#body-1", "attr": "fill", "value": "#b95e4e" }',
  '{ "op": "removeAttr",  "target": "#body-1", "attr": "stroke" }',
  '{ "op": "translate",   "target": "#g-2",    "dx": -4, "dy": 0 }',
  '{ "op": "remove",      "target": "#old-3" }',
  '{ "op": "reorder",     "target": "#bg",     "position": "first" }',
  '{ "op": "add",         "parent": "#body-1", "svg": "<path id=\\"new-1\\" d=\\"M0 0 L10 10 Z\\" fill=\\"#222c28\\"/>" }',
  '{ "op": "replacePath", "target": "#path-4", "d": "M0 0 L10 10 Z" }',
  '{ "op": "moveAnchor",   "target": "#thumb", "anchor": 3, "x": 120, "y": 40 }',
  '{ "op": "moveHandle",   "target": "#thumb", "anchor": 2, "x": 110, "y": 30 }',
  '{ "op": "setGradient",  "target": "#palm",  "channel": "fill", "stops": [{ "offset": 0, "color": "#54e8d1" }, { "offset": 1, "color": "#ece8de" }], "direction": "h" }',
  '{ "op": "group",        "targets": ["#thumb", "#finger-1"], "id": "fingers", "role": "part" }',
  '{ "op": "ungroup",      "target": "#fingers" }',
].join('\n');

/** 语义部件的扁平索引：id · role · label · 同义词；给自然语言匹配用。 */
function partsIndex(parts: SemanticPartInfo[]): string {
  const max = 60;
  const lines = parts.slice(0, max).map((part) => {
    const bits = [`#${part.id}`, part.role, part.label];
    if (part.synonyms.length > 0) bits.push(`同义词:${part.synonyms.join('/')}`);
    if (part.locked) bits.push('锁定');
    return bits.filter(Boolean).join(' · ');
  });
  if (parts.length > max) lines.push(`… 共 ${parts.length} 个部件，已省略 ${parts.length - max} 个`);
  return lines.join('\n');
}

/** 按字符预算截断，尽量停在整行边界，并标注被截掉的总长度。 */
function clipText(text: string, max: number): string {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return '';
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit);
  const newline = cut.lastIndexOf('\n');
  if (newline > limit * 0.6) cut = cut.slice(0, newline);
  return `${cut}\n…（已截断：原 ${text.length} 字符，上限 ${limit}）`;
}

function idList(ids: string[]): string {
  return ids
    .map((id) => {
      const name = id.trim();
      if (!name) return '';
      return `\`${name.startsWith('#') ? name : `#${name}`}\``;
    })
    .filter(Boolean)
    .join('、');
}

function selectionBlock(selection: NonNullable<ContextOptions['selection']>): string[] {
  const attrs: Record<string, string> = {};
  for (const [name, value] of selection.attrs) attrs[name] = value;
  const payload = JSON.stringify(
    { tag: selection.tag, id: selection.id, selector: selection.selector, attrs },
    null,
    2,
  );
  return [
    '## 选中元素',
    '',
    '```json',
    payload,
    '```',
    '',
    '若任务只涉及该元素，优先只改它，不要顺带重排其它节点。',
    '',
  ];
}

export function buildContextPack(options: ContextOptions): string {
  const {
    root,
    stats,
    parts,
    selection = null,
    constraints,
    includeSource = false,
    source,
  } = options;
  const maxDigestChars = options.maxDigestChars ?? DEFAULT_MAX_DIGEST_CHARS;
  const maxSourceChars = options.maxSourceChars ?? DEFAULT_MAX_SOURCE_CHARS;
  const viewBox = root.getAttribute('viewBox');
  const lines: string[] = ['# SVG 编辑上下文', ''];

  lines.push('## 硬约束');
  lines.push(
    `1. 坐标系 = viewBox 用户单位${viewBox ? `（viewBox="${viewBox}"）` : ''}；不要按像素或屏幕坐标估算。`,
  );
  lines.push(
    '2. 图层顺序 = 文档顺序（先出现的在下层）；调整层级只能用 reorder，不要靠 transform 伪造层序。',
  );
  lines.push('3. 不要修改、删除或移动锁定元素；不要重命名已有 id；新增元素必须自带唯一 id。');
  lines.push('4. 不要引入 <style> 或 class；颜色与描边直接写在 fill / stroke 等呈现属性上。');
  lines.push(
    '5. 只输出 JSON 补丁数组；只有明确要求时才输出整份 canonical SVG。不要输出解释或 markdown 代码块。',
  );
  lines.push(
    `6. 精度：数值保留 2 位小数（输入中最多出现 ${stats.maxDecimals} 位）；优先改几何/呈现属性，不要堆叠 transform。`,
  );
  const palette = constraints?.palette?.filter(Boolean) ?? [];
  if (palette.length > 0) {
    lines.push(`- 调色板：${palette.map((c) => `\`${c}\``).join('、')}；不要引入表外颜色。`);
  }
  const locked = constraints?.locked?.filter(Boolean) ?? [];
  if (locked.length > 0) {
    lines.push(`- 锁定元素（禁止修改、删除、移动）：${idList(locked)}。`);
  }
  const whitelist = constraints?.whitelist?.filter(Boolean) ?? [];
  if (whitelist.length > 0) {
    lines.push(`- 只允许修改：${idList(whitelist)}；其它元素保持原样。`);
  }
  for (const note of constraints?.notes ?? []) {
    const text = note.trim();
    if (text) lines.push(`- 备注：${text}`);
  }
  lines.push('');

  lines.push('## 语义部件与同义词');
  lines.push('');
  const semantics = parts.length > 0 ? partsIndex(parts) : '';
  if (semantics) {
    lines.push('```text');
    lines.push(semantics);
    lines.push('```');
    lines.push('');
  } else {
    lines.push('（未收集到语义部件；按文档结构与 id 定位。）');
    lines.push('');
  }
  lines.push('用户用自然语言提到某个部件时，优先用它的 label / synonyms 匹配 id。');
  lines.push('');

  lines.push('## 画布 digest');
  lines.push('');
  lines.push('```text');
  // digest 里的语义段与上面的“语义部件与同义词”重复，这里只保留结构树。
  lines.push(clipText(digestText(root, stats, 4, 10, false), maxDigestChars));
  lines.push('```');
  lines.push('');

  if (selection) lines.push(...selectionBlock(selection));

  lines.push('## 可用 op');
  lines.push('');
  lines.push(
    '只接受以下 op，按数组顺序执行；`target` 用 `#id` 或 `svg`（根）。`add` 只能挂到已有父节点下，片段根必须带唯一 id。',
  );
  lines.push('');
  lines.push('```json');
  lines.push(OP_EXAMPLES);
  lines.push('```');
  lines.push('');
  lines.push('锚点索引按 collectAnchors() 顺序（各命令的 point/c1/c2 都占一个索引）；group 要求目标同父级且连续。');
  lines.push('');

  lines.push('## 任务');
  lines.push('');
  lines.push('（在这里写清楚要改什么；只改必要的元素，其余保持原样。）');

  if (includeSource && source && source.trim()) {
    lines.push('');
    lines.push('## 当前源码（canonical）');
    lines.push('');
    lines.push('```svg');
    lines.push(clipText(source, maxSourceChars));
    lines.push('```');
    lines.push('');
    lines.push('如果任务只需局部修改，不要输出整份源码，只给 JSON 补丁。');
  }

  return lines.join('\n');
}

/**
 * 把自然语言短语解析成 `#id` 目标。
 *
 * 只在**唯一匹配**时返回；命中多个（有歧义）或没有命中都返回 null，
 * 让调用方追问用户，而不是猜一个可能改错的元素。
 */
export function resolvePhrase(parts: SemanticPartInfo[], phrase: string): string | null {
  const needle = phrase.trim();
  if (!needle) return null;
  const matches = findPartsByPhrase(parts, needle);
  if (matches.length !== 1) return null;
  const id = matches[0]?.id?.trim();
  return id ? `#${id}` : null;
}
