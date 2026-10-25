// Syntax-check every JS file in js/, effects/, scripts/ and tools/, plus the
// Electron entry points at the repo root (skip node_modules and temp). Uses
// `node --check` (parse only, no execution) so it's safe for browser globals.
//
// tools/ is included because those scripts drive the real app in CI and by hand,
// and they are where a broken probe hides: nothing imports them, so a stray brace
// or a bad paste only surfaced minutes into an Electron run, mid-suite, with the
// real cause buried under the app's console output.
//
// main.js, preload.js and theme-backdrop.js are listed explicitly rather than by
// walking the root, because the root also holds config/asset files we must not
// parse as app source. They are the worst possible place for a parse error to
// hide: main.js owns the window, the IPC handlers and the update checks, so a
// broken one means the app never opens - no window, no console, nothing. The
// import loop below only walks directories, so these three were the single
// biggest blind spot left in this check.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['app/js', 'app/effects', 'scripts', 'tools'];
const entryFiles = ['main.js', 'preload.js', 'theme-backdrop.js'];
const PARSES_AS_JS = /\.(?:js|mjs|cjs)$/;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) collect(abs, out);
      continue;
    }
    if (entry.isFile() && PARSES_AS_JS.test(entry.name)) out.push(abs);
  }
  return out;
}

const files = [];
for (const d of dirs) {
  const abs = join(root, d);
  if (statSync(abs, { throwIfNoEntry: false })) collect(abs, files);
}

// A missing entry point is a failure, not a skip: silently dropping one would
// turn this check into a pass over 175 files while the app cannot start.
let missing = 0;
for (const name of entryFiles) {
  const abs = join(root, name);
  if (statSync(abs, { throwIfNoEntry: false })) files.push(abs);
  else { missing++; console.error('MISSING', name + ' - listed as an Electron entry point'); }
}

let failed = 0;
for (const fp of files.sort()) {
  const r = spawnSync(process.execPath, ['--check', fp], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error('FAIL', relative(root, fp).replace(/\\/g, '/')); console.error(r.stderr); }
}

if (failed || missing) {
  if (failed) console.error(`\n${failed}/${files.length} files FAILED`);
  if (missing) console.error(`${missing} entry point(s) missing`);
  process.exit(1);
}
console.log(`OK - ${files.length} files parsed clean (${entryFiles.length} Electron entry points)`);