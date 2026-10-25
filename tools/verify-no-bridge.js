// Verifies the app still boots when window.appBridge does not exist at all.
//
//   npx electron tools/verify-no-bridge.js
//
// main.js is not the only way index.html is opened: tools/ screenshot and
// audit probes load it in a plain BrowserWindow with no preload, and so does
// anyone opening the page in a browser. In that window `window.appBridge` is
// undefined, so every bridge call must be guarded - `if (!bridge) return;`,
// `if (window.appBridge && typeof ... === 'function')`, or `?.`.
//
// scripts/check-bridge.mjs proves that statically, from source. This suite
// proves the guarded paths actually behave: the app boots, nothing throws, and
// the bridge-dependent controls report "desktop app only" instead of dying. The
// two failures it exists for are a TypeError during boot (the whole page then
// renders half-initialised) and a bridge call reached from a click that never
// had its guard.
//
// It asserts:
//   1. this window really has no bridge (and that an unguarded call here throws)
//   2. the app boots with no uncaught exception and no console error
//   3. the browser fallbacks are the ones the user sees, not silent no-ops
//   4. nothing throws while those fallbacks run
//
// Errors are read from console messages rather than a debugger attachment:
// Chromium reports every uncaught exception there ("Uncaught TypeError: ..."),
// the app's own global handler logs it too, and a debugger on a target that is
// still loading is unreliable enough to hang this suite.
const { app, BrowserWindow } = require('electron');
require('./lib/verify-profile').isolateProfile('no-bridge');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.gz': 'application/gzip', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv'
};

// Expected in a window with no audio hardware and no preload. Each is noisy
// environment output, not a bridge failure; the bridge assertions would
// otherwise drown in AudioContext warnings on the CI runner.
const IGNORE = [
  /AudioContext was not allowed to start/i,
  /AudioWorklet|AudioWorkletNode/i,
  /Failed to load resource.*net::ERR_/i,
  /favicon/i,
  /Autoplay is only allowed/i
];

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}
function checkIncludes(label, actual, expected) {
  const ok = String(actual).includes(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(String(actual).slice(0, 120))}${ok ? '' : ` (expected to contain ${JSON.stringify(expected)})`}`);
}

const errors = [];

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

  // NO `preload` key: that absence is the entire point of this suite.
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { backgroundThrottling: false }
  });

  win.webContents.on('console-message', (first, ...rest) => {
    // Electron >= 37 passes a details object; older versions pass positionals.
    const level = typeof first === 'object' && first !== null ? first.level : rest[0];
    const message = typeof first === 'object' && first !== null ? first.message : rest[1];
    const text = String(message == null ? '' : message);
    if (IGNORE.some(re => re.test(text))) return;
    if (level === 'error' || level === 3) errors.push(text);
  });
  win.webContents.on('preload-error', (_e, p, err) => errors.push('[preload-error] ' + p + ': ' + err.message));
  win.webContents.on('render-process-gone', (_e, d) => errors.push('[render-process-gone] ' + JSON.stringify(d)));

  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  const run = (js) => win.webContents.executeJavaScript(js, true);
  // DataStore is a top-level `const`, so it is a global binding but not a
  // property of window - `typeof DataStore` is the only safe read.
  for (let i = 0; i < 80; i++) {
    const ready = await run("!!(window.App && window.IEM && typeof DataStore !== 'undefined')").catch(() => false);
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await new Promise(r => setTimeout(r, 2500));

  console.log('\n[1] this window has no preload, so there is no bridge');
  check('window.appBridge', await run('typeof window.appBridge'), 'undefined');
  check('app modules booted', await run("!!(window.App && window.IEM && window.UIKit && typeof DataStore !== 'undefined')"), 'true');
  check('the tab bar rendered', await run("!!document.getElementById('top-nav-bar')"), 'true');

  // Positive control: proves the absence is real, and shows what an unguarded
  // call would do here rather than leaving "no error" as the only evidence.
  check('an unguarded bridge call throws here', await run(`(() => {
    try { window.appBridge.dataInfo(); return 'no throw'; }
    catch (e) { return e && e.name; }
  })()`), 'TypeError');

  console.log('\n[2] boot completed without a bridge failure');
  const bootErrors = errors.slice();
  check('console errors during boot', bootErrors.length, 0);
  if (bootErrors.length) bootErrors.slice(0, 5).forEach(t => console.log('    ' + t.slice(0, 200)));
  check('DataStore fell back to browser mode', await run("typeof DataStore !== 'undefined' ? DataStore.state.mode : 'missing'"), 'memory');
  check('the update hint says why updates are unavailable', await run("(document.getElementById('app-version-hint') || {}).textContent"), 'Updates require the desktop app');
  // windowChrome binds the caption buttons through the bridge; with no bridge
  // it must bail before setting its bound flag, or a later call would think the
  // chrome is wired when nothing is listening.
  check('windowChrome bails instead of half-binding', await run(`(() => {
    UIKit.windowChrome();
    return UIKit._chromeBound;
  })()`), 'false');

  console.log('\n[3] bridge-dependent actions report their browser fallback');
  const toastAfter = (body) => `(async () => {
    ${body}
    await new Promise(r => setTimeout(r, 250));
    const stack = document.getElementById('toast-stack');
    const text = stack ? stack.textContent.trim() : '';
    if (stack) stack.innerHTML = '';
    return text;
  })()`;
  const fallback = async (label, js, expected) => {
    const before = errors.length;
    const text = await run(js).catch(e => { errors.push('[step threw] ' + label + ': ' + e.message); return ''; });
    checkIncludes(label, text, expected);
    check(`  ${label} added no error`, errors.length - before, 0);
  };

  // The update centre lives on App, not IEM (IEM is the review-card module).
  await fallback('checking for an app update', toastAfter('App.checkAppUpdate();'), 'Updates require the desktop app.');
  await fallback('checking for a database update', toastAfter('App.checkDatabaseUpdate();'), 'Updates require the desktop app.');
  await fallback('opening the release page', toastAfter('App.openReleasePage();'), 'This only works in the desktop app.');
  await fallback('opening the database folder', toastAfter(`(() => {
    const btn = document.querySelector('[data-action="click_900_App_openDataFolder"]');
    if (!btn) throw new Error('Open folder button is missing from Settings');
    btn.click();
  })()`), 'Opening folders only works in the desktop app.');

  console.log('\n[4] nothing threw anywhere in the run');
  if (errors.length) {
    console.log('  errors:');
    [...new Set(errors)].slice(0, 10).forEach(t => console.log('    ' + t.slice(0, 200)));
  }
  check('total console errors', errors.length, 0);
  check('none of them mention the bridge', errors.filter(t => /appBridge|Cannot read properties of undefined|is not a function/.test(t)).length, 0);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => { console.error('WATCHDOG TIMEOUT'); app.exit(2); }, 180000);
