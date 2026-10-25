// A throwaway Chromium / Electron profile for one verification run.
//
// Every Electron script in tools/ - the verify suites, and the ad-hoc audit,
// check, diag, measure and screenshot probes - drives the REAL app:
// smoke-runtime clicks every data-action and data-cmd control in the UI, which
// persists whatever those controls write (theme, font, gapless, crossfade, the
// safety limiter, the chosen audio device) into localStorage and IndexedDB.
// `npm run verify:ui` isolates that with --user-data-dir, but the documented way
// to run one script - `npx electron tools/<script>.js` - had no isolation at
// all, so a hand run silently reconfigured the developer's own app. A run on
// 2026-10-24 left the real profile on Black + JetBrains Mono and forgot the
// selected DAC, which is the class of accident this module exists to prevent.
//
// Usage, at the top of a script, before app.whenReady() resolves (setPath has
// to happen before the profile is opened):
//
//   const PROFILE = require('./lib/verify-profile').isolateProfile('tab-panels');
//
// The directory is fresh every time, so suites cannot inherit each other's
// state either: a shared directory made later suites read the theme and font an
// earlier one happened to leave behind.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'iem-verify-';
// Prefixes used before this helper existed (three suites isolated themselves)
// plus the single shared directory the runner used for every suite. Swept here
// too, so switching to the helper does not strand the old litter.
const LEGACY_PREFIXES = [
  'iem-settings-cycle-',
  'iem-output-device-',
  'iem-factory-reset-',
  'iem-tool-verify-profile'
];
const STALE_AFTER = 60 * 60 * 1000;

// Chromium keeps its LevelDB files open until the process is gone, so a suite
// cannot delete its own directory on the way out. The next run sweeps the
// previous ones instead - and only directories untouched for an hour, so a
// suite running concurrently is never pulled out from under itself.
function sweepStaleProfiles() {
  const tmp = os.tmpdir();
  let names;
  try { names = fs.readdirSync(tmp); } catch (e) { return; }
  for (const name of names) {
    if (!name.startsWith(PREFIX) && !LEGACY_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    const dir = path.join(tmp, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs < STALE_AFTER) continue;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 0 });
    } catch (e) { /* in use, or already gone: try again next run */ }
  }
}

function slugify(label) {
  const slug = String(label || 'suite').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'suite';
}

// Returns the profile directory and points the app at it. When the runner (or a
// developer debugging a suite) has named a directory in IEM_VERIFY_USER_DATA,
// that one wins: an explicit choice should not be overruled, and the runner
// already gives each suite its own fresh subdirectory there.
function isolateProfile(label) {
  const chosen = process.env.IEM_VERIFY_USER_DATA;
  if (chosen) {
    fs.mkdirSync(chosen, { recursive: true });
    app.setPath('userData', chosen);
    return chosen;
  }
  sweepStaleProfiles();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX + slugify(label) + '-'));
  app.setPath('userData', dir);
  return dir;
}

module.exports = { isolateProfile, sweepStaleProfiles, PREFIX, LEGACY_PREFIXES };
