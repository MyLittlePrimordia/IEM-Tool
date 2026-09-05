const EQ_LoudnessMethods = {
        loudnessActive: false,
        loudnessCalibrationVol: 50,
        loudnessStrength: 100,
        // Worst-case shelf boost currently applied by the compensator (dB).
        // Consumed by updatePreamp() (app-core.js) and effectivePreampDb()
        // (eq-squig-graph.js) so both the audio path and the drawn curve make
        // room for the boost instead of relying on the downstream limiter.
        // MUST stay 0 when loudnessActive is false.
        _loudnessMaxBoost: 0,
        toggleLoudness: function() {
            const btn = document.getElementById('btn-loudness-toggle');
            const lbl = document.getElementById('lbl-loudness-state');
            const container = document.getElementById('loudness-sliders-container');
            
            this.loudnessActive = !this.loudnessActive;
            
            if (!this.loudnessActive) {
                if (btn) btn.classList.remove('is-on');
                if (lbl) lbl.textContent = "Loudness: OFF";
                if (container) {
                    container.className = "flex flex-col gap-2 mt-1 opacity-40 pointer-events-none transition-all duration-200";
                }
                showToast("Loudness Compensator (two-shelf approx) deactivated.", "🔊");
            } else {
                if (btn) btn.classList.add('is-on');
                if (lbl) lbl.textContent = "Loudness: ON";
                if (container) {
                    container.className = "flex flex-col gap-2 mt-1 opacity-100 transition-all duration-200";
                }
                showToast("Loudness Compensator active (two-shelf approx). Calibrating volume-dynamic curves...", "🔊");
            }
            this.updateLoudnessDSP();
            this.drawCurve();
        },
        updateLoudnessParam: function(param, val) {
            const value = parseFloat(val);
            if (param === 'calibration') {
                this.loudnessCalibrationVol = value;
                const disp = document.getElementById('loudness-cal-val');
                if (disp) disp.textContent = value + "% Vol";
            } else if (param === 'strength') {
                this.loudnessStrength = value;
                const disp = document.getElementById('loudness-strength-val');
                if (disp) disp.textContent = value + "%";
            }
            this.updateLoudnessDSP();
            this.drawCurve();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },
        calibrateLoudnessFromVolume: function() {
            const volSlider = document.getElementById("eq-musicVolumeSlider");
            const rawVol = volSlider ? (parseFloat(volSlider.value) || 50) : 50;
            const vol = Math.max(10, Math.min(90, Math.round(rawVol)));
            this.updateLoudnessParam('calibration', vol);
            const calSlider = document.getElementById("loudness-cal-slider");
            if (calSlider) {
                calSlider.value = vol;
                // Programmatic .value writes don't fire input events, so the
                // custom-painted track fill stays at the old position until
                // the next full slider sync — repaint it now (same pattern
                // as the graph-drag path in eq-core.js).
                if (window.paintSliderTrack) window.paintSliderTrack(calSlider);
                else calSlider.style.setProperty('--range-fill', ((vol - parseFloat(calSlider.min || 0)) / (parseFloat(calSlider.max || 100) - parseFloat(calSlider.min || 0)) * 100) + '%');
            }
            showToast(`Calibration set to current volume (${vol}%).`, "🎯");
        },
        updateLoudnessDSP: function() {
            if (!this.graphBuilt || !SharedAudio.workletNode) {
                if (this._queuePendingDsp) this._queuePendingDsp('loudness');
                else { this._pendingDspQueue = this._pendingDspQueue || []; if (!this._pendingDspQueue.includes('loudness')) this._pendingDspQueue.push('loudness'); if (!this.graphBuilt) this.ensureDSPGraph && this.ensureDSPGraph().catch(()=>{}); }
                return;
            }
            
            const currentVol = parseFloat(document.getElementById("eq-musicVolumeSlider")?.value || 50);
            const calibrationVol = this.loudnessCalibrationVol || 50;
            const strength = this.loudnessStrength || 100;

            let bassBoost = 0;
            let trebleBoost = 0;

            if (this.loudnessActive) {
                const volumeDiff = Math.max(0, calibrationVol - currentVol);
                // Perceptual log shape: human loudness contours are not linear —
                // even small drops need noticeable bass compensation, while very
                // quiet keeps boosting. Power-law exponents 0.6 (bass) and 0.65
                // (treble) are a cheap two-shelf approximation (not an ISO 226
                // phon-curve implementation).
                // Max gains (at 0% volume, 100% calibration, 100% strength):
                //   bass:  14.0 dB lowshelf @ 100 Hz, Q=0.7
                //   treble: 8.0 dB highshelf @ 7500 Hz, Q=0.7
                // These values were tuned by ear against pink noise at low SPL
                // and are not derived from a specific ISO 226 phon curve.
                const norm = volumeDiff / 100;
                bassBoost = 14.0 * Math.pow(norm, 0.6) * (strength / 100);
                trebleBoost = 8.0 * Math.pow(norm, 0.65) * (strength / 100);
            }

            // Track the worst-case boost for preamp headroom (see
            // _loudnessMaxBoost above). max() — not sum() — because the two
            // shelves act on largely disjoint bands; summing would over-
            // attenuate by up to ~8 dB at maximum compensation.
            this._loudnessMaxBoost = this.loudnessActive ? Math.max(bassBoost, trebleBoost) : 0;

            // Map loudness-compensation filters directly to worklet simulation indices 8 and 9.
            // (Slots 6/7 belong to the tape-mod sim; 12-19 to hearing calibration;
            // 22/23 to the master tone — using shared slots silently clobbered
            // each other's filters.)
            if (SharedAudio.workletNode) {
                SharedAudio.workletNode.port.postMessage({
                    type: 'updateSimulations',
                    sims: [
                        { index: 8, bypassed: !this.loudnessActive, filterType: 'lowshelf', frequency: 100, gain: bassBoost, q: 0.7 },
                        { index: 9, bypassed: !this.loudnessActive, filterType: 'highshelf', frequency: 7500, gain: trebleBoost, q: 0.7 }
                    ]
                });

                // Boost amount just changed with the volume slider / strength /
                // calibration — re-sync the master preamp so the headroom
                // compensation tracks it live instead of only on the next EQ
                // interaction.
                if (this.graphBuilt) this.updatePreamp();
            }
        },
};
