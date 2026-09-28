// Converts attribute-form inline handlers in JS template strings into the
// data-cmd / data-cmd-input / data-cmd-change form handled by events.js.
//
//   node tools/convert-to-data-cmd.js [--apply] [file.js ...]
//
// Handles the shapes actually present in this codebase:
//   onclick="EQ.cycleBandType(${i})"                  -> data-cmd + data-arg-N
//   oninput="EQ.handleStandardSlider(${i}, this.value)"-> data-cmd-input, @value
//   onclick="event.stopPropagation(); PEQDB.cycleDbItemSource('${escJs(x)}', -1)"
//                                                          -> data-cmd + args
//
// Deliberately refuses anything it cannot parse confidently rather than
// guessing, because a mangled call is worse than an inline handler.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
// argv[0] is node and argv[1] is this script; skip both or the tool rewrites
// its own source (it did, once, and reported 1 phantom conversion).
const targets = process.argv.slice(2).filter(a => a.endsWith('.js'));
if (!targets.length) { console.error('usage: node tools/convert-to-data-cmd.js [--apply] <file.js> [...]'); process.exit(1); }

const EVENT_ATTR = { click: 'data-cmd', input: 'data-cmd-input', change: 'data-cmd-change' };

// A single argument: a number, a quoted string, a `this.X` reference, a
// template expression such as ${i} — which is still interpolated when the
// surrounding template literal is evaluated, so it passes through verbatim — or
// the `this.closest('[data-uid]').dataset.uid` shape the PEQdb rows use.
function parseArg(src) {
    const s = src.trim();
    if (s === 'this.value') return '@value';
    if (s === 'this.checked') return '@checked';
    if (s === 'this') return '@self';
    const from = s.match(/^this\.closest\(\s*['"]\[data-([\w-]+)\]['"]\s*\)\.dataset\.([\w-]+)$/);
    if (from) {
        if (from[1] !== from[2]) return null;   // e.g. data-uid -> dataset.name
        return '@from:' + from[1];
    }
    if (/^\$\{[\s\S]*\}$/.test(s)) return s;
    if (/^-?\d*\.?\d+$/.test(s)) return s;
    const q = s.match(/^'([\s\S]*)'$/);
    if (q) return q[1];            // already JS-escaped by escJs in the source
    return null;
}

function splitTopLevel(body) {
    const out = [];
    let depth = 0, q = null, cur = '';
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (q) { cur += c; if (c === q && body[i - 1] !== '\\') q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) depth--;
        if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

// A handler body may be `<call>` or `event.stopPropagation(); <call>`.
function parseBody(body) {
    let b = body.trim();
    const stop = b.match(/^event\.stopPropagation\(\)\s*;\s*/);
    if (stop) b = b.slice(stop[0].length);
    const m = b.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?$/);
    if (!m) return null;
    const [, mod, fn, argstr] = m;
    const args = [];
    for (const raw of splitTopLevel(argstr)) {
        const a = parseArg(raw);
        if (a === null) return null;
        args.push(a);
    }
    return { mod, fn, args };
}

function escapeAttr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let totalConverted = 0;
let totalSkipped = 0;

for (const rel of targets) {
  const file = path.resolve(ROOT, rel);
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const skippedHere = [];

  src = src.replace(/\s+on(click|input|change)=(["'])([\s\S]*?)\2/g, (m, ev, q, body) => {
    // A bare stopPropagation with no call: becomes a marker attribute.
    if (/^event\.stopPropagation\(\)\s*;?$/.test(body.trim())) {
      totalConverted++;
      return ' data-stop-propagation';
    }
    // An empty handler is dead markup; drop the attribute entirely.
    if (body.trim() === '') { totalConverted++; return ''; }
    const parsed = parseBody(body);
    if (!parsed) { skippedHere.push(ev + '="' + body.slice(0, 70) + '"'); totalSkipped++; return m; }
    const attr = EVENT_ATTR[ev];
    let out = ' ' + attr + '="' + escapeAttr(parsed.mod + '.' + parsed.fn) + '"';
    parsed.args.forEach((a, i) => { out += ' data-arg-' + i + '="' + escapeAttr(a) + '"'; });
    totalConverted++;
    return out;
  });

  if (src !== original) {
    console.log(`\n${rel}:`);
    const added = (src.match(/data-cmd(-input|-change)?=/g) || []).length;
    console.log(`  converted ${added} handler(s)`);
    if (APPLY) { fs.writeFileSync(file, src); console.log('  written'); }
  } else {
    console.log(`\n${rel}: no convertible handlers`);
  }
  if (skippedHere.length) {
    console.log(`  left alone (${skippedHere.length}) - could not parse confidently:`);
    skippedHere.forEach(s => console.log('    ' + s));
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${totalConverted} converted, ${totalSkipped} left as inline handlers`);
