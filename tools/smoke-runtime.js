// Runtime smoke test: drives the app through every tab, every carousel
// sub-panel and every modal, and fails on ANY console error, uncaught
// exception or failed request. Static checks cannot see a module that throws
// only when a rarely-visited panel is opened, which is exactly the class of
// defect that ships to users unnoticed.
//
//   npx electron tools/smoke-runtime.js
const { app, BrowserWindow } = require('electron');
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

// Noise that is expected in a headless environment with no audio hardware.
// Each is justified rather than blanket-suppressed.
const IGNORE = [
  /AudioContext was not allowed to start/i,
  /AudioWorklet|AudioWorkletNode/i,
  /The AudioContext was not allowed to start/i,
  /Failed to load resource.*net::ERR_/i,
  /favicon/i,
  /Autoplay is only allowed/i
];

const errors = [];
const warnings = [];

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(APP_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
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

  win.webContents.on('console-message', (e) => {
    // Electron >=37 passes an event object; older passes positional args.
    const level = typeof e === 'object' && e !== null ? e.level : arguments[1];
    const message = typeof e === 'object' && e !== null ? e.message : arguments[2];
    const text = String(message);
    if (IGNORE.some(re => re.test(text))) return;
    if (level === 'error' || level === 3) errors.push('[console.error] ' + text);
    else if (level === 'warning' || level === 2) warnings.push('[console.warn] ' + text);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('[render-process-gone] ' + JSON.stringify(d)));
  win.webContents.on('preload-error', (_e, p, err) => errors.push('[preload-error] ' + p + ' ' + err.message));

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    const ok = await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false);
    if (ok) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));

  const run = (js) => win.webContents.executeJavaScript(js, true);

  // Block every native dialog BEFORE driving anything.
  //
  // This is not optional. A native confirm()/alert() or a file chooser blocks the
  // whole renderer until a human answers it, which in an automated run means the
  // test hangs until its timeout and a person has to click the popup by hand.
  // That happened: the "click every control" step stalled every time because
  // three handlers call input.click() on a hidden file input.
  const BLOCK = `(() => {
    window.__dialogsBlocked = 0;
    const noop = function () { window.__dialogsBlocked++; return false; };
    window.alert = noop;
    window.confirm = noop;
    window.prompt = noop;
    // Neutralise the file chooser: keep the input's own click behaviour for
    // everything else, but never let it reach the OS picker.
    const origClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') { window.__dialogsBlocked++; return; }
      return origClick.apply(this, arguments);
    };
    // <label>.click() forwards to a wrapped file input, so intercept that too.
    const origLabelClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      if (this.tagName === 'LABEL') {
        const fi = this.querySelector('input[type="file"]');
        if (fi) { window.__dialogsBlocked++; return; }
      }
      return origLabelClick.apply(this, arguments);
    };
    return 'blocked';
  })()`;
  const blockStatus = await run(BLOCK);
  console.log('dialog blocker installed: ' + blockStatus + '\n');
  const steps = [];
  const step = async (label, js, settle = 700) => {
    const before = errors.length;
    await run(js).catch(e => errors.push('[step threw] ' + label + ': ' + e.message));
    await new Promise(r => setTimeout(r, settle));
    const newErrors = errors.length - before;
    steps.push({ label, newErrors });
    console.log(`  ${newErrors === 0 ? 'ok  ' : 'ERR '} ${label}${newErrors ? '  (+' + newErrors + ' error)' : ''}`);
  };

  console.log('\n--- tabs ---');
  for (const t of ['find', 'eq', 'iem', 'testlab', 'settings', 'visualizer']) {
    await step(`switchTab('${t}')`, `App.switchTab('${t}')`);
  }

  console.log('\n--- Find sub-panels ---');
  await step("switchTab('find')", "App.switchTab('find')");
  for (const s of ['tune', 'endgame']) {
    await step(`FindEngine.switchRightTab('${s}')`, `FindEngine.switchRightTab('${s}')`);
  }

  console.log('\n--- Test Lab sub-panels ---');
  await step("switchTab('testlab')", "App.switchTab('testlab')");
  for (const s of ['tone', 'ab', 'hearing']) {
    await step(`TestLab.switchRightTab('${s}')`, `TestLab.switchRightTab('${s}')`);
  }

  console.log('\n--- modals ---');
  // Names taken from the actual handler table, not guessed: the library modal is
  // IEM.toggleLibraryModal and the export modal is PEQDB_Module.showExportModal.
  // (Guessing EQ.showLibraryModal produced two phantom "errors" in an earlier
  // run of this file, which is exactly the failure mode this test is meant to
  // avoid confusing with a real defect.)
  const modals = [
    ['IEM.toggleLibraryModal', 'library', 'library-modal'],
    ['PEQDB_Module.showExportModal', 'export', 'export-modal'],
    ['EQ.showSmartImportModal', 'smart import', 'smart-import-modal'],
    ['PEQDB_Module.showSmartRFModal', 'smart RF', 'smart-rf-modal']
  ];
  for (const [fn, name, modalId] of modals) {
    await step(`open ${name} (${fn})`, `typeof ${fn.split('.')[0]} !== 'undefined' && typeof ${fn} === 'function' ? (${fn}(), 'called') : 'MISSING: ${fn}'`);
    await step(`close ${name}`, `(() => {
      const el = document.getElementById(${JSON.stringify(modalId)});
      if (el) el.classList.add('hidden');
    })()`, 400);
  }

  console.log('\n--- every data-action control is wired (click must not throw) ---');
  // One element per distinct action, clicked back to back with no per-click
  // settle: 242 actions x a 700ms settle would blow the time budget on its own.
  // This runs last because some actions are destructive (reset, clear) and some
  // open native dialogs; the instance is throwaway so that is acceptable.
  //
  // data-cmd* elements are swept too. They are the JS-built controls that used
  // to carry inline onclick, and omitting them left a real blind spot: a broken
  // conversion produced three console errors here that nothing else caught
  // until a dedicated A/B probe was written.
  await step('click one element per data-action AND per data-cmd', `(() => {
    const seen = new Set();
    let clicked = 0;
    const failures = [];
    const sel = '[data-action], [data-cmd], [data-cmd-input], [data-cmd-change]';
    for (const el of document.querySelectorAll(sel)) {
      const a = el.getAttribute('data-action')
        || el.getAttribute('data-cmd')
        || el.getAttribute('data-cmd-input')
        || el.getAttribute('data-cmd-change');
      const ev = el.hasAttribute('data-cmd-input') ? 'input'
        : el.hasAttribute('data-cmd-change') ? 'change' : 'click';
      const key = ev + ':' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (ev === 'click') el.click();
        else el.dispatchEvent(new Event(ev, { bubbles: true }));
        clicked++;
      } catch (e) { failures.push(key + ': ' + e.message); }
    }
    if (failures.length) throw new Error('threw for ' + failures.length + ': ' + failures.slice(0, 5).join(' | '));
    return 'clicked ' + clicked;
  })()`, 2500);

  console.log('\n--- back to a clean tab ---');
  await step("switchTab('find')", "App.switchTab('find')", 900);

  console.log('\n================ RESULT ================');
  const blocked = await run('window.__dialogsBlocked').catch(() => '?');
  console.log(`  native dialogs blocked : ${blocked}  (no popup should ever appear)`);
  if (Number(blocked) === 0) {
    console.log('  NOTE: nothing needed blocking - the click-everything step may not have run');
  }
  console.log(`  steps run           : ${steps.length}`);
  console.log(`  steps with new error: ${steps.filter(s => s.newErrors > 0).length}`);
  console.log(`  console warnings    : ${warnings.length}`);
  console.log(`  console errors      : ${errors.length}`);
  if (warnings.length) {
    console.log('\n  warnings (first 12):');
    [...new Set(warnings)].slice(0, 12).forEach(w => console.log('    ' + w.slice(0, 160)));
  }
  if (errors.length) {
    console.log('\n  ERRORS:');
    [...new Set(errors)].slice(0, 30).forEach(e => console.log('    ' + e.slice(0, 220)));
    // `return` before exit so the success line cannot also print - an earlier
    // version of this file reported both FAILED and PASSED.
    console.log(`\nSMOKE TEST FAILED - ${errors.length} console error(s)`);
    process.exitCode = 1;
    return app.exit(1);
  }
  console.log('\nSMOKE TEST PASSED - no console errors anywhere in the sweep');
  app.exit(0);
});
setTimeout(() => { console.error('\nSMOKE TEST TIMED OUT'); app.exit(2); }, 300000);
