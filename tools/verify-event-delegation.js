// Functional test for the inline-handler migration.
//
// The 13 inline on*= attributes were replaced with data-action-focus /
// -dragover / -dragleave / -drop delegations in events.js. Passing a grep is not
// evidence the events actually fire, and drag-and-drop in particular depends on
// dragover calling preventDefault() or the browser refuses the drop entirely.
//
//   npx electron tools/verify-event-delegation.js
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

  console.log('\n[1] the 13 migrated elements carry no inline on*= attribute');
  // Deliberately NOT a whole-document count: the app injects ~5,600 inline
  // on*= attributes at runtime from JS template strings (see
  // tools/find-inline-injectors.js), which is separate pre-existing debt.
  // This asserts the specific elements that were migrated.
  const migrated = ['brand', 'find-taste-search', 'find-gk-search', 'find-upgrade-search', 'base-slot', 'target-slot', 'reference-pile'];
  const stillInline = await run(`(() => {
    const bad = [];
    for (const id of ${JSON.stringify(migrated)}) {
      const el = document.getElementById(id);
      if (!el) { bad.push(id + '=MISSING'); continue; }
      for (const a of el.attributes) if (/^on/i.test(a.name)) bad.push(id + ':' + a.name);
    }
    return bad;
  })()`);
  check('inline attributes on the 7 migrated elements', JSON.stringify(stillInline), '[]');

  console.log('\n[2] focus delegation routes to the right action');
  // Spying on EventBinding.execute proves the delegation fires and picks the
  // right attribute, without depending on module internals.
  //
  // Synthetic FocusEvent for all four so the result does not depend on which
  // panel happens to be visible (a real .focus() on a display:none input is a
  // no-op, which is what made an earlier version of this test flaky). Real
  // .focus() is asserted separately below so the non-bubbling capture path is
  // still exercised for real.
  const focusRes = await run(`(() => {
    const seen = [];
    const orig = EventBinding.execute;
    EventBinding.execute = function (action) { seen.push(action); return orig.apply(this, arguments); };
    for (const id of ['brand', 'find-taste-search', 'find-gk-search', 'find-upgrade-search']) {
      const e = document.getElementById(id);
      if (e) e.dispatchEvent(new FocusEvent('focus'));
    }
    return seen;
  })()`);
  check('focus routed 4 actions', focusRes.length, 4);
  check('focus actions, in order', JSON.stringify(focusRes), JSON.stringify([
    'focus_900_IEM_updateBrandSuggestions',
    'focus_901_FindEngine_handleTasteSearch',
    'focus_902_FindEngine_handleGkSearch',
    'focus_903_FindEngine_handleUpgradeSearch'
  ]));

  console.log('\n[2a] the input is genuinely focusable, and focus reaches the delegation');
  // Asserted as two separate things on purpose. A real .focus() only dispatches
  // a focus event when the document itself has focus, which a headless or
  // background window does not guarantee - that was an intermittent failure
  // which had nothing to do with the delegation. Focusability is the property
  // this change owns, so it is asserted directly; the event path is already
  // proven by the synthetic dispatch in step [2].
  const focusable = await run(`(() => {
    const el = document.getElementById('find-taste-search');
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    return {
      missing: false,
      tabIndex: el.tabIndex,
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      display: cs.display,
      visibility: cs.visibility
    };
  })()`);
  check('input exists', focusable.missing, false);
  check('is in the tab order (tabIndex >= 0)', focusable.tabIndex >= 0, 'true');
  check('not disabled', focusable.disabled, 'false');
  check('not hidden by display/visibility', focusable.display !== 'none' && focusable.visibility !== 'hidden', 'true');

  const realFocus = await run(`(() => {
    const seen = [];
    const orig = EventBinding.execute;
    EventBinding.execute = function (action) { seen.push(action); return orig.apply(this, arguments); };
    const el = document.getElementById('find-taste-search');
    el.focus();
    return { seen, docHadFocus: document.hasFocus(), active: document.activeElement === el };
  })()`);
  if (realFocus.docHadFocus) {
    check('real focus fired the taste action', JSON.stringify(realFocus.seen), '["focus_901_FindEngine_handleTasteSearch"]');
  } else {
    console.log('  SKIP  real-focus event: the document does not have focus in this window,');
    console.log('        so .focus() dispatches nothing. Focusability is asserted above and the');
    console.log('        event path is covered by the synthetic dispatch in step [2].');
  }

  console.log('\n[2b] the focus handler bodies reach their module functions');
  // IEM is a window property, but FindEngine and PEQDB_Module are script-scoped
  // `const` bindings (see find-engine.js line 4) and are NOT on window - which is
  // why they must be referenced as bare identifiers here. Inline handlers could
  // see them for the same reason, so the original onfocus="FindEngine...." worked.
  const bodies = await run(`(() => {
    const out = {};
    const IEMmod = IEM;
    const FEmod = FindEngine;
    const probes = [
      [IEMmod, 'updateBrandSuggestions', 'focus_900_IEM_updateBrandSuggestions', 'brand'],
      [FEmod, 'handleTasteSearch', 'focus_901_FindEngine_handleTasteSearch', 'find-taste-search'],
      [FEmod, 'handleGkSearch', 'focus_902_FindEngine_handleGkSearch', 'find-gk-search'],
      [FEmod, 'handleUpgradeSearch', 'focus_903_FindEngine_handleUpgradeSearch', 'find-upgrade-search']
    ];
    for (const [M, fn, action, inputId] of probes) {
      if (!M || typeof M[fn] !== 'function') { out[fn] = 'module/function missing'; continue; }
      const orig = M[fn];
      const calls = [];
      M[fn] = function (v) { calls.push(v); };
      try {
        // Run the registered handler body directly, with this bound to a real input.
        const el = document.getElementById(inputId) || document.createElement('input');
        el.value = 'probe-' + fn;
        EventBinding.get(action).call(el, new Event('focus'), el);
        out[fn] = calls.length === 1 && calls[0] === el.value ? 'ok' : 'called ' + JSON.stringify(calls);
      } catch (e) {
        out[fn] = 'THREW: ' + e.message;
      } finally {
        M[fn] = orig;
      }
    }
    return out;
  })()`);
  for (const fn of ['updateBrandSuggestions', 'handleTasteSearch', 'handleGkSearch', 'handleUpgradeSearch']) {
    check(`handler body calls ${fn} with this.value`, bodies[fn], 'ok');
  }

  console.log('\n[3] drag delegation: highlight, reset, and correct slot routing');
  const dragRes = await run(`(() => {
    const calls = [];
    const origDrop = PEQDB_Module.handleDrop;
    PEQDB_Module.handleDrop = function (ev, slot) { calls.push(slot); };
    PEQDB_Module.handleDrop.__orig = origDrop;

    const fire = (el, type) => {
      const dt = new DataTransfer();
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(ev);
      return ev;
    };

    const out = {};
    for (const id of ['base-slot', 'target-slot', 'reference-pile']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = 'missing'; continue; }
      el.style.borderColor = '';
      const over = fire(el, 'dragover');
      const highlighted = el.style.borderColor;
      const expected = el.getAttribute('data-drop-border');
      const prevented = over.defaultPrevented;
      fire(el, 'dragleave');
      const afterLeave = el.style.borderColor;
      fire(el, 'drop');
      out[id] = {
        highlighted: highlighted === expected,
        got: highlighted, expected,
        prevented,
        afterLeave,
        slot: el.getAttribute('data-drop-slot')
      };
    }
    out.calls = calls;
    PEQDB_Module.handleDrop = origDrop;
    return out;
  })()`);

  for (const id of ['base-slot', 'target-slot', 'reference-pile']) {
    const r = dragRes[id];
    check(`${id}: dragover applied its own highlight colour`, r && r.highlighted, true);
    check(`${id}: dragover called preventDefault (else the drop is rejected)`, r && r.prevented, true);
    check(`${id}: dragleave reset the border`, r && r.afterLeave === '' ? '""' : JSON.stringify(r && r.afterLeave), '""');
  }
  check('handleDrop routed to the right slots', JSON.stringify(dragRes.calls), '["base","target","reference"]');

  console.log('\n[4] EventBinding registered the new event types');
  const reg = await run(`({
    focus: typeof EventBinding.get('focus_900_IEM_updateBrandSuggestions'),
    dragover: typeof EventBinding.get('dragover_904_EQ_highlightDropSlot'),
    dragleave: typeof EventBinding.get('dragleave_905_EQ_unhighlightDropSlot'),
    drop: typeof EventBinding.get('drop_906_EQ_handleSlotDrop')
  })`);
  check('focus handler registered', reg.focus, 'function');
  check('dragover handler registered', reg.dragover, 'function');
  check('dragleave handler registered', reg.dragleave, 'function');
  check('drop handler registered', reg.drop, 'function');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
