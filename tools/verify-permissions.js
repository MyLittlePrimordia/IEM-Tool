// Runs the REAL main.js (local server, Host guard, permission lockdown) and checks
// from inside the page:
//   - clipboard write + read still work (Smart RF paste / EQ-line copy)
//   - camera, microphone, geolocation and notifications are denied
//   - the local server refuses a request with a foreign Host header
//
//   npx electron tools/verify-permissions.js
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const EXPECTED_ENTRIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.json'), 'utf8')).length;  // follows database.json, never a hardcoded count
let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// main.js serves app.getAppPath(); when this script is the Electron entry point
// that would be tools/, so point it at the project root first.
const ROOT = path.join(__dirname, '..');
app.getAppPath = () => ROOT;
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(500); }
  if (!win) { console.log('  FAIL  no window created by main.js'); app.exit(1); return; }
  await sleep(6000);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const url = new URL(win.webContents.getURL());
  console.log('   app origin:', url.origin);
  check('window actually loaded the app (nav bar present)', await js("!!document.getElementById('top-nav-bar')"), true);

  check('real server delivers the catalogue', await js('CurveIndexer.catalog.length'), EXPECTED_ENTRIES);
  // Pick whichever curve file the CURRENT database points at and that exists on
  // disk, instead of assuming entry #0 has a file. The bundled database and the
  // data/ folder change often; this test must not care what is in them.
  const dbEntries = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.json'), 'utf8'));
  let sampleCurve = null;
  for (const e of dbEntries) {
    const f = e && Array.isArray(e.files) && e.files[0];
    if (typeof f === 'string' && fs.existsSync(path.join(ROOT, f))) { sampleCurve = f; break; }
  }
  if (sampleCurve) {
    const curve = await js(`fetch('./' + ${JSON.stringify(sampleCurve)}.split('/').map(encodeURIComponent).join('/')).then(r => r.status)`);
    check('real server delivers a curve file', curve, 200);
  } else {
    console.log('  SKIP  no database entry points at an existing curve file in data/ - nothing to fetch');
  }

  console.log('\n[1] clipboard still works under the lockdown');
  await js("window.focus(); document.body.focus()");
  const w = await js("navigator.clipboard.writeText('iem-clip-test-123').then(() => 'ok').catch(e => 'ERR ' + e.name)");
  check('writeText', w, 'ok');
  const r = await js("navigator.clipboard.readText().catch(e => 'ERR ' + e.name)");
  check('readText returns what was written', r, 'iem-clip-test-123');

  console.log('\n[2] everything else is denied');
  for (const perm of ['geolocation', 'notifications']) {
    const st = await js(`navigator.permissions.query({ name: '${perm}' }).then(p => p.state).catch(e => 'ERR')`);
    check(`${perm} not granted`, st === 'granted', false);
  }
  const cam = await js("navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'granted').catch(e => e.name)");
  check('camera denied', cam === 'granted', false);
  const mic = await js("navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted').catch(e => e.name)");
  check('microphone denied', mic === 'granted', false);

  console.log('\n[3] Host-header guard (DNS-rebinding defence)');
  const status = (host, p = '/') => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: url.port, path: p, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve('error')); req.end();
  });
  check('own loopback origin is served', await status(`127.0.0.1:${url.port}`), 200);
  check('package.json is never served', await status(`127.0.0.1:${url.port}`, '/package.json'), 403);
  check('rebound hostname is refused', await status(`evil.example.com:${url.port}`), 403);
  check('localhost alias is refused', await status(`localhost:${url.port}`), 403);

  console.log('\n[4] the save log exports beside the database, under a fixed name');
  // The renderer never names a path: it sends Markdown, the main process picks
  // the file. Unpackaged, the writable root is the project folder, so write and
  // then clean up so a verification run leaves no stray file behind.
  const logDest = path.join(ROOT, 'save-log.md');
  const hadLog = fs.existsSync(logDest);
  try {
    if (!hadLog) {
      const none = await js("window.appBridge.dataReadSaveLog()");
      check('nothing exported yet reads back as null', none && none.text, null);
      const noOpen = await js("window.appBridge.dataOpenSaveLog()");
      check('opening before an export says why', noOpen && noOpen.error, 'No save-log.md yet.');
    }
    // A realistic changelog: a header and one section, the shape a previous export leaves.
    const okRes = await js("window.appBridge.dataWriteSaveLog({ text: ['# Database save log','','_1 save, newest first — exported from the Data tab on 2026-10-01 09:00._','','## 2026-10-01 09:00 — saved to disk','','5,100 entries · 2.90 MB · ＋2','','- ＋ test entry',''].join(String.fromCharCode(10)) })");
    check('the bridge accepts the Markdown', !!(okRes && okRes.ok), true);
    check('it lands at save-log.md next to database.json', fs.existsSync(logDest), true);
    check('with the text that was sent', fs.existsSync(logDest) && fs.readFileSync(logDest, 'utf8').includes('test entry'), true);
    check('and leaves the database alone', fs.readFileSync(path.join(ROOT, 'database.json'), 'utf8').length > 100, true);
    const read = await js("window.appBridge.dataReadSaveLog()");
    check('the bridge reads the changelog back', !!(read && read.ok && read.text && read.text.includes('test entry')), true);
    // A second export merges into the file the way the panel does: the read gives
    // the merge its existing sections, and the write must not drop them.
    const mergedRes = await js("(async () => { const existing = (await window.appBridge.dataReadSaveLog()).text;" +
      " const m = DataCore.mergeSaveLog(existing, [{ ts: Date.now(), mode: 'electron', entries: 2, bytes: 0, added: 1, modified: 0, removed: 0, total: 1, changes: [{ k: 'add', label: 'Bridge check', detail: '' }] }]);" +
      " const r = await window.appBridge.dataWriteSaveLog({ text: m.text }); return { ok: r.ok, added: m.added, total: m.total }; })()");
    check('a second export adds only the new save', mergedRes && mergedRes.added, 1);
    const mergedText = fs.existsSync(logDest) ? fs.readFileSync(logDest, 'utf8') : '';
    check('the earlier save survives it', mergedText.includes('test entry'), true);
    check('and the new one is there', mergedText.includes('Bridge check'), true);
    // Opening is checked with the launcher stubbed: a verification run must not
    // start an editor, and both branches (a handler exists / it does not) need to
    // be reachable.
    const realOpenPath = shell.openPath, realReveal = shell.showItemInFolder, revealed = [];
    try {
      shell.openPath = async () => '';
      shell.showItemInFolder = (f) => revealed.push(f);
      const opened = await js("window.appBridge.dataOpenSaveLog()");
      check('the bridge opens the changelog', opened && opened.ok && opened.how, 'opened');
      shell.openPath = async () => 'no handler for .md';
      const fallback = await js("window.appBridge.dataOpenSaveLog()");
      check('with no Markdown handler the file is revealed instead', fallback && fallback.how, 'revealed');
      check('and the file revealed is save-log.md', revealed.length === 1 && path.basename(revealed[0]), 'save-log.md');
    } finally {
      shell.openPath = realOpenPath;
      shell.showItemInFolder = realReveal;
    }
    // The panel's status line must read the file in the app: clicking it may not
    // hand the document to the OS any more (that is now a button in the viewer).
    await js("App.switchTab('database')");
    for (let i = 0; i < 80; i++) { if (await js("!!document.querySelector('#dt-tree .dt-item')")) break; await sleep(500); }
    check('the Data tab finds the changelog it wrote', await js("!!document.querySelector('[data-dt=\"log-open-file\"]')"), true);
    let openCalls = 0;
    shell.openPath = async () => { openCalls++; return ''; };
    await js("(() => { const b = document.querySelector('[data-dt=\"log-open-file\"]'); b.focus(); b.click(); })()");
    await sleep(600);
    check('clicking it opens the changelog inside the app', await js("(() => { const v = document.querySelector('#uikit-reader'); return !!v && !v.classList.contains('hidden'); })()"), true);
    check('which does not hand the file to the OS', openCalls, 0);
    check('the viewer shows what is in the file', await js("document.querySelector('#uikit-reader-body').textContent.includes('Bridge check')"), true);
    // The desktop-only secondary action still reaches the file.
    await js("document.querySelectorAll('#uikit-reader-actions button')[0].click()");
    await sleep(600);
    check('the Markdown-app action still opens it', openCalls, 1);
    await js("UIKit.closeReader()");

    const bad = await js("window.appBridge.dataWriteSaveLog({ text: 42 })");
    check('a non-string payload is refused', bad && bad.error, 'bad payload');
  } finally {
    if (!hadLog) { try { fs.unlinkSync(logDest); } catch (_) {} }
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 120000);
