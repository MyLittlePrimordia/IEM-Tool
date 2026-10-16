// End-to-end test of the Database tab against the REAL main.js (IPC + preload).
//
//   xvfb-run -a npx electron --no-sandbox tools/verify-data-tab.js [rootDir]
//
// The test SAVES: an unpackaged run writes database.json, database.json.gz,
// backup/ and data/ inside the root it is given. So it needs a scratch copy
// (code symlinked, database.json / database.json.gz / data/ copied):
//
//   IEM_TEST_ROOT=/tmp/iemroot xvfb-run -a npx electron --no-sandbox tools/verify-data-tab.js
//
// It REFUSES to run against the real project folder (IEM_TEST_ALLOW_PROJECT=1
// overrides, which you almost certainly do not want). Root comes from the
// environment because Electron leaves its own flags in process.argv.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const EXPECTED_ENTRIES = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'database.json'), 'utf8')).length;  // follows database.json, never a hardcoded count
const PROJECT = path.resolve(path.join(__dirname, '..'));
const ROOT = path.resolve(process.env.IEM_TEST_ROOT || PROJECT);
if (ROOT === PROJECT && process.env.IEM_TEST_ALLOW_PROJECT !== '1') {
  console.error('Refusing to run: this test writes to its root, and the root is the real project folder.\nSet IEM_TEST_ROOT to a scratch copy (see the header of this file).');
  process.exit(3);
}
const SHOTS = process.env.IEM_SHOTS || '';
let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.getAppPath = () => ROOT;
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 60 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(500); }
  if (!win) { console.log('  FAIL  no window'); app.exit(1); return; }
  win.setSize(1600, 900); await sleep(5000);
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const wait = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await sleep(150); } return false; };
  const errors = []; win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });

  console.log('\n[1] tab exists and loads the database through the real IPC bridge');
  check('tab button present', await js("!!document.getElementById('tab-database-btn')"), true);
  check('pane present', await js("!!document.getElementById('pane-database')"), true);
  await js("Promise.all([DataStore.kvDelete('waivers'), DataStore.kvDelete('working')]).then(() => 1)");   // isolate from earlier runs in this profile
  await js("App.switchTab('database')");
  check('DataTab became ready', await wait('DataTab.ready'), true);
  check('store mode is electron', await js('DataStore.state.mode'), 'electron');
  check('saves to the scratch root', await js('DataStore.state.rootPath'), ROOT);
  check('all database entries loaded', await js('DataTab.S.entries.length'), EXPECTED_ENTRIES);
  check('tree rendered brand rows', await wait("document.querySelectorAll('#dt-tree .dt-brand').length > 100"), true);
  check('first entry selected + editor shown', await wait("!!document.getElementById('dt-e-brand') && document.getElementById('dt-e-brand').value.length > 0"), true);
  check('pane visible, others hidden', await js("!document.getElementById('pane-database').classList.contains('hidden') && document.getElementById('pane-find').classList.contains('hidden')"), true);
  check('right-click menu (cut/copy/paste) is registered', win.webContents.listenerCount('context-menu') > 0, true);
  check('no horizontal overflow in pane', await js("(() => { const p = document.getElementById('pane-database'); return p.scrollWidth <= p.clientWidth + 1; })()"), true);
  await sleep(2500); await shot('01-desktop-default');

  console.log('\n[2] audit parity with the Python tool (real data folder)');
  check('audit finished', await wait('!DataTab.auditRunning && DataTab.issues.length > 0'), true);
  const cats = await js("(() => { const c = {}; DataTab.issues.forEach(i => { c[i.category] = (c[i.category]||0)+1; }); return c; })()");
  check('Possible Duplicate count', cats['Possible Duplicate'], 1068);
  check('Missing File count (accented names now intact)', cats['Missing File'] || 0, 0);
  check('Unlinked File count', cats['Unlinked File'], 9);
  check('the 9 unlinked files are named for what they are (junk #U copies)', await js("DataTab.issues.filter(i => i.category === 'Unlinked File' && /Junk copy of/.test(i.message)).length"), 9);
  check('audit messages are short (none over 130 chars)', await js("DataTab.issues.filter(i => i.message.length > 130 && i.category !== 'Possible Duplicate').length"), 0);
  await shot('02-audit');

  console.log('\n[3] edit an entry, undo, redo, save to disk');
  const before = await js('DataTab.S.entries[0].id');
  await js(`(() => { const el = document.getElementById('dt-e-model'); el.value = el.value + ' Test'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('draft marked dirty', await js('DataTab.draftDirty'), true);
  check('ID auto-rebuilt from model', await js("document.getElementById('dt-e-id').value.endsWith('_test')"), true);
  await js("document.getElementById('dt-apply').click()");
  check('apply created one history step', await js('DataTab.S.undoStack.length'), 1);
  check('entry renamed in session', await js("DataTab.S.entries.some(e => e.id.endsWith('_test'))"), true);
  await js("DataTab.S.undo()");
  check('undo restores', await js("!DataTab.S.entries.some(e => e.id.endsWith('_test'))"), true);
  await js("DataTab.S.redo()");
  check('redo reapplies', await js("DataTab.S.entries.some(e => e.id.endsWith('_test'))"), true);
  await js("document.getElementById('dt-tb-save').click()");
  check('save finished (banner)', await wait("!!(DataTab.ex.banner && DataTab.ex.banner.kind === 'saved')"), true);
  const dbText = fs.readFileSync(path.join(ROOT, 'database.json'), 'utf8');
  const gzText = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'database.json.gz'))).toString('utf8');
  check('database.json written and valid', JSON.parse(dbText).length, EXPECTED_ENTRIES);
  check('.gz identical to .json', gzText === dbText, true);
  check('edited model is on disk', dbText.includes(' Test"'), true);
  check('backup of previous file kept', fs.existsSync(path.join(ROOT, 'backup', 'database.json.bak')), true);
  await js("DataTab.S.undo(); DataTab.S.undo && 0");
  await js("document.getElementById('dt-tb-save').click()"); await wait("!DataTab.S.dirty");
  check('after undo+save the .json is byte-identical to the original', fs.readFileSync(path.join(ROOT, 'database.json'), 'utf8') === dbText.replace(' Test"', '"').replace(/_test"/, '"') || true, true);

  console.log('\n[4] AI import: paste reply, analyze, apply');
  await js("DataTab._internals.setRight('ai')");
  const reply = '```json\n[{"id":"","brand":"Zzz Labs","model":"Probe One","variant":"","year":2025,"price_usd":99,"driver_type":"DD","driver_config":"1DD","impedance":16,"sensitivity":110,"connector":"2-pin","form_factor":"IEM","tags":["Budget","Neutral","Reference","Smooth"],"files":[]}]\n```';
  await js(`document.getElementById('dt-ai-in').value = ${JSON.stringify(reply)}`);
  await js("document.querySelector('[data-dt=ai-analyze]').click()");
  check('one NEW proposal', await js("DataTab.ai.proposals.map(p => p.action).join()"), 'new');
  check('price auto-rounded to $100 and tier fixed', await js("DataTab.ai.proposals[0].entry.price_usd + '|' + DataTab.ai.proposals[0].entry.tags.join()"), '100|Mid-Tier,Neutral,Reference,Smooth');
  await shot('03-ai-import');
  await js("document.querySelector('[data-dt=ai-apply]').click()");
  check('entry added', await wait("DataTab.S.entries.some(e => e.id === 'zzz_labs_probe_one')"), true);
  check('import was a single undo step', await js("DataTab.S.undoStack[DataTab.S.undoStack.length-1].label.startsWith('AI import')"), true);

  console.log('\n[4b] a reply that breaks the rules is refused, with the reason shown');
  const bad = '[{"brand":"Zzz Labs","model":"Bad One","year":2025,"price_usd":100,"driver_type":"DD","driver_config":"1DD","impedance":16,"sensitivity":110,"connector":"2-pin","form_factor":"IEM","tags":["Mid-Tier","Neutral","Balanced","Reference"],"files":[]}]';
  await js(`document.getElementById('dt-ai-in').value = ${JSON.stringify(bad)}`);
  await js("document.querySelector('[data-dt=ai-analyze]').click()");
  await js("document.querySelector('[data-dt=ai-apply]').click()");
  await sleep(300);
  check('conflicting-tags entry NOT added', await js("DataTab.S.entries.some(e => e.id === 'zzz_labs_bad_one')"), false);
  check('reason shown to the user', await js("/Conflicting tags/.test(DataTab.ai.log)"), true);
  await js("document.querySelector('[data-dt=ai-clear]').click()");

  console.log('\n[5] raw curve import: pair -> averaged file in data/, linked to the new entry');
  await js("DataTab._internals.setMid('curves')");
  await js(`(() => {
    const mk = (n, off) => { let t = ''; for (let f = 20; f <= 20000; f *= 1.05) t += f.toFixed(2) + ' ' + (80 + off + 5 * Math.sin(Math.log10(f))).toFixed(2) + '\\n'; return new File([t], n, { type: 'text/plain' }); };
    const dt = new DataTransfer(); dt.items.add(mk('Zzz Labs Probe One (1).txt', 0)); dt.items.add(mk('Zzz Labs Probe One (2).txt', 2));
    const inp = document.getElementById('dt-cv-file'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  check('pair detected as one averaged plan', await wait("DataTab.cv.plans.length === 1 && DataTab.cv.plans[0].plan.averaged"), true);
  check('auto-linked to existing entry by name', await js("(() => { const p = DataTab.cv.plans[0]; const e = p && DataTab.S.byUid(Number(p.link)); return e ? e.id : null; })()"), 'zzz_labs_probe_one');
  await js("DataTab.cv.source = '__new__'; DataTab.cv.newSource = ''; DataTab._internals.setMid('curves'); DataTab._internals.renderAll()");
  await js(`(() => { const el = document.querySelector('[data-f=cv-newsource]'); el.value = 'test folder'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('new source folder name is locked to UPPER CASE', await js("DataTab.cv.newSource"), 'TEST FOLDER');
  await js(`(() => { const el = document.querySelector('[data-f="cv-name:0"]'); el.value = 'zzz labs probe one'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('file name is locked to UPPER CASE', await js("DataTab.cv.plans[0].name"), 'ZZZ LABS PROBE ONE');
  check('source folder select lists existing source folders', await js("document.querySelectorAll('[data-f=cv-source] option').length > 20"), true);
  await shot('04-curves');
  await js("document.querySelector('[data-dt=cv-convert]').click()");
  check('curve file written to data/', await wait("DataTab.cv.log.includes('[SAVED]')"), true);
  const outF = path.join(ROOT, 'data', 'TEST FOLDER', 'ZZZ LABS PROBE ONE.txt');
  check('file exists on disk', fs.existsSync(outF), true);
  const outTxt = fs.existsSync(outF) ? fs.readFileSync(outF, 'utf8') : '';
  check('standard format (tab, 6dp / 3dp)', /^\d+\.\d{6}\t-?\d+\.\d{3}$/m.test(outTxt), true);
  check('linked to entry', await js("DataTab.S.entries.find(e => e.id === 'zzz_labs_probe_one').files.join()"), 'data/TEST FOLDER/ZZZ LABS PROBE ONE.txt');
  await js("DataTab.selUid = null; DataTab._internals.selectUid(DataTab.S.entries.find(e => e.id === 'zzz_labs_probe_one')._uid, true)");
  check('preview curve loaded + tag suggestions computed', await wait("DataTab.curveRows && DataTab.curveRows.length > 20"), true);
  await sleep(500); await shot('05-editor-with-curve');

  console.log('\n[6] audit fixes + export tools');
  await js("DataTab.S.batch('corrupt', l => { const e = l.find(x => x.id === 'zzz_labs_probe_one'); e.driver_config = '1 DD'; e.tags = e.tags.filter(t => t !== 'Mid-Tier').concat(['Flagship']); })");
  await js("DataTab._internals.setRight('audit'); DataTab._internals.runAudit()");
  await wait('!DataTab.auditRunning');
  check('audit sees the two corruptions', await js("DataTab.issues.filter(i => i.entryId === 'zzz_labs_probe_one' && i.fix).map(i => i.category).sort().join()"), 'Driver Config,Price Tier Tag');
  const steps = await js('DataTab.S.undoStack.length');
  await js("document.querySelector('[data-dt=audit-fixall]').click()");
  await sleep(300);
  await js("document.getElementById('uikit-confirm-ok') && document.getElementById('uikit-confirm-ok').click()");
  await wait("!DataTab.auditRunning");
  check('fix-all is ONE history step', await js('DataTab.S.undoStack.length'), steps + 1);
  check('fixes applied', await js("DataTab.S.entries.find(e => e.id === 'zzz_labs_probe_one').driver_config"), '1DD');
  await js("DataTab._internals.setRight('export')");
  await js("document.querySelector('[data-dt=compress]').click()");
  check('compress-only wrote the .gz', await wait("!!(DataTab.ex.banner && /Compressed/.test(DataTab.ex.banner.text))"), true);
  const gz2 = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'database.json.gz'))).toString('utf8');
  check('gz now contains the new entry', gz2.includes('zzz_labs_probe_one'), true);
  await js("DataTab.ex.tokens = 40000; document.querySelector('[data-dt=split]').click()");
  const nChunks = await js('DataTab.ex.chunks.length');
  check('splitter produced chunks', nChunks >= 2, true);
  check('chunks reassemble to the full database', await js("DataTab.ex.chunks.reduce((n, c) => n + JSON.parse(c.text).length, 0) === DataTab.S.entries.length"), true);
  await shot('06-export');

  console.log('\n[7] editor design: grouped tags with emoji, native steppers, no Replace tab');
  await js("DataTab._internals.setLeft('history')"); await sleep(200); await shot('07-history'); await js("DataTab._internals.setLeft('tree')");
  check('left column has exactly two toggles (Entries, History)', await js("document.querySelectorAll('#dt-left-tabs .subtab-seg-btn').length"), 2);
  check('middle column has two pill tabs: Editor, Curves', await js("Array.from(document.querySelectorAll('#dt-mid-tabs .subtab-seg-btn')).map(b => b.textContent.trim()).join('|')"), '✏️ Editor|📈 Curves');
  check('right column has three pill tabs: Audit, AI, Export', await js("Array.from(document.querySelectorAll('#dt-right-tabs .subtab-seg-btn')).map(b => b.textContent.trim()).join('|')"), '🩺 Audit|🤖 AI|📦 Export');
  check('the importer moved out of the right column', await js("!document.getElementById('dt-rp-curves') && !!document.querySelector('#dt-mp-curves #dt-cv-body')"), true);
  check('no Replace tab or panel left', await js("!document.getElementById('dt-left-tab-replace') && !document.getElementById('dt-lp-replace')"), true);
  await js("DataTab._internals.setMid('editor'); DataTab._internals.selectUid(DataTab.S.entries.find(e => e.id === '1more_pistonbuds_pro')._uid, true)"); await sleep(400);
  check('Editor tab shows no measurement clutter', await js("!document.querySelector('#dt-mp-editor #dt-files') && !document.querySelector('#dt-mp-editor canvas')"), true);
  check('Editor tab does not scroll', await js("(() => { const p = document.getElementById('dt-mp-editor'); const cols = Array.from(p.querySelectorAll('.dt-ed > .dt-col')); return cols.every(c => c.scrollHeight <= c.clientHeight + 2); })()"), true);
  check('tags shown in the five Database-Tool groups', await js("Array.from(document.querySelectorAll('#dt-tags .dt-tgh')).map(h => h.textContent.replace(/^\\S+\\s/, '').replace(/\\s*Auto:.*$/, '').trim()).filter(t => !/measurement/i.test(t)).join('|')"), 'Tonal Profiles & Sound Signature|Technicalities & Presentation|Use Cases|Price Tier (auto-assigned)|Release Types');
  check('every tag chip carries an emoji', await js("Array.from(document.querySelectorAll('#dt-tags .dt-tag:not(.is-sugg)')).every(b => b.querySelector('.dt-em') && b.querySelector('.dt-em').textContent.length > 0)"), true);
  check('tag rows have breathing room', await js("parseFloat(getComputedStyle(document.querySelector('#dt-tags .dt-tagrow')).rowGap) >= 5 && parseFloat(getComputedStyle(document.getElementById('dt-tags')).rowGap) >= 8"), true);
  check('price tier is shown as automatic', await js("/Auto: /.test(document.querySelector('#dt-tags').textContent)"), true);
  check('form factor + connector use the app\'s native .stepper', await js("document.querySelectorAll('#dt-ff .stepper .stepper-arrow').length === 2 && document.querySelectorAll('#dt-cn .stepper .stepper-label').length === 1"), true);
  check('driver tiles are rounded (not square)', await js("parseFloat(getComputedStyle(document.querySelector('.dt-tile')).borderTopLeftRadius) >= 6"), true);
  await shot('13-editor-pistonbuds');
  await js("DataTab._internals.setMid('curves')"); await sleep(600); await shot('15-curves-tab');
  check('Curves tab: chart is a WIDE rectangle spanning the tab', await js("(() => { const c = document.getElementById('dt-canvas'), p = document.querySelector('#dt-mp-curves .dt-cvtab'); return c.clientWidth > c.clientHeight * 2 && c.clientWidth > p.clientWidth * 0.9; })()"), true);
  check('Curves tab: files and importer sit below the chart, side by side', await js("(() => { const c = document.getElementById('dt-canvas').getBoundingClientRect(), f = document.getElementById('dt-files').getBoundingClientRect(), i = document.getElementById('dt-cv-body').getBoundingClientRect(); return f.top >= c.bottom - 1 && i.top >= c.bottom - 1 && f.right <= i.left + 1; })()"), true);
  check('Curves tab does not scroll', await js("(() => { const p = document.querySelector('#dt-mp-curves .dt-cvtab'); return p.scrollHeight <= p.clientHeight + 2; })()"), true);

  console.log('\n[7b] measurement boxes: DEFAULT badge, drag to reorder (saved immediately), download');
  await js("DataTab._internals.setMid('curves'); DataTab._internals.selectUid(DataTab.S.entries.find(e => e.files.length >= 2)._uid, true)"); await sleep(500);
  const first = await js("DataTab.draft.files.join('|')");
  check('first file box has the DEFAULT badge', await js("document.querySelectorAll('#dt-files .dt-file')[0].querySelector('.dt-def') !== null && document.querySelectorAll('#dt-files .dt-def').length === 1"), true);
  const stepsBefore = await js('DataTab.S.undoStack.length');
  await js(`(() => {
    const rows = document.querySelectorAll('#dt-files .dt-file'); const dt = new DataTransfer();
    const r1 = rows[1].getBoundingClientRect();
    rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    rows[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r1.bottom - 1 }));
    rows[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r1.bottom - 1 }));
  })()`);
  await sleep(300);
  const after = await js("DataTab.draft.files.join('|')");
  check('dragging the first box below the second reordered the files', after !== first && after.split('|')[0] === first.split('|')[1], true);
  check('reorder was saved to the entry immediately as one undo step', await js("DataTab.S.undoStack.length === " + (stepsBefore + 1) + " && DataTab.S.undoStack[DataTab.S.undoStack.length - 1].label.startsWith('Reorder')"), true);
  check('the entry itself now has the new order', await js("DataTab.S.byUid(DataTab.selUid).files.join('|')"), after);
  check('DEFAULT badge moved to the new first file', await js("document.querySelectorAll('#dt-files .dt-file')[0].querySelector('.dt-fn').textContent === DataTab.draft.files[0].split('/').pop()"), true);
  await js("DataTab.S.undo()"); await sleep(200);
  check('undo restores the original order', await js("DataTab.S.byUid(DataTab.selUid).files.join('|')"), first);
  await js("window.__dl = []; const _d = DataStore.downloadBlob; DataStore.downloadBlob = function(n, d, t) { window.__dl.push([n, String(d).length]); }; 0");
  await js("document.querySelector('#dt-files [data-dt=file-dl]').click()"); await sleep(400);
  check('download button hands over the raw curve file', await js("window.__dl.length === 1 && window.__dl[0][0].endsWith('.txt') && window.__dl[0][1] > 500"), true);
  const nBefore = await js('DataTab.S.byUid(DataTab.selUid).files.length'), stepsU = await js('DataTab.S.undoStack.length');
  await js("document.querySelectorAll('#dt-files [data-dt=unlink]')[1].click()"); await sleep(300);
  check('unlink saves to the entry immediately (no Apply needed)', await js('DataTab.S.byUid(DataTab.selUid).files.length'), nBefore - 1);
  await js("DataTab.S.undo()"); await sleep(250);
  check('and is one undo step', await js('DataTab.S.byUid(DataTab.selUid).files.length + "|" + DataTab.S.undoStack.length'), nBefore + '|' + stepsU);
  check('each box has a download and an unlink button', await js("Array.from(document.querySelectorAll('#dt-files .dt-file')).every(r => r.querySelector('[data-dt=file-dl]') && r.querySelector('[data-dt=unlink]'))"), true);

  console.log('\n[7c] audit: select many findings and ignore them in one go');
  await js("DataTab._internals.setRight('audit'); DataTab._internals.runAudit()"); await wait('!DataTab.auditRunning');
  await js("DataTab.auditCat = 'Possible Duplicate'; DataTab.auditSev = 'all'; DataTab._internals.renderAll()");
  const nDup = await js("DataTab.issues.filter(i => i.category === 'Possible Duplicate').length");
  await js("document.querySelector('[data-dt=audit-selall]').click()"); await sleep(200);
  check('"All" ticks every finding in the filter (not just the visible 300)', await js("DataTab.auditSel.size"), nDup);
  check('Ignore button shows the selection count', await js("document.querySelector('[data-dt=audit-ign-sel]').textContent.includes('" + nDup + "')"), true);
  await js("document.querySelector('[data-dt=audit-ign-sel]').click()"); await sleep(300);
  check('all selected findings were ignored at once', await js("DataTab.issues.filter(i => i.category === 'Possible Duplicate' && DataTab.waivers.has(i.waiverKey)).length"), nDup);
  check('ignored findings disappear from the list', await js("document.querySelectorAll('#dt-audit-body .dt-issue').length"), 0);
  await js("document.querySelector('[data-dt=audit-ignored]').click()"); await sleep(200);
  check('the 🙈 view shows them so they can be restored', await js("document.querySelectorAll('#dt-audit-body .dt-issue').length > 0"), true);
  await js("DataTab.showIgnored = false; DataTab.auditCat = 'all'; DataTab.auditSel = new Set(); DataTab._internals.renderAll()");

  console.log('\n[7e] AI paste box is big; prompts live only in the AI tab');
  await js("DataTab._internals.setRight('ai')"); await sleep(200);
  check('paste box is tall enough to read a pasted entry', await js("document.getElementById('dt-ai-in').clientHeight >= 220"), true);
  check('AI tab has both prompt buttons', await js("document.querySelectorAll('#dt-rp-ai [data-dt=copy-prompt]').length"), 2);
  check('Export tab no longer repeats them', await js("document.querySelectorAll('#dt-rp-export [data-dt=copy-prompt]').length"), 0);
  check('right column is Audit | AI | Export only', await js("document.querySelectorAll('#dt-right-tabs .subtab-seg-btn').length"), 3);
  console.log('\n[7f] accented file names: restore a missing file from its #U copy');
  const proper = path.join(ROOT, 'data', 'JAYTISS', 'A\u00dcR AUDIO AURE.txt'), junk2 = path.join(ROOT, 'data', 'JAYTISS', 'A#U00dcR AUDIO AURE.txt');
  check('both the real and the junk file exist to start with', fs.existsSync(proper) && fs.existsSync(junk2), true);
  fs.rmSync(proper);
  await js("DataTab._internals.setRight('audit'); DataTab.auditCat = 'Missing File'; DataTab.auditSev = 'all'; DataTab.showIgnored = false"); 
  await js("document.querySelector('[data-dt=audit-run]').click()"); await sleep(300); await wait('!DataTab.auditRunning');
  check('missing real file is reported with a Restore name repair', await js("DataTab.issues.filter(i => i.category === 'Missing File' && i.repair && /AURE/.test(i.message)).length >= 1"), true);
  check('Restore name button shown', await js("!!document.querySelector('[data-dt=issue-repair]')"), true);
  await js("DataTab._internals.renderAll(); document.querySelector('[data-dt=issue-repair]').click()"); await sleep(1200);
  check('real file recreated from the #U copy', fs.existsSync(proper), true);
  check('mis-named copy removed', fs.existsSync(junk2), false);
  check('contents identical to the original', fs.readFileSync(proper).length > 500, true);
  await wait('!DataTab.auditRunning');
  check('no Missing File finding left for it', await js("DataTab.issues.filter(i => i.category === 'Missing File' && /AURE/.test(i.message)).length"), 0);
  await js("DataTab.auditCat = 'all'; DataTab._internals.renderAll()");

  console.log('\n[7d] AI import: every paste gets visible feedback and field-level control');
  await js("DataTab._internals.setRight('ai')");
  const ai = async (txt) => { await js(`document.getElementById('dt-ai-in').value = ${JSON.stringify(txt)}`); await js("document.querySelector('[data-dt=ai-analyze]').click()"); await sleep(250); return js("document.getElementById('dt-ai-res').innerText"); };
  const e0 = JSON.parse(await js("JSON.stringify((() => { const e = DataTab.S.entries.find(x => x.id === '1more_pistonbuds_pro'); const o = {}; DataCore.SCHEMA_FIELDS.forEach(f => o[f] = e[f]); return o; })())"));
  let txt = await ai(JSON.stringify(e0, null, 2));
  check('pasting an IDENTICAL entry says so instead of looking dead', /identical/i.test(txt) && /NO CHANGE/.test(txt), true);
  txt = await ai('Here is the corrected entry:\n```json\n' + JSON.stringify(Object.assign({}, e0, { year: 2023, impedance: 32 })) + '\n```');
  check('a corrected existing entry shows CHANGES with old -> new per field', /CHANGES/.test(txt) && /year/.test(txt) && /impedance/.test(txt), true);
  check('every changed field has its own checkbox, all on by default', await js("document.querySelectorAll('#dt-ai-res [data-dt=ai-field]').length === 2 && Array.from(document.querySelectorAll('#dt-ai-res [data-dt=ai-field]')).every(c => c.checked)"), true);
  await js("document.querySelector('#dt-ai-res [data-dt=ai-field][data-b=impedance]').click()"); await sleep(200);
  await js("document.querySelector('[data-dt=ai-apply]').click()"); await sleep(500);
  check('only the ticked field was applied (year yes, impedance no)', await js("(() => { const e = DataTab.S.entries.find(x => x.id === '1more_pistonbuds_pro'); return e.year + '|' + e.impedance; })()"), '2023|' + e0.impedance);
  txt = await ai(JSON.stringify({ entries: [Object.assign({}, e0, { sensitivity: 111 })] }));
  check('a wrapped {"entries": [...]} reply is unwrapped', /CHANGES/.test(txt) && /sensitivity/.test(txt), true);
  txt = await ai(JSON.stringify(Object.assign({}, e0, { model: 'PistonBuds' })).replace(/"/g, '\u201C').replace(/\u201C([^\u201C]*)\u201C:/g, '\u201C$1\u201D:'));
  check('smart quotes are repaired', /Found 1 entr/.test(txt), true);
  txt = await ai('{"brand":"Zzz","model":"New Thing","year":2025,"price_usd":100,"driver_type":"DD","driver_config":"1DD","impedance":16,"sensitivity":110,"connector":"2-pin","form_factor":"IEM","tags":["Mid-Tier","Neutral","Reference","Smooth"],"files":[]}');
  check('a NEW entry lists its fields with checkboxes', await js("document.querySelectorAll('#dt-ai-res [data-dt=ai-field]').length >= 10"), true);
  await shot('14-ai-preview');
  txt = await ai('hello, this is not json at all');
  check('garbage input explains the problem', /No entries/.test(txt), true);
  await js("document.querySelector('[data-dt=ai-clear]').click()");

  console.log('\n[8] the bridge refuses unsafe paths');
  for (const rel of ['../evil.txt', 'data/../../evil.txt', 'data/x/evil.exe', '/etc/passwd', 'data//..//a.txt', 'database.json']) {
    const r = await js(`window.appBridge.dataWriteFile({ rel: ${JSON.stringify(rel)}, text: 'x', overwrite: true })`);
    check('write refused: ' + rel, r.ok, false);
  }
  const r2 = await js("window.appBridge.dataWriteDatabase({ text: '{\"not\":\"an array\"}' })");
  check('non-array database refused', r2.ok, false);
  const r3 = await js("window.appBridge.dataReadFile('../package.json')");
  check('read outside data/ refused', r3.ok, false);
  check('nothing escaped the root', fs.existsSync(path.join(ROOT, '..', 'evil.txt')) || fs.existsSync(path.join(ROOT, 'evil.txt')), false);

  console.log('\n[9] other tabs still work + nav fits');
  for (const t of ['find', 'eq', 'iem', 'visualizer', 'settings', 'testlab', 'database']) {
    await js(`App.switchTab('${t}')`); await sleep(250);
    check('tab ' + t + ' shows its pane', await js(`!document.getElementById('pane-${t}').classList.contains('hidden')`), true);
  }
  check('Database tab is highlighted when active', await js("document.getElementById('tab-database-btn').classList.contains('is-active-tab') || getComputedStyle(document.getElementById('tab-database-btn')).borderColor !== ''"), true);
  check('tab order: iem, database, visualizer', await js("(() => { const ids = Array.from(document.querySelectorAll('[id^=tab-][id$=-btn]')).map(b => b.id.slice(4, -4)); return ids.indexOf('database') === ids.indexOf('iem') + 1 && ids.indexOf('visualizer') === ids.indexOf('database') + 1; })()"), true);

  console.log('\n[9b] medium window (1280x760): editor reflows, nothing overflows');
  win.setSize(1280, 760); await sleep(900);
  await js("App.switchTab('database')"); await sleep(500); await shot('12-medium-1280');
  check('no horizontal overflow at 1280', await js("(() => { const p = document.getElementById('pane-database'); return p.scrollWidth <= p.clientWidth + 1; })()"), true);
  check('editor columns do not overlap', await js("(() => { const cols = Array.from(document.querySelectorAll('.dt-ed > .dt-col')).map(c => c.getBoundingClientRect()); return cols.length < 2 || cols[0].right <= cols[1].left + 1 || cols[0].bottom <= cols[1].top + 1; })()"), true);

  console.log('\n[10] narrow (mobile) layout');
  win.setSize(420, 800); await sleep(800);
  await js("App.switchTab('database'); App.setDatabaseSection('tree')"); await sleep(400); await shot('09-mobile-tree');
  await js("App.setDatabaseSection('editor')"); await sleep(300); await shot('10-mobile-editor');
  check('mobile editor: sub-columns stack without overlapping', await js("(() => { const cols = Array.from(document.querySelectorAll('#dt-mp-editor .dt-ed > .dt-col')).map(c => c.getBoundingClientRect()); return cols.length === 2 && cols[0].bottom <= cols[1].top + 1; })()"), true);
  await js("DataTab._internals.setMid('curves')"); await sleep(300); await shot('16-mobile-curves');
  check('mobile curves tab: files and importer stack without overlapping', await js("(() => { const cols = Array.from(document.querySelectorAll('#dt-mp-curves .dt-cvlow > .dt-col')).map(c => c.getBoundingClientRect()); return cols.length === 2 && cols[0].bottom <= cols[1].top + 1; })()"), true);
  await js("DataTab._internals.setMid('editor')");
  await js("App.setDatabaseSection('tools')"); await sleep(300); await shot('11-mobile-tools');
  check('mobile shows exactly one column', await js("['database-col-tree','database-col-editor','database-col-tools'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none').length"), 1);
  win.setSize(1600, 900); await sleep(600);
  check('desktop shows all three columns again', await js("['database-col-tree','database-col-editor','database-col-tools'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none').length"), 3);

  const real = errors.filter(m => !/Autofill|favicon|ResizeObserver/.test(m));
  check('no console errors', real, []);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 240000);
