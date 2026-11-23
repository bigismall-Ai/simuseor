/**
 * 预览前的 SVG 清洗。只服务渲染，不参与 canonical 文本。
 *
 * 目标是防止导入文件把宿主页面当跳板：脚本、事件属性、外部资源、foreignObject、
 * 以及 `<style>` 里的 @import。真实资产基本用不到这些，误伤很小。
 */

const BANNED_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'handler',
  'listener',
]);

const BANNED_URL = /^\s*(?:javascript|data:text\/html|vbscript):/i;

export interface SanitizeReport {
  text: string;
  removed: string[];
}

export function sanitizeSvgText(text: string): SanitizeReport {
  const removed: string[] = [];
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    return { text, removed: [] };
  }

  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (BANNED_TAGS.has(el.localName.toLowerCase())) {
      removed.push(`<${el.localName}>`);
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (/^on/i.test(name)) {
        removed.push(`${name}=`);
        el.removeAttribute(name);
        continue;
      }
      if ((name === 'href' || name === 'xlink:href') && BANNED_URL.test(attr.value)) {
        removed.push(`${name}=javascript:`);
        el.removeAttribute(name);
        continue;
      }
      if (name === 'style' && /expression\s*\(/i.test(attr.value)) {
        removed.push('style=expression()');
        el.removeAttribute(name);
      }
    }
    if (el.localName === 'style') {
      const css = el.textContent ?? '';
      if (/@import|expression\s*\(/i.test(css)) {
        removed.push('<style>@import');
        el.textContent = '';
      }
    }
  }

  // 根节点上的事件与 href 也要清。
  for (const attr of Array.from(root.attributes)) {
    if (/^on/i.test(attr.name)) {
      removed.push(`${attr.name}=`);
      root.removeAttribute(attr.name);
    }
  }

  if (removed.length === 0) return { text, removed };
  return { text: new XMLSerializer().serializeToString(root), removed };
}
