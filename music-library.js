// Music Library module — runs in the Electron main process.
// Owns: config persistence (userData/music-library.json), folder scanning,
// metadata reading (music-metadata), tag writing (node-id3 + hand-rolled
// Vorbis/MP4 writers), and playlist/LRC file I/O. The renderer talks to this
// through the whitelisted MusicAPI bridge in preload.js.

const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- constants

const AUDIO_EXTS = new Set([
  'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'mp4', 'wav', 'wma',
  'aiff', 'aif', 'ape', 'wv', 'oga', 'm4b', 'amr', 'mka'
]);

const PLAYLIST_EXTS = new Set(['m3u', 'm3u8', 'pls', 'xspf']);
const LRC_EXTS = new Set(['lrc']);

const SKIP_DIR_NAMES = new Set([
  '.git', '.svn', '.hg', 'node_modules', '$recycle.bin',
  'system volume information', '.thumbnails', '.trash', '__macosx'
]);

const MAX_ART_BYTES = 4 * 1024 * 1024; // don't ship multi-MB embedded covers over IPC

let _mm = null;
function metadata() {
  if (!_mm) _mm = require('music-metadata');
  return _mm;
}

let _nid = null;
function nodeId3() {
  if (!_nid) _nid = require('node-id3');
  return _nid;
}

// ---------------------------------------------------------------- config store

function configPath() {
  return path.join(app.getPath('userData'), 'music-library.json');
}

let _config = null;

// Bundled demo folder ("Server Audio" in the browser path). In Electron it is
// the on-disk audio/ dir shipped with the app so users get real starter content
// in the Music tab without providing their own audio first.
function demoFolder() {
  return path.join(app.getAppPath(), 'audio');
}

function getConfig() {
  if (_config) return _config;
  try {
    _config = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) {
    _config = { folders: [], playlists: [], session: null, settings: {} };
  }
  const folders = Array.isArray(_config.folders) ? _config.folders : [];
  const demo = demoFolder();
  const seeded = !!( _config.settings && _config.settings.demoSeeded );
  // Seed the bundled audio/ demo folder exactly once. Afterwards the flag stays
  // set, so if the user removes the demo (or all) folders we never re-add it.
  if (!seeded) {
    const demoExists = (() => {
      try { return fs.statSync(demo).isDirectory(); } catch (_) { return false; }
    })();
    if (demoExists && !folders.some(f => String(f).toLowerCase() === demo.toLowerCase())) {
      folders.push(demo);
      _config.folders = folders;
    }
    _config.settings = Object.assign({}, _config.settings, { demoSeeded: true });
    saveConfig();
  }
  return _config;
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(_config, null, 2));
  } catch (err) {
    console.error('[Music] Failed to persist config:', err);
  }
}

function setConfig(cfg) {
  const clean = {
    folders: Array.isArray(cfg && cfg.folders) ? cfg.folders : [],
    playlists: Array.isArray(cfg && cfg.playlists) ? cfg.playlists : [],
    session: (cfg && cfg.session) || null,
    settings: (cfg && cfg.settings) || {}
  };
  _config = clean;
  saveConfig();
  return _config;
}

function saveSession(session) {
  _config = getConfig();
  _config.session = session || null;
  saveConfig();
  return _config.session;
}

// ---------------------------------------------------------------- folder picker

async function pickFolders(mainWindow) {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Music Folders',
    buttonLabel: 'Add to Library',
    properties: ['openDirectory', 'multiSelections'],
  });
  return res.canceled ? null : res.filePaths;
}

// ---------------------------------------------------------------- scanner

async function walkDir(dir, onFile, depth, maxDepth) {
  if (depth > (maxDepth == null ? 24 : maxDepth)) return;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      await walkDir(full, onFile, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      onFile(full, entry.name);
    }
  }
}

// Recursively collect audio / playlist / lrc files across all given folders.
async function scan(folders) {
  const audio = [];
  const playlists = [];
  const lrc = [];
  const folderList = [];
  const started = Date.now();

  for (const folder of folders) {
    let exists = false;
    try { exists = fs.statSync(folder).isDirectory(); } catch (_) { exists = false; }
    if (!exists) continue;

    const folderFiles = [];
    await walkDir(folder, (full, name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      const rel = path.relative(folder, full).split(path.sep).join('/');
      if (AUDIO_EXTS.has(ext)) {
        let size = 0, mtimeMs = 0;
        try {
          const st = fs.statSync(full);
          size = st.size;
          mtimeMs = Math.round(st.mtimeMs);
        } catch (_) {}
        folderFiles.push({
          folder, rel, path: full, name, ext,
          size, mtimeMs
        });
      } else if (PLAYLIST_EXTS.has(ext)) {
        playlists.push({ folder, rel, path: full, name, ext });
      } else if (LRC_EXTS.has(ext)) {
        lrc.push({ folder, rel, path: full, name });
      }
    }, 0);

    // Stable sort by relative path so library ordering is consistent.
    folderFiles.sort((a, b) => a.rel.localeCompare(b.rel));
    audio.push(...folderFiles);
    folderList.push({ path: folder, name: path.basename(folder) || folder, trackCount: folderFiles.length });
  }

  return {
    folders: folderList,
    audio,
    playlists,
    lrc,
    stats: {
      audioCount: audio.length,
      playlistCount: playlists.length,
      lrcCount: lrc.length,
      folderCount: folderList.length,
      elapsedMs: Date.now() - started
    }
  };
}

// ---------------------------------------------------------------- metadata reading

function pickString(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const s = v.map(pickString).filter(Boolean);
    return s.length ? s.join('; ') : null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  if (v && typeof v === 'object' && 'text' in v) return pickString(v.text);
  return null;
}

function pickInt(v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'no' in v) return v.no || null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// Unsynced lyrics from music-metadata's common.lyrics (string, array, or object).
function extractUnsynced(common) {
  const raw = common && common.lyrics;
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (Array.isArray(raw)) {
    const parts = raw
      .map(x => (typeof x === 'string' ? x : (x && x.text) || null))
      .filter(Boolean);
    return parts.length ? parts.join('\n').trim() : null;
  }
  if (raw.text) return raw.text.trim() || null;
  return null;
}

// MP3 SYLT via node-id3; returns { synced: [{time, text}], format }.
function extractSyncedMp3(filePath) {
  try {
    const tags = nodeId3().read(filePath);
    const sync = tags && tags.syncedLyrics;
    if (!sync) return null;
    const arr = Array.isArray(sync) ? sync : [sync];
    for (const entry of arr) {
      if (entry && Array.isArray(entry.lyrics) && entry.lyrics.length) {
        return {
          lines: entry.lyrics
            .map(l => ({ time: Math.round((l.timeStamp || 0) / 1000), text: String(l.text || '').trim() }))
            .filter(l => l.text),
          format: 'SYLT'
        };
      }
    }
  } catch (_) {}
  return null;
}

// Full metadata for a single audio file. Never throws; returns null on failure.
async function readTags(filePath) {
  let meta;
  try {
    meta = await metadata().parseFile(filePath, { duration: true, skipCovers: false });
  } catch (err) {
    console.warn('[Music] readTags failed for', filePath, err.message);
    return null;
  }

  const common = meta.common || {};
  const format = meta.format || {};

  let art = null;
  const pic = (common.picture && common.picture[0]) || null;
  if (pic && pic.data && pic.data.length && pic.data.length <= MAX_ART_BYTES) {
    let mime = pic.format || 'image/jpeg';
    if (mime === '-->') mime = 'image/jpeg';
    art = {
      mime,
      base64: Buffer.from(pic.data).toString('base64')
    };
  }

  let lyrics = null;
  let unsynced = extractUnsynced(common);
  if (!unsynced && meta.native && meta.native.vorbis) {
    // Fallback for FLAC/OGG: this music-metadata parses the LYRICS comment as
    // *timestamped* text, so plain unsynced lyrics (the ecosystem standard) land
    // in a near-empty syncText object instead of common.lyrics. Read the raw
    // Vorbis comment value directly so self-written lyrics round-trip.
    for (const tag of meta.native.vorbis) {
      const id = String(tag.id || '').toUpperCase();
      if ((id === 'UNSYNCEDLYRICS' || id === 'LYRICS') && typeof tag.value === 'string' && tag.value.trim()) {
        unsynced = tag.value.trim();
        break;
      }
    }
  }
  const synced = path.extname(filePath).toLowerCase() === '.mp3' ? extractSyncedMp3(filePath) : null;
  if (synced || unsynced) {
    lyrics = { unsynced, synced: synced ? synced.lines : null, format: synced ? synced.format : 'USLT' };
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).slice(1).toLowerCase(),
    title: pickString(common.title),
    artist: pickString(common.artist),
    album: pickString(common.album),
    albumArtist: pickString(common.albumartist),
    genre: pickString(common.genre),
    year: pickInt(common.year) || null,
    trackNo: pickInt(common.track),
    trackTotal: (common.track && common.track.no == null ? null : (common.track && common.track.of) || null),
    discNo: pickInt(common.disk),
    composer: pickString(common.composer),
    comment: pickString(common.comment),
    duration: format.duration || 0,
    bitrate: format.bitrate || 0,
    sampleRate: format.sampleRate || 0,
    codec: format.codec || null,
    container: format.container || null,
    art,
    lyrics
  };
}

// ---------------------------------------------------------------- tag writing

// Map our normalized patch onto node-id3's tag shape and write in place.
function writeTagsMp3(filePath, patch) {
  const tags = {};
  if (patch.title != null) tags.title = patch.title;
  if (patch.artist != null) tags.artist = patch.artist;
  if (patch.album != null) tags.album = patch.album;
  if (patch.albumArtist != null) tags.albumArtist = patch.albumArtist;
  if (patch.genre != null) tags.genre = patch.genre;
  if (patch.year != null) tags.year = String(patch.year);
  if (patch.trackNo != null) tags.trackNumber = patch.trackNo;
  if (patch.discNo != null) tags.discNumber = patch.discNo;
  if (patch.composer != null) tags.composer = patch.composer;
  if (patch.comment != null) tags.comment = { language: 'eng', text: patch.comment };
  if (patch.picture != null) {
    tags.picture = {
      mime: patch.picture.mime || 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBase64: patch.picture.base64
    };
  }
  if (patch.removePicture) tags.picture = undefined;
  if (patch.lyrics != null) {
    tags.lyrics = [{ language: 'eng', descriptor: '', text: patch.lyrics || '' }];
  }
  if (patch.syncedLyrics != null && Array.isArray(patch.syncedLyrics)) {
    tags.syncedLyrics = [{
      language: 'eng',
      timestampFormat: 2,
      contentType: 1,
      descriptor: '',
      lyrics: patch.syncedLyrics.map(l => ({ timeStamp: Math.round((l.time || 0) * 1000), text: l.text }))
    }];
  }
  if (patch.removeSyncedLyrics) tags.syncedLyrics = undefined;

  try {
    const ok = nodeId3().write(tags, filePath);
    if (ok) return { ok: true };
    return { ok: false, reason: 'node-id3 reported a write failure.' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------------------------------------------------------------- FLAC / Vorbis writing
// Hand-rolled in-place FLAC tag writer (VORBIS_COMMENT + PICTURE metadata blocks).
// FLAC layout: "fLaC" then a chain of 4-byte-header metadata blocks (1 flag byte,
// 3-byte big-endian length), then the audio frames. Editing only touches the
// metadata chain; the audio payload is copied through untouched.

function parseVorbisCommentData(data) {
  let off = 0;
  if (data.length < 8) throw new Error('comment block too short');
  const vendorLen = data.readUInt32LE(off); off += 4;
  const vendor = data.slice(off, off + vendorLen).toString('utf8'); off += vendorLen;
  const count = data.readUInt32LE(off); off += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (off + 4 > data.length) throw new Error('comment list truncated');
    const len = data.readUInt32LE(off); off += 4;
    const line = data.slice(off, off + len).toString('utf8'); off += len;
    const eq = line.indexOf('=');
    if (eq > 0) entries.push({ key: line.slice(0, eq), value: line.slice(eq + 1) });
  }
  return { vendor, entries };
}

function buildVorbisCommentData(entries, vendor) {
  const vendorBuf = Buffer.from(vendor, 'utf8');
  const parts = [];
  const h = Buffer.alloc(4);
  h.writeUInt32LE(vendorBuf.length, 0);
  parts.push(h, vendorBuf);
  const cnt = Buffer.alloc(4);
  cnt.writeUInt32LE(entries.length, 0);
  parts.push(cnt);
  for (const line of entries) {
    const raw = Buffer.from(line, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(raw.length, 0);
    parts.push(len, raw);
  }
  return Buffer.concat(parts);
}

function buildVorbisPictureData(picture) {
  const mime = Buffer.from(String(picture.mime || 'image/jpeg'), 'ascii');
  const raw = Buffer.from(String(picture.base64 || ''), 'base64');
  const desc = Buffer.from('Cover', 'utf8');
  const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };
  return Buffer.concat([
    u32be(3),                // picture type: front cover
    u32be(mime.length), mime,
    u32be(desc.length), desc,
    u32be(0), u32be(0),      // width/height unknown (0 = unset per spec)
    u32be(0), u32be(0),      // depth / indexed-colors
    u32be(raw.length), raw
  ]);
}

function writeTagsVorbis(filePath, patch) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'fLaC') {
      return { ok: false, reason: 'Only FLAC files are supported by the in-place writer (OGG/Opus not yet).' };
    }

    // Parse the metadata block chain.
    let off = 4;
    const blocks = [];
    let last = false;
    while (!last && off + 4 <= buf.length) {
      const flagByte = buf[off];
      const type = flagByte & 0x7f;
      const len = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
      last = !!(flagByte & 0x80);
      if (off + 4 + len > buf.length) throw new Error('Truncated FLAC metadata block.');
      blocks.push({ type, data: buf.slice(off + 4, off + 4 + len) });
      off += 4 + len;
    }
    const audioStart = off;

    // Gather existing comments + vendor string.
    let vendor = 'IEM Tool';
    const comments = [];
    for (const b of blocks) {
      if (b.type === 4) {
        try {
          const parsed = parseVorbisCommentData(b.data);
          if (parsed.vendor) vendor = parsed.vendor;
          comments.push(...parsed.entries);
        } catch (_) { /* keep going */ }
      }
    }

    const dropKey = (k) => {
      const upper = String(k).toUpperCase();
      for (let i = comments.length - 1; i >= 0; i--) {
        if (String(comments[i].key).toUpperCase() === upper) comments.splice(i, 1);
      }
    };
    const setComment = (key, value) => {
      if (value == null) return;
      dropKey(key);
      const sv = String(value).trim();
      if (!sv) return;
      comments.push({ key: String(key).toUpperCase(), value: sv });
    };

    if (patch.title != null) setComment('TITLE', patch.title);
    if (patch.artist != null) setComment('ARTIST', patch.artist);
    if (patch.album != null) setComment('ALBUM', patch.album);
    if (patch.albumArtist != null) setComment('ALBUMARTIST', patch.albumArtist);
    if (patch.genre != null) setComment('GENRE', patch.genre);
    if (patch.year != null) setComment('DATE', patch.year);
    if (patch.trackNo != null) setComment('TRACKNUMBER', patch.trackNo);
    if (patch.trackTotal != null) setComment('TRACKTOTAL', patch.trackTotal);
    if (patch.discNo != null) setComment('DISCNUMBER', patch.discNo);
    if (patch.composer != null) setComment('COMPOSER', patch.composer);
    if (patch.comment != null) setComment('COMMENT', patch.comment);
    if (patch.lyrics != null) setComment('LYRICS', patch.lyrics);

    const commentData = buildVorbisCommentData(
      comments.map(c => c.key + '=' + c.value), vendor);
    const wantsRemovePicture = !!patch.removePicture;
    let pictureData = null;
    if (patch.picture != null) pictureData = buildVorbisPictureData(patch.picture);

    // Rebuild the chain: keep every block except PADDING / VORBIS_COMMENT / PICTURE
    // (those are regenerated), then insert the new comment + picture blocks right
    // after STREAMINFO so they stay early in the file.
    const kept = blocks.filter(b => b.type !== 1 && b.type !== 4 && b.type !== 6);
    const streaminfo = kept.find(b => b.type === 0);
    if (!streaminfo) throw new Error('FLAC missing STREAMINFO block.');
    while (kept.length && kept[0].type !== 0) kept.shift();
    if (!kept.length) kept.push(streaminfo);

    const fresh = [];
    if (commentData.length) fresh.push({ type: 4, data: commentData });
    if (pictureData) fresh.push({ type: 6, data: pictureData });
    kept.splice(1, 0, ...fresh);

    const parts = [Buffer.from('fLaC', 'ascii')];
    for (let i = 0; i < kept.length; i++) {
      const b = kept[i];
      const hdr = Buffer.alloc(4);
      hdr[0] = (i === kept.length - 1 ? 0x80 : 0x00) | (b.type & 0x7f);
      hdr.writeUIntBE(b.data.length, 1, 3);
      parts.push(hdr, b.data);
    }
    parts.push(buf.slice(audioStart));

    fs.writeFileSync(filePath, Buffer.concat(parts));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// MP4 ilst writer for M4A/MP4/AAC (Phase 5 implements this fully).
function writeTagsMp4(filePath, patch) {
  return { ok: false, reason: 'M4A/MP4 tag writing is coming in the next phase.' };
}

async function writeTags(filePath, patch) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') {
    const res = writeTagsMp3(filePath, patch);
    if (res.ok) {
      const fresh = await readTags(filePath);
      return { ok: true, tags: fresh };
    }
    return res;
  }
  if (ext === '.flac' || ext === '.ogg' || ext === '.opus' || ext === '.oga') {
    const res = writeTagsVorbis(filePath, patch);
    if (res.ok) {
      const fresh = await readTags(filePath);
      return { ok: true, tags: fresh };
    }
    return res;
  }
  if (ext === '.m4a' || ext === '.mp4' || ext === '.aac' || ext === '.m4b') {
    return writeTagsMp4(filePath, patch);
  }
  return { ok: false, reason: `Tag writing is not supported for ${ext || 'this'} files.` };
}

// ---------------------------------------------------------------- text / playlist I/O

function readText(filePath) {
  try {
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function writeText(filePath, content) {
  try {
    fs.writeFileSync(filePath, String(content == null ? '' : content), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function savePlaylist(mainWindow, defaultName, content) {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Playlist',
    defaultPath: defaultName || 'playlist.m3u8',
    filters: [
      { name: 'Playlist', extensions: ['m3u8', 'm3u', 'pls', 'xspf'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePath) return { saved: false };
  return writeText(res.filePath, content).ok
    ? { saved: true, path: res.filePath }
    : { saved: false, reason: 'Failed to write the playlist file.' };
}

module.exports = {
  getConfig,
  setConfig,
  saveSession,
  pickFolders,
  scan,
  readTags,
  writeTags,
  readText,
  writeText,
  savePlaylist
};
