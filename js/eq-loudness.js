const EQ_LoudnessMethods = {
        loudnessActive: false,
        loudnessCalibrationVol: 50,
        loudnessStrength: 100,
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
                showToast("Equal Loudness Compensator deactivated.", "🔊");
            } else {
                if (btn) btn.classList.add('is-on');
                if (lbl) lbl.textContent = "Loudness: ON";
                if (container) {
                    container.className = "flex flex-col gap-2 mt-1 opacity-100 transition-all duration-200";
                }
                showToast("Equal Loudness Compensator active. Calibrating volume-dynamic curves...", "🔊");
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
            if (calSlider) calSlider.value = vol;
            showToast(`Calibration set to current volume (${vol}%).`, "🎯");
        },
        updateLoudnessDSP: function() {
            if (!this.graphBuilt || !SharedAudio.workletNode) return;
            
            const currentVol = parseFloat(document.getElementById("eq-musicVolumeSlider")?.value || 50);
            const calibrationVol = this.loudnessCalibrationVol || 50;
            const strength = this.loudnessStrength || 100;
            
            let bassBoost = 0;
            let trebleBoost = 0;
            
            if (this.loudnessActive) {
                const volumeDiff = Math.max(0, calibrationVol - currentVol);
                bassBoost = (volumeDiff / 100) * 14.0 * (strength / 100);
                trebleBoost = (volumeDiff / 100) * 8.0 * (strength / 100);
            }
            
            // Map Fletcher-Munson filters directly to worklet simulation indices 6 and 7
            SharedAudio.workletNode.port.postMessage({
                type: 'updateSimulations',
                sims: [
                    { index: 6, bypassed: !this.loudnessActive, filterType: 'lowshelf', frequency: 100, gain: bassBoost, q: 0.7 },
                    { index: 7, bypassed: !this.loudnessActive, filterType: 'highshelf', frequency: 7500, gain: trebleBoost, q: 0.7 }
                ]
            });
        },
};
