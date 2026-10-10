const EQ_DynamicsMethods = {
    togglePreventClipping: function() {
        this.preventClipping = !this.preventClipping;
        this.updatePreventClippingUI();
        this.drawCurve();
        if (this.preventClipping) {
            // Forget any previous session's auto-reduction so the watchdog
            // re-baselines against the user's current setting.
            this._agcUserPreamp = undefined;
            this._agcAutoDb = 0;
            this._agcNotified = false;
            // The watchdog tracks the slider value it has accounted for so it can
            // tell a user edit from its own write. Clear it so the first tick after
            // a toggle treats the current slider as the user's, and so the
            // reduction toast starts counting from zero again.
            this._agcLastSeenValue = undefined;
            this._agcAnnouncedDb = 0;
            this._agcUserAdjustAt = undefined;
            showToast("Anti-Clip Headroom Limiter Enabled", "🛡️");
        } else {
            // Restore the user's own preamp. The watchdog lowers the slider to
            // stop clipping but must never permanently rewrite the user's mix
            // setting — previously a single transient peak ratcheted their
            // preamp down and turning CLIP off never gave it back.
            const autoDb = this._agcAutoDb || 0;
            if (autoDb > 0.01) {
                const slider = document.getElementById('eq-preampSlider');
                const restore = Number.isFinite(this._agcUserPreamp) ? this._agcUserPreamp : null;
                if (slider && restore !== null) {
                    slider.value = restore.toFixed(1);
                    try {
                        window.isProgrammaticPreampUpdate = true;
                        this.updatePreamp();
                    } catch (e) {
                        console.warn('[Dynamics] preamp restore failed:', e && e.message);
                    } finally {
                        window.isProgrammaticPreampUpdate = false;
                    }
                    showToast('Preamp restored to ' + restore.toFixed(1) + ' dB (Anti-Clip released ' + autoDb.toFixed(1) + ' dB).', '🛡️');
                } else {
                    // Reduction happened but there is no baseline to go back to,
                    // or no slider to put it on. Say so: the old code fell
                    // through to a bare "Disabled" toast, leaving the user with a
                    // permanently lowered preamp and no explanation for it.
                    showToast('Anti-Clip released ' + autoDb.toFixed(1) +
                        ' dB, but your original preamp could not be recovered - it is still at ' +
                        (slider ? (parseFloat(slider.value) || 0).toFixed(1) : '?') + ' dB.', '⚠️', { duration: 8000 });
                }
            }
            this._agcUserPreamp = undefined;
            this._agcAutoDb = 0;
            this._agcNotified = false;
            this._agcLastSeenValue = undefined;
            this._agcAnnouncedDb = 0;
            this._agcUserAdjustAt = undefined;
            showToast("Anti-Clip Headroom Limiter Disabled", "🛡️");
        }
    },
    toggleCompressor: function() {
        if (!SharedAudio.compressor) return;
        const btn = document.getElementById('btn-compressor-toggle');
        const lbl = document.getElementById('lbl-compressor-state');
        const container = document.getElementById('compressor-sliders-container');
        
        this.compressorActive = !this.compressorActive;
        
        if (!this.compressorActive) {
            setAudioParamSmooth(SharedAudio.compressor.ratio, 1.0, 0.015);
            // Also neutralise make-up gain and the pre-filter, which stay engaged
            // even with ratio=1 and would keep boosting/shaping the signal after
            // the compressor is switched off.
            if (SharedAudio.compressorGain) {
                setAudioParamSmooth(SharedAudio.compressorGain.gain, 1.0, 0.015);
            }
            if (SharedAudio.compressorFilter) {
                setAudioParamSmooth(SharedAudio.compressorFilter.frequency, 1000, 0.015);
            }
            const gainSlider = document.getElementById('comp-gain-slider');
            if (gainSlider) gainSlider.value = 0;
            if (btn) btn.classList.remove('is-on');
            if (lbl) lbl.textContent = "Comp: OFF";
            if (container) {
                container.className = "flex flex-col gap-2 mt-1 opacity-40 pointer-events-none transition-all duration-200";
            }
            showToast("Compressor Deactivated", "🎛️");
        } else {
            const ratioSlider = document.getElementById('comp-ratio-slider');
            const ratioVal = ratioSlider ? parseFloat(ratioSlider.value) / 10 : 4.0;
            setAudioParamSmooth(SharedAudio.compressor.ratio, Number.isFinite(ratioVal) ? ratioVal : 4.0, 0.015);
            
            if (btn) btn.classList.add('is-on');
            if (lbl) lbl.textContent = "Comp: ON";
            if (container) {
                container.className = "flex flex-col gap-2 mt-1 opacity-100 transition-all duration-200";
            }
            showToast("Compressor Activated", "🎛️");
        }
    },
    updateCompressorParam: function(param, val) {
        if (!SharedAudio.compressor) return;
        const value = parseFloat(val);
        if (!Number.isFinite(value)) return; // Safety guard against NaN / empty inputs

        const disp = document.getElementById(`comp-${param}-val`);
        
        if (param === 'attack') {
            setAudioParamSmooth(SharedAudio.compressor.attack, value / 1000, 0.015);
            if (disp) disp.textContent = value.toFixed(1) + " ms";
        } 
        else if (param === 'release') {
            setAudioParamSmooth(SharedAudio.compressor.release, value / 1000, 0.015);
            if (disp) disp.textContent = value.toFixed(1) + " ms";
        } 
        else if (param === 'ratio') {
            setAudioParamSmooth(SharedAudio.compressor.ratio, value, 0.015);
            if (disp) disp.textContent = value.toFixed(1) + " : 1";
        } 
        else if (param === 'frequency') {
            if (SharedAudio.compressorFilter) {
                setAudioParamSmooth(SharedAudio.compressorFilter.frequency, value, 0.015);
            }
            if (disp) {
                disp.textContent = value >= 1000 ? (value / 1000).toFixed(1) + "k Hz" : Math.round(value) + " Hz";
            }
        } 
        else if (param === 'threshold') {
            setAudioParamSmooth(SharedAudio.compressor.threshold, value, 0.015);
            if (disp) disp.textContent = value.toFixed(1) + " dB";
        } 
        else if (param === 'gain') {
            if (SharedAudio.compressorGain) {
                setAudioParamSmooth(SharedAudio.compressorGain.gain, Math.pow(10, value / 20), 0.015);
            }
            if (disp) disp.textContent = (value >= 0 ? "+" : "") + value.toFixed(1) + " dB";
        }
        if (window.syncGlobalSliders) window.syncGlobalSliders();
    },
    updatePreventClippingUI: function() {
        const btn = document.getElementById('btn-prevent-clipping');
        const icon = document.getElementById('prevent-clipping-icon');
        if (btn) {
            if (this.preventClipping) {
                btn.classList.add('is-on');
            } else {
                btn.classList.remove('is-on');
            }
            if (icon) icon.textContent = this.preventClipping ? "CLIP: ON" : "CLIP: OFF";
        }
    },
};