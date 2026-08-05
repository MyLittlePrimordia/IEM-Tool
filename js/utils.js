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
