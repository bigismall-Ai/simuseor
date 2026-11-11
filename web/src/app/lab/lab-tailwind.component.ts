import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { fmtSize } from '../core/types';
import { LAB_LIBRARY, LabRow, TYPE_COLOR } from './fixtures';

/**
 * 对照实验 B：模型库表格页，全部视觉用 Tailwind 4 的工具类表达，没有任何手写 CSS。
 * 一致性来自「受限尺度」——间距/字号/圆角只能从刻度里选，值不会各页各写一套。
 */
@Component({
  selector: 'app-lab-tailwind',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="mb-5 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p class="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">对照实验 B</p>
        <h1 class="m-0 flex items-center gap-2 text-[21px] font-medium text-zinc-900">
          模型库
          <span class="rounded-md bg-indigo-50 px-2 py-[3px] font-mono text-[11px] font-medium text-indigo-700">
            Tailwind 4
          </span>
        </h1>
        <p class="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-zinc-500">
          表格、筛选、批量操作全部用工具类拼装，没有一行自定义 CSS。封面在密集列表里退化成 4px 类型色条。
        </p>
      </div>
      <a class="text-[12.5px] font-medium text-indigo-600 hover:underline" routerLink="/lab/primeng">
        切换到 PrimeNG 版 →
      </a>
    </div>

    <section
      class="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-solid border-zinc-200 bg-white p-3"
    >
      <div class="relative">
        <svg
          class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" stroke-linecap="round" />
        </svg>
        <input
          [(ngModel)]="q"
          placeholder="名称 / repo / 标签"
          class="h-8 w-64 shrink-0 rounded-lg border border-solid border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <select
        [(ngModel)]="source"
        class="h-8 w-auto min-w-[8.5rem] rounded-lg border border-solid border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 focus:border-indigo-500 focus:outline-none"
      >
        <option value="">全部来源</option>
        <option value="huggingface">Hugging Face</option>
        <option value="modelscope">ModelScope</option>
        <option value="civitai">Civitai</option>
      </select>

      <select
        [(ngModel)]="review"
        class="h-8 w-auto min-w-[8.5rem] rounded-lg border border-solid border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 focus:border-indigo-500 focus:outline-none"
      >
        <option value="">全部评审状态</option>
        <option value="untried">未试用</option>
        <option value="keep">保留</option>
        <option value="discard">弃用</option>
      </select>

      <label class="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-zinc-600">
        <input
          type="checkbox"
          [(ngModel)]="favOnly"
          class="h-3.5 w-3.5 rounded border-solid border-zinc-300 accent-indigo-600"
        />
        只看收藏
      </label>

      <span class="flex-1"></span>

      <button [class]="btn.primary" type="button">
        <svg class="mr-1.5 h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M8 3v8m0 0 3-3m-3 3-3-3M3 13h10" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        导入目录
      </button>
    </section>

    <section class="mb-4 overflow-hidden rounded-xl border border-solid border-zinc-200 bg-white">
      <table class="w-full table-fixed border-collapse text-left">
        <thead>
          <tr class="border-b border-solid border-zinc-200 bg-zinc-50">
            <th class="w-10 px-3 py-2">
              <input
                type="checkbox"
                [checked]="allSelected()"
                (change)="toggleAll()"
                class="h-3.5 w-3.5 rounded border-solid border-zinc-300 accent-indigo-600"
              />
            </th>
            <th class="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">模型</th>
            <th class="w-32 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">来源</th>
            <th class="w-24 px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              体积
            </th>
            <th class="w-56 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">标签</th>
            <th class="w-32 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">评审</th>
            <th class="w-28 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows; track r.id) {
            <tr
              class="border-b border-solid border-zinc-100 last:border-b-0"
              [class]="isPicked(r.id) ? 'bg-indigo-50/50' : 'hover:bg-zinc-50'"
            >
              <td class="px-3 py-2.5">
                <input
                  type="checkbox"
                  [checked]="isPicked(r.id)"
                  (change)="toggle(r.id)"
                  class="h-3.5 w-3.5 rounded border-solid border-zinc-300 accent-indigo-600"
                />
              </td>
              <td class="px-3 py-2.5">
                <div class="flex items-center gap-2.5">
                  <span
                    class="h-7 w-1 shrink-0 rounded-full"
                    [style.background]="typeColor[r.fileType]"
                  ></span>
                  <div class="min-w-0">
                    <p class="m-0 truncate text-[13px] font-medium text-zinc-900">{{ r.name }}</p>
                    <p class="m-0 truncate font-mono text-[11px] text-zinc-400">{{ r.repo }}</p>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5">
                <span
                  class="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-[3px] text-[11.5px] font-medium text-zinc-600"
                >
                  <span class="h-1.5 w-1.5 rounded-full" [style.background]="typeColor[r.fileType]"></span>
                  {{ r.source }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-zinc-600">
                {{ fmtSize(r.sizeBytes) }}
              </td>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap gap-1">
                  @for (t of r.tags; track t) {
                    <span class="rounded bg-zinc-100 px-1.5 py-[1px] text-[11px] text-zinc-500">{{ t }}</span>
                  }
                </div>
              </td>
              <td class="px-3 py-2.5">
                <span
                  class="inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11.5px] font-medium"
                  [class]="reviewClass(r.review)"
                >
                  {{ reviewLabel(r.review) }}
                </span>
              </td>
              <td class="px-3 py-2.5">
                <div class="flex items-center justify-end gap-1">
                  <button [class]="btn.ghost" type="button">下载</button>
                  <button
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
                    type="button"
                    title="删除"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>

    <div
      class="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-zinc-200 bg-white px-3.5 py-2.5"
    >
      <span class="text-[12.5px] text-zinc-500">
        共 {{ rows.length }} 个模型 · 已选
        <b class="font-medium text-zinc-900">{{ picked.length }}</b>
        个 · 合计 <b class="font-mono font-medium text-zinc-900">{{ fmtSize(pickedSize()) }}</b>
      </span>
      <span class="flex-1"></span>
      <button [class]="btn.secondary" type="button">校验文件</button>
      <button [class]="btn.primary" type="button">部署到 ComfyUI</button>
    </div>

    <p
      class="mt-4 rounded-xl border border-solid border-zinc-200 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-zinc-500"
    >
      观察点：间距、字号、圆角只能取值于刻度，所以行高和内边距天然对齐；代价是类名很长，
      复杂组件的可读性明显不如「一个 p-button」。另外「卡片 + 封面」这种形态要自己拼 SVG 和渐变。
    </p>
  `,
})
export class LabTailwindComponent {
  readonly all = LAB_LIBRARY;
  readonly typeColor = TYPE_COLOR;
  readonly fmtSize = fmtSize;

  q = '';
  source = '';
  review = '';
  favOnly = false;
  picked: string[] = ['l1'];

  /** 变体表：把「能选的值」收成三档，避免每处各写一套按钮。 */
  readonly btn = {
    primary:
      'inline-flex h-8 items-center justify-center rounded-lg bg-indigo-600 px-3 text-[13px] font-medium text-white hover:bg-indigo-700 active:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
    secondary:
      'inline-flex h-8 items-center justify-center rounded-lg border border-solid border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50',
    ghost:
      'inline-flex h-7 items-center justify-center rounded-md px-2 text-[12.5px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
  };

  get rows(): LabRow[] {
    const q = this.q.trim().toLowerCase();
    return this.all.filter((r) => {
      if (this.favOnly && !r.favorite) return false;
      if (this.review && r.review !== this.review) return false;
      if (this.source && !r.repo.toLowerCase().includes(this.source)) return false;
      if (!q) return true;
      return (r.name + r.repo + r.tags.join(' ')).toLowerCase().includes(q);
    });
  }

  isPicked(id: string): boolean {
    return this.picked.includes(id);
  }

  toggle(id: string): void {
    this.picked = this.isPicked(id) ? this.picked.filter((x) => x !== id) : [...this.picked, id];
  }

  allSelected(): boolean {
    return this.rows.length > 0 && this.rows.every((r) => this.isPicked(r.id));
  }

  toggleAll(): void {
    this.picked = this.allSelected() ? [] : this.rows.map((r) => r.id);
  }

  pickedSize(): number {
    return this.all.filter((r) => this.isPicked(r.id)).reduce((s, r) => s + r.sizeBytes, 0);
  }

  reviewLabel(state: LabRow['review']): string {
    return state === 'keep' ? '保留' : state === 'discard' ? '弃用' : '未试用';
  }

  reviewClass(state: LabRow['review']): string {
    if (state === 'keep') return 'bg-emerald-50 text-emerald-700';
    if (state === 'discard') return 'bg-zinc-100 text-zinc-500';
    return 'bg-amber-50 text-amber-700';
  }
}
