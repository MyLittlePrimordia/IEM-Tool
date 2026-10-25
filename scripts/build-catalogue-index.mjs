// Builds catalogue-index.json(.gz): a precomputed, source-aware signature for
// every product in database.json.
//
// Why this exists
// ---------------
// A full Find scan used to score one file per product (files[0]). 2,000+ of
// the 5,300 products have several measurements, and they can disagree by 20+
// points. Loading all 11,398 curve files at runtime is not viable, so this
// script computes a stock-measurement median for each product once and stores
// it as a 100-point, 0.25 dB-quantized base64 blob (100 bytes per product).
//
// The app decodes it in app/js/source-index.js and Find scores the consensus.
// Per-source curves are still loaded on demand for the explorer.
//
// Run with: node scripts/build-catalogue-index.mjs
// Add --check to verify the existing index matches database.json.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const CurveUtils = require(join(root, 'app/js/utils.js'));
const GRID_POINTS = 100;
const GRID = Array.from(CurveUtils.generateLogGrid(GRID_POINTS));
const OUT_JSON = join(root, 'catalogue-index.json');
const OUT_GZ = join(root, 'catalogue-index.json.gz');

const MOD_RE = /(adapter|impedance|foam|mod\b|tape|vent|nozzle|filter|mesh|damper|tanya|switch|sample|\d+\s*(?:ohm|ω))/i;

function parsePath(filePath) {
  const raw = String(filePath || '').replace(/\\/g, '/');
  const parts = raw.split('/').filter(Boolean);
  const file = parts.length ? parts[parts.length - 1].replace(/\.[^.]+$/, '') : '';
  return { source: parts.length >= 2 ? parts[parts.length - 2] : '', file };
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function quantile(values, q) {
  const s = values.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

function quantize(interp) {
  const bytes = new Uint8Array(interp.length);
  for (let i = 0; i < interp.length; i++) {
    let q = Math.round((interp[i] - 75) * 4);
    if (q < -128) q = -128;
    if (q > 127) q = 127;
    bytes[i] = q & 0xff;
  }
  return Buffer.from(bytes).toString('base64');
}

function curveInterp(filePath) {
  const full = join(root, filePath);
  if (!existsSync(full)) return null;
  let text;
  try { text = readFileSync(full, 'utf8'); } catch (_) { return null; }
  const data = CurveUtils.parseCurveText(text);
  if (!data || data.length < 2) return null;
  const norm = CurveUtils.normalizeTo75dB(data, 500, 75);
  if (!norm || norm.length < 2) return null;
  return CurveUtils.cubicSplineInterpolate(norm, GRID);
}

const checkOnly = process.argv.includes('--check');
if (checkOnly && existsSync(OUT_JSON)) {
  const existing = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
  const db = JSON.parse(readFileSync(join(root, 'database.json'), 'utf8'));
  const ids = new Set(Object.keys(existing.entries || {}));
  const missing = db.filter(e => !ids.has(String(e.id))).length;
  console.log(`catalogue index: ${ids.size} entries, ${db.length} products, ${missing} missing`);
  if (missing > 0) process.exit(1);
  process.exit(0);
}

const database = JSON.parse(readFileSync(join(root, 'database.json'), 'utf8'));
const entries = {};
let withIndex = 0;
let totalFiles = 0;
let loaded = 0;
const started = Date.now();

for (let n = 0; n < database.length; n++) {
  const product = database[n];
  if (!product || product.id == null) continue;
  const files = Array.isArray(product.files) ? product.files : [];
  if (!files.length) continue;
  totalFiles += files.length;

  const curves = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const meta = parsePath(filePath);
    const interp = curveInterp(filePath);
    loaded++;
    if (!interp) continue;
    curves.push({ interp, isMod: MOD_RE.test(meta.file) });
  }

  if (!curves.length) continue;
  const stock = curves.filter(c => !c.isMod);
  const use = stock.length ? stock : curves;

  const medianInterp = new Float32Array(GRID_POINTS);
  let spread = 0;
  for (let p = 0; p < GRID_POINTS; p++) {
    const column = use.map(c => c.interp[p]);
    medianInterp[p] = median(column);
    spread += (quantile(column, 0.9) - quantile(column, 0.1)) / 2;
  }

  entries[String(product.id)] = {
    n: curves.length,
    m: use.length,
    s: Math.round((spread / GRID_POINTS) * 100) / 100,
    q: quantize(medianInterp)
  };
  withIndex++;
}

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  gridPoints: GRID_POINTS,
  entries
};
const json = JSON.stringify(payload);
writeFileSync(OUT_JSON, json);
writeFileSync(OUT_GZ, gzipSync(Buffer.from(json, 'utf8'), { level: 9 }));
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`catalogue index: ${withIndex} products, ${loaded}/${totalFiles} curves read, ${seconds}s`);
console.log(`  ${OUT_JSON} ${(statSync(OUT_JSON).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  ${OUT_GZ} ${(statSync(OUT_GZ).size / 1024).toFixed(0)} KB`);
