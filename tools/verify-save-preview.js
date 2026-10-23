// Functional test for the Database tab's save preview.
//
//   npx electron tools/verify-save-preview.js
//
// A save overwrites database.json, so it is confirmed with a diff of exactly
// what changes. This suite drives the real tab and asserts:
//   1. saving a clean database writes nothing and says so
//   2. one edited entry is listed by name, with the row count unchanged
//   3. Cancel writes nothing; the dialog comes back on the next Save
//   4. confirming writes once, and the preview then reports no changes
//   5. a deletion is listed and the confirm button carries the danger style
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
function checkIncludes(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${ok ? 'found' : 'MISSING'} ${JSON.stringify(needle)} in ${JSON.stringify(String(haystack).slice(0, 200))}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1500, height: 850, show: true, webPreferences: { backgroundThrottling: false } });
  // Surface renderer errors: a failing click reports as an uncaught error in the
  // page, which executeJavaScript then only reports as "Script failed to execute".
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) console.log('  [renderer] ' + message);
  });
  // The memory-mode save "downloads" the pair. Cancel the download at the
  // session layer so the test never writes files, while the app still takes its
  // normal post-write path.
  win.webContents.session.on('will-download', (e) => e.preventDefault());
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  const js = (code) => win.webContents.executeJavaScript(code, true).catch((e) => {
    console.log(`  [js error] ${e && e.message}\n             while evaluating: ${code.slice(0, 160)}`);
    throw e;
  });

  for (let i = 0; i < 60; i++) {
    if (await js("!!document.getElementById('top-nav-bar')").catch(() => false)) break;
    await sleep(500);
  }
  await js("localStorage.clear()");
  // No leftover working copy, or the tab would offer to restore it.
  await js("DataStore.init().then(() => DataStore.kvDelete('working'))");
  await js("App.switchTab('database')");

  let loaded = false;
  for (let i = 0; i < 80; i++) {
    if (await js("!!document.querySelector('#dt-tree .dt-item') && !!document.getElementById('dt-e-price_usd')").catch(() => false)) { loaded = true; break; }
    await sleep(500);
  }
  console.log('\n[0] the Database tab loads');
  check('tree rows and editor are present', loaded, true);
  if (!loaded) { console.log('\nFAILED (database never loaded)'); return app.exit(1); }

  // Count writes without changing how the app writes.
  await js("window.__saves = 0; (function(){ const o = DataStore.saveDatabase; DataStore.saveDatabase = function(){ window.__saves++; return o.apply(this, arguments); }; })()");
  // The confirm modal is built on first use, so "no dialog" includes "not built".
  const modalHidden = "(() => { const m = document.getElementById('uikit-confirm-modal'); return !m || m.classList.contains('hidden'); })()";
  const detailText = "(document.getElementById('uikit-confirm-details') || {}).textContent || ''";
  const clickSave = "document.querySelector('[data-dt=\"save\"]').click()";

  console.log('\n[1] a clean database writes nothing');
  await js(clickSave);
  await sleep(400);
  check('no confirm dialog', await js(modalHidden), true);
  check('saveDatabase not called', await js('window.__saves'), 0);
  checkIncludes('the user is told why', await js("document.getElementById('toast-stack').textContent"), 'No changes to save');

  console.log('\n[2] one edited entry is listed before the write');
  await js("document.querySelector('#dt-tree .dt-item').click()");
  await sleep(500);
  const label = (await js("document.getElementById('dt-e-title').textContent")).trim();
  const price = await js("document.getElementById('dt-e-price_usd').value");
  await js(`(() => { const el = document.getElementById('dt-e-price_usd'); el.value = ${Number(price) + 5}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(150);
  await js("document.querySelector('[data-dt=\"apply\"]').click()");
  await sleep(600);
  check('the edit is applied', await js("document.getElementById('dt-e-price_usd').value"), Number(price) + 5);

  await js(clickSave);
  await sleep(500);
  check('dialog is visible', await js('!' + modalHidden), true);
  check('title counts the change', (await js("document.getElementById('uikit-confirm-title').textContent")).trim(), '💾 Save 1 change?');
  checkIncludes('message shows the row counts', await js("document.getElementById('uikit-confirm-msg').textContent"), '→ 5,309 entries');
  checkIncludes('message names the files', await js("document.getElementById('uikit-confirm-msg').textContent"), 'database.json + database.json.gz');
  checkIncludes('details name the edited entry', await js(detailText), label);
  checkIncludes('details say what kind of change', await js(detailText), '1 edited entry');
  checkIncludes('the row shows the field delta', await js("document.querySelector('#uikit-confirm-details .uikit-detail-row').textContent"), `Price: $${price} → $${Number(price) + 5}`);
  check('the list is visible', await js("document.getElementById('uikit-confirm-details').classList.contains('hidden')"), false);

  console.log('\n[2b] a listed entry is a button that jumps to that entry');
  // Move away first, so the jump back to the edited entry is observable: search
  // narrows the tree to another brand, which also means the jump has to clear
  // the search to reveal its row.
  await js("(() => { const s = document.getElementById('dt-search'); s.value = 'Moondrop'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(600);
  await js("document.querySelector('#dt-tree .dt-item').click()");
  await sleep(500);
  check('a different entry is open', (await js("document.getElementById('dt-e-title').textContent")).trim() === label, false);
  await js(clickSave);
  await sleep(500);
  check('the row is a real button', await js("(document.querySelector('#uikit-confirm-details .uikit-detail-row') || { tagName: '' }).tagName"), 'BUTTON');
  check('only the changed entry is clickable', await js("document.querySelectorAll('#uikit-confirm-details [data-detail-id]').length"), 1);
  check('the row is styled as clickable', await js("getComputedStyle(document.querySelector('#uikit-confirm-details .uikit-detail-row')).cursor"), 'pointer');
  await js("document.querySelector('#uikit-confirm-details .uikit-detail-row').click()");
  await sleep(700);
  check('the dialog closes', await js(modalHidden), true);
  check('jumping writes nothing', await js('window.__saves'), 0);
  check('the listed entry is open in the editor', (await js("document.getElementById('dt-e-title').textContent")).trim(), label);
  check('and selected in the tree', await js("!!document.querySelector('#dt-tree .dt-item.is-sel')"), true);
  check('the search that hid it was cleared', await js("document.getElementById('dt-search').value"), '');

  console.log('\n[3] Cancel writes nothing and the dialog returns');
  await js(clickSave);
  await sleep(500);
  check('dialog is visible', await js('!' + modalHidden), true);
  await js("document.getElementById('uikit-confirm-cancel').click()");
  await sleep(300);
  check('dialog closed', await js(modalHidden), true);
  check('still nothing written', await js('window.__saves'), 0);
  await js(clickSave);
  await sleep(400);
  check('the pending change is still offered', await js('!' + modalHidden), true);

  console.log('\n[4] confirming writes once, then reports no changes');
  await js("document.getElementById('uikit-confirm-ok').click()");
  await sleep(1200);
  check('written once', await js('window.__saves'), 1);
  checkIncludes('the tab reports the save', await js("document.querySelector('#dt-banner-slot').textContent"), 'Downloaded');
  await js(clickSave);
  await sleep(400);
  check('no dialog now that the file matches', await js(modalHidden), true);
  check('no second write', await js('window.__saves'), 1);

  console.log('\n[5] a deletion is listed, and the confirm is styled as destructive');
  await js("document.querySelector('#dt-tree .dt-item').click()");
  await sleep(500);
  await js("document.querySelector('[data-dt=\"del\"]').click()");
  await sleep(400);
  check('delete asks first', await js('!' + modalHidden), true);
  await js("document.getElementById('uikit-confirm-ok').click()");
  await sleep(600);
  await js(clickSave);
  await sleep(500);
  check('dialog is visible', await js('!' + modalHidden), true);
  checkIncludes('details say what is removed', await js(detailText), '1 deleted entry');
  checkIncludes('the count goes down', await js("document.getElementById('uikit-confirm-msg').textContent"), '5,309 → 5,308 entries');
  checkIncludes('the confirm button is the danger colour', await js("document.getElementById('uikit-confirm-ok').style.background"), '--danger');
  check('the destructive default is Cancel', await js("document.activeElement && document.activeElement.id"), 'uikit-confirm-cancel');

  await js("document.getElementById('uikit-confirm-cancel').click()");
  await sleep(300);
  check('cancel keeps the entry', await js("document.querySelectorAll('#dt-tree .dt-item').length > 0"), true);
  check('nothing written by the cancelled save', await js('window.__saves'), 1);

  console.log('\n[6] desktop mode names the files and warns when the file has moved');
  // A save in the packaged app writes site files and copies the previous pair to
  // backup/, and it compares against the file on disk at save time. Drive that
  // branch with the read seam; the write path itself belongs to the store suite.
  await js(`(async () => {
    const r = await DataStore.readDatabase();
    window.__diskText = r.text;
    DataStore.state.mode = 'electron';
    DataStore.readDatabase = async () => ({ text: window.__diskText, source: 'database.json', gzStale: false });
    return true;
  })()`);
  await js(clickSave);
  await sleep(500);
  check('dialog is visible', await js('!' + modalHidden), true);
  checkIncludes('details name the pending deletion', await js(detailText), '1 deleted entry');
  checkIncludes('details warn about the moved file', await js(detailText), 'changed on disk since this tab loaded it');
  checkIncludes('message says where the files go', await js("document.getElementById('uikit-confirm-msg').textContent"), 'Writes database.json + database.json.gz. The current files are copied to backup/ first.');
  checkIncludes('message shows the size delta', await js("document.getElementById('uikit-confirm-msg').textContent"), 'MB → ');
  await js("document.getElementById('uikit-confirm-cancel').click()");
  await sleep(300);
  check('nothing written', await js('window.__saves'), 1);

  console.log('\n[7] the save log records what the save wrote');
  await js("document.getElementById('dt-right-tab-export').click()");
  await sleep(400);
  const exportText = "document.getElementById('dt-ex-body').textContent";
  checkIncludes('the Export panel has a save log', await js(exportText), 'Recent saves');
  check('one save was recorded, the cancelled ones were not', await js("document.querySelectorAll('[data-dt=\"log-open\"]').length"), 1);
  checkIncludes('the row summarises the change', await js("document.querySelector('[data-dt=\"log-open\"]').textContent"), '～1');
  await js("document.querySelector('[data-dt=\"log-open\"]').click()");
  await sleep(250);
  checkIncludes('expanding it lists the entry', await js(exportText), label);
  checkIncludes('and what changed', await js(exportText), `Price: $${price} → $${Number(price) + 5}`);
  check('the log is persisted', await js("DataStore.kvGet('saveLog').then(l => (Array.isArray(l) ? l.length : -1))"), 1);

  console.log('\n[7b] the log survives a reload');
  // Poll with a fresh probe: the old js() helper rejects while the page unloads.
  const probe = (code) => win.webContents.executeJavaScript(code, true).catch(() => false);
  await probe('location.reload()');
  for (let i = 0; i < 60; i++) { if (await probe("!!document.getElementById('top-nav-bar')")) break; await sleep(500); }
  await probe("App.switchTab('database')");
  for (let i = 0; i < 80; i++) { if (await probe("!!document.querySelector('#dt-tree .dt-item')")) break; await sleep(500); }
  await probe("document.getElementById('dt-right-tab-export').click()");
  await sleep(600);
  check('the log is reloaded with the tab', await probe("document.querySelectorAll('[data-dt=\"log-open\"]').length"), 1);
  checkIncludes('and still shows the summary', await probe("document.getElementById('dt-ex-body').textContent"), '～1');

  console.log('\n[8] the log exports as a Markdown changelog');
  // This harness runs the page over HTTP with no preload bridge, so the app is
  // in memory mode and hands the file to the browser (the session's
  // will-download handler cancels it, so nothing reaches the disk). Wrap the
  // store call to read the Markdown, then run the real write path behind it.
  await probe("(() => { window.__md = null; const real = DataStore.writeSaveLog; DataStore.writeSaveLog = function (text) { window.__md = { text: String(text) }; return real.apply(this, arguments).then(r => { window.__md.name = r.name; window.__md.mode = r.mode; return r; }); }; })()");
  check('the panel offers a Markdown export', await probe("!!document.querySelector('[data-dt=\"log-export\"]')"), true);
  await probe("document.querySelector('[data-dt=\"log-export\"]').click()");
  await sleep(500);
  check('the file is named save-log.md', await probe('window.__md && window.__md.name'), 'save-log.md');
  const md = await probe('window.__md && window.__md.text');
  checkIncludes('it starts as a Markdown document', md, '# Database save log');
  checkIncludes('it counts the recorded saves', md, '1 save, newest first');
  checkIncludes('it lists the saved entry', md, label);
  checkIncludes('and the field it changed', md, `Price: $${price} → $${Number(price) + 5}`);
  checkIncludes('the save it wrote is marked as this export\u2019s', md, '_added to this changelog on ');
  checkIncludes('the toast says how much of the file is new', await js("document.getElementById('toast-stack').textContent"), 'save-log.md downloaded — 1 new save, 1 in the changelog.');
  checkIncludes('and the panel keeps that after the toast', await js("document.getElementById('dt-ex-body').textContent"), 'Last export: 1 new save, 1 in the changelog');
  check('exporting leaves the log itself alone', await js("document.querySelectorAll('[data-dt=\"log-open\"]').length"), 1);
  // Browser-only: this page has no file on disk, so the viewer shows the copy the
  // export just built and says where the real one went. Nothing here may leave
  // the app, so the OS hand-off is stubbed and counted.
  // The dialog is built on first use, so "closed" here is "not on screen".
  check('the viewer starts closed', await probe("(() => { const v = document.querySelector('#uikit-reader'); return !v || v.classList.contains('hidden'); })()"), true);
  await probe("(() => { window.__opened = 0; DataStore.openSaveLog = async () => { window.__opened++; return { name: 'save-log.md', how: 'opened' }; }; const b = document.querySelector('[data-dt=\"log-open-file\"]'); b.focus(); b.click(); })()");
  await sleep(400);
  check('clicking the changelog opens it inside the app', await probe("document.querySelector('#uikit-reader').classList.contains('hidden')"), false);
  check('and never hands the file to the OS', await probe('window.__opened'), 0);
  // The changelog is drawn as a document: title, export note, one card per save,
  // one row per changed entry - not a single text block.
  check('the changelog renders as structure, not one text block', await probe("!!document.querySelector('#uikit-reader .slv-doc') && !document.querySelector('#uikit-reader-text')"), true);
  check('with the file title at the top', await probe("document.querySelector('#uikit-reader .slv-title').textContent"), 'Database save log');
  check('the export note reads as a note', await probe("document.querySelector('#uikit-reader .slv-note').textContent.includes('newest first')"), true);
  check('one card per save', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  check('headed by when the save happened', await probe("document.querySelector('#uikit-reader .slv-h').textContent.slice(0, 5)"), '2026-');
  check('and where it went', await probe("document.querySelector('#uikit-reader .slv-where').textContent"), 'downloaded');
  checkIncludes('the counts line is kept', await probe("document.querySelector('#uikit-reader .slv-meta').textContent"), 'entries');
  check('the changed entry is a row with its mark', await probe("document.querySelector('#uikit-reader .slv-row .slv-mark').textContent"), '～');
  check('named as the panel names it', await probe("document.querySelector('#uikit-reader .slv-row .slv-name').textContent"), label);
  checkIncludes('with the change beside it', await probe("document.querySelector('#uikit-reader .slv-row .slv-detail').textContent"), '→');
  checkIncludes('and the provenance this export wrote', await probe("[...document.querySelectorAll('#uikit-reader .slv-note')].map(n => n.textContent).join('|')"), 'added to this changelog on');
  check('the changes can be filtered in place', await probe("document.querySelectorAll('#uikit-reader-tools .slv-fbtn').length"), 3);
  check('and searched', await probe("!!document.querySelector('#uikit-reader-tools .slv-search')"), true);
  checkIncludes('and the bar counts what is shown', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), '1 save · 1 change');
  checkIncludes('and says where this copy came from', await probe("document.getElementById('uikit-reader-sub').textContent"), 'The exported copy · read-only');
  check('browser-only offers nothing but reading', await probe("[...document.querySelectorAll('#uikit-reader-actions button')].map(b => b.textContent).join('|')"), 'Close');
  // The search box is the only field: the document itself is read-only text.
  check('nothing in the document can be edited', await probe("document.querySelectorAll('#uikit-reader-body input, #uikit-reader-body textarea, #uikit-reader-body [contenteditable]').length"), 0);
  check('the text can be selected and copied', await probe("getComputedStyle(document.querySelector('#uikit-reader-body')).userSelect"), 'text');
  await probe("document.querySelector('#uikit-reader-close').click()");
  await sleep(200);
  check('Close dismisses it', await probe("document.querySelector('#uikit-reader').classList.contains('hidden')"), true);

  // A changelog already beside the database is merged, not replaced. The store
  // read is stubbed with one save the 20-row log no longer holds, which is the
  // case that matters: an export must not erase history to fit the panel.
  const oldFile = '# Database save log\n\n_1 save, newest first — exported from the Data tab on 2026-10-01 09:00._\n\n' +
    '## 2026-10-01 09:00 — saved to disk\n\n5,100 entries · 2.90 MB · ＋2\n\n- ＋ Old Save Entry — $10 · 1DD · 1 file\n';
  await probe(`(() => { DataStore.readSaveLog = async () => ${JSON.stringify(oldFile)}; })()`);
  await probe("document.querySelector('[data-dt=\"log-export\"]').click()");
  await sleep(500);
  const merged = await probe('window.__md && window.__md.text');
  checkIncludes('an existing changelog is merged, not replaced', merged, '- ＋ Old Save Entry');
  checkIncludes('the new save is added to it', merged, label);
  checkIncludes('and the header counts the whole file', merged, '2 saves, newest first');
  check('only the newly added save is marked', (merged.match(/_added to this changelog on/g) || []).length, 1);
  checkIncludes('the panel counts the whole file', await js("document.getElementById('dt-ex-body').textContent"), 'Last export: 1 new save, 2 in the changelog');

  console.log('\n[9] the changelog on disk is visible when the tab opens');
  // Reloading the tab re-runs the load path, which reads save-log.md itself. The
  // stub holds three saves while the panel's own list has one, so the count can
  // only come from the file.
  const onDisk = '# Database save log\n\n_3 saves, newest first — exported from the Data tab on 2026-10-20 12:00._\n\n' +
    '## 2026-10-20 11:00 — saved to disk\n\n5,100 entries · 2.90 MB · ＋1 －1\n\n- ＋ One <b>bold</b>\n- － Gone for good\n\n' +
    '## 2026-10-19 09:00 — saved to folder\n\n5,000 entries · 2.80 MB · ～1\n\n- ～ Two — Price: $20 → $25\n\n' +
    '## 2026-09-30 08:00 — downloaded\n\n4,900 entries · 2.70 MB · ～1\n\n- ～ Three\n';
  await probe(`(() => { DataStore.readSaveLog = async () => ${JSON.stringify(onDisk)}; })()`);
  await probe("document.querySelector('[data-dt=\"reload-db\"]').click()");
  await sleep(400);
  if (await probe('!' + modalHidden)) await probe("document.getElementById('uikit-confirm-ok').click()");
  for (let i = 0; i < 80; i++) { if (await probe("!!document.querySelector('#dt-tree .dt-item')")) break; await sleep(500); }
  await probe("document.getElementById('dt-right-tab-export').click()");
  await sleep(600);
  const status = await probe("document.getElementById('dt-ex-body').textContent");
  checkIncludes('the panel shows the file it will merge into', status, 'save-log.md');
  checkIncludes('with the count and when it was last written', status, '3 saves · last updated Oct 20');
  check('and the load forgot the previous export report', await probe("document.getElementById('dt-ex-body').textContent.includes('Last export: 1 new save, 2 in the changelog')"), false);

  // The status is a control: it opens the file, which is the only way to read the
  // saves the 20-row list no longer holds.
  check('the status line is a button', await probe("!!document.querySelector('[data-dt=\"log-open-file\"]')"), true);
  await probe("(() => { const b = document.querySelector('[data-dt=\"log-open-file\"]'); b.focus(); b.click(); })()");
  await sleep(400);
  checkIncludes('the reader shows the file on disk, not just this session', await probe("document.querySelector('#uikit-reader-body').textContent"), '2026-10-19 09:00');
  checkIncludes('with the size of the whole changelog', await probe("document.getElementById('uikit-reader-sub').textContent"), '3 saves · last updated Oct 20');
  check('reading it still never hands the file to the OS', await probe('window.__opened'), 0);
  check('the reader carries the saves the panel list dropped', await probe("document.querySelector('#uikit-reader-body').textContent.includes('One')"), true);
  check('every save in the file gets its own card', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 3);
  check('each card keeps its heading', await probe("[...document.querySelectorAll('#uikit-reader .slv-h')].map(h => h.textContent).join('|')"), '2026-10-20 11:00|2026-10-19 09:00|2026-09-30 08:00');
  check('and says where that save went', await probe("[...document.querySelectorAll('#uikit-reader .slv-where')].map(h => h.textContent).join('|')"), 'saved to disk|saved to folder|downloaded');
  check('one row per changed entry', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 4);
  // A file can hold anything: markup in a name is text in the viewer, never DOM.
  check('markup in the file is shown, not executed', await probe("(() => { const n = document.querySelector('#uikit-reader .slv-name'); return n.textContent + '|' + !!document.querySelector('#uikit-reader b'); })()"), 'One <b>bold</b>|false');
  // Styled, not just wrapped: the app stylesheet has to reach the dialog too.
  check('each save is drawn as a card', await probe("(() => { const s = getComputedStyle(document.querySelector('#uikit-reader .slv-sec')); const b = getComputedStyle(document.querySelector('#uikit-reader-body')); return s.backgroundColor !== b.backgroundColor && s.borderTopWidth !== '0px'; })()"), true);
  check('the add / change marks are colour-coded', await probe("(() => { const m = document.querySelectorAll('#uikit-reader .slv-mark'); return m.length === 4 && getComputedStyle(m[0]).color !== getComputedStyle(m[1]).color; })()"), true);
  check('and carry the row weight', await probe("getComputedStyle(document.querySelector('#uikit-reader .slv-mark')).fontWeight"), '700');

  // Filtering narrows the document on screen only - the file is never rewritten.
  check('the viewer offers the three views', await probe("[...document.querySelectorAll('#uikit-reader-tools .slv-fbtn')].map(b => b.textContent).join('|')"), 'All|＋ Additions|－ Removals');
  check('and only the months the file holds', await probe("[...document.querySelectorAll('#uikit-reader-tools .slv-month option')].map(o => o.value).join('|')"), 'all|2026-10|2026-09');
  checkIncludes('the bar counts the whole file', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), '3 saves · 4 changes');
  await probe("document.querySelector('[data-slv-kind=\"add\"]').click()");
  await sleep(200);
  check('Additions keeps only added rows', await probe("[...document.querySelectorAll('#uikit-reader .slv-row')].map(r => r.className.replace('slv-row slv-', '')).join('|')"), 'add');
  check('and only the saves that added something', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  check('the active view is marked', await probe("document.querySelector('[data-slv-kind=\"add\"]').classList.contains('is-on')"), true);
  checkIncludes('the count admits what is hidden', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), 'Showing 1 of 3 saves · 1 change');
  checkIncludes('and the card says so too', await probe("document.querySelector('#uikit-reader .slv-text').textContent"), 'Showing 1 of 2 changes this save lists');
  await probe("document.querySelector('[data-slv-kind=\"del\"]').click()");
  await sleep(200);
  check('Removals keeps only removed rows', await probe("[...document.querySelectorAll('#uikit-reader .slv-row')].map(r => r.className.replace('slv-row slv-', '')).join('|')"), 'del');
  check('named as the file saved it', await probe("document.querySelector('#uikit-reader .slv-name').textContent"), 'Gone for good');
  // Month and kind combine; choosing a month narrows what "all" means.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = '2026-10'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(200);
  check('a month keeps only that month', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  check('and the removal view is still active', await probe("document.querySelector('[data-slv-kind=\"del\"]').classList.contains('is-on')"), true);
  // A month drops whole saves, so it says so once above them rather than on
  // every card - otherwise a short document looks like a short file.
  // A hidden month carries the picker's own count where that number sets it
  // apart, so the line says which one is worth switching to and not only that it
  // exists.
  check('the month explains itself above the cards', await probe("document.querySelector('#uikit-reader .slv-scope').textContent"), 'Only saves from Oct 2026 (2 saves) are shown; Sep 2026 (1 save) is hidden.');
  check('in its own line, not inside a card', await probe("!!document.querySelector('#uikit-reader-body .slv-scope + .slv-sec')"), true);
  check('and the file\u2019s note still comes first', await probe("document.querySelector('#uikit-reader .slv-note').textContent.includes('newest first')"), true);
  await probe("document.querySelector('[data-slv-kind=\"all\"]').click()");
  await sleep(200);
  check('All inside a month shows every change in it', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 3);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = '2026-09'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(200);
  check('another month shows its own save', await probe("document.querySelector('#uikit-reader .slv-h').textContent"), '2026-09-30 08:00');
  check('and names itself in the note', await probe("document.querySelector('#uikit-reader .slv-scope').textContent"), 'Only saves from Sep 2026 (1 save) are shown; Oct 2026 (2 saves) is hidden.');
  // The number in the note is the number in the menu beside it, not a second
  // count that could drift from what the picker offers.
  check('and the hidden count matches the picker\u2019s', await probe("(() => { const o = document.querySelector('#uikit-reader-tools .slv-month option[value=\"2026-10\"]'); return o.textContent + '|' + document.querySelector('#uikit-reader .slv-scope').textContent; })()"), 'Oct 2026 · 2 saves|Only saves from Sep 2026 (1 save) are shown; Oct 2026 (2 saves) is hidden.');
  // The shown month states its own count too, and from the same place: it is the
  // number the hidden ones are read against, so it cannot be the odd one out.
  check('and the shown count matches its own option', await probe("(() => { const o = document.querySelector('#uikit-reader-tools .slv-month option[value=\"2026-09\"]'); return o.textContent + '|' + document.querySelector('#uikit-reader .slv-scope').textContent; })()"), 'Sep 2026 · 1 save|Only saves from Sep 2026 (1 save) are shown; Oct 2026 (2 saves) is hidden.');
  // The note also says what the picker can show, so a narrowed document is not
  // mistaken for a file that has nothing else in it.
  const manyMonths = '# Database save log\n\n_6 saves, newest first._\n\n' +
    '## 2026-10-20 11:00 — saved to disk\n\n5,100 entries · ＋1\n\n- ＋ One\n\n' +
    '## 2026-09-30 08:00 — downloaded\n\n4,900 entries · ＋1\n\n- ＋ Sep\n\n' +
    '## 2026-08-30 08:00 — downloaded\n\n4,800 entries · ＋1\n\n- ＋ Aug\n\n' +
    '## 2026-08-14 08:00 — saved to disk\n\n4,750 entries · ＋1\n\n- ＋ Aug again\n\n' +
    '## 2026-07-30 08:00 — downloaded\n\n4,700 entries · ＋1\n\n- ＋ Jul\n\n' +
    '## 2026-06-30 08:00 — downloaded\n\n4,600 entries · ＋1\n\n- ＋ Jun\n';
  await probe("document.querySelector('#uikit-reader-close').click()");
  await sleep(250);
  await probe(`(() => { DataStore.readSaveLog = async () => ${JSON.stringify(manyMonths)}; })()`);
  await probe("document.querySelector('[data-dt=\"log-open-file\"]').click()");
  await sleep(450);
  // Named in date order, oldest first, like the changelog itself - the picker
  // beside it stays newest first. The last name carries the marker, so the
  // month a reader is most likely to switch to is not lost in the "and" clause;
  // "the others" scopes it to the hidden months, so it cannot be read as the
  // file's newest save.
  // Only Aug holds a count no other hidden month shares, so it is the only name
  // that carries one: Jun, Jul and Oct would each repeat "1 save" back to back.
  check('the note lists every other month the file holds', await probe("document.querySelector('#uikit-reader .slv-scope').textContent"), 'Only saves from Sep 2026 (1 save) are shown; Jun 2026, Jul 2026, Aug 2026 (2 saves) and Oct 2026 (the newest of the others) are hidden.');
  // Choosing the newest month leaves the marker on the newest *hidden* one, so it
  // never points at a month the note is not about.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = '2026-10'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(200);
  check('the marker follows the list, not the file', await probe("document.querySelector('#uikit-reader .slv-scope').textContent"), 'Only saves from Oct 2026 (1 save) are shown; Jun 2026, Jul 2026, Aug 2026 (2 saves) and Sep 2026 (the newest of the others) are hidden.');
  // When every hidden month holds the same number, the count separates nothing:
  // the line drops them all instead of repeating one number three times.
  const evenMonths = '# Database save log\n\n_4 saves, newest first._\n\n' +
    '## 2026-10-20 11:00 — saved to disk\n\n5,100 entries · ＋1\n\n- ＋ One\n\n' +
    '## 2026-09-30 08:00 — downloaded\n\n4,900 entries · ＋1\n\n- ＋ Sep\n\n' +
    '## 2026-08-30 08:00 — downloaded\n\n4,800 entries · ＋1\n\n- ＋ Aug\n\n' +
    '## 2026-07-30 08:00 — downloaded\n\n4,700 entries · ＋1\n\n- ＋ Jul\n';
  await probe("document.querySelector('#uikit-reader-close').click()");
  await sleep(250);
  await probe(`(() => { DataStore.readSaveLog = async () => ${JSON.stringify(evenMonths)}; })()`);
  await probe("document.querySelector('[data-dt=\"log-open-file\"]').click()");
  await sleep(450);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = '2026-09'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(200);
  check('counts that all agree are left out', await probe("document.querySelector('#uikit-reader .slv-scope').textContent"), 'Only saves from Sep 2026 (1 save) are shown; Jul 2026, Aug 2026 and Oct 2026 (the newest of the others) are hidden.');
  await probe("(() => { DataStore.readSaveLog = async () => " + JSON.stringify(onDisk) + "; })()");
  await probe("document.querySelector('#uikit-reader-close').click()");
  await sleep(250);
  await probe("document.querySelector('[data-dt=\"log-open-file\"]').click()");
  await sleep(450);
  await probe("document.querySelector('[data-slv-kind=\"del\"]').click()");
  await sleep(200);
  checkIncludes('an empty result says so rather than looking like an empty file', await probe("document.querySelector('#uikit-reader .slv-text').textContent"), 'Nothing in save-log.md matches this filter');
  check('the file\u2019s own note stays above it', await probe("document.querySelector('#uikit-reader .slv-note').textContent.includes('newest first')"), true);
  await probe("document.querySelector('[data-slv-kind=\"all\"]').click()");
  await sleep(200);

  // Search is a third, independent narrowing: the text is matched against the
  // row's entry name and its change detail.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(200);
  check('every month needs no such note', await probe("document.querySelectorAll('#uikit-reader .slv-scope').length"), 0);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.focus(); s.value = 'price'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a search matches the change detail', await probe("[...document.querySelectorAll('#uikit-reader .slv-name')].map(n => n.textContent).join('|')"), 'Two');
  check('and keeps only the save that holds it', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  checkIncludes('the count reflects the search', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), 'Showing 1 of 3 saves · 1 change');
  check('the caret stays in the search box', await probe("document.activeElement === document.querySelector('#uikit-reader-tools .slv-search')"), true);
  // Esc in the field is the browser's own clear, not "close the document".
  await probe("document.querySelector('#uikit-reader-tools .slv-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(150);
  check('Esc inside the search box does not close the viewer', await probe("!document.querySelector('#uikit-reader').classList.contains('hidden')"), true);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'TWO'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a search matches the entry name, ignoring case', await probe("[...document.querySelectorAll('#uikit-reader .slv-name')].map(n => n.textContent).join('|')"), 'Two');
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'zzz'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  checkIncludes('a search with no match says so', await probe("document.querySelector('#uikit-reader .slv-text').textContent"), 'Nothing in save-log.md matches this filter');
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('clearing the search restores every row', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 4);
  // A save is findable by when and where it happened too, which is how someone
  // looks for a save they remember the destination of - not the entry in it.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'folder'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a search matches where a save went', await probe("document.querySelector('#uikit-reader .slv-where').textContent"), 'saved to folder');
  check('and keeps only that save', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  check('with every change it lists', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 1);
  check('the card names the text that found it', await probe("document.querySelector('#uikit-reader .slv-found').textContent"), 'found by its destination \u201Cfolder\u201D');
  // Quoted back exactly as typed, not folded: the match is case-insensitive, but
  // the label has to show the reader their own text.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'FOLDER'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('in the casing it was typed', await probe("document.querySelector('#uikit-reader .slv-found').textContent"), 'found by its destination \u201CFOLDER\u201D');
  check('while the match itself ignores case', await probe("document.querySelectorAll('#uikit-reader .slv-sec').length"), 1);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'disk'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a save matched by its heading keeps its rows', await probe("[...document.querySelectorAll('#uikit-reader .slv-row .slv-mark')].map(m => m.textContent).join('|')"), '\uFF0B|\uFF0D');
  check('and the card no longer claims to hide anything', await probe("document.querySelectorAll('#uikit-reader .slv-text').length"), 0);
  check('and still says why its rows are all here', await probe("document.querySelector('#uikit-reader .slv-found').textContent"), 'found by its destination \u201Cdisk\u201D');
  checkIncludes('the count counts that whole save', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), 'Showing 1 of 3 saves · 2 changes');
  check('a save match obeys the kind filter too', await probe("(() => { document.querySelector('[data-slv-kind=\"del\"]').click(); return document.querySelectorAll('#uikit-reader .slv-row').length + '|' + document.querySelector('#uikit-reader .slv-name').textContent; })()"), '1|Gone for good');
  check('and its label stays while the kind filter narrows it', await probe("document.querySelector('#uikit-reader .slv-found').textContent"), 'found by its destination \u201Cdisk\u201D');
  await sleep(150);
  await probe("document.querySelector('[data-slv-kind=\"all\"]').click()");
  await sleep(150);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = '2026-09'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a date finds a save by its heading', await probe("document.querySelector('#uikit-reader .slv-h').textContent"), '2026-09-30 08:00');
  check('and shows what that save changed', await probe("document.querySelector('#uikit-reader .slv-name').textContent"), 'Three');
  check('labelled as a match on its date, not its entries', await probe("document.querySelector('#uikit-reader .slv-found').textContent"), 'found by its date \u201C2026-09\u201D');
  check('the label sits on the card it explains', await probe("!!document.querySelector('#uikit-reader .slv-sec > .slv-head .slv-found')"), true);
  check('and explains itself on hover', await probe("document.querySelector('#uikit-reader .slv-found').title"), 'The search text matched this save’s date, not an entry in it.');
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('clearing it again restores the whole file', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 4);
  // A row match explains itself: no label, because the row that matched is drawn.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'price'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('a row match carries no such label', await probe("document.querySelectorAll('#uikit-reader .slv-found').length"), 0);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);

  // Closing the changelog does not throw the view away: reopening it resumes the
  // kind, month and search it was left in, so a long file is not scrolled again.
  await probe("document.querySelector('[data-slv-kind=\"add\"]').click()");
  await sleep(150);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-month'); s.value = '2026-10'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(150);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'one'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(350);
  check('the narrowed view holds one row', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 1);
  check('and is remembered in view storage', await probe("!!SafeStorage.getItem('iem_savelog_filter_v1')"), true);
  await probe("document.querySelector('#uikit-reader-close').click()");
  await sleep(250);
  await probe("document.querySelector('[data-dt=\"log-open-file\"]').click()");
  await sleep(450);
  check('reopening resumes the additions view', await probe("document.querySelector('[data-slv-kind=\"add\"]').classList.contains('is-on')"), true);
  check('with its month', await probe("document.querySelector('#uikit-reader-tools .slv-month').value"), '2026-10');
  check('and its search text', await probe("document.querySelector('#uikit-reader-tools .slv-search').value"), 'one');
  check('so the same row is showing', await probe("[...document.querySelectorAll('#uikit-reader .slv-name')].map(n => n.textContent).join('|')"), 'One <b>bold</b>');
  checkIncludes('and the bar still admits what is hidden', await probe("document.querySelector('#uikit-reader-tools .slv-count').textContent"), 'Showing 1 of 3 saves · 1 change');
  // Remembering two of three narrowings must not lose the third.
  check('a remembered narrowing still leaves the rest of its save listed', await probe("document.querySelector('#uikit-reader .slv-text').textContent.includes('Showing 1 of 2 changes this save lists')"), true);
  // A month the file no longer holds would open on an empty document that looks
  // broken, so it is dropped and the whole file is shown instead.
  await probe("(() => { SafeStorage.setItem('iem_savelog_filter_v1', JSON.stringify({ kind: 'all', month: '2026-01', query: '' })); document.querySelector('#uikit-reader-close').click(); })()");
  await sleep(250);
  await probe("document.querySelector('[data-dt=\"log-open-file\"]').click()");
  await sleep(450);
  check('a month the file no longer holds falls back to every month', await probe("document.querySelector('#uikit-reader-tools .slv-month').value"), 'all');
  check('so the whole changelog is still readable', await probe("document.querySelectorAll('#uikit-reader .slv-row').length"), 4);
  check('and the stale memory is corrected, not left behind', await probe("SafeStorage.getItem('iem_savelog_filter_v1') === null"), true);
  // Showing everything is not a view worth restoring: the next read starts whole.
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = 'gone'; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(300);
  await probe("document.querySelector('[data-slv-kind=\"all\"]').click()");
  await sleep(150);
  await probe("(() => { const s = document.querySelector('#uikit-reader-tools .slv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(300);
  check('a view showing everything is forgotten', await probe("SafeStorage.getItem('iem_savelog_filter_v1') === null"), true);
  // The installed app keeps the hand-off as a secondary action. The mode is
  // switched only so that button is drawn; the read is the same stubbed file.
  await probe("(() => { window.__mode = DataStore.state.mode; DataStore.state.mode = 'electron'; document.querySelector('[data-dt=\"log-open-file\"]').click(); })()");
  await sleep(400);
  check('the desktop view offers opening in a Markdown app', await probe("[...document.querySelectorAll('#uikit-reader-actions button')].map(b => b.textContent).join('|')"), 'Open in Markdown app|Close');
  await probe("document.querySelectorAll('#uikit-reader-actions button')[0].click()");
  await sleep(400);
  check('which uses the existing hand-off', await probe('window.__opened'), 1);
  checkIncludes('and reports what happened', await js("document.getElementById('toast-stack').textContent"), 'Opened save-log.md.');
  await probe("(() => { DataStore.state.mode = window.__mode; UIKit.closeReader(); })()");
  await sleep(200);
  // Esc closes, with focus back on the control that opened it.
  await probe("(() => { const b = document.querySelector('[data-dt=\"log-open-file\"]'); b.focus(); b.click(); })()");
  await sleep(300);
  await probe("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(200);
  check('the viewer is gone after Esc', await probe("document.querySelector('#uikit-reader').classList.contains('hidden')"), true);
  check('and focus is back on the status line', await probe("document.activeElement && document.activeElement.getAttribute('data-dt')"), 'log-open-file');

  await js("document.querySelector('[data-dt=\"log-clear\"]').click()");
  await sleep(400);
  check('clearing asks first', await js('!' + modalHidden), true);
  await js("document.getElementById('uikit-confirm-ok').click()");
  await sleep(500);
  checkIncludes('the log is emptied', await js(exportText), 'Every save records what it changed here');
  check('and forgotten in storage', await js("DataStore.kvGet('saveLog').then(l => (l || []).length)"), 0);
  checkIncludes('the changelog line outlives the list it was showing beside', await js(exportText), '3 saves · last updated Oct 20');
  check('the export button goes with it', await js("document.querySelectorAll('[data-dt=\"log-export\"]').length"), 0);

  console.log(failures ? `\nSAVE PREVIEW FAILED (${failures} check(s))` : '\nSAVE PREVIEW PASSED');
  app.exit(failures ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
