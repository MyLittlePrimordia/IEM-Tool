// Regression test for "the coloured slider bar does not follow the knob".
//
//   npx electron tools/verify-slider-fill.js
//
// The stylesheet paints each range track from --range-fill. Assigning
// `el.value` in code fires no event, so the bar used to stay at its old
// position while the knob moved. This test moves sliders every way the app
// does and asserts the invariant: for EVERY range input, --range-fill equals
// the knob's real position.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = process.env.IEM_APP_ROOT || path.join(__dirname, '..');
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
// Returns the ids of range inputs whose painted fill disagrees with their value.
const STALE = `(() => {
  const bad = [];
  document.querySelectorAll('input[type="range"]').forEach((el) => {
    if (el.classList.contains('dual-range')) return;
    const fill = el.style.getPropertyValue('--range-fill');
    if (!fill) return;
    const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100, val = parseFloat(el.value) || 0;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    if (Math.abs(parseFloat(fill) - pct) > 0.05) bad.push((el.id || el.className || 'range') + ' value=' + el.value + ' fill=' + fill + ' expected=' + pct.toFixed(1) + '%');
  });
  return bad.slice(0, 8).join(' ; ');
})()`;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1500, height: 900, show: true });
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await sleep(6000);
  await js("App.switchTab('eq')"); await sleep(800);
  check('fresh app: every fill matches its knob', await js(STALE), '');

  console.log('\n[1] code assigns el.value directly (no event)');
  await js("document.getElementById('eq-s3-std').value = 12; document.getElementById('eq-s5-std').value = -15; true");
  check('raw .value writes repaint', await js(STALE), '');
  check('band 4 fill follows the knob (80%)', await js("document.getElementById('eq-s3-std').style.getPropertyValue('--range-fill')"), '80%');

  console.log('\n[2] app code paths that move sliders');
  await js("EQ.handleGainNumInput(0, '-12'); EQ.handleGainNumInput(2, '8'); true"); await sleep(500);
  check('handleGainNumInput', await js(STALE), '');
  await js("EQ.resetEQ(); true"); await sleep(500);
  check('resetEQ (Clear)', await js(STALE), '');
  check('after reset band 1 fill is back at 50%', await js("document.getElementById('eq-s0-std').style.getPropertyValue('--range-fill')"), '50%');
  if (await js("!!document.querySelector('[data-cmd=\"EQ.undoEQ\"]')")) {
  await js("EQ.handleGainNumInput(4, '6'); document.getElementById('eq-s4').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); EQ.handleGainNumInput(4, '-6'); true"); await sleep(300);
  await js("document.querySelector('[data-cmd=\"EQ.undoEQ\"]').click(); true"); await sleep(600);
  check('undo', await js(STALE), '');
  await js("document.querySelector('[data-cmd=\"EQ.redoEQ\"]').click(); true"); await sleep(600);
  check('redo', await js(STALE), '');
  }

  console.log('\n[3] min / max change moves the knob relative to its range');
  await js("(() => { const s = document.getElementById('eq-s7-std'); s.value = 10; s.setAttribute('max', '40'); return true; })()");
  await sleep(200);
  check('bounds change repainted', await js(STALE), '');
  await js("(() => { const s = document.getElementById('eq-s7-std'); s.setAttribute('max', '20'); s.value = 0; return true; })()");

  console.log('\n[4] sliders created later by code');
  await js("(() => { const i = document.createElement('input'); i.type = 'range'; i.id = 'zz-late'; i.min = 0; i.max = 200; i.value = 50; document.body.appendChild(i); return true; })()");
  await sleep(300);
  check('late slider painted from its value (25%)', await js("document.getElementById('zz-late').style.getPropertyValue('--range-fill')"), '25%');
  await js("document.getElementById('zz-late').value = 150; true");
  check('late slider repaints on write (75%)', await js("document.getElementById('zz-late').style.getPropertyValue('--range-fill')"), '75%');
  await js("document.getElementById('zz-late').remove(); true");

  console.log('\n[5] other tabs');
  for (const tab of ['find', 'test', 'review', 'viz', 'settings', 'eq']) {
    await js(`App.switchTab('${tab}')`); await sleep(500);
    check(`tab ${tab}: all fills match`, await js(STALE), '');
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 150000);
