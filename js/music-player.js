// ============================================================================
// MusicPlayer — the app's unified global music engine + library front-end.
//
// Unification model: the existing EQ playlist player is the shared transport
// (audioEl = #eq-audio, routed through the EQ/WebAudio graph). The library
// "plays" by loading the selected tracks into EQ.playlist as app-file:// URLs
// and calling EQ.playPlaylistIndex(). That means EVERY existing footer button,
// shuffle/repeat, scrub, loudness match, modal and visualizer keeps working,
// and this module adds the library-specific chrome on top (album art, marquee
// title/artist, lyrics, tag editor, playlist manager, grid/list views).
// ============================================================================

const BATCH_FIELD_IDS = {
  title: 'batch-title',
  artist: 'batch-artist',
  album: 'batch-album',
  albumArtist: 'batch-albumartist',
  genre: 'batch-genre',
  year: 'batch-year',
  trackNo: 'batch-track',
  trackTotal: 'batch-tracktotal',
  discNo: 'batch-disc',
  composer: 'batch-composer',
  comment: 'batch-comment',
  lyrics: 'batch-lyrics',
  syncedLyrics: 'batch-synced'
};

const MusicPlayer = {

  // ------------------------------------------------------------ state
  config: { folders: [], playlists: [], session: null, settings: {} },
  folders: [],
  db: null,
  dbReady: false,

  view: 'list',          // track list view (grid removed)
  leftSel: 'all',        // all | artists | albums | genres | favorites | recent | playlist:<id> | folder:<id>
  selArtist: null,       // drill-down context (artist name)
  selAlbum: null,        // drill-down context (album key)
  selGenre: null,        // drill-down context (genre name)
  rightMode: 'now',      // now | queue
  favorites: [],         // track paths (persisted in config)
  recent: [],            // [{path, at}] most-recent-first, capped 50
  mobileRegion: 'left',  // left | center | right (mobile focus region)
  _clickSource: [],
  _playlistCtxId: null,
  _undoStack: [],        // [{ label, items: [{path,folder,rel,name,ext,size,...tags}] }] for tag-edit undo
  search: '',
  sortKey: 'title',      // title | artist | album | trackNo | duration | genre | year
  sortDir: 1,
  filterGenre: 'all',
  _lyricFollow: true,    // auto-follow/center the active synced lyric line
  _lyricUserScroll: false, // true while the user manually scrolled the lyrics pane
  _nowLyricsOpen: false,   // Now Playing tab: true = Lyrics pane shown in place of Up Next
  _nowLyricsSynced: false, // Now Playing lyrics pane holds synced (timestamped) lyrics
  _lyricRowEls: null,      // cached .lyric-line[data-time] NodeList for _tickLyrics
  _lyricCache: {},         // path -> normalized lyrics result (avoids re-reading .lrc)
  paneLeftW: null,         // persisted resizable sidebar width (px)
  paneRightW: null,        // persisted resizable now-playing width (px)
  _selPaths: [],           // multi-selected track paths in the current center view
  _selAnchor: -1,          // shift-click range anchor (index into _clickSource)

  // Explorer-style sort columns: order is user-reorderable, widths are
  // user-resizable and both persist in config.cols.
  _COLUMNS: {
    no:     { label: '#', w: 30, sortKey: 'trackNo', align: 'center' },
    title:  { label: 'Title', w: 240, flex: true, sortKey: 'title' },
    artist: { label: 'Artist', w: 150, sortKey: 'artist' },
    album:  { label: 'Album', w: 170, sortKey: 'album' },
    genre:  { label: 'Genre', w: 100, sortKey: 'genre' },
    year:   { label: 'Year', w: 76, sortKey: 'year', align: 'right' },
    time:   { label: 'Time', w: 72, sortKey: 'duration', align: 'right' }
  },
  colOrder: ['no', 'title', 'artist', 'album', 'genre', 'year', 'time'],
  colWidths: {},
  colHidden: {},   // key -> true for columns the user has hidden

  tracks: [],            // full library cache (from IndexedDB), kept in memory
  playlists: [],         // user-created playlists  [{id,name,trackPaths:[],created}]
  detectedPlaylists: [], // .m3u/.pls/.xspf files found on disk
  lrcIndex: {},          // path -> lrc file path (attached during scan)

  scanning: false,
  scanProgress: { done: 0, total: 0, label: '' },

  currentQueue: [],      // track records currently loaded into the EQ engine
  currentIndex: -1,
  lastSrc: '',

  lyricState: { open: false, track: null, synced: false, lines: [], loading: false },
  _sessionTimer: null,
  _renderRAF: null,

  // ================================================================== init
  init: async function() {
    if (!window.MusicAPI) {
      console.warn('[Music] MusicAPI bridge missing — running in a plain browser; library is disabled.');
      return;
    }
    try {
      this.config = await window.MusicAPI.getConfig() || this.config;
    } catch (e) { console.error('[Music] getConfig failed:', e); }

    this.favorites = Array.isArray(this.config.favorites) ? this.config.favorites : [];
    this.recent = Array.isArray(this.config.recent) ? this.config.recent : [];

    if (typeof this.config.sortKey === 'string' && ['title','artist','album','trackNo','duration','genre','year'].includes(this.config.sortKey)) this.sortKey = this.config.sortKey;
    if (this.config.sortDir === 1 || this.config.sortDir === -1) this.sortDir = this.config.sortDir;

    const cols = this.config.cols;
    if (cols && Array.isArray(cols.order) && cols.order.length) {
      const valid = cols.order.filter(k => this._COLUMNS[k]);
      Object.keys(this._COLUMNS).forEach(k => { if (!valid.includes(k)) valid.push(k); });
      if (valid.length) { this.colOrder = valid; this.colWidths = cols.widths && typeof cols.widths === 'object' ? cols.widths : {}; }
      if (cols.hidden && typeof cols.hidden === 'object') {
        Object.keys(this._COLUMNS).forEach(k => { if (cols.hidden[k]) this.colHidden[k] = true; });
      }
    }

    const panes = this.config.panes;
    if (panes && typeof panes === 'object') {
      if (typeof panes.leftW === 'number') this.paneLeftW = panes.leftW;
      if (typeof panes.rightW === 'number') this.paneRightW = panes.rightW;
    }

    await this._openDB();
    await this._loadLibraryCache();

    this._bindFooter();
    this._bindMediaEvents();
    this._bindPane();
    this._applyPanePrefs();
    this._bindPaneResize();

    if (this.config.folders && this.config.folders.length) {
      await this.refreshLibrary({ quiet: true, auto: true });
    }

    let restored = false;
    if (this.config.session && this.config.session.queue && this.config.session.queue.length) {
      restored = await this._restoreSession(this.config.session);
    }
    if (!restored) {
      this._loadAllMusicQueue();
    }
  },

  // Fill the footer queue with the full library up front (sorted per the last
  // used sort) so the bottom bar always shows real content — art + first-track
  // highlight, NO autoplay. Used at boot when there is no stored session.
  _loadAllMusicQueue: function() {
    if (!window.EQ) return;
    const tracks = this._sorted(this.tracks);
    if (!tracks.length) return;
    if (EQ.playlist && EQ.playlist.length) return; // a queue is already loaded

    this.currentQueue = tracks;
    this.currentIndex = 0;

    EQ.playlist = tracks.map((t, i) => ({
      name: this._displayName(t),
      url: t.url || window.MusicAPI.appFileUrl(t.path),
      _musicIndex: i,
      _track: t
    }));
    EQ.playlistIndex = 0;

    this._updateNowPlaying(tracks[0]);
    this._highlightTrack(tracks[0].path);
    this._saveSessionDebounced();
  },

  // ------------------------------------------------------------ IndexedDB
  _openDB: function() {
    return new Promise((resolve) => {
      if (this.db) { resolve(); return; }
      const req = indexedDB.open('music_library', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = (e) => { this.db = e.target.result; this.dbReady = true; resolve(); };
      req.onerror = () => { console.error('[Music] IndexedDB failed to open.'); resolve(); };
    });
  },

  _dbTx: function(store, mode) {
    return this.db.transaction(store, mode || 'readonly').objectStore(store);
  },

  _dbGet: function(store, key) {
    return new Promise((resolve) => {
      if (!this.db) { resolve(null); return; }
      try {
        const r = this._dbTx(store).get(key);
        r.onsuccess = () => resolve(r.result ?? null);
        r.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  },

  _dbAll: function(store) {
    return new Promise((resolve) => {
      if (!this.db) { resolve([]); return; }
      try {
        const r = this._dbTx(store).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
  },

  _dbPutMany: function(store, values) {
    return new Promise((resolve) => {
      if (!this.db || !values || !values.length) { resolve(); return; }
      try {
        const tx = this.db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const v of values) os.put(v);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch (_) { resolve(); }
    });
  },
  _dbDeleteMany: function(store, keys) {
    return new Promise((resolve) => {
      if (!this.db || !keys || !keys.length) { resolve(); return; }
      try {
        const tx = this.db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const k of keys) os.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch (_) { resolve(); }
    });
  },
  _dbPut: function(store, value) {
    return new Promise((resolve) => {
      if (!this.db) { resolve(); return; }
      try {
        const r = this._dbTx(store, 'readwrite').put(value);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  },

  _dbDelete: function(store, key) {
    return new Promise((resolve) => {
      if (!this.db) { resolve(); return; }
      try {
        const r = this._dbTx(store, 'readwrite').delete(key);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  },

  _dbClear: function(store) {
    return new Promise((resolve) => {
      if (!this.db) { resolve(); return; }
      try {
        const r = this._dbTx(store, 'readwrite').clear();
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();
      } catch (_) { resolve(); }
    });
  },

  _getMeta: function(k) { return this._dbGet('meta', k); },
  _setMeta: function(k, v) { return this._dbPut('meta', { k, v }); },

  _loadLibraryCache: async function() {
    this.tracks = await this._dbAll('tracks');
    this.playlists = (await this._getMeta('playlists_created')) || [];
    this.detectedPlaylists = (await this._getMeta('playlists_detected')) || [];
    this.lrcIndex = (await this._getMeta('lrc_index')) || {};
  },

  // ================================================================== scan
  refreshLibrary: async function(opts) {
    opts = opts || {};
    if (this.scanning) return;
    if (!this.config.folders || !this.config.folders.length) {
      this.render();
      return;
    }
    if (!window.MusicAPI) { this.render(); return; }
    this.scanning = true;
    this._showScanOverlay('Scanning folders…', '');

    try {
      const res = await window.MusicAPI.scan(this.config.folders);
      if (!res || !res.audio) {
        this._hideScanOverlay();
        this.scanning = false;
        this.render();
        return;
      }

      this.folders = res.folders || [];
      await this._setMeta('folders', this.folders);

      const trackIdx = new Map(this.tracks.map((t, i) => [t.path, i]));

      // --- playlists + lrc sidecars from this scan ---
      this.detectedPlaylists = (res.playlists || []).map((p, i) => ({ ...p, id: 'dp_' + i }));
      await this._setMeta('playlists_detected', this.detectedPlaylists);

      const lrcByKey = {};
      for (const l of (res.lrc || [])) {
        const base = l.name.replace(/\.lrc$/i, '').toLowerCase();
        lrcByKey[l.folder.toLowerCase() + '::' + base] = l.path;
      }
      this.lrcIndex = lrcByKey;
      await this._setMeta('lrc_index', this.lrcIndex);

      // --- diff: parse only new/changed ---
      const toParse = [];
      const livePaths = new Set();
      for (const f of res.audio) {
        livePaths.add(f.path);
        const prev = trackIdx.has(f.path) ? this.tracks[trackIdx.get(f.path)] : null;
        if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) {
          if (prev.lrcPath == null) {
            const base = f.name.replace(/\.[^.]+$/i, '').toLowerCase();
            const lp = lrcByKey[f.folder.toLowerCase() + '::' + base];
            if (lp && !prev.lrcPath) { prev.lrcPath = lp; await this._dbPut('tracks', prev); }
          }
          continue;
        }
        toParse.push(f);
      }

      // delete tracks no longer present
      const removed = this.tracks.filter(t => !livePaths.has(t.path));
      await this._dbDeleteMany('tracks', removed.map(r => r.path));
      if (removed.length) {
        this.tracks = this.tracks.filter(t => livePaths.has(t.path));
      }

      if (toParse.length) {
        const total = toParse.length;
        let done = 0;
        const CONCURRENCY = 4;
        const pending = [];
        let flushing = Promise.resolve();
        const flushPending = () => {
          flushing = flushing.then(async () => {
            while (pending.length) {
              await this._dbPutMany('tracks', pending.splice(0, 20));
            }
          });
          return flushing;
        };
        const queue = [...toParse];
        const workers = Array.from({ length: CONCURRENCY }, async () => {
          while (queue.length) {
            const f = queue.shift();
            const tag = await window.MusicAPI.readTags(f.path, { skipSynced: true });
            done++;
            if (done % 4 === 0 || done === total) {
              this.scanProgress = { done, total, label: `Reading tags ${done}/${total}` };
              this._updateScanOverlay();
            }
            const rec = this._mergeScanRecord(f, tag);
            pending.push(rec);
            if (pending.length >= 20) await flushPending();
            const idx = trackIdx.get(rec.path);
            if (idx != null) this.tracks[idx] = rec; else { this.tracks.push(rec); trackIdx.set(rec.path, this.tracks.length - 1); }
          }
        });
        await Promise.all(workers);
        await flushPending();
      }

      this._hideScanOverlay();
      this.scanning = false;
      this._plIdx = null;
      this._lyricCache = {};
      this._lyricRowEls = null;
      const n = this.tracks.length;
      this.render();
      // Browser: folders that couldn't be re-read on this scan (webkitdirectory
      // imports, lapsed permissions, or no File System Access API) need the user
      // to re-add them so new files show up. Skip silently for Electron, which
      // rescans real folders every time (res.rescan is undefined there).
      if (res.rescan && res.rescan.skipped && res.rescan.skipped.length) {
        const blocked = res.rescan.skipped.slice(0, 3).map(s => s.folder).join(', ');
        const more = res.rescan.skipped.length > 3 ? ' and ' + (res.rescan.skipped.length - 3) + ' more' : '';
        this._toast('Re-add folder(s) to see new files: ' + blocked + more, '📁');
      }
      if (opts.quiet) {
        this._toast(`Music library ready — ${n} track${n === 1 ? '' : 's'}.`, '🎵');
      }
    } catch (e) {
      console.error('[Music] scan failed:', e);
      this._hideScanOverlay();
      this.scanning = false;
      this._toast('Music scan failed. See console.', '⚠️');
    }
  },

  _mergeScanRecord: function(f, tag) {
    const base = f.name.replace(/\.[^.]+$/i, '').toLowerCase();
    return {
      path: f.path,
      folder: f.folder,
      rel: f.rel,
      name: f.name,
      ext: f.ext,
      size: f.size,
      mtimeMs: f.mtimeMs,
      title: (tag && tag.title) || null,
      artist: (tag && tag.artist) || null,
      album: (tag && tag.album) || null,
      albumArtist: (tag && tag.albumArtist) || null,
      genre: (tag && tag.genre) || null,
      year: (tag && tag.year) || null,
      trackNo: (tag && tag.trackNo) || null,
      trackTotal: (tag && tag.trackTotal) || null,
      discNo: (tag && tag.discNo) || null,
      composer: (tag && tag.composer) || null,
      comment: (tag && tag.comment) || null,
      duration: (tag && tag.duration) || 0,
      bitrate: (tag && tag.bitrate) || 0,
      sampleRate: (tag && tag.sampleRate) || 0,
      codec: (tag && tag.codec) || null,
      container: (tag && tag.container) || null,
      art: (tag && tag.art) || null,
      lyrics: (tag && tag.lyrics) || null,
      url: (tag && tag.url) || null,
      lrcPath: this.lrcIndex[f.folder.toLowerCase() + '::' + base] || null,
      scannedAt: Date.now()
    };
  },

  addFolders: async function() {
    if (!window.MusicAPI) { this._toast('The folder picker needs the desktop app.', '📁'); return; }
    const picked = await window.MusicAPI.pickFolders();
    if (!picked || !picked.length) return;
    const existing = new Set((this.config.folders || []).map(f => f.toLowerCase()));
    for (const p of picked) {
      if (!existing.has(p.toLowerCase())) this.config.folders.push(p);
    }
    await this._saveConfig();
    this.refreshLibrary({});
  },

  removeFolder: async function(folder) {
    this.config.folders = (this.config.folders || []).filter(f => f.toLowerCase() !== folder.toLowerCase());
    await this._saveConfig();
    if (window.MusicAPI && typeof window.MusicAPI.removeFolder === 'function') {
      try { await window.MusicAPI.removeFolder(folder); } catch (_) {}
    }
    // drop those tracks from the DB
    const doomed = this.tracks.filter(t => t.folder && t.folder.toLowerCase() === folder.toLowerCase());
    for (const d of doomed) await this._dbDelete('tracks', d.path);
    this.tracks = this.tracks.filter(t => !doomed.some(d => d.path === t.path));
    // Full removal: also drop the folder's tracks from the running queue / footer.
    if (doomed.length) this._dropFromQueue(doomed);
    if (this.leftSel === 'folder:' + folder) this.setLeft('all');
    else this.render();
    this._toast('Folder removed from library.', '🗂️');
  },

  // Remove tracks from the live EQ queue + footer now-playing when their folder
  // is dropped. If the queue empties, the bottom bar goes blank (no demo ghosts).
  _dropFromQueue: function(removedTracks) {
    if (!window.EQ || !this.currentQueue || !this.currentQueue.length) return;
    const removed = new Set(removedTracks.map(t => t.path));
    const kept = this.currentQueue.filter(t => !removed.has(t.path));

    // Rebuild EQ.playlist around whatever still exists.
    EQ.playlist = kept.map((t, i) => ({
      name: this._displayName(t),
      url: t.url || window.MusicAPI.appFileUrl(t.path),
      _musicIndex: i,
      _track: t
    }));

    if (!kept.length) {
      this.currentQueue = [];
      this.currentIndex = -1;
      EQ.playlistIndex = -1;
      this._clearNowPlaying();
      return;
    }

    this.currentQueue = kept;
    const playingSrc = EQ.audioEl && (EQ.audioEl.currentSrc || EQ.audioEl.src || '');
    const playingPath = this._trackForSrc(playingSrc);
    if (playingPath && removed.has(playingPath.path)) {
      // The removed track is what was loaded — fall back to the first kept one,
      // no autoplay.
      this.currentIndex = 0;
      EQ.playlistIndex = 0;
      this._updateNowPlaying(kept[0]);
      this._highlightTrack(kept[0].path);
    } else {
      this.currentIndex = Math.min(this.currentIndex, kept.length - 1);
    }
    this._saveSessionDebounced();
  },

  clearLibrary: async function() {
    await this._dbClear('tracks');
    await this._setMeta('playlists_detected', []);
    await this._setMeta('lrc_index', {});
    this.tracks = [];
    this.detectedPlaylists = [];
    this.lrcIndex = {};
    this._lyricCache = {};
    this._lyricRowEls = null;
    this.render();
    this._toast('Music library cleared.', '🧹');
  },

  _saveConfig: async function() {
    this.config.favorites = this.favorites;
    this.config.recent = this.recent;
    this.config.sortKey = this.sortKey;
    this.config.sortDir = this.sortDir;
    this.config.cols = { order: this.colOrder.slice(), widths: Object.assign({}, this.colWidths), hidden: Object.assign({}, this.colHidden) };
    this.config.panes = { leftW: this.paneLeftW, rightW: this.paneRightW };
    if (window.MusicAPI) {
      this.config = await window.MusicAPI.setConfig(this.config);
    }
  },

  // Debounced persistence for high-frequency toggles (favorites, recent). Avoids
  // a config disk write on every track change / star click.
  _saveConfigDebounced: function() {
    if (this._cfgTimer) clearTimeout(this._cfgTimer);
    this._cfgTimer = setTimeout(() => { this._cfgTimer = null; this._saveConfig(); }, 600);
  },

  // ==================================================== filtering / sorting
  get filteredTracks() {
    let list = this.tracks;
    if (this.search.trim()) {
      const q = this.search.trim().toLowerCase();
      list = list.filter(t =>
        String(t.title || '').toLowerCase().includes(q) ||
        String(t.artist || '').toLowerCase().includes(q) ||
        String(t.album || '').toLowerCase().includes(q) ||
        String(t.genre || '').toLowerCase().includes(q) ||
        String(t.name || '').toLowerCase().includes(q)
      );
    }
    if (this.filterGenre !== 'all' && this.filterGenre) {
      list = list.filter(t => String(t.genre || '').toLowerCase() === this.filterGenre.toLowerCase());
    }
    const key = this.sortKey;
    const dir = this.sortDir;
    list = [...list].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'trackNo') { va = va == null ? Infinity : va; vb = vb == null ? Infinity : vb; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  },

  get genres() {
    const s = new Set();
    for (const t of this.tracks) if (t.genre) s.add(String(t.genre));
    return [...s].sort((a, b) => a.localeCompare(b));
  },

  // ==================================================== playback (unified)
  playTracks: function(trackList, index) {
    if (!trackList || !trackList.length) return;
    if (!window.EQ) return;
    this.currentQueue = trackList;
    this.currentIndex = Math.max(0, Math.min(index == null ? 0 : index, trackList.length - 1));

    EQ.playlist = trackList.map((t, i) => ({
      name: this._displayName(t),
      url: t.url || window.MusicAPI.appFileUrl(t.path),
      _musicIndex: i,
      _track: t
    }));

    // Make sure the DSP graph is warm so the first track has no click/pop.
    const ctx = window.SharedAudio && SharedAudio.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();

    EQ.playPlaylistIndex(this.currentIndex);
    this._saveSessionDebounced();
  },

  playTrack: function(track) {
    const list = this.filteredTracks;
    const idx = list.findIndex(t => t.path === track.path);
    this.playTracks(list, idx >= 0 ? idx : 0);
  },

  togglePlay: function() { if (window.EQ) EQ.togglePlayState(); },
  next: function() { if (window.EQ) EQ.nextTrack(); },
  prev: function() { if (window.EQ) EQ.prevTrack(); },
  seek: function(t) {
    if (window.EQ && EQ.audioEl) {
      EQ.performCleanSeek ? EQ.performCleanSeek(t, (t / (EQ.audioEl.duration || 1)) * 100) : (EQ.audioEl.currentTime = t);
    }
  },

  // Detect which library track is now loaded on the shared audio element and
  // keep the global now-playing chrome (art / title / artist / lyrics) in sync.
  _onMediaChanged: function() {
    if (!window.EQ || !EQ.audioEl) return;
    const src = EQ.audioEl.currentSrc || EQ.audioEl.src || '';
    if (src === this.lastSrc) return;
    this.lastSrc = src;

    const track = this._trackForSrc(src);
    if (track) {
      this.currentIndex = EQ.playlistIndex >= 0 ? EQ.playlistIndex : this.currentIndex;
      this._nowLyricsOpen = false;
      this._updateNowPlaying(track);
      this._loadLyrics(track);
      this._noteRecent(track.path);
      this.renderRight();
      return;
    }
    this._clearNowPlaying();
  },

  _updateNowPlaying: function(track) {
    const el = (id) => document.getElementById(id);
    const setArt = (art) => {
      if (!art) return;
      if (track.art) {
        art.src = 'data:' + track.art.mime + ';base64,' + track.art.base64;
        art.style.background = '';
        art.style.opacity = '1';
      } else {
        art.removeAttribute('src');
        const g = this._coverGradient(track);
        art.style.background = 'linear-gradient(135deg,' + g[0] + ',' + g[1] + ')';
        art.style.opacity = '1';
      }
    };
    setArt(el('music-now-art'));
    setArt(el('music-now-art-mobile'));
    const titleEl = el('music-now-title');
    const titleM = el('music-now-title-mobile');
    const title = track.title || track.name.replace(/\.[^.]+$/, '');
    if (titleEl) titleEl.textContent = title;
    if (titleM) titleM.textContent = title;
    if (titleEl && titleEl.parentElement) this._marquee(titleEl);
    if (titleM && titleM.parentElement) this._marquee(titleM);

    // hide the legacy EQ text, show the library now-playing block
    this._setLibraryNowPlaying(true);

    // highlight the row in the visible view
    this._highlightTrack(track.path);

    const goBtn = el('mobile-music-go-btn');
    if (goBtn) goBtn.style.display = '';
  },

  _clearNowPlaying: function() {
    const el = (id) => document.getElementById(id);
    const art = el('music-now-art');
    if (art) { art.removeAttribute('src'); art.style.background = ''; }
    const artM = el('music-now-art-mobile');
    if (artM) { artM.removeAttribute('src'); artM.style.background = ''; }
    this._setLibraryNowPlaying(false);
    const goBtn = el('mobile-music-go-btn');
    if (goBtn) goBtn.style.display = 'none';
    this._highlightTrack(null);
    this._nowLyricsOpen = false;
  },

  _setLibraryNowPlaying: function(on) {
    const art = document.getElementById('music-now-art');
    const info = document.getElementById('music-now-info');
    const legacy = document.getElementById('music-now-legacy');
    if (art) art.style.display = on ? 'block' : 'none';
    if (info) info.style.display = on ? 'flex' : 'none';
    if (legacy) legacy.style.display = on ? 'none' : 'flex';
    const artM = document.getElementById('music-now-art-mobile');
    const infoM = document.getElementById('music-now-info-mobile');
    const legacyM = document.getElementById('music-now-legacy-mobile');
    if (artM) artM.style.display = on ? 'block' : 'none';
    if (infoM) infoM.style.display = on ? 'flex' : 'none';
    if (legacyM) legacyM.style.display = on ? 'none' : 'flex';
  },

  _highlightTrack: function(path) {
    const root = document.getElementById('music-center-body');
    if (!root) return;
    const prev = root.querySelector('.music-row-playing');
    if (prev) prev.classList.remove('music-row-playing');
    if (path) {
      const row = Array.from(root.querySelectorAll('.music-row, .music-card')).find(el => el.dataset && el.dataset.path === path);
      if (row) {
        row.classList.add('music-row-playing');
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      }
    }
  },

  // ==================================================== session persistence
  _saveSessionDebounced: function() {
    clearTimeout(this._sessionTimer);
    this._sessionTimer = setTimeout(() => this._saveSessionNow(), 1200);
  },

  _saveSessionNow: function() {
    if (!window.EQ || !EQ.audioEl || !this.currentQueue.length) return;
    window.MusicAPI.saveSession({
      queue: this.currentQueue.map(t => t.path),
      index: EQ.playlistIndex >= 0 ? EQ.playlistIndex : this.currentIndex,
      time: EQ.audioEl.currentTime || 0,
      savedAt: Date.now()
    });
  },

  _restoreSession: async function(session) {
    if (!session || !session.queue || !session.queue.length) return false;
    const byPath = {};
    for (const t of this.tracks) byPath[t.path] = t;
    const tracks = session.queue.map(p => byPath[p]).filter(Boolean);
    if (!tracks.length) return false;
    this.currentQueue = tracks;
    const idx = Math.max(0, Math.min(session.index || 0, tracks.length - 1));
    this.currentIndex = idx;

    EQ.playlist = tracks.map((t, i) => ({
      name: this._displayName(t),
      url: window.MusicAPI.appFileUrl(t.path),
      _musicIndex: i,
      _track: t
    }));
    EQ.playlistIndex = idx;

    // Show now-playing chrome but don't autoplay (browser policy).
    this._updateNowPlaying(tracks[idx]);
    const banner = document.getElementById('music-resume-banner');
    if (banner) {
      banner.classList.remove('hidden');
      const label = document.getElementById('music-resume-label');
      if (label) label.textContent = `Resume "${this._displayName(tracks[idx])}" at ${this._fmtTime(session.time || 0)}`;
    }
    this._bindResumeButton(session);
    return true;
  },

  _bindResumeButton: function(session) {
    const btn = document.getElementById('music-resume-btn');
    const dismiss = document.getElementById('music-resume-dismiss');
    if (btn) {
      btn.onclick = () => {
        const el = EQ.audioEl;
        EQ.playPlaylistIndex(this.currentIndex);
        if (el && session.time) {
          setTimeout(() => { try { el.currentTime = session.time; } catch (_) {} }, 120);
        }
        this._saveSessionNow();
        const banner = document.getElementById('music-resume-banner');
        if (banner) banner.classList.add('hidden');
      };
    }
    if (dismiss) dismiss.onclick = () => {
      const banner = document.getElementById('music-resume-banner');
      if (banner) banner.classList.add('hidden');
    };
  },

  // ==================================================== media listeners
  _bindMediaEvents: function() {
    if (!window.EQ || !EQ.audioEl) return;
    const el = EQ.audioEl;

    const srcPoller = () => this._onMediaChanged();
    el.addEventListener('play', srcPoller);
    el.addEventListener('loadeddata', srcPoller);
    el.addEventListener('durationchange', srcPoller);

    // lyrics highlight + session scrub tracking
    el.addEventListener('timeupdate', () => {
      this._onMediaChanged();
      this._tickLyrics(el.currentTime);
      if (this._sessionTimer) clearTimeout(this._sessionTimer);
      this._sessionTimer = setTimeout(() => this._saveSessionNow(), 3000);
    });

    el.addEventListener('ended', () => {
      setTimeout(() => { this._saveSessionNow(); }, 300);
    });
  },

  // ==================================================== lyrics (Now Playing pane)
  toggleLyrics: function() {
    const t = this._nowPlayingTrack();
    if (!t) { this._toast('No track is playing.', '🎵'); return; }
    this._nowLyricsOpen = !this._nowLyricsOpen;
    this.renderRight();
    this._setRightLyricScrollbar();
  },

  _isLyricsOpen: function() {
    return this.rightMode === 'now' && this._nowLyricsOpen;
  },

  _hasLyrics: function(np) {
    if (!np) return false;
    if (this.lyricState.track === np && this.lyricState.data) return true;
    return !!(np.lyrics || np.lrcPath);
  },

  _isDesktop: function() {
    return !!(window.MusicAPI && window.MusicAPI.isDesktop === true);
  },

  _setRightLyricScrollbar: function() {
    const rb = document.getElementById('music-right-body');
    if (!rb) return;
    const sc = document.getElementById('music-now-lower') || rb;
    const synced = rb.querySelector('.lyric-line[data-time]') != null;
    sc.style.scrollbarWidth = (this._isLyricsOpen() && synced && this._lyricFollow !== false) ? 'none' : 'thin';
  },

  _nowPlayingTrack: function() {
    if (!window.EQ || !EQ.audioEl) return null;
    return this._trackForSrc(EQ.audioEl.currentSrc || '');
  },

  // Map whatever src is on the shared audio element back to a library track.
  // Electron plays app-file://local/<path>; the browser plays blob: URLs that
  // the MusicAPI can reverse-map via pathForUrl().
  _trackForSrc: function(src) {
    if (!src) return null;
    if (/^app-file:\/\/local\//.test(src)) {
      const p = decodeURIComponent(src.replace(/^app-file:\/\/local\//, ''));
      return this.tracks.find(t => t.path === p) || null;
    }
    if (window.MusicAPI && typeof window.MusicAPI.pathForUrl === 'function') {
      const p = window.MusicAPI.pathForUrl(src);
      if (p) return this.tracks.find(t => t.path === p) || null;
    }
    return this.tracks.find(t => t.url && t.url === src) || null;
  },

  _loadLyrics: async function(track) {
    if (!track) return;
    let norm = this._lyricCache[track.path];
    if (norm === undefined) {
      norm = this._normLyrics(track.lyrics);
      if (!norm) {
        // Prefer the attached sidecar, but fall back to a fresh name-based
        // lookup so a missing/renamed .lrc gets re-resolved on the next load.
        let lp = track.lrcPath;
        if (!lp) {
          const base = String(track.name || '').replace(/\.[^.]+$/i, '').toLowerCase();
          lp = this.lrcIndex[String(track.folder || '').toLowerCase() + '::' + base] || null;
          if (lp && lp !== track.lrcPath) {
            track.lrcPath = lp;
            this._dbPut('tracks', track);
          }
        }
        if (lp) {
          try {
            const res = await window.MusicAPI.readText(lp);
            if (res.ok) norm = this._normLyrics(res.text);
          } catch (_) {}
        }
      }
      this._lyricCache[track.path] = norm || null;
    }
    // MP3 SYLT is skipped during scans (a full node-id3 parse per track is
    // wasted on files without synced lyrics). On playback we re-read the file
    // once so embedded synced lyrics still surface.
    if (String(track.path || '').toLowerCase().endsWith('.mp3') && !(norm && norm.synced && norm.synced.length)) {
      const tried = this._syncedTried || (this._syncedTried = new Set());
      if (!tried.has(track.path)) {
        tried.add(track.path);
        try {
          const fresh = await window.MusicAPI.readTags(track.path);
          if (fresh && fresh.lyrics && fresh.lyrics.synced && fresh.lyrics.synced.length) {
            norm = { ...norm, synced: fresh.lyrics.synced, format: fresh.lyrics.format };
            this._lyricCache[track.path] = norm;
          }
        } catch (_) {}
      }
    }
    this.lyricState.track = track;
    this.lyricState.data = norm;
    this.lyricState.synced = !!(norm && norm.synced && norm.synced.length);
    if (this.rightMode === 'now') this.renderRight();
  },

  // Normalize every possible lyrics shape (raw LRC string, plain text string,
  // Electron/browser {unsynced, synced, format} object, or a parsed
  // {lines, synced, unsynced} object) into a single {unsynced, synced} shape.
  _normLyrics: function(l) {
    if (!l) return null;
    if (typeof l === 'string') {
      const t = l.trim();
      if (!t) return null;
      const p = this._parseLrc(t);
      if (p && p.synced && p.synced.length) return { unsynced: p.unsynced, synced: p.synced, format: 'LRC' };
      return { unsynced: t, synced: null, format: 'USLT' };
    }
    if (typeof l === 'object') {
      const synced = Array.isArray(l.synced) && l.synced.length ? l.synced : null;
      let unsynced = typeof l.unsynced === 'string' && l.unsynced.trim() ? l.unsynced : null;
      if (unsynced == null && Array.isArray(l.lines) && !synced) {
        unsynced = l.lines.map(x => (x && x.text != null ? x.text : x)).join('\n') || null;
      }
      if (synced || unsynced) {
        // Many taggers store *synced* lyrics as an LRC-formatted string in
        // USLT / LYRICS / UNSYNCEDLYRICS. If the payload actually carries
        // [mm:ss] stamps, extract the synced lines instead of showing raw text.
        if (!synced && unsynced) {
          const p = this._parseLrc(unsynced);
          if (p && p.synced && p.synced.length) return { unsynced: p.unsynced, synced: p.synced, format: 'LRC' };
        }
        return { unsynced, synced, format: l.format || (synced ? 'SYLT' : 'USLT') };
      }
    }
    return null;
  },

  _tickLyrics: function(time) {
    const rightBody = document.getElementById('music-right-body');
    // Reuse the cached NodeList while it still points at live DOM (cheap);
    // re-query after any re-render replaces the rows.
    let lines = this._lyricRowEls;
    if (!lines || !lines.length || !lines[0].isConnected) {
      lines = rightBody ? rightBody.querySelectorAll('.lyric-line[data-time]') : null;
      this._lyricRowEls = lines;
    }
    if (lines && lines.length) {
      const sc = document.getElementById('music-now-lower') || rightBody;
      let active = -1;
      for (let i = 0; i < lines.length; i++) {
        const t = parseFloat(lines[i].dataset.time);
        if (!isNaN(t) && time >= t) active = i;
      }
      const follow = this._lyricFollow !== false;
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        const d = active < 0 ? 1 : Math.abs(i - active);
        const clsActive = d === 0;
        // When the user is browsing manually (follow off), keep every line
        // readable — no blur. Blur only applies while auto-following.
        const clsNear = follow && d === 1;
        const clsFar = follow && d >= 2;
        const c = lines[i].classList;
        if (clsActive !== c.contains('music-lyric-active')) { c.toggle('music-lyric-active', clsActive); changed = true; }
        if (clsNear !== c.contains('lyric-near')) { c.toggle('lyric-near', clsNear); changed = true; }
        if (clsFar !== c.contains('lyric-far')) { c.toggle('lyric-far', clsFar); changed = true; }
      }
      // Spotify-style: keep the line being sung centered as it plays — unless the
      // user has scrolled away (then they stay free to browse until they hit Sync).
      if (changed && active >= 0 && lines[active] && follow) {
        const y = lines[active].offsetTop - sc.clientHeight / 2 + lines[active].clientHeight / 2;
        this._followScrollTop = y;
        this._lastFollowScrollAt = Date.now();
        sc.scrollTo({ top: y, behavior: 'smooth' });
      }
      this._activeLyricLine = active;
      this._setRightLyricScrollbar();
    }
  },

  syncLyrics: function() {
    this._lyricFollow = true;
    this._lyricUserScroll = false;
    const pill = document.getElementById('music-lyric-sync-pill');
    if (pill) pill.classList.add('music-pill-hidden');
    this._setRightLyricScrollbar();
    const sc = document.getElementById('music-now-lower') || document.getElementById('music-right-body');
    const activeEl = sc && sc.querySelector('.lyric-line.music-lyric-active');
    if (sc && activeEl) {
      const y = activeEl.offsetTop - sc.clientHeight / 2 + activeEl.clientHeight / 2;
      sc.scrollTo({ top: y, behavior: 'smooth' });
    }
  },

  _seekToLyric: function(idx) {
    const line = this.lyricState.lines && this.lyricState.lines[idx];
    if (line && line.time != null) this.seek(line.time);
  },

  _parseLrc: function(text) {
    const meta = {};
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
      const mm = /^\[(ti|ar|al|by|offset|re|ve|length):(.*)\]$/i.exec(raw.trim());
      if (mm) { meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
      const stamps = [];
      const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      let m;
      while ((m = re.exec(raw))) {
        const min = +m[1], sec = +m[2], frac = +(m[3] || 0);
        let t = min * 60 + sec;
        if (m[3] !== undefined) t += frac / (String(m[3]).length >= 3 ? 1000 : 100);
        stamps.push(t);
      }
      const txt = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (txt && stamps.length) {
        for (const t of stamps) lines.push({ time: Math.round(t * 10) / 10, text: txt });
      } else if (txt) {
        lines.push({ time: null, text: txt });
      }
    }
    lines.sort((a, b) => (a.time == null ? 1e9 : a.time) - (b.time == null ? 1e9 : b.time));
    const synced = lines.filter(l => l.time != null);
    const unsynced = lines.filter(l => l.time == null).map(l => l.text).join('\n') || null;
    return { meta, lines, synced: synced.length ? synced : null, unsynced };
  },

  // ==================================================== helpers
  _displayName: function(t) {
    const title = t.title || t.name.replace(/\.[^.]+$/, '');
    if (t.artist && t.title) return title + ' — ' + t.artist;
    return title || t.name;
  },

  _marquee: function(el) {
    el.classList.remove('marquee-active');
    el.style.transform = '';
    setTimeout(() => {
      const parentW = el.parentElement.clientWidth;
      const w = el.scrollWidth;
      if (w > parentW) {
        const dist = -(w - parentW + 12);
        el.style.setProperty('--scroll-dist', dist + 'px');
        el.classList.add('marquee-active');
      }
    }, 60);
  },

  _fmtTime: function(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ':' + String(sec).padStart(2, '0');
  },

  _fmtDuration: function(s) {
    if (!s) return '—:—';
    return this._fmtTime(s);
  },

  _toast: function(msg, icon, opts) {
    if (window.showToast) window.showToast(msg, icon || '🎵', opts);
  },

  clearSearch: function() {
    this.search = '';
    const el = document.getElementById('music-search');
    if (el) el.value = '';
    this.renderCenter();
  },

  // ==================================================== tag editor (Phase 5)
  onRowDblClick: function(event, idx) {
    // A double-click on a row's own buttons (favorite star, edit, playlist)
    // should not fire the row-level "open tag editor" action.
    if (event && event.target && event.target.closest && event.target.closest('button')) return;
    const t = this._clickSource && this._clickSource[idx];
    if (t) this.openTagEditor(t);
  },

  openTagEditor: function(track) {
    if (!track) return;
    const modal = document.getElementById('music-tag-editor');
    if (!modal) return;
    this._tagEditTrack = track;
    this._tagArtPatch = null;
    this._tagRemoveArt = false;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val == null ? '' : val;
    };
    set('tag-title', track.title || '');
    set('tag-artist', track.artist || '');
    set('tag-album', track.album || '');
    set('tag-albumartist', track.albumArtist || '');
    set('tag-genre', track.genre || '');
    set('tag-year', track.year || '');
    set('tag-track', track.trackNo || '');
    set('tag-tracktotal', track.trackTotal || '');
    set('tag-disc', track.discNo || '');
    set('tag-composer', track.composer || '');
    set('tag-comment', track.comment || '');
    const ly = this._normLyrics(track.lyrics);
    set('tag-lyrics', (ly && ly.unsynced) || '');
    set('tag-synced', (ly && ly.synced) ? ly.synced.map(l => `[${this._fmtLrcTime(l.time)}] ${l.text}`).join('\n') : '');

    const artBox = document.getElementById('tag-art-preview');
    if (artBox) {
      artBox.innerHTML = track.art
        ? '<img src="data:' + track.art.mime + ';base64,' + track.art.base64 + '" style="width:100%;height:100%;object-fit:cover;display:block;" alt="">'
        : '<span class="text-2xl">🎵</span>';
    }
    document.getElementById('tag-file-label').textContent = track.name;

    const format = (track.ext || '').toLowerCase();
    // In-place writing is implemented for MP3 (node-id3), FLAC, and OGG/Opus
    // (hand-rolled Vorbis writers in music-library.js). Other formats are
    // read-only previews. A MusicAPI can opt in for extra formats.
    let writable = format === 'mp3' || format === 'flac' || format === 'ogg' || format === 'opus' || format === 'oga';
    if (window.MusicAPI && typeof window.MusicAPI.canWriteTags === 'function') {
      writable = !!window.MusicAPI.canWriteTags(track);
    }
    // The browser shim only edits its own in-memory copy of the audio, never the
    // file on disk — so tag/writing must stay strictly read-only outside Electron.
    if (!this._isDesktop()) writable = false;
    const writeHint = document.getElementById('tag-write-hint');
    if (writeHint) {
      if (writable) writeHint.textContent = `Editable in place (${format.toUpperCase()})`;
      else if (!this._isDesktop()) writeHint.textContent = 'Read-only preview — run the desktop app to edit the actual files.';
      else writeHint.textContent = `Read-only preview — writing not yet supported for ${format || 'this'} format`;
      writeHint.classList.toggle('text-emerald-400', writable);
      writeHint.classList.toggle('text-amber-400', !writable);
    }
    const saveBtn = document.getElementById('tag-save-btn');
    if (saveBtn) saveBtn.disabled = !writable;
    if (saveBtn) saveBtn.classList.toggle('opacity-40', !writable);

    modal.classList.remove('hidden');
  },

  closeTagEditor: function() {
    const modal = document.getElementById('music-tag-editor');
    if (modal) modal.classList.add('hidden');
    this._tagEditTrack = null;
  },

  _fmtLrcTime: function(t) {
    const min = Math.floor((t || 0) / 60);
    const sec = Math.floor((t || 0) % 60);
    const ms = Math.floor(((t || 0) % 1) * 100);
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(2, '0');
  },

  saveTagEditor: async function() {
    const track = this._tagEditTrack;
    if (!track) return;
    const g = (id) => document.getElementById(id) ? document.getElementById(id).value.trim() : '';
    const patch = {
      title: g('tag-title'),
      artist: g('tag-artist'),
      album: g('tag-album'),
      albumArtist: g('tag-albumartist'),
      genre: g('tag-genre'),
      year: g('tag-year'),
      trackNo: g('tag-track'),
      trackTotal: g('tag-tracktotal'),
      discNo: g('tag-disc'),
      composer: g('tag-composer'),
      comment: g('tag-comment'),
      lyrics: g('tag-lyrics'),
      syncedLyrics: this._parseSyncedField(g('tag-synced'))
    };
    // clear empties to undefined so we don't wipe untouched fields
    for (const k in patch) { if (patch[k] === '' || patch[k] == null) delete patch[k]; }
    if (this._tagArtPatch) patch.picture = this._tagArtPatch;
    if (this._tagRemoveArt) patch.removePicture = true;

    const snap = this._snapshotTrack(track);
    const res = await window.MusicAPI.writeTags(track.path, patch);
    this._tagArtPatch = null;
    this._tagRemoveArt = false;
    if (res.ok) {
      // refresh the cached record
      const fresh = await window.MusicAPI.readTags(track.path);
      const idx = this.tracks.findIndex(t => t.path === track.path);
      const rec = this._mergeScanRecord({
        path: track.path, folder: track.folder, rel: track.rel, name: track.name,
        ext: track.ext, size: track.size, mtimeMs: Date.now()
      }, fresh);
      if (idx >= 0) this.tracks[idx] = rec; else this.tracks.push(rec);
      await this._dbPut('tracks', rec);
      this._pushUndo('tag edit on ' + track.name, [snap]);
      this._toast('Tags saved to ' + track.name, '💾',
        { action: { label: '↩ Undo', onClick: () => this.undoTagEdits() } });
      this.closeTagEditor();
      this.render();
      this._onMediaChanged();
    } else {
      this._toast(res.reason || 'Failed to save tags.', '⚠️');
    }
  },

  // Re-read a track's embedded tags from disk and refresh the cached record —
  // useful after editing files externally or when the DB has gone stale.
  refreshTrackMeta: async function(path) {
    const idx = this.tracks.findIndex(t => t.path === path);
    if (idx < 0) return;
    const track = this.tracks[idx];
    try {
      const tag = await window.MusicAPI.readTags(path);
      if (tag) {
        const rec = this._mergeScanRecord({
          path: track.path, folder: track.folder, rel: track.rel, name: track.name,
          ext: track.ext, size: track.size, mtimeMs: Date.now()
        }, tag);
        this.tracks[idx] = rec;
        await this._dbPut('tracks', rec);
        if (this._lyricCache[path] !== undefined) delete this._lyricCache[path];
        this._toast('Re-read metadata for ' + (rec.title || rec.name) + '.', '🔄');
        this.render();
        return;
      }
    } catch (e) { console.error('[Music] refreshTrackMeta', e); }
    this._toast('Could not re-read metadata for this track.', '⚠️');
  },

  _parseSyncedField: function(text) {
    const out = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)/;
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = re.exec(line);
      if (!m) continue;
      let t = (+m[1]) * 60 + (+m[2]);
      if (m[3] !== undefined) t += (+m[3]) / (String(m[3]).length >= 3 ? 1000 : 100);
      out.push({ time: t, text: m[4].trim() });
    }
    return out.length ? out : null;
  },

  chooseArtFile: function() {
    const input = document.getElementById('tag-art-file');
    if (input) input.click();
  },

  onArtChosen: function(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, '');
      const mimeMatch = result.match(/^data:image\/(png|jpeg|jpg|webp|gif)/);
      const mime = mimeMatch ? ('image/' + (mimeMatch[1] === 'jpg' ? 'jpeg' : mimeMatch[1])) : 'image/jpeg';
      this._tagArtPatch = { mime, base64 };
      const box = document.getElementById('tag-art-preview');
      if (box) box.innerHTML = '<img src="' + result + '" style="width:100%;height:100%;object-fit:cover;display:block;">';
    };
    reader.readAsDataURL(file);
  },

  removeArt: function() {
    this._tagArtPatch = null;
    const box = document.getElementById('tag-art-preview');
    if (box) box.innerHTML = '<span class="text-2xl">🎵</span>';
    this._tagRemoveArt = true;
  },

  // ------------------------------------------------ batch tag editor
  // Applies one set of filled-in fields to every selected track. An empty +
  // unchecked field is left untouched; ticking "✖ erase" clears that field
  // on all tracks. Art can be set once or removed across the whole selection.
  openBatchTagEditor: function(tracks) {
    const list = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!list.length) return;
    const modal = document.getElementById('music-batch-tag-editor');
    if (!modal) return;
    this._batchEditTracks = list;
    this._batchTagArtPatch = null;
    this._batchTagRemoveArt = false;
    for (const id of Object.values(BATCH_FIELD_IDS)) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    modal.querySelectorAll('input[type=checkbox][data-key]').forEach(cb => { cb.checked = false; });
    const label = document.getElementById('batch-tag-art-label');
    if (label) label.textContent = '';
    const title = document.getElementById('batch-tag-title');
    if (title) title.textContent = '✏️ Edit Tags — ' + list.length + ' track' + (list.length === 1 ? '' : 's');
    modal.classList.remove('hidden');
  },

  closeBatchTagEditor: function() {
    const modal = document.getElementById('music-batch-tag-editor');
    if (modal) modal.classList.add('hidden');
    this._batchEditTracks = null;
    this._batchTagArtPatch = null;
    this._batchTagRemoveArt = false;
  },

  saveBatchTagEditor: async function() {
    const tracks = this._batchEditTracks || [];
    if (!tracks.length) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const cleared = {};
    document.querySelectorAll('#music-batch-tag-editor input[type=checkbox][data-key]').forEach(cb => {
      if (cb.checked) cleared[cb.getAttribute('data-key')] = true;
    });

    const patch = {};
    for (const key of Object.keys(BATCH_FIELD_IDS)) {
      if (cleared[key]) {
        if (key === 'syncedLyrics') patch.removeSyncedLyrics = true;
        else patch[key] = '';
        continue;
      }
      const v = g(BATCH_FIELD_IDS[key]);
      if (key === 'syncedLyrics') {
        const parsed = this._parseSyncedField(v);
        if (parsed) patch.syncedLyrics = parsed;
      } else if (v !== '') {
        patch[key] = v;
      }
    }
    if (this._batchTagArtPatch) patch.picture = this._batchTagArtPatch;
    if (this._batchTagRemoveArt) patch.removePicture = true;

    if (!Object.keys(patch).length) {
      this._toast('Nothing to apply — fill a field or tick a ✖ erase box first.', '✏️');
      return;
    }

    const failed = [];
    const done = [];
    let okCount = 0;
    const snaps = tracks.map(t => this._snapshotTrack(t));
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const res = await window.MusicAPI.writeTags(t.path, patch);
      if (res && res.ok) {
        okCount++;
        done.push(snaps[i]);
        try {
          const fresh = await window.MusicAPI.readTags(t.path);
          const rec = this._mergeScanRecord({
            path: t.path, folder: t.folder, rel: t.rel, name: t.name,
            ext: t.ext, size: t.size, mtimeMs: Date.now()
          }, fresh);
          const idx = this.tracks.findIndex(x => x.path === t.path);
          if (idx >= 0) this.tracks[idx] = rec; else this.tracks.push(rec);
          await this._dbPut('tracks', rec);
        } catch (_) {}
      } else {
        failed.push(t);
      }
    }
    this._batchTagArtPatch = null;
    this._batchTagRemoveArt = false;
    this.closeBatchTagEditor();
    if (okCount) {
      this._pushUndo('batch tag edit on ' + okCount + ' track' + (okCount === 1 ? '' : 's'), done);
      this._toast(failed.length
        ? 'Updated ' + okCount + '/' + tracks.length + ' — ' + failed.length + ' failed (' + (failed[0].name || '') + ').'
        : 'Updated tags on ' + okCount + ' track' + (okCount === 1 ? '' : 's') + '.',
        '💾', { action: { label: '↩ Undo', onClick: () => this.undoTagEdits() } });
    } else {
      this._toast('Could not update any of the selected tracks.', '⚠️');
    }
    this.render();
    this._onMediaChanged();
  },

  chooseBatchArtFile: function() {
    const input = document.getElementById('batch-tag-art-file');
    if (input) input.click();
  },

  onBatchArtChosen: function(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, '');
      const mimeMatch = result.match(/^data:image\/(png|jpeg|jpg|webp|gif)/);
      const mime = mimeMatch ? ('image/' + (mimeMatch[1] === 'jpg' ? 'jpeg' : mimeMatch[1])) : 'image/jpeg';
      this._batchTagArtPatch = { mime, base64 };
      const label = document.getElementById('batch-tag-art-label');
      if (label) label.textContent = 'Art set: ' + (file.name || 'image');
    };
    reader.readAsDataURL(file);
  },

  removeBatchArt: function() {
    this._batchTagArtPatch = null;
    this._batchTagRemoveArt = true;
    const label = document.getElementById('batch-tag-art-label');
    if (label) label.textContent = 'Art will be removed from all selected tracks.';
  },

  // ------------------------------------------------ tag-edit undo
  // Snapshots a track record's current tags so a later writeTags can be
  // rolled back. Keep only the fields the tag writers understand.
  _snapshotTrack: function(t) {
    return {
      path: t.path, folder: t.folder, rel: t.rel, name: t.name, ext: t.ext, size: t.size,
      title: t.title, artist: t.artist, album: t.album, albumArtist: t.albumArtist,
      genre: t.genre, year: t.year, trackNo: t.trackNo, trackTotal: t.trackTotal,
      discNo: t.discNo, composer: t.composer, comment: t.comment,
      lyrics: t.lyrics, art: t.art
    };
  },

  // Convert a snapshot back into a full writeTags patch so undo restores
  // every field exactly (empty string clears, like the batch ✖ erase flow).
  _tagsToPatch: function(s) {
    const patch = {};
    const text = k => { patch[k] = s[k] == null ? '' : s[k]; };
    text('title'); text('artist'); text('album'); text('albumArtist'); text('genre');
    text('composer'); text('comment');
    patch.year = s.year == null ? '' : String(s.year);
    patch.trackNo = s.trackNo == null ? '' : String(s.trackNo);
    patch.trackTotal = s.trackTotal == null ? '' : String(s.trackTotal);
    patch.discNo = s.discNo == null ? '' : String(s.discNo);
    const ly = this._normLyrics(s.lyrics);
    patch.lyrics = ly && ly.unsynced ? ly.unsynced : '';
    if (ly && ly.synced && ly.synced.length) patch.syncedLyrics = ly.synced;
    else patch.removeSyncedLyrics = true;
    if (s.art) patch.picture = s.art;
    else patch.removePicture = true;
    return patch;
  },

  _pushUndo: function(label, items) {
    this._undoStack.push({ label, items });
    if (this._undoStack.length > 10) this._undoStack.shift();
    this._updateUndoButton();
  },

  undoTagEdits: async function() {
    const entry = this._undoStack[this._undoStack.length - 1];
    if (!entry) return;
    const items = entry.items;
    let ok = 0, fail = 0;
    for (const it of items) {
      const res = await window.MusicAPI.writeTags(it.path, this._tagsToPatch(it));
      if (res && res.ok) {
        ok++;
        try {
          const fresh = await window.MusicAPI.readTags(it.path);
          const rec = this._mergeScanRecord(it, fresh);
          const idx = this.tracks.findIndex(x => x.path === it.path);
          if (idx >= 0) this.tracks[idx] = rec; else this.tracks.push(rec);
          await this._dbPut('tracks', rec);
          if (this._lyricCache[it.path] !== undefined) delete this._lyricCache[it.path];
        } catch (_) {}
      } else {
        fail++;
      }
    }
    this._undoStack.pop();
    this._updateUndoButton();
    if (fail) this._toast('Undo restored ' + ok + '/' + items.length + ' — ' + fail + ' failed.', '⚠️');
    else this._toast('Undid: ' + entry.label + '.', '↩️');
    this.render();
    this._onMediaChanged();
  },

  _updateUndoButton: function() {
    const btn = document.getElementById('music-undo-btn');
    if (!btn) return;
    const has = !!(this._undoStack && this._undoStack.length);
    btn.disabled = !has;
    btn.classList.toggle('opacity-30', !has);
    btn.classList.toggle('pointer-events-none', !has);
    btn.title = has ? 'Undo last tag edit' : 'Nothing to undo yet';
  },

  // ==================================================== playlists (Phase 4)
  createPlaylist: function() {
    this._openPlaylistModal('create');
  },

  addToPlaylist: function(trackOrList) {
    const tracks = Array.isArray(trackOrList) ? trackOrList : (trackOrList ? [trackOrList] : []);
    if (!tracks.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._playlistModalResolve = (target) => {
        resolve(target);
        if (!target) return;
        let added = 0;
        for (const t of tracks) {
          if (!t || !t.path) continue;
          if (target.trackPaths.includes(t.path)) continue;
          target.trackPaths.push(t.path);
          added++;
        }
        this._persistPlaylists();
        this.render();
        if (added) this._toast('Added ' + added + ' track' + (added === 1 ? '' : 's') + ' to "' + target.name + '".', '📃');
        else this._toast('Already in playlist.', '📃');
      };
      this._openPlaylistModal('add');
    });
  },

  _openPlaylistModal: function(mode) {
    const overlay = document.getElementById('music-playlist-modal');
    const body = document.getElementById('music-playlist-modal-body');
    const titleEl = document.getElementById('music-playlist-modal-title');
    if (!overlay || !body || !titleEl) return;
    titleEl.textContent = mode === 'add' ? '📋 Add to Playlist' : '📋 New Playlist';
    overlay.classList.remove('hidden');

    let html = '';
    const createLabel = mode === 'add' ? '＋ Create & Add' : '＋ Create';
    html += '<div class="flex flex-col gap-1.5">' +
      '<label class="text-[9px] font-black uppercase tracking-wider text-zinc-500">New playlist name</label>' +
      '<div class="flex gap-2">' +
      '<input id="playlist-name-input" class="flex-1 min-w-0 h-9 px-2 rounded border border-zinc-700 bg-[var(--bg-input)] text-[11px] font-bold text-[var(--text-main)] focus:outline-none" placeholder="My Playlist" autocomplete="off">' +
      '<button id="playlist-name-create" class="px-3 py-1.5 text-[10px] font-black bg-[var(--accent-blue)] text-white hover:brightness-110 border-2 border-black cursor-pointer shadow-[2px_2px_0_0_#000] flex-shrink-0">' + createLabel + '</button>' +
      '</div></div>';

    if (this.playlists.length) {
      html += '<div class="text-[9px] font-black uppercase tracking-wider text-zinc-500">Existing playlists</div>' +
        '<div class="space-y-1">' + this.playlists.map(p => {
          const count = p.trackPaths.filter(path => this.tracks.some(t => t.path === path)).length;
          return '<div class="flex items-center gap-2 px-2.5 py-1.5 border-2 border-black bg-[var(--bg-input)] rounded">' +
            '<span class="text-sm">📋</span>' +
            '<div class="flex-1 min-w-0"><div class="text-[10.5px] font-black text-[var(--text-main)] truncate">' + esc(p.name) + '</div>' +
            '<div class="text-[8.5px] text-zinc-500">' + count + ' track' + (count === 1 ? '' : 's') + '</div></div>' +
            (mode === 'add'
              ? '<button data-pl="' + p.id + '" class="pl-pick-btn px-2.5 py-1 text-[9px] font-black bg-[var(--accent-blue)] text-white hover:brightness-110 border-2 border-black cursor-pointer">＋ Add</button>'
              : '<button data-pl="' + p.id + '" class="pl-pick-btn px-2.5 py-1 text-[9px] font-black bg-[var(--bg-input)] text-zinc-300 hover:text-white border-2 border-black cursor-pointer">Open</button>') +
            '</div>';
        }).join('') + '</div>';
    } else {
      html += '<div class="text-[9px] text-zinc-600 px-1">No playlists yet — create your first one above.</div>';
    }
    body.innerHTML = html;

    const close = () => {
      overlay.classList.add('hidden');
      const r = this._playlistModalResolve;
      this._playlistModalResolve = null;
      if (r) r(null);
    };
    document.getElementById('music-playlist-modal-close').onclick = close;
    overlay.onmousedown = (e) => { if (e.target === overlay) close(); };

    const input = document.getElementById('playlist-name-input');
    const doCreate = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      const id = 'pl_' + Date.now();
      const pl = { id, name, trackPaths: [], created: Date.now() };
      this.playlists.push(pl);
      this._persistPlaylists();
      const r = this._playlistModalResolve;
      this._playlistModalResolve = null;
      overlay.classList.add('hidden');
      if (r) r(pl);
      else { this.render(); this._toast('Playlist created.', '📋'); }
    };
    document.getElementById('playlist-name-create').onclick = doCreate;
    if (input) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
      setTimeout(() => input.focus(), 10);
    }

    body.querySelectorAll('.pl-pick-btn').forEach(b => {
      b.onclick = () => {
        const pl = this.playlists.find(p => p.id === b.dataset.pl);
        if (!pl) return;
        const r = this._playlistModalResolve;
        this._playlistModalResolve = null;
        overlay.classList.add('hidden');
        if (r) r(pl);
        else this.setLeft('playlist:' + pl.id);
      };
    });
  },

  removeFromPlaylist: function(id, path) {
    const pl = this.playlists.find(p => p.id === id);
    if (!pl) return;
    pl.trackPaths = pl.trackPaths.filter(p => p !== path);
    this._persistPlaylists();
    this.render();
    this._toast('Removed from playlist.', '🗑️');
  },

  removePlaylist: function(id) {
    this.playlists = this.playlists.filter(p => p.id !== id);
    this._persistPlaylists();
    this.render();
  },

  playPlaylist: function(id) {
    const pl = this.playlists.find(p => p.id === id);
    if (!pl) return;
    const byPath = {};
    for (const t of this.tracks) byPath[t.path] = t;
    const tracks = pl.trackPaths.map(p => byPath[p]).filter(Boolean);
    if (!tracks.length) { this._toast('Playlist is empty or its files are missing.', '⚠️'); return; }
    this.playTracks(tracks, 0);
  },

  savePlaylistToDisk: async function(id) {
    const pl = this.playlists.find(p => p.id === id);
    if (!pl) return;
    const byPath = {};
    for (const t of this.tracks) byPath[t.path] = t;
    const entries = pl.trackPaths.map(p => byPath[p]).filter(Boolean);
    if (!entries.length) { this._toast('Nothing to export.', '⚠️'); return; }
    const lines = ['#EXTM3U'];
    for (const t of entries) {
      lines.push('#EXTINF:' + Math.round(t.duration || 0) + ',' + (t.artist ? t.artist + ' - ' : '') + (t.title || t.name));
      lines.push(this._escapeM3u(t.path));
    }
    const defaultName = pl.name.replace(/[\\/:*?"<>|]+/g, '_') + '.m3u8';
    const res = await window.MusicAPI.savePlaylist(defaultName, lines.join('\n'));
    if (res.saved) this._toast('Playlist saved to disk.', '💾');
    else if (!res.saved && res.reason) this._toast(res.reason, '⚠️');
  },

  _escapeM3u: function(p) {
    return String(p).replace(/[\\]/g, '/');
  },

  _persistPlaylists: function() {
    this._setMeta('playlists_created', this.playlists);
  },

  playDetectedPlaylist: function(id) {
    const pl = this.detectedPlaylists.find(p => p.id === id);
    if (!pl) return;
    const res = window.MusicAPI.readText(pl.path);
    if (!res.ok) { this._toast('Could not read playlist.', '⚠️'); return; }
    const entries = this._parseM3u(res.text);
    if (!entries.length) { this._toast('No playable entries in this playlist.', '⚠️'); return; }
    const byPath = {};
    for (const t of this.tracks) byPath[t.path] = t;
    const tracks = [];
    for (const e of entries) {
      const found = byPath[e];
      if (found) tracks.push(found);
    }
    if (!tracks.length) { this._toast('No files from this playlist are in your library.', '⚠️'); return; }
    this.playTracks(tracks, 0);
  },

  _parseM3u: function(text) {
    const entries = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let p = line;
      try { if (/^[a-zA-Z]:[\\/]/.test(line)) p = line.replace(/\//g, '\\'); } catch (_) {}
      // resolve relative to a folder if needed
      entries.push(p);
    }
    // try to resolve relative entries against library folders
    return this._resolvePlaylistEntries(entries);
  },

  _resolvePlaylistEntries: function(entries) {
    const tracks = this.tracks;
    if (!this._plIdx || this._plIdx.tracks !== tracks) {
      const byPath = new Map();
      const byLower = new Map();
      const byName = new Map();
      for (const t of tracks) {
        byPath.set(t.path, t.path);
        byLower.set(t.path.toLowerCase(), t.path);
        if (!byName.has(t.name.toLowerCase())) byName.set(t.name.toLowerCase(), t.path);
      }
      this._plIdx = { tracks, byPath, byLower, byName };
    }
    const idx = this._plIdx;
    const out = [];
    for (const e of entries) {
      if (idx.byPath.has(e)) { out.push(e); continue; }
      const byLower = idx.byLower.get(e.toLowerCase());
      if (byLower) { out.push(byLower); continue; }
      // bare filename match
      const base = e.split(/[\\/]/).pop().toLowerCase();
      const byName = idx.byName.get(base);
      if (byName) { out.push(byName); continue; }
      out.push(e);
    }
    return out;
  },

  // ==================================================== rendering
  render: function() {
    this.renderLeft();
    this.renderLeftFolders();
    this.renderCenter();
    this.renderRight();
    this.updateLeftStats();
    this._applyMobileRegions();
  },

  // ==================================================== LEFT panel (nav)
  setLeft: function(sel) {
    this.leftSel = sel;
    this.selArtist = null;
    this.selAlbum = null;
    this.selGenre = null;
    this._updateNavActive();
    this.renderLeftFolders();
    this.renderCenter();
    this._updateMobileLabel();
  },

  cycleLeft: function(dir) {
    const order = ['all', 'artists', 'albums', 'genres', 'favorites', 'recent'];
    const cur = (this.leftSel.startsWith('playlist:') || this.leftSel.startsWith('folder:')) ? 'all' : this.leftSel;
    let i = order.indexOf(cur);
    i = (i + dir + order.length) % order.length;
    this.setLeft(order[i]);
  },

  _updateNavActive: function() {
    const root = document.getElementById('music-left-nav');
    if (!root) return;
    root.querySelectorAll('.music-nav-btn').forEach(b => {
      const on = b.dataset.left === this.leftSel;
      b.classList.toggle('active', on);
      b.classList.toggle('bg-zinc-800/60', on);
      b.classList.toggle('text-white', on);
    });
  },

  renderLeft: function() {
    const el = document.getElementById('music-left-playlists');
    if (!el) return;
    if (!this.playlists.length) {
      el.innerHTML = '<div class="text-[9px] text-zinc-600 px-1">No playlists yet</div>';
      return;
    }
    el.innerHTML = this.playlists.map(p => {
      const count = p.trackPaths.filter(path => this.tracks.some(t => t.path === path)).length;
      const on = this.leftSel === 'playlist:' + p.id;
      return '<div class="flex items-center gap-1.5 rounded ' + (on ? 'bg-zinc-800/60' : '') + '" style="margin:2px 0;">' +
        '<button class="flex-1 min-w-0 flex items-center gap-2 h-8 px-2 text-left text-[10px] font-bold text-[var(--text-secondary)] hover:text-white cursor-pointer rounded truncate" onclick="MusicPlayer.setLeft(\'playlist:' + p.id + '\')">📋 <span class="truncate">' + esc(p.name) + '</span>' +
        '<span class="text-[8px] text-zinc-600">' + count + '</span></button>' +
        '<button class="w-6 h-6 flex items-center justify-center text-[9px] text-zinc-500 hover:text-rose-300 cursor-pointer flex-shrink-0" title="Delete playlist" onclick="MusicPlayer.removePlaylist(\'' + p.id + '\')">✕</button>' +
        '</div>';
    }).join('');
  },

  renderLeftFolders: function() {
    const el = document.getElementById('music-left-folders-list');
    if (!el) return;
    if (!this.config.folders.length) {
      el.innerHTML = '<div class="text-[9px] text-zinc-600 px-1">No folders yet</div>';
      return;
    }
    el.innerHTML = this.config.folders.map(f => {
      const on = this.leftSel === 'folder:' + f;
      const count = this.tracks.filter(t => t.folder && t.folder.toLowerCase() === f.toLowerCase()).length;
      const name = f.split(/[\\/]/).pop() || f;
      return '<div class="flex items-center gap-1.5 rounded ' + (on ? 'bg-zinc-800/60' : '') + '" style="margin:2px 0;">' +
        '<button class="flex-1 min-w-0 flex items-center gap-1.5 h-8 px-2 text-left text-[10px] font-bold text-[var(--text-secondary)] hover:text-white cursor-pointer rounded truncate" onclick="MusicPlayer.setLeft(\'folder:' + esc(f) + '\')" title="' + esc(f) + '">📁 <span class="truncate">' + esc(name) + '</span>' +
        '<span class="text-[8px] text-zinc-600">' + count + '</span></button>' +
        '<button class="w-6 h-6 flex items-center justify-center text-[9px] text-zinc-500 hover:text-rose-300 cursor-pointer flex-shrink-0" title="Remove folder" onclick="MusicPlayer.removeFolder(\'' + esc(f) + '\')">✕</button>' +
        '</div>';
    }).join('');
  },

  updateLeftStats: function() {
    const el = document.getElementById('music-stats-count');
    if (el) el.textContent = this.tracks.length + ' track' + (this.tracks.length === 1 ? '' : 's');
    const albums = new Set(this.tracks.map(t => t.album).filter(Boolean).map(a => String(a).toLowerCase())).size;
    const genres = new Set(this.tracks.map(t => t.genre).filter(Boolean).map(g => String(g).toLowerCase())).size;
    const ae = document.getElementById('music-stats-albums');
    if (ae) ae.textContent = albums;
    const ge = document.getElementById('music-stats-genres');
    if (ge) ge.textContent = genres;
    const ttl = this.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const hrs = Math.floor(ttl / 3600);
    const mins = Math.floor((ttl % 3600) / 60);
    const de = document.getElementById('music-stats-duration');
    if (de) de.textContent = (hrs ? hrs + 'h ' : '') + mins + 'm';
  },

  // ==================================================== MOBILE region cycling
  setMobileRegion: function(region) {
    this.mobileRegion = region;
    this._applyMobileRegions();
    this._updateMobileLabel();
  },

  cycleMobileRegion: function(dir) {
    const order = ['left', 'center', 'right'];
    let i = order.indexOf(this.mobileRegion);
    i = (i + dir + order.length) % order.length;
    this.setMobileRegion(order[i]);
  },

  _applyMobileRegions: function() {
    const narrow = window.innerWidth < 1280;
    const map = { left: 'music-col-left', center: 'music-col-center', right: 'music-col-right' };
    Object.entries(map).forEach(([k, id]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', narrow && k !== this.mobileRegion);
    });
  },

  _updateMobileLabel: function() {
    const el = document.getElementById('music-mobile-section-label');
    if (!el) return;
    const rightLabels = {
      now: '🎧 Now Playing', queue: '📃 Queue'
    };
    const labels = {
      left: '📚 Library',
      center: '🎵 ' + (this.search ? 'Search' : this._centerTitle()),
      right: rightLabels[this.rightMode] || '🎧 Now Playing'
    };
    el.textContent = labels[this.mobileRegion];
  },

  renderLibrary: function() {
    this.renderCenter();
  },

  // ==================================================== CENTER panel
  _centerContext: function() {
    const q = this.search.trim().toLowerCase();
    if (q) {
      return { title: '🔍 Search Results', sub: '', kind: 'tracks',
        tracks: this.tracks.filter(t =>
          String(t.title || '').toLowerCase().includes(q) ||
          String(t.artist || '').toLowerCase().includes(q) ||
          String(t.album || '').toLowerCase().includes(q) ||
          String(t.genre || '').toLowerCase().includes(q) ||
          String(t.name || '').toLowerCase().includes(q)) };
    }
    if (this.selGenre) {
      const tracks = this._sorted(this.tracks.filter(t => String(t.genre || '').toLowerCase() === this.selGenre.toLowerCase()));
      return { title: '🎼 ' + this.selGenre, sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks };
    }
    if (this.selArtist) {
      const tracks = this._sorted(this.tracks.filter(t => String(t.artist || 'Unknown Artist').toLowerCase() === this.selArtist.toLowerCase()));
      return { title: '👤 ' + this.selArtist, sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks };
    }
    if (this.selAlbum) {
      const group = this._albumGroups().find(g => g.key === this.selAlbum);
      if (group) {
        return { title: '💿 ' + (group.album || 'Unknown Album'), sub: (group.artist || '') + ' · ' + group.tracks.length + ' track' + (group.tracks.length === 1 ? '' : 's'), kind: 'album-detail', group };
      }
      this.selAlbum = null;
    }
    if (this.leftSel.startsWith('folder:')) {
      const folder = this.leftSel.slice('folder:'.length);
      const tracks = this._sorted(this.tracks.filter(t => t.folder && t.folder.toLowerCase() === folder.toLowerCase()));
      return { title: '📁 ' + (folder.split(/[\\/]/).pop() || folder), sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks };
    }
    if (this.leftSel === 'playlist:' + this.selPlaylist && this.selPlaylist) {
      const pl = this.playlists.find(p => p.id === this.selPlaylist);
      if (pl) {
        const byPath = {};
        for (const t of this.tracks) byPath[t.path] = t;
        const tracks = pl.trackPaths.map(p2 => byPath[p2]).filter(Boolean);
        return { title: '📋 ' + pl.name, sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks, playlistId: pl.id };
      }
    }
    switch (this.leftSel) {
      case 'favorites': {
        const favs = new Set(this.favorites);
        const tracks = this._sorted(this.tracks.filter(t => favs.has(t.path)));
        return { title: '⭐ Favorites', sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks };
      }
      case 'recent': {
        const byPath = {};
        for (const t of this.tracks) byPath[t.path] = t;
        const tracks = this.recent.map(r => byPath[r.path]).filter(Boolean);
        return { title: '🕘 Recent', sub: '', kind: 'tracks', tracks };
      }
      case 'artists': {
        const artists = this.artists;
        return { title: '👤 Artists', sub: artists.length + ' artist' + (artists.length === 1 ? '' : 's'), kind: 'artists' };
      }
      case 'genres': {
        const genres = this.genres;
        return { title: '🎼 Genres', sub: genres.length + ' genre' + (genres.length === 1 ? '' : 's'), kind: 'genres' };
      }
      case 'albums': {
        const groups = this._albumGroups();
        return { title: '💿 Albums', sub: groups.length + ' album' + (groups.length === 1 ? '' : 's'), kind: 'albums', groups };
      }
      case 'all':
      default: {
        const tracks = this._sorted(this.tracks);
        return { title: '🏠 All Music', sub: tracks.length + ' track' + (tracks.length === 1 ? '' : 's'), kind: 'tracks', tracks };
      }
    }
  },

  _centerTitle: function() {
    const c = this._centerContext();
    return c.title;
  },

  renderCenter: function() {
    const body = document.getElementById('music-center-body');
    if (!body) return;
    const ctx = this._centerContext();
    const titleEl = document.getElementById('music-center-title');
    if (titleEl) titleEl.textContent = ctx.title;
    const subEl = document.getElementById('music-center-sub');
    if (subEl) subEl.textContent = ctx.sub || '';
    this._renderInto(body, ctx);
    const np = this._nowPlayingTrack();
    this._highlightTrack(np ? np.path : null);
    this._updateMobileLabel();
    this._updateUndoButton();
  },

  _renderInto: function(body, ctx) {
    this._clickSource = ctx.tracks || [];
    this._playlistCtxId = ctx.playlistId || null;
    if (!this.tracks.length) {
      body.innerHTML = this._emptyStateHtml('No music in your library yet.',
        'Pick a folder to scan and your tracks will appear here — and stay here, even after restarting the app.',
        '<button onclick="MusicPlayer.addFolders()" class="px-4 py-2 bg-[var(--accent-blue)] hover:brightness-110 text-white font-black text-xs border-2 border-black cursor-pointer shadow-[3px_3px_0_0_#000]">＋ Add Music Folder</button>');
      return;
    }
    if (ctx.kind === 'artists') { this._renderArtistList(body); return; }
    if (ctx.kind === 'genres') { this._renderGenreList(body); return; }
    if (ctx.kind === 'albums') { this._renderAlbumList(body, ctx.groups || []); return; }
    if (ctx.kind === 'album-detail') {
      body.innerHTML = '<button class="px-2 py-1 text-[9px] font-black uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer mb-1" onclick="MusicPlayer._backFromAlbum()">← Back</button>' +
        '<div class="flex items-center gap-2.5 mb-2">' +
        this._artHtml(ctx.group.tracks[0], 'w-14 h-14 object-cover border-2 border-black flex-shrink-0') +
        '<div class="min-w-0"><div class="text-xs font-black text-[var(--text-main)] truncate">' + esc(ctx.group.album || 'Unknown Album') + '</div>' +
        '<div class="text-[10px] text-zinc-400 truncate">' + esc(ctx.group.artist || '') + '</div>' +
        '<div class="text-[9px] text-zinc-500">' + ctx.group.tracks.length + ' track' + (ctx.group.tracks.length === 1 ? '' : 's') + (ctx.group.year ? ' · ' + esc(ctx.group.year) : '') + '</div></div></div>';
      this._clickSource = ctx.group.tracks;
      this._renderList(body, ctx.group.tracks, this._playlistCtxId);
      return;
    }
    const tracks = ctx.tracks || [];
    if (!tracks.length) {
      body.innerHTML = this._emptyStateHtml(
        this.search ? 'No tracks match your search.' : 'Nothing here yet.',
        this.search
          ? 'Try a different song, artist, album, or genre keyword.'
          : 'Add tracks to this view and they will appear here.',
        this.search
          ? '<button onclick="MusicPlayer.clearSearch()" class="px-4 py-2 bg-[var(--accent-blue)] hover:brightness-110 text-white font-black text-xs border-2 border-black cursor-pointer shadow-[3px_3px_0_0_#000]">✕ Clear Search</button>'
          : '',
        this.search ? '🔍' : '📂');
      return;
    }
    this._renderList(body, tracks, this._playlistCtxId);
    this._playlistCtxId = null;
  },

  _sorted: function(list) {
    const key = this.sortKey, dir = this.sortDir;
    return [...list].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'trackNo') { va = va == null ? Infinity : va; vb = vb == null ? Infinity : vb; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  },

  get artists() {
    const map = {};
    for (const t of this.tracks) {
      const name = t.artist || 'Unknown Artist';
      if (!map[name]) map[name] = { name, tracks: 0, albums: new Set() };
      map[name].tracks++;
      if (t.album) map[name].albums.add(String(t.album).toLowerCase());
    }
    return Object.values(map).map(a => ({ name: a.name, tracks: a.tracks, albums: a.albums.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  _albumKey: function(t) {
    return String(t.album || 'Unknown Album').toLowerCase() + '::' + String(t.albumArtist || t.artist || '').toLowerCase();
  },

  _albumGroups: function() {
    const map = {};
    for (const t of this.tracks) {
      if (!t.album) continue;
      const key = this._albumKey(t);
      if (!map[key]) map[key] = { key, album: t.album, artist: t.albumArtist || t.artist || '', year: t.year, tracks: [] };
      map[key].tracks.push(t);
    }
    const groups = Object.values(map);
    for (const g of groups) g.tracks.sort((a, b) => (a.trackNo == null ? 999 : +a.trackNo) - (b.trackNo == null ? 999 : +b.trackNo));
    const key = this.sortKey, dir = this.sortDir;
    return groups.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'trackNo') { va = a.tracks.length; vb = b.tracks.length; }
      if (key === 'duration') { va = a.tracks.reduce((x, t) => x + (t.duration || 0), 0); vb = b.tracks.reduce((x, t) => x + (t.duration || 0), 0); }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  },

  _albumTracks: function(key) {
    const g = this._albumGroups().find(g2 => g2.key === key);
    return g ? g.tracks : [];
  },

  _renderArtistList: function(body) {
    body.innerHTML = '<div class="p-1">' + this.artists.map(a =>
      '<button class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.04] cursor-pointer text-left" onclick="MusicPlayer._drillArtist(\'' + esc(a.name) + '\')">' +
      '<span class="text-base">👤</span>' +
      '<span class="flex-1 min-w-0 text-[11px] font-black text-[var(--text-main)] truncate">' + esc(a.name) + '</span>' +
      '<span class="text-[9px] text-zinc-500 flex-shrink-0">' + a.albums + ' album' + (a.albums === 1 ? '' : 's') + ' · ' + a.tracks + ' track' + (a.tracks === 1 ? '' : 's') + '</span>' +
      '<span class="text-[10px] text-zinc-500 flex-shrink-0">▶</span></button>'
    ).join('') + '</div>';
  },

  _renderGenreList: function(body) {
    const items = this.genres.map(g => {
      const count = this.tracks.filter(t => String(t.genre || '').toLowerCase() === g.toLowerCase()).length;
      return '<button class="px-3 py-1.5 border-2 border-black bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] text-[var(--text-main)] font-black text-[10px] cursor-pointer" onclick="MusicPlayer._drillGenre(\'' + esc(g) + '\')">🎼 ' + esc(g) + ' <span class="text-zinc-500">(' + count + ')</span></button>';
    }).join('');
    body.innerHTML = items
      ? '<div class="p-1 flex flex-wrap gap-1.5">' + items + '</div>'
      : this._emptyStateHtml('No genres yet.', 'Genres appear here once your tracks have genre tags.', '', '🎼');
  },

  _renderAlbumGrid: function(body, groups) {
    if (!groups.length) { body.innerHTML = this._emptyStateHtml('No albums yet.', 'Albums appear here once your tracks have album tags.', '', '💿'); return; }
    body.innerHTML = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5 p-1">' + groups.map(g => {
      const first = g.tracks[0];
      const art = (first && first.art)
        ? '<img loading="lazy" src="data:' + first.art.mime + ';base64,' + first.art.base64 + '" class="w-full h-full object-cover">'
        : this._coverHtml(first, 'w-full h-full', '34px');
      return '<div class="music-card group relative section-card p-2 flex flex-col gap-1.5 cursor-pointer select-none" onclick="MusicPlayer._drillAlbum(\'' + esc(g.key) + '\')">' +
        '<div class="relative aspect-square w-full overflow-hidden border-2 border-black bg-black">' + art +
        '<div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"><span class="text-2xl">▶️</span></div></div>' +
        '<div class="min-w-0"><div class="text-[10px] font-black text-[var(--text-main)] truncate">' + esc(g.album || 'Unknown Album') + '</div>' +
        '<div class="text-[9px] text-zinc-500 truncate font-bold">' + esc(g.artist || '') + '</div>' +
        '<div class="text-[8px] text-zinc-600">' + g.tracks.length + ' track' + (g.tracks.length === 1 ? '' : 's') + '</div></div></div>';
    }).join('') + '</div>';
  },

  _renderAlbumList: function(body, groups) {
    if (!groups.length) { body.innerHTML = '<div class="text-center text-zinc-500 italic text-xs py-16">No albums yet.</div>'; return; }
    body.innerHTML = '<div class="p-1 flex flex-col gap-0.5">' + groups.map(g => {
      const first = g.tracks[0];
      const art = (first && first.art)
        ? '<img loading="lazy" src="data:' + first.art.mime + ';base64,' + first.art.base64 + '" class="w-8 h-8 object-cover border border-black flex-shrink-0">'
        : this._coverHtml(first, 'w-8 h-8 border border-black', '13px');
      const ttl = g.tracks.reduce((a, t) => a + (t.duration || 0), 0);
      return '<div class="flex items-center gap-2 px-2 py-1.5 hover:bg-white/[0.04] cursor-pointer select-none" onclick="MusicPlayer._drillAlbum(\'' + esc(g.key) + '\')">' +
        art +
        '<div class="flex-1 min-w-0"><div class="text-[10.5px] font-black text-[var(--text-main)] truncate">' + esc(g.album || 'Unknown Album') + '</div>' +
        '<div class="text-[9px] text-zinc-500 truncate">' + esc(g.artist || '') + ' · ' + g.tracks.length + ' track' + (g.tracks.length === 1 ? '' : 's') + ' · ' + this._fmtTime(ttl) + '</div></div>' +
        '<span class="text-[9px] text-zinc-600 flex-shrink-0">' + (g.year || '') + '</span></div>';
    }).join('') + '</div>';
  },

  _drillArtist: function(name) {
    this.leftSel = 'artists';
    this.selArtist = name;
    this.selAlbum = null; this.selGenre = null;
    this._updateNavActive();
    this.renderCenter();
  },

  _drillAlbum: function(key) {
    this.leftSel = 'albums';
    this.selAlbum = key;
    this.selArtist = null; this.selGenre = null;
    this._updateNavActive();
    this.renderCenter();
  },

  _drillGenre: function(genre) {
    this.leftSel = 'genres';
    this.selGenre = genre;
    this.selAlbum = null; this.selArtist = null;
    this._updateNavActive();
    this.renderCenter();
  },

  _backFromAlbum: function() { this.selAlbum = null; this.renderCenter(); },
  _backFromArtist: function() { this.selArtist = null; this.renderCenter(); },
  _backFromGenre: function() { this.selGenre = null; this.renderCenter(); },

  // ==================================================== favorites + recent
  toggleFavorite: function(path, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    if (!path) return;
    const i = this.favorites.indexOf(path);
    if (i >= 0) this.favorites.splice(i, 1);
    else this.favorites.push(path);
    this._saveConfigDebounced();
    const on = this.favorites.includes(path);
    this._toast(on ? 'Added to favorites.' : 'Removed from favorites.', '⭐');
    // Update every visible star for this track immediately (no re-render needed).
    document.querySelectorAll('[aria-label="favorite"]').forEach(b => {
      if (b.dataset.path !== path) return;
      b.textContent = on ? '★' : '☆';
      b.title = on ? 'Remove from favorites' : 'Add to favorites';
      b.classList.toggle('text-amber-300', on);
      b.classList.toggle('text-zinc-500', !on);
    });
    if (this.leftSel === 'favorites') this.renderCenter();
    if (this.rightMode === 'now') this.renderRight();
  },

  _noteRecent: function(path) {
    if (!path) return;
    this.recent = this.recent.filter(r => r.path !== path);
    this.recent.unshift({ path, at: Date.now() });
    if (this.recent.length > 50) this.recent.length = 50;
    this._saveConfigDebounced();
  },

  _artHtml: function(track, cls) {
    if (track && track.art) return '<img src="data:' + track.art.mime + ';base64,' + track.art.base64 + '" class="' + cls + '" alt="">';
    return this._coverHtml(track, cls);
  },

  // Deterministic colored cover used for tracks that have no embedded artwork.
  _COVER_PALETTES: [
    ['#f472b6', '#be185d'],
    ['#fbbf24', '#b45309'],
    ['#34d399', '#047857'],
    ['#60a5fa', '#1d4ed8'],
    ['#a78bfa', '#6d28d9'],
    ['#f87171', '#b91c1c'],
    ['#22d3ee', '#0e7490'],
    ['#fb923c', '#c2410c'],
    ['#a3e635', '#4d7c0f'],
    ['#f9a8d4', '#db2777'],
    ['#818cf8', '#4338ca'],
    ['#2dd4bf', '#0f766e']
  ],

  _coverSeed: function(track) {
    const s = String((track && (track.title || track.name)) || 'x').toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  },

  _coverGradient: function(track) {
    return this._COVER_PALETTES[this._coverSeed(track) % this._COVER_PALETTES.length];
  },

  _coverHtml: function(track, cls, textSize, extraStyle) {
    const g = this._coverGradient(track);
    const title = String((track && (track.title || track.name)) || '').replace(/\.[^.]+$/, '').trim();
    const letter = title ? title.charAt(0).toUpperCase() : '♪';
    return '<div class="' + cls + ' flex items-center justify-center text-white font-black select-none flex-shrink-0 overflow-hidden" style="background:linear-gradient(135deg,' + g[0] + ',' + g[1] + ');font-size:' + (textSize || '16px') + ';aspect-ratio:1/1;' + (extraStyle || '') + '">' + esc(letter) + '</div>';
  },

  // Small square star-only favorite toggle for list rows / grid hover.
  _favBtnSm: function(path) {
    const on = path && this.favorites.includes(path);
    return '<button data-path="' + esc(path) + '" title="' + (on ? 'Remove from favorites' : 'Add to favorites') + '" aria-label="favorite" class="w-6 h-6 flex items-center justify-center text-[11px] font-black border-2 border-black bg-[var(--bg-input)] hover:brightness-110 cursor-pointer flex-shrink-0 ' + (on ? 'text-amber-300' : 'text-zinc-500') + '" onclick="event.stopPropagation();MusicPlayer.toggleFavorite(\'' + path.replace(/'/g, '\\\'') + '\')">' + (on ? '★' : '☆') + '</button>';
  },

  _renderGrid: function(container, list) {
    const cards = list.map((t, i) => {
      const artHtml = t.art
        ? '<img loading="lazy" src="data:' + t.art.mime + ';base64,' + t.art.base64 + '" class="w-full h-full object-cover" alt="">'
        : this._coverHtml(t, 'w-full h-full', '30px');
      const meta = (t.title || t.name.replace(/\.[^.]+$/, '')) + (t.artist ? ' — ' + t.artist : '');
      return '' +
        '<div class="music-card group relative section-card p-2 flex flex-col gap-1.5 cursor-pointer select-none" ' +
        'data-idx="' + i + '" data-path="' + esc(t.path) + '" ' +
        'onclick="MusicPlayer.playTracks(MusicPlayer._clickSource, ' + i + ')" ' +
        'ondblclick="MusicPlayer.openTagEditor(MusicPlayer._clickSource[' + i + '])" ' +
        'title="' + esc(meta) + '">' +
        '<div class="relative aspect-square w-full overflow-hidden border-2 border-black bg-black flex items-center justify-center">' +
        artHtml +
        '<div class="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">' +
        '<span class="text-2xl">▶️</span>' +
        this._favBtnSm(t.path) +
        '<button class="w-7 h-7 bg-black/70 rounded flex items-center justify-center text-sm cursor-pointer" title="Add to playlist" onclick="event.stopPropagation(); MusicPlayer.addToPlaylist(MusicPlayer._clickSource[' + i + '])">➕</button>' +
        (this._playlistCtxId ? '<button class="w-7 h-7 bg-black/70 rounded flex items-center justify-center text-sm cursor-pointer" title="Remove from playlist" onclick="event.stopPropagation(); MusicPlayer.removeFromPlaylist(\'' + this._playlistCtxId + '\', MusicPlayer._clickSource[' + i + '].path)">🗑️</button>' : '') +
        '</div></div>' +
        '<div class="min-w-0">' +
        '<div class="text-[10px] font-black text-[var(--text-main)] truncate">' + esc(t.title || t.name.replace(/\.[^.]+$/, '')) + '</div>' +
        '<div class="text-[9px] text-zinc-500 truncate font-bold">' + esc(t.artist || 'Unknown Artist') + '</div>' +
        '<div class="flex items-center justify-between mt-0.5">' +
        '<span class="text-[8px] text-zinc-500 truncate">' + esc(t.album || '') + '</span>' +
        '<span class="text-[8px] font-mono text-zinc-500 flex-shrink-0">' + this._fmtDuration(t.duration) + '</span>' +
        '</div></div></div>';
    }).join('');
    container.innerHTML = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 p-1">' + cards + '</div>';
  },

  _renderList: function(container, list, playlistCtxId) {
    const cols = this._COLUMNS;
    const order = this.colOrder.slice();
    const widths = this.colWidths;
    const visible = order.filter(k => !this.colHidden[k]);
    const sortBtn = (c) => {
      const on = this.sortKey === c.sortKey;
      const arrow = on ? (this.sortDir === 1 ? '▲' : '▼') : '';
      // Reserve a fixed slot for the sort arrow so right-aligned headers (Year/Time)
      // never shift when one of them gets sorted — that shift is what made "YEAR"
      // and "TIME▲" visually merge into "YEARTIME".
      return '<button type="button" class="no-tactile music-sort-btn inline-flex items-center text-[8px] font-black uppercase tracking-wider cursor-pointer whitespace-nowrap ' +
        (on ? 'text-[var(--accent-blue)]' : 'text-zinc-400 hover:text-[var(--accent-blue)]') + '" ' +
        'onclick="MusicPlayer.setSort(\'' + c.sortKey + '\')" title="Sort by ' + c.label + '">' +
        c.label + '<span class="inline-block w-[10px] text-center flex-shrink-0">' + arrow + '</span></button>';
    };
    const columnHeader = (key) => {
      const c = cols[key];
      const w = widths[key] || c.w;
      const align = c.align === 'right' ? 'justify-end' : (c.align === 'center' ? 'justify-center' : '');
      const draggable = key !== 'no' ? ' draggable="true"' : '';
      const resizer = c.flex ? '' : '<div class="music-col-resizer" data-col="' + key + '"></div>';
      return '<div class="music-col-head flex items-center select-none ' + (c.flex ? 'flex-1 min-w-0' : 'flex-shrink-0') + '" data-col="' + key + '"' + draggable +
        (c.flex ? '' : ' style="width:' + w + 'px"') + '>' +
        '<div class="music-col-label flex items-center min-w-0 px-1 w-full ' + align + '">' + sortBtn(c) + '</div>' + resizer + '</div>';
    };
    const rows = list.map((t, i) => {
      const art = t.art
        ? '<img loading="lazy" src="data:' + t.art.mime + ';base64,' + t.art.base64 + '" class="w-8 h-8 object-cover border border-black flex-shrink-0">'
        : this._coverHtml(t, 'w-8 h-8 border border-black', '13px');
      const cells = visible.map(key => {
        const c = cols[key];
        const w = widths[key] || c.w;
        const align = c.align === 'right' ? ' justify-end' : (c.align === 'center' ? ' justify-center' : '');
        let inner;
        if (key === 'no') inner = '<span class="text-[9px] font-mono text-zinc-500">' + (t.trackNo || '') + '</span>';
        else if (key === 'title') inner = '<div class="music-mq text-[10.5px] font-black text-[var(--text-main)]">' + esc(t.title || t.name.replace(/\.[^.]+$/, '')) + '</div>';
        else if (key === 'artist') inner = '<div class="music-mq text-[10px] text-zinc-400 font-bold">' + esc(t.artist || 'Unknown Artist') + '</div>';
        else if (key === 'album') inner = '<div class="music-mq text-[10px] text-zinc-500">' + esc(t.album || '') + '</div>';
        else if (key === 'genre') inner = '<div class="music-mq text-[10px] text-zinc-500">' + esc(t.genre || '') + '</div>';
        else if (key === 'year') inner = '<div class="music-mq text-[10px] text-zinc-500">' + esc(t.year || '') + '</div>';
        else inner = '<div class="music-mq text-[10px] font-mono text-zinc-500">' + this._fmtDuration(t.duration) + '</div>';
        return '<div class="music-col-cell flex items-center min-w-0 px-1 ' + (c.flex ? 'flex-1' : 'flex-shrink-0') + align + '" data-col="' + key + '"' +
          (c.flex ? '' : ' style="width:' + w + 'px"') + '>' + inner + '</div>';
      }).join('');
      return '<div class="flex items-center gap-3 px-2 py-1.5 hover:bg-white/[0.04] cursor-pointer select-none music-row' +
        (this._selPaths.includes(t.path) ? ' music-row-selected' : '') + '" ' +
        'data-idx="' + i + '" data-path="' + esc(t.path) + '"' + (playlistCtxId ? ' data-pl="' + playlistCtxId + '"' : '') + ' ' +
        'draggable="true" ' +
        'onclick="MusicPlayer._rowClick(' + i + ', event)" ' +
        'ondblclick="MusicPlayer.onRowDblClick(event, ' + i + ')" ' +
        'oncontextmenu="event.preventDefault(); MusicPlayer._openRowMenu(event, ' + i + ')">' +
        art + cells + '</div>';
    }).join('');
    const selBar = this._selPaths.length > 1 ? this._selBarHtml() : '';
    container.innerHTML = selBar +
      '<div class="p-1"><div class="music-list-head flex items-center gap-3 px-2 py-1.5 mb-1 text-zinc-500 border-b-2 border-black/70">' +
      '<div class="w-8 flex-shrink-0"></div>' +
      visible.map(columnHeader).join('') +
      '<div class="music-col-menu-btn flex-shrink-0 self-stretch flex items-center px-1.5 text-[11px] font-black text-zinc-400 hover:text-[var(--accent-blue)] cursor-pointer select-none no-tactile ml-auto" title="Show / hide columns" onclick="MusicPlayer.toggleColumnMenu(event)">☰</div>' +
      '</div>' + rows + '</div>';
    this._mqify(container);
    this._bindColumnDrags(container);
  },

  // Explorer-style header behaviour: drag the right edge of a column to resize
  // it, or drag a column header left/right to reorder columns. Both persist.
  _bindColumnDrags: function(container) {
    if (!container || container.dataset.colsBound) return;
    container.dataset.colsBound = '1';
    const self = this;
    let dragKey = null;

    container.addEventListener('pointerdown', (e) => {
      const rz = e.target.closest('.music-col-resizer');
      if (!rz) return;
      const colHead = rz.closest('.music-col-head');
      if (!colHead) return;
      const key = colHead.dataset.col;
      const startX = e.clientX;
      const startW = colHead.getBoundingClientRect().width;
      e.preventDefault();
      const move = (ev) => {
        const w = Math.max(32, Math.min(420, Math.round(startW + (ev.clientX - startX))));
        colHead.style.width = w + 'px';
        self.colWidths[key] = w;
        container.querySelectorAll('.music-col-cell[data-col="' + key + '"]').forEach(cel => { cel.style.width = w + 'px'; });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        self._saveConfig();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    container.addEventListener('dragstart', (e) => {
      const ch = e.target.closest('.music-col-head');
      if (ch && ch.draggable) {
        dragKey = ch.dataset.col;
        e.dataTransfer.setData('text/plain', dragKey);
        e.dataTransfer.effectAllowed = 'move';
        ch.classList.add('music-col-dragging');
        return;
      }
      const row = e.target.closest('.music-row');
      if (row) { this._onRowDragStart(e, row); return; }
      e.preventDefault();
    });
    container.addEventListener('dragover', (e) => {
      const ch = e.target.closest('.music-col-head');
      if (!ch || !dragKey || ch.dataset.col === dragKey) return;
      e.preventDefault();
      container.querySelectorAll('.music-col-head').forEach(h => h.classList.remove('music-col-before', 'music-col-after'));
      ch.classList.add((e.clientX - ch.getBoundingClientRect().left) / ch.getBoundingClientRect().width > 0.5 ? 'music-col-after' : 'music-col-before');
    });
    container.addEventListener('dragleave', (e) => {
      if (e.target.closest && e.target.closest('.music-col-head') && !e.relatedTarget) {
        container.querySelectorAll('.music-col-head').forEach(h => h.classList.remove('music-col-before', 'music-col-after'));
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const ch = e.target.closest('.music-col-head');
      container.querySelectorAll('.music-col-head').forEach(h => h.classList.remove('music-col-before', 'music-col-after', 'music-col-dragging'));
      if (!ch || !dragKey || ch.dataset.col === dragKey) { dragKey = null; return; }
      const rect = ch.getBoundingClientRect();
      const placeAfter = (e.clientX - rect.left) / rect.width > 0.5;
      const from = self.colOrder.indexOf(dragKey);
      const to = self.colOrder.indexOf(ch.dataset.col);
      if (from < 0 || to < 0) { dragKey = null; return; }
      self.colOrder.splice(from, 1);
      const target = self.colOrder.indexOf(ch.dataset.col);
      self.colOrder.splice(target + (placeAfter ? 1 : 0), 0, dragKey);
      dragKey = null;
      self._saveConfig();
      self.renderCenter();
    });
    container.addEventListener('dragend', () => {
      dragKey = null;
      container.querySelectorAll('.music-col-head').forEach(h => h.classList.remove('music-col-before', 'music-col-after', 'music-col-dragging'));
    });

    container.addEventListener('contextmenu', (e) => {
      const head = e.target.closest('.music-col-head') || e.target.closest('.music-list-head');
      if (!head) return;
      e.preventDefault();
      e.stopPropagation();
      this._openColumnMenu(e.clientX, e.clientY);
    });

    container.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.music-row');
      if (!row) return;
      e.preventDefault();
      this._openRowMenu(e, parseInt(row.dataset.idx, 10));
    });
  },

  _openRowMenu: function(ev, index) {
    const t = (this._clickSource || [])[index];
    if (!t) return;
    // If a multi-selection exists and the clicked row is part of it, show the
    // bulk menu (acts on all selected tracks) instead of the single-track menu.
    if (this._selPaths.length > 1 && this._selPaths.includes(t.path)) {
      this._showBulkMenu(ev.clientX, ev.clientY);
      return;
    }
    const row = ev.target && ev.target.closest ? ev.target.closest('.music-row') : null;
    this._showRowMenu(ev.clientX, ev.clientY, t, index, row && row.dataset.pl ? row.dataset.pl : null);
  },

  _showBulkMenu: function(x, y) {
    const n = this._selPaths.length;
    const items = [
      { label: '▶️ Play (' + n + ')', fn: 'MusicPlayer._playSelected()' },
      { label: '⭐ Favorite', fn: 'MusicPlayer._bulkFavorite()' },
      { label: '📃 Add to playlist', fn: 'MusicPlayer._bulkAddToPlaylist()' }
    ];
    if (this._isDesktop()) items.push({ label: '✏️ Edit tags', fn: 'MusicPlayer._bulkEditTags()' });
    items.push({ label: '✕ Clear selection', fn: 'MusicPlayer._clearSelection()' });
    const menu = document.createElement('div');
    menu.className = 'music-pop-menu music-row-menu';
    menu.style.minWidth = '170px';
    document.body.appendChild(menu);
    menu.innerHTML = items.map(it =>
      '<button class="no-tactile text-left px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 hover:bg-white/[0.07] hover:text-white cursor-pointer" onclick="MusicPlayer._hideRowMenu();' + it.fn + '">' + it.label + '</button>'
    ).join('');
    this._positionMenu(menu, x, y);
    this._rowMenuEl = menu;
    this._rowMenuVanish = (e) => {
      if (menu.contains(e.target)) return;
      this._hideRowMenu();
    };
    document.addEventListener('mousedown', this._rowMenuVanish, true);
    document.addEventListener('wheel', this._rowMenuVanish, true);
    window.addEventListener('resize', this._rowMenuVanish);
    document.addEventListener('keydown', this._rowMenuKey);
  },

  _showRowMenu: function(x, y, track, index, plid) {
    this._hideRowMenu();
    const on = this.favorites.includes(track.path);
    const items = [
      { label: '▶️ Play', fn: 'MusicPlayer.playTracks(MusicPlayer._clickSource, ' + index + ')' },
      { label: on ? '☆ Remove from favorites' : '⭐ Add to favorites', fn: 'MusicPlayer._toggleFavByIndex(' + index + ')' },
      { label: '📃 Add to playlist', fn: 'MusicPlayer.addToPlaylist(MusicPlayer._clickSource[' + index + '])' },
      { label: '✏️ Edit tags', fn: 'MusicPlayer.openTagEditor(MusicPlayer._clickSource[' + index + '])' },
      { label: '🔄 Re-read tags', fn: 'MusicPlayer.refreshTrackMeta(MusicPlayer._clickSource[' + index + '].path)' }
    ];
    if (plid) {
      items.push({ label: '🗑️ Remove from playlist', fn: 'MusicPlayer.removeFromPlaylist(\'' + plid + '\', MusicPlayer._clickSource[' + index + '].path)' });
    }
    const menu = document.createElement('div');
    menu.className = 'music-pop-menu music-row-menu';
    menu.style.minWidth = '170px';
    document.body.appendChild(menu);
    menu.innerHTML = items.map(it =>
      '<button class="no-tactile text-left px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 hover:bg-white/[0.07] hover:text-white cursor-pointer" onclick="MusicPlayer._hideRowMenu();' + it.fn + '">' + it.label + '</button>'
    ).join('');
    this._positionMenu(menu, x, y);
    this._rowMenuEl = menu;
    this._rowMenuVanish = (e) => {
      if (menu.contains(e.target)) return;
      this._hideRowMenu();
    };
    document.addEventListener('mousedown', this._rowMenuVanish, true);
    document.addEventListener('wheel', this._rowMenuVanish, true);
    window.addEventListener('resize', this._rowMenuVanish);
    document.addEventListener('keydown', this._rowMenuKey);
  },

  _rowMenuKey: (e) => { if (e.key === 'Escape') window.MusicPlayer && window.MusicPlayer._hideRowMenu(); },

  _hideRowMenu: function() {
    if (this._rowMenuEl) { this._rowMenuEl.remove(); this._rowMenuEl = null; }
    if (this._rowMenuVanish) {
      document.removeEventListener('mousedown', this._rowMenuVanish, true);
      document.removeEventListener('wheel', this._rowMenuVanish, true);
      window.removeEventListener('resize', this._rowMenuVanish);
      document.removeEventListener('keydown', this._rowMenuKey);
      this._rowMenuVanish = null;
    }
  },

  // ============================================ column hide/show (Explorer-style)
  toggleColumnMenu: function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const p = this._colMenuPos || { x: 140, y: 120 };
    this._openColumnMenu(e ? e.clientX : p.x, e ? e.clientY : p.y);
  },

  _openColumnMenu: function(x, y) {
    this._hideColMenu();
    this._colMenuPos = { x: x, y: y };
    const visCount = this.colOrder.filter(k => !this.colHidden[k]).length;
    const items = this.colOrder.map(k => {
      const c = this._COLUMNS[k];
      const hidden = !!this.colHidden[k];
      const locked = !hidden && visCount <= 1; // keep at least one column visible
      return '<label class="no-tactile flex items-center gap-2 px-2.5 py-1 text-[10px] font-bold cursor-pointer select-none ' +
        (locked ? 'opacity-40 pointer-events-none' : 'hover:bg-white/[0.07]') + '" title="' + (locked ? 'Keep at least one column visible' : '') + '">' +
        '<input type="checkbox" class="accent-[var(--accent-blue)]" ' + (hidden ? '' : 'checked') +
        (locked ? ' disabled' : '') + ' onchange="MusicPlayer.toggleColumn(\'' + k + '\')">' +
        '<span class="text-zinc-200">' + c.label + '</span></label>';
    }).join('');
    const menu = document.createElement('div');
    menu.className = 'music-pop-menu';
    menu.style.minWidth = '150px';
    document.body.appendChild(menu);
    menu.innerHTML = items +
      '<div class="border-t border-black/60 mt-1 pt-1">' +
      '<button class="no-tactile text-left w-full px-2.5 py-1 text-[10px] font-bold text-[var(--accent-blue)] hover:brightness-125 cursor-pointer" onclick="MusicPlayer.resetColumns()">↺ Reset columns</button></div>';
    this._positionMenu(menu, x, y);
    this._colMenuEl = menu;
    this._colMenuVanish = (e) => {
      if (menu.contains(e.target)) return;
      this._hideColMenu();
    };
    document.addEventListener('mousedown', this._colMenuVanish, true);
    document.addEventListener('wheel', this._colMenuVanish, true);
    window.addEventListener('resize', this._colMenuVanish);
    document.addEventListener('keydown', this._colMenuKey);
  },

  toggleColumn: function(k) {
    if (!this._COLUMNS[k]) return;
    const visible = this.colOrder.filter(z => !this.colHidden[z]);
    if (this.colHidden[k]) {
      delete this.colHidden[k];
    } else {
      if (visible.length <= 1) { this._toast('Keep at least one column visible.', '⚠️'); return; }
      this.colHidden[k] = true;
    }
    this._saveConfig();
    this.renderCenter();
    if (this._colMenuPos) this._openColumnMenu(this._colMenuPos.x, this._colMenuPos.y);
  },

  resetColumns: function() {
    this.colHidden = {};
    this.colWidths = {};
    this._hideColMenu();
    this._saveConfig();
    this.renderCenter();
  },

  _colMenuKey: (e) => { if (e.key === 'Escape') window.MusicPlayer && window.MusicPlayer._hideColMenu(); },

  _positionMenu: function(menu, x, y) {
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 8)) + 'px';
  },

  _hideColMenu: function() {
    if (this._colMenuEl) { this._colMenuEl.remove(); this._colMenuEl = null; }
    if (this._colMenuVanish) {
      document.removeEventListener('mousedown', this._colMenuVanish, true);
      document.removeEventListener('wheel', this._colMenuVanish, true);
      window.removeEventListener('resize', this._colMenuVanish);
      document.removeEventListener('keydown', this._colMenuKey);
      this._colMenuVanish = null;
    }
  },

  // Activate the marquee-scroll effect on overflowing text cells in the
  // "All Music" list so long titles/artists/albums scroll instead of clamping.
  _mqify: function(container) {
    if (!container) return;
    requestAnimationFrame(() => {
      const cells = container.querySelectorAll('.music-mq');
      cells.forEach(el => {
        const was = el.classList.contains('music-mq-over');
        if (el.scrollWidth > el.clientWidth) {
          el.classList.add('music-mq-over');
          el.style.setProperty('--scroll-dist', (el.clientWidth - el.scrollWidth - 14) + 'px');
        } else {
          el.classList.remove('music-mq-over');
        }
        // Re-trigger the hover animation after a re-render while hovering.
        if (was && el.classList.contains('music-mq-over')) {
          el.style.animation = 'none';
          void el.offsetHeight;
          el.style.animation = '';
        }
      });
    });
  },

  renderPlaylists: function() {
    const container = document.getElementById('music-view-playlists');
    if (!container) return;

    let html = '<div class="flex items-center justify-between px-1 pb-2">' +
      '<span class="text-xs font-black uppercase tracking-widest text-zinc-400">My Playlists</span>' +
      '<button onclick="MusicPlayer.createPlaylist()" class="px-3 py-1.5 bg-[var(--accent-blue)] hover:brightness-110 text-white font-black text-[10px] border-2 border-black cursor-pointer shadow-[2px_2px_0_0_#000]">＋ New</button></div>';

    if (!this.playlists.length) {
      html += '<div class="text-zinc-500 italic text-xs px-1 py-6 text-center">Create a playlist to collect your favourite tracks.</div>';
    } else {
      html += '<div class="space-y-1.5">' + this.playlists.map(p => {
        const count = p.trackPaths.filter(p => this.tracks.some(t => t.path === p)).length;
        return '<div class="section-card p-2.5 flex items-center gap-2.5 select-none">' +
          '<span class="text-lg">📃</span>' +
          '<div class="flex-1 min-w-0 cursor-pointer" onclick="MusicPlayer.playPlaylist(\'' + p.id + '\')">' +
          '<div class="text-xs font-black text-[var(--text-main)] truncate">' + esc(p.name) + '</div>' +
          '<div class="text-[9px] text-zinc-500">' + count + ' track' + (count === 1 ? '' : 's') + '</div></div>' +
          '<button class="px-2 py-1 text-[9px] font-black text-zinc-300 hover:text-white border border-black bg-[var(--bg-input)] cursor-pointer" onclick="MusicPlayer.savePlaylistToDisk(\'' + p.id + '\')" title="Save as .m3u8">💾</button>' +
          '<button class="px-2 py-1 text-[9px] font-black text-rose-300 hover:text-rose-200 border border-black bg-[var(--bg-input)] cursor-pointer" onclick="MusicPlayer.removePlaylist(\'' + p.id + '\')" title="Delete">✕</button>' +
          '</div>';
      }).join('') + '</div>';
    }

    html += '<div class="flex items-center justify-between px-1 py-3 mt-2 border-t border-[var(--border-color)]">' +
      '<span class="text-xs font-black uppercase tracking-widest text-zinc-400">Detected on Disk</span></div>';

    if (!this.detectedPlaylists.length) {
      html += '<div class="text-zinc-500 italic text-xs px-1 py-4 text-center">No .m3u / .pls / .xspf playlists found in your folders yet.</div>';
    } else {
      html += '<div class="space-y-1.5">' + this.detectedPlaylists.map(p =>
        '<div class="section-card p-2.5 flex items-center gap-2.5 select-none cursor-pointer hover:brightness-110" onclick="MusicPlayer.playDetectedPlaylist(\'' + p.id + '\')">' +
        '<span class="text-lg">🗂️</span>' +
        '<div class="flex-1 min-w-0"><div class="text-xs font-black text-[var(--text-main)] truncate">' + esc(p.name) + '</div>' +
        '<div class="text-[9px] text-zinc-500 truncate">' + esc(p.rel) + '</div></div>' +
        '<span class="text-[9px] text-zinc-500">▶</span></div>'
      ).join('') + '</div>';
    }
    container.innerHTML = html;
  },

  renderFolders: function() {
    const container = document.getElementById('music-view-folders');
    if (!container) return;
    let html = '<div class="flex items-center justify-between px-1 pb-2">' +
      '<span class="text-xs font-black uppercase tracking-widest text-zinc-400">Music Folders</span>' +
      '<div class="flex gap-1.5">' +
      '<button onclick="MusicPlayer.addFolders()" class="px-2.5 py-1.5 bg-[var(--accent-blue)] hover:brightness-110 text-white font-black text-[10px] border-2 border-black cursor-pointer shadow-[2px_2px_0_0_#000]">＋ Add</button>' +
      '<button onclick="MusicPlayer.refreshLibrary()" class="px-2.5 py-1.5 text-[var(--text-main)] font-black text-[10px] border-2 border-black bg-[var(--bg-input)] cursor-pointer hover:bg-zinc-800">⟳ Rescan</button>' +
      '</div></div>';

    if (!this.config.folders.length) {
      html += '<div class="text-zinc-500 italic text-xs px-1 py-6 text-center">No folders configured. Your library is scanned automatically on startup.</div>';
    } else {
      html += '<div class="space-y-1.5">' + this.config.folders.map(f => {
        const count = this.tracks.filter(t => t.folder && t.folder.toLowerCase() === f.toLowerCase()).length;
        return '<div class="section-card p-2.5 flex items-center gap-2 select-none">' +
          '<span class="text-lg">📁</span>' +
          '<div class="flex-1 min-w-0"><div class="text-[11px] font-black text-[var(--text-main)] truncate" title="' + esc(f) + '">' + esc(f.split(/[\\/]/).pop() || f) + '</div>' +
          '<div class="text-[9px] text-zinc-500 truncate">' + esc(f) + '</div>' +
          '<div class="text-[8px] text-zinc-600">' + count + ' track' + (count === 1 ? '' : 's') + '</div></div>' +
          '<button class="px-2 py-1 text-[9px] font-black text-rose-300 hover:text-rose-200 border border-black bg-[var(--bg-input)] cursor-pointer" onclick="MusicPlayer.removeFolder(\'' + esc(f) + '\')" title="Remove from library">✕</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    container.innerHTML = html;
  },

  updateCounts: function() {
    const el = document.getElementById('music-library-count');
    if (el) el.textContent = this.tracks.length + ' track' + (this.tracks.length === 1 ? '' : 's');
    const ttl = this.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const hrs = Math.floor(ttl / 3600);
    const mins = Math.floor((ttl % 3600) / 60);
    const durEl = document.getElementById('music-library-duration');
    if (durEl) durEl.textContent = (hrs ? hrs + 'h ' : '') + mins + 'm';
    const statEl = document.getElementById('music-rail-stats');
    if (statEl) {
      const genres = new Set(this.tracks.map(t => t.genre).filter(Boolean)).size;
      const albums = new Set(this.tracks.map(t => t.album).filter(Boolean)).size;
      statEl.innerHTML =
        '<div class="flex justify-between"><span>Tracks</span><span class="text-[var(--accent-blue)]">' + this.tracks.length + '</span></div>' +
        '<div class="flex justify-between"><span>Albums</span><span class="text-[var(--accent-blue)]">' + albums + '</span></div>' +
        '<div class="flex justify-between"><span>Genres</span><span class="text-[var(--accent-blue)]">' + genres + '</span></div>' +
        '<div class="flex justify-between"><span>Length</span><span class="text-[var(--accent-blue)]">' + (hrs ? hrs + 'h ' : '') + mins + 'm</span></div>';
    }
  },

  updateRail: function() {
    const foldersEl = document.getElementById('music-rail-folders-list');
    if (foldersEl) {
      foldersEl.innerHTML = this.config.folders.length
        ? this.config.folders.map(f => '<div class="text-[9px] font-bold text-zinc-400 truncate px-1 py-0.5" title="' + esc(f) + '">📁 ' + esc(f.split(/[\\/]/).pop() || f) + '</div>').join('')
        : '<div class="text-[9px] text-zinc-600 px-1">No folders yet</div>';
    }
  },

  updateGenreFilter: function() {
    const sel = document.getElementById('music-genre-filter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Genres</option>' + this.genres.map(g => '<option value="' + esc(g) + '">' + esc(g) + '</option>').join('');
    if (current && this.genres.includes(current)) sel.value = current;
    else sel.value = 'all';
  },

  setSort: function(key) {
    if (this.sortKey === key) this.sortDir = -this.sortDir;
    else { this.sortKey = key; this.sortDir = 1; }
    this.renderCenter();
    this._saveConfigDebounced();
  },

  onSearch: function(value) {
    this.search = value;
    // Debounced so large libraries don't re-render the whole table per keystroke.
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.renderCenter();
    }, 160);
  },

  onGenreFilter: function(value) {
    this.filterGenre = value;
    this.renderCenter();
  },

  _emptyStateHtml: function(title, sub, cta, icon) {
    return '<div class="flex flex-col items-center justify-center text-center gap-3 py-20 px-6 select-none">' +
      '<div class="w-20 h-20 rounded-full border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-input)] flex items-center justify-center text-4xl opacity-70 shadow-[3px_3px_0_0_#000]">' + (icon || '🎵') + '</div>' +
      '<div class="text-sm font-black text-[var(--text-main)]">' + esc(title) + '</div>' +
      '<div class="text-xs text-zinc-500 max-w-sm leading-relaxed">' + esc(sub) + '</div>' +
      (cta || '') + '</div>';
  },

  // ==================================================== RIGHT panel
  setRightMode: function(mode) {
    if (!['now', 'queue'].includes(mode)) return;
    if (mode !== 'now') this._nowLyricsOpen = false;
    this.rightMode = mode;
    this.renderRight();
    this._updateMobileLabel();
  },

  cycleRight: function(dir) {
    const order = ['now', 'queue'];
    let i = order.indexOf(this.rightMode);
    if (i < 0) i = 0;
    i = (i + dir + order.length) % order.length;
    this.setRightMode(order[i]);
  },

  renderRight: function() {
    const body = document.getElementById('music-right-body');
    if (!body) return;
    const mode = this.rightMode;
    const titleEl = document.getElementById('music-right-title');
    if (titleEl) titleEl.textContent = {
      now: '🎧 Now Playing', queue: '📃 Queue'
    }[mode] || '🎧 Now Playing';
    const np = this._nowPlayingTrack();
    const modeBtn = document.getElementById('music-right-mode');
    if (modeBtn) modeBtn.title = { now: 'Now Playing', queue: 'Queue' }[mode] || 'Now Playing';
    const fn = this['_renderRight' + mode.charAt(0).toUpperCase() + mode.slice(1)];
    if (typeof fn === 'function') fn.call(this, body, np);
    else this._renderRightNow(body, np);
  },

  // Square star-only favorite toggle; pass the click event so it can stop
  // propagation when embedded inside an otherwise clickable row/card.
  _favBtn: function(path) {
    const on = path && this.favorites.includes(path);
    return '<button data-path="' + esc(path) + '" title="' + (on ? 'Remove from favorites' : 'Add to favorites') + '" aria-label="favorite" class="w-9 h-9 flex items-center justify-center text-base font-black border-2 border-black bg-[var(--bg-input)] hover:brightness-110 cursor-pointer shadow-[2px_2px_0_0_#000] ' + (on ? 'text-amber-300' : 'text-zinc-500') + '" onclick="event.stopPropagation();MusicPlayer.toggleFavorite(\'' + path.replace(/'/g, '\\\'') + '\')">' + (on ? '★' : '☆') + '</button>';
  },

  _toggleFavByIndex: function(index) {
    const t = (this._clickSource || [])[index];
    if (!t) return;
    this.toggleFavorite(t.path);
  },

  // ---- Multi-select & bulk actions ----

  _rowClick: function(index, ev) {
    ev = ev || window.event;
    const t = (this._clickSource || [])[index];
    if (!t) return;
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      const i = this._selPaths.indexOf(t.path);
      if (i >= 0) this._selPaths.splice(i, 1);
      else this._selPaths.push(t.path);
      this._selAnchor = index;
      this._updateSelVisual();
      return;
    }
    if (ev.shiftKey && this._selAnchor >= 0 && this._selAnchor !== index) {
      const src = this._clickSource || [];
      const a = Math.min(this._selAnchor, index);
      const b = Math.max(this._selAnchor, index);
      const set = new Set();
      for (let k = a; k <= b; k++) if (src[k]) set.add(src[k].path);
      this._selPaths = Array.from(set);
      this._selAnchor = index;
      this._updateSelVisual();
      return;
    }
    if (this._selPaths.length > 1 && this._selPaths.includes(t.path)) {
      this._selPaths = [t.path];
      this._selAnchor = index;
      this._updateSelVisual();
      return;
    }
    this._selPaths = [];
    this._selAnchor = -1;
    this.playTracks(this._clickSource, index);
  },

  _selectedTracks: function() {
    if (!this._selPaths.length) return [];
    const byPath = {};
    (this._clickSource || []).forEach(t => { byPath[t.path] = t; });
    return this._selPaths.map(p => byPath[p]).filter(Boolean);
  },

  _playSelected: function() {
    const sel = this._selectedTracks();
    if (!sel.length) return;
    const first = this._selPaths[0];
    const idx = Math.max(0, sel.findIndex(t => t.path === first));
    this._selPaths = [];
    this._selAnchor = -1;
    this.playTracks(sel, idx);
  },

  _bulkFavorite: function() {
    const sel = this._selectedTracks();
    if (!sel.length) return;
    const add = sel.filter(t => !this.favorites.includes(t.path)).length > 0;
    sel.forEach(t => {
      const i = this.favorites.indexOf(t.path);
      if (add) { if (i < 0) this.favorites.push(t.path); }
      else if (i >= 0) this.favorites.splice(i, 1);
    });
    this._saveConfigDebounced();
    this.render();
    this._toast((add ? '⭐ Added ' : '☆ Removed ') + sel.length + ' track' + (sel.length === 1 ? '' : 's') + (add ? ' from favorites' : ' from favorites'), '⭐');
  },

  _bulkAddToPlaylist: function() {
    const sel = this._selectedTracks();
    if (!sel.length) return;
    this.addToPlaylist(sel);
  },

  _bulkEditTags: function() {
    const sel = this._selectedTracks();
    if (!sel.length) return;
    if (!this._isDesktop()) { this._toast('Tag editing is only available in the desktop app.', '✏️'); return; }
    this.openBatchTagEditor(sel);
  },

  _clearSelection: function() {
    if (!this._selPaths.length) return;
    this._selPaths = [];
    this._selAnchor = -1;
    this._updateSelVisual();
  },

  _updateSelVisual: function() {
    this.renderCenter();
  },

  _selBarHtml: function() {
    const n = this._selPaths.length;
    const edit = this._isDesktop()
      ? '<button class="no-tactile music-selbar-btn" onclick="MusicPlayer._hideRowMenu();MusicPlayer._bulkEditTags()">✏️ Edit tags</button>'
      : '';
    return '<div class="music-selbar flex items-center gap-1.5 px-2 py-1.5 mb-1.5 bg-[var(--accent-blue)]/15 border-2 border-[var(--accent-blue)] shadow-[2px_2px_0_0_#000]">' +
      '<span class="text-[10px] font-black text-[var(--accent-blue)] mr-1 whitespace-nowrap">☑ ' + n + ' selected</span>' +
      '<button class="no-tactile music-selbar-btn" onclick="MusicPlayer._playSelected()">▶️ Play</button>' +
      '<button class="no-tactile music-selbar-btn" onclick="MusicPlayer._bulkFavorite()">⭐ Favorite</button>' +
      '<button class="no-tactile music-selbar-btn" onclick="MusicPlayer._bulkAddToPlaylist()">📃 Playlist</button>' + edit +
      '<span class="flex-1"></span>' +
      '<button class="no-tactile music-selbar-btn" title="Clear selection" onclick="MusicPlayer._clearSelection()">✕</button>' +
      '</div>';
  },

  _renderRightNow: function(body, np) {
    if (!np) {
      body.innerHTML = '<div class="flex flex-col items-center justify-center gap-3 py-16 text-center px-4 select-none">' +
        '<div class="w-16 h-16 rounded-full border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-input)] flex items-center justify-center text-3xl opacity-60 shadow-[3px_3px_0_0_#000]">🎧</div>' +
        '<div class="text-xs font-black text-[var(--text-main)]">Nothing playing yet</div>' +
        '<div class="text-[10px] text-zinc-500 leading-relaxed max-w-xs">Pick a track from the library to start listening.</div></div>';
      body.style.overflowY = '';
      body.style.display = '';
      body.style.flexDirection = '';
      return;
    }
    this._npTrack = np;
    let btns = this._favBtn(np.path) + this._npBtn('playlist');
    if (this._hasLyrics(np)) btns += this._npBtn('lyrics', this._nowLyricsOpen);
    if (this._isDesktop()) btns += this._npBtn('edit');
    const lower = this._nowLyricsOpen
      ? this._buildLyricsPane(np)
      : (this._nowQueueHtml() || '');
    body.style.overflowY = 'hidden';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.innerHTML =
      '<div class="flex flex-col w-full h-full min-h-0">' +
      '<div class="flex flex-col items-center text-center px-2 pt-2 flex-shrink-0">' +
      (np.art
        ? '<img src="data:' + np.art.mime + ';base64,' + np.art.base64 + '" class="object-cover border-2 border-black shadow-[4px_4px_0_0_#000] flex-shrink-0" style="width:160px;height:160px;" alt="">'
        : this._coverHtml(np, 'border-2 border-black shadow-[4px_4px_0_0_#000] flex-shrink-0', '48px', 'width:160px;height:160px;')) +
      '<div class="mt-4 min-w-0 w-full">' +
      '<div class="text-base font-black text-[var(--text-main)] leading-tight break-words">' + esc(np.title || np.name) + '</div>' +
      '<div class="text-[11px] text-zinc-400 font-bold mt-0.5 break-words">' + esc(np.artist || 'Unknown Artist') + '</div>' +
      (np.album ? '<div class="text-[10px] text-zinc-600 mt-0.5 break-words">' + esc(np.album) + '</div>' : '') +
      ((np.genre || np.year) ? '<div class="text-[10px] text-zinc-500 mt-1">' + (np.genre ? '🎼 ' + esc(np.genre) : '') + (np.genre && np.year ? ' · ' : '') + (np.year ? esc(np.year) : '') + '</div>' : '') +
      '</div>' +
      '<div class="mt-4 flex items-center justify-center gap-2.5">' + btns + '</div>' +
      '</div>' +
      '<div id="music-now-lower" class="flex-1 min-h-0 overflow-y-auto w-full relative mt-3" style="scrollbar-width: thin;">' + (lower || '') + '</div>' +
      (this._nowLyricsOpen && this._nowLyricsSynced
        ? '<button id="music-lyric-sync-pill" class="music-lyric-sync-pill music-pill-hidden" onclick="MusicPlayer.syncLyrics()">⤓ Sync</button>'
        : '') +
      '</div>';
    this._setRightLyricScrollbar();
    this._bindLyricsUserScroll(document.getElementById('music-now-lower'));
  },

  _npBtn: function(kind, on) {
    const base = 'w-9 h-9 flex items-center justify-center text-sm font-black border-2 border-black bg-[var(--bg-input)] cursor-pointer shadow-[2px_2px_0_0_#000] flex-shrink-0';
    if (kind === 'playlist') {
      return '<button title="Add to playlist" class="' + base + ' text-zinc-300 hover:text-white hover:brightness-110" onclick="event.stopPropagation();MusicPlayer.addToPlaylist(MusicPlayer._npTrack)">➕</button>';
    }
    if (kind === 'lyrics') {
      const onCls = on ? ' bg-[var(--accent-blue)] text-white hover:brightness-110' : ' text-zinc-300 hover:text-white hover:brightness-110';
      return '<button title="Show lyrics" class="' + base + onCls + '" onclick="event.stopPropagation();MusicPlayer.toggleLyrics()">📄</button>';
    }
    return '<button title="Edit tags" class="' + base + ' text-zinc-300 hover:text-white hover:brightness-110" onclick="event.stopPropagation();MusicPlayer.openTagEditor(MusicPlayer._npTrack)">✏️</button>';
  },

  _nowQueueHtml: function() {
    const list = this.currentQueue || [];
    if (!list.length) return '';
    const np = this._nowPlayingTrack();
    return '<div class="text-[9px] font-black uppercase tracking-widest text-zinc-600 w-full mt-5 mb-1 text-left">Up Next</div>' +
      '<div class="space-y-0.5 w-full text-left">' + list.slice(0, 5).map((t, i) => {
        const isCur = np && t && np.path === t.path;
        return '<div class="flex items-center gap-2 px-1.5 py-1 rounded ' + (isCur ? 'bg-white/[0.06]' : '') + ' hover:bg-white/[0.03] cursor-pointer select-none" onclick="MusicPlayer.playTracks(MusicPlayer.currentQueue, ' + i + ')">' +
          this._artHtml(t, 'w-6 h-6 object-cover border border-black flex-shrink-0') +
          '<div class="min-w-0 flex-1"><div class="text-[9.5px] font-bold text-[var(--text-main)] truncate">' + esc(t.title || t.name) + '</div>' +
          '<div class="text-[8px] text-zinc-500 truncate">' + esc(t.artist || '') + '</div></div>' +
          (isCur ? '<span class="text-[8px] text-emerald-400 flex-shrink-0">▶</span>' : '') +
          '</div>';
      }).join('') + '</div>';
  },

  _renderRightQueue: function(body, np) {
    body.style.overflowY = '';
    body.style.display = '';
    body.style.flexDirection = '';
    const list = this.currentQueue || [];
    if (!list.length) {
      body.innerHTML = '<div class="flex flex-col items-center justify-center gap-2 py-16 text-center px-4"><div class="text-3xl opacity-40">📃</div><div class="text-xs text-zinc-500">The queue is empty.</div></div>';
      return;
    }
    body.innerHTML = '<div class="space-y-0.5" id="music-queue-list">' + list.map((t, i) => {
      const isCur = np && t && np.path === t.path;
      return '<div class="music-queue-row flex items-center gap-2 px-1.5 py-1.5 rounded ' + (isCur ? 'bg-white/[0.06]' : '') + ' hover:bg-white/[0.03] cursor-pointer select-none" draggable="true" data-qidx="' + i + '" onclick="MusicPlayer.playTracks(MusicPlayer.currentQueue, ' + i + ')">' +
        '<span class="cursor-grab text-[9px] text-zinc-600 flex-shrink-0" title="Drag to reorder">⠿</span>' +
        '<span class="text-[9px] font-mono text-zinc-500 w-5 text-right flex-shrink-0">' + (i + 1) + '</span>' +
        this._artHtml(t, 'w-7 h-7 object-cover border border-black flex-shrink-0') +
        '<div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[var(--text-main)] truncate">' + esc(t.title || t.name) + '</div>' +
        '<div class="text-[8.5px] text-zinc-500 truncate">' + esc(t.artist || '') + '</div></div>' +
        '<span class="text-[8px] font-mono text-zinc-600 flex-shrink-0">' + this._fmtDuration(t.duration) + '</span></div>';
    }).join('') + '</div>';
    this._bindQueueDrag(document.getElementById('music-queue-list'));
  },

  // HTML5 drag-and-drop reorder for the right-pane Queue tab. Mutates the live
  // queue (this.currentQueue) and mirrors it back into EQ.playlist so playback
  // follows the new order.
  _bindQueueDrag: function(listEl) {
    if (!listEl) return;
    let dragIdx = -1;
    listEl.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.music-queue-row');
      if (!row) return;
      dragIdx = parseInt(row.dataset.qidx, 10);
      row.classList.add('opacity-40');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (err) {}
    });
    listEl.addEventListener('dragend', (e) => {
      listEl.querySelectorAll('.music-queue-row').forEach(r => r.classList.remove('opacity-60', 'ring-1', 'ring-[var(--accent-blue)]'));
    });
    listEl.addEventListener('dragover', (e) => {
      const row = e.target.closest('.music-queue-row');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.querySelectorAll('.music-queue-row').forEach(r => r.classList.remove('ring-1', 'ring-[var(--accent-blue)]'));
      row.classList.add('ring-1', 'ring-[var(--accent-blue)]');
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('.music-queue-row');
      if (!row || dragIdx < 0) return;
      const toIdx = parseInt(row.dataset.qidx, 10);
      if (toIdx === dragIdx) { this.renderRight(); return; }
      const list = this.currentQueue || [];
      if (dragIdx < 0 || dragIdx >= list.length || toIdx < 0 || toIdx >= list.length) { this.renderRight(); return; }
      const currentPath = (list[this.currentIndex] || {}).path;
      const moved = list.splice(dragIdx, 1)[0];
      list.splice(toIdx, 0, moved);
      // Find where the currently-playing track ended up and point the index there
      // so the highlight/transport stays glued to it after reordering.
      let newCur = this.currentIndex;
      list.forEach((t, i) => { if (t.path === currentPath) newCur = i; });
      this.currentIndex = newCur;
      // Keep EQ.playlist in lockstep with the reordered queue.
      if (window.EQ) {
        EQ.playlist = list.map((t, i) => ({
          name: t.name,
          url: t.url || (t.path != null && window.MusicAPI ? window.MusicAPI.appFileUrl(t.path) : t.url),
          _musicIndex: i,
          _track: t
        }));
        EQ.playlistIndex = newCur;
      }
      this.renderRight();
      this._saveSessionDebounced();
    });
  },

  _buildLyricsPane: function(np) {
    if (this.lyricState.track !== np) {
      this._loadLyrics(np);
      this._nowLyricsSynced = false;
      return '<div class="text-zinc-500 italic text-xs px-1 py-8 text-center">Loading lyrics…</div>';
    }
    const data = this.lyricState.data;
    if (!data) {
      this._nowLyricsSynced = false;
      return '<div class="text-zinc-500 italic text-xs px-1 py-8 text-center">No lyrics found for this track.<br>Add an .lrc file next to the audio, or embed lyrics in the tags.</div>';
    }
    if (data.synced && data.synced.length) {
      this.lyricState.lines = data.synced;
      this.lyricState.synced = true;
      this._nowLyricsSynced = true;
      this._lyricFollow = true;
      this._lyricUserScroll = false;
      const linesHtml = data.synced.map((ln, i) =>
        '<div class="lyric-line" data-time="' + (ln.time == null ? '' : ln.time) + '" data-i="' + i + '" onclick="MusicPlayer._seekToLyric(' + i + ')">' + esc(ln.text) + '</div>'
      ).join('');
      this._activeLyricLine = -1;
      const ael = window.EQ && EQ.audioEl;
      setTimeout(() => { this._tickLyrics(ael ? ael.currentTime : 0); }, 0);
      return '<div class="music-lyrics-synced flex flex-col items-center gap-0.5 py-2 px-1 pb-10">' + linesHtml + '</div>';
    }
    this.lyricState.lines = [];
    this.lyricState.synced = false;
    this._nowLyricsSynced = false;
    const text = data.unsynced || '';
    return '<div class="text-left text-[13px] leading-relaxed text-[var(--text-main)] whitespace-pre-wrap px-1 pb-4">' + (esc(text) || '<span class="text-zinc-500">No lyrics.</span>') + '</div>';
  },

  // ==================================================== resizable panes
  _applyPanePrefs: function() {
    if (window.innerWidth < 1280) return;
    const l = document.getElementById('music-col-left');
    const r = document.getElementById('music-col-right');
    if (l && this.paneLeftW) l.style.setProperty('width', this.paneLeftW + 'px', 'important');
    if (r && this.paneRightW) r.style.setProperty('width', this.paneRightW + 'px', 'important');
  },

  _bindPaneResize: function() {
    const bind = (handleId, colId, min) => {
      const handle = document.getElementById(handleId);
      const col = document.getElementById(colId);
      if (!handle || !col) return;
      let startX = 0, startW = 0, pending = false;
      const onMove = (e) => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          const cw = col.parentElement ? col.parentElement.clientWidth : 1200;
          let w = startW + (e.clientX - startX);
          if (w < min) w = min;
          const max = Math.max(min + 40, Math.round(cw * 0.45));
          if (w > max) w = max;
          col.style.setProperty('width', w + 'px', 'important');
          if (colId === 'music-col-left') this.paneLeftW = w;
          else this.paneRightW = w;
        });
      };
      const onUp = () => {
        handle.classList.remove('music-divider-active');
        document.body.classList.remove('music-resizing');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        this._saveConfigDebounced();
      };
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = col.getBoundingClientRect().width;
        handle.classList.add('music-divider-active');
        document.body.classList.add('music-resizing');
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    };
    bind('music-divider-left', 'music-col-left', 200);
    bind('music-divider-right', 'music-col-right', 260);
  },

  // ==================================================== scan overlay + pane bind
  _bindPane: function() {
    const search = document.getElementById('music-search');
    if (search) search.addEventListener('input', (e) => this.onSearch(e.target.value));
    const genre = document.getElementById('music-genre-filter');
    if (genre) genre.addEventListener('change', (e) => this.onGenreFilter(e.target.value));
    const rbody = document.getElementById('music-right-body');
    this._lastLyricScrollTop = rbody ? rbody.scrollTop : 0;
  },

  // Per-render binding for the contained Now Playing lyrics/Up-Next scroll area.
  // Spotify-style: only break out of follow mode when the user actually moves
  // the lyrics scrollbar. Programmatic centering from _tickLyrics never sets
  // _lyricUserScroll, so it is always ignored here.
  _bindLyricsUserScroll: function(sc) {
    if (!sc) return;
    sc.addEventListener('wheel', () => { this._lyricUserScroll = true; }, { passive: true });
    sc.addEventListener('touchmove', () => { this._lyricUserScroll = true; }, { passive: true });
    sc.addEventListener('pointerdown', (e) => {
      if (!this._isLyricsOpen() || this._lyricFollow === false) return;
      const r = sc.getBoundingClientRect();
      if (r.right - e.clientX <= 14) this._lyricUserScroll = true;
    });
    sc.addEventListener('scroll', () => {
      if (!this._isLyricsOpen() || this._lyricFollow === false) return;
      const pill = document.getElementById('music-lyric-sync-pill');
      if (!pill) return;
      if (sc.scrollTop === this._lastLyricScrollTop) return;
      this._lastLyricScrollTop = sc.scrollTop;
      if (!this._lyricUserScroll) return;
      this._lyricUserScroll = false;
      this._lyricFollow = false;
      pill.classList.remove('music-pill-hidden');
      this._setRightLyricScrollbar();
      this._tickLyrics();
    }, { passive: true });
  },

  _showScanOverlay: function(title, sub) {
    const ov = document.getElementById('music-scan-overlay');
    if (!ov) return;
    this.scanProgress = { done: 0, total: 0, label: sub || '' };
    document.getElementById('music-scan-title').textContent = title;
    this._updateScanOverlay();
    ov.classList.remove('hidden');
  },

  _updateScanOverlay: function() {
    const ring = document.getElementById('music-scan-ring');
    const label = document.getElementById('music-scan-label');
    const p = this.scanProgress;
    if (ring) {
      const pct = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
      ring.style.strokeDashoffset = String(Math.round(402.12 * (1 - pct)));
    }
    if (label) label.textContent = p.label || (p.total ? p.done + ' / ' + p.total : '');
  },

  _hideScanOverlay: function() {
    const ov = document.getElementById('music-scan-overlay');
    if (ov) ov.classList.add('hidden');
  },

  // ==================================================== footer bindings
  _bindFooter: function() {
    const closeTag = document.getElementById('music-tag-editor-close');
    if (closeTag) closeTag.onclick = () => this.closeTagEditor();
    const closeBatchTag = document.getElementById('music-batch-tag-editor-close');
    if (closeBatchTag) closeBatchTag.onclick = () => this.closeBatchTagEditor();
  }
};

window.MusicPlayer = MusicPlayer;
