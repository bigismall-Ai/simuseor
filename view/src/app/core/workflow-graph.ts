/**
 * 工作流图模型：UI JSON / API JSON 与画布之间的唯一转换层。
 *
 * 这一层刻意不依赖 Angular，也不直接碰 DOM：解析、连断线、自动排版、序列化
 * 都是纯函数，页面只负责把结果画出来。编辑器最怕的是「改坏原文件」——
 * 所以序列化永远基于原始对象的深拷贝，编辑器不认识的键原样带回去。
 */
export type WorkflowFormat = 'ui' | 'api' | 'broken';

export type WidgetKind = 'number' | 'text' | 'toggle' | 'combo' | 'raw';

export interface GraphWidget {
  name: string;
  kind: WidgetKind;
  value: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** 在节点参数区里显示的名字；缺省用 name */
  label?: string;
}

export interface GraphInput {
  name: string;
  type: string;
  link: number | null;
  /** UI 格式里这个输入同时是一个控件（seed / text …） */
  widget?: string;
}

export interface GraphOutput {
  name: string;
  type: string;
  links: number[];
}

export interface GraphNode {
  id: number;
  type: string;
  title: string;
  pos: [number, number];
  size: [number, number];
  inputs: GraphInput[];
  outputs: GraphOutput[];
  widgets: GraphWidget[];
  /** 原始节点对象，序列化时作为基底 */
  raw: Record<string, unknown> | null;
}

export interface GraphLink {
  id: number;
  from: number;
  fromSlot: number;
  to: number;
  toSlot: number;
  type: string;
}

export interface WorkflowGraph {
  format: WorkflowFormat;
  nodes: GraphNode[];
  links: GraphLink[];
  raw: Record<string, unknown>;
  /** 新版工作流套在 {"workflow": {...}} 里 */
  wrapper: boolean;
  lastNodeId: number;
  lastLinkId: number;
}

export interface DefWidget {
  kind: WidgetKind;
  options?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  controlAfter?: boolean;
  multiline?: boolean;
}

export interface DefInput {
  name: string;
  type: string;
  required: boolean;
  widget?: DefWidget;
}

export interface NodeDef {
  type: string;
  title: string;
  category: string;
  inputs: DefInput[];
  outputs: { name: string; type: string }[];
}

export type DefMap = Record<string, NodeDef>;

export interface GraphIssue {
  level: 'error' | 'warn';
  message: string;
  nodeId?: number;
}

const CONTROL_VALUES = ['fixed', 'increment', 'decrement', 'randomize'];
const WIDGET_LABELS: Record<string, string> = {
  seed: '种子',
  noise_seed: '种子',
  steps: '步数',
  cfg: 'CFG',
  sampler_name: '采样器',
  scheduler: '调度器',
  denoise: '降噪',
  text: '提示词',
  prompt: '提示词',
  ckpt_name: '模型权重',
  unet_name: '权重文件',
  clip_name1: 'CLIP 1',
  clip_name2: 'CLIP 2',
  vae_name: 'VAE',
  filename_prefix: '文件名前缀',
  control_after_generate: '生成后',
  width: '宽度',
  height: '高度',
  batch_size: '批量',
  image_gen_width: '生成宽度',
  image_gen_height: '生成高度',
};
const CONTROL_OPTIONS = [...CONTROL_VALUES];
const CARD_WIDTH = 210;
const CARD_HEADER = 30;
const CARD_PAD = 16;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ---------------------------------------------------------------- 节点定义 */

/** 把 /object_info 的原始表压成编辑器需要的形状。 */
export function defsFromObjectInfo(nodes: Record<string, unknown> | null | undefined): DefMap {
  const out: DefMap = {};
  if (!nodes) return out;
  for (const [type, raw] of Object.entries(nodes)) {
    const def = raw as Record<string, unknown>;
    const input = (def?.['input'] ?? {}) as Record<string, unknown>;
    const order = (def?.['input_order'] ?? {}) as Record<string, string[]>;
    const names: string[] = [];
    for (const group of ['required', 'optional'] as const) {
      for (const name of order[group] ?? []) names.push(name);
      // input_order 偶尔缺失：退回对象键序，至少不丢端口
      if (!(order[group] ?? []).length) {
        for (const name of Object.keys((input[group] ?? {}) as Record<string, unknown>)) {
          if (!names.includes(name)) names.push(name);
        }
      }
    }
    const inputs: DefInput[] = [];
    for (const name of names) {
      const required = Object.prototype.hasOwnProperty.call(input['required'] ?? {}, name);
      const spec = ((input['required'] ?? {}) as Record<string, unknown>)[name]
        ?? ((input['optional'] ?? {}) as Record<string, unknown>)[name];
      if (!Array.isArray(spec) || !spec.length) continue;
      inputs.push(readDefInput(name, spec as unknown[], required));
    }
    const outputTypes = Array.isArray(def['output']) ? (def['output'] as unknown[]) : [];
    const outputNames = Array.isArray(def['output_name']) ? (def['output_name'] as unknown[]) : [];
    const outputs = outputTypes.map((t, i) => ({
      name: String(outputNames[i] ?? t ?? `out${i}`),
      type: String(t ?? ''),
    }));
    out[type] = {
      type,
      title: String(def['display_name'] || def['name'] || type),
      category: String(def['category'] || ''),
      inputs,
      outputs,
    };
  }
  return out;
}

function readDefInput(name: string, spec: unknown[], required: boolean): DefInput {
  const head = spec[0];
  const opts = (spec[1] ?? {}) as Record<string, unknown>;
  const forceInput = !!opts['forceInput'];
  if (Array.isArray(head)) {
    const values = head as unknown[];
    return {
      name,
      type: 'COMBO',
      required,
      widget: {
        kind: 'combo',
        options: values.map((v) => String(v)),
        default: opts['default'] ?? (values.length ? String(values[0]) : ''),
      },
    };
  }
  const type = String(head ?? '');
  if (forceInput) return { name, type, required };
  if (type === 'INT' || type === 'FLOAT') {
    return {
      name,
      type,
      required,
      widget: {
        kind: 'number',
        default: opts['default'] ?? 0,
        min: typeof opts['min'] === 'number' ? opts['min'] : undefined,
        max: typeof opts['max'] === 'number' ? opts['max'] : undefined,
        step: type === 'FLOAT' ? num(opts['step'], 0.01) : 1,
        controlAfter: !!opts['control_after_generate'],
      },
    };
  }
  if (type === 'STRING') {
    return {
      name,
      type,
      required,
      widget: {
        kind: 'text',
        default: opts['default'] ?? '',
        multiline: !!opts['multiline'],
      },
    };
  }
  if (type === 'BOOLEAN') {
    return {
      name,
      type,
      required,
      widget: { kind: 'toggle', default: !!opts['default'] },
    };
  }
  if (type === 'COMBO') {
    const options = Array.isArray(opts['options']) ? (opts['options'] as unknown[]) : [];
    return {
      name,
      type,
      required,
      widget: {
        kind: 'combo',
        options: options.map((v) => String(v)),
        default: opts['default'] ?? (options.length ? String(options[0]) : ''),
      },
    };
  }
  return { name, type, required };
}

/** 节点定义到了之后再润色（标题、端口类型、控件候选值），不重建已有值。 */
export function applyDefs(graph: WorkflowGraph, defs: DefMap): void {
  for (const node of graph.nodes) {
    const def = defs[node.type];
    if (!def) continue;
    const rawTitle = typeof node.raw?.['title'] === 'string' ? String(node.raw['title']) : '';
    if (!rawTitle && (!node.title || node.title === node.type)) node.title = def.title;
    // 新导出的 UI 文件里，纯控件节点常常没有 inputs 元数据（inputs: null），
    // 解析时只能叫「参数 1」。拿到节点定义后按定义顺序把它们认回来。
    if (node.widgets.length && node.widgets.every((w) => /^参数 \d+$/.test(w.name))) {
      const specs = def.inputs.filter((i) => i.widget);
      const rebuilt: GraphWidget[] = [];
      let vi = 0;
      for (const spec of specs) {
        if (vi >= node.widgets.length) break;
        const source = node.widgets[vi++];
        rebuilt.push(widgetFromValue(spec.name, source.value, spec.widget));
        const control = spec.widget?.controlAfter;
        if (
          control &&
          vi < node.widgets.length &&
          typeof node.widgets[vi].value === 'string' &&
          CONTROL_VALUES.includes(String(node.widgets[vi].value))
        ) {
          rebuilt.push({
            name: 'control_after_generate',
            kind: 'combo',
            value: node.widgets[vi++].value,
            options: CONTROL_OPTIONS,
          });
        }
      }
      while (vi < node.widgets.length) rebuilt.push(node.widgets[vi++]);
      node.widgets = rebuilt;
    }
    for (const widget of node.widgets) {
      const spec = def.inputs.find((i) => i.name === widget.name && i.widget);
      if (!spec?.widget) continue;
      widget.kind = spec.widget.kind;
      if (spec.widget.options?.length) {
        widget.options = [...spec.widget.options];
        if (widget.kind === 'combo' && !widget.options.includes(String(widget.value))) {
          widget.options.unshift(String(widget.value));
        }
      }
      if (spec.widget.min !== undefined) widget.min = spec.widget.min;
      if (spec.widget.max !== undefined) widget.max = spec.widget.max;
      if (spec.widget.step !== undefined) widget.step = spec.widget.step;
    }
    if (graph.format === 'api') {
      // API 文件本身不存输出端口；定义到了以后补齐，没连出去过的节点才接得上线
      def.outputs.forEach((spec, index) => {
        if (!node.outputs[index]) {
          node.outputs[index] = { name: spec.name, type: spec.type, links: [] };
        } else {
          const output = node.outputs[index];
          if (!output.name || /^out\d+$/.test(output.name)) output.name = spec.name;
          if (!output.type) output.type = spec.type;
        }
      });
    }
  }
}

/* ---------------------------------------------------------------- 解析 */

export function parseWorkflow(
  data: unknown,
  format: WorkflowFormat,
  defs: DefMap = {},
): WorkflowGraph {
  if (format === 'broken' || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('不是有效的工作流文件');
  }
  const raw = clone(data as Record<string, unknown>);
  const graph = format === 'api' ? parseApi(raw, defs) : parseUi(raw, defs);
  applyDefs(graph, defs);
  return graph;
}

function parseUi(raw: Record<string, unknown>, defs: DefMap): WorkflowGraph {
  const inner = raw['workflow'];
  const wrapper = !!inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>)['nodes']);
  const container = (wrapper ? inner : raw) as Record<string, unknown>;
  const rawNodes = Array.isArray(container['nodes']) ? (container['nodes'] as unknown[]) : [];
  const nodes: GraphNode[] = [];

  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const id = num(n['id'], nodes.length + 1);
    const type = String(n['type'] ?? '');
    const inputs: GraphInput[] = (Array.isArray(n['inputs']) ? (n['inputs'] as unknown[]) : []).map(
      (entry, index) => {
        const i = (entry ?? {}) as Record<string, unknown>;
        const widget = i['widget'] as Record<string, unknown> | undefined;
        return {
          name: String(i['name'] ?? `in${index}`),
          type: String(i['type'] ?? ''),
          link: typeof i['link'] === 'number' ? i['link'] : null,
          ...(widget?.['name'] ? { widget: String(widget['name']) } : {}),
        };
      },
    );
    const outputs: GraphOutput[] = (Array.isArray(n['outputs']) ? (n['outputs'] as unknown[]) : []).map(
      (entry, index) => {
        const o = (entry ?? {}) as Record<string, unknown>;
        return {
          name: String(o['name'] ?? `out${index}`),
          type: String(o['type'] ?? ''),
          links: Array.isArray(o['links']) ? (o['links'] as unknown[]).map((v) => num(v)).filter((v) => v > 0) : [],
        };
      },
    );
    const pos = vec2(n['pos']);
    const size = vec2(n['size']);
    nodes.push({
      id,
      type,
      title: String(n['title'] || defs[type]?.title || type),
      pos: [pos[0], pos[1]],
      size: [size[0] || CARD_WIDTH, size[1]],
      inputs,
      outputs,
      widgets: readUiWidgets(n, defs[type]),
      raw: n,
    });
  }

  const links: GraphLink[] = [];
  for (const entry of Array.isArray(container['links']) ? (container['links'] as unknown[]) : []) {
    const link = readLink(entry);
    if (link) links.push(link);
  }
  // 连线表缺失时用节点端口上的 link / links 反向补齐，至少让画面有边
  if (!links.length) links.push(...deriveUiLinks(nodes));

  return {
    format: 'ui',
    nodes,
    links,
    raw,
    wrapper,
    lastNodeId: num(container['last_node_id'], nodes.reduce((m, n) => Math.max(m, n.id), 0)),
    lastLinkId: num(container['last_link_id'], links.reduce((m, l) => Math.max(m, l.id), 0)),
  };
}

/** ComfyUI 的向量通常是数组，但有些导出器写成 {"0":x,"1":y}，两种都接。 */
function vec2(value: unknown): [number, number] {
  if (Array.isArray(value)) return [num(value[0]), num(value[1])];
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return [num(v['0'] ?? v['x']), num(v['1'] ?? v['y'])];
  }
  return [0, 0];
}

function readLink(entry: unknown): GraphLink | null {
  if (Array.isArray(entry) && entry.length >= 5) {
    return {
      id: num(entry[0]),
      from: num(entry[1]),
      fromSlot: num(entry[2]),
      to: num(entry[3]),
      toSlot: num(entry[4]),
      type: String(entry[5] ?? ''),
    };
  }
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    return {
      id: num(o['id']),
      from: num(o['origin_id'] ?? o['from']),
      fromSlot: num(o['origin_slot'] ?? o['fromSlot']),
      to: num(o['target_id'] ?? o['to']),
      toSlot: num(o['target_slot'] ?? o['toSlot']),
      type: String(o['type'] ?? ''),
    };
  }
  return null;
}

function deriveUiLinks(nodes: GraphNode[]): GraphLink[] {
  const out: GraphLink[] = [];
  for (const node of nodes) {
    node.inputs.forEach((input, slot) => {
      if (input.link == null) return;
      for (const source of nodes) {
        const fromSlot = source.outputs.findIndex((o) => o.links.includes(input.link as number));
        if (fromSlot < 0) continue;
        out.push({ id: input.link, from: source.id, fromSlot, to: node.id, toSlot: slot, type: input.type });
        return;
      }
    });
  }
  return out;
}

function readUiWidgets(n: Record<string, unknown>, def?: NodeDef): GraphWidget[] {
  const values = Array.isArray(n['widgets_values']) ? (n['widgets_values'] as unknown[]) : [];
  const rawInputs = Array.isArray(n['inputs']) ? (n['inputs'] as unknown[]) : [];
  const widgets: GraphWidget[] = [];
  let vi = 0;

  for (const entry of rawInputs) {
    const input = (entry ?? {}) as Record<string, unknown>;
    const widget = input['widget'] as Record<string, unknown> | undefined;
    if (!widget?.['name']) continue;
    const name = String(widget['name']);
    const spec = def?.inputs.find((i) => i.name === name && i.widget);
    const value = values[vi++];
    widgets.push(widgetFromValue(name, value, spec?.widget));
    const next = values[vi];
    const control = spec?.widget?.controlAfter ?? (
      typeof next === 'string' && CONTROL_VALUES.includes(next)
    );
    if (control) {
      widgets.push({
        name: 'control_after_generate',
        label: WIDGET_LABELS['control_after_generate'],
        kind: 'combo',
        value: typeof next === 'string' ? next : 'fixed',
        options: CONTROL_OPTIONS,
      });
      vi += 1;
    }
  }
  // 没有 inputs 元数据的自定义节点：按原顺序保留，宁可只读也不能错位
  while (vi < values.length) {
    const value = values[vi];
    widgets.push({
      name: `参数 ${vi + 1}`,
      kind: inferKind(value),
      value,
    });
    vi += 1;
  }
  return widgets;
}

function widgetFromValue(name: string, value: unknown, spec?: DefWidget): GraphWidget {
  if (spec) {
    const effective = value === undefined ? spec.default : value;
    const options = spec.options ? [...spec.options] : undefined;
    if (options && effective !== undefined && !options.includes(String(effective))) {
      options.unshift(String(effective));
    }
    return {
      name,
      ...(WIDGET_LABELS[name] ? { label: WIDGET_LABELS[name] } : {}),
      kind: spec.kind,
      value: effective,
      ...(options ? { options } : {}),
      ...(spec.min !== undefined ? { min: spec.min } : {}),
      ...(spec.max !== undefined ? { max: spec.max } : {}),
      ...(spec.step !== undefined ? { step: spec.step } : {}),
    };
  }
  return { name, ...(WIDGET_LABELS[name] ? { label: WIDGET_LABELS[name] } : {}), kind: inferKind(value), value };
}

function inferKind(value: unknown): WidgetKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'toggle';
  if (typeof value === 'string') return 'text';
  return 'raw';
}

function parseApi(raw: Record<string, unknown>, defs: DefMap): WorkflowGraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let linkId = 1;
  let maxId = 0;

  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['class_type'] !== 'string') continue;
    const id = num(e['id'] ?? key, nodes.length + 1);
    maxId = Math.max(maxId, id);
    const type = String(e['class_type']);
    const meta = (e['_meta'] ?? {}) as Record<string, unknown>;
    const inputs: GraphInput[] = [];
    const widgets: GraphWidget[] = [];
    const def = defs[type];

    for (const [name, value] of Object.entries((e['inputs'] ?? {}) as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
        const slot = num(value[1]);
        inputs.push({ name, type: def?.inputs.find((i) => i.name === name)?.type ?? '', link: linkId });
        links.push({
          id: linkId,
          from: num(value[0]),
          fromSlot: slot,
          to: id,
          toSlot: inputs.length - 1,
          type: def?.inputs.find((i) => i.name === name)?.type ?? '',
        });
        linkId += 1;
        continue;
      }
      const spec = def?.inputs.find((i) => i.name === name)?.widget;
      widgets.push(widgetFromValue(name, value, spec));
    }

    nodes.push({
      id,
      type,
      title: String(meta['title'] || def?.title || type),
      pos: [0, 0],
      size: [CARD_WIDTH, 0],
      inputs,
      outputs: (def?.outputs ?? []).map((o) => ({ name: o.name, type: o.type, links: [] })),
      widgets,
      raw: e,
    });
  }

  for (const link of links) {
    const source = nodes.find((n) => n.id === link.from);
    if (!source) continue;
    while (source.outputs.length <= link.fromSlot) {
      source.outputs.push({ name: `out${source.outputs.length}`, type: '', links: [] });
    }
    const output = source.outputs[link.fromSlot];
    output.links.push(link.id);
    if (!link.type) link.type = output.type;
  }

  return {
    format: 'api',
    nodes,
    links,
    raw,
    wrapper: false,
    lastNodeId: maxId,
    lastLinkId: linkId - 1,
  };
}

/* ---------------------------------------------------------------- 输出 */

/** UI 格式写回 UI；API 格式写回 API。返回值永远是可直接落盘的 JSON 对象。 */
export function serializeWorkflow(graph: WorkflowGraph): Record<string, unknown> {
  return graph.format === 'api' ? serializeApi(graph) : serializeUi(graph);
}

function serializeUi(graph: WorkflowGraph): Record<string, unknown> {
  const root = clone(graph.raw);
  const container = graph.wrapper
    ? ((root['workflow'] as Record<string, unknown> | undefined) ?? root)
    : root;

  container['nodes'] = graph.nodes.map((node) => {
    const base = node.raw ? clone(node.raw) : {};
    base['id'] = node.id;
    base['type'] = node.type;
    const hadTitle = typeof base['title'] === 'string' && base['title'] !== '';
    if (hadTitle || node.title !== node.type) base['title'] = node.title;
    else delete base['title'];
    base['pos'] = [round(node.pos[0]), round(node.pos[1])];
    // 只有新节点才补 size；已有节点原样保留，连小数和对象写法都不动
    if (base['size'] === undefined) {
      base['size'] = [Math.round(node.size[0] || CARD_WIDTH), Math.round(node.size[1] || 0)];
    }
    const oldInputs = Array.isArray(base['inputs']) ? (base['inputs'] as unknown[]) : [];
    base['inputs'] = node.inputs.map((input, index) => {
      const old = oldInputs[index] && typeof oldInputs[index] === 'object'
        ? (oldInputs[index] as Record<string, unknown>)
        : {};
      const merged: Record<string, unknown> = {
        ...old,
        name: input.name,
        type: input.type,
        link: input.link,
      };
      if (input.widget) {
        const oldWidget = old['widget'];
        merged['widget'] = {
          ...(oldWidget && typeof oldWidget === 'object' ? oldWidget : {}),
          name: input.widget,
        };
      } else delete merged['widget'];
      return merged;
    });
    const oldOutputs = Array.isArray(base['outputs']) ? (base['outputs'] as unknown[]) : [];
    base['outputs'] = node.outputs.map((output, index) => {
      const old = oldOutputs[index] && typeof oldOutputs[index] === 'object'
        ? (oldOutputs[index] as Record<string, unknown>)
        : {};
      return {
        ...old,
        name: output.name,
        type: output.type,
        links: [...output.links],
        slot_index: index,
      };
    });
    base['widgets_values'] = node.widgets.map((w) => w.value);
    return base;
  });

  container['links'] = graph.links.map((l) => [l.id, l.from, l.fromSlot, l.to, l.toSlot, l.type]);
  if (graph.lastNodeId || container['last_node_id'] !== undefined) {
    container['last_node_id'] = Math.max(graph.lastNodeId, ...graph.nodes.map((n) => n.id));
  }
  if (graph.lastLinkId || container['last_link_id'] !== undefined) {
    container['last_link_id'] = Math.max(graph.lastLinkId, ...graph.links.map((l) => l.id));
  }
  return root;
}

function serializeApi(graph: WorkflowGraph): Record<string, unknown> {
  const root = clone(graph.raw);
  const ids = new Set(graph.nodes.map((n) => String(n.id)));
  for (const key of Object.keys(root)) {
    if (!ids.has(key)) delete root[key];
  }
  for (const node of graph.nodes) {
    const base = node.raw ? clone(node.raw) : {};
    base['class_type'] = node.type;
    const inputs: Record<string, unknown> = {};
    for (const widget of node.widgets) {
      if (widget.name === 'control_after_generate') continue;
      inputs[widget.name] = widget.value;
    }
    for (const input of node.inputs) {
      if (input.link == null) continue;
      const link = graph.links.find((l) => l.id === input.link);
      if (link) inputs[input.name] = [String(link.from), link.fromSlot];
    }
    base['inputs'] = inputs;
    const oldMeta = base['_meta'];
    const meta: Record<string, unknown> = {
      ...(oldMeta && typeof oldMeta === 'object' ? (oldMeta as Record<string, unknown>) : {}),
      title: node.title,
    };
    if (Object.keys(meta).length) base['_meta'] = meta;
    root[String(node.id)] = base;
  }
  return root;
}

/* ---------------------------------------------------------------- 编辑 */

export function createNode(graph: WorkflowGraph, def: NodeDef, at: [number, number]): GraphNode {
  const id = Math.max(graph.lastNodeId, ...graph.nodes.map((n) => n.id), 0) + 1;
  const widgets: GraphWidget[] = [];
  const inputs: GraphInput[] = [];
  for (const input of def.inputs) {
    if (input.widget) {
      inputs.push({ name: input.name, type: input.widget.kind === 'combo' ? 'COMBO' : input.type, link: null, widget: input.name });
      widgets.push({
        name: input.name,
        kind: input.widget.kind,
        value: input.widget.default,
        ...(input.widget.options ? { options: [...input.widget.options] } : {}),
        ...(input.widget.min !== undefined ? { min: input.widget.min } : {}),
        ...(input.widget.max !== undefined ? { max: input.widget.max } : {}),
        ...(input.widget.step !== undefined ? { step: input.widget.step } : {}),
      });
      if (input.widget.controlAfter) {
        widgets.push({
          name: 'control_after_generate',
          label: WIDGET_LABELS['control_after_generate'],
          kind: 'combo',
          value: 'fixed',
          options: CONTROL_OPTIONS,
        });
      }
    } else {
      inputs.push({ name: input.name, type: input.type, link: null });
    }
  }
  const node: GraphNode = {
    id,
    type: def.type,
    title: def.title,
    pos: [Math.round(at[0]), Math.round(at[1])],
    size: [CARD_WIDTH, 0],
    inputs,
    outputs: def.outputs.map((o) => ({ name: o.name, type: o.type, links: [] })),
    widgets,
    raw: { id, type: def.type, title: def.title },
  };
  node.size = [CARD_WIDTH, cardHeight(node)];
  graph.nodes.push(node);
  graph.lastNodeId = Math.max(graph.lastNodeId, id);
  return node;
}

/** 建立一条连线；类型不兼容或端点不存在时返回 null。 */
export function connect(
  graph: WorkflowGraph,
  from: number,
  fromSlot: number,
  to: number,
  toSlot: number,
): GraphLink | null {
  if (from === to) return null;
  const source = graph.nodes.find((n) => n.id === from);
  const target = graph.nodes.find((n) => n.id === to);
  const output = source?.outputs[fromSlot];
  const input = target?.inputs[toSlot];
  if (!source || !target || !output || !input) return null;
  if (!compatible(output.type, input.type)) return null;

  if (input.link != null) disconnect(graph, input.link);
  const id = Math.max(graph.lastLinkId, ...graph.links.map((l) => l.id), 0) + 1;
  const link: GraphLink = { id, from, fromSlot, to, toSlot, type: output.type || input.type };
  graph.links.push(link);
  graph.lastLinkId = id;
  input.link = id;
  output.links.push(id);
  return link;
}

function compatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a === '*' || b === '*') return true;
  return a.toUpperCase() === b.toUpperCase();
}

export function disconnect(graph: WorkflowGraph, linkId: number): void {
  const index = graph.links.findIndex((l) => l.id === linkId);
  if (index < 0) return;
  const link = graph.links[index];
  graph.links.splice(index, 1);
  const target = graph.nodes.find((n) => n.id === link.to);
  const input = target?.inputs[link.toSlot];
  if (input && input.link === linkId) input.link = null;
  const source = graph.nodes.find((n) => n.id === link.from);
  const output = source?.outputs[link.fromSlot];
  if (output) output.links = output.links.filter((id) => id !== linkId);
}

export function removeNode(graph: WorkflowGraph, id: number): void {
  for (const link of graph.links.filter((l) => l.from === id || l.to === id)) {
    disconnect(graph, link.id);
  }
  graph.nodes = graph.nodes.filter((n) => n.id !== id);
}

/* ---------------------------------------------------------------- 排版 */

export function visibleInputs(node: GraphNode): { input: GraphInput; index: number }[] {
  return node.inputs
    .map((input, index) => ({ input, index }))
    .filter((row) => !row.input.widget);
}

export function cardHeight(node: GraphNode): number {
  const inputs = visibleInputs(node).length;
  const widgets = Math.max(0, node.widgets.length);
  const outputs = node.outputs.length ? 8 + node.outputs.length * 20 : 0;
  return CARD_HEADER + CARD_PAD + inputs * 22 + widgets * 27 + outputs;
}

/**
 * 分层排版：列 = 数据流深度，行 = 同一列里的顺序。
 * 每列居中到同一条水平线上，主链路自然接近一条直线。
 */
export function autoLayout(graph: WorkflowGraph): Record<number, [number, number]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  const indegree = new Map<number, number>();
  for (const node of graph.nodes) {
    parents.set(node.id, []);
    children.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const link of graph.links) {
    if (!byId.has(link.from) || !byId.has(link.to)) continue;
    parents.get(link.to)?.push(link.from);
    children.get(link.from)?.push(link.to);
    indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
  }

  // 1) 数据流深度：最长路径。消费者永远在生产者右边。
  const rank = new Map<number, number>();
  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) rank.set(id, 0);
  while (queue.length) {
    const id = queue.shift() as number;
    for (const child of children.get(id) ?? []) {
      rank.set(child, Math.max(rank.get(child) ?? 0, (rank.get(id) ?? 0) + 1));
      const left = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  const maxRank = Math.max(0, ...rank.values());
  for (const node of graph.nodes) {
    if (!rank.has(node.id)) rank.set(node.id, maxRank + 1);
  }

  // 2) 供给节点前移：只有出边、又只服务少数下游的加载器，不该钉死在最左列。
  //    把它放到最早消费者的前一列，长线立刻缩短，也不破坏左右方向。
  const placeRank = new Map(rank);
  for (const node of graph.nodes) {
    if ((parents.get(node.id) ?? []).length) continue;
    const kids = children.get(node.id) ?? [];
    if (!kids.length) continue;
    const earliest = Math.min(...kids.map((id) => rank.get(id) ?? 0));
    if (earliest > 0) placeRank.set(node.id, Math.max(0, earliest - 1));
  }

  // 3) 交叉最小化：按相邻列的重心排序，来回各扫两遍。
  const columns = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const r = placeRank.get(node.id) ?? 0;
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r)?.push(node);
  }
  const ranks = [...columns.keys()].sort((a, b) => a - b);
  const order = new Map(graph.nodes.map((n, index) => [n.id, index]));
  const meanOf = (node: GraphNode, neighbours: number[] | undefined): number => {
    const values = (neighbours ?? [])
      .map((id) => order.get(id))
      .filter((value): value is number => value !== undefined);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : (order.get(node.id) ?? 0);
  };
  const sortColumn = (list: GraphNode[], neighbours: (node: GraphNode) => number[] | undefined): void => {
    list.sort((a, b) => meanOf(a, neighbours(a)) - meanOf(b, neighbours(b)));
    list.forEach((node, index) => order.set(node.id, index));
  };
  for (let pass = 0; pass < 4; pass += 1) {
    if (pass % 2 === 0) {
      for (const r of ranks) {
        if (r === 0) continue;
        sortColumn(columns.get(r) as GraphNode[], (node) => parents.get(node.id));
      }
    } else {
      for (const r of [...ranks].reverse()) {
        if (r === maxRank) continue;
        sortColumn(columns.get(r) as GraphNode[], (node) => children.get(node.id));
      }
    }
  }

  const centerY = 320;
  // 顶部留一条总线槽：长线从卡片上方绕，不压卡片
  const TOP_MARGIN = 110;
  const positions: Record<number, [number, number]> = {};
  // 前移供给节点后会空出整列；显示时按「实际有节点的列」连续编号，不留空档
  const displayRank = new Map<number, number>();
  ranks.forEach((rankValue, index) => displayRank.set(rankValue, index));
  for (const r of ranks) {
    const list = columns.get(r) as GraphNode[];
    const heights = list.map((n) => cardHeight(n));
    const total = heights.reduce((sum, h) => sum + h + 26, -26);
    let y = Math.max(TOP_MARGIN, centerY - total / 2);
    const x = 40 + (displayRank.get(r) ?? 0) * (CARD_WIDTH + 78);
    list.forEach((node, index) => {
      positions[node.id] = [x, Math.round(y)];
      y += heights[index] + 26;
    });
  }
  return positions;
}

/**
 * 配置类端口：模型、CLIP、VAE、采样器、噪声、调度曲线……
 * 这些线连的是「插头」，不是生成数据本身；卡片上的 `model ← 某节点` 已经
 * 说清来源，默认不必让它们横穿画布。
 */
export const SUPPLY_LINK_TYPES = new Set([
  'MODEL',
  'CLIP',
  'VAE',
  'SAMPLER',
  'SIGMAS',
  'NOISE',
  'GUIDER',
  'CONTROL_NET',
  'STYLE_MODEL',
  'CLIP_VISION',
  'CLIP_VISION_OUTPUT',
  'UPSCALE_MODEL',
  'TAESD',
  'LORA_MODEL',
]);

/** 加载器 / 图片输入 / 注释：这些节点的连线是「供料」，不是主数据流。 */
export function isSupplyNode(node: GraphNode): boolean {
  const type = node.type.toLowerCase();
  return /loader|checkpoint|loadimage|primitive|note|reroute/.test(type);
}

/* ---------------------------------------------------------------- 校验 */

export function validateGraph(graph: WorkflowGraph, defs: DefMap = {}): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<number>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      issues.push({ level: 'error', message: `节点 id 重复：#${node.id}`, nodeId: node.id });
    }
    ids.add(node.id);
  }
  const linkIds = new Set(graph.links.map((l) => l.id));
  for (const link of graph.links) {
    if (!ids.has(link.from)) {
      issues.push({ level: 'error', message: `连线 #${link.id} 的来源节点 #${link.from} 不存在`, nodeId: link.to });
    }
    if (!ids.has(link.to)) {
      issues.push({ level: 'error', message: `连线 #${link.id} 的目标节点 #${link.to} 不存在`, nodeId: link.from });
    }
  }
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      if (input.link != null && !linkIds.has(input.link)) {
        issues.push({ level: 'error', message: `${node.title} 的输入「${input.name}」指向不存在的连线`, nodeId: node.id });
      }
    }
    const def = defs[node.type];
    if (!def) continue;
    for (const spec of def.inputs) {
      if (!spec.required || spec.widget) continue;
      const input = node.inputs.find((i) => i.name === spec.name);
      if (input && input.link == null) {
        issues.push({ level: 'warn', message: `${node.title} 的必填输入「${spec.name}」还没连接`, nodeId: node.id });
      }
    }
  }
  return issues;
}

/* ---------------------------------------------------------------- 小工具 */

export function nodeById(graph: WorkflowGraph, id: number | null): GraphNode | null {
  if (id == null) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

export function inputSource(graph: WorkflowGraph, input: GraphInput): { node: GraphNode; output: GraphOutput } | null {
  if (input.link == null) return null;
  const link = graph.links.find((l) => l.id === input.link);
  if (!link) return null;
  const node = nodeById(graph, link.from);
  const output = node?.outputs[link.fromSlot];
  return node && output ? { node, output } : null;
}

export function linkFor(graph: WorkflowGraph, input: GraphInput): GraphLink | null {
  if (input.link == null) return null;
  return graph.links.find((l) => l.id === input.link) ?? null;
}
