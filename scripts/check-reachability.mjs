// Reachability guard for the app's JS graph.
// Fails if any *.js under js/ or effects/ is not reachable from the app's
// load graph: index.html <script> tags, the build-bundle.mjs src list, a
// runtime reference (injectScriptAsync, new Worker, AudioWorklet.addModule,
// fetch of effects/visualizer.json), or the visualizer.json effect index.
// Also fails if a reference points to a .js file that doesn't exist.
// This is cheap insurance against an orphaned multi-hundred-KB file (e.g. a
// stray tailwindcss.js runtime) sneaking back into the repo and shipping in
// the Electron package or a static GitHub Pages deploy.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['app/js', 'app/effects'];

// Generated bundle artifacts that index.html builds dynamically
// ('js/app.bundle' + (isPackaged ? '.min' : '') + '.js') and that
// build-bundle.mjs writes as build output.
const GENERATED = ['app/js/app.bundle.js', 'app/js/app.bundle.min.js'];

const files = new Set();
for (const d of dirs) {
  const abs = join(root, d);
  if (!statSync(abs, { throwIfNoEntry: false })) continue;
  for (const name of readdirSync(abs)) {
    if (!name.endsWith('.js') || !statSync(join(abs, name)).isFile()) continue;
    files.add(`${d}/${name}`);
  }
}

const scanTargets = ['index.html', 'scripts/build-bundle.mjs', 'app/effects/visualizer.json'];
for (const d of dirs) {
  const abs = join(root, d);
  if (!statSync(abs, { throwIfNoEntry: false })) continue;
  for (const name of readdirSync(abs)) {
    if (!name.endsWith('.js')) continue;
    if (GENERATED.includes(`${d}/${name}`) || name === 'bundle-version.js') continue;
    scanTargets.push(`${d}/${name}`);
  }
}

const reachable = new Set();
const missing = new Set();

function addRef(ref) {
  if (!ref) return;
  const norm = ref.replace(/^\.\//, '');
  if (files.has(norm)) {
    reachable.add(norm);
  } else if (GENERATED.includes(norm)) {
    // index.html constructs these dynamically, so mark them reachable as
    // long as the source actually mentions the bundle prefix.
    reachable.add(norm);
  } else {
    missing.add(norm);
  }
}

for (const rel of scanTargets) {
  const fp = join(root, rel);
  if (!statSync(fp, { throwIfNoEntry: false })) continue;
  const text = readFileSync(fp, 'utf8');

  if (rel.endsWith('visualizer.json')) {
    try {
      for (const effect of JSON.parse(text)) {
        if (effect && typeof effect.file === 'string') addRef(`app/effects/${effect.file}`);
      }
    } catch (e) {
      console.error('FAIL', rel, 'invalid JSON:', e.message);
      process.exit(1);
    }
    continue;
  }

  const refRe = /app\/(?:js|effects)\/[\w.-]+\.js\b/g;
  for (const m of text.matchAll(refRe)) addRef(m[0]);

  // index.html builds the bundle name dynamically:
  // bundleScript.src = 'js/app.bundle' + (isPackaged ? '.min' : '') + '.js?...'
  if (/app\/js\/app\.bundle/.test(text)) {
    for (const g of GENERATED) reachable.add(g);
  }
}

const orphans = [...files].filter((f) => !reachable.has(f)).sort();
const missingList = [...missing].sort();

if (orphans.length || missingList.length) {
  for (const f of orphans) console.error('UNREACHABLE  ' + f);
  for (const f of missingList) console.error('MISSING REF  ' + f);
  console.error(`\n${orphans.length} unreachable file(s), ${missingList.length} dangling reference(s)`);
  process.exit(1);
}

console.log(`OK - ${files.size} script files, all reachable`);