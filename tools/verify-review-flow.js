// Functional test for the Review tab: library save / load / delete round trip
// and the infographic export. Run against any checkout:
//
//   npx electron tools/verify-review-flow.js           (this repo)
//   IEM_APP_ROOT=/path/to/other npx electron tools/verify-review-flow.js
//
// Used during the god-file split to run the SAME script against the original
// and the refactored tree and compare the printed export metrics.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = process.env.IEM_APP_ROOT || path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain' };
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
let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1400, height: 900, show: true });
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await sleep(6000);
  await js("App.switchTab('review')"); await sleep(1200);
  await js("localStorage.clear()");

  console.log('\n[1] library round trip');
  await js("document.getElementById('brand').value = 'Test Brand'; document.getElementById('model').value = 'Round Trip'; document.getElementById('price').value = '123'");
  await js("IEM.saveToLibrary()"); await sleep(1500);
  const lib = JSON.parse(await js("(async () => JSON.stringify((await IEM.getLibrary()).map(r => ({ id: r.id, brand: r.brand, model: r.model }))))()"));
  check('saved record present', lib.some(r => r.id === 'test-brand-round-trip'), true);
  await js("document.getElementById('brand').value = 'Changed'; document.getElementById('model').value = 'Changed'");
  await js("IEM.loadFromLibrary('test-brand-round-trip')"); await sleep(1500);
  check('load restores brand', await js("document.getElementById('brand').value"), 'Test Brand');
  check('load restores model', await js("document.getElementById('model').value"), 'Round Trip');
  check('load restores price', await js("document.getElementById('price').value"), '123');
  await js("(() => { IEM.deleteFromLibrary('test-brand-round-trip'); return true; })()"); await sleep(600);
  await js("(document.getElementById('uikit-confirm-ok') || {click(){}}).click()"); await sleep(1200);
  const after = JSON.parse(await js("(async () => JSON.stringify((await IEM.getLibrary()).map(r => r.id)))()"));
  check('record deleted', after.includes('test-brand-round-trip'), false);

  console.log('\n[2] infographic export renders a real PNG');
  await js("document.getElementById('brand').value = 'Export Brand'; document.getElementById('model').value = 'Card'");
  const metrics = await js(`(async () => {
    let captured = null;
    IEM_Module.triggerInfographicDownload = function (canvas, brand, model) { captured = { w: canvas.width, h: canvas.height, len: canvas.toDataURL('image/png').length, brand, model }; };
    let err = null;
    try {
      await IEM_Module.ensureChartReady();
      await IEM_Module.exportReviewCard();
      // The card is composed inside an <img>.onload callback, so the download
      // hook fires AFTER exportReviewCard() resolves. Wait for it.
      for (let i = 0; i < 100 && !captured; i++) await new Promise(r => setTimeout(r, 100));
    } catch (e) { err = String(e && e.stack || e).slice(0, 300); }
    if (!captured) return { error: err, chart: !!IEM_Module.radarChart, toast: (document.querySelector('#toast, .toast, [id*="toast"]') || {}).textContent || null };
    return captured;
  })()`);
  console.log('   export metrics:', JSON.stringify(metrics));
  check('export produced a canvas', !!(metrics && metrics.w), true);
  if (metrics && metrics.w) {
    check('canvas is card sized (>= 800x800)', metrics.w >= 800 && metrics.h >= 800, true);
    check('PNG is not blank (> 20 KB)', metrics.len > 20000, true);
    check('file name parts passed through', metrics.brand + '|' + metrics.model, 'Export Brand|Card');
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 150000);
