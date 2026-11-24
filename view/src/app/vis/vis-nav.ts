export interface NavLink {
  label: string;
  route: string;
  icon: string;
}

export interface NavGroup {
  key: string;
  label: string;
  links: NavLink[];
}

export interface NavSection {
  key: string;
  label: string;
  groups?: NavGroup[];
  links: NavLink[];
}

/**
 * VIS 侧栏导航的唯一数据源。
 *
 * 外壳、侧边导航原型页和总览都从这里取分类 / 顺序 / 图标 / 路由，
 * 避免页面之间各写一份导致排序和命名漂移。
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'visual',
    label: '视觉设计',
    links: [],
    groups: [
      {
        key: 'brand',
        label: '品牌',
        links: [
          { label: '标识', route: '/vis/brand', icon: 'brand' },
          { label: '色彩', route: '/vis/color', icon: 'palette' },
          { label: '封面与纹样', route: '/vis/cover', icon: 'image' },
          { label: '背景', route: '/vis/background', icon: 'layers' },
          { label: '图标', route: '/vis/icons', icon: 'library' },
          { label: '布局', route: '/vis/layout', icon: 'panel-left' },
          { label: '圆角', route: '/vis/radius', icon: 'radius' },
        ],
      },
      {
        key: 'components',
        label: '组件',
        links: [
          { label: '按钮', route: '/vis/buttons', icon: 'button' },
          { label: '输入框', route: '/vis/inputs', icon: 'input' },
          { label: '胶囊', route: '/vis/pills', icon: 'pill' },
          { label: '表格', route: '/vis/tables', icon: 'table' },
          { label: '空状态', route: '/vis/empty', icon: 'inbox' },
          { label: '模态框', route: '/vis/modals', icon: 'modal' },
        ],
      },
    ],
  },
  {
    key: 'proto-components',
    label: '原型组件',
    links: [],
    groups: [
      {
        key: 'shell',
        label: '外壳',
        links: [
          { label: '侧边导航', route: '/vis/prototypes/components/sidebar', icon: 'panel-left' },
          { label: '页头', route: '/vis/prototypes/components/page-header', icon: 'menu' },
          { label: '滚动条', route: '/vis/prototypes/components/scrollbar', icon: 'sort' },
        ],
      },
      {
        key: 'content',
        label: '内容',
        links: [
          { label: '卡片', route: '/vis/prototypes/components/card-design', icon: 'card' },
          { label: '资产卡片', route: '/vis/prototypes/components/cards', icon: 'library' },
          { label: '厂牌', route: '/vis/prototypes/components/families', icon: 'brand' },
          { label: '行内提示', route: '/vis/prototypes/components/notice', icon: 'alert' },
          { label: '提示与来源', route: '/vis/prototypes/components/feedback', icon: 'inbox' },
        ],
      },
    ],
  },
  {
    key: 'pages',
    label: '页面',
    links: [
      { label: '模型库', route: '/vis/prototypes/pages/models', icon: 'library' },
      { label: '工作流', route: '/vis/prototypes/pages/workflows', icon: 'workflows' },
      { label: '自定义节点', route: '/vis/prototypes/pages/nodes', icon: 'nodes' },
      { label: '资源管理器', route: '/vis/prototypes/pages/resource-manager', icon: 'resources' },
      { label: '下载', route: '/vis/prototypes/pages/downloads', icon: 'download' },
      { label: '错误与反馈', route: '/vis/prototypes/pages/error-states', icon: 'alert' },
      { label: '设置', route: '/vis/prototypes/pages/settings', icon: 'settings' },
      { label: '源探针', route: '/vis/prototypes/pages/source-probe', icon: 'network' },
    ],
  },
  {
    key: 'tools',
    label: '工具',
    links: [{ label: 'SVG 工作台', route: '/svg', icon: 'pen' }],
  },
];
