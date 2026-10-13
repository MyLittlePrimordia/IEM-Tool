/* ===== data-store.js =====
 * Database tab: where the database actually lives.
 *
 *   electron : desktop app. database.json / database.json.gz / data/ are read
 *              and written through the scoped appBridge methods in preload.js (the
 *              renderer never gets a path). Packaged builds write to the
 *              IEM-Data folder that the app already prefers over the copy it
 *              shipped with; `npm start` writes to the project folder.
 *   folder   : browser (GitHub Pages) with the File System Access API. The
 *              user picks the project folder once; reads and writes go there.
 *   memory   : browser without folder access. Edits live in the page (and the
 *              autosave) and are exported as a .zip of changed files.
 *
 * Also: a tiny IndexedDB key/value store for autosave + ignored audit findings,
 * a gzip helper, and a store-only ZIP writer (no libraries, CSP-safe).
 */
const DataStore = (function () {
  'use strict';
  const bridge = (typeof window !== 'undefined' && window.appBridge) ? window.appBridge : null;
  const state = { mode: 'memory', label: 'Browser only', canWrite: false, dirHandle: null, pending: new Map(), fsApi: false,
    packaged: false, workingCopy: true, canReset: false, onNeedSeed: null };
  try { state.fsApi = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------- kv (IDB)
  let kvDb = null;
  function kvOpen() {
    if (kvDb) return Promise.resolve(kvDb);
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('iem_data_tab', 1);
        req.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
        req.onsuccess = e => { kvDb = e.target.result; resolve(kvDb); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function kvGet(key) {
    const db = await kvOpen(); if (!db) return null;
    return new Promise(resolve => {
      try { const r = db.transaction('kv', 'readonly').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result === undefined ? null : r.result); r.onerror = () => resolve(null); }
      catch (e) { resolve(null); }
    });
  }
  async function kvSet(key, value) {
    const db = await kvOpen(); if (!db) return false;
    return new Promise(resolve => {
      try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false); }
      catch (e) { resolve(false); }
    });
  }
  async function kvDelete(key) {
    const db = await kvOpen(); if (!db) return false;
    return new Promise(resolve => {
      try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); }
      catch (e) { resolve(false); }
    });
  }

  // ------------------------------------------------------------- helpers
  const enc = new TextEncoder();
  async function gzipBytes(text) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(enc.encode(text)); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function gunzipText(buf) {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(buf); w.close();
    return await new Response(ds.readable).text();
  }
  function safeRel(rel) {
    if (typeof rel !== 'string') return null;
    const n = rel.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
    if (!/^data\/[^/].*\.txt$/i.test(n)) return null;
    if (n.split('/').some(p => p === '..' || p === '.' || p === '')) return null;
    return n;
  }
  function downloadBlob(name, data, type) {
    const blob = new Blob([data], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // ---- minimal store-only ZIP ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) { // files: [{name, data:Uint8Array}]
    const parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0]);
      parts.push(local, name, f.data);
      central.push({ name, crc, size, offset });
      offset += local.length + name.length + size;
    });
    let csize = 0;
    central.forEach(c => {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(c.offset)]);
      parts.push(h, c.name); csize += h.length + c.name.length;
    });
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(central.length), ...u16(central.length), ...u32(csize), ...u32(offset), 0, 0]));
    return new Blob(parts, { type: 'application/zip' });
  }

  // ------------------------------------------------------- folder (web) helpers
  async function dirFor(root, rel, create) {
    const parts = rel.split('/').filter(Boolean);
    let h = root;
    for (let i = 0; i < parts.length - 1; i++) h = await h.getDirectoryHandle(parts[i], { create: !!create });
    return { dir: h, name: parts[parts.length - 1] };
  }
  async function walkTxt(dirHandle, prefix, out) {
    for await (const [name, h] of dirHandle.entries()) {
      if (h.kind === 'directory') await walkTxt(h, prefix + name + '/', out);
      else if (name.toLowerCase().endsWith('.txt')) out.push(prefix + name);
    }
  }

  // -------------------------------------------------------------- public API
  async function init() {
    if (bridge && bridge.dataInfo) {
      try {
        const r = await bridge.dataInfo();
        if (r && r.ok) {
          state.mode = 'electron'; state.label = r.label; state.canWrite = !!r.canWrite; state.rootPath = r.path;
          state.packaged = !!r.packaged; state.workingCopy = !!r.workingCopy; state.canReset = !!r.canReset;
          return state;
        }
      } catch (e) { console.warn('[DataStore] bridge unavailable', e); }
    }
    // Restore a previously-picked folder in the browser, if permission is still granted.
    if (state.fsApi) {
      const h = await kvGet('dirHandle');
      if (h) {
        try {
          const perm = await h.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') { state.dirHandle = h; state.mode = 'folder'; state.label = 'Folder: ' + h.name; state.canWrite = true; }
          else state.savedHandle = h;
        } catch (e) { /* ignore */ }
      }
    }
    return state;
  }
  async function pickFolder() {
    if (!state.fsApi) throw new Error('This browser cannot open folders. Use Chrome or Edge, or the desktop app.');
    const h = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.dirHandle = h; state.mode = 'folder'; state.label = 'Folder: ' + h.name; state.canWrite = true;
    await kvSet('dirHandle', h);
    return state;
  }
  async function reconnectFolder() {
    const h = state.savedHandle;
    if (!h) return false;
    const perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    state.dirHandle = h; state.mode = 'folder'; state.label = 'Folder: ' + h.name; state.canWrite = true;
    return true;
  }

  /**
   * Installed app only: the first write copies the bundled database into the user's own
   * IEM-Data working copy (the bundled files are never modified). The UI supplies
   * state.onNeedSeed to explain that and ask; returning false cancels the write.
   */
  async function ensureWritable() {
    if (state.mode !== 'electron' || !state.packaged || state.workingCopy) return true;
    if (state.onNeedSeed && !(await state.onNeedSeed())) throw new Error('Cancelled: no working copy was created.');
    const r = await bridge.dataEnsureWorkingCopy();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not create the working copy.');
    state.workingCopy = true; state.label = 'Your copy (IEM-Data)';
    return true;
  }

  /** Returns { text, source } for the database currently in effect. */
  async function readDatabase() {
    if (state.mode === 'electron') {
      const r = await bridge.dataReadDatabase();
      if (!r || !r.ok) throw new Error((r && r.error) || 'Could not read database');
      return { text: r.text, source: r.source };
    }
    if (state.mode === 'folder') {
      for (const name of ['database.json', 'database.json.gz']) {
        try {
          const fh = await state.dirHandle.getFileHandle(name);
          const file = await fh.getFile();
          if (name.endsWith('.gz')) return { text: await gunzipText(await file.arrayBuffer()), source: name };
          return { text: await file.text(), source: name };
        } catch (e) { /* try next */ }
      }
      throw new Error('database.json was not found in the chosen folder.');
    }
    // memory/web: the same file the rest of the app loaded
    let res = await fetch('./database.json.gz');
    if (res.ok) return { text: await gunzipText(await res.arrayBuffer()), source: 'database.json.gz (web)' };
    res = await fetch('./database.json');
    if (!res.ok) throw new Error('Database file missing');
    return { text: await res.text(), source: 'database.json (web)' };
  }
  /** Array of 'data/...' paths, or null when the data folder can't be listed. */
  async function listDataFiles() {
    if (state.mode === 'electron') { const r = await bridge.dataListFiles(); return r && r.ok ? r.files : null; }
    if (state.mode === 'folder') {
      try { const d = await state.dirHandle.getDirectoryHandle('data'); const out = []; await walkTxt(d, 'data/', out); return out.sort(); }
      catch (e) { return []; }
    }
    return null;
  }
  async function readDataFile(rel) {
    rel = safeRel(rel); if (!rel) throw new Error('Bad path');
    if (state.pending.has(rel)) return state.pending.get(rel);
    if (state.mode === 'electron') { const r = await bridge.dataReadFile(rel); if (!r || !r.ok) throw new Error((r && r.error) || 'read failed'); return r.text; }
    if (state.mode === 'folder') { const x = await dirFor(state.dirHandle, rel, false); return await (await (await x.dir.getFileHandle(x.name)).getFile()).text(); }
    const res = await fetch('./' + rel.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error('not found');
    return await res.text();
  }
  /** Save the database. opts: {json:true, gz:true}. Returns { files:[{name,bytes}], mode } */
  async function saveDatabase(text, opts) {
    opts = Object.assign({ json: true, gz: true }, opts || {});
    const out = [];
    if (state.mode === 'electron') {
      await ensureWritable();
      const r = await bridge.dataWriteDatabase({ text: text, json: opts.json, gz: opts.gz });
      if (!r || !r.ok) throw new Error((r && r.error) || 'save failed');
      return { files: r.files, mode: 'electron', path: r.path };
    }
    if (state.mode === 'folder') {
      if (opts.json) {
        try { const old = await (await state.dirHandle.getFileHandle('database.json')).getFile(); const bd = await state.dirHandle.getDirectoryHandle('backup', { create: true }); const w0 = await (await bd.getFileHandle('database.json.bak', { create: true })).createWritable(); await w0.write(await old.text()); await w0.close(); } catch (e) { /* no previous file */ }
        const w = await (await state.dirHandle.getFileHandle('database.json', { create: true })).createWritable();
        await w.write(text); await w.close(); out.push({ name: 'database.json', bytes: enc.encode(text).length });
      }
      if (opts.gz) {
        const gz = await gzipBytes(text);
        const w = await (await state.dirHandle.getFileHandle('database.json.gz', { create: true })).createWritable();
        await w.write(gz); await w.close(); out.push({ name: 'database.json.gz', bytes: gz.length });
      }
      return { files: out, mode: 'folder' };
    }
    // memory: browser download
    if (opts.json) { downloadBlob('database.json', text, 'application/json'); out.push({ name: 'database.json', bytes: enc.encode(text).length }); }
    if (opts.gz) { const gz = await gzipBytes(text); downloadBlob('database.json.gz', gz, 'application/gzip'); out.push({ name: 'database.json.gz', bytes: gz.length }); }
    return { files: out, mode: 'memory' };
  }
  /** Write one measurement file. Returns { existed }. In memory mode it is queued for the zip. */
  async function writeDataFile(rel, text, overwrite) {
    rel = safeRel(rel); if (!rel) throw new Error('Unsafe path: ' + rel);
    if (state.mode === 'electron') { await ensureWritable(); const r = await bridge.dataWriteFile({ rel: rel, text: text, overwrite: !!overwrite }); if (!r || !r.ok) throw new Error((r && r.error) || 'write failed'); return { existed: !!r.existed }; }
    if (state.mode === 'folder') {
      const x = await dirFor(state.dirHandle, rel, true);
      let existed = true;
      try { await x.dir.getFileHandle(x.name); } catch (e) { existed = false; }
      if (existed && !overwrite) return { existed: true, skipped: true };
      const w = await (await x.dir.getFileHandle(x.name, { create: true })).createWritable();
      await w.write(text); await w.close();
      return { existed: existed };
    }
    const existed = state.pending.has(rel);
    if (existed && !overwrite) return { existed: true, skipped: true };
    state.pending.set(rel, text);
    return { existed: existed };
  }
  /** Delete one measurement file from the writable copy. Returns { existed }. */
  async function deleteDataFile(rel) {
    rel = safeRel(rel); if (!rel) throw new Error('Bad path');
    if (state.mode === 'electron') { await ensureWritable(); const r = await bridge.dataDeleteFile(rel); if (!r || !r.ok) throw new Error((r && r.error) || 'delete failed'); return { existed: !!r.existed }; }
    if (state.mode === 'folder') {
      const x = await dirFor(state.dirHandle, rel, false);
      try { await x.dir.removeEntry(x.name); return { existed: true }; } catch (e) { return { existed: false }; }
    }
    const had = state.pending.delete(rel);
    if (!had) throw new Error('In the browser only files added this session can be deleted. Connect your project folder to delete files on disk.');
    return { existed: true };
  }
  async function resetWorkingCopy() {
    if (state.mode !== 'electron' || !bridge.dataResetWorkingCopy) throw new Error('Reset is only available in the installed desktop app.');
    const r = await bridge.dataResetWorkingCopy();
    if (!r || !r.ok) throw new Error((r && r.error) || 'reset failed');
    return true;
  }
  async function exportZip(extra) {
    const files = [];
    (extra || []).forEach(f => files.push({ name: f.name, data: typeof f.data === 'string' ? enc.encode(f.data) : f.data }));
    state.pending.forEach((text, rel) => files.push({ name: rel, data: enc.encode(text) }));
    downloadBlob('iem-database-update.zip', makeZip(files), 'application/zip');
    return files.length;
  }
  async function openFolder() {
    if (state.mode === 'electron' && bridge.openDataFolder) return bridge.openDataFolder();
    return { ok: false, error: 'Only available in the desktop app.' };
  }

  return { state, init, pickFolder, reconnectFolder, readDatabase, listDataFiles, readDataFile, saveDatabase, writeDataFile,
    exportZip, deleteDataFile, resetWorkingCopy, ensureWritable, openFolder, gzipBytes, gunzipText, downloadBlob, kvGet, kvSet, kvDelete, safeRel, makeZip };
})();
