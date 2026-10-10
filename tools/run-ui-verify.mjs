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
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = [
  { file: 'tools/smoke-runtime.js', what: 'runtime sweep: every tab, sub-panel, modal, data-action + data-cmd control' },
  { file: 'tools/verify-event-delegation.js', what: 'inline on*= -> data-action-* migration' },
  { file: 'tools/verify-data-cmd.js', what: 'data-cmd dispatcher (replaced 60 runtime inline handlers)' },
  { file: 'tools/verify-file-picker-a11y.js', what: 'keyboard-accessible file pickers' },
  { file: 'tools/verify-tone-sweep.js', what: 'Auto Sweep button state' },
  { file: 'tools/verify-volume-sync.js', what: 'volume synced across footer/mobile/modal' },
  { file: 'tools/verify-facades.js', what: 'god-file split keeps every public member (PEQDB, Find, TestLab, IEM, App)' },
  { file: 'tools/verify-review-flow.js', what: 'Review tab: library round trip and infographic export' },
  { file: 'tools/verify-permissions.js', what: 'real main.js: clipboard allowed, other permissions denied, Host guard' },
  { file: 'tools/verify-adapter-impedance.js', what: 'Gear Simulator adapters fit from a measured impedance curve, with fallbacks' },
  { file: 'tools/verify-slider-fill.js', what: 'slider bar follows the knob after code-driven changes' },
  { file: 'tools/verify-eq-history.js', what: 'EQ undo/redo, remembered EQ, Settings > Fix settings' },
  { file: 'tools/verify-database-load.js', what: 'catalogue loads once, bad file survives, Refresh picks up a new entry' },
  { file: 'tools/verify-refresh-database.js', what: 'Settings > Refresh database: one-row hint, cache clear, reload' }
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

// ISOLATE THE USER PROFILE. Every suite drives the real app, and
// smoke-runtime.js in particular clicks every data-action / data-cmd control in
// the UI. That persists whatever those controls write - theme, font, graph
// alignment, gapless, crossfade, the safety limiter - into localStorage and
// IndexedDB under %APPDATA%/iem-tool. Running the suite therefore silently
// reconfigures the developer's or user's actual app: a run on 2026-10-05 flipped
// settings_theme_id slate->parchment, settings_font_id JetBrains Mono->Rubik and
// set --font-scale-modifier to 0.99, which visibly changed the layout (footer
// bar overlapping the 3-column panes) with nothing in the code having changed.
//
// Chromium honours --user-data-dir for the whole profile, so pointing every
// suite at a throwaway directory stops a verification run from ever touching the
// real one. Set IEM_VERIFY_USER_DATA to override the location.
const verifyProfile = process.env.IEM_VERIFY_USER_DATA
  || join(tmpdir(), 'iem-tool-verify-profile');
mkdirSync(verifyProfile, { recursive: true });
const isolationFlags = ['--user-data-dir=' + verifyProfile];
console.log('User profile: ' + verifyProfile + '  (the real one is NOT touched)');

let failed = 0;
for (const suite of SUITES) {
  if (!existsSync(join(root, suite.file))) {
    console.error(`\n=== ${suite.file} is missing - cannot verify: ${suite.what}`);
    failed++;
    continue;
  }
  console.log(`\n=== ${suite.what}  (${suite.file})`);
  const res = spawnSync(bin, [...isolationFlags, ...extraFlags, suite.file], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
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
