/* ===== data-curves.js =====
 * Database tab: raw measurement curve logic (pure, Node-testable).
 * Ported from the Database Tool's curve_logic.py + fr_analysis.py:
 * lenient parsing of any freq/SPL text export, L/R and (1)/(2) pairing,
 * averaging onto a common grid, standardised output, and the acoustic
 * analysis that suggests sound-signature tags.
 */
const DataCurves = (function () {
  'use strict';

  const NUMBERED_SUFFIX_RE = /[_\-(\[]+([12])[\s_\-)\]]*$/;
  const LR_SUFFIX_RE = /[\s_\-]([LR])$/i;
  const DECIMAL_COMMA_RE = /^-?\d+,\d+$/;
  const MIN_FREQ_HZ = 1.0, MAX_FREQ_HZ = 200000.0;
  const MIN_SPL_DB = -200.0, MAX_SPL_DB = 200.0;
  const KHZ_SUSPECT_MAX_HZ = 100.0;
  const MIN_CURVE_POINTS = 2;
  const PAIR_MISMATCH_WARN_DB = 10.0;

  function groupKeyAndRole(stem) {
    let m = NUMBERED_SUFFIX_RE.exec(stem);
    if (m) return [stem.slice(0, m.index).trim(), m[1]];
    m = LR_SUFFIX_RE.exec(stem);
    if (m) return [stem.slice(0, m.index).trim(), m[1].toUpperCase()];
    return [stem, null];
  }
  const normDec = f => (DECIMAL_COMMA_RE.test(f) ? f.replace(',', '.') : f);

  function splitFields(s) {
    let chunks;
    if (s.indexOf(';') >= 0) chunks = s.split(';').map(c => c.trim()).filter(Boolean);
    else if (s.indexOf('\t') >= 0) chunks = s.split('\t').map(c => c.trim()).filter(Boolean);
    else {
      const toks = s.split(/\s+/).filter(Boolean);
      if (toks.length >= 2 && toks.every(t => DECIMAL_COMMA_RE.test(t))) return toks.map(normDec);
      return s.split(/[\t,]+|\s+/).filter(Boolean);
    }
    const fields = [];
    chunks.forEach(c => c.split(/\s+/).forEach(sub => { if (sub) fields.push(normDec(sub)); }));
    return fields;
  }
  // Python float() on a data field; NaN-able, returns null when not numeric.
  function toNum(f) {
    const t = f.replace(/(\d)_(?=\d)/g, '$1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
    const l = t.toLowerCase();
    if (/^[+-]?(inf|infinity)$/.test(l)) return l[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(l)) return NaN;
    return null;
  }
  function looksLikeDateTriple(rows, nums) {
    if (nums.length !== 3) return false;
    for (const v of nums) if (v === null || !Number.isInteger(v)) return false;
    const f = nums[0], s = nums[1], p = nums[2];
    if (!(f >= 1900 && f <= 2100 && s >= 1 && s <= 12 && p >= 1 && p <= 31)) return false;
    return rows && rows.length ? rows.some(r => r[0] < 1900 || r[0] > 2100) : false;
  }
  function tryParseRow(line, rows, stats, col) {
    const s = line.trim();
    if (!s) return null;
    const fields = splitFields(s);
    if (fields.length < 2) return null;
    const nums = [];
    for (const f of fields.slice(col, col + 3)) { const n = toNum(f); if (n === null) break; nums.push(n); }
    if (nums.length < 2) return null;
    if (looksLikeDateTriple(rows, nums)) return null;
    const freq = nums[0], spl = nums[1];
    let phase = nums.length > 2 ? nums[2] : null;
    if (!(freq >= MIN_FREQ_HZ && freq <= MAX_FREQ_HZ)) {
      if (stats && freq < MIN_FREQ_HZ) stats.belowMin = (stats.belowMin || 0) + 1;
      return null;
    }
    if (!(isFinite(spl) && spl >= MIN_SPL_DB && spl <= MAX_SPL_DB)) return null;
    if (phase !== null && !isFinite(phase)) phase = null;
    return [freq, spl, phase];
  }
  function sortDedupe(rows) {
    const sorted = rows.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let last = null;
    sorted.forEach(r => { if (last !== null && r[0] === last) return; out.push(r); last = r[0]; });
    return out;
  }
  function parseRows(text, col, stats) {
    const rows = [];
    text.split(/\r\n|\r|\n/).forEach(line => { const r = tryParseRow(line, rows, stats, col); if (r) rows.push(r); });
    return rows;
  }
  function looksLikeIndexColumn(rows) {
    if (rows.length < 3) return false;
    if (rows[0][0] !== 0 && rows[0][0] !== 1) return false;
    for (let i = 1; i < rows.length; i++) if (rows[i][0] - rows[i - 1][0] !== 1) return false;
    return true;
  }
  /** parseCurveText(text) -> [[freq, spl, phase|null], ...] ; throws on kHz axes. */
  function parseCurveText(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const stats = {};
    const cands = parseRows(text, 0, stats);
    let rows = sortDedupe(cands.filter(r => !looksLikeDateTriple(cands, r)));
    if (looksLikeIndexColumn(rows)) {
      const retry = sortDedupe(parseRows(text, 1, {}).filter(r => !looksLikeDateTriple(cands, r)));
      if (retry.length >= rows.length) rows = retry;
    }
    if (rows.length < MIN_CURVE_POINTS) return [];
    if (Math.max.apply(null, rows.map(r => r[0])) <= KHZ_SUSPECT_MAX_HZ && stats.belowMin) {
      throw new Error('frequency column looks like kHz, not Hz (highest value ' + Math.max.apply(null, rows.map(r => r[0])) + ', and ' + stats.belowMin + ' row(s) fell below ' + MIN_FREQ_HZ + ' Hz and were dropped) -- re-export with the frequency axis in Hz');
    }
    return rows;
  }
  function interpSpl(freqs, spls, targets) {
    if (!freqs.length || !spls.length) return [];
    const n = freqs.length, out = [];
    targets.forEach(tf => {
      if (tf <= freqs[0]) { out.push(spls[0]); return; }
      if (tf >= freqs[n - 1]) { out.push(spls[n - 1]); return; }
      let lo = 0, hi = n - 1;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (freqs[mid] <= tf) lo = mid; else hi = mid; }
      const f0 = freqs[lo], f1 = freqs[hi], s0 = spls[lo], s1 = spls[hi];
      out.push(f1 === f0 ? s0 : s0 + (tf - f0) / (f1 - f0) * (s1 - s0));
    });
    return out;
  }
  function overlapBounds(lists) {
    return [Math.max.apply(null, lists.map(r => r[0][0])), Math.min.apply(null, lists.map(r => r[r.length - 1][0]))];
  }
  function pairMismatch(a, b) {
    const ob = overlapBounds([a, b]);
    if (ob[0] > ob[1]) return Infinity;
    const grid = a.filter(r => r[0] >= ob[0] && r[0] <= ob[1]);
    const ib = interpSpl(b.map(r => r[0]), b.map(r => r[1]), grid.map(r => r[0]));
    const d = grid.map((r, i) => Math.abs(r[1] - ib[i]));
    return d.length ? d.reduce((x, y) => x + y, 0) / d.length : 0;
  }
  function averageGroup(lists) {
    const ob = overlapBounds(lists);
    if (ob[0] > ob[1]) return [];
    const base = lists[0].filter(r => r[0] >= ob[0] && r[0] <= ob[1]).map(r => r[0]);
    if (!base.length) return [];
    const all = lists.map(rows => interpSpl(rows.map(r => r[0]), rows.map(r => r[1]), base));
    return base.map((f, i) => [f, all.reduce((s, a) => s + a[i], 0) / all.length]);
  }
  function formatCurve(rows) {
    return rows.map(r => r[0].toFixed(6) + '\t' + r[1].toFixed(3)).join('\n') + '\n';
  }
  function sanitizeFilename(name) {
    let c = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, ' ');
    if (c === '.' || c === '..') return 'curve.txt';
    return c || 'curve.txt';
  }
  function stemOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; }

  /**
   * planGroups(files) - files: [{name, text}]. Returns plans:
   * { key, sources:[{name,text,role}], averaged, suggestedName }
   */
  function planGroups(files) {
    const groups = new Map();
    files.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).forEach(f => {
      const gr = groupKeyAndRole(stemOf(f.name));
      if (!groups.has(gr[0])) groups.set(gr[0], []);
      groups.get(gr[0]).push({ name: f.name, text: f.text, role: gr[1] });
    });
    const plans = [];
    Array.from(groups.keys()).sort().forEach(key => {
      const members = groups.get(key);
      const roles = new Set(members.filter(m => m.role !== null).map(m => m.role));
      const setEq = (a, b) => a.size === b.length && b.every(x => a.has(x));
      const averaged = members.length === 2 && (setEq(roles, ['1', '2']) || setEq(roles, ['L', 'R']));
      plans.push({ key: key, sources: members, averaged: averaged, suggestedName: sanitizeFilename(key.toUpperCase() + '.txt') });
    });
    return plans;
  }
  /**
   * convertPlan(plan, name) -> { outputs:[{name, text, rows, how}], log:[] }
   * Mirrors convert_plan: demotes mismatched "pairs" to separate files.
   */
  function convertPlan(plan, outName) {
    const log = [], good = [];
    plan.sources.forEach(s => {
      let rows;
      try { rows = parseCurveText(s.text); }
      catch (e) { log.push('[FAILED]  ' + s.name + '  (' + e.message + ')'); return; }
      if (!rows.length) { log.push('[SKIPPED] ' + s.name + '  (no usable data rows found)'); return; }
      good.push({ name: s.name, rows: rows });
    });
    if (!good.length) return { outputs: [], log: log };
    let averaged = plan.averaged;
    if (averaged && good.length === 2) {
      const mm = pairMismatch(good[0].rows, good[1].rows);
      if (mm === Infinity) { log.push('[SKIPPED] ' + plan.key.toUpperCase() + '  (no overlapping frequency range - converting each file separately)'); averaged = false; }
      else if (mm > PAIR_MISMATCH_WARN_DB) { log.push('[SKIPPED] ' + plan.key.toUpperCase() + '  (looks paired by filename but the curves differ by ' + mm.toFixed(1) + ' dB on average - too different to be a stereo/repeat pair; converting each file separately)'); averaged = false; }
      else {
        const avg = averageGroup([good[0].rows, good[1].rows]);
        if (!avg.length) { log.push('[SKIPPED] ' + plan.key.toUpperCase() + '  (no overlapping frequency range - converting each file separately)'); averaged = false; }
        else {
          log.push('[OK]      ' + outName + '  <-  averaged ' + good[0].name + ' + ' + good[1].name);
          return { outputs: [{ name: outName, text: formatCurve(avg), rows: avg, how: 'averaged' }], log: log, averaged: true };
        }
      }
    }
    const outputs = [];
    good.forEach((g, n) => {
      const nm = n === 0 ? outName : sanitizeFilename(stemOf(g.name).toUpperCase() + '.txt');
      if (n > 0 && (nm === outName || outputs.some(o => o.name === nm))) { log.push('[SKIPPED] ' + nm + '  (derived name collides with another output -- rename to convert this one)'); return; }
      outputs.push({ name: nm, text: formatCurve(g.rows.map(r => [r[0], r[1]])), rows: g.rows.map(r => [r[0], r[1]]), how: 'single' });
      log.push('[OK]      ' + nm);
    });
    return { outputs: outputs, log: log, averaged: false };
  }

  // ------------------------------------------------------ FR analysis / tags
  const band = (pts, lo, hi) => { const v = pts.filter(p => p[0] >= lo && p[0] <= hi).map(p => p[1]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const bandPeak = (pts, lo, hi) => { const v = pts.filter(p => p[0] >= lo && p[0] <= hi).map(p => p[1]); return v.length ? Math.max.apply(null, v) : null; };
  function ref1k(pts) {
    let v = pts.filter(p => p[0] >= 900 && p[0] <= 1100).map(p => p[1]).sort((a, b) => a - b);
    if (!v.length) v = pts.filter(p => p[0] >= 700 && p[0] <= 1300).map(p => p[1]).sort((a, b) => a - b);
    if (!v.length) return null;
    const n = v.length, mid = n >> 1;
    return n % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }
  const r1 = x => Math.round(x * 10) / 10;
  const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(1);

  /** analyzePoints(points[[f,db]]) -> { ok, metrics, suggestions:[{tag,reason}], coverage } */
  function analyzePoints(points) {
    const out = { ok: false, metrics: {}, suggestions: [] };
    if (!points || points.length < 20) { out.error = 'Not enough data points.'; return out; }
    const fmin = points[0][0], fmax = points[points.length - 1][0];
    const ref = ref1k(points);
    if (ref === null) { out.error = 'No samples near 1 kHz to reference against.'; return out; }
    const m = {};
    const bass = band(points, 20, 100); if (bass !== null) m.bass_shelf = r1(bass - ref);
    const mid = band(points, 500, 1500); if (mid !== null) m.mid_level = r1(mid - ref);
    const pb = band(points, 2500, 3500), pp = bandPeak(points, 2500, 3500);
    if (pb !== null) m.pinna_gain = r1(pb - ref);
    if (pp !== null) m.pinna_peak = r1(pp - ref);
    const thi = Math.min(15000, fmax), cov = (thi - 6000) / 9000;
    const ta0 = band(points, 6000, thi), tp0 = bandPeak(points, 6000, thi);
    if (ta0 !== null && cov >= 0.25) m.treble_avg = r1(ta0 - ref); else if (ta0 !== null) m.treble_avg_partial = r1(ta0 - ref);
    if (tp0 !== null) { if (cov >= 0.25) m.treble_peak = r1(tp0 - ref); else m.treble_peak_partial = r1(tp0 - ref); }
    let sugg = [];
    const add = (tag, reason) => sugg.push({ tag: tag, reason: reason });
    const bs = m.bass_shelf;
    if (bs !== undefined) {
      if (bs > 8) { add('Basshead', 'Bass shelf ' + sgn(bs) + ' dB above 1 kHz (>8)'); add('Sub-Bass', 'Deep-bass elevated shelf'); add('Punchy Bass', 'Elevated low-end energy'); }
      else if (bs >= 3) { add('Warm', 'Moderate bass shelf ' + sgn(bs) + ' dB (3-8)'); add('Balanced', 'Bass present but controlled (' + sgn(bs) + ' dB)'); }
      else if (bs >= 0) { add('Neutral', 'Flat bass shelf ' + sgn(bs) + ' dB vs 1 kHz'); add('Reference', 'Near-linear low end'); }
    }
    const pg = m.pinna_gain !== undefined ? m.pinna_gain : m.pinna_peak;
    const ta = m.treble_avg, tp = m.treble_peak;
    const warmBass = bs !== undefined && bs >= 3;
    let score = 0;
    if (pg !== undefined) score += (pg - 9) / 3;
    if (ta !== undefined) score += (ta + 2) / 6;
    if (tp !== undefined && pg !== undefined && tp - pg > 6) score += 0.4;
    const bright = score > 1.0 && !(warmBass && score < 2.0);
    const dark = score < -0.9;
    if (bright) {
      add('Bright', 'Forward upper range (brightness score ' + sgn(score) + ')');
      if (pg !== undefined && pg > 12) add('Vocal-Focused', 'Pinna gain ' + sgn(pg) + ' dB (>12)');
      if (tp !== undefined && pg !== undefined && tp - pg > 6) add('Treblehead', 'Sharp treble peak ' + sgn(tp) + ' dB over ear gain');
      else if (ta !== undefined && pg !== undefined && ta > pg) add('Analytical', 'Treble energy at/above ear gain (' + sgn(ta) + ' dB)');
    } else if (dark) {
      add('Smooth', 'Receding highs (brightness score ' + sgn(score) + ')');
      add('Dark', 'Low high-frequency energy');
      if (pg !== undefined && pg < 6) add('Relaxed', 'Soft pinna gain ' + sgn(pg) + ' dB (<6)');
    }
    const ml = m.mid_level;
    if (ml !== undefined && bs !== undefined && pg !== undefined) {
      const floor = Math.min(bs, pg - 7);
      if (ml + 3 < floor) add(bs >= 6 ? 'V-Shaped' : 'U-Shaped', 'Midrange sits ' + Math.abs(ml).toFixed(1) + ' dB below the bass/pinna shoulders');
      else if (Math.abs(ml) <= 3 && pg >= 8 && pg <= 12 && !bright && !dark) add('Balanced', 'Linear midrange with Harman-like pinna gain');
    }
    const prim = ['V-Shaped', 'U-Shaped', 'Neutral', 'Balanced'];
    const keptPrimary = prim.find(p => sugg.some(s => s.tag === p)) || null;
    if (keptPrimary !== null) sugg = sugg.filter(s => ['Neutral', 'Balanced', 'V-Shaped', 'U-Shaped'].indexOf(s.tag) < 0 || s.tag === keptPrimary);
    if (pg !== undefined && pg < 6) {
      sugg = sugg.filter(s => ['Bright', 'Treblehead', 'Analytical', 'Vocal-Focused'].indexOf(s.tag) < 0);
      if (!sugg.some(s => ['Smooth', 'Dark', 'Relaxed', 'Warm'].indexOf(s.tag) >= 0)) add('Relaxed', 'Soft pinna gain ' + sgn(pg) + ' dB (<6)');
    }
    let now = new Set(sugg.map(s => s.tag));
    if (now.has('Warm')) sugg = sugg.filter(s => s.tag !== 'Bright' && s.tag !== 'Analytical');
    now = new Set(sugg.map(s => s.tag));
    if (now.has('Basshead')) sugg = sugg.filter(s => s.tag !== 'Treblehead');
    if (keptPrimary === 'V-Shaped') sugg = sugg.filter(s => s.tag !== 'Vocal-Focused');
    const seen = new Set(), uniq = [];
    sugg.forEach(s => { if (!seen.has(s.tag)) { seen.add(s.tag); uniq.push(s); } });
    out.ok = true; out.metrics = m; out.suggestions = uniq;
    out.coverage = Math.round(fmin) + 'Hz - ' + Math.round(fmax) + 'Hz';
    return out;
  }
  function summarizeMetrics(m) {
    const order = [['bass_shelf', 'Bass'], ['mid_level', 'Mid'], ['pinna_gain', 'Pinna'], ['treble_avg', 'Treble']];
    const parts = order.filter(o => m[o[0]] !== undefined).map(o => o[1] + ' ' + sgn(m[o[0]]));
    return parts.join(' | ') + (parts.length ? ' dB' : '');
  }

  return { parseCurveText, interpSpl, pairMismatch, averageGroup, formatCurve, sanitizeFilename, planGroups, convertPlan,
    groupKeyAndRole, analyzePoints, summarizeMetrics, PAIR_MISMATCH_WARN_DB };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataCurves;
