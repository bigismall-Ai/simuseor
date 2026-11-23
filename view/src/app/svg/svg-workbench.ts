import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../core/theme.service';
import { UiMaterialModule } from '../ui/material';
import {
  allElements,
  byteLength,
  digestJson,
  digestText,
  formatBytes,
  parseSvg,
  type SvgDocument,
  type SvgStats,
} from './core/svg-doc';
import { analyze, type Finding } from './core/svg-analyze';
import {
  PASSES,
  SAFE_PASSES,
  runPasses,
  type OptimizeOptions,
  type PassId,
  type PassReport,
} from './core/svg-optimize';
import {
  PATCH_EXAMPLE,
  PATCH_SPEC,
  applyPatch,
  resolveTarget,
  type PatchIssue,
  type PatchOp,
} from './core/svg-patch';
import { sanitizeSvgText } from './core/svg-sanitize';
import { loadSvgAsset, loadSvgIndex, type SvgAsset, type SvgIndex } from './core/svg-assets';
import {
  batchReportCsv,
  batchReportJson,
  batchReportMarkdown,
  renderLabel,
  runBatch,
  summarize,
  type BatchRow,
} from './core/svg-batch';
import { createZip } from './core/svg-zip';
import {
  applySemanticPlan,
  collectSemanticParts,
  diffSemanticParts,
  parseSemanticPlan,
  semanticFingerprint,
  validateSemantics,
  type SemanticDiff,
  type SemanticIssue,
} from './core/svg-semantics';
import { buildContextPack } from './core/svg-context';
import { SvgSemanticsPanelComponent } from './svg-semantics-panel';
import type { SvgPick } from './core/svg-types';
import {
  createGradient,
  gradientCss,
  listGradients,
  setDirection,
  setStops,
  type GradientDirection,
  type GradientInfo,
  type GradientStop,
} from './core/svg-gradient';
import { SvgStageComponent, type SvgTool } from './svg-stage';

type Tab = 'diagnose' | 'batch' | 'tree' | 'code' | 'patch' | 'prompt' | 'semantic';
type Mode = 'edit' | 'inspect' | 'ai';
type ViewMode = 'working' | 'optimized';
type BatchMode = 'canonical' | 'stable' | 'optimize' | 'ids';

interface Snapshot {
  label: string;
  text: string;
  at: number;
}

interface GroupView {
  id: string;
  label: string;
  assets: SvgAsset[];
}

interface SizeRow {
  label: string;
  bytes: number;
  ratio: number;
}

interface PatchReport {
  applied: number;
  issues: PatchIssue[];
  bytes: number;
}

interface EditField {
  name: string;
  label: string;
  value: string;
  numeric: boolean;
}

interface LayerRow {
  key: string;
  tag: string;
  id: string | null;
  selector: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  childCount: number;
  role: string | null;
  label: string | null;
  active: boolean;
}

const LAYER_HIDDEN = new Set([
  'defs',
  'style',
  'title',
  'desc',
  'metadata',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'filter',
  'pattern',
  'symbol',
  'marker',
]);

const TAG_FIELDS: Record<string, string[]> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  image: ['x', 'y', 'width', 'height'],
  use: ['x', 'y', 'width', 'height'],
  text: ['x', 'y', 'font-size'],
  svg: ['viewBox'],
};

const FIELD_LABELS: Record<string, string> = {
  x: 'x',
  y: 'y',
  width: '宽',
  height: '高',
  rx: 'rx',
  ry: 'ry',
  cx: 'cx',
  cy: 'cy',
  r: '半径',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  'font-size': '字号',
  fill: '填充',
  stroke: '描边',
  'stroke-width': '描边宽',
  opacity: '不透明度',
  viewBox: 'viewBox',
};

const NUMERIC_FIELDS = new Set([
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2', 'font-size', 'stroke-width', 'opacity',
]);

const PASS_SHORT: Record<PassId, string> = {
  'inline-css': '内联 CSS',
  'expand-style': '展开 style',
  'round-numbers': '精度',
  'compact-path': '压缩 path',
  'strip-editor': '清元数据',
  'strip-unsafe': '清风险',
  'remove-comments': '去注释',
  'remove-empty': '去空容器',
  'remove-unused-defs': '去未引用 defs',
  'assign-ids': '补 id',
  'stable-ids': '稳定 id',
  'strip-title': '去 title',
};



@Component({
  selector: 'app-svg-workbench',
  imports: [RouterLink, UiMaterialModule, SvgStageComponent, SvgSemanticsPanelComponent],
  templateUrl: './svg-workbench.html',
  styleUrl: './svg-workbench.scss',
})
export class SvgWorkbenchComponent {
  readonly theme = inject(ThemeService);
  private readonly stage = viewChild(SvgStageComponent);

  /** 右栏按“编辑 → 检查 → AI”三层组织，避免一上来就把七个 tab 摊给人看。 */
  readonly modes: Array<{ id: Mode; label: string; hint: string; tabs: Array<{ id: Tab; label: string }> }> = [
    {
      id: 'edit',
      label: '编辑',
      hint: '先在画布或图层里选元素，再改属性；也可以直接改源码文本。',
      tabs: [
        { id: 'tree', label: '结构' },
        { id: 'code', label: '源码' },
      ],
    },
    {
      id: 'inspect',
      label: '检查',
      hint: '诊断问题并逐条修复；批量处理只读仓库文件，结果打包下载。',
      tabs: [
        { id: 'diagnose', label: '诊断' },
        { id: 'batch', label: '批量' },
      ],
    },
    {
      id: 'ai',
      label: 'AI',
      hint: '给 LLM 读上下文、贴回 JSON 补丁、维护部件语义。',
      tabs: [
        { id: 'semantic', label: '语义' },
        { id: 'prompt', label: '提示词' },
        { id: 'patch', label: '补丁' },
      ],
    },
  ];
  readonly mode = signal<Mode>('edit');
  readonly activeMode = computed(() => this.modes.find((m) => m.id === this.mode()) ?? this.modes[0]);
  readonly activeTabs = computed(() => this.activeMode().tabs);
  readonly precisions = [0, 1, 2, 3, 4];
  readonly passList = PASSES;
  readonly safePasses = SAFE_PASSES;
  readonly patchExample = PATCH_EXAMPLE;
  readonly patchSpec = PATCH_SPEC;

  readonly index = signal<SvgIndex>({ groups: [], assets: [] });
  readonly filter = signal('');
  readonly current = signal<SvgAsset | null>(null);
  readonly originalText = signal('');
  readonly workingText = signal('');
  readonly optimizedText = signal<string | null>(null);
  readonly optimizedReports = signal<PassReport[]>([]);
  readonly viewMode = signal<ViewMode>('working');
  readonly precision = signal(2);
  readonly tab = signal<Tab>('tree');
  readonly selection = signal<SvgPick | null>(null);
  readonly snapshots = signal<Snapshot[]>([]);
  readonly toastText = signal('');
  readonly codeDraft = signal('');
  readonly patchDraft = signal(PATCH_EXAMPLE);
  readonly patchReport = signal<PatchReport | null>(null);
  readonly includeSource = signal(true);

  readonly batchRows = signal<BatchRow[]>([]);
  readonly batchRunning = signal(false);
  readonly batchDone = signal(0);
  readonly batchTotal = signal(0);
  readonly batchCurrent = signal('');
  readonly batchOnlyChanged = signal(true);
  readonly batchSafeOnly = signal(true);
  readonly batchPrecision = signal(2);
  readonly batchMode = signal<BatchMode>('optimize');
  readonly batchModeUsed = signal<BatchMode>('optimize');
  readonly nudgeX = signal(1);
  readonly nudgeY = signal(0);
  readonly tool = signal<SvgTool>('select');
  readonly penColor = signal('#b95e4e');
  readonly newWidth = signal(512);
  readonly newHeight = signal(512);
  readonly newBackground = signal(false);
  readonly swatches = [
    '#222c28',
    '#b95e4e',
    '#68756c',
    '#ece8de',
    '#ffffff',
    '#0e1026',
    '#5658ff',
    '#54e8d1',
  ];

  private batchStop = false;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly doc = computed<SvgDocument | null>(() => {
    const raw = this.workingText();
    if (!raw.trim()) return null;
    const parsed = parseSvg(raw);
    return parsed.ok ? parsed.doc : null;
  });

  readonly parseError = computed<string | null>(() => {
    const raw = this.workingText();
    if (!raw.trim()) return null;
    const parsed = parseSvg(raw);
    if (parsed.ok) return null;
    const { message, line, column } = parsed.error;
    return line ? `${message}（第 ${line} 行${column ? `，第 ${column} 列` : ''}）` : message;
  });

  readonly stats = computed<SvgStats | null>(() => {
    const doc = this.doc();
    return doc ? doc.stats(byteLength(this.workingText())) : null;
  });

  readonly originalBytes = computed(() => byteLength(this.originalText()));
  readonly canonicalText = computed(() => {
    const doc = this.doc();
    return doc ? doc.canonical({ precision: this.precision() }) : this.workingText();
  });
  readonly canonicalBytes = computed(() => byteLength(this.canonicalText()));

  readonly findings = computed<Finding[]>(() => {
    const doc = this.doc();
    return doc ? analyze(doc.root, this.workingText(), this.precision()) : [];
  });

  readonly errorCount = computed(() => this.findings().filter((f) => f.severity === 'error').length);
  readonly warnCount = computed(() => this.findings().filter((f) => f.severity === 'warn').length);

  readonly digest = computed(() => {
    const doc = this.doc();
    const stats = this.stats();
    return doc && stats ? digestText(doc.root, stats) : '';
  });

  readonly digestObject = computed(() => {
    const doc = this.doc();
    return doc ? digestJson(doc.root) : null;
  });

  readonly groupedAssets = computed<GroupView[]>(() => {
    const index = this.index();
    const needle = this.filter().trim().toLowerCase();
    return index.groups
      .map((group) => ({
        id: group.id,
        label: group.label,
        assets: index.assets.filter(
          (a) =>
            a.group === group.id &&
            (!needle || a.name.toLowerCase().includes(needle) || a.viewBox?.includes(needle)),
        ),
      }))
      .filter((g) => g.assets.length > 0);
  });

  readonly optimizedBytes = computed(() => {
    const text = this.optimizedText();
    return text ? byteLength(text) : 0;
  });

  readonly sizeRows = computed<SizeRow[]>(() => {
    const rows = [
      { label: '原始', bytes: this.originalBytes() },
      { label: '规范化', bytes: this.canonicalBytes() },
    ];
    const optimized = this.optimizedBytes();
    if (optimized > 0) rows.push({ label: '优化后', bytes: optimized });
    const max = Math.max(...rows.map((r) => r.bytes), 1);
    return rows.map((r) => ({ ...r, ratio: r.bytes / max }));
  });

  readonly savedRatio = computed(() => {
    const original = this.originalBytes();
    const canonical = this.canonicalBytes();
    if (!original) return 0;
    return Math.round(((original - canonical) / original) * 100);
  });

  readonly codeBytes = computed(() => byteLength(this.codeDraft()));
  readonly codeDirty = computed(() => this.codeDraft().trim() !== this.canonicalText().trim());

  readonly batchSummary = computed(() => summarize(this.batchRows()));
  readonly batchModeLabel = computed(() => {
    const mode = this.batchModeUsed();
    if (mode === 'canonical') return '仅规范化';
    if (mode === 'stable') return '仅稳定 id';
    if (mode === 'optimize') return '规范化 + 优化';
    return '优化 + 稳定 id';
  });
  readonly batchPercent = computed(() => {
    const total = this.batchTotal();
    return total > 0 ? Math.round((this.batchDone() / total) * 100) : 0;
  });
  readonly batchChangedCount = computed(() => this.batchRows().filter((r) => r.status === 'changed').length);
  readonly batchPackRows = computed(() => {
    const rows = this.batchRows().filter((r) => r.status === 'changed');
    if (!this.batchSafeOnly()) return rows;
    return rows.filter((r) => r.render.status === 'identical' || r.render.status === 'minor');
  });
  readonly batchVisible = computed(() => {
    const rows = this.batchRows();
    const filtered = this.batchOnlyChanged() ? rows.filter((r) => r.status !== 'unchanged') : rows;
    return [...filtered].sort((a, b) => b.saved - a.saved);
  });

  readonly writebackManifest = computed(() => ({
    version: 1,
    generator: 'view/svg-workbench',
    mode: this.batchModeUsed(),
    generatedAt: new Date().toISOString(),
    precision: this.batchPrecision(),
    entries: this.batchPackRows().map((row) => ({
      path: row.path,
      sourceSize: row.before,
      sourceCrc32: row.sourceCrc32,
      text: row.optimized,
    })),
  }));

  readonly writebackJson = computed(() => JSON.stringify(this.writebackManifest(), null, 2));

  readonly selectionTarget = computed(() => {
    const sel = this.selection();
    if (!sel) return '';
    return sel.id ? `#${sel.id}` : sel.selector;
  });

  readonly selectedElement = computed<Element | null>(() => {
    const doc = this.doc();
    const target = this.selectionTarget();
    if (!doc || !target) return null;
    return resolveTarget(doc, target);
  });

  readonly selectedHasClass = computed(() => Boolean(this.selectedElement()?.getAttribute('class')));
  readonly hasStyleBlock = computed(() => (this.stats()?.styleBlocks ?? 0) > 0);

  readonly selectedAttrs = computed<Array<[string, string]>>(() => {
    const el = this.selectedElement();
    if (!el) return [];
    return Array.from(el.attributes).map((attr) => [
      attr.name,
      attr.value.length > 64 ? `${attr.value.slice(0, 61)}…` : attr.value,
    ]);
  });

  readonly gradients = computed<GradientInfo[]>(() => {
    const doc = this.doc();
    return doc ? listGradients(doc.root) : [];
  });

  readonly activeGradient = computed<
    { channel: 'fill' | 'stroke'; id: string; info: GradientInfo | null } | null
  >(() => {
    const el = this.selectedElement();
    if (!el) return null;
    for (const channel of ['fill', 'stroke'] as const) {
      const value = el.getAttribute(channel) ?? '';
      const match = /^url\(#([^)]+)\)$/.exec(value.trim());
      if (!match) continue;
      return {
        channel,
        id: match[1],
        info: this.gradients().find((g) => g.id === match[1]) ?? null,
      };
    }
    return null;
  });

  readonly editFields = computed<EditField[]>(() => {
    const el = this.selectedElement();
    if (!el) return [];
    const names = new Set([...(TAG_FIELDS[el.localName] ?? []), 'fill', 'stroke', 'stroke-width', 'opacity']);
    return Array.from(names).map((name) => ({
      name,
      label: FIELD_LABELS[name] ?? name,
      value: el.getAttribute(name) ?? '',
      numeric: NUMERIC_FIELDS.has(name),
    }));
  });

  readonly previewText = computed(() => {
    const mode = this.viewMode();
    const text = mode === 'optimized' ? (this.optimizedText() ?? this.workingText()) : this.workingText();
    return sanitizeSvgText(text).text;
  });

  readonly layerRows = computed<LayerRow[]>(() => {
    const doc = this.doc();
    if (!doc) return [];
    const collapsed = this.layerCollapsed();
    const sel = this.selection();
    const rows: LayerRow[] = [];

    const walk = (el: Element, depth: number): void => {
      const id = el.getAttribute('id');
      const selector = id ? `#${id}` : this.selectorFor(el);
      const key = selector;
      const children = Array.from(el.children).filter(
        (child) => !LAYER_HIDDEN.has(child.localName.toLowerCase()),
      );
      const isCollapsed = collapsed.has(id ?? selector);
      rows.push({
        key,
        tag: el.localName,
        id,
        selector,
        depth,
        hasChildren: children.length > 0,
        collapsed: isCollapsed,
        childCount: children.length,
        role: el.getAttribute('data-role'),
        label: el.getAttribute('data-label'),
        active:
          !!sel &&
          ((!!id && sel.id === id) || (!id && sel.selector === selector) || (el === doc.root && sel.selector === 'svg')),
      });
      if (children.length > 0 && !isCollapsed) {
        for (const child of children) walk(child, depth + 1);
      }
    };

    walk(doc.root, 0);
    return rows;
  });

  readonly semanticParts = computed(() => {
    const doc = this.doc();
    return doc ? collectSemanticParts(doc.root) : [];
  });

  readonly semanticFp = computed(() => {
    const doc = this.doc();
    return doc ? semanticFingerprint(doc.root) : '';
  });

  readonly semanticIssues = signal<SemanticIssue[]>([]);
  readonly semanticDiff = signal<SemanticDiff | null>(null);
  readonly layerCollapsed = signal<Set<string>>(new Set());

  readonly prompt = computed(() => {
    const doc = this.doc();
    const stats = this.stats();
    if (!doc || !stats) return '当前没有可解析的 SVG。';
    const locked = this.semanticParts()
      .filter((part) => part.locked)
      .map((part) => part.id);
    const notes = this.findings()
      .filter((finding) => finding.severity !== 'info')
      .map((finding) => `${finding.title}：${finding.detail}`);
    return buildContextPack({
      root: doc.root,
      stats,
      parts: this.semanticParts(),
      selection: this.selection(),
      constraints: {
        palette: this.swatches,
        locked,
        notes,
      },
      includeSource: this.includeSource(),
      source: this.canonicalText(),
      maxDigestChars: 6000,
      maxSourceChars: 12000,
    });
  });

  constructor() {
    void this.loadIndex();
  }

  private async loadIndex(): Promise<void> {
    const index = await loadSvgIndex();
    this.index.set(index);
    if (index.assets.length > 0 && !this.current()) {
      await this.loadAsset(index.assets[0]);
    }
  }

  async loadAsset(asset: SvgAsset): Promise<void> {
    try {
      const text = await loadSvgAsset(asset.path);
      this.loadText(text, asset);
    } catch (err) {
      this.toast(String((err as Error).message ?? err));
    }
  }

  private loadText(text: string, asset: SvgAsset): void {
    this.originalText.set(text);
    this.workingText.set(text);
    this.current.set(asset);
    this.optimizedText.set(null);
    this.optimizedReports.set([]);
    this.viewMode.set('working');
    this.selection.set(null);
    this.snapshots.set([]);
    this.patchReport.set(null);
    this.semanticIssues.set([]);
    this.semanticDiff.set(null);
    // 默认展开全部图层：这些组多是规范化生成的包装，收起后只剩两行，反而看不懂结构。
    this.layerCollapsed.set(new Set());
    this.codeDraft.set(this.canonicalText());
    this.showTab('tree');
  }

  setMode(id: Mode): void {
    if (this.mode() === id) return;
    const next = this.modes.find((m) => m.id === id);
    if (!next) return;
    this.mode.set(id);
    this.tab.set(next.tabs[0].id);
  }

  /** 代码里跳转 tab 时同步上层模式，保证不会出现“模式停在编辑、tab 却是补丁”。 */
  private showTab(tab: Tab): void {
    const owner = this.modes.find((m) => m.tabs.some((t) => t.id === tab));
    if (owner) this.mode.set(owner.id);
    this.tab.set(tab);
  }

  onFilter(ev: Event): void {
    this.filter.set((ev.target as HTMLInputElement).value);
  }

  async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const name = file.name.replace(/\.svg$/i, '');
    this.loadText(text, {
      path: '',
      group: 'local',
      groupLabel: '本地文件',
      name,
      label: name,
      variant: '',
      bytes: byteLength(text),
      sha1: 'local',
      viewBox: null,
    });
    input.value = '';
    this.toast(`已载入 ${file.name}`);
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      this.loadText(text, {
        path: '',
        group: 'local',
        groupLabel: '剪贴板',
        name: 'clipboard',
        label: 'clipboard',
        variant: '',
        bytes: byteLength(text),
        sha1: 'paste',
        viewBox: null,
      });
      this.toast('已从剪贴板载入');
    } catch {
      this.toast('剪贴板不可用，请用「打开文件」');
    }
  }

  onPrecision(ev: Event): void {
    const value = Number((ev.target as HTMLSelectElement).value);
    if (!Number.isFinite(value)) return;
    this.precision.set(value);
    this.codeDraft.set(this.canonicalText());
  }

  normalize(): void {
    const doc = this.doc();
    if (!doc) return;
    const next = doc.canonical({ precision: this.precision() });
    this.commit(next, '规范化');
    this.toast(`已规范化为 ${formatBytes(byteLength(next))}`);
  }

  runOptimize(passes: PassId[] = SAFE_PASSES): void {
    const doc = this.doc();
    if (!doc) return;
    const clone = doc.clone();
    const options: OptimizeOptions = { precision: this.precision() };
    const result = runPasses(clone.root, passes, options);
    const text = clone.canonical({ precision: this.precision() });
    this.optimizedText.set(text);
    this.optimizedReports.set(result.reports);
    this.viewMode.set('optimized');
    const saved = byteLength(this.workingText()) - byteLength(text);
    this.toast(
      result.changes === 0
        ? '没有可优化的内容'
        : `优化完成：${result.changes} 处改动，${saved >= 0 ? '省' : '增'} ${formatBytes(Math.abs(saved))}`,
    );
  }

  adoptOptimized(): void {
    const text = this.optimizedText();
    if (!text) return;
    this.commit(text, '采用优化');
    this.optimizedText.set(null);
    this.viewMode.set('working');
    this.toast('已采用优化结果');
  }

  discardOptimized(): void {
    this.optimizedText.set(null);
    this.optimizedReports.set([]);
    this.viewMode.set('working');
  }

  applyFinding(finding: Finding): void {
    if (!finding.fix) return;
    const doc = this.doc();
    if (!doc) return;
    const clone = doc.clone();
    const result = runPasses(clone.root, finding.fix, { precision: this.precision() });
    if (result.changes === 0) {
      this.toast('没有产生改动');
      return;
    }
    this.commit(clone.canonical({ precision: this.precision() }), finding.title);
    this.toast(`${finding.title}：${result.changes} 处改动`);
  }

  fixLabel(fix: PassId[]): string {
    return fix
      .map((id) => this.passList.find((p) => p.id === id)?.title ?? id)
      .join(' + ');
  }

  undo(): void {
    const stack = this.snapshots();
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    this.snapshots.set(stack.slice(0, -1));
    this.workingText.set(last.text);
    this.optimizedText.set(null);
    this.viewMode.set('working');
    this.codeDraft.set(this.canonicalText());
    this.toast(`已撤销：${last.label}`);
  }

  private commit(text: string, label: string, keepSelection = false): void {
    const snapshot: Snapshot = { label, text: this.workingText(), at: Date.now() };
    this.snapshots.set([...this.snapshots().slice(-19), snapshot]);
    this.workingText.set(text);
    this.optimizedText.set(null);
    this.viewMode.set('working');
    this.codeDraft.set(this.canonicalText());
    if (!keepSelection) this.selection.set(null);
  }

  onCodeInput(ev: Event): void {
    this.codeDraft.set((ev.target as HTMLTextAreaElement).value);
  }

  applyCode(): void {
    const text = this.codeDraft();
    const parsed = parseSvg(text);
    if (!parsed.ok) {
      const { message, line } = parsed.error;
      this.toast(`源码无法解析${line ? `（第 ${line} 行）` : ''}：${message}`);
      return;
    }
    this.commit(parsed.doc.canonical({ precision: this.precision() }), '编辑源码');
    this.toast('源码已应用');
  }

  resetCode(): void {
    this.codeDraft.set(this.canonicalText());
    this.toast('已回到 canonical 文本');
  }

  onPatchInput(ev: Event): void {
    this.patchDraft.set((ev.target as HTMLTextAreaElement).value);
  }

  formatPatch(): void {
    try {
      const parsed = JSON.parse(this.patchDraft()) as unknown;
      this.patchDraft.set(JSON.stringify(parsed, null, 2));
    } catch {
      this.toast('补丁不是合法 JSON');
    }
  }

  applyPatchOps(): void {
    const doc = this.doc();
    if (!doc) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.patchDraft());
    } catch (err) {
      this.toast(`补丁不是合法 JSON：${(err as Error).message}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      this.toast('补丁必须是数组');
      return;
    }
    const outcome = applyPatch(doc, parsed as PatchOp[], { precision: this.precision() });
    this.patchReport.set({
      applied: outcome.applied,
      issues: outcome.issues,
      bytes: byteLength(outcome.text),
    });
    if (outcome.changed) {
      this.commit(outcome.text, '应用补丁');
      this.optimizedText.set(null);
      this.viewMode.set('working');
    }
    const errors = outcome.issues.length;
    this.toast(
      errors === 0
        ? `已应用 ${outcome.applied} 个操作`
        : `已应用 ${outcome.applied} 个操作，${errors} 条问题`,
    );
  }

  patchFromSelection(sel: SvgPick): void {
    const target = sel.id ? `#${sel.id}` : sel.selector;
    this.patchDraft.set(
      JSON.stringify(
        [
          { op: 'setAttr', target, attr: 'fill', value: '#b95e4e' },
          { op: 'translate', target, dx: 0, dy: 0 },
        ],
        null,
        2,
      ),
    );
    this.showTab('patch');
    this.toast('已生成补丁模板');
  }

  async scanBatch(): Promise<void> {
    if (this.batchRunning() || this.index().assets.length === 0) return;
    this.batchStop = false;
    const mode = this.batchMode();
    const passes: PassId[] =
      mode === 'canonical'
        ? []
        : mode === 'stable'
          ? ['stable-ids']
          : mode === 'optimize'
            ? SAFE_PASSES
            : [...SAFE_PASSES, 'stable-ids'];
    this.batchModeUsed.set(mode);
    this.batchPrecision.set(this.precision());
    this.batchRows.set([]);
    this.batchDone.set(0);
    this.batchTotal.set(this.index().assets.length);
    this.batchCurrent.set('');
    this.batchRunning.set(true);
    try {
      await runBatch(
        this.index().assets,
        { precision: this.batchPrecision(), passes },
        (row, progress) => {
          this.batchRows.update((rows) => [...rows, row]);
          this.batchDone.set(progress.done);
          this.batchCurrent.set(progress.name);
        },
        () => this.batchStop,
      );
      const summary = this.batchSummary();
      this.toast(
        `批量完成：${summary.changed} 个有改动，共${summary.saved >= 0 ? '省' : '增'} ${formatBytes(Math.abs(summary.saved))}`,
      );
    } catch (err) {
      this.toast(`批量失败：${String((err as Error).message ?? err)}`);
    } finally {
      this.batchRunning.set(false);
    }
  }

  stopBatch(): void {
    this.batchStop = true;
    this.toast('已停止，保留已完成的结果');
  }

  async inspectBatch(row: BatchRow): Promise<void> {
    if (row.status === 'error') return;
    const asset = this.index().assets.find((a) => a.path === row.path);
    if (!asset) return;
    await this.loadAsset(asset);
    this.optimizedText.set(row.optimized);
    this.optimizedReports.set(row.reports);
    this.viewMode.set('optimized');
    this.showTab('diagnose');
    this.toast(`${row.name}：优化后预览`);
  }

  downloadBatchZip(): void {
    const changed = this.batchPackRows();
    if (changed.length === 0) {
      this.toast('没有可下载的改动');
      return;
    }
    const encoder = new TextEncoder();
    const rows = this.batchRows();
    const files = changed.map((row) => ({
      name: `optimized/${row.path.replace(/^\//, '')}`,
      data: encoder.encode(row.optimized),
    }));
    files.push({ name: 'report.md', data: encoder.encode(batchReportMarkdown(rows, this.batchPrecision())) });
    files.push({ name: 'report.json', data: encoder.encode(batchReportJson(rows)) });
    files.push({ name: 'report.csv', data: encoder.encode(batchReportCsv(rows)) });
    this.saveBlob(createZip(files), `svg-batch-${changed.length}.zip`);
    this.toast(`已打包 ${changed.length} 个文件 + 报告`);
  }

  downloadWriteback(): void {
    const rows = this.batchPackRows();
    if (rows.length === 0) {
      this.toast('没有可写回的条目');
      return;
    }
    this.saveBlob(
      new Blob([this.writebackJson()], { type: 'application/json' }),
      'svg-writeback.json',
    );
    this.toast(`写回包：${rows.length} 个文件，运行 scripts/svg_writeback.py`);
  }

  onBatchMode(ev: Event): void {
    const value = (ev.target as HTMLSelectElement).value;
    if (value === 'canonical' || value === 'stable' || value === 'optimize' || value === 'ids') {
      this.batchMode.set(value);
    }
  }

  renderLabelOf(row: BatchRow): string {
    return renderLabel(row.render);
  }

  downloadBatchReport(kind: 'md' | 'json' | 'csv'): void {
    const rows = this.batchRows();
    if (rows.length === 0) return;
    const text =
      kind === 'md'
        ? batchReportMarkdown(rows, this.batchPrecision())
        : kind === 'json'
          ? batchReportJson(rows)
          : batchReportCsv(rows);
    const type = kind === 'json' ? 'application/json' : kind === 'csv' ? 'text/csv' : 'text/markdown';
    this.saveBlob(new Blob([text], { type }), `svg-batch-report.${kind}`);
  }

  copyBatchReport(): void {
    void this.copy(batchReportMarkdown(this.batchRows(), this.batchPrecision()));
  }

  downloadRow(row: BatchRow): void {
    if (row.status === 'error') return;
    this.saveBlob(new Blob([row.optimized], { type: 'image/svg+xml' }), `${row.name}.optimized.svg`);
    this.toast(`已下载 ${row.name}.optimized.svg`);
  }

  passLabel(id: PassId): string {
    return PASS_SHORT[id] ?? id;
  }

  attrLabel(name: string): string {
    return FIELD_LABELS[name] ?? name;
  }

  onFieldChange(name: string, ev: Event): void {
    this.onFieldSet(name, (ev.target as HTMLInputElement).value);
  }

  onFieldSet(name: string, value: string): void {
    const doc = this.doc();
    const target = this.selectionTarget();
    if (!doc || !target) return;
    const trimmed = value.trim();
    const clone = doc.clone();
    const el = this.prepareTarget(clone, target);
    if (!el) {
      this.toast('目标元素已不存在');
      return;
    }
    if (trimmed === '') el.removeAttribute(name);
    else el.setAttribute(name, trimmed);
    this.commit(clone.canonical({ precision: this.precision() }), `改 ${this.attrLabel(name)}`, true);
    this.toast(`${this.attrLabel(name)} 已更新`);
  }

  /** class 的 CSS 优先级高于同名属性；改颜色/渐变前先把 class 内联，避免改了没反应。 */
  private prepareTarget(clone: SvgDocument, target: string): Element | null {
    let el = resolveTarget(clone, target);
    if (!el) return null;
    const hasStyle = allElements(clone.root).some((node) => node.localName === 'style');
    if (hasStyle && el.hasAttribute('class')) {
      runPasses(clone.root, ['inline-css'], { precision: this.precision() });
      el = resolveTarget(clone, target);
    }
    return el;
  }

  extendCanvas(): void {
    const doc = this.doc();
    const box = this.stage()?.contentBBox();
    if (!doc || !box) {
      this.toast('读不到内容包围盒');
      return;
    }
    const vb = doc.viewBox() ?? [0, 0, Math.max(1, box.width), Math.max(1, box.height)];
    const [x, y, w, h] = vb;
    const minX = round3(Math.min(x, box.x));
    const minY = round3(Math.min(y, box.y));
    const maxX = round3(Math.max(x + w, box.x + box.width));
    const maxY = round3(Math.max(y + h, box.y + box.height));
    if (minX >= x && minY >= y && maxX <= x + w && maxY <= y + h) {
      this.toast('内容已经在画布内');
      return;
    }
    this.editDoc('扩展画布', (clone) => {
      clone.root.setAttribute('viewBox', `${minX} ${minY} ${round3(maxX - minX)} ${round3(maxY - minY)}`);
    });
    this.toast(`画布已扩展：${minX} ${minY} ${round3(maxX - minX)} ${round3(maxY - minY)}`);
  }

  createNewSvg(): void {
    const width = clampSizeValue(this.newWidth());
    const height = clampSizeValue(this.newHeight());
    const background = this.newBackground()
      ? `
  <rect id="bg" x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
      : '';
    const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${background}
</svg>
`;
    const parsed = parseSvg(text);
    if (!parsed.ok) {
      this.toast(parsed.error.message);
      return;
    }
    this.newWidth.set(width);
    this.newHeight.set(height);
    this.loadText(parsed.doc.canonical({ precision: this.precision() }), {
      path: '',
      group: 'local',
      groupLabel: '新建',
      name: `untitled-${width}x${height}`,
      label: '未命名',
      variant: '',
      bytes: byteLength(text),
      sha1: 'new',
      viewBox: `0 0 ${width} ${height}`,
    });
    this.tool.set('select');
    this.toast(`已新建 ${width}×${height} 画布`);
  }

  clampSize(ev: Event): number {
    return clampSizeValue(Number((ev.target as HTMLInputElement).value));
  }

  insertShape(kind: 'rect' | 'circle'): void {
    const doc = this.doc();
    const vb = doc?.viewBox();
    if (!doc || !vb) {
      this.toast('当前没有可用的 viewBox');
      return;
    }
    const [vx, vy, vw, vh] = vb;
    const size = Math.max(1, Math.round(Math.min(vw, vh) * 0.35 * 1000) / 1000);
    const existing = doc.root.querySelectorAll('rect[id^="rect-"], circle[id^="circle-"]').length;
    const offset = Math.min(40, existing * 8);
    const x = round3(vx + (vw - size) / 2 + offset);
    const y = round3(vy + (vh - size) / 2 + offset);
    const color = /^#[0-9a-f]{3,8}$/i.test(this.penColor()) ? this.penColor() : '#b95e4e';
    const used = new Set<string>();
    for (const el of doc.elementsWithId()) used.add(el.getAttribute('id') ?? '');
    let n = 1;
    while (used.has(`${kind}-${n}`)) n += 1;
    const id = `${kind}-${n}`;
    const markup =
      kind === 'rect'
        ? `<rect id="${id}" x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/>`
        : `<circle id="${id}" cx="${round3(x + size / 2)}" cy="${round3(y + size / 2)}" r="${round3(size / 2)}" fill="${color}"/>`;
    const outcome = applyPatch(doc, [{ op: 'add', parent: this.activeParentTarget(), svg: markup }], {
      precision: this.precision(),
    });
    if (outcome.issues.length > 0) {
      this.toast(outcome.issues[0].message);
      return;
    }
    this.commit(outcome.text, '插入形状', true);
    this.selection.set({ tag: kind, id, selector: `#${id}`, attrs: [] });
    this.toast(`已插入 ${kind === 'rect' ? '矩形' : '圆形'} #${id}`);
  }

  colorValue(value: string | null | undefined): string {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value ?? '').trim());
    if (!match) return '#000000';
    const hex = match[1];
    return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
  }

  colorFromEvent(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  isGradient(value: string | null | undefined): boolean {
    return /^url\(#/.test((value ?? '').trim());
  }

  gradientPreview(value: string): string {
    const match = /^url\(#([^)]+)\)$/.exec(value.trim());
    if (!match) return 'none';
    const info = this.gradients().find((g) => g.id === match[1]);
    return info ? gradientCss(info) : 'none';
  }

  gradientCssOf(info: GradientInfo): string {
    return gradientCss(info);
  }

  nudge(): void {
    const doc = this.doc();
    const target = this.selectionTarget();
    if (!doc || !target) return;
    const outcome = applyPatch(
      doc,
      [{ op: 'translate', target, dx: this.nudgeX(), dy: this.nudgeY() }],
      { precision: this.precision() },
    );
    if (outcome.issues.length > 0) {
      this.toast(outcome.issues[0].message);
      return;
    }
    this.commit(outcome.text, '位移', true);
    this.toast(`位移 ${this.nudgeX()}, ${this.nudgeY()}`);
  }

  applyGradient(channel: 'fill' | 'stroke', id: string): void {
    this.onFieldSet(channel, `url(#${id})`);
  }

  createGradientFor(channel: 'fill' | 'stroke'): void {
    const doc = this.doc();
    const target = this.selectionTarget();
    if (!doc) return;
    if (!target) {
      this.toast('先选中一个元素');
      return;
    }
    const from = this.colorValue(this.selectedElement()?.getAttribute(channel) ?? '#b95e4e');
    const to = channel === 'fill' ? '#ece8de' : '#ffffff';
    const stops: GradientStop[] = [
      { offset: 0, color: from, opacity: '1' },
      { offset: 1, color: to, opacity: '1' },
    ];
    const clone = doc.clone();
    const id = createGradient(clone.root, stops);
    const el = this.prepareTarget(clone, target);
    if (el) el.setAttribute(channel, `url(#${id})`);
    this.commit(clone.canonical({ precision: this.precision() }), '新建渐变', true);
    this.toast(`已创建 #${id}`);
  }

  updateGradientStop(index: number, field: 'color' | 'offset', ev: Event): void {
    const active = this.activeGradient();
    if (!active?.info) return;
    const stops = active.info.stops.map((stop) => ({ ...stop }));
    if (!stops[index]) return;
    const raw = (ev.target as HTMLInputElement).value;
    if (field === 'color') {
      stops[index].color = raw;
    } else {
      const percent = Number(raw);
      if (!Number.isFinite(percent)) return;
      stops[index].offset = Math.min(1, Math.max(0, percent / 100));
    }
    this.editDoc('改渐变', (clone) => setStops(clone.root, active.id, stops));
  }

  addGradientStop(): void {
    const active = this.activeGradient();
    if (!active?.info) return;
    const stops = active.info.stops.map((stop) => ({ ...stop }));
    const last = stops[stops.length - 1] ?? { offset: 0, color: '#b95e4e', opacity: '1' };
    stops.push({
      offset: Math.min(1, Math.round(((last.offset + 1) / 2) * 100) / 100),
      color: last.color,
      opacity: last.opacity,
    });
    this.editDoc('加渐变停靠点', (clone) => setStops(clone.root, active.id, stops));
  }

  removeGradientStop(index: number): void {
    const active = this.activeGradient();
    if (!active?.info || active.info.stops.length <= 2) return;
    const stops = active.info.stops.filter((_, i) => i !== index).map((stop) => ({ ...stop }));
    this.editDoc('删渐变停靠点', (clone) => setStops(clone.root, active.id, stops));
  }

  onGradientDirection(ev: Event): void {
    const active = this.activeGradient();
    if (!active) return;
    const value = (ev.target as HTMLSelectElement).value as GradientDirection;
    this.editDoc('改渐变方向', (clone) => setDirection(clone.root, active.id, value));
  }

  offsetPercent(offset: number): number {
    return Math.round(offset * 100);
  }

  onMoved(event: { target: string; dx: number; dy: number }): void {
    const doc = this.doc();
    if (!doc) return;
    const outcome = applyPatch(
      doc,
      [{ op: 'translate', target: event.target, dx: event.dx, dy: event.dy }],
      { precision: this.precision() },
    );
    if (outcome.issues.length > 0) {
      this.toast(outcome.issues[0].message);
      return;
    }
    this.commit(outcome.text, '移动', true);
  }

  onGeometryChanged(event: { target: string; kind: 'points' | 'path'; value: string }): void {
    const doc = this.doc();
    if (!doc) return;
    const op: PatchOp =
      event.kind === 'path'
        ? { op: 'replacePath', target: event.target, d: event.value }
        : { op: 'setAttr', target: event.target, attr: 'points', value: event.value };
    const outcome = applyPatch(doc, [op], { precision: this.precision() });
    if (outcome.issues.length > 0) {
      this.toast(outcome.issues[0].message);
      return;
    }
    this.commit(outcome.text, '改几何', true);
  }

  onPathCreated(event: { d: string }): void {
    const doc = this.doc();
    if (!doc) return;
    const parent = this.activeParentTarget();
    const used = new Set<string>();
    for (const el of doc.elementsWithId()) used.add(el.getAttribute('id') ?? '');
    let n = 1;
    while (used.has(`pen-${n}`)) n += 1;
    const id = `pen-${n}`;
    const stroke = /^#[0-9a-f]{3,8}$/i.test(this.penColor()) ? this.penColor() : '#b95e4e';
    const markup = `<path id="${id}" d="${event.d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const outcome = applyPatch(doc, [{ op: 'add', parent, svg: markup }], {
      precision: this.precision(),
    });
    if (outcome.issues.length > 0) {
      this.toast(outcome.issues[0].message);
      return;
    }
    this.commit(outcome.text, '钢笔路径', true);
    this.selection.set({ tag: 'path', id, selector: `#${id}`, attrs: [] });
    // 画完一条路径切回选择，立刻能看到锚点/手柄；继续画再点钢笔。
    this.tool.set('select');
    this.toast(`已创建 #${id}`);
  }

  applySemanticPlanText(text: string): void {
    const doc = this.doc();
    if (!doc) return;
    const parsed = parseSemanticPlan(text);
    if (!parsed.ok) {
      this.semanticIssues.set(parsed.issues);
      this.toast('语义计划无法解析');
      return;
    }
    const before = collectSemanticParts(doc.root);
    const clone = doc.clone();
    const applied = applySemanticPlan(clone.root, parsed.plan);
    const issues = [
      ...parsed.issues,
      ...applied.issues,
      ...validateSemantics(clone.root, parsed.plan),
    ];
    const after = collectSemanticParts(clone.root);
    this.semanticIssues.set(issues);
    this.semanticDiff.set(diffSemanticParts(before, after));
    this.commit(clone.canonical({ precision: this.precision() }), '语义计划', true);
    this.toast(`语义计划：新建 ${applied.created} · 更新 ${applied.updated} · 问题 ${issues.length}`);
  }

  toggleLayer(row: LayerRow, event: Event): void {
    event.stopPropagation();
    if (!row.hasChildren) return;
    const next = new Set(this.layerCollapsed());
    const key = row.id ?? row.selector;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.layerCollapsed.set(next);
  }

  selectLayer(row: LayerRow): void {
    if (row.tag === 'svg') {
      this.selectCanvas();
      return;
    }
    this.tool.set('select');
    this.selection.set({ tag: row.tag, id: row.id, selector: row.selector, attrs: [] });
  }

  expandAllLayers(): void {
    this.layerCollapsed.set(new Set());
  }

  collapseAllLayers(): void {
    const doc = this.doc();
    if (!doc) return;
    const next = new Set<string>();
    for (const el of allElements(doc.root)) {
      if (el === doc.root || el.localName !== 'g' || el.children.length === 0) continue;
      const id = el.getAttribute('id');
      if (id) next.add(id);
    }
    this.layerCollapsed.set(next);
  }

  selectCanvas(): void {
    this.tool.set('select');
    this.selection.set({ tag: 'svg', id: null, selector: 'svg', attrs: [] });
    this.toast('已选中画布；可编辑 viewBox');
  }

  selectSemanticPart(id: string): void {
    this.tool.set('select');
    this.selection.set({ tag: 'g', id, selector: `#${id}`, attrs: [] });
    this.toast(`已选中 #${id}；钢笔/形状会落进这个部件`);
  }

  private selectorFor(el: Element): string {
    const root = this.doc()?.root;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== root) {
      const tag = cur.localName;
      const siblings = cur.parentElement
        ? Array.from(cur.parentElement.children).filter((c) => c.localName === tag)
        : [];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(cur) + 1})`);
      cur = cur.parentElement;
    }
    return `svg > ${parts.join(' > ')}`;
  }

  private activeParentTarget(): string {
    const el = this.selectedElement();
    if (!el) return 'svg';
    if (el.localName === 'g') {
      const id = el.getAttribute('id');
      return id ? `#${id}` : 'svg';
    }
    const parent = el.parentElement;
    if (parent && parent.localName === 'g') {
      const id = parent.getAttribute('id');
      if (id) return `#${id}`;
    }
    return 'svg';
  }

  updateSemanticPart(event: { id: string; role?: string; label?: string }): void {
    const doc = this.doc();
    if (!doc) return;
    const target = `#${event.id}`;
    const el = resolveTarget(doc, target);
    if (!el) {
      this.toast(`找不到 ${target}`);
      return;
    }
    const before = collectSemanticParts(doc.root);
    const clone = doc.clone();
    const updated = resolveTarget(clone, target);
    if (!updated) return;
    if (event.role !== undefined) updated.setAttribute('data-role', event.role);
    if (event.label !== undefined) {
      updated.setAttribute('data-label', event.label);
      updated.setAttribute('aria-label', event.label);
    }
    const issues = validateSemantics(clone.root);
    const after = collectSemanticParts(clone.root);
    this.semanticIssues.set(issues);
    this.semanticDiff.set(diffSemanticParts(before, after));
    this.commit(clone.canonical({ precision: this.precision() }), '改语义', true);
    this.toast('语义已更新');
  }

  private editDoc(label: string, mutate: (doc: SvgDocument) => void, keepSelection = true): void {
    const doc = this.doc();
    if (!doc) return;
    const clone = doc.clone();
    mutate(clone);
    this.commit(clone.canonical({ precision: this.precision() }), label, keepSelection);
  }

  numberValue(ev: Event): number {
    const value = Number((ev.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : 0;
  }

  copySelectionMarkup(): void {
    const el = this.selectedElement();
    if (!el) return;
    void this.copy(new XMLSerializer().serializeToString(el));
  }

  copyPatchSpec(): void {
    void this.copy(this.patchSpec);
  }

  copyDigestJson(): void {
    void this.copy(JSON.stringify(this.digestObject(), null, 2));
  }

  abs(n: number): number {
    return Math.abs(n);
  }

  inlineSelectionCss(): void {
    const doc = this.doc();
    if (!doc) return;
    const clone = doc.clone();
    const result = runPasses(clone.root, ['inline-css'], { precision: this.precision() });
    if (result.changes === 0) {
      this.toast('没有可内联的 class 样式');
      return;
    }
    this.commit(clone.canonical({ precision: this.precision() }), '内联 CSS', true);
    this.toast(`已内联 ${result.changes} 处样式`);
  }

  copyAttrs(): void {
    const el = this.selectedElement();
    if (!el) return;
    const obj: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) obj[attr.name] = attr.value;
    void this.copy(JSON.stringify(obj, null, 2));
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`已复制 ${formatBytes(byteLength(text))}`);
    } catch {
      this.toast('复制失败（剪贴板权限）');
    }
  }

  download(kind: 'canonical' | 'optimized' | 'original'): void {
    const text =
      kind === 'canonical'
        ? this.canonicalText()
        : kind === 'optimized'
          ? (this.optimizedText() ?? this.workingText())
          : this.workingText();
    const name = this.current()?.name ?? 'svg';
    const suffix = kind === 'original' ? 'working' : kind;
    const blob = new Blob([text], { type: 'image/svg+xml' });
    this.saveBlob(blob, `${name}.${suffix}.svg`);
    this.toast(`已下载 ${name}.${suffix}.svg`);
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  bytes(n: number): string {
    return formatBytes(n);
  }

  toast(text: string): void {
    this.toastText.set(text);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastText.set(''), 3200);
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampSizeValue(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(8192, Math.max(1, Math.round(value)));
}
