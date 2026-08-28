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

            // Per-mode presets: each speaker position varies the arrival
            // (delay), the high-frequency rolloff (lowpass) and the bleed
            // level. 'natural' keeps the historic behavior.
            const MODE_PRESETS = {
                natural:   { delayMs: 0.65, filterHz: 2000, level: 1.0 },
                nearfield: { delayMs: 0.45, filterHz: 4200, level: 0.9 },
                midfield:  { delayMs: 0.65, filterHz: 2000, level: 1.0 },
                farfield:  { delayMs: 0.85, filterHz: 1400, level: 1.2 },
                'near/mid': { delayMs: 0.55, filterHz: 3100, level: 0.95 },
                'mid/far':  { delayMs: 0.75, filterHz: 1700, level: 1.1 }
            };
            const preset = MODE_PRESETS[this.speakerSimMode] || MODE_PRESETS.natural;

            // When the crossfeed is switched OFF, fully neutralize the bleed
            // path — the level slider value and stereo-expand level must not
            // keep leaking audio across channels while off.
            const isOff = (this.crossfeedState === 'off');
            const crossVal = isOff ? 0 : (levelVal / 100) * 0.58 * preset.level;
            
            // Automatic volume compensation to prevent quiet drops.
            // INTENTIONALLY partial (0.35 factor): crossfeed attenuates
            // perceived level, and full unity replacement would over-brighten
            // the direct path. For centered/mono content direct+cross peaks
            // around +1..+3 dB depending on preset level — bounded by design
            // and absorbed by the downstream limiter (-0.5 dB threshold).
            // Do not "fix" this to equal-power without also retuning the
            // presets; users have calibrated levels around this response.
            const directVal = 1.0 - (crossVal * 0.35);
            
            // Delay emulates the arrival time of the simulated speaker position
            const delaySecs = preset.delayMs / 1000;
            
            // Lowpass lets vocal sparkle and room echo bleed naturally for organic depth
            const filterHz = preset.filterHz;
            
            // Apply parameters smoothly to the global output DSP graph
            setAudioParamSmooth(SharedAudio.crossGainL.gain, crossVal, 0.02);
            setAudioParamSmooth(SharedAudio.crossGainR.gain, crossVal, 0.02);
            setAudioParamSmooth(SharedAudio.directGainL.gain, directVal, 0.02);
            setAudioParamSmooth(SharedAudio.directGainR.gain, directVal, 0.02);

            // Calculate and apply phase-inverted coefficients for Stereo Expansion
            const expandVal = isOff ? 0 : -(this.stereoExpandLevel / 100) * 0.65; // High-precision negative gain
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
