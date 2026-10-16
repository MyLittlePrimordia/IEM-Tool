// Runs the REAL main.js (local server, Host guard, permission lockdown) and checks
// from inside the page:
//   - clipboard write + read still work (Smart RF paste / EQ-line copy)
//   - camera, microphone, geolocation and notifications are denied
//   - the local server refuses a request with a foreign Host header
//
//   npx electron tools/verify-permissions.js
const { app, BrowserWindow } = require('electron');
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

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 120000);
