// Runs the Electron-based UI verification suites and aggregates the result.
//
//   npm run verify:ui
//
// These are deliberately NOT part of `npm run check`, which stays pure static
// analysis so it needs no display and no Electron. This runner needs both.
//
// Linux CI has no display by default; run it under xvfb:
//   xvfb-run -a npm run verify:ui
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = [
  { file: 'tools/smoke-runtime.js', what: 'runtime sweep: every tab, sub-panel, modal, data-action + data-cmd control' },
  { file: 'tools/verify-event-delegation.js', what: 'inline on*= -> data-action-* migration' },
  { file: 'tools/verify-data-cmd.js', what: 'data-cmd dispatcher (replaced 60 runtime inline handlers)' },
  { file: 'tools/verify-file-picker-a11y.js', what: 'keyboard-accessible file pickers' },
  { file: 'tools/verify-tone-sweep.js', what: 'Auto Sweep button state' },
  { file: 'tools/verify-volume-sync.js', what: 'volume synced across footer/mobile/modal' }
];

function electronBinary() {
  const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';

  // Ask the package first. Since Electron 43 the `electron` npm package has no
  // postinstall script: `npm ci` installs the package but NOT the binary, and
  // the binary is downloaded lazily the first time the package is required.
  // Probing node_modules/electron/dist directly therefore finds nothing on a
  // clean machine, which is exactly what happens on a fresh CI runner.
  try {
    const resolved = createRequire(import.meta.url)('electron');
    if (typeof resolved === 'string' && existsSync(resolved)) return resolved;
  } catch (e) {
    console.error('Could not load the electron package: ' + (e.message || e));
  }

  const p = join(root, 'node_modules', 'electron', 'dist', exe);
  return existsSync(p) ? p : null;
}

const bin = electronBinary();
if (!bin) {
  // This must FAIL, not skip. A behavioural gate that exits 0 when it cannot
  // run is worse than no gate: CI goes green having verified nothing, and the
  // failure only surfaces later as a mysterious bug report. This was a real
  // defect, found by cloning the repo and running `npm ci` - the electron
  // package installed, its binary never downloaded, and all six suites
  // silently did nothing while the job reported success.
  console.error('UI verification needs the Electron binary, which could not be resolved.');
  console.error('');
  console.error('Electron 43 has no postinstall, so `npm ci` alone does not fetch the');
  console.error('binary; it downloads on first require. If that download failed (no');
  console.error('network, or npm_config_ignore_scripts set), this gate cannot run and');
  console.error('must not be treated as a pass.');
  process.exit(1);
}
console.log('Electron: ' + bin);

// Extra Chromium flags, space separated. CI sets these because a runner has no
// sound card and runs in a container:
//   IEM_VERIFY_CHROMIUM_FLAGS="--no-sandbox --disable-audio-output --mute-audio"
// All six suites are verified to pass with audio output disabled.
const extraFlags = (process.env.IEM_VERIFY_CHROMIUM_FLAGS || '').split(/\s+/).filter(Boolean);
if (extraFlags.length) console.log('Chromium flags: ' + extraFlags.join(' '));

let failed = 0;
for (const suite of SUITES) {
  if (!existsSync(join(root, suite.file))) {
    console.error(`\n=== ${suite.file} is missing - cannot verify: ${suite.what}`);
    failed++;
    continue;
  }
  console.log(`\n=== ${suite.what}  (${suite.file})`);
  const res = spawnSync(bin, [...extraFlags, suite.file], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  for (const line of out.split(/\r?\n/)) {
    if (/PASS|FAIL|^\[|SMOKE|CHECK|ERR |Error|error:/i.test(line)) console.log('  ' + line.trim());
  }
  if (res.status !== 0) {
    failed++;
    console.error(`  -> suite exited ${res.status}` +
      (res.signal ? ` (signal ${res.signal})` : '') +
      (res.error ? ` (${res.error.code || res.error.message})` : ''));
    // A suite that produced no recognisable output has failed before its first
    // check, so the filtered view above is useless. Show the raw tail.
    if (!/PASS|FAIL/.test(out)) {
      console.error('  -- no check output produced; raw tail follows --');
      out.split(/\r?\n/).slice(-25).forEach(l => console.error('    ' + l));
    }
  }
}

console.log('');
if (failed) {
  console.error(`UI VERIFICATION FAILED (${failed} of ${SUITES.length} suite(s))`);
  process.exit(1);
}
console.log(`UI VERIFICATION PASSED (${SUITES.length} suites)`);
