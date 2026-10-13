/* ===== data-import.js =====
 * Database tab: parsing and staging of AI replies (pure, Node-testable).
 * Ported from the Database Tool's ai_import.py. Accepts a JSON array, loose
 * objects, or Notepad++-style SEARCH:/REPLACE: blocks, classifies each against
 * the live database (new / changed / delete / invalid) and stages validated,
 * normalised candidates for one undoable apply.
 */
const DataImport = (function () {
  'use strict';
  const DC = DataCore;
  const FENCE_RE = /^\s*(```|~~~)[a-zA-Z0-9_-]*\s*$/gm;
  const COMMENT_RE = /^\s*\/\/.*$/gm;
  const TRAILING_COMMA_RE = /,\s*([}\]])/g;
  const SR_RE = /SEARCH\s*:\s*([\s\S]*?)REPLACE\s*:\s*([\s\S]*?)(?=\n\s*SEARCH\s*:|$(?![\r\n]))/gi;
  const EMPTY_REPLACE_RE = /^(?:null|\{\s*\})/i;

  // Chat apps and word processors love to "improve" quotes and spaces. JSON needs the plain ones.
  function straighten(text) {
    return text.replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'").replace(/[\u00A0\u2007\u202F]/g, ' ');
  }
  function clean(text) { return straighten(text.replace(/\uFEFF/g, '')).replace(FENCE_RE, '').replace(COMMENT_RE, '').trim(); }
  function loadsLenient(raw) {
    raw = raw.trim();
    if (!raw) return [null, 'empty'];
    try { return [JSON.parse(raw), null]; } catch (e) { /* retry */ }
    try { return [JSON.parse(raw.replace(TRAILING_COMMA_RE, '$1')), null]; } catch (e) { /* retry */ }
    if (raw.indexOf('"') < 0 && raw.indexOf("'") >= 0) {   // Python-style {'brand': 'X'}
      try { return [JSON.parse(raw.replace(/'/g, '"').replace(TRAILING_COMMA_RE, '$1')), null]; } catch (e2) { /* fall through */ }
    }
    return [null, 'not valid JSON'];
  }
  const entryLike = o => o && typeof o === 'object' && !Array.isArray(o) && ('brand' in o || 'model' in o || 'id' in o);
  // AI models like to wrap the list: {"entries": [...]}, {"database": [...]}, {"results": {...}}.
  function unwrap(v) {
    if (Array.isArray(v)) return v;
    if (entryLike(v)) return [v];
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (Array.isArray(x) && x.some(entryLike)) return x;
        if (entryLike(x)) return [x];
      }
    }
    return null;
  }
  function balancedObjects(text) {
    const found = [], errors = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      if (text[i] !== '{') { i++; continue; }
      let depth = 0, inStr = false, esc = false, j = i, end = -1;
      while (j < n) {
        const ch = text[j];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
        else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
        j++;
      }
      if (end < 0) { errors.push('Input appears TRUNCATED at character ' + i + ' -- the reply never closes this entry, so it and everything after it were NOT imported. Re-copy the complete reply.'); break; }
      const r = loadsLenient(text.slice(i, end));
      if (r[0] === null) errors.push('Entry at character ' + i + ' could not be parsed and was skipped (' + (r[1] || 'not valid JSON') + ').');
      else found.push([r[0], i, end]);
      i = end;
    }
    return { found: found, errors: errors };
  }
  const objsOf = t => balancedObjects(t).found.map(f => f[0]);

  function parseSearchReplace(text) {
    const replacements = [], standalone = [], errors = [];
    const cl = clean(text);
    const spans = [];
    let m;
    SR_RE.lastIndex = 0;
    while ((m = SR_RE.exec(cl)) !== null) {
      const ss = m.index + m[0].indexOf(m[1], m[0].toLowerCase().indexOf('search'));
      const rsStart = m.index + m[0].length - m[2].length;
      spans.push([ss, ss + m[1].length, rsStart, rsStart + m[2].length]);
      if (m[0].length === 0) SR_RE.lastIndex++;
    }
    if (!spans.length) return { replacements, standalone, errors };
    const covered = [];
    spans.forEach(sp => {
      const sc = objsOf(cl.slice(sp[0], sp[1]));
      const rTxt = cl.slice(sp[2], sp[3]);
      const stripped = rTxt.replace(/^\s+/, '');
      const del = EMPTY_REPLACE_RE.exec(stripped);
      let replaceObj, extra;
      if (del) { replaceObj = null; extra = objsOf(stripped.slice(del[0].length)); }
      else { const ro = objsOf(rTxt); replaceObj = ro.length ? ro[0] : null; extra = ro.slice(1); }
      if (!sc.length) { errors.push('A SEARCH block contained no parseable JSON entry; it was skipped.'); extra.forEach(x => standalone.push(x)); return; }
      replacements.push([sc[0], replaceObj]);
      sc.slice(1).forEach(x => standalone.push(x));
      extra.forEach(x => standalone.push(x));
      covered.push([sp[0], sp[3]]);
    });
    balancedObjects(cl).found.forEach(f => { if (!covered.some(c => f[1] >= c[0] && f[1] < c[1])) standalone.push(f[0]); });
    return { replacements, standalone, errors };
  }
  /** parseAiOutput(text) -> { objects, replacements:[[search, replace|null]], errors } */
  function parseAiOutput(text) {
    const cleaned = clean(text);
    const errors = [];
    const r = loadsLenient(cleaned);
    if (r[0] !== null) {
      const list = unwrap(r[0]);
      if (list === null) {
        errors.push('That is valid JSON, but it does not look like an entry: there is no brand / model / id. Paste the entry (or list of entries) the AI produced.');
        return { objects: [], replacements: [], errors: errors };
      }
      const objects = [];
      list.forEach((o, i) => { if (o && typeof o === 'object' && !Array.isArray(o)) objects.push(o); else errors.push('Ignoring non-object array element #' + i); });
      return { objects: objects, replacements: [], errors: errors };
    }
    const sr = parseSearchReplace(text);
    sr.errors.forEach(e => errors.push(e));
    if (sr.replacements.length) return { objects: sr.standalone.filter(o => o && typeof o === 'object'), replacements: sr.replacements, errors: errors };
    const be = balancedObjects(cleaned);
    be.errors.forEach(e => errors.push(e));
    const objects = be.found.map(f => f[0]).filter(o => o && typeof o === 'object' && !Array.isArray(o));
    if (!objects.length && !errors.length) {
      errors.push(r[1] ? 'No JSON entries found -- the text is not valid JSON (' + r[1] + '). If the AI reply was cut off, re-copy the complete reply.' : 'No JSON entries found in the provided text.');
    }
    return { objects: objects, replacements: [], errors: errors };
  }

  const identKey = e => [DC.SCHEMA_FIELDS.length && String(e.brand || '').trim().toLowerCase(), String(e.model || '').trim().toLowerCase(), String(e.variant || '').trim().toLowerCase()].join('\u0000');

  /** classifyAgainst(entries, parsed) -> proposals (pos = index into entries) */
  function classifyAgainst(entries, parsed) {
    const byId = new Map(), byIdent = new Map();
    entries.forEach((e, pos) => { if (e.id && !byId.has(e.id)) byId.set(e.id, pos); const k = identKey(e); if (!byIdent.has(k)) byIdent.set(k, pos); });
    const proposals = [], claimed = new Set();
    const targetOf = obj => { if (obj.id && byId.has(obj.id)) return byId.get(obj.id); const k = identKey(obj); return byIdent.has(k) ? byIdent.get(k) : -1; };
    const fieldChanges = (o, n) => {
      const ch = [];
      DC.SCHEMA_FIELDS.forEach(f => {
        const ov = o[f], nv = n[f];
        if (Array.isArray(ov) || Array.isArray(nv)) { if (JSON.stringify(ov || []) !== JSON.stringify(nv || [])) ch.push([f, ov, nv]); }
        else if (String(ov) !== String(nv)) ch.push([f, ov, nv]);
      });
      return ch;
    };
    (parsed.replacements || []).forEach(pair => {
      const s = pair[0], r = pair[1];
      if (!s || typeof s !== 'object') return;
      let pos = targetOf(s);
      if (pos < 0 && r && typeof r === 'object') pos = targetOf({ brand: r.brand, model: r.model, variant: r.variant });
      if (pos < 0) {
        if (r && typeof r === 'object' && Object.keys(r).length) proposals.push({ action: 'new', entry: r });
        else proposals.push({ action: 'invalid', entry: s, error: 'SEARCH block matches no database entry' });
        return;
      }
      if (claimed.has(pos)) { proposals.push({ action: 'invalid', entry: s, error: 'targeted by more than one block in this import' }); return; }
      claimed.add(pos);
      if (!r || typeof r !== 'object' || !Object.keys(r).length) { proposals.push({ action: 'delete', pos: pos, old: entries[pos] }); return; }
      const ch = fieldChanges(entries[pos], r);
      if (ch.length) proposals.push({ action: 'changed', pos: pos, old: entries[pos], 'new': r, changes: ch });
      else proposals.push({ action: 'same', pos: pos, old: entries[pos] });
    });
    (parsed.objects || []).forEach(obj => {
      if (!obj || typeof obj !== 'object' || !Object.keys(obj).length) return;
      const pos = targetOf(obj);
      if (pos >= 0) {
        if (claimed.has(pos)) { proposals.push({ action: 'invalid', entry: obj, error: 'targeted more than once in this import' }); return; }
        claimed.add(pos);
        const ch = fieldChanges(entries[pos], obj);
        if (ch.length) proposals.push({ action: 'changed', pos: pos, old: entries[pos], 'new': obj, changes: ch });
        else proposals.push({ action: 'same', pos: pos, old: entries[pos] });
      } else proposals.push({ action: 'new', entry: obj });
    });
    return proposals;
  }

  function normalizePriceValue(raw) {
    let p;
    if (typeof raw === 'boolean') return null;
    if (typeof raw === 'number') { if (!isFinite(raw)) return null; p = raw; }
    else if (typeof raw === 'string') { const s = raw.trim(); if (!s || s.indexOf('_') >= 0 || s.indexOf('.') >= 0 || !/^[+-]?\d+$/.test(s)) return null; p = parseInt(s, 10); }
    else { p = DC.coerceInt(raw, null); if (p === null) return null; }
    const rounded = DC.roundPriceTo5(p);
    if (rounded === p) return null;
    if (rounded <= 0 || rounded > DC.PRICE_MAX || p <= 0 || p > DC.PRICE_MAX) return null;
    return rounded;
  }
  function normalizeImportEntry(src, only) {
    const cand = Object.assign({}, src), notes = [];
    if (!only || only.has('price_usd')) {
      const old = cand.price_usd === undefined ? 0 : cand.price_usd, np = normalizePriceValue(old);
      if (np !== null) { notes.push('price $' + old + '->$' + np); cand.price_usd = np; }
    }
    if (!only || only.has('tags')) {
      const r = DC.fixTierTags(cand.tags || [], cand.price_usd === undefined ? 0 : cand.price_usd);
      if (Array.isArray(cand.tags || []) && r.changed) { cand.tags = r.tags; notes.push(r.note); }
    }
    return { candidate: cand, notes: notes };
  }
  /** Rewrites price/tier on every incoming object so the review rows show what Apply will do. */
  function normalizeParsed(parsed) {
    const notesFor = new Map();
    let n = 0;
    const objs = (parsed.objects || []).concat((parsed.replacements || []).map(r => r[1]).filter(o => o && typeof o === 'object'));
    objs.forEach(o => {
      const r = normalizeImportEntry(o, null);
      if (r.notes.length) { o.price_usd = r.candidate.price_usd; o.tags = r.candidate.tags; notesFor.set(o, r.notes); n++; }
    });
    return { fixed: n, notes: notesFor };
  }
  function normalizeBrandSpellings(entries, parsed) {
    const canon = DC.brandCanonicalSpellings(entries);
    let n = 0;
    const objs = (parsed.objects || []).concat((parsed.replacements || []).map(r => r[1]).filter(o => o && typeof o === 'object'));
    objs.forEach(o => {
      const raw = String(o.brand || '').trim();
      if (!raw) return;
      const want = canon.get(DC.brandFold(raw));
      if (want && want !== raw) { o.brand = want; n++; }
    });
    return n;
  }
  function splitFilesByExistence(files, onDisk, diskIndex) {
    const kept = [], dropped = [];
    (files || []).forEach(rel => {
      if (typeof rel !== 'string' || !rel.trim()) { dropped.push(rel); return; }
      const norm = DC.normRelPath(rel);
      if (!norm) { dropped.push(rel); return; }
      if (onDisk.has(norm)) kept.push(norm);
      else if (diskIndex.has(norm.toLowerCase())) kept.push(diskIndex.get(norm.toLowerCase()));
      else dropped.push(rel);
    });
    const seen = new Set(), dedup = [];
    kept.forEach(k => { const l = k.toLowerCase(); if (!seen.has(l)) { seen.add(l); dedup.push(k); } });
    return { kept: dedup, dropped: dropped };
  }
  function buildFieldMerged(p, selected) {
    if (p.action === 'changed') {
      const valid = new Set(p.changes.map(c => c[0]));
      const keep = Array.from(selected || []).filter(f => valid.has(f));
      if (!keep.length) return null;
      const base = JSON.parse(JSON.stringify(p.old));
      keep.forEach(f => { base[f] = JSON.parse(JSON.stringify(p['new'][f] === undefined ? null : p['new'][f])); });
      return base;
    }
    if (p.action === 'new') {
      const src = p.entry || {};
      const keep = Array.from(selected || []).filter(f => DC.SCHEMA_FIELDS.indexOf(f) >= 0 && f !== 'id');
      if (!keep.length) return null;
      const base = DC.blankEntry();
      keep.forEach(f => { base[f] = JSON.parse(JSON.stringify(src[f] === undefined ? DC.BLANK_ENTRY[f] : src[f])); });
      ['brand', 'model', 'variant'].forEach(f => { if (base[f] === undefined) base[f] = src[f] || ''; });
      return base;
    }
    return null;
  }
  /**
   * stageCandidates(proposals, opts) - validates and normalises the ticked rows.
   * opts: { include:Set(indexes), fieldSel:(i,p)=>Set|null, liveIds:Set, diskFiles:Array|null }
   * Returns { staged:[{proposal, candidate}], problems:[], stats }.
   */
  function stageCandidates(proposals, opts) {
    const staged = [], problems = [];
    const stats = { stripped: 0, strippedReports: [], linksKept: 0, keptReports: [] };
    const liveIds = opts.liveIds;
    const onDisk = new Set(opts.diskFiles || []), diskIndex = new Map();
    (opts.diskFiles || []).forEach(p => diskIndex.set(p.toLowerCase(), p));
    const dirKnown = Array.isArray(opts.diskFiles) && opts.diskFiles.length > 0;
    proposals.forEach((p, i) => {
      if (!opts.include.has(i)) return;
      if (p.action === 'delete') { staged.push({ proposal: p, candidate: null }); return; }
      if (p.action === 'invalid' || p.action === 'same') return;
      const selected = opts.fieldSel ? opts.fieldSel(i, p) : null;
      let candidate, only = null;
      if (selected) { candidate = buildFieldMerged(p, selected); if (!candidate) return; only = new Set(selected); }
      else candidate = Object.assign({}, p.action === 'new' ? p.entry : p['new']);
      if (p.action === 'changed') {
        if (candidate.id === undefined) candidate.id = p.old.id;
        const inc = candidate.files;
        if (!(Array.isArray(inc) && inc.length)) {
          const kept = (p.old.files || []).slice();
          candidate.files = kept;
          if (kept.length) { stats.linksKept++; stats.keptReports.push((p.old.id || '(no id)') + ': kept ' + kept.length + ' existing file link(s) -- the AI reply did not list any'); }
        }
      }
      candidate.id = DC.buildId(String(candidate.brand || ''), String(candidate.model || ''), String(candidate.variant || '')) || candidate.id;
      candidate = normalizeImportEntry(candidate, only).candidate;
      if (dirKnown && (!only || only.has('files'))) {
        const inc = (candidate.files || []).slice();
        if (inc.length) {
          const r = splitFilesByExistence(inc, onDisk, diskIndex);
          if (r.dropped.length) {
            candidate.files = r.kept;
            stats.stripped += r.dropped.length;
            stats.strippedReports.push((candidate.id || '(no id)') + ': stripped phantom file(s) not on disk: ' + r.dropped.slice(0, 3).join(', ') + (r.dropped.length > 3 ? '...' : ''));
          }
        }
      }
      const exclude = p.action === 'changed' ? p.old.id : null;
      const errs = DC.validateEntry(candidate, liveIds, exclude);
      if (errs.length) { problems.push((candidate.id || '(no id)') + ': ' + errs[0]); return; }
      if (p.action === 'new') liveIds.add(candidate.id);
      else if (p.action === 'changed' && candidate.id !== exclude) { liveIds.delete(exclude); liveIds.add(candidate.id); }
      staged.push({ proposal: p, candidate: candidate });
    });
    return { staged: staged, problems: problems, stats: stats };
  }
  return { parseAiOutput, classifyAgainst, normalizeParsed, normalizeBrandSpellings, normalizeImportEntry, stageCandidates, splitFilesByExistence, buildFieldMerged };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataImport;
