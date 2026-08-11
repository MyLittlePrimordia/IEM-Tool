// ============================================================================
// music-browser.js — real browser implementation of the MusicAPI bridge.
//
// When the app runs in a plain browser (no Electron, so no window.MusicAPI),
// this file installs a real MusicAPI that:
//   * reads ACTUAL embedded metadata from audio files (ID3v2 + ID3v1 for MP3,
//     Vorbis comments for OGG/Opus/FLAC) including embedded artwork (APIC /
//     FLAC picture blocks) and embedded lyrics (USLT / SYLT),
//   * measures real durations via the <audio> element,
//   * lets the user import music folders (<input type="file" webkitdirectory>)
//     whose audio is persisted as blobs in IndexedDB so the library survives
//     reloads,
//   * writes tags back to the stored MP3 copies (real ID3v2 rewriting),
//   * exports playlists as real .m3u8 downloads.
//
// On first run it seeds the bundled /audio folder ("Server Audio") through the
// server's audio.json index so there is real content to play immediately.
//
// In the packaged Electron app this file is a no-op (MusicAPI already exists).
// ============================================================================

(function () {
  if (window.MusicAPI) return;

  // ------------------------------------------------------------ constants

  const AUDIO_RE = /\.(mp3|m4a|flac|opus|ogg|oga|wav|aiff?|wma)$/i;
  const CFG_KEY = 'music_browser_config';
  const SES_KEY = 'music_browser_session';
  const DB_NAME = 'music_browser_library';
  const STORE = 'files';
  const SERVER_FOLDER = 'Server Audio';

  // ------------------------------------------------------------ IDB storage

  let db = null;
  const rowsByPath = {};       // path -> {path,folder,rel,name,ext,size,mtimeMs,blob,meta}
  const urlCache = {};         // path -> object URL (playback)
  let seeding = null;

  function openDB() {
    return new Promise((resolve) => {
      if (db) { resolve(db); return; }
      if (!window.indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'path' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = () => resolve(null);
    });
  }

  function idbPut(value) {
    return new Promise((resolve) => {
      if (!db) { resolve(); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  }

  function idbAll() {
    return new Promise((resolve) => {
      if (!db) { resolve([]); return; }
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
  }

  function idbDelete(key) {
    return new Promise((resolve) => {
      if (!db) { resolve(); return; }
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  }

  function idbMetaGet(key) {
    return new Promise((resolve) => {
      if (!db) { resolve(null); return; }
      try {
        const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.v : null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  function idbMetaSet(key, val) {
    return new Promise((resolve) => {
      if (!db) { resolve(); return; }
      try {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ k: key, v: val });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  }

  async function loadAllRows() {
    const all = await idbAll();
    for (const r of all) rowsByPath[r.path] = r;
  }

  // ------------------------------------------------------------ config / session

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      folders: [SERVER_FOLDER],
      playlists: [],
      session: null,
      settings: {},
      favorites: [],
      recent: []
    };
  }

  // ------------------------------------------------------------ text decoding

  function decodeText(bytes, enc) {
    if (!bytes || !bytes.length) return '';
    let s = '';
    try {
      if (enc === 3) s = new TextDecoder('utf-8').decode(bytes);
      else if (enc === 0) s = new TextDecoder('iso-8859-1').decode(bytes);
      else if (enc === 1) {
        if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
          s = new TextDecoder('utf-16be').decode(bytes.subarray(2));
        } else {
          const b = bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes;
          s = new TextDecoder('utf-16le').decode(b);
        }
      } else if (enc === 2) s = new TextDecoder('utf-16be').decode(bytes);
      else s = new TextDecoder('utf-8').decode(bytes);
    } catch (_) { s = ''; }
    return s.replace(/\u0000+$/, '');
  }

  function bytesToBase64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 8192) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length)));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function synchsafe(u8, off) {
    return ((u8[off] & 0x7f) << 21) | ((u8[off + 1] & 0x7f) << 14) |
      ((u8[off + 2] & 0x7f) << 7) | (u8[off + 3] & 0x7f);
  }

  function toSynchsafe(n) {
    return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
  }

  // ------------------------------------------------------------ ID3v2 parsing

  function parseId3v2(u8) {
    const out = { frames: {}, end: 0, version: 0 };
    if (u8.length < 10 || u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return out;
    const version = u8[3];
    const flags = u8[5];
    const tagSize = synchsafe(u8, 6);
    out.version = version;
    out.end = Math.min(u8.length, 10 + tagSize);
    let data = u8.subarray(10, out.end);
    if (flags & 0x80) {
      const out2 = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0xFF && data[i + 1] === 0x00) { out2.push(0xFF); i++; }
        else out2.push(data[i]);
      }
      data = Uint8Array.from(out2);
    }
    let p = 0;
    if (flags & 0x40) {
      const es = version >= 4 ? synchsafe(data, 0)
        : ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]);
      p = 4 + es;
    }
    const id3Size = version >= 4 ? 10 : 10;
    while (p + 8 <= data.length) {
      const id = String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) { p++; continue; }
      const size = version >= 4 ? synchsafe(data, p + 4)
        : ((data[p + 4] << 24) | (data[p + 5] << 16) | (data[p + 6] << 8) | data[p + 7]);
      const fs = p + id3Size;
      if (fs + size > data.length) break;
      out.frames[id] = data.subarray(fs, fs + size);
      p = fs + size;
    }
    return out;
  }

  function id3String(fd) {
    if (!fd || !fd.length) return '';
    return decodeText(fd.subarray(1), fd[0]).split('\u0000').join('; ').trim();
  }

  function id3Slash(fd) {
    const s = id3String(fd);
    const parts = s.split('/').map(x => parseInt(x, 10));
    return { no: isNaN(parts[0]) ? null : parts[0], of: isNaN(parts[1]) ? null : parts[1] };
  }

  function id3USLT(fd) {
    if (!fd || fd.length < 5) return null;
    const enc = fd[0];
    let i = 4;
    while (i < fd.length && fd[i] !== 0) i++;
    i++;
    const t = decodeText(fd.subarray(i), enc).replace(/\u0000+$/g, '').trim();
    return t || null;
  }

  function id3SYLT(fd) {
    if (!fd || fd.length < 7) return null;
    const enc = fd[0];
    const format = fd[4];
    let i = 6;
    while (i < fd.length && fd[i] !== 0) i++;
    i++;
    const lines = [];
    const dv = new DataView(fd.buffer, fd.byteOffset, fd.byteLength);
    while (i + 4 <= fd.length) {
      let j = i;
      while (j < fd.length && fd[j] !== 0) j++;
      const text = decodeText(fd.subarray(i, j), enc).trim();
      i = j + 1;
      if (i + 4 > fd.length) break;
      const raw = dv.getUint32(i, false);
      i += 4;
      if (text) lines.push({ time: Math.round(raw / 1000), text });
    }
    return lines.length ? lines : null;
  }

  function id3APIC(fd) {
    if (!fd || fd.length < 4) return null;
    let i = 1;
    while (i < fd.length && fd[i] !== 0) i++;
    const mime = String.fromCharCode.apply(null, fd.subarray(1, i)) || 'image/jpeg';
    i++; i++;
    while (i < fd.length && fd[i] !== 0) i++;
    i++;
    const data = fd.subarray(i);
    if (!data.length) return null;
    return { mime, base64: bytesToBase64(data) };
  }

  function id3COMM(fd) {
    if (!fd || fd.length < 5) return null;
    const enc = fd[0];
    let i = 4;
    while (i < fd.length && fd[i] !== 0) i++;
    i++;
    const t = decodeText(fd.subarray(i), enc).replace(/\u0000+$/g, '').trim();
    return t || null;
  }

  function parseId3v1(u8) {
    if (u8.length < 128) return null;
    const off = u8.length - 128;
    if (u8[off] !== 0x54 || u8[off + 1] !== 0x41 || u8[off + 2] !== 0x47) return null;
    const txt = (a, b) => new TextDecoder('iso-8859-1').decode(u8.subarray(a, b)).replace(/[\u0000\s]+$/g, '').trim();
    return {
      title: txt(off + 3, off + 33) || null,
      artist: txt(off + 33, off + 63) || null,
      album: txt(off + 63, off + 93) || null,
      year: txt(off + 93, off + 97) || null
    };
  }

  // ------------------------------------------------------------ Vorbis / FLAC parsing

  // Parse a Vorbis/FLAC comment payload starting at absolute offset `start`
  // (vendor length first). The spec says big-endian, but some taggers write
  // little-endian, so try both and keep whichever decodes sanely.
  function parseVorbisPayload(u8, start, avail) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (const little of [false, true]) {
      try {
        let p = start;
        const vendorLen = dv.getUint32(p, little); p += 4;
        if (vendorLen > avail - 4 || p + vendorLen > u8.length) continue;
        let printable = true;
        for (let i = 0; i < vendorLen; i++) {
          const b = u8[p + i];
          if (b < 0x20 || b > 0x7e) { printable = false; break; }
        }
        if (!printable) continue;
        p += vendorLen;
        if (p + 4 > u8.length) continue;
        const count = dv.getUint32(p, little); p += 4;
        if (count > 100000) continue;
        const comments = {};
        for (let c = 0; c < count && p + 4 <= u8.length; c++) {
          const len = dv.getUint32(p, little); p += 4;
          if (p + len > u8.length) break;
          const kv = new TextDecoder('utf-8').decode(u8.subarray(p, p + len));
          p += len;
          const eq = kv.indexOf('=');
          if (eq < 0) continue;
          const key = kv.slice(0, eq).toUpperCase();
          const val = kv.slice(eq + 1);
          if (!comments[key]) comments[key] = [];
          comments[key].push(val);
        }
        return comments;
      } catch (_) {}
    }
    return {};
  }

  function readVorbisComments(u8, magic) {
    const magicBytes = new TextEncoder().encode(magic);
    let idx = -1;
    outer:
    for (let i = 0; i + magicBytes.length <= u8.length; i++) {
      for (let k = 0; k < magicBytes.length; k++) {
        if (u8[i + k] !== magicBytes[k]) continue outer;
      }
      idx = i; break;
    }
    if (idx < 0) return {};
    return parseVorbisPayload(u8, idx + magicBytes.length, u8.length - idx - magicBytes.length);
  }

  // FLAC PICTURE metadata block. Lengths are big-endian per the FLAC spec.
  function parseFlacPicture(u8) {
    if (!u8 || u8.length < 4) return null;
    try {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let p = 4; // picture type
      const mimeLen = dv.getUint32(p, false); p += 4;
      if (mimeLen > u8.length - p) return null;
      const mime = new TextDecoder('utf-8').decode(u8.subarray(p, p + mimeLen)) || 'image/jpeg';
      p += mimeLen;
      const descLen = dv.getUint32(p, false); p += 4;
      if (descLen > u8.length - p) return null;
      p += descLen;
      p += 16; // width, height, depth, colors
      if (p + 4 > u8.length) return null;
      const dataLen = dv.getUint32(p, false); p += 4;
      if (p + dataLen > u8.length) return null;
      const data = u8.subarray(p, p + dataLen);
      if (!data.length) return null;
      return { mime, base64: bytesToBase64(data) };
    } catch (_) { return null; }
  }

  function parseFlacBlocks(u8) {
    if (u8.length < 4 || u8[0] !== 0x66 || u8[1] !== 0x4c || u8[2] !== 0x61 || u8[3] !== 0x43) {
      return { comments: {}, picture: null };
    }
    let p = 4;
    let comments = {};
    let picture = null;
    while (p + 4 <= u8.length) {
      const hdr = u8[p];
      const last = hdr & 0x80;
      const type = hdr & 0x7f;
      const size = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
      const body = u8.subarray(p + 4, p + 4 + size);
      if (type === 4) {
        comments = parseVorbisPayload(u8, p + 4, size);
      } else if (type === 6) {
        picture = parseFlacPicture(body);
      }
      p += 4 + size;
      if (last) break;
    }
    return { comments, picture };
  }

  // ------------------------------------------------------------ full tag reader

  function parseTags(u8, ext) {
    const tags = { title: null, artist: null, album: null, albumArtist: null, genre: null, year: null,
      trackNo: null, trackTotal: null, discNo: null, composer: null, comment: null,
      art: null, lyrics: null, codec: null, container: null };
    const e = (ext || '').toLowerCase();

    if (e === 'mp3') {
      const id3 = parseId3v2(u8);
      const F = id3.frames;
      tags.title = id3String(F.TIT2) || null;
      tags.artist = id3String(F.TPE1) || null;
      tags.album = id3String(F.TALB) || null;
      tags.albumArtist = id3String(F.TPE2) || null;
      tags.genre = id3String(F.TCON) || null;
      tags.year = (id3String(F.TDRC) || id3String(F.TYER) || '').slice(0, 4) || null;
      const tr = id3Slash(F.TRCK);
      tags.trackNo = tr.no;
      tags.trackTotal = tr.of;
      const ds = id3Slash(F.TPOS);
      tags.discNo = ds.no;
      tags.composer = id3String(F.TCOM) || null;
      tags.comment = id3COMM(F.COMM) || null;
      tags.art = id3APIC(F.APIC);
      const uslt = id3USLT(F.USLT);
      const sylt = id3SYLT(F.SYLT);
      if (uslt || sylt) tags.lyrics = { unsynced: uslt, synced: sylt, format: sylt ? 'SYLT' : 'USLT' };
      tags.codec = 'MPEG Layer 3';
      tags.container = 'MPEG';
      if (!tags.title && !tags.artist && !tags.album) {
        const v1 = parseId3v1(u8);
        if (v1) { tags.title = v1.title; tags.artist = v1.artist; tags.album = v1.album; if (!tags.year) tags.year = v1.year; }
      }
    } else if (e === 'flac') {
      const blk = parseFlacBlocks(u8);
      tags.art = blk.picture;
      mapVorbis(tags, blk.comments);
      tags.codec = 'FLAC';
      tags.container = 'FLAC';
    } else if (e === 'opus' || e === 'ogg' || e === 'oga') {
      const comments = readVorbisComments(u8, e === 'opus' ? 'OpusTags' : '\u0003vorbis');
      if (!Object.keys(comments).length && e === 'ogg') {
        const fb = parseFlacBlocks(u8);
        mapVorbis(tags, fb.comments);
        tags.art = tags.art || fb.picture;
      }
      mapVorbis(tags, comments);
      tags.codec = e === 'opus' ? 'Opus' : 'Vorbis';
      tags.container = 'Ogg';
    } else if (e === 'wav' || e === 'aiff' || e === 'aif') {
      tags.container = e === 'wav' ? 'WAVE' : 'AIFF';
      tags.codec = e === 'wav' ? 'PCM' : 'PCM';
    } else if (e === 'm4a' || e === 'mp4' || e === 'aac') {
      tags.container = 'MP4';
      tags.codec = 'AAC';
    }
    return tags;
  }

  function mapVorbis(tags, comments) {
    const one = (key) => {
      const a = comments[key];
      if (!a || !a.length) return null;
      return a.join('; ').trim() || null;
    };
    const first = (key) => {
      const a = comments[key];
      return (a && a[0] != null && String(a[0]).trim()) ? String(a[0]).trim() : null;
    };
    if (!tags.title) tags.title = first('TITLE');
    if (!tags.artist) tags.artist = one('ARTIST');
    if (!tags.album) tags.album = first('ALBUM');
    if (!tags.albumArtist) tags.albumArtist = one('ALBUMARTIST');
    if (!tags.genre) tags.genre = one('GENRE');
    if (!tags.year) tags.year = (first('DATE') || first('YEAR') || '').slice(0, 4) || null;
    if (tags.trackNo == null) {
      const tn = parseInt(first('TRACKNUMBER'), 10);
      if (!isNaN(tn)) tags.trackNo = tn;
    }
    if (tags.trackTotal == null) {
      const t = first('TRACKTOTAL') || first('TOTALTRACKS');
      const tt = parseInt(t, 10);
      if (!isNaN(tt)) tags.trackTotal = tt;
    }
    if (tags.discNo == null) {
      const dn = parseInt(first('DISCNUMBER'), 10);
      if (!isNaN(dn)) tags.discNo = dn;
    }
    if (!tags.composer) tags.composer = one('COMPOSER');
    if (!tags.comment) tags.comment = one('COMMENT') || one('DESCRIPTION');
    if (!tags.art) {
      const picB64 = comments['METADATA_BLOCK_PICTURE'];
      if (picB64 && picB64.length) {
        try { tags.art = parseFlacPicture(base64ToBytes(picB64[0])); } catch (_) {}
      }
    }
    let uslt = first('UNSYNCEDLYRICS') || one('UNSYNCEDLYRICS');
    if (!uslt) uslt = one('LYRICS');
    if (uslt) tags.lyrics = { unsynced: uslt, synced: null, format: 'USLT' };
  }

  // ------------------------------------------------------------ duration probe

  function probeDuration(url) {
    return new Promise((resolve) => {
      try {
        const a = new Audio();
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
        a.addEventListener('error', () => resolve(0), { once: true });
        a.src = url;
        setTimeout(() => resolve(0), 5000);
      } catch (_) { resolve(0); }
    });
  }

  // ------------------------------------------------------------ server seed

  async function ensureServerSeed() {
    if (seeding) return seeding;
    const cfg = loadConfig();
    if (!cfg.folders.some(f => String(f).toLowerCase() === SERVER_FOLDER.toLowerCase())) return;

    // The manifest is the source of truth: fetch any manifest entries that
    // aren't already stored so newly added tracks get picked up on rescan.
    let manifest = [];
    try {
      const res = await fetch('./audio/audio.json');
      if (res.ok) manifest = await res.json();
    } catch (_) {}
    if (!manifest || !manifest.length) return;

    const stored = new Set(
      Object.values(rowsByPath).filter(r => r.folder === SERVER_FOLDER).map(r => String(r.rel || '').toLowerCase())
    );
    const missing = (manifest || []).filter(item => {
      const file = String(item.file || '');
      return file && AUDIO_RE.test(file) && !stored.has(file.toLowerCase());
    });
    if (!missing.length) return;

    seeding = (async () => {
      try {
        const base = location.href.slice(0, location.href.lastIndexOf('/') + 1);
        for (const item of missing) {
          const file = String(item.file || '');
          const fileRes = await fetch(base + 'audio/' + encodeURIComponent(file));
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          const rel = file;
          const path = SERVER_FOLDER + '/' + rel;
          await idbPut({
            path, folder: SERVER_FOLDER, rel, name: file,
            ext: (file.split('.').pop() || '').toLowerCase(),
            size: blob.size, mtimeMs: Date.now(), blob, meta: null
          });
          rowsByPath[path] = {
            path, folder: SERVER_FOLDER, rel, name: file,
            ext: (file.split('.').pop() || '').toLowerCase(),
            size: blob.size, mtimeMs: Date.now(), blob, meta: null
          };
        }
      } catch (_) {}
    })();
    try { await seeding; } finally { seeding = null; }
  }

  // ------------------------------------------------------------ object urls

  function urlFor(path) {
    const r = rowsByPath[path];
    if (!r) return '';
    if (urlCache[path]) return urlCache[path];
    const url = URL.createObjectURL(r.blob);
    urlCache[path] = url;
    return url;
  }

  // ------------------------------------------------------------ tag writer (Vorbis / FLAC / Ogg)

  // Serialize a Vorbis-comment payload (vendor + key=value list). All the
  // length fields here are little-endian per the Vorbis comment spec.
  function encodeVorbisComments(commentMap) {
    const enc = new TextEncoder();
    const vendor = 'IEM Media Tool';
    const vb = enc.encode(vendor);
    const entries = [];
    let total = 4 + vb.length + 4;
    for (const key in commentMap) {
      const arr = commentMap[key];
      if (!arr || !arr.length) continue;
      for (const raw of arr) {
        const val = String(raw == null ? '' : raw);
        if (val === '') continue;
        const b = enc.encode(key + '=' + val);
        entries.push(b);
        total += 4 + b.length;
      }
    }
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let p = 0;
    dv.setUint32(p, vb.length, true); p += 4;
    out.set(vb, p); p += vb.length;
    dv.setUint32(p, entries.length, true); p += 4;
    for (const b of entries) {
      dv.setUint32(p, b.length, true); p += 4;
      out.set(b, p); p += b.length;
    }
    return out;
  }

  // Build a FLAC PICTURE metadata block body from {mime, base64} using the
  // exact same layout bytes our reader expects (big-endian lengths).
  function encodeFlacPicture(pic) {
    const enc = new TextEncoder();
    const mimeBytes = enc.encode(pic.mime || 'image/jpeg');
    const descBytes = enc.encode('');
    const img = base64ToBytes(pic.base64);
    const out = new Uint8Array(4 + 4 + mimeBytes.length + 4 + descBytes.length + 16 + 4 + img.length);
    const dv = new DataView(out.buffer);
    let p = 0;
    dv.setUint32(p, 3, false); p += 4; // picture type: front cover
    dv.setUint32(p, mimeBytes.length, false); p += 4;
    out.set(mimeBytes, p); p += mimeBytes.length;
    dv.setUint32(p, descBytes.length, false); p += 4;
    out.set(descBytes, p); p += descBytes.length;
    p += 16; // width/height/depth/colors = 0
    dv.setUint32(p, img.length, false); p += 4;
    out.set(img, p); p += img.length;
    return out;
  }

  // RFC 3533 CRC-32 (polynomial 0x04C11DB7, MSB-first) used by Ogg pages.
  const _oggCrcLut = (() => {
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = (i << 24) >>> 0;
      for (let k = 0; k < 8; k++) {
        c = (c & 0x80000000) ? (((c << 1) ^ 0x04c11db7) >>> 0) : ((c << 1) >>> 0);
      }
      lut[i] = c;
    }
    return lut;
  })();
  function oggCrc(data, start, end) {
    let crc = 0;
    for (let i = start; i < end; i++) {
      crc = ((crc << 8) >>> 0) ^ _oggCrcLut[((crc >>> 24) & 0xff) ^ data[i]];
    }
    return crc;
  }

  // -------------------------------------------------------- Ogg / Opus write path

  // Parse an Ogg container into a page table. Each entry carries the raw page
  // header fields and the byte extent of its laced body.
  function parseOggPages(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const pages = [];
    let off = 0;
    while (off + 27 <= u8.length && u8[off] === 0x4f && u8[off + 1] === 0x67 && u8[off + 2] === 0x67 && u8[off + 3] === 0x53) {
      const segCount = u8[off + 26];
      const bodyStart = off + 27 + segCount;
      let bodyEnd = bodyStart;
      for (let i = 0; i < segCount; i++) bodyEnd += u8[off + 27 + i];
      pages.push({
        start: off,
        type: u8[off + 5],
        granuleHi: dv.getUint32(off + 6, true),
        granuleLo: dv.getUint32(off + 10, true),
        serial: dv.getUint32(off + 14, true),
        seq: dv.getUint32(off + 18, true),
        segCount,
        bodyStart,
        bodyEnd
      });
      off = bodyEnd;
    }
    return pages;
  }

  // Walk the lacing values across all pages and reconstruct logical packet
  // boundaries as absolute byte ranges. Also records, per original page, the
  // cumulative number of packets completed once that page has been consumed.
  function collectOggPackets(u8, pages) {
    const list = [];
    const endPacketEnds = [];
    let curStart = -1;
    for (const pg of pages) {
      let p = pg.bodyStart;
      for (let i = 0; i < pg.segCount; i++) {
        const l = u8[pg.start + 27 + i];
        if (curStart < 0) curStart = p;
        p += l;
        if (l < 255) {
          list.push({ start: curStart, end: p });
          curStart = -1;
        }
      }
      endPacketEnds.push(list.length);
    }
    if (curStart >= 0) return null; // stream ends mid-packet
    return { list, endPacketEnds };
  }

  // Lace a set of whole packets into one Ogg page and return its bytes, or null
  // if the page would need more than 255 lacing entries. A packet is ended by a
  // segment shorter than 255 (a zero segment terminates an exact multiple of 255).
  function buildOggPage(packets, granuleHi, granuleLo, serial, seq, type) {
    const segs = [];
    for (const pkt of packets) {
      if (!pkt || !pkt.length) { segs.push(0); continue; }
      let pos = 0;
      while (pkt.length - pos >= 255) { segs.push(255); pos += 255; }
      const rem = pkt.length - pos;
      segs.push(rem === 0 ? 0 : rem);
    }
    if (!segs.length || segs.length > 255) return null;
    const page = new Uint8Array(27 + segs.length + segs.reduce((a, b) => a + b, 0));
    const enc = new TextEncoder();
    page.set(enc.encode('OggS'), 0);
    page[5] = type;
    const dv = new DataView(page.buffer);
    dv.setUint32(6, granuleLo, true);
    dv.setUint32(10, granuleHi, true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, seq, true);
    page[26] = segs.length;
    let off = 27;
    for (let i = 0; i < segs.length; i++) page[off++] = segs[i];
    for (const pkt of packets) {
      if (pkt && pkt.length) { page.set(pkt, off); off += pkt.length; }
    }
    const crc = oggCrc(page, 0, page.length);
    dv.setUint32(22, crc, true);
    return page;
  }

  // Strip the leading comment-header magic ('OpusTags' or '\x03vorbis') off
  // packet #1, keep any unrecognized leading bytes, then replace with the magic
  // plus the freshly encoded comment frames plus the required 0x01 framing bit.
  function buildOggCommentPacket(magicNumber, map, trailing) {
    const enc = new TextEncoder();
    const payload = encodeVorbisComments(map);
    const out = new Uint8Array(magicNumber.length + payload.length + (trailing ? 1 : 0));
    out.set(magicNumber, 0);
    out.set(payload, magicNumber.length);
    if (trailing) out[out.length - 1] = 0x01;
    return out;
  }

  // Rebuild an Ogg / Opus file with an updated Vorbis-comment packet. Audio
  // packet payloads are copied verbatim; pages are re-laced from the (possibly
  // edited) logical packet list and re-sequenced, keeping each original page's
  // granule position.
  function rewriteOggTags(blob, patch) {
    return new Promise(async (resolve) => {
      try {
        const u8 = new Uint8Array(await blob.arrayBuffer());
        const pages = parseOggPages(u8);
        if (!pages.length) { resolve(null); return; }
        const pk = collectOggPackets(u8, pages);
        if (!pk || !pk.list || pk.list.length < 2) { resolve(null); return; }

        // Identify the comment magic on packet #1 (index 1).
        const c0 = pk.list[1].start;
        const cBytes = u8.subarray(c0, pk.list[1].end);
        let magic;
        if (cBytes.length >= 8 && cBytes[0] === 0x4f && cBytes[1] === 0x70 && cBytes[2] === 0x75 && cBytes[3] === 0x73 && cBytes[4] === 0x54 && cBytes[5] === 0x61 && cBytes[6] === 0x67 && cBytes[7] === 0x73) {
          magic = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // "OpusTags"
        } else if (cBytes.length >= 7 && cBytes[0] === 0x03 && cBytes[1] === 0x76 && cBytes[2] === 0x6f && cBytes[3] === 0x72 && cBytes[4] === 0x62 && cBytes[5] === 0x69 && cBytes[6] === 0x73) {
          magic = new Uint8Array([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // "\x03vorbis"
        } else {
          resolve(null); // not an Ogg/Opus/Vorbis comment stream we can rewrite
          return;
        }

        const existing = parseVorbisPayload(u8, c0 + magic.length, pk.list[1].end - c0 - magic.length);
        const map = vorbisMapFromPatch(existing, patch);
        const newPacket = buildOggCommentPacket(magic, map, true);

        const rebuilt = pk.list.map(rec => u8.subarray(rec.start, rec.end));
        rebuilt[1] = newPacket;

        const serial = pages[0].serial;
        const out = [];
        let prevEnd = 0;
        let seq = 0;
        const lastPageIndex = pages.length - 1;
        for (let i = 0; i < pages.length; i++) {
          const end = pk.endPacketEnds[i];
          if (i > 0 && end === pk.endPacketEnds[i - 1]) continue; // pure continuation page
          const window = rebuilt.slice(prevEnd, end);
          if (!window.length) continue;
          let type = 0;
          if (i === 0) type |= 0x02; // beginning of stream
          if (i === lastPageIndex) type |= 0x04; // end of stream
          const pageBytes = buildOggPage(window, pages[i].granuleHi, pages[i].granuleLo, serial, seq, type);
          if (!pageBytes) { resolve(null); return; }
          out.push(pageBytes);
          prevEnd = end;
          seq++;
        }
        if (prevEnd !== rebuilt.length) { resolve(null); return; }
        resolve(new Blob(out, { type: blob.type }));
      } catch (_) {
        resolve(null);
      }
    });
  }

  // -------------------------------------------------------- Vorbis / FLAC write path

  // Map our normalized patch + existing comments onto a fresh Vorbis comment
  // dictionary (keys uppercased, values arrays of strings) shared by FLAC/Ogg.
  // Any existing keys we don't explicitly manage are carried through untouched.
  function vorbisMapFromPatch(existing, patch) {
    const m = {};
    const MANAGED = 'TITLE,ARTIST,ALBUM,ALBUMARTIST,ARTISTS,GENRE,DATE,YEAR,TRACKNUMBER,TRACKTOTAL,TOTALTRACKS,DISCNUMBER,COMPOSER,COMMENT,DESCRIPTION,UNSYNCEDLYRICS,LYRICS,SYNCEDLYRICS,METADATA_BLOCK_PICTURE'.split(',');
    for (const k in existing) {
      if (!MANAGED.includes(String(k).toUpperCase())) m[k] = (existing[k] || []).slice();
    }
    const first = (key) => {
      const a = existing[key];
      return (a && a[0] != null) ? String(a[0]) : null;
    };
    const joined = (key) => {
      const a = existing[key];
      return (a && a.length) ? a.join('; ') : null;
    };
    const set = (key, val) => {
      if (val == null) { m[key] = []; return; }
      const s = String(val);
      if (s.trim() === '') m[key] = [];
      else m[key] = [s];
    };
    const one = (key, val) => { if (m[key] == null || !m[key].length) set(key, val); };

    one('TITLE', patch.title != null ? patch.title : first('TITLE'));
    one('ARTIST', patch.artist != null ? patch.artist : joined('ARTIST'));
    one('ALBUM', patch.album != null ? patch.album : first('ALBUM'));
    one('ALBUMARTIST', patch.albumArtist != null ? patch.albumArtist : joined('ALBUMARTIST'));
    one('GENRE', patch.genre != null ? patch.genre : joined('GENRE'));
    one('DATE', patch.year != null ? String(patch.year) : (first('DATE') || first('YEAR')));
    const tNo = patch.trackNo != null ? patch.trackNo : first('TRACKNUMBER');
    const tTot = patch.trackTotal != null ? patch.trackTotal : (first('TRACKTOTAL') || first('TOTALTRACKS'));
    if ((tNo != null || tTot != null)) {
      set('TRACKNUMBER', (tNo != null ? String(tNo) : '') + (tTot != null ? '/' + String(tTot) : ''));
    }
    if (tTot != null) set('TRACKTOTAL', String(tTot));
    one('DISCNUMBER', patch.discNo != null ? String(patch.discNo) : first('DISCNUMBER'));
    one('COMPOSER', patch.composer != null ? patch.composer : joined('COMPOSER'));
    one('COMMENT', patch.comment != null ? patch.comment : (joined('COMMENT') || joined('DESCRIPTION')));
    if (patch.picture != null) m.METADATA_BLOCK_PICTURE = [bytesToBase64(encodeFlacPicture(patch.picture))];
    else if (patch.removePicture) m.METADATA_BLOCK_PICTURE = [];
    else if (existing.METADATA_BLOCK_PICTURE) m.METADATA_BLOCK_PICTURE = (existing.METADATA_BLOCK_PICTURE || []).slice();
    if (patch.lyrics != null) {
      const t = String(patch.lyrics || '').trim();
      m.UNSYNCEDLYRICS = t ? [t] : [];
    } else if (existing.UNSYNCEDLYRICS) m.UNSYNCEDLYRICS = (existing.UNSYNCEDLYRICS || []).slice();
    if (Array.isArray(patch.syncedLyrics)) {
      m.SYNCEDLYRICS = patch.syncedLyrics.length ? [patch.syncedLyrics.map(l => '[' + _fmtLrcTime(l.time) + '] ' + l.text).join('\n')] : [];
    } else if (existing.SYNCEDLYRICS) m.SYNCEDLYRICS = (existing.SYNCEDLYRICS || []).slice();
    // drop keys we cleared to empty
    for (const key in m) if (m[key].length === 0) delete m[key];
    return m;
  }

  function _fmtLrcTime(t) {
    const min = Math.floor((t || 0) / 60), sec = Math.floor((t || 0) % 60), ms = Math.floor(((t || 0) % 1) * 100);
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(2, '0');
  }

  // Rebuild a FLAC file: STREAMINFO stays first, VORBIS_COMMENT (4) is
  // regenerated from the merged comments, PICTURE (6) replaced/removed, all
  // other metadata blocks pass through verbatim. Tail (audio frames) unchanged.
  function rewriteFlacTags(blob, patch) {
    return new Promise(async (resolve) => {
      try {
        const u8 = new Uint8Array(await blob.arrayBuffer());
        if (u8.length < 4 || u8[0] !== 0x66 || u8[1] !== 0x4c || u8[2] !== 0x61 || u8[3] !== 0x43) { resolve(null); return; }
        const blocks = [];
        let p = 4;
        let audioStart = 4;
        let existingComments = {};
        while (p + 4 <= u8.length) {
          const hdr = u8[p];
          const last = (hdr & 0x80) !== 0;
          const type = hdr & 0x7f;
          const size = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
          const body = u8.subarray(p + 4, p + 4 + size);
          if (type === 4) existingComments = parseVorbisPayload(u8, p + 4, size);
          blocks.push({ type, body: u8.slice(p + 4, p + 4 + size) });
          p += 4 + size;
          audioStart = p;
          if (last) break;
        }
        const map = vorbisMapFromPatch(existingComments, patch);
        const commentBody = encodeVorbisComments(map);
        // picture handling: FLAC PICTURE lives in its own block, not the comment field
        let outBlocks = [];
        for (const b of blocks) {
          if (b.type === 4) continue;
          if (b.type === 6) continue;
          outBlocks.push(b);
        }
        // insert comment right after STREAMINFO (type 0) if present, else at start
        const insertAt = outBlocks.findIndex(b => b.type === 0);
        outBlocks.splice(insertAt >= 0 ? insertAt + 1 : 0, 0, { type: 4, body: commentBody });
        if (patch.picture != null) {
          outBlocks.splice(1, 0, { type: 6, body: encodeFlacPicture(patch.picture) });
        } else if (!patch.removePicture) {
          const oldPic = blocks.find(b => b.type === 6);
          if (oldPic) outBlocks.push(oldPic);
        }
        // serialize metadata blocks with the "last block" flag on the final one
        const parts = [];
        let total = 0;
        const serialized = [];
        for (let i = 0; i < outBlocks.length; i++) {
          const b = outBlocks[i];
          const last = i === outBlocks.length - 1;
          const hdr = new Uint8Array(4);
          hdr[0] = (b.type & 0x7f) | (last ? 0x80 : 0);
          const size = b.body.length;
          hdr[1] = (size >> 16) & 0xff; hdr[2] = (size >> 8) & 0xff; hdr[3] = size & 0xff;
          serialized.push(hdr, new Uint8Array(b.body.buffer, b.body.byteOffset, b.body.byteLength));
          total += 4 + size;
        }
        const head = new Uint8Array(total);
        let off = 0;
        for (const s of serialized) { head.set(s, off); off += s.length; }
        const tail = u8.subarray(audioStart);
        const merged = new Uint8Array(4 + head.length + tail.length);
        merged.set([0x66, 0x4c, 0x61, 0x43], 0);
        merged.set(head, 4);
        merged.set(tail, 4 + head.length);
        resolve(new Blob([merged], { type: blob.type }));
      } catch (err) {
        resolve(null);
      }
    });
  }

  function encodeTextFrame(id, text) {
    const b = new TextEncoder().encode(String(text == null ? '' : text));
    const data = new Uint8Array(1 + b.length);
    data[0] = 3;
    data.set(b, 1);
    return frame24(id, data);
  }

  function encodeComm(text) {
    const b = new TextEncoder().encode(String(text || ''));
    const data = new Uint8Array(5 + b.length);
    data[0] = 3; data[1] = 0x65; data[2] = 0x6e; data[3] = 0x67; data[4] = 0;
    data.set(b, 5);
    return frame24('COMM', data);
  }

  function encodeUslt(text) {
    const b = new TextEncoder().encode(String(text || ''));
    const data = new Uint8Array(5 + b.length);
    data[0] = 3; data[1] = 0x65; data[2] = 0x6e; data[3] = 0x67; data[4] = 0;
    data.set(b, 5);
    return frame24('USLT', data);
  }

  function encodeSylt(lines) {
    const enc = new TextEncoder();
    let need = 7;
    const entries = [];
    for (const l of (lines || [])) {
      const tb = enc.encode(String(l.text || ''));
      entries.push({ tb, t: Math.round((l.time || 0) * 1000) });
      need += tb.length + 1 + 4;
    }
    const data = new Uint8Array(need);
    data[0] = 3; data[1] = 0x65; data[2] = 0x6e; data[3] = 0x67; data[4] = 2; data[5] = 1; data[6] = 0;
    let off = 7;
    const dv = new DataView(data.buffer);
    for (const e of entries) {
      data.set(e.tb, off); off += e.tb.length;
      data[off] = 0; off++;
      dv.setUint32(off, e.t, false); off += 4;
    }
    return frame24('SYLT', data);
  }

  function encodeApic(mime, base64) {
    const m = new TextEncoder().encode(mime || 'image/jpeg');
    const img = base64ToBytes(base64);
    const data = new Uint8Array(1 + m.length + 2 + img.length);
    data[0] = 0;
    data.set(m, 1);
    data[1 + m.length] = 3;
    data[2 + m.length] = 0;
    data.set(img, 3 + m.length);
    return frame24('APIC', data);
  }

  function frame24(id, data) {
    const out = new Uint8Array(10 + data.length);
    out[0] = id.charCodeAt(0); out[1] = id.charCodeAt(1);
    out[2] = id.charCodeAt(2); out[3] = id.charCodeAt(3);
    const s = toSynchsafe(data.length);
    out[4] = s[0]; out[5] = s[1]; out[6] = s[2]; out[7] = s[3];
    out[8] = 0; out[9] = 0;
    out.set(data, 10);
    return out;
  }

  // Managed frame ids we rebuild; everything else is preserved verbatim.
  const MANAGED_FRAMES = new Set([
    'TIT2', 'TPE1', 'TALB', 'TPE2', 'TCON', 'TYER', 'TDRC', 'TRCK', 'TPOS',
    'TCOM', 'COMM', 'USLT', 'SYLT', 'APIC', 'TXXX', 'TCOP', 'TENC', 'TOPE',
    'TPUB', 'TSSE', 'WXXX', 'POPM', 'PRIV'
  ]);

  function buildId3v2(frames) {
    const out = [];
    for (const id in frames) out.push(frame24(id, frames[id]));
    let total = 0;
    for (const f of out) total += f.length;
    const header = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00].concat(toSynchsafe(total)));
    const buf = new Uint8Array(10 + total);
    buf.set(header, 0);
    let off = 10;
    for (const f of out) { buf.set(f, off); off += f.length; }
    return buf;
  }

  function rewriteMp3Tags(blob, patch) {
    return new Promise(async (resolve) => {
      try {
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        const id3 = parseId3v2(u8);
        let audioStart = id3.end && u8[0] === 0x49 ? id3.end : 0;

        const frames = {};
        for (const id in id3.frames) {
          if (!MANAGED_FRAMES.has(id)) frames[id] = id3.frames[id];
        }

        const set = (fid, val) => {
          if (val == null || val === '') delete frames[fid];
          else frames[fid] = encodeTextFrame(fid, val).subarray(10);
        };
        set('TIT2', patch.title != null ? patch.title : (id3String(id3.frames.TIT2) || null));
        set('TPE1', patch.artist != null ? patch.artist : (id3String(id3.frames.TPE1) || null));
        set('TALB', patch.album != null ? patch.album : (id3String(id3.frames.TALB) || null));
        set('TPE2', patch.albumArtist != null ? patch.albumArtist : (id3String(id3.frames.TPE2) || null));
        set('TCON', patch.genre != null ? patch.genre : (id3String(id3.frames.TCON) || null));
        set('TDRC', patch.year != null ? String(patch.year) : ((id3String(id3.frames.TDRC) || id3String(id3.frames.TYER) || '').slice(0, 4) || null));
        delete frames.TYER;

        const trk = (patch.trackNo != null ? patch.trackNo : id3Slash(id3.frames.TRCK).no);
        const tro = (patch.trackTotal != null ? patch.trackTotal : id3Slash(id3.frames.TRCK).of);
        if (trk != null || tro != null) {
          const s = (trk != null ? trk : '') + (tro != null ? '/' + tro : '');
          frames.TRCK = encodeTextFrame('TRCK', s).subarray(10);
        } else delete frames.TRCK;
        const dn = patch.discNo != null ? patch.discNo : id3Slash(id3.frames.TPOS).no;
        if (dn != null) frames.TPOS = encodeTextFrame('TPOS', String(dn)).subarray(10);
        else delete frames.TPOS;
        set('TCOM', patch.composer != null ? patch.composer : (id3String(id3.frames.TCOM) || null));
        set('COMM', patch.comment != null ? patch.comment : (id3COMM(id3.frames.COMM) || null));

        if (patch.lyrics != null) {
          const t = String(patch.lyrics || '').trim();
          if (t) frames.USLT = encodeUslt(t).subarray(10);
          else delete frames.USLT;
        } else if (id3.frames.USLT) {
          frames.USLT = id3.frames.USLT;
        }
        if (Array.isArray(patch.syncedLyrics)) {
          if (patch.syncedLyrics.length) frames.SYLT = encodeSylt(patch.syncedLyrics).subarray(10);
          else delete frames.SYLT;
        } else if (id3.frames.SYLT) {
          frames.SYLT = id3.frames.SYLT;
        }
        if (patch.removePicture) delete frames.APIC;
        else if (patch.picture != null) frames.APIC = encodeApic(patch.picture.mime, patch.picture.base64).subarray(10);
        else if (id3.frames.APIC) frames.APIC = id3.frames.APIC;

        const tag = buildId3v2(frames);
        const audio = u8.subarray(audioStart);
        const merged = new Uint8Array(tag.length + audio.length);
        merged.set(tag, 0);
        merged.set(audio, tag.length);
        resolve(new Blob([merged], { type: blob.type }));
      } catch (err) {
        resolve(null);
      }
    });
  }

  // ------------------------------------------------------------ folder picking

  // Recursively collect audio rows under a File System Access directory handle.
  async function walkDir(handle, folder, prefix, out) {
    if (!handle || handle.kind !== 'directory') return;
    for await (const [name, h] of handle.entries()) {
      if (h.kind === 'directory') {
        await walkDir(h, folder, prefix + '/' + name, out);
      } else if (AUDIO_RE.test(name)) {
        let file;
        try { file = await h.getFile(); } catch (_) { continue; }
        const rel = (prefix ? prefix + '/' : '') + name;
        out.push({
          path: folder + '/' + rel,
          folder, rel, name,
          ext: (name.split('.').pop() || '').toLowerCase(),
          size: file.size,
          mtimeMs: file.lastModified || Date.now(),
          blob: file, meta: null
        });
      }
    }
  }

  // Re-read every folder that was imported through showDirectoryPicker and pull
  // in files that were added/changed on disk since the last visit, so a refresh
  // or restart picks them up without forcing the user to re-pick the folder.
  // Returns { skipped: [{folder, reason}] } where reason is one of
  // 'unsupported' (browser has no File System Access API), 'nohandle'
  // (webkitdirectory import — folder can't be re-read), 'denied' (permission
  // was asked but not granted), so callers can tell the user what to re-add.
  async function refreshFromHandles(folders) {
    const skipped = [];
    if (!window.showDirectoryPicker) {
      for (const folder of (folders || [])) skipped.push({ folder, reason: 'unsupported' });
      return { skipped };
    }
    let handles = {};
    try { handles = (await idbMetaGet('dir_handles')) || {}; } catch (_) {}
    for (const folder of (folders || [])) {
      const fk = String(folder).toLowerCase();
      const handle = handles[fk];
      if (!handle) { skipped.push({ folder, reason: 'nohandle' }); continue; }
      let perm = 'denied';
      try {
        perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'read' });
      } catch (_) {}
      if (perm !== 'granted') { skipped.push({ folder, reason: 'denied' }); continue; }
      const rows = [];
      try { await walkDir(handle, folder, '', rows); } catch (_) {}
      if (!rows.length) continue;
      const seen = new Set();
      for (const r of rows) {
        seen.add(r.path);
        const prev = rowsByPath[r.path];
        if (prev && prev.size === r.size && prev.mtimeMs === r.mtimeMs) continue;
        rowsByPath[r.path] = r;
        await idbPut(r);
      }
      // drop DB rows in this folder that no longer exist on disk
      const doomed = Object.keys(rowsByPath).filter(p => {
        const row = rowsByPath[p];
        return row && row.folder && String(row.folder).toLowerCase() === fk && !seen.has(p);
      });
      for (const p of doomed) {
        if (urlCache[p]) { try { URL.revokeObjectURL(urlCache[p]); } catch (_) {} delete urlCache[p]; }
        delete rowsByPath[p];
        await idbDelete(p);
      }
    }
    return { skipped };
  }

  async function pickFolders() {
    // Prefer the File System Access API: the handle is stored so later rescans
    // can silently re-read the folder (new files show up after a refresh).
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await openDB();
        await loadAllRows();
        const handles = (await idbMetaGet('dir_handles')) || {};
        handles[String(handle.name).toLowerCase()] = handle;
        await idbMetaSet('dir_handles', handles);
        const folder = handle.name;
        const rows = [];
        await walkDir(handle, folder, '', rows);
        for (const r of rows) { rowsByPath[r.path] = r; await idbPut(r); }
        return [folder];
      } catch (err) {
        if (err && err.name === 'AbortError') return [];
      }
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []).filter(f => AUDIO_RE.test(f.name));
        input.remove();
        if (!files.length) { resolve([]); return; }
        await openDB();
        const folderNames = [];
        const seen = {};
        for (const file of files) {
          const rel = file.webkitRelativePath || file.name;
          const parts = rel.split('/');
          const folder = parts.length > 1 ? parts[0] : '(Selected Files)';
          const path = folder + '/' + (parts.length > 1 ? parts.slice(1).join('/') : file.name);
          const row = {
            path, folder, rel, name: file.name,
            ext: (file.name.split('.').pop() || '').toLowerCase(),
            size: file.size, mtimeMs: file.lastModified || Date.now(),
            blob: file, meta: null
          };
          rowsByPath[path] = row;
          await idbPut(row);
          if (!seen[folder]) { seen[folder] = true; folderNames.push(folder); }
        }
        resolve(folderNames);
      });
      input.addEventListener('cancel', () => { input.remove(); resolve([]); });
      input.click();
    });
  }

  // ------------------------------------------------------------ read tags

  async function readTagsFor(filePath) {
    const r = rowsByPath[filePath];
    if (!r) return null;
    if (r.meta) return r.meta;
    try {
      const buf = await r.blob.arrayBuffer();
      const u8 = new Uint8Array(buf);
      const parsed = parseTags(u8, r.ext);
      const url = urlFor(filePath);
      let duration = 0;
      if (url) duration = await probeDuration(url);
      const meta = {
        path: filePath,
        name: r.name,
        ext: r.ext,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        albumArtist: parsed.albumArtist,
        genre: parsed.genre,
        year: parsed.year,
        trackNo: parsed.trackNo,
        trackTotal: parsed.trackTotal,
        discNo: parsed.discNo,
        composer: parsed.composer,
        comment: parsed.comment,
        duration,
        bitrate: 0,
        sampleRate: 0,
        codec: parsed.codec,
        container: parsed.container,
        art: parsed.art,
        lyrics: parsed.lyrics
      };
      r.meta = meta;
      await idbPut(r);
      return meta;
    } catch (err) {
      console.error('[browser readTagsFor]', filePath, err);
      return null;
    }
  }

  // ------------------------------------------------------------ public API

  window.MusicAPI = {
    isDesktop: false,
    canWriteTags: function (track) {
      const ext = track && track.ext ? String(track.ext).toLowerCase() : '';
      // Matches the supported rewrites in writeTags: MP3, FLAC, OGG/Opus.
      return ext === 'mp3' || ext === 'flac' || ext === 'ogg' || ext === 'opus' || ext === 'oga';
    },

    appFileUrl: function (path) {
      return urlFor(path);
    },

    pathForUrl: function (url) {
      for (const p in urlCache) if (urlCache[p] === url) return p;
      return null;
    },

    getConfig: async function () {
      return loadConfig();
    },

    setConfig: async function (cfg) {
      try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {}
      return cfg;
    },

    saveSession: async function (session) {
      try { localStorage.setItem(SES_KEY, JSON.stringify(session)); } catch (_) {}
      return { ok: true };
    },

    pickFolders: function () {
      return pickFolders();
    },

    removeFolder: async function (folder) {
      const key = String(folder || '').toLowerCase();
      const doomed = Object.keys(rowsByPath).filter(p => String(rowsByPath[p].folder || '').toLowerCase() === key);
      for (const p of doomed) {
        if (urlCache[p]) { try { URL.revokeObjectURL(urlCache[p]); } catch (_) {} delete urlCache[p]; }
        delete rowsByPath[p];
        await idbDelete(p);
      }
      return { ok: true };
    },

    scan: async function (folders) {
      await openDB();
      await loadAllRows();
      await ensureServerSeed();
      const rescan = await refreshFromHandles(folders);
      const wanted = (folders || []).map(f => String(f).toLowerCase());
      const audio = [];
      const folderList = [];
      const counts = {};
      const seenFolders = {};
      for (const p in rowsByPath) {
        const r = rowsByPath[p];
        const f = String(r.folder || '');
        if (wanted.length && !wanted.includes(f.toLowerCase())) continue;
        if (!seenFolders[f]) { seenFolders[f] = true; folderList.push({ path: f, name: f.split(/[\\/]/).pop() || f, trackCount: 0 }); }
        counts[f] = (counts[f] || 0) + 1;
        audio.push({ path: r.path, folder: r.folder, rel: r.rel, name: r.name, ext: r.ext, size: r.size, mtimeMs: r.mtimeMs });
      }
      for (const fl of folderList) fl.trackCount = counts[fl.path] || 0;
      return { folders: folderList, audio, playlists: [], lrc: [], rescan }; 
    },

    readTags: function (filePath) {
      return readTagsFor(filePath);
    },

    writeTags: async function (filePath, patch) {
      const r = rowsByPath[filePath];
      if (!r) return { ok: false, reason: 'File not found in the browser library.' };
      const ext = (r.ext || '').toLowerCase();
      let newBlob = null;
      if (ext === 'mp3') newBlob = await rewriteMp3Tags(r.blob, patch);
      else if (ext === 'flac') newBlob = await rewriteFlacTags(r.blob, patch);
      else if (ext === 'ogg' || ext === 'opus' || ext === 'oga') newBlob = await rewriteOggTags(r.blob, patch);
      if (!newBlob) return { ok: false, reason: 'Failed to rewrite the audio tags.' };
      r.blob = newBlob;
      r.size = newBlob.size;
      r.meta = null;
      if (urlCache[filePath]) { try { URL.revokeObjectURL(urlCache[filePath]); } catch (_) {} delete urlCache[filePath]; }
      await idbPut(r);
      const fresh = await readTagsFor(filePath);
      return { ok: true, reason: 'Tags saved to the library copy.', tags: fresh };
    },

    readText: async function (filePath) {
      const r = rowsByPath[filePath];
      if (!r) return { ok: false };
      const t = r.meta ? (r.meta.lyrics && r.meta.lyrics.unsynced) : null;
      return { ok: !!t, text: t || '' };
    },

    writeText: async function () {
      return { ok: false, reason: 'Writing text files needs the desktop app.' };
    },

    savePlaylist: async function (defaultName, content) {
      try {
        const blob = new Blob([String(content || '')], { type: 'audio/x-mpegurl' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName || 'playlist.m3u8';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
        return { saved: true };
      } catch (_) {
        return { saved: false, reason: 'Could not trigger the download.' };
      }
    }
  };
})();
