const EQ_ReverbMethods = {
    toggleReverb: function() {
        this.reverbActive = !this.reverbActive;
        const btn = document.getElementById('btn-reverb-toggle');
        const lbl = document.getElementById('lbl-reverb-state');
        const presetBtn = document.getElementById('reverb-preset-btn');
        const container = document.getElementById('reverb-sliders-container');

        if (this.reverbActive) {
            if (btn) btn.classList.add('is-on');
            if (lbl) lbl.textContent = 'Reverb: ON';
            if (presetBtn) presetBtn.classList.remove('opacity-40', 'pointer-events-none');
            if (container) container.classList.remove('opacity-40', 'pointer-events-none');
            showToast("Reverb Engine active. Simulating natural room reflections.", "📣");
        } else {
            if (btn) btn.classList.remove('is-on');
            if (lbl) lbl.textContent = 'Reverb: OFF';
            if (presetBtn) presetBtn.classList.add('opacity-40', 'pointer-events-none');
            if (container) container.classList.add('opacity-40', 'pointer-events-none');
        }
        this.updateReverbDSP();
    },

    cycleReverbPreset: function() {
        const curIdx = this.reverbPresetOptions.indexOf(this.reverbPresetSelected);
        const nextIdx = (curIdx + 1) % this.reverbPresetOptions.length;
        const nextPresetKey = this.reverbPresetOptions[nextIdx];
        this.applyReverbPreset(nextPresetKey);
    },

    applyReverbPreset: function(val) {
        this.reverbPresetSelected = val;
        const preset = this.reverbPresets[val] || this.reverbPresets.small_room;
        
        const presetBtn = document.getElementById('reverb-preset-btn');
        if (presetBtn) presetBtn.textContent = preset.label || '🚪 Small Room';

        this.reverbParams.mix = preset.wet;
        this.reverbParams.size = preset.size;
        this.reverbParams.damp = preset.damp;
        this.reverbParams.filter = preset.filter;
        this.reverbParams.fade = preset.fade;
        this.reverbParams.predelay = preset.predelay;
        this.reverbParams.predelaymix = preset.predelaymix;

        document.getElementById('rev-mix-slider').value = Math.round(preset.wet * 100);
        document.getElementById('rev-mix-val').textContent = preset.wet.toFixed(2);
        
        document.getElementById('rev-size-slider').value = Math.round(preset.size * 100);
        document.getElementById('rev-size-val').textContent = preset.size.toFixed(2);
        
        document.getElementById('rev-damp-slider').value = Math.round(preset.damp * 100);
        document.getElementById('rev-damp-val').textContent = preset.damp.toFixed(2);
        
        document.getElementById('rev-filter-slider').value = Math.round(preset.filter * 100);
        document.getElementById('rev-filter-val').textContent = preset.filter.toFixed(2);

        document.getElementById('rev-fade-slider').value = Math.round(preset.fade * 100);
        document.getElementById('rev-fade-val').textContent = preset.fade.toFixed(2);
        
        document.getElementById('rev-predelay-slider').value = Math.round(preset.predelay * 1000);
        document.getElementById('rev-predelay-val').textContent = preset.predelay.toFixed(3);

        document.getElementById('rev-predelaymix-slider').value = Math.round(preset.predelaymix * 100);
        document.getElementById('rev-predelaymix-val').textContent = preset.predelaymix.toFixed(2);

        // Update Convolver Buffer seamlessly (debounced - slider drags during
        // preset cycles coalesce into a single rebuild)
            this.scheduleImpulseRebuild();

            this.updateReverbDSP();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },

    updateReverbParam: function(param, val) {
        this.reverbParams[param] = parseFloat(val);
        const valEl = document.getElementById(`rev-${param}-val`);
        if (valEl) valEl.textContent = this.reverbParams[param].toFixed(2);
        // mix/filter only touch live DSP nodes; everything else shapes the IR
        // itself and needs the impulse response rebuilt (debounced).
        if (param === 'mix' || param === 'filter') {
            this.updateReverbDSP();
        } else {
            this.scheduleImpulseRebuild();
        }
    },

    scheduleImpulseRebuild: function() {
        if (this._irRebuildTimer) clearTimeout(this._irRebuildTimer);
        this._irRebuildTimer = setTimeout(() => {
            this._irRebuildTimer = null;
            if (!SharedAudio.ctx || !SharedAudio.reverbNode) return;
            const base = this.reverbPresets[this.reverbPresetSelected] || this.reverbPresets.small_room || {};
            // Merge live slider params over the active preset defaults so a
            // user tweak (damp/predelay/predelaymix...) is reflected in the IR.
            const effective = {
                size: this.reverbParams.size !== undefined ? this.reverbParams.size : (base.size || 0.4),
                damp: this.reverbParams.damp !== undefined ? this.reverbParams.damp : (base.damp || 0.5),
                fade: this.reverbParams.fade !== undefined ? this.reverbParams.fade : (base.fade || 0.2),
                predelay: this.reverbParams.predelay !== undefined ? this.reverbParams.predelay : (base.predelay || 0),
                predelaymix: this.reverbParams.predelaymix !== undefined ? this.reverbParams.predelaymix : (base.predelaymix || 0)
            };
            const key = 'custom@' + (SharedAudio.ctx.sampleRate || 48000) + '@' +
                [effective.size, effective.damp, effective.fade, effective.predelay, effective.predelaymix]
                    .map(v => +Number(v).toFixed(4)).join(',');
            this._irCache = this._irCache || {};
            let ir = this._irCache[key];
            if (!ir) {
                ir = this.createImpulseResponse(SharedAudio.ctx, effective);
                this._irCache[key] = ir;
            }
            SharedAudio.reverbNode.buffer = ir;
            this.updateReverbDSP();
        }, 180);
    },

    createImpulseResponse: function(ctx, preset) {
    const sampleRate = ctx.sampleRate;
    // Map Room Size and Decay parameter cleanly to an RT60 range (0.4s to 4.5s)
    const rt60 = 0.4 + (preset.size * 1.6) + (preset.fade * 2.5);
    const duration = Math.max(0.1, rt60);
    // IR is capped at 4 s - the decay envelope must use the same cap so a long
    // preset doesn't get truncated mid-decay (audible cutoff click).
    const effectiveDuration = Math.min(duration, 4.0);

    const numSamples = Math.floor(sampleRate * effectiveDuration);
    const impulseBuffer = ctx.createBuffer(2, numSamples, sampleRate);
    const left = impulseBuffer.getChannelData(0);
    const right = impulseBuffer.getChannelData(1);

    const damping = preset.damp;
    const preDelay = preset.predelay;
    const preDelaySamples = Math.floor(preDelay * sampleRate);
    // predelaymix blends the pre-delay region: 0 collapses the silent gap so
    // the tail starts immediately (tight/small spaces), 1 applies the full
    // delay. Reflections follow the same collapsed timeline.
    const preDelayMix = Math.min(1, Math.max(0, preset.predelaymix || 0));
    const tailDelaySamples = Math.floor(preDelaySamples * preDelayMix);

    // 1. Synthesize Early Reflections using prime-like spacing to prevent metallic ringing
    const reflections = [];
    const reflectionCount = 15;
    for (let r = 0; r < reflectionCount; r++) {
        // Non-integer exponent curves prevent resonant clustering
        const delayMs = 5 + Math.pow(r / (reflectionCount - 1), 1.5) * 85;
        const delaySamples = Math.floor((delayMs / 1000) * sampleRate) + tailDelaySamples;
        
        if (delaySamples < numSamples) {
            const pan = Math.sin(r * 1.7); // Alternating left-to-right spacing
            const decayEnv = Math.exp(-delayMs * 0.035);
            const amp = decayEnv * (0.15 + Math.random() * 0.08) * (0.3 + 0.7 * preDelayMix);
            
            reflections.push({
                sampleIdx: delaySamples,
                ampL: amp * Math.sqrt(0.5 * (1.0 - pan)),
                ampR: amp * Math.sqrt(0.5 * (1.0 + pan))
            });
        }
    }

    // Filter state tracking
    let lpL = 0, lpR = 0; // Low-pass damping state
    let hpL = 0, hpR = 0; // High-pass mud cut state
    let prevL = 0, prevR = 0;

    // 2. Late Tail Generation with Exponential Bloom and Time-Varying Damping
    const bloomDuration = 0.025; // 25ms rise time for reflections to diffuse
    const bloomSamples = Math.floor(bloomDuration * sampleRate);

    // Multiplicative exponential decay: decayEnvelope *= decayFactor each step
    // is mathematically identical to Math.exp(-t*(6.91/duration)) but avoids a
    // Math.exp() call per sample (~100k+ saved per IR synthesis).
    const decayFactor = Math.exp(-(6.91 / effectiveDuration) / sampleRate);
    let decayEnvelope = 1.0;

    for (let i = 0; i < numSamples; i++) {
        if (i < tailDelaySamples) {
            left[i] = 0;
            right[i] = 0;
            continue;
        }

        decayEnvelope *= decayFactor;

        // Smooth onset bloom (using a smoothstep curve)
        let bloomEnvelope = 1.0;
        const tBloom = i - tailDelaySamples;
        if (tBloom < bloomSamples) {
            const x = tBloom / bloomSamples;
            bloomEnvelope = x * x * (3 - 2 * x);
        }

        const combinedEnvelope = decayEnvelope * bloomEnvelope;

        // Independent, decorrelated white noise sources
        const noiseL = Math.random() * 2 - 1;
        const noiseR = Math.random() * 2 - 1;

        // Dynamic Damping: high frequencies decay faster as time progresses.
        // Time in seconds is i / sampleRate (the loop counter is `i`).
        const currentDamping = Math.min(0.997, damping * 0.72 + (i / sampleRate / duration) * 0.25);
        const alpha = 1.0 - currentDamping;

        // Apply low-pass damping
        lpL += alpha * (noiseL - lpL);
        lpR += alpha * (noiseR - lpR);

        // Apply high-pass filter (approx. 120Hz cutoff) to eliminate low-end rumble
        const hpAlpha = 0.985;
        hpL = hpAlpha * (hpL + lpL - prevL);
        hpR = hpAlpha * (hpR + lpR - prevR);
        prevL = lpL;
        prevR = lpR;

        left[i] = hpL * combinedEnvelope * 0.35;
        right[i] = hpR * combinedEnvelope * 0.35;
    }

    // 3. Superimpose Early Reflections onto the late tail
    reflections.forEach(ref => {
        if (ref.sampleIdx < numSamples) {
            left[ref.sampleIdx] += ref.ampL;
            right[ref.sampleIdx] += ref.ampR;
        }
    });

    // 4. Mid/Side (M/S) Spatial Expansion
    // This widens the stereo image of the tail without introducing phase issues
    for (let i = 0; i < numSamples; i++) {
        const l = left[i];
        const r = right[i];
        
        const mid = (l + r) * 0.5;
        const side = (l - r) * 0.5;
        
        // Boost side signal by 25% for high spatial performance on IEMs
        left[i] = mid + side * 1.25;
        right[i] = mid - side * 1.25;
    }

    return impulseBuffer;
},

        updateReverbDSP: function() {
            if (!SharedAudio.ctx || !SharedAudio.dryGainNode || !SharedAudio.wetGainNode) return;
            
            const now = SharedAudio.ctx.currentTime;
            // Keep the wet gain at the user's mix while paused so the reverb
            // tail rings out naturally instead of snapping to silence on every
            // pause/seek (with the source muted the finite IR fades on its own).
            const mix = this.reverbActive ? this.reverbParams.mix : 0;
            
            setAudioParamSmooth(SharedAudio.dryGainNode.gain, 1.0 - (mix * 0.35), 0.015);
            setAudioParamSmooth(SharedAudio.wetGainNode.gain, mix, 0.015);
            
            if (SharedAudio.reverbFilterNode) {
                setAudioParamSmooth(SharedAudio.reverbFilterNode.frequency, this.reverbParams.filter * 20000, 0.015);
            }
        },
};
