// Renderer -> preload bridge check.
//
//   node scripts/check-bridge.mjs
//
// preload.js exposes one object (`window.appBridge`) and the renderer calls
// methods on it. Those method names are plain properties: nothing types them,
// nothing imports them, and with contextIsolation on there is no fallback that
// would accidentally work. Rename a method in preload.js and every caller throws
// `TypeError: window.appBridge.foo is not a function` at the moment the user
// clicks - usually inside a `.then()` or an event handler, so it surfaces as a
// silently dead button rather than a crash anyone can trace.
//
// scripts/check-ipc.mjs closes the same class of gap one layer down (bridge
// channels vs main.js handlers). This closes the layer the user actually
// touches: what the renderer asks the bridge for.
//
// What it asserts:
//   1. every `window.appBridge.<name>` (and every `<alias>.<name>` where the
//      alias is `const x = window.appBridge`) is a key preload.js exposes
//   2. every exposed key is actually used by the renderer - an unused one is
//      dead API surface that still has to be maintained and reviewed
//   3. dynamic access (`window.appBridge[name]`) fails, because a computed
//      property cannot be verified from source
//   4. every access is guarded for the case where no bridge exists at all.
//      main.js is not the only way this page is opened: tools/ loads index.html
//      in a plain BrowserWindow with no preload, and the browser harness does
//      the same. There `window.appBridge` is undefined, so an unguarded
//      `window.appBridge.foo()` throws `Cannot read properties of undefined`.
//      `?.` counts as a guard, as does a null/typeof test on the same reference
//      earlier in an enclosing function, which is the convention every current
//      call site follows (`if (!bridge || typeof bridge.x !== 'function') return;`).
//
// Scope: the hand-written renderer sources under app/js. The generated bundles
// (app.bundle.js / app.bundle.min.js) are built from those same files and are
// skipped, as is app/js/vendor. A bridge call in inline HTML or in an effect
// worker would not be seen here - neither exists today (checked when this was
// written: `grep -rn appBridge` finds only preload.js and app/js).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(root, p).replace(/\\/g, '/');

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// ---------------------------------------------------------------- masking
//
// Scope questions ("is this access inside a function, and is there a guard
// before it in that function") need brace positions, and brace positions need
// strings, comments, template literals and regex literals out of the way - a
// single `/[“']/g` or a template with HTML in it otherwise wrecks the counts.
// `maskSource` returns a copy of the file with every one of those replaced by
// spaces, newlines kept, so indices and line numbers still line up with src.

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await']);

// `s[i]` is a backtick. Returns the index just past the closing one, including
// any `${ ... }` interpolations, which may themselves contain templates.
function skipTemplate(s, i) {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && s[j + 1] === '{') { j = skipInterpolation(s, j + 2); continue; }
    j++;
  }
  return j;
}

// `s[i]` is just after `${`. Returns the index just past the matching `}`.
function skipInterpolation(s, i) {
  let depth = 1;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '/' && s[j + 1] === '/') {
      const nl = s.indexOf('\n', j);
      j = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === '/' && s[j + 1] === '*') {
      const k = s.indexOf('*/', j + 2);
      j = k < 0 ? s.length : k + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = j + 1;
      while (k < s.length && s[k] !== c) k += s[k] === '\\' ? 2 : 1;
      j = k + 1;
      continue;
    }
    if (c === '`') { j = skipTemplate(s, j); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

function wordBefore(s, i) {
  let k = i - 1;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(s[k])) k--;
  return s.slice(k + 1, i);
}

function maskSource(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  let prev = ''; // last significant character, or 'value' after a string/regex
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl < 0 ? src.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
      prev = 'value';
      continue;
    }
    if (ch === '`') {
      const end = skipTemplate(src, i);
      blank(i, end);
      i = end;
      prev = 'value';
      continue;
    }
    if (ch === '/') {
      const readAsRegex = prev === '' || REGEX_PRECEDERS.has(prev)
        || (prev === 'word' && REGEX_KEYWORDS.has(wordBefore(src, i)));
      if (readAsRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length) {
          const c = src[j];
          if (c === '\\') { j += 2; continue; }
          if (c === '\n') break;
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          j++;
        }
        blank(i, j + 1);
        i = j + 1;
        while (i < src.length && /[a-z]/.test(src[i])) i++;
        prev = 'value';
        continue;
      }
    }
    prev = /[A-Za-z0-9_$]/.test(ch) ? 'word' : ch;
    i++;
  }
  return out.join('');
}

// ------------------------------------------------------------- structure
//
// Brace/paren map over masked text: which braces pair up, which brace encloses
// which, and which paren opened before a `)` (needed to tell `function f() {`
// and `f() {` from `if (...) {`).

function structure(masked) {
  const braceClose = new Map();
  const braceParent = new Map();
  const parenOpen = new Map();
  const stack = [];
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(') {
      let parent = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (masked[stack[k]] === '{') { parent = stack[k]; break; }
      }
      if (ch === '{') braceParent.set(i, parent);
      stack.push(i);
      continue;
    }
    if (ch === '}' || ch === ')') {
      for (let k = stack.length - 1; k >= 0; k--) {
        const opener = masked[stack[k]];
        if ((ch === '}' && opener === '{') || (ch === ')' && opener === '(')) {
          const open = stack[k];
          stack.length = k;
          if (ch === '}') braceClose.set(open, i);
          else parenOpen.set(i, open);
          break;
        }
      }
    }
  }
  return { braceClose, braceParent, parenOpen };
}

const CONTROL = /^(?:if|for|while|switch|catch|with)$/;

// True when `open` is the `{` of a function or method body, false for an
// if/for/try block.
function isFunctionBody(masked, maps, open) {
  let j = open - 1;
  while (j >= 0 && /\s/.test(masked[j])) j--;
  if (j < 0) return false;
  if (masked[j] === '>' && masked[j - 1] === '=') return true;
  if (masked[j] !== ')') return false;
  const pOpen = maps.parenOpen.get(j);
  if (pOpen === undefined) return false;
  return !CONTROL.test(wordBefore(masked, pOpen));
}

function innermostBrace(maps, index) {
  let best = -1;
  for (const [open, close] of maps.braceClose) {
    if (open < index && close > index && open > best) best = open;
  }
  return best;
}

// Is `ref` null/typeof-tested (or `&&`-chained) anywhere in the text?
// The `(?![\w$.])` on the negative and typeof forms is load-bearing:
// `!bridge.foo` and `typeof bridge.foo` read a property, so they throw when
// `bridge` itself is undefined and prove nothing about it.
function guardMentions(text, ref) {
  const esc = ref.replace(/\$/g, '\\$');
  const re = new RegExp(
    `(?:!\\s*${esc}(?![\\w$.])` +
    `|\\b${esc}(?![\\w$])\\s*(?:&&|\\|\\||\\?\\?|\\?\\.|===?|!==?)` +
    `|typeof\\s+${esc}(?![\\w$.]))`
  );
  return re.test(text);
}

// A guard in any enclosing function before the access. Walking outwards matters:
// `if (!bridge) return;` at the top of a function protects the bridge calls
// inside the arrow callbacks registered further down in that same function.
function isGuarded(masked, maps, index, ref) {
  let brace = innermostBrace(maps, index);
  while (brace !== -1) {
    if (isFunctionBody(masked, maps, brace) && guardMentions(masked.slice(brace + 1, index), ref)) return true;
    brace = maps.braceParent.get(brace) ?? -1;
  }
  return false;
}

// Walks an object literal starting at `open` (index of '{') and returns the
// keys declared at its top level. String/comment aware so a brace inside text
// cannot close the object early; nested objects and function bodies are past
// depth 1 and therefore ignored.
function objectKeys(src, open) {
  const keys = [];
  let depth = 0;
  let i = open;
  let wantKey = false;
  const isIdStart = (c) => /[A-Za-z_$]/.test(c || '');
  const isId = (c) => /[A-Za-z0-9_$]/.test(c || '');

  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      if (ch === '{' && depth === 1) wantKey = true;
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      i++;
      if (depth <= 0) break;
      continue;
    }
    if (ch === ',' && depth === 1) { wantKey = true; i++; continue; }
    if (wantKey && depth === 1 && isIdStart(ch)) {
      let j = i;
      while (j < src.length && isId(src[j])) j++;
      const name = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      // `name:` (property), `name(` (method shorthand) and `name,` / `name}`
      // (shorthand) all declare a key; anything else mean this was a value.
      if (src[k] === ':' || src[k] === '(' || src[k] === ',' || src[k] === '}') {
        keys.push({ name, line: lineAt(src, i) });
      }
      wantKey = false;
      i = j;
      continue;
    }
    i++;
  }
  return keys;
}

const preloadSrc = readFileSync(join(root, 'preload.js'), 'utf8');
const expose = /contextBridge\.exposeInMainWorld\(\s*(['"])([\w$]+)\1\s*,\s*\{/.exec(preloadSrc);
if (!expose) {
  console.error('preload.js no longer calls contextBridge.exposeInMainWorld(<name>, { ... }).');
  console.error('This check reads the exposed object to know the bridge API; update it before removing the call.');
  process.exit(1);
}
const worldName = expose[2];
const exposed = objectKeys(preloadSrc, expose.index + expose[0].length - 1);
const exposedNames = new Set(exposed.map(k => k.name));

// Every non-generated renderer source. Sorted so a failure list is stable.
const rendererFiles = [];
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') collect(abs);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    if (/\.bundle(\.min)?\.js$/.test(entry.name)) continue;
    rendererFiles.push(abs);
  }
}
collect(join(root, 'app', 'js'));
rendererFiles.sort();

const problems = [];
const used = new Map(); // method name -> "file:line"
const escape = worldName.replace(/\$/g, '\\$');
const ALIAS = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:[^;\\n]*?window\\.${escape}|window\\.${escape})`, 'g');

for (const file of rendererFiles) {
  const src = readFileSync(file, 'utf8');
  const name = rel(file);
  const masked = maskSource(src);
  const maps = structure(masked);

  const record = (method, index) => {
    if (!used.has(method)) used.set(method, `${name}:${lineAt(src, index)}`);
  };

  // Calls to a member that may be missing entirely (no preload at all).
  const unguarded = (ref, method, index) => {
    if (isGuarded(masked, maps, index, ref)) return;
    problems.push(`${name}:${lineAt(src, index)} reads ${ref}.${method} without first checking ${ref} exists - the browser-only harness (no preload) throws TypeError here`);
  };

  // Dynamic access cannot be checked, in either spelling.
  const directBracket = new RegExp(`window\\.${escape}\\s*\\[`, 'g');
  let m;
  while ((m = directBracket.exec(src))) {
    problems.push(`${name}:${lineAt(src, m.index)} reads window.${worldName}[...] with a computed property - the method name cannot be checked; call it directly`);
  }

  // Aliases declared in this file, e.g. `const bridge = window.appBridge`, or
  // the guarded `(typeof window !== 'undefined' && window.appBridge) ? window.appBridge : null`.
  const aliases = new Set();
  ALIAS.lastIndex = 0;
  let a;
  while ((a = ALIAS.exec(src))) aliases.add(a[1]);

  const directCall = new RegExp(`window\\.${escape}(\\?)?\\.([A-Za-z_$][\\w$]*)`, 'g');
  while ((m = directCall.exec(src))) {
    record(m[2], m.index);
    // `?.` is itself the guard.
    if (!m[1]) unguarded(`window.${worldName}`, m[2], m.index);
  }

  for (const alias of aliases) {
    const esc = alias.replace(/\$/g, '\\$');
    const call = new RegExp(`(?:^|[^\\w$.])${esc}(\\?)?\\.([A-Za-z_$][\\w$]*)`, 'gm');
    // m.index points at the character before the alias, so offset to the call.
    while ((m = call.exec(src))) {
      const at = m.index + m[0].indexOf(alias);
      record(m[2], at);
      if (!m[1]) unguarded(alias, m[2], at);
    }
    const bracket = new RegExp(`(?:^|[^\\w$.])${esc}\\s*\\[`, 'gm');
    while ((m = bracket.exec(src))) {
      problems.push(`${name}:${lineAt(src, m.index)} reads ${alias}[...] with a computed property - the method name cannot be checked; call it directly`);
    }
  }
}

for (const [method, where] of [...used].sort()) {
  if (!exposedNames.has(method)) {
    problems.push(`${where} calls window.${worldName}.${method}() but preload.js does not expose '${method}' - the call throws TypeError at click time`);
  }
}
for (const key of exposed) {
  if (!used.has(key.name)) {
    problems.push(`preload.js exposes '${key.name}' (line ${key.line}) but no renderer code uses it - dead bridge API`);
  }
}

console.log('BRIDGE API CHECK');
console.log(`  preload.js: ${exposed.length} exposed member(s) on window.${worldName}`);
console.log(`  renderer:   ${used.size} distinct member(s) used across ${rendererFiles.length} source file(s)`);

if (problems.length) {
  for (const p of problems) console.error('  FAIL  ' + p);
  console.error(`\n${problems.length} BRIDGE API PROBLEM(S)`);
  process.exit(1);
}

console.log(`  PASS  every ${worldName} member the renderer calls is exposed, and every exposed member is used`);
console.log('  PASS  no computed bridge property access');
console.log(`  PASS  every access is guarded for the browser-only case where ${worldName} is undefined`);
console.log(`\nBRIDGE OK - ${used.size} member(s) agree in both directions, every access guarded`);
