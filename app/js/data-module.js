/* ===== data-module.js =====
 * The Database tab (🗃️). Three columns, same shell as FIND / EQ / TEST / REVIEW:
 *   left   : Entries tree | History (undo / redo)
 *   centre : entry editor (live validation, auto id / tier / driver type)
 *   right  : Audit | AI import | Raw curves | Export (save, .gz, splitter, prompts)
 * Logic lives in data-core / data-curves / data-import / data-store; this file
 * is only state + DOM. Markup is rendered into the containers declared in
 * index.html (#dt-*), and every control is bound by one delegated listener
 * reading data-dt / data-a / data-b / data-f attributes (strict CSP: no inline
 * handlers). Nothing here touches other tabs except through their public API.
 */
const DataTab = (function () {
  'use strict';
  const DC = DataCore, DCV = DataCurves, DI = DataImport;
  const $ = id => document.getElementById(id);
  const E = s => (typeof esc === 'function' ? esc(String(s === null || s === undefined ? '' : s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (m, i) => { try { showToast(m, i || '🗃️'); } catch (e) { console.log(m); } };

  const T = {
    S: null,
    ready: false, loading: false, loadError: '', booted: false,
    left: 'tree', mid: 'editor', right: 'audit',
    selUid: null, draft: null, draftBase: null, isNew: false, draftDirty: false,
    expanded: new Set(), search: '', filter: 'all',
    issues: [], issueByUid: new Map(), auditAt: 0, auditRunning: false, waivers: new Set(), showIgnored: false,
    auditSev: 'all', auditCat: 'all', openIssue: -1, auditSel: new Set(), lastSel: -1,
    diskFiles: null, source: '', gzStale: false, notes: [],
    changed: new Map(), savedLen: 0, base: null, saving: false, saveLog: [], openSave: -1,
    curveCache: new Map(), curveRows: null, curveName: '', curveFileIdx: 0, sugg: null,
    ai: { text: '', proposals: [], notes: '', include: new Set(), fieldSel: new Map(), collapsed: new Set(), errors: [], log: '', status: '' },
    cv: { queue: [], plans: [], source: '', newSource: '', overwrite: false, log: '', busy: false },
    ex: { tokens: 50000, chunks: [], banner: null, changelog: null, lastExport: null },
    lastSaved: 0, autosaveTimer: null, auditTimer: null, treeRaf: 0, hasAutosave: null
  };

  // =================================================================== boot
  T.init = function () {
    if (T.booted) return;
    T.booted = true;
    const pane = $('pane-database');
    if (!pane) return;
    pane.addEventListener('click', onClick);
    pane.addEventListener('input', onInput);
    pane.addEventListener('change', onChange);
    pane.addEventListener('keydown', onKey);
    pane.addEventListener('dragstart', onDragStart);
    pane.addEventListener('dragover', onDragOver);
    pane.addEventListener('dragend', onDragEnd);
    pane.addEventListener('paste', e => { if (e.target && e.target.id === 'dt-ai-in') setTimeout(() => { if ($('dt-ai-in').value.trim()) aiAnalyze(); }, 60); });
    pane.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('.dt-drop'); if (z) z.classList.remove('is-over'); });
    pane.addEventListener('drop', onDrop);
    window.addEventListener('resize', () => { if (T.ready) { clearTimeout(T._rz); T._rz = setTimeout(drawCurve, 120); } });
    // Autosave must survive a close. `beforeunload` + an un-awaited IndexedDB
    // write did not: the renderer is torn down immediately after the event, so
    // an edit inside the debounce window could be lost. pagehide is the more
    // reliable "page is going away" signal, and main.js additionally defers the
    // window close until the flush below answers (or 800ms passes).
    window.addEventListener('pagehide', () => { autosaveNow(); });
    if (window.appBridge && typeof window.appBridge.onFlushBeforeClose === 'function') {
      window.appBridge.onFlushBeforeClose(() => {
        Promise.resolve(autosaveNow()).then(() => {
          try { window.appBridge.flushBeforeCloseDone(); } catch (_) {}
        });
      });
    }
    // The app styles every <button> with a global !important "tactile" look unless it
    // carries .no-tactile (the tab bar and the pills opt out the same way). The tab
    // re-renders its panels often, so opt new buttons out as they appear instead of
    // threading the class through every template.
const OPT_OUT = 'button:not(.no-tactile):not(.stepper-arrow):not(.stepper-label)';
    const optOut = root => { root.querySelectorAll(OPT_OUT).forEach(b => b.classList.add('no-tactile')); };
    new MutationObserver(muts => { muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.tagName === 'BUTTON') { if (!n.classList.contains('stepper-arrow') && !n.classList.contains('stepper-label')) n.classList.add('no-tactile'); } else optOut(n); } })); })
      .observe(pane, { childList: true, subtree: true });
    DataStore.state.onNeedSeed = confirmSeed;
    DataStore.init().then(() => { const b = $('btn-reset-database'); if (b && DataStore.state.canReset) b.style.display = ''; }).catch(() => {});
    renderShell();
    try {
      if (SafeStorage.getItem('iem_data_return') === '1') {
        SafeStorage.removeItem('iem_data_return');
        setTimeout(() => App.switchTab('database'), 600);
      }
    } catch (_) {}
  };
  T.onShow = function () {
    T.init();
    if (!T.ready && !T.loading) T.load();
    else if (T.ready) { renderTree(); drawCurve(); }
  };

  // Installed app, first edit: explain the working copy once, then let the user decide.
  async function confirmSeed() {
    const ok = await UIKit.confirm({
      title: 'Create your own copy?',
      message: 'Your first save makes a private copy of the database (~120 MB, once) in IEM-Data. The built-in files are never changed. Settings → Reset restores them.',
      confirmLabel: 'Create copy'
    });
    if (ok) toast('Creating your copy…', '🗂️');
    return ok;
  }

  function renderShell() {
    $('dt-lp-tree').innerHTML = treeShell();
    $('dt-lp-history').innerHTML = '<div id="dt-hist-body" class="dt-col dt-grow" style="gap:6px"></div>';
    $('dt-rp-audit').innerHTML = '<div id="dt-audit-body" class="dt-col dt-grow" style="gap:6px"></div>';
    $('dt-rp-ai').innerHTML = aiShell();
    $('dt-rp-export').innerHTML = '<div id="dt-ex-body" class="dt-col dt-grow dt-scroll" style="gap:8px"></div>';
    $('dt-editor').innerHTML = '<div class="dt-empty"><span class="dt-big">🗃️</span>Loading the database…</div>';
    setLeft(T.left); setMid(T.mid); setRight(T.right);
  }

  // ================================================================= loading
  T.load = async function (opts) {
    opts = opts || {};
    T.loading = true; T.loadError = '';
    try {
      await DataStore.init();
      const r = await DataStore.readDatabase();
      const parsed = DC.loadDatabaseText(r.text);
      T.source = r.source; T.gzStale = !!r.gzStale; T.notes = parsed.notes;
      if (!T.S) { T.S = new DC.Session(parsed.entries); T.S.onChange(onSessionChange); }
      else T.S.replaceAll(parsed.entries);
      // What the file contains right now: the baseline every save preview is
      // diffed against (replaced after each successful save).
      T.base = DC.snapshotEntries(T.S.entries);
      T.savedLen = 0; T.changed.clear();
      try { const w = await DataStore.kvGet('waivers'); T.waivers = new Set(Array.isArray(w) ? w : []); } catch (_) {}
      try { const l = await DataStore.kvGet('saveLog'); T.saveLog = Array.isArray(l) ? l : []; } catch (_) { T.saveLog = []; }
      // The changelog beside the database, so what has been exported is visible
      // before exporting again. A missing or unreadable file is simply no status.
      T.ex.changelog = null;
      try { T.ex.changelog = DC.summarizeSaveLog(await DataStore.readSaveLog()); } catch (_) { T.ex.changelog = null; }
      T.ex.lastExport = null;
      T.openSave = -1;
      try { const f = await DataStore.kvGet('curveSource'); if (f) T.cv.source = f; } catch (_) {}
      T.diskFiles = await DataStore.listDataFiles().catch(() => null);
      T.ready = true; T.loading = false;
      T.hasAutosave = await DataStore.kvGet('working').catch(() => null);
      if (T.hasAutosave && T.hasAutosave.entries && T.hasAutosave.opCount !== T.hasAutosave.savedMark) T.ex.banner = 'restore';
      T.exBannerInit = true;
      renderAll();
      runAudit();
      if (opts.keepSelection !== true && T.S.entries.length && T.selUid === null) selectUid(T.S.entries[0]._uid, true);
    } catch (e) {
      console.error('[DataTab] load failed', e);
      T.loading = false; T.loadError = String((e && e.message) || e);
      $('dt-editor').innerHTML = '<div class="dt-empty"><span class="dt-big">⚠️</span>Could not load the database.<br><span class="dt-mono" style="font-size:var(--t-micro)">' + E(T.loadError) + '</span><br><br><button class="dt-btn" data-dt="reload-db">Try again</button></div>';
    }
  };
  function onSessionChange(kind) {
    if (kind !== 'saved' && T.ex.banner && T.ex.banner.kind === 'saved') T.ex.banner = null;
    recomputeChanged();
    scheduleTree();
    renderHistory();
    updateToolbar();
    scheduleAutosave();
    scheduleAudit();
    if (kind === 'undo' || kind === 'redo' || kind === 'load') { refreshSelection(); }
  }
  function recomputeChanged() {
    const S = T.S; const m = new Map();
    const touch = (ops) => ops.forEach(op => op.changes.forEach(ch => {
      if (ch.before === null) m.set(ch.uid, 'new'); else if (!m.has(ch.uid)) m.set(ch.uid, 'mod');
      if (ch.after === null) m.delete(ch.uid);
    }));
    const keep = Math.min(T.savedLen, S.undoStack.length);
    touch(S.undoStack.slice(keep));
    if (S.undoStack.length < T.savedLen) touch(S.redoStack.slice(-(T.savedLen - S.undoStack.length)));
    T.changed = m;
  }

  // ----------------------------------------------------------------- autosave
  // Short debounce: the working copy is only a few hundred KB, and 4s was long
  // enough that a close between edits and the timer lost the edit.
  function scheduleAutosave() { clearTimeout(T.autosaveTimer); T.autosaveTimer = setTimeout(autosaveNow, 1500); }
  function autosaveNow() {
    if (!T.S) return Promise.resolve(false);
    if (!T.S.dirty && !T.S.undoStack.length) return DataStore.kvDelete('working').catch(() => false);
    const b = T.S.toBlob(); b.savedAt = Date.now();
    // Never silent: kvSet resolves false when IndexedDB is unavailable/full.
    return DataStore.kvSet('working', b).then((ok) => {
      if (!ok) console.warn('[DataTab] Autosave failed — IndexedDB unavailable or full.');
      return ok;
    }).catch((err) => { console.warn('[DataTab] Autosave failed:', err); return false; });
  }
  async function restoreAutosave() {
    const b = T.hasAutosave; if (!b) return;
    T.S.fromBlob(b); T.savedLen = 0; recomputeChanged();
    T.ex.banner = null; selectUid(T.S.entries.length ? T.S.entries[0]._uid : null, true);
    renderAll(); runAudit(); toast('Restored your unsaved working copy.', '↩️');
  }

  // ==================================================================== save
  // Every overwrite of database.json is confirmed with exactly what changes:
  // added / edited / removed entries by id, the entry-count and size delta, and
  // a warning when the file on disk has moved since it was loaded. Returns false
  // when the user cancels (or there is nothing to do), so saveAll writes nothing.
  async function previewSave(text, opts) {
    const memory = DataStore.state.mode === 'memory';
    const base = T.base || DC.snapshotEntries(T.S.entries);
    const d = DC.diffAgainstSnapshot(base, T.S.entries);

    // Compare against the file as it is NOW: that is what the save replaces, and
    // it is not necessarily the file this tab loaded (another editor or a second
    // window may have saved since). A stale tab must not silently undo that.
    // Only when the save actually writes in place: in memory mode it downloads
    // instead, so the served file never changes and would always look renewed.
    let diskBytes = 0, diskMoved = false;
    if (!memory) {
      try {
        const r = await DataStore.readDatabase();
        diskBytes = textBytes(r.text);
        diskMoved = DC.diffAgainstSnapshot(base, DC.loadDatabaseText(r.text).entries).total > 0;
      } catch (e) { console.warn('[DataTab] Could not re-read the database before saving:', e); }
    }

    if (!d.total && !diskMoved) { toast('No changes to save.', '💾'); return null; }

    const rows = [];
    [['add', '＋ ', d.added, 'new entry', 'new entries'],
     ['mod', '～ ', d.modified, 'edited entry', 'edited entries'],
     ['del', '－ ', d.removed, 'deleted entry', 'deleted entries']].forEach(g => {
      const kind = g[0], glyph = g[1], items = g[2];
      if (!items.length) return;
      rows.push({ kind: 'muted', text: glyph + items.length + ' ' + (items.length === 1 ? g[3] : g[4]) });
      items.slice(0, 10).forEach(it => {
        // Name plus the actual field changes, so a whole save can be reviewed
        // without opening each entry ("->" reads as an arrow in the list).
        const detail = it.detail ? '  ·  ' + it.detail.replace(/ -> /g, ' → ') : '';
        const row = { kind: kind, text: '     ' + it.label + detail };
        // A listed entry opens when clicked. Deleted ones are gone from the
        // working copy, so they stay plain rows rather than dead links.
        if (kind !== 'del') row.id = it.id;
        rows.push(row);
      });
      if (items.length > 10) rows.push({ kind: 'muted', text: '     …and ' + (items.length - 10) + ' more' });
    });
    if (diskMoved) rows.push({ kind: 'warn', text: '⚠ database.json changed on disk since this tab loaded it — saving replaces those changes.' });

    const after = T.S.entries.length;
    const before = after - d.added.length + d.removed.length;
    const names = [opts.json !== false ? 'database.json' : null, opts.gz !== false ? 'database.json.gz' : null].filter(Boolean);
    const sizeNote = diskBytes && !memory ? ' · ' + fmtBytes(diskBytes) + ' → ' + fmtBytes(textBytes(text)) : '';
    const message = before.toLocaleString() + ' → ' + after.toLocaleString() + ' entries' + sizeNote +
      '\n' + (memory
        ? 'Downloads ' + names.join(' + ') + '.'
        : 'Writes ' + names.join(' + ') + '. The current ' + (names.length > 1 ? 'files are' : 'file is') + ' copied to backup/ first.');

    const ok = await UIKit.confirm({
      title: d.total ? 'Save ' + d.total + ' change' + (d.total === 1 ? '' : 's') + '?' : 'Overwrite database.json?',
      message: message,
      details: rows,
      icon: '💾',
      confirmLabel: d.total ? 'Save' : 'Overwrite',
      // Deletions are the part that cannot be undone after the backup rotates.
      danger: d.removed.length > 0,
      onDetailClick: revealChangedEntry
    });
    return ok ? { diff: d, diskMoved: diskMoved } : null;
  }
  // Clicking a listed entry closes the preview (as Cancel, so nothing is
  // written) and takes you to it: tree visible, row scrolled to and selected,
  // editor on the entry so you can see what the save would write.
  function revealChangedEntry(id) {
    if (!T.S) return;
    const e = T.S.entries.find(x => x.id === id);
    if (!e) return;
    setLeft('tree');
    setMid('editor');
    revealInTree(e._uid);          // drop a search/filter that would hide the row
    T._fromTap = true;
    selectUid(e._uid, false);
  }
  function textBytes(s) { try { return new TextEncoder().encode(s).length; } catch (_) { return s.length; } }

  // --------------------------------------------------------------- save log
  // A record of recent writes: what each save changed, kept after the dialog is
  // gone so the result can still be reviewed. Stored beside the autosave in
  // IndexedDB; the 20 newest saves keep their first 25 entries, while the counts
  // are always the real totals (a big save says "…and N more").
  const SAVE_LOG_MAX = 20, SAVE_LOG_CHANGES = 25;
  function summarizeSave(s) {
    const parts = [];
    if (s.added) parts.push('＋' + s.added);
    if (s.modified) parts.push('～' + s.modified);
    if (s.removed) parts.push('－' + s.removed);
    return parts.join(' ') || 'no entry changes';
  }
  // "2 new saves, 9 in the changelog": how much of the exported file this run
  // added, in the same words in the toast and in the panel.
  function exportSummary(added, total) {
    return added
      ? added + ' new save' + (added === 1 ? '' : 's') + ', ' + total + ' in the changelog'
      : 'no new saves, ' + total + ' in the changelog';
  }
  async function logSave(preview, res) {
    try {
      const d = preview.diff;
      const row = {
        ts: Date.now(),
        mode: res.mode,
        entries: T.S.entries.length,
        bytes: (res.files || []).reduce((n, f) => n + (Number(f.bytes) || 0), 0),
        added: d.added.length, modified: d.modified.length, removed: d.removed.length, total: d.total,
        changes: d.added.map(x => ({ k: 'add', label: x.label, detail: x.detail }))
          .concat(d.modified.map(x => ({ k: 'mod', label: x.label, detail: x.detail })))
          .concat(d.removed.map(x => ({ k: 'del', label: x.label, detail: '' })))
          .slice(0, SAVE_LOG_CHANGES)
      };
      T.saveLog = [row].concat(T.saveLog || []).slice(0, SAVE_LOG_MAX);
      if (T.openSave >= 0) T.openSave += 1;   // the expanded row stays the same save
      await DataStore.kvSet('saveLog', T.saveLog);
    } catch (e) { console.warn('[DataTab] Could not record this save in the save log:', e); }
  }

  async function saveAll(opts) {
    opts = opts || {};
    if (!T.S) return;
    if (T.saving) return;                 // the preview is async; ignore a second Ctrl+S
    if (T.draftDirty && !(await commitDraft(true))) return;
    T.saving = true;
    try {
      const text = T.S.serialize();
      const preview = await previewSave(text, opts);
      if (!preview) return;
      const res = await DataStore.saveDatabase(text, { json: opts.json !== false, gz: opts.gz !== false });
      T.S.markSaved(); T.savedLen = T.S.undoStack.length; recomputeChanged();
      T.base = DC.snapshotEntries(T.S.entries);
      await logSave(preview, res);
      T.lastSaved = Date.now(); T.gzStale = false;
      DataStore.kvDelete('working');
      const sz = res.files.map(f => fmtBytes(f.bytes)).join(' + ');
      T.ex.banner = { kind: 'saved', text: (res.mode === 'memory' ? 'Downloaded · ' : 'Saved · ') + sz, mode: res.mode };
      toast(res.mode === 'memory' ? 'Downloaded.' : 'Saved.', '💾');
      T.diskFiles = await DataStore.listDataFiles().catch(() => T.diskFiles);
      renderAll(); runAudit();
    } catch (e) { console.error(e); toast('Save failed: ' + ((e && e.message) || e), '⚠️'); }
    finally { T.saving = false; }
  }
  async function compressOnly() {
    try {
      const text = T.S.serialize();
      const res = await DataStore.saveDatabase(text, { json: false, gz: true });
      const f = res.files[0];
      T.ex.banner = { kind: 'saved', text: 'Compressed · ' + fmtBytes(f.bytes), mode: res.mode };
      toast('Compressed · ' + fmtBytes(f.bytes), '📦'); T.gzStale = false; renderExport();
    } catch (e) { toast('Compress failed: ' + ((e && e.message) || e), '⚠️'); }
  }
  function fmtBytes(n) { return DC.formatBytes(n); }
  function reloadApp() {
    try { SafeStorage.setItem('iem_data_return', '1'); } catch (_) {}
    (async () => {
      try { await CurveIndexer.clearCurveCache(); } catch (_) {}
      try { SafeStorage.removeItem('squig_db_indexed'); SafeStorage.removeItem('find_canonical_profiles'); } catch (_) {}
      location.reload();
    })();
  }

  // ===================================================================== tree
  function treeShell() {
    return '<input id="dt-search" class="dt-in" type="search" placeholder="Search brand, model, tag, id…" autocomplete="off" spellcheck="false" data-f="search">' +
      '<div id="dt-filters" class="dt-row" style="flex-wrap:wrap;gap:4px"></div>' +
      '<div class="dt-row"><span id="dt-count" class="dt-help dt-grow"></span><button class="dt-btn is-sm" data-dt="collapse" title="Collapse all brands">⮟ Collapse</button></div>' +
      '<div id="dt-tree" class="dt-box dt-scroll dt-grow dt-tree"></div>';
  }
  const FILTERS = [['all', 'All'], ['issues', '⚠ Issues'], ['nocurve', 'No curve'], ['changed', '✎ Changed']];
  function entryWorst(uid) { return T.issueByUid.get(uid) || ''; }
  function matchesFilter(e) {
    if (T.filter === 'issues') return !!entryWorst(e._uid);
    if (T.filter === 'nocurve') return !(e.files && e.files.length);
    if (T.filter === 'changed') return T.changed.has(e._uid);
    return true;
  }
  function scheduleTree() { if (T.treeRaf) return; T.treeRaf = requestAnimationFrame(() => { T.treeRaf = 0; renderTree(); }); }
  function renderTree() {
    const box = $('dt-tree'); if (!box || !T.S) return;
    $('dt-filters').innerHTML = FILTERS.map(f => '<button class="dt-chip' + (T.filter === f[0] ? ' is-accent' : '') + '" data-dt="filter" data-a="' + f[0] + '">' + f[1] + '</button>').join('');
    const q = T.search.trim().toLowerCase();
    const toks = q ? q.split(/\s+/) : [];
    const groups = []; let cur = null, shown = 0;
    T.S.entries.forEach(e => {
      if (!matchesFilter(e)) return;
      if (toks.length) {
        const hay = (e.brand + ' ' + e.model + ' ' + e.variant + ' ' + e.id + ' ' + e.tags.join(' ') + ' ' + e.driver_config + ' ' + e.form_factor).toLowerCase();
        for (const t of toks) if (hay.indexOf(t) < 0) return;
      }
      const b = e.brand || '(no brand)';
      if (!cur || cur.brand !== b) { cur = { brand: b, items: [] }; groups.push(cur); }
      cur.items.push(e); shown++;
    });
    const forceOpen = toks.length > 0 || T.filter !== 'all';
    const parts = []; let rows = 0;
    for (const g of groups) {
      const open = forceOpen || T.expanded.has(g.brand);
      parts.push('<button class="dt-brand' + (open ? ' is-open' : '') + '" data-dt="brand" data-a="' + E(g.brand) + '"><span class="dt-caret">▶</span><span>' + E(g.brand) + '</span><span class="dt-n">' + g.items.length + '</span></button>');
      if (open) for (const e of g.items) {
        if (rows++ > 700) break;
        const w = entryWorst(e._uid), ch = T.changed.get(e._uid);
        parts.push('<button class="dt-item' + (e._uid === T.selUid ? ' is-sel' : '') + (ch === 'new' ? ' is-new' : ch === 'mod' ? ' is-mod' : '') + '" data-dt="sel" data-a="' + e._uid + '">' +
          '<span class="dt-dot ' + (w ? 'is-' + w : '') + '"></span><span class="dt-t">' + E([e.model, e.variant && '[' + e.variant + ']'].filter(Boolean).join(' ') || e.id) + '</span>' +
          (e.files && e.files.length ? '' : '<span class="dt-nocurve" title="No measurement file linked">∅</span>') + '</button>');
      }
      if (rows > 700) { parts.push('<div class="dt-help" style="padding:6px">Showing the first 700 rows — refine the search to see more.</div>'); break; }
    }
    box.innerHTML = parts.join('') || '<div class="dt-empty">No entries match.</div>';
    $('dt-count').textContent = shown + ' of ' + T.S.entries.length + ' entries';
    const cur2 = box.querySelector('.is-sel'); if (cur2 && T._scrollSel) { cur2.scrollIntoView({ block: 'center' }); T._scrollSel = false; }
  }
  // After an import we want the new/edited entry visible AND selected in the
  // tree. If the current filter/search would hide it, drop back to the default
  // view so the scroll-into-view actually finds a row to scroll to.
  function revealInTree(uid) {
    const e = T.S && T.S.byUid(uid); if (!e) return;
    const toks = T.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (e.brand + ' ' + e.model + ' ' + e.variant + ' ' + e.id + ' ' + e.tags.join(' ') + ' ' + e.driver_config + ' ' + e.form_factor).toLowerCase();
    const visible = matchesFilter(e) && toks.every(t => hay.indexOf(t) >= 0);
    if (visible) return;
    if (T.filter !== 'all') { T.filter = 'all'; }
    if (T.search) { T.search = ''; const s = $('dt-search'); if (s) s.value = ''; }
    renderTree();
  }

  // =================================================================== history
  function renderHistory() {
    const el = $('dt-hist-body'); if (!el || !T.S) return;
    const S = T.S;
    const when = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = (op, i, kind) => '<button class="dt-hist' + (kind === 'redo' ? ' is-redo' : '') + '" data-dt="hist-' + kind + '" data-a="' + i + '"><span class="dt-t"><b>' + E(op.label) + '</b><span class="dt-s">' + op.changes.length + ' entr' + (op.changes.length === 1 ? 'y' : 'ies') + ' · ' + when(op.ts) + (op.changes.length === 1 ? ' · ' + E(DC.describeEntryChange(op.changes[0].before, op.changes[0].after, 2)) : '') + '</span></span><span>' + (kind === 'redo' ? '↷' : '↶') + '</span></button>';
    const redo = S.redoStack.map((op, i) => row(op, i, 'redo')).reverse();
    const undo = S.undoStack.map((op, i) => row(op, i, 'undo')).reverse();
    el.innerHTML = '<div class="dt-row"><button class="dt-btn dt-grow" data-dt="undo"' + (S.canUndo() ? '' : ' disabled') + '>↶ Undo</button><button class="dt-btn dt-grow" data-dt="redo"' + (S.canRedo() ? '' : ' disabled') + '>↷ Redo</button></div>' +
      '<p class="dt-help">Click a step to rewind to it.</p>' +
      '<div class="dt-box dt-scroll dt-grow">' + (redo.join('') + undo.join('') || '<div class="dt-empty">No edits yet.</div>') + '</div>';
  }

  // ==================================================================== editor
  const ICON = n => 'app/icons/' + n + '.png';
  function blankDraft() {
    const d = DC.blankEntry(); d.form_factor = 'IEM'; d.connector = '2-pin';
    const cur = T.S && T.S.byUid(T.selUid); if (cur) d.brand = cur.brand;
    return normDraft(d);
  }
  function cloneDraft(e) { const d = {}; DC.SCHEMA_FIELDS.forEach(f => { d[f] = Array.isArray(e[f]) ? e[f].slice() : e[f]; }); return d; }
  function normDraft(d, keepDriver) {
    d.id = DC.buildId(d.brand, d.model, d.variant);
    if (!keepDriver) {
      const cfg = String(d.driver_config || '').trim();
      if (!cfg) d.driver_type = '';
      else if (!DC.driverConfigUnknownTokens(cfg).length) {
        const p = DC.parseDriverConfig(cfg);
        if (Object.keys(p).length) { const c = DC.classifyDriver(p); d.driver_type = c[0]; d.driver_config = c[1]; }
      }
    }
    const fx = DC.fixTierTags(d.tags, d.price_usd); d.tags = fx.tags;
    const allowed = DC.FORM_CONNECTOR_MAP[d.form_factor];
    if (allowed && allowed.indexOf(d.connector) < 0) d.connector = allowed[0];
    return d;
  }
  function draftErrors() {
    if (!T.draft) return [];
    const ids = T.S.ids(T.isNew ? -1 : T.selUid);
    return DC.validateEntry(T.draft, ids, null);
  }
  function markDirty() {
    T.draftDirty = T.isNew || JSON.stringify(T.draft) !== JSON.stringify(T.draftBase);
  }
  async function selectUid(uid, force) {
    if (!force && uid === T.selUid && !T.isNew) return;
    if (T.draftDirty && !force) {
      if (draftErrors().length === 0) { if (!(await commitDraft(true))) return; }
      else {
        const ok = await UIKit.confirm({ title: 'Discard edits?', message: 'These edits are invalid. Discard them?', confirmLabel: 'Discard', danger: true });
        if (!ok) return;
      }
    }
    T.selUid = uid; T.isNew = false;
    const e = T.S && T.S.byUid(uid);
    if (e) T.expanded.add(e.brand || '(no brand)');
    T.draft = e ? cloneDraft(e) : null; T.draftBase = e ? cloneDraft(e) : null; T.draftDirty = false;
    T.curveFileIdx = 0; T.curveRows = null; T.sugg = null;
    T._scrollSel = true;
    renderEditor(); scheduleTree();
    if (e && typeof RESPONSIVE_SECTION_BREAKPOINT_PX !== 'undefined' && window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX && T._fromTap) { App.setDatabaseSection('editor'); }
    T._fromTap = false;
  }
  function refreshSelection() {
    // After undo/redo/batch: re-read the selected entry (or fall back).
    if (!T.S) return;
    if (T.isNew) return;
    const e = T.S.byUid(T.selUid);
    if (!e) { T.selUid = null; T.draft = null; T.draftBase = null; T.draftDirty = false; renderEditor(); return; }
    if (!T.draftDirty) { T.draft = cloneDraft(e); T.draftBase = cloneDraft(e); renderEditor(); }
  }
  async function commitDraft(silent) {
    if (!T.draft) return false;
    normDraft(T.draft);
    const errs = draftErrors();
    if (errs.length) { if (!silent) toast(errs[0], '⚠️'); return false; }
    if (T.isNew) {
      const uid = T.S.addEntries([T.draft], 'Add ' + DC.formatEntryLabel(T.draft))[0];
      T.isNew = false; T.selUid = uid; T.draftBase = cloneDraft(T.draft); T.draftDirty = false; T._scrollSel = true;
      T.expanded.add(T.draft.brand || '(no brand)');
    } else {
      T.S.updateEntry(T.selUid, T.draft, 'Edit ' + DC.formatEntryLabel(T.draft));
      T.draftBase = cloneDraft(T.draft); T.draftDirty = false;
    }
    renderEditor(); scheduleTree();
    if (!silent) toast('Applied. 💾 Save to write to disk.', '✅');
    return true;
  }
  function revertDraft() {
    if (T.isNew) { T.isNew = false; T.draft = null; T.draftDirty = false; const f = T.S.entries[0]; if (f) selectUid(f._uid, true); else renderEditor(); return; }
    const e = T.S.byUid(T.selUid); if (!e) return;
    T.draft = cloneDraft(e); T.draftBase = cloneDraft(e); T.draftDirty = false; renderEditor();
  }
  async  function newEntry() {
    if (T.draftDirty && !T.isNew) { if (draftErrors().length === 0) { if (!(await commitDraft(true))) return; } }
    T.selUid = null; T.isNew = true; T.draft = blankDraft(); T.draftBase = cloneDraft(T.draft); T.draftDirty = true;
    T.curveRows = null; T.sugg = null; renderEditor(); scheduleTree();
    const b = $('dt-e-model') || $('dt-e-brand'); if (b) b.focus();
    if (typeof RESPONSIVE_SECTION_BREAKPOINT_PX !== 'undefined' && window.innerWidth < RESPONSIVE_SECTION_BREAKPOINT_PX) App.setDatabaseSection('editor');
  }
  function duplicateEntry() {
    const e = T.S.byUid(T.selUid); if (!e) return;
    const d = cloneDraft(e); d.variant = (d.variant ? d.variant + ' ' : '') + 'Copy'; d.files = [];
    T.selUid = null; T.isNew = true; T.draft = normDraft(d); T.draftBase = cloneDraft(d); T.draftDirty = true; T.curveRows = null; T.sugg = null;
    renderEditor(); scheduleTree();
  }
  async function deleteEntry() {
    const e = T.S.byUid(T.selUid); if (!e) return;
    const ok = await UIKit.confirm({ title: 'Delete entry?', message: DC.formatEntryLabel(e) + ' will be removed. Undo brings it back.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const i = T.S.indexOfUid(T.selUid);
    T.S.deleteEntries([T.selUid], 'Delete ' + DC.formatEntryLabel(e));
    T.draftDirty = false; T.selUid = null;
    const nxt = T.S.entries[Math.min(i, T.S.entries.length - 1)];
    if (nxt) selectUid(nxt._uid, true); else { T.draft = null; renderEditor(); }
  }

  // The app's own themed stepper (same markup + classes as Review's Form Factor / Connector),
  // so it follows every theme instead of looking like a separate tool.
  function stepperHtml(kind, label, icon) {
    const arrow = (dir, glyph) => '<button type="button" data-dt="step" data-a="' + kind + '" data-b="' + dir + '" class="stepper-arrow w-8 h-9 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-[3px] border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none" aria-label="' + (dir < 0 ? 'Previous' : 'Next') + '">' + glyph + '</button>';
    return '<div class="stepper flex items-center gap-1.5 w-full h-9">' + arrow(-1, '◀') +
      '<button type="button" data-dt="step" data-a="' + kind + '" data-b="1" class="stepper-label flex-1 text-center text-xs px-2.5 bg-[var(--bg-input)] border-[3px] border-black text-[var(--text-main)] transition-all font-bold shadow-none h-9 cursor-pointer flex items-center justify-center truncate gap-1.5 focus:outline-none">' +
      '<span class="flex items-center justify-center gap-2 truncate">' + (icon ? '<img src="' + ICON(icon) + '" class="w-6 h-6 object-contain flex-shrink-0 inline-block" alt="">' : '') + E(label || '—') + '</span></button>' + arrow(1, '▶') + '</div>';
  }
  const DRV_ICON = { DD: 'dd', BA: 'ba', Planar: 'planar', EST: 'est', MEMS: 'mems', PZT: 'pzt', BC: 'bc' };
  const TIER_RANGE = { 'Budget': '$0–99', 'Mid-Tier': '$100–499', 'Premium': '$500–1,499', 'Flagship': '$1,500+' };
  // The Tags column shows one group at a time. Thirty-one pills at once needed
  // more height than the editor column has, so the column grew its own scrollbar
  // (and, worse, the flex item shrank below its content and drew the pills over
  // the status line). A five-tab carousel keeps the group one click away and the
  // column ~230px tall at any window size. `label` is deliberately a prefix of
  // the canonical group name rather than a new vocabulary; `group` is the key
  // into DC.TAG_GROUPS. The ids are what the carousel audit walks.

  function headerHtml(d) {
    return '<div class="dt-ed-head"><div class="dt-title" id="dt-e-title">' + (d ? '' : 'No entry selected') + '</div>' + (d ? '<span class="dt-chip" id="dt-e-status"></span>' : '') +
      '<button class="dt-btn is-sm" data-dt="new" title="Add a new entry">➕ New</button>' +
      '<button class="dt-btn is-sm is-ico" data-dt="dup" id="dt-tb-dup" title="Duplicate this entry as a new one">📋</button>' +
      '<button class="dt-btn is-sm is-ico is-danger" data-dt="del" id="dt-tb-del" title="Delete this entry (undoable)">🗑️</button>' +
      '<button class="dt-btn is-sm is-ico" data-dt="copy-json" id="dt-tb-json" title="Copy this entry as JSON (handy for the AI audit prompt)">{ }</button>' +
      '<span class="dt-sepv"></span>' +
      '<button class="dt-btn is-sm is-ico" data-dt="undo" id="dt-tb-undo" title="Undo (Ctrl+Z)">↶</button><button class="dt-btn is-sm is-ico" data-dt="redo" id="dt-tb-redo" title="Redo (Ctrl+Y)">↷</button>' +
      '<button class="dt-btn is-sm is-primary" data-dt="save" id="dt-tb-save" title="Save - shows exactly what will change, then writes database.json and database.json.gz (Ctrl+S)">💾 Save</button></div>';
  }
  function editorPanelHtml(d) {
    if (!d) return '<div class="dt-empty"><span class="dt-big">🗃️</span>Select an entry in the tree, or<br><br><button class="dt-btn is-primary" data-dt="new">➕ New entry</button></div>';
    const tiles = DC.DRIVER_TECH_ORDER.map(t => '<div class="dt-tile" id="dt-tile-' + t + '"><div class="dt-tn"><img src="' + ICON(DRV_ICON[t]) + '" alt="">' + t + '</div><div class="dt-tc"><button type="button" data-dt="drv" data-a="' + t + '" data-b="-1" aria-label="Fewer ' + t + '">−</button><b id="dt-drv-' + t + '">0</b><button type="button" data-dt="drv" data-a="' + t + '" data-b="1" aria-label="More ' + t + '">+</button></div></div>').join('');
    const inp = (f, label, extra) => '<div><label class="dt-lbl" for="dt-e-' + f + '">' + label + '</label><input id="dt-e-' + f + '" class="dt-in input-bg-fix' + (extra && extra.num ? ' is-num' : '') + '" data-f="e:' + f + '" value="' + E(d[f]) + '" autocomplete="off" spellcheck="' + (extra && extra.num ? 'false' : 'true') + '"' + (extra && extra.num ? ' inputmode="numeric"' : '') + (extra && extra.list ? ' list="' + extra.list + '"' : '') + '></div>';
    return '<div class="dt-ed"><div class="dt-col">' +
        '<h4 class="dt-h">Identity</h4>' +
        '<div class="dt-g2">' + inp('brand', 'Brand', { list: 'dt-brand-list' }) + inp('model', 'Model') + '</div>' +
        '<div class="dt-g2">' + inp('variant', 'Variant (optional)') + '<div><label class="dt-lbl">ID (auto)</label><input id="dt-e-id" class="dt-in input-bg-fix dt-mono" readonly tabindex="-1" value="' + E(d.id) + '"></div></div>' +
        '<h4 class="dt-h">Specs</h4>' +
        '<div class="dt-g4">' + inp('year', 'Year', { num: 1 }) + inp('price_usd', 'Price $', { num: 1 }) + inp('impedance', 'Ω', { num: 1 }) + inp('sensitivity', 'dB', { num: 1 }) + '</div>' +
        '<h4 class="dt-h">Hardware</h4>' +
        // Form factor and connector are the same control (a stepper showing a
        // short value), so they share one row. Stacked, the form column was 56px
        // taller than the editor at 1366x768 and grew its own scrollbar.
        '<div class="dt-g2"><div><label class="dt-lbl">Form factor</label><div id="dt-ff"></div></div><div><label class="dt-lbl">Connector</label><div id="dt-cn"></div></div></div>' +
        '<div><label class="dt-lbl">Drivers per side</label><div class="dt-tiles">' + tiles + '</div></div>' +
        '<div class="dt-g2"><div><label class="dt-lbl" for="dt-e-driver_config">Config (e.g. 1DD+2BA)</label><input id="dt-e-driver_config" class="dt-in input-bg-fix dt-mono" data-f="e:driver_config" value="' + E(d.driver_config) + '" autocomplete="off" spellcheck="false"></div><div><label class="dt-lbl">Type (auto)</label><div id="dt-dtype" class="dt-in input-bg-fix" style="display:flex;align-items:center;gap:6px"></div></div></div>' +
      '</div><div class="dt-col">' +
        '<h4 class="dt-h">Tags <span id="dt-tagcount" class="dt-help" style="display:inline"></span></h4>' +
        '<div id="dt-tags" class="dt-col dt-tgwrap"></div>' +
        '<div id="dt-msgs" class="dt-msgs"></div>' +
      '</div></div>' +
      '<div class="dt-row dt-foot"><button class="dt-btn is-primary dt-grow" data-dt="apply" id="dt-apply">✅ Apply changes</button><button class="dt-btn" data-dt="revert" id="dt-revert">↺ Revert</button></div>';
  }
  // Curves tab: a wide chart as the centre piece; linked files and the importer sit below it.
  function curvesPanelHtml(d) {
    const ok = d && !T.isNew;
    return '<div class="dt-cvtab">' +
      '<div class="dt-row"><h4 class="dt-h dt-grow">' + (ok ? E(DC.formatEntryLabel(d)) : 'Measurements') + '</h4>' + (ok ? '<button class="dt-btn is-sm" data-dt="go-eq" id="dt-go-eq">🎚️ EQ</button><button class="dt-btn is-sm" data-dt="go-review" id="dt-go-review">📝 Review</button>' : '') + '</div>' +
      (ok ? '<div class="dt-curve is-wide"><canvas id="dt-canvas"></canvas><span class="dt-cap" id="dt-curve-cap">No curve</span></div>' : '<div class="dt-box dt-empty dt-wide-empty">' + (!d ? 'Select an entry.' : 'Apply the new entry first.') + '</div>') +
      '<div class="dt-cvlow">' +
        '<div class="dt-col dt-cvcard"><div class="dt-cvhead"><h4 class="dt-h" title="The first file is the default curve. Drag to reorder.">📎 Linked files</h4>' + (ok ? '<span class="dt-cvcount">' + d.files.length + '</span>' : '') + '</div>' +
          (ok ? '<div id="dt-files" class="dt-col dt-fscroll" style="gap:6px"></div><div class="dt-sug"><input id="dt-file-in" class="dt-in input-bg-fix dt-mono" data-f="file-in" placeholder="Link an existing file…" autocomplete="off" spellcheck="false"><div id="dt-file-sug" class="dt-sugbox" style="display:none"></div></div>' : '<div class="dt-box dt-help" style="padding:10px">Apply the new entry first, then its files appear here.</div>') +
        '</div>' +
        '<div class="dt-col dt-cvcard"><div class="dt-cvhead"><h4 class="dt-h">📥 Import</h4></div><div id="dt-cv-body" class="dt-col dt-grow" style="gap:10px;min-height:0"></div></div>' +
      '</div></div>';
  }
  function renderEditor() {
    const box = $('dt-editor'); if (!box) return;
    if (!T.ready) return;
    const d = T.draft;
    box.innerHTML = headerHtml(d) + '<div id="dt-banner-slot"></div>' +
      '<div id="dt-mp-editor" class="dt-panel">' + editorPanelHtml(d) + '</div>' +
      '<div id="dt-mp-curves" class="dt-panel">' + curvesPanelHtml(d) + '</div>' +
      '<datalist id="dt-brand-list">' + brandOptions() + '</datalist>';
    setMid(T.mid);
    renderCurves();
    if (d) { refreshDerived(); loadPreview(); } else updateToolbar();
  }
  function setMid(id) {
    T.mid = id;
    ['editor', 'curves'].forEach(k => {
      const b = $('dt-mid-tab-' + k), p = $('dt-mp-' + k);
      if (b) { b.classList.toggle('active', k === id); b.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
      if (p) p.classList.toggle('is-on', k === id);
    });
    if (id === 'curves' && T.ready) { drawCurve(); }
  }
  function brandOptions() {
    const seen = new Set(); let h = '';
    T.S.entries.forEach(e => { if (e.brand && !seen.has(e.brand)) { seen.add(e.brand); h += '<option value="' + E(e.brand) + '">'; } });
    return h;
  }
  function tagChip(t, sel, clash) {
    return '<button class="dt-tag' + (sel.has(t) ? ' is-on' : '') + (clash.has(t) ? ' is-clash' : '') + '" data-dt="tag" data-a="' + t + '">' +
      '<span class="dt-em">' + (DC.TAG_EMOJI[t] || '') + '</span>' + t + '</button>';
  }
  // The whole tag vocabulary, grouped, in one sheet: no group tabs, no hidden
  // panel. Five groups of text-only pills at 22px fit in ~300-340px beside the
  // form at every desktop width, so nothing has to be switched or scrolled to
  // see the other groups. The price tier is derived, not chosen, so it renders
  // as one read-only chip with its range rather than four disabled buttons.
  function renderTags() {
    const d = T.draft, box = $('dt-tags'); if (!d || !box) return;
    const sel = new Set(d.tags), clash = new Set();
    DC.tagConflicts(sel).forEach(p => p.forEach(t => clash.add(t)));
    const suggest = (T.sugg && T.sugg.suggestions || []).filter(s => {
      if (sel.has(s.tag) || DC.PRICE_TIER_TAGS.indexOf(s.tag) >= 0) return false;
      const withIt = new Set(sel); withIt.add(s.tag);          // never offer a tag that would clash with what is already ticked
      return DC.tagConflicts(withIt).length <= DC.tagConflicts(sel).length;
    });
    const tier = DC.priceTierFor(DC.priceTierBasis(d.price_usd));
    box.innerHTML = Object.keys(DC.TAG_GROUPS).map(g => {
      const head = '<div class="dt-tgh">' + DC.TAG_GROUP_EMOJI[g] + ' ' + E(g);
      if (g === DC.PRICE_GROUP) {
        // Derived, not chosen: one heading line, no second row of buttons.
        return '<div class="dt-tg">' + head + ' <span class="dt-tgnote">' + tier + ' · ' + TIER_RANGE[tier] + '</span></div></div>';
      }
      const tags = DC.TAG_GROUPS[g].slice().sort((a, b) => (a < b ? -1 : 1));
      return '<div class="dt-tg">' + head + '</div><div class="dt-tagrow">' + tags.map(t => tagChip(t, sel, clash)).join('') + '</div></div>';
    }).join('') +
      (suggest.length ? '<div class="dt-tg"><div class="dt-tgh">🧪 From the measurement <span class="dt-tgnote">' + E(DCV.summarizeMetrics(T.sugg.metrics)) + ' · click to add</span></div><div class="dt-tagrow">' + suggest.map(s => '<button class="dt-tag is-sugg" data-dt="tag" data-a="' + s.tag + '" title="' + E(s.reason) + '"><span class="dt-em">' + (DC.TAG_EMOJI[s.tag] || '') + '</span>+ ' + s.tag + '</button>').join('') + '</div></div>' : '');
    $('dt-tagcount').textContent = '· ' + d.tags.length + '/' + DC.MAX_TAGS;
  }
  function refreshDerived() {
    const d = T.draft; if (!d || !$('dt-e-id')) return;
    markDirty();
    $('dt-e-id').value = d.id;
    const lbl = DC.formatEntryLabel(d);
    $('dt-e-title').textContent = lbl === '(unnamed entry)' ? (T.isNew ? 'New entry' : lbl) : lbl;
    const errs = draftErrors();
    const st = $('dt-e-status');
    st.className = 'dt-chip ' + (errs.length ? 'is-err' : T.draftDirty ? 'is-warn' : 'is-ok');
    st.textContent = errs.length ? errs.length + ' issue' + (errs.length === 1 ? '' : 's') : T.isNew ? 'new · valid' : T.draftDirty ? 'unapplied edits' : '✓ valid';
    $('dt-ff').innerHTML = stepperHtml('ff', d.form_factor, DC.FORM_FACTOR_ICON[d.form_factor]);
    $('dt-cn').innerHTML = stepperHtml('cn', d.connector, DC.CONNECTOR_ICON[d.connector]);
    const counts = DC.parseDriverConfig(d.driver_config);
    DC.DRIVER_TECH_ORDER.forEach(t => { const n = $('dt-drv-' + t), tile = $('dt-tile-' + t); if (n) n.textContent = counts[t] || 0; if (tile) tile.classList.toggle('is-on', !!counts[t]); });
    const dc = $('dt-e-driver_config'); if (dc && document.activeElement !== dc) dc.value = d.driver_config;
    $('dt-dtype').innerHTML = d.driver_type ? (DC.DRIVER_TYPE_ICON[d.driver_type] ? '<img src="' + ICON(DC.DRIVER_TYPE_ICON[d.driver_type]) + '" alt="" style="width:20px;height:20px;object-fit:contain">' : '') + '<b>' + E(d.driver_type) + '</b>' : '<span style="opacity:.6">—</span>';
    renderTags();
    // linked measurement files: first one is the default curve EQ loads. Drag to reorder.
    const cur = Math.min(T.curveFileIdx, Math.max(0, d.files.length - 1));
    const filesBox = $('dt-files');
    if (filesBox) filesBox.innerHTML = d.files.length ? d.files.map((f, i) => {
      const parts = f.replace(/^data\//, '').split('/'), name = parts.pop(), folder = parts.join('/');
      return '<div class="dt-file' + (i === cur ? ' is-cur' : '') + '" draggable="true" data-idx="' + i + '">' +
        '<span class="dt-grip" title="Drag to reorder">⠿</span>' +
        (i === 0 ? '<span class="dt-chip is-accent dt-def" title="First file = the curve EQ loads">DEFAULT</span>' : '') +
        '<span class="dt-t dt-mono" data-dt="prev-file" data-a="' + i + '" title="' + E(f) + '"><span class="dt-fd">' + E(folder) + '/</span><span class="dt-fn">' + E(name) + '</span></span>' +
        (i > 0 ? '<button class="dt-btn is-sm is-ico dt-fb" data-dt="file-top" data-a="' + i + '" title="Make default">★</button>' : '') +
        '<button class="dt-btn is-sm is-ico dt-fb" data-dt="file-dl" data-a="' + i + '" title="Download this raw curve file">⬇</button>' +
        '<button class="dt-btn is-sm is-ico dt-fb" data-dt="unlink" data-a="' + i + '" title="Unlink (file stays on disk)">✕</button></div>';
    }).join('') : '<div class="dt-box dt-help" style="padding:8px">No files linked.</div>';
    // Errors only: the header chip already says "✓ valid", and the green line sat
    // at the bottom of the tags column where a short column left it stranded.
    $('dt-msgs').innerHTML = errs.length ? errs.map(m => '<div class="dt-msg"><span>⚠</span><span>' + E(m) + '</span></div>').join('') : '';
    updateToolbar();
  }
  function updateToolbar() {
    const S = T.S; if (!S) return;
    const set = (id, fn) => { const el = $(id); if (el) fn(el); };
    set('dt-tb-undo', el => { el.disabled = !S.canUndo(); el.title = S.canUndo() ? 'Undo: ' + S.undoStack[S.undoStack.length - 1].label : 'Nothing to undo'; });
    set('dt-tb-redo', el => { el.disabled = !S.canRedo(); el.title = S.canRedo() ? 'Redo: ' + S.redoStack[S.redoStack.length - 1].label : 'Nothing to redo'; });
    set('dt-tb-save', el => { el.textContent = S.dirty ? '💾 Save •' : '💾 Save'; });
    set('dt-tb-dup', el => { el.disabled = T.isNew || !T.selUid; });
    set('dt-tb-del', el => { el.disabled = T.isNew || !T.selUid; });
    set('dt-apply', el => { el.disabled = !T.draftDirty; });
    set('dt-revert', el => { el.disabled = !T.draftDirty; });
    const live = T.draft && !T.isNew && !T.draftDirty && T.S.byUid(T.selUid);
    let inApp = false;
    try { inApp = !!(live && typeof IEM !== 'undefined' && IEM.getIemDatabase().some(x => x.id === live.id)); } catch (_) {}
    set('dt-go-eq', el => { el.disabled = !inApp; el.title = inApp ? 'Load this curve into the EQ tab' : 'Save, then reload the app'; });
    set('dt-go-review', el => { el.disabled = !inApp; el.title = inApp ? 'Load this entry into the Review tab' : 'Save, then reload the app'; });
    const slot = $('dt-banner-slot');
    if (slot) slot.innerHTML = bannerHtml();
  }
  function bannerHtml() {
    const b = T.ex.banner;
    if (b === 'restore') return '<div class="dt-banner">↩️ Restore unsaved edits? <button class="dt-btn is-sm" data-dt="restore">Restore</button><button class="dt-btn is-sm" data-dt="dismiss-banner">Dismiss</button></div>';
    if (b && b.kind === 'saved') return '<div class="dt-banner is-ok">💾 ' + E(b.text) + (b.mode !== 'memory' ? ' <button class="dt-btn is-sm" data-dt="reload-app" title="Reload so every tab uses the saved database">↻ Reload</button>' : '') + '<button class="dt-btn is-sm is-ico" data-dt="dismiss-banner" style="margin-left:auto">✕</button></div>';
    if (T.gzStale) return '<div class="dt-banner">⚠ database.json is newer than the compressed copy. <button class="dt-btn is-sm" data-dt="compress">Compress</button></div>';
    if (T.notes && T.notes.length && !T._notesSeen) return '<div class="dt-banner">ℹ️ ' + T.notes.length + ' fields cleaned on load. <button class="dt-btn is-sm" data-dt="dismiss-notes">OK</button></div>';
    return '';
  }

  // field handlers ---------------------------------------------------------
  function onField(name, el) {
    const d = T.draft; if (!d) return;
    const f = name.slice(2), v = el.value;
    if (f === 'brand' || f === 'model' || f === 'variant') d[f] = v;
    else if (f === 'driver_config') { d.driver_config = v.replace(/\s+/g, ''); normDraft(d, true); }
    else d[f] = DC.coerceInt(v, 0);
    if (f !== 'driver_config') normDraft(d);
    refreshDerived();
  }
  function onFieldCommit(name, el) {
    const d = T.draft; if (!d) return;
    const f = name.slice(2);
    if (f === 'price_usd') { d.price_usd = DC.roundPriceTo5(d.price_usd); el.value = d.price_usd; normDraft(d); }
    if (f === 'driver_config') { normDraft(d); el.value = d.driver_config; }
    refreshDerived();
  }
  function stepValue(kind, dir) {
    const d = T.draft; if (!d) return;
    const list = kind === 'ff' ? DC.FORM_FACTORS : (DC.FORM_CONNECTOR_MAP[d.form_factor] || DC.CONNECTORS_ALL);
    const key = kind === 'ff' ? 'form_factor' : 'connector';
    let i = list.indexOf(d[key]); i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    d[key] = list[i]; normDraft(d); refreshDerived();
  }
  function driverStep(tech, dir) {
    const d = T.draft; if (!d) return;
    const p = DC.parseDriverConfig(d.driver_config);
    if (DC.driverConfigUnknownTokens(d.driver_config).length) { toast('Fix the unknown tokens in the config text first.', '⚠️'); return; }
    p[tech] = Math.max(0, Math.min(99, (p[tech] || 0) + dir));
    const c = DC.classifyDriver(p); d.driver_config = c[1]; d.driver_type = c[0]; normDraft(d); refreshDerived();
  }
  function toggleTag(tag) {
    const d = T.draft; if (!d || DC.PRICE_TIER_TAGS.indexOf(tag) >= 0) return;
    const i = d.tags.indexOf(tag);
    if (i >= 0) d.tags.splice(i, 1);
    else { if (d.tags.length >= DC.MAX_TAGS) { toast('A maximum of ' + DC.MAX_TAGS + ' tags is allowed.', '⚠️'); return; } d.tags.push(tag); }
    normDraft(d); refreshDerived();
  }
  function linkFile(path) {
    const d = T.draft; if (!d || T.isNew) { toast('Apply the entry first.', 'ℹ️'); return false; }
    const n = DC.normRelPath(String(path || '').trim());
    if (!/^data\/.+\.txt$/i.test(n)) { toast('Use a path like data/FOLDER/NAME.txt', '⚠️'); return false; }
    if (d.files.some(f => DC.foldPath(f) === DC.foldPath(n))) { toast('Already linked.', 'ℹ️'); return false; }
    if (T.diskFiles && !diskHas(n)) toast('Linked, but the file is not on disk.', '⚠️');
    commitFiles(d.files.concat([n]), 'Link measurement file', d.files.length);
    return true;
  }
  function fileSuggest(q) {
    const box = $('dt-file-sug'); if (!box) return;
    q = q.trim().toLowerCase();
    if (!q || !T.diskFiles) { box.style.display = 'none'; return; }
    const toks = q.split(/\s+/), linked = new Set((T.draft ? T.draft.files : []).map(f => f.toLowerCase()));
    const out = [];
    for (let i = 0; i < T.diskFiles.length && out.length < 8; i++) {
      const p = T.diskFiles[i], l = p.toLowerCase();
      if (linked.has(l)) continue;
      if (toks.every(t => l.indexOf(t) >= 0)) out.push(p);
    }
    box.innerHTML = out.map(p => '<button data-dt="pick-file" data-a="' + E(p) + '">&lrm;' + E(p) + '</button>').join('');
    box.style.display = out.length ? 'block' : 'none';
  }

  // curve preview ------------------------------------------------------------
  let previewToken = 0;
  async function loadPreview() {
    const d = T.draft; const tok = ++previewToken;
    T.curveRows = null;
    const cap = $('dt-curve-cap');
    if (!d || !d.files.length) { if (cap) cap.textContent = 'No curve'; drawCurve(); return; }
    const idx = Math.min(T.curveFileIdx, d.files.length - 1), path = d.files[idx];
    if (cap) cap.textContent = 'Loading…';
    try {
      let rows = T.curveCache.get(path);
      if (!rows) { rows = DCV.parseCurveText(await DataStore.readDataFile(path)); T.curveCache.set(path, rows); }
      if (tok !== previewToken) return;
      T.curveRows = rows; T.curveName = path.split('/').pop();
      const a = DCV.analyzePoints(rows.map(r => [r[0], r[1]]));
      T.sugg = a.ok ? a : null;
    } catch (e) { if (tok !== previewToken) return; T.curveRows = null; T.sugg = null; if (cap) cap.textContent = 'Could not read ' + path.split('/').pop(); }
    if (tok !== previewToken) return;
    refreshDerived(); drawCurve();
  }
  function drawCurve() {
    const cv = $('dt-canvas'); if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const accent = (css.getPropertyValue('--accent') || '#4af').trim() || '#4af';
    const L = 34, R = 10, Tp = 18, B = 18;                       // plot margins (room for axis labels)
    const X = f => L + (Math.log10(Math.max(20, Math.min(20000, f))) - Math.log10(20)) / 3 * (w - L - R);
    g.font = '10px sans-serif'; g.textBaseline = 'alphabetic';
    const cap = $('dt-curve-cap');
    let lo = 0, hi = 1, rows = null;
    if (T.curveRows && T.curveRows.length) {
      rows = T.curveRows.filter(r => r[0] >= 20 && r[0] <= 20000);
      if (rows.length) { const ys = rows.map(r => r[1]); lo = Math.min.apply(null, ys); hi = Math.max.apply(null, ys); }
      else rows = null;
    }
    const span = Math.max(10, hi - lo), step = span > 60 ? 20 : span > 28 ? 10 : 5;
    const yMin = Math.floor((lo - span * 0.08) / step) * step, yMax = Math.ceil((hi + span * 0.08) / step) * step;
    const Y = v => h - B - (v - yMin) / (yMax - yMin) * (h - B - Tp);
    g.lineWidth = 1;
    for (let v = yMin; v <= yMax + 0.001; v += step) {                // horizontal dB grid
      const y = Math.round(Y(v)) + .5;
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.42)'; g.textAlign = 'right'; g.fillText(String(v), L - 5, y + 3);
    }
    [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k']].forEach(t => {
      const x = Math.round(X(t[0])) + .5, major = t[0] === 100 || t[0] === 1000 || t[0] === 10000;
      g.strokeStyle = major ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(x, Tp); g.lineTo(x, h - B); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.42)'; g.textAlign = 'center'; g.fillText(t[1], x, h - 5);
    });
    if (!rows) return;
    g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    rows.forEach((r, i) => { const x = X(r[0]), y = Y(r[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    if (cap) cap.textContent = T.curveName + ' · ' + rows.length + ' pts';
  }

  // measurement boxes: reorder (saved to the entry immediately), make default, download -------
  function commitFiles(newFiles, label, showIdx) {
    const d = T.draft; if (!d) return;
    d.files = newFiles;
    T.curveFileIdx = showIdx || 0;
    if (!T.isNew) {
      const e = T.S.byUid(T.selUid);
      if (e) {
        const next = cloneDraft(e); next.files = newFiles.slice();
        T.draftBase.files = newFiles.slice();        // keep any other unapplied edits unapplied
        T.S.updateEntry(T.selUid, next, label + ' — ' + DC.formatEntryLabel(e));
      }
    }
    refreshDerived(); loadPreview();
  }
  function moveFile(from, insertAt) {
    const arr = T.draft.files.slice();
    if (from < 0 || from >= arr.length) return;
    const m = arr.splice(from, 1)[0];
    if (from < insertAt) insertAt--;
    insertAt = Math.max(0, Math.min(arr.length, insertAt));
    arr.splice(insertAt, 0, m);
    if (JSON.stringify(arr) === JSON.stringify(T.draft.files)) return;
    commitFiles(arr, 'Reorder measurement files');
  }
  async function downloadCurve(i) {
    const path = T.draft && T.draft.files[i]; if (!path) return;
    try { DataStore.downloadBlob(path.split('/').pop(), await DataStore.readDataFile(path), 'text/plain'); }
    catch (e) { toast('Could not read ' + path.split('/').pop() + ' — is it on disk?', '⚠️'); }
  }
  let dragFrom = -1;
  function clearDropMarks() { document.querySelectorAll('#dt-files .is-drop-before, #dt-files .is-drop-after').forEach(n => n.classList.remove('is-drop-before', 'is-drop-after')); }
  function onDragStart(e) {
    const row = e.target.closest && e.target.closest('.dt-file[data-idx]'); if (!row) return;
    dragFrom = Number(row.getAttribute('data-idx'));
    row.classList.add('is-dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'iem-file-' + dragFrom); } catch (_) {}
  }
  function onDragOver(e) {
    const z = e.target.closest && e.target.closest('.dt-drop'); if (z) { e.preventDefault(); z.classList.add('is-over'); return; }
    if (dragFrom < 0) return;
    const row = e.target.closest && e.target.closest('.dt-file[data-idx]'); if (!row) return;
    e.preventDefault(); clearDropMarks();
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY > r.top + r.height / 2 ? 'is-drop-after' : 'is-drop-before');
  }
  function onDragEnd() { dragFrom = -1; clearDropMarks(); document.querySelectorAll('#dt-files .is-dragging').forEach(n => n.classList.remove('is-dragging')); }
  // jump to other tabs --------------------------------------------------------
  async function goEq() {
    const e = T.S.byUid(T.selUid); if (!e) return;
    try {
      const uid = e.id + '_src_0';
      if (!PEQDB_Module.STATE.activeCurves.some(c => c.uid === uid)) await PEQDB_Module.toggleCurveSelection(e.id, 0);
      App.switchTab('eq');
    } catch (err) { toast('Could not load the curve into EQ.', '⚠️'); }
  }
  async function goReview() {
    const e = T.S.byUid(T.selUid); if (!e) return;
    try { App.switchTab('iem'); await IEM.applyDbEntryToReview(e.id); } catch (err) { toast('Could not load the entry into Review.', '⚠️'); }
  }

  // ===================================================================== audit
  function diskList() {
    if (!Array.isArray(T.diskFiles)) return null;
    const pend = Array.from(DataStore.state.pending.keys());
    return pend.length ? T.diskFiles.concat(pend.filter(p => T.diskFiles.indexOf(p) < 0)) : T.diskFiles;
  }
  function scheduleAudit() { clearTimeout(T.auditTimer); T.auditTimer = setTimeout(runAudit, 1800); }
  function runAudit() {
    if (!T.S) return;
    clearTimeout(T.auditTimer);
    T.auditRunning = true; renderAudit();
    setTimeout(() => {
      const entries = T.S.entries;
      let issues;
      try { issues = DC.runFullAudit(entries, diskList()); } catch (e) { console.error('[DataTab] audit failed', e); issues = []; toast('Audit crashed: ' + e.message, '⚠️'); }
      issues.forEach(i => { i.uid = i.entryIndex >= 0 && entries[i.entryIndex] ? entries[i.entryIndex]._uid : null; });
      T.issues = issues; T.auditAt = Date.now(); T.auditRunning = false; T.openIssue = -1; T.auditSel = new Set(); T.lastSel = -1;
      recomputeIssueMap();
      renderAudit(); scheduleTree();
    }, 12);
  }
  function recomputeIssueMap() {
    const rank = { error: 3, warning: 2, info: 1 }, m = new Map();
    T.issues.forEach(i => { if (i.uid === null || T.waivers.has(i.waiverKey)) return; const cur = m.get(i.uid); if (!cur || rank[i.severity] > rank[cur]) m.set(i.uid, i.severity === 'warning' ? 'warn' : i.severity === 'error' ? 'err' : 'info'); });
    T.issueByUid = m;
  }
  function visibleIssues() {
    return T.issues.map((iss, i) => ({ iss: iss, i: i })).filter(x => {
      const ign = T.waivers.has(x.iss.waiverKey);
      if (ign !== T.showIgnored) return false;
      if (T.auditSev !== 'all' && x.iss.severity !== T.auditSev) return false;
      if (T.auditCat !== 'all' && x.iss.category !== T.auditCat) return false;
      return true;
    });
  }
  const deletable = i => i.category === 'Unlinked File' && /^data\/.+\.txt$/i.test(i.subject || '');
  function renderAudit() {
    const el = $('dt-audit-body'); if (!el) return;
    if (!T.ready) { el.innerHTML = '<div class="dt-empty">Waiting for the database…</div>'; return; }
    const keepTop = (() => { const sc = el.querySelector('.dt-scroll'); return sc ? sc.scrollTop : 0; })();
    const live = T.issues.filter(i => !T.waivers.has(i.waiverKey)), sum = DC.summarizeIssues(live);
    const ignoredN = T.issues.length - live.length;
    const cats = Array.from(new Set(T.issues.map(i => i.category))).sort();
    const vis = visibleIssues();
    const fixable = vis.filter(x => x.iss.fix && !T.showIgnored);
    const selVis = vis.filter(x => T.auditSel.has(x.i));
    const selFix = selVis.filter(x => x.iss.fix).length, selDel = selVis.filter(x => deletable(x.iss)).length;
    const allSel = vis.length > 0 && selVis.length === vis.length;
    const sevChip = (k, label, n, cls) => '<button class="dt-chip ' + (T.auditSev === k ? 'is-accent' : cls) + '" data-dt="sev" data-a="' + k + '">' + label + (n === null ? '' : ' ' + n) + '</button>';
    const rows = vis.slice(0, 300).map(x => {
      const i = x.iss, open = T.openIssue === x.i;
      return '<div class="dt-issue' + (open ? ' is-open' : '') + (T.auditSel.has(x.i) ? ' is-sel' : '') + '"><div class="dt-top"><input type="checkbox" data-dt="issue-sel" data-a="' + x.i + '"' + (T.auditSel.has(x.i) ? ' checked' : '') + ' aria-label="Select this finding"><span class="dt-dot is-' + (i.severity === 'warning' ? 'warn' : i.severity === 'error' ? 'err' : 'info') + '"></span><span>' + E(i.category) + '</span><span class="dt-mono" style="text-transform:none;letter-spacing:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">' + E(i.entryId) + '</span></div>' +
        '<div class="dt-m" data-dt="issue-open" data-a="' + x.i + '" style="cursor:pointer" title="Click to expand">' + E(i.message) + '</div><div class="dt-acts">' +
        (i.uid !== null ? '<button class="dt-btn is-sm" data-dt="issue-go" data-a="' + x.i + '">Go to</button>' : '') +
        (i.fix && !T.showIgnored ? '<button class="dt-btn is-sm is-primary" data-dt="issue-fix" data-a="' + x.i + '">Auto-fix</button>' : '') +
        (i.pairIds ? '<button class="dt-btn is-sm" data-dt="issue-merge" data-a="' + x.i + '">Merge…</button>' : '') +
        (i.repair && !T.showIgnored ? '<button class="dt-btn is-sm is-primary" data-dt="issue-repair" data-a="' + x.i + '" title="Create the correctly named file from the #U copy">Restore name</button>' : '') +
        (deletable(i) && !T.showIgnored ? '<button class="dt-btn is-sm is-danger" data-dt="issue-delfile" data-a="' + x.i + '" title="Delete this file from the data folder">🗑 Delete</button>' : '') +
        '<button class="dt-btn is-sm" data-dt="issue-ignore" data-a="' + x.i + '">' + (T.showIgnored ? 'Restore' : 'Ignore') + '</button></div></div>';
    }).join('');
    el.innerHTML =
      '<div class="dt-row"><button class="dt-btn is-primary dt-grow" data-dt="audit-run"' + (T.auditRunning ? ' disabled' : '') + '>' + (T.auditRunning ? '⏳ Auditing…' : '🩺 Run audit') + '</button>' +
      '<button class="dt-btn dt-grow" data-dt="audit-fixall"' + (fixable.length ? '' : ' disabled') + ' title="Auto-fix every fixable finding in the current filter">🔧 Fix all ' + fixable.length + '</button></div>' +
      '<div class="dt-row" style="flex-wrap:wrap;gap:4px">' + sevChip('all', 'All', live.length, '') + sevChip('error', 'Errors', sum.error, 'is-err') + sevChip('warning', 'Warn', sum.warning, 'is-warn') + sevChip('info', 'Info', sum.info, 'is-info') + '</div>' +
      '<div class="dt-row"><select class="dt-sel input-bg-fix" data-f="audit-cat" style="height:26px"><option value="all">All categories</option>' + cats.map(c => '<option' + (c === T.auditCat ? ' selected' : '') + '>' + E(c) + '</option>').join('') + '</select>' +
      '<button class="dt-btn is-sm' + (T.showIgnored ? ' is-on' : '') + '" data-dt="audit-ignored" title="' + (T.showIgnored ? 'Back to findings' : 'Show ignored findings') + '">🙈 ' + ignoredN + '</button></div>' +
      '<div class="dt-row dt-selbar"><label class="dt-row" style="gap:5px;cursor:pointer;font-size:var(--t-xs);font-weight:800"><input type="checkbox" data-dt="audit-selall"' + (allSel ? ' checked' : '') + (vis.length ? '' : ' disabled') + '> All ' + vis.length + '</label><span class="dt-grow"></span>' +
      '<button class="dt-btn is-sm" data-dt="audit-ign-sel"' + (selVis.length ? '' : ' disabled') + '>' + (T.showIgnored ? '↩ Restore ' : '🙈 Ignore ') + selVis.length + '</button>' +
      (!T.showIgnored ? '<button class="dt-btn is-sm" data-dt="audit-fix-sel"' + (selFix ? '' : ' disabled') + '>🔧 ' + selFix + '</button>' : '') +
      (selDel && !T.showIgnored ? '<button class="dt-btn is-sm is-danger" data-dt="audit-del-sel" title="Delete the selected unlinked files">🗑 ' + selDel + '</button>' : '') + '</div>' +
      '<div class="dt-box dt-scroll dt-grow">' + (rows || '<div class="dt-empty"><span class="dt-big">' + (T.issues.length ? '🔎' : '✅') + '</span>' + (T.issues.length ? 'No matches.' : 'All clean.') + '</div>') + (vis.length > 300 ? '<div class="dt-help" style="padding:6px">Showing 300 of ' + vis.length + '.</div>' : '') + '</div>' +
      '<p class="dt-help">' + (Array.isArray(T.diskFiles) ? T.S.entries.length + ' entries · ' + T.diskFiles.length + ' files checked' : 'File checks need the desktop app.') + '</p>';
    const sc = el.querySelector('.dt-scroll'); if (sc) sc.scrollTop = keepTop;
  }
  function findIssue(i) { return T.issues[Number(i)]; }
  function fixOne(iss) {
    let ok = false;
    T.S.batch('Fix: ' + iss.category + ' — ' + iss.entryId, list => { ok = iss.fix(list) !== null; });
    toast(ok ? 'Fixed: ' + iss.category : 'Could not apply that fix (the entry changed).', ok ? '🔧' : '⚠️');
    refreshSelection(); runAudit();
  }
  async function fixAll() {
    const todo = visibleIssues().filter(x => x.iss.fix).map(x => x.iss);
    if (!todo.length) return;
    const ok = await UIKit.confirm({ title: 'Apply ' + todo.length + ' auto-fixes?', message: 'One Undo reverts them all.', confirmLabel: 'Fix ' + todo.length, icon: '🔧' });
    if (!ok) return;
    let n = 0;
    T.S.batch('Audit: fix ' + todo.length + ' findings', list => { todo.forEach(i => { if (i.fix(list) !== null) n++; }); });
    toast('Applied ' + n + ' of ' + todo.length + ' fixes.', '🔧'); refreshSelection(); runAudit();
  }
  function persistWaivers() { DataStore.kvSet('waivers', Array.from(T.waivers)); }
  function toggleIgnore(iss) {
    if (T.waivers.has(iss.waiverKey)) T.waivers.delete(iss.waiverKey); else T.waivers.add(iss.waiverKey);
    persistWaivers(); recomputeIssueMap(); renderAudit(); scheduleTree();
  }
  function selectedIssues() { return visibleIssues().filter(x => T.auditSel.has(x.i)).map(x => x.iss); }
  function bulkIgnore() {
    const list = selectedIssues(); if (!list.length) return;
    list.forEach(i => { if (T.showIgnored) T.waivers.delete(i.waiverKey); else T.waivers.add(i.waiverKey); });
    T.auditSel = new Set(); T.lastSel = -1;
    persistWaivers(); recomputeIssueMap(); renderAudit(); scheduleTree();
    toast((T.showIgnored ? 'Restored ' : 'Ignored ') + list.length + ' finding' + (list.length === 1 ? '' : 's') + (T.showIgnored ? '.' : ' — bring them back any time from 🙈.'), '🙈');
  }
  async function bulkFix() {
    const todo = selectedIssues().filter(i => i.fix); if (!todo.length) return;
    const ok = await UIKit.confirm({ title: 'Apply ' + todo.length + ' auto-fixes?', message: 'One Undo reverts them all.', confirmLabel: 'Fix ' + todo.length });
    if (!ok) return;
    let n = 0;
    T.S.batch('Audit: fix ' + todo.length + ' selected findings', list => { todo.forEach(i => { if (i.fix(list) !== null) n++; }); });
    toast('Applied ' + n + ' of ' + todo.length + ' fixes.', '🔧'); refreshSelection(); runAudit();
  }
  async function deleteFiles(issues) {
    const paths = Array.from(new Set(issues.filter(deletable).map(i => i.subject)));
    if (!paths.length) return;
    const where = DataStore.state.mode === 'electron' && DataStore.state.packaged ? 'your working copy' : (DataStore.state.mode === 'electron' ? 'the project folder (these ship with the app)' : 'the connected folder');
    const ok = await UIKit.confirm({ title: 'Delete ' + paths.length + ' file' + (paths.length === 1 ? '' : 's') + '?', message: paths.length === 1 ? paths[0] + '\n\nDeleted from ' + where + '. Cannot be undone.' : paths.length + ' unlinked files will be deleted from ' + where + '. Cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    let n = 0, failed = '';
    for (const p of paths) {
      try { await DataStore.deleteDataFile(p); n++; if (Array.isArray(T.diskFiles)) { const k = T.diskFiles.indexOf(p); if (k >= 0) T.diskFiles.splice(k, 1); } T.curveCache.delete(p); }
      catch (e) { failed = String((e && e.message) || e); if (/Cancelled/.test(failed)) break; }
    }
    toast(n ? 'Deleted ' + n + ' file' + (n === 1 ? '' : 's') + '.' : 'Nothing deleted: ' + failed, n ? '🗑' : '⚠️');
    runAudit();
  }

  // The real file is missing but a copy with the accent saved as "#U00dc" exists: create the
  // correctly named file from it, then remove the mis-named copy.
  async function repairName(iss) {
    const r = iss.repair; if (!r) return;
    try {
      const text = await DataStore.readDataFile(r.from);
      const w = await DataStore.writeDataFile(r.to, text, false);
      if (w && w.skipped) { toast('A file with that name already exists.', '⚠️'); return; }
      await DataStore.deleteDataFile(r.from);
      if (Array.isArray(T.diskFiles)) { const k = T.diskFiles.indexOf(r.from); if (k >= 0) T.diskFiles.splice(k, 1); if (!diskHas(r.to)) T.diskFiles.push(r.to); }
      T.curveCache.delete(r.to);
      toast('Restored ' + r.to.split('/').pop(), '🔤');
    } catch (e) { toast('Could not restore: ' + ((e && e.message) || e), '⚠️'); }
    runAudit();
  }
  async function mergeDup(iss) {
    const S = T.S, a = S.entries.find(e => e.id === iss.pairIds[0]), b = S.entries.find(e => e.id === iss.pairIds[1] && e !== a);
    if (!a || !b) { toast('Entry gone. Re-run the audit.', '⚠️'); return; }
    const ok = await UIKit.confirm({ title: 'Merge duplicates?', message: 'KEEP: ' + DC.formatEntryLabel(a) + ' (' + a.id + ')\nREMOVE: ' + DC.formatEntryLabel(b) + ' (' + b.id + ')\n\nFiles and tags are combined. One Undo reverts it.', confirmLabel: 'Merge', icon: '🧬' });
    if (!ok) return;
    S.batch('Merge ' + b.id + ' into ' + a.id, list => {
      ['year', 'price_usd', 'impedance', 'sensitivity'].forEach(f => { if (!a[f] && b[f]) a[f] = b[f]; });
      ['variant', 'driver_type', 'driver_config', 'connector', 'form_factor'].forEach(f => { if (!a[f] && b[f]) a[f] = b[f]; });
      b.files.forEach(f => { if (!a.files.some(x => x.toLowerCase() === f.toLowerCase())) a.files.push(f); });
      const merged = a.tags.slice(); b.tags.forEach(t => { if (merged.indexOf(t) < 0 && merged.length < DC.MAX_TAGS) merged.push(t); });
      a.tags = DC.fixTierTags(merged, a.price_usd).tags;
      const i = list.indexOf(b); if (i >= 0) list.splice(i, 1);
    });
    toast('Merged into ' + a.id + '.', '🧬'); selectUid(a._uid, true); runAudit();
  }

  // ======================================================================= AI
  const AI_EMPTY = () => ({ text: '', proposals: [], notes: '', include: new Set(), fieldSel: new Map(), collapsed: new Set(), errors: [], log: '', status: '' });
  function aiShell() {
    return '<div class="dt-col dt-grow" style="gap:8px">' +
      '<div class="dt-g2"><button class="dt-btn" data-dt="copy-prompt" data-a="addEntry" title="Give this to an AI with your list of IEMs">📋 Add-entry prompt</button><button class="dt-btn" data-dt="copy-prompt" data-a="audit" title="Give this to an AI with a chunk of your database">📋 Audit prompt</button></div>' +
      '<textarea id="dt-ai-in" class="dt-ta dt-mono dt-ai-ta" data-f="ai-text" placeholder="Paste the AI reply here…" spellcheck="false"></textarea>' +
      '<div class="dt-row"><button class="dt-btn is-primary dt-grow" data-dt="ai-analyze">🔍 Analyze</button><button class="dt-btn" data-dt="ai-paste" title="Paste the clipboard and analyze it">📥 Paste</button><button class="dt-btn" data-dt="ai-clear">Clear</button></div>' +
      '<div id="dt-ai-res" class="dt-col dt-grow" style="gap:6px"></div></div>';
  }
  function aiFieldsOf(p) {
    if (p.action === 'changed') return p.changes.map(c => c[0]);
    if (p.action === 'new') return DC.SCHEMA_FIELDS.filter(f => f !== 'id' && Object.prototype.hasOwnProperty.call(p.entry, f));
    return [];
  }
  function aiAnalyze() {
    const A = T.ai, txt = $('dt-ai-in').value; A.text = txt; A.log = '';
    if (!txt.trim()) { A.proposals = []; A.errors = []; A.status = 'Paste a reply first.'; toast('Paste a reply first.', 'ℹ️'); renderAI(); return; }
    let parsed;
    try { parsed = DI.parseAiOutput(txt); } catch (e) { parsed = { objects: [], replacements: [], errors: ['Could not read that text: ' + (e && e.message ? e.message : e)] }; }
    const fixedBrands = DI.normalizeBrandSpellings(T.S.entries, parsed);
    const nz = DI.normalizeParsed(parsed);
    const props = DI.classifyAgainst(T.S.entries, parsed);
    props.forEach(p => { if (p.pos !== undefined && T.S.entries[p.pos]) p.uid = T.S.entries[p.pos]._uid; });
    A.proposals = props; A.errors = parsed.errors.slice(); A.include = new Set(); A.fieldSel = new Map(); A.collapsed = new Set();
    props.forEach((p, i) => { if (p.action === 'new' || p.action === 'changed') A.include.add(i); });
    const c = { new: 0, changed: 0, delete: 0, same: 0, invalid: 0 }; props.forEach(p => c[p.action]++);
    const found = props.length;
    A.status = found ? 'Found ' + found + ' entr' + (found === 1 ? 'y' : 'ies') + ': ' + [c.new && c.new + ' new', c.changed && c.changed + ' changed', c.delete && c.delete + ' to delete', c.same && c.same + ' identical', c.invalid && c.invalid + ' skipped'].filter(Boolean).join(' · ') + '.'
      : (A.errors.length ? 'No entries could be read from that text.' : 'No entries found in that text.');
    A.notes = (fixedBrands ? 'Brands matched: ' + fixedBrands + '. ' : '') + (nz.fixed ? 'Prices/tiers fixed: ' + nz.fixed + '.' : '');
    renderAI();
    toast(A.status, found ? '🔍' : 'ℹ️');
  }
  async function aiPaste() {
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt || !txt.trim()) { toast('The clipboard is empty.', 'ℹ️'); return; }
      $('dt-ai-in').value = txt; aiAnalyze();
    } catch (e) { toast('Clipboard blocked. Press Ctrl+V in the box.', '⚠️'); }
  }
  const aiFmt = v => Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : (v === '' || v === null || v === undefined || v === 0 ? '—' : String(v));
  function renderAI() {
    const el = $('dt-ai-res'); if (!el) return;
    const A = T.ai;
    if (!A.status && !A.proposals.length && !A.errors.length && !A.log) { el.innerHTML = ''; return; }
    const keepTop = (() => { const sc = el.querySelector('.dt-scroll'); return sc ? sc.scrollTop : 0; })();
    const rows = A.proposals.map((p, i) => {
      const label = p.action === 'new' ? DC.formatEntryLabel(p.entry) : p.action === 'invalid' ? DC.formatEntryLabel(p.entry || {}) : DC.formatEntryLabel(p.old);
      const badge = { new: ['is-ok', 'NEW'], changed: ['is-warn', 'CHANGES'], delete: ['is-err', 'DELETE'], same: ['', 'NO CHANGE'], invalid: ['is-err', 'SKIPPED'] }[p.action];
      const fields = aiFieldsOf(p), sel = A.fieldSel.get(i) || new Set(fields);
      const open = (p.action === 'new' || p.action === 'changed') && !A.collapsed.has(i);
      let detail = '';
      if (open && p.action === 'changed') {
        detail = p.changes.map(c => '<label class="dt-fld"><input type="checkbox" data-dt="ai-field" data-a="' + i + '" data-b="' + c[0] + '"' + (sel.has(c[0]) ? ' checked' : '') + '><span class="dt-v"><b>' + c[0] + '</b><br><s>' + E(aiFmt(c[1])) + '</s> → <ins>' + E(aiFmt(c[2])) + '</ins></span></label>').join('');
      } else if (open && p.action === 'new') {
        detail = fields.map(f => '<label class="dt-fld"><input type="checkbox" data-dt="ai-field" data-a="' + i + '" data-b="' + f + '"' + (sel.has(f) ? ' checked' : '') + '><span class="dt-v"><b>' + f + '</b>: <ins>' + E(aiFmt(p.entry[f])) + '</ins></span></label>').join('');
      } else if (p.action === 'invalid') detail = '<div class="dt-fld"><span class="dt-v">' + E(p.error) + '</span></div>';
      else if (p.action === 'same') detail = '<div class="dt-fld"><span class="dt-v">Identical — nothing to change.</span></div>';
      else if (p.action === 'delete') detail = '<div class="dt-fld"><span class="dt-v">Removes <span class="dt-mono">' + E(p.old.id) + '</span>.</span></div>';
      const selectable = p.action === 'new' || p.action === 'changed' || p.action === 'delete';
      return '<div class="dt-prop' + (p.action === 'same' ? ' is-dim' : '') + '"><div class="dt-top">' + (selectable ? '<input type="checkbox" data-dt="ai-inc" data-a="' + i + '"' + (A.include.has(i) ? ' checked' : '') + ' aria-label="Include this entry">' : '<span style="width:14px"></span>') +
        '<span class="dt-chip ' + badge[0] + '">' + badge[1] + '</span><span class="dt-t" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--t-xs);font-weight:700" title="' + E(label) + '">' + E(label) + '</span>' +
        ((p.action === 'new' || p.action === 'changed') ? '<span class="dt-help">' + sel.size + '/' + fields.length + '</span><button class="dt-btn is-sm is-ico" data-dt="ai-open" data-a="' + i + '" style="width:22px;height:20px" title="Show / hide fields">' + (open ? '▾' : '▸') + '</button>' : '') + '</div>' + detail + '</div>';
    }).join('');
    const nSel = A.include.size;
    el.innerHTML = '<div class="dt-banner' + (A.proposals.some(p => p.action === 'new' || p.action === 'changed' || p.action === 'delete') ? ' is-ok' : '') + '">' + E(A.status) + '</div>' +
      (A.errors.length ? '<div class="dt-banner">' + E(A.errors.join(' ')) + '</div>' : '') +
      (A.notes ? '<p class="dt-help">' + E(A.notes) + '</p>' : '') +
      (A.proposals.length ? '<div class="dt-row"><span class="dt-help dt-grow">Tick what to apply.</span><button class="dt-btn is-sm" data-dt="ai-all" data-a="1">All</button><button class="dt-btn is-sm" data-dt="ai-all" data-a="0">None</button></div>' : '') +
      (rows ? '<div class="dt-box dt-scroll dt-grow">' + rows + '</div>' : '') +
      (A.log ? '<pre class="dt-log dt-box dt-scroll" style="max-height:110px">' + E(A.log) + '</pre>' : '') +
      (A.proposals.some(p => p.action === 'new' || p.action === 'changed' || p.action === 'delete') ? '<button class="dt-btn is-primary" data-dt="ai-apply"' + (nSel ? '' : ' disabled') + '>✅ Apply ' + nSel + ' selected</button>' : '');
    const sc = el.querySelector('.dt-scroll'); if (sc) sc.scrollTop = keepTop;
  }
  async function aiApply() {
    const A = T.ai;
    const staged = DI.stageCandidates(A.proposals, {
      include: A.include, liveIds: T.S.ids(-1), diskFiles: diskList(),
      fieldSel: (i, p) => { const s = A.fieldSel.get(i); if (!s || (p.action !== 'changed' && p.action !== 'new')) return null; return s.size === aiFieldsOf(p).length ? null : s; }
    });
    if (!staged.staged.length) { A.log = 'Nothing could be applied.\n' + staged.problems.join('\n'); renderAI(); return; }
    const dels = staged.staged.filter(x => x.candidate === null).length;
    if (dels) {
      const ok = await UIKit.confirm({ title: 'Delete ' + dels + ' entr' + (dels === 1 ? 'y' : 'ies') + '?', message: 'Undo brings them back.', confirmLabel: 'Apply', danger: true });
      if (!ok) return;
    }
    let nNew = 0, nChg = 0, nDel = 0;
    const beforeUids = new Set(T.S.entries.map(e => e._uid));
    T.S.batch('AI import: ' + staged.staged.length + ' entr' + (staged.staged.length === 1 ? 'y' : 'ies'), list => {
      staged.staged.forEach(x => {
        const p = x.proposal;
        if (p.action === 'new') { list.push(DC.buildCleanEntry(x.candidate)); nNew++; }
        else {
          const tgt = list.find(e => e._uid === p.uid); if (!tgt) return;
          if (x.candidate === null) { list.splice(list.indexOf(tgt), 1); nDel++; return; }
          const c = DC.buildCleanEntry(x.candidate); DC.SCHEMA_FIELDS.forEach(f => { tgt[f] = c[f]; }); nChg++;
        }
      });
    });
    const st = staged.stats, lines = ['Applied: ' + nNew + ' new, ' + nChg + ' changed, ' + nDel + ' deleted.'];
    st.strippedReports.forEach(l => lines.push('• ' + l)); st.keptReports.forEach(l => lines.push('• ' + l));
    if (staged.problems.length) { lines.push('', 'NOT applied (failed validation):'); staged.problems.forEach(l => lines.push('• ' + l)); }
    A.log = lines.join('\n'); A.proposals = []; A.include = new Set(); A.status = 'Applied. 💾 Save to keep.';
    A.text = ''; { const inp = $('dt-ai-in'); if (inp) inp.value = ''; }
    toast('AI import applied: ' + nNew + ' new, ' + nChg + ' changed' + (nDel ? ', ' + nDel + ' deleted' : '') + '.', '🤖');
    renderAI(); runAudit();
    // Jump to what changed: the first new entry, else the first edited one.
    const added = T.S.entries.find(e => !beforeUids.has(e._uid));
    const changedUid = staged.staged.filter(x => x.proposal.action === 'changed' && T.S.byUid(x.proposal.uid)).map(x => x.proposal.uid)[0];
    const focusUid = added ? added._uid : (changedUid !== undefined ? changedUid : null);
    if (focusUid !== null) {
      const fe = T.S.byUid(focusUid);
      if (fe) T.expanded.add(fe.brand || '(no brand)');
      revealInTree(focusUid);
      T._fromTap = true;   // on a phone, jump from Tools to the Editor section
      setLeft('tree'); setMid('editor'); selectUid(focusUid, true);
    } else refreshSelection();
  }

  // ===================================================================== curves
  // Folders under data/ are the SOURCE of a measurement (RTINGS, SUPER REVIEW …). Folder and
  // file names are UPPER CASE everywhere in the database, so the inputs lock to upper case.
  function lockClean(v) { return String(v || '').toUpperCase().replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').replace(/\s{2,}/g, ' '); }
  function lockInput(el) {
    const pos = el.selectionStart, v = lockClean(el.value);
    if (v !== el.value) { el.value = v; try { el.setSelectionRange(pos, pos); } catch (_) {} }
    return v;
  }
  function sourceFolders() {
    const set = new Set();
    (diskList() || []).forEach(p => { const seg = p.split('/')[1]; if (seg) set.add(seg); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  function chosenFolder() {
    const C = T.cv;
    return (C.source && C.source !== '__new__' ? C.source : lockClean(C.newSource)).trim().replace(/[. ]+$/, '');
  }
  function diskHas(rel) {
    const list = diskList(); if (!list) return false;
    const k = DC.foldPath(rel);
    return list.some(p => DC.foldPath(p) === k);
  }
  function labelKey(e, withVariant) { return DC.normalizeComponent([e.brand, e.model, withVariant ? e.variant : ''].filter(Boolean).join(' ')); }
  function guessEntryFor(key) {
    const k = DC.normalizeComponent(key); if (!k) return { exact: null, near: [] };
    let exact = null; const scored = [];
    T.S.entries.forEach(e => {
      if (!exact && (labelKey(e, true) === k || labelKey(e, false) === k)) exact = e._uid;
      else { const r = DC.seqRatio(k, labelKey(e, true)); if (r >= 0.8) scored.push([r, e._uid]); }
    });
    scored.sort((a, b) => b[0] - a[0]);
    return { exact: exact, near: scored.slice(0, 4).map(s => s[1]) };
  }
  function rebuildPlans() {
    const old = new Map(T.cv.plans.map(p => [p.plan.key, p]));
    T.cv.plans = DCV.planGroups(T.cv.queue).map(plan => {
      const prev = old.get(plan.key);
      if (prev) { prev.plan = plan; return prev; }
      const g = guessEntryFor(plan.key);
      // exact name match, else the entry open in the editor, else a new entry — always visible in the row's dropdown
      const link = g.exact !== null ? String(g.exact) : (T.selUid && !T.isNew && T.S.byUid(T.selUid) ? String(T.selUid) : 'new');
      return { plan: plan, name: lockClean(plan.suggestedName.replace(/\.txt$/i, '')), link: link, near: g.near };
    });
  }
  async function addCurveFiles(files) {
    const ok = Array.from(files).filter(f => /\.(txt|csv|tsv)$/i.test(f.name));
    if (!ok.length) { toast('Drop .txt or .csv measurement files.', 'ℹ️'); return; }
    for (const f of ok) {
      if (f.size > 8 * 1024 * 1024) { toast(f.name + ' is too large to be a curve.', '⚠️'); continue; }
      const text = await f.text();
      const i = T.cv.queue.findIndex(q => q.name === f.name);
      if (i >= 0) T.cv.queue[i] = { name: f.name, text: text }; else T.cv.queue.push({ name: f.name, text: text });
    }
    rebuildPlans(); renderCurves();
  }
  function renderCurves() {
    const el = $('dt-cv-body'); if (!el) return;
    if (!T.ready) { el.innerHTML = ''; return; }
    const C = T.cv, folders = sourceFolders();
    if (!C.source) C.source = folders.length ? folders[0] : '__new__';
    if (C.source !== '__new__' && folders.indexOf(C.source) < 0) C.source = folders.length ? folders[0] : '__new__';
    const folder = chosenFolder();
    const opt = u => { const t = T.S.byUid(Number(u)); return t ? '<option value="' + t._uid + '">' + E((Number(u) === T.selUid ? '🔗 Current: ' : '🔗 ') + DC.formatEntryLabel(t)) + '</option>' : ''; };
    const rows = C.plans.map((p, i) => {
      const rel = 'data/' + folder + '/' + (lockClean(p.name).replace(/\.TXT$/i, '').trim() || '…') + '.txt';
      const exists = folder && diskHas(rel);
      const choices = ['<option value="new">➕ New entry</option>', '<option value="none">— No link</option>'];
      const seen = new Set();
      [p.link !== 'new' && p.link !== 'none' ? p.link : null, T.selUid].concat(p.near || []).forEach(u => { if (u === null || u === undefined || seen.has(String(u))) return; seen.add(String(u)); choices.push(opt(u)); });
      const sel = choices.join('').replace('value="' + p.link + '"', 'value="' + p.link + '" selected');
      return '<div class="dt-prop"><div class="dt-row"><span class="dt-chip ' + (p.plan.averaged ? 'is-ok' : '') + '">' + (p.plan.averaged ? 'L+R avg' : p.plan.sources.length + ' file' + (p.plan.sources.length === 1 ? '' : 's')) + '</span>' +
        '<span class="dt-help dt-grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + E(p.plan.sources.map(s => s.name).join(' + ')) + '">' + E(p.plan.sources.map(s => s.name).join(' + ')) + '</span>' +
        (exists ? '<span class="dt-chip is-warn" title="' + E(rel) + '">exists · ' + (C.overwrite ? 'replace' : 'skip') + '</span>' : '') +
        '<button class="dt-btn is-sm is-ico" data-dt="cv-drop-plan" data-a="' + i + '" style="width:22px;height:20px" title="Remove">✕</button></div>' +
        '<div class="dt-g2" style="margin-top:5px"><input class="dt-in input-bg-fix dt-mono dt-up" style="height:26px" data-f="cv-name:' + i + '" value="' + E(p.name) + '" placeholder="NAME" spellcheck="false" autocomplete="off" title="File name (.txt is added)"><select class="dt-sel input-bg-fix" style="height:26px" data-f="cv-link:' + i + '" title="Link to">' + sel + '</select></div></div>';
    }).join('');
    el.innerHTML =
      '<div class="dt-cvsec"><label class="dt-lbl">Source folder</label>' +
      '<select class="dt-sel input-bg-fix" data-f="cv-source">' + folders.map(f => '<option value="' + E(f) + '"' + (C.source === f ? ' selected' : '') + '>' + E(f) + '</option>').join('') + '<option value="__new__"' + (C.source === '__new__' ? ' selected' : '') + '>➕ New source folder…</option></select>' +
      (C.source === '__new__' ? '<input class="dt-in input-bg-fix dt-mono dt-up" style="margin-top:5px" data-f="cv-newsource" value="' + E(C.newSource) + '" placeholder="NEW SOURCE NAME" spellcheck="false" autocomplete="off">' : '') +
      '<p class="dt-help" id="dt-cv-where" style="margin-top:3px">' + cvWhere(folder, folders) + '</p></div>' +
      '<div class="dt-drop" data-dt="cv-pick" title="Left/right or (1)/(2) pairs are averaged">📥 Drop .txt / .csv files here, or click to browse</div><input type="file" id="dt-cv-file" multiple accept=".txt,.csv,.tsv" data-f="cv-files" style="display:none">' +
      (rows ? '<div class="dt-box dt-scroll dt-grow">' + rows + '</div>' : '<div class="dt-grow"></div>') +
      (C.log ? '<pre class="dt-log dt-box dt-scroll" style="max-height:64px;flex:0 0 auto">' + E(C.log) + '</pre>' : '') +
      '<div class="dt-cvfoot"><div class="dt-row"><button class="dt-btn dt-grow' + (C.overwrite ? ' is-on' : '') + '" data-dt="cv-over" title="Replace files that already exist">♻ ' + (C.overwrite ? 'Replace' : 'Keep') + '</button><button class="dt-btn dt-grow" data-dt="cv-clear" title="Clear the list">Clear list</button></div>' +
      '<button class="dt-btn is-primary" data-dt="cv-convert"' + (C.plans.length && folder && !C.busy ? '' : ' disabled') + '>' + (C.busy ? '⏳ Converting…' : 'Convert & save') + '</button></div>';
  }
  function cvWhere(folder, folders) {
    const C = T.cv;
    return folder ? '→ data/<b class="dt-mono">' + E(folder) + '</b>/' + (C.source === '__new__' && (folders || sourceFolders()).some(f => f === folder) ? ' (exists)' : '') : 'Name the new folder.';
  }
  // Cheap live refresh while typing: no re-render, so focus and caret never move.
  function updateCvChrome() {
    const w = $('dt-cv-where'); if (w) w.innerHTML = cvWhere(chosenFolder());
    const b = document.querySelector('#dt-cv-body [data-dt=cv-convert]'); if (b) b.disabled = !(T.cv.plans.length && chosenFolder() && !T.cv.busy);
  }
  function guessBrandModel(name) {
    const brands = Array.from(new Set(T.S.entries.map(e => e.brand).filter(Boolean))).sort((a, b) => b.length - a.length);
    const low = name.toLowerCase();
    for (const b of brands) { const bl = b.toLowerCase(); if (low === bl || low.startsWith(bl + ' ')) return [b, name.slice(b.length).trim()]; }
    const parts = name.trim().split(/\s+/);
    return [parts[0] || '', parts.slice(1).join(' ')];
  }
  async function convertCurves() {
    const C = T.cv; if (C.busy || !C.plans.length) return;
    const folder = chosenFolder();
    if (!folder) { toast('Choose or name a source folder first.', '⚠️'); return; }
    C.busy = true; C.log = ''; renderCurves(); DataStore.kvSet('curveSource', folder);
    const log = [], jobs = [];
    try {
      for (const p of C.plans) {
        const base = lockClean(p.name).replace(/\.TXT$/i, '').trim();
        if (!base) { log.push('[SKIPPED] ' + p.plan.sources.map(x => x.name).join(' + ') + ' (no name)'); continue; }
        const r = DCV.convertPlan(p.plan, base + '.txt'); r.log.forEach(l => log.push(l));
        for (const o of r.outputs) {
          const rel = 'data/' + folder + '/' + o.name;
          try {
            const w = await DataStore.writeDataFile(rel, o.text, C.overwrite);
            if (w.skipped) { log.push('[EXISTS]   ' + rel + ' (skipped)'); jobs.push({ rel: rel, out: o, link: p.link, wrote: false }); }
            else { log.push('[SAVED]    ' + rel + (w.existed ? '  (replaced)' : '')); T.curveCache.delete(rel); jobs.push({ rel: rel, out: o, link: p.link, wrote: true }); }
          } catch (e) { log.push('[FAILED]   ' + rel + '  (' + ((e && e.message) || e) + ')'); if (/Cancelled/.test(String(e && e.message))) throw e; }
        }
      }
    } catch (e) { C.busy = false; C.log = log.join('\n') || String(e.message || e); renderCurves(); return; }
    // Link / create entries as ONE undoable step.
    let linked = 0, created = 0, firstNew = null;
    T.S.batch('Import ' + jobs.length + ' curve' + (jobs.length === 1 ? '' : 's'), list => {
      jobs.forEach(j => {
        if (j.wrote && T.diskFiles && !diskHas(j.rel)) T.diskFiles.push(j.rel);
        let target = null;
        if (j.link === 'none') return;
        if (j.link !== 'new') target = list.find(e => e._uid === Number(j.link));
        if (!target) {
          const bm = guessBrandModel(j.out.name.replace(/\.txt$/i, ''));
          const toTitle = s => s.split(/\s+/).map(w => (/^[A-Z0-9\-+.]+$/.test(w) && w.length > 3 ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
          const e = DC.blankEntry(); e.brand = bm[0] ? toTitle(bm[0]) : ''; e.model = toTitle(bm[1] || bm[0]); e.form_factor = 'IEM'; e.connector = '2-pin';
          e.id = DC.buildId(e.brand, e.model, e.variant);
          const dup = list.find(x => x.id === e.id);
          if (dup) target = dup;
          else {
            const a = DCV.analyzePoints(j.out.rows); const tags = a.ok ? a.suggestions.map(s => s.tag).filter(t => DC.PRICE_TIER_TAGS.indexOf(t) < 0).slice(0, 7) : [];
            e.tags = DC.fixTierTags(tags, 0).tags; list.push(e); target = e; created++; if (!firstNew) firstNew = e;
          }
        }
        if (!target.files.some(f => DC.foldPath(f) === DC.foldPath(j.rel))) { target.files.push(j.rel); linked++; }
      });
    });
    log.push('', 'Linked ' + linked + (created ? ' · new drafts: ' + created : ''));
    C.log = log.join('\n'); C.busy = false; C.queue = []; C.plans = [];
    toast('Saved ' + jobs.length + ' curve' + (jobs.length === 1 ? '' : 's') + (created ? ' · ' + created + ' new draft(s)' : ''), '📈');
    renderCurves(); renderExport(); runAudit();
    if (firstNew) { T.expanded.add(firstNew.brand || '(no brand)'); const u = T.S.entries.find(e => e.id === firstNew.id); if (u) { setLeft('tree'); setMid('editor'); selectUid(u._uid, true); } }
    else refreshSelection();
  }

  // ===================================================================== export
  // The parsed changelog as markup: a title, the header note, then one card per
  // save with its heading, counts and changed entries. Every piece of text comes
  // from the file, so it is escaped through E() here - the parser hands back
  // strings, never markup. `filter` narrows the view without touching the file.
  function saveLogView(doc, filter) {
    const view = DC.filterSaveLogDocument(doc, filter);
    const blocks = (list) => (list || []).map(b => {
      if (b.k === 'row') {
        return '<div class="slv-row slv-' + E(b.kind) + '"><span class="slv-mark">' + E(b.mark) + '</span>' +
          '<span class="slv-name">' + E(b.name) + '</span>' +
          (b.detail ? '<span class="slv-detail">' + E(b.detail) + '</span>' : '') + '</div>';
      }
      if (b.k === 'note') return '<p class="slv-note">' + E(b.text) + '</p>';
      if (b.k === 'meta') return '<p class="slv-meta">' + E(b.text) + '</p>';
      return '<p class="slv-text">' + E(b.text) + '</p>';
    }).join('');
    // The text the reader typed, as they typed it: the label quotes it back, so a
    // card says which search put it on screen and not just that one did.
    const typed = String((filter && filter.query) || '').trim();
    // The month picker drops whole saves rather than narrowing a card, so it
    // explains itself once above them. Without this, a reader who comes back to a
    // remembered month sees a shorter document and no reason for it.
    const monthKey = (filter && filter.month) || 'all';
    const months = monthKey === 'all' ? [] : DC.saveLogMonths(doc);
    const monthHit = months.find(m => m.key === monthKey) || null;
    // The other months are named too, so the line says what the picker can show
    // without the reader having to open it - every one of them, not a sample, so
    // a reader never has to wonder which month the note left out. They read
    // oldest first, the way the changelog itself does: the note is a timeline
    // with its missing stretches named, not a copy of the picker's menu, which
    // stays newest first beside it.
    const others = monthHit ? months.filter(m => m.key !== monthHit.key).reverse() : [];
    // Reading oldest first buries the month a reader is likeliest to want next,
    // since it lands at the end of an "and" clause. Marking the last one says
    // which hidden month is the latest without moving it out of the timeline.
    // The marker names its own scope: a bare "most recent" would read as the
    // newest save in the file, which is a different month whenever the reader is
    // already looking at the newest one. "The others" is that scope in the words
    // the sentence is already using - the months not shown, said again as hidden
    // by the clause it sits in - so the marker needs no second "hidden" to say
    // which months it is comparing. A lone hidden month needs no marker at all:
    // it is the only candidate, and the label would just make the line longer.
    // A name also carries how many saves it holds - the answer to the question
    // that follows from naming the months at all - but only where that number
    // tells the months apart. A count every other hidden month shares is the same
    // number written once per month, and a long file of one-save months would
    // read as a wall of numbers that helps nobody choose. So a month keeps its
    // count only when no other hidden month has it; a bare name then means "the
    // same as the rest", not "unknown". The number is still the picker's own, so
    // a month reads the same here as in the menu, and it goes in brackets rather
    // than the picker's middot because this is a comma list, and two separators
    // in a row would fight.
    // The month on screen always states its count, bracketed the same way: it is
    // the number the hidden ones are weighed against, and without it a bracket on
    // the far side of the semicolon is a figure with nothing to compare to. Its
    // count is unconditional because there is only one shown month - it cannot be
    // repeated. Silence on a hidden month keeps its one meaning (shared with
    // another hidden month) rather than becoming "same as the month on screen".
    const counted = n => n + ' ' + (n === 1 ? 'save' : 'saves');
    const named = others.map((m, i) => {
      const last = others.length > 1 && i === others.length - 1;
      const own = others.filter(o => o.count === m.count).length === 1;
      const bits = [];
      if (own) bits.push(counted(m.count));
      if (last) bits.push('the newest of the others');
      return bits.length ? m.label + ' (' + bits.join(', ') + ')' : m.label;
    });
    // "Sep 2026", "Jun 2026 and Jul 2026", "Jun 2026, Jul 2026 and Aug 2026".
    const list = named.length > 1
      ? named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1] : (named[0] || '');
    const also = !others.length ? '' : '; ' + list +
      (others.length === 1 ? ' is hidden' : ' are hidden');
    const scope = monthHit
      ? '<p class="slv-note slv-scope">' + E('Only saves from ' + monthHit.label + ' (' +
        counted(monthHit.count) + ') are shown' + also + '.') + '</p>' : '';
    const secs = view.sections.map(s => {
      const shown = s.blocks.filter(b => b.k === 'row').length;
      // A card whose rows are partly filtered keeps its own summary line, so it
      // says how many of its changes are being shown rather than looking wrong.
      const hint = s.hidden
        ? '<p class="slv-text">' + E('Showing ' + shown + ' of ' + (shown + s.hidden) + ' changes this save lists.') + '</p>' : '';
      // A card can be here because the search text is in the save itself, not in
      // any of its rows. Quoting the text and naming the part it was found in keeps
      // a full card among filtered ones legible - and two saves found for different
      // reasons apart.
      const field = s.matchedSave === 'date' ? 'date' : 'destination';
      const found = s.matchedSave
        ? '<span class="slv-found" title="' + E('The search text matched this save\u2019s ' + field +
          ', not an entry in it.') + '">' +
          E('found by its ' + field + (typed ? ' \u201C' + typed + '\u201D' : '')) + '</span>' : '';
      return '<section class="slv-sec"><div class="slv-head"><span class="slv-h">' + E(s.heading) + '</span>' +
        (s.where ? '<span class="slv-where">' + E(s.where) + '</span>' : '') + found + '</div>' + blocks(s.blocks) + hint + '</section>';
    }).join('');
    const blank = !doc.title && !(doc.blocks || []).length && !view.total;
    const empty = blank
      ? '<p class="slv-text">This file has no saves in it yet.</p>'
      : (!secs ? '<p class="slv-text">' + E('Nothing in ' + DC.SAVE_LOG_FILE + ' matches this filter.') + '</p>' : '');
    return {
      html: '<div class="slv-doc">' + (doc.title ? '<div class="slv-title">' + E(doc.title) + '</div>' : '') +
        blocks(doc.blocks) + scope + secs + empty + '</div>',
      saves: view.saves, total: view.total, rows: view.rows
    };
  }
  // The view the reader left is the view they return to: reopening the changelog
  // resumes its kind, month and search instead of starting from the whole file.
  // This is a preference about reading, so it lives in view storage - never in
  // the changelog, the database or anything the viewer can write.
  const SLV_FILTER_KEY = 'iem_savelog_filter_v1';
  function loadSaveLogFilter(months) {
    let saved = null;
    try { saved = JSON.parse(SafeStorage.getItem(SLV_FILTER_KEY) || 'null'); } catch (_) { saved = null; }
    return DC.sanitizeSaveLogFilter(saved, months);
  }
  function storeSaveLogFilter(filter) {
    try {
      // A view showing everything has nothing to remember; forgetting it is what
      // lets a later read open on the whole file without a hidden filter.
      if (DC.isDefaultSaveLogFilter(filter)) SafeStorage.removeItem(SLV_FILTER_KEY);
      else SafeStorage.setItem(SLV_FILTER_KEY, JSON.stringify({ kind: filter.kind, month: filter.month, query: filter.query }));
    } catch (_) {}
  }
  // Reading the changelog itself. The list above only holds the newest 20 saves,
  // so the status line opens the whole document in a read-only view inside the
  // app, rather than handing the file to the OS or pointing at a copy in
  // Downloads that the page cannot reach.
  async function openSaveLogView() {
    let text = null;
    try { text = await DataStore.readSaveLog(); } catch (e) {
      toast('Could not read the save log: ' + ((e && e.message) || e), '⚠️');
      return;
    }
    const onDisk = typeof text === 'string';
    if (!onDisk) {
      // Browser-only: the export went to the Downloads folder, so the only copy
      // this page can show is the one it built from its own log.
      if (!(T.saveLog || []).length) { toast(DC.SAVE_LOG_FILE + ' is in your Downloads folder — export again to read it here.', '📝'); return; }
      text = DC.mergeSaveLog(null, T.saveLog, { now: (T.ex.lastExport && T.ex.lastExport.ts) || Date.now() }).text;
    }
    const sum = DC.summarizeSaveLog(text);
    const stamp = sum && sum.updatedAt
      ? new Date(sum.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const actions = [];
    // The installed app can still hand the file to whatever owns .md files: the
    // in-app view is the default way in, not the only one.
    if (DataStore.state.mode === 'electron') actions.push({
      label: 'Open in Markdown app',
      title: 'Hand ' + DC.SAVE_LOG_FILE + ' to the app that opens .md files.',
      onClick: async () => {
        try {
          const r = await DataStore.openSaveLog();
          toast(r.how === 'revealed' ? r.name + ' selected in its folder.' : 'Opened ' + r.name + '.', '📝');
        } catch (e) { toast('Could not open the save log: ' + ((e && e.message) || e), '⚠️'); }
      }
    });
    const doc = DC.saveLogDocument(text);
    const months = DC.saveLogMonths(doc);
    const filter = loadSaveLogFilter(months);
    // Write back what was actually applied, so a stale or half-readable entry is
    // corrected once instead of lingering in storage after every open.
    storeSaveLogFilter(filter);
    const kindBtns = new Map();
    let bodyEl = null, countEl = null;
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    const draw = () => {
      const v = saveLogView(doc, filter);
      if (bodyEl) { bodyEl.innerHTML = v.html; bodyEl.scrollTop = 0; }
      kindBtns.forEach((b, k) => b.classList.toggle('is-on', filter.kind === k));
      if (!countEl) return;
      const narrowed = filter.kind !== 'all' || filter.month !== 'all' || !!filter.query.trim();
      // "Showing 1 of 3 saves" is what makes a filtered list honest: the file is
      // not empty, the filter is on.
      countEl.textContent = (narrowed ? 'Showing ' + v.saves + ' of ' + v.total : String(v.saves)) +
        ' save' + (v.total === 1 ? '' : 's') + ' · ' + plural(v.rows, 'change', 'changes');
    };
    // The controls live above the body and are built once per open, so changing
    // one redraws the document without taking focus away from the control.
    const toolbar = (bar) => {
      [['all', 'All', 'Every change, newest save first'],
        ['add', '＋ Additions', 'Only saves that added entries, and only those rows'],
        ['del', '－ Removals', 'Only saves that removed entries, and only those rows']].forEach(([k, label, title]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slv-fbtn';
        b.setAttribute('data-slv-kind', k);
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', () => { filter.kind = k; storeSaveLogFilter(filter); draw(); });
        kindBtns.set(k, b);
        bar.appendChild(b);
      });
      // Only months the file actually holds are offered, so the picker can never
      // land on nothing. One month means nothing to choose between.
      if (months.length > 1) {
        const sel = document.createElement('select');
        sel.className = 'slv-month';
        sel.setAttribute('aria-label', 'Show the saves of one month');
        sel.title = 'Show one month of saves';
        sel.innerHTML = '<option value="all">Every month</option>' + months.map(m =>
          '<option value="' + E(m.key) + '">' + E(m.label + ' · ' + plural(m.count, 'save', 'saves')) + '</option>').join('');
        // Opened on the month that was last being read, when the file still holds it.
        sel.value = filter.month;
        sel.addEventListener('change', () => { filter.month = sel.value; storeSaveLogFilter(filter); draw(); });
        bar.appendChild(sel);
      }
      // Search narrows to rows whose name or change detail contains the text,
      // and also to saves whose heading or destination does - so "folder" or a
      // date finds a save by where and when it happened. Debounced so a long
      // changelog is not re-rendered on every keystroke, and only the body is
      // redrawn, so the caret stays in this field.
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'slv-search';
      search.setAttribute('data-slv-search', '');
      search.placeholder = 'Name, price or save…';
      search.setAttribute('aria-label', 'Show only saves and changes whose entry name, change detail, save date or destination contains this text');
      search.title = 'Narrow to entry names, change details, save dates and destinations that contain this text';
      search.value = filter.query;
      let debounce = 0;
      search.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { filter.query = search.value; storeSaveLogFilter(filter); draw(); }, 120);
      });
      bar.appendChild(search);
      countEl = document.createElement('span');
      countEl.className = 'slv-count';
      countEl.setAttribute('aria-live', 'polite');
      bar.appendChild(countEl);
    };
    UIKit.read({
      title: DC.SAVE_LOG_FILE,
      subtitle: onDisk
        ? (sum ? sum.total + ' save' + (sum.total === 1 ? '' : 's') + (stamp ? ' · last updated ' + stamp : '') + ' · read-only' : 'Empty file · read-only')
        : 'The exported copy · read-only — the file itself is in your Downloads folder',
      toolbar: toolbar,
      render: (body) => { bodyEl = body; draw(); },
      actions: actions
    });
  }
  function renderExport() {
    const el = $('dt-ex-body'); if (!el) return;
    if (!T.ready) { el.innerHTML = ''; return; }
    const st = DataStore.state, X = T.ex;
    const pend = st.pending.size;
    const wcNote = st.mode !== 'electron' ? '' : st.packaged
      ? (st.workingCopy ? '🛡️ Built-in files are protected.' : '🛡️ Your copy is made on first save.')
      : '⚠️ Dev mode: saves change the shipped files.';
    const storage = '<div class="dt-box" style="padding:8px"><div class="dt-kv"><span>Source</span><b>' + E(T.source) + '</b></div><div class="dt-kv"><span>Saves to</span><b>' + E(st.mode === 'memory' ? 'Downloads' : st.label) + '</b></div><div class="dt-kv"><span>Entries</span><b>' + T.S.entries.length + '</b></div>' +
      (st.mode === 'electron' && st.rootPath ? '<div class="dt-help dt-mono" style="word-break:break-all;margin-top:4px;font-size:var(--t-micro)">' + E(st.rootPath) + '</div>' : '') +
      (wcNote ? '<div class="dt-help" style="margin-top:5px">' + wcNote + '</div>' : '') + '</div>';
    const folderBtns = st.mode === 'electron' ? '<button class="dt-btn" data-dt="open-folder">📂 Open ' + (st.packaged ? 'my copy' : 'project') + ' folder</button>' :
      (st.fsApi ? '<button class="dt-btn" data-dt="pick-folder">📂 ' + (st.mode === 'folder' ? 'Change folder…' : 'Connect folder…') + '</button>' + (st.savedHandle && st.mode !== 'folder' ? '<button class="dt-btn" data-dt="reconnect-folder">↻ Reconnect ' + E(st.savedHandle.name) + '</button>' : '') : '<p class="dt-help">Folder saving needs Chrome/Edge or the desktop app.</p>');
    const chunkRows = X.chunks.map((c, i) => '<div class="dt-file"><span class="dt-t dt-mono" style="direction:ltr" title="' + E(c.name) + '">' + E(c.name) + '</span><span class="dt-help" style="white-space:nowrap">' + c.count + '</span><button class="dt-btn is-sm" data-dt="chunk-copy" data-a="' + i + '">Copy</button><button class="dt-btn is-sm" data-dt="chunk-dl" data-a="' + i + '">⬇</button></div>').join('');
    const log = T.saveLog || [];
    const chLog = T.ex.changelog;
    // The file itself is the only way to read more than the newest 20 saves, so the
    // status is the way in to it rather than a caption: clicking it opens the
    // changelog in a read-only view instead of leaving the app.
    const changelogHtml = chLog && chLog.total
      ? '<button class="dt-hist" data-dt="log-open-file" title="' + E('Reads ' + DC.SAVE_LOG_FILE + ' and shows it here, without leaving the app or waiting for an export, so the whole changelog is readable — not just the saves listed above. Browser-only mode shows the copy the export downloaded.') + '">' +
        '<span class="dt-t"><b>' + E(DC.SAVE_LOG_FILE) + '</b><span class="dt-s">' + E(chLog.total + ' save' + (chLog.total === 1 ? '' : 's') +
          (chLog.updatedAt ? ' · last updated ' + new Date(chLog.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')) + '</span></span>' +
        '<span>👁</span></button>'
      : '';
    const lastEx = T.ex.lastExport;
    const lastExHtml = lastEx
      ? '<p class="dt-help" style="margin:0">' + E('Last export: ' + exportSummary(lastEx.added, lastEx.total) + ' · ' +
          new Date(lastEx.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</p>'
      : '';
    const logHtml = log.length
      ? '<div class="dt-box dt-scroll" style="max-height:190px">' + log.map((s, i) => {
          const open = T.openSave === i;
          const bits = [new Date(s.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), s.entries.toLocaleString() + ' entries'];
          if (s.bytes) bits.push(fmtBytes(s.bytes));
          if (s.mode === 'memory') bits.push('downloaded');
          const rows = open && (s.changes || []).length
            ? s.changes.map(c => '<div class="dt-help" style="padding:2px 8px">' + (c.k === 'add' ? '＋ ' : c.k === 'mod' ? '～ ' : '－ ') + E(c.label) +
                (c.detail ? '  ·  ' + E(String(c.detail).replace(/ -> /g, ' → ')) : '') + '</div>').join('') +
              (s.total > s.changes.length ? '<div class="dt-help" style="padding:2px 8px">…and ' + (s.total - s.changes.length) + ' more</div>' : '')
            : '';
          return '<button class="dt-hist" data-dt="log-open" data-a="' + i + '"><span class="dt-t"><b>' + E(summarizeSave(s)) + '</b><span class="dt-s">' + E(bits.join(' · ')) + '</span></span><span>' + (open ? '▾' : '▸') + '</span></button>' + rows;
        }).join('') + '</div>' +
        '<div class="dt-g2"><button class="dt-btn" data-dt="log-export" title="' + E('Adds the saves listed here to ' + DC.SAVE_LOG_FILE + ' beside database.json, keeping every save the file already lists so the changelog grows past this list. What this export adds is marked in the file. Browser-only mode downloads it instead.') + '">📝 Export .md</button>' +
        '<button class="dt-btn" data-dt="log-clear" title="Forget this list. The database files, backups and undo history are untouched.">🗑 Clear log</button></div>' + lastExHtml
      : '<p class="dt-help">Every save records what it changed here, so the result can be reviewed after the fact.</p>';
    el.innerHTML =
      '<h4 class="dt-h">Save</h4>' + storage +
      '<div class="dt-g2"><button class="dt-btn is-primary" data-dt="save" title="Shows every entry the save will add, edit or delete, then writes database.json and database.json.gz together. The previous files go to backup/.">💾 Save</button><button class="dt-btn" data-dt="compress" title="Write only database.json.gz from the current database">📦 .gz only</button></div>' +
      '<div class="dt-g2"><button class="dt-btn" data-dt="dl-json" title="Download a copy of database.json">⬇ .json</button><button class="dt-btn" data-dt="dl-gz" title="Download a compressed copy">⬇ .gz</button></div>' +
      folderBtns +
      (st.mode === 'memory' ? '<button class="dt-btn" data-dt="zip">🗜️ Download update (.zip' + (pend ? ', ' + pend + ' curve' + (pend === 1 ? '' : 's') : '') + ')</button>' : '') +
      '<div class="dt-sep"></div><h4 class="dt-h">Recent saves</h4>' + logHtml + changelogHtml +
      '<div class="dt-sep"></div><h4 class="dt-h">Split for AI audit</h4>' +
      '<div class="dt-row"><label class="dt-lbl dt-grow" style="margin:0">Tokens per chunk</label><input class="dt-in input-bg-fix is-num" style="width:90px" data-f="ex-tokens" value="' + X.tokens + '" inputmode="numeric"><button class="dt-btn" data-dt="split">✂ Split</button></div>' +
      (chunkRows ? '<div class="dt-box" style="max-height:150px;overflow-y:auto">' + chunkRows + '</div><button class="dt-btn" data-dt="chunk-zip">⬇ All chunks (.zip)</button>' : '') +
      '<div class="dt-sep"></div>' +
      '<button class="dt-btn" data-dt="reload-db" title="Discard unsaved edits and re-read the database from disk">⟳ Reload from disk</button>';
  }
  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); toast(what + ' copied to the clipboard.', '📋'); return; } catch (_) { /* fallback */ }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(what + ' copied to the clipboard.', '📋'); } catch (e) { toast('Copy failed — select and copy manually.', '⚠️'); }
    ta.remove();
  }
  function doSplit() {
    const n = Math.max(2000, Math.min(500000, DC.coerceInt(T.ex.tokens, 50000)));
    T.ex.tokens = n; T.ex.chunks = DC.splitIntoChunks(T.S.entries, n, 'database'); renderExport();
    toast('Split into ' + T.ex.chunks.length + ' chunk' + (T.ex.chunks.length === 1 ? '' : 's') + '.', '✂');
  }

  // ====================================================================== wiring
  function setLeft(id) {
    T.left = id;
    ['tree', 'history'].forEach(k => {
      const b = $('dt-left-tab-' + k), p = $('dt-lp-' + k);
      if (b) { b.classList.toggle('active', k === id); b.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
      if (p) p.classList.toggle('is-on', k === id);
    });
    if (id === 'history') renderHistory(); if (id === 'tree' && T.ready) renderTree();
  }
  function setRight(id) {
    T.right = id;
    ['audit', 'ai', 'export'].forEach(k => {
      const b = $('dt-right-tab-' + k), p = $('dt-rp-' + k);
      if (b) { b.classList.toggle('active', k === id); b.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
      if (p) p.classList.toggle('is-on', k === id);
    });
    if (id === 'audit') renderAudit(); if (id === 'ai') renderAI(); if (id === 'export') renderExport();
  }
  function renderAll() { renderTree(); renderEditor(); renderHistory(); renderAudit(); renderAI(); renderCurves(); renderExport(); }

  async function onClick(e) {
    const sug = $('dt-file-sug'); if (sug && !e.target.closest('.dt-sug')) sug.style.display = 'none';
    const t = e.target.closest('[data-dt]'); if (!t || t.disabled) return;
    const a = t.getAttribute('data-a'), b = t.getAttribute('data-b');
    switch (t.getAttribute('data-dt')) {
      case 'left': setLeft(a); break;
      case 'right': setRight(a); break;
      case 'filter': T.filter = a; renderTree(); break;
      case 'collapse': T.expanded.clear(); T.search = ''; { const s = $('dt-search'); if (s) s.value = ''; } T.filter = 'all'; renderTree(); break;
      case 'brand': if (T.expanded.has(a)) T.expanded.delete(a); else T.expanded.add(a); renderTree(); break;
      case 'sel': T._fromTap = true; await selectUid(Number(a)); break;
      case 'new': newEntry(); break;
      case 'dup': duplicateEntry(); break;
      case 'del': deleteEntry(); break;
      case 'apply': commitDraft(false); break;
      case 'revert': revertDraft(); break;
      case 'undo': if (T.draftDirty) { T.draftDirty = false; } T.S.undo(); break;
      case 'redo': T.S.redo(); break;
      case 'hist-undo': T.S.undoTo(T.S.undoStack.length - 1 - Number(a)); break;
      case 'hist-redo': { const n = T.S.redoStack.length - Number(a); for (let i = 0; i < n; i++) T.S.redo(); break; }
      case 'save': saveAll(); break;
      case 'compress': compressOnly(); break;
      case 'step': stepValue(a, Number(b)); break;
      case 'drv': driverStep(a, Number(b)); break;
      case 'tag': toggleTag(a); break;
      case 'unlink': { const d = T.draft; if (d) { const f = d.files.slice(); f.splice(Number(a), 1); commitFiles(f, 'Unlink measurement file'); } break; }
      case 'mid': setMid(a); break;
      case 'prev-file': T.curveFileIdx = Number(a); refreshDerived(); loadPreview(); break;
      case 'file-top': moveFile(Number(a), 0); break;
      case 'file-dl': downloadCurve(Number(a)); break;
      case 'pick-file': { const ok = linkFile(a); const i = $('dt-file-in'); if (i && ok) i.value = ''; if (sug) sug.style.display = 'none'; break; }
      case 'go-eq': goEq(); break;
      case 'go-review': goReview(); break;
      case 'copy-json': { const x = T.draft; if (x) copyText(JSON.stringify(x, null, 2), 'Entry JSON'); break; }
      case 'restore': restoreAutosave(); break;
      case 'dismiss-banner': T.ex.banner = null; T.gzStale = false; updateToolbar(); renderExport(); break;
      case 'log-open': T.openSave = T.openSave === Number(a) ? -1 : Number(a); renderExport(); break;
      case 'log-open-file': await openSaveLogView(); break;
      case 'log-export': {
        try {
          // Merge into what is already there: the file is the long-term changelog,
          // the list in this panel is only the newest 20 saves of it.
          const merged = DC.mergeSaveLog(await DataStore.readSaveLog(), T.saveLog);
          const r = await DataStore.writeSaveLog(merged.text);
          const n = merged.added, total = merged.total;
          // Kept on screen after the toast fades: how much of the file was new.
          T.ex.lastExport = { ts: Date.now(), added: n, total: total };
          T.ex.changelog = { total: total, updatedAt: Date.now() };
          renderExport();
          toast(r.mode === 'memory' ? r.name + ' downloaded — ' + exportSummary(n, total) + '.'
            : n ? r.name + ' updated — ' + exportSummary(n, total) + '.'
              : r.name + ' already lists all ' + total + ' save' + (total === 1 ? '' : 's') + '.', '📝');
        } catch (e) { toast('Could not export the save log: ' + ((e && e.message) || e), '⚠️'); }
        break;
      }
      case 'log-clear': {
        const ok = await UIKit.confirm({ title: 'Clear the save log?', message: 'Only this list is forgotten. The database files, the backups and the undo history are untouched.', confirmLabel: 'Clear log', icon: '🗑️', danger: true });
        if (!ok) break;
        T.saveLog = []; T.openSave = -1; DataStore.kvDelete('saveLog'); renderExport(); toast('Save log cleared.', '🗑️'); break;
      }
      case 'dismiss-notes': T._notesSeen = true; console.info('[DataTab] load notes:', T.notes); updateToolbar(); break;
      case 'reload-app': reloadApp(); break;
      case 'reload-db': if (T.S && T.S.dirty) { const ok = await UIKit.confirm({ title: 'Discard unsaved edits?', message: 'Unsaved edits will be lost.', confirmLabel: 'Reload from disk', danger: true }); if (!ok) break; } T.ready = false; T.selUid = null; T.draft = null; T.draftDirty = false; DataStore.kvDelete('working'); T.ex.banner = null; T.load(); break;
      case 'audit-run': { try { T.diskFiles = await DataStore.listDataFiles(); } catch (_) {} runAudit(); break; }
      case 'audit-fixall': fixAll(); break;
      case 'audit-ignored': T.showIgnored = !T.showIgnored; T.auditSel = new Set(); T.lastSel = -1; renderAudit(); break;
      case 'sev': T.auditSev = a; T.auditSel = new Set(); T.lastSel = -1; renderAudit(); break;
      case 'issue-open': T.openIssue = T.openIssue === Number(a) ? -1 : Number(a); renderAudit(); break;
      case 'issue-go': { const i = findIssue(a); if (i && i.uid !== null) { setLeft('tree'); setMid(/File|Path|Measurement/.test(i.category) ? 'curves' : 'editor'); T._fromTap = true; await selectUid(i.uid, false); } break; }
      case 'issue-fix': { const i = findIssue(a); if (i) fixOne(i); break; }
      case 'issue-merge': { const i = findIssue(a); if (i) mergeDup(i); break; }
      case 'issue-ignore': { const i = findIssue(a); if (i) toggleIgnore(i); break; }
      case 'issue-delfile': { const i = findIssue(a); if (i) deleteFiles([i]); break; }
      case 'issue-repair': { const i = findIssue(a); if (i) repairName(i); break; }
      case 'issue-sel': {
        const vis = visibleIssues(), idx = Number(a), pos = vis.findIndex(x => x.i === idx), on = t.checked;
        if (e.shiftKey && T.lastSel >= 0 && pos >= 0) { const lo = Math.min(pos, T.lastSel), hi = Math.max(pos, T.lastSel); for (let k = lo; k <= hi; k++) { if (on) T.auditSel.add(vis[k].i); else T.auditSel.delete(vis[k].i); } }
        else if (on) T.auditSel.add(idx); else T.auditSel.delete(idx);
        T.lastSel = pos; renderAudit(); break;
      }
      case 'audit-selall': { const vis = visibleIssues(); if (vis.length && vis.every(x => T.auditSel.has(x.i))) vis.forEach(x => T.auditSel.delete(x.i)); else vis.forEach(x => T.auditSel.add(x.i)); renderAudit(); break; }
      case 'audit-ign-sel': bulkIgnore(); break;
      case 'audit-fix-sel': bulkFix(); break;
      case 'audit-del-sel': deleteFiles(selectedIssues()); break;
      case 'ai-analyze': aiAnalyze(); break;
      case 'ai-clear': T.ai = AI_EMPTY(); { const x = $('dt-ai-in'); if (x) x.value = ''; } renderAI(); break;
      case 'ai-paste': aiPaste(); break;
      case 'ai-open': if (T.ai.collapsed.has(Number(a))) T.ai.collapsed.delete(Number(a)); else T.ai.collapsed.add(Number(a)); renderAI(); break;
      case 'ai-all': T.ai.include = new Set(a === '1' ? T.ai.proposals.map((p, i) => (p.action === 'new' || p.action === 'changed' || p.action === 'delete' ? i : -1)).filter(i => i >= 0) : []); renderAI(); break;
      case 'ai-apply': aiApply(); break;
      case 'copy-prompt': copyText(DataPrompts[a], a === 'audit' ? 'Audit prompt' : 'Add-entry prompt'); break;
      case 'cv-pick': { const f = $('dt-cv-file'); if (f) f.click(); break; }
      case 'cv-clear': T.cv.queue = []; T.cv.plans = []; T.cv.log = ''; renderCurves(); break;
      case 'cv-over': T.cv.overwrite = !T.cv.overwrite; renderCurves(); break;
      case 'cv-drop-plan': { const p = T.cv.plans[Number(a)]; if (p) { const names = new Set(p.plan.sources.map(s => s.name)); T.cv.queue = T.cv.queue.filter(q => !names.has(q.name)); T.cv.plans.splice(Number(a), 1); rebuildPlans(); renderCurves(); } break; }
      case 'cv-convert': convertCurves(); break;
      case 'split': doSplit(); break;
      case 'chunk-copy': { const c = T.ex.chunks[Number(a)]; if (c) copyText(c.text, c.name); break; }
      case 'chunk-dl': { const c = T.ex.chunks[Number(a)]; if (c) DataStore.downloadBlob(c.name, c.text, 'application/json'); break; }
      case 'chunk-zip': DataStore.downloadBlob('database_chunks.zip', DataStore.makeZip(T.ex.chunks.map(c => ({ name: c.name, data: new TextEncoder().encode(c.text) }))), 'application/zip'); break;
      case 'open-folder': DataStore.openFolder(); break;
      case 'dl-json': DataStore.downloadBlob('database.json', T.S.serialize(), 'application/json'); break;
      case 'dl-gz': DataStore.downloadBlob('database.json.gz', await DataStore.gzipBytes(T.S.serialize()), 'application/gzip'); break;
      case 'pick-folder': try { await DataStore.pickFolder(); toast('Connected.', '📂'); T.ready = false; T.selUid = null; T.draft = null; T.load(); } catch (err) { if (err && err.name !== 'AbortError') toast(String(err.message || err), '⚠️'); } break;
      case 'reconnect-folder': if (await DataStore.reconnectFolder()) { T.ready = false; T.load(); } else toast('Permission was not granted.', '⚠️'); break;
      case 'zip': { if (T.S.dirty) { const n = await DataStore.exportZip([{ name: 'database.json', data: T.S.serialize() }, { name: 'database.json.gz', data: await DataStore.gzipBytes(T.S.serialize()) }]); T.S.markSaved(); T.savedLen = T.S.undoStack.length; recomputeChanged(); toast('Downloaded ' + n + ' files.', '🗜️'); renderAll(); } break; }
    }
  }
  function onInput(e) {
    const el = e.target, f = el.getAttribute && el.getAttribute('data-f'); if (!f) return;
    if (f.startsWith('e:')) onField(f, el);
    else if (f === 'search') { T.search = el.value; scheduleTree(); }
    else if (f === 'file-in') fileSuggest(el.value);
    else if (f === 'cv-newsource') { T.cv.newSource = lockInput(el); updateCvChrome(); }
    else if (f.startsWith('cv-name:')) { const p = T.cv.plans[Number(f.slice(8))]; if (p) p.name = lockInput(el); }
    else if (f === 'ex-tokens') T.ex.tokens = el.value;
  }
  function onChange(e) {
    const el = e.target, f = el.getAttribute && el.getAttribute('data-f'); if (!f) { 
      if (el.getAttribute && el.getAttribute('data-dt') === 'ai-inc') { const i = Number(el.getAttribute('data-a')); if (el.checked) T.ai.include.add(i); else T.ai.include.delete(i); renderAI(); }
      else if (el.getAttribute && el.getAttribute('data-dt') === 'ai-field') {
        const i = Number(el.getAttribute('data-a')), p = T.ai.proposals[i], fld = el.getAttribute('data-b');
        const s = T.ai.fieldSel.get(i) || new Set(aiFieldsOf(p)); if (el.checked) s.add(fld); else s.delete(fld);
        T.ai.fieldSel.set(i, s); if (s.size) T.ai.include.add(i); else T.ai.include.delete(i); renderAI();
      }
      return; }
    if (f.startsWith('e:')) onFieldCommit(f, el);
    else if (f === 'audit-cat') { T.auditCat = el.value; T.auditSel = new Set(); T.lastSel = -1; renderAudit(); }
    else if (f === 'cv-files') { addCurveFiles(el.files); el.value = ''; }
    else if (f === 'cv-source') { T.cv.source = el.value; renderCurves(); }
    else if (f.startsWith('cv-name:')) { renderCurves(); }
    else if (f.startsWith('cv-link:')) { const p = T.cv.plans[Number(f.slice(8))]; if (p) p.link = el.value; }
  }
  function onKey(e) {
    const tg = e.target, inText = tg.matches && tg.matches('input, textarea, select');
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveAll(); return; }
      if (!inText || (tg.getAttribute && tg.getAttribute('data-f') === 'e:id')) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); T.S.undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); T.S.redo(); return; }
      }
    }
    if (e.key === 'Enter' && tg.matches && tg.matches('#dt-editor input.dt-in:not([readonly])')) {
      if (tg.id === 'dt-file-in') { e.preventDefault(); if (linkFile(tg.value)) { tg.value = ''; fileSuggest(''); } return; }
      e.preventDefault(); onFieldCommit(tg.getAttribute('data-f'), tg); commitDraft(false);
    }
    if (e.key === 'Escape') { const s = $('dt-file-sug'); if (s) s.style.display = 'none'; }
  }
  function onDrop(e) {
    const row = e.target.closest && e.target.closest('.dt-file[data-idx]');
    if (row && dragFrom >= 0) {
      e.preventDefault(); e.stopPropagation();
      const r = row.getBoundingClientRect(), idx = Number(row.getAttribute('data-idx'));
      const insertAt = idx + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      const from = dragFrom; onDragEnd(); moveFile(from, insertAt);
      return;
    }
    const z = e.target.closest && e.target.closest('.dt-drop'); if (!z) return;
    e.preventDefault(); e.stopPropagation(); z.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addCurveFiles(e.dataTransfer.files);
  }

  // test hooks / public surface
  T._internals = { selectUid: selectUid, runAudit: runAudit, aiAnalyze: aiAnalyze, renderAll: renderAll, setLeft: setLeft, setMid: setMid, setRight: setRight };
  return T;
})();
