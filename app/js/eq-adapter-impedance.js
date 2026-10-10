// Gear Simulator: impedance-adapter modelling from a MEASURED impedance curve.
//
// Physics: an output (or adapter) impedance Zo in series with the IEM forms a
// voltage divider, so at each frequency the level at the driver changes by
//     20 * log10( Z(f) / (Z(f) + Zo) )          dB
// where Z(f) is the IEM's impedance at that frequency. Volume is assumed to be
// re-matched around 1 kHz, so only the SHAPE matters. A flat-impedance IEM is
// unaffected; one with a bass impedance peak gains bass relative to the mids.
//
// Data: data/impedance/<database entry id>.txt - two numbers per line,
// "frequency_Hz  impedance_ohms" (space, tab, comma or semicolon separated;
// lines starting with # or text headers are ignored). Served from the same
// (user-writable) data root as the FR curves. No file => the generic
// approximation already in gearSimOptions is used unchanged.
//
// The fitted result is expressed with the two shelf filters the simulator
// already owns (worklet slots 20/21 + the graph), so audio and graph stay in
// sync with no DSP changes. Mid-band impedance features that two shelves cannot
// express are reported through the fit error, never hidden.
const EQ_AdapterImpedanceMethods = {
    _impCache: new Map(),       // entry id -> curve array, or null when no file
    _impPending: new Map(),     // entry id -> in-flight load promise
    _adapterLastBase: undefined,

    parseImpedanceText: function (text) {
        const pts = [];
        String(text || '').split(/\r?\n/).forEach(function (line) {
            const t = line.trim();
            if (!t || t[0] === '#' || t[0] === '*') return;
            const parts = t.split(/[\s,;]+/);
            if (parts.length < 2) return;
            const f = parseFloat(parts[0]);
            const z = parseFloat(parts[1]);
            if (Number.isFinite(f) && Number.isFinite(z) && f >= 10 && f <= 40000 && z >= 0.1 && z <= 2000) pts.push([f, z]);
        });
        pts.sort(function (a, b) { return a[0] - b[0]; });
        const out = [];
        pts.forEach(function (p) { if (!out.length || p[0] > out[out.length - 1][0]) out.push(p); });
        // Too sparse or too narrow to model: treat as absent rather than guess.
        if (out.length < 8 || out[0][0] > 100 || out[out.length - 1][0] < 10000) return null;
        return out;
    },

    _impAt: function (curve, f) {
        if (f <= curve[0][0]) return curve[0][1];
        const last = curve[curve.length - 1];
        if (f >= last[0]) return last[1];
        let lo = 0, hi = curve.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (curve[mid][0] <= f) lo = mid; else hi = mid; }
        const a = curve[lo], b = curve[hi];
        const t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
        return a[1] + (b[1] - a[1]) * t;
    },

    // Level change (dB) vs. a zero-impedance source, matched at 1 kHz, on a log grid.
    adapterDeltaDb: function (curve, zo, freqs) {
        const raw = freqs.map((f) => { const z = this._impAt(curve, f); return 20 * Math.log10(z / (z + zo)); });
        let sum = 0, n = 0;
        freqs.forEach(function (f, i) { if (f >= 700 && f <= 1400) { sum += raw[i]; n++; } });
        const ref = n ? sum / n : 0;
        return raw.map(function (v) { return v - ref; });
    },

    // Best two-shelf (low + high) approximation of the divider curve.
    fitAdapterShelves: function (curve, zo) {
        const freqs = [];
        for (let i = 0; i < 96; i++) freqs.push(20 * Math.pow(1000, i / 95));   // 20 Hz .. 20 kHz
        const target = this.adapterDeltaDb(curve, zo, freqs);
        const db = (type, f, F, G) => 20 * Math.log10(this.getBiquadMagnitude(type, f, F, 0.7, G));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        let best = null;
        const lowFs = [60, 80, 100, 125, 160, 200, 250, 315, 400];
        const highFs = [2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];
        lowFs.forEach((LF) => highFs.forEach((HF) => {
            // Shelf dB response is close to linear in gain: solve the 2x2
            // least squares on unit-ish basis shapes, then score the REAL filters.
            const bl = freqs.map((f) => db('lowshelf', f, LF, 3) / 3);
            const bh = freqs.map((f) => db('highshelf', f, HF, 3) / 3);
            let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
            for (let i = 0; i < freqs.length; i++) { aa += bl[i] * bl[i]; ab += bl[i] * bh[i]; bb += bh[i] * bh[i]; ay += bl[i] * target[i]; by += bh[i] * target[i]; }
            const det = aa * bb - ab * ab;
            if (Math.abs(det) < 1e-9) return;
            const GL = clamp((ay * bb - by * ab) / det, -12, 15);
            const GH = clamp((by * aa - ay * ab) / det, -15, 6);
            let se = 0, mx = 0;
            for (let i = 0; i < freqs.length; i++) {
                const m = (Math.abs(GL) > 0.05 ? db('lowshelf', freqs[i], LF, GL) : 0) + (Math.abs(GH) > 0.05 ? db('highshelf', freqs[i], HF, GH) : 0);
                const e = m - target[i]; se += e * e; mx = Math.max(mx, Math.abs(e));
            }
            const rms = Math.sqrt(se / freqs.length);
            if (!best || rms < best.rms) best = { lowF: LF, lowG: Math.round(GL * 10) / 10, highF: HF, highG: Math.round(GH * 10) / 10, rms: rms, maxErr: mx };
        }));
        return best;
    },

    loadImpedanceCurve: function (id) {
        if (!id) return Promise.resolve(null);
        if (this._impCache.has(id)) return Promise.resolve(this._impCache.get(id));
        if (this._impPending.has(id)) return this._impPending.get(id);
        const p = fetch('./data/impedance/' + encodeURIComponent(id) + '.txt')
            .then((res) => (res && res.ok ? res.text() : null))
            .then((txt) => (txt ? this.parseImpedanceText(txt) : null))
            .catch(() => null)
            .then((curve) => { this._impCache.set(id, curve); this._impPending.delete(id); return curve; });
        this._impPending.set(id, p);
        return p;
    },

    _adapterOptions: function () {
        const out = [];
        (this.gearSimOptions || []).forEach(function (g) {
            const m = /^adapter(\d+)$/.exec(g.id);
            if (!m) return;
            if (!g.generic) g.generic = { lowF: g.lowF, lowG: g.lowG, highF: g.highF, highG: g.highG, sub: g.sub };
            g.zo = parseInt(m[1], 10);
            out.push(g);
        });
        return out;
    },

    // Applies (or reverts) every adapter option from the CACHED curve of the
    // loaded base IEM. Synchronous: safe to call right before drawing.
    _adapterApplyCachedFit: function () {
        const id = this.getCurrentBaseIemId ? this.getCurrentBaseIemId() : null;
        const curve = id ? this._impCache.get(id) : null;
        this._adapterOptions().forEach((g) => {
            if (curve) {
                const fit = this.fitAdapterShelves(curve, g.zo);
                if (fit) {
                    g.lowF = fit.lowF; g.lowG = fit.lowG; g.highF = fit.highF; g.highG = fit.highG;
                    g.fitRmsDb = fit.rms;
                    const s = fit.lowG >= 0 ? '+' : '';
                    g.sub = s + fit.lowG.toFixed(1) + 'dB bass (measured Z)';
                    return;
                }
            }
            g.lowF = g.generic.lowF; g.lowG = g.generic.lowG; g.highF = g.generic.highF; g.highG = g.generic.highG;
            g.sub = g.generic.sub; g.fitRmsDb = undefined;
        });
    },

    refreshAdapterForCurrentIem: async function () {
        const id = this.getCurrentBaseIemId ? this.getCurrentBaseIemId() : null;
        if (id) await this.loadImpedanceCurve(id);
        // The base may have changed while the file was loading.
        if ((this.getCurrentBaseIemId ? this.getCurrentBaseIemId() : null) !== id) return;
        this._adapterApplyCachedFit();
        const gear = this.gearSimOptions && this.gearSimOptions[this.currentGearIdx || 0];
        if (gear && gear.zo) {
            const subEl = document.getElementById('gear-sim-sub-label');
            if (subEl) subEl.textContent = gear.sub;
            this.applyGearSimDSP();
            this.drawCurve();
        }
    },

    // Cheap check run on every redraw: when the base IEM changes, re-fit.
    _adapterSyncCheck: function () {
        const id = this.getCurrentBaseIemId ? this.getCurrentBaseIemId() : null;
        if (id === this._adapterLastBase) return;
        this._adapterLastBase = id;
        this.refreshAdapterForCurrentIem().catch(function (e) { console.warn('[Adapter Z] refresh failed:', e); });
    }
};
