// @ts-check
/**
 * `no-unregistered-ui-element` 冒烟测试（ESM）。
 *
 *   cd view && node --test eslint-rules/no-unregistered-ui-element.test.mjs
 *
 * 验三件事：登记过的放过、没登记的报出来（文案固定）、
 * VIS / 原型与 Material / 原生标签不误伤。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { Linter } from 'eslint';

const require = createRequire(import.meta.url);
const parser = require('@angular-eslint/template-parser');
const rule = require('./no-unregistered-ui-element.js');

/** @param {string} code */
function lint(code) {
  const linter = new Linter();
  return linter.verify(
    code,
    [
      {
        files: ['**/*.html'],
        languageOptions: { parser },
        plugins: {
          'local-ui-registry': { rules: { 'no-unregistered-ui-element': rule } },
        },
        rules: { 'local-ui-registry/no-unregistered-ui-element': 'error' },
      },
    ],
    'probe.html',
  );
}

test('已登记的选择器不报', () => {
  const messages = lint('<ui-button>确定</ui-button><md-model-card [item]="x"></md-model-card>');
  assert.deepEqual(messages, []);
});

test('未登记的 ui-* / md-* 报错，消息文案固定', () => {
  const messages = lint(
    '<ui-button>确定</ui-button>' +
      '<ui-ghost-widget></ui-ghost-widget>' +
      '<md-ghost-card></md-ghost-card>',
  );
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((m) => m.message),
    ['组件未在 ui/registry.json 登记: ui-ghost-widget', '组件未在 ui/registry.json 登记: md-ghost-card'],
  );
  assert.ok(messages.every((m) => m.ruleId === 'local-ui-registry/no-unregistered-ui-element'));
});

test('Material / 原生 / VIS / 原型页组件不误伤', () => {
  const messages = lint(
    '<mat-icon svgIcon="app:download"></mat-icon>' +
      '<button type="button">按钮</button>' +
      '<app-vis-brand></app-vis-brand>' +
      '<app-proto-shell></app-proto-shell>',
  );
  assert.deepEqual(messages, []);
});

test('app-cover-plate / app-workflow-card 已登记，不报', () => {
  const messages = lint('<app-cover-plate></app-cover-plate><app-workflow-card></app-workflow-card>');
  assert.deepEqual(messages, []);
});
