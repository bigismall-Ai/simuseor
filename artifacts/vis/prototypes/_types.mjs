/* ============================================================================
 * VIS 原型页 · 类型层（Type Layer）
 * ----------------------------------------------------------------------------
 * 原型页 = 展示面（render surface），不是手写页面。
 * 这里定义「形状」：一类原型长什么样、由哪几块拼成、每块怎么渲染。
 * 定义层（_defs.mjs）只提供数据；本层负责把数据变成 HTML。
 *
 * 【为什么要分层】
 *   手写展示面 = 样式改了、字段改了、版本号改了，都要人去同步三处，
 *   而且没人知道展示面跟真值脱节了 —— 它照样「看起来正常」。
 *   分层之后：定义是唯一手写处，展示面是生成物，漂移由 check 拦。
 *
 * 【形状清单】
 *   shell        页面壳（head / 侧栏 / 主区 / 版本标签）—— 所有原型页共用
 *   asset-card   资产卡（模型 / 工作流 / 节点同构，用字段区分）
 *   card-grid    一组资产卡
 *   spec-list    ①②③… 规格说明（成对的小标题 + 说明）
 *   diff-columns 差异对照（若干列，每列若干「项 / 值」）
 *   anchor-block 带锚点标题的分区（标题 + 副标题 + 内容 + 图注）
 * ============================================================================ */

/* --------------------------------------------------------------------------
 * 小组件
 * -------------------------------------------------------------------------- */

/** 外部链接的 ↗ 图标（画布右上的原站入口） */
function originSvg(indent) {
  return [
    `${indent}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5H2.5v7h7v-2"/><path d="M6.5 2.5h3v3M9.5 2.5 5 7"/></svg>`,
  ].join('\n');
}

/** 标识块：家族厂牌 / 通用图标 / 纯文字缩写 —— 卡片右上角的 32×32 */
function identMark(mark, indent) {
  if (!mark) return `${indent}<span class="ident-mark"></span>`;
  if (mark.type === 'text') return `${indent}<span class="ident-mark">${mark.text}</span>`;
  if (mark.type === 'svg') return [
    `${indent}<span class="ident-mark">`,
    `${indent}  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">`,
    `${indent}    ${mark.body}`,
    `${indent}  </svg>`,
    `${indent}</span>`,
  ].join('\n');
  if (mark.type === 'logo') return [
    `${indent}<span class="ident-mark">`,
    `${indent}  <img class="logo-light" src="${mark.src}" alt="${mark.alt}">`,
    `${indent}  <img class="logo-dark" src="${mark.darkSrc}" alt="" aria-hidden="true">`,
    `${indent}</span>`,
  ].join('\n');
  return `${indent}<span class="ident-mark"><img src="${mark.src}" alt="${mark.alt}"></span>`;
}

/** 状态槽：白线左侧状态 / 右侧大小 */
function slot(s, indent) {
  const left = s.state
    ? `<span class="${s.state}">${s.text}</span>`
    : `<span>${s.text}</span>`;
  return `${indent}<div class="ac-slot">${left}<span class="ac-rule"></span><span class="ac-size">${s.size}</span></div>`;
}

/* --------------------------------------------------------------------------
 * 形状 1 · asset-card —— 资产卡（模型 / 工作流 / 节点同构）
 * -------------------------------------------------------------------------- */
function assetCard(c, indent = '              ') {
  const I = indent;
  const inner = I + '  ';
  const inner2 = inner + '  ';
  const inner3 = inner2 + '  ';
  const inner4 = inner3 + '  ';
  const L = [];

  const art = [];
  if (c.photo) art.push(`${inner4}<img class="photo" src="${c.photo}" alt="">`);
  art.push(`${inner4}<span class="motif"></span><span class="scrim"></span>`);
  if (c.count) {
    art.push(`${inner4}<div class="ac-count"><strong>${c.count}</strong><span>${c.countLabel || '节点类'}</span></div>`);
  }
  /* 铭牌兜底：没有预览图时用标识 + 名字填满封面区（与模型卡的家族铭牌同一逻辑） */
  if (c.plateMark) {
    art.push(`${inner4}<div class="ac-count is-mark"><strong>${c.plateMark.mark}</strong><span>${c.plateMark.label}</span></div>`);
  }
  const plateCls = ['plate', `f-${c.family}`, `mo-${c.motif}`].concat(c.onShot ? ['on-shot'] : []).join(' ');

  L.push(`${I}<article class="ac${c.onShot ? ' on-shot' : ''}">`);
  L.push(`${inner}<div class="ac-media${c.broken ? ' is-broken' : ''}">`);
  L.push(`${inner2}<div class="ac-plate">`);
  L.push(`${inner3}<div class="cp"><div class="${plateCls}">`);
  L.push(...art);
  L.push(`${inner3}</div></div>`);
  L.push(`${inner2}</div>`);
  if (c.broken) {
    L.push(`${inner2}<div class="ac-broken">`);
    L.push(`${inner3}<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"`);
    L.push(`${inner4} stroke-width="1.4" stroke-linecap="round" aria-hidden="true">`);
    L.push(`${inner4}  <path d="M12 8v5"/><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>`);
    L.push(`${inner4}  <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>`);
    L.push(`${inner3}</svg>`);
    L.push(`${inner3}<span class="ac-broken-title">${c.broken.title}</span>`);
    L.push(`${inner3}<span class="ac-broken-msg">${c.broken.msg}</span>`);
    L.push(`${inner2}</div>`);
  }
  L.push(`${inner}</div>`);

  L.push(`${inner}<div class="ac-head">`);
  L.push(identMark(c.mark, inner2));
  L.push(`${inner2}<span class="ac-ident"><b>${c.brand}</b><span>${c.author}</span></span>`);
  if (c.origin) {
    L.push(`${inner2}<a class="ac-origin" href="../reference/components/index.html">${c.origin}`);
    L.push(originSvg(inner3));
    L.push(`${inner2}</a>`);
  }
  L.push(`${inner}</div>`);

  L.push(`${inner}<div class="ac-body">`);
  L.push(`${inner2}<h3 class="ac-name">${c.name}</h3>`);
  L.push(`${inner2}<p class="ac-meta"><span>${c.meta}</span></p>`);
  L.push(slot(c.slot, inner2));
  /* 标签行：一枚或一组。mono=true 是「标识类」内容（节点类名），
     与分类胶囊（Checkpoint / 人物 / 安装方式）不同调，故另给样式。 */
  const tags = Array.isArray(c.tags) ? c.tags : [{ text: c.tag }];
  L.push(`${inner2}<div class="ac-tags">${tags.map((t) => {
    const cls = ['pill', t.more ? 'is-more' : '', t.mono ? 'is-mono' : ''].filter(Boolean).join(' ');
    const title = t.title ? ` title="${t.title}"` : '';
    return `<span class="${cls}"${title}>${t.text}</span>`;
  }).join('')}</div>`);
  L.push(`${inner2}<div class="ac-foot">`);
  L.push(`${inner3}<button class="ac-kebab" type="button" aria-label="更多操作">⋯</button>`);
  L.push(`${inner3}<button class="primary btn-xs" type="button">${c.cta}</button>`);
  L.push(`${inner2}</div>`);
  L.push(`${inner}</div>`);
  L.push(`${I}</article>`);
  return L.join('\n');
}

/* --------------------------------------------------------------------------
 * 形状 2 · card-grid —— 一组资产卡
 * -------------------------------------------------------------------------- */
function cardGrid(cards, indent = '            ') {
  const L = [`${indent}<div class="ac-grid">`];
  for (const c of cards) {
    L.push('');
    L.push(assetCard(c, indent + '  '));
  }
  L.push(`${indent}</div>`);
  return L.join('\n');
}

/* --------------------------------------------------------------------------
 * 形状 3 · spec-list —— ①②③ 规格说明
 * -------------------------------------------------------------------------- */
function specList(items, indent = '          ') {
  const L = [`${indent}<div class="ac-spec">`];
  for (const [k, v] of items) {
    L.push(`${indent}  <div><b>${k}</b><span>${v}</span></div>`);
  }
  L.push(`${indent}</div>`);
  return L.join('\n');
}

/* --------------------------------------------------------------------------
 * 形状 4 · diff-columns —— 差异对照
 * -------------------------------------------------------------------------- */
function diffColumns(cols, indent = '            ') {
  const L = [`${indent}<div class="ac-diff">`];
  for (const c of cols) {
    L.push(`${indent}  <div>`);
    L.push(`${indent}    <b>${c.title}</b>`);
    L.push(`${indent}    <dl>`);
    for (const [k, v] of c.rows) {
      L.push(`${indent}      <dt>${k}</dt><dd>${v}</dd>`);
    }
    L.push(`${indent}    </dl>`);
    L.push(`${indent}  </div>`);
  }
  L.push(`${indent}</div>`);
  return L.join('\n');
}

/* --------------------------------------------------------------------------
 * 形状 5 · anchor-block —— 带锚点标题的分区
 * -------------------------------------------------------------------------- */
function anchorBlock(sec, indent = '          ') {
  const L = [];
  L.push(`${indent}<div class="proto-anchor" id="${sec.id}">`);
  L.push(`${indent}  <div class="proto-anchor-head"><b>${sec.title}</b><span>${sec.sub}</span></div>`);
  if (sec.cards) {
    L.push(cardGrid(sec.cards, indent + '  '));
  } else if (sec.diff) {
    L.push(diffColumns(sec.diff.columns || sec.diff, indent + '  '));
  }
  if (sec.caption) {
    L.push(`${indent}  <p class="proto-caption">${sec.caption}</p>`);
  }
  L.push(`${indent}</div>`);
  return L.join('\n');
}

/* --------------------------------------------------------------------------
 * 形状 5.5 · page-status —— 列表顶部统一骨架（页头 / 状态条 / 筛选条）
 * -------------------------------------------------------------------------- */

const PS_ICON = {
  funnel: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.6V13l-2.8 1.4V8.6z"/></svg>',
  sort: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.2h10M3 8h7M3 11.8h4"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.4 6.4 3.6 3.4 3.6-3.4"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 7.4a5.3 5.3 0 1 0-.3 2.6"/><path d="M13.3 3.6v3.9H9.4"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.4"/><path d="M10.3 10.3 13.6 13.6"/></svg>',
};

function psCount(s) {
  const head = s.filtered
    ? `<b>${s.filtered.visible}</b><span class="ps-total">/ ${s.filtered.total}</span>`
    : `<b>${s.count}</b>`;
  return `<p class="ps-count">${head}<span class="ps-unit">${s.unit}</span></p>`;
}

function psFacts(facts = []) {
  if (!facts.length) return '';
  const items = facts.map((f) => {
    const tone = f.tone ? ` is-${f.tone}` : '';
    return `<li><span class="ps-fact-label">${f.label}</span>` +
      `<b class="ps-fact-value${tone}">${f.value}</b></li>`;
  }).join('');
  return `<ul class="ps-facts">${items}</ul>`;
}

function psSearch(placeholder) {
  return `<label class="ps-search">${PS_ICON.search}` +
    `<input type="search" placeholder="${placeholder}" aria-label="${placeholder}">` +
    '</label>';
}

function psChips(group) {
  const chips = group.chips.map((c) => {
    const cls = ['ps-chip', c.on ? 'on' : '', c.tone ? `is-${c.tone}` : '']
      .filter(Boolean).join(' ');
    const count = c.count != null ? `<b>${c.count}</b>` : '';
    return `<button type="button" class="${cls}">${c.text}${count}</button>`;
  }).join('');
  const label = group.label ? ` role="group" aria-label="${group.label}"` : '';
  return `<div class="ps-chips"${label}>${chips}</div>`;
}

function psTools(t = {}) {
  const L = ['<div class="ps-tools">'];
  if (t.filter) {
    const badge = t.filterCount != null ? `<b class="ps-badge">${t.filterCount}</b>` : '';
    L.push(`<button class="ps-select" type="button">${PS_ICON.funnel}<span>${t.filter}</span>${badge}</button>`);
  }
  if (t.sort) {
    L.push(`<button class="ps-select" type="button">${PS_ICON.sort}<span>${t.sort}</span>${PS_ICON.caret}</button>`);
  }
  if (t.view) {
    const grid = t.view === 'grid' ? ' class="on"' : '';
    const list = t.view === 'list' ? ' class="on"' : '';
    L.push('<div class="ps-view" role="group" aria-label="视图切换">' +
      `<button type="button"${grid} title="网格视图">▦</button>` +
      `<button type="button"${list} title="列表视图">☰</button>` +
      '</div>');
  }
  L.push('</div>');
  return L.join('');
}

function psBar(s) {
  const filters = s.filters
    ? `<div class="ps-filters">${s.filters.search ? psSearch(s.filters.search) : ''}` +
      `${(s.filters.groups || []).map((g) => psChips(g)).join('')}` +
      `${psTools(s.filters.tools)}</div>`
    : '';
  const progress = s.progress ? `<span class="ps-progress">${s.progress}</span>` : '';
  return `<section class="ps-bar" aria-label="列表状态与筛选">
      <div class="ps-status">
        ${psCount(s)}
        ${psFacts(s.facts)}
        <div class="ps-status-actions">
          ${progress}
          <button class="ps-icon" type="button" aria-label="刷新" title="刷新">${PS_ICON.refresh}</button>
        </div>
      </div>
      ${filters}
    </section>`;
}

function psDemo(sec) {
  const h = sec.header;
  const actions = (h.actions || []).map((a) => {
    const badge = a.badge != null
      ? `<b class="ps-badge${a.tone ? ` is-${a.tone}` : ''}">${a.badge}</b>`
      : '';
    return `<button type="button"${a.primary ? ' class="primary"' : ''}>${a.text}${badge}</button>`;
  }).join('');
  const header = `<header class="ui-page-header">
        <div class="ui-page-heading">
          <p class="ui-page-kicker">${h.kicker}</p>
          <h1>${h.title}</h1>
          ${h.hint ? `<p class="ui-page-hint">${h.hint}</p>` : ''}
        </div>
        ${actions ? `<div class="ui-page-actions">${actions}</div>` : ''}
      </header>`;
  const ghosts = '<span class="ps-ghost"></span>'.repeat(3);
  return `<div class="ps-demo">
      ${header}
      ${psBar(sec.status)}
      <p class="ps-content-cap">内容区 · 沿用资产卡统一骨架（见「资产卡片」原型）</p>
      <div class="ps-content" aria-hidden="true">${ghosts}</div>
    </div>`;
}

function psSection(sec, indent = '          ') {
  return [
    `${indent}<div class="proto-anchor" id="${sec.id}">`,
    `${indent}  <div class="proto-anchor-head"><b>${sec.title}</b><span>${sec.sub}</span></div>`,
    `${indent}  ${psDemo(sec)}`,
    sec.caption ? `${indent}  <p class="proto-caption">${sec.caption}</p>` : '',
    `${indent}</div>`,
  ].filter(Boolean).join('\n');
}

function psMatrix(rows, indent = '          ') {
  const head = '<div class="tbl-wrap"><table class="t"><thead><tr>' +
    '<th>页面</th><th>现在的顶部</th><th>归一后的顶部</th></tr></thead><tbody>';
  const body = rows.map(([page, before, after]) =>
    `<tr><td><b>${page}</b></td><td>${before}</td><td>${after}</td></tr>`).join('');
  return `${indent}${head}${body}</tbody></table></div>`;
}

/* --------------------------------------------------------------------------
 * 形状 0 · shell —— 页面壳（所有原型页共用）
 * -------------------------------------------------------------------------- */
function shell(def, body, ctx) {
  const d = def.data;
  const v = (ctx && ctx.version) || def.version || '(未知版本)';   // 版本真值来自 VIS.md，不手写
  const css = (def.stylesheets || ['../assets/vis.css', '_proto.css']);
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.title}</title>
<meta name="description" content="${d.description}">
${css.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
</head>
<body data-page="${d.page}" data-root="${d.root || '../'}">
<div class="app-shell">
  <aside class="app-side">
    <div class="app-brand">
      <span class="brand-mark"><img src="../assets/cicada/svg/cicada-mid.svg" alt="" /></span>
      <span class="brand-wordmark">SiMuseor<small class="brand-sub">${d.brandSub}</small></span>
    </div>
    <nav class="app-nav" id="app-nav" aria-label="主导航"></nav>
    <div class="app-side-foot">
      <button class="btn-toggle" id="theme-btn" type="button" aria-label="切换明暗主题">切换主题</button>
      <small>VIS ${v} · 2026</small>
    </div>
  </aside>
  <main class="app-main">
    <div class="wrap">
      <div class="proto-view active ref" id="pv-${d.page}">
        <div class="proto-view-head">
          <div>
            <h3>${d.head.title}</h3>
            <p>${d.head.sub}</p>
          </div>
          <div class="proto-btns"><i class="ghost"></i><i></i></div>
        </div>

        <div class="proto-view-body">
${body}
        </div>
      </div>
    </div>
  </main>
</div>
<script src="../assets/shell.js"></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------------------
 * 类型注册表
 * -------------------------------------------------------------------------- */
export const TYPES = {
  /* 资产卡样张页：模型 / 工作流 / 节点共用一套骨架 */
  'asset-cards': {
    render(def, ctx) {
      const d = def.data;
      const L = [];
      L.push(specList(d.spec));
      for (const sec of d.sections) {
        L.push('');
        L.push(anchorBlock(sec));
      }
      return shell(def, L.join('\n'), ctx);
    },
  },

  /* 列表顶部样张页：同一个页头 / 状态条 / 筛选条，六页只换内容 */
  'page-status': {
    render(def, ctx) {
      const d = def.data;
      const L = [];
      L.push(specList(d.spec));
      L.push('');
      L.push('          <div class="proto-anchor" id="ps-before">');
      L.push('            <div class="proto-anchor-head"><b>现在六页的顶部</b><span>同一个位置，六种写法 · 归一后只保留三层</span></div>');
      L.push(psMatrix(d.before));
      L.push('          </div>');
      for (const sec of d.sections) {
        L.push('');
        L.push(psSection(sec));
      }
      if (d.diff) {
        L.push('');
        L.push('          <div class="proto-anchor" id="ps-rules">');
        L.push('            <div class="proto-anchor-head"><b>归一规则</b><span>层级、读数、事实、工具各归各位</span></div>');
        L.push(diffColumns(d.diff.columns));
        L.push('          </div>');
      }
      return shell(def, L.join('\n'), ctx);
    },
  },
};

export { assetCard, cardGrid, specList, diffColumns, anchorBlock, shell, psBar, psSection, psMatrix };
