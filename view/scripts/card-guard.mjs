import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const uiDir = path.join(root, 'src/app/ui');
const visDir = path.join(root, 'src/app/vis');

const shellClasses = [
  'head',
  'ident',
  'origin',
  'mark',
  'code',
  'meta',
  'name',
  'slot',
  'rule',
  'size',
  'tags',
  'foot',
  'primary',
  'kebab',
  'media',
  'menu',
  'plate',
  'body',
];

const allowedHints = ['data-tone', '.acard-menu', '.pill-demo', 'is-mono', 'is-more'];

const files = fs
  .readdirSync(uiDir)
  .filter((name) => name.endsWith('-card.ts') && name !== 'list-card.ts')
  .map((name) => path.join(uiDir, name));

const violations = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.includes('.acard-') || !trimmed.includes('{')) return;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (allowedHints.some((hint) => trimmed.includes(hint))) return;

    for (const name of shellClasses) {
      if (new RegExp(`\\.acard-${name}\\b`).test(trimmed)) {
        violations.push(`${path.relative(root, file)}:${index + 1}  .acard-${name}  ${trimmed}`);
        break;
      }
    }
  });
}

/* ---- 组件复用检查：VIS 页面不得手写已收口的共享结构 ---- */

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rawSection = /class="section-(?:block|head|pill|body)/;
const localButton = /class="(?:btn|toggle-chip)[\s"]/;
const materialButton = /(?:mat-flat-button|matButton=|mat-button\b|mat-stroked-button)/;
const localSurface = /^\.(?:toast|source|notice|table-wrap|list-card|modal)\s*\{/;
const localTable = /class="(?:table-wrap|list-card)"/;
const localChip = /class="(?:filter-chip|segmented)"/;
const localEmpty = /class="empty[\s"]/;
const localBadge = /class="badge[\s"]/;

for (const file of walk(visDir)) {
  const rel = path.relative(root, file);
  const isTemplate = file.endsWith('.ts');
  const isStyle = file.endsWith('.scss');
  if (!isTemplate && !isStyle) continue;

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    if (isTemplate) {
      if (rawSection.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  手写 section 结构，请改用 <ui-section>  ${trimmed}`);
      }
      if (localButton.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  本地按钮类，请改用 <ui-button>  ${trimmed}`);
      }
      if (localTable.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  手写表格/列表外壳，请改用 <ui-table> / <ui-list-card>  ${trimmed}`);
      }
      if (localChip.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  本地胶囊/分段控件，请改用 <ui-chip> / <ui-segmented>  ${trimmed}`);
      }
      if (localEmpty.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  手写空状态，请改用 <ui-empty>  ${trimmed}`);
      }
      if (localBadge.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  本地状态徽标，请改用 <ui-badge>  ${trimmed}`);
      }
      if (/class="notice/.test(trimmed) && !trimmed.includes('mock-notice')) {
        violations.push(`${rel}:${index + 1}  本地提示条，请改用 <ui-notice>  ${trimmed}`);
      }
      if (materialButton.test(trimmed)) {
        const allowed =
          trimmed.includes('mat-dialog-close') ||
          trimmed.includes('matDialogClose') ||
          trimmed.includes('#cancelBtn') ||
          trimmed.includes('mat-icon');
        if (!allowed) {
          violations.push(`${rel}:${index + 1}  Material 按钮，请改用 <ui-button>  ${trimmed}`);
        }
      }
    }

    if (isTemplate) {
      const inputs = trimmed.match(/<input[^>]*>/g) ?? [];
      for (const tag of inputs) {
        const allowed = /type="(?:checkbox|radio|file|range|color|date|time)"/.test(tag) || tag.includes('matInput');
        if (!allowed) {
          violations.push(`${rel}:${index + 1}  原生文本输入，请改用 <ui-input>  ${tag.slice(0, 80)}`);
        }
      }
    }

    if (isStyle && /outline:\s*(?:none|0)/.test(trimmed)) {
      violations.push(`${rel}:${index + 1}  可见焦点被抹掉，请改用 :focus-visible + --ui-ring  ${trimmed}`);
    }

    if (isStyle && localSurface.test(trimmed)) {
      violations.push(`${rel}:${index + 1}  本地 ${trimmed.split(/\s/)[0]} 表面，请改用 ui-toast / ui-source-chip`);
    }
  });
}

if (violations.length > 0) {
  console.error('组件漂移：VIS 页面必须复用共享组件。');
  console.error('区块用 <ui-section>，按钮用 <ui-button>，提示用 <ui-toast>，来源用 <ui-source-chip>。');
  console.error('卡片外壳约束见 src/app/ui/asset-card.css 与 --card-* token。\n');
  for (const line of violations) console.error('  ' + line);
  process.exit(1);
}

console.log(
  `component-guard: ${files.length} 个卡片组件外壳无本地覆盖；VIS 页面未手写 section / 按钮 / 提示表面。`,
);
