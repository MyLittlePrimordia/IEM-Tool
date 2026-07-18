/**
 * dsp-processor.js (Parameter-Interpolated Edition)
 * Professional-grade AudioWorkletProcessor.
 * Interpolates in parameter-space (Freq, Gain, Q) to prevent resonant ringing.
 */

// The original per-sample smoothing factor (0.005) was tuned at 44.1kHz, giving a real-world
// time constant of 1/0.005 = 200 samples ≈ 4.54ms. Deriving the factor from this fixed time
// constant (rather than hardcoding 0.005) keeps parameter ramps the same speed in real time
// regardless of the audio engine's actual sample rate (44.1k/48k/96k/etc).
const SMOOTHING_TIME_CONSTANT_SECONDS = 200 / 44100;

function computeSmoothingFactor(sampleRate) {
    return 1 - Math.exp(-1 / (SMOOTHING_TIME_CONSTANT_SECONDS * sampleRate));
}

class BiquadFilter {
    constructor() {
        // Active Coefficients
        this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0;
        this.a1 = 0.0; this.a2 = 0.0;

        // Active Parameters
        this.frequency = 1000.0;
        this.gain = 0.0;
        this.q = 1.0;

        // Target Parameters
        this.target_frequency = 1000.0;
        this.target_gain = 0.0;
        this.target_q = 1.0;

        // History states (Stereo)
        this.s1_L = 0.0; this.s2_L = 0.0;
        this.s1_R = 0.0; this.s2_R = 0.0;

        this.bypassed = true;
        this.type = 'peaking';

        // Coefficient recalculation is throttled while interpolating (see processSampleL):
        // parameters still update every sample, but the expensive trig/pow design equations
        // are only re-run every RECALC_INTERVAL samples to save CPU when many filters move at once.
        this.RECALC_INTERVAL = 8;
        this.recalcCounter = 1;
        this.coeffsCurrent = true; // true once b0..a2 exactly reflect the current frequency/gain/q
    }

    reset() {
        this.s1_L = 0.0; this.s2_L = 0.0;
        this.s1_R = 0.0; this.s2_R = 0.0;
    }

    updateCoefficients(type, freq, gain, q, sampleRate, wasBypassed) {
        this.type = type;
        
        // Store targets directly
        this.target_frequency = Math.max(10, Math.min(22000, Number.isFinite(freq) ? freq : 1000));
        this.target_gain = Math.max(-40, Math.min(40, Number.isFinite(gain) ? gain : 0.0));
        this.target_q = Math.max(0.01, Math.min(50, Number.isFinite(q) ? q : 1.0));

        // Snap current parameters directly to targets when this filter is being (re)enabled,
        // to prevent an audible ramp/sweep from stale parameters. Must check the PREVIOUS
        // bypassed state (passed in), since the caller updates this.bypassed before calling here.
        if (wasBypassed) {
            this.frequency = this.target_frequency;
            this.gain = this.target_gain;
            this.q = this.target_q;
            this.calculateCoefficients(sampleRate);
            this.coeffsCurrent = true;
            this.recalcCounter = this.RECALC_INTERVAL;
        } else {
            // Parameters changed while active: coefficients are now stale relative to the
            // (possibly new) target, so make sure the next sample recalculates right away.
            this.coeffsCurrent = false;
            this.recalcCounter = 1;
        }
    }

    calculateCoefficients(sampleRate) {
        const w0 = 2 * Math.PI * this.frequency / sampleRate;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const alpha = sinW0 / (2 * this.q);
        const A = Math.pow(10, this.gain / 40);

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
                const innerSqrt = (A + 1 / A) * (1 / this.q - 1) + 2;
                const alphaS = (sinW0 / 2) * Math.sqrt(Math.max(0, innerSqrt));
                b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alphaS);
                b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
                b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alphaS);
                a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alphaS;
                a1 = -2 * ((A - 1) + (A + 1) * cosW0);
                a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alphaS;
                break;
            }
            case 'highshelf': {
                const innerSqrt = (A + 1 / A) * (1 / this.q - 1) + 2;
                const alphaS = (sinW0 / 2) * Math.sqrt(Math.max(0, innerSqrt));
                b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alphaS);
                b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
                b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alphaS);
                a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alphaS;
                a1 = 2 * ((A - 1) - (A + 1) * cosW0);
                a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alphaS;
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
        this.b0 = b0 / div;
        this.b1 = b1 / div;
        this.b2 = b2 / div;
        this.a1 = a1 / div;
        this.a2 = a2 / div;
    }

    processSampleL(x, smoothingFactor, sampleRate) {
        const freqDiff = Math.abs(this.target_frequency - this.frequency);
        const gainDiff = Math.abs(this.target_gain - this.gain);
        const qDiff = Math.abs(this.target_q - this.q);
        const settled = freqDiff <= 0.01 && gainDiff <= 0.01 && qDiff <= 0.001;

        // Linear interpolation of parameters (Intrinsic Stability guaranteed)
        if (!settled) {
            this.frequency += (this.target_frequency - this.frequency) * smoothingFactor;
            this.gain += (this.target_gain - this.gain) * smoothingFactor;
            this.q += (this.target_q - this.q) * smoothingFactor;

            // Parameters move every sample, but the full biquad design (sin/cos/pow/sqrt) is only
            // recomputed every RECALC_INTERVAL samples. With up to ~100 filters this cuts the CPU
            // cost of a preset load or multi-band sweep by roughly RECALC_INTERVAL-fold, at the cost
            // of a coefficient granularity of a few samples (inaudible).
            this.recalcCounter--;
            if (this.recalcCounter <= 0) {
                this.calculateCoefficients(sampleRate);
                this.recalcCounter = this.RECALC_INTERVAL;
            }
            this.coeffsCurrent = false;
        } else if (!this.coeffsCurrent) {
            // Just reached the target: snap the exact values and do one final, exact recalculation
            // so the steady-state coefficients aren't left reflecting the last approximate step.
            this.frequency = this.target_frequency;
            this.gain = this.target_gain;
            this.q = this.target_q;
            this.calculateCoefficients(sampleRate);
            this.coeffsCurrent = true;
        }

        if (!Number.isFinite(this.s1_L) || !Number.isFinite(this.s2_L)) {
            this.s1_L = 0.0;
            this.s2_L = 0.0;
        }

        const y = x * this.b0 + this.s1_L;
        this.s1_L = x * this.b1 - this.a1 * y + this.s2_L;
        this.s2_L = x * this.b2 - this.a2 * y;

        // Flush denormals: during silence/decay tails these feedback states can settle into the
        // denormal float range, which is dramatically slower to compute on many CPUs.
        if (Math.abs(this.s1_L) < 1e-15) this.s1_L = 0.0;
        if (Math.abs(this.s2_L) < 1e-15) this.s2_L = 0.0;

        return y;
    }

    processSampleR(x) {
        if (!Number.isFinite(this.s1_R) || !Number.isFinite(this.s2_R)) {
            this.s1_R = 0.0;
            this.s2_R = 0.0;
        }

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
        this.sampleRate = 44100;
        this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
        this.preampDb = 0.0;
        this.preampGain = 1.0;
        this.targetPreampGain = 1.0;

        this.filters = Array.from({ length: 80 }, () => new BiquadFilter());
        this.simFilters = Array.from({ length: 15 }, () => new BiquadFilter());

        this.xoEnabled = false;
        this.xoType = '3way';
        this.xoGains = [1.0, 1.0, 1.0, 1.0, 1.0];
        this.xoFilters = Array.from({ length: 10 }, () => new BiquadFilter());

        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
    }

    handleMessage(data) {
        if (data.type === 'init') {
            this.sampleRate = data.sampleRate || 44100;
            this.smoothingFactor = computeSmoothingFactor(this.sampleRate);
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
        }
        else if (data.type === 'updateCrossover') {
            this.xoEnabled = data.enabled;
            this.xoType = data.xoType;
            this.xoGains = data.gains.map(g => Number.isFinite(g) ? g : 1.0);
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

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0] || input[0].length === 0) return true;

        const inputChannelL = input[0];
        const inputChannelR = input[1] || input[0];
        const outputChannelL = output[0];
        const outputChannelR = output[1];

        const bufferSize = inputChannelL.length;

        for (let i = 0; i < bufferSize; i++) {
            this.preampGain += (this.targetPreampGain - this.preampGain) * this.smoothingFactor;

            let sampleL = inputChannelL[i] * this.preampGain;
            let sampleR = inputChannelR[i] * this.preampGain;

            // 1. Parametric EQ
            for (let f = 0; f < 80; f++) {
                const filter = this.filters[f];
                if (!filter.bypassed) {
                    sampleL = filter.processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    sampleR = filter.processSampleR(sampleR);
                }
            }

            // 2. Acoustics & Simulations
            for (let s = 0; s < 15; s++) {
                const filter = this.simFilters[s];
                if (!filter.bypassed) {
                    sampleL = filter.processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    sampleR = filter.processSampleR(sampleR);
                }
            }

            // 3. Active Crossover
            if (this.xoEnabled) {
                let summedL = 0.0;
                let summedR = 0.0;
                const type = this.xoType;

                let branch1_L = sampleL;
                let branch1_R = sampleR;
                if (!this.xoFilters[0].bypassed) {
                    branch1_L = this.xoFilters[0].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    branch1_R = this.xoFilters[0].processSampleR(sampleR);
                }
                summedL += branch1_L * this.xoGains[0];
                summedR += branch1_R * this.xoGains[0];

                if (type === '5way') {
                    let branch2_L = sampleL;
                    let branch2_R = sampleR;
                    if (!this.xoFilters[1].bypassed) {
                        branch2_L = this.xoFilters[1].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        branch2_L = this.xoFilters[2].processSampleL(branch2_L, this.smoothingFactor, this.sampleRate);
                        branch2_R = this.xoFilters[1].processSampleR(sampleR);
                        branch2_R = this.xoFilters[2].processSampleR(branch2_R);
                    }
                    summedL += branch2_L * this.xoGains[1];
                    summedR += branch2_R * this.xoGains[1];
                }

                if (type === '3way' || type === '4way' || type === '5way') {
                    let branch3_L = sampleL;
                    let branch3_R = sampleR;
                    if (!this.xoFilters[3].bypassed) {
                        branch3_L = this.xoFilters[3].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        branch3_L = this.xoFilters[4].processSampleL(branch3_L, this.smoothingFactor, this.sampleRate);
                        branch3_R = this.xoFilters[3].processSampleR(sampleR);
                        branch3_R = this.xoFilters[4].processSampleR(branch3_R);
                    }
                    summedL += branch3_L * this.xoGains[2];
                    summedR += branch3_R * this.xoGains[2];
                }

                if (type === '4way' || type === '5way') {
                    let branch4_L = sampleL;
                    let branch4_R = sampleR;
                    if (!this.xoFilters[5].bypassed) {
                        branch4_L = this.xoFilters[5].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                        branch4_L = this.xoFilters[6].processSampleL(branch4_L, this.smoothingFactor, this.sampleRate);
                        branch4_R = this.xoFilters[5].processSampleR(sampleR);
                        branch4_R = this.xoFilters[6].processSampleR(branch4_R);
                    }
                    summedL += branch4_L * this.xoGains[3];
                    summedR += branch4_R * this.xoGains[3];
                }

                let branch5_L = sampleL;
                let branch5_R = sampleR;
                if (!this.xoFilters[7].bypassed) {
                    branch5_L = this.xoFilters[7].processSampleL(sampleL, this.smoothingFactor, this.sampleRate);
                    branch5_R = this.xoFilters[7].processSampleR(sampleR);
                }
                summedL += branch5_L * this.xoGains[4];
                summedR += branch5_R * this.xoGains[4];

                sampleL = summedL;
                sampleR = summedR;
            }

            outputChannelL[i] = sampleL;
            if (outputChannelR) {
                outputChannelR[i] = sampleR;
            }
        }

        return true;
    }
}

registerProcessor('dsp-processor', DspProcessor);