// Unit tests for app/js/name-utils.js (canonical IEM name normalisation).
// Zero dependencies: uses Node's built-in test runner.  Run:  npm test
//
// The point of this module is that the Worker and the main-thread fallback share
// ONE implementation. These tests pin the rules that decide which measurements
// group together, because a change here silently changes Endgame/Giant-Killer
// results rather than throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const NameUtils = require(path.join(here, '..', 'app', 'js', 'name-utils.js'));

test('strips review-source suffixes', () => {
  assert.equal(NameUtils.sanitizeName('Moondrop Aria x Crinacle'), 'Moondrop Aria');
  assert.equal(NameUtils.sanitizeName('Truthear Hexa x HBB'), 'Truthear Hexa');
  assert.equal(NameUtils.sanitizeName('Moondrop Aria x Z Reviews'), 'Moondrop Aria');
});

test('strips bracketed notes', () => {
  assert.equal(NameUtils.sanitizeName('Moondrop Aria (Crinacle)'), 'Moondrop Aria');
  assert.equal(NameUtils.sanitizeName('Moondrop Aria [2021]'), 'Moondrop Aria');
});

test('removes switch, connector and sample variants', () => {
  assert.equal(NameUtils.sanitizeName('KZ ZSN switch on'), 'Kz Zsn');
  assert.equal(NameUtils.sanitizeName('KZ ZSN 3.5mm'), 'Kz Zsn');
  assert.equal(NameUtils.sanitizeName('Moondrop Blessing 3 sample 2'), 'Moondrop Blessing 3');
});

test('collapses whitespace and title-cases each word', () => {
  assert.equal(NameUtils.sanitizeName('  fiio   fh3  '), 'Fiio Fh3');
});

test('keeps the Dudu model name intact', () => {
  // The [ud]{4} rule must not eat a legitimate four-letter model name.
  assert.equal(NameUtils.sanitizeName('Dudu'), 'Dudu');
  assert.equal(NameUtils.sanitizeName('dudu'), 'Dudu');
});

test('coerces non-string names instead of throwing', () => {
  // Custom imports can carry numbers or null in `name`; callers previously
  // threw on .toLowerCase(), aborting the whole scan.
  assert.equal(NameUtils.sanitizeName(null), '');
  assert.equal(NameUtils.sanitizeName(undefined), '');
  assert.equal(NameUtils.sanitizeName(''), '');
  assert.equal(NameUtils.sanitizeName(42), '42');
});

test('is deterministic for repeated calls', () => {
  const name = 'Truthear Nova 4.4mm balanced';
  assert.equal(NameUtils.sanitizeName(name), NameUtils.sanitizeName(name));
});

test('worker delegates to the shared implementation', async () => {
  const fs = await import('node:fs');
  const worker = fs.readFileSync(path.join(here, '..', 'app', 'js', 'find-worker.js'), 'utf8');
  assert.match(worker, /importScripts\('name-utils\.js'\)/, 'worker must load the shared module');
  assert.match(worker, /return NameUtils\.sanitizeName\(name\)/, 'worker must not keep its own copy');
});
