// Settings > Library > Reset: the one destructive control in the app, so it is
// verified against the REAL main.js rather than a stubbed bridge.
//
//   npx electron tools/verify-factory-reset.js
//
// The profile is a throwaway directory, so this never touches the developer's
// own settings or reviews, and app.isPackaged is overridden so the IEM-Data half
// of the reset (only used by the installed app) runs too.
//
// What it pins down:
//   * the Library row offers exactly Backup / Restore / Reset - the old "Clear
//     workspace" and "Delete reviews" buttons are gone, along with their
//     handlers, so neither can come back as a half-reset.
//   * Cancel really cancels: reviews and IEM-Data survive and the app does not
//     restart.
//   * Confirm erases both halves (Chromium storage and the IEM-Data folder) and
//     relaunches. The storage check reads back from a FRESH document, because a
//     live page can still hold the deleted store in memory and report it as
//     present.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
// The profile has to be a throwaway (this suite wipes it). Chromium keeps its
// LevelDB files open until the process exits, so the shared helper sweeps the
// previous runs' directories instead of trying to remove this one.
const PROFILE = require('./lib/verify-profile').isolateProfile('factory-reset');
// The suite stubs app.exit to observe the reset's restart path, and that stub
// outlives the checks. Electron's own exit is captured first so the suite can
// still end: process.exit() alone left this process alive (the runner then
// waited for its 180s watchdog on every run).
const nativeExit = app.exit.bind(app);
app.getAppPath = () => ROOT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

try {
  // The installed app keeps a writable IEM-Data folder beside the bundled
  // database. Point the app at the temp profile as though it were packaged so
  // the reset's disk half is exercised as shipped.
  Object.defineProperty(app, 'isPackaged', { configurable: true, get: () => true });
} catch (e) {
  console.log('  NOTE  could not override app.isPackaged; the IEM-Data half will be skipped (' + e.message + ')');
}
const IEM_DATA = path.join(PROFILE, 'IEM-Data');
fs.mkdirSync(path.join(IEM_DATA, 'data', 'probe'), { recursive: true });
fs.writeFileSync(path.join(IEM_DATA, 'database.json'), '[]');
fs.writeFileSync(path.join(IEM_DATA, 'data', 'probe', 'x.txt'), '20 80\n');
fs.writeFileSync(path.join(IEM_DATA, '.iem-working-copy.json'), '{}');

require(path.join(ROOT, 'main.js'));

setTimeout(() => { console.log('WATCHDOG TIMEOUT'); process.exit(2); }, 180000);

(async () => {
  await app.whenReady();
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(500); }
  if (!win) { console.log('  FAIL  no window created by main.js'); return process.exit(1); }
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const booted = async () => {
    // DBCache is a bundle-scope const, not a window property; the review reads
    // below reach it by name because executeJavaScript runs in the page scope.
    for (let i = 0; i < 80; i++) { if (await js("!!(window.App && window.IEM) && typeof DBCache === 'object'") === true) return true; await sleep(500); }
    return false;
  };
  if (!await booted()) { console.log('  FAIL  app never booted'); return process.exit(1); }
  await sleep(2500);
  await js("App.switchTab('settings')");
  await sleep(1200);

  console.log('\n[1] the Library row offers Backup, Restore and Reset only');
  const row = await js(`(() => {
    const label = Array.from(document.querySelectorAll('#pane-settings .settings-row-label')).find(e => e.textContent.trim() === 'Library');
    if (!label) return { err: 'no Library row' };
    const r = label.closest('.settings-row');
    return {
      buttons: Array.from(r.querySelectorAll('button')).map(b => b.textContent.trim()),
      actions: Array.from(r.querySelectorAll('button')).map(b => b.getAttribute('data-action'))
    };
  })()`);
  check('three buttons', (row.buttons || []).length, 3);
  check('labelled Backup / Restore / Reset', (row.buttons || []).join(','), 'Backup,Restore,Reset');
  check('the half-reset controls are gone',
    await js("document.querySelectorAll('#pane-settings [data-action=\\\"click_49_IEM_resetAll\\\"], #pane-settings [data-action=\\\"click_1001_IEM_deleteSavedReviews\\\"]').length"), 0);
  check('the new action is registered',
    await js("typeof EventBinding.get('click_1011_App_factoryReset')"), 'function');
  check('the old handlers are gone too',
    await js("(() => { if (typeof EventBinding === 'undefined') return 'missing'; return (EventBinding.get('click_49_IEM_resetAll') || EventBinding.get('click_1001_IEM_deleteSavedReviews')) ? 'present' : 'absent'; })()"), 'absent');

  console.log('\n[2] the seed the reset must erase');
  const seeded = await js(`(async () => {
    localStorage.setItem('probe_keep_me', 'yes');
    await DBCache.init();
    await DBCache.saveReview({ id: 'probe-review', brand: 'Probe', model: 'Review' });
    return (await DBCache.getAllReviews()).length;
  })()`);
  check('a saved review exists', seeded, 1);
  check('and IEM-Data is on disk', fs.existsSync(path.join(IEM_DATA, 'database.json')), true);

  console.log('\n[3] cancelling the dialog changes nothing');
  let relaunched = 0, exited = null;
  app.relaunch = () => { relaunched++; };
  app.exit = (code) => { exited = code === undefined ? 0 : code; };
  await js("document.querySelector('[data-action=\\\"click_1011_App_factoryReset\\\"]').click()");
  await sleep(500);
  const dlg = await js(`(() => {
    const m = document.getElementById('uikit-confirm-modal');
    return { shown: !!m && !m.classList.contains('hidden'),
             title: document.getElementById('uikit-confirm-title').textContent.trim(),
             msg: document.getElementById('uikit-confirm-msg').textContent,
             ok: document.getElementById('uikit-confirm-ok').textContent.trim() };
  })()`);
  check('the confirmation opens', dlg.shown, true);
  check('it names the factory reset', /factory defaults/i.test(dlg.title), true);
  check('it lists reviews', /Saved reviews/i.test(dlg.msg), true);
  check('it lists presets and settings', /presets/i.test(dlg.msg) && /setting/i.test(dlg.msg), true);
  check('it lists database edits', /Database entries/i.test(dlg.msg), true);
  check('it warns that it cannot be undone', /cannot be undone/i.test(dlg.msg), true);
  check('the confirm button says what it does', dlg.ok, 'Reset everything');
  await js("document.getElementById('uikit-confirm-cancel').click()");
  await sleep(800);
  check('cancel keeps the review', await js("(async () => (await DBCache.getAllReviews()).length)()"), 1);
  check('cancel keeps the setting', await js("localStorage.getItem('probe_keep_me')"), 'yes');
  check('cancel keeps IEM-Data', fs.existsSync(path.join(IEM_DATA, 'database.json')), true);
  check('cancel does not restart the app', relaunched, 0);

  console.log('\n[4] confirming wipes both halves and restarts');
  await js("document.querySelector('[data-action=\\\"click_1011_App_factoryReset\\\"]').click()");
  await sleep(400);
  await js("document.getElementById('uikit-confirm-ok').click()");
  for (let i = 0; i < 40 && !relaunched; i++) await sleep(250);
  check('the app asked to restart', relaunched, 1);
  check('with a clean exit code', exited, 0);
  check('localStorage is empty', await js("localStorage.length"), 0);
  check('IndexedDB stores are deleted', await js("(async () => { try { return (await indexedDB.databases()).length; } catch (e) { return 'unsupported'; } })()"), 0);
  check('IEM-Data is removed', fs.existsSync(IEM_DATA), false);

  console.log('\n[5] a fresh document sees a fresh app');
  // The live page kept its deleted store in memory during [4]; only a new
  // document reads what actually survived the wipe.
  await win.webContents.reloadIgnoringCache();
  if (!await booted()) { console.log('  FAIL  app did not come back after the reload'); return process.exit(1); }
  await sleep(2500);
  check('saved reviews are gone', await js("(async () => (await DBCache.getAllReviews()).length)()"), 0);
  check('the probe setting is gone', await js("localStorage.getItem('probe_keep_me')"), null);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  console.log('  (temp profile kept until the next run sweeps it: ' + PROFILE + ')');
  try { win.destroy(); } catch (e) {}
  nativeExit(failures === 0 ? 0 : 1);
})();
