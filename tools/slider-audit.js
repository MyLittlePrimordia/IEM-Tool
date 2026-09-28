// Audits every range input's geometry so a hit-area change can be verified
// numerically rather than only by eye. Reports, per slider:
//   - layout box (what occupies space in the flow)
//   - painted box (border box, i.e. the real pointer target)
//   - the rendered webkit track rect, so a centred 12px track inside a taller
//     input can be proven to sit exactly where the old 12px input was
//
//   npx electron tools/slider-audit.js <outJson>
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

const AUDIT = `(() => {
  const rows = [];
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const el of document.querySelectorAll('input[type="range"]')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    const cs = getComputedStyle(el);
    // The webkit track is not scriptable, so infer its painted geometry: the
    // track is centred in the content box and has height = track height.
    const contentH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const trackH = parseFloat(getComputedStyle(el, '::-webkit-slider-runnable-track').height) || 0;
    rows.push({
      id: el.id || '',
      cls: el.className || '',
      pane: (el.closest('[id^="pane-"]') || {}).id || '',
      x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height),
      clientH: el.clientHeight,
      cssH: cs.height,
      padT: cs.paddingTop, padB: cs.paddingBottom,
      marT: cs.marginTop, marB: cs.marginBottom,
      trackH: r2(trackH),
      trackTop: r2(b.y + (b.height - trackH) / 2),
      bg: cs.backgroundImage === 'none' ? 'flat' : 'gradient'
    });
  }
  return rows;
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
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 3000));

  const all = {};
  for (const tab of ['find', 'eq', 'iem', 'testlab', 'settings']) {
    await win.webContents.executeJavaScript(`App.switchTab('${tab}')`, true).catch(() => {});
    await new Promise(r => setTimeout(r, 900));
    for (const sub of (tab === 'testlab' ? ['tone', 'ab', 'hearing'] : tab === 'find' ? ['tune', 'endgame'] : [null])) {
      const key = tab + (sub ? ':' + sub : '');
      if (sub) {
        await win.webContents.executeJavaScript(
          tab === 'testlab' ? `TestLab.switchRightTab('${sub}')` : `FindEngine.switchRightTab('${sub}')`, true).catch(() => {});
        await new Promise(r => setTimeout(r, 700));
      }
      all[key] = await win.webContents.executeJavaScript(AUDIT, true).catch(() => []);
    }
  }

  const total = Object.values(all).reduce((a, v) => a + v.length, 0);
  const short = all.find ? [] : [];
  fs.writeFileSync(process.argv[2], JSON.stringify(all, null, 1));
  console.log('wrote ' + process.argv[2]);
  console.log('sliders audited across views: ' + total);
  const uniq = new Map();
  for (const rows of Object.values(all)) for (const r of rows) uniq.set(r.id + '|' + r.cls, r);
  const heights = {};
  for (const r of uniq.values()) {
    const k = 'inputBox h=' + r.h + '  clientH=' + r.clientH + '  cssH=' + r.cssH;
    heights[k] = (heights[k] || 0) + 1;
  }
  console.log('distinct input box heights:');
  Object.entries(heights).sort().forEach(([k, v]) => console.log('   ' + k + '  x' + v));
  const under = [...uniq.values()].filter(r => r.h < 24);
  console.log('sliders with painted box < 24px: ' + under.length + ' of ' + uniq.size);
  app.exit(0);
});
setTimeout(() => app.exit(2), 180000);
