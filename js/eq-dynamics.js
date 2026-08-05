const EQ_DynamicsMethods = {
    togglePreventClipping: function() {
        this.preventClipping = !this.preventClipping; 
        this.updatePreventClippingUI(); 
        this.drawCurve();
        if (this.preventClipping) {
            showToast("Anti-Clip Headroom Limiter Enabled", "🛡️");
        } else {
            showToast("Anti-Clip Headroom Limiter Disabled", "🛡️");
        }
    },
    toggleDynamicsDrawer: function() {
        var content = document.getElementById('dynamics-drawer-content');
        var arrow = document.getElementById('dynamics-drawer-arrow');
        if (content && arrow) { 
            var h = content.classList.toggle('hidden'); 
            arrow.textContent = h ? "▼" : "▲"; 
        }
    },
    toggleLimiter: function() {
        this.limiterActive = !this.limiterActive;
        const btn = document.getElementById('btn-limiter-toggle');
        const lbl = document.getElementById('lbl-limiter-state');
        
        if (btn) {
            if (this.limiterActive) {
                btn.classList.add('active-btn');
            } else {
                btn.classList.remove('active-btn');
            }
        }
        if (lbl) {
            lbl.textContent = this.limiterActive ? 'Limiter: ON' : 'Limiter: Off';
        }
        
        if (SharedAudio.limiter && SharedAudio.ctx) {
            setAudioParamSmooth(SharedAudio.limiter.ratio, this.limiterActive ? 20.0 : 1.0);
        }
    },
    toggleCompressor: function() {
        if (!SharedAudio.compressor) return;
        const btn = document.getElementById('btn-compressor-toggle');
        const lbl = document.getElementById('lbl-compressor-state');
        const container = document.getElementById('compressor-sliders-container');
        
        this.compressorActive = !this.compressorActive;
        
        if (!this.compressorActive) {
            SharedAudio.compressor.ratio.value = 1.0;
            if (btn) btn.classList.remove('is-on');
            if (lbl) lbl.textContent = "Comp: OFF";
            if (container) {
                container.className = "flex flex-col gap-2 mt-1 opacity-40 pointer-events-none transition-all duration-200";
            }
            showToast("Compressor Deactivated", "🎛️");
        } else {
            const ratioSlider = document.getElementById('comp-ratio-slider');
            const ratioVal = ratioSlider ? parseFloat(ratioSlider.value) / 10 : 4.0;
            SharedAudio.compressor.ratio.value = Number.isFinite(ratioVal) ? ratioVal : 4.0;
            
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