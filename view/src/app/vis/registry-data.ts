import registry from '../ui/registry.json';

/** 注册条目里一条输入 / 输出的说明（只登记关键项，不代替完整 API 文档）。 */
export interface RegistryApiMember {
  name: string;
  type?: string;
  note?: string;
}

/** 卡 / 代码 / 搜索这类带实际 API 的组件，才在注册表里附关键输入输出。 */
export interface RegistryApi {
  inputs?: RegistryApiMember[];
  outputs?: RegistryApiMember[];
}

/** `src/app/ui/registry.json` 的一条登记。 */
export interface RegistryEntry {
  selector: string;
  name: string;
  category: string;
  page?: string;
  demoFile?: string;
  deprecated?: boolean;
  variants?: string[];
  sizes?: string[];
  tokens?: string[];
  api?: RegistryApi;
}

/** 分类的展示顺序：注册表与组件 API 页共用。 */
export const CATEGORY_ORDER = ['shell', 'action', 'form', 'feedback', 'surface', 'content', 'card'];

const CATEGORY_LABELS: Record<string, string> = {
  shell: '外壳与结构',
  action: '动作',
  form: '表单',
  feedback: '反馈',
  surface: '表面',
  content: '内容排版',
  card: '卡片',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** 唯一登记表的只读副本；页面不再各自 `import registry.json` 后重写一遍类型。 */
export const REGISTRY_ENTRIES: RegistryEntry[] = registry.components as RegistryEntry[];

/** 按选择器查一条登记；大小写与首尾空白不敏感。 */
export function findRegistryEntry(selector: string): RegistryEntry | undefined {
  const key = selector.trim().toLowerCase();
  return REGISTRY_ENTRIES.find((entry) => entry.selector.toLowerCase() === key);
}

/** 组件 API 页的固定路由；注册表与页面共用，避免两处拼字符串走散。 */
export function apiRoute(selector: string): string {
  return `/vis/components/${selector}`;
}
