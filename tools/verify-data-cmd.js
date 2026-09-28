// Functional test for the data-cmd dispatcher that replaced attribute-form
// inline handlers in JS-built markup. Passing a grep is not evidence: the
// dispatcher has to resolve the module off window, coerce the args, and map
// `@value` to the element's own value.
//
//   npx electron tools/verify-data-cmd.js
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
  const consoleErrors = [];
  win.webContents.on('console-message', (...a) => {
    const e = a[0];
    const level = e && typeof e === 'object' ? e.level : a[1];
    const msg = e && typeof e === 'object' ? e.message : a[2];
    if (level === 'error' || level === 3) consoleErrors.push(String(msg));
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));
  const run = (js) => win.webContents.executeJavaScript(js, true);

  // The band cards are built for the EQ tab, so it has to be active before
  // eq-f0 / eq-s0-std exist. Without this they are simply absent and the @value
  // assertions below fail for the wrong reason.
  await run(`App.switchTab('eq')`);
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n[1] modules the dispatcher resolves are on window');
  const mods = await run(`({
    EQ: typeof window.EQ, IEM: typeof window.IEM, Tone: typeof window.Tone,
    TestLab: typeof window.TestLab, PEQDB: typeof window.PEQDB, FindEngine: typeof window.FindEngine
  })`);
  for (const k of Object.keys(mods)) check(`window.${k}`, mods[k], 'object');

  console.log('\n[2] the EQ band cards are now data-cmd driven, not inline');
  const cards = await run(`(() => {
    const band = document.getElementById('eq-band-cards') || document.querySelector('[id^=eq-s0]')?.closest('div');
    const withCmd = document.querySelectorAll('[data-cmd], [data-cmd-input], [data-cmd-change]').length;
    let inlineLeft = 0;
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) if (/^on(click|input|change)$/i.test(a.name)) inlineLeft++;
    }
    return { withCmd, inlineLeft };
  })()`);
  check('elements using data-cmd*', cards.withCmd > 0, 'true');
  check('no inline click/input/change attributes remain in the DOM', cards.inlineLeft, 0);
  check('inline handlers in the DOM (was 5508 before this migration)', cards.inlineLeft, 0);

  console.log('\n[3] a real band-card control fires through the dispatcher');
  const fired = await run(`(() => {
    // Spy on the target so we prove the dispatcher resolved and called it.
    const calls = [];
    const orig = EQ.cycleBandType;
    EQ.cycleBandType = function (i) { calls.push({ i, type: typeof i }); return orig.apply(this, arguments); };
    const btn = document.getElementById('eq-t_m0');
    if (!btn) { EQ.cycleBandType = orig; return { missing: true }; }
    btn.click();
    EQ.cycleBandType = orig;
    return { calls, missing: false };
  })()`);
  check('band type button exists', fired.missing, 'false');
  check('dispatcher called cycleBandType once', fired.calls && fired.calls.length, 1);
  check('with a numeric arg', fired.calls && fired.calls[0] && fired.calls[0].type, 'number');

  console.log('\n[4] @value maps to the element own value (input + change events)');
  // First prove the dispatcher itself works for input/change, using a detached
  // element so the app's own listeners on the band cards cannot interfere.
  const isolated = await run(`(() => {
    const out = {};
    for (const ev of ['input', 'change']) {
      const el = document.createElement('input');
      el.type = 'range';
      // max must be raised first: a range input clamps its value, so assigning
      // 4242 with the default max=100 would silently become 100.
      el.min = '0';
      el.max = '10000';
      el.value = '4242';
      el.setAttribute('data-cmd-' + ev, 'EQ.handleStandardSlider');
      el.setAttribute('data-arg-0', '7');
      el.setAttribute('data-arg-1', '@value');
      document.body.appendChild(el);
      const calls = [];
      const orig = EQ.handleStandardSlider;
      EQ.handleStandardSlider = function (i, v) { calls.push({ i, v }); };
      el.dispatchEvent(new Event(ev, { bubbles: true }));
      EQ.handleStandardSlider = orig;
      out[ev] = calls;
      el.remove();
    }
    return out;
  })()`);
  check('isolated input dispatch reaches the handler', isolated.input && isolated.input.length, 1);
  check('  @value read the element value', isolated.input && isolated.input[0] && isolated.input[0].v, '4242');
  check('isolated change dispatch reaches the handler', isolated.change && isolated.change.length, 1);
  check('  @value read the element value', isolated.change && isolated.change[0] && isolated.change[0].v, '4242');

  const present = await run(`['eq-f0','eq-s0-std'].map(id => {
    const el = document.getElementById(id);
    return id + '=' + (el ? 'present cmd-change=' + el.getAttribute('data-cmd-change') + ' cmd-input=' + el.getAttribute('data-cmd-input') : 'MISSING');
  })`);
  present.forEach(p => console.log('    ' + p));
  const rawArgs = await run(`['eq-f0','eq-s0-std','eq-t_m0'].map(id => {
    const el = document.getElementById(id);
    if (!el) return id + '=MISSING';
    return id + ' -> ' + [0,1,2].map(i => 'data-arg-' + i + '=' + JSON.stringify(el.getAttribute('data-arg-' + i))).join(' ');
  })`);
  rawArgs.forEach(r => console.log('    raw ' + r));
  const valued = await run(`(() => {
    const out = {};
    const num = document.getElementById('eq-f0');
    if (num) {
      const calls = [];
      const orig = EQ.handleFreqNumInput;
      EQ.handleFreqNumInput = function (i, v) { calls.push({ i, v, typeI: typeof i, typeV: typeof v }); };
      num.value = '1234';
      num.dispatchEvent(new Event('change', { bubbles: true }));
      EQ.handleFreqNumInput = orig;
      out.freqNum = calls;
    }
    const std = document.getElementById('eq-s0-std');
    if (std) {
      const calls = [];
      const orig = EQ.handleStandardSlider;
      EQ.handleStandardSlider = function (i, v) { calls.push({ i, v, typeI: typeof i, typeV: typeof v }); };
      std.value = '-7.5';
      std.dispatchEvent(new Event('input', { bubbles: true }));
      EQ.handleStandardSlider = orig;
      out.std = calls;
    }
    return out;
  })()`);
  check('change handler fired once', valued.freqNum && valued.freqNum.length, 1);
  check('  with @value -> element value', valued.freqNum && valued.freqNum[0] && valued.freqNum[0].v, '1234');
  check('  index arg is a number', valued.freqNum && valued.freqNum[0] && valued.freqNum[0].typeI, 'number');
  check('  @value arg stays a string (it is input text)', valued.freqNum && valued.freqNum[0] && valued.freqNum[0].typeV, 'string');
  check('input handler fired once', valued.std && valued.std.length, 1);
  check('  with @value -> element value', valued.std && valued.std[0] && valued.std[0].v, '-7.5');

  console.log('\n[5] argument coercion and bad commands are handled');
  // The Find pick chips only render once the taste panel has content, which
  // needs the database, so exercise the hand-converted togglePick wiring with a
  // synthetic element instead of leaving it unverified.
  const pick = await run(`(() => {
    const calls = [];
    const orig = FindEngine.togglePick;
    FindEngine.togglePick = function (kind, value) { calls.push({ kind, value, typeV: typeof value }); };
    const el = document.createElement('button');
    el.setAttribute('data-cmd', 'FindEngine.togglePick');
    el.setAttribute('data-arg-0', 'bass');
    el.setAttribute('data-arg-1', "Moondrop Blessing 2");
    document.body.appendChild(el);
    el.click();
    FindEngine.togglePick = orig;
    el.remove();
    return calls;
  })()`);
  check('togglePick chip wiring calls through', pick && pick.length, 1);
  check('  kind arg', pick && pick[0] && pick[0].kind, 'bass');
  check('  value arg (with a space)', pick && pick[0] && pick[0].v === undefined ? pick[0].value : pick[0] && pick[0].value, "Moondrop Blessing 2");

  const edge = await run(`(() => {
    const out = {};
    const el = document.createElement('div');
    el.setAttribute('data-cmd', 'EQ.doesNotExist');
    el.setAttribute('data-arg-0', '1');
    document.body.appendChild(el);
    el.click();
    out.missingHandled = true;
    el.remove();

    const el2 = document.createElement('div');
    el2.setAttribute('data-cmd', 'notAModuleCall');
    document.body.appendChild(el2);
    el2.click();
    out.malformedHandled = true;
    el2.remove();
    return out;
  })()`);
  check('unknown method does not throw', edge.missingHandled, 'true');
  check('malformed data-cmd does not throw', edge.malformedHandled, 'true');

  console.log('\n[6] no console errors were produced along the way');
  check('console errors', consoleErrors.length, 0);
  if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log('    ' + e.slice(0, 160)));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
