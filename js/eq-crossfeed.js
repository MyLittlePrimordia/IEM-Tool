const EQ_CrossfeedMethods = {
    cycleCrossfeed: function() {
        const options = ['off', 'on'];
        const curIdx = options.indexOf(this.crossfeedState);
        this.crossfeedState = options[(curIdx + 1) % options.length];
        this.updateCrossfeedDSP();
        this.updateCrossfeedUI();
    },
    setSpeakerSimMode: function(mode) {
        this.speakerSimMode = mode;
        document.querySelectorAll('.spk-sim-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById('spk-sim-' + mode);
        if (activeBtn) activeBtn.classList.add('active');
        
        this.updateCrossfeedDSP();
    },
    updateCrossfeedUI: function() {
        const btn = document.getElementById('btn-crossfeed-toggle');
        const container = document.getElementById('crossfeed-level-container');
        if (btn) {
            if (this.crossfeedState === 'off') {
                btn.textContent = "Feed: Off";
                btn.className = 'btn-clear text-stone-200 font-bold rounded text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center';
                if (container) container.classList.add('opacity-40', 'pointer-events-none');
            } else {
                btn.textContent = "Feed: ON";
                btn.className = 'btn-clear text-emerald-400 border-emerald-500/50 bg-emerald-950/15 font-bold rounded text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center active-btn';
                if (container) container.classList.remove('opacity-40', 'pointer-events-none');
            }
        }
    },
    updateCrossfeedDSP: function() {
            // Diagnostics check: see if the global audio graph has been initialized
            if (!SharedAudio.ctx || !SharedAudio.crossGainL) {
                console.warn("[Crossfeed Debug] Output nodes are not initialized yet. Play music or a test sound first.");
                return;
            }

            const slider = document.getElementById('crossfeed-level');
            const levelVal = slider ? parseFloat(slider.value) : 0;

            // Calibrate to a spacious, highly audible 58% maximum room bleed
            const crossVal = (levelVal / 100) * 0.58;
            
            // Automatic volume compensation to prevent quiet drops
            const directVal = 1.0 - (crossVal * 0.35);
            
            // 650 microsecond delay emulates a wide, expansive speaker soundstage
            const delaySecs = 0.00065;
            
            // 2.0kHz lowpass lets vocal sparkle and room echo bleed naturally for organic depth
            const filterHz = 2000;
            
            console.log(`[Crossfeed Active] Slider Level: ${levelVal}% | Bleed Gain: ${crossVal.toFixed(3)} | Direct Gain: ${directVal.toFixed(3)}`);

            // Apply parameters smoothly to the global output DSP graph
            setAudioParamSmooth(SharedAudio.crossGainL.gain, crossVal, 0.02);
            setAudioParamSmooth(SharedAudio.crossGainR.gain, crossVal, 0.02);
            setAudioParamSmooth(SharedAudio.directGainL.gain, directVal, 0.02);
            setAudioParamSmooth(SharedAudio.directGainR.gain, directVal, 0.02);

            // Calculate and apply phase-inverted coefficients for Stereo Expansion
            const expandVal = -(this.stereoExpandLevel / 100) * 0.65; // High-precision negative gain
            if (SharedAudio.expandGainL && SharedAudio.expandGainR) {
                setAudioParamSmooth(SharedAudio.expandGainL.gain, expandVal, 0.02);
                setAudioParamSmooth(SharedAudio.expandGainR.gain, expandVal, 0.02);
            }

            if (SharedAudio.crossfeedDelayL && SharedAudio.crossfeedDelayR) {
                setAudioParamSmooth(SharedAudio.crossfeedDelayL.delayTime, delaySecs, 0.02);
                setAudioParamSmooth(SharedAudio.crossfeedDelayR.delayTime, delaySecs, 0.02);
            }
            if (SharedAudio.crossfeedFilterL && SharedAudio.crossfeedFilterR) {
                setAudioParamSmooth(SharedAudio.crossfeedFilterL.frequency, filterHz, 0.02);
                setAudioParamSmooth(SharedAudio.crossfeedFilterR.frequency, filterHz, 0.02);
            }
        },
    updateCrossfeedLevel: function(val) {
        const valEl = document.getElementById('crossfeed-level-val');
        if (valEl) valEl.textContent = val + "%";
        this.updateCrossfeedDSP();
    },
};
