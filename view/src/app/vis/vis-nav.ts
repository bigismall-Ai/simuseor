import type { NavStatus } from '../ui/nav-tree';

export type NavNodeStatus = NavStatus;

export interface NavNode {
  /** 稳定 key：折叠状态、测试与 breadcrumb 都按它定位 */
  key: string;
  label: string;
  /** 叶子节点的路由；分组节点不带路由 */
  route?: string;
  icon?: string;
  /** 右侧状态 chip：New / Preview / Planned / Deprecated */
  status?: NavNodeStatus;
  /** 分组标题：不可点击、字号更小、始终展开（外壳展开时） */
  subheader?: boolean;
  children?: NavNode[];
}

export interface NavRow {
  node: NavNode;
  depth: number;
  /** 分组节点是否展开；叶子恒为 false */
  open: boolean;
}

/**
 * VIS 侧栏导航的唯一数据源：一棵递归树。
 *
 * 结构对齐 MUI 文档站：
 *   - 有 children 的节点是分组，点击可展开 / 收起；
 *   - `subheader` 节点是大写分组标题，不可点击，子项始终显示；
 *   - 叶子节点才是路由；
 *   - `status` 在右侧渲染状态 chip。
 *
 * 外壳、侧边导航原型页、breadcrumb 都从这里取数据，不再各写一份。
 */
export const NAV_TREE: NavNode[] = [
  { key: 'overview', label: '总览', route: '/vis/overview', icon: 'home' },
  {
    key: 'visual',
    label: '视觉设计',
    children: [
      {
        key: 'brand',
        label: '品牌',
        subheader: true,
        children: [
          { key: 'brand-mark', label: '标识', route: '/vis/brand', icon: 'brand' },
          { key: 'color', label: '色彩', route: '/vis/color', icon: 'palette' },
          { key: 'cover', label: '封面与纹样', route: '/vis/cover', icon: 'image' },
          { key: 'background', label: '背景', route: '/vis/background', icon: 'layers' },
          { key: 'icons', label: '图标', route: '/vis/icons', icon: 'library' },
          { key: 'layout', label: '布局', route: '/vis/layout', icon: 'panel-left' },
          { key: 'radius', label: '圆角', route: '/vis/radius', icon: 'radius' },
        ],
      },
      {
        key: 'components',
        label: '组件',
        subheader: true,
        children: [
          { key: 'buttons', label: '按钮', route: '/vis/buttons', icon: 'button' },
          { key: 'inputs', label: '输入框', route: '/vis/inputs', icon: 'input' },
          { key: 'pills', label: '胶囊', route: '/vis/pills', icon: 'pill' },
          { key: 'tables', label: '表格', route: '/vis/tables', icon: 'table' },
          { key: 'empty', label: '空状态', route: '/vis/empty', icon: 'inbox' },
          { key: 'modals', label: '模态框', route: '/vis/modals', icon: 'modal' },
        ],
      },
    ],
  },
  {
    key: 'proto-components',
    label: '原型组件',
    children: [
      {
        key: 'shell',
        label: '外壳',
        subheader: true,
        children: [
          { key: 'sidebar', label: '侧边导航', route: '/vis/prototypes/components/sidebar', icon: 'panel-left' },
          { key: 'page-header', label: '页头', route: '/vis/prototypes/components/page-header', icon: 'menu' },
          { key: 'page-shell', label: '页面壳', route: '/vis/prototypes/components/shell', icon: 'panel-right' },
          { key: 'structure', label: '结构件', route: '/vis/prototypes/components/structure', icon: 'library' },
          { key: 'scrollbar', label: '滚动条', route: '/vis/prototypes/components/scrollbar', icon: 'sort' },
        ],
      },
      {
        key: 'content',
        label: '内容',
        subheader: true,
        children: [
          { key: 'cards', label: '资产卡片', route: '/vis/prototypes/components/cards', icon: 'library' },
          { key: 'families', label: '厂牌', route: '/vis/prototypes/components/families', icon: 'brand' },
          { key: 'notice', label: '行内提示', route: '/vis/prototypes/components/notice', icon: 'alert' },
          { key: 'feedback', label: '提示与来源', route: '/vis/prototypes/components/feedback', icon: 'inbox' },
          { key: 'code', label: '代码与搜索', route: '/vis/prototypes/components/code', icon: 'terminal' },
        ],
      },
    ],
  },
  {
    key: 'pages',
    label: '页面',
    children: [
      { key: 'models', label: '模型库', route: '/vis/prototypes/pages/models', icon: 'library' },
      { key: 'workflows', label: '工作流', route: '/vis/prototypes/pages/workflows', icon: 'workflows' },
      { key: 'nodes', label: '自定义节点', route: '/vis/prototypes/pages/nodes', icon: 'nodes' },
      { key: 'resource-manager', label: '资源管理器', route: '/vis/prototypes/pages/resource-manager', icon: 'resources' },
      { key: 'downloads', label: '下载', route: '/vis/prototypes/pages/downloads', icon: 'download' },
      { key: 'error-states', label: '错误与反馈', route: '/vis/prototypes/pages/error-states', icon: 'alert' },
      { key: 'settings', label: '设置', route: '/vis/prototypes/pages/settings', icon: 'settings' },
      { key: 'source-probe', label: '源探针', route: '/vis/prototypes/pages/source-probe', icon: 'network' },
    ],
  },
  {
    key: 'tools',
    label: '工具',
    children: [
      { key: 'registry', label: '组件注册表', route: '/vis/registry', icon: 'library' },
      { key: 'svg', label: 'SVG 工作台', route: '/svg', icon: 'pen' },
    ],
  },
];

/**
 * 把树摊平成当前可见的行。
 *
 * - 折叠侧栏时只保留叶子，分组与 subheader 都不渲染；
 * - 分组节点关闭时只输出分组行本身；
 * - subheader 节点没有折叠概念，父级展开时子项始终可见。
 */
export function flattenNav(
  nodes: NavNode[],
  closed: ReadonlySet<string>,
  collapsed = false,
): NavRow[] {
  const rows: NavRow[] = [];

  const walk = (list: NavNode[], depth: number): void => {
    for (const node of list) {
      if (collapsed) {
        if (node.children?.length) {
          walk(node.children, depth);
          continue;
        }
        if (!node.subheader && node.route) rows.push({ node, depth: 0, open: false });
        continue;
      }

      if (node.subheader) {
        rows.push({ node, depth, open: true });
        walk(node.children ?? [], depth);
        continue;
      }

      const isGroup = !!node.children?.length;
      if (isGroup) {
        const open = !closed.has(node.key);
        rows.push({ node, depth, open });
        if (open) walk(node.children!, depth + 1);
        continue;
      }

      if (node.route) rows.push({ node, depth, open: false });
    }
  };

  walk(nodes, 0);
  return rows;
}

/** 找到某个路由的祖先链（用于 breadcrumb 与自动展开）。 */
export function navPathFor(
  nodes: NavNode[],
  route: string,
): NavNode[] {
  const url = route.split('?')[0];
  const walk = (list: NavNode[], trail: NavNode[]): NavNode[] | null => {
    for (const node of list) {
      const next = [...trail, node];
      if (node.route && url.startsWith(node.route)) return next;
      if (node.children?.length) {
        const found = walk(node.children, next);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

/** 当前路由所在的、需要保持展开的分组 key。 */
export function openKeysFor(nodes: NavNode[], route: string): Set<string> {
  return new Set(navPathFor(nodes, route).filter((node) => node.children?.length).map((node) => node.key));
}
