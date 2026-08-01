/**
 * dsp-processor.js (Production High-Performance DSP Engine)
 * Low-latency, CPU-optimized AudioWorkletProcessor.
 * Bypasses sub-sample math when parameters are settled to maximize efficiency.
 */

const SMOOTHING_TIME_CONSTANT_SECONDS = 200 / 44100;

function computeSmoothingFactor(sampleRate) {
    return 1 - Math.exp(-1 / (SMOOTHING_TIME_CONSTANT_SECONDS * sampleRate));
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
    }

    updateCoefficients(type, freq, gain, q, sampleRate, wasBypassed) {
        this.type = type;
        
        const maxFreq = sampleRate * 0.49;
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
        const alpha = sinW0 / (2 * q);
        const A = Math.pow(10, gain / 40);

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

    processSampleL(x, smoothingFactor, sampleRate) {
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

            // Smooth sub-sample linear ramping
            this.b0 += (this.target_b0 - this.b0) * 0.125;
            this.b1 += (this.target_b1 - this.b1) * 0.125;
            this.b2 += (this.target_b2 - this.b2) * 0.125;
            this.a1 += (this.target_a1 - this.a1) * 0.125;
            this.a2 += (this.target_a2 - this.a2) * 0.125;

            if (this.coeffsCurrent && Math.abs(this.b0 - this.target_b0) < 1e-6) {
                this.snapCoefficients();
                this.coeffsRamped = true;
            }
        }

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
}

class DspProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sampleRate = globalThis.sampleRate || 44100;
        this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
        
        this.preampDb = 0.0;
        this.preampGain = 1.0;
        this.targetPreampGain = 1.0;

        this.filters = Array.from({ length: 80 }, () => new BiquadFilter());
        this.simFilters = Array.from({ length: 15 }, () => new BiquadFilter());
        this.xoFilters = Array.from({ length: 10 }, () => new BiquadFilter());

        this.activeFilters = [];
        this.activeSimFilters = [];

        this.xoEnabled = false;
        this.xoType = '3way';
        this.xoGains = [1.0, 1.0, 1.0, 1.0, 1.0];

        this.port.onmessage = (event) => this.handleMessage(event.data);
    }

    updateActiveLists() {
        this.activeFilters = this.filters.filter(f => !f.bypassed);
        this.activeSimFilters = this.simFilters.filter(f => !f.bypassed);
    }

    handleMessage(data) {
        if (data.type === 'init') {
            if (data.sampleRate) {
                this.sampleRate = data.sampleRate;
                this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
            }
        } 
        else if (data.type === 'updatePreamp') {
            this.preampDb = Number.isFinite(data.preampDb) ? data.preampDb : 0.0;
            this.targetPreampGain = Math.pow(10, this.preampDb / 20);
        } 
        else if (data.type === 'updateFilters') {
            data.filters.forEach(fData => {
                const f = this.filters[fData.index];
                if (f) {
                    const wasBypassed = f.bypassed;
                    f.bypassed = fData.bypassed;
                    f.updateCoefficients(fData.filterType, fData.frequency, fData.gain, fData.q, this.sampleRate, wasBypassed);
                }
            });
            this.updateActiveLists();
        }
        else if (data.type === 'updateSimulations') {
            data.sims.forEach(sData => {
                const f = this.simFilters[sData.index];
                if (f) {
                    const wasBypassed = f.bypassed;
                    f.bypassed = sData.bypassed;
                    f.updateCoefficients(sData.filterType, sData.frequency, sData.gain, sData.q, this.sampleRate, wasBypassed);
                }
            });
            this.updateActiveLists();
        }
        else if (data.type === 'updateCrossover') {
            this.xoEnabled = data.enabled;
            this.xoType = data.xoType;
            if (Array.isArray(data.gains)) {
                this.xoGains = data.gains.map(g => Number.isFinite(g) ? g : 1.0);
            }
            data.filters.forEach(fData => {
                const f = this.xoFilters[fData.index];
                if (f) {
                    const wasBypassed = f.bypassed;
                    f.bypassed = fData.bypassed;
                    f.updateCoefficients(fData.filterType, fData.frequency, fData.gain, fData.q, this.sampleRate, wasBypassed);
                }
            });
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

        for (let i = 0; i < bufferSize; i++) {
            this.preampGain += (this.targetPreampGain - this.preampGain) * this.smoothingFactor;

            let sampleL = inputChannelL[i] * this.preampGain;
            let sampleR = inputChannelR[i] * this.preampGain;

            // 1. Parametric EQ Filters
            for (let f = 0; f < numFilters; f++) {
                const filter = activeFilters[f];
                sampleL = filter.processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                if (isStereo) sampleR = filter.processSampleR(sampleR);
            }

            // 2. Acoustics & Simulations
            for (let s = 0; s < numSims; s++) {
                const filter = activeSimFilters[s];
                sampleL = filter.processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                if (isStereo) sampleR = filter.processSampleR(sampleR);
            }

            // 3. Active Crossover
            if (this.xoEnabled) {
                let summedL = 0.0;
                let summedR = 0.0;
                const type = this.xoType;

                // Band 1 (Low)
                let b1_L = sampleL, b1_R = sampleR;
                if (!this.xoFilters[0].bypassed) {
                    b1_L = this.xoFilters[0].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    if (isStereo) b1_R = this.xoFilters[0].processSampleR(sampleR);
                }
                const g0 = this.getGainSafe(0);
                summedL += b1_L * g0;
                summedR += b1_R * g0;

                // Band 2 (Low-Mid)
                if (type === '5way') {
                    let b2_L = sampleL, b2_R = sampleR;
                    if (!this.xoFilters[1].bypassed) {
                        b2_L = this.xoFilters[1].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        b2_L = this.xoFilters[2].processSampleL(b2_L, this.smoothingFactor, this.sampleRate);
                        if (isStereo) {
                            b2_R = this.xoFilters[1].processSampleR(sampleR);
                            b2_R = this.xoFilters[2].processSampleR(b2_R);
                        }
                    }
                    const g1 = this.getGainSafe(1);
                    summedL += b2_L * g1;
                    summedR += b2_R * g1;
                }

                // Band 3 (Mid)
                if (type === '3way' || type === '4way' || type === '5way') {
                    let b3_L = sampleL, b3_R = sampleR;
                    if (!this.xoFilters[3].bypassed) {
                        b3_L = this.xoFilters[3].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        b3_L = this.xoFilters[4].processSampleL(b3_L, this.smoothingFactor, this.sampleRate);
                        if (isStereo) {
                            b3_R = this.xoFilters[3].processSampleR(sampleR);
                            b3_R = this.xoFilters[4].processSampleR(b3_R);
                        }
                    }
                    const g2 = this.getGainSafe(type === '5way' ? 2 : 1);
                    summedL += b3_L * g2;
                    summedR += b3_R * g2;
                }

                // Band 4 (High-Mid)
                if (type === '4way' || type === '5way') {
                    let b4_L = sampleL, b4_R = sampleR;
                    if (!this.xoFilters[5].bypassed) {
                        b4_L = this.xoFilters[5].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        b4_L = this.xoFilters[6].processSampleL(b4_L, this.smoothingFactor, this.sampleRate);
                        if (isStereo) {
                            b4_R = this.xoFilters[5].processSampleR(sampleR);
                            b4_R = this.xoFilters[6].processSampleR(b4_R);
                        }
                    }
                    const g3 = this.getGainSafe(type === '5way' ? 3 : 2);
                    summedL += b4_L * g3;
                    summedR += b4_R * g3;
                }

                // Band 5 (High)
                let b5_L = sampleL, b5_R = sampleR;
                if (!this.xoFilters[7].bypassed) {
                    b5_L = this.xoFilters[7].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    if (isStereo) b5_R = this.xoFilters[7].processSampleR(sampleR);
                }
                const highGainIdx = (type === '2way') ? 1 : (type === '3way' ? 2 : (type === '4way' ? 3 : 4));
                const g4 = this.getGainSafe(highGainIdx);
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