// Proves the CSP guard fails when 'unsafe-inline' is reintroduced, and when an
// inline <script> is added back. A security check that cannot fail is worse than
// no check, so this is verified rather than assumed.
//
//   node tools/verify-csp-guard.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'index.html');
const check = path.join(ROOT, 'scripts', 'check-integrity.mjs');
const original = fs.readFileSync(file, 'utf8');

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
    mutate: (s) => s.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    expect: /CSP/
  },
  {
    name: 'add an inline <script> block back',
    mutate: (s) => s.replace('</body>', '<script>console.log(1)</script>\n</body>'),
    expect: /inline <script>/
  },
  {
    name: "add 'unsafe-eval' to script-src",
    mutate: (s) => s.replace("script-src 'self';", "script-src 'self' 'unsafe-eval';"),
    expect: /unsafe-eval/
  }
];

try {
  const base = run();
  console.log('  baseline: ' + (base.ok ? 'passes (as expected)' : 'FAILS at baseline - fix that first'));
  const line = base.out.split(/\r?\n/).find(l => l.includes('CSP script-src'));
  if (line) console.log('    ' + line.trim());

  for (const sc of scenarios) {
    const mutated = sc.mutate(original);
    if (mutated === original) { console.log(`  ${sc.name}: MUTATION DID NOT APPLY - check failed`); continue; }
    fs.writeFileSync(file, mutated);
    const r = run();
    const failLine = r.out.split(/\r?\n/).find(l => l.includes('FAIL'));
    const raised = !r.ok && failLine && sc.expect.test(failLine);
    console.log(`  ${raised ? 'PASS' : 'FAIL'}  ${sc.name}: ${raised ? 'guard fired' : 'GUARD DID NOT FIRE'}`);
    if (failLine) console.log('        ' + failLine.trim().slice(0, 150));
  }
} finally {
  fs.writeFileSync(file, original);
  const restored = run();
  console.log('  restored byte-exact: ' + (fs.readFileSync(file, 'utf8') === original));
  console.log('  check passes after restore: ' + restored.ok);
}
