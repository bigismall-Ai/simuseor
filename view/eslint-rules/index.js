// @ts-check
/**
 * 本地规则集合。
 *
 * 目前只有一条：模板里用到的工程内组件选择器必须已经在 `src/app/ui/registry.json` 登记。
 * `scripts/card-guard.mjs` 守的是「组件源码里有没有登记」；这条规则守的是
 * 「模板里有没有人先把选择器写上了」——页面先引用、登记表后补的漂移在 PR 里就拦下。
 */
const noUnregisteredUiElement = require('./no-unregistered-ui-element');

module.exports = {
  meta: { name: 'local-ui-registry' },
  rules: {
    'no-unregistered-ui-element': noUnregisteredUiElement,
  },
};
