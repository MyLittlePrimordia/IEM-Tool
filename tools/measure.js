// Geometry measurement harness: runs in the page and reports the ACTUAL box
// metrics for the elements behind the design findings, so symmetry claims are
// measured rather than eyeballed.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8' };

const MEASURE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) }; };
  const out = {};
  const grab = (k, sel) => { const e = document.querySelector(sel); out[k] = e ? Object.assign({ sel }, r(e)) : { sel, missing: true }; };

  // --- 1. sibling curve slots (the graph's three boxes)
  out.slots = ['base-slot-wrapper','target-slot-wrapper','reference-slot-wrapper']
    .map(id => ({ id, ...(r(document.getElementById(id)) || { missing: true }) }));

  // --- 2. section-card heights across the three EQ columns
  out.cards = [...document.querySelectorAll('.tab-pane:not(.hidden) .section-card')].map((e,i) => ({
    i, ...r(e), cls: e.className.slice(0,60) }));

  // --- 3. every visible <button> that has a text child, with its box + whether
  //        its content is clipped (scrollWidth > clientWidth or scrollHeight > clientHeight)
  out.clipped = [];
  for (const el of document.querySelectorAll('.tab-pane:not(.hidden) button, .tab-pane:not(.hidden) .section-card > div')) {
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    const ox = el.scrollWidth - el.clientWidth;
    const oy = el.scrollHeight - el.clientHeight;
    if (ox > 1 || oy > 1) {
      out.clipped.push({ id: el.id || '', tag: el.tagName, txt: (el.textContent||'').trim().slice(0,34),
                         overflowX: ox, overflowY: oy, w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
    }
  }

  // --- 4. stepper arrow pairs: compare each ◀/▶ sibling pair's boxes
  out.arrows = [];
  for (const g of document.querySelectorAll('.tab-pane:not(.hidden) div')) {
    const kids = [...g.children].filter(c => c.tagName === 'BUTTON');
    if (kids.length === 2) {
      const a = r(kids[0]), b = r(kids[1]);
      if (a && b && a.w && b.w) out.arrows.push({ left: a, right: b, sameH: a.h === b.h, sameW: a.w === b.w });
    }
  }

  // --- 5. effective border-radius of a sample of elements (is the 0 !important winning?)
  out.radii = ['.section-card','#eq-main .eq-band-card','#top-nav-bar button','.btn-clear','.retro-switch-btn']
    .map(s => { const e = document.querySelector(s); return { sel: s, radius: e ? getComputedStyle(e).borderRadius : null }; });

  // --- 6. font sizes actually rendering (the 1280px media query claim)
  out.fonts = [...document.querySelectorAll('.tab-pane:not(.hidden) [class*="text-["], .tab-pane:not(.hidden) button')]
    .slice(0, 400)
    .map(e => ({ declared: (e.className.match(/text-\\[([\\d.]+)px\\]/)||[])[1] || null,
                 computed: getComputedStyle(e).fontSize,
                 txt: (e.textContent||'').trim().slice(0,22) }))
    .filter(x => x.declared);

  // --- 7. hit-target sizes below 24px
  out.smallTargets = [];
  for (const el of document.querySelectorAll('.tab-pane:not(.hidden) button, .tab-pane:not(.hidden) input[type=range]')) {
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    if (b.height < 24 || b.width < 24) out.smallTargets.push({ id: el.id||'', txt:(el.textContent||'').trim().slice(0,20), w:+b.width.toFixed(1), h:+b.height.toFixed(1) });
  }

  // --- 8. does the app's own sub-tab "active" state exist anywhere?
  out.activeIds = [...document.querySelectorAll('[id]')].map(e=>e.id)
    .filter(id => /-tab-(info|search|drivers|power|taste|upgrade|tone|ab|hearing|resonance|balance|burnin)$/.test(id));

  return out;
})()`;

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(APP_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1600, height: 900, show: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    const ok = await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 3500));

  for (const tab of ['eq', 'iem', 'testlab', 'find']) {
    await win.webContents.executeJavaScript(`App.switchTab('${tab}')`, true).catch(e => console.log('switchTab ' + tab + ' failed: ' + e.message));
    await new Promise(r => setTimeout(r, 900));
    const m = await win.webContents.executeJavaScript(MEASURE, true).catch(e => ({ error: String(e) }));
    console.log('\n================ TAB: ' + tab + ' ================');
    console.log(JSON.stringify(m, null, 1));
  }
  app.exit(0);
});
setTimeout(() => app.exit(2), 240000);
