(function () {
  var root = document.documentElement;
  var body = document.body;
  var BASE = body.getAttribute('data-root') || './';
  var CURRENT = body.getAttribute('data-page') || '';

  var P = {
    overview: 'vis-reference.html',
    spec: 'SiMuseor-VIS.html',
    brand: 'reference/brand.html',
    families: 'reference/families.html',
    color: 'reference/color.html',
    typography: 'reference/typography.html',
    icons: 'reference/icons.html',
    layout: 'reference/layout.html',
    components: 'reference/components.html',
    cards: 'prototypes/cards.html',
    backgrounds: 'prototypes/backgrounds.html',
    audit: 'reference/audit.html'
  };

  var ICONS = {
    overview: '<rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1"/>',
    book: '<path d="M2.6 3.4h4.1a1.7 1.7 0 0 1 1.7 1.7v7.6a1.4 1.4 0 0 0-1.4-1.4H2.6z"/><path d="M13.4 3.4H9.3a1.7 1.7 0 0 0-1.7 1.7v7.6a1.4 1.4 0 0 1 1.4-1.4h4.4z"/>',
    brand: '<path d="M8 2.2l5.7 3.2v5.2L8 13.8l-5.7-3.2V5.4z"/><circle cx="8" cy="8" r="1.6"/>',
    family: '<path d="M2.8 3.5h5.8l5.6 5.6-4.7 4.7-5.6-5.6z"/><circle cx="6.2" cy="6.9" r="1"/>',
    color: '<path d="M8 2.4a5.6 5.6 0 1 0 0 11.2c1.4 0 2-.9 1.4-2-.5-1 .1-2 1.3-2h1.1c.8 0 1.4-.6 1.4-1.4A5.8 5.8 0 0 0 8 2.4z"/><circle cx="5.5" cy="6" r=".7"/><circle cx="8" cy="4.7" r=".7"/><circle cx="10.5" cy="6" r=".7"/>',
    typography: '<path d="M3 4.2V3h10v1.2M8 3v10M6 13h4"/>',
    icons: '<path d="M8 2.2l1.8 4.1 4.4.4-3.3 2.9 1 4.3L8 11.6l-3.9 2.3 1-4.3-3.3-2.9 4.4-.4z"/>',
    layout: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6.2h11M6.2 6.2v7.3"/>',
    components: '<rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1"/><rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1"/><rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1"/>',
    prototype: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11M5.5 6v7"/>',
    audit: '<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
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

  var NAV = [
    { type: 'link', page: 'overview', label: '总览', icon: 'overview' },
    { type: 'link', page: 'spec', label: '完整规范', icon: 'book' },
    { type: 'link', page: 'brand', label: '标识', icon: 'brand' },
    { type: 'link', page: 'families', label: '厂牌', icon: 'family' },
    { type: 'link', page: 'color', label: '色彩', icon: 'color' },
    { type: 'link', page: 'typography', label: '排版', icon: 'typography' },
    { type: 'link', page: 'icons', label: '图标', icon: 'icons' },
    { type: 'link', page: 'layout', label: '布局', icon: 'layout' },
    { type: 'link', page: 'components', label: '组件', icon: 'components' },
    { type: 'link', page: 'cards', label: '资产卡片', icon: 'prototype' },
    { type: 'link', page: 'backgrounds', label: '背景实验', icon: 'prototype' },
    { type: 'link', page: 'audit', label: '审计', icon: 'audit' }
  ];

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

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-group';
      btn.setAttribute('data-group', item.key);
      btn.title = item.label;
      btn.setAttribute('aria-label', item.label);
      btn.innerHTML = '<span class="nav-lead">' + icon(item.icon) + '<span class="label">' + item.label + '</span></span><span class="chev">›</span>';
      if (item.keys && item.keys.indexOf(CURRENT) !== -1) {
        currentGroup = item.key;
        btn.className += ' has-current';
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

      nav.appendChild(btn);
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

    nav.querySelectorAll('.nav-group').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-group');
        var shell = document.querySelector('.app-shell');
        if (shell && shell.classList.contains('side-collapsed')) {
          setCollapsed(false);
          open.add(key);
          syncGroups();
          return;
        }
        if (open.has(key)) open.delete(key); else open.add(key);
        syncGroups();
      });
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
