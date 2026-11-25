// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const localRules = require('./eslint-rules');

module.exports = defineConfig([
  {
    ignores: ['dist/**', '.angular/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    // 内联模板会被抽成虚拟 .html，交给下面的模板配置（含本地登记表规则）
    processor: angular.processInlineTemplates,
    rules: {
      // 选择器前缀沿用工程约定：ui-* / md-* 也是合法前缀（见 AGENTS.md）
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['app', 'ui', 'md'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'ui', 'md'],
          style: 'kebab-case',
        },
      ],
      // { optimized: _optimized, ...rest } 这种「剥掉一个字段」的解构很常见，
      // 下划线开头即表示刻意不用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    plugins: {
      'local-ui-registry': localRules,
    },
    rules: {
      'local-ui-registry/no-unregistered-ui-element': 'error',
    },
  },
]);
