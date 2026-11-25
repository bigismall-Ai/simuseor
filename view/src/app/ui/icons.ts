/**
 * 项目自有图标集：24 × 24 网格、1.6px 描边、圆头圆角、currentColor。
 * 只在这里维护；页面通过 MatIconRegistry 以 `app:<name>` 使用。
 */
export interface AppIcon {
  name: string;
  label: string;
  svg: string;
}

export interface AppIconGroup {
  title: string;
  icons: AppIcon[];
}

const s = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const dot = (cx: number, cy: number, r = 1.6): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICON_GROUPS: AppIconGroup[] = [
  {
    title: '导航与结构',
    icons: [
      {
        name: 'home',
        label: '总览',
        svg: s('<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>'),
      },
      {
        name: 'resources',
        label: '资源',
        svg: s('<path d="M3.5 6.5h5l1.8 2.2h10.2V19H3.5z"/>'),
      },
      {
        name: 'download',
        label: '下载',
        svg: s('<path d="M12 4v10"/><path d="M8 10.5 12 14.5 16 10.5"/><path d="M5 19h14"/>'),
      },
      {
        name: 'library',
        label: '模型库',
        svg: s('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>'),
      },
      {
        name: 'workflows',
        label: '工作流',
        svg: s('<rect x="3.5" y="4" width="6" height="5" rx="1.2"/><rect x="14.5" y="15" width="6" height="5" rx="1.2"/><path d="M9.5 6.5h4a3 3 0 0 1 3 3V15"/><path d="M14.5 12.5 16.5 15 18.5 12.5"/>'),
      },
      {
        name: 'nodes',
        label: '节点',
        svg: s('<path d="M12 3.5 19 7.5v9L12 20.5 5 16.5v-9z"/><circle cx="12" cy="12" r="2.3"/>'),
      },
      {
        name: 'settings',
        label: '设置',
        svg: s('<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>'),
      },
      {
        name: 'panel-left',
        label: '收起侧栏',
        svg: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 4.5v15"/>'),
      },
      {
        name: 'panel-right',
        label: '展开侧栏',
        svg: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15 4.5v15"/>'),
      },
    ],
  },
  {
    title: '界面',
    icons: [
      {
        name: 'brand',
        label: '标识',
        svg: s('<path d="M12 3.5 19.5 12 12 20.5 4.5 12z"/><path d="M12 8.5 15.5 12 12 15.5 8.5 12z"/>'),
      },
      {
        name: 'palette',
        label: '色彩',
        svg: s('<circle cx="9" cy="9" r="3.5"/><circle cx="15" cy="9" r="3.5"/><circle cx="12" cy="15" r="3.5"/>'),
      },
      {
        name: 'layers',
        label: '背景',
        svg: s('<path d="M12 3.5 20 8l-8 4.5L4 8z"/><path d="M4 12l8 4.5 8-4.5"/><path d="M4 16l8 4.5 8-4.5"/>'),
      },
      {
        name: 'button',
        label: '按钮',
        svg: s('<rect x="3.5" y="8" width="17" height="8" rx="4"/><path d="M8 12h4"/>'),
      },
      {
        name: 'input',
        label: '输入框',
        svg: s('<rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M7 10v4"/>'),
      },
      {
        name: 'pill',
        label: '胶囊',
        svg: s('<rect x="3.5" y="8" width="17" height="8" rx="4"/><path d="M12 8v8"/>'),
      },
      {
        name: 'radius',
        label: '圆角',
        svg: s('<path d="M4 20V9a5 5 0 0 1 5-5h11"/><path d="M4 16v4h4"/>'),
      },
      {
        name: 'type',
        label: '字体与排版',
        svg: s('<path d="M5 5.5h14"/><path d="M12 5.5V19"/><path d="M9 19h6"/>'),
      },
      {
        name: 'spacing',
        label: '间距',
        svg: s('<rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2"/>'),
      },
      {
        name: 'elevation',
        label: '层级与阴影',
        svg: s('<rect x="5" y="13.5" width="14" height="6" rx="1.5"/><path d="M7 10h10"/><path d="M9 6.5h6"/>'),
      },
      {
        name: 'motion',
        label: '动效',
        svg: s('<circle cx="12" cy="12" r="7.5"/><path d="M10.5 9l5 3-5 3z"/>'),
      },
      {
        name: 'tokens',
        label: '主题 Token',
        svg: s('<rect x="4" y="6" width="9" height="12" rx="1.5"/><rect x="11" y="9.5" width="9" height="9" rx="1.5"/>'),
      },
      {
        name: 'inbox',
        label: '空状态',
        svg: s('<path d="M4 13.5 6.5 5h11L20 13.5V19H4z"/><path d="M4 13.5h5l1 2h4l1-2h5"/>'),
      },
      {
        name: 'table',
        label: '表格',
        svg: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M15 9.5v10"/>'),
      },
      {
        name: 'modal',
        label: '模态框',
        svg: s('<rect x="5.5" y="6.5" width="13" height="11" rx="2"/><path d="M5.5 10h13"/><path d="M8 20h8"/>'),
      },
      {
        name: 'card',
        label: '卡片',
        svg: s('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 10h17"/>'),
      },
      {
        name: 'pen',
        label: 'SVG 工作台',
        svg: s('<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M13.5 6.5l3 3"/>'),
      },
    ],
  },
  {
    title: '操作',
    icons: [
      {
        name: 'search',
        label: '搜索',
        svg: s('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>'),
      },
      { name: 'plus', label: '新增', svg: s('<path d="M12 5v14M5 12h14"/>') },
      { name: 'minus', label: '移除', svg: s('<path d="M5 12h14"/>') },
      { name: 'check', label: '确认', svg: s('<path d="M5 12.5l4.2 4.2L19 7"/>') },
      { name: 'close', label: '关闭', svg: s('<path d="M6 6l12 12M18 6L6 18"/>') },
      {
        name: 'refresh',
        label: '刷新',
        svg: s('<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 9a8 8 0 0 0-14.3-3"/><path d="M4 15a8 8 0 0 0 14.3 3"/>'),
      },
      {
        name: 'trash',
        label: '删除',
        svg: s('<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12.5h9.4L17.5 7"/><path d="M10 11v5.5M14 11v5.5"/>'),
      },
      {
        name: 'copy',
        label: '复制',
        svg: s('<rect x="8.5" y="8.5" width="10" height="10" rx="2"/><path d="M6 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v1"/>'),
      },
      {
        name: 'external',
        label: '外部打开',
        svg: s('<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v5.5H4.5V6H10"/>'),
      },
      {
        name: 'filter',
        label: '筛选',
        svg: s('<path d="M3.5 5.5h17l-6.5 7.2V20l-4-2v-5.3z"/>'),
      },
      {
        name: 'sort',
        label: '排序',
        svg: s('<path d="M8 4v16"/><path d="M5 17l3 3 3-3"/><path d="M16 20V4"/><path d="M13 7l3-3 3 3"/>'),
      },
      { name: 'more', label: '更多', svg: s(dot(5, 12) + dot(12, 12) + dot(19, 12)) },
      {
        name: 'more-vertical',
        label: '更多（纵向）',
        svg: s(dot(12, 5) + dot(12, 12) + dot(12, 19)),
      },
      { name: 'play', label: '运行', svg: s('<path d="M8 5.5v13l11-6.5z"/>') },
      { name: 'pause', label: '暂停', svg: s('<path d="M9 5.5v13M15 5.5v13"/>') },
      {
        name: 'stop',
        label: '停止',
        svg: s('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
      },
      {
        name: 'chevron-down',
        label: '展开',
        svg: s('<path d="M6 9.5l6 6 6-6"/>'),
      },
      {
        name: 'chevron-up',
        label: '收起',
        svg: s('<path d="M6 14.5l6-6 6 6"/>'),
      },
      {
        name: 'chevron-left',
        label: '上一页',
        svg: s('<path d="M14.5 6l-6 6 6 6"/>'),
      },
      {
        name: 'chevron-right',
        label: '下一页',
        svg: s('<path d="M9.5 6l6 6-6 6"/>'),
      },
      {
        name: 'arrow-up-right',
        label: '跳转',
        svg: s('<path d="M7 17 17 7"/><path d="M9 7h8v8"/>'),
      },
      {
        name: 'eye',
        label: '显示',
        svg: s('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>'),
      },
      {
        name: 'eye-off',
        label: '隐藏',
        svg: s('<path d="M4 4l16 16"/><path d="M9.9 6.5A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.4 3.1"/><path d="M6.4 8.3A15 15 0 0 0 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 4-.8"/><path d="M10.4 10.4a2.2 2.2 0 0 0 3.2 3.2"/>'),
      },
    ],
  },
  {
    title: '状态',
    icons: [
      {
        name: 'check-circle',
        label: '成功',
        svg: s('<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>'),
      },
      {
        name: 'alert',
        label: '警告',
        svg: s('<path d="M12 4 20.5 19h-17z"/><path d="M12 10v4"/>' + dot(12, 16.6, 0.9)),
      },
      {
        name: 'error',
        label: '错误',
        svg: s('<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>'),
      },
      {
        name: 'info',
        label: '信息',
        svg: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/>' + dot(12, 8, 0.9)),
      },
      {
        name: 'clock',
        label: '等待',
        svg: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
      },
    ],
  },
  {
    title: '对象',
    icons: [
      {
        name: 'file',
        label: '文件',
        svg: s('<path d="M7 3.5h6l4.5 4.5V20.5H7z"/><path d="M13 3.5V8h4.5"/>'),
      },
      {
        name: 'folder-open',
        label: '目录',
        svg: s('<path d="M3.5 8.5V6.5h5l1.8 2.2h10.2v2"/><path d="M3.5 8.5h17l-2 12h-15z"/>'),
      },
      {
        name: 'model',
        label: '模型',
        svg: s('<path d="M12 3.5 19.5 7.7v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M12 12l7.5-4.3"/><path d="M12 12v8.5"/><path d="M12 12 4.5 7.7"/>'),
      },
      {
        name: 'image',
        label: '图片',
        svg: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.4"/><path d="M4.5 17l5-5 3.5 3.5 2.5-2.5 4 4"/>'),
      },
      {
        name: 'link',
        label: '链接',
        svg: s('<path d="M10 13.5a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0L5 13.8a4 4 0 0 0 5.7 5.7l1.8-1.8"/>'),
      },
      {
        name: 'database',
        label: '数据库',
        svg: s('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
      },
      {
        name: 'tag',
        label: '标签',
        svg: s('<path d="M12.5 3.5h8v8L11 21 3 13z"/><circle cx="16.5" cy="7.5" r="1.1"/>'),
      },
      {
        name: 'star',
        label: '收藏',
        svg: s('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
      },
      {
        name: 'heart',
        label: '喜欢',
        svg: s('<path d="M12 20.5s-8-4.8-8-10a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 5.2-8 10-8 10z"/>'),
      },
      {
        name: 'lock',
        label: '锁定',
        svg: s('<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
      },
      {
        name: 'unlock',
        label: '解锁',
        svg: s('<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>'),
      },
    ],
  },
  {
    title: '环境',
    icons: [
      {
        name: 'sun',
        label: '浅色',
        svg: s('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/>'),
      },
      {
        name: 'moon',
        label: '深色',
        svg: s('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>'),
      },
      {
        name: 'monitor',
        label: '实例',
        svg: s('<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M9 20h6M12 15.5V20"/>'),
      },
      {
        name: 'terminal',
        label: '终端',
        svg: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>'),
      },
      {
        name: 'cpu',
        label: '算力',
        svg: s('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3.5v3M15 3.5v3M9 17.5v3M15 17.5v3M3.5 9h3M3.5 15h3M17.5 9h3M17.5 15h3"/>'),
      },
      {
        name: 'disk',
        label: '磁盘',
        svg: s('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M8 7.5h.01M16 16.5h.01"/>'),
      },
      {
        name: 'network',
        label: '网络',
        svg: s('<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M10.5 12.5 6.5 17M13.5 12.5l4 4.5"/>'),
      },
      { name: 'menu', label: '菜单', svg: s('<path d="M4 7h16M4 12h16M4 17h16"/>') },
    ],
  },
];

export const APP_ICONS: AppIcon[] = ICON_GROUPS.flatMap((group) => group.icons);
