(function () {
  var root = document.documentElement;
  var body = document.body;
  var BASE = body.getAttribute('data-root') || './';
  var CURRENT = body.getAttribute('data-page') || '';

  /* P 映射与 NAV 在下方「BEGIN nav-data」块内，由 vis-manual.mjs build 生成 —— 别手改 */

  var ICONS = {
    overview: '<rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1"/>',
    brand: '<path d="M8 2.2l5.7 3.2v5.2L8 13.8l-5.7-3.2V5.4z"/><circle cx="8" cy="8" r="1.6"/>',
    family: '<path d="M2.8 3.5h5.8l5.6 5.6-4.7 4.7-5.6-5.6z"/><circle cx="6.2" cy="6.9" r="1"/>',
    color: '<path d="M8 2.4a5.6 5.6 0 1 0 0 11.2c1.4 0 2-.9 1.4-2-.5-1 .1-2 1.3-2h1.1c.8 0 1.4-.6 1.4-1.4A5.8 5.8 0 0 0 8 2.4z"/><circle cx="5.5" cy="6" r=".7"/><circle cx="8" cy="4.7" r=".7"/><circle cx="10.5" cy="6" r=".7"/>',
    typography: '<path d="M3 4.2V3h10v1.2M8 3v10M6 13h4"/>',
    icons: '<path d="M8 2.2l1.8 4.1 4.4.4-3.3 2.9 1 4.3L8 11.6l-3.9 2.3 1-4.3-3.3-2.9 4.4-.4z"/>',
    layout: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6.2h11M6.2 6.2v7.3"/>',
    components: '<rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1"/>',
    prototype: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11M5.5 6v7"/>',
    audit: '<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
    app: '<rect x="2.5" y="3" width="11" height="4" rx="1.2"/><rect x="2.5" y="9" width="11" height="4" rx="1.2"/>',
    check: '<circle cx="8" cy="8" r="5.2"/><path d="M5.6 8.2l1.7 1.7 3.2-3.4"/>',
    gavel: '<path d="M2.6 13.4l6-6"/><path d="M6.6 3.6l3.8 3.8"/><path d="M9 6l2 2"/><path d="M4.4 11.6l-1.2 1.2"/>',
    workflow: '<circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="4" cy="12" r="1.6"/><path d="M5.4 4.8l5.2 2.4M5.4 11.2l5.2-2.4"/>',
    models: '<path d="M8 2.4l5 2.6v5.4l-5 2.6-5-2.6V5z"/><path d="M3 5l5 2.6L13 5M8 7.6v5.4"/>',
    nodes: '<circle cx="8" cy="8" r="2.2"/><circle cx="3" cy="3" r="1.2"/><circle cx="13" cy="3" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="13" cy="13" r="1.2"/><path d="M4 4l2.2 2.2M12 4L9.8 6.2M4 12l2.2-2.2M12 12L9.8 9.8"/>',
    discover: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>',
    downloads: '<path d="M8 2.5v7M5 7l3 3 3-3M3 12.5h10"/>',
    settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>'
  };

  function icon(name) {
    return '<svg class="nav-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* 两级导航：一级 = 章（章头可点击进章 / 箭头展开），二级 = 章内的节（锚点直链）。
     「整份读」就是这么来的 —— 顺着章 -> 节读下来，不需要另一个单文件版。
     二级项的 hash 必须与页面里真实的锚点一致，由 vis-check.mjs [3.7] 核对。 */
  /* BEGIN nav-data */
  var P = {
    overview: 'vis-reference.html',
    'cards': 'prototypes/cards.html',
    'page-status': 'prototypes/page-status.html',
    'brand': 'reference/brand/index.html',
    'brand/s-51': 'reference/brand/s-51.html',
    'brand/s-52': 'reference/brand/s-52.html',
    'brand/s-53': 'reference/brand/s-53.html',
    'brand/s-54': 'reference/brand/s-54.html',
    'brand/s-55': 'reference/brand/s-55.html',
    'families': 'reference/families/index.html',
    'families/s-fam-default': 'reference/families/s-fam-default.html',
    'families/s-fam-official': 'reference/families/s-fam-official.html',
    'families/s-fam-redraw': 'reference/families/s-fam-redraw.html',
    'color': 'reference/color/index.html',
    'color/s-11': 'reference/color/s-11.html',
    'color/s-12': 'reference/color/s-12.html',
    'color/s-13': 'reference/color/s-13.html',
    'color/s-14': 'reference/color/s-14.html',
    'color/s-15': 'reference/color/s-15.html',
    'color/s-16': 'reference/color/s-16.html',
    'color/s-17': 'reference/color/s-17.html',
    'color/s-18': 'reference/color/s-18.html',
    'color/s-19': 'reference/color/s-19.html',
    'typography': 'reference/typography/index.html',
    'typography/s-21': 'reference/typography/s-21.html',
    'typography/s-22': 'reference/typography/s-22.html',
    'typography/s-23': 'reference/typography/s-23.html',
    'typography/s-24': 'reference/typography/s-24.html',
    'icons': 'reference/icons/index.html',
    'icons/s-icon-grid': 'reference/icons/s-icon-grid.html',
    'icons/s-icon-size': 'reference/icons/s-icon-size.html',
    'layout': 'reference/layout/index.html',
    'layout/s-41': 'reference/layout/s-41.html',
    'layout/s-42': 'reference/layout/s-42.html',
    'layout/s-43': 'reference/layout/s-43.html',
    'layout/s-44': 'reference/layout/s-44.html',
    'layout/s-45': 'reference/layout/s-45.html',
    'layout/s-46': 'reference/layout/s-46.html',
    'components': 'reference/components/index.html',
    'components/s-31': 'reference/components/s-31.html',
    'components/s-310': 'reference/components/s-310.html',
    'components/s-311': 'reference/components/s-311.html',
    'components/s-312': 'reference/components/s-312.html',
    'components/s-32': 'reference/components/s-32.html',
    'components/s-33': 'reference/components/s-33.html',
    'components/s-34': 'reference/components/s-34.html',
    'components/s-35': 'reference/components/s-35.html',
    'components/s-36': 'reference/components/s-36.html',
    'components/s-37': 'reference/components/s-37.html',
    'components/s-38': 'reference/components/s-38.html',
    'components/s-39': 'reference/components/s-39.html',
    'application': 'reference/application/index.html',
    'application/s-71': 'reference/application/s-71.html',
    'application/s-72': 'reference/application/s-72.html',
    'application/s-73': 'reference/application/s-73.html',
    'application/s-74': 'reference/application/s-74.html',
    'application/s-75': 'reference/application/s-75.html',
    'application/s-76': 'reference/application/s-76.html',
    'engineering': 'reference/engineering/index.html',
    'engineering/s-81': 'reference/engineering/s-81.html',
    'engineering/s-82': 'reference/engineering/s-82.html',
    'engineering/s-83': 'reference/engineering/s-83.html',
    'engineering/s-84': 'reference/engineering/s-84.html',
    'acceptance': 'reference/acceptance/index.html',
    'acceptance/s-91': 'reference/acceptance/s-91.html',
    'acceptance/s-92': 'reference/acceptance/s-92.html',
    'decisions': 'reference/decisions/index.html',
    'decisions/s-101': 'reference/decisions/s-101.html',
    'decisions/s-a1': 'reference/decisions/s-a1.html',
    'decisions/s-b1': 'reference/decisions/s-b1.html',
    'decisions/s-c1': 'reference/decisions/s-c1.html',
    'audit': 'reference/audit/index.html',
    'audit/s-61': 'reference/audit/s-61.html',
  };

  var NAV = [
    { type: 'link', page: 'overview', label: '总览', icon: 'overview' },
    { type: 'link', page: 'cards', label: "资产卡片原型", icon: 'prototype' },
    { type: 'link', page: 'page-status', label: "页面状态原型", icon: 'prototype' },
    {
      type: 'group', key: 'brand', page: 'brand', label: "标识", icon: 'brand', keys: ['brand'],
      items: [
        { page: 'brand/s-51', label: "组合标" },
        { page: 'brand/s-52', label: "纸墨" },
        { page: 'brand/s-53', label: "蝉形" },
        { page: 'brand/s-54', label: "图标档" },
        { page: 'brand/s-55', label: "禁用" },
      ],
    },
    {
      type: 'group', key: 'families', page: 'families', label: "厂牌", icon: 'family', keys: ['families'],
      items: [
        { page: 'families/s-fam-default', label: "默认标" },
        { page: 'families/s-fam-official', label: "官方标" },
        { page: 'families/s-fam-redraw', label: "重绘" },
      ],
    },
    {
      type: 'group', key: 'color', page: 'color', label: "色彩", icon: 'color', keys: ['color'],
      items: [
        { page: 'color/s-11', label: "原始层" },
        { page: 'color/s-12', label: "语义层" },
        { page: 'color/s-13', label: "组件层" },
        { page: 'color/s-14', label: "纸墨层" },
        { page: 'color/s-15', label: "对比度" },
        { page: 'color/s-16', label: "色域" },
        { page: 'color/s-17', label: "约束表" },
        { page: 'color/s-18', label: "国际锚点" },
        { page: 'color/s-19', label: "渐变层" },
      ],
    },
    {
      type: 'group', key: 'typography', page: 'typography', label: "排版", icon: 'typography', keys: ['typography'],
      items: [
        { page: 'typography/s-21', label: "字体" },
        { page: 'typography/s-22', label: "字号" },
        { page: 'typography/s-23', label: "字重" },
        { page: 'typography/s-24', label: "字距" },
      ],
    },
    {
      type: 'group', key: 'icons', page: 'icons', label: "图标", icon: 'icons', keys: ['icons'],
      items: [
        { page: 'icons/s-icon-grid', label: "图标集" },
        { page: 'icons/s-icon-size', label: "尺寸" },
      ],
    },
    {
      type: 'group', key: 'layout', page: 'layout', label: "布局", icon: 'layout', keys: ['layout'],
      items: [
        { page: 'layout/s-41', label: "圆角" },
        { page: 'layout/s-42', label: "间距" },
        { page: 'layout/s-43', label: "阴影" },
        { page: 'layout/s-44', label: "栅格" },
        { page: 'layout/s-45', label: "色板" },
        { page: 'layout/s-46', label: "卡片" },
      ],
    },
    {
      type: 'group', key: 'components', page: 'components', label: "组件", icon: 'components', keys: ['components'],
      items: [
        { page: 'components/s-31', label: "按钮" },
        { page: 'components/s-310', label: "表格" },
        { page: 'components/s-311', label: "导航" },
        { page: 'components/s-312', label: "弹层" },
        { page: 'components/s-32', label: "输入框" },
        { page: 'components/s-33', label: "胶囊" },
        { page: 'components/s-34', label: "徽章" },
        { page: 'components/s-35', label: "面板" },
        { page: 'components/s-36', label: "页头" },
        { page: 'components/s-37', label: "卡片" },
        { page: 'components/s-38', label: "模型卡" },
        { page: 'components/s-39', label: "空状态" },
      ],
    },
    {
      type: 'group', key: 'application', page: 'application', label: "应用系统", icon: 'app', keys: ['application'],
      items: [
        { page: 'application/s-71', label: "品牌落位" },
        { page: 'application/s-72', label: "状态机" },
        { page: 'application/s-73', label: "无障碍" },
        { page: 'application/s-74', label: "响应式" },
        { page: 'application/s-75', label: "文案" },
        { page: 'application/s-76', label: "E2E清单" },
      ],
    },
    {
      type: 'group', key: 'engineering', page: 'engineering', label: "工程落地", icon: 'settings', keys: ['engineering'],
      items: [
        { page: 'engineering/s-81', label: "token层" },
        { page: 'engineering/s-82', label: "实跑报告" },
        { page: 'engineering/s-83', label: "迁移" },
        { page: 'engineering/s-84', label: "交付物" },
      ],
    },
    {
      type: 'group', key: 'acceptance', page: 'acceptance', label: "验收与治理", icon: 'check', keys: ['acceptance'],
      items: [
        { page: 'acceptance/s-91', label: "验收清单" },
        { page: 'acceptance/s-92', label: "冻结同步" },
      ],
    },
    {
      type: 'group', key: 'decisions', page: 'decisions', label: "裁决与附录", icon: 'gavel', keys: ['decisions'],
      items: [
        { page: 'decisions/s-101', label: "裁决记录" },
        { page: 'decisions/s-a1', label: "迭代档案" },
        { page: 'decisions/s-b1', label: "三条教训" },
        { page: 'decisions/s-c1', label: "版本记录" },
      ],
    },
    {
      type: 'group', key: 'audit', page: 'audit', label: "审计", icon: 'audit', keys: ['audit'],
      items: [
        { page: 'audit/s-61', label: "口径声明" },
      ],
    }
  ];
  /* END nav-data */

  function href(page, hash) {
    return BASE + P[page] + (hash ? '#' + hash : '');
  }

  // 主题先应用，避免导航渲染时闪一下
  var KEY = 'md-vis-ref-theme';
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { stored = null; }
  var initial = stored === 'light' || stored === 'dark'
    ? stored
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  var themeBtn = document.getElementById('theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* 隐私模式下忽略 */ }
    });
  }

  // 生成统一导航
  var nav = document.getElementById('app-nav');
  var currentGroup = '';
  if (nav) {
    NAV.forEach(function (item) {
      if (item.type === 'link') {
        var a = document.createElement('a');
        a.href = href(item.page);
        a.title = item.label;
        if (item.page === CURRENT) a.className = 'on';
        a.innerHTML = icon(item.icon) + '<span class="label">' + item.label + '</span>';
        nav.appendChild(a);
        return;
      }

      var head = document.createElement('div');
      head.className = 'nav-group';
      head.setAttribute('data-group', item.key);
      head.setAttribute('aria-expanded', 'false');
      /* 章头：点文字进章，点箭头展开 */
      var lead = document.createElement('a');
      lead.className = 'nav-lead';
      lead.href = href(item.page);
      lead.title = item.label;
      if (item.page === CURRENT) lead.className += ' on';
      lead.innerHTML = icon(item.icon) + '<span class="label">' + item.label + '</span>';
      var chev = document.createElement('button');
      chev.type = 'button';
      chev.className = 'chev-btn';
      chev.setAttribute('aria-label', '展开或收起 ' + item.label);
      chev.innerHTML = '<span class="chev">›</span>';
      head.appendChild(lead);
      head.appendChild(chev);
      if (item.keys && item.keys.some(function (k) {
        return CURRENT === k || CURRENT.indexOf(k + '/') === 0;
      })) {
        currentGroup = item.key;
        head.className += ' has-current';
      }

      var box = document.createElement('div');
      box.className = 'nav-items';
      box.setAttribute('data-group', item.key);
      item.items.forEach(function (it) {
        var link = document.createElement('a');
        link.href = href(it.page, it.hash);
        link.title = it.label;
        if (it.sub) link.className = 'sub';
        if (it.page === CURRENT && !it.hash) link.className += ' on';
        link.innerHTML = icon(it.icon) + '<span class="label">' + it.label + '</span>';
        box.appendChild(link);
      });

      nav.appendChild(head);
      nav.appendChild(box);
    });

    var open = new Set();
    try {
      var saved = JSON.parse(localStorage.getItem('md-vis-nav-open') || 'null');
      if (saved) open = new Set(saved);
    } catch (e) { /* 忽略损坏状态 */ }
    if (currentGroup) open.add(currentGroup);

    function syncGroups() {
      nav.querySelectorAll('.nav-group').forEach(function (btn) {
        var key = btn.getAttribute('data-group');
        var box = nav.querySelector('.nav-items[data-group="' + key + '"]');
        var isOpen = open.has(key);
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (box) box.hidden = !isOpen;
      });
      try { localStorage.setItem('md-vis-nav-open', JSON.stringify(Array.from(open))); } catch (e) { /* 忽略 */ }
    }

    nav.querySelectorAll('.nav-group').forEach(function (head) {
      var key = head.getAttribute('data-group');
      var chev = head.querySelector('.chev-btn');
      var lead = head.querySelector('.nav-lead');
      function toggle() {
        var shell = document.querySelector('.app-shell');
        if (shell && shell.classList.contains('side-collapsed')) {
          setCollapsed(false);
          open.add(key);
          syncGroups();
          return;
        }
        if (open.has(key)) open.delete(key); else open.add(key);
        syncGroups();
      }
      if (chev) {
        chev.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        });
      }
      /* 侧栏收起时章头图标变成「展开」入口（收起态点图标不跳章，直接展开） */
      if (lead) {
        lead.addEventListener('click', function (e) {
          var shell = document.querySelector('.app-shell');
          if (shell && shell.classList.contains('side-collapsed')) {
            e.preventDefault();
            toggle();
          }
        });
      }
    });

    syncGroups();
  }

  // 侧栏收起 / 展开
  var shell = document.querySelector('.app-shell');
  var side = document.querySelector('.app-side');
  var brand = document.querySelector('.app-brand');
  var toggle = null;

  function setCollapsed(value, silent) {
    if (!shell || !side || !toggle) return;
    shell.classList.toggle('side-collapsed', value);
    side.classList.toggle('collapsed', value);
    toggle.textContent = value ? '»' : '«';
    toggle.setAttribute('aria-label', value ? '展开导航' : '收起导航');
    toggle.title = value ? '展开导航' : '收起导航';
    if (!silent) {
      try { localStorage.setItem('md-vis-side-collapsed', value ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }
  }

  if (shell && side && brand) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'side-toggle';
    toggle.id = 'side-toggle';
    brand.appendChild(toggle);

    var compact = window.matchMedia && window.matchMedia('(max-width: 900px)');
    var collapsed = false;
    try { collapsed = localStorage.getItem('md-vis-side-collapsed') === '1'; } catch (e) { /* 忽略 */ }
    if (compact && compact.matches) collapsed = false;
    setCollapsed(collapsed, true);
    toggle.addEventListener('click', function () {
      setCollapsed(!shell.classList.contains('side-collapsed'));
    });
    if (compact && compact.addEventListener) {
      compact.addEventListener('change', function (e) {
        if (e.matches) setCollapsed(false, true);
      });
    }
  }

  // 外链样式加载完成后再按 hash 定位一次
  window.addEventListener('load', function () {
    var id = (location.hash || '').replace('#', '');
    if (!id) return;
    var el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start' });
  });
})();
