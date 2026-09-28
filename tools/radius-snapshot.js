// Captures the computed border-radius of EVERY element in the app, across all
// tabs, as a sorted multiset. Run before and after removing the dead `rounded-*`
// class tokens: if the two sets are identical, the removal provably changed
// nothing visually.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8' };

const SNAP = `(() => {
  const tally = {};
  const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    bump('r=' + cs.borderRadius);
    bump('tl=' + cs.borderTopLeftRadius + ' br=' + cs.borderTopRightRadius + ' bl=' + cs.borderBottomLeftRadius + ' bbr=' + cs.borderBottomRightRadius);
  }
  return tally;
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

  const merged = {};
  for (const tab of ['find', 'eq', 'iem', 'testlab', 'settings']) {
    await win.webContents.executeJavaScript(`App.switchTab('${tab}')`, true).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
    const t = await win.webContents.executeJavaScript(SNAP, true).catch(() => ({}));
    for (const [k, v] of Object.entries(t)) merged[k] = (merged[k] || 0) + v;
  }
  // The Test Lab right panel is a carousel whose sub-panels are NOT all in the
  // DOM at once, so pin each one to cover the elements the default view misses.
  for (const sub of ['tone', 'ab', 'hearing']) {
    await win.webContents.executeJavaScript(
      `App.switchTab('testlab'); TestLab.switchRightTab('${sub}')`, true).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
    const t = await win.webContents.executeJavaScript(SNAP, true).catch(() => ({}));
    for (const [k, v] of Object.entries(t)) merged[k] = (merged[k] || 0) + v;
  }
  // And the Find tab's right-hand carousel, same reason.
  for (const sub of ['tune', 'endgame']) {
    await win.webContents.executeJavaScript(
      `App.switchTab('find'); FindEngine.switchRightTab('${sub}')`, true).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
    const t = await win.webContents.executeJavaScript(SNAP, true).catch(() => ({}));
    for (const [k, v] of Object.entries(t)) merged[k] = (merged[k] || 0) + v;
  }
  const out = process.argv[2];
  fs.writeFileSync(out, JSON.stringify(merged, Object.keys(merged).sort(), 1));
  const radii = Object.keys(merged).filter(k => k.startsWith('r=')).map(k => k + ' x' + merged[k]);
  console.log('wrote ' + out);
  console.log('distinct computed radius values across all 5 tabs:');
  radii.forEach(r => console.log('   ' + r));
  app.exit(0);
});
setTimeout(() => app.exit(2), 180000);
