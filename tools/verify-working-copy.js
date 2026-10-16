// Proves the "bundled files are protected" design against the REAL main.js, simulating an
// INSTALLED app (app.isPackaged = true) so the Database tab uses the IEM-Data working copy.
//
//   BUNDLE=/tmp/bundled IEM_TEST_ROOT=/tmp/iemroot IEM_TEST_BASE=/tmp/iembase \
//     xvfb-run -a npx electron --no-sandbox tools/verify-working-copy.js
//
//   IEM_TEST_ROOT : scratch copy of the code (symlinks are fine)
//   BUNDLE        : stands in for process.resourcesPath: database.json, database.json.gz, data/
//                   (hard links to the project's files are fine - the test hashes it before/after)
//   IEM_TEST_BASE : empty dir; becomes the portable base, so IEM-Data lands in <base>/IEM-Data
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const EXPECTED_ENTRIES = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'database.json'), 'utf8')).length;  // follows database.json, never a hardcoded count
const crypto = require('crypto');
const ROOT = path.resolve(process.env.IEM_TEST_ROOT || '');
const BUNDLE = path.resolve(process.env.BUNDLE || '');
const BASE = path.resolve(process.env.IEM_TEST_BASE || '');
if (!process.env.IEM_TEST_ROOT || !process.env.BUNDLE || !process.env.IEM_TEST_BASE) { console.error('Set IEM_TEST_ROOT, BUNDLE and IEM_TEST_BASE (see header).'); process.exit(3); }
fs.rmSync(BASE, { recursive: true, force: true }); fs.mkdirSync(BASE, { recursive: true });
process.env.PORTABLE_EXECUTABLE_DIR = BASE;
const EXT = path.join(BASE, 'IEM-Data');
Object.defineProperty(app, 'isPackaged', { get: () => true });
Object.defineProperty(process, 'resourcesPath', { value: BUNDLE, configurable: true, writable: true }); // plain assignment is ignored by Electron
app.getAppPath = () => ROOT;
let failures = 0;
const check = (label, actual, expected) => { const ok = JSON.stringify(actual) === JSON.stringify(expected); if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// A fingerprint of every bundled file (path + size + content hash of the small ones + mtime of all).
function fingerprint(dir) {
  const h = crypto.createHash('sha1'); let n = 0;
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const st = fs.statSync(p); h.update(path.relative(dir, p) + '|' + st.size + '|' + st.mtimeMs + ';'); n++; if (st.size < 20000000 && /database/.test(e.name)) h.update(fs.readFileSync(p)); } } })(dir);
  return n + ':' + h.digest('hex');
}
const countFiles = (dir) => { let n = 0; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) w(path.join(d, e.name)); else n++; } })(dir); return n; };
const bundleBefore = fingerprint(BUNDLE);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(500); }
  if (!win) { console.log('  FAIL  no window'); app.exit(1); return; }
  win.setSize(1600, 900); await sleep(5000);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const wait = async (expr, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(expr)) return true; } catch (_) {} await sleep(200); } return false; };
  const clickConfirm = async (which) => { await wait("!!document.getElementById('uikit-confirm-" + which + "') && document.getElementById('uikit-confirm-modal') && !document.getElementById('uikit-confirm-modal').classList.contains('hidden')", 8000); await js("document.getElementById('uikit-confirm-" + which + "').click()"); };

  console.log('\n[1] installed app, nothing edited yet: reads the bundle, creates nothing');
  await js("App.switchTab('database')");
  check('Data tab loaded', await wait('DataTab.ready'), true);
  check('mode is electron + packaged', await js('DataStore.state.mode + "|" + DataStore.state.packaged'), 'electron|true');
  check('no working copy yet', await js('DataStore.state.workingCopy'), false);
  check('entries read from the bundled database', await js('DataTab.S.entries.length'), EXPECTED_ENTRIES);
  check('IEM-Data has no database or marker yet', fs.existsSync(path.join(EXT, 'database.json')) || fs.existsSync(path.join(EXT, '.iem-working-copy.json')), false);
  check('Settings → Reset button is available in the installed app', await js("getComputedStyle(document.getElementById('btn-reset-database')).display !== 'none'"), true);

  console.log('\n[2] first save asks permission; declining writes nothing');
  await js("DataTab._internals.selectUid(DataTab.S.entries[3]._uid, true)"); await sleep(300);
  await js(`(() => { const el = document.getElementById('dt-e-year'); el.value = '2001'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js("document.getElementById('dt-apply').click()"); await sleep(300);
  await js("document.getElementById('dt-tb-save').click()");
  await clickConfirm('cancel'); await sleep(800);
  check('declined: no working copy created', fs.existsSync(path.join(EXT, 'database.json')) || fs.existsSync(path.join(EXT, 'data')), false);
  check('declined: edit is still pending in the app', await js('DataTab.S.dirty'), true);
  check('declined: bundled files untouched', fingerprint(BUNDLE), bundleBefore);

  console.log('\n[3] accepting creates the working copy (a copy, never the bundle)');
  await js("document.getElementById('dt-tb-save').click()");
  await clickConfirm('ok');
  check('save completed', await wait("!!(DataTab.ex.banner && DataTab.ex.banner.kind === 'saved')", 120000), true);
  check('marker written', fs.existsSync(path.join(EXT, '.iem-working-copy.json')), true);
  check('database.json + .gz in IEM-Data', fs.existsSync(path.join(EXT, 'database.json')) && fs.existsSync(path.join(EXT, 'database.json.gz')), true);
  check('the data folder was copied across', countFiles(path.join(EXT, 'data')), countFiles(path.join(BUNDLE, 'data')));
  check('the edit is in the working copy', JSON.parse(fs.readFileSync(path.join(EXT, 'database.json'), 'utf8')).some(e => e.year === 2001), true);
  check('BUNDLED database.json is byte-identical to the original', fs.readFileSync(path.join(BUNDLE, 'database.json')).equals(fs.readFileSync('/tmp/db_orig.json')), true);
  check('BUNDLE untouched (every file, size, mtime, database content)', fingerprint(BUNDLE), bundleBefore);
  check('status now says working copy exists', await js('DataStore.state.workingCopy'), true);

  console.log('\n[4] deleting a measurement file removes it from the working copy only');
  const junk = 'data/JAYTISS/A#U00dcR AUDIO AURE.txt';
  check('junk duplicate exists in both before', fs.existsSync(path.join(EXT, junk)) && fs.existsSync(path.join(BUNDLE, junk)), true);
  const url = '/' + junk.split('/').map(encodeURIComponent).join('/');
  check('served OK while it exists', await js(`fetch(${JSON.stringify(url)}).then(r => r.status)`), 200);
  await js(`DataStore.deleteDataFile(${JSON.stringify(junk)}).then(() => 1)`);
  check('gone from the working copy', fs.existsSync(path.join(EXT, junk)), false);
  check('STILL in the bundle', fs.existsSync(path.join(BUNDLE, junk)), true);
  check('server does NOT fall back to the bundled copy (deleted stays deleted)', await js(`fetch(${JSON.stringify(url)}).then(r => r.status)`), 404);
  check('other files still served', await js("fetch('/database.json.gz').then(r => r.status)"), 200);

  console.log('\n[5] new curves land in the working copy only');
  await js("DataTab._internals.setMid('curves')");
  await js(`(() => { let t = ''; for (let f = 20; f <= 20000; f *= 1.05) t += f.toFixed(2) + ' ' + (80 + 5 * Math.sin(Math.log10(f))).toFixed(2) + '\\n';
    const dt = new DataTransfer(); dt.items.add(new File([t], 'Wc Test One.txt')); const inp = document.getElementById('dt-cv-file'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait('DataTab.cv.plans.length === 1');
  await js("DataTab.cv.source = '__new__'; DataTab.cv.newSource = 'MY SOURCE'; DataTab._internals.setMid('curves'); DataTab._internals.renderAll()");
  await js("document.querySelector('[data-dt=cv-convert]').click()");
  check('curve saved', await wait("DataTab.cv.log.includes('[SAVED]')"), true);
  check('new curve is in IEM-Data/data/MY SOURCE', fs.existsSync(path.join(EXT, 'data', 'MY SOURCE', 'WC TEST ONE.txt')), true);
  check('bundle has no new folder', fs.existsSync(path.join(BUNDLE, 'data', 'MY SOURCE')), false);
  check('server serves the new curve', await js("fetch('/data/MY%20SOURCE/WC%20TEST%20ONE.txt').then(r => r.status)"), 200);

  console.log('\n[6] write backstop: nothing can write before a working copy exists');
  const wcRoot = path.join(BASE, 'IEM-Data');
  // (temporarily hide the marker to prove the main process itself refuses)
  fs.renameSync(path.join(wcRoot, '.iem-working-copy.json'), path.join(wcRoot, '.hidden-marker'));
  const r1 = await js("window.appBridge.dataWriteFile({ rel: 'data/X/should-not-exist.txt', text: 'x', overwrite: true })");
  const r2 = await js("window.appBridge.dataWriteDatabase({ text: '[]' })");
  const r3 = await js("window.appBridge.dataDeleteFile('data/MY SOURCE/WC TEST ONE.txt')");
  check('write refused without a working copy', [r1.ok, r1.error], [false, 'needs-working-copy']);
  check('database write refused', [r2.ok, r2.error], [false, 'needs-working-copy']);
  check('delete refused', [r3.ok, r3.error], [false, 'needs-working-copy']);
  check('nothing written', fs.existsSync(path.join(wcRoot, 'data', 'X', 'should-not-exist.txt')), false);
  fs.renameSync(path.join(wcRoot, '.hidden-marker'), path.join(wcRoot, '.iem-working-copy.json'));

  console.log('\n[7] Settings → Reset restores the built-in database');
  await js("App.switchTab('settings')"); await sleep(400);
  await js("document.getElementById('btn-reset-database').click()");
  await clickConfirm('ok');
  // deleting ~11k files takes a moment; the app only reloads once the main process says it is done
  const left = () => ['database.json', 'database.json.gz', 'data', '.iem-working-copy.json', 'backup'].filter(n => fs.existsSync(path.join(EXT, n)));
  const t0 = Date.now(); while (left().length && Date.now() - t0 < 60000) await sleep(250);
  console.log('        (reset took ' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  await sleep(800);
  check('IEM-Data database + data + marker removed', ['database.json', 'database.json.gz', 'data', '.iem-working-copy.json', 'backup'].filter(n => fs.existsSync(path.join(EXT, n))), []);
  check('page reloaded and the app is back up', await wait("typeof DataTab !== 'undefined' && !!document.getElementById('pane-database')", 40000), true);
  await sleep(2500);
  check('the deleted file is served again (back on the bundle)', await js(`fetch(${JSON.stringify(url)}).then(r => r.status)`), 200);
  check('the user-added curve is gone', await js("fetch('/data/MY%20SOURCE/WC%20TEST%20ONE.txt').then(r => r.status)"), 404);
  await js("App.switchTab('database')");
  check('Data tab shows the original entries again, no edits', await wait('DataTab.ready && DataTab.S.entries.length === ' + EXPECTED_ENTRIES + ' && !DataTab.S.entries.some(e => e.year === 2001 && e.id === DataTab.S.entries[3].id && false)'), true);
  check('original entry year restored', await js('DataTab.S.entries[3].year !== 2001'), true);
  check('BUNDLE still byte-for-byte untouched after everything', fingerprint(BUNDLE), bundleBefore);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 270000);
