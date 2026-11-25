// @ts-check
/**
 * `no-unregistered-ui-element`
 *
 * 模板里一旦出现 `ui-*` / `md-*` / `app-cover-plate` / `app-workflow-card` 这类
 * 工程内视觉原语，就必须已经写进 `src/app/ui/registry.json`：
 * 没登记的组件等于「页面先引用、登记表后补」，VIS 的注册表页与守卫都看不到它。
 *
 * 不拦：Angular 内置（`ng-*`）、Material（`mat-*` 等）、原生标签、
 * VIS / 原型页组件（`app-vis-*` / `app-proto-*`）以及其它自由 `app-*` 组件。
 *
 * 登记表在 lint 时读，按文件 mtime 缓存；`--fix` 不会也不能替人登记。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getTemplateParserServices } = require('@angular-eslint/utils');

const RULE_NAME = 'no-unregistered-ui-element';
const REGISTRY_PATH = path.resolve(__dirname, '..', 'src', 'app', 'ui', 'registry.json');
const MESSAGE = '组件未在 ui/registry.json 登记: {{selector}}';

/** 工程内视觉原语的前缀 / 精确选择器。 */
const PRIMITIVE_PATTERNS = [/^ui-/, /^md-/, /^app-cover-plate$/, /^app-workflow-card$/];

const IGNORED_PATTERNS = [/^ng-/, /^mat-/, /^app-vis-/, /^app-proto-/];

/** @type {{ mtimeMs: number; selectors: Set<string> } | null} */
let cache = null;

/**
 * 读登记表里的全部选择器。
 * @returns {Set<string>}
 */
function registeredSelectors() {
  const stat = fs.statSync(REGISTRY_PATH);
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.selectors;

  /** @type {Set<string>} */
  const selectors = new Set();
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  for (const entry of registry.components ?? []) {
    for (const selector of String(entry.selector ?? '').split(',')) {
      const element = selector.trim().split(/[.[#:]/)[0].trim().toLowerCase();
      if (element) selectors.add(element);
    }
  }
  cache = { mtimeMs: stat.mtimeMs, selectors };
  return selectors;
}

/**
 * 这个标签是不是工程内视觉原语（因此需要登记）。
 * @param {string} tag
 */
function isPrimitive(tag) {
  if (IGNORED_PATTERNS.some((pattern) => pattern.test(tag))) return false;
  return PRIMITIVE_PATTERNS.some((pattern) => pattern.test(tag));
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '工程内视觉原语必须在 src/app/ui/registry.json 登记',
    },
    schema: [],
    messages: { unregistered: MESSAGE },
  },

  create(context) {
    const selectors = registeredSelectors();
    const parserServices = getTemplateParserServices(context);

    return {
      Element(node) {
        const tag = String(node.name ?? '').toLowerCase();
        if (!tag || !isPrimitive(tag)) return;
        if (selectors.has(tag)) return;

        const loc = parserServices.convertNodeSourceSpanToLoc(node.sourceSpan);
        context.report({
          loc,
          messageId: 'unregistered',
          data: { selector: tag },
        });
      },
    };
  },
};

module.exports.RULE_NAME = RULE_NAME;
module.exports.REGISTRY_PATH = REGISTRY_PATH;
