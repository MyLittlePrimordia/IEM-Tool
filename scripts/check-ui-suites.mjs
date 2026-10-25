// Guard: a verify-* script in tools/ must be accounted for.
//
// The UI suites live in two tiers. tools/run-ui-verify.mjs runs its SUITES list
// in `npm run verify:ui`; the rest are stand-alone probes you run by hand when
// you touch that area (they need audio, the ONNX model, a real app install, or
// they just take too long for every run). That split is fine - but nothing was
// keeping it honest. A new verify-* written for a fix could sit in tools/
// forever, never run by the gate, while CI stayed green and the regression it
// was written to catch came back. Equally, a SUITES entry whose file was
// renamed only failed at :ui time, on the machine that ran it.
//
// So: every verify-*.js is either registered in SUITES, or it says on its first
// line that it is a stand-alone probe. Both states are explicit, neither can
// happen by accident, and a file in both is a contradiction and fails too.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(root, 'tools', 'run-ui-verify.mjs');
const MARKER = /^\s*\/\/\s*Stand-alone probe:/m;

const runnerSrc = readFileSync(RUNNER, 'utf8');
// Parse the array rather than grepping it: the entries are plain object
// literals, and evaluating them gets the escapes and comments right. If the
// shape ever changes, say so loudly instead of passing on an empty list.
const literal = runnerSrc.match(/const SUITES = (\[[\s\S]*?\r?\n\]);/);
if (!literal) {
  console.error('FAIL could not find `const SUITES = [...];` in tools/run-ui-verify.mjs');
  console.error('     This check parses that array; update scripts/check-ui-suites.mjs to match.');
  process.exit(1);
}
let suites;
try {
  suites = new Function('return ' + literal[1])();
} catch (e) {
  console.error('FAIL could not evaluate the SUITES array: ' + (e.message || e));
  process.exit(1);
}
if (!Array.isArray(suites) || suites.some(s => !s || typeof s.file !== 'string')) {
  console.error('FAIL SUITES is not an array of objects with a string `file`');
  process.exit(1);
}

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
const registered = new Set(suites.map(s => norm(s.file)));
const failures = [];

// A registered file must exist, whatever its name: smoke-runtime.js and
// audit-control-corners.js are suites too.
for (const file of registered) {
  const abs = join(root, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    failures.push({ msg: `${file} is listed in tools/run-ui-verify.mjs but does not exist (renamed or deleted?)`, hint: false });
  }
}

// Every verify-*.js must pick a side.
let registeredVerify = 0;
let standalone = 0;
for (const name of readdirSync(join(root, 'tools'))) {
  if (!/^verify-.*\.js$/.test(name)) continue;
  const rel = 'tools/' + name;
  const abs = join(root, 'tools', name);
  if (!statSync(abs).isFile()) continue;
  const isRegistered = registered.has(rel);
  const marked = MARKER.test(readFileSync(abs, 'utf8'));
  if (isRegistered && marked) {
    failures.push({ msg: `${rel} is registered in SUITES AND marked as a stand-alone probe - pick one`, hint: false });
  } else if (isRegistered) {
    registeredVerify++;
  } else if (marked) {
    standalone++;
  } else {
    failures.push({ msg: `${rel} is not in the tools/run-ui-verify.mjs SUITES list and does not declare itself a stand-alone probe`, hint: true });
  }
}

if (failures.length) {
  for (const f of failures) console.error('FAIL ' + f.msg);
  if (failures.some(f => f.hint)) {
    console.error('\nEither add the file to SUITES (if it can run in every gate) or put this');
    console.error('line at the top of it:');
    console.error('  // Stand-alone probe: run by hand. Not part of npm run verify:ui - see tools/run-ui-verify.mjs.');
  }
  console.error(`\n${failures.length} problem(s)`);
  process.exit(1);
}

console.log(`OK - ${suites.length} suites registered (${registeredVerify} verify-*), ${standalone} stand-alone probes declared`);
