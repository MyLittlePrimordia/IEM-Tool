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

function sanitizeName(name) {
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
    // Unified perceptual weight table (CurveUtils.PERCEPTUAL_WEIGHTS) so the
    // worker's scoring matches the main-thread Find scoring (_scoreInterp in
    // app-core.js) exactly - see CurveUtils.weightFor.
    return CurveUtils.weightFor(f);
}

function scoreInterp(interp, targetInterp, freqs, weighted) {
    let numK = 0, denK = 0;
    for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= 100 && freqs[i] <= 8000) {
            const w = weighted ? freqWeight(freqs[i]) : 1.0;
            numK += (targetInterp[i] - interp[i]) * w;
            denK += w;
        }
    }
    const k = denK > 0 ? numK / denK : 0;
    let errSum = 0, wSum = 0;
    for (let i = 0; i < freqs.length; i++) {
        const w = weighted ? freqWeight(freqs[i]) : 1.0;
        errSum += Math.abs((interp[i] + k) - targetInterp[i]) * w;
        wSum += w;
    }
    return Math.max(0, Math.min(100, 100 * Math.exp(-0.11 * (errSum / wSum))));
}

function buildCanonicalProfiles(dataset) {
    const CU = CurveUtils;
    const groups = {};
    const freqs = CU.generateLogGrid(100);

    dataset.forEach(item => {
        if (!item.data) return;

        const nameLower = item.name.toString().toLowerCase();

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

    for (const name in groups) {
        const items = groups[name];
        if (items.length === 1) {
            const item = items[0];
            const normalized = CU.normalizeTo75dB(item.data, 500, 75);
            const interp = CU.cubicSplineInterpolate(normalized, freqs);
            canonicalList.push({
                name: name,
                id: item.id,
                interp: Array.from(interp)
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

            canonicalList.push({
                name: displayName,
                id: sub.items[0].item.id,
                interp: Array.from(averagedInterp)
            });
        });
    }

    return canonicalList;
}

function verifyGoalAcoustics(candInterp, baseInterp, freqs, goal) {
    if (!candInterp || !baseInterp || !freqs) return { passed: false, reason: "Missing Curve Data" };

    const getBandAvg = (interp, minHz, maxHz, offset) => {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= minHz && freqs[i] <= maxHz) {
                sum += (interp[i] + (offset || 0));
                count++;
            }
        }
        return count > 0 ? sum / count : 75;
    };

    const baseMid = getBandAvg(baseInterp, 400, 1000, 0);
    const candMidRaw = getBandAvg(candInterp, 400, 1000, 0);
    const alignOffset = baseMid - candMidRaw;

    const candSubBass = getBandAvg(candInterp, 20, 80, alignOffset);
    const baseSubBass = getBandAvg(baseInterp, 20, 80, 0);
    const candMidrange = getBandAvg(candInterp, 400, 1000, alignOffset);
    const candTreble = getBandAvg(candInterp, 10000, 16000, alignOffset);
    const baseTreble = getBandAvg(baseInterp, 10000, 16000, 0);
    const candPinna = getBandAvg(candInterp, 1500, 3500, alignOffset);

    const candBassBoost = candSubBass - candMidrange;

    if (goal === 'direct') {
        let totalDiff = 0;
        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs(candInterp[i] - baseInterp[i]);
        const mae = totalDiff / freqs.length;
        const passed = (mae <= 2.8);
        return { passed, reason: passed ? "High Tonal Match to Base IEM" : "Tuning Deviates From Base" };
    } else if (goal === 'bass') {
        const passed = (candBassBoost >= 6.5) || (candSubBass >= baseSubBass + 1.8);
        return { passed, reason: passed ? "Measured +6.5dB Sub-Bass Shelf" : "Lacks Measured Sub-Bass Elevation" };
    } else if (goal === 'detail') {
        const passed = (candTreble >= baseTreble + 1.0) && (candPinna >= candMidrange + 3.5);
        return { passed, reason: passed ? "Measured High-Treble Extension" : "Treble Air Rolled Off" };
    } else if (goal === 'vocal') {
        const pinnaGain = candPinna - candMidrange;
        const passed = (pinnaGain >= 5.5 && pinnaGain <= 11.5);
        return { passed, reason: passed ? "Measured Smooth Vocal Pinna Gain" : "Pinna Gain Too Flat or Harsh" };
    } else if (goal === 'stage') {
        const passed = (candTreble >= baseTreble - 1.0) && (candPinna >= candMidrange + 2.5);
        return { passed, reason: passed ? "Measured Spatial Air & Pinna Balance" : "Narrow High-Frequency Energy" };
    } else if (goal === 'refine') {
        let totalDiff = 0;
        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs(candInterp[i] - baseInterp[i]);
        const mae = totalDiff / freqs.length;
        const passed = (mae <= 2.2);
        return { passed, reason: passed ? "High Tonal Shape Continuity" : "Tonal Shape Deviates Too Far" };
    }

    return { passed: true, reason: "Goal Criteria Met" };
}

function hasGoalTag(tags, goal) {
    if (!tags || !Array.isArray(tags)) return false;
    const tagStr = tags.join(' ').toLowerCase();
    if (goal === 'direct') return /balanced|smooth|reference|neutral|all-rounder/i.test(tagStr);
    if (goal === 'bass') return /basshead|sub-bass|punchy/i.test(tagStr);
    if (goal === 'detail') return /detailed|resolving|technical|analytical/i.test(tagStr);
    if (goal === 'gaming') return /gaming|competitive|imaging|stage/i.test(tagStr);
    if (goal === 'vocal') return /vocal|smooth|warm|mid/i.test(tagStr);
    if (goal === 'stage') return /wide-stage|good-imaging|3d/i.test(tagStr);
    if (goal === 'refine') return /balanced|smooth|reference|neutral/i.test(tagStr);
    return false;
}

function scoreUpgradeCandidate(item, baseInterp, freqs, goal) {
    const tags = (item && Array.isArray(item.tags)) ? item.tags : [];
    const data = item && item.data;
    if (!data || data.length < 2 || !baseInterp || !freqs) {
        return { id: item && item.id, tonalMatch: 0, acousticPassed: false, acousticReason: "Missing Curve Data", matchedTag: false };
    }

    const norm = CurveUtils.normalizeTo75dB(data, 500, 75);
    const interp = CurveUtils.cubicSplineInterpolate(norm, freqs);

    // Use the SAME offset-corrected, perceptually weighted scorer as the
    // main-thread upgrade fallback so worker and inline results agree.
    const tonalMatch = scoreInterp(interp, baseInterp, freqs, true);

    const acoustic = verifyGoalAcoustics(interp, baseInterp, freqs, goal);

    return {
        id: item.id,
        tonalMatch: tonalMatch,
        acousticPassed: !!acoustic.passed,
        acousticReason: acoustic.reason || "",
        matchedTag: hasGoalTag(tags, goal)
    };
}

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

self.onmessage = function (e) {
    const msg = e.data || {};
    try {
        if (msg.type === 'prime') {
            // Prime: build the canonical profiles from the full payload and
            // cache them under msg.sig. Follow-up tuning messages with the
            // same sig skip both the rebuild and the payload transfer, so
            // repeated scans don't re-clone ~20MB of curve data.
            if (msg.dataset && Array.isArray(msg.dataset)) {
                canonicalList = buildCanonicalProfiles(msg.dataset);
                canonicalKey = (msg.sig !== undefined && msg.sig !== null) ? msg.sig : itemsKey(msg.dataset);
            }
            self.postMessage({ type: 'primed', ok: true });
            return;
        }
        if (msg.type === 'tuning') {
            const freqs = msg.freqs || CurveUtils.generateLogGrid(100);
            const targetInterp = msg.targetInterp || null;

            if (!targetInterp) {
                self.postMessage({ type: 'result', ok: false, error: 'no targetInterp' });
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
                    self.postMessage({ type: 'result', ok: false, error: 'no items for rebuild', reprime: true });
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

            self.postMessage({ type: 'result', ok: true, matches: returnList });
        } else if (msg.type === 'upgrade') {
            const items = msg.items || [];
            const freqs = msg.freqs || CurveUtils.generateLogGrid(100);
            const baseInterp = msg.baseInterp || null;

            if (!baseInterp) {
                self.postMessage({ type: 'result', ok: false, error: 'no baseInterp' });
                return;
            }

            const returnList = [];

            for (let i = 0; i < items.length; i++) {
                returnList.push(scoreUpgradeCandidate(items[i], baseInterp, freqs, msg.goal || 'direct'));
            }

            self.postMessage({ type: 'result', ok: true, matches: returnList });
        } else {
            self.postMessage({ type: 'result', ok: false, error: 'unknown message type: ' + (msg.type || 'none') });
        }
    } catch (err) {
        self.postMessage({ type: 'result', ok: false, error: (err && err.stack) ? err.stack : String(err) });
    }
};