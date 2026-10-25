// Guard: every tools/ script that launches Electron must isolate its profile.
//
// The suites and probes in tools/ drive the REAL app - smoke-runtime clicks every
// data-action control, the theme probes switch themes, the output-device suite
// picks a DAC. Whatever they touch persists into the user's own profile under
// %APPDATA%/iem-tool. tools/lib/verify-profile.js exists to send each run to a
// throwaway directory, but the only thing enforcing it was care: a new probe
// copied from an older one, or a helper added above the existing call, silently
// reintroduced the bug this whole system exists to prevent.
//
// Static, so it costs nothing at runtime and cannot be skipped by a suite that
// exits early. Presence is the drift that actually happened, so that is what
// this checks: an Electron entry point with no isolateProfile() call fails.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(root, 'tools');
const HELPER = join(TOOLS, 'lib', 'verify-profile.js');

// The helper is the one file allowed to touch the profile: it is what moves it.
const EXEMPT = new Set([HELPER]);
// Both spellings are in use; electron/main is the modern subpath.
const USES_ELECTRON = /require\(\s*['"](?:electron|electron\/main)['"]\s*\)|from\s+['"]electron(?:\/main)?['"]/;
const ISOLATED = /\.isolateProfile\s*\(/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs, out); continue; }
    if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

function labelFor(file) {
  return relative(TOOLS, file).replace(/\\/g, '/').replace(/\.(?:js|mjs|cjs)$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'suite';
}

const failures = [];
let electronScripts = 0;
for (const file of walk(TOOLS)) {
  if (EXEMPT.has(file)) continue;
  const src = readFileSync(file, 'utf8');
  if (!USES_ELECTRON.test(src)) continue;
  electronScripts++;
  if (ISOLATED.test(src)) continue;
  let spec = relative(dirname(file), HELPER).split(sep).join('/').replace(/\.js$/, '');
  if (!spec.startsWith('.')) spec = './' + spec;
  failures.push({ file, spec, label: labelFor(file) });
}

if (failures.length) {
  for (const f of failures) {
    console.error(`FAIL ${relative(root, f.file).replace(/\\/g, '/')}`);
    console.error('     launches Electron but never isolates its profile, so it writes to the real app profile.');
    console.error('     Add this near the top, before anything opens a window:');
    console.error(`       require('${f.spec}').isolateProfile('${f.label}');`);
  }
  console.error(`\n${failures.length}/${electronScripts} Electron scripts FAILED`);
  process.exit(1);
}

console.log(`OK - ${electronScripts} Electron scripts, all on a throwaway profile`);
