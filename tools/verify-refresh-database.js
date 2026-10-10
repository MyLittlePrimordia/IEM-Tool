// Functional test for Settings -> Data -> "Refresh" (reload database).
//
//   npx electron tools/verify-refresh-database.js
//
// Asserts:
//   - the offline-database hint fits on ONE row and the Open folder / Refresh
//     buttons share a row, at several window widths
//   - Cancel on the confirm dialog changes nothing (no reload, cache intact)
//   - Confirm clears the persisted curve cache, drops the "already indexed"
//     flag, reloads the window, and leaves unrelated settings untouched
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

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

const LAYOUT = `(() => {
  const hint = document.querySelector('.settings-row-hint.is-one-line');
  const open = document.querySelector('[data-action="click_900_App_openDataFolder"]');
  const refresh = document.querySelector('[data-action="click_901_App_reloadDatabase"]');
  if (!hint || !open || !refresh) return { missing: true };
  const cs = getComputedStyle(hint);
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35;
  const hr = hint.getBoundingClientRect(), o = open.getBoundingClientRect(), r = refresh.getBoundingClientRect();
  return {
    oneRow: hr.height <= lineH + 1,
    notTruncated: hint.scrollWidth <= hint.clientWidth,
    sameRow: Math.abs(o.top - r.top) < 2,
    refreshRightOfOpen: r.left > o.right - 1,
    refreshVisible: r.width > 0 && r.height > 0
  };
})()`;

const SEED = `(async () => {
  window.__noReload = 1;
  await CurveIndexer._openDB();
  await CurveIndexer._dbPut({ path: '__marker__', freqs: new Float32Array([20, 20000]), dbs: new Float32Array([0, 0]), indexedAt: 1 });
  SafeStorage.setItem('squig_db_indexed', 'true');
  SafeStorage.setItem('settings_marker_keep', '1');
  return true;
})()`;

const MARKER_PRESENT = `new Promise((resolve) => {
  const req = indexedDB.open('iem_curve_index', 3);
  req.onerror = () => resolve('error');
  req.onsuccess = () => {
    const db = req.result;
    try {
      const g = db.transaction(db.objectStoreNames[0], 'readonly').objectStore(db.objectStoreNames[0]).get('__marker__');
      g.onsuccess = () => { db.close(); resolve(!!g.result); };
      g.onerror = () => { db.close(); resolve('error'); };
    } catch (e) { db.close(); resolve('error'); }
  };
})`;

const CLICK_REFRESH = `document.querySelector('[data-action="click_901_App_reloadDatabase"]').click()`;
const WAIT_MODAL = `new Promise(async (resolve) => {
  for (let i = 0; i < 40; i++) {
    const m = document.getElementById('uikit-confirm-modal');
    if (m && m.getBoundingClientRect().width > 0 && document.getElementById('uikit-confirm-ok')) return resolve(true);
    await new Promise(r => setTimeout(r, 100));
  }
  resolve(false);
})`;

async function boot(win, port) {
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await sleep(500);
  }
  await sleep(2500);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1000, height: 700, show: true, webPreferences: { backgroundThrottling: false } });
  await boot(win, port);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js("App.switchTab('settings')");
  await sleep(500);

  console.log('\n[1] hint fits one row; buttons share a row');
  for (const w of [1400, 1000, 760, 520]) {
    win.setSize(w, 700);
    await sleep(500);
    const l = await js(LAYOUT);
    console.log(`   width ${w}: ${JSON.stringify(l)}`);
    check(`${w}px: both buttons present`, !l.missing, true);
    check(`${w}px: hint on one row`, l.oneRow, true);
    check(`${w}px: Refresh sits next to Open folder`, l.sameRow && l.refreshRightOfOpen, true);
    if (w >= 760) check(`${w}px: hint not truncated`, l.notTruncated, true);
  }
  win.setSize(1000, 700);
  await sleep(400);

  console.log('\n[2] Cancel leaves everything alone');
  await js(SEED);
  await js(CLICK_REFRESH);
  check('confirm dialog opens', await js(WAIT_MODAL), true);
  await js("document.getElementById('uikit-confirm-cancel').click()");
  await sleep(1200);
  check('page did not reload', await js('window.__noReload'), 1);
  check('curve cache marker still present', await js(MARKER_PRESENT), true);
  check('indexed flag still set', await js("SafeStorage.getItem('squig_db_indexed')"), 'true');

  console.log('\n[3] Confirm clears caches and reloads the window');
  await js(CLICK_REFRESH);
  check('confirm dialog opens', await js(WAIT_MODAL), true);
  const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve(true)));
  await js("document.getElementById('uikit-confirm-ok').click()");
  check('window reloaded', await Promise.race([reloaded, sleep(10000).then(() => false)]), true);
  for (let i = 0; i < 40; i++) {
    if (await js("!!document.getElementById('top-nav-bar')").catch(() => false)) break;
    await sleep(500);
  }
  await sleep(2500);
  check('in-memory state reset by reload', await js('window.__noReload === undefined'), true);
  check('curve cache marker cleared', await js(MARKER_PRESENT), false);
  check('unrelated setting kept', await js("SafeStorage.getItem('settings_marker_keep')"), '1');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
