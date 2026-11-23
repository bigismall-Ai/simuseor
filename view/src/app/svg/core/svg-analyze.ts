/**
 * 诊断：把「优化资产」拆成可解释、可单步修复的问题清单。
 * 每条 finding 都对应一个或一组保守 pass，避免“一键优化”变成黑盒。
 */

import {
  allElements,
  byteLength,
  isNumericAttribute,
  type SvgStats,
} from './svg-doc';
import { isUnstableId, referencedIds, type PassId } from './svg-optimize';

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  fix: PassId[] | null;
}

const ID_TARGETS = new Set([
  'g',
  'path',
  'polygon',
  'polyline',
  'rect',
  'circle',
  'ellipse',
  'line',
  'image',
  'use',
]);

const UNSAFE_TAGS = new Set(['script', 'foreignobject', 'handler', 'listener', 'iframe']);
const EDITOR_PREFIXES = ['inkscape:', 'sodipodi:', 'illustrator:', 'i:', 'graph:'];
const DEF_TAGS = new Set([
  'lineargradient',
  'radialgradient',
  'pattern',
  'clippath',
  'mask',
  'filter',
  'symbol',
  'marker',
]);

export function analyze(root: Element, text: string, precision: number): Finding[] {
  const stats = collectStatsLite(root, text, precision);
  const findings: Finding[] = [];
  const elements = allElements(root);

  const unsafe = elements.filter(
    (el) =>
      UNSAFE_TAGS.has(el.localName.toLowerCase()) ||
      Array.from(el.attributes).some(
        (a) => /^on/i.test(a.name) || (/^(?:xlink:)?href$/.test(a.name) && /^\s*javascript:/i.test(a.value)),
      ),
  ).length;
  if (unsafe > 0) {
    findings.push({
      key: 'unsafe',
      severity: 'error',
      title: '包含可执行内容',
      detail: 'script / foreignObject / on* 事件 / javascript: 链接。导出前必须清除。',
      count: unsafe,
      fix: ['strip-unsafe'],
    });
  }

  if (!root.getAttribute('viewBox')) {
    findings.push({
      key: 'no-viewbox',
      severity: 'error',
      title: '缺少 viewBox',
      detail: '没有 viewBox 的 SVG 无法无损缩放，也不利于按用户单位寻址。',
      count: 1,
      fix: null,
    });
  }

  if (stats.images > 0) {
    findings.push({
      key: 'embedded-raster',
      severity: 'warn',
      title: '内嵌位图，不是矢量',
      detail: `包含 ${stats.images} 个 <image>，其中内嵌数据约 ${Math.round(stats.embeddedRasterBytes / 1024)} kB。LLM 无法读写其内容，也无法改色/改形；需要重新矢量化。`,
      count: stats.images,
      fix: null,
    });
  }

  if (stats.classRefs > 0 || stats.styleBlocks > 0) {
    findings.push({
      key: 'css-classes',
      severity: 'warn',
      title: '颜色藏在 <style> 类选择器里',
      detail: `${stats.styleBlocks} 个 <style>、${stats.cssRules} 条规则、${stats.classRefs} 处 class 引用。改一个形状的颜色必须跨表查 .cls-N，LLM 与人工都容易改错。内联后每个元素自带 fill/stroke。`,
      count: stats.classRefs,
      fix: ['inline-css'],
    });
  }

  const inlineStyles = elements.filter((el) => el.hasAttribute('style')).length;
  if (inlineStyles > 0) {
    findings.push({
      key: 'inline-style',
      severity: 'info',
      title: '行内 style 属性',
      detail: `${inlineStyles} 个元素用 style="" 承载呈现属性。展开成 fill/stroke 等属性后可被补丁直接寻址。`,
      count: inlineStyles,
      fix: ['expand-style'],
    });
  }

  const junk = elements.filter(
    (el) =>
      el !== root &&
      (el.localName === 'metadata' ||
        el.localName === 'namedview' ||
        el.localName === 'pgf' ||
        el.hasAttribute('data-name') ||
        Array.from(el.attributes).some((a) => EDITOR_PREFIXES.some((p) => a.name.startsWith(p)))),
  ).length;
  const rootLayerId = /^(?:_*图层.*|Layer[\s_-]?\d+)$/i.test(root.getAttribute('id') ?? '');
  if (junk > 0 || rootLayerId) {
    findings.push({
      key: 'editor-junk',
      severity: 'info',
      title: '编辑器元数据',
      detail: `${junk} 处 metadata / data-name / inkscape 属性${rootLayerId ? '，外加「图层」根 id' : ''}。这些对渲染无影响，但会污染 diff 与 LLM 上下文。`,
      count: junk + (rootLayerId ? 1 : 0),
      fix: ['strip-editor'],
    });
  }

  const comments = countComments(root);
  if (comments > 0) {
    findings.push({
      key: 'comments',
      severity: 'info',
      title: 'XML 注释',
      detail: `${comments} 处注释。规范化与提示词里都不保留。`,
      count: comments,
      fix: ['remove-comments'],
    });
  }

  const emptyContainers = elements.filter(
    (el) =>
      el !== root &&
      ['g', 'defs', 'symbol', 'marker', 'clippath', 'mask', 'pattern'].includes(el.localName.toLowerCase()) &&
      el.children.length === 0 &&
      !(el.textContent ?? '').trim(),
  ).length;
  if (emptyContainers > 0) {
    findings.push({
      key: 'empty',
      severity: 'info',
      title: '空容器',
      detail: `${emptyContainers} 个没有内容的 <g>/<defs> 等。`,
      count: emptyContainers,
      fix: ['remove-empty'],
    });
  }

  const unusedDefs = countUnusedDefs(root);
  if (unusedDefs > 0) {
    findings.push({
      key: 'unused-defs',
      severity: 'info',
      title: '未被引用的 defs',
      detail: `${unusedDefs} 个渐变/蒙版/裁剪/symbol 没有任何 url(#…) 或 href="#…" 引用。`,
      count: unusedDefs,
      fix: ['remove-unused-defs'],
    });
  }

  const ids = elements.map((el) => el.getAttribute('id')).filter((id): id is string => Boolean(id));
  const singleLetterIds = ids.filter((id) => /^[a-z]$/.test(id)).length;
  const unstableIds = ids.filter((id) => isUnstableId(id, singleLetterIds)).length;
  const missingIds = elements.filter(
    (el) => el !== root && !el.hasAttribute('id') && ID_TARGETS.has(el.localName),
  ).length;
  if (missingIds > 0 || unstableIds > 0) {
    findings.push({
      key: 'missing-ids',
      severity: 'info',
      title: '元素 id 缺失或不稳定',
      detail: `${missingIds} 个可绘制元素没有 id，${unstableIds} 个是编辑器随机 id 或位置编号。改成稳定 id 后，重排、diff 和补丁都不会整片失效；引用会同步改写。`,
      count: missingIds + unstableIds,
      fix: ['stable-ids'],
    });
  }

  const duplicateIds = countDuplicateIds(root);
  if (duplicateIds > 0) {
    findings.push({
      key: 'duplicate-ids',
      severity: 'warn',
      title: '重复 id',
      detail: `${duplicateIds} 个 id 被多个元素共用。合并或内联到页面时会互相覆盖渐变/裁剪。`,
      count: duplicateIds,
      fix: null,
    });
  }

  if (stats.precisionExcess > 0) {
    findings.push({
      key: 'precision',
      severity: 'info',
      title: `数值精度高于 ${precision} 位`,
      detail: `${stats.precisionExcess} 个数值有冗余小数（最多 ${stats.maxDecimals} 位）。按 ${precision} 位取整可省约 ${stats.precisionBytes} B，视觉误差小于 0.01 用户单位。`,
      count: stats.precisionExcess,
      fix: ['round-numbers', 'compact-path'],
    });
  }

  if (stats.compactablePaths > 0) {
    findings.push({
      key: 'compact-path',
      severity: 'info',
      title: 'path 数据可压缩空白',
      detail: `${stats.compactablePaths} 条 d/points 含逗号或多余空白，压缩后语义不变，diff 更短。`,
      count: stats.compactablePaths,
      fix: ['compact-path'],
    });
  }

  const titles = elements.filter((el) => el.localName === 'title' || el.localName === 'desc').length;
  if (titles > 0) {
    findings.push({
      key: 'titles',
      severity: 'info',
      title: 'title / desc',
      detail: `${titles} 个可访问性文本节点。保留有助于无障碍，删除可省体积。`,
      count: titles,
      fix: ['strip-title'],
    });
  }

  if (stats.texts > 0) {
    findings.push({
      key: 'text',
      severity: 'info',
      title: '包含活文本',
      detail: `${stats.texts} 个 <text>/<tspan>。LLM 可读，但渲染依赖字体；品牌资产通常应在导出时转轮廓。`,
      count: stats.texts,
      fix: null,
    });
  }

  if (stats.masks + stats.clipPaths > 0) {
    findings.push({
      key: 'id-refs',
      severity: 'info',
      title: '依赖 id 的引用结构',
      detail: `${stats.masks} 个 mask、${stats.clipPaths} 个 clipPath。跨文件合并或复制粘贴时必须重映射 id。`,
      count: stats.masks + stats.clipPaths,
      fix: null,
    });
  }

  const external = elements.filter((el) =>
    Array.from(el.attributes).some(
      (a) => /^(?:xlink:)?href$/.test(a.name) && /^(?:https?:)?\/\//i.test(a.value),
    ),
  ).length;
  if (external > 0) {
    findings.push({
      key: 'external',
      severity: 'warn',
      title: '外链资源',
      detail: `${external} 处 href 指向外部地址。离线渲染与 LLM 阅读都会失败。`,
      count: external,
      fix: null,
    });
  }

  if (stats.pathBytes > 0) {
    const share = Math.round((stats.pathBytes / Math.max(1, stats.bytes)) * 100);
    findings.push({
      key: 'path-share',
      severity: 'info',
      title: `几何数据占 ${share}%`,
      detail: `d/points 合计 ${stats.pathBytes} B。这类文件继续减小体积只能靠合并图形或降低精度，不能靠删属性。`,
      count: stats.paths,
      fix: null,
    });
  }

  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

interface LiteStats extends SvgStats {
  precisionExcess: number;
  precisionBytes: number;
  compactablePaths: number;
}

function collectStatsLite(root: Element, text: string, precision: number): LiteStats {
  const elements = allElements(root);
  const stats: LiteStats = {
    bytes: byteLength(text),
    elements: elements.length,
    paths: 0,
    groups: 0,
    ids: 0,
    classRefs: 0,
    styleBlocks: 0,
    cssRules: 0,
    pathBytes: 0,
    numbers: 0,
    maxDecimals: 0,
    images: 0,
    embeddedRasterBytes: 0,
    masks: 0,
    clipPaths: 0,
    gradients: 0,
    texts: 0,
    unsafe: 0,
    viewBox: root.getAttribute('viewBox'),
    tags: [],
    precisionExcess: 0,
    precisionBytes: 0,
    compactablePaths: 0,
    // 占位：analyze 不用 tags
  } as LiteStats;

  for (const el of elements) {
    const tag = el.localName;
    if (tag === 'path') stats.paths += 1;
    if (tag === 'g') stats.groups += 1;
    if (tag === 'style') {
      stats.styleBlocks += 1;
      stats.cssRules += (el.textContent ?? '').split('{').length - 1;
    }
    if (tag === 'image') {
      stats.images += 1;
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      if (href.startsWith('data:')) stats.embeddedRasterBytes += href.length;
    }
    if (tag === 'mask') stats.masks += 1;
    if (tag === 'clipPath') stats.clipPaths += 1;
    if (tag === 'linearGradient' || tag === 'radialGradient') stats.gradients += 1;
    if (tag === 'text' || tag === 'tspan') stats.texts += 1;
    if (el.hasAttribute('id')) stats.ids += 1;
    const cls = el.getAttribute('class');
    if (cls) stats.classRefs += cls.split(/\s+/).filter(Boolean).length;

    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'points') stats.pathBytes += byteLength(attr.value);
      if (attr.name === 'd') {
        stats.pathBytes += byteLength(attr.value);
        if (/,/.test(attr.value) || /\s{2,}/.test(attr.value) || /[a-zA-Z]\s+/.test(attr.value)) {
          stats.compactablePaths += 1;
        }
      }
      if (!isNumericAttribute(attr.name)) continue;
      for (const m of attr.value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []) {
        stats.numbers += 1;
        const dot = m.indexOf('.');
        if (dot < 0) continue;
        const frac = m.slice(dot + 1).replace(/[eE].*$/, '');
        stats.maxDecimals = Math.max(stats.maxDecimals, frac.length);
        if (frac.length > precision) {
          stats.precisionExcess += 1;
          stats.precisionBytes += frac.length - precision;
        }
      }
    }
  }
  return stats;
}

function countComments(root: Element): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}

function countDuplicateIds(root: Element): number {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const el of allElements(root)) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return dup.size;
}

function countUnusedDefs(root: Element): number {
  const refs = referencedIds(root);
  let n = 0;
  for (const el of allElements(root)) {
    const id = el.getAttribute('id');
    if (!id) continue;
    const isDef = DEF_TAGS.has(el.localName.toLowerCase()) || el.closest('defs');
    if (!isDef) continue;
    if (!refs.has(id)) n += 1;
  }
  return n;
}
