// Compares two slider-audit JSON files and explains any slider whose geometry
// or fill changed. Run after an ERG-006 style change to see exactly what moved.
const fs = require('fs');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const flat = (o) => {
  const m = new Map();
  for (const [view, rows] of Object.entries(o)) {
    for (const r of rows) {
      const key = (r.id || '(no-id)') + ' | ' + (r.cls || '(no-class)');
      if (!m.has(key)) m.set(key, { view, ...r });
    }
  }
  return m;
};
const A = flat(a), B = flat(b);
const keys = [...new Set([...A.keys(), ...B.keys()])].sort();

const r2 = n => Math.round(n * 100) / 100;
let stillShort = 0, grew = 0, shifted = 0, fillLost = 0;

for (const k of keys) {
  const x = A.get(k), y = B.get(k);
  if (!x || !y) { console.log(`  ONLY IN ONE: ${k}`); continue; }
  const notes = [];
  if (x.h !== y.h) notes.push(`box ${x.h}->${y.h}`);
  if (Math.abs(x.y - y.y) > 0.6) notes.push(`y ${r2(x.y)}->${r2(y.y)} (SHIFT ${r2(y.y - x.y)}px)`);
  if (x.bg !== y.bg) notes.push(`fill ${x.bg}->${y.bg}`);
  if (x.trackH !== y.trackH) notes.push(`trackH ${x.trackH}->${y.trackH}`);
  if (y.h < 24) stillShort++;
  if (y.h > x.h) grew++;
  if (notes.some(n => n.includes('SHIFT'))) shifted++;
  if (x.bg === 'gradient' && y.bg === 'flat') fillLost++;
  if (notes.length) console.log(`  ${k}\n      ${notes.join('  |  ')}`);
}

console.log('');
console.log(`sliders still under 24px : ${stillShort} of ${keys.length}`);
console.log(`sliders that grew         : ${grew}`);
console.log(`sliders that SHIFTED in y : ${shifted}   (must be 0 - negative margins should hold layout)`);
console.log(`gradients lost their fill : ${fillLost}   (must be 0)`);
console.log('');
if (stillShort) {
  console.log('remaining under 24px:');
  for (const k of keys) { const y = B.get(k); if (y && y.h < 24) console.log(`   h=${y.h} cssH=${y.cssH} cls=[${y.cls}] id=${y.id || '-'}`); }
}
