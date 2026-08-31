// Smoothing time constant in seconds (independent of sample rate).
// At 44.1 kHz this equals the old hardcoded value 200/44100 ≈ 4.5 ms.
const SMOOTHING_TIME_CONSTANT_SECONDS = 0.0045;
const COEFF_SMOOTHING_TAU = 0.00017; // ~0.125 at 44.1k, derived from 1-exp(-1/(tau*SR))

function computeSmoothingFactor(sampleRate) {
    return 1 - Math.exp(-1 / (SMOOTHING_TIME_CONSTANT_SECONDS * sampleRate));
}
function computeCoeffSmoothingFactor(sampleRate) {
    return 1 - Math.exp(-1 / (COEFF_SMOOTHING_TAU * sampleRate));
}

// Shared RBJ shelf alpha — must stay identical to CurveUtils.computeShelfAlpha in utils.js
function computeShelfAlpha(sinW0, A, Q) {
    const shelfQ = Math.max(0.3, Math.min(3.0, Number.isFinite(Q) ? Q : 1.0));
    const inner = (A + 1 / A) * (1 / shelfQ - 1) + 2;
    return (sinW0 / 2) * Math.sqrt(Math.max(0.02, inner));
}

class BiquadFilter {
    constructor() {
        // Active Coefficients (Currently running in processing loop)
        this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0;
        this.a1 = 0.0; this.a2 = 0.0;

        // Target Coefficients (Interpolated towards over sub-samples)
        this.target_b0 = 1.0; this.target_b1 = 0.0; this.target_b2 = 0.0;
        this.target_a1 = 0.0; this.target_a2 = 0.0;

        // Active Parameters
        this.frequency = 1000.0;
        this.gain = 0.0;
        this.q = 1.0;

        // Target Parameters
        this.target_frequency = 1000.0;
        this.target_gain = 0.0;
        this.target_q = 1.0;

        // History states (Stereo Transposed Direct Form II)
        this.s1_L = 0.0; this.s2_L = 0.0;
        this.s1_R = 0.0; this.s2_R = 0.0;
        // Second-stage state for 4th-order LR cascade (two identical
        // 2nd-order sections per edge). Sharing s1/s2 between the two
        // passes corrupts the cascade (state of stage 1 bleeds into stage 2).
        this.s1b_L = 0.0; this.s2b_L = 0.0;
        this.s1b_R = 0.0; this.s2b_R = 0.0;

        this.bypassed = true;
        this.type = 'peaking';

        this.RECALC_INTERVAL = 8;
        this.recalcCounter = 1;
        this.coeffsCurrent = true;
        this.coeffsRamped = true;
    }

    reset() {
        this.s1_L = 0.0; this.s2_L = 0.0;
        this.s1_R = 0.0; this.s2_R = 0.0;
        this.s1b_L = 0.0; this.s2b_L = 0.0;
        this.s1b_R = 0.0; this.s2b_R = 0.0;
    }

    updateCoefficients(type, freq, gain, q, sampleRate, wasBypassed) {
        this.type = type;
        
        // Clamp to 0.45×SR with at least 1 kHz margin from Nyquist to prevent
        // instability of high-Q filters near fs/2. At 44.1 kHz: maxFreq = 19.845 kHz.
        // MUST stay identical to getBiquadMagnitude (app-core.js), which draws
        // and exports the response of the coefficients built here.
        const maxFreq = Math.min(sampleRate * 0.45, sampleRate / 2 - 1000);
        this.target_frequency = Math.max(10, Math.min(maxFreq, Number.isFinite(freq) ? freq : 1000));
        this.target_gain = Math.max(-40, Math.min(40, Number.isFinite(gain) ? gain : 0.0));
        this.target_q = Math.max(0.01, Math.min(50, Number.isFinite(q) ? q : 1.0));

        if (wasBypassed && !this.bypassed) {
            this.reset();
            this.frequency = this.target_frequency;
            this.gain = this.target_gain;
            this.q = this.target_q;
            this.calculateCoefficients(this.frequency, this.gain, this.target_q, sampleRate);
            this.snapCoefficients();
            this.coeffsCurrent = true;
            this.coeffsRamped = true;
            this.recalcCounter = this.RECALC_INTERVAL;
        } else if (!this.bypassed) {
            this.coeffsCurrent = false;
            this.coeffsRamped = false;
            this.recalcCounter = 1;
        }
    }

    snapCoefficients() {
        this.b0 = this.target_b0; this.b1 = this.target_b1; this.b2 = this.target_b2;
        this.a1 = this.target_a1; this.a2 = this.target_a2;
    }

    calculateCoefficients(freq, gain, q, sampleRate) {
        const w0 = 2 * Math.PI * freq / sampleRate;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const A = Math.pow(10, gain / 40);
        // Shared helper above — single source of truth with utils.js
        const alpha = (this.type === 'lowshelf' || this.type === 'highshelf')
            ? computeShelfAlpha(sinW0, A, q)
            : sinW0 / (2 * (Number.isFinite(q) && q > 1e-6 ? q : 1.0));

        let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

        switch (this.type) {
            case 'peaking':
                b0 = 1 + alpha * A;
                b1 = -2 * cosW0;
                b2 = 1 - alpha * A;
                a0 = 1 + alpha / A;
                a1 = -2 * cosW0;
                a2 = 1 - alpha / A;
                break;
            case 'lowshelf': {
                b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
                b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = -2 * ((A - 1) + (A + 1) * cosW0);
                a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
                break;
            }
            case 'highshelf': {
                b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
                b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = 2 * ((A - 1) - (A + 1) * cosW0);
                a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
                break;
            }
            case 'lowpass':
                b0 = (1 - cosW0) / 2;
                b1 = 1 - cosW0;
                b2 = (1 - cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
            case 'highpass':
                b0 = (1 + cosW0) / 2;
                b1 = -(1 + cosW0);
                b2 = (1 + cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
            case 'notch':
                b0 = 1;
                b1 = -2 * cosW0;
                b2 = 1;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
                break;
            default:
                b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
                break;
        }

        const div = (Number.isFinite(a0) && a0 !== 0) ? a0 : 1.0;
        this.target_b0 = b0 / div;
        this.target_b1 = b1 / div;
        this.target_b2 = b2 / div;
        this.target_a1 = a1 / div;
        this.target_a2 = a2 / div;
    }

    stepSmoothing(smoothingFactor, sampleRate) {
        if (!this.coeffsRamped) {
            const freqDiff = Math.abs(this.target_frequency - this.frequency);
            const gainDiff = Math.abs(this.target_gain - this.gain);
            const qDiff = Math.abs(this.target_q - this.q);
            const settled = freqDiff <= 0.01 && gainDiff <= 0.01 && qDiff <= 0.001;

            if (!settled) {
                this.frequency += (this.target_frequency - this.frequency) * smoothingFactor;
                this.gain += (this.target_gain - this.gain) * smoothingFactor;
                this.q += (this.target_q - this.q) * smoothingFactor;

                this.recalcCounter--;
                if (this.recalcCounter <= 0) {
                    this.calculateCoefficients(this.frequency, this.gain, this.q, sampleRate);
                    this.recalcCounter = this.RECALC_INTERVAL;
                }
            } else if (!this.coeffsCurrent) {
                this.frequency = this.target_frequency;
                this.gain = this.target_gain;
                this.q = this.target_q;
                this.calculateCoefficients(this.frequency, this.gain, this.q, sampleRate);
                this.snapCoefficients();
                this.coeffsCurrent = true;
            }

            // Sub-sample linear ramping, SR-dependent
            const coeffLerp = Math.min(0.5, smoothingFactor * 25);
            this.b0 += (this.target_b0 - this.b0) * coeffLerp;
            this.b1 += (this.target_b1 - this.b1) * coeffLerp;
            this.b2 += (this.target_b2 - this.b2) * coeffLerp;
            this.a1 += (this.target_a1 - this.a1) * coeffLerp;
            this.a2 += (this.target_a2 - this.a2) * coeffLerp;

            if (this.coeffsCurrent && Math.max(Math.abs(this.b0 - this.target_b0), Math.abs(this.b1 - this.target_b1), Math.abs(this.b2 - this.target_b2), Math.abs(this.a1 - this.target_a1), Math.abs(this.a2 - this.target_a2)) < 1e-6) {
                this.snapCoefficients();
                this.coeffsRamped = true;
            }
        }
    }

    _updateCoeffsIfNeeded(smoothingFactor, sampleRate) {
        if (smoothingFactor === undefined || !Number.isFinite(smoothingFactor)) smoothingFactor = 0.0045;
        if (sampleRate === undefined || !Number.isFinite(sampleRate)) sampleRate = 44100;
        this.stepSmoothing(smoothingFactor, sampleRate);
    }

    processSampleL(x, smoothingFactor, sampleRate) {
        this.stepSmoothing(smoothingFactor !== undefined ? smoothingFactor : 0.0045, sampleRate !== undefined ? sampleRate : 44100);

        const y = x * this.b0 + this.s1_L;
        this.s1_L = x * this.b1 - this.a1 * y + this.s2_L;
        this.s2_L = x * this.b2 - this.a2 * y;

        // Fast denormal flush
        if (Math.abs(this.s1_L) < 1e-15) this.s1_L = 0.0;
        if (Math.abs(this.s2_L) < 1e-15) this.s2_L = 0.0;

        return y;
    }

    processSampleR(x) {
        const y = x * this.b0 + this.s1_R;
        this.s1_R = x * this.b1 - this.a1 * y + this.s2_R;
        this.s2_R = x * this.b2 - this.a2 * y;

        if (Math.abs(this.s1_R) < 1e-15) this.s1_R = 0.0;
        if (Math.abs(this.s2_R) < 1e-15) this.s2_R = 0.0;

        return y;
    }

    processSampleL_4th(x, smoothingFactor, sampleRate) {
        this.stepSmoothing(smoothingFactor !== undefined ? smoothingFactor : 0.0045, sampleRate !== undefined ? sampleRate : 44100);
        // stage 1
        let y1 = x * this.b0 + this.s1_L;
        this.s1_L = x * this.b1 - this.a1 * y1 + this.s2_L;
        this.s2_L = x * this.b2 - this.a2 * y1;
        if (Math.abs(this.s1_L) < 1e-15) this.s1_L = 0.0;
        if (Math.abs(this.s2_L) < 1e-15) this.s2_L = 0.0;
        // stage 2 (independent state, same coeffs)
        let y2 = y1 * this.b0 + this.s1b_L;
        this.s1b_L = y1 * this.b1 - this.a1 * y2 + this.s2b_L;
        this.s2b_L = y1 * this.b2 - this.a2 * y2;
        if (Math.abs(this.s1b_L) < 1e-15) this.s1b_L = 0.0;
        if (Math.abs(this.s2b_L) < 1e-15) this.s2b_L = 0.0;
        return y2;
    }

    processSampleR_4th(x) {
        // stage 1
        let y1 = x * this.b0 + this.s1_R;
        this.s1_R = x * this.b1 - this.a1 * y1 + this.s2_R;
        this.s2_R = x * this.b2 - this.a2 * y1;
        if (Math.abs(this.s1_R) < 1e-15) this.s1_R = 0.0;
        if (Math.abs(this.s2_R) < 1e-15) this.s2_R = 0.0;
        // stage 2
        let y2 = y1 * this.b0 + this.s1b_R;
        this.s1b_R = y1 * this.b1 - this.a1 * y2 + this.s2b_R;
        this.s2b_R = y1 * this.b2 - this.a2 * y2;
        if (Math.abs(this.s1b_R) < 1e-15) this.s1b_R = 0.0;
        if (Math.abs(this.s2b_R) < 1e-15) this.s2b_R = 0.0;
        return y2;
    }
}

// Central slot maps (must stay in sync with renderer eq-* modules).
// Used for asserts to catch last-write clobbers when a new sim reuses a slot.
const SIM_SLOT_MAP = Object.freeze({
    eartip: [0,1,2,3,4], deEsser: 5, tape: [6,7], loudness: [8,9],
    dac: [10,11], hearing: [12,13,14,15,16,17,18,19], gear: [20,21], masterTone: [22,23]
});
const XO_GAIN_SLOTS = Object.freeze({ low: 0, lowMid: 1, mid: 2, highMid: 3, high: 4 });

class DspProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sampleRate = globalThis.sampleRate || 44100;
        this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
        
        this.preampDb = 0.0;
        this.preampGain = 1.0;
        this.targetPreampGain = 1.0;

        this.filters = Array.from({ length: 80 }, () => new BiquadFilter());
        // Simulation slot map (must stay in sync with the renderer):
        //   0-4   eartip sim          5   de-esser
        //   6-7   tape-mod            8-9   loudness
        //   10-11 DAC source sim      12-19 hearing calibration
        //   20-21 gear sim            22-23 master tone
        this.simFilters = Array.from({ length: 24 }, () => new BiquadFilter());
        this.xoFilters = Array.from({ length: 10 }, () => new BiquadFilter());

        this.activeFilters = [];
        this.activeSimFilters = [];

        this.xoEnabled = false;
        this.xoType = '3way';
        this.xoGains = [1.0, 1.0, 1.0, 1.0, 1.0];

        this.port.onmessage = (event) => this.handleMessage(event.data);
    }

    updateActiveLists() {
        // In-place to avoid per-message GC on the audio thread
        this.activeFilters.length = 0;
        for (let i = 0; i < this.filters.length; i++) if (!this.filters[i].bypassed) this.activeFilters.push(this.filters[i]);
        this.activeSimFilters.length = 0;
        for (let i = 0; i < this.simFilters.length; i++) if (!this.simFilters[i].bypassed) this.activeSimFilters.push(this.simFilters[i]);
    }

    handleMessage(data) {
        try {
            this._handleMessageInner(data);
        } catch (err) {
            // A malformed message must never kill the audio worklet: report
            // it back to the main thread with structured error info and keep
            // processing with the last good filter state.
            const errorInfo = {
                type: 'error',
                error: String(err && err.message ? err.message : err),
                code: this._classifyError(err),
                context: data ? data.type : 'unknown'
            };
            try {
                this.port.postMessage(errorInfo);
            } catch (_) {}
        }
    }

    _classifyError(err) {
        const msg = String(err && err.message ? err.message : err).toLowerCase();
        if (msg.includes('cannot read') || msg.includes('undefined') || msg.includes('null')) return 'INVALID_STATE';
        if (msg.includes('index') || msg.includes('out of bounds')) return 'INVALID_INDEX';
        if (msg.includes('filter') || msg.includes('biquad') || msg.includes('coefficient')) return 'DSP_MATH_ERROR';
        if (msg.includes('message') || msg.includes('postmessage') || msg.includes('port')) return 'IPC_ERROR';
        if (msg.includes('sample rate') || msg.includes('samplerate')) return 'SAMPLE_RATE_MISMATCH';
        return 'UNKNOWN';
    }

    _handleMessageInner(data) {
        if (!data || typeof data !== 'object') return;

        if (data.type === 'init') {
            if (data.sampleRate) {
                this.sampleRate = data.sampleRate;
                this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
            }
        } 
        else if (data.type === 'updatePreamp') {
            const db = Number.isFinite(data.preampDb) ? data.preampDb : 0.0;
            // Trust-boundary clamp: an unbounded preampDb (e.g. NaN-adjacent
            // extreme values from a corrupted message) can make
            // Math.pow(10, db/20) evaluate to Infinity, which then poisons
            // the per-sample smoother below into NaN permanently (verified:
            // no subsequent message, including 'reset', can recover it once
            // that happens -- see the self-heal guard in process() for the
            // second layer of defense).
            this.preampDb = Math.max(-60, Math.min(60, db));
            this.targetPreampGain = Math.pow(10, this.preampDb / 20);
        } 
        else if (data.type === 'updateFilters' && Array.isArray(data.filters)) {
            data.filters.forEach(fData => {
                if (fData && fData.index !== undefined) {
                    const f = this.filters[fData.index];
                    if (f) {
                        const wasBypassed = f.bypassed;
                        f.bypassed = fData.bypassed;
                        f.updateCoefficients(fData.filterType, fData.frequency, fData.gain, fData.q, this.sampleRate, wasBypassed);
                    }
                }
            });
            this.updateActiveLists();
        }
        else if (data.type === 'updateSimulations' && Array.isArray(data.sims)) {
            data.sims.forEach(sData => {
                if (sData && sData.index !== undefined) {
                    const f = this.simFilters[sData.index];
                    if (f) {
                        const wasBypassed = f.bypassed;
                        f.bypassed = sData.bypassed;
                        f.updateCoefficients(sData.filterType, sData.frequency, sData.gain, sData.q, this.sampleRate, wasBypassed);
                    }
                }
            });
            this.updateActiveLists();
        }
        else if (data.type === 'updateCrossover') {
            this.xoEnabled = !!data.enabled;
            this.xoType = data.xoType || '3way';
            if (Array.isArray(data.gains)) {
                this.xoGains = data.gains.map(g => Number.isFinite(g) ? g : 1.0);
            }
            if (Array.isArray(data.filters)) {
                data.filters.forEach(fData => {
                    if (fData && fData.index !== undefined) {
                        const f = this.xoFilters[fData.index];
                        if (f) {
                            const wasBypassed = f.bypassed;
                            f.bypassed = fData.bypassed;
                            f.updateCoefficients(fData.filterType, fData.frequency, fData.gain, fData.q, this.sampleRate, wasBypassed);
                        }
                    }
                });
            }
        }
        else if (data.type === 'reset') {
            this.filters.forEach(f => f.reset());
            this.simFilters.forEach(f => f.reset());
            this.xoFilters.forEach(f => f.reset());
        }
    }

    getGainSafe(index) {
        return (index < this.xoGains.length && Number.isFinite(this.xoGains[index])) ? this.xoGains[index] : 1.0;
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0] || input[0].length === 0) return true;

        const inputChannelL = input[0];
        const inputChannelR = input[1] || input[0];
        const outputChannelL = output[0];
        const outputChannelR = output[1];
        const isStereo = !!outputChannelR;

        const bufferSize = inputChannelL.length;
        const activeFilters = this.activeFilters;
        const activeSimFilters = this.activeSimFilters;
        const numFilters = activeFilters.length;
        const numSims = activeSimFilters.length;

        // Realtime-thread: hoist crossover helpers + gain reads OUT of the
        // per-sample loop (they are constant across an audio block).
        const appXo = this.xoEnabled;
        const xoType = this.xoType;
        const xoF = this.xoFilters;
        const xoG0 = this.getGainSafe(0);
        const xoG1 = this.getGainSafe(1);
        const xoG2 = this.getGainSafe(2);
        const xoG3 = this.getGainSafe(3);
        const xoG4 = this.getGainSafe(4);
        const smFactor = this.smoothingFactor;
        const sRate = this.sampleRate;

        for (let i = 0; i < bufferSize; i++) {
            this.preampGain += (this.targetPreampGain - this.preampGain) * this.smoothingFactor;
            // Self-heal: if preampGain ever goes non-finite (NaN/Infinity)
            // through any path, snap it back to the current target instead
            // of latching a broken value forever -- the exponential
            // smoother above has no way to recover from NaN on its own
            // (NaN + anything = NaN). One comparison per sample; no-op on
            // the healthy path.
            if (!Number.isFinite(this.preampGain)) this.preampGain = this.targetPreampGain;

            let sampleL = inputChannelL[i] * this.preampGain;
            let sampleR = inputChannelR[i] * this.preampGain;

            // 1. Parametric EQ Filters
            for (let f = 0; f < numFilters; f++) {
                const filter = activeFilters[f];
                sampleL = filter.processSampleL(sampleL, smFactor, sRate);
                if (isStereo) sampleR = filter.processSampleR(sampleR);
            }

            // 2. Acoustics & Simulations
            for (let s = 0; s < numSims; s++) {
                const filter = activeSimFilters[s];
                sampleL = filter.processSampleL(sampleL, smFactor, sRate);
                if (isStereo) sampleR = filter.processSampleR(sampleR);
            }

            // 3. Active Crossover — Linkwitz-Riley 4th order.
            if (appXo) {
                let summedL = 0.0;
                let summedR = 0.0;

                // Band 1 (Low)
                let b1_L = sampleL, b1_R = sampleR;
                if (xoF[0] && !xoF[0].bypassed) {
                    b1_L = xoF[0].processSampleL_4th(sampleL, smFactor, sRate);
                    if (isStereo) b1_R = xoF[0].processSampleR_4th(sampleR);
                }
                const g0 = xoG0;
                summedL += b1_L * g0;
                summedR += b1_R * g0;

                // Band 2 (Low-Mid)
                if (xoType === '5way') {
                    let b2_L = sampleL, b2_R = sampleR;
                    if (xoF[1] && !xoF[1].bypassed) {
                        b2_L = xoF[1].processSampleL_4th(sampleL, smFactor, sRate);
                        if (xoF[2]) b2_L = xoF[2].processSampleL_4th(b2_L, smFactor, sRate);
                        if (isStereo) {
                            b2_R = xoF[1].processSampleR_4th(sampleR);
                            if (xoF[2]) b2_R = xoF[2].processSampleR_4th(b2_R);
                        }
                    }
                    const g1 = xoG1;
                    summedL += b2_L * g1;
                    summedR += b2_R * g1;
                }

                // Band 3 (Mid)
                if (xoType === '3way' || xoType === '4way' || xoType === '5way') {
                    let b3_L = sampleL, b3_R = sampleR;
                    if (xoF[3] && !xoF[3].bypassed) {
                        b3_L = xoF[3].processSampleL_4th(sampleL, smFactor, sRate);
                        if (xoF[4]) b3_L = xoF[4].processSampleL_4th(b3_L, smFactor, sRate);
                        if (isStereo) {
                            b3_R = xoF[3].processSampleR_4th(sampleR);
                            if (xoF[4]) b3_R = xoF[4].processSampleR_4th(b3_R);
                        }
                    }
                    const g2 = xoG2;
                    summedL += b3_L * g2;
                    summedR += b3_R * g2;
                }

                // Band 4 (High-Mid)
                if (xoType === '4way' || xoType === '5way') {
                    let b4_L = sampleL, b4_R = sampleR;
                    if (xoF[5] && !xoF[5].bypassed) {
                        b4_L = xoF[5].processSampleL_4th(sampleL, smFactor, sRate);
                        if (xoF[6]) b4_L = xoF[6].processSampleL_4th(b4_L, smFactor, sRate);
                        if (isStereo) {
                            b4_R = xoF[5].processSampleR_4th(sampleR);
                            if (xoF[6]) b4_R = xoF[6].processSampleR_4th(b4_R);
                        }
                    }
                    const g3 = xoG3;
                    summedL += b4_L * g3;
                    summedR += b4_R * g3;
                }

                // Band 5 (High) — high trim is always the last gain slot (4)
                let b5_L = sampleL, b5_R = sampleR;
                if (xoF[7] && !xoF[7].bypassed) {
                    b5_L = xoF[7].processSampleL_4th(sampleL, smFactor, sRate);
                    if (isStereo) b5_R = xoF[7].processSampleR_4th(sampleR);
                }
                const g4 = xoG4;
                summedL += b5_L * g4;
                summedR += b5_R * g4;

                sampleL = summedL;
                sampleR = summedR;
            }

            outputChannelL[i] = sampleL;
            if (isStereo) {
                outputChannelR[i] = sampleR;
            }
        }

        return true;
    }
}

registerProcessor('dsp-processor', DspProcessor);