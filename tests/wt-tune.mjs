import { chromium } from '@playwright/test';

const CAND = {
  'W5': 'M3 19.2V13.3A9 9 0 0 1 21 13.3V19.2H18.4V13.3A6.4 6.4 0 0 0 5.6 13.3V19.2Z M7.2 19.2V13.3A4.8 4.8 0 0 1 16.8 13.3V19.2H14.2V13.3A2.2 2.2 0 0 0 9.8 13.3V19.2Z',
  'W6': 'M3 18.6V13.1A9 9 0 0 1 21 13.1V18.6H18.4V13.1A6.4 6.4 0 0 0 5.6 13.1V18.6Z M7.2 18.6V13.1A4.8 4.8 0 0 1 16.8 13.1V18.6H14.2V13.1A2.2 2.2 0 0 0 9.8 13.1V18.6Z',
  'W7': 'M3 19.4V13.4A9 9 0 0 1 21 13.4V19.4H18.2V13.4A6.2 6.2 0 0 0 5.8 13.4V19.4Z M7.6 19.4V13.4A4.4 4.4 0 0 1 16.4 13.4V19.4H14.2V13.4A2.2 2.2 0 0 0 9.8 13.4V19.4Z',
  'W8': 'M2.6 19.6V13.2A9.4 9.4 0 0 1 21.4 13.2V19.6H18.4V13.2A6.4 6.4 0 0 0 5.6 13.2V19.6Z M7.2 19.6V13.2A4.8 4.8 0 0 1 16.8 13.2V19.6H14.2V13.2A2.2 2.2 0 0 0 9.8 13.2V19.6Z',
  'oth·cur': 'M6 6h3v3H6Z M15 6h3v3h-3Z M6 15h3v3H6Z M15 15h3v3h-3Z',
  'O2': 'M5 5h4v4H5Z M15 5h4v4h-4Z M5 15h4v4H5Z M15 15h4v4h-4Z',
  'O3': 'M4.5 4.5h5v5h-5Z M14.5 4.5h5v5h-5Z M4.5 14.5h5v5h-5Z M14.5 14.5h5v5h-5Z',
  'pony': 'M12 4L21 19H3Z',
  'ltx': 'M4 7h6v10H4Z M14 7h6v10h-6Z',
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1010 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8000/lab/primeng', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);

await p.evaluate((CAND) => {
  const src = document.querySelector('.lab-card .brand');
  const board = document.createElement('div');
  board.id = 'wt-board';
  board.style.cssText =
    'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:10px;display:grid;grid-template-columns:repeat(5,96px);gap:6px 10px;align-items:end';
  document.body.appendChild(board);
  const cell = (br, label) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
    br.style.cssText = 'width:96px;height:96px;background:#fff;flex:none';
    const t = document.createElement('div');
    t.style.cssText = 'font:11px monospace;color:#666;white-space:nowrap';
    t.textContent = label;
    br.querySelectorAll('svg,img').forEach((e) => e.setAttribute('style','width:96px;height:96px'));
    d.appendChild(br); d.appendChild(t);
    return d;
  };
  for (const [name, d] of Object.entries(CAND)) {
    const br = src.cloneNode(true);
    br.querySelectorAll('img').forEach((e) => e.remove());
    const svg = br.querySelector('svg');
    svg.innerHTML = '';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    board.appendChild(cell(br, name));
  }
  for (const [name, f] of [['flux', 'flux'], ['qwen', 'qwen'], ['sdxl', 'sdxl'], ['hunyuan', 'hunyuan']]) {
    const br = src.cloneNode(true);
    br.querySelector('svg')?.remove();
    const im = document.createElement('img');
    im.src = 'families/' + f + '.svg';
    im.className = 'logo-light';
    br.appendChild(im);
    board.appendChild(cell(br, name));
  }
}, CAND);
await p.waitForTimeout(700);

const res = await p.evaluate(async () => {
  const S = 96;
  const load = (s) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('x')); im.src = s; });
  const out = [];
  for (const br of document.querySelectorAll('#wt-board .brand')) {
    const name = br.parentElement.querySelector('div').textContent;
    const el = br.firstElementChild;
    let im;
    if (el.tagName === 'IMG') im = await load(el.src);
    else {
      const c = el.cloneNode(true);
      c.setAttribute('width', S); c.setAttribute('height', S);
      c.setAttribute('style', `color:${getComputedStyle(br).color};width:${S}px;height:${S}px`);
      im = await load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c)));
    }
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const r = Math.min(S / im.width, S / im.height);
    g.drawImage(im, (S - im.width * r) / 2, (S - im.height * r) / 2, im.width * r, im.height * r);
    const d = g.getImageData(0, 0, S, S).data;
    let cov = 0, x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4, a = d[k + 3] / 255;
      if (a < 0.06) continue;
      cov += a;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    out.push({ name, cov: +((cov / (S * S)) * 100).toFixed(1), w: +(((x1 - x0 + 1) / S) * 22).toFixed(1), h: +(((y1 - y0 + 1) / S) * 22).toFixed(1) });
  }
  return out;
});
console.log(res.map((r) => `${r.name.padEnd(9)} cover=${String(r.cov).padStart(5)}%  ${r.w}x${r.h}px`).join('\n'));
await p.locator('#wt-board').screenshot({ path: '../artifacts/wt-tune.png' });
await b.close();
