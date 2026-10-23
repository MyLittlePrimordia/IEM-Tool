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
    importScripts('name-utils.js');    // provides NameUtils (canonical name grouping)
    importScripts('endgame-categories.js'); // provides EndgameCategories (Endgame scan rubric)
    importScripts('endgame-scoring.js');    // provides EndgameScoring (shared with the renderer)
} catch (e) {
    // Only the 'endgame' message type needs it; the handler reports a clear
    // error if the file failed to load.
}

function sanitizeName(name) {
    // Single implementation: js/name-utils.js (also in the renderer bundle).
    return NameUtils.sanitizeName(name);
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

// Endgame scoring lives in endgame-scoring.js, shared verbatim with the
// renderer fallback (find-endgame.js) so both paths rank identically.
// Loaded via importScripts() at the top of this file.
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

            const endgame = EndgameScoring.scoreEndgameCategories(cc, freqs, maxPrice);
            self.postMessage({ type: 'result', ok: true, endgame: endgame, reqId: reqId });
        } else {
            self.postMessage({ type: 'result', ok: false, error: 'unknown message type: ' + (msg.type || 'none'), reqId: reqId });
        }
    } catch (err) {
        self.postMessage({ type: 'result', ok: false, error: (err && err.stack) ? err.stack : String(err), reqId: reqId });
    }
};