// Proves the CSP guard fails when 'unsafe-inline' is reintroduced, when an
// inline <script> is added back, and when an attribute-form event handler is
// reintroduced in either index.html or a JS template string. A security check
// that cannot fail is worse than no check, so this is verified rather than
// assumed - including for the guard that was itself broken until 2026-10-05.
//
// The last two scenarios exist because the inline-handler scan in
// scripts/check-integrity.mjs had a blind spot: its event-name list omitted
// `mousedown`, and it had no pattern for setAttribute('onX', ...). Three live
// onmousedown sites and one setAttribute('onclick') shipped under it, all dead
// at runtime, while the check printed "runtime inline-handler sites: 0".
//
//   node tools/verify-csp-guard.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const htmlFile = path.join(ROOT, 'index.html');
const jsFile = path.join(ROOT, 'app', 'js', 'find-engine.js');
const check = path.join(ROOT, 'scripts', 'check-integrity.mjs');

const originals = {
  [htmlFile]: fs.readFileSync(htmlFile, 'utf8'),
  [jsFile]: fs.readFileSync(jsFile, 'utf8'),
};

const run = () => {
  try {
    return { ok: true, out: execFileSync('node', [check], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

const scenarios = [
  {
    name: "reintroduce 'unsafe-inline' in script-src",
    file: htmlFile,
    mutate: (s) => s.replace("script-src 'self' 'wasm-unsafe-eval';", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';"),
    expect: /CSP/,
  },
  {
    name: 'add an inline <script> block back',
    file: htmlFile,
    mutate: (s) => s.replace('</body>', '<script>console.log(1)</script>\n</body>'),
    expect: /inline <script>/,
  },
  {
    name: "add 'unsafe-eval' to script-src",
    file: htmlFile,
    mutate: (s) => s.replace("script-src 'self' 'wasm-unsafe-eval';", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';"),
    expect: /unsafe-eval/,
  },
  {
    // The exact regression: this event name was missing from the old list.
    name: 'add an onmousedown attribute to index.html',
    file: htmlFile,
    mutate: (s) => s.replace('</body>', '<div onmousedown="alert(1)">x</div>\n</body>'),
    expect: /INLINE HANDLERS/,
  },
  {
    // Also missing: an event the app genuinely never uses, to prove the list is
    // event-agnostic rather than merely extended for the one case above.
    name: 'add an onpointerdown attribute to index.html',
    file: htmlFile,
    mutate: (s) => s.replace('</body>', '<div onpointerdown="alert(1)">x</div>\n</body>'),
    expect: /INLINE HANDLERS/,
  },
  {
    // Same blind spot, but in a JS template string (check #4 rather than #3).
    name: 'add an onmousedown template site to a module',
    file: jsFile,
    mutate: (s) => s.replace('handleBrandSearch: function(query) {',
      'handleBrandSearch: function(query) {\n        const probe = `<div onmousedown="alert(1)">x</div>`; void probe;'),
    expect: /RUNTIME INLINE HANDLERS/,
  },
  {
    // The second blind spot: no setAttribute pattern existed at all. This is
    // precisely the peqdb-module.js:3512 shape that shipped dead.
    name: "add setAttribute('onclick') to a module",
    file: jsFile,
    mutate: (s) => s.replace('handleBrandSearch: function(query) {',
      "handleBrandSearch: function(query) {\n        const el = document.createElement('div'); el.setAttribute('onclick', 'alert(1)'); void el;"),
    expect: /setAttribute ON\*/,
  },
  {
    // setAttribute('mousedown', ...) is NOT an event handler - that sets an
    // ordinary custom attribute and CSP does not gate it. The dangerous form is
    // setAttribute('onmousedown', ...), which is what a runtime-injected
    // handler actually looks like. Scenario uses the real thing.
    name: "add setAttribute('onmousedown') to a module",
    file: jsFile,
    mutate: (s) => s.replace('handleBrandSearch: function(query) {',
      "handleBrandSearch: function(query) {\n        const el = document.createElement('div'); el.setAttribute('onmousedown', 'alert(1)'); void el;"),
    expect: /setAttribute ON\*/,
  },
];

let failed = 0;
try {
  const base = run();
  console.log('  baseline: ' + (base.ok ? 'passes (as expected)' : 'FAILS at baseline - fix that first'));
  if (!base.ok) failed++;
  const line = base.out.split(/\r?\n/).find(l => l.includes('CSP script-src'));
  if (line) console.log('    ' + line.trim());
  for (const l of base.out.split(/\r?\n/)) {
    if (l.includes('inline-handler sites') || l.includes('setAttribute')) console.log('    ' + l.trim());
  }

  // Restore every file after EVERY scenario, not just at the end. Two of these
  // scenarios touch index.html and the rest touch a module; without a per-scenario
  // restore a stale failure from scenario N is still in the file when scenario
  // N+1 runs, and the assertion then matches the wrong FAIL line.
  const restoreAll = () => {
    for (const [f, s] of Object.entries(originals)) fs.writeFileSync(f, s);
  };

  for (const sc of scenarios) {
    const original = originals[sc.file];
    const mutated = sc.mutate(original);
    if (mutated === original) { console.log(`  FAIL  ${sc.name}: MUTATION DID NOT APPLY - check failed`); failed++; continue; }
    restoreAll();
    fs.writeFileSync(sc.file, mutated);
    const r = run();
    const failLines = r.out.split(/\r?\n/).filter(l => l.includes('FAIL'));
    const raised = !r.ok && failLines.some(l => sc.expect.test(l));
    console.log(`  ${raised ? 'PASS' : 'FAIL'}  ${sc.name}: ${raised ? 'guard fired' : 'GUARD DID NOT FIRE'}`);
    if (raised) {
      console.log('        ' + failLines.find(l => sc.expect.test(l)).trim().slice(0, 170));
    } else {
      console.log('        expected ' + sc.expect + '; got ' + (failLines.length ? failLines.map(l => l.trim().slice(0, 60)).join(' | ') : '(no FAIL line, exit ok=' + r.ok + ')'));
      failed++;
    }
  }
} finally {
  for (const [f, s] of Object.entries(originals)) fs.writeFileSync(f, s);
  let allRestored = true;
  // Belt and braces: the per-scenario restore above must have left both files
  // byte-identical to the snapshot taken at startup.
  for (const [f, s] of Object.entries(originals)) {
    if (fs.readFileSync(f, 'utf8') !== s) { allRestored = false; console.log('  RESTORE FAILED: ' + f); }
  }
  console.log('  restored byte-exact: ' + allRestored);
  const restored = run();
  console.log('  check passes after restore: ' + restored.ok);
  if (!restored.ok) failed++;
}

console.log(failed === 0 ? '\nCSP GUARD VERIFIED - every scenario fires' : `\n${failed} SCENARIO(S) DID NOT FIRE`);
process.exit(failed === 0 ? 0 : 1);