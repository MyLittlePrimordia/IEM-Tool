// Reproducible JS bundle builder.
// Concats the app's source scripts (in load order) into js/app.bundle.js and a
// minified js/app.bundle.min.js. Order MUST match the original <script src>
// sequence. chart.js and tailwindcss.js are intentionally NOT included (chart.js
// is injected at runtime via injectScriptAsync; tailwindcss.js is unused at rt).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Source-of-truth load order (matches the pre-bundling <script> tags).
const src = [
  'js/utils.js','js/audio-engine.js','js/safe-storage.js','js/accessibility.js','js/eq-export.js',
  'js/eq-playlist.js','js/eq-reverb.js','js/eq-crossfeed.js','js/eq-crossover.js','js/eq-dynamics.js',
  'js/eq-loudness.js','js/eq-tempo.js','js/eq-smart-import.js','js/eq-hearing-cal.js','js/eq-viz-fullscreen.js',
  'js/eq-source-sim.js','js/eq-presets.js','js/eq-band-handlers.js','js/eq-draw-curve.js','js/eq-squig-graph.js',
  'js/eq-math-utils.js','js/app-core.js','js/app-init.js'
];

const parts = [];
for (const rel of src) {
  const fp = join(root, rel);
  if (!existsSync(fp)) throw new Error('missing source: ' + rel);
  parts.push(`/* ===== ${rel} ===== */`);
  parts.push(readFileSync(fp, 'utf8'));
}
const raw = parts.join('\n');

writeFileSync(join(root, 'js', 'app.bundle.js'), raw);

const out = await minify(raw, { compress: true, mangle: true, toplevel: false, keep_fnames: false });
if (!out.code) throw new Error('minify failed');
writeFileSync(join(root, 'js', 'app.bundle.min.js'), out.code);

console.log('built ' + src.length + ' files');
console.log('app.bundle.js     :', Buffer.byteLength(raw, 'utf8'), 'bytes');
console.log('app.bundle.min.js :', Buffer.byteLength(out.code, 'utf8'), 'bytes');