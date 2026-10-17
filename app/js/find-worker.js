/* Find scan offload worker.
 * Runs the CPU-heavy tuning scan (canonical profile building + target scoring)
 * off the main thread so the UI stays responsive.
 * Pure functions only; no DOM. Curve math comes from js/utils.js.
 */
try {
    importScripts('utils.js'); // provides CurveUtils (relative to this worker's own path)
} catch (e) {
    // Worker may be created from a different base path; ignore, CurveUtils is
    // resolved lazily below and will throw a clear error if genuinely missing.
}
try {
    importScripts('endgame-categories.js'); // provides EndgameCategories (Endgame scan rubric)
} catch (e) {
    // Only the 'endgame' message type needs it; the handler reports a clear
    // error if the file failed to load.
}

function sanitizeName(name) {
    // Coerce at the boundary: a truthy non-string (e.g. a number,
    // an object) reaches .toLowerCase() below and throws --
    // Number.isFinite/typeof guards on null/undefined already work
    // via the falsy check, this catches everything else.
    if (typeof name !== 'string') name = (name == null) ? '' : String(name);
    if (!name) return "";
    let clean = name.toLowerCase();

    clean = clean.replace(/[\(\[][^\]\)]*[\)\]]/g, '');

    clean = clean.replace(/\s*x\s*(?:hbb|crinacle|crin|zeos|gizaudio|fresh reviews|jays audio|divinus|seeaudio|akros|ducbloke|community|fresh|z reviews|z)\b/g, '');

    clean = clean.replace(/\b(?!dudu\b)[ud]{4}\b/g, '');
    clean = clean.replace(/\b[ud]{2,3}\b/g, '');
    clean = clean.replace(/\b[01]{2,4}\b/g, '');
    clean = clean.replace(/\b[1-5]\s+[1-5]\b/g, '');
    clean = clean.replace(/\b(?:all on|all off|bc on|bc off)\b/g, '');
    clean = clean.replace(/\s*(?:bass|treble|reference|ref|mid|midrange)?\s*(?:switch|sw|switches)\s*(?:on|off|up|down|1|2|3|4|0)*\b/g, '');

    clean = clean.replace(/\b\d+\s*(?:Ω|ohm|ohms|o)\b/g, '');
    clean = clean.replace(/\b(?:high|low|s\s+high|s\s+low)\s*(?:Ω|ohm|ohms|impedance)\b/g, '');

    clean = clean.replace(/\b(?:\d+\.\d+mm|\d+mm|3\.5|4\.4|usb\s+c|type\s+c|usb|tws|anc|analog|digital|dsp)\b/g, '');
    clean = clean.replace(/\s*(?:gold|grey|gray|silver|default)?\s*(?:plug|cable|connection|connector|adapter|headband|wire)\b/g, '');

    clean = clean.replace(/\s*(?:foam|silicone|silicon|yaxi|spinfit|symbio|starline|widebore|narrowbore|final|clear|red|blue|grey|gray|stock|custom|my|dunu\s+ss)\s*(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');
    clean = clean.replace(/\b(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');

    clean = clean.replace(/\s*(?:blue|gold|silver|red|black|green|brass|steel|titanium|ti|short\s+black|short\s+red|alt|reference|ref|hifi|pop|vocal|instrumental|monitor|balanced|classic|default|standard|std)?\s*(?:nozzles?|rings?|filters?|mesh|damper|vent|mod|mods|taped?|tanya|microtape)\b/g, '');

    clean = clean.replace(/\b(?:v\d+(?:\.\d+)?|mk[ivx\d]+b?)\b/g, '');
    clean = clean.replace(/\b(?:\d+st|\d+nd|\d+rd|\d+th)\s+(?:gen|generation|unit|anniversary|anniv)\b/g, '');
    clean = clean.replace(/\b(?:og|gen|generation|unit|anniversary|anniv|re\s+set|preprod|pre\s+retail|retail|sample\s*\d*|sample)\b/g, '');

    clean = clean.replace(/\b(?:edition|standard|std|default|reference|ref|stock|base|baseline|pro\s+max|pro|max|ltd|limited|custom\s+resin|resin)\b/g, '');

    clean = clean.replace(/\s+/g, ' ').trim();

    return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function freqWeight(f) {
    // Single source of truth lives in CurveUtils (js/utils.js, imported above)
    // and is shared verbatim with FindEngine on the main thread.
    return CurveUtils.freqWeight(f);
}

function scoreInterp(interp, targetInterp, freqs, weighted) {
    return CurveUtils.scoreInterp(interp, targetInterp, freqs, weighted);
}

function buildCanonicalProfiles(dataset) {
    const CU = CurveUtils;
    // Null-prototype map: a canonical name of "__proto__" (or "constructor")
    // would otherwise collide with Object.prototype keys and corrupt grouping.
    const groups = Object.create(null);
    const freqs = CU.generateLogGrid(100);

    dataset.forEach(item => {
        // <2-point "curves" would interpolate as flat-75 (perfectly neutral)
        // and score as ideal — skip them instead of rewarding missing data.
        if (!item.data || item.data.length < 2) return;

        // Coerce: a non-string name (number/object from custom imports)
        // previously threw on .toLowerCase(). Mirrors the main thread.
        const nameLower = String(item.name == null ? '' : item.name).toLowerCase();

        const isImpedanceEntry = /[Ωω]|\b\d+\s*ohms?\b|\badapter\b|\bimpedance\b/i.test(nameLower);

        const isTipVariant = /\s+(?:foam|silicone|widebore|spinfit|stock|dunu)?\s*tips$/i.test(nameLower);

        const isSampleVariant = /\s+sample\s*\d*$/i.test(nameLower);

        if (isImpedanceEntry || isTipVariant || isSampleVariant) {
            return;
        }

        const canonicalName = sanitizeName(item.name);
        if (!groups[canonicalName]) {
            groups[canonicalName] = [];
        }
        groups[canonicalName].push(item);
    });

    const canonicalList = [];

    // Price/brand/tags are passed through from the dataset payload (the main
    // thread resolves them via FindEngine._slimItem / getDbEntry). They are
    // unused by the tuning/upgrade branches but required by the Endgame scan,
    // and carrying them on the shared memoized canonical list keeps every scan
    // type on the same prime cache.
    function resolveMeta(items) {
        let price = null, brand = '', tags = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it && !price) {
                const p = it.price !== undefined && it.price !== null ? parseFloat(it.price) : NaN;
                if (isFinite(p) && p > 0) price = p;
            }
            if (it && !brand && it.brand) brand = String(it.brand);
            if (it && Array.isArray(it.tags)) {
                for (let t = 0; t < it.tags.length; t++) {
                    if (tags.indexOf(it.tags[t]) === -1) tags.push(it.tags[t]);
                }
            }
        }
        return { price: price, brand: brand, tags: tags };
    }

    for (const name in groups) {
        const items = groups[name];
        if (items.length === 1) {
            const item = items[0];
            const normalized = CU.normalizeTo75dB(item.data, 500, 75);
            const interp = CU.cubicSplineInterpolate(normalized, freqs);
            const meta = resolveMeta([item]);
            canonicalList.push({
                name: name,
                id: item.id,
                interp: Array.from(interp),
                price: meta.price,
                brand: meta.brand,
                tags: meta.tags
            });
            continue;
        }

        const subgroups = [];
        for (const item of items) {
            const normalized = CU.normalizeTo75dB(item.data, 500, 75);
            const interp = CU.cubicSplineInterpolate(normalized, freqs);

            let placed = false;
            for (let s = 0; s < subgroups.length; s++) {
                const sub = subgroups[s];

                let diffSum = 0;
                for (let i = 0; i < freqs.length; i++) {
                    diffSum += Math.abs(interp[i] - sub.anchorInterp[i]);
                }
                const mae = diffSum / freqs.length;

                if (mae < 2.0) {
                    sub.items.push({ item, interp });
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                subgroups.push({
                    anchorInterp: interp,
                    items: [{ item, interp }]
                });
            }
        }

        subgroups.forEach((sub) => {
            let displayName = name;
            if (subgroups.length > 1) {
                displayName = sub.items[0].item.name;
            }

            const averagedInterp = new Float32Array(freqs.length).fill(0);
            const nMembers = sub.items.length;
            for (let m = 0; m < nMembers; m++) {
                const memberInterp = sub.items[m].interp;
                for (let i = 0; i < freqs.length; i++) {
                    averagedInterp[i] += memberInterp[i];
                }
            }

            for (let i = 0; i < freqs.length; i++) {
                averagedInterp[i] /= nMembers;
            }

            const meta = resolveMeta(sub.items.map(m => m.item));

            canonicalList.push({
                name: displayName,
                id: sub.items[0].item.id,
                interp: Array.from(averagedInterp),
                price: meta.price,
                brand: meta.brand,
                tags: meta.tags
            });
        });
    }

    return canonicalList;
}

// NOTE: the dead 'prime' and 'upgrade' worker branches (and the helpers that
// only they used: verifyGoalAcoustics / hasGoalTag / buildUpgradeInterpList)
// were removed. The main thread only ever posts 'tuning' and 'endgame'
// (upgrade is scored locally in find-upgrade.js), so the worker-side upgrade
// scorer was unreachable and its hasGoalTag had silently drifted from the
// main-thread copy — a single source of truth now lives on the main thread.
let canonicalKey = null;
let canonicalList = null;

function itemsKey(list) {
    let s = list.length + '|';
    for (let i = 0; i < list.length; i++) {
        const it = list[i];
        s += (it && it.id !== undefined ? it.id : i) + ':' + (it && it.data ? it.data.length : 0) + ',';
    }
    return s;
}

// Endgame scan: for every rubric category, rank ALL priced candidates and
// return a top-N pool (Option X of Y card cycling) instead of the old 3
// curated slots. Each pool member carries its composite score, its tag
// corroboration result, and role flags: the top pick is the Champion, any
// budget clone of the Champion (>=75% curve similarity for <=40% of its
// price) is flagged as a Giant Killer. A value strip then collects the
// Giant Killers of all 8 champions into one cycling pool.
// Uses the shared canonical list, so no extra normalize + spline pass
// beyond what the tuning scan already paid for.
function scoreEndgameCategories(cc, freqs, maxPrice) {
    if (!EndgameCategories) {
        throw new Error('EndgameCategories unavailable — endgame-categories.js did not load');
    }
    const EG = EndgameCategories;
    const cats = EG.ENDGAME_CATEGORIES || [];
    const maxPicks = EG.ENDGAME_MAX_PICKS || 12;

    // Only items with a real price inside the budget can be any of the
    // picks (Champion <= budget, Giant Killer <= 40% of the Champion's
    // price which is already <= budget).
    const priced = [];
    for (let i = 0; i < cc.length; i++) {
        const e = cc[i];
        if (!e.price || e.price > maxPrice) continue;
        priced.push(e);
    }

    const out = {};
    const champions = [];

    for (let c = 0; c < cats.length; c++) {
        const cat = cats[c];
        const scored = [];
        for (let i = 0; i < priced.length; i++) {
            const e = priced[i];
            const res = EG.scoreCategory(cat, e.tags, e.interp, freqs);
            // No price bonus: at equal acoustics the cheapest option should
            // win, not the priciest affordable one (price ≠ quality).
            const bonus = 0;
            scored.push({
                entry: e,
                composite: res.score + bonus,
                reason: res.reason,
                tagMatch: res.tagMatch,
                curveScore: res.curveScore
            });
        }

        if (scored.length === 0) {
            out[cat.id] = { pool: [] };
            continue;
        }

        scored.sort((a, b) => b.composite - a.composite);
        const champion = scored[0];

        // Giant Killer set: closest tuner under 40% of the Champion's price
        // wins (>=75% curve similarity). No brand constraint: same-brand
        // cheaper siblings are legit giant killers (e.g. Hexa under Nova).
        const gkCeiling = champion.entry.price * EG.GIANT_KILLER_PRICE_FRACTION;
        const gkSims = {};
        for (let i = 1; i < scored.length; i++) {
            const s = scored[i];
            if (s.entry.price > gkCeiling) continue;
            const sim = scoreInterp(s.entry.interp, champion.entry.interp, freqs, true);
            if (sim >= 75) gkSims[s.entry.id] = { sim: sim, s: s };
        }

        const pool = [];
        const limit = Math.min(maxPicks, scored.length);
        for (let i = 0; i < limit; i++) {
            const s = scored[i];
            const gk = gkSims[s.entry.id];
            const pick = {
                id: s.entry.id,
                name: s.entry.name,
                price: s.entry.price,
                brand: s.entry.brand || '',
                score: Math.min(100, Math.round(s.composite)),
                reason: s.reason,
                tagMatch: !!s.tagMatch,
                curveScore: Math.round(s.curveScore || 0)
            };
            if (i === 0) pick.isChampion = true;
            if (gk) {
                pick.isGiantKiller = true;
                pick.similarity = gk.sim;
                pick.reason = `${gk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`;
            }
            pool.push(pick);
        }

        // A Giant Killer ranked outside the top-N cap still earns a slot —
        // budget clones are the whole point of the Endgame tab. The best
        // clone overall is also kept for the value strip.
        let bestGk = null;
        let bestGkAll = null;
        for (const gkId in gkSims) {
            const g = gkSims[gkId];
            if (!bestGkAll || g.sim > bestGkAll.sim) bestGkAll = g;
            if (pool.some(p => p.id === gkId)) continue;
            if (!bestGk || g.sim > bestGk.sim) bestGk = g;
        }
        if (bestGk) {
            pool.push({
                id: bestGk.s.entry.id,
                name: bestGk.s.entry.name,
                price: bestGk.s.entry.price,
                brand: bestGk.s.entry.brand || '',
                score: Math.min(100, Math.round(bestGk.s.composite)),
                reason: `${bestGk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`,
                tagMatch: !!bestGk.s.tagMatch,
                curveScore: Math.round(bestGk.s.curveScore || 0),
                isGiantKiller: true,
                similarity: bestGk.sim
            });
        }

        champions.push({ id: champion.entry.id, name: champion.entry.name, interp: champion.entry.interp, price: champion.entry.price, gk: bestGkAll });
        out[cat.id] = { pool: pool };
    }

    // Value strip: the giant killers of all 8 category champions — the same
    // budget-clone rule as each category's 💥 pick (<=40% of the champion's
    // price, >=75% tonal match) — collected into one cycling pool, best
    // match first. Duplicate clones keep the strongest match.
    const valueById = new Map();
    for (let k = 0; k < champions.length; k++) {
        const ch = champions[k];
        const gk = ch.gk;
        if (!gk) continue;
        const e = gk.s.entry;
        const existing = valueById.get(e.id);
        if (existing && existing.similarity >= gk.sim) continue;
        valueById.set(e.id, { id: e.id, name: e.name, price: e.price, brand: e.brand || '', similarity: gk.sim, matchName: ch.name });
    }
    const valuePool = Array.from(valueById.values()).sort((a, b) => b.similarity - a.similarity);
    out._value = { pool: valuePool.slice(0, 12) };
    return out;
}

self.onmessage = function (e) {
    const msg = e.data || {};
    // Echo the caller's request id with every reply so the main thread can
    // tell which scan a result belongs to (tuning vs upgrade share this
    // worker and both listeners observe every message).
    const reqId = msg.reqId;
    try {
        if (msg.type === 'tuning') {
            const freqs = msg.freqs || CurveUtils.generateLogGrid(100);
            const targetInterp = msg.targetInterp || null;

            if (!targetInterp) {
                self.postMessage({ type: 'result', ok: false, error: 'no targetInterp', reqId: reqId });
                return;
            }

            // buildCanonicalProfiles is target-independent (depends only on the
            // item set), so memoize it: repeated scans over the same filtered
            // set with a different target slider value skip the whole rebuild.
            // The main thread sends a signature computed with the same formula
            // as itemsKey; when it matches, the items themselves are NOT sent
            // again, so repeated scans don't re-clone ~20MB of curve data.
            const key = (msg.sig !== undefined && msg.sig !== null) ? msg.sig : itemsKey(msg.items || []);
            let cc;
            if (key === canonicalKey && canonicalList) {
                cc = canonicalList;
            } else {
                // No memoized list: either the dataset changed (worker expects
                // items to rebuild) or the worker lost its cache (reply with
                // reprime so the main thread re-sends the full payload).
                if (!msg.items || msg.items.length === 0) {
                    self.postMessage({ type: 'result', ok: false, error: 'no items for rebuild', reprime: true, reqId: reqId });
                    return;
                }
                canonicalList = buildCanonicalProfiles(msg.items || []);
                canonicalKey = key;
                cc = canonicalList;
            }

            const returnList = [];

            for (let i = 0; i < cc.length; i++) {
                const iem = cc[i];
                const matchPct = scoreInterp(iem.interp, targetInterp, freqs, true);
                returnList.push({
                    name: iem.name,
                    id: iem.id,
                    similarity: matchPct,
                    interp: iem.interp,
                    isTuningMatch: true
                });
            }

            self.postMessage({ type: 'result', ok: true, matches: returnList, reqId: reqId });
        } else if (msg.type === 'endgame') {
            const freqs = msg.freqs || CurveUtils.generateLogGrid(100);
            const maxPrice = parseFloat(msg.maxPrice);
            if (!isFinite(maxPrice) || maxPrice <= 0) {
                self.postMessage({ type: 'result', ok: false, error: 'invalid maxPrice', reqId: reqId });
                return;
            }

            // Same memoized canonical list as the tuning branch — the Endgame
            // scan reuses the exact profiles already built (and the metadata
            // pass-through), so it never re-normalizes or re-splines.
            const key = (msg.sig !== undefined && msg.sig !== null) ? msg.sig : itemsKey(msg.items || []);
            let cc;
            if (key === canonicalKey && canonicalList) {
                cc = canonicalList;
            } else {
                if (!msg.items || msg.items.length === 0) {
                    self.postMessage({ type: 'result', ok: false, error: 'no items for rebuild', reprime: true, reqId: reqId });
                    return;
                }
                canonicalList = buildCanonicalProfiles(msg.items || []);
                canonicalKey = key;
                cc = canonicalList;
            }

            const endgame = scoreEndgameCategories(cc, freqs, maxPrice);
            self.postMessage({ type: 'result', ok: true, endgame: endgame, reqId: reqId });
        } else {
            self.postMessage({ type: 'result', ok: false, error: 'unknown message type: ' + (msg.type || 'none'), reqId: reqId });
        }
    } catch (err) {
        self.postMessage({ type: 'result', ok: false, error: (err && err.stack) ? err.stack : String(err), reqId: reqId });
    }
};