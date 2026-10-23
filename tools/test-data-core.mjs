// Unit tests for app/js/data-core.js (the database integrity gate).
// Zero dependencies: uses Node's built-in test runner.  Run:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const DataCore = require(path.join(here, '..', 'app', 'js', 'data-core.js'));

const good = () => ({
  id: '1964_ears_v2', brand: '1964 Ears', model: 'V2', variant: '', year: 2012,
  price_usd: 400, driver_type: 'BA', driver_config: '2BA', impedance: 22,
  sensitivity: 115, connector: '2-pin', form_factor: 'IEM',
  tags: ['Mid-Tier', 'Balanced', 'Vocal-Focused', 'Smooth', 'Studio-Monitoring'], files: ['data/x/y.txt']
});

test('buildCleanEntry coerces numeric strings and reports it', () => {
  const notes = [];
  const out = DataCore.buildCleanEntry({ ...good(), price_usd: '299.5' }, notes);
  assert.equal(typeof out.price_usd, 'number');
  assert.ok(Number.isInteger(out.price_usd));
  assert.ok(notes.length > 0, 'a coercion note should be recorded');
});

test('buildCleanEntry resets non-finite numbers to 0', () => {
  const out = DataCore.buildCleanEntry({ ...good(), price_usd: Infinity, impedance: NaN });
  assert.equal(out.price_usd, 0);
  assert.equal(out.impedance, 0);
});

test('buildCleanEntry drops unknown keys and notes them', () => {
  const notes = [];
  const out = DataCore.buildCleanEntry({ ...good(), bogus_field: 1 }, notes);
  assert.equal('bogus_field' in out, false);
  assert.ok(notes.some(n => n.includes('bogus_field')));
});

test('buildCleanEntry never returns non-string text in string fields', () => {
  const out = DataCore.buildCleanEntry({ ...good(), brand: { evil: 1 }, model: null });
  assert.equal(typeof out.brand, 'string');
  assert.equal(out.model, '');
});

test('validateEntry accepts a good entry', () => {
  assert.deepEqual(DataCore.validateEntry(good()), []);
});

test('validateEntry flags a wrong ID, bad price and unknown form factor', () => {
  const errs = DataCore.validateEntry({ ...good(), id: 'wrong', price_usd: 403, form_factor: 'Nope' });
  assert.ok(errs.some(e => e.startsWith('ID should be')));
  assert.ok(errs.some(e => e.includes('multiple of $5')));
  assert.ok(errs.some(e => e.includes('Unknown form factor')));
});

test('validateEntry flags duplicate IDs but allows the entry itself (excludeId)', () => {
  const ids = new Set(['1964_ears_v2']);
  assert.ok(DataCore.validateEntry(good(), ids).some(e => e.includes('already exists')));
  assert.deepEqual(DataCore.validateEntry(good(), ids, '1964_ears_v2'), []);
});

test('loadDatabaseText strips a BOM and parses', () => {
  const r = DataCore.loadDatabaseText('\uFEFF' + JSON.stringify([good()]));
  assert.equal(r.entries.length, 1);
});

test('loadDatabaseText rejects non-array roots and truncated JSON', () => {
  assert.throws(() => DataCore.loadDatabaseText('{"a":1}'), /array/i);
  assert.throws(() => DataCore.loadDatabaseText('[{"id":'), /Invalid JSON/);
});

test('loadDatabaseText skips non-object items instead of crashing', () => {
  const r = DataCore.loadDatabaseText(JSON.stringify([good(), 5, null, 'x']));
  assert.equal(r.entries.length, 1);
  assert.ok(r.notes.length >= 3);
});

test('serializeCanonical round-trips through loadDatabaseText', () => {
  const text = DataCore.serializeCanonical([good()]);
  const again = DataCore.serializeCanonical(DataCore.loadDatabaseText(text).entries);
  assert.equal(again, text);
});

test('Session undo/redo round-trips and dirty tracks opCount vs savedMark', () => {
  const s = new DataCore.Session([good()]);
  assert.equal(s.dirty, false);
  const uid = s.entries[0]._uid;
  s.updateEntry(uid, { ...good(), price_usd: 500 }, 'edit');
  assert.equal(s.dirty, true);
  assert.equal(s.canUndo(), true);
  s.undo();
  assert.equal(s.dirty, false, 'undoing back to the saved state is clean');
  assert.equal(s.entries[0].price_usd, 400);
  s.redo();
  assert.equal(s.entries[0].price_usd, 500);
  assert.equal(s.dirty, true);
  s.markSaved();
  assert.equal(s.dirty, false);
  s.undo();
  assert.equal(s.dirty, true, 'undoing past the saved mark is dirty again');
});

// ------------------------------------------------------------------- save log
// The log is exported as Markdown so a changelog can live beside database.json.
// It has to survive a round trip through Markdown: entry labels are database
// values, so a name with [ ] * _ must not turn into emphasis or a link.

const logRow = (over) => Object.assign({
  ts: new Date(2026, 9, 22, 16, 3).getTime(), mode: 'electron', entries: 5309, bytes: 3151872,
  added: 1, modified: 2, removed: 1, total: 3,
  changes: [
    { k: 'add', label: 'Moondrop Lan', detail: '$25 · 1DD · 2 files' },
    { k: 'mod', label: 'Moondrop Chu II', detail: 'Price: $20 -> $25' },
    { k: 'del', label: 'Moondrop Aria [2021]', detail: '' }
  ]
}, over || {});

test('saveLogMarkdown: an empty log says so instead of rendering nothing', () => {
  const md = DataCore.saveLogMarkdown([]);
  assert.equal(md.split('\n')[0], '# Database save log');
  assert.ok(md.includes('_No saves recorded yet._'));
});

test('saveLogMarkdown: one save renders its heading, counts and changed entries', () => {
  const md = DataCore.saveLogMarkdown([logRow()], { now: new Date(2026, 9, 22, 16, 32).getTime() });
  const lines = md.split('\n');
  assert.ok(lines.includes('_1 save, newest first — exported from the Data tab on 2026-10-22 16:32._'), 'header names the export time');
  assert.ok(lines.includes('## 2026-10-22 16:03 — saved to disk'), 'heading names when and where');
  assert.ok(lines.includes('5,309 entries · 3.01 MB · ＋1 ～2 －1'), 'the same summary the tab shows');
  assert.ok(lines.includes('- ＋ Moondrop Lan — $25 · 1DD · 2 files'), 'a new entry keeps its summary');
  assert.ok(lines.includes('- ～ Moondrop Chu II — Price: $20 → $25'), 'the ASCII delta is rendered as an arrow');
  assert.ok(lines.includes('- － Moondrop Aria \\[2021\\]'), 'brackets are escaped so a name is not read as a link');
  assert.ok(!md.includes('more changed'), 'a fully recorded save says nothing about truncation');
});

test('saveLogMarkdown: a downloaded save is labelled as such and omits a zero size', () => {
  const md = DataCore.saveLogMarkdown([logRow({ mode: 'memory', bytes: 0, added: 0, modified: 0, removed: 0, total: 0, changes: [] })], { now: 0 });
  assert.ok(md.includes('## 2026-10-22 16:03 — downloaded'));
  assert.ok(md.includes('5,309 entries · no entry changes'));
});

test('saveLogMarkdown: a truncated save says how many entries it left out', () => {
  const md = DataCore.saveLogMarkdown([logRow({ added: 0, modified: 30, removed: 0, total: 31, changes: [{ k: 'mod', label: 'A*b_c', detail: 'Price: $1 -> $2' }] })], { now: 0 });
  assert.ok(md.includes('- ～ A\\*b\\_c — Price: $1 → $2'), 'asterisk and underscore are escaped');
  assert.ok(md.includes('_…and 30 more changed entries (the log keeps the first 1 of each save)._'));
});

test('saveLogMarkdown: newest save first, each save its own section', () => {
  const md = DataCore.saveLogMarkdown([
    logRow({ ts: new Date(2026, 9, 22, 18, 0).getTime() }),
    logRow({ ts: new Date(2026, 9, 21, 9, 5).getTime(), mode: 'folder' })
  ], { now: 0 });
  assert.ok(md.includes('_2 saves, newest first'));
  const first = md.indexOf('## 2026-10-22 18:00 — saved to disk');
  const second = md.indexOf('## 2026-10-21 09:05 — saved to folder');
  assert.ok(first > 0 && second > first, 'stored order is preserved');
});

// The export appends to save-log.md instead of replacing it, so the changelog
// outlives the 20-save list the Data tab keeps.
const older = () => logRow({ ts: new Date(2026, 9, 20, 10, 0).getTime(), mode: 'folder', entries: 5200 });

 test('mergeSaveLog: a save already in the file is not appended twice', () => {
  const once = DataCore.mergeSaveLog('', [logRow()], { now: 0 }).text;
  const again = DataCore.mergeSaveLog(once, [logRow()], { now: 0 });
  assert.equal(again.added, 0);
  assert.equal(again.total, 1);
  assert.equal((again.text.match(/^## /gm) || []).length, 1, 'one section, not two');
  assert.ok(again.text.includes('- ＋ Moondrop Lan — $25 · 1DD · 2 files'));
});

test('mergeSaveLog: saves that dropped out of the log stay in the changelog', () => {
  const first = DataCore.mergeSaveLog('', [older()], { now: 0 }).text;
  const next = DataCore.mergeSaveLog(first, [logRow()], { now: 0 });
  assert.equal(next.added, 1);
  assert.equal(next.total, 2);
  assert.ok(next.text.includes('_2 saves, newest first'), 'the count covers the whole file');
  assert.ok(next.text.includes('## 2026-10-20 10:00 — saved to folder'), 'the older save is still described');
  const fresh = next.text.indexOf('## 2026-10-22 16:03 — saved to disk');
  const kept = next.text.indexOf('## 2026-10-20 10:00 — saved to folder');
  assert.ok(fresh > 0 && fresh < kept, 'newest first even after appending');
});

test('mergeSaveLog: two saves in the same minute both survive', () => {
  const first = DataCore.mergeSaveLog('', [logRow({ entries: 5000 })], { now: 0 }).text;
  const both = DataCore.mergeSaveLog(first, [logRow({ entries: 5309 }), logRow({ entries: 5000 })], { now: 0 });
  assert.equal(both.total, 2, 'the new save is appended, the existing one is not duplicated');
  assert.ok(both.text.includes('5,309 entries'), 'the new save is in the file');
  assert.ok(both.text.includes('5,000 entries'), 'and so is the one that was already there');
});

test('mergeSaveLog: hand edits to a section survive the next export', () => {
  const file = DataCore.mergeSaveLog('', [logRow()], { now: 0 }).text;
  const edited = file.replace('Price: $20 → $25', 'Price: $20 → $25 (checked by hand)');
  const merged = DataCore.mergeSaveLog(edited, [logRow({ ts: new Date(2026, 9, 23, 8, 0).getTime() })], { now: 0 });
  assert.equal(merged.total, 2);
  assert.ok(merged.text.includes('(checked by hand)'), 'the edited line is kept verbatim');
});

test('mergeSaveLog: only the sections this export added are marked', () => {
  const first = DataCore.mergeSaveLog('', [older()], { now: new Date(2026, 9, 22, 16, 32).getTime() }).text;
  const lines = first.split('\n');
  const head = lines.indexOf('## 2026-10-20 10:00 — saved to folder');
  assert.ok(head > 0, 'the section is there');
  assert.equal(lines[head + 2], '_added to this changelog on 2026-10-22 16:32._', 'marked right under its heading');
  const next = DataCore.mergeSaveLog(first, [older(), logRow()], { now: new Date(2026, 9, 23, 8, 0).getTime() });
  assert.equal(next.added, 1);
  assert.equal(next.total, 2);
  assert.ok(next.text.includes('_added to this changelog on 2026-10-22 16:32._'), 'the earlier marker is left alone');
  assert.equal((next.text.match(/_added to this changelog on 2026-10-23 08:00\._/g) || []).length, 1, 'only the new save is marked with this export');
});

test('summarizeSaveLog: says how many saves the file holds and when it was last written', () => {
  const file = DataCore.mergeSaveLog('', [older(), logRow()], { now: new Date(2026, 9, 22, 16, 32).getTime() }).text;
  const sum = DataCore.summarizeSaveLog(file);
  assert.equal(sum.total, 2);
  assert.equal(sum.updatedAt, new Date(2026, 9, 22, 16, 32).getTime(), 'the export stamp, not a save date');
});

test('summarizeSaveLog: nothing to report without a file or with no saves in it', () => {
  assert.equal(DataCore.summarizeSaveLog(null), null);
  assert.equal(DataCore.summarizeSaveLog(''), null);
  assert.equal(DataCore.summarizeSaveLog('# Database save log\n\n_No saves recorded yet._\n'), null);
});

test('summarizeSaveLog: falls back to the newest save when the header is gone', () => {
  const sum = DataCore.summarizeSaveLog('## 2026-10-20 10:00 — saved to folder\n\n5,200 entries · 2.90 MB · ＋1\n');
  assert.equal(sum.total, 1);
  assert.equal(sum.updatedAt, new Date(2026, 9, 20, 10, 0).getTime());
});

// The reader draws the changelog as structure, so the parser must hand back the
// title, the export's note and one block per line - and must never drop a line
// it does not recognise.

test('saveLogDocument: title, header note and one section per save', () => {
  const file = DataCore.mergeSaveLog('', [older(), logRow()], { now: new Date(2026, 9, 22, 16, 32).getTime() }).text;
  const doc = DataCore.saveLogDocument(file);
  assert.equal(doc.title, 'Database save log');
  assert.equal(doc.blocks[0].k, 'note');
  assert.ok(doc.blocks[0].text.includes('2 saves, newest first'));
  assert.equal(doc.sections.length, 2, 'newest first');
  assert.equal(doc.sections[0].heading, '2026-10-22 16:03');
  assert.equal(doc.sections[0].where, 'saved to disk');
  assert.equal(doc.sections[0].ts, new Date(2026, 9, 22, 16, 3).getTime());
  assert.deepEqual(doc.sections[0].blocks.map(b => b.k), ['note', 'meta', 'row', 'row', 'row']);
});

test('saveLogDocument: a changed row is split into its mark, name and detail', () => {
  const doc = DataCore.saveLogDocument(DataCore.saveLogMarkdown([logRow()], { now: 0 }));
  const rows = doc.sections[0].blocks.filter(b => b.k === 'row');
  assert.deepEqual(rows.map(r => [r.mark, r.kind, r.name, r.detail]), [
    ['＋', 'add', 'Moondrop Lan', '$25 · 1DD · 2 files'],
    ['～', 'mod', 'Moondrop Chu II', 'Price: $20 → $25'],
    ['－', 'del', 'Moondrop Aria [2021]', '']
  ], 'the export\u2019s Markdown escaping is removed for display');
});

test('saveLogDocument: the counts line and the truncation note stay visible', () => {
  const doc = DataCore.saveLogDocument(DataCore.saveLogMarkdown([logRow({
    added: 0, modified: 30, removed: 0, total: 31, changes: [{ k: 'mod', label: 'A', detail: '' }]
  })], { now: 0 }));
  // The section was added by this export, so its provenance note comes first.
  const blocks = doc.sections[0].blocks;
  assert.deepEqual(blocks.map(b => b.k), ['note', 'meta', 'row', 'note']);
  assert.ok(blocks[1].text.includes('5,309 entries'));
  assert.ok(blocks[3].text.includes('and 30 more changed entries'));
});

test('saveLogDocument: a hand-edited line is kept as text, not dropped', () => {
  const file = '# Database save log\n\n_1 save, newest first._\n\n' +
    '## 2026-10-01 09:00 — saved to folder\n\nChecked by hand.\n\n5,100 entries · ＋1\n\n- ＋ Foo — $10\n';
  const doc = DataCore.saveLogDocument(file);
  assert.deepEqual(doc.sections[0].blocks.map(b => b.text || b.name), ['Checked by hand.', '5,100 entries · ＋1', 'Foo']);
  assert.equal(doc.sections[0].blocks[0].k, 'text');
});

test('saveLogDocument: an empty or absent file is an empty document, not a throw', () => {
  for (const input of [null, '', '# Database save log\n\n_No saves recorded yet._\n']) {
    const doc = DataCore.saveLogDocument(input);
    assert.deepEqual(doc.sections, []);
    assert.ok(Array.isArray(doc.blocks));
  }
  assert.equal(DataCore.saveLogDocument('').title, '');
});

// The reader can show only additions, only removals, or one month. Filtering
// happens on the parsed document, so it can never touch the file.

const twoMonthDoc = () => {
  const sep = logRow({ ts: new Date(2026, 8, 30, 8, 0).getTime(), mode: 'memory' });
  return DataCore.saveLogDocument(DataCore.mergeSaveLog('', [logRow(), sep], { now: 0 }).text);
};

test('saveLogMonths: only the months in the file, newest first', () => {
  assert.deepEqual(DataCore.saveLogMonths(twoMonthDoc()), [
    { key: '2026-10', count: 1, label: 'Oct 2026' },
    { key: '2026-09', count: 1, label: 'Sep 2026' }
  ]);
  assert.deepEqual(DataCore.saveLogMonths({ sections: [] }), []);
});

test('filterSaveLogDocument: additions keep only added rows and their saves', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { kind: 'add' });
  assert.equal(view.total, 2, 'the file still holds two saves');
  assert.equal(view.saves, 2);
  assert.equal(view.rows, 2);
  for (const s of view.sections) {
    assert.deepEqual(s.blocks.filter(b => b.k === 'row').map(b => b.kind), ['add']);
    assert.equal(s.hidden, 2, 'the two other changes are counted as hidden');
  }
});

test('filterSaveLogDocument: a save with nothing of that kind is left out', () => {
  const doc = DataCore.saveLogDocument(DataCore.saveLogMarkdown([logRow({
    added: 0, modified: 1, removed: 0, total: 1, changes: [{ k: 'mod', label: 'B', detail: '' }]
  })], { now: 0 }));
  const view = DataCore.filterSaveLogDocument(doc, { kind: 'add' });
  assert.deepEqual([view.saves, view.rows, view.sections.length], [0, 0, 0]);
  assert.equal(view.total, 1);
});

test('filterSaveLogDocument: one month keeps that month\u2019s saves', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { month: '2026-09' });
  assert.equal(view.saves, 1);
  assert.equal(view.rows, 3);
  assert.equal(view.sections[0].heading, '2026-09-30 08:00');
  assert.equal(view.sections[0].where, 'downloaded');
});

test('filterSaveLogDocument: kind and month combine, and every month restores all', () => {
  const doc = twoMonthDoc();
  const none = DataCore.filterSaveLogDocument(doc, { kind: 'del', month: '2026-08' });
  assert.deepEqual([none.saves, none.rows, none.sections.length], [0, 0, 0]);
  assert.equal(none.total, 2);
  const all = DataCore.filterSaveLogDocument(doc, {});
  assert.deepEqual([all.saves, all.rows, all.sections[0].hidden], [2, 6, 0]);
});

test('filterSaveLogDocument: a search matches the entry name, ignoring case', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'MOONDROP CHU' });
  assert.equal(view.rows, 2);
  assert.equal(view.saves, 2);
  assert.deepEqual(view.sections[0].blocks.filter(b => b.k === 'row').map(r => r.name), ['Moondrop Chu II']);
  assert.equal(view.query, 'moondrop chu', 'trimmed and lower-cased once');
});

test('filterSaveLogDocument: a search matches the change detail too', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'price' });
  assert.equal(view.rows, 2, 'each save changed a price');
  assert.ok(view.sections[0].blocks.some(b => b.k === 'row' && b.detail.includes('Price')));
  assert.equal(view.sections[0].hidden, 2);
});

test('filterSaveLogDocument: a search with no match empties the view, not the total', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'zzz' });
  assert.deepEqual([view.saves, view.rows, view.sections.length], [0, 0, 0]);
  assert.equal(view.total, 2);
});

test('filterSaveLogDocument: search combines with kind and month, and blanks mean all', () => {
  const doc = twoMonthDoc();
  const combined = DataCore.filterSaveLogDocument(doc, { query: 'moondrop', kind: 'del', month: '2026-10' });
  assert.deepEqual([combined.saves, combined.rows], [1, 1]);
  assert.equal(combined.sections[0].blocks.filter(b => b.k === 'row')[0].name, 'Moondrop Aria [2021]');
  const blank = DataCore.filterSaveLogDocument(doc, { query: '   ' });
  assert.deepEqual([blank.saves, blank.rows], [2, 6], 'whitespace is no filter at all');
});

// A save is also findable by when and where it happened: the heading carries
// its date and the "where" carries its destination. Matching there keeps the
// whole save, because the save is what was searched for - not one changed row.

test('filterSaveLogDocument: a search matches a save\u2019s date heading', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: '2026-09' });
  assert.equal(view.saves, 1);
  assert.equal(view.sections[0].heading, '2026-09-30 08:00');
  assert.equal(view.rows, 3, 'every change that save lists is kept');
  assert.equal(view.sections[0].hidden, 0);
  assert.equal(view.sections[0].matchedSave, 'date', 'the card says which part of the save matched');
});

test('filterSaveLogDocument: a search matches where the save went', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'downloaded' });
  assert.equal(view.saves, 1);
  assert.equal(view.sections[0].where, 'downloaded');
  assert.deepEqual(view.sections[0].blocks.filter(b => b.k === 'row').map(r => r.name),
    ['Moondrop Lan', 'Moondrop Chu II', 'Moondrop Aria [2021]']);
  assert.equal(view.sections[0].matchedSave, 'destination');
});

test('filterSaveLogDocument: a save matched by its heading still obeys the kind filter', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'downloaded', kind: 'del' });
  assert.equal(view.rows, 1);
  assert.equal(view.sections[0].blocks.filter(b => b.k === 'row')[0].kind, 'del');
  assert.equal(view.sections[0].hidden, 2, 'the rest of the save is counted as hidden');
  assert.equal(view.sections[0].matchedSave, 'destination', 'the label survives a kind filter');
});

test('filterSaveLogDocument: a heading match does not leak into other saves', () => {
  const view = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'saved to disk' });
  assert.equal(view.saves, 1);
  assert.equal(view.sections[0].heading, '2026-10-22 16:03');
  assert.equal(view.rows, 3);
  const rowsOnly = DataCore.filterSaveLogDocument(twoMonthDoc(), { query: 'price' });
  assert.equal(rowsOnly.rows, 2, 'a row match still matches rows alone');
  assert.equal(rowsOnly.sections[0].matchedSave, '', 'a row match needs no label');
});

test('filterSaveLogDocument: the label survives a kind filter that hides the row that also matched', () => {
  // The reader can only see rows of the chosen kind, so a match in a row that
  // kind filters out is no explanation for the card: the label has to say why.
  const doc = { title: '', blocks: [], sections: [{ heading: '2026-10-20 11:00', where: 'saved to disk', ts: 0,
    blocks: [
      { k: 'row', kind: 'add', mark: '＋', name: 'One', detail: '' },
      { k: 'row', kind: 'del', mark: '－', name: 'Gone 11:00', detail: '' }
    ] }] };
  assert.equal(DataCore.filterSaveLogDocument(doc, { query: '11:00' }).sections[0].matchedSave, '', 'the matching row is on screen');
  assert.equal(DataCore.filterSaveLogDocument(doc, { query: '11:00', kind: 'del' }).sections[0].matchedSave, '');
  const add = DataCore.filterSaveLogDocument(doc, { query: '11:00', kind: 'add' });
  assert.equal(add.sections[0].matchedSave, 'date', 'the row that matched is filtered out, so the date explains the card');
  assert.equal(add.sections[0].hidden, 1);
});

test('filterSaveLogDocument: a save the text also hits in its rows carries no label', () => {
  const doc = { title: '', blocks: [], sections: [{ heading: 'Moondrop save', where: 'saved to disk', ts: 0,
    blocks: [{ k: 'row', kind: 'add', mark: '＋', name: 'Moondrop Lan', detail: '' }] }] };
  assert.equal(DataCore.filterSaveLogDocument(doc, { query: 'moondrop' }).sections[0].matchedSave, '', 'the row is the visible reason');
  assert.equal(DataCore.filterSaveLogDocument(doc, { query: '2026' }).sections.length, 0, 'no hit, no card');
});

// The viewer reopens on the view it was closed in, so the remembered filter is
// checked against today's file before it is used: a stale month, an unknown kind
// or a runaway query must not hide the changelog for no visible reason.

const monthsOf = () => DataCore.saveLogMonths(twoMonthDoc());

test('sanitizeSaveLogFilter: a remembered view is restored as it was left', () => {
  const f = DataCore.sanitizeSaveLogFilter({ kind: 'del', month: '2026-09', query: 'aria' }, monthsOf());
  assert.deepEqual(f, { kind: 'del', month: '2026-09', query: 'aria' });
});

test('sanitizeSaveLogFilter: nothing remembered means the whole document', () => {
  const all = { kind: 'all', month: 'all', query: '' };
  for (const input of [null, undefined, '', 42, 'x', []]) assert.deepEqual(DataCore.sanitizeSaveLogFilter(input, monthsOf()), all);
});

test('sanitizeSaveLogFilter: a month the file no longer holds falls back to every month', () => {
  // The file keeps growing and old saves can be cleared; opening on a month that
  // is gone would show an empty changelog that looks broken.
  assert.equal(DataCore.sanitizeSaveLogFilter({ month: '2026-01' }, monthsOf()).month, 'all');
  assert.equal(DataCore.sanitizeSaveLogFilter({ month: '2026-01' }, []).month, 'all');
});

test('sanitizeSaveLogFilter: a single month drops the month rather than filtering invisibly', () => {
  const one = [{ key: '2026-10', count: 1, label: 'Oct 2026' }];
  assert.equal(DataCore.sanitizeSaveLogFilter({ month: '2026-10' }, one).month, 'all', 'no picker, no hidden filter');
});

test('sanitizeSaveLogFilter: an unknown kind and a hostile shape are ignored', () => {
  const all = { kind: 'all', month: 'all', query: '' };
  assert.deepEqual(DataCore.sanitizeSaveLogFilter({ kind: 'mod' }, monthsOf()), all);
  assert.deepEqual(DataCore.sanitizeSaveLogFilter({ kind: {}, month: [], query: { a: 1 } }, monthsOf()), all);
  assert.deepEqual(DataCore.sanitizeSaveLogFilter({ kind: 'add' }, null), { kind: 'add', month: 'all', query: '' });
});

test('sanitizeSaveLogFilter: a runaway query is cut rather than stored whole', () => {
  const f = DataCore.sanitizeSaveLogFilter({ query: 'x'.repeat(5000) }, monthsOf());
  assert.equal(f.query.length, 200);
});

test('isDefaultSaveLogFilter: only a view showing everything is worth forgetting', () => {
  assert.equal(DataCore.isDefaultSaveLogFilter({ kind: 'all', month: 'all', query: '' }), true);
  assert.equal(DataCore.isDefaultSaveLogFilter({ kind: 'all', month: 'all', query: '   ' }), true, 'blank is no filter');
  assert.equal(DataCore.isDefaultSaveLogFilter(null), true);
  assert.equal(DataCore.isDefaultSaveLogFilter({ kind: 'add', month: 'all', query: '' }), false);
  assert.equal(DataCore.isDefaultSaveLogFilter({ kind: 'all', month: '2026-09', query: '' }), false);
  assert.equal(DataCore.isDefaultSaveLogFilter({ kind: 'all', month: 'all', query: 'aria' }), false);
});

test('mergeSaveLog: text that is not a save log is kept above it', () => {
  const merged = DataCore.mergeSaveLog('Notes from the audit.\n\n- keep me\n', [logRow()], { now: 0 });
  assert.ok(merged.text.startsWith('Notes from the audit.\n\n- keep me\n\n# Database save log\n'));
  assert.equal(merged.total, 1);
});

// ---------------------------------------------------------------- save previews
// The Data tab confirms a save with a diff of the file it is about to replace.
// The snapshot must hold fingerprints, not references: the Session edits entries
// in place, so a reference-based snapshot would always diff to nothing.

test('diffAgainstSnapshot: an unchanged set reports nothing', () => {
  const entries = [good(), { ...good(), id: 'other', model: 'Other' }];
  const snap = DataCore.snapshotEntries(entries);
  const d = DataCore.diffAgainstSnapshot(snap, entries);
  assert.deepEqual([d.added.length, d.modified.length, d.removed.length, d.total], [0, 0, 0, 0]);
});

test('diffAgainstSnapshot: in-place edit is caught (snapshot is not a reference)', () => {
  const e = good();
  const snap = DataCore.snapshotEntries([e]);
  e.price_usd = 450;
  const d = DataCore.diffAgainstSnapshot(snap, [e]);
  assert.equal(d.modified.length, 1);
  assert.equal(d.modified[0].id, e.id);
  assert.ok(d.modified[0].label.includes('V2'), 'the row carries a readable label');
  assert.ok(d.modified[0].detail.includes('Price: $400 -> $450'), 'and the field delta that changed');
  assert.equal(d.total, 1);
});

test('diffAgainstSnapshot: adds, removes and tag edits are reported separately', () => {
  const a = good(), b = { ...good(), id: 'b_id', model: 'B' };
  const snap = DataCore.snapshotEntries([a, b]);
  const edited = { ...a, tags: ['Mid-Tier', 'Balanced'] };
  const added = { ...good(), id: 'new_id', model: 'New' };
  const d = DataCore.diffAgainstSnapshot(snap, [edited, added]);
  assert.deepEqual(d.added.map(x => x.id), ['new_id']);
  assert.deepEqual(d.modified.map(x => x.id), [a.id]);
  assert.deepEqual(d.removed.map(x => x.id), ['b_id']);
  assert.equal(d.total, 3);
  // The preview lists what changed, not just which entries did.
  assert.equal(d.modified[0].detail, 'Tags: 5 -> 2 item(s)');
  assert.equal(d.added[0].detail, '$400 · 2BA · 1 file');
  assert.equal(d.removed[0].detail, '', 'a removed entry has no current values to show');
});

test('diffAgainstSnapshot: a new entry with no files or price still describes itself', () => {
  const snap = DataCore.snapshotEntries([]);
  const bare = { ...good(), id: 'bare_id', price_usd: 0, driver_config: '', files: [] };
  const d = DataCore.diffAgainstSnapshot(snap, [bare]);
  assert.equal(d.added[0].detail, '0 files');
});

test('diffAgainstSnapshot: a changed id is one removal plus one addition', () => {
  const e = good();
  const snap = DataCore.snapshotEntries([e]);
  const renamed = { ...e, model: 'Renamed', id: '1964_ears_renamed' };
  const d = DataCore.diffAgainstSnapshot(snap, [renamed]);
  assert.deepEqual(d.added.map(x => x.id), ['1964_ears_renamed']);
  assert.deepEqual(d.removed.map(x => x.id), [e.id]);
  assert.equal(d.modified.length, 0);
});

test('diffAgainstSnapshot against the shipped database: identity is empty, one price is one edit', () => {
  const file = path.join(here, '..', 'database.json');
  if (!fs.existsSync(file)) return;
  const { entries } = DataCore.loadDatabaseText(fs.readFileSync(file, 'utf8'));
  const snap = DataCore.snapshotEntries(entries);
  assert.equal(DataCore.diffAgainstSnapshot(snap, entries).total, 0);
  entries[0].price_usd = entries[0].price_usd + 5;
  const d = DataCore.diffAgainstSnapshot(snap, entries);
  assert.deepEqual([d.added.length, d.modified.length, d.removed.length], [0, 1, 0]);
});

test('shipped database.json loads and every entry passes through the clean funnel', () => {
  const file = path.join(here, '..', 'database.json');
  if (!fs.existsSync(file)) return;
  const r = DataCore.loadDatabaseText(fs.readFileSync(file, 'utf8'));
  assert.ok(r.entries.length > 100);
  for (const e of r.entries) {
    assert.equal(typeof e.price_usd, 'number');
    assert.equal(typeof e.year, 'number');
  }
});
