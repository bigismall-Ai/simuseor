/**
 * 来源站的显示名、短名与模型原址。
 *
 * 发现页与模型库都必须用同一套口径 —— 同一张卡在「发现」里能点 HF 跳回原仓库，
 * 进了「模型库」却找不到入口，是这次重构里最明显的割裂。
 *
 * 原址只按 source + repo_id 拼，拼不出就返回空串（本地导入 / Demo / 官方模板没有
 * 远端页面）。**不猜**：给一个 404 的链接比没有链接更糟。
 */

/** 来源显示名。`imported` 是本地扫描入库，不在 settings.sources 里 */
export const SOURCE_LABELS: Record<string, string> = {
  huggingface: 'Hugging Face',
  modelscope: 'ModelScope',
  civitai: 'Civitai',
  demo: 'Demo',
  github: 'GitHub',
  imported: '本地导入',
  templates: '官方模板',
};

/** 卡片上的来源短名：完整名占太宽，title 里给全名 */
export const SOURCE_SHORT: Record<string, string> = {
  huggingface: 'HF',
  modelscope: 'MS',
  civitai: 'Civitai',
  demo: 'Demo',
  github: 'GitHub',
  imported: '本地导入',
  templates: '模板',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source || '';
}

export function sourceShort(source: string): string {
  return SOURCE_SHORT[source] || sourceLabel(source);
}

/** 来源站点的模型原址。认不出 / 没有 repo_id 就返回空串。 */
export function sourceUrl(source: string, repoId: string): string {
  const id = (repoId || '').trim();
  if (!id) return '';
  switch (source) {
    case 'huggingface':
      return `https://huggingface.co/${id}`;
    case 'modelscope':
      return `https://modelscope.cn/models/${id}`;
    case 'civitai':
      // .red 是完整目录前门；.com 对 SFW 模型一样有效，且不会把用户带去 18+ 站点
      return `https://civitai.com/models/${id}`;
    case 'github':
      return `https://github.com/${id}`;
    default:
      return '';
  }
}

/**
 * 可展示的发布方。
 *
 * HF / ModelScope 的仓库归属（`org/repo` 的第一段）就是发布方，是可靠信息；
 * Civitai 的 creator 字段没有落进本库表，本地导入 / Demo 也没有远端作者 ——
 * 这些来源返回空串，不拿域名或模型名冒充。
 */
export function sourceAuthor(source: string, repoId: string): string {
  if (source !== 'huggingface' && source !== 'modelscope') return '';
  return (repoId || '').split('/')[0] || '';
}
