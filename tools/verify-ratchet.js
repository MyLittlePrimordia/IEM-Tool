// Proves the runtime inline-handler ratchet actually fails when a new
// onclick="..." markup string is added, then restores the file. A ratchet that
// cannot fail is worse than no ratchet, so this is verified rather than assumed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const target = path.join(ROOT, 'app', 'js', 'tone-module.js');
const original = fs.readFileSync(target, 'utf8');
const check = path.join(ROOT, 'scripts', 'check-integrity.mjs');

const run = () => {
  try {
    return { ok: true, out: execFileSync('node', [check], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

const before = run();
const line = before.out.split(/\r?\n/).find(l => l.includes('runtime inline-handler sites'));
console.log('  before: ' + (line || '(not reported)').trim());
console.log('  exit ok: ' + before.ok);

try {
  fs.writeFileSync(target, original + '\nconst __ratchetProbe = `<button onclick="EQ.probe()">x</button>`;\n');
  const after = run();
  const afterLine = after.out.split(/\r?\n/).find(l => l.includes('runtime inline-handler sites'));
  const failLine = after.out.split(/\r?\n/).find(l => l.includes('RUNTIME INLINE HANDLERS'));
  console.log('  after adding one site:');
  console.log('    ' + (afterLine || '(not reported)').trim());
  console.log('    ' + (failLine ? 'FAIL raised: ' + failLine.trim() : 'NO FAIL RAISED  <-- ratchet is broken'));
  console.log('    exit ok (should be false): ' + after.ok);
} finally {
  fs.writeFileSync(target, original);
  const restored = run();
  const restoredLine = restored.out.split(/\r?\n/).find(l => l.includes('runtime inline-handler sites'));
  console.log('  restored: ' + (restoredLine || '(not reported)').trim());
  console.log('  exit ok after restore: ' + restored.ok);
}

// Second ratchet: a new dead getElementById reference must also fail.
try {
  fs.writeFileSync(target, original + '\nconst __deadProbe = document.getElementById("totally-absent-id");\n');
  const after = run();
  const failLine = after.out.split(/\r?\n/).find(l => l.includes('DEAD ID REFS'));
  console.log('  dead-id ratchet: ' + (failLine ? 'FAIL raised' : 'NO FAIL RAISED  <-- ratchet is broken'));
  console.log('    exit ok (should be false): ' + after.ok);
} finally {
  fs.writeFileSync(target, original);
  console.log('  exit ok after final restore: ' + run().ok);
}

// Third ratchet: a dead id that is 1-2 characters from a LIVE id is the
// signature of a rename/typo, where the code silently stops updating a real
// element. That must be reported separately from ordinary vestigial dead code,
// so it gets its own probe ("crossfeed-level" is a live id in index.html).
try {
  fs.writeFileSync(target, original + '\nconst __typoProbe = document.getElementById("crossfeed-leve");\n');
  const after = run();
  const typoLine = after.out.split(/\r?\n/).find(l => l.includes('DEAD ID TYPO'));
  const summary = after.out.split(/\r?\n/).find(l => l.includes('look like TYPOS'));
  console.log('  typo ratchet (1 char from a live id):');
  console.log('    ' + (typoLine ? 'FAIL raised: ' + typoLine.trim() : 'NO FAIL RAISED  <-- typo guard is broken'));
  console.log('    ' + (summary ? 'summary: ' + summary.trim() : '(summary not reported)'));
} finally {
  fs.writeFileSync(target, original);
  const back = run();
  const backSummary = back.out.split(/\r?\n/).find(l => l.includes('dead getElementById'));
  console.log('  restored: ' + (backSummary || '(not reported)').trim());
  console.log('  exit ok after final restore: ' + back.ok);
}
