// End-to-end test of database loading and Settings > Refresh.
//
//   npx electron tools/verify-database-load.js
//
//  1. The shipped catalogue loads: PEQDB and Find see the same entries, and
//     both loaders share ONE array (the single-flight load in CurveIndexer).
//  2. A malformed database does not crash the app and is reported.
//  3. Replace the served database with one that has an extra entry, press
//     Refresh, and confirm the NEW catalogue is what the app now uses.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

// What the "user" currently has in their database folder.
let served = fs.readFileSync(path.join(APP_ROOT, 'database.json'));

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      if (rel === '/database.json.gz') {
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' });
        return res.end(zlib.gzipSync(served));
      }
      if (rel === '/database.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(served);
      }
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
async function boot(win) {
  for (let i = 0; i < 60; i++) {
    const ready = await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar') && typeof CurveIndexer !== 'undefined' && Array.isArray(CurveIndexer.catalog) && (CurveIndexer.catalog.length > 0 || !!CurveIndexer.catalogLoadError)", true).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  await sleep(2500);
}
async function reload(win) {
  const loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(true)));
  win.webContents.reload();
  await loaded;
  await boot(win);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1300, height: 800, show: true, webPreferences: { backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await boot(win);
  const expected = JSON.parse(served.toString('utf8')).length;

  console.log('\n[1] shipped catalogue');
  check('CurveIndexer catalogue size', await js('CurveIndexer.catalog.length'), expected);
  check('PEQDB dataset size', await js('PEQDB_Module.STATE.dataset.length'), expected);
  check('Find metadata size', await js('FindEngine.iemDatabase.length'), expected);
  check('Find and CurveIndexer share ONE array', await js('FindEngine.iemDatabase === CurveIndexer.catalog'), true);
  check('no load error flagged', await js('!!CurveIndexer.catalogLoadError'), false);

  console.log('\n[2] malformed database (root is an object) does not take the app down');
  served = Buffer.from('{"not":"an array"}');
  await reload(win);
  check('app still booted', await js("!!document.getElementById('top-nav-bar')"), true);
  check('load error is reported', await js('!!CurveIndexer.catalogLoadError'), true);
  check('falls back to built-in targets, not an empty list', await js('PEQDB_Module.STATE.dataset.length > 0'), true);
  check('not claimed as fully loaded', await js('!!PEQDB_Module.databaseFullyLoaded'), false);
  check('no permanent "indexed" flag written', await js("localStorage.getItem('squig_db_indexed') === 'true'"), false);

  console.log('\n[3] restore a good database, then add an entry and press Refresh');
  served = fs.readFileSync(path.join(APP_ROOT, 'database.json'));
  await reload(win);
  check('good catalogue back', await js('CurveIndexer.catalog.length'), expected);
  const bigger = JSON.parse(served.toString('utf8'));
  bigger.push({ id: 'zz_refresh_test', brand: 'ZZ Test', model: 'Refresh One', variant: '', year: 2026, price_usd: 1, driver_type: 'DD', driver_config: '1DD', impedance: 16, sensitivity: 100, connector: '2-pin', form_factor: 'IEM', tags: [], files: [] });
  served = Buffer.from(JSON.stringify(bigger));
  await js("App.switchTab('settings')"); await sleep(400);
  await js("document.querySelector('[data-action=\"click_901_App_reloadDatabase\"]').click()");
  await sleep(500);
  const loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(true)));
  await js("document.getElementById('uikit-confirm-ok').click()");
  check('window reloaded', await Promise.race([loaded, sleep(10000).then(() => false)]), true);
  await boot(win);
  check('PEQDB sees the new entry', await js("PEQDB_Module.STATE.dataset.some(d => d.id === 'zz_refresh_test')"), true);
  check('Find sees the new entry', await js("FindEngine.iemDatabase.some(d => d.id === 'zz_refresh_test')"), true);
  check('catalogue grew by exactly one', await js('CurveIndexer.catalog.length'), expected + 1);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 240000);
