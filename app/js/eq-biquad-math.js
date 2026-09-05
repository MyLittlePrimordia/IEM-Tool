// Split out of eq-core.js (2026 god-file refactor, Step 2).
// RBJ biquad magnitude evaluation — the EXACT coefficient math the worklet
// runs (dsp-processor.js), used by the graph renderer, the exporters, and the
// AutoEQ solver so drawn/exported curves match the audible response. Pure
// function except for the SharedAudio sample-rate read; merged into EQ_Module
// via Object.assign in db-cache.js.
const EQ_BiquadMathMethods = {
        _biquadCoeffs: function(type, f0, Q, G, Fs) {
            const rawFs = Fs || (window.SharedAudio && SharedAudio.ctx ? SharedAudio.ctx.sampleRate : 44100);
            const activeFs = Number.isFinite(rawFs) && rawFs >= 2000 ? rawFs : 44100;
            const maxF0 = Math.min(activeFs * 0.45, activeFs / 2 - 1000);
            const safeF0 = Math.max(10, Math.min(maxF0, Number.isFinite(f0) ? f0 : 1000));
            const safeQ = Math.max(0.01, Math.min(50, Number.isFinite(Q) ? Q : 1.0));
            const safeG = Math.max(-40, Math.min(40, Number.isFinite(G) ? G : 0));
            return { activeFs, safeF0, safeQ, safeG };
        },
        getBiquadComplex: function(type, f, f0, Q, G, Fs = null) {
            if ((G === 0 || !Number.isFinite(G)) && (type === 'peaking' || type === 'lowshelf' || type === 'highshelf')) return [1, 0];
            const { activeFs, safeF0, safeQ, safeG } = this._biquadCoeffs(type, f0, Q, G, Fs);
            const fClamped = Math.max(1.0, Number.isFinite(f) ? f : 1000);
            // Nyquist-mirror guard: evaluation above Fs/2 mirrors instead of
            // representing a real response; clamp into (0, Fs/2).
            const fEval = Math.min(fClamped, activeFs / 2 * 0.999);
            const w = 2 * Math.PI * fEval / activeFs;
            const cosW = Math.cos(w);
            const sinW = Math.sin(w);

            // Clamp to 0.45xSR with a >=1 kHz margin from Nyquist. MUST stay
            // identical to BiquadFilter.updateCoefficients (dsp-processor.js).
            const w0 = 2 * Math.PI * safeF0 / activeFs;
            const cosW0 = Math.cos(w0);
            const sinW0 = Math.sin(w0);
            const A = Math.pow(10, safeG / 40);

            let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

            if (type === 'peaking') {
                const alpha = sinW0 / (2 * safeQ);
                b0 = 1 + alpha * A;
                b1 = -2 * cosW0;
                b2 = 1 - alpha * A;
                a0 = 1 + alpha / A;
                a1 = -2 * cosW0;
                a2 = 1 - alpha / A;
            } else if (type === 'lowshelf') {
                const alpha = (typeof CurveUtils !== 'undefined' && CurveUtils.computeShelfAlpha)
                    ? CurveUtils.computeShelfAlpha(sinW0, A, safeQ)
                    : (sinW0 / 2) * Math.sqrt(Math.max(0.02, (A + 1 / A) * (1 / Math.max(0.3, Math.min(3.0, safeQ)) - 1) + 2));

                b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
                b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = -2 * ((A - 1) + (A + 1) * cosW0);
                a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
            } else if (type === 'highshelf') {
                const alpha = (typeof CurveUtils !== 'undefined' && CurveUtils.computeShelfAlpha)
                    ? CurveUtils.computeShelfAlpha(sinW0, A, safeQ)
                    : (sinW0 / 2) * Math.sqrt(Math.max(0.02, (A + 1 / A) * (1 / Math.max(0.3, Math.min(3.0, safeQ)) - 1) + 2));

                b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
                b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = 2 * ((A - 1) - (A + 1) * cosW0);
                a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
            } else if (type === 'lowpass') {
                const alpha = sinW0 / (2 * safeQ);
                b0 = (1 - cosW0) / 2;
                b1 = 1 - cosW0;
                b2 = (1 - cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else if (type === 'highpass') {
                const alpha = sinW0 / (2 * safeQ);
                b0 = (1 + cosW0) / 2;
                b1 = -(1 + cosW0);
                b2 = (1 + cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else if (type === 'notch') {
                const alpha = sinW0 / (2 * safeQ);
                b0 = 1;
                b1 = -2 * cosW0;
                b2 = 1;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else {
                return [1, 0];
            }

            const nB0 = b0 / a0, nB1 = b1 / a0, nB2 = b2 / a0;
            const nA1 = a1 / a0, nA2 = a2 / a0;

            const cos2W = cosW * cosW - sinW * sinW;
            const sin2W = 2 * sinW * cosW;

            const numReal = nB0 + nB1 * cosW + nB2 * cos2W;
            const numImag = -(nB1 * sinW + nB2 * sin2W);
            const denReal = 1 + nA1 * cosW + nA2 * cos2W;
            const denImag = -(nA1 * sinW + nA2 * sin2W);
            const denMag2 = denReal * denReal + denImag * denImag;
            const safeDen = Math.max(1e-12, denMag2);
            if (!Number.isFinite(safeDen) || !Number.isFinite(numReal) || !Number.isFinite(numImag) || !Number.isFinite(denReal) || !Number.isFinite(denImag)) return [1, 0];
            // (a+ib)/(c+id) = ((ac+bd) + i(bc-ad)) / (c^2+d^2)
            const re = (numReal * denReal + numImag * denImag) / safeDen;
            const im = (numImag * denReal - numReal * denImag) / safeDen;
            return Number.isFinite(re) && Number.isFinite(im) ? [re, im] : [1, 0];
        },
        getBiquadMagnitude: function(type, f, f0, Q, G, Fs = null) {
            const c = this.getBiquadComplex(type, f, f0, Q, G, Fs);
            const mag = Math.sqrt(c[0] * c[0] + c[1] * c[1]);
            return Number.isFinite(mag) ? mag : 1.0;
        },


};
