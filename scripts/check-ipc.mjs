// IPC bridge contract check.
//
//   node scripts/check-ipc.mjs
//
// preload.js is the ONLY place the renderer can reach the main process: it lists
// named, argument-less commands (no `invoke(channel, ...)` passthrough, by
// design). That means every channel exists in exactly two places, and nothing
// in the code connects them - `ipcRenderer.invoke('data:read-file')` and
// `ipcMain.handle('data:read-file')` are two strings that must agree.
//
// When they drift, nothing fails at build time and nothing fails at launch. The
// renderer calls a channel no one handles and gets a rejected promise, or main
// registers a handler no bridge method can reach. Both look like "that button
// does nothing" in a bug report, and both cost a full packaged installer run to
// diagnose. This is the same class of blind spot the syntax check closed for
// probes, one layer down.
//
// What it asserts, in both directions:
//   1. each ipcRenderer.invoke/sendSync  has ipcMain.handle/handleOnce
//   2. each ipcRenderer.send             has ipcMain.on/once
//   3. each ipcRenderer.on/once          has a webContents.send from main
//   4. each ipcMain handler is reachable from the bridge
//   5. each webContents.send has a bridge listener
//   6. no channel is registered twice (Electron throws on the second handle)
//   7. no channel name is dynamic, because a variable or template literal cannot
//      be verified from source - it fails loudly instead of passing silently
//
// Channel nodes are read from source text, not executed: main.js boots an app
// window when required, so it can never be imported by a static gate.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

// Rendered in output so a failure points at a line, not just a channel name.
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// Finds `receiver.method( <literal> )` calls. The first argument must be a
// string literal for the channel to be knowable statically; anything else
// (variable, template literal, concatenation) comes back with channel: null.
function scanCalls(src, file, receiver) {
  const methods = receiver === 'ipcRenderer'
    ? 'send|invoke|sendSync|on|once'
    : receiver === 'ipcMain'
      ? 'handle|handleOnce|on|once'
      : 'send';
  const re = new RegExp(`\\b${receiver}\\.(${methods})\\s*\\(`, 'g');
  const calls = [];
  let m;
  while ((m = re.exec(src))) {
    const method = m[1];
    const line = lineAt(src, m.index);
    let i = re.lastIndex;
    while (i < src.length && /\s/.test(src[i])) i++;
    const quote = src[i];
    if (!/['"`]/.test(quote || '')) {
      // Show the expression itself, not the rest of the call: `c`, not `c);`.
      const rest = src.slice(i);
      const stop = rest.search(/[,)\n]/);
      const raw = (stop >= 0 ? rest.slice(0, stop) : rest.slice(0, 40)).trim();
      calls.push({ file, line, method, channel: null, raw });
      continue;
    }
    const end = src.indexOf(quote, i + 1);
    if (end < 0) {
      calls.push({ file, line, method, channel: null, raw: src.slice(i, i + 60) });
      continue;
    }
    const channel = src.slice(i + 1, end);
    if (!channel || channel.includes('${')) {
      // `\``-quoted with an interpolation, or an empty name.
      calls.push({ file, line, method, channel: null, raw: `${quote}${channel}${quote}` });
      continue;
    }
    calls.push({ file, line, method, channel });
    re.lastIndex = end + 1;
  }
  return calls;
}

// ipcMain kinds. A fire-and-forget send() is answered by on(), an awaited
// invoke()/sendSync() only by handle().
const HANDLE_KINDS = new Set(['handle', 'handleOnce']);
const ON_KINDS = new Set(['on', 'once']);

const preloadSrc = read('preload.js');
const mainSrc = read('main.js');

const bridge = scanCalls(preloadSrc, 'preload.js', 'ipcRenderer');
const handlers = scanCalls(mainSrc, 'main.js', 'ipcMain');
const pushes = scanCalls(mainSrc, 'main.js', 'webContents');

const problems = [];
const problem = (msg) => problems.push(msg);
const add = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

const bridgeBy = new Map();
for (const call of bridge) {
  if (call.channel) add(bridgeBy, call.channel, call);
}
const handlerBy = new Map();
for (const call of handlers) {
  if (call.channel) add(handlerBy, call.channel, call);
}
const pushBy = new Map();
for (const call of pushes) {
  if (call.channel) add(pushBy, call.channel, call);
}

// 7. Dynamic names. Verified nothing, so reported rather than skipped.
for (const call of [...bridge, ...handlers, ...pushes]) {
  if (call.channel === null) {
    problem(`${call.file}:${call.line} ${call.method}() channel is not a string literal (${call.raw}) - it cannot be checked; use a quoted channel name`);
  }
}

// 6. A second registration of the same channel throws at runtime, on whichever
// window opens second - and only then.
for (const [channel, list] of handlerBy) {
  if (list.length > 1) {
    problem(`${channel} is registered ${list.length} times in main.js (${list.map(c => 'line ' + c.line).join(', ')}) - Electron throws on the second handler`);
  }
}

// 1-3. Bridge -> main. The kind pairing is the contract: invoke resolves a
// promise, send does not, on receives a push.
for (const [channel, calls] of bridgeBy) {
  const methods = new Set(calls.map(c => c.method));
  const listens = [...methods].every(m => m === 'on' || m === 'once');

  if (listens) {
    if (!pushBy.has(channel)) {
      const wrong = handlerBy.get(channel);
      problem(`preload.js listens for '${channel}' but main.js never sends it with webContents.send()${wrong ? ` (it only registers ipcMain.${wrong[0].method}, so nothing arrives)` : ''}`);
    }
    continue;
  }

  // invoke() and sendSync() block/await a reply; send() is fire-and-forget.
  const wantsHandle = methods.has('invoke') || methods.has('sendSync');
  const registered = handlerBy.get(channel);
  if (!registered) {
    problem(`preload.js calls '${channel}' (ipcRenderer.${[...methods].join('/')}) but main.js has no ipcMain.${wantsHandle ? 'handle' : 'on'}('${channel}')`);
    continue;
  }
  const actualKind = registered[0].method;
  if (wantsHandle && !HANDLE_KINDS.has(actualKind)) {
    problem(`'${channel}' is invoked from preload.js but main.js registers it with ipcMain.${actualKind} - invoke() needs ipcMain.handle(), on() cannot answer a promise`);
  } else if (!wantsHandle && !ON_KINDS.has(actualKind)) {
    problem(`'${channel}' is sent from preload.js but main.js registers it with ipcMain.${actualKind} - send() needs ipcMain.on(), handle() returns to a caller that is not awaiting`);
  }
}

// 4-5. Main -> bridge. An unreachable handler is usually a half-finished
// rename: the bridge method was edited, the handler was not.
for (const [channel, list] of handlerBy) {
  if (!bridgeBy.has(channel)) {
    problem(`main.js handles '${channel}' (ipcMain.${list[0].method}, line ${list[0].line}) but preload.js never calls it - the renderer cannot reach this channel`);
  }
}
for (const [channel, list] of pushBy) {
  const listener = bridgeBy.get(channel);
  if (!listener) {
    problem(`main.js sends '${channel}' (line ${list[0].line}) but preload.js has no ipcRenderer.on('${channel}') listener - the message is dropped`);
  } else if (!listener.some(c => c.method === 'on' || c.method === 'once')) {
    problem(`main.js pushes '${channel}' but preload.js only calls ipcRenderer.${listener[0].method}('${channel}') - a push needs ipcRenderer.on()`);
  }
}

const invokes = bridge.filter(c => HANDLE_KINDS.has(c.method) || c.method === 'invoke' || c.method === 'sendSync').length;
const sends = bridge.filter(c => c.method === 'send').length;
const listeners = bridge.filter(c => c.method === 'on' || c.method === 'once').length;

console.log('IPC CONTRACT CHECK');
console.log(`  main.js:    ${handlers.length} ipcMain handler(s), ${pushes.length} webContents.send channel(s)`);
console.log(`  preload.js: ${invokes} invoke, ${sends} send, ${listeners} listener(s)`);

if (problems.length) {
  for (const p of problems) console.error('  FAIL  ' + p);
  console.error(`\n${problems.length} IPC CONTRACT PROBLEM(S)`);
  process.exit(1);
}

console.log('  PASS  every bridged channel has a main handler of the matching kind');
console.log('  PASS  every main handler and push is reachable from the bridge');
console.log('  PASS  no duplicate handler registration, no dynamic channel names');
console.log(`\nIPC OK - ${bridgeBy.size} channel(s) agree in both directions`);
