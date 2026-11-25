import fs from 'node:fs';
import path from 'node:path';
import { styleGuard } from './style-guard.mjs';

const root = path.resolve(import.meta.dirname, '..');
const uiDir = path.join(root, 'src/app/ui');
const visDir = path.join(root, 'src/app/vis');
const appDir = path.join(root, 'src/app');

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
const localPrimitive = /class="(?:pill|chip|card)(?:[\s"])/;
/** 组件已经收口的表面：页面不得再直接用类名，也不得自己定义同名样式 */
const ownedClass = /class="[^"]*(?:list-card|table-wrap|inner-card|acard-menu|section-block|section-head|section-body|section-pill)/;
const localOwnedStyle = /^\.(?:list-card|table-wrap|inner-card|acard-menu|section-block|section-head|section-body|section-pill|set-label|set-lead|mono|rules|hint)\s*(?:[,.{:]|$)/;

for (const file of walk(appDir)) {
  if (file.startsWith(uiDir + path.sep)) continue;
  if (file.startsWith(path.join(appDir, 'svg') + path.sep)) continue;
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
      if (localPrimitive.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  本地标签/卡片原语，请改用 ui-tag / ui-chip / ui-state-card  ${trimmed}`);
      }
      if (ownedClass.test(trimmed)) {
        violations.push(`${rel}:${index + 1}  使用了已收口的表面类，请改用对应组件  ${trimmed}`);
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

    if (isStyle && localOwnedStyle.test(trimmed)) {
      violations.push(`${rel}:${index + 1}  本地重复定义已收口样式，请改用组件  ${trimmed}`);
    }

    if (isStyle && localSurface.test(trimmed)) {
      violations.push(`${rel}:${index + 1}  本地 ${trimmed.split(/\s/)[0]} 表面，请改用 ui-toast / ui-source-chip`);
    }
  });
}

/* ---- 注册表检查：自定义视觉件必须先登记 ---- */

const registry = JSON.parse(
  fs.readFileSync(path.join(uiDir, 'registry.json'), 'utf8'),
);
const entries = registry.components ?? [];
const registered = new Set(entries.map((entry) => entry.selector));
const warnings = [];

// 1) ui/ 下的每个组件都必须在 registry 登记（新增共享件不登记即失败）
for (const file of fs.readdirSync(uiDir).filter((name) => name.endsWith('.ts'))) {
  const full = path.join(uiDir, file);
  const text = fs.readFileSync(full, 'utf8');
  const selector = text.match(/selector:\s*'([^']+)'/)?.[1];
  if (!selector) continue;
  if (!registered.has(selector)) {
    violations.push(
      `${path.relative(root, full)}  组件未在 ui/registry.json 登记  ${selector}`,
    );
  }
}

// 2) registry 的 demoFile 必须存在并真的渲染该组件；page 必须是可访问路由
const routesText = fs.readFileSync(path.join(visDir, 'vis.routes.ts'), 'utf8');
for (const entry of entries) {
  if (!entry.demoFile) {
    warnings.push(`${entry.selector}  未指定展示页（demoFile 为空）`);
  } else {
    const demo = path.join(root, entry.demoFile);
    if (!fs.existsSync(demo)) {
      violations.push(`${entry.selector}  demoFile 不存在  ${entry.demoFile}`);
    } else if (!new RegExp(`<${entry.selector}[\\s>/]`).test(fs.readFileSync(demo, 'utf8'))) {
      violations.push(
        `${entry.selector}  未在登记的 demoFile 中渲染  ${entry.demoFile}`,
      );
    }
  }

  if (!entry.page) {
    warnings.push(`${entry.selector}  未指定展示页路由（page 为空）`);
  } else {
    const routePath = entry.page.replace(/^\/vis\/?/, '');
    if (!routesText.includes(`path: '${routePath}'`)) {
      violations.push(`${entry.selector}  展示页路由不存在  ${entry.page}`);
    }
  }
}

// 3) VIS 模板里出现的 ui-* 标签必须在 registry 登记
const registeredTags = new Set([...registered].filter((s) => s.startsWith('ui-')));
for (const file of walk(visDir)) {
  if (!file.endsWith('.ts')) continue;
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/<(ui-[a-z0-9-]+)/g)) {
    if (!registeredTags.has(match[1])) {
      violations.push(`${rel}  使用了未登记的组件  <${match[1]}>`);
    }
  }
}

// 4) 页面样式不得写死卡 / 列表面板级圆角，必须走 token
const literalRadius = /border-radius:\s*(?:16|24|28)px/;
for (const file of walk(visDir)) {
  if (!file.endsWith('.scss')) continue;
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (literalRadius.test(line)) {
      violations.push(
        `${rel}:${index + 1}  写死圆角，请改用 --ui-radius-list / -card / -panel  ${line.trim()}`,
      );
    }
  });
}

violations.push(...styleGuard(root));

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
console.log(
  `component-guard: ${registered.size} 个组件已登记，展示页与 demoFile 校验通过。`,
);
for (const line of warnings) console.log('  提示：' + line);
