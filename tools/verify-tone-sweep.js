// Verifies the Auto Sweep button reflects its state. It previously used
// querySelector('button[onclick="Tone.toneSweep()"]'), which never matched — the
// button is wired via data-action and has no inline onclick — so the label and
// the is-on class silently never changed during a sweep.
//
//   npx electron tools/verify-tone-sweep.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

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
  await new Promise(r => setTimeout(r, 2500));
  const run = (js) => win.webContents.executeJavaScript(js, true);

  // No audio hardware here, so stub the oscillator: this test is about the
  // button's label/class, not about sound.
  const setup = await run(`(() => {
    window.alert = () => false;
    const ctx = SharedAudio.init ? SharedAudio.init() : null;
    Tone.osc = ctx ? ctx.createOscillator() : { frequency: { value: 0 }, connect() {}, disconnect() {}, stop() {} };
    Tone.gain = ctx ? ctx.createGain() : { gain: { value: 0 }, connect() {}, disconnect() {} };
    try { Tone.osc.start && Tone.osc.start(); } catch (e) {}
    const b = document.getElementById('tone-sweep-btn');
    return b ? 'found' : 'BUTTON MISSING';
  })()`);
  console.log('\n[1] the Auto Sweep button is addressable by id');
  check('button lookup', setup, 'found');

  const before = await run(`(() => { const b = document.getElementById('tone-sweep-btn'); return { label: b.textContent.trim(), on: b.classList.contains('is-on') }; })()`);
  check('initial label', before.label, 'Auto Sweep');
  check('initial is-on', before.on, 'false');

  console.log('\n[2] starting a sweep flips the label and the is-on class');
  await run(`Tone.toneSweep()`).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
  const during = await run(`(() => { const b = document.getElementById('tone-sweep-btn'); return { label: b.textContent.trim(), on: b.classList.contains('is-on'), timer: !!Tone.sweepTimer }; })()`);
  check('sweep timer started', during.timer, 'true');
  check('label during sweep', during.label, 'Stop Sweep');
  check('is-on during sweep', during.on, 'true');

  console.log('\n[3] stopping restores the label and clears is-on');
  await run(`Tone.toneStop()`).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const after = await run(`(() => { const b = document.getElementById('tone-sweep-btn'); return { label: b.textContent.trim(), on: b.classList.contains('is-on'), timer: !!Tone.sweepTimer }; })()`);
  check('sweep timer cleared', after.timer, 'false');
  check('label after stop', after.label, 'Auto Sweep');
  check('is-on after stop', after.on, 'false');

  console.log('\n[4] no leftover onclick-based lookups in the sources');
  // Comment lines are excluded on purpose: the fix documents the old lookup in a
  // comment, and a naive substring count would flag its own explanation.
  const leftovers = await run(`fetch('app/js/tone-module.js').then(r => r.text()).then(t => {
    const re = /querySelector\\('button\\[onclick=/g;
    let n = 0;
    for (const line of t.split('\\n')) {
      const s = line.trim();
      if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue;
      n += (line.match(re) || []).length;
    }
    return n;
  })`);
  check('onclick-based button lookups in code', leftovers, 0);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
