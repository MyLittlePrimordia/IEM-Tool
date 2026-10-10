// Functional test for EQ Undo / Redo, "remember last EQ", and Settings > Fix settings.
//
//   npx electron tools/verify-eq-history.js
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

// A "gesture" = pointerdown inside the EQ workspace, then the change.
const gesture = (id, code) => `(() => {
  document.getElementById(${JSON.stringify(id)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  ${code};
  document.getElementById(${JSON.stringify(id)}).dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return true;
})()`;
const GAIN = (i) => `parseFloat(document.getElementById('eq-s${i}').value)`;
const CLICK = (cmd) => `document.querySelector('[data-cmd="${cmd}"]').click()`;

async function boot(win) {
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar') && !!document.getElementById('eq-s3')", true).catch(() => false)) break;
    await sleep(500);
  }
  await sleep(2500);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1500, height: 850, show: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await boot(win);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js("localStorage.clear()");
  await js("App.switchTab('eq')");
  await sleep(600);

  console.log('\n[1] buttons exist and fit');
  check('undo button present', await js("!!document.querySelector('[data-cmd=\"EQ.undoEQ\"]')"), true);
  check('redo button present', await js("!!document.querySelector('[data-cmd=\"EQ.redoEQ\"]')"), true);
  check('buttons visible', await js("(() => { const a = document.querySelector('[data-cmd=\"EQ.undoEQ\"]').getBoundingClientRect(); const b = document.querySelector('[data-cmd=\"EQ.redoEQ\"]').getBoundingClientRect(); return a.width > 0 && b.width > 0; })()"), true);

  console.log('\n[2] undo / redo walk');
  await js(gesture('eq-s3', "EQ.handleGainNumInput(3, '4.0')"));
  await js(gesture('eq-s5', "EQ.handleGainNumInput(5, '-3.0')"));
  check('band 3 set', await js(GAIN(3)), 4);
  check('band 5 set', await js(GAIN(5)), -3);
  await js(CLICK('EQ.undoEQ')); await sleep(200);
  check('undo #1 reverts band 5', await js(GAIN(5)), 0);
  check('undo #1 keeps band 3', await js(GAIN(3)), 4);
  await js(CLICK('EQ.undoEQ')); await sleep(200);
  check('undo #2 reverts band 3', await js(GAIN(3)), 0);
  await js(CLICK('EQ.redoEQ')); await sleep(200);
  check('redo #1 restores band 3', await js(GAIN(3)), 4);
  await js(CLICK('EQ.redoEQ')); await sleep(200);
  check('redo #2 restores band 5', await js(GAIN(5)), -3);
  check('numeric box follows slider on restore', await js("document.getElementById('eq-s5_num').value"), '-3.0');

  console.log('\n[3] a fresh edit makes the old redo stale');
  await js(CLICK('EQ.undoEQ')); await sleep(200);
  await js(gesture('eq-s1', "EQ.handleGainNumInput(1, '2.0')"));
  await js(CLICK('EQ.redoEQ')); await sleep(200);
  check('stale redo did nothing (band 5 still 0)', await js(GAIN(5)), 0);
  check('new edit kept', await js(GAIN(1)), 2);

  console.log('\n[4] band type / slope / bypass visuals follow undo');
  const typeLabel = "document.getElementById('eq-t_m2').textContent.trim()";
  await js(gesture('eq-t_m2', "EQ.cycleBandType(2)"));
  check('type changed to LS', await js(typeLabel), 'LS');
  await js(CLICK('EQ.undoEQ')); await sleep(200);
  check('undo restores label PK', await js(typeLabel), 'PK');
  check('undo restores model type', await js("EQ.bands[2].type"), 'peaking');
  await js(CLICK('EQ.redoEQ')); await sleep(200);
  check('redo restores label LS', await js(typeLabel), 'LS');
  check('slope button visible for LS', await js("!document.getElementById('eq-sl_m2').classList.contains('hidden')"), true);
  await js(gesture('eq-bp_m4', "EQ.toggleBandBypass(4)"));
  check('bypass dot red', await js("document.getElementById('eq-bp_m4').textContent.trim()"), '\u{1F534}');
  await js(CLICK('EQ.undoEQ')); await sleep(200);
  check('undo restores green dot', await js("document.getElementById('eq-bp_m4').textContent.trim()"), '\u{1F7E2}');
  check('undo clears bypass state', await js("window.bypassedBands.has('m4')"), false);

  console.log('\n[5] Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z keyboard');
  await js(gesture('eq-s7', "EQ.handleGainNumInput(7, '5.0')"));
  await js("document.getElementById('eq-s7').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
  await sleep(200);
  check('Ctrl+Z undoes', await js(GAIN(7)), 0);
  await js("document.getElementById('eq-s7').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))");
  await sleep(200);
  check('Ctrl+Shift+Z redoes', await js(GAIN(7)), 5);
  await js("document.getElementById('eq-s7').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
  await sleep(200);
  await js("document.getElementById('eq-s7').dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))");
  await sleep(200);
  check('Ctrl+Y redoes', await js(GAIN(7)), 5);

  console.log('\n[6] remembered across a reload');
  await js("EQ.handleGainNumInput(4, '4.5'); document.getElementById('eq-s4').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))");
  await sleep(1300);
  check('saved entry exists', await js("!!SafeStorage.getItem('iem_last_eq_v1')"), true);
  let loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(true)));
  win.webContents.reload(); await loaded; await boot(win);
  check('band 4 restored after relaunch', await js(GAIN(4)), 4.5);
  check('band 7 restored too', await js(GAIN(7)), 5);
  check('band 2 type restored (LS label)', await js("document.getElementById('eq-t_m2').textContent.trim()"), 'LS');

  console.log('\n[7] damaged saved EQ is discarded, app still boots');
  await js("SafeStorage.setItem('iem_last_eq_v1', JSON.stringify({ preamp: 999, main: [{ hz: 'x' }], adv: [], bypassed: [] }))");
  loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(true)));
  // Block the pagehide flush from overwriting the bad entry we just planted.
  await js("window.addEventListener('pagehide', (e) => e.stopImmediatePropagation(), true)");
  win.webContents.reload(); await loaded; await boot(win);
  check('boots with default EQ', await js(GAIN(4)), 0);
  check('bad entry removed', await js("SafeStorage.getItem('iem_last_eq_v1') === null || SafeStorage.getItem('iem_last_eq_v1') === undefined"), true);

  console.log('\n[8] Settings > Fix settings');
  await js("App.switchTab('settings')"); await sleep(400);
  await js("SafeStorage.setItem('settings_theme_id','zz'); SafeStorage.setItem('settings_hearing_offsets','{\"a\":1}'); SafeStorage.setItem('iem_custom_eq_presets','{\"keep\":{\"p\":0}}'); SafeStorage.setItem('iem_last_eq_v1','{}')");
  check('button present', await js("!!document.querySelector('[data-action=\"click_902_App_resetSettings\"]')"), true);
  await js("document.querySelector('[data-action=\"click_902_App_resetSettings\"]').click()");
  await sleep(500);
  loaded = new Promise((r) => win.webContents.once('did-finish-load', () => r(true)));
  await js("document.getElementById('uikit-confirm-ok').click()");
  check('window reloaded', await Promise.race([loaded, sleep(10000).then(() => false)]), true);
  await boot(win);
  // The app may or may not re-write its default theme this soon after boot, so assert the planted value is gone.
  check('planted theme setting cleared', await js("localStorage.getItem('settings_theme_id') !== 'zz'"), true);
  check('hearing calibration kept', await js("localStorage.getItem('settings_hearing_offsets')"), '{"a":1}');
  check('custom presets kept', await js("localStorage.getItem('iem_custom_eq_presets') !== null"), true);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 240000);
