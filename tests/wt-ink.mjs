import { chromium } from '@playwright/test';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1010 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await p.goto('http://127.0.0.1:8000/lab/primeng', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

// 在页面里注入 pony / ltx / other / hunyuan 四张卡（克隆现有 WAN 卡，只换家族类与标），
// 这样不用改生产 fixtures 也能量到不在 fixtures 里的家族。
const marks = {
  pony: 'M12 4L21 19H3Z',
  ltx: 'M4 7h6v10H4Z M14 7h6v10h-6Z',
  other: 'M5 5h4v4H5Z M15 5h4v4h-4Z M5 15h4v4H5Z M15 15h4v4h-4Z',
};
await p.evaluate((marks) => {
  const host = document.querySelector('.lab-card')?.parentElement;
  const src = document.querySelector('.lab-card');
  if (!host || !src) return;
  const ng = [...src.querySelector('.brand').attributes].map((a) => a.name).filter((k) => k.startsWith('_ng'));
  const add = (fam, build) => {
    const c = src.cloneNode(true);
    const plate = c.querySelector('.plate');
    plate.className = plate.className.replace(/f-\w+/, 'f-' + fam);
    c.querySelector('.code').textContent = fam.toUpperCase();
    c.querySelector('.variant').textContent = fam + '-probe';
    const brand = c.querySelector('.brand');
    build(brand, ng);
    host.appendChild(c);
  };
  for (const [fam, d] of Object.entries(marks)) {
    add(fam, (brand) => {
      brand.querySelectorAll('img').forEach((e) => e.remove());
      const svg = brand.querySelector('svg');
      svg.innerHTML = '';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
      svg.appendChild(path);
    });
  }
  add('hunyuan', (brand, ng) => {
    brand.querySelectorAll('svg').forEach((e) => e.remove());
    brand.querySelectorAll('img').forEach((e) => e.remove());
    const im = document.createElement('img');
    ng.forEach((k) => im.setAttribute(k, ''));
    im.className = 'logo-light';
    im.src = new URL('families/hunyuan.svg', document.baseURI).href;
    brand.appendChild(im);
  });
}, marks);
await p.waitForTimeout(400);

const res = await p.evaluate(async () => {
  const S = 96;
  const load = (src) =>
    new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => no(new Error('load fail ' + src));
      im.src = src;
    });

  const out = [];
  const brands = [...document.querySelectorAll('.lab-card .brand')];
  for (const br of brands) {
    const plate = br.closest('.plate');
    const fam = (plate.className.match(/f-(\w+)/) || [])[1];
    const el = br.firstElementChild;
    if (!el) continue;
    let im;
    try {
      if (el.tagName === 'IMG') im = await load(el.currentSrc || el.src);
      else {
        const clone = el.cloneNode(true);
        clone.removeAttribute('class');
        clone.setAttribute('width', String(S));
        clone.setAttribute('height', String(S));
        clone.setAttribute('style', `color:${getComputedStyle(br).color};width:${S}px;height:${S}px`);
        im = await load(
          'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(new XMLSerializer().serializeToString(clone))
        );
      }
    } catch (e) {
      out.push({ fam, tag: el.tagName, err: String(e).slice(0, 80) });
      continue;
    }
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    // 统一按 contain 铺满 S×S，等价于 22px 槽位的 object-fit: contain
    const r = Math.min(S / im.width, S / im.height);
    const w = im.width * r, h = im.height * r;
    g.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
    const d = g.getImageData(0, 0, S, S).data;

    let cover = 0, mass = 0, x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = (y * S + x) * 4;
        const a = d[k + 3] / 255;
        if (a < 0.06) continue;
        const lum = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
        cover += a;
        mass += a * (1 - lum * 0.6);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const n = S * S;
    out.push({
      fam,
      tag: el.tagName,
      cover: +((cover / n) * 100).toFixed(1),   // 占整个 22px 槽位的墨水覆盖率 %
      mass: +((mass / n) * 100).toFixed(1),     // 按亮度加权的视觉质量 %
      wpx: +(((x1 - x0 + 1) / S) * 22).toFixed(1),
      hpx: +(((y1 - y0 + 1) / S) * 22).toFixed(1),
      fill: +((cover / ((x1 - x0 + 1) * (y1 - y0 + 1))) * 100).toFixed(0), // 内容框内填充密度 %
    });
  }
  // 去重（同家族取第一个）
  const seen = new Set(), uniq = [];
  for (const r of out) { if (!seen.has(r.fam)) { seen.add(r.fam); uniq.push(r); } }
  return uniq;
});

console.log(
  res.map((r) => `${(r.fam || '?').padEnd(8)} ${String(r.tag).padEnd(4)} cover=${String(r.cover).padStart(5)}%  mass=${String(r.mass).padStart(5)}%  box=${r.wpx}x${r.hpx}px  fill=${r.fill}%`).join('\n')
);
await b.close();
