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
