/* ===== data-core.js =====
 * Database tab: pure logic. No DOM, no Electron, no I/O, so every function in
 * here can be exercised from Node (see tools/test-data-core.mjs).
 *
 * Ported from the standalone Database Tool (db_logic.py): schema + rules,
 * entry validation, canonical serialisation, the full audit engine (with
 * auto-fixes), fuzzy duplicate detection, JSON splitter, and an undo/redo
 * session model. Behaviour is intentionally identical to the Python tool so a
 * database that audits clean there audits clean here.
 */
const DataCore = (function () {
  'use strict';

  const CURRENT_YEAR = new Date().getFullYear();

  // ---------------------------------------------------------------- schema
  const SCHEMA_FIELDS = ['id', 'brand', 'model', 'variant', 'year', 'price_usd',
    'driver_type', 'driver_config', 'impedance', 'sensitivity',
    'connector', 'form_factor', 'tags', 'files'];
  const SCHEMA_STR_FIELDS = ['id', 'brand', 'model', 'variant', 'driver_type',
    'driver_config', 'connector', 'form_factor'];
  const SCHEMA_INT_FIELDS = ['year', 'price_usd', 'impedance', 'sensitivity'];
  const SCHEMA_LIST_FIELDS = ['tags', 'files'];
  const BLANK_ENTRY = Object.freeze({
    id: '', brand: '', model: '', variant: '', year: 0, price_usd: 0,
    driver_type: '', driver_config: '', impedance: 0, sensitivity: 0,
    connector: '', form_factor: '', tags: [], files: []
  });
  function blankEntry() {
    return { id: '', brand: '', model: '', variant: '', year: 0, price_usd: 0,
      driver_type: '', driver_config: '', impedance: 0, sensitivity: 0,
      connector: '', form_factor: '', tags: [], files: [] };
  }

  const DRIVER_TECH_ORDER = ['DD', 'BA', 'Planar', 'EST', 'MEMS', 'PZT', 'BC'];
  const ALLOWED_DRIVER_TYPES = ['', 'DD', 'BA', 'BC', 'Planar', 'Hybrid', 'Tribrid', 'EST', 'MEMS', 'PZT'];
  const FORM_FACTORS = ['IEM', 'Wireless Earbuds (TWS)', 'Earbuds (Wired)',
    'Wireless Over-Ear Headphones', 'Over-Ear Headphones (Wired)'];
  const CONNECTORS_ALL = ['Bluetooth', '2-pin', 'QDC', 'MMCX', 'A2DC',
    'Fixed Cable', 'Detachable Cable', 'Proprietary', 'Electrostatic'];
  const FORM_CONNECTOR_MAP = {
    'IEM': ['2-pin', 'QDC', 'MMCX', 'A2DC', 'Fixed Cable', 'Proprietary'],
    'Earbuds (Wired)': ['2-pin', 'QDC', 'MMCX', 'A2DC', 'Fixed Cable', 'Proprietary'],
    'Wireless Earbuds (TWS)': ['Bluetooth'],
    'Wireless Over-Ear Headphones': ['Bluetooth'],
    'Over-Ear Headphones (Wired)': ['Detachable Cable', 'Fixed Cable', 'Proprietary', 'Electrostatic']
  };
  const TWS_FORM_FACTOR = 'Wireless Earbuds (TWS)';
  const WIRELESS_OVER_EAR_FORM_FACTOR = 'Wireless Over-Ear Headphones';

  // Icons that ship with IEM Tool (app/icons). Note the file is "trybrid.png".
  const FORM_FACTOR_ICON = { 'IEM': 'iem', 'Wireless Earbuds (TWS)': 'tws', 'Earbuds (Wired)': 'earbud',
    'Wireless Over-Ear Headphones': 'headphone', 'Over-Ear Headphones (Wired)': 'headphone' };
  const CONNECTOR_ICON = { 'Bluetooth': 'bluetooth', '2-pin': '2pin', 'QDC': 'qdc', 'MMCX': 'mmcx',
    'A2DC': 'a2dc', 'Fixed Cable': 'fixed', 'Detachable Cable': 'detach',
    'Proprietary': 'proprietary', 'Electrostatic': 'electro' };
  const DRIVER_TYPE_ICON = { 'DD': 'dd', 'BA': 'ba', 'BC': 'bc', 'Planar': 'planar', 'EST': 'est',
    'MEMS': 'mems', 'PZT': 'pzt', 'Hybrid': 'hybrid', 'Tribrid': 'trybrid' };

  // Same five groups, names and emoji as the Database Tool's tag picker. Emoji are
  // display-only: the strings saved to database.json are the plain tag names.
  const PRICE_GROUP = 'Price Tier (auto-assigned)';
  const TAG_GROUPS = {
    'Tonal Profiles & Sound Signature': ['Basshead', 'Sub-Bass', 'Punchy Bass', 'Warm', 'Neutral', 'V-Shaped',
      'U-Shaped', 'Balanced', 'Bright', 'Treblehead', 'Dark', 'Vocal-Focused'],
    'Technicalities & Presentation': ['Detailed', 'Resolving', 'Technical', 'Wide-Stage', 'Good-Imaging',
      'Smooth', 'Reference', 'Analytical', 'Fun', 'Relaxed'],
    'Use Cases': ['Gaming', 'Competitive-Gaming', 'Studio-Monitoring'],
    'Price Tier (auto-assigned)': ['Budget', 'Mid-Tier', 'Premium', 'Flagship'],
    'Release Types': ['Collab', 'Limited-Edition']
  };
  const TAG_GROUP_EMOJI = { 'Tonal Profiles & Sound Signature': '\uD83C\uDFA8', 'Technicalities & Presentation': '\uD83D\uDD2C',
    'Use Cases': '\uD83C\uDFAF', 'Price Tier (auto-assigned)': '\uD83D\uDCB0', 'Release Types': '\uD83C\uDFF7\uFE0F' };
  const TAG_EMOJI = {
    'Basshead': '\uD83D\uDCA5', 'Sub-Bass': '\uD83C\uDF0A', 'Punchy Bass': '\uD83E\uDD4A', 'Warm': '\uD83C\uDF3F',
    'Neutral': '\u2696\uFE0F', 'V-Shaped': '\uD83D\uDD3A', 'U-Shaped': '\uD83E\uDDF2', 'Balanced': '\u262F\uFE0F',
    'Bright': '\u2728', 'Treblehead': '\u26A1', 'Dark': '\uD83C\uDF11', 'Vocal-Focused': '\uD83D\uDDE3\uFE0F',
    'Detailed': '\uD83D\uDD0D', 'Resolving': '\uD83D\uDC53', 'Technical': '\uD83D\uDD2C', 'Wide-Stage': '\uD83C\uDFDF\uFE0F',
    'Good-Imaging': '\uD83D\uDD2D', 'Smooth': '\uD83E\uDDC8', 'Reference': '\uD83D\uDCD0', 'Analytical': '\uD83E\uDDE0',
    'Fun': '\uD83D\uDD25', 'Relaxed': '\uD83D\uDE0C', 'Gaming': '\uD83C\uDFAE', 'Competitive-Gaming': '\uD83C\uDFC6',
    'Studio-Monitoring': '\uD83C\uDF9B\uFE0F', 'Collab': '\uD83E\uDD1D', 'Limited-Edition': '\uD83C\uDF1F',
    'Budget': '\uD83E\uDE99', 'Mid-Tier': '\uD83D\uDCB5', 'Premium': '\uD83D\uDC8E', 'Flagship': '\uD83D\uDC51'
  };
  const APPROVED_TAGS = [].concat.apply([], Object.keys(TAG_GROUPS).map(k => TAG_GROUPS[k]));
  // One canonical emoji lookup for the whole app (Find, EQ, Review, PEQdb all
  // resolve through tagEmoji). Names are matched case/space/underscore-folded;
  // a small alias table keeps the historical synonyms that predate the shared
  // registry (v-shape, sub bass, detail, soundstage, …) pointing at the same
  // emoji as their canonical tag. Unknown names fall back to the generic label.
  function tagNorm(s) { return String(s === null || s === undefined ? '' : s).toLowerCase().trim().replace(/[\s_]+/g, '-'); }
  const TAG_EMOJI_BY_NORM = {};
  Object.keys(TAG_EMOJI).forEach(k => { TAG_EMOJI_BY_NORM[tagNorm(k)] = TAG_EMOJI[k]; });
  const TAG_EMOJI_ALIAS = {
    'v-shape': '\uD83D\uDD3A',            // V-Shaped
    'detail': '\uD83D\uDD0D',             // Detailed
    'soundstage': '\uD83C\uDFDF\uFE0F',   // Wide-Stage
    'imaging': '\uD83D\uDD2D',            // Good-Imaging
    'warm-tilt': '\uD83C\uDF3F',          // Warm
    'u-shape': '\uD83E\uDDF2',            // U-Shaped
    'vocal': '\uD83C\uDFA4',              // Vocal (review-side name)
    'vintage': '\uD83D\uDCFC'            // legacy-only tag
  };
  const TAG_EMOJI_FALLBACK = '\uD83C\uDFF7\uFE0F';
  function tagEmoji(name) {
    if (name === null || name === undefined || name === '') return TAG_EMOJI_FALLBACK;
    if (typeof name !== 'string') name = String(name);
    const k = tagNorm(name);
    return TAG_EMOJI_BY_NORM[k] || TAG_EMOJI_ALIAS[k] || TAG_EMOJI_FALLBACK;
  }
  const PRICE_TIER_TAGS = TAG_GROUPS[PRICE_GROUP];
  const PRIMARY_TONALITY_GROUP = ['Neutral', 'Balanced', 'V-Shaped', 'U-Shaped'];
  const TAG_CONFLICT_PAIRS = [
    ['V-Shaped', 'U-Shaped'], ['Neutral', 'V-Shaped'], ['V-Shaped', 'Vocal-Focused'],
    ['Dark', 'Bright'], ['Dark', 'Treblehead'], ['Warm', 'Bright'],
    ['Warm', 'Analytical'], ['Basshead', 'Treblehead']
  ];
  const TAG_CONFLICT_RESOLUTION = {
    'U-Shaped|V-Shaped': 'deterministic default: keep the profile the measurement curves support; the prompt says default to "V-Shaped" if ambiguous',
    'Neutral|V-Shaped': 'remove the weaker supported tag',
    'V-Shaped|Vocal-Focused': 'remove "Vocal-Focused" -- a V-shape recesses the midrange',
    'Bright|Dark': 'keep the dominant treble character',
    'Dark|Treblehead': 'remove the contradictory tag based on the frequency response',
    'Bright|Warm': 'resolve to the dominant tonal balance',
    'Analytical|Warm': 'remove "Analytical" if warm/bassy, or "Warm" if lean/clinical',
    'Basshead|Treblehead': 'keep the defining signature tag'
  };
  const PRIMARY_TONALITY_RESOLUTION = 'at most one primary tonal profile is allowed; keep the one the measurement curves support';
  const MIN_TAGS = 4;
  const MAX_TAGS = 12;

  const IMPEDANCE_MAX = 200000;
  const IMPEDANCE_MAX_ELECTROSTATIC = 360000;
  const SENSITIVITY_MAX = 200;
  const PRICE_MAX = 10000000;

  // Audit knobs (same defaults as the Python tool).
  const ENFORCE_TWS_ZERO_SPECS = false;
  const CANONICALIZE_DRIVER_ORDER = true;
  const WARN_ZERO_YEAR = true;
  const WARN_ZERO_PRICE = true;
  const WARN_UNVERIFIED_DRIVERS = true;
  const WARN_ZERO_SPECS_NON_TWS = true;
  const WARN_TWS_SPECS_NONZERO = true;
  const NO_FILES_WARN_THRESHOLD = 25;
  const UNLINKED_ROW_CAP = 200;

  // ----------------------------------------------------- python-ish helpers
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function sstr(v) { return str(v).trim(); }

  // Python float(text): returns a number (may be +-Infinity / NaN) or null if unparseable.
  function pyFloat(text) {
    const s = String(text).trim().replace(/(\d)_(?=\d)/g, '$1');
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    const low = s.toLowerCase();
    if (/^[+-]?(inf|infinity)$/.test(low)) return low[0] === '-' ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(low)) return NaN;
    return null;
  }
  function pyFloatAny(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') return pyFloat(v);
    return null;
  }

  const NUM_UNIT_SUFFIXES = ['ohms', 'ohm', '\u2126', '\u03a9', 'db', 'hz'];
  const THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

  function coerceInt(value, dflt) {
    if (dflt === undefined) dflt = 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') {
      if (!isFinite(value)) return dflt;
      if (!Number.isInteger(value)) return Math.floor(value + 0.5);
      return value;
    }
    if (typeof value === 'string') {
      if (value.indexOf('_') >= 0) return dflt;
      let cleaned = value.trim().replace(/\$/g, '');
      const lowered = cleaned.toLowerCase();
      for (const suffix of NUM_UNIT_SUFFIXES) {
        if (lowered.endsWith(suffix.toLowerCase())) {
          cleaned = cleaned.slice(0, cleaned.length - suffix.length).trim();
          break;
        }
      }
      if (cleaned.indexOf(',') >= 0 && THOUSANDS_RE.test(cleaned)) cleaned = cleaned.replace(/,/g, '');
      if (cleaned && cleaned !== value.trim()) {
        const f = pyFloat(cleaned);
        if (f !== null && isFinite(f)) return Math.trunc(f !== Math.trunc(f) ? Math.floor(f + 0.5) : f);
      }
      const f2 = pyFloat(value);
      if (f2 === null || !isFinite(f2)) return dflt;
      return Math.trunc(f2 !== Math.trunc(f2) ? Math.floor(f2 + 0.5) : f2);
    }
    return dflt;
  }

  function isValidYear(year) {
    const y = coerceInt(year, -1);
    if (y === 0) return true;
    return y >= 1950 && y <= CURRENT_YEAR + 1;
  }

  // ----------------------------------------------------------- id building
  function normalizeComponent(text) {
    if (text === null || text === undefined) return '';
    let t = String(text).normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
    t = t.trim().toLowerCase().replace(/\+/g, '_plus_');
    t = t.replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return t;
  }
  // Python: "x" + sha1(utf8)[:6]. A tiny synchronous sha1 so ids stay byte-identical.
  function sha1Hex(str_) {
    const bytes = Array.from(new TextEncoder().encode(str_));
    const l = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const bits = l * 8;
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const rol = (n, s) => ((n << s) | (n >>> (32 - s))) >>> 0;
    for (let off = 0; off < bytes.length; off += 64) {
      const w = new Array(80);
      for (let i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        const t = (rol(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('');
  }
  function nonLatinDigest(text) { return 'x' + sha1Hex(String(text)).slice(0, 6); }

  function buildId(brand, model, variant) {
    const comps = [];
    [brand, model].forEach(raw => {
      const norm = normalizeComponent(raw);
      if (norm) comps.push(norm);
      else if (raw && String(raw).trim()) comps.push(nonLatinDigest(raw));
    });
    if (variant && String(variant).trim()) {
      const vnorm = normalizeComponent(variant);
      comps.push(vnorm || nonLatinDigest(variant));
    }
    return comps.filter(Boolean).join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  }

  function brandFold(brand) {
    if (!brand) return '';
    return String(brand).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function brandSpellingFixes(entries) {
    const buckets = new Map();
    entries.forEach((e, idx) => {
      const brand = sstr(e.brand);
      if (!brand) return;
      const fold = brandFold(brand);
      if (!fold) return;
      if (!buckets.has(fold)) buckets.set(fold, new Map());
      const m = buckets.get(fold);
      if (!m.has(brand)) m.set(brand, []);
      m.get(brand).push(idx);
    });
    const fixes = new Map();
    buckets.forEach(spellings => {
      if (spellings.size < 2) return;
      const ranked = Array.from(spellings.entries()).sort((a, b) =>
        (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const canonical = ranked[0][0];
      const hasMajority = ranked[0][1].length > ranked[1][1].length;
      const summary = ranked.map(r => "'" + r[0] + "' (" + r[1].length + ')').join(', ');
      ranked.slice(1).forEach(r => r[1].forEach(idx => fixes.set(idx, [r[0], canonical, summary, hasMajority])));
    });
    return fixes;
  }

  function brandCanonicalSpellings(entries) {
    const canon = new Map();
    entries.forEach(e => {
      const brand = sstr(e.brand);
      if (!brand) return;
      const fold = brandFold(brand);
      if (!fold) return;
      if (!canon.has(fold)) canon.set(fold, new Map());
      const m = canon.get(fold);
      m.set(brand, (m.get(brand) || 0) + 1);
    });
    const out = new Map();
    canon.forEach((m, fold) => {
      const best = Array.from(m.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
      out.set(fold, best);
    });
    return out;
  }

  // ------------------------------------------------------------- price/tier
  function roundPriceTo5(price) {
    const p = pyFloatAny(price);
    if (p === null || !isFinite(p)) return 0;
    if (p <= 0) return 0;
    return Math.floor((p + 2.5) / 5) * 5;
  }
  function priceTierFor(price) {
    const f = pyFloatAny(price);
    if (f === null || !isFinite(f)) return 'Budget';
    const p = Math.trunc(f);
    if (p >= 1500) return 'Flagship';
    if (p >= 500) return 'Premium';
    if (p >= 100) return 'Mid-Tier';
    return 'Budget';
  }
  function priceTierBasis(price) {
    if (typeof price === 'string' && price.indexOf('_') >= 0) return price;
    const p = pyFloatAny(price);
    if (p === null) return price;
    if (!isFinite(p) || p < 0) return price;
    if (Number.isInteger(p) && p % 5 === 0) return p;
    return roundPriceTo5(p);
  }

  // ---------------------------------------------------------------- drivers
  function classifyDriver(components) {
    const techs = Object.keys(components).filter(t => components[t] && components[t] > 0);
    const ordered = DRIVER_TECH_ORDER.filter(t => techs.indexOf(t) >= 0);
    if (!ordered.length) return ['', ''];
    const config = ordered.map(t => components[t] + t).join('+');
    if (ordered.length === 1) return [ordered[0], config];
    if (ordered.length === 2) return ['Hybrid', config];
    return ['Tribrid', config];
  }
  const TECH_BY_UPPER = {};
  DRIVER_TECH_ORDER.forEach(t => { TECH_BY_UPPER[t.toUpperCase()] = t; });
  function splitDriverToken(part) {
    const m = /^(\d+)([A-Za-z]+)$/.exec(part);
    if (!m) return [0, null];
    const tech = TECH_BY_UPPER[m[2].toUpperCase()];
    if (!tech) return [0, null];
    return [coerceInt(m[1], 0), tech];
  }
  function parseDriverConfig(cfg) {
    const result = {};
    if (!cfg) return result;
    String(cfg).replace(/ /g, '').split('+').forEach(part => {
      if (!part) return;
      const r = splitDriverToken(part);
      if (r[1] !== null && r[0] > 0) result[r[1]] = r[0];
    });
    return result;
  }
  function driverConfigUnknownTokens(cfg) {
    const out = [];
    String(cfg).replace(/ /g, '').split('+').forEach(part => {
      if (!part) return;
      const r = splitDriverToken(part);
      if (r[1] === null || r[0] <= 0) out.push(part);
    });
    return out;
  }

  // ------------------------------------------------------------------- tags
  function tagConflicts(tagSet) {
    const conflicts = [];
    const seen = new Set();
    TAG_CONFLICT_PAIRS.forEach(pair => {
      if (tagSet.has(pair[0]) && tagSet.has(pair[1])) {
        const key = pair.slice().sort();
        const k = key.join('|');
        if (!seen.has(k)) { seen.add(k); conflicts.push(key); }
      }
    });
    const presentPrimary = Array.from(tagSet).filter(t => PRIMARY_TONALITY_GROUP.indexOf(t) >= 0);
    if (presentPrimary.length > 1) {
      const key = presentPrimary.slice().sort();
      const k = key.join('|');
      if (!seen.has(k)) { seen.add(k); conflicts.push(key); }
    }
    return conflicts;
  }
  function tagConflictResolution(pair) {
    const k = pair.slice().sort().join('|');
    if (TAG_CONFLICT_RESOLUTION[k]) return TAG_CONFLICT_RESOLUTION[k];
    if (pair.length && pair.every(t => PRIMARY_TONALITY_GROUP.indexOf(t) >= 0)) return PRIMARY_TONALITY_RESOLUTION;
    return null;
  }
  function joinTags(tags) { return tags.map(String).join(', '); }
  function countDup(arr) {
    const c = new Map();
    arr.forEach(t => c.set(String(t), (c.get(String(t)) || 0) + 1));
    return Array.from(c.entries()).filter(e => e[1] > 1).map(e => e[0]).sort();
  }
  function fixTierTags(tags, price) {
    // Rewrites tags to carry exactly the expected tier, keeping the original slot.
    const expected = priceTierFor(priceTierBasis(price));
    const present = tags.filter(t => PRICE_TIER_TAGS.indexOf(t) >= 0);
    if (present.length === 1 && present[0] === expected) return { tags: tags, changed: false, note: '' };
    const out = [];
    let placed = false;
    tags.forEach(t => {
      if (PRICE_TIER_TAGS.indexOf(t) >= 0) { if (!placed) { out.push(expected); placed = true; } }
      else out.push(t);
    });
    if (!placed) out.push(expected);
    return { tags: out, changed: true, note: 'tier ' + (present.length ? present.join('+') : '(none)') + '->' + expected };
  }

  // -------------------------------------------------------------- validation
  function validateEntry(entry, existingIds, excludeId) {
    const errors = [];
    existingIds = existingIds || new Set();
    const brand = sstr(entry.brand), model = sstr(entry.model), variant = sstr(entry.variant);
    if (!brand) errors.push('Brand is required.');
    if (!model) errors.push('Model is required.');
    const expectedId = buildId(brand, model, variant);
    if (!expectedId) errors.push('Brand and model are needed for the ID.');
    else if (entry.id !== expectedId) errors.push("ID should be '" + expectedId + "'.");
    if (expectedId && existingIds.has(expectedId) && expectedId !== excludeId) {
      errors.push("An entry with ID '" + expectedId + "' already exists.");
    }
    if (!isValidYear(entry.year === undefined ? 0 : entry.year)) {
      errors.push('Year must be 1950–' + (CURRENT_YEAR + 1) + ' (or 0).');
    }
    const priceRaw = entry.price_usd === undefined ? 0 : entry.price_usd;
    let price, priceFlagged = false;
    if (typeof priceRaw === 'number' && !isFinite(priceRaw)) { errors.push('Price must be a finite number.'); price = -1; }
    else if (typeof priceRaw === 'string' && priceRaw.indexOf('_') >= 0) {
      errors.push('Price must be a whole number.');
      price = -1;
    } else if (typeof priceRaw === 'string' && priceRaw.indexOf('.') >= 0) {
      errors.push('Price must be a whole number.');
      price = coerceInt(priceRaw, -1);
      priceFlagged = true;
    } else if (typeof priceRaw === 'string') {
      if (/^[+-]?\d+$/.test(priceRaw.trim())) price = parseInt(priceRaw.trim(), 10);
      else { errors.push('Price must be a whole number.'); price = -1; }
    } else price = coerceInt(priceRaw, -1);
    if (price >= 0 && price <= PRICE_MAX) {
      if (price % 5 !== 0 && !priceFlagged) errors.push('Price must be a multiple of $5.');
    } else if (price > PRICE_MAX) errors.push('Price is too high.');
    else if (price < 0) errors.push('Price cannot be negative.');

    const ff = sstr(entry.form_factor), conn = sstr(entry.connector);
    if (!ff) errors.push('Choose a form factor.');
    else if (FORM_FACTORS.indexOf(ff) < 0) errors.push("Unknown form factor '" + ff + "'.");
    if (!conn) errors.push('Choose a connector.');
    else if (CONNECTORS_ALL.indexOf(conn) < 0) errors.push("Unknown connector '" + conn + "'.");
    else if (ff && FORM_CONNECTOR_MAP[ff] && FORM_CONNECTOR_MAP[ff].indexOf(conn) < 0) {
      errors.push("'" + conn + "' doesn't fit '" + ff + "'.");
    }
    if (ENFORCE_TWS_ZERO_SPECS && ff === TWS_FORM_FACTOR) {
      [['impedance', 'Impedance'], ['sensitivity', 'Sensitivity']].forEach(p => {
        if (coerceInt(entry[p[0]] === undefined ? 0 : entry[p[0]], -1) !== 0) {
          errors.push(p[1] + ' must be 0 for wireless.');
        }
      });
    }

    const dt = sstr(entry.driver_type), dc = sstr(entry.driver_config);
    if (dt && ALLOWED_DRIVER_TYPES.indexOf(dt) < 0) errors.push("Unknown driver type '" + dt + "'.");
    if (dc && /\s/.test(dc)) errors.push("Driver config can't contain spaces.");
    if (dt && !dc) errors.push('Driver type needs a config.');
    if (dc && !dt) {
      if (Object.keys(parseDriverConfig(dc)).length) errors.push('Driver config needs a type.');
    }
    if (dc) {
      const unknown = driverConfigUnknownTokens(dc);
      if (unknown.length) errors.push('Unknown driver token(s): ' + unknown.join(', ') + '.');
      const parsed = parseDriverConfig(dc);
      if (Object.keys(parsed).length) {
        const exp = classifyDriver(parsed);
        if (exp[0] !== dt) errors.push("Driver type should be '" + exp[0] + "'.");
      }
    }
    [['impedance', 'Impedance'], ['sensitivity', 'Sensitivity']].forEach(p => {
      const raw = entry[p[0]] === undefined ? 0 : entry[p[0]];
      if (typeof raw === 'string' && raw.indexOf('.') >= 0) errors.push(p[1] + ' must be a whole number.');
      const v = coerceInt(raw, -1);
      const fv = pyFloatAny(raw);
      if (fv === null) { errors.push(p[1] + ' must be a whole number.'); return; }
      if (!isFinite(fv)) { errors.push(p[1] + ' must be a finite number.'); return; }
      if (v < 0) errors.push(p[1] + ' cannot be negative.');
    });

    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    if (tags.length !== new Set(tags.map(String)).size) errors.push('Duplicate tag(s): ' + countDup(tags).join(', '));
    const unapproved = tags.filter(t => APPROVED_TAGS.indexOf(t) < 0);
    if (unapproved.length) errors.push('Unapproved tag(s): ' + joinTags(unapproved));
    if (tags.length < MIN_TAGS) errors.push('Needs ' + MIN_TAGS + '+ tags (has ' + tags.length + ').');
    if (tags.length > MAX_TAGS) errors.push('Max ' + MAX_TAGS + ' tags (has ' + tags.length + ').');
    tagConflicts(new Set(tags.map(String))).forEach(pair => {
      const c = 'Conflicting tags: ' + pair.join(' + ');
      const r = tagConflictResolution(pair);
      errors.push(c);
    });
    const tiers = tags.filter(t => PRICE_TIER_TAGS.indexOf(t) >= 0);
    if (tiers.length !== 1) errors.push('Needs exactly one price-tier tag.');
    else {
      const expected = priceTierFor(priceTierBasis(entry.price_usd === undefined ? 0 : entry.price_usd));
      if (tiers[0] !== expected) {
        errors.push("Tier tag should be '" + expected + "'.");
      }
    }
    return errors;
  }

  // ------------------------------------------------------------ clean entry
  function buildCleanEntry(source, notes, where) {
    const note = msg => { if (notes) notes.push((where ? where + ': ' : '') + msg); };
    const label = f => f + " ('" + (source.id || source.model || '?') + "')";
    Object.keys(source).forEach(key => {
      if (SCHEMA_FIELDS.indexOf(key) >= 0 || key.charAt(0) === '_') return;
      let hint = '';
      const low = key.trim().toLowerCase();
      let best = null, bestR = 0.7;
      SCHEMA_FIELDS.forEach(f => { const r = seqRatio(low, f); if (r >= bestR) { bestR = r; best = f; } });
      if (best) hint = " (did you mean '" + best + "'?)";
      else if (SCHEMA_FIELDS.indexOf(low.replace(/[ -]/g, '_')) >= 0) hint = " (did you mean '" + low.replace(/[ -]/g, '_') + "'?)";
      note("unknown field '" + key + "' is not in the schema and was discarded" + hint + '.');
    });
    const out = {};
    SCHEMA_FIELDS.forEach(f => {
      let val = source[f] === undefined ? BLANK_ENTRY[f] : source[f];
      if (SCHEMA_INT_FIELDS.indexOf(f) >= 0) {
        const orig = val;
        if (typeof val === 'number' && !isFinite(val)) { note(label(f) + ' value ' + orig + ' (non-finite) reset to 0.'); val = 0; }
        else if (typeof val === 'string') {
          const sval = val.trim();
          if (sval === '') val = 0;
          else if (sval.indexOf('_') >= 0) { note(label(f) + " value '" + orig + "' contains underscores (not allowed); reset to 0."); val = 0; }
          else if (!/^[+-]?\d+$/.test(sval) && sval.indexOf('.') >= 0) {
            const fv = pyFloat(sval.replace(/,/g, '.'));
            if (fv !== null && isFinite(fv)) { val = coerceInt(fv, 0); note(label(f) + " value '" + orig + "' coerced to " + val + '.'); }
            else { note(label(f) + " value '" + orig + "' is not numeric; reset to 0."); val = 0; }
          } else {
            val = coerceInt(sval, 0);
            if (String(val) !== sval) note(label(f) + " value '" + orig + "' coerced to " + val + '.');
          }
        } else if (typeof val === 'boolean') { val = val ? 1 : 0; note(label(f) + ' boolean coerced to ' + val + '.'); }
        else if (!Number.isInteger(val)) {
          const nw = coerceInt(val, 0);
          if (nw === 0 && !(val === 0 || val === '0')) note(label(f) + " value '" + orig + "' is not numeric; reset to 0.");
          else if (typeof orig === 'number' && !Number.isInteger(orig)) note(label(f) + ' value ' + orig + ' coerced to ' + nw + '.');
          val = nw;
        }
      } else if (SCHEMA_STR_FIELDS.indexOf(f) >= 0) {
        if (val === null || val === undefined) val = '';
        else if (typeof val === 'object') { note(label(f) + ' structured value flattened to text.'); val = String(val).trim(); }
        else val = String(val).trim();
      } else if (SCHEMA_LIST_FIELDS.indexOf(f) >= 0) {
        if (!Array.isArray(val)) {
          if (!(val === null || val === '' || (isObj(val) && !Object.keys(val).length))) note(label(f) + ' was ' + typeof val + ' (not a list); reset to [].');
          val = [];
        } else {
          const cl = [];
          val.forEach(x => {
            if (x === null || x === undefined) return;
            if (typeof x === 'object') { note(label(f) + ' item ' + JSON.stringify(x).slice(0, 40) + ' dropped (structured value).'); return; }
            const s = String(x).trim();
            if (s) cl.push(s);
          });
          val = cl;
        }
      }
      out[f] = val;
    });
    return out;
  }

  function sortKey(e) { return [str(e.brand).toLowerCase(), str(e.model).toLowerCase(), str(e.variant).toLowerCase()]; }
  function cmpEntries(a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    for (let i = 0; i < 3; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
    return 0;
  }
  function formatEntryLabel(e) {
    let label = [str(e.brand), str(e.model)].filter(Boolean).join(' ').trim();
    const v = sstr(e.variant);
    if (v) label = label ? label + '  [' + v + ']' : v;
    return label || str(e.id) || '(unnamed entry)';
  }
  function describeEntryChange(before, after, maxFields) {
    maxFields = maxFields || 3;
    if (!before && !after) return '';
    if (!before) return 'created';
    if (!after) return 'removed';
    const parts = [];
    for (let i = 0; i < SCHEMA_FIELDS.length; i++) {
      const f = SCHEMA_FIELDS[i];
      if (f === 'id') continue;
      const b = before[f], a = after[f];
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      const cap = f.charAt(0).toUpperCase() + f.slice(1);
      if (Array.isArray(b) || Array.isArray(a)) parts.push(cap + ': ' + (b || []).length + ' -> ' + (a || []).length + ' item(s)');
      else if (f === 'price_usd') parts.push('Price: $' + b + ' -> $' + a);
      else if (SCHEMA_INT_FIELDS.indexOf(f) >= 0) parts.push(cap + ': ' + b + ' -> ' + a);
      else parts.push(cap + ": '" + b + "' -> '" + a + "'");
      if (parts.length >= maxFields) {
        let remaining = 0;
        SCHEMA_FIELDS.slice(i + 1).forEach(g => { if (g !== 'id' && JSON.stringify(before[g]) !== JSON.stringify(after[g])) remaining++; });
        if (remaining) parts.push('(+' + remaining + ' more)');
        break;
      }
    }
    return parts.join('; ');
  }

  // ----------------------------------------------------------- load / save
  function loadDatabaseText(text) {
    // Returns { entries, notes } or throws Error with a friendly message.
    let raw = String(text).replace(/^\uFEFF/, '');
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error('Invalid JSON: ' + (e && e.message ? e.message : e)); }
    if (!Array.isArray(data)) throw new Error('The database must be a JSON array.');
    const entries = [], notes = [];
    data.forEach((item, i) => {
      const where = 'Entry #' + i;
      if (!isObj(item)) { notes.push(i + ' was not a JSON object and was skipped.'); return; }
      const extra = Object.keys(item).filter(k => SCHEMA_FIELDS.indexOf(k) < 0);
      if (extra.length) notes.push(i + ' had extra field(s) ' + extra.sort().join(', ') + ' - they will be dropped on save.');
      entries.push(buildCleanEntry(item, notes, where));
    });
    return { entries: entries, notes: notes };
  }
  function serializeCanonical(entries) {
    const ordered = entries.slice().sort(cmpEntries).map(e => buildCleanEntry(e));
    return JSON.stringify(ordered, null, 2) + '\n';
  }

  // Token-budgeted splitter (chars/4), identical output layout to the Python tool.
  function splitIntoChunks(entries, maxTokens, baseName) {
    maxTokens = maxTokens || 50000;
    baseName = baseName || 'database';
    const src = entries.slice().sort(cmpEntries).map(e => buildCleanEntry(e));
    const chunks = [];
    let cur = [], curJson = [], curTok = 0, n = 1;
    const indent = s => s.split('\n').map(l => (l ? '  ' + l : l)).join('\n');
    const flush = () => {
      if (!cur.length) return;
      chunks.push({ name: baseName + '_chunk_' + n + '.json', count: cur.length, tokens: curTok,
        text: '[\n' + curJson.map(indent).join(',\n') + '\n]\n' });
      n++; cur = []; curJson = []; curTok = 0;
    };
    src.forEach(item => {
      const j = JSON.stringify(item, null, 2);
      const t = Math.max(1, Math.floor(j.length / 4));
      if (cur.length && curTok + t > maxTokens) flush();
      cur.push(item); curJson.push(j); curTok += t;
    });
    flush();
    return chunks;
  }

  // ======================================================== SequenceMatcher
  // Port of difflib.SequenceMatcher(None, a, b).ratio().
  function seqRatio(a, b) {
    const la = a.length, lb = b.length;
    if (la + lb === 0) return 1;
    const b2j = new Map();
    for (let i = 0; i < lb; i++) {
      const ch = b[i];
      if (!b2j.has(ch)) b2j.set(ch, []);
      b2j.get(ch).push(i);
    }
    if (lb >= 200) {
      const ntest = Math.floor(lb / 100) + 1;
      Array.from(b2j.entries()).forEach(kv => { if (kv[1].length > ntest) b2j.delete(kv[0]); });
    }
    function findLongest(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nj2len = new Map();
        const js = b2j.get(a[i]) || [];
        for (let q = 0; q < js.length; q++) {
          const j = js[q];
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          nj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = nj2len;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
      while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
      return [besti, bestj, bestsize];
    }
    let matches = 0;
    const queue = [[0, la, 0, lb]];
    while (queue.length) {
      const q = queue.pop();
      const m = findLongest(q[0], q[1], q[2], q[3]);
      const i = m[0], j = m[1], k = m[2];
      if (k) {
        matches += k;
        if (q[0] < i && q[2] < j) queue.push([q[0], i, q[2], j]);
        if (i + k < q[1] && j + k < q[3]) queue.push([i + k, q[1], j + k, q[3]]);
      }
    }
    return 2 * matches / (la + lb);
  }

  // ============================================================== AUDIT
  const GEN_TOKENS = { '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
    'ii': '2', 'iii': '3', 'iv': '4', 'vi': '6', 'mk2': 'mk2', 'mk3': 'mk3', 'mk4': 'mk4', 'dsp': 'dsp' };
  const DUP_MIN_RATIO = 0.84;
  const DUP_PAIR_CAP_PER_FILE = 50;
  const MODEL_NUM_RE = /^([a-z]*)(\d{1,5})([a-z]*)$/;

  function makeIssue(category, entryIndex, entryId, message, opts) {
    opts = opts || {};
    return {
      category: category, entryIndex: entryIndex, entryId: entryId, message: message,
      fix: opts.fix || null, severity: opts.severity || 'warning',
      code: opts.code || category.toLowerCase().replace(/ /g, '-'),
      subject: opts.subject !== undefined ? opts.subject : entryId,
      waiverKey: null
    };
  }
  function waiverKeyOf(issue) { return issue.subject + '|' + issue.category + '|' + issue.code; }

  function dupNormName(e) {
    const text = [str(e.model), str(e.variant)].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return text.split(/\s+/).filter(Boolean).map(t => (GEN_TOKENS[t] !== undefined ? GEN_TOKENS[t] : t)).join(' ');
  }
  function dupSpecsMatch(a, b) {
    let same = 0;
    ['year', 'price_usd', 'driver_config'].forEach(f => {
      const va = a[f], vb = b[f];
      const missing = v => v === null || v === undefined || v === '' || v === 0 || String(v).trim() === '';
      if (missing(va) || missing(vb)) return;
      const ia = /^[+-]?\d+$/.test(String(va)) ? parseInt(String(va), 10) : null;
      const ib = /^[+-]?\d+$/.test(String(vb)) ? parseInt(String(vb), 10) : null;
      if (ia !== null && ib !== null) { if (ia === ib) same++; }
      else if (String(va) === String(vb)) same++;
    });
    return same;
  }
  function modelNumberSiblings(x, y) {
    const mx = MODEL_NUM_RE.exec(x), my = MODEL_NUM_RE.exec(y);
    if (!mx || !my) return false;
    return mx[1] === my[1] && mx[3] === my[3] && mx[2] !== my[2];
  }
  function dupPrefixPair(na, nb) {
    if (na === nb) return null;
    if (nb.startsWith(na + ' ')) return [na, nb, nb.slice(na.length).trim()];
    if (na.startsWith(nb + ' ')) return [nb, na, na.slice(nb.length).trim()];
    return null;
  }
  function setOf(s) { return new Set(s.split(' ').filter(Boolean)); }
  function isSubset(a, b) { for (const x of a) if (!b.has(x)) return false; return true; }
  function allDigits(s) { return /^\d+$/.test(s); }

  function findDuplicatePairs(entries, referencedMap) {
    referencedMap = referencedMap || new Map();
    const issues = [];
    if (entries.length < 2) return issues;
    const seenPairs = new Set();
    const pending = [];
    const RANK = { high: 0, medium: 1, low: 2 };
    const emit = (ia, ib, confidence, reasons) => {
      const key = Math.min(ia, ib) + ',' + Math.max(ia, ib);
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      pending.push([RANK[confidence] !== undefined ? RANK[confidence] : 3, ia, ib, confidence, reasons.slice()]);
    };
    const sharedBoost = new Set();
    let sharedEmitted = 0;
    const overflow = [];
    referencedMap.forEach((idxs, rel) => {
      const uniq = Array.from(new Set(idxs)).sort((a, b) => a - b);
      if (uniq.length < 2) return;
      const pc = uniq.length * (uniq.length - 1) / 2;
      if (sharedEmitted + pc > DUP_PAIR_CAP_PER_FILE) { overflow.push([rel, uniq.length]); return; }
      sharedEmitted += pc;
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
        sharedBoost.add(uniq[i] + ',' + uniq[j]);
        emit(uniq[i], uniq[j], 'high', ['share a measurement file']);
      }
    });
    overflow.forEach(o => pending.push([0, -1, -1, 'high', ['mass-link', o[1] + " entries share '" + o[0] + "'"]]));

    const byBrand = new Map();
    entries.forEach((e, idx) => {
      const b = sstr(e.brand).toLowerCase();
      if (!byBrand.has(b)) byBrand.set(b, []);
      byBrand.get(b).push(idx);
    });
    byBrand.forEach((idxs, brand) => {
      if (!brand || idxs.length < 2) return;
      const info = new Map();
      idxs.forEach(i => { let na = ''; try { na = dupNormName(entries[i]); } catch (e) { na = ''; } info.set(i, [na, na.length, setOf(na)]); });
      for (let ii = 0; ii < idxs.length; ii++) for (let jj = ii + 1; jj < idxs.length; jj++) {
        const ia = idxs[ii], ib = idxs[jj];
        if (seenPairs.has(Math.min(ia, ib) + ',' + Math.max(ia, ib))) continue;
        const na = info.get(ia)[0], nb = info.get(ib)[0];
        if (!na || !nb) continue;
        const a = entries[ia], b = entries[ib];
        const reasons = [];
        let confidence = null;
        const prefix = dupPrefixPair(na, nb);
        if (prefix !== null) {
          const restTokens = setOf(prefix[2]);
          if (restTokens.size && (Array.from(restTokens).every(t => GEN_TOKENS[t] !== undefined) || Array.from(restTokens).every(allDigits))) continue;
        }
        const ta = info.get(ia)[2], tb = info.get(ib)[2];
        let same = ta.size === tb.size;
        if (same) for (const x of ta) if (!tb.has(x)) { same = false; break; }
        if (!same) {
          const da = Array.from(ta).filter(x => !tb.has(x));
          const dbb = Array.from(tb).filter(x => !ta.has(x));
          if (da.length === 1 && dbb.length === 1 && modelNumberSiblings(da[0], dbb[0])) continue;
        }
        const la = info.get(ia)[1], lb = info.get(ib)[1];
        if (2 * Math.min(la, lb) / (la + lb) < DUP_MIN_RATIO && prefix === null) continue;
        let p = 0;
        const mlen = Math.min(na.length, nb.length);
        while (p < mlen && na[p] === nb[p]) p++;
        if (p >= 3) {
          const sa = na.slice(p), sb = nb.slice(p);
          if ((allDigits(sa) || !sa) && (allDigits(sb) || !sb) && (sa || sb) && sa !== sb) continue;
        } else {
          let shared = false;
          for (const x of ta) if (tb.has(x)) { shared = true; break; }
          if (!shared) { if (Math.abs(la - lb) > 2 || p < 2) continue; }
        }
        const ratio = seqRatio(na, nb);
        if (ratio >= DUP_MIN_RATIO) {
          confidence = ratio >= 0.93 ? 'high' : 'medium';
          reasons.push('very similar names (' + Math.round(ratio * 100) + '% alike)');
        } else if (prefix !== null) {
          confidence = 'low';
          reasons.push('one name extends the other');
        }
        if (confidence === null) continue;
        const specN = dupSpecsMatch(a, b);
        const sharesFiles = sharedBoost.has(ia + ',' + ib) || sharedBoost.has(ib + ',' + ia);
        const similarNames = (confidence === 'medium' || confidence === 'high') && reasons.some(r => r.indexOf('alike') >= 0);
        if (sharesFiles) { confidence = 'high'; reasons.push('they share a measurement file'); }
        else if (similarNames && specN === 3) confidence = 'high';
        else if (confidence === 'high') { confidence = 'medium'; reasons.push('specs differ'); }
        emit(ia, ib, confidence, reasons);
      }
    });
    pending.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]));
    pending.forEach(p => {
      const ia = p[1], ib = p[2], confidence = p[3], reasons = p[4];
      if (ia < 0 || ib < 0) {
        const detail = reasons.length > 1 ? reasons[1] : reasons.join('; ');
        issues.push(makeIssue('Possible Duplicate', -1, '(summary)',
          'Many entries share one file: ' + detail + '.',
          { severity: 'warning', code: 'dup-masslink', subject: 'dup|mass|' + detail.slice(0, 80) }));
        return;
      }
      const a = entries[ia], b = entries[ib];
      const idA = a.id || 'entry #' + ia, idB = b.id || 'entry #' + ib;
      const msg = 'Possible duplicate (' + confidence + "): '" + idA + "' + '" + idB + "' · " + reasons.join('; ') + '.';
      const iss = makeIssue('Possible Duplicate', ia, idA, msg,
        { severity: 'warning', code: 'dup-pair', subject: 'dup|' + [idA, idB].sort().join('|') });
      iss.pairIds = [idA, idB];
      iss.confidence = confidence;
      issues.push(iss);
    });
    return issues;
  }

  function entryIdent(e) { return [sstr(e.brand), sstr(e.model), sstr(e.variant)].join('\u0000'); }
  function snapshotEntry(e) {
    const o = {};
    Object.keys(e).forEach(k => { o[k] = Array.isArray(e[k]) ? e[k].slice() : e[k]; });
    return o;
  }
  // Compare file paths the way a person would: ignore case AND Unicode form. "Ü" can be one
  // code point (NFC, Windows/Linux) or U + a combining mark (NFD, macOS); the two look
  // identical but never compare equal, which would report a present file as missing.
  function foldPath(p) { return String(p).normalize('NFC').toLowerCase(); }
  // Some zip tools save "Ü" as the literal text "#U00dc" (an unzip escape for a non-UTF-8 name).
  // The file then exists on disk under a name no entry links to, while the real name is missing.
  const HASH_U = /#U([0-9a-fA-F]{4})/g;
  function decodeHashU(p) { return String(p).replace(HASH_U, (m, h) => String.fromCharCode(parseInt(h, 16))); }
  function encodeHashU(p) { return Array.from(String(p)).map(c => { const cp = c.codePointAt(0); return cp > 127 && cp <= 0xFFFF ? '#U' + cp.toString(16).padStart(4, '0') : c; }).join(''); }
  function normRelPath(rel) {
    let norm = rel.replace(/\\/g, '/');
    norm = norm.trim().replace(/\/+/g, '/');
    while (norm.startsWith('./')) norm = norm.slice(2);
    norm = norm.replace(/\/\.\//g, '/');
    return norm;
  }

  /**
   * runFullAudit(entries, diskFiles)
   *   entries   - the working list (objects are mutated by fixes)
   *   diskFiles - array of posix paths ("data/FOLDER/NAME.txt") present in the
   *               data folder, or null when the data folder can't be listed
   *               (then Missing File / Unlinked File / Path Casing are skipped).
   */
  function runFullAudit(entries, diskFiles, opts) {
    opts = opts || {};
    const issues = [];
    const seenIds = new Map();
    let onDiskSet = null, diskIndex = null;

    function resolveTarget(list, targetObj, eid, frozenIdx, ident) {
      if (targetObj) { const p = list.indexOf(targetObj); if (p >= 0) return p; }
      const tid = eid && eid !== '-' && !String(eid).startsWith('(no id)') ? eid : null;
      if (tid) {
        const hits = [];
        list.forEach((e, p) => { if (e.id === tid) hits.push(p); });
        if (hits.length > 1) return -1;
        if (hits.length === 1) {
          if (ident !== null && entryIdent(list[hits[0]]) !== ident) return -1;
          return hits[0];
        }
      }
      if (frozenIdx >= 0 && frozenIdx < list.length && !list[frozenIdx].id) {
        if (ident !== null && entryIdent(list[frozenIdx]) !== ident) return -1;
        return frozenIdx;
      }
      return -1;
    }
    function makeFix(targetObj, eid, frozenIdx, mutator) {
      const ident = targetObj ? entryIdent(targetObj) : null;
      return function fix(list) {
        const p = resolveTarget(list, targetObj, eid, frozenIdx, ident);
        if (p < 0) return null;
        const entry = list[p];
        const pre = snapshotEntry(entry);
        const idBefore = pre.id;
        mutator(entry);
        if (entry.id !== idBefore) {
          for (let q = 0; q < list.length; q++) {
            if (q !== p && list[q].id === entry.id) {
              Object.keys(entry).forEach(k => delete entry[k]);
              Object.assign(entry, pre);
              return null;
            }
          }
        }
        return p;
      };
    }

    const referencedMap = new Map();
    entries.forEach((entry, idx) => {
      (entry.files || []).forEach(rel => {
        if (typeof rel !== 'string') return;
        const norm = normRelPath(rel);
        if (norm) { if (!referencedMap.has(norm)) referencedMap.set(norm, []); referencedMap.get(norm).push(idx); }
      });
    });
    if (Array.isArray(diskFiles)) {
      onDiskSet = new Set(diskFiles);
      diskIndex = new Map();
      diskFiles.forEach(p => diskIndex.set(foldPath(p), p));
    }
    const brandFixes = brandSpellingFixes(entries);

    entries.forEach((entry, idx) => {
      const eid = entry.id || '(no id) #' + idx;
      const realId = entry.id || '';
      if (realId) {
        if (seenIds.has(realId)) {
          issues.push(makeIssue('Duplicate ID', idx, eid, "Duplicate id '" + realId + "' also used by entry #" + seenIds.get(realId) + '.',
            { severity: 'error', subject: realId + '@' + idx }));
        } else seenIds.set(realId, idx);
      }
      const expectedId = buildId(entry.brand || '', entry.model || '', entry.variant || '');
      if (expectedId && entry.id !== expectedId) {
        const cur = entry.id || '';
        const lt = cur.startsWith('_') || cur.endsWith('_');
        const msg = "ID should be '" + expectedId + "'.";
        issues.push(makeIssue('ID Format', idx, eid, msg,
          { fix: makeFix(entry, realId || eid, idx, en => { en.id = expectedId; }) }));
      }
      [['brand', entry.brand], ['model', entry.model], ['variant', entry.variant]].forEach(p => {
        const val = sstr(p[1]);
        if (val && !normalizeComponent(val)) {
          issues.push(makeIssue('ID Format', idx, eid,
            p[0].charAt(0).toUpperCase() + p[0].slice(1) + " '" + val + "' has no Latin spelling, so the ID uses a hash.",
            { severity: 'warning', code: 'id-nonlatin' }));
        }
      });
      if (brandFixes.has(idx)) {
        const bf = brandFixes.get(idx);
        const current = bf[0], canonical = bf[1], summary = bf[2], hasMajority = bf[3];
        const mut = en => {
          en.brand = canonical;
          const nid = buildId(canonical, en.model || '', en.variant || '');
          if (nid) en.id = nid;
        };
        let msg, fix = null;
        if (hasMajority) {
          msg = "Brand '" + current + "' → '" + canonical + "' (" + summary + ').';
          fix = makeFix(entry, realId || eid, idx, mut);
        } else {
          msg = 'Brand spelled inconsistently (' + summary + '). Edit by hand.';
        }
        issues.push(makeIssue('Brand Spelling', idx, eid, msg, { fix: fix, severity: 'warning', code: 'brand-spelling' }));
      }

      const dc = entry.driver_config || '';
      if (dc && /\s/.test(dc)) {
        const dcp = parseDriverConfig(dc);
        const fixedDc = Object.keys(dcp).length ? classifyDriver(dcp)[1] : dc.replace(/\s+/g, '');
        issues.push(makeIssue('Driver Config', idx, eid,
          "Driver config '" + dc + "' has spaces" + (fixedDc === dc.replace(/\s+/g, '') ? '' : ' and wrong order') + '.',
          { fix: makeFix(entry, realId || eid, idx, en => { en.driver_config = fixedDc; }), code: 'dc-whitespace' }));
      }
      const parsed = parseDriverConfig(entry.driver_config || '');
      const dt = sstr(entry.driver_type);
      const dcStripped = sstr(entry.driver_config);
      const unknownTokens = dcStripped ? driverConfigUnknownTokens(dcStripped) : [];
      if (unknownTokens.length) {
        const cleanCfg = Object.keys(parsed).length ? classifyDriver(parsed)[1] : '';
        issues.push(makeIssue('Driver Config', idx, eid,
          'Unknown driver token(s): ' + unknownTokens.join(', ') + " → '" + cleanCfg + "'.",
          { fix: makeFix(entry, realId || eid, idx, en => { en.driver_config = cleanCfg; }), severity: 'warning', code: 'dc-unknown' }));
      }
      if (dt && !dcStripped) {
        issues.push(makeIssue('Driver Type', idx, eid, "Driver type '" + dt + "' has no config.",
          { fix: makeFix(entry, realId || eid, idx, en => { en.driver_type = ''; }), severity: 'error', code: 'dt-no-config' }));
      } else if (dcStripped && !dt) {
        if (Object.keys(parsed).length) {
          const et = classifyDriver(parsed)[0];
          issues.push(makeIssue('Driver Type', idx, eid, "Driver type should be '" + et + "'.",
            { fix: makeFix(entry, realId || eid, idx, en => { en.driver_type = et; }), severity: 'error', code: 'dt-no-type' }));
        }
      } else if (Object.keys(parsed).length) {
        const cl = classifyDriver(parsed);
        const et = cl[0], ec = cl[1];
        if (dt !== et) {
          issues.push(makeIssue('Driver Type', idx, eid, "Driver type '" + dt + "' → should be '" + et + "'.",
            { fix: makeFix(entry, realId || eid, idx, en => { en.driver_type = et; }), code: 'dt-mismatch' }));
        }
        const tight = dcStripped.replace(/\s+/g, '');
        if (CANONICALIZE_DRIVER_ORDER && tight !== ec) {
          issues.push(makeIssue('Driver Config', idx, eid, "Driver config order: use '" + ec + "'.",
            { fix: makeFix(entry, realId || eid, idx, en => { en.driver_config = ec; }), severity: 'info', code: 'dc-order' }));
        }
      }

      const ff = sstr(entry.form_factor), conn = sstr(entry.connector);
      if (!ff) issues.push(makeIssue('Form/Connector Mismatch', idx, eid, 'Form factor missing.', { severity: 'error', code: 'ff-missing' }));
      else if (FORM_FACTORS.indexOf(ff) < 0) issues.push(makeIssue('Form/Connector Mismatch', idx, eid, "Unknown form factor '" + ff + "'.", { severity: 'error', code: 'ff-invalid' }));
      if (!conn) issues.push(makeIssue('Form/Connector Mismatch', idx, eid, 'Connector missing.', { severity: 'error', code: 'conn-missing' }));
      else if (CONNECTORS_ALL.indexOf(conn) < 0) issues.push(makeIssue('Form/Connector Mismatch', idx, eid, "Unknown connector '" + conn + "'.", { severity: 'error', code: 'conn-invalid' }));
      if (FORM_CONNECTOR_MAP[ff] && CONNECTORS_ALL.indexOf(conn) >= 0 && FORM_CONNECTOR_MAP[ff].indexOf(conn) < 0) {
        issues.push(makeIssue('Form/Connector Mismatch', idx, eid, "'" + conn + "' doesn't fit '" + ff + "'.", { severity: 'error', code: 'conn-matrix' }));
      }
      if (ENFORCE_TWS_ZERO_SPECS && ff === TWS_FORM_FACTOR) {
        const iv = coerceInt(entry.impedance === undefined ? 0 : entry.impedance, -1), sv = coerceInt(entry.sensitivity === undefined ? 0 : entry.sensitivity, -1);
        if (iv !== 0 || sv !== 0) issues.push(makeIssue('TWS Specs', idx, eid, 'Wireless: impedance/sensitivity should be 0.',
          { fix: makeFix(entry, realId || eid, idx, en => { en.impedance = 0; en.sensitivity = 0; }), severity: 'error' }));
      }

      [['impedance', 'Impedance'], ['sensitivity', 'Sensitivity']].forEach(p => {
        const field = p[0], label = p[1];
        const raw = entry[field] === undefined ? 0 : entry[field];
        const fv = pyFloatAny(raw);
        const finite = fv !== null && isFinite(fv);
        if (!finite) {
          issues.push(makeIssue('Spec Sanity', idx, eid, label + ' is not a number.',
            { fix: makeFix(entry, realId || eid, idx, en => { en[field] = 0; }), severity: 'error', code: 'spec-nan' }));
          return;
        }
        if (fv < 0) {
          issues.push(makeIssue('Spec Sanity', idx, eid, label + ' is negative.',
            { fix: makeFix(entry, realId || eid, idx, en => { en[field] = 0; }), severity: 'error', code: 'spec-negative' }));
        } else if (fv !== Math.trunc(fv)) {
          const rounded = Math.floor(fv + 0.5);
          issues.push(makeIssue('Spec Sanity', idx, eid, label + ' must be whole (' + rounded + ').',
            { fix: makeFix(entry, realId || eid, idx, en => { en[field] = rounded; }), severity: 'warning', code: 'spec-float' }));
        } else if (field === 'impedance') {
          const isEst = sstr(entry.connector) === 'Electrostatic' || sstr(entry.driver_type) === 'EST';
          const cap = isEst ? IMPEDANCE_MAX_ELECTROSTATIC : IMPEDANCE_MAX;
          if (fv > cap) issues.push(makeIssue('Spec Sanity', idx, eid, label + ' ' + Math.trunc(fv) + ' looks too high.', { severity: 'warning', code: 'spec-range' }));
        } else if (fv > SENSITIVITY_MAX) {
          issues.push(makeIssue('Spec Sanity', idx, eid, label + ' ' + Math.trunc(fv) + ' looks too high.', { severity: 'warning', code: 'spec-range' }));
        }
      });

      const files = entry.files || [];
      if (diskIndex && diskIndex.size) {
        const fixedPaths = [];
        files.forEach((rel, pos) => {
          const actual = typeof rel === 'string' ? diskIndex.get(foldPath(rel)) : null;
          if (actual && actual !== rel) fixedPaths.push([pos, rel, actual]);
        });
        if (fixedPaths.length) {
          const mut = en => {
            const lst = en.files || [];
            fixedPaths.forEach(u => { if (u[0] >= 0 && u[0] < lst.length && foldPath(lst[u[0]]) === foldPath(u[2])) lst[u[0]] = u[2]; });
          };
          const shown = fixedPaths.slice(0, 2).map(u => "'" + u[1] + "'->'" + u[2] + "'").join(', ');
          issues.push(makeIssue('Path Casing', idx, eid, 'Path spelling differs from disk: ' + shown + '.',
            { fix: makeFix(entry, realId || eid, idx, mut), severity: 'warning' }));
        }
      }

      const price = entry.price_usd === undefined ? 0 : entry.price_usd;
      const tierBasis = priceTierBasis(price);
      const expectedTier = priceTierFor(tierBasis);
      const tags = entry.tags || [];
      const presentTiers = tags.filter(t => PRICE_TIER_TAGS.indexOf(t) >= 0);
      const tierMut = en => {
        const out = [];
        let placed = false;
        (en.tags || []).forEach(t => {
          if (PRICE_TIER_TAGS.indexOf(t) >= 0) { if (!placed) { out.push(expectedTier); placed = true; } }
          else out.push(t);
        });
        if (!placed) out.push(expectedTier);
        en.tags = out;
      };
      if (!(presentTiers.length === 1 && presentTiers[0] === expectedTier)) {
        issues.push(makeIssue('Price Tier Tag', idx, eid,
          "Tier tag should be '" + expectedTier + "' for $" + tierBasis + '.',
          { fix: makeFix(entry, realId || eid, idx, tierMut) }));
      }
      const pInt = coerceInt(price, null);
      const pBad = pInt === null || (typeof price === 'number' && !isFinite(price));
      if (pBad) issues.push(makeIssue('Price Rounding', idx, eid, 'Price is not a number.', { severity: 'error', code: 'price-invalid' }));
      else if (pInt < 0) issues.push(makeIssue('Price Rounding', idx, eid, 'Price is negative.', { severity: 'error', code: 'price-negative' }));
      else if (pInt % 5 !== 0) {
        const rounded = roundPriceTo5(pInt);
        issues.push(makeIssue('Price Rounding', idx, eid, 'Price $' + pInt + ' → $' + rounded + '.',
          { fix: makeFix(entry, realId || eid, idx, en => { en.price_usd = rounded; }), code: 'price-rounding' }));
      }
      if (!isValidYear(entry.year === undefined ? 0 : entry.year)) {
        issues.push(makeIssue('Year', idx, eid, 'Year is invalid.', { severity: 'error' }));
      }
      if (!sstr(entry.brand)) issues.push(makeIssue('Missing Field', idx, eid, 'Brand is empty.', { severity: 'error', code: 'brand-missing' }));
      if (!sstr(entry.model)) issues.push(makeIssue('Missing Field', idx, eid, 'Model is empty.', { severity: 'error', code: 'model-missing' }));
      if (WARN_ZERO_YEAR && coerceInt(entry.year === undefined ? 0 : entry.year) === 0) issues.push(makeIssue('Missing Data', idx, eid, 'Year unknown.', { severity: 'warning', code: 'year-unknown' }));
      if (WARN_ZERO_PRICE && coerceInt(price) === 0) issues.push(makeIssue('Missing Data', idx, eid, 'Price unknown.', { severity: 'warning', code: 'price-unknown' }));
      if (WARN_UNVERIFIED_DRIVERS && !sstr(entry.driver_type) && !sstr(entry.driver_config)) {
        issues.push(makeIssue('Missing Data', idx, eid, 'Drivers unknown.', { severity: 'warning', code: 'drivers-unknown' }));
      }
      if (WARN_ZERO_SPECS_NON_TWS && ff !== TWS_FORM_FACTOR && ff !== WIRELESS_OVER_EAR_FORM_FACTOR) {
        [['impedance', 'Impedance'], ['sensitivity', 'Sensitivity']].forEach(p => {
          if (coerceInt(entry[p[0]] === undefined ? 0 : entry[p[0]]) === 0) {
            issues.push(makeIssue('Missing Data', idx, eid, p[1] + ' unknown.',
              { severity: 'warning', code: p[0] === 'impedance' ? 'impedance-unknown' : 'sensitivity-unknown' }));
          }
        });
      }
      if (WARN_TWS_SPECS_NONZERO && ff === TWS_FORM_FACTOR && !ENFORCE_TWS_ZERO_SPECS) {
        const bad = [['impedance', 'Impedance'], ['sensitivity', 'Sensitivity']].filter(p => coerceInt(entry[p[0]] === undefined ? 0 : entry[p[0]], -1) !== 0).map(p => p[1]);
        if (bad.length) issues.push(makeIssue('Missing Data', idx, eid, bad.join(' & ') + ' should be 0 (wireless).', { severity: 'warning', code: 'tws-nonzero' }));
      }
      tagConflicts(new Set(tags.map(String))).forEach(pair => {
        const c = 'Conflicting tags: ' + pair.join(' + ');
        const r = tagConflictResolution(pair);
        issues.push(makeIssue('Tag Conflict', idx, eid, c, { severity: 'error' }));
      });
      if (tags.length < MIN_TAGS) issues.push(makeIssue('Tag Count', idx, eid, 'Only ' + tags.length + ' tags (min ' + MIN_TAGS + ').', { severity: 'error' }));
      if (tags.length > MAX_TAGS) issues.push(makeIssue('Tag Count', idx, eid, tags.length + ' tags (max ' + MAX_TAGS + ').', { severity: 'error' }));
      if (tags.length !== new Set(tags.map(String)).size) issues.push(makeIssue('Duplicate Tag', idx, eid, 'Duplicate tag(s): ' + countDup(tags).join(', '), { severity: 'error' }));
      const unapproved = tags.filter(t => APPROVED_TAGS.indexOf(t) < 0);
      if (unapproved.length) issues.push(makeIssue('Unapproved Tag', idx, eid, 'Unapproved tag(s): ' + joinTags(unapproved), { severity: 'error' }));

      if (files.length !== new Set(files.map(String)).size) issues.push(makeIssue('Duplicate File', idx, eid, 'Same file linked twice.', { severity: 'error' }));
      files.forEach((rel, pos) => {
        if (typeof rel !== 'string' || !rel.trim()) {
          const popBad = en => {
            const lst = en.files || [];
            if (pos >= 0 && pos < lst.length && lst[pos] === rel) lst.splice(pos, 1);
            else { const k = lst.indexOf(rel); if (k >= 0) lst.splice(k, 1); }
          };
          issues.push(makeIssue('File Path', idx, eid, 'Empty file path.',
            { fix: makeFix(entry, realId || eid, idx, popBad), severity: 'error', code: 'file-empty' }));
          return;
        }
        if (rel !== rel.trim()) {
          const stripPath = en => {
            const lst = en.files || [];
            if (pos >= 0 && pos < lst.length && lst[pos] === rel) lst[pos] = rel.trim();
            else { const k = lst.indexOf(rel); if (k >= 0) lst[k] = rel.trim(); }
          };
          issues.push(makeIssue('File Path', idx, eid, "Path has stray spaces: '" + rel + "'.",
            { fix: makeFix(entry, realId || eid, idx, stripPath), severity: 'error', code: 'file-ws' }));
        }
        if (rel.indexOf('\\') >= 0) {
          const slash = en => { en.files = (en.files || []).map(q => (q === rel ? q.replace(/\\/g, '/') : q)); };
          issues.push(makeIssue('File Path', idx, eid, "Path uses backslashes: '" + rel + "'.",
            { fix: makeFix(entry, realId || eid, idx, slash), severity: 'warning', code: 'file-backslash' }));
        }
        if (rel.split('/').indexOf('..') >= 0) issues.push(makeIssue('File Path', idx, eid, "Path contains '..': '" + rel + "'.", { severity: 'error', code: 'file-traversal' }));
      });
    });

    const noFiles = [];
    entries.forEach((e2, i) => { if (!(e2.files && e2.files.length)) noFiles.push(i); });
    if (noFiles.length) {
      const preview = noFiles.slice(0, 5).map(i => entries[i].id || '#' + i).join(', ');
      const more = noFiles.length > 5 ? ' ... (+' + (noFiles.length - 5) + ' more)' : '';
      issues.push(makeIssue('No Measurement Files', -1, '(summary)',
        noFiles.length + ' of ' + entries.length + (noFiles.length === 1 ? ' entry has' : ' entries have') + ' no measurement file.',
        { severity: noFiles.length <= NO_FILES_WARN_THRESHOLD ? 'warning' : 'info' }));
    }
    referencedMap.forEach((idxs, rel) => {
      if (idxs.length > 1) {
        const ids = idxs.map(i => entries[i].id || '#' + i);
        idxs.forEach(idx => {
          const eid = entries[idx].id || '(no id) #' + idx;
          issues.push(makeIssue('Duplicate File Link', idx, eid, "'" + rel.split('/').pop() + "' shared by: " + ids.join(', '), { severity: 'warning', subject: rel + '@' + idx }));
        });
      }
    });
    const foldMap = new Map();
    referencedMap.forEach((_v, rel) => { const f = foldPath(rel); if (!foldMap.has(f)) foldMap.set(f, []); foldMap.get(f).push(rel); });
    foldMap.forEach((variants, fold) => {
      if (variants.length < 2) return;
      const variantIdx = new Map();
      variants.forEach(rel => variantIdx.set(rel, referencedMap.get(rel)));
      const allIdx = Array.from(new Set([].concat.apply([], variants.map(r => referencedMap.get(r))))).sort((a, b) => a - b);
      if (allIdx.length < 2) return;
      allIdx.forEach(idx => {
        const eid = entries[idx].id || '(no id) #' + idx;
        const own = variants.filter(r => variantIdx.get(r).indexOf(idx) >= 0).sort();
        const others = variants.filter(r => own.indexOf(r) < 0);
        const parts = ["same-file spelling(s) here: '" + own.join(', ') + "'"];
        if (others.length) parts.push("elsewhere: '" + others.join(', ') + "'");
        issues.push(makeIssue('Duplicate File Link', idx, eid,
          'Same file linked with different spellings: ' + parts.join('; ') + '.',
          { severity: 'warning', code: 'duplicate-file-ci', subject: fold + '@' + idx }));
      });
    });
    if (onDiskSet !== null) {
      referencedMap.forEach((idxs, rel) => {
        if (!onDiskSet.has(rel) && !(diskIndex && diskIndex.has(foldPath(rel)))) {
          idxs.forEach(idx => {
            const eid = entries[idx].id || '(no id) #' + idx;
            const iss = makeIssue('Missing File', idx, eid, 'Missing: ' + rel, { severity: 'error' });
            const alt = diskIndex ? diskIndex.get(foldPath(encodeHashU(rel))) : null;
            if (alt && alt !== rel) { iss.repair = { from: alt, to: rel }; iss.message = 'Missing: ' + rel + ' · a copy with the accent saved as #U exists (Restore name).'; }
            issues.push(iss);
          });
        }
      });
      const referencedFold = new Set(Array.from(referencedMap.keys()).map(foldPath));
      const unlinked = diskFiles.filter(p => !referencedMap.has(p) && !referencedFold.has(foldPath(p))).sort();
      if (unlinked.length > UNLINKED_ROW_CAP) {
        issues.push(makeIssue('Unlinked File', -1, '(none)',
          unlinked.length + ' files on disk are not linked to any entry.', { severity: 'info' }));
      } else {
        unlinked.forEach(rel => {
          let msg = 'Not linked: ' + rel;
          if (/#U[0-9a-fA-F]{4}/.test(rel)) {
            const real = decodeHashU(rel);
            msg = (onDiskSet.has(real) || diskIndex.has(foldPath(real))) ? 'Junk copy of ' + real.split('/').pop() + ' (accent saved as #U). Safe to delete.' : 'Name has #U accent escapes: ' + rel;
          }
          issues.push(makeIssue('Unlinked File', -1, '(none)', msg, { severity: 'info', subject: rel }));
        });
      }
    }
    if (!opts.skipDuplicates) findDuplicatePairs(entries, referencedMap).forEach(i => issues.push(i));
    issues.forEach(i => { i.waiverKey = waiverKeyOf(i); });
    return issues;
  }

  // Count helper for the audit header.
  function summarizeIssues(issues) {
    const s = { error: 0, warning: 0, info: 0, fixable: 0, total: issues.length, byCategory: {} };
    issues.forEach(i => {
      s[i.severity] = (s[i.severity] || 0) + 1;
      if (i.fix) s.fixable++;
      s.byCategory[i.category] = (s.byCategory[i.category] || 0) + 1;
    });
    return s;
  }

  // ===================================================== undo / redo session
  /**
   * Session: the working copy of the database plus its edit history.
   * Every entry in `entries` carries a hidden numeric `_uid` (never serialised)
   * so history operations stay valid when entries are renamed, re-sorted or
   * re-inserted. One user action == one history operation, however many
   * entries it touches.
   */
  function Session(initialEntries) {
    this.entries = [];
    this.nextUid = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.maxOps = 400;
    this.dirty = false;
    this.savedMark = 0;          // opCount value at last save, to detect "back to saved"
    this.opCount = 0;
    this.listeners = [];
    (initialEntries || []).forEach(e => this.entries.push(this._adopt(e)));
    this.entries.sort(cmpEntries);
  }
  Session.prototype._adopt = function (e, uid) {
    const clean = buildCleanEntry(e);
    clean._uid = uid || this.nextUid++;
    if (clean._uid >= this.nextUid) this.nextUid = clean._uid + 1;
    return clean;
  };
  Session.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Session.prototype._emit = function (kind) { this.listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } }); };
  Session.prototype.byUid = function (uid) {
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i]._uid === uid) return this.entries[i];
    return null;
  };
  Session.prototype.indexOfUid = function (uid) {
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i]._uid === uid) return i;
    return -1;
  };
  Session.prototype.ids = function (exceptUid) {
    const s = new Set();
    this.entries.forEach(e => { if (e._uid !== exceptUid && e.id) s.add(e.id); });
    return s;
  };
  Session.prototype._push = function (op) {
    if (!op.changes.length) return false;
    op.ts = Date.now();
    this.undoStack.push(op);
    if (this.undoStack.length > this.maxOps) this.undoStack.shift();
    this.redoStack = [];
    this.opCount++;
    this.dirty = true;
    return true;
  };
  function cleanSnap(e) { const c = buildCleanEntry(e); return c; }
  function sameContent(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  Session.prototype.addEntries = function (list, label) {
    const changes = [];
    list.forEach(src => {
      const e = this._adopt(src);
      this.entries.push(e);
      changes.push({ uid: e._uid, before: null, after: cleanSnap(e) });
    });
    this.entries.sort(cmpEntries);
    if (this._push({ label: label || 'Add entry', changes: changes })) this._emit('edit');
    return changes.map(c => c.uid);
  };
  Session.prototype.updateEntry = function (uid, newValues, label) {
    const e = this.byUid(uid);
    if (!e) return false;
    const before = cleanSnap(e), after = buildCleanEntry(newValues);
    if (sameContent(before, after)) return false;
    SCHEMA_FIELDS.forEach(f => { e[f] = Array.isArray(after[f]) ? after[f].slice() : after[f]; });
    this.entries.sort(cmpEntries);
    this._push({ label: label || 'Edit ' + formatEntryLabel(after), changes: [{ uid: uid, before: before, after: after }] });
    this._emit('edit');
    return true;
  };
  Session.prototype.deleteEntries = function (uids, label) {
    const changes = [];
    uids.forEach(uid => {
      const i = this.indexOfUid(uid);
      if (i < 0) return;
      changes.push({ uid: uid, before: cleanSnap(this.entries[i]), after: null });
      this.entries.splice(i, 1);
    });
    if (this._push({ label: label || 'Delete ' + changes.length + ' entr' + (changes.length === 1 ? 'y' : 'ies'), changes: changes })) this._emit('edit');
    return changes.length;
  };
  /**
   * batch(label, fn): fn(entriesList) may mutate entries in place (audit fixes,
   * find/replace). Before/after snapshots are diffed afterwards so the whole
   * action becomes one undoable operation.
   */
  Session.prototype.batch = function (label, fn) {
    const before = new Map();
    this.entries.forEach(e => before.set(e._uid, cleanSnap(e)));
    const result = fn(this.entries);
    // Entries pushed inside fn arrive raw: normalise them and give each a uid
    // BEFORE diffing, so their history change refers to a real uid.
    this.entries = this.entries.map(e => (e._uid === undefined ? this._adopt(e) : e));
    const changes = [];
    const nowUids = new Set();
    this.entries.forEach(e => {
      nowUids.add(e._uid);
      const b = before.get(e._uid);
      const a = cleanSnap(e);
      if (!b) changes.push({ uid: e._uid, before: null, after: a });
      else if (!sameContent(b, a)) changes.push({ uid: e._uid, before: b, after: a });
    });
    before.forEach((b, uid) => { if (!nowUids.has(uid)) changes.push({ uid: uid, before: b, after: null }); });
    this.entries.sort(cmpEntries);
    if (this._push({ label: label, changes: changes })) this._emit('edit');
    return result;
  };
  Session.prototype._apply = function (op, direction) {
    // direction 'undo' restores `before`; 'redo' restores `after`.
    const seq = direction === 'undo' ? op.changes.slice().reverse() : op.changes;
    seq.forEach(ch => {
      const target = direction === 'undo' ? ch.before : ch.after;
      const idx = this.indexOfUid(ch.uid);
      if (target === null) { if (idx >= 0) this.entries.splice(idx, 1); return; }
      if (idx < 0) { const e = this._adopt(target, ch.uid); this.entries.push(e); return; }
      const e = this.entries[idx];
      SCHEMA_FIELDS.forEach(f => { e[f] = Array.isArray(target[f]) ? target[f].slice() : target[f]; });
    });
    this.entries.sort(cmpEntries);
  };
  Session.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Session.prototype.canRedo = function () { return this.redoStack.length > 0; };
  Session.prototype.undo = function () {
    const op = this.undoStack.pop();
    if (!op) return null;
    this._apply(op, 'undo');
    this.redoStack.push(op);
    this.opCount--; this.dirty = this.opCount !== this.savedMark;
    this._emit('undo');
    return op;
  };
  Session.prototype.redo = function () {
    const op = this.redoStack.pop();
    if (!op) return null;
    this._apply(op, 'redo');
    this.undoStack.push(op);
    this.opCount++; this.dirty = this.opCount !== this.savedMark;
    this._emit('redo');
    return op;
  };
  Session.prototype.undoTo = function (stackIndex) {
    // Undo until undoStack.length === stackIndex.
    let n = 0;
    while (this.undoStack.length > stackIndex) { if (!this.undo()) break; n++; }
    return n;
  };
  Session.prototype.markSaved = function () { this.savedMark = this.opCount; this.dirty = false; this._emit('saved'); };
  Session.prototype.replaceAll = function (entries) {
    this.entries = []; this.nextUid = 1;
    entries.forEach(e => this.entries.push(this._adopt(e)));
    this.entries.sort(cmpEntries);
    this.undoStack = []; this.redoStack = []; this.opCount = 0; this.savedMark = 0; this.dirty = false;
    this._emit('load');
  };
  Session.prototype.serialize = function () { return serializeCanonical(this.entries); };
  // History persistence (autosave blob). Entries carry _uid, ops reference uids.
  Session.prototype.toBlob = function () {
    return { v: 1, nextUid: this.nextUid, entries: this.entries.map(e => Object.assign({}, e)), undo: this.undoStack, redo: this.redoStack,
      opCount: this.opCount, savedMark: this.savedMark };
  };
  Session.prototype.fromBlob = function (b) {
    this.entries = (b.entries || []).map(e => { const c = buildCleanEntry(e); c._uid = e._uid; return c; });
    this.nextUid = b.nextUid || (this.entries.reduce((m, e) => Math.max(m, e._uid || 0), 0) + 1);
    this.undoStack = b.undo || []; this.redoStack = b.redo || [];
    this.opCount = b.opCount || 0; this.savedMark = b.savedMark || 0;
    this.entries.sort(cmpEntries);
    this.dirty = this.opCount !== this.savedMark;
    this._emit('load');
  };

  return {
    // constants
    SCHEMA_FIELDS, BLANK_ENTRY, blankEntry, DRIVER_TECH_ORDER, ALLOWED_DRIVER_TYPES, FORM_FACTORS, CONNECTORS_ALL,
    FORM_CONNECTOR_MAP, FORM_FACTOR_ICON, CONNECTOR_ICON, DRIVER_TYPE_ICON, TAG_GROUPS, TAG_GROUP_EMOJI, TAG_EMOJI, PRICE_GROUP, APPROVED_TAGS, PRICE_TIER_TAGS,
    tagEmoji,
    PRIMARY_TONALITY_GROUP, TAG_CONFLICT_PAIRS, MIN_TAGS, MAX_TAGS, TWS_FORM_FACTOR, WIRELESS_OVER_EAR_FORM_FACTOR,
    PRICE_MAX, CURRENT_YEAR,
    // helpers
    coerceInt, isValidYear, normalizeComponent, buildId, brandFold, brandSpellingFixes, brandCanonicalSpellings,
    roundPriceTo5, priceTierFor, priceTierBasis, classifyDriver, parseDriverConfig, driverConfigUnknownTokens,
    tagConflicts, tagConflictResolution, fixTierTags, normRelPath, foldPath, decodeHashU, encodeHashU, seqRatio, pyFloat,
    // entries
    validateEntry, buildCleanEntry, cmpEntries, formatEntryLabel, describeEntryChange,
    loadDatabaseText, serializeCanonical, splitIntoChunks,
    // audit
    runFullAudit, findDuplicatePairs, summarizeIssues, waiverKeyOf,
    // session
    Session
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataCore;
