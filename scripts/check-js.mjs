// Syntax-check every JS file in js/ and effects/ (skip node_modules and temp).
// Uses `node --check` (parse only, no execution) so it's safe for browser globals.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['app/js', 'app/effects', 'scripts'];

let failed = 0, checked = 0;
for (const d of dirs) {
  const abs = join(root, d);
  if (!statSync(abs, { throwIfNoEntry: false })) continue;
  for (const name of readdirSync(abs)) {
    if (!name.endsWith('.js')) continue;
    const fp = join(abs, name);
    if (!statSync(fp).isFile()) continue;
    const r = spawnSync(process.execPath, ['--check', fp], { encoding: 'utf8' });
    checked++;
    if (r.status !== 0) { failed++; console.error('FAIL', d + '/' + name); console.error(r.stderr); }
  }
}

if (failed) { console.error(`\n${failed}/${checked} files FAILED`); process.exit(1); }
console.log(`OK - ${checked} files parsed clean`);