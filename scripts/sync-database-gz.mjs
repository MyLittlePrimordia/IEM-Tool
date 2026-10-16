// Keeps database.json.gz in step with database.json.
//
//   node scripts/sync-database-gz.mjs
//
// database.json is the single source of truth. The app prefers the .gz and only
// falls back to the .json, so a stale .gz silently shows the OLD catalogue, and
// the integrity check used to fail the whole build when someone edited the json
// and forgot to regenerate the .gz by hand. This script removes that chore: it is
// run before every integrity check / package build and rewrites the .gz only when
// its CONTENT differs, so the file does not churn in git when nothing changed.
//
// It deliberately does not care what is IN the database (entry count, brands,
// files). It only compresses whatever database.json currently contains.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = join(root, 'database.json');
const gzPath = join(root, 'database.json.gz');

if (!existsSync(jsonPath)) {
  console.log('sync-database-gz: no database.json, nothing to do');
  process.exit(0);
}

const json = readFileSync(jsonPath);
let current = null;
if (existsSync(gzPath)) {
  try { current = gunzipSync(readFileSync(gzPath)); } catch { current = null; }
}

if (current && current.equals(json)) {
  console.log('sync-database-gz: database.json.gz already matches database.json');
} else {
  writeFileSync(gzPath, gzipSync(json, { level: 9 }));
  console.log(`sync-database-gz: regenerated database.json.gz (${json.length} -> ${readFileSync(gzPath).length} bytes)`);
}
