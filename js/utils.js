const CurveUtils = {
    generateLogGrid: function(numPoints = 500) {
        const n = Math.max(2, Math.floor(numPoints) || 500);
        const grid = new Float32Array(n);
        const minF = 20;
        const maxF = 20000;
        for (let i = 0; i < n; i++) {
            grid[i] = minF * Math.pow(maxF / minF, i / (n - 1));
        }
        return grid;
    },

    normalizeTo75dB: function(data, targetHz = null, referenceDb = null) {
        if (!data || !Array.isArray(data) || data.length === 0) return [];
        const hz = targetHz !== null ? targetHz : (typeof PEQDB_Module !== 'undefined' ? PEQDB_Module.alignHz : 1000);
        const db = referenceDb !== null ? referenceDb : (typeof PEQDB_Module !== 'undefined' ? PEQDB_Module.alignDb : 75);

        let ref_db = 0;
        if (hz === 'mean') {
            let sum = 0, count = 0;
            for (let i = 0; i < data.length; i++) {
                if (data[i] && typeof data[i][0] === 'number' && typeof data[i][1] === 'number') {
                    if (data[i][0] >= 500 && data[i][0] <= 2000) {
                        sum += data[i][1];
                        count++;
                    }
                }
            }
            ref_db = count > 0 ? (sum / count) : (data[0] && typeof data[0][1] === 'number' ? data[0][1] : 75);
        } else {
            const freq = parseFloat(hz) || 500;
            let min_diff = Infinity;
            for (let i = 0; i < data.length; i++) {
                if (data[i] && typeof data[i][0] === 'number' && typeof data[i][1] === 'number') {
                    const diff = Math.abs(data[i][0] - freq);
                    if (diff < min_diff) {
                        min_diff = diff;
                        ref_db = data[i][1];
                    }
                }
            }
            if (min_diff === Infinity && data[0] && typeof data[0][1] === 'number') {
                ref_db = data[0][1];
            }
        }
        return data.filter(pt => pt && typeof pt[0] === 'number' && typeof pt[1] === 'number')
                   .map(pt => [pt[0], pt[1] - ref_db + db]);
    },

    cubicSplineInterpolate: function(points, targetFreqs) {
        if (!points || points.length < 2) return new Float32Array(targetFreqs.length).fill(75.0);

        const rawX = [];
        const rawA = [];
        for (let i = 0; i < points.length; i++) {
            if (!points[i] || typeof points[i][0] !== 'number' || typeof points[i][1] !== 'number') continue;
            const lx = Math.log10(points[i][0]);
            if (rawX.length === 0 || lx > rawX[rawX.length - 1] + 1e-6) {
                rawX.push(lx);
                rawA.push(points[i][1]);
            }
        }
        if (rawX.length < 2) return new Float32Array(targetFreqs.length).fill(rawA[0] != null ? rawA[0] : 75.0);

        const n = rawX.length;
        const x = new Float32Array(rawX);
        const a = new Float32Array(rawA);

        const h = new Float32Array(n - 1);
        for (let i = 0; i < n - 1; i++) h[i] = Math.max(1e-6, x[i + 1] - x[i]);

        const alpha = new Float32Array(n - 1);
        for (let i = 1; i < n - 1; i++) {
            alpha[i] = (3 / h[i]) * (a[i + 1] - a[i]) - (3 / h[i - 1]) * (a[i] - a[i - 1]);
        }

        const l = new Float32Array(n);
        const mu = new Float32Array(n);
        const z = new Float32Array(n);
        l[0] = 1; mu[0] = 0; z[0] = 0;

        for (let i = 1; i < n - 1; i++) {
            l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
            mu[i] = h[i] / l[i];
            z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
        }
        l[n - 1] = 1; z[n - 1] = 0;

        const c = new Float32Array(n);
        const b = new Float32Array(n - 1);
        const d = new Float32Array(n - 1);
        c[n - 1] = 0;

        for (let j = n - 2; j >= 0; j--) {
            c[j] = z[j] - mu[j] * c[j + 1];
            b[j] = (a[j + 1] - a[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
            d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
        }

        const results = new Float32Array(targetFreqs.length);
        for (let k = 0; k < targetFreqs.length; k++) {
            const val = Math.log10(targetFreqs[k]);
            if (val <= x[0]) {
                results[k] = a[0];
                continue;
            }
            if (val >= x[n - 1]) {
                results[k] = a[n - 1];
                continue;
            }
            let low = 0, high = n - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                if (x[mid] === val) { low = mid; break; }
                if (x[mid] < val) low = mid + 1;
                else high = mid - 1;
            }
            const idx = Math.min(n - 2, Math.max(0, high));
            const dx = val - x[idx];
            results[k] = a[idx] + b[idx] * dx + c[idx] * dx * dx + d[idx] * dx * dx * dx;
        }
        return results;
    },

    // ---- Shared perceptual model -------------------------------------------------
    // One frequency->importance table feeds the classifier axis weights, the
    // similar-curve ranking and the auto-EQ solve weights, so every feature
    // agrees on which bands matter most (mid/vocal heavy, air & sub noisy).
    PERCEPTUAL_WEIGHTS: [
        [20, 0.30], [31, 0.45], [62, 0.70], [125, 0.90], [250, 1.00], [500, 1.10],
        [1000, 1.20], [2000, 1.35], [3000, 1.30], [4000, 1.20], [6000, 1.00],
        [8000, 0.90], [10000, 0.80], [12000, 0.65], [14000, 0.50], [16000, 0.40],
        [20000, 0.30]
    ],

    weightFor: function(freq) {
        const f = parseFloat(freq) || 1000;
        const table = this.PERCEPTUAL_WEIGHTS;
        if (f <= table[0][0]) return table[0][1];
        if (f >= table[table.length - 1][0]) return table[table.length - 1][1];
        let lo = 0;
        while (lo < table.length - 2 && table[lo + 1][0] < f) lo++;
        const x0 = table[lo][0], x1 = table[lo + 1][0];
        const t = (x1 > x0) ? Math.log(f / x0) / Math.log(x1 / x0) : 0;
        return table[lo][1] + (table[lo + 1][1] - table[lo][1]) * t;
    },

    // Tonal anchor band used for level-offset correction (constant dB removed
    // before scoring) so same-shape curves differing only in average level
    // still rank as matches.
    MID_MEAN_BAND: [300, 3000],

    // Canonical log-spaced probes for similarity ranking (20 Hz - 16 kHz).
    SIM_PROBE_FREQS: [20, 31, 62, 125, 250, 500, 1000, 2000, 3000, 4000, 6000,
        8000, 10000, 12000, 14000, 16000],

    // Map probe freqs to nearest indices of a monotonic log grid.
    probeIndices: function(gridFreqs, probeFreqs) {
        const list = probeFreqs || this.SIM_PROBE_FREQS;
        const n = gridFreqs.length;
        return list.map(f => {
            if (f <= gridFreqs[0]) return 0;
            if (f >= gridFreqs[n - 1]) return n - 1;
            let lo = 0, hi = n - 1;
            while (lo + 1 < hi) {
                const mid = (lo + hi) >> 1;
                if (gridFreqs[mid] < f) lo = mid; else hi = mid;
            }
            return (f - gridFreqs[lo]) <= (gridFreqs[hi] - f) ? lo : hi;
        });
    },

    // 5-axis classification bands. Each band's lo/hi now meets its neighbors
    // at the geometric-mean boundary between adjacent centers (and the outer
    // two extend to the edges of the audible range), so the six windows tile
    // the full 20Hz-20kHz spectrum with NO gaps between them. The previous
    // version used narrow islands (e.g. 25-45, 85-160) with large silent gaps
    // between them (45-85, 160-400, 650-2000, 3200-6500, 9500-11500) - any EQ
    // band whose *frequency* (not just gain) landed in one of those gaps was
    // invisible to the genre classifier, which is why dragging a dot
    // horizontally on the graph barely moved the Find-tab genre badge even
    // though the curve visibly changed shape. With contiguous coverage, every
    // point on the curve - and therefore any horizontal drag anywhere on the
    // graph - now lands inside exactly one axis band and measurably shifts
    // its average, so the badge tracks the drawn curve shape everywhere, not
    // just at a few pre-selected frequencies. Order matches the
    // [subBoost, warmth, vocal, treble, air] axes used by the genre families.
    AXIS_BANDS: [
        { center: 30, lo: 20, hi: 54.77 },
        { center: 100, lo: 54.77, hi: 223.61 },
        { center: 500, lo: 223.61, hi: 1118.03 },
        { center: 2500, lo: 1118.03, hi: 4472.14 },
        { center: 8000, lo: 4472.14, hi: 10583.01 },
        { center: 14000, lo: 10583.01, hi: 20000 }
    ],

    // Average the curve's spline over each band (9 log-spaced samples per band).
    bandAverages: function(points, bands) {
        const out = [];
        // cubicSplineInterpolate rebuilds the whole tridiagonal solve on every
        // call, so evaluating it once per sample (54 calls across 6 bands x 9
        // samples) was 54 full spline solves per curve. Build every sample
        // frequency across all bands up front and do a single solve, then
        // slice the results back out per band - same output, one spline build.
        const samplesPerBand = 9;
        const allFreqs = new Array(bands.length * samplesPerBand);
        let idx = 0;
        for (let b = 0; b < bands.length; b++) {
            const lo = bands[b].lo, hi = bands[b].hi;
            for (let k = 0; k <= 8; k++) {
                allFreqs[idx++] = lo * Math.pow(hi / lo, k / 8);
            }
        }
        const allInterp = this.cubicSplineInterpolate(points, allFreqs);
        for (let b = 0; b < bands.length; b++) {
            let sum = 0, count = 0;
            const base = b * samplesPerBand;
            for (let k = 0; k < samplesPerBand; k++) {
                sum += allInterp[base + k];
                count++;
            }
            out.push(count > 0 ? sum / count : 0);
        }
        return out;
    },

    // Average a dense dB response (parallel freq/dB arrays) over each band.
    responseBandMeans: function(freqsData, respData, bands) {
        const out = [];
        for (let b = 0; b < bands.length; b++) {
            const lo = bands[b].lo, hi = bands[b].hi;
            let sum = 0, count = 0;
            for (let j = 0; j < freqsData.length; j++) {
                const f = freqsData[j];
                if (f >= lo && f <= hi) { sum += respData[j]; count++; }
            }
            out.push(count > 0 ? sum / count : 0);
        }
        return out;
    },

    // Per-axis weights derived from PERCEPTUAL_WEIGHTS [sub, warmth, vocal,
    // treble, air] - axes 0,1,3,4,5 of AXIS_BANDS (index 2 is the mids ref).
    axisScoreWeights: function() {
        const bands = this.AXIS_BANDS;
        const axes = [0, 1, 3, 4, 5];
        return axes.map(bi => {
            const b = bands[bi];
            let sum = 0, count = 0;
            for (let k = 0; k <= 8; k++) {
                const f = b.lo * Math.pow(b.hi / b.lo, k / 8);
                sum += this.weightFor(f);
                count++;
            }
            return count > 0 ? sum / count : 1.0;
        });
    },

    // Level-offset-corrected, perceptually weighted MAE between two curves
    // indexed through `probes` (grid indices). Returns similarity % in [0,100].
    similarityScore: function(targetInterp, candInterp, probes, weights, midMask, threshold) {
        const n = probes.length;
        let wSum = 0, wErr = 0, wMid = 0, wMidW = 0;
        for (let i = 0; i < n; i++) {
            const d = targetInterp[probes[i]] - candInterp[probes[i]];
            const w = weights[i];
            wSum += w;
            wErr += w * Math.abs(d);
            if (midMask[i]) { wMid += w * d; wMidW += w; }
        }
        const offset = wMidW > 0 ? wMid / wMidW : 0;
        let adjErr = 0, adjW = 0;
        for (let i = 0; i < n; i++) {
            const d = targetInterp[probes[i]] - candInterp[probes[i]];
            adjErr += weights[i] * Math.abs(d - offset);
            adjW += weights[i];
        }
        const mae = adjW > 0 ? adjErr / adjW : 0;
        return {
            mae: mae,
            similarity: Math.max(0, Math.min(100, 100 * (1 - (mae / (threshold || 8))))),
            offset: offset
        };
    },

    gaussianSmooth: function(freqs, values, octaveBandwidth = 0.08) {
        const n = freqs.length;
        const smoothed = new Float32Array(n);
        const logFreqs = new Float32Array(n);
        for (let i = 0; i < n; i++) logFreqs[i] = Math.log10(freqs[i]);

        const sigma = octaveBandwidth * Math.log10(2);
        const factor = -1 / (2 * sigma * sigma);
        const cutoff = 3 * sigma;

        // logFreqs is monotonically increasing, so the gaussian kernel is
        // band-limited: only points within 3 sigma in log-frequency matter.
        // Slide [jStart, jEnd) along with i instead of rescanning the full
        // array every row (was O(n^2), now O(n * windowWidth)).
        let jStart = 0, jEnd = 0;
        for (let i = 0; i < n; i++) {
            while (jEnd < n && logFreqs[jEnd] <= logFreqs[i] + cutoff) jEnd++;
            while (logFreqs[jStart] < logFreqs[i] - cutoff) jStart++;
            let weightSum = 0;
            let valueSum = 0;
            for (let j = jStart; j < jEnd; j++) {
                const diff = logFreqs[i] - logFreqs[j];
                const w = Math.exp(diff * diff * factor);
                valueSum += values[j] * w;
                weightSum += w;
            }
            smoothed[i] = weightSum > 0 ? valueSum / weightSum : values[i];
        }
        return smoothed;
    },

    averageCurves: function(curves, logGrid) {
        if (!curves || curves.length === 0) return new Float32Array(logGrid.length).fill(75.0);
        if (curves.length === 1) return curves[0].cachedInterp || this.cubicSplineInterpolate(curves[0].data, logGrid);

        const len = logGrid.length;
        const interpolatedMatrix = [];

        curves.forEach(c => {
            if (c && c.cachedInterp) {
                interpolatedMatrix.push(c.cachedInterp);
            } else if (c && c.data) {
                const norm = CurveUtils.normalizeTo75dB(c.data);
                interpolatedMatrix.push(CurveUtils.cubicSplineInterpolate(norm, logGrid));
            }
        });

        if (interpolatedMatrix.length === 0) return new Float32Array(logGrid.length).fill(75.0);

        const activeNumCurves = interpolatedMatrix.length;
        const averaged = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            const valuesAtFreq = [];
            for (let j = 0; j < activeNumCurves; j++) {
                valuesAtFreq.push(interpolatedMatrix[j][i]);
            }
            valuesAtFreq.sort((a, b) => a - b);
            let sum = 0;
            let count = 0;
            if (activeNumCurves >= 4) {
                const start = Math.floor(activeNumCurves * 0.15);
                const end = activeNumCurves - start;
                for (let k = start; k < end; k++) {
                    sum += valuesAtFreq[k];
                    count++;
                }
            } else {
                for (let k = 0; k < activeNumCurves; k++) {
                    sum += valuesAtFreq[k];
                    count++;
                }
            }
            averaged[i] = count > 0 ? (sum / count) : 75.0;
        }
        return this.gaussianSmooth(logGrid, averaged, 0.05);
    }
};
