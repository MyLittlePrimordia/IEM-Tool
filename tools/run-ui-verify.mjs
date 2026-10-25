// Runs the Electron-based UI verification suites and aggregates the result.
//
//   npm run verify:ui
//
// These are deliberately NOT part of `npm run check`, which stays pure static
// analysis so it needs no display and no Electron. This runner needs both.
//
// Linux CI has no display by default; run it under xvfb:
//   xvfb-run -a npm run verify:ui
//
// A verify-* script that is not in SUITES is a probe you run by hand, and says
// so on its first line. scripts/check-ui-suites.mjs (part of `npm run check`)
// fails when a verify-* script is neither registered here nor declared a probe,
// so a suite written for a fix cannot be forgotten and never run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
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
  { file: 'tools/verify-refresh-database.js', what: 'Settings > Refresh database: one-row hint, cache clear, reload' },
  { file: 'tools/verify-output-device.js', what: 'Settings > Output device: shortened labels + full tooltip, one click cycles every endpoint and wraps, disabled and inert with no devices' },
  { file: 'tools/verify-settings-cycle.js', what: 'Settings cycle boxes: Audio channel / Theme / Font advance one step in declared order, keep their emoji label, wrap, and are restored on reload' },
  { file: 'tools/verify-settings-layout.js', what: 'Settings layout: three cards / twelve rows in one 760px column, merged rows complete, quiet hint and border tokens, visible switch track, no overlap or clipped hints, no inner scroll at 1536, 1280 and the 1229x691 laptop window (100% and 125% text), Track transitions writes the old gapless/crossfade keys and survives reload, narrow viewport scrolls to the last card' },
  { file: 'tools/verify-factory-reset.js', what: 'Settings > Library > Reset: Backup/Restore/Reset row, cancel is a no-op, confirm wipes settings + reviews + IEM-Data and restarts (real main.js)' },
  { file: 'tools/verify-save-preview.js', what: 'Data tab save preview: listed changes, cancel writes nothing, stale-file warning' },
  { file: 'tools/verify-no-bridge.js', what: 'no-preload window (screenshot harness / browser): app boots, nothing throws, bridge-dependent controls show their desktop-only fallback' },
  { file: 'tools/verify-tab-panels.js', what: 'tab carousels (Data, IEM, TestLab, Find, EQ acoustics/faders + console): each shows exactly one panel, and the one showing is the selected tab\'s' },
  { file: 'tools/audit-control-corners.js', what: 'control corners: one radius per family across all seven panes, --r-square for the square shapes' }
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
// Chromium honours --user-data-dir for the whole profile, so a throwaway
// directory keeps a verification run away from the real one. Each suite gets
// its OWN directory rather than one shared by the run: smoke-runtime clicks
// every control in the app, and the state it leaves used to be read back by the
// suites that ran after it. The suites themselves call
// tools/lib/verify-profile.js, which honours the same path through
// IEM_VERIFY_USER_DATA; the --user-data-dir flag stays as a second line of
// defence so a suite that has not adopted the helper still cannot reach the
// real profile. Set IEM_VERIFY_USER_DATA to pin the location.
const verifyRoot = process.env.IEM_VERIFY_USER_DATA
  || join(tmpdir(), 'iem-tool-verify-' + process.pid);
mkdirSync(verifyRoot, { recursive: true });
const profileFor = (file) => join(verifyRoot, basename(file, '.js'));
console.log('User profiles: ' + verifyRoot + '/<suite>  (the real one is NOT touched)');

// A suite cannot delete its own profile (Chromium holds its LevelDB files until
// the process exits), so a previous run's directory is swept here once it is an
// hour old. The age bound keeps a concurrently running verify:ui untouched.
const STALE_AFTER = 60 * 60 * 1000;
for (const name of readdirSync(tmpdir())) {
  if (!/^(iem-tool-verify-|iem-verify-)/.test(name)) continue;
  const dir = join(tmpdir(), name);
  try {
    if (Date.now() - statSync(dir).mtimeMs < STALE_AFTER) continue;
    rmSync(dir, { recursive: true, force: true, maxRetries: 0 });
  } catch (e) { /* in use or already gone */ }
}

let failed = 0;
for (const suite of SUITES) {
  if (!existsSync(join(root, suite.file))) {
    console.error(`\n=== ${suite.file} is missing - cannot verify: ${suite.what}`);
    failed++;
    continue;
  }
  console.log(`\n=== ${suite.what}  (${suite.file})`);
  const profile = profileFor(suite.file);
  mkdirSync(profile, { recursive: true });
  const res = spawnSync(bin, ['--user-data-dir=' + profile, ...extraFlags, suite.file], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, IEM_VERIFY_USER_DATA: profile }
  });
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
// All suites are done, so their files are closed and the run's profiles can go.
// Best effort: a file still held by a lingering renderer is left for the
// stale sweep above. A directory the caller pinned is never removed.
if (!process.env.IEM_VERIFY_USER_DATA) {
  try { rmSync(verifyRoot, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
}

console.log('');
if (failed) {
  console.error(`UI VERIFICATION FAILED (${failed} of ${SUITES.length} suite(s))`);
  process.exit(1);
}
console.log(`UI VERIFICATION PASSED (${SUITES.length} suites)`);
