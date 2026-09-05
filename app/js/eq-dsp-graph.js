// Split out of eq-core.js (2026 god-file refactor, Step 6).
// AudioWorklet graph lifecycle + message bridge:
//   - ensureDSPGraph / _buildDSPGraph (single-flight worklet boot, media
//     element wiring, crossfeed/merger topology, pending-DSP-tag flush)
//   - _pendingDspQueue / _queuePendingDsp (pre-boot coalescing)
//   - _uacCoalesced (rAF-coalesced filter push) + updateAudioConnections
//     (the full worklet filter-bank payload builder)
//   - merger/safety limiter routing (worklet lookahead limiter config,
//     persisted toggle) + the GR meter bridge
//   - toggleEQ (master bypass; re-pushes the whole bank on flip)
// All state (graphBuilt, _dspBuildPromise, _uacScheduled, mergerLimiterEnabled)
// lives on EQ_Module via 	his; merged into EQ_Module via Object.assign in
// db-cache.js. Names unchanged. dsp-processor.js (the worklet itself) is
// untouched.
const EQ_DspGraphMethods = {        _dspBuildPromise: null,
        ensureDSPGraph: async function() {
            if (this.graphBuilt) return;
            // Re-entrancy guard. Callers fire this concurrently (document click
            // handler, playback hook, drag flush, queued DSP tags). Each awaited
            // addModule independently and built a SECOND worklet graph; the media
            // source stayed wired to the first node while SharedAudio.workletNode
            // pointed at the orphan, so every updateFilters message reached a
            // filter bank that was never in the signal path — dragging EQ nodes
            // changed nothing audibly.
            if (!this._dspBuildPromise) {
                this._dspBuildPromise = this._buildDSPGraph().catch((err) => {
                    console.error("[AudioEngine] DSP graph build failed:", err);
                });
            }
            await this._dspBuildPromise;
            this._dspBuildPromise = null;
        },

        _buildDSPGraph: async function() {
            const ctx = SharedAudio.init();
            // Do NOT await ctx.resume() here. In browsers, an AudioContext created
            // before any user gesture stays 'suspended' and resume()'s promise
            // remains PENDING (never resolves or rejects) until playback is
            // allowed. Boot-time callers (queued DSP tags, visualizer setup) hit
            // this before any click, wedging _dspBuildPromise on a forever-pending
            // promise — after which every later ensureDSPGraph() caller (including
            // togglePlayState for bundled tracks) queued behind it forever. That is
            // why imported files (which bypass ensureDSPGraph) played while the
            // built-in playlist stayed silent in browser testing. Fire-and-forget
            // instead: each playback path resumes the context inside its own user
            // gesture (togglePlayState, onplay handler).
            ctx.resume().catch(() => {});

            try {
                await ctx.audioWorklet.addModule('app/js/dsp-processor.js');
                console.log("[AudioEngine] AudioWorklet dsp-processor module loaded successfully.");
            } catch (err) {
                console.error("[AudioEngine] Failed to load AudioWorklet module. Falling back to native structures.", err);
                showDebugError("AudioWorklet failed to load. Check console/network paths.", "dsp-processor.js");
                return;
            }

            SharedAudio.workletNode = new AudioWorkletNode(ctx, 'dsp-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });

            SharedAudio.workletNode.port.postMessage({
                type: 'init',
                sampleRate: ctx.sampleRate
            });

            this.inputGainNode = ctx.createGain();
            this.inputGainNode.gain.value = 1.0;

            this.musicVolumeNode = ctx.createGain();
            const volSlider = document.getElementById("eq-musicVolumeSlider");
            const initialVol = volSlider ? (parseFloat(volSlider.value) / 100) : 0.5;
            this.musicVolumeNode.gain.value = initialVol;

            this.inputGainNode.connect(SharedAudio.workletNode);

            SharedAudio.workletNode.connect(SharedAudio.compressorFilter);
            SharedAudio.compressorFilter.connect(SharedAudio.compressor);
            SharedAudio.compressor.connect(SharedAudio.compressorGain);
            SharedAudio.compressorGain.connect(SharedAudio.autoGainNode);
            SharedAudio.autoGainNode.connect(SharedAudio.limiter);

            SharedAudio.limiter.connect(SharedAudio.dryGainNode);
            SharedAudio.limiter.connect(SharedAudio.reverbNode);
            SharedAudio.reverbNode.connect(SharedAudio.reverbFilterNode).connect(SharedAudio.wetGainNode);

            SharedAudio.dryGainNode.connect(SharedAudio.crossfeedSplitter);
            SharedAudio.wetGainNode.connect(SharedAudio.crossfeedSplitter);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.directGainL, 0);
            SharedAudio.crossfeedSplitter.connect(SharedAudio.crossfeedFilterL, 0);
            SharedAudio.crossfeedFilterL.connect(SharedAudio.crossfeedDelayL).connect(SharedAudio.crossGainL);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.directGainR, 1);
            SharedAudio.crossfeedSplitter.connect(SharedAudio.crossfeedFilterR, 1);
            SharedAudio.crossfeedFilterR.connect(SharedAudio.crossfeedDelayR).connect(SharedAudio.crossGainR);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.expandGainL, 0);
            SharedAudio.expandGainL.connect(SharedAudio.sumGainR);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.expandGainR, 1);
            SharedAudio.expandGainR.connect(SharedAudio.sumGainL);

            SharedAudio.directGainL.connect(SharedAudio.sumGainL);
            SharedAudio.crossGainR.connect(SharedAudio.sumGainL);

            SharedAudio.directGainR.connect(SharedAudio.sumGainR);
            SharedAudio.crossGainL.connect(SharedAudio.sumGainR);

            SharedAudio.sumGainL.connect(SharedAudio.crossfeedMerger, 0, 0);
            SharedAudio.sumGainR.connect(SharedAudio.crossfeedMerger, 0, 1);

            // M-4/F-6: the merger feeds the volume node directly — clipping
            // protection is handled by the worklet's final-stage lookahead
            // limiter (zero-overshoot), configured right below.
            SharedAudio.crossfeedMerger.connect(this.musicVolumeNode);
            this.musicVolumeNode.connect(SharedAudio.masterGain);

            // Push the persisted safety-limiter state + start the GR meter.
            this.applyMergerLimiterRouting();
            this.startGrMeter();
            const safetyBtn = document.getElementById('btn-merger-limiter');
            if (safetyBtn) {
                safetyBtn.classList.toggle('active-btn', this.mergerLimiterEnabled);
                const lbl = document.getElementById('lbl-merger-limiter-state');
                if (lbl) lbl.textContent = this.mergerLimiterEnabled ? 'Safety: ON' : 'Safety: OFF';
            }
            const meterWrap = document.getElementById('gr-meter-wrap');
            if (meterWrap) meterWrap.classList.toggle('hidden', !this.mergerLimiterEnabled);

            // Route the <audio> element through the DSP graph EXACTLY once, now,
            // while playback hasn't begun. Creating the MediaElementSource lazily
            // inside the element's onplay handler was the startup-mute bug: by the
            // time onplay fired, audio was already playing, and re-routing a playing
            // element strands the stream (or throws), so 'connected' never took and
            // the only working volume control became the raw audioEl.volume — which
            // the boot-path fade had already set to 0. Locking it here guarantees the
            // graph owns volume from the very first millisecond of playback.
            if (this.audioEl && !this.source) {
                this.source = ctx.createMediaElementSource(this.audioEl);
                // Primary element routes through the sourceGain arm so
                // per-track loudness matching and crossfade fades have a gain
                // to ride on (eq-playlist.js _retargetActiveArm /
                // _crossfadeToStandby read this arm).
                if (!this.sourceGain) {
                    this.sourceGain = ctx.createGain();
                    this.sourceGain.gain.value = Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1));
                }
                this.source.connect(this.sourceGain);
                this.sourceGain.connect(this.inputGainNode);
                this.audioEl.volume = 1.0;
                this.connected = true;
            }

            // Gapless/crossfade standby arm: the B element (eq-audio-gapless)
            // preloads the next track and is crossfaded in at the seam. Both
            // arms must share this DSP graph or the standby would be either
            // silent or always-on top of the active track. Guarded because
            // createMediaElementSource throws when called twice on one
            // element, and _buildDSPGraph can re-run after a failed attempt.
            if (!this._gaplessWired && this.gaplessEl) {
                try {
                    this.gaplessSource = ctx.createMediaElementSource(this.gaplessEl);
                    if (!this.gaplessGain) this.gaplessGain = ctx.createGain();
                    this.gaplessGain.gain.value = 0;
                    this.gaplessSource.connect(this.gaplessGain);
                    this.gaplessGain.connect(this.inputGainNode);
                    this.gaplessEl.volume = 1.0;
                    this._gaplessWired = true;
                } catch (e) {
                    console.warn("[AudioEngine] Gapless standby wiring failed:", e);
                }
            }

            this.graphBuilt = true;
            // Flush coalesced DSP state that arrived while the graph was building
            if (this._pendingDspQueue && this._pendingDspQueue.length) {
                const q = [...new Set(this._pendingDspQueue)];
                this._pendingDspQueue = [];
                for (const tag of q) {
                    try {
                        if (tag === 'filters') this.updateAudioConnections();
                        else if (tag === 'crossover') this.updateCrossoverDSP();
                        else if (tag === 'loudness') this.updateLoudnessDSP();
                        else if (tag === 'simulation') this.updateSimulation();
                        else if (tag === 'gear') this.applyGearSimDSP();
                        else if (tag === 'hearing') this.applyHearingCalibrationGains();
                        else if (tag === 'tape') this.updateTapeModDSP();
                        else if (tag === 'masterTone') this.updateMasterTone('bass', document.getElementById('eq-masterBass')?.value || 0);
                    } catch(_) {}
                }
            }
            this.updateAudioConnections();

            this.updatePreamp();
            this.bands.forEach((_, i) => this.updateSlider(i, 'main'));
            this.advancedBands.forEach((_, i) => this.updateSlider(i, 'adv'));
            this.updateSimulation();
            if (this.applyGearSimDSP) this.applyGearSimDSP();
            if (this.updateTapeModDSP) this.updateTapeModDSP();
            this.updateLoudnessDSP();
            this.updateCrossoverDSP();

            const ratioSlider = document.getElementById('comp-ratio-slider');
            if (ratioSlider) {
                this.updateCompressorParam('ratio', parseFloat(ratioSlider.value) / 10);
            }

            // With the standby arm live, preload the next track so the first
            // skip after boot is already seamless (no-op when gapless and
            // crossfade are both disabled — _standbyReady() gates it).
            if (this._preloadNextTrack) this._preloadNextTrack();
        },

        _pendingDspQueue: [],
        _queuePendingDsp: function(tag) {
            if (!this._pendingDspQueue.includes(tag)) this._pendingDspQueue.push(tag);
            if (!this.graphBuilt) this.ensureDSPGraph().catch(()=>{});
        },
        // M-4 + F-6: post-DSP safety limiter. The toggle now drives the
        // worklet's final-stage LOOKAHEAD limiter (zero-overshoot, 5ms
        // lookahead) instead of a main-thread DynamicsCompressor after the
        // crossfeed merger — one engine, better transient behavior, and the
        // GR meter reads its true gain reduction. The merger feeds the
        // volume node directly.
        mergerLimiterEnabled: (localStorage.getItem('settings_merger_limiter') !== '0'),
        applyMergerLimiterRouting: function() {
            if (!SharedAudio.workletNode) return;
            SharedAudio.workletNode.port.postMessage({
                type: 'updateLimiter',
                enabled: this.mergerLimiterEnabled,
                thresholdDb: -1.0
            });
        },
        toggleMergerLimiter: function(force) {
            this.mergerLimiterEnabled = (force !== undefined) ? !!force : !this.mergerLimiterEnabled;
            try { localStorage.setItem('settings_merger_limiter', this.mergerLimiterEnabled ? '1' : '0'); } catch (e) {}
            this.applyMergerLimiterRouting();
            const btn = document.getElementById('btn-merger-limiter');
            if (btn) {
                btn.classList.toggle('active-btn', this.mergerLimiterEnabled);
                // Update the inner label span — do NOT overwrite textContent,
                // which would destroy the span and break every later sync.
                const lbl = document.getElementById('lbl-merger-limiter-state');
                if (lbl) lbl.textContent = this.mergerLimiterEnabled ? 'Safety: ON' : 'Safety: OFF';
            }
            const meterWrap = document.getElementById('gr-meter-wrap');
            if (meterWrap) meterWrap.classList.toggle('hidden', !this.mergerLimiterEnabled);
            showToast(this.mergerLimiterEnabled
                ? "Lookahead safety limiter engaged (zero-overshoot ceiling)."
                : "Safety limiter disabled — watch for clipping with crossfeed/expand on.", this.mergerLimiterEnabled ? "🛡️" : "⚠️");
        },
        // F-6: GR meter loop — consumes the worklet's throttled gainReduction
        // posts and paints the meter bar in the output panel. Runs only while
        // the limiter is enabled AND audio is flowing; started from the DSP
        // graph build and stopped on disable.
        _grMeterRunning: false,
        startGrMeter: function() {
            if (this._grMeterRunning || !SharedAudio.workletNode) return;
            this._grMeterRunning = true;
            SharedAudio.workletNode.port.addEventListener('message', (e) => {
                const d = e.data;
                if (d && d.type === 'gainReduction') {
                    const bar = document.getElementById('gr-meter-bar');
                    const lbl = document.getElementById('gr-meter-label');
                    if (bar || lbl) {
                        const gr = Math.max(0, Math.min(24, d.grDb || 0));
                        // Scale: 0..12dB maps to 0..100% width.
                        const pct = (gr / 12) * 100;
                        if (bar) bar.style.width = pct + '%';
                        if (lbl) {
                            if (gr < 0.1) { lbl.textContent = '0.0 dB'; lbl.style.color = ''; }
                            else if (gr < 3) { lbl.textContent = '-' + gr.toFixed(1) + ' dB'; lbl.style.color = 'var(--accent-green)'; }
                            else if (gr < 8) { lbl.textContent = '-' + gr.toFixed(1) + ' dB'; lbl.style.color = 'var(--accent-amber)'; }
                            else { lbl.textContent = '-' + gr.toFixed(1) + ' dB'; lbl.style.color = 'var(--accent-red, #f87171)'; }
                        }
                    }
                }
            });
        },
        // rAF-coalesced updateAudioConnections: slider drags fire `input`
        // many times per frame (pointermove rate, up to ~240Hz) and each call
        // re-reads ~60 DOM inputs and posts a full filter payload to the
        // worklet. The coalescer keeps ONE scheduled flush per frame; the
        // final state always lands before the next paint, so drags stay
        // sonically identical but no longer queue dozens of redundant
        // message posts between frames.
        _uacScheduled: false,
        _uacCoalesced: function() {
            if (this._uacScheduled) return;
            this._uacScheduled = true;
            const flush = () => {
                this._uacScheduled = false;
                this.updateAudioConnections();
            };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
            else setTimeout(flush, 16);
        },
        updateAudioConnections: function() {
            if (!this.graphBuilt || !SharedAudio.workletNode) {
                this._queuePendingDsp('filters');
                return;
            }

            const payload = [];

            this.bands.forEach((b, i) => {
                const isBypassed = window.bypassedBands.has("m" + i);
                const type = b.type || 'peaking';

                const rawHz = parseFloat(document.getElementById("eq-f" + i)?.value);
                const hz = Number.isFinite(rawHz) ? rawHz : b.hz;

                const rawG = parseFloat(document.getElementById("eq-s" + i)?.value);
                const g = isBypassed ? 0.0 : (Number.isFinite(rawG) ? rawG : 0.0);

                const rawQ = parseFloat(document.getElementById("eq-q_m" + i)?.value);
                const q = Number.isFinite(rawQ) ? rawQ : b.defaultQ;

                // Slope (cascade count) only means anything for Shelf/HP/LP
                // sections; a stale value on Peaking/Notch would silently
                // cascade multiple full-gain copies of the same filter.
                // handleTypeChange() resets b.slope on every type change,
                // but this is the actual DSP trust boundary, so it is
                // re-enforced here too (e.g. against a hand-authored preset
                // that round-trips a mismatched type+slope pair).
                const slopeCapable = (type === 'lowshelf' || type === 'highshelf' || type === 'lowpass' || type === 'highpass');
                const activeSlope = slopeCapable ? (b.slope || 12) : 12;
                const cascadeNodesCount = Math.max(1, Math.round(activeSlope / 12));

                for (let k = 0; k < 4; k++) {
                    const idx = (i * 4) + k;
                    let nodeGain = g;
                    let nodeBypassed = (k >= cascadeNodesCount) || isBypassed || !this.eqEnabled;

                    if (type === 'lowshelf' || type === 'highshelf') {
                        nodeGain = g / cascadeNodesCount;
                    }

                    payload.push({
                        index: idx,
                        bypassed: nodeBypassed,
                        filterType: type,
                        frequency: hz,
                        gain: nodeGain,
                        q: q
                    });
                }
            });

            this.advancedBands.forEach((b, i) => {
                const isBypassed = window.bypassedBands.has("a" + i);
                const type = b.type || 'peaking';
                const hz = b.hz;

                const sEl = document.getElementById("eq-a" + i);
                const qEl = document.getElementById("eq-q_a" + i);

                const rawG = sEl ? parseFloat(sEl.value) : undefined;
                const g = isBypassed ? 0.0 : (Number.isFinite(rawG) ? rawG : (b.g !== undefined ? b.g : 0.0));

                const rawQ = qEl ? parseFloat(qEl.value) : undefined;
                const q = Number.isFinite(rawQ) ? rawQ : (b.q !== undefined ? b.q : b.defaultQ);

                payload.push({
                    index: 40 + i,
                    bypassed: isBypassed || !this.eqEnabled,
                    filterType: type,
                    frequency: hz,
                    gain: g,
                    q: q
                });
            });

            if (this.virtualBands) {
                this.virtualBands.forEach((b, i) => {
                    if (i < 30) {
                        const rawG = parseFloat(b.g);
                        const finalG = Number.isFinite(rawG) ? rawG : 0.0;
                        const rawQ = parseFloat(b.q);
                        const finalQ = Number.isFinite(rawQ) ? rawQ : 1.0;

                        payload.push({
                            index: 50 + i,
                            bypassed: !this.eqEnabled,
                            filterType: b.type || 'peaking',
                            frequency: b.hz,
                            gain: finalG,
                            q: finalQ
                        });
                    }
                });
            }

            SharedAudio.workletNode.port.postMessage({
                type: 'updateFilters',
                filters: payload
            });
        },

                toggleEQ: function() {

            var now = Date.now();
            if (this.lastEQToggle && now - this.lastEQToggle < 300) return;
            this.lastEQToggle = now;

            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const btn = document.getElementById("eqToggleBtn");
            if (this.eqEnabled) {
                this.eqEnabled = false;
                if (btn) {
                    btn.classList.remove('is-on');
                    btn.textContent = "EQ: OFF";
                }
                showToast("Equalizer Disabled (Bypass)", "🚫");
            } else {
                this.eqEnabled = true;
                if (btn) {
                    btn.classList.add('is-on');
                    btn.textContent = "EQ: ON";
                }
                showToast("Equalizer Enabled (Active)", "✅");
            }

                        this.updateAudioConnections();
            Mascot.update();

            // (native filter-gain sync removed — the worklet owns the bank;
            // updateAudioConnections above already re-pushed every band with
            // the new eqEnabled state)

            this.drawCurve();
        },
};
