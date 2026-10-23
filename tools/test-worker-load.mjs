// Unit test: the scripts find-worker.js pulls in with importScripts() must load
// in a worker scope, where there is no `window` and no `document`.
//
// utils.js is shared by the renderer bundle and the worker. A renderer-only
// statement at its top level (e.g. `window.iLog = ...`) throws in the worker,
// importScripts() swallows it, and every off-thread scan silently falls back to
// the main thread — so this pins the boundary rather than the behaviour.
//   Run:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = (name) => path.join(here, '..', 'app', 'js', name);

// Deliberately minimal: no window, no document, no require.
const ctx = vm.createContext({ console, Math, JSON, Date, Promise, Float32Array, Map, Set });
const WORKER_SCRIPTS = ['utils.js', 'name-utils.js', 'endgame-categories.js', 'endgame-scoring.js'];
const loadErrors = [];
for (const file of WORKER_SCRIPTS) {
  try {
    vm.runInContext(fs.readFileSync(js(file), 'utf8'), ctx, { filename: file });
  } catch (e) {
    loadErrors.push(file + ': ' + e.message);
  }
}

const CurveUtils = loadErrors.length ? null : vm.runInContext('CurveUtils', ctx);
const NameUtils = loadErrors.length ? null : vm.runInContext('NameUtils', ctx);
const EndgameScoring = loadErrors.length ? null : vm.runInContext('EndgameScoring', ctx);

test('every script find-worker.js imports loads without window/document', () => {
  assert.deepEqual(loadErrors, []);
});

test('curve maths is reachable in a worker scope', () => {
  const freqs = CurveUtils.generateLogGrid(64, 20, 20000);
  const a = freqs.map((f) => Math.sin(Math.log(f)) * 4);
  const b = a.slice();
  assert.ok(CurveUtils.scoreInterp(a, b, freqs, true) > 99, 'identical curves must score near 100');
  assert.ok(typeof CurveUtils.freqWeight(freqs[10]) === 'number');
});

test('name normalisation is reachable in a worker scope', () => {
  assert.equal(NameUtils.sanitizeName('Truthear Hexa x HBB'), 'Truthear Hexa');
});

test('the endgame rubric runs and flags a budget clone in a worker scope', () => {
  const freqs = CurveUtils.generateLogGrid(64, 20, 20000);
  const shape = freqs.map((f) => Math.sin(Math.log(f)) * 4);
  const cc = [
    { id: 'champ', name: 'Champion', brand: 'A', price: 500, tags: [], interp: shape },
    { id: 'clone', name: 'Clone', brand: 'B', price: 40, tags: [], interp: shape }
  ];
  const out = EndgameScoring.scoreEndgameCategories(cc, freqs, 1000);
  const first = out[(vm.runInContext('EndgameCategories.ENDGAME_CATEGORIES[0].id', ctx))];
  assert.ok(first && first.pool.length >= 2, 'both priced entries belong in the pool');
  assert.equal(first.pool[0].isChampion, true);
  const clone = first.pool.find((p) => p.id === 'clone');
  assert.equal(clone.isGiantKiller, true, '<=40% of the champion price at 100% similarity is a Giant Killer');
});
