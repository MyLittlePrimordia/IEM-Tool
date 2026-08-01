// ==========================================================================
// utils.js — CurveUtils: core high-precision DSP math (log grid generation,
// cubic-spline interpolation, dB normalization, gaussian smoothing, curve
// averaging). Extracted verbatim from the monolithic inline script (audit #4,
// first slice) — this is a pure math module with no dependency on any other
// app module (the one soft reference to PEQDB_Module is guarded with
// 'typeof PEQDB_Module !== undefined' and only resolves at call time, long
// after every script on the page has finished loading, so load order here
// doesn't matter).
//
// Deliberately still a plain global (not an ES module / import-export) for this
// first extraction step: CurveUtils is referenced by name in ~15 places across
// the rest of the still-monolithic script, and switching those to imports all
// at once is a much bigger, separate-risk change. This step only moves the
// code to its own file/network request; behavior and the global 'CurveUtils'
// identifier are unchanged, so nothing else needed to change to adopt it.
// ==========================================================================
    // ==========================================
    // 1. CURVEUTILS MODULE (CORE HIGH-PRECISION DSP MATH)
    // ==========================================
    const CurveUtils = {
generateLogGrid: function(numPoints = 500) {
            const grid = new Float32Array(numPoints);
            const minF = 20;
            const maxF = 20000;
            for (let i = 0; i < numPoints; i++) {
                grid[i] = minF * Math.pow(maxF / minF, i / (numPoints - 1));
            }
            return grid;
        },

                normalizeTo75dB: function(data, targetHz = null, referenceDb = null) {
            if (!data || data.length === 0) return [];
            const hz = targetHz !== null ? targetHz : (typeof PEQDB_Module !== 'undefined' ? PEQDB_Module.alignHz : 1000);
            const db = referenceDb !== null ? referenceDb : (typeof PEQDB_Module !== 'undefined' ? PEQDB_Module.alignDb : 75);

            let ref_db = 0;
            if (hz === 'mean') {
                let sum = 0, count = 0;
                for (let i = 0; i < data.length; i++) {
                    if (data[i][0] >= 500 && data[i][0] <= 2000) {
                        sum += data[i][1];
                        count++;
                    }
                }
                ref_db = count > 0 ? (sum / count) : data[0][1];
            } else {
                const freq = parseFloat(hz) || 500;
                let min_diff = Infinity;
                for (let i = 0; i < data.length; i++) {
                    const diff = Math.abs(data[i][0] - freq);
                    if (diff < min_diff) {
                        min_diff = diff;
                        ref_db = data[i][1];
                    }
                }
            }
            return data.map(pt => [pt[0], pt[1] - ref_db + db]);
        },

        cubicSplineInterpolate: function(points, targetFreqs) {
            if (!points || points.length < 2) return new Float32Array(targetFreqs.length).fill(75.0);

            // Deduplicate points with identical (or near-identical) log-frequency — duplicate/near-duplicate
            // x-values collapse the spline step (h[i]) to 0, which blows up the alpha/tridiagonal solve into
            // Infinity/NaN that then corrupts every interpolated value, not just the duplicated region.
            const rawX = [];
            const rawA = [];
            for (let i = 0; i < points.length; i++) {
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
            for (let i = 0; i < n - 1; i++) h[i] = Math.max(1e-6, x[i + 1] - x[i]); // safety floor, belt-and-suspenders

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
                const idx = Math.max(0, high);
                const dx = val - x[idx];
                results[k] = a[idx] + b[idx] * dx + c[idx] * dx * dx + d[idx] * dx * dx * dx;
            }
            return results;
        },

        gaussianSmooth: function(freqs, values, octaveBandwidth = 0.08) {
            const n = freqs.length;
            const smoothed = new Float32Array(n);
            const logFreqs = new Float32Array(n);
            for (let i = 0; i < n; i++) logFreqs[i] = Math.log10(freqs[i]);

            const sigma = octaveBandwidth * Math.log10(2);
            const factor = -1 / (2 * sigma * sigma);

            for (let i = 0; i < n; i++) {
                let weightSum = 0;
                let valueSum = 0;
                for (let j = 0; j < n; j++) {
                    const diff = logFreqs[i] - logFreqs[j];
                    const distSq = diff * diff;
                    if (distSq > 9 * sigma * sigma) continue; 
                    const w = Math.exp(distSq * factor);
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

            const numCurves = curves.length;
            const len = logGrid.length;
            const interpolatedMatrix = [];

            curves.forEach(c => {
                if (c.cachedInterp) {
                    interpolatedMatrix.push(c.cachedInterp);
                } else {
                    const norm = CurveUtils.normalizeTo75dB(c.data);
                    interpolatedMatrix.push(CurveUtils.cubicSplineInterpolate(norm, logGrid));
                }
            });

            const averaged = new Float32Array(len);
            for (let i = 0; i < len; i++) {
                const valuesAtFreq = [];
                for (let j = 0; j < numCurves; j++) {
                    valuesAtFreq.push(interpolatedMatrix[j][i]);
                }
                valuesAtFreq.sort((a, b) => a - b);
                let sum = 0;
                let count = 0;
                if (numCurves >= 4) {
                    const start = Math.floor(numCurves * 0.15);
                    const end = numCurves - start;
                    for (let k = start; k < end; k++) {
                        sum += valuesAtFreq[k];
                        count++;
                    }
                } else {
                    for (let k = 0; k < numCurves; k++) {
                        sum += valuesAtFreq[k];
                        count++;
                    }
                }
                averaged[i] = sum / count;
            }
            return this.gaussianSmooth(logGrid, averaged, 0.05);
        }
    };
