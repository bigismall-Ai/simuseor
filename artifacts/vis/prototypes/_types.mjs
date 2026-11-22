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
    const cls = ['ps-chip', c.on ? 'on' : '', c.tone ? `is-${c.tone}` : '', c.off ? 'is-off' : '']
      .filter(Boolean).join(' ');
    const count = c.count != null ? `<b>${c.count}</b>` : '';
    /* 不可用的站：灰置、不可点 —— 渲染成 span（不是 button，天生不可点）。
       原因不印在页面上：放 data-tip（hover 气泡）与 aria-label（读屏可读）。 */
    if (c.off) {
      const aria = c.aria ? ` aria-label="${c.aria}"` : '';
      const tip = c.tip ? ` data-tip="${c.tip}"` : '';
      return `<span class="${cls}" aria-disabled="true"${aria}${tip}>${c.text}${count}</span>`;
    }
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
 * 形状 6 · page-header —— 统一页头（已定稿）
 * --------------------------------------------------------------------------
 * 一套排布（分层页头）：三组页面 × 本地库 / 发现 = 6 个页头实例。
 * 六页共用同一批文案与按钮，实例之间只换内容，不换排布 ——
 * 所以横向看的时候，差别只可能来自内容本身。
 * -------------------------------------------------------------------------- */

/** 视图切换控件：segmented（产品既有 .segmented）—— 全站只有这一种切视图的控件 */
function phSwitch(seg) {
  const items = seg.items.map((it) =>
    `<button type="button"${it.on ? ' class="active"' : ''} aria-pressed="${it.on ? 'true' : 'false'}">${it.text}</button>`
  ).join('');
  return `<div class="segmented" role="group" aria-label="${seg.label}">${items}</div>`;
}

/** 主操作区：至多一个主按钮 + 一个次要按钮；无动作则整区留空（不留占位） */
function phActions(actions) {
  if (!actions || !actions.length) return '';
  const btns = actions.map((a) => {
    const badge = a.badge ? `<b class="ph-badge is-warn">${a.badge}</b>` : '';
    const cls = a.primary ? ' class="primary"' : '';
    return `<button type="button"${cls}>${a.text}${badge}</button>`;
  }).join('');
  return `<div class="ui-page-actions">${btns}</div>`;
}

/** 视图切换的两项：本地库 / 发现（当前页在哪个，哪个就选中） */
function phSegOf(c) {
  const onLocal = c.view === '本地库';
  return {
    label: '视图切换',
    items: [
      { text: '本地库', on: onLocal },
      { text: '发现', on: !onLocal },
    ],
  };
}

/** 一个页头实例（分层页头 —— 定稿）：kicker 只标区，视图切换贴在标题右边 */
function phHeader(c) {
  const sw = phSwitch(phSegOf(c));
  const heading = `<p class="ui-page-kicker">${c.area}</p>
        <div class="ph-title-row"><h1>${c.title}</h1>${sw}</div>`;
  return `<header class="ui-page-header">
        <div class="ui-page-heading">
          ${heading}
          ${c.hint ? `<p class="ui-page-hint">${c.hint}</p>` : ''}
        </div>
        ${phActions(c.actions)}
      </header>`;
}

/** 6 个页头实例：工作流 / 模型库 / 节点管理 × 本地库 / 发现 */
function phCases(cases, indent = '          ') {
  const L = [`${indent}<div class="ph-grid">`];
  for (const c of cases) {
    L.push(`${indent}  <div class="ph-case">`);
    L.push(`${indent}    <div class="ph-case-head"><b>${c.group} · ${c.view}</b><span>${c.area} · ${c.title}</span></div>`);
    L.push(`${indent}    <div class="ph-frame">`);
    L.push(phHeader(c).replace(/^/gm, indent + '      '));
    L.push(`${indent}    </div>`);
    L.push(`${indent}  </div>`);
  }
  L.push(`${indent}</div>`);
  return L.join('\n');
}

/** 通用表格（表头 + 行） */
function phTable(head, rows, indent = '          ') {
  const h = '<div class="tbl-wrap"><table class="t"><thead><tr>'
    + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  const b = rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('');
  return `${indent}${h}${b}</tbody></table></div>`;
}

/* --------------------------------------------------------------------------
 * 形状 7 · search-filter —— 搜索 + 筛选统一视觉方案（定稿形态）
 * ------------------------------------------------------------------------
 * 最终形态 = **一行筛选条**（沿用 page-status 的 .ps-filters 单行结构）：
 *   搜索框 → 站点筛选 → 「筛选」按钮（带徽标）→ 排序 → 视图 → 读数 + 清除全部筛选
 * 其余类别筛选收进「筛选」按钮点开的浮层（div 浮层，不是第二行、不是侧栏）。
 * 控件一律复用既有语汇：.ps-search / .ps-chips / .ps-chip / .ps-select /
 * .ps-badge / .ps-view / .ps-count —— 不新造样式体系。
 * -------------------------------------------------------------------------- */

/** 搜索框：清空按钮只在有内容时出现（input 用 type=search，与 page-status 同） */
function sfSearch(s = {}) {
  const ph = s.placeholder || '搜索名称、路径或标签';
  const clear = s.clear
    ? '<button class="ps-clear" type="button" aria-label="清空搜索">✕</button>'
    : '';
  return `<label class="ps-search${s.wide ? ' is-wide' : ''}">${PS_ICON.search}` +
    `<input type="search" placeholder="${ph}" aria-label="${ph}">${clear}</label>`;
}

/** 「筛选」按钮 ＋ 点开的浮层（其余类别维度都在里面） */
function sfPopup(p) {
  const badge = `<b class="ps-badge"${p.count ? '' : ' hidden'}>${p.count || 0}</b>`;
  const facets = (p.facets || []).map((f) => {
    const chips = f.items.map((i) => {
      const n = i.count != null ? `<b>${i.count}</b>` : '';
      return `<button type="button" class="ps-chip${i.on ? ' on' : ''}" data-facet="${f.key}">${i.text}${n}</button>`;
    }).join('');
    return `<div class="sf-facet">
          <div class="sf-facet-head"><span>${f.label}</span><b>${f.items.length}</b></div>
          <div class="sf-facet-list">${chips}</div>
        </div>`;
  }).join('');
  return `<div class="sf-pop-wrap">
        <button class="ps-select sf-pop-trigger" type="button" aria-haspopup="dialog" aria-expanded="false">${PS_ICON.funnel}<span>${p.label}</span>${badge}</button>
        <div class="sf-pop" role="dialog" aria-label="${p.label}" hidden>
          <div class="sf-pop-head">
            <b>${p.label}</b>
            <span class="sf-pop-sel">0 项已选</span>
            <button class="sf-pop-x" type="button" aria-label="关闭">✕</button>
          </div>
          <div class="sf-pop-body">${facets}</div>
          <div class="sf-pop-foot">
            <button class="sf-pop-clear" type="button">清除全部</button>
            <button class="primary btn-xs" type="button" data-pop-ok>完成</button>
          </div>
        </div>
      </div>`;
}

/** 一行筛选条：搜索 → 站点 → 筛选按钮 → 排序 → 视图 → 读数 + 清除全部 */
function sfBar(b) {
  const search = sfSearch(b.search || {});
  const sites = b.sites ? psChips(b.sites) : '';
  const pop = sfPopup(b.pop || {});
  const sort = `<button class="ps-select" type="button">${PS_ICON.sort}<span>${b.sort}</span>${PS_ICON.caret}</button>`;
  const view = '<div class="ps-view" role="group" aria-label="视图切换">' +
    `<button type="button"${b.view === 'list' ? '' : ' class="on"'} title="网格视图">▦</button>` +
    `<button type="button"${b.view === 'list' ? ' class="on"' : ''} title="列表视图">☰</button></div>`;
  const c = b.count || {};
  const tail = `<div class="sf-tail">
        <p class="ps-count"><b>${c.visible}</b><span class="ps-total">/ ${c.total}</span><span class="ps-unit">${c.unit}</span></p>
        <button class="btn-xs sf-clear" type="button">${b.clearAll}</button>
      </div>`;
  return `<div class="sf-bar">
      <div class="ps-filters sf-row">${search}${sites}${pop}${sort}${view}${tail}</div>
    </div>`;
}

/** 空结果三态 */
function sfEmpty(states) {
  const items = states.map((s) => {
    const kw = (s.keywords || []).map((k) => `<button class="filter-chip" type="button">${k}</button>`).join('');
    const cta = s.cta
      ? `<button class="${s.cta.primary ? 'primary ' : ''}btn-xs" type="button">${s.cta.text}</button>`
      : '';
    return `<div class="sf-empty-case">
          <div class="sf-empty-head"><b>${s.kind}</b><span>${s.cond}</span></div>
          <div class="sf-empty-frame">
            <div class="ui-empty">
              ${s.icon ? `<div class="ui-empty-icon" aria-hidden="true">${s.icon}</div>` : ''}
              <p class="ui-empty-title">${s.title}</p>
              ${s.hint ? `<p class="ui-empty-hint">${s.hint}</p>` : ''}
              ${kw ? `<div class="chip-row">${kw}</div>` : ''}
              ${cta}
            </div>
          </div>
        </div>`;
  }).join('');
  return `<div class="sf-empty-grid">${items}</div>`;
}

/** 原型页内交互脚本（浮层开合 + 灰置项 hover 提示）—— 自包含，无外链 */
const SF_SCRIPT = [
  '(function () {',
  '  var pop = document.querySelector(".sf-pop");',
  '  var trig = document.querySelector(".sf-pop-trigger");',
  '  if (!pop || !trig) return;',
  '  var badge = trig.querySelector(".ps-badge");',
  '  var sel = pop.querySelector(".sf-pop-sel");',
  '  function sync() {',
  '    var n = pop.querySelectorAll(".ps-chip.on").length;',
  '    if (badge) { badge.textContent = String(n); badge.hidden = (n === 0); }',
  '    if (sel) sel.textContent = n + " 项已选";',
  '  }',
  '  function open() { pop.hidden = false; trig.setAttribute("aria-expanded", "true"); sync(); }',
  '  function close() { pop.hidden = true; trig.setAttribute("aria-expanded", "false"); }',
  '  trig.addEventListener("click", function (e) {',
  '    e.stopPropagation();',
  '    if (pop.hidden) open(); else close();',
  '  });',
  '  pop.addEventListener("click", function (e) {',
  '    e.stopPropagation();',
  '    var chip = e.target.closest ? e.target.closest(".ps-chip") : null;',
  '    if (chip) { chip.classList.toggle("on"); sync(); return; }',
  '    if (e.target.closest && e.target.closest(".sf-pop-clear")) {',
  '      var on = pop.querySelectorAll(".ps-chip.on");',
  '      for (var i = 0; i < on.length; i++) on[i].classList.remove("on");',
  '      sync(); return;',
  '    }',
  '    if (e.target.closest && (e.target.closest("[data-pop-ok]") || e.target.closest(".sf-pop-x"))) close();',
  '  });',
  '  document.addEventListener("click", function (e) {',
  '    if (!pop.hidden && !pop.contains(e.target) && !trig.contains(e.target)) close();',
  '  });',
  '  document.addEventListener("keydown", function (e) {',
  '    if (e.key === "Escape" && !pop.hidden) close();',
  '  });',
  '  sync();',
  '})();',
  '',
  '(function () {',
  '  var tip = document.createElement("div");',
  '  tip.className = "sf-tipbox";',
  '  tip.setAttribute("role", "tooltip");',
  '  tip.hidden = true;',
  '  document.body.appendChild(tip);',
  '  function show(t) {',
  '    tip.textContent = t.getAttribute("data-tip");',
  '    tip.hidden = false;',
  '    var r = t.getBoundingClientRect();',
  '    var b = tip.getBoundingClientRect();',
  '    var left = r.left + r.width / 2 - b.width / 2;',
  '    if (left < 8) left = 8;',
  '    if (left > window.innerWidth - b.width - 8) left = window.innerWidth - b.width - 8;',
  '    tip.style.left = left + "px";',
  '    tip.style.top = (r.top - b.height - 8) + "px";',
  '  }',
  '  document.addEventListener("mouseover", function (e) {',
  '    var t = e.target.closest ? e.target.closest("[data-tip]") : null;',
  '    if (t) show(t);',
  '  });',
  '  document.addEventListener("mouseout", function (e) {',
  '    var t = e.target.closest ? e.target.closest("[data-tip]") : null;',
  '    if (t) tip.hidden = true;',
  '  });',
  '})();',
].join('\n');

/* --------------------------------------------------------------------------
 * 形状 0 · shell —— 页面壳（所有原型页共用）
 * -------------------------------------------------------------------------- */
function shell(def, body, ctx) {
  const d = def.data;
  const v = (ctx && ctx.version) || def.version || '(未知版本)';   // 版本真值来自 VIS.md，不手写
  const css = (def.stylesheets || ['../assets/vis.css', '_proto.css']);
  /* 页内脚本（原型自带交互用）：没有就一个字节都不多写，保证其它原型页零漂移 */
  const scripts = (def.scripts || []).map((s) => `\n<script>\n${s}\n</script>`).join('');
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
<script src="../assets/shell.js"></script>${scripts}
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

  /* 统一页头（定稿）+ 搜索筛选定稿形态样张页 */
  'page-header': {
    render(def, ctx) {
      const d = def.data;
      const L = [];
      L.push(specList(d.spec));
      /* 现状对照 */
      L.push('');
      L.push('          <div class="proto-anchor" id="ph-now">');
      L.push('            <div class="proto-anchor-head"><b>现在六页的页头</b><span>同一个组件 · 六种写法 · 问题在信息层级，不在组件</span></div>');
      L.push(phTable(d.now.head, d.now.rows));
      L.push(`            <p class="proto-caption">${d.now.foot}</p>`);
      L.push('          </div>');
      /* 定稿的页头 */
      L.push('');
      L.push('          <div class="proto-anchor" id="ph-a">');
      L.push('            <div class="proto-anchor-head"><b>定稿 · 分层页头</b><span>kicker 只标区 · segmented 贴标题 · 单句 hint · 右置主操作</span></div>');
      L.push(specList(d.scheme.spec, '            '));
      L.push(phCases(d.pages, '            '));
      L.push(`            <p class="proto-caption">${d.scheme.caption}</p>`);
      L.push('          </div>');
      /* 三处代价 */
      L.push('');
      L.push('          <div class="proto-anchor" id="ph-cost">');
      L.push('            <div class="proto-anchor-head"><b>三处代价</b><span>这套排布的附带后果 —— 本轮一并落地，不是可选项</span></div>');
      L.push('            <div class="ph-rec">');
      L.push(`              <b>${d.cost.title}</b>`);
      for (const r of d.cost.why) L.push(`              <p>${r}</p>`);
      L.push('            </div>');
      L.push('          </div>');

      /* ---------- 搜索 + 筛选 ---------- */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-now">');
      L.push('            <div class="proto-anchor-head"><b>搜索 + 筛选 · 现状盘点</b><span>壳已经统一了，不统一的是壳里面那几样</span></div>');
      L.push(phTable(d.sf.now.head, d.sf.now.rows));
      L.push(`            <p class="proto-caption">${d.sf.now.foot}</p>`);
      L.push('          </div>');

      /* 定稿形态：主视觉（一行筛选条 ＋「筛选」浮层） */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-final">');
      L.push(`            <div class="proto-anchor-head"><b>定稿 · 一行筛选条 ＋「筛选」浮层</b><span>${d.sf.final.sub}</span></div>`);
      L.push(specList(d.sf.final.spec, '            '));
      L.push('            <div class="sf-frame">');
      L.push(sfBar(d.sf.final.bar).replace(/^/gm, '              '));
      L.push('            </div>');
      L.push(`            <p class="proto-caption">${d.sf.final.caption}</p>`);
      L.push(`            <p class="sf-hint">${d.sf.final.hint}</p>`);
      L.push('          </div>');

      /* 分层：站点筛选 vs 类别筛选 */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-layers">');
      L.push(`            <div class="proto-anchor-head"><b>${d.sf.layers.title}</b><span>站点在行内 · 类别在浮层</span></div>`);
      L.push(`            <p class="proto-lead">${d.sf.layers.lead}</p>`);
      L.push(phTable(d.sf.layers.rows.head, d.sf.layers.rows.rows));
      L.push(`            <p class="proto-caption">${d.sf.layers.foot}</p>`);
      L.push('          </div>');

      /* 探针状态 */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-probe">');
      L.push('            <div class="proto-anchor-head"><b>站点候选项按探针状态定</b><span>不可达 / 未探测的站不作为可选项提供</span></div>');
      L.push(phTable(d.sf.layers.probe.head, d.sf.layers.probe.rows));
      L.push('          </div>');

      /* 改了什么 */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-change">');
      L.push('            <div class="proto-anchor-head"><b>改了什么</b><span>相对上一轮提法，以及两套未采用的候选</span></div>');
      L.push('            <div class="sf-rec">');
      L.push(`              <b>${d.sf.change.title}</b>`);
      for (const r of d.sf.change.why) L.push(`              <p>${r}</p>`);
      L.push('            </div>');
      L.push(`            <p class="proto-caption">${d.sf.change.foot}</p>`);
      L.push('          </div>');

      /* 空结果三态 */
      L.push('');
      L.push('          <div class="proto-anchor" id="sf-empty">');
      L.push('            <div class="proto-anchor-head"><b>空结果三态</b><span>空集合 / 搜索无匹配 / 筛选后为空</span></div>');
      L.push(sfEmpty(d.sf.empty));
      L.push(`            <p class="proto-caption">${d.sf.emptyFoot}</p>`);
      L.push('          </div>');

      return shell({ ...def, scripts: [SF_SCRIPT] }, L.join('\n'), ctx);
    },
  },

};

export {
  assetCard, cardGrid, specList, diffColumns, anchorBlock, shell, psBar, psSection, psMatrix,
  phSwitch, phActions, phSegOf, phHeader, phCases, phTable,
  sfSearch, sfPopup, sfBar, sfEmpty, SF_SCRIPT,
};
