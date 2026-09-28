// Adds accessible names to the interactive controls the DOM audit found
// unnamed: icon-only transport buttons and range inputs with no label. Adds an
// aria-label only where one is absent, so nothing already named is touched.
//
//   node tools/add-aria-labels.js [--apply]
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const file = path.join(__dirname, '..', 'index.html');
let src = fs.readFileSync(file, 'utf8');

// Each entry: a unique anchor already present in the tag, plus the label to add.
const BUTTONS = [
  ['id="playlist-shuffle-btn"', 'Shuffle'],
  ['id="playlist-play-btn"', 'Play or pause'],
  ['id="playlist-repeat-btn"', 'Repeat'],
  ['data-action="click_20_EQ_prevTrack"', 'Previous track'],
  ['data-action="click_81_EQ_nextTrack"', 'Next track'],
  ['data-action="click_282_EQ_clearPlaylist"', 'Clear playlist']
];

const SLIDERS = [
  ['id="eq-musicVolumeSlider"', 'Music volume'],
  ['id="playlist-scrub"', 'Track position'],
  ['id="find-bass"', 'Bass impact'],
  ['id="find-sub"', 'Sub-bass rumble'],
  ['id="find-punch"', 'Bass punch'],
  ['id="find-warm"', 'Warmth and body'],
  ['id="find-vocals"', 'Vocal clarity'],
  ['id="find-treble"', 'Treble detail'],
  ['id="find-smooth"', 'Sibilance reduction']
];

let added = 0;
let skipped = 0;

function addLabel(anchor, label) {
  const i = src.indexOf(anchor);
  if (i === -1) { console.log(`  MISSING anchor: ${anchor}`); skipped++; return; }
  // Find the start of this tag.
  const start = src.lastIndexOf('<', i);
  const end = src.indexOf('>', i);
  if (start === -1 || end === -1) { console.log(`  could not bound tag for ${anchor}`); skipped++; return; }
  const tag = src.slice(start, end + 1);
  if (/aria-label\s*=/.test(tag)) { console.log(`  already named: ${anchor}`); skipped++; return; }
  // Insert the attribute just before the closing > of the opening tag.
  const insertAt = end;
  const updated = tag.slice(0, insertAt - start) + ` aria-label="${label}"` + tag.slice(insertAt - start);
  src = src.slice(0, start) + updated + src.slice(end + 1);
  added++;
  console.log(`  + ${label.padEnd(22)} -> ${anchor}`);
}

console.log('buttons:');
for (const [a, l] of BUTTONS) addLabel(a, l);
console.log('sliders:');
for (const [a, l] of SLIDERS) addLabel(a, l);

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${added} aria-label(s) added, ${skipped} skipped`);

if (APPLY && added) {
  fs.writeFileSync(file, src);
  console.log('index.html updated');
}
