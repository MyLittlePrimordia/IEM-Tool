// A-008: every folder under data/ is a person, publication or archive. This
// test makes the credits table part of the build rather than a one-off edit:
//
//   * a new measurement source cannot ship without attribution
//   * a credit cannot point at a dead folder, a non-HTTPS URL, or a host that
//     main.js would refuse to open
//   * the panel's de-duplicated list keeps the two DCinside folders as one
//
// It runs in `npm test` and needs no Electron because SourceIndex only assigns
// itself to `window` at load time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceIndex = readFileSync(join(root, 'app/js/source-index.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(sourceIndex, sandbox, { filename: 'source-index.js' });
const SourceIndex = sandbox.window.SourceIndex;

const folders = readdirSync(join(root, 'data'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'data')
  .map((entry) => entry.name)
  .sort();

// Hosts are duplicated in main.js because the renderer cannot import the main
// process module. Read the real allowlist instead of restating it here, so a
// URL that the UI happily renders but IPC silently blocks fails the test.
const mainSource = readFileSync(join(root, 'main.js'), 'utf8');
const allowBlock = mainSource.match(/const CREDIT_URL_HOSTS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(allowBlock, 'main.js must declare CREDIT_URL_HOSTS');
const allowedHosts = new Set(
  Array.from(allowBlock[1].matchAll(/'([^']+)'/g), (match) => match[1])
);

function hostAllowed(hostname) {
  return allowedHosts.has(hostname) || hostname.endsWith('.squig.link');
}

// Exercise main.js's validator itself, not a copy of its rules. It is a plain
// function with one dependency (the host set), so it can be lifted into a VM
// without starting Electron.
const guardSource = mainSource.match(/function isCreditUrlAllowed\(raw\) \{[\s\S]*?\n\}/);
assert.ok(guardSource, 'main.js must declare isCreditUrlAllowed');
const guard = vm.runInNewContext(guardSource[0] + '; isCreditUrlAllowed', {
  URL,
  CREDIT_URL_HOSTS: allowedHosts
});

test('every measurement folder has a credit', () => {
  const missing = folders.filter((folder) => !SourceIndex.creditFor(folder));
  assert.deepEqual(missing, [], `unattributed source folder(s): ${missing.join(', ')}`);
});

test('every credit points at a real folder and a valid allowlisted URL', () => {
  assert.equal(typeof SourceIndex.CREDITS, 'object');
  const known = new Set(folders);
  const unknown = Object.keys(SourceIndex.CREDITS).filter((folder) => !known.has(folder));
  assert.deepEqual(unknown, [], `credits for folders that no longer exist: ${unknown.join(', ')}`);

  for (const [folder, credit] of Object.entries(SourceIndex.CREDITS)) {
    assert.ok(credit.label && credit.label.trim(), `${folder} has no display label`);
    assert.ok(credit.kind === 'squig' || credit.kind === 'web', `${folder} has an unknown kind`);

    let url;
    assert.doesNotThrow(() => { url = new URL(credit.url); }, `${folder} has an invalid URL`);
    assert.equal(url.protocol, 'https:', `${folder} must use HTTPS`);
    assert.equal(url.username, '', `${folder} must not embed credentials`);
    assert.equal(url.password, '', `${folder} must not embed credentials`);
    assert.equal(url.port, '', `${folder} must not name a port`);
    assert.ok(hostAllowed(url.hostname), `${folder} host ${url.hostname} is not allowlisted in main.js`);
  }
});

test('main.js accepts every credit link and rejects hostile ones', () => {
  for (const credit of SourceIndex.creditList()) {
    assert.equal(guard(credit.url), true, `main.js would block ${credit.url}`);
  }
  assert.equal(guard('http://achoreviews.squig.link/'), false, 'HTTP must be rejected');
  assert.equal(guard('https://evil.example/'), false, 'unknown host must be rejected');
  assert.equal(guard('https://squig.link.evil.example/'), false, 'lookalike host must be rejected');
  assert.equal(guard('https://user:pass@achoreviews.squig.link/'), false, 'embedded credentials must be rejected');
  assert.equal(guard('https://achoreviews.squig.link:8443/'), false, 'explicit port must be rejected');
  assert.equal(guard('javascript:alert(1)'), false, 'non-URL must be rejected');
  assert.equal(guard(''), false, 'empty value must be rejected');
});

test('sourceLabel uses the researched publisher name', () => {
  assert.equal(SourceIndex.sourceLabel('ACHO REVIEWS'), 'Acho Reviews');
  assert.equal(SourceIndex.sourceLabel('DEN-FI'), 'Den-Fi (Kyle)');
  assert.equal(SourceIndex.sourceLabel('HAWAII BAY BOY'), 'Hawaii Bad Boy (HBB)');
  assert.equal(SourceIndex.sourceLabel("JAY'S AUDIO"), "Jay's Audio");
  assert.equal(SourceIndex.sourceLabel('acho reviews'), 'Acho Reviews');
  assert.equal(SourceIndex.sourceLabel('mystery source'), 'Mystery Source');
});

test('credits panel lists publishers once, in alphabetical order', () => {
  const credits = SourceIndex.creditList();
  const urls = credits.map((credit) => credit.url);
  assert.equal(new Set(urls).size, urls.length, 'duplicate publisher URL in the credits list');
  assert.equal(credits.length, 106);

  const dcinside = credits.find((credit) => credit.url === 'https://dchpgall.squig.link/');
  assert.ok(dcinside, 'DCinside gallery credit is missing');
  assert.equal(Array.from(dcinside.folders).sort().join(','), 'DCHPGALL,DCINSIDE');

  const labels = credits.map((credit) => credit.label);
  const sorted = labels.slice().sort((a, b) => a.localeCompare(b));
  assert.deepEqual(labels, sorted, 'credits must be sorted by publisher name');
});
