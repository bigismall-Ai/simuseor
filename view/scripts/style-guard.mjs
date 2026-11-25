import fs from 'node:fs';
import path from 'node:path';

const layoutProps = new Set([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-inline',
  'z-index',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block',
  'margin-inline',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-inline',
  'gap',
  'row-gap',
  'column-gap',
  'grid',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-columns',
  'grid-auto-rows',
  'grid-auto-flow',
  'grid-area',
  'grid-row',
  'grid-column',
  'grid-row-start',
  'grid-row-end',
  'grid-column-start',
  'grid-column-end',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-content',
  'align-self',
  'justify-content',
  'justify-items',
  'justify-self',
  'order',
  'overflow',
  'overflow-x',
  'overflow-y',
  'box-sizing',
  'cursor',
  'pointer-events',
  'user-select',
  'visibility',
  'float',
  'clear',
]);

const visualProps = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'box-shadow',
  'text-shadow',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration',
  'opacity',
  'filter',
  'backdrop-filter',
  'fill',
  'stroke',
  'stroke-width',
  'outline',
  'outline-color',
  'outline-width',
  'outline-style',
  'outline-offset',
]);

const literalOk = /var\(--|^(?:0|auto|none|transparent|inherit|initial|unset|currentColor)$/;
const allowedGlobal = /^(:root|html|body|textarea|a|:focus-visible|::selection|\.mono|\.ui-scrollbar)/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function readLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

function declarations(file) {
  const found = [];
  const lines = readLines(file);
  lines.forEach((line, index) => {
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*\/\*/.test(line)) return;
    const match = line.match(/^\s*([a-z-]+)\s*:\s*(.+?);/);
    if (!match) return;
    const [, prop, value] = match;
    if (prop.startsWith('--') || layoutProps.has(prop)) return;
    if (!visualProps.has(prop)) return;
    found.push({ line: index + 1, prop, value });
  });
  return found;
}

/**
 * 守卫 2.0：全局样式白名单 / 产品页样式白名单 / VIS 视觉债务棘轮。
 *
 * 目标：实际产品页（`src/app/pages`）里不允许出现视觉字面量；
 * 设计页（`src/app/vis`）保留现状，但新增视觉声明会被拦下。
 */
export function styleGuard(root) {
  const violations = [];

  // 1) styles.scss 只允许品牌层与 base
  const globalCss = path.join(root, 'src/styles.scss');
  if (fs.existsSync(globalCss)) {
    readLines(globalCss).forEach((line, index) => {
      if (!/^[^ \t@/*].*\{/.test(line)) return;
      const selector = line.slice(0, line.indexOf('{')).trim();
      if (!allowedGlobal.test(selector)) {
        violations.push(
          `src/styles.scss:${index + 1}  全局样式只允许品牌层，请把视觉件做成组件  ${selector}`,
        );
      }
    });
  }

  // 2) 产品页：只允许布局属性，视觉属性只能走 token
  const pagesDir = path.join(root, 'src/app/pages');
  if (fs.existsSync(pagesDir)) {
    for (const file of walk(pagesDir).filter((name) => name.endsWith('.scss'))) {
      const rel = path.relative(root, file);
      for (const item of declarations(file)) {
        if (literalOk.test(item.value.trim())) continue;
        violations.push(
          `${rel}:${item.line}  页面样式不得写死视觉值，请改用组件或 token  ${item.prop}: ${item.value}`,
        );
      }
    }
  }

  // 3) VIS 视觉债务棘轮：允许保留现状，不允许新增
  const visDir = path.join(root, 'src/app/vis');
  const baselinePath = path.join(root, 'scripts/vis-style-baseline.json');
  const counts = {};
  if (fs.existsSync(visDir)) {
    for (const file of walk(visDir).filter((name) => name.endsWith('.scss'))) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      counts[rel] = declarations(file).length;
    }
  }

  if (process.env['WRITE_VIS_BASELINE'] === '1') {
    fs.writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n', 'utf8');
    console.log(`component-guard: 已写入 ${Object.keys(counts).length} 个 VIS 样式基线。`);
    return violations;
  }

  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    for (const [file, count] of Object.entries(counts)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        violations.push(
          `${file}  VIS 视觉声明从 ${allowed} 增加到 ${count}，新增视觉样式必须做成组件`,
        );
      }
    }
  }

  return violations;
}
