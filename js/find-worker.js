/* Find scan offload worker.
 * Runs the CPU-heavy tuning scan (canonical profile building + target scoring)
 * off the main thread so the UI stays responsive.
 * Pure functions only; no DOM. Curve math comes from js/utils.js.
 */
try {
    importScripts('js/utils.js'); // provides CurveUtils
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
    if (f < 80) return 1.2;
    if (f < 250) return 1.1;
    if (f < 1000) return 1.0;
    if (f < 3500) return 1.5;
    if (f < 7000) return 1.0;
    if (f <= 10000) return 0.5;
    return 0.1;
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
                interp: Array.from(interp),
                sourceData: item.data
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
                interp: Array.from(averagedInterp),
                sourceData: sub.items[0].item.data
            });
        });
    }

    return canonicalList;
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
        if (msg.type === 'tuning') {
            const items = msg.items || [];
            const freqs = msg.freqs || CurveUtils.generateLogGrid(100);
            const targetInterp = msg.targetInterp || null;

            if (!targetInterp) {
                self.postMessage({ type: 'result', ok: false, error: 'no targetInterp' });
                return;
            }

            // buildCanonicalProfiles is target-independent (depends only on the
            // item set), so memoize it: repeated scans over the same filtered
            // set with a different target slider value skip the whole rebuild.
            const key = itemsKey(items);
            let cc;
            if (key === canonicalKey && canonicalList) {
                cc = canonicalList;
            } else {
                canonicalList = buildCanonicalProfiles(items);
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
                    data: iem.sourceData,
                    similarity: matchPct,
                    interp: iem.interp,
                    isTuningMatch: true
                });
            }

            self.postMessage({ type: 'result', ok: true, matches: returnList });
        } else {
            self.postMessage({ type: 'result', ok: false, error: 'unknown message type: ' + (msg.type || 'none') });
        }
    } catch (err) {
        self.postMessage({ type: 'result', ok: false, error: (err && err.stack) ? err.stack : String(err) });
    }
};