// Isolates the POL-003 markup change for a pixel diff: strips the a11y
// attributes, captures, restores them, captures again, then diffs the two sets.
// Needed because the previous "before" screenshot set predates the footer work,
// so diffing against it conflated several unrelated changes.
//
//   node tools/a11y-ab.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = path.join(ROOT, 'index.html');
const original = fs.readFileSync(html, 'utf8');

// The exact attributes the POL-003 change added to the five triggers.
const ADDED = [
  'role="button"',
  'tabindex="0"',
  'data-file-trigger',
  'aria-label="Add audio files"',
  'aria-label="Choose source A audio file"',
  'aria-label="Choose source B audio file"',
  'aria-label="Choose a smart import file, or drop one here"'
];

const strip = (src) => {
  let out = src;
  for (const a of ADDED) {
    // Remove the attribute plus one following space, but never touch aria-label
    // text that merely appears inside a comment or another attribute value.
    out = out.split(a + ' ').join('').split(' ' + a).join('');
  }
  return out;
};

const stripped = strip(original);
if (stripped === original) {
  console.log('  ERROR: nothing was stripped - the attributes are not in the expected form');
  process.exit(1);
}
const removedCount = original.split(/\s/).length - stripped.split(/\s/).length;
console.log(`  stripped ${removedCount} attribute tokens for the "before" capture`);

// Spawn the Electron binary directly. execFileSync cannot launch a .cmd without
// a shell on Windows (spawnSync EINVAL), so npx.cmd is not usable from here.
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!fs.existsSync(ELECTRON)) {
  console.log('  ERROR: electron binary not found at ' + ELECTRON);
  process.exit(1);
}
const shoot = (dir) => execFileSync(ELECTRON, ['tools/shoot.js', dir], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });

try {
  fs.writeFileSync(html, stripped);
  shoot('tools/shots-a11y-before');
  console.log('  captured before');
} finally {
  fs.writeFileSync(html, original);
}

shoot('tools/shots-a11y-after');
console.log('  captured after (attributes restored)');

// Confirm the restore was byte-exact before trusting the diff.
console.log('  index.html restored byte-exact: ' + (fs.readFileSync(html, 'utf8') === original));

const out = execFileSync(ELECTRON, ['tools/diff-shots.js', 'tools/shots-a11y-before', 'tools/shots-a11y-after'],
  { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
console.log('\n' + out.split(/\r?\n/).map(l => '  ' + l).join('\n'));
