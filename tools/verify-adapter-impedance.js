// Gear Simulator impedance adapters: measured-curve fit, fallbacks, and the
// physics sign. Uses SYNTHETIC impedance files served by the test server only;
// nothing here ships as data.
//
//   npx electron tools/verify-adapter-impedance.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain' };

function curveText(fn) {
  const lines = ['# synthetic test curve', 'Frequency(Hz)  Impedance(ohm)'];
  for (let i = 0; i <= 120; i++) { const f = 20 * Math.pow(2, i / 12); if (f > 20000) break; lines.push(f.toFixed(2) + '\t' + fn(f).toFixed(3)); }
  return lines.join('\n');
}
const FILES = {
  zz_flat: curveText(() => 16),
  // Dynamic-driver-like: 16 ohm baseline with a 60 ohm bass resonance near 100 Hz.
  zz_dd: curveText((f) => 16 + 44 * Math.exp(-Math.pow(Math.log(f / 100), 2) / 0.5)),
  zz_bad: 'this is not an impedance file\nat all'
};
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      const m = /^\/data\/impedance\/(.+)\.txt$/.exec(rel);
      if (m) {
        if (FILES[m[1]]) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(FILES[m[1]]); }
        res.writeHead(404); return res.end();
      }
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
  const win = new BrowserWindow({ width: 1400, height: 850, show: true });
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await sleep(6000);
  await js("App.switchTab('eq')"); await sleep(500);
  await js('(() => { window.__origBaseFn = EQ.getCurrentBaseIemId; return true; })()');
  const opt = (id, field) => js(`(EQ.gearSimOptions.find(g => g.id === '${id}') || {}).${field}`);
  const useIem = (id) => js(`(() => { EQ.getCurrentBaseIemId = () => ${id === null ? 'null' : `'${id}'`}; return EQ.refreshAdapterForCurrentIem().then(() => true); })()`);

  console.log('\n[1] no IEM / no curve: the generic approximation is untouched');
  await js("EQ._adapterApplyCachedFit()");
  check('adapter50 generic bass', await opt('adapter50', 'lowG'), 5);
  check('adapter50 generic label', await opt('adapter50', 'sub'), '+5.0dB Bass Boost');

  console.log('\n[2] DD-like curve (bass impedance peak): physics says bass rises relative to mids');
  await useIem('zz_dd');
  const l50 = await opt('adapter50', 'lowG'), l10 = await opt('adapter10', 'lowG'), l100 = await opt('adapter100', 'lowG');
  console.log(`   fitted low-shelf gain: 10ohm ${l10}, 50ohm ${l50}, 100ohm ${l100}; rms ${(await opt('adapter50', 'fitRmsDb')).toFixed(2)} dB`);
  check('50 ohm gives a clear bass lift', l50 > 3, true);
  check('bigger adapter, bigger lift (10 < 50 < 100)', l10 < l50 && l50 < l100, true);
  check('label says measured', String(await opt('adapter50', 'sub')).includes('measured'), true);
  check('fit error is reported and modest (< 3 dB rms)', (await opt('adapter50', 'fitRmsDb')) < 3, true);
  check('differs from the generic table', l50 !== 5, true);

  console.log('\n[3] flat-impedance IEM: an adapter changes level, not tone');
  await useIem('zz_flat');
  check('bass lift ~0', Math.abs(await opt('adapter50', 'lowG')) < 0.6, true);
  check('treble change ~0', Math.abs(await opt('adapter50', 'highG')) < 0.6, true);

  console.log('\n[4] missing or unreadable curve falls back to generic');
  await useIem('zz_none');
  check('missing file: generic bass', await opt('adapter50', 'lowG'), 5);
  await useIem('zz_bad');
  check('garbage file: generic bass', await opt('adapter50', 'lowG'), 5);
  check('garbage file: generic label', await opt('adapter50', 'sub'), '+5.0dB Bass Boost');

  console.log('\n[5] selected adapter updates the on-screen label and re-fits on IEM change');
  const idx = await js("EQ.gearSimOptions.findIndex(g => g.id === 'adapter50')");
  await js(`EQ.currentGearIdx = ${idx - 1}`);
  await useIem('zz_dd');
  await js("EQ.cycleGearSim(1)"); await sleep(400);
  check('sub label shows measured fit', (await js("document.getElementById('gear-sim-sub-label').textContent")).includes('measured'), true);
  await useIem('zz_none'); await sleep(300);
  check('base IEM change reverts label to generic', await js("document.getElementById('gear-sim-sub-label').textContent"), '+5.0dB Bass Boost');

  console.log('\n[6] base IEM id comes from the active curves');
  const id = await js(`(() => { EQ.getCurrentBaseIemId = window.__origBaseFn; const s = PEQDB_Module.STATE; const keep = s.activeCurves; s.activeCurves = [{ role: 'base', visible: true, id: 'zz_dd' }]; const r = EQ.getCurrentBaseIemId(); s.activeCurves = keep; return r; })()`);
  check('getCurrentBaseIemId', id, 'zz_dd');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 150000);
