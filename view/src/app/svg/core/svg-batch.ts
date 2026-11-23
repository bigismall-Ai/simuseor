/**
 * 批量优化：对索引内全部资产跑同一套保守 pass，产出可审阅、可下载的报告。
 *
 * 只读仓库文件；「落盘」通过下载 zip 完成——浏览器不能直接写 public/。
 */

import { analyze } from './svg-analyze';
import { byteLength, collectStats, parseSvg } from './svg-doc';
import { runPasses, type PassId, type PassReport } from './svg-optimize';
import { compareSvgRender, type RenderDiff } from './svg-render';
import { crc32 } from './svg-zip';
import { loadSvgAssetBytes, type SvgAsset } from './svg-assets';

export type BatchStatus = 'changed' | 'unchanged' | 'error';

export interface BatchRow {
  path: string;
  name: string;
  group: string;
  groupLabel: string;
  before: number;
  after: number;
  saved: number;
  savedPct: number;
  status: BatchStatus;
  error: string | null;
  reports: PassReport[];
  changes: number;
  errors: number;
  warns: number;
  raster: boolean;
  elements: number;
  paths: number;
  sourceCrc32: number;
  render: RenderDiff;
  optimized: string;
}

export interface BatchSummary {
  total: number;
  changed: number;
  unchanged: number;
  failed: number;
  visualOk: number;
  visualDiff: number;
  visualUnavailable: number;
  before: number;
  after: number;
  saved: number;
  savedPct: number;
}

export interface BatchOptions {
  precision: number;
  passes: PassId[];
}

export interface BatchProgress {
  done: number;
  total: number;
  name: string;
}

export async function runBatch(
  assets: SvgAsset[],
  options: BatchOptions,
  onRow: (row: BatchRow, progress: BatchProgress) => void,
  shouldStop: () => boolean,
): Promise<void> {
  let done = 0;
  for (const asset of assets) {
    if (shouldStop()) return;
    const row = await optimizeOne(asset, options);
    done += 1;
    onRow(row, { done, total: assets.length, name: asset.name });
    // 让出主线程，进度条与表格能逐行出现。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function optimizeOne(asset: SvgAsset, options: BatchOptions): Promise<BatchRow> {
  const base: BatchRow = {
    path: asset.path,
    name: asset.name,
    group: asset.group,
    groupLabel: asset.groupLabel,
    before: asset.bytes,
    after: asset.bytes,
    saved: 0,
    savedPct: 0,
    status: 'unchanged',
    error: null,
    reports: [],
    changes: 0,
    errors: 0,
    warns: 0,
    raster: false,
    elements: 0,
    paths: 0,
    sourceCrc32: 0,
    render: { status: 'unavailable', changedPixels: 0, strongPixels: 0, totalPixels: 0, percent: 0 },
    optimized: '',
  };

  let text: string;
  let raw: Uint8Array;
  try {
    const loaded = await loadSvgAssetBytes(asset.path);
    text = loaded.text;
    raw = loaded.bytes;
  } catch (err) {
    return { ...base, status: 'error', error: String((err as Error).message ?? err) };
  }

  const parsed = parseSvg(text);
  if (!parsed.ok) {
    return { ...base, status: 'error', error: parsed.error.message };
  }

  try {
    const before = raw.length;
    const sourceCrc32 = crc32(raw);
    const findings = analyze(parsed.doc.root, text, options.precision);
    const stats = collectStats(parsed.doc.root, before);
    const clone = parsed.doc.clone();
    const result = runPasses(clone.root, options.passes, { precision: options.precision });
    const optimized = clone.canonical({ precision: options.precision });
    const after = byteLength(optimized);
    const saved = before - after;
    const render = await compareSvgRender(text, optimized);

    return {
      ...base,
      before,
      after,
      saved,
      savedPct: before > 0 ? Math.round((saved / before) * 100) : 0,
      status: optimized === text ? 'unchanged' : 'changed',
      reports: result.reports.filter((r) => r.changes > 0),
      changes: result.changes,
      errors: findings.filter((f) => f.severity === 'error').length,
      warns: findings.filter((f) => f.severity === 'warn').length,
      raster: findings.some((f) => f.key === 'embedded-raster'),
      elements: stats.elements,
      paths: stats.paths,
      sourceCrc32,
      render,
      optimized,
    };
  } catch (err) {
    return { ...base, status: 'error', error: String((err as Error).message ?? err) };
  }
}

export function summarize(rows: BatchRow[]): BatchSummary {
  const before = rows.reduce((n, r) => n + r.before, 0);
  const after = rows.reduce((n, r) => n + r.after, 0);
  const saved = before - after;
  return {
    total: rows.length,
    changed: rows.filter((r) => r.status === 'changed').length,
    unchanged: rows.filter((r) => r.status === 'unchanged').length,
    failed: rows.filter((r) => r.status === 'error').length,
    visualOk: rows.filter((r) => r.render.status === 'identical' || r.render.status === 'minor').length,
    visualDiff: rows.filter((r) => r.render.status === 'different').length,
    visualUnavailable: rows.filter((r) => r.render.status === 'unavailable').length,
    before,
    after,
    saved,
    savedPct: before > 0 ? Math.round((saved / before) * 100) : 0,
  };
}

export function batchReportJson(rows: BatchRow[]): string {
  return JSON.stringify({ summary: summarize(rows), rows: rows.map(({ optimized: _optimized, ...rest }) => rest) }, null, 2);
}

export function batchReportMarkdown(rows: BatchRow[], precision: number): string {
  const summary = summarize(rows);
  const lines: string[] = [];
  lines.push('# SVG 批量优化报告');
  lines.push('');
  lines.push(`- 精度：${precision} 位小数`);
  lines.push(`- 资产：${summary.total} 个（有改动 ${summary.changed} · 无改动 ${summary.unchanged} · 失败 ${summary.failed}）`);
  lines.push(`- 体积：${formatKb(summary.before)} → ${formatKb(summary.after)}（${summary.saved >= 0 ? '省' : '增'} ${formatKb(Math.abs(summary.saved))}，${summary.savedPct}%）`);
  lines.push(`- 视觉校验：一致 ${summary.visualOk} · 有差异 ${summary.visualDiff} · 无法校验 ${summary.visualUnavailable}`);
  lines.push('');
  lines.push('## 有改动的文件');
  lines.push('');
  lines.push('| 文件 | 原始 | 优化后 | 变化 | 视觉差异 | 元素 | 主要 pass |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of rows.filter((r) => r.status === 'changed').sort((a, b) => b.saved - a.saved)) {
    lines.push(
      `| \`${row.path}\` | ${formatKb(row.before)} | ${formatKb(row.after)} | ${row.saved >= 0 ? '−' : '+'}${formatKb(Math.abs(row.saved))} | ${renderLabel(row.render)} | ${row.elements} | ${row.reports.map((r) => `${r.title} ${r.changes}`).join(' · ')} |`,
    );
  }
  const untouched = rows.filter((r) => r.status !== 'changed');
  if (untouched.length > 0) {
    lines.push('');
    lines.push('## 无改动 / 失败');
    lines.push('');
    for (const row of untouched) {
      lines.push(`- \`${row.path}\`${row.status === 'error' ? ` — 失败：${row.error ?? ''}` : row.raster ? ' — 内嵌位图，未改动' : ' — 已是最简'}`);
    }
  }
  return lines.join('\n');
}

export function batchReportCsv(rows: BatchRow[]): string {
  const escape = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = ['path,status,before,after,saved,saved_pct,elements,paths,changes,errors,warns'];
  for (const row of rows) {
    lines.push(
      [row.path, row.status, row.before, row.after, row.saved, row.savedPct, row.elements, row.paths, row.changes, row.errors, row.warns]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function renderLabel(render: RenderDiff): string {
  if (render.status === 'unavailable') return '无法校验';
  if (render.status === 'identical') return '一致';
  if (render.status === 'minor') return `AA ${render.percent}%`;
  return `差异 ${render.percent}%`;
}

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}
