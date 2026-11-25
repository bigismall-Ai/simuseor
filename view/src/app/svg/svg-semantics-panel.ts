import { Component, computed, input, output, signal } from '@angular/core';
import { UiMaterialModule } from '../ui/material';
import { ROLE_VOCABULARY } from './core/svg-semantics';
import type { SemanticDiff, SemanticIssue, SemanticPartInfo } from './core/svg-semantics';

type EditField = 'role' | 'label';

interface DiffGroup {
  key: 'added' | 'removed' | 'labelChanged' | 'roleChanged';
  label: string;
  ids: string[];
}

const PLAN_EXAMPLE = JSON.stringify(
  {
    version: 1,
    kind: 'hand',
    viewBox: '0 0 160 180',
    parts: [
      {
        id: 'hand',
        role: 'hand',
        label: '手掌',
        synonyms: ['手', '整只手', 'hand'],
        required: true,
        locked: false,
      },
      {
        id: 'palm',
        role: 'palm',
        label: '掌心',
        synonyms: ['手掌心', 'palm'],
        parent: 'hand',
      },
      {
        id: 'thumb',
        role: 'thumb',
        label: '拇指',
        synonyms: ['大拇指', 'thumb'],
        parent: 'hand',
      },
      {
        id: 'finger-1',
        role: 'finger',
        label: '食指',
        synonyms: ['index', '第二指'],
        parent: 'hand',
      },
      {
        id: 'finger-2',
        role: 'finger',
        label: '中指',
        synonyms: ['middle', '第三指'],
        parent: 'hand',
      },
      {
        id: 'finger-3',
        role: 'finger',
        label: '无名指',
        synonyms: ['ring', '第四指'],
        parent: 'hand',
      },
      {
        id: 'finger-4',
        role: 'finger',
        label: '小指',
        synonyms: ['pinky', '第五指'],
        parent: 'hand',
      },
    ],
  },
  null,
  2,
);

/**
 * 语义面板：计划 JSON、部件、指纹、diff、问题与角色词表。
 * 只负责展示与收集输入，解析、写回、剪贴板都交给父组件。
 */
@Component({
  selector: 'app-svg-semantics-panel',
  imports: [UiMaterialModule],
  template: `
    <section class="section-block">
      <header class="section-head">
        <h3>语义计划</h3>
        <span class="section-pill">示例 · 手掌</span>
      </header>
      <textarea
        class="plan-input"
        spellcheck="false"
        aria-label="语义计划 JSON"
        [value]="plan()"
        (input)="onPlanInput($event)"
      ></textarea>
      <div class="actions">
        <span class="hint">改完 id / role / label 后应用，由父级重算。</span>
        <button type="button" mat-flat-button class="dense" [disabled]="!plan().trim()" (click)="apply()">
          应用计划
        </button>
      </div>
    </section>

    <section class="section-block">
      <header class="section-head">
        <h3>部件</h3>
        <span class="section-pill">{{ parts().length }}</span>
      </header>

      @if (parts().length > 0) {
        <ul class="parts">
          @for (part of parts(); track part.id) {
            <li class="part" [class.missing]="!part.exists">
              <header class="part-head">
                <button
                  type="button"
                  class="part-id"
                  [title]="'选中 #' + part.id"
                  (click)="selectPart.emit(part.id)"
                >#{{ part.id }}</button>
                <span class="section-pill">{{ part.childCount }} 子</span>
              </header>

              <div class="part-grid">
                <label class="field">
                  <span>角色</span>
                  <input
                    type="text"
                    spellcheck="false"
                    [value]="part.role"
                    [disabled]="!!part.locked"
                    [attr.aria-label]="'角色：' + part.id"
                    (change)="commit(part, 'role', $event)"
                    (keydown.enter)="commit(part, 'role', $event)"
                  />
                </label>
                <label class="field">
                  <span>名称</span>
                  <input
                    type="text"
                    spellcheck="false"
                    [value]="part.label"
                    [disabled]="!!part.locked"
                    [attr.aria-label]="'名称：' + part.id"
                    (change)="commit(part, 'label', $event)"
                    (keydown.enter)="commit(part, 'label', $event)"
                  />
                </label>
              </div>

              @if (part.parentId || part.required || part.locked || !part.exists) {
                <div class="part-meta">
                  @if (part.parentId) {
                    <span>父级 #{{ part.parentId }}</span>
                  }
                  @if (part.required) {
                    <span class="tag">必需</span>
                  }
                  @if (part.locked) {
                    <span class="tag">锁定</span>
                  }
                  @if (!part.exists) {
                    <span class="tag bad">缺失</span>
                  }
                </div>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="empty">还没有部件。应用计划后会在这里列出。</p>
      }
    </section>

    <section class="section-block">
      <header class="section-head">
        <h3>指纹</h3>
        <button
          type="button"
          mat-button class="dense tiny"
          [disabled]="!parts().length && !fingerprint()"
          (click)="copySummary()"
        >
          复制语义摘要
        </button>
      </header>
      <code class="fp" [class.empty]="!fingerprint()">{{ fingerprint() || '尚未生成指纹' }}</code>
    </section>

    <section class="section-block">
      <header class="section-head">
        <h3>语义 diff</h3>
        @if (diff(); as d) {
          <span class="section-pill" [class.on]="d.geometryOnly">
            {{ d.geometryOnly ? '仅几何变化' : '含语义变化' }}
          </span>
        }
      </header>

      @if (diff()) {
        @if (diffGroups().length > 0) {
          @for (group of diffGroups(); track group.key) {
            <div class="diff-group">
              <h4>{{ group.label }} · {{ group.ids.length }}</h4>
              <ul class="chips">
                @for (id of group.ids; track $index) {
                  <li class="chip" [attr.data-kind]="group.key">#{{ id }}</li>
                }
              </ul>
            </div>
          }
        } @else {
          <p class="empty">语义结构没有变化。</p>
        }
      } @else {
        <p class="empty">还没有 diff。应用计划或改动后会显示。</p>
      }
    </section>

    <section class="section-block">
      <header class="section-head">
        <h3>问题</h3>
        @if (errorCount() > 0) {
          <span class="section-pill bad">{{ errorCount() }} 错误</span>
        }
        @if (warnCount() > 0) {
          <span class="section-pill warn">{{ warnCount() }} 警告</span>
        }
      </header>

      @if (issues().length > 0) {
        <ul class="issues">
          @for (issue of issues(); track $index) {
            <li class="issue" [attr.data-sev]="issue.severity">
              <span class="sev">{{ issue.severity === 'error' ? '错误' : '警告' }}</span>
              <div class="issue-body">
                <p>{{ issue.message }}</p>
                <div class="issue-meta">
                  <code>{{ issue.code }}</code>
                  @if (issue.id) {
                    <span>#{{ issue.id }}</span>
                  }
                </div>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">没有语义问题。</p>
      }
    </section>

    <details class="vocab">
      <summary>
        角色词表
        <span class="section-pill">
          {{ roleEntries().length }}
          @if (vocabTotal() > roleEntries().length) {
            / {{ vocabTotal() }}
          }
        </span>
      </summary>
      @if (roleEntries().length > 0) {
        <ul>
          @for (term of roleEntries(); track term.key) {
            <li>
              <code>{{ term.key }}</code>
              <b>{{ term.label }}</b>
              @if (term.synonyms) {
                <small>{{ term.synonyms }}</small>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="empty">词表为空。</p>
      }
    </details>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      color: var(--ui-text);
    }

    .section-block {
      padding: 10px 0;
      border-bottom: 1px solid var(--ui-border-2);
    }

    .section-block:first-child {
      padding-top: 0;
    }

    .section-block:last-of-type {
      border-bottom: 0;
    }

    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 7px;
    }

    .section-head h3 {
      flex: 1;
      min-width: 0;
      margin: 0;
      font-size: 12px;
      font-weight: 600;
    }

    .section-pill {
      flex: none;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--ui-panel-3);
      color: var(--ui-muted);
      font: 500 9.5px/1.7 var(--ui-font-mono);
    }

    .section-pill.on {
      background: color-mix(in srgb, var(--ui-accent) 18%, transparent);
      color: var(--ui-text-2);
    }

    .section-pill.bad {
      background: color-mix(in srgb, var(--ui-error) 14%, transparent);
      color: var(--ui-error);
    }

    .section-pill.warn {
      background: var(--warn-soft);
      color: var(--warn);
    }

    .dense {
      --mat-button-filled-container-height: 28px;
      --mat-button-tonal-container-height: 28px;
      --mat-button-text-container-height: 28px;
      --mat-button-filled-touch-target-size: 28px;
      --mat-button-tonal-touch-target-size: 28px;
      --mat-button-text-touch-target-size: 28px;
      --mat-button-filled-label-text-size: 11px;
      --mat-button-tonal-label-text-size: 11px;
      --mat-button-text-label-text-size: 11px;
      --mat-button-filled-horizontal-padding: 9px;
      --mat-button-tonal-horizontal-padding: 9px;
      --mat-button-text-horizontal-padding: 7px;
      --mat-button-filled-container-shape: 18px;
      --mat-button-tonal-container-shape: 18px;
      --mat-button-text-container-shape: 18px;
    }

    .dense.tiny {
      --mat-button-filled-container-height: 24px;
      --mat-button-tonal-container-height: 24px;
      --mat-button-text-container-height: 24px;
      --mat-button-filled-touch-target-size: 24px;
      --mat-button-tonal-touch-target-size: 24px;
      --mat-button-text-touch-target-size: 24px;
      --mat-button-filled-label-text-size: 10px;
      --mat-button-tonal-label-text-size: 10px;
      --mat-button-text-label-text-size: 10px;
    }

    .btn {
      height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      border: 1px solid var(--ui-border-2);
      background: var(--ui-raised);
      color: var(--ui-text);
      font: 500 11px/1 var(--ui-font-body);
      cursor: pointer;
      white-space: nowrap;
    }

    .btn:hover {
      background: var(--ui-panel-2);
    }

    .btn:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }

    .btn.primary {
      background: var(--ui-primary);
      border-color: transparent;
      color: var(--ui-on-primary);
    }

    .btn.tiny {
      height: 22px;
      padding: 0 8px;
      font: 500 10px/1 var(--ui-font-mono);
    }

    .btn:focus-visible,
    .field input:focus-visible,
    .plan-input:focus-visible,
    .vocab summary:focus-visible {
      outline: none;
      box-shadow: var(--ui-ring);
    }

    .plan-input {
      box-sizing: border-box;
      width: 100%;
      min-height: 132px;
      max-height: 220px;
      padding: 8px 9px;
      border-radius: 10px;
      border: 1px solid var(--ui-border-2);
      background: var(--ui-inset);
      color: var(--ui-text);
      font: 400 10px/1.5 var(--ui-font-mono);
      resize: vertical;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 6px;
    }

    .hint {
      flex: 1;
      min-width: 0;
      color: var(--ui-muted);
      font-size: 10px;
      line-height: 1.45;
    }

    .parts {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 280px;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .part {
      padding: 7px 8px;
      border-radius: 9px;
      border: 1px solid var(--ui-border-2);
      border-left: 3px solid var(--ui-line);
      background: var(--ui-raised);
    }

    .part.missing {
      border-left-color: var(--ui-error);
      opacity: 0.72;
    }

    .part-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .part-id {
      flex: 1;
      min-width: 0;
      padding: 0;
      overflow: hidden;
      border: 0;
      background: transparent;
      color: var(--ui-text-2);
      font: 500 10.5px/1.4 var(--ui-font-mono);
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }

    .part-id:hover {
      color: var(--ui-primary);
      text-decoration: underline;
    }

    .part-grid {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      gap: 5px 6px;
      margin-top: 5px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .field span {
      color: var(--ui-muted);
      font: 500 9px/1.4 var(--ui-font-mono);
    }

    .field input {
      box-sizing: border-box;
      width: 100%;
      height: 23px;
      padding: 0 6px;
      border-radius: 6px;
      border: 1px solid var(--ui-border-2);
      background: var(--ui-inset);
      color: var(--ui-text);
      font: 400 10px/1.4 var(--ui-font-mono);
    }

    .field input:disabled {
      opacity: 0.55;
    }

    .part-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 4px;
      color: var(--ui-muted);
      font: 400 9.5px/1.4 var(--ui-font-mono);
    }

    .tag {
      padding: 0 5px;
      border-radius: 4px;
      background: var(--ui-panel-3);
    }

    .tag.bad {
      background: color-mix(in srgb, var(--ui-error) 14%, transparent);
      color: var(--ui-error);
    }

    .fp {
      display: block;
      padding: 7px 8px;
      border-radius: 9px;
      background: var(--ui-inset);
      color: var(--ui-text-2);
      font: 400 10px/1.5 var(--ui-font-mono);
      word-break: break-all;
    }

    .fp.empty {
      color: var(--ui-muted);
    }

    .diff-group {
      margin-top: 6px;
    }

    .diff-group h4 {
      margin: 0 0 4px;
      color: var(--ui-muted);
      font: 600 9.5px/1.4 var(--ui-font-mono);
      letter-spacing: 0.03em;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .chip {
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--ui-panel-3);
      color: var(--ui-text-2);
      font: 500 9.5px/1.6 var(--ui-font-mono);
    }

    .chip[data-kind='added'] {
      background: color-mix(in srgb, var(--ok) 16%, transparent);
      color: var(--ok);
    }

    .chip[data-kind='removed'] {
      background: color-mix(in srgb, var(--ui-error) 13%, transparent);
      color: var(--ui-error);
    }

    .chip[data-kind='labelChanged'] {
      background: color-mix(in srgb, var(--ui-accent) 15%, transparent);
      color: var(--ui-text-2);
    }

    .chip[data-kind='roleChanged'] {
      background: var(--warn-soft);
      color: var(--warn);
    }

    .issues {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .issue {
      display: flex;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 8px;
      border-left: 3px solid var(--ui-line);
      background: var(--ui-raised);
    }

    .issue[data-sev='error'] {
      border-left-color: var(--ui-error);
      background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-raised));
    }

    .issue[data-sev='warn'] {
      border-left-color: var(--warn);
      background: var(--warn-soft);
    }

    .sev {
      flex: none;
      color: var(--ui-muted);
      font: 600 9.5px/1.6 var(--ui-font-mono);
    }

    .issue[data-sev='error'] .sev {
      color: var(--ui-error);
    }

    .issue[data-sev='warn'] .sev {
      color: var(--warn);
    }

    .issue-body {
      flex: 1;
      min-width: 0;
    }

    .issue-body p {
      margin: 0;
      font-size: 11px;
      line-height: 1.5;
    }

    .issue-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 2px;
      color: var(--ui-muted);
      font: 400 9.5px/1.4 var(--ui-font-mono);
    }

    .issue-meta code {
      color: var(--ui-text-2);
    }

    .empty {
      margin: 0;
      padding: 10px;
      border-radius: 9px;
      background: var(--ui-inset);
      color: var(--ui-muted);
      font-size: 11px;
      line-height: 1.5;
      text-align: center;
    }

    .vocab {
      margin-top: 10px;
      border: 1px solid var(--ui-border-2);
      border-radius: 10px;
      background: var(--ui-inset);
      overflow: hidden;
    }

    .vocab summary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 9px;
      color: var(--ui-muted);
      font-size: 11px;
      cursor: pointer;
      list-style: none;
    }

    .vocab summary::-webkit-details-marker {
      display: none;
    }

    .vocab[open] summary {
      color: var(--ui-text);
      border-bottom: 1px solid var(--ui-border-2);
    }

    .vocab ul {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 220px;
      margin: 0;
      padding: 6px 9px 8px;
      overflow-y: auto;
      list-style: none;
    }

    .vocab li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 7px;
      font-size: 10.5px;
    }

    .vocab code {
      color: var(--ui-text-2);
      font: 500 10px/1.4 var(--ui-font-mono);
    }

    .vocab b {
      font-weight: 600;
    }

    .vocab small {
      width: 100%;
      color: var(--ui-muted);
      font-size: 9.5px;
      line-height: 1.4;
    }

    .vocab .empty {
      margin: 0 9px 8px;
    }
  `,
})
export class SvgSemanticsPanelComponent {
  readonly parts = input<SemanticPartInfo[]>([]);
  readonly fingerprint = input('');
  readonly diff = input<SemanticDiff | null>(null);
  readonly issues = input<SemanticIssue[]>([]);

  readonly applyPlan = output<string>();
  readonly updatePart = output<{ id: string; role?: string; label?: string }>();
  // 输出名沿用 copy（工作台里 (copy) 绑定它）；与原生事件同名但只在本组件上出现。
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly copy = output<string>();
  readonly selectPart = output<string>();

  readonly plan = signal(PLAN_EXAMPLE);

  readonly errorCount = computed(() => this.issues().filter((issue) => issue.severity === 'error').length);
  readonly warnCount = computed(() => this.issues().filter((issue) => issue.severity === 'warn').length);

  readonly diffGroups = computed<DiffGroup[]>(() => {
    const diff = this.diff();
    if (!diff) return [];
    const groups: DiffGroup[] = [
      { key: 'added', label: '新增', ids: diff.added },
      { key: 'removed', label: '移除', ids: diff.removed },
      { key: 'labelChanged', label: '名称变化', ids: diff.labelChanged },
      { key: 'roleChanged', label: '角色变化', ids: diff.roleChanged },
    ];
    return groups.filter((group) => group.ids.length > 0);
  });

  readonly vocabTotal = computed(() => Object.keys(ROLE_VOCABULARY).length);

  readonly roleEntries = computed(() =>
    Object.entries(ROLE_VOCABULARY)
      .slice(0, 20)
      .map(([key, term]) => ({
        key,
        label: term.label,
        synonyms: term.synonyms.join(' / '),
      })),
  );

  readonly summary = computed(() => {
    const lines = [
      `语义摘要 · ${this.fingerprint() || '无指纹'}`,
      `部件 ${this.parts().length}`,
    ];
    for (const part of this.parts()) {
      const flags = [
        part.required ? '必需' : '',
        part.locked ? '锁定' : '',
        part.exists ? '' : '缺失',
      ].filter(Boolean);
      const bits = [
        `#${part.id}`,
        part.role,
        part.label,
        `子 ${part.childCount}`,
      ];
      if (part.parentId) bits.push(`父 #${part.parentId}`);
      if (flags.length > 0) bits.push(flags.join('/'));
      lines.push(bits.join(' · '));
    }
    const errorCount = this.errorCount();
    const warnCount = this.warnCount();
    if (errorCount > 0 || warnCount > 0) {
      lines.push(`问题 ${errorCount} 错误 / ${warnCount} 警告`);
    }
    return lines.join('\n');
  });

  onPlanInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.plan.set(target.value);
  }

  apply(): void {
    const text = this.plan().trim();
    if (!text) return;
    this.applyPlan.emit(text);
  }

  commit(part: SemanticPartInfo, field: EditField, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const value = target.value.trim();
    if (!value || value === part[field]) return;
    this.updatePart.emit(
      field === 'role' ? { id: part.id, role: value } : { id: part.id, label: value },
    );
  }

  copySummary(): void {
    this.copy.emit(this.summary());
  }
}
