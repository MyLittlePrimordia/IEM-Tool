// POL-001: strips provably-dead `rounded*` class tokens and non-`!important`
// `border-radius` declarations.
//
// Why this is safe: `app/css/app.css` applies `border-radius: 0px !important`
// to the universal selector, so EVERY rendered element resolves to 0px
// regardless of these tokens/declarations. Verified by tools/radius-snapshot.js
// (693,336 elements across all 5 tabs, all 0px).
//
// Uses a quote-aware scanner rather than a single regex, because a class
// attribute value may legitimately contain the OTHER quote character, e.g.
//   class="... ${hasGraph ? '' : 'hidden'}"
//
// Idempotent. Run without --apply to report only.
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..');
const VENDOR = /chart\.js$|bundle|\.min\.js$/;

// Any assignment of a class-bearing string. `class=`, `className=`, and the
// common `const fooClass = '...'` variable convention.
// NOTE: classList.* is deliberately excluded. Stripping a token from
// classList.add/remove/toggle would change logic rather than markup.
const PREFIX = /(?:\bclass|\bclassName|\b\w*Class(?:Name)?)\s*=\s*(["'])/g;
const TOKEN = /(?:^|\s)rounded(?:-[a-z0-9]+)*(?=\s|$)/g;

function cleanValue(val) {
  TOKEN.lastIndex = 0;
  if (!TOKEN.test(val)) return null;
  TOKEN.lastIndex = 0;
  const cleaned = val.replace(TOKEN, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === val ? null : cleaned;
}

function stripClassTokens(src) {
  let touched = 0;
  let out = '';
  let i = 0;
  PREFIX.lastIndex = 0;
  let m;
  while ((m = PREFIX.exec(src)) !== null) {
    // Copy everything up to and including the opening quote.
    const qStart = m.index + m[0].length - 1;
    const q = m[0][m[0].length - 1];
    // Scan for the matching close quote, honouring backslash escapes.
    let j = qStart + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === q) break;
      j++;
    }
    if (j >= src.length) break; // unterminated: leave the rest untouched
    const val = src.slice(qStart + 1, j);
    const cleaned = cleanValue(val);
    out += src.slice(i, qStart + 1);
    if (cleaned === null) {
      out += val;
    } else {
      touched++;
      out += cleaned;
    }
    i = j;
    PREFIX.lastIndex = j;
  }
  out += src.slice(i);
  return { out, touched };
}

function stripRadiusDecls(src) {
  let removed = 0;
  const keep = m => (/!important/.test(m) ? m : (removed++, ''));
  let out = src;
  // Case A: the declaration occupies a whole line -> drop the entire line so
  // the file's formatting and line count stay intact.
  out = out.replace(/^[ \t]*border-radius\s*:\s*[^;{}]*;[ \t]*\r?\n/gm, keep);
  // Case B1: inline, preceded by whitespace -> take that whitespace with it so
  // no trailing space is orphaned at the end of the line.
  out = out.replace(/[ \t]+border-radius\s*:\s*[^;{}]*;/g, keep);
  // Case B2: inline, at the start of a declaration run.
  out = out.replace(/border-radius\s*:\s*[^;{}]*;[ \t]*/g, keep);
  return { out, removed };
}

const jsDir = path.join(ROOT, 'app', 'js');
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && !VENDOR.test(f));
const targets = [path.join(ROOT, 'index.html')].concat(jsFiles.map(f => path.join(jsDir, f)));

let classTouched = 0;
const changed = [];

for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8');
  const { out, touched } = stripClassTokens(src);
  if (!touched) continue;
  classTouched += touched;
  changed.push(`  ${path.relative(ROOT, file)}: ${touched}`);
  if (APPLY) fs.writeFileSync(file, out);
}

const cssPath = path.join(ROOT, 'app', 'css', 'app.css');
const cssSrc = fs.readFileSync(cssPath, 'utf8');
const cssRes = stripRadiusDecls(cssSrc);
if (APPLY) fs.writeFileSync(cssPath, cssRes.out);

console.log(APPLY ? 'APPLIED' : 'DRY RUN');
console.log(`class-bearing strings cleaned: ${classTouched} in ${changed.length} file(s)`);
changed.forEach(l => console.log(l));
console.log(`border-radius declarations removed from app.css: ${cssRes.removed}`);
