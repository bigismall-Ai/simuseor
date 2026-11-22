/* 无头 Chrome（CDP）打开 file:// 看板，收集控制台错误、外部请求、图片加载与看板断言。
   零外部依赖：只用 Node 内置的 child_process / global fetch / global WebSocket。 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function pickChrome() {
  for (const c of CHROME_CANDIDATES) { if (fs.existsSync(c)) return c; }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(dir, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const f = path.join(dir, 'DevToolsActivePort');
    if (fs.existsSync(f)) {
      const txt = fs.readFileSync(f, 'utf8').split('\n');
      if (txt.length >= 2 && txt[0].trim()) return parseInt(txt[0].trim(), 10);
    }
    await sleep(120);
  }
  throw new Error('DevToolsActivePort 未出现（Chrome 未启动？）');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) {
        c.handlers.forEach((h) => h(msg));
      }
    });
    return c;
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

(async () => {
  const htmlPath = process.argv[2];
  const shotDir = process.argv[3] || '';
  const out = { url: '', errors: [], external_requests: [], failed_requests: [], checks: {}, images: {}, shots: [] };
  const chrome = pickChrome();
  if (!chrome) { console.error('VERIFY_FAIL 未找到 Chrome 可执行文件'); process.exit(1); }
  out.chrome = chrome;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trb-board-chrome-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--hide-scrollbars', '--window-size=1440,1000',
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeErr = '';
  child.stderr.on('data', (d) => { chromeErr += d.toString(); });

  let cdp = null;
  try {
    const port = await waitPort(profile, 20000);
    const ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
    cdp = await CDP.connect(ver.webSocketDebuggerUrl);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = sessionId;
    const send = (m, p) => cdp.send(m, p, S);

    cdp.on((msg) => {
      if (msg.sessionId !== S) return;
      const p = msg.params || {};
      if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
        out.errors.push('console.' + p.type + ': ' + (p.args || []).map((a) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        out.errors.push('pageerror: ' + ((p.exceptionDetails && p.exceptionDetails.text) || 'unknown'));
      }
      if (msg.method === 'Log.entryAdded' && p.entry && p.entry.level === 'error') {
        out.errors.push('log: ' + p.entry.text);
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const u = p.request && p.request.url;
        if (u && !/^(file|data|blob):/.test(u)) out.external_requests.push(u);
      }
      if (msg.method === 'Network.loadingFailed') {
        out.failed_requests.push((p.errorText || 'failed') + ' ' + (p.type || ''));
      }
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await send('Page.enable');

    const url = 'file:///' + htmlPath.replace(/\\/g, '/');
    out.url = url;
    const loaded = new Promise((res) => {
      const h = (msg) => { if (msg.sessionId === S && msg.method === 'Page.loadEventFired') res(true); };
      cdp.on(h);
    });
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(1600);

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        const desc = (d.exception && d.exception.description) || d.text || JSON.stringify(d);
        out.errors.push('eval: ' + String(desc).slice(0, 500));
        return null;
      }
      return r.result ? r.result.value : null;
    };

    out.checks.page = await evalJs("(function(){return {href: location.href, ready: document.readyState, title: document.title};})()");

    const probe = `(function () {
      function q(sel) { return document.querySelectorAll(sel); }
      function el(id) { return document.getElementById(id); }
      function txt(id) { var e = el(id); return e ? (e.textContent || '') : ''; }
      function htm(id) { var e = el(id); return e ? (e.innerHTML || '') : ''; }
      var rows = q('#shotRows tr');
      var cards = q('#wallGrid .item');
      var imgs = Array.prototype.slice.call(document.images);
      var broken = imgs.filter(function (i) { return !i.complete || i.naturalWidth === 0; });
      var first = rows.length ? rows[0] : null;
      var rowCells = first ? Array.prototype.slice.call(first.children).map(function (td) { return td.textContent.trim(); }) : [];
      var hrefs = Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(function (a) { return a.getAttribute('href'); });
      return {
        title: document.title,
        rows: rows.length,
        cards: cards.length,
        row_cells: rowCells,
        detail_title: txt('detailTitle'),
        detail_title_outer: el('detailTitle') ? el('detailTitle').outerHTML : 'NULL',
        detail_outer_head: el('detailBody') ? el('detailBody').innerHTML.slice(0, 120) : 'NULL',
        detail_h2_outer: (document.querySelector('#detail h2') || {}).outerHTML || 'NULL',
        detail_has_params: htm('detailBody').indexOf('参数化') >= 0,
        detail_has_spark: q('#detailBody svg polyline').length,
        detail_has_checks: htm('detailBody').indexOf('镜头包验收') >= 0,
        detail_has_assets: htm('detailBody').indexOf('资产引用') >= 0,
        detail_has_note: !!el('shotNote'),
        images_total: imgs.length,
        images_broken: broken.length,
        external_anchors: hrefs.filter(function (h) { return /^https?:/i.test(h); }).length,
        data_uri_images: hrefs.filter(function (h) { return /^data:image\\//.test(h); }).length,
        package_links: hrefs.filter(function (h) { return /\\.\\.\\/shots\\/[^/]+\\/shot_spec\\.json$/.test(h); }).length,
        wall_data_uri: Array.prototype.slice.call(q('#wallGrid img')).filter(function (i) { return /^data:image\\//.test(i.src); }).length,
        board_meta: txt('boardMeta'),
        list_count: txt('listCount')
      };
    })()`;
    out.checks.probe = await evalJs(probe) || {};

    out.checks.click_row = await evalJs(`(function () {
      var rows = document.querySelectorAll('#shotRows tr');
      if (rows.length < 3) return { ok: false, reason: 'rows<3' };
      var before = document.getElementById('detailTitle').textContent;
      rows[2].click();
      var after = document.getElementById('detailTitle').textContent;
      return { ok: before !== after, before: before, after: after };
    })()`) || {};

    out.checks.filter = await evalJs(`(function () {
      var q = document.getElementById('q');
      q.value = 'dolly';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      var n = document.querySelectorAll('#shotRows tr').length;
      var m = document.querySelectorAll('#wallGrid .item').length;
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      var back = document.querySelectorAll('#shotRows tr').length;
      return { filtered_rows: n, filtered_cards: m, restored_rows: back };
    })()`) || {};

    out.checks.notes = await evalJs(`(function () {
      var ta = document.getElementById('shotNote');
      if (!ta) return { ok: false, reason: 'no textarea' };
      ta.value = 'probe-note';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      var ls = 'unavailable';
      try { ls = (window.localStorage.getItem('trb-board-notes') || '').length; } catch (e) { ls = 'blocked'; }
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, storage: ls };
    })()`) || {};

    if (shotDir) {
      fs.mkdirSync(shotDir, { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(shotDir, 'board_full.png'), Buffer.from(shot.data, 'base64'));
      out.shots.push('board_full.png');
      await evalJs('(function(){window.scrollTo(0,0); return true;})()');
      await sleep(500);
      const shotTop = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, 'board_top.png'), Buffer.from(shotTop.data, 'base64'));
      out.shots.push('board_top.png');
      await evalJs("(function(){var s=document.getElementById('wall'); if(s) s.scrollIntoView(); return true;})()");
      await sleep(700);
      const shot2 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, 'board_wall.png'), Buffer.from(shot2.data, 'base64'));
      out.shots.push('board_wall.png');
      await evalJs("(function(){var s=document.getElementById('list'); if(s) s.scrollIntoView(); return true;})()");
      await sleep(700);
      const shot3 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, 'board_list.png'), Buffer.from(shot3.data, 'base64'));
      out.shots.push('board_list.png');
      await evalJs("(function(){var s=document.getElementById('detail'); if(s) s.scrollIntoView(); return true;})()");
      await sleep(700);
      const shot4 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, 'board_detail.png'), Buffer.from(shot4.data, 'base64'));
      out.shots.push('board_detail.png');
    }
  } catch (e) {
    out.errors.push('harness: ' + (e && e.message ? e.message : String(e)));
    if (chromeErr) out.chrome_stderr = chromeErr.slice(0, 600);
  } finally {
    if (cdp) cdp.close();
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  const pr = out.checks.probe || {};
  out.images = { total: pr.images_total, broken: pr.images_broken };
  out.ok = !out.errors.length && !out.external_requests.length && !out.failed_requests.length
    && pr.rows === 9 && pr.cards === 9 && pr.images_broken === 0
    && pr.external_anchors === 0 && pr.detail_has_spark >= 3
    && out.checks.click_row && out.checks.click_row.ok === true
    && out.checks.filter && out.checks.filter.restored_rows === 9;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
})().catch((e) => { console.error('VERIFY_FAIL', e); process.exit(1); });
