// Validates .github/workflows/build.yml with a real YAML parser and asserts the
// job graph is what we think it is. A workflow that fails to parse, or whose
// `needs` does not gate the builds, would silently stop protecting releases.
//
//   node tools/check-workflow.js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const text = readFileSync(join(root, '.github', 'workflows', 'build.yml'), 'utf8');

let doc;
try {
  doc = yaml.load(text);
  console.log('  PASS  the workflow parses as YAML');
} catch (e) {
  console.log('  FAIL  YAML parse error: ' + e.message);
  process.exit(1);
}

const jobs = doc.jobs || {};
const names = Object.keys(jobs);
console.log('\n  jobs: ' + names.join(', ') + '\n');

check('verify job exists', !!jobs.verify, 'true');
check('verify-ui job exists', !!jobs['verify-ui'], 'true');

// Every platform build must wait for BOTH gates.
for (const b of ['build-linux', 'build-windows', 'build-macos']) {
  const needs = jobs[b]?.needs;
  const list = Array.isArray(needs) ? needs : [needs];
  check(`${b} gated on verify`, list.includes('verify'), 'true');
  check(`${b} gated on verify-ui`, list.includes('verify-ui'), 'true');
}

// The rolling release publishes binaries it downloads as artifacts, so it must
// wait for all three builds. Without this it can fire on a partial set and
// overwrite a good `latest` release with one missing a platform.
const releaseNeeds = jobs['update-release']?.needs;
const releaseNeedList = Array.isArray(releaseNeeds) ? releaseNeeds : [releaseNeeds];
for (const b of ['build-linux', 'build-windows', 'build-macos']) {
  check(`update-release gated on ${b}`, releaseNeedList.includes(b), 'true');
}

// The behavioural gate must actually run the suite, under xvfb, and declare
// Electron's shared libraries - each of these was a real omission once.
// Include env values, not just `run` — the Chromium flags are passed via env
// rather than on the command line.
const uiSteps = jobs['verify-ui']?.steps || [];
const steps = uiSteps.map(s => [s.run, s.name, JSON.stringify(s.env || {})].join('\n')).join('\n');
check('verify-ui installs Electron runtime libraries', /apt-get install/.test(steps), 'true');
check('verify-ui runs under xvfb', /xvfb-run/.test(steps), 'true');
check('verify-ui runs npm run verify:ui', /npm run verify:ui/.test(steps), 'true');
check('verify-ui passes no-sandbox + no-audio flags', /--no-sandbox/.test(steps) && /--disable-audio-output/.test(steps), 'true');
// Electron 43 has no postinstall, so `npm ci` does not fetch the binary. Without
// resolving it explicitly the behavioural gate can no-op on a clean runner.
check('verify-ui fetches the Electron binary', /require\('electron'\)|require\("electron"\)/.test(steps), 'true');

// And the static gate must still be present on all three.
for (const b of ['build-linux', 'build-windows', 'build-macos']) {
  const s = (jobs[b]?.steps || []).map(x => x.run || '').join('\n');
  check(`${b} still runs the strict package build`, /dist-/.test(s), 'true');
}

// The static gate should police this file too, otherwise the assertions above
// only ever run on a developer machine.
const verifyRuns = (jobs.verify?.steps || []).map(x => x.run || '').join('\n');
check('verify job runs check:workflow on itself', /check:workflow/.test(verifyRuns), 'true');

// The mac target builds ONE universal DMG (x64 + arm64 merged with lipo), so the
// release carries a single file per OS. Both failure modes here are silent, so
// both are policed:
//  - a glob like `ls dist/*.dmg | head -n 1` would publish an arm64-only DMG if
//    someone reverted package.json's arch list: Apple Silicon is fine, every
//    Intel Mac breaks, and the job still reports success;
//  - shipping per-arch DMGs again puts four files on the release page, which is
//    exactly the confusion this setup exists to avoid.
const macSteps = (jobs['build-macos']?.steps || []).map(x => [x.run || '', JSON.stringify(x.with || {})].join('\n')).join('\n');
check('build-macos requires exactly one DMG', /-ne 1/.test(macSteps), 'true');
check('build-macos proves the DMG is universal', /lipo -archs/.test(macSteps) && /x86_64/.test(macSteps) && /arm64/.test(macSteps), 'true');
check('build-macos publishes no per-arch DMG', !/IEM-Tool-(arm64|x64)\.dmg/.test(macSteps), 'true');

// The rolling release must actually carry every shipped binary. This has to read
// the `artifacts` input specifically - matching the filename anywhere in the
// step would also match the release `body` prose and pass even when the file is
// no longer uploaded.
const releaseStep = (jobs['update-release']?.steps || [])
  .find(x => String(x.uses || '').includes('release-action'));
const releaseArtifacts = String(releaseStep?.with?.artifacts || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
for (const f of ['IEM-Tool-Setup.exe', 'IEM-Tool.dmg', 'IEM-Tool.appimage']) {
  // Entries are full paths (release-files/<artifact>/<file>), so match on the
  // trailing filename rather than requiring exact list membership.
  check(`rolling release includes ${f}`, releaseArtifacts.some(p => p === f || p.endsWith('/' + f)), 'true');
}
// The whole point of this layout: a user opening the release page sees three
// files and picks their OS. A fourth entry - a stray portable exe or a per-arch
// DMG - reintroduces the guesswork, so pin the count as well as the names.
check('rolling release publishes exactly 3 files', releaseArtifacts.length, '3');

console.log(failures === 0 ? '\nWORKFLOW OK' : `\n${failures} WORKFLOW PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
