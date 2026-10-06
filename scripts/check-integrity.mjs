// Integrity checks that catch the classes of bug `node --check` cannot.
//
// 1. DEAD BUTTONS  — every data-action* token in index.html must have a matching
//    key in app/js/handlers.js. A typo or a deleted handler leaves a button that
//    looks fine and does nothing, which is invisible until someone clicks it.
//
// 2. BUNDLE ORDER  — app/js/db-cache.js bolts ~25 `EQ_*Methods` fragments onto
//    EQ_Module with Object.assign at bundle-eval time, and several other files
//    read those globals at eval time too. Because everything concatenates into
//    one shared scope, reordering the `src` array in build-bundle.mjs would
//    throw a TDZ ReferenceError and ship a completely blank app — while
//    `check:js` (parse-only) and `check:reach` both still pass. This asserts
//    that every fragment is declared before the file that consumes it.
//
// 3. INLINE HANDLER RATCHET — index.html is supposed to be free of on*=
//    attributes (they are the reason script-src needs 'unsafe-inline'). The last
//    13 (4x onfocus, 3x ondragover/ondragleave/ondrop) were migrated to
//    data-action-focus / -dragover / -dragleave / -drop, so the baseline is now
//    0 and any reintroduction fails the build.
//
// 4. RUNTIME-INJECTED INLINE HANDLERS — check 3 only sees static HTML, which made
//    it look like the debt was cleared while the live DOM actually ends up with
//    ~5,600 inline on*= attributes. They come from HTML template strings in the
//    JS modules (eq-core builds 10 band cards full of onclick="...", find-engine
//    and peqdb-module do the same). Only *attribute* form needs 'unsafe-inline';
//    `el.onclick = fn` is ordinary DOM scripting and is fine. This counts the
//    attribute-form sites so the real blocker is measured and cannot grow.
// 5. DEAD getElementById REFERENCES — `getElementById('x')` where no element
//    with id "x" exists in index.html and none is created at runtime. Each of
//    these is a guaranteed null. They are currently all guarded with `if (el)`,
//    so they are dead code rather than live crashes (the runtime smoke test in
//    tools/smoke-runtime.js passes with zero console errors), but an unguarded
//    one added later would throw. Reported and ratcheted rather than mass-deleted,
//    because removing 35 call sites across eight modules for zero user-visible
//    gain is a much worse trade than leaving them counted.
// 6. CSP — script-src must not carry 'unsafe-inline'.
//
//    This was only achievable once BOTH sources of inline script were gone: the
//    13 on*= attributes in the HTML, and the ~5,600 the JS modules injected at
//    runtime through markup strings. The runtime ones moved to data-cmd /
//    data-cmd-input / data-cmd-change (see the data-cmd dispatcher and the
//    dispatcher in events.js), and the bundle loader moved to
//    app/js/boot-bundle.js.
//
//    style-src still needs 'unsafe-inline' because the markup uses style="..."
//    attributes throughout, so only script-src is asserted here.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const problems = [];
const notes = [];

// Every event name an attribute-form handler can legally use. Shared by
// checks #3 (index.html) and #4 (JS template strings) so the two cannot drift.
//
// This list previously read `click|input|change|focus|blur|keydown|dragover|
// drop|dragleave|mouseover|mouseout` in both places, which omitted `mousedown`.
// Three live sites shipped with `onmousedown="..."` and were therefore blocked
// at runtime by `script-src 'self' 'wasm-unsafe-eval'` (no 'unsafe-inline') —
// the brand autocomplete, the PEQdb search chips and the Find brand filter all
// rendered and did nothing on click, while this check reported
// "runtime inline-handler sites: 0".
const ON_ATTR_EVENTS = [
  'click', 'dblclick', 'auxclick',
  'input', 'change', 'submit', 'reset',
  'focus', 'blur', 'focusin', 'focusout',
  'keydown', 'keyup', 'keypress',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  'dragstart', 'dragend', 'dragover', 'dragleave', 'drop',
  'wheel', 'contextmenu',
  'animationstart', 'animationend', 'animationiteration',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  'load', 'error', 'scroll', 'resize', 'select', 'toggle', 'beforeinput', 'inputcapture', 'copy', 'cut', 'paste',
];

// Builds the matcher. `quote` selects `"` only (the markup case) or either
// quote (the template-string case).
const ON_ATTR_RE = (events, quote) => {
  const tail = quote === '"' ? '"' : "['\\\"]";
  return new RegExp('\\bon(?:' + events.join('|') + ')\\s*=\\s*' + tail, 'g');
};

// ---------------------------------------------------------------- 1
{
  const html = read('index.html');
  const handlers = read('app/js/handlers.js');

  // Every key in the handlers table:  "some_key": function (...) {
  const registered = new Set(
    [...handlers.matchAll(/^\s*"([^"]+)"\s*:\s*(?:async\s+)?function/gm)].map((m) => m[1])
  );

  const used = new Map(); // token -> count
  for (const m of html.matchAll(/\bdata-action(?:-input|-change|-blur|-keydown|-focus|-dragover|-dragleave|-drop)?="([^"]+)"/g)) {
    used.set(m[1], (used.get(m[1]) || 0) + 1);
  }

  const dead = [...used.keys()].filter((k) => !registered.has(k)).sort();
  if (dead.length) {
    for (const k of dead) problems.push(`DEAD CONTROL   data-action="${k}" has no handler in app/js/handlers.js`);
  }
  notes.push(`dead controls: ${dead.length} (of ${used.size} data-action tokens used)`);

  // Registered but never wired: informational only, several are invoked from JS.
  const orphanHandlers = [...registered].filter((k) => !used.has(k));
  if (orphanHandlers.length) {
    notes.push(`handlers not referenced in index.html (likely called from JS): ${orphanHandlers.length}`);
  }
}

// ---------------------------------------------------------------- 2
{
  const bundle = read('scripts/build-bundle.mjs');
  const srcMatch = /const src = \[([\s\S]*?)\];/.exec(bundle);
  if (!srcMatch) {
    problems.push('BUNDLE ORDER   could not parse the `src` array from scripts/build-bundle.mjs');
  } else {
    const src = [...srcMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const idx = new Map(src.map((p, i) => [p, i]));

    const dbCacheAt = idx.get('app/js/db-cache.js');
    if (dbCacheAt === undefined) {
      problems.push('BUNDLE ORDER   app/js/db-cache.js is not in the src array');
    } else {
      // Which fragments does db-cache.js bolt on?
      const dbCache = read('app/js/db-cache.js');
      const assigned = new Set(
        [...dbCache.matchAll(/Object\.assign\(\s*EQ_Module\s*,\s*(\w+)\s*\)/g)].map((m) => m[1])
      );

      for (const frag of [...assigned].sort()) {
        // Where is `const <frag> = {` declared?
        let declaredAt = -1;
        let declaredIn = null;
        for (const [i, rel] of src.entries()) {
          const fp = join(root, rel);
          if (!existsSync(fp)) continue;
          if (new RegExp(`const\\s+${frag}\\s*=\\s*\\{`).test(readFileSync(fp, 'utf8'))) {
            declaredAt = i;
            declaredIn = rel;
            break;
          }
        }
        if (declaredAt === -1) {
          problems.push(`BUNDLE ORDER   Object.assign(EQ_Module, ${frag}) but \`const ${frag} = {\` is declared nowhere`);
        } else if (declaredAt > dbCacheAt) {
          problems.push(
            `BUNDLE ORDER   '${declaredIn}' declares ${frag} at src[${declaredAt}] but db-cache.js ` +
            `(which Object.assign's it) is at src[${dbCacheAt}] — this would throw a TDZ ReferenceError and ship a blank app`
          );
        }
      }
      notes.push(`bundle order: ${assigned.size} EQ fragments checked against db-cache.js at src[${dbCacheAt}]`);
    }
  }
}

// ---------------------------------------------------------------- 3
{
  const html = read('index.html');
  // Shares ON_ATTR_EVENTS with check #4 below. They were two separate literals
  // with the same blind spot: `mousedown` was in neither, so an onmousedown
  // attribute in the markup passed both checks. One constant so they cannot
  // drift apart again.
  const inline = [...html.matchAll(ON_ATTR_RE(ON_ATTR_EVENTS, '"'))];
  const BASELINE = 0; // all 13 migrated to data-action-*; must stay at zero
  if (inline.length > BASELINE) {
    problems.push(
      `INLINE HANDLERS  ${inline.length} inline on*= attributes in index.html (ratchet baseline is ${BASELINE}). ` +
      `These force script-src 'unsafe-inline'. Migrate to data-action-* instead of adding more.`
    );
  }
  notes.push(`inline on*= handlers: ${inline.length} (ratchet baseline ${BASELINE})`);
}

// ---------------------------------------------------------------- 4
{
  const jsDir = join(root, 'app', 'js');
  // Same shared event list as check #3. This used to be its own literal that
  // omitted `mousedown`, which is how 3 onmousedown sites shipped past a check
  // reporting 0 (see ON_ATTR_EVENTS above).
  const ATTR = ON_ATTR_RE(ON_ATTR_EVENTS, 'both');
  // Property assignments (`el.onclick = fn`) are ordinary DOM scripting and are
  // NOT subject to CSP. Only the attribute form needs 'unsafe-inline'. Guard
  // against `setAttribute('onclick', ...)` producing the attribute form at
  // runtime, which is exactly what peqdb-module.js:3512 used to do.
  const SETATTR = /\bsetAttribute\(\s*['"](on[a-z]+)['"]/g;
  let sites = 0;
  let setAttrSites = 0;
  const byFile = [];
  const setAttrByFile = [];

  for (const f of readdirSync(jsDir).sort()) {
    if (!f.endsWith('.js')) continue;
    if (/chart\.js$|bundle|\.min\.js$/.test(f)) continue; // vendored, not ours
    const src = readFileSync(join(jsDir, f), 'utf8');

    let n = 0;
    let ns = 0;
    src.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      // `el.onclick = fn` is a DOM property assignment, not an inline attribute.
      if (/\.\s*on(click|input|change|focus|blur)\s*=/.test(line)) return;
      // A selector that *looks* for an existing handler, e.g.
      // querySelector('button[onclick="Tone.toneSweep()"]') - not an injection.
      const hits = [...line.matchAll(ATTR)];
      if (hits.length) {
        for (const h of hits) {
          const at = h.index;
          // Skip occurrences that sit inside an attribute selector `[onclick="`.
          const before = line.slice(0, at);
          if (/\[\s*$/.test(before)) continue;
          n++;
        }
      }
      ns += [...line.matchAll(SETATTR)].length;
    });
    if (n) { sites += n; byFile.push(`${f}:${n}`); }
    if (ns) { setAttrSites += ns; setAttrByFile.push(`${f}:${ns}`); }
  }

  // Pinned at 0. The 60 original attribute-form sites were migrated to data-cmd
  // / data-cmd-input / data-cmd-change (see the data-cmd dispatcher), then
  // FOUR more were found still shipping in 2026-10 and fixed: three onmousedown
  // template strings (iem-module.js brand autocomplete, peqdb-module.js search
  // chips, find-engine.js brand filter) and one setAttribute('onclick') in
  // peqdb-module.js buildDbModelCard. All four rendered and did nothing, because
  // script-src has no 'unsafe-inline'. The regex above is what missed them.
  const BASELINE = 0;
  notes.push(
    `runtime inline-handler sites: ${sites} (ratchet baseline ${BASELINE})` +
    `\n                 ^ attribute-form onX= in JS template strings; all migrated to data-cmd.`
  );
  if (sites > BASELINE) {
    problems.push(
      `RUNTIME INLINE HANDLERS  ${sites} inline on*= template sites (ratchet baseline ${BASELINE}). ` +
      `Use data-cmd / data-cmd-input / data-cmd-change with data-arg-N instead of onclick="...".`
    );
  }

  const SETATTR_BASELINE = 0;
  notes.push(`runtime setAttribute('onX') sites: ${setAttrSites} (ratchet baseline ${SETATTR_BASELINE})`);
  if (setAttrSites > SETATTR_BASELINE) {
    problems.push(
      `RUNTIME setAttribute ON*  ${setAttrSites} setAttribute('on<event>', ...) sites (ratchet baseline ${SETATTR_BASELINE})` +
      (setAttrByFile.length ? ` in ${setAttrByFile.join(', ')}` : '') +
      `. setAttribute('onclick', ...) compiles to an attribute-form EventHandler, which CSP ` +
      `blocks exactly like onclick="..." - it renders but never runs. Use data-cmd + data-arg-N, ` +
      `which is a plain attribute and therefore also survives .outerHTML round-trips.`
    );
  }
}

// ---------------------------------------------------------------- 4b
// Negative test for the data-cmd module allowlist in events.js.
//
// The dispatcher used to resolve `window[modName] || window[alias]`, i.e. any
// global in the renderer. The runtime allowlist now refuses unknown modules,
// but a refusal only helps if the codebase cannot silently start naming a
// fifth one - a typo, or a new global someone reaches for, would fail at click
// time and only as a console warning nobody reads. So the source is scanned
// here, where a mistake is a build failure instead.
//
// Mirrors CMD_MODULES in app/js/events.js. A new module must be added to both.
{
  const ALLOWED_CMD_MODULES = new Set(['EQ', 'FindEngine', 'IEM', 'PEQDB_Module']);

  // Matches the attribute form in both index.html and JS template strings,
  // including the data-cmd-<event> variants. Values are read as source text, so
  // a template literal like data-cmd="EQ.cycleBandType" and a concatenation
  // like 'data-cmd="' + x + '"' are not both catchable; only the first is,
  // which is the overwhelmingly common form.
  const CMD_RE = /\bdata-cmd(?:-click|-input|-change)?\s*=\s*(["'])([A-Za-z_$][\w$]*)\.[\w$]+\1/g;

  const files = [join(root, 'index.html')];
  const jsDir = join(root, 'app', 'js');
  for (const f of readdirSync(jsDir).sort()) {
    if (!f.endsWith('.js')) continue;
    if (/chart\.js$|bundle|\.min\.js$/.test(f)) continue; // vendored, not ours
    files.push(join(jsDir, f));
  }

  const seen = new Map(); // module -> count
  const bad = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(CMD_RE)) {
      const modName = m[2];
      seen.set(modName, (seen.get(modName) || 0) + 1);
      if (!ALLOWED_CMD_MODULES.has(modName)) {
        const line = src.slice(0, m.index).split(/\r?\n/).length;
        bad.push(`${file.replace(root + '\\', '').replace(root + '/', '')}:${line}  ${m[0]}`);
      }
    }
  }

  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  notes.push(
    `data-cmd module allowlist: ${total} sites, ${seen.size} distinct module(s) ` +
    `[${[...seen.keys()].sort().join(', ')}]`
  );

  // The allowlist and the dispatcher must not drift apart.
  const eventsSrc = read('app/js/events.js');
  for (const modName of ALLOWED_CMD_MODULES) {
    if (!new RegExp(`^\\s*${modName}:\\s*'`, 'm').test(eventsSrc)) {
      problems.push(
        `CMD MODULE ALLOWLIST  check #4b allows "${modName}" but events.js CMD_MODULES has no such entry. ` +
        `Update both together.`
      );
    }
  }

  if (bad.length) {
    problems.push(
      `CMD MODULE ALLOWLIST  ${bad.length} data-cmd site(s) name a module that events.js will refuse:\n` +
      bad.map(b => '                 ' + b).join('\n') +
      `\n                 Allowed: ${[...ALLOWED_CMD_MODULES].join(', ')}. ` +
      `The dispatcher resolves only these modules; anything else is a click that does nothing.`
    );
  }
}

// ---------------------------------------------------------------- 5
{
  const html = read('index.html');
  const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

  const jsDir = join(root, 'app', 'js');
  const referenced = new Set();
  const runtimeCreated = new Set();

  for (const f of readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    if (/chart\.js$|bundle|\.min\.js$/.test(f)) continue;
    const src = readFileSync(join(jsDir, f), 'utf8');

    for (const m of src.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) referenced.add(m[1]);
    // Ids the app assigns itself, so they are legitimately absent from the HTML.
    for (const m of src.matchAll(/\.id\s*=\s*['"`]([^'"`]*)['"`]/g)) runtimeCreated.add(m[1]);
    for (const m of src.matchAll(/id\s*=\s*['"`]([^'"`]*\$\{[^'"`]*)['"`]/g)) runtimeCreated.add(m[1]);
  }

  // Skip anything built by interpolation or concatenation at call time.
  const dynamic = /\$\{|\+\s*[A-Za-z_$]/;
  const dead = [...referenced]
    .filter(id => !staticIds.has(id) && !runtimeCreated.has(id) && !dynamic.test(id))
    .sort();

  // A dead id is usually vestigial code left behind by a removed UI (e.g. the
  // `modal-*` media-transport ids, superseded by the `mobile-*` footer
  // transport, which the very same functions still update correctly). Those are
  // harmless `if (el)` no-ops, so a raw count is ratcheted rather than failed.
  //
  // But a dead id that is only 1-2 characters away from a LIVE id is a
  // different animal: that is the signature of a rename or typo, and the code
  // silently stops updating a real element. Those are treated as bugs and fail.
  const editDistance = (a, b) => {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  };

  // Verified vestigial, not a typo: the sound-character tabs are a 6-button
  // `subtab-seg-grid` (self-labelled), so there is no stepper label to update.
  // The nearest live id, `rc-tab-stepper-label`, belongs to the unrelated
  // Room Correction stepper.
  const ALLOWLIST = new Set(['sc-tab-stepper-label']);

  const typos = [];
  for (const id of dead) {
    if (ALLOWLIST.has(id)) continue;
    let nearest = null, best = Infinity;
    for (const live of staticIds) {
      if (Math.abs(live.length - id.length) > 2) continue;
      const d = editDistance(id, live);
      if (d < best) { best = d; nearest = live; }
    }
    // d === 0 cannot happen (the id is not live), so this means 1 or 2.
    if (nearest && best <= 2) typos.push(`"${id}" is 1-2 chars from the LIVE id "${nearest}" - likely a rename/typo`);
  }
  if (typos.length) {
    for (const t of typos) problems.push(`DEAD ID TYPO  ${t}. The code will never update that element.`);
  }

  // Measured by this check (it scans every app/js source file, so it sees a few
  // more than the runtime DOM audit in tools/audit-dom.js). These are all
  // `if (el)`-guarded no-ops today - the smoke test passes with zero console
  // errors - so this reports and ratchets rather than failing on the existing set.
  const BASELINE = 87;
  const typoNote = typos.length
    ? `, ${typos.length} of which ${typos.length === 1 ? 'looks' : 'look'} like a TYPO of a live id and must be fixed`
    : ', none of which are near-misses of a live id';
  notes.push(
    `dead getElementById refs: ${dead.length} (all guarded; ratchet baseline ${BASELINE}${typoNote})` +
    `\n                 e.g. ${dead.slice(0, 6).join(', ')}${dead.length > 6 ? ', ...' : ''}`
  );
  if (dead.length > BASELINE) {
    problems.push(
      `DEAD ID REFS  ${dead.length} getElementById targets do not exist (ratchet baseline ${BASELINE}). ` +
      `Each is a guaranteed null, so guard it or point it at a real id.`
    );
  }
}

// ---------------------------------------------------------------- 6
{
  const html = read('index.html');
  // The content attribute is double-quoted and CONTAINS single quotes (the CSP
  // keywords), so the value must be matched as "..." and not with a negated
  // class that includes '.
  const csp = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*\bcontent="([^"]*)"/i.exec(html);

  if (!csp) {
    problems.push(`CSP  no Content-Security-Policy meta tag found in index.html`);
  } else {
    const policy = csp[1];
    const scriptSrc = (/(?:^|;)\s*script-src\s+([^;]*)/i.exec(policy) || [])[1] || '';
    notes.push(`CSP script-src: ${scriptSrc.trim() || '(not set)'}`);

    if (/'unsafe-inline'/.test(scriptSrc)) {
      problems.push(
        `CSP  script-src still contains 'unsafe-inline' (${scriptSrc.trim()}). ` +
        `Every on*= attribute and the inline bundle loader are gone, so it should not be needed.`
      );
    }
    if (!scriptSrc.trim()) {
      problems.push(`CSP  script-src is not specified; the policy would fall back to default-src 'self', which also blocks the AudioWorklet blob.`);
    }
    if (/'unsafe-eval'/.test(scriptSrc)) {
      problems.push(`CSP  script-src contains 'unsafe-eval' - the data-cmd dispatcher deliberately avoids eval.`);
    }
  }

  // And there must be no inline <script> left for the policy to be lying about.
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length;
  notes.push(`inline <script> blocks: ${inlineScripts}`);
  if (inlineScripts > 0) {
    problems.push(
      `CSP  ${inlineScripts} inline <script> block(s) remain in index.html but script-src no longer allows 'unsafe-inline', ` +
      `so they will be blocked at runtime.`
    );
  }
}

// ---------------------------------------------------------------- report
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error('');
  for (const p of problems) console.error('FAIL  ' + p);
  console.error(`\n${problems.length} integrity problem(s)`);
  process.exit(1);
}
console.log('\nOK - no dead controls, bundle order is safe, inline-handler debt is not growing');
