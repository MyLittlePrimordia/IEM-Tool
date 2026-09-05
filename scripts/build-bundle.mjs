// Reproducible JS bundle builder.
// Concats the app's source scripts (in load order) into js/app.bundle.js and a
// minified js/app.bundle.min.js, and writes js/bundle-version.js with a content
// hash so index.html can cache-bust on actual changes instead of Date.now().
// Order MUST match the original <script src> sequence. chart.js is
// intentionally NOT included (it's injected at runtime via injectScriptAsync).
//
// --strict: require terser and produce app.bundle.min.js, or fail the build.
// Used by the predist* npm hooks so a packaged/dist build can never silently
// ship a stale (or missing) minified bundle just because terser wasn't
// installed in this environment. Plain `npm run build:js` (used for local
// dev / `npm start`) stays lenient so it still works before `npm install`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

// Source-of-truth load order (matches the pre-bundling <script> tags).
// NOTE: handlers.js MUST come after the app-core split files below because it
// references globals (EQ, TestLab, App, IEM, etc.) defined in them.
//
// 2026 god-file refactor: the former single monolithic app-core.js file
// (22.7k lines) was split into the 9 files below, physically cut along its
// boundaries with NO reordering and NO content changes (verified
// byte-for-byte against the original via reconstruction diff before the old
// file was removed). They are listed here in the exact sequence they used to
// appear inline inside app-core.js, so concatenation output is unchanged:
const src = [
  'app/js/utils.js','app/js/endgame-categories.js','app/js/audio-engine.js','app/js/safe-storage.js','app/js/accessibility.js','app/js/ui-kit.js',
  'app/js/shortcuts.js','app/js/eq-export.js',
  'app/js/eq-playlist.js','app/js/eq-reverb.js','app/js/eq-crossfeed.js','app/js/eq-crossover.js','app/js/eq-dynamics.js',
  'app/js/eq-loudness.js','app/js/eq-tempo.js','app/js/eq-smart-import.js','app/js/eq-hearing-cal.js','app/js/eq-viz-fullscreen.js',
  'app/js/eq-source-sim.js','app/js/eq-presets.js','app/js/eq-band-handlers.js','app/js/eq-draw-curve.js','app/js/eq-squig-graph.js',
  'app/js/eq-math-utils.js','app/js/iem-search.js','app/js/eq-sculptor.js','app/js/app-theme.js','app/js/events.js',
  'app/js/app-core-shared.js','app/js/mascot-module.js','app/js/iem-module.js','app/js/tone-module.js',
  // eq-core.js god-file split (Phase 7): data + method-set files extracted
  // from eq-core.js. eq-presets-data.js loads BEFORE the trunk (pure data,
  // no deps); the method-set files load AFTER the trunk and BEFORE
  // db-cache.js (which merges them into EQ_Module via Object.assign) —
  // identical evaluation order to the pre-split single file.
  'app/js/eq-presets-data.js',
  'app/js/eq-core.js',
  'app/js/eq-tape-mod.js',
  'app/js/eq-biquad-math.js',
  'app/js/eq-magnitude-engine.js',
  'app/js/eq-genre-targets.js',
  'app/js/eq-dsp-graph.js',
  'app/js/eq-media-transport.js',
  'app/js/eq-graph-input.js',
  'app/js/eq-visualizer.js',
  'app/js/db-cache.js','app/js/peqdb-module.js','app/js/testlab-module.js','app/js/find-engine.js',
  'app/js/handlers.js','app/js/app-init.js'
];

const parts = [];
for (const rel of src) {
  const fp = join(root, rel);
  if (!existsSync(fp)) throw new Error('missing source: ' + rel);
  parts.push(`/* ===== ${rel} ===== */`);
  parts.push(readFileSync(fp, 'utf8'));
}
const raw = parts.join('\n');

writeFileSync(join(root, 'app', 'js', 'app.bundle.js'), raw);

// Content-hash version marker, consumed by index.html as the `?v=` cache-bust
// for both app.bundle.js and app.bundle.min.js. Only changes when the
// concatenated source actually changes, so the browser can cache the bundle
// across reloads instead of re-fetching it on every page load.
const version = createHash('sha256').update(raw).digest('hex').slice(0, 12);
writeFileSync(join(root, 'app', 'js', 'bundle-version.js'), `window.BUNDLE_VERSION = ${JSON.stringify(version)};\n`);

// Stamp the same hash into index.html's bundle-version.js <script src> so the
// version file itself is cache-busted on real changes. Without this the tiny
// version file (and the bundle it points at) could be served stale forever
// from a browser cache that never sees a new URL.
const indexPath = join(root, 'index.html');
const indexSrc = readFileSync(indexPath, 'utf8');
const marker = 'app/js/bundle-version.js?v=';
const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const newIndexSrc = indexSrc.replace(new RegExp(escapedMarker + "[^\"']+"), marker + version);
if (indexSrc.indexOf(marker) === -1) {
  throw new Error('could not find "' + marker + '" script tag in index.html to stamp version');
}
writeFileSync(indexPath, newIndexSrc);

console.log('built ' + src.length + ' files');
console.log('app.bundle.js      :', Buffer.byteLength(raw, 'utf8'), 'bytes');
console.log('bundle-version.js  :', version);

// terser is a devDependency used for the minified/packaged build. In plain
// (non --strict) mode, if it isn't installed (e.g. `npm install` hasn't been
// run yet), skip minification instead of failing the whole build -
// app.bundle.js + bundle-version.js are still produced and the unpackaged
// app still runs. In --strict mode (used by predist* before packaging),
// a missing or failing terser aborts the build instead: a packaged app that
// silently shipped a stale/missing app.bundle.min.js is worse than a build
// that refuses to run.
let terserInstalled = true;
try {
  await import('terser');
} catch (e) {
  terserInstalled = false;
}
if (!terserInstalled) {
  if (strict) {
    console.error('\n[build-bundle] --strict: terser is not installed.');
    console.error('[build-bundle] Run `npm install` (terser is listed as a devDependency)');
    console.error('[build-bundle] then re-run the dist script. Refusing to package without a fresh app.bundle.min.js.\n');
    process.exit(1);
  }
  console.warn('\n[build-bundle] Skipped minified build (terser unavailable)');
  console.warn('[build-bundle] Run `npm install` (terser is already listed as a devDependency)');
  console.warn('[build-bundle] then re-run this script to refresh app.bundle.min.js.');
  console.warn('[build-bundle] app.bundle.js and bundle-version.js were still rebuilt.\n');
} else {
  try {
    const { minify } = await import('terser');
    const out = await minify(raw, { compress: true, mangle: true, toplevel: false, keep_fnames: false });
    if (!out.code) throw new Error('minify failed');
    writeFileSync(join(root, 'app', 'js', 'app.bundle.min.js'), out.code);
    console.log('app.bundle.min.js  :', Buffer.byteLength(out.code, 'utf8'), 'bytes');
  } catch (e) {
    console.error('\n[build-bundle] Minification FAILED: ' + e.message);
    console.error('[build-bundle] app.bundle.min.js would be stale; aborting build.');
    process.exit(1);
  }
}
