/**
 * SVG 语义层。
 *
 * canonical SVG 是唯一真值；`id` 负责机器寻址，`data-role` / `data-label` /
 * `data-synonyms` / `aria-label` / `<title>` 负责人类与 LLM 阅读。语义只加在
 * 「部件组」(`<g>`) 上，不给每个面片起名。
 *
 * 分工：
 * - LLM 输出 `SemanticPlan`（JSON），`applySemanticPlan` 据此建立/补全部件组；
 * - `collectSemanticParts` 把文档还原成可序列化的部件清单；
 * - `semanticFingerprint` / `diffSemanticParts` 判断一次改动是否只动了几何；
 * - `findPartsByPhrase` 让自然语言（label / synonyms / id / role）找到 id；
 * - `validateSemantics` 给出机器可读的问题清单。
 *
 * 本模块是纯 TypeScript + DOM API，不依赖 Angular；`ROLE_VOCABULARY` 是
 * 语义计划的受控词表，未知 role 只告警、不阻塞。
 */

import { SVG_NS, allElements } from './svg-doc';

export interface SemanticPart {
  id: string;
  role: string;
  label: string;
  synonyms: string[];
  parent?: string;
  required?: boolean;
  locked?: boolean;
}

export interface SemanticPlan {
  version: 1;
  kind: string;
  viewBox?: string;
  parts: SemanticPart[];
}

export interface SemanticPartInfo extends SemanticPart {
  exists: boolean;
  childCount: number;
  parentId: string | null;
}

export type SemanticIssueCode =
  | 'bad-json'
  | 'duplicate-id'
  | 'invalid-id'
  | 'unknown-role'
  | 'missing-required'
  | 'not-a-group'
  | 'missing-parent'
  | 'empty-part';

export interface SemanticIssue {
  code: SemanticIssueCode;
  severity: 'error' | 'warn';
  message: string;
  id?: string;
}

export interface SemanticDiff {
  added: string[];
  removed: string[];
  labelChanged: string[];
  roleChanged: string[];
  geometryOnly: boolean;
}

/* ------------------------------------------------------------------ */
/* 角色词表                                                            */
/* ------------------------------------------------------------------ */

export const ROLE_VOCABULARY: Record<string, { label: string; synonyms: string[] }> = {
  hand: { label: '手', synonyms: ['手部', '双手', 'hand', 'hands'] },
  palm: { label: '手掌', synonyms: ['掌心', 'palm'] },
  thumb: { label: '拇指', synonyms: ['大拇指', 'thumb'] },
  finger: { label: '手指', synonyms: ['指头', 'fingers', 'finger', 'digit'] },
  wrist: { label: '手腕', synonyms: ['腕部', '袖口', 'wrist', 'cuff'] },
  body: { label: '主体', synonyms: ['躯干', '机身', 'body', 'torso', 'trunk'] },
  wing: { label: '翅膀', synonyms: ['翼', '双翼', 'wing', 'wings'] },
  head: { label: '头部', synonyms: ['头', 'head'] },
  handle: { label: '握柄', synonyms: ['手柄', '把手', '刀柄', 'handle', 'grip', 'shaft'] },
  blade: { label: '刀身', synonyms: ['刃', '刀刃', 'blade', 'edge'] },
  frame: { label: '外框', synonyms: ['边框', '框架', 'frame', 'border', 'outline'] },
  ornament: { label: '装饰', synonyms: ['纹样', '花纹', 'ornament', 'decoration', 'detail'] },
  background: { label: '背景', synonyms: ['底色', '背板', 'background', 'bg', 'backdrop'] },
  text: { label: '文字', synonyms: ['文本', '文案', 'text', 'label', 'copy'] },
  logo: { label: '标志', synonyms: ['商标', '品牌标识', 'logo', 'mark', 'brand'] },
  part: { label: '部件', synonyms: ['局部', '零件', '组件', 'part', 'component', 'element'] },
  shadow: { label: '阴影', synonyms: ['投影', 'shadow'] },
  highlight: { label: '高光', synonyms: ['亮部', 'highlight'] },
  icon: { label: '图标', synonyms: ['符号', 'icon', 'symbol'] },
  pattern: { label: '图案', synonyms: ['纹理', 'pattern', 'texture'] },
};

/* ------------------------------------------------------------------ */
/* 常量与内部工具                                                       */
/* ------------------------------------------------------------------ */

const ID_PATTERN = /^[A-Za-z_][\w-]*$/;
const SYNONYM_SEPARATOR = '|';
const MAX_TEXT_LINES = 200;

/** 不参与「子元素」计数的元数据节点。 */
const METADATA_TAGS = new Set(['title', 'desc', 'metadata']);

function hasRole(role: string): boolean {
  return Object.hasOwn(ROLE_VOCABULARY, role);
}

function semanticIssue(
  code: SemanticIssueCode,
  severity: SemanticIssue['severity'],
  message: string,
  id?: string,
): SemanticIssue {
  return id ? { code, severity, message, id } : { code, severity, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 兼容 JSON 布尔与字符串布尔；其它值视为「未指定」。 */
function readFlag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function normalizeSynonyms(value: unknown): string[] {
  const raw: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') raw.push(item);
    }
  } else if (typeof value === 'string') {
    raw.push(...value.split(/[|,，、;；\n]/));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const synonym = item.trim();
    if (!synonym) continue;
    const key = synonym.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(synonym);
  }
  return out;
}

function isViewBox(value: string): boolean {
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return false;
  return parts.every((part) => part !== '' && Number.isFinite(Number(part)));
}

function geometryChildren(el: Element): Element[] {
  return Array.from(el.children).filter(
    (child) => !METADATA_TAGS.has(child.localName.toLowerCase()),
  );
}

/** 排除 <title>/<desc>/<metadata> 后仍有可见文本。 */
function hasRenderableText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim()) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (METADATA_TAGS.has(child.localName.toLowerCase())) continue;
    if (hasRenderableText(child)) return true;
  }
  return false;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function dedupeIssues(issues: SemanticIssue[]): SemanticIssue[] {
  const seen = new Set<string>();
  const out: SemanticIssue[] = [];
  for (const item of issues) {
    const key = `${item.code}|${item.id ?? ''}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 从纯 JSON、Markdown 代码块或带说明文字的回复中提取第一个 JSON 对象。 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

/* ------------------------------------------------------------------ */
/* 解析语义计划                                                        */
/* ------------------------------------------------------------------ */

export function parseSemanticPlan(
  text: string,
): { ok: true; plan: SemanticPlan; issues: SemanticIssue[] } | { ok: false; issues: SemanticIssue[] } {
  const json = extractJson(text);
  if (!json) {
    return {
      ok: false,
      issues: [semanticIssue('bad-json', 'error', '没有找到 JSON 对象')],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [semanticIssue('bad-json', 'error', `JSON 解析失败：${detail}`)],
    };
  }

  const record = asRecord(raw);
  if (!record) {
    return {
      ok: false,
      issues: [semanticIssue('bad-json', 'error', '语义计划必须是 JSON 对象')],
    };
  }

  const rawParts = record['parts'];
  if (!Array.isArray(rawParts)) {
    return {
      ok: false,
      issues: [semanticIssue('bad-json', 'error', '缺少 parts 数组')],
    };
  }

  const issues: SemanticIssue[] = [];
  if (record['version'] !== 1) {
    issues.push(semanticIssue('bad-json', 'error', 'version 必须为 1'));
  }

  let kind = readString(record['kind']);
  if (!kind) {
    kind = 'generic';
    issues.push(semanticIssue('bad-json', 'warn', '缺少 kind，已用 generic'));
  }

  const plan: SemanticPlan = { version: 1, kind, parts: [] };

  const viewBox = readString(record['viewBox']);
  if (viewBox) {
    if (isViewBox(viewBox)) plan.viewBox = viewBox;
    else issues.push(semanticIssue('bad-json', 'warn', `viewBox 不合法：${viewBox}`));
  }

  const seen = new Set<string>();
  rawParts.forEach((entry, index) => {
    const part = asRecord(entry);
    if (!part) {
      issues.push(semanticIssue('bad-json', 'error', `第 ${index + 1} 个部件不是对象`));
      return;
    }

    const id = readString(part['id']);
    if (!ID_PATTERN.test(id)) {
      issues.push(
        semanticIssue('invalid-id', 'error', `部件 id 不合法：${id || '(空)'}`, id || undefined),
      );
      return;
    }
    if (seen.has(id)) {
      issues.push(semanticIssue('duplicate-id', 'error', `id 重复：#${id}`, id));
      return;
    }
    seen.add(id);

    const rawRole = readString(part['role']).toLowerCase();
    const role = rawRole || 'part';
    if (!rawRole) {
      issues.push(semanticIssue('unknown-role', 'warn', '缺少 role，已用 part', id));
    } else if (!hasRole(role)) {
      issues.push(semanticIssue('unknown-role', 'warn', `未知 role：${rawRole}`, id));
    }

    const vocab = hasRole(role) ? ROLE_VOCABULARY[role] : null;
    const label = readString(part['label']) || vocab?.label || id;
    const synonyms = normalizeSynonyms(part['synonyms']);

    let parent: string | undefined;
    const rawParent = readString(part['parent']);
    if (rawParent) {
      if (!ID_PATTERN.test(rawParent)) {
        issues.push(
          semanticIssue('invalid-id', 'error', `parent id 不合法：${rawParent}`, id),
        );
      } else if (rawParent === id) {
        issues.push(semanticIssue('missing-parent', 'error', `#${id} 不能以自身为父级`, id));
      } else {
        parent = rawParent;
      }
    }

    const required = readFlag(part['required']);
    const locked = readFlag(part['locked']);

    const semantic: SemanticPart = { id, role, label, synonyms };
    if (parent) semantic.parent = parent;
    if (required !== undefined) semantic.required = required;
    if (locked !== undefined) semantic.locked = locked;
    plan.parts.push(semantic);
  });

  return { ok: true, plan, issues: dedupeIssues(issues) };
}

/* ------------------------------------------------------------------ */
/* 应用语义计划                                                        */
/* ------------------------------------------------------------------ */

function applyFlag(el: Element, name: string, flag: boolean | undefined): boolean {
  if (flag === undefined) return false;
  return setAttributeIfChanged(el, name, flag ? 'true' : null);
}

function setAttributeIfChanged(el: Element, name: string, value: string | null): boolean {
  if (value === null) {
    if (!el.hasAttribute(name)) return false;
    el.removeAttribute(name);
    return true;
  }
  if (el.getAttribute(name) === value) return false;
  el.setAttribute(name, value);
  return true;
}

/** 写入语义属性；返回是否有实际改动。 */
function writeSemantics(el: Element, part: SemanticPart): boolean {
  const synonyms = Array.isArray(part.synonyms) ? part.synonyms : [];
  let changed = false;
  changed = setAttributeIfChanged(el, 'data-role', part.role || null) || changed;
  changed = setAttributeIfChanged(el, 'data-label', part.label || null) || changed;
  changed = setAttributeIfChanged(
    el,
    'data-synonyms',
    synonyms.length > 0 ? synonyms.join(SYNONYM_SEPARATOR) : null,
  ) || changed;
  changed = setAttributeIfChanged(el, 'aria-label', part.label || null) || changed;
  changed = applyFlag(el, 'data-locked', part.locked) || changed;
  changed = applyFlag(el, 'data-required', part.required) || changed;
  return changed;
}

export function applySemanticPlan(
  root: Element,
  plan: SemanticPlan,
): { created: number; updated: number; issues: SemanticIssue[] } {
  const issues: SemanticIssue[] = [];
  const doc = root.ownerDocument;

  if (plan.version !== 1) {
    issues.push(semanticIssue('bad-json', 'warn', '计划 version 不是 1，仍按 1 处理'));
  }

  const byId = new Map<string, Element>();
  for (const el of allElements(root)) {
    const id = el.getAttribute('id');
    if (id && !byId.has(id)) byId.set(id, el);
  }

  const planById = new Map<string, SemanticPart>();
  const warnedRoles = new Set<string>();
  for (const part of plan.parts) {
    if (!ID_PATTERN.test(part.id)) {
      issues.push(semanticIssue('invalid-id', 'error', `部件 id 不合法：${part.id}`, part.id));
      continue;
    }
    if (planById.has(part.id)) {
      issues.push(semanticIssue('duplicate-id', 'error', `计划内 id 重复：#${part.id}`, part.id));
      continue;
    }
    if (part.role && !hasRole(part.role)) {
      const key = `${part.id}|${part.role}`;
      if (!warnedRoles.has(key)) {
        warnedRoles.add(key);
        issues.push(semanticIssue('unknown-role', 'warn', `未知 role：${part.role}`, part.id));
      }
    }
    planById.set(part.id, part);
  }

  let created = 0;
  let updated = 0;
  const resolved = new Map<string, Element | null>();

  const createGroup = (id: string): Element => {
    const el = doc.createElementNS(SVG_NS, 'g');
    el.setAttribute('id', id);
    byId.set(id, el);
    created += 1;
    return el;
  };

  const ensureParent = (parentId: string, stack: Set<string>): Element | null => {
    const existing = byId.get(parentId);
    if (existing) {
      // 根 <svg> 天然是画板容器；其余非 <g> 元素视为 id 冲突。
      if (existing === root) return root;
      if (existing.localName !== 'g') {
        issues.push(
          semanticIssue(
            'not-a-group',
            'error',
            `父级 #${parentId} 是 <${existing.localName}>，不是 <g>`,
            parentId,
          ),
        );
        return null;
      }
      return existing;
    }

    // 计划内的父级先按完整语义创建；失败时不再伪造同名裸组，避免重复 id。
    const parentPart = planById.get(parentId);
    if (parentPart) return ensurePart(parentPart, stack);

    if (!ID_PATTERN.test(parentId)) {
      issues.push(
        semanticIssue('missing-parent', 'error', `父级 id 不合法：${parentId}`, parentId),
      );
      return null;
    }
    if (stack.has(parentId)) {
      issues.push(
        semanticIssue('missing-parent', 'error', `父级引用成环：#${parentId}`, parentId),
      );
      return null;
    }

    // 计划没列出的父级：自动补一个裸 <g>，不猜 role/label。
    const el = createGroup(parentId);
    root.appendChild(el);
    return el;
  };

  const ensurePart = (part: SemanticPart, stack: Set<string>): Element | null => {
    const memo = resolved.get(part.id);
    if (memo !== undefined) return memo;

    if (stack.has(part.id)) {
      issues.push(
        semanticIssue('missing-parent', 'error', `父级引用成环：#${part.id}`, part.id),
      );
      resolved.set(part.id, null);
      return null;
    }
    stack.add(part.id);

    const existing = byId.get(part.id);
    if (existing) {
      stack.delete(part.id);
      if (existing.localName !== 'g') {
        issues.push(
          semanticIssue(
            'not-a-group',
            'error',
            `#${part.id} 已是 <${existing.localName}>，未覆盖`,
            part.id,
          ),
        );
        resolved.set(part.id, null);
        return null;
      }
      if (writeSemantics(existing, part)) updated += 1;
      resolved.set(part.id, existing);
      return existing;
    }

    let container: Element = root;
    if (part.parent && part.parent !== part.id) {
      container = ensureParent(part.parent, stack) ?? root;
    } else if (part.parent === part.id) {
      issues.push(semanticIssue('missing-parent', 'error', `#${part.id} 不能以自身为父级`, part.id));
    }

    const el = createGroup(part.id);
    writeSemantics(el, part);
    container.appendChild(el);

    stack.delete(part.id);
    resolved.set(part.id, el);
    return el;
  };

  for (const part of plan.parts) {
    const canonical = planById.get(part.id);
    if (!canonical) continue;
    ensurePart(canonical, new Set());
  }

  // viewBox 只在根没有时补，避免计划覆盖人工画板。
  if (plan.viewBox && !root.hasAttribute('viewBox')) {
    if (isViewBox(plan.viewBox)) root.setAttribute('viewBox', plan.viewBox.trim());
    else issues.push(semanticIssue('bad-json', 'warn', `viewBox 不合法：${plan.viewBox}`));
  }

  return { created, updated, issues: dedupeIssues(issues) };
}

/* ------------------------------------------------------------------ */
/* 收集与指纹                                                          */
/* ------------------------------------------------------------------ */

export function collectSemanticParts(root: Element): SemanticPartInfo[] {
  const elements = allElements(root).filter(
    (el) => el.hasAttribute('data-role') || el.hasAttribute('data-label'),
  );
  const semantic = new Set(elements);

  const parentIdOf = (el: Element): string | null => {
    let current = el.parentElement;
    while (current) {
      if (semantic.has(current)) return current.getAttribute('id') || null;
      current = current.parentElement;
    }
    return null;
  };

  return elements.map((el) => {
    const id = el.getAttribute('id') ?? '';
    const parentId = parentIdOf(el);
    const info: SemanticPartInfo = {
      id,
      role: (el.getAttribute('data-role') ?? '').trim().toLowerCase(),
      label:
        el.getAttribute('data-label') ||
        el.getAttribute('aria-label') ||
        el.querySelector(':scope > title')?.textContent?.trim() ||
        id,
      synonyms: normalizeSynonyms(el.getAttribute('data-synonyms') ?? ''),
      exists: true,
      childCount: geometryChildren(el).length,
      parentId,
      required: el.getAttribute('data-required') === 'true',
      locked: el.getAttribute('data-locked') === 'true',
    };
    if (parentId) info.parent = parentId;
    return info;
  });
}

/** 只对 id/role/label/parent 取指纹；几何或同步属性变化不影响结果。 */
export function semanticFingerprint(root: Element): string {
  const lines = collectSemanticParts(root).map((part) =>
    [part.id, part.role, part.label, part.parentId ?? ''].join('\u0001'),
  );
  lines.sort();
  return fnv1a(lines.join('\n'));
}

export function diffSemanticParts(
  before: SemanticPartInfo[],
  after: SemanticPartInfo[],
): SemanticDiff {
  const beforeById = new Map(before.map((part) => [part.id, part]));
  const afterById = new Map(after.map((part) => [part.id, part]));

  const added: string[] = [];
  const removed: string[] = [];
  const labelChanged: string[] = [];
  const roleChanged: string[] = [];

  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) added.push(id);
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed.push(id);
  }
  for (const [id, prev] of beforeById) {
    const next = afterById.get(id);
    if (!next) continue;
    if (prev.label !== next.label) labelChanged.push(id);
    if (prev.role !== next.role) roleChanged.push(id);
  }

  return {
    added,
    removed,
    labelChanged,
    roleChanged,
    geometryOnly:
      added.length === 0 &&
      removed.length === 0 &&
      labelChanged.length === 0 &&
      roleChanged.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* 自然语言检索                                                        */
/* ------------------------------------------------------------------ */

function normalizePhrase(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** label > synonyms > id > role；同级按「完全相同 > 前缀 > 包含」排。 */
export function findPartsByPhrase(parts: SemanticPartInfo[], phrase: string): SemanticPartInfo[] {
  const query = normalizePhrase(phrase);
  if (!query) return [];

  const scored: { part: SemanticPartInfo; tier: number; score: number; index: number }[] = [];
  parts.forEach((part, index) => {
    let tier = -1;
    let score = -1;

    const consider = (field: string, nextTier: number): void => {
      const value = normalizePhrase(field);
      if (!value) return;
      const nextScore = value === query ? 0 : value.startsWith(query) ? 1 : value.includes(query) ? 2 : -1;
      if (nextScore < 0) return;
      if (tier < 0 || nextTier < tier || (nextTier === tier && nextScore < score)) {
        tier = nextTier;
        score = nextScore;
      }
    };

    consider(part.label, 0);
    for (const synonym of part.synonyms) consider(synonym, 1);
    consider(part.id, 2);
    consider(part.role, 3);

    if (tier >= 0) scored.push({ part, tier, score, index });
  });

  scored.sort((a, b) => a.tier - b.tier || a.score - b.score || a.index - b.index);
  return scored.map((entry) => entry.part);
}

/* ------------------------------------------------------------------ */
/* 文本树                                                              */
/* ------------------------------------------------------------------ */

export function semanticToText(parts: SemanticPartInfo[]): string {
  const ids = new Set(parts.map((part) => part.id).filter(Boolean));
  const children = new Map<string, SemanticPartInfo[]>();
  const roots: SemanticPartInfo[] = [];

  for (const part of parts) {
    const parent = part.parentId;
    if (!parent || parent === part.id || !ids.has(parent)) {
      roots.push(part);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(part);
    children.set(parent, list);
  }

  const lines: string[] = [];
  const visited = new Set<SemanticPartInfo>();
  let truncated = false;

  const walk = (part: SemanticPartInfo, depth: number): void => {
    if (lines.length >= MAX_TEXT_LINES) {
      truncated = true;
      return;
    }
    if (visited.has(part)) return;
    visited.add(part);

    const id = part.id || '(no-id)';
    const role = part.role || '?';
    const label = part.label.replace(/"/g, '\\"');
    lines.push(`${'  '.repeat(depth)}#${id} role=${role} label="${label}" (${part.childCount} 子元素)`);

    for (const child of children.get(part.id) ?? []) {
      if (lines.length >= MAX_TEXT_LINES) {
        truncated = true;
        return;
      }
      walk(child, depth + 1);
    }
  };

  for (const part of roots) walk(part, 0);
  // 成环或孤儿：按原顺序兜底，保证每个部件最多出现一次。
  for (const part of parts) {
    if (!visited.has(part)) walk(part, 0);
  }

  if (truncated) {
    lines.push(`… 其余 ${Math.max(0, parts.length - visited.size)} 个部件未显示`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

export function validateSemantics(root: Element, plan?: SemanticPlan): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const elements = allElements(root);
  const elementById = new Map<string, Element>();
  const seen = new Set<string>();
  const reportedDuplicates = new Set<string>();

  for (const el of elements) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (!elementById.has(id)) elementById.set(id, el);
    if (!ID_PATTERN.test(id)) {
      issues.push(semanticIssue('invalid-id', 'error', `id 不合法：${id}`, id));
    }
    if (seen.has(id)) {
      if (!reportedDuplicates.has(id)) {
        reportedDuplicates.add(id);
        issues.push(semanticIssue('duplicate-id', 'error', `id 重复：#${id}`, id));
      }
    } else {
      seen.add(id);
    }
  }

  for (const el of elements) {
    const role = (el.getAttribute('data-role') ?? '').trim().toLowerCase();
    const hasLabel = el.hasAttribute('data-label');
    if (!role && !hasLabel) continue;

    const id = el.getAttribute('id') ?? '';
    if (!id) {
      issues.push(
        semanticIssue('invalid-id', 'error', `语义元素 <${el.localName}> 缺少 id`),
      );
    }
    if (role && !hasRole(role)) {
      issues.push(semanticIssue('unknown-role', 'warn', `未知 role：${role}`, id || undefined));
    }
    if (
      el.localName === 'g' &&
      geometryChildren(el).length === 0 &&
      !hasRenderableText(el)
    ) {
      issues.push(
        semanticIssue(
          'empty-part',
          'warn',
          `语义组为空：#${id || '(无 id)'}（可以继续往里填几何）`,
          id || undefined,
        ),
      );
    }
  }

  if (plan) {
    if (plan.version !== 1) {
      issues.push(semanticIssue('bad-json', 'error', '计划 version 必须为 1'));
    }

    const planIds = new Set<string>();
    for (const part of plan.parts) {
      if (!ID_PATTERN.test(part.id)) {
        issues.push(semanticIssue('invalid-id', 'error', `部件 id 不合法：${part.id}`, part.id));
      }
      if (planIds.has(part.id)) {
        issues.push(semanticIssue('duplicate-id', 'error', `计划内 id 重复：#${part.id}`, part.id));
      }
      planIds.add(part.id);
    }

    for (const part of plan.parts) {
      if (part.role && !hasRole(part.role)) {
        issues.push(
          semanticIssue('unknown-role', 'warn', `未知 role：${part.role}`, part.id),
        );
      }

      const el = elementById.get(part.id);
      if (!el) {
        if (part.required) {
          issues.push(
            semanticIssue('missing-required', 'error', `必需的部件不存在：#${part.id}`, part.id),
          );
        }
        continue;
      }

      if (el.localName !== 'g') {
        issues.push(
          semanticIssue(
            'not-a-group',
            'error',
            `#${part.id} 是 <${el.localName}>，语义部件应为 <g>`,
            part.id,
          ),
        );
      } else if (
        part.required &&
        geometryChildren(el).length === 0 &&
        !hasRenderableText(el)
      ) {
        issues.push(
          semanticIssue('empty-part', 'warn', `语义组为空：#${part.id}（可以继续往里填几何）`, part.id),
        );
      }

      if (part.parent) {
        const parentEl = elementById.get(part.parent);
        if (!parentEl && !planIds.has(part.parent)) {
          issues.push(
            semanticIssue('missing-parent', 'warn', `父级不存在：#${part.parent}`, part.id),
          );
        } else if (parentEl && parentEl.localName !== 'g') {
          issues.push(
            semanticIssue(
              'not-a-group',
              'error',
              `父级 #${part.parent} 是 <${parentEl.localName}>，不是 <g>`,
              part.id,
            ),
          );
        }
      }
    }
  }

  return dedupeIssues(issues);
}
