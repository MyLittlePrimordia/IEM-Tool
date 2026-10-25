window.isMonoMode = false;

const SharedAudio = {
    ctx: null,
    masterGain: null,
    masterPanner: null,
    limiter: null,
    compressor: null,
    analyser: null,
    splitter: null,
    analyserL: null,
    analyserR: null,
    workletNode: null, // Core worklet engine reference
    
    init: function() {
        if (this.ctx) return this.ctx;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass({ latencyHint: 'playback' });
        
        this.masterGain = this.ctx.createGain();

        // Mono is a persisted accessibility choice (Settings > Audio channel).
        // The graph is built lazily, long after the saved mode is restored, so
        // the channel count has to be applied here as well as at click time -
        // otherwise the row could read "Mono" while the context it feeds was
        // created stereo.
        if (window.isMonoMode) {
            this.masterGain.channelCount = 1;
            this.masterGain.channelCountMode = 'explicit';
        }

        // Check for native StereoPannerNode support with a safe fallback for older iOS WebKit
        if (typeof this.ctx.createStereoPanner === 'function') {
            this.masterPanner = this.ctx.createStereoPanner();
        } else {
            this.masterPanner = this.ctx.createGain();
            this.masterPanner.pan = { value: 0 };
        }
        
        this.compressorFilter = this.ctx.createBiquadFilter();
        this.compressorFilter.type = 'peaking';
        this.compressorFilter.frequency.value = 1000;
        this.compressorFilter.Q.value = 1.0;
        this.compressorFilter.gain.value = 0.0;
        
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -15.0;
        this.compressor.knee.value = 30.0;
        this.compressor.ratio.value = 1.0;
        this.compressor.attack.value = 0.015;
        this.compressor.release.value = 0.10;
        
        this.compressorGain = this.ctx.createGain();
        this.compressorGain.gain.value = 1.0;
        
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -0.5;
        this.limiter.knee.value = 4.0;
        this.limiter.ratio.value = 20.0;
        // 0.5ms attack: the previous 3ms let fast transients (kick, plucks,
        // crossfeed-summed peaks) overshoot ~1-2dB past the -0.5dB threshold
        // before gain reduction engaged — audible as clipping on hot masters.
        // 0.5ms is the Web Audio minimum-musical value that still tracks
        // transients without distortion (sub-millisecond pumping artifacts
        // are absorbed by the 4dB soft knee).
        this.limiter.attack.value = 0.0005;
        this.limiter.release.value = 0.08;

        // (the former post-merger DynamicsCompressor safety stage was
        // replaced by the worklet's final-stage lookahead limiter — see
        // dsp-processor.js LookaheadLimiter + eq-core.js applyMergerLimiterRouting)
        
        this.autoGainNode = this.ctx.createGain();
        this.autoGainNode.gain.value = 1.0;
        
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.8;
        
        this.splitter = this.ctx.createChannelSplitter(2);
        this.analyserL = this.ctx.createAnalyser();
        this.analyserR = this.ctx.createAnalyser();
        this.analyserL.fftSize = 1024;
        this.analyserR.fftSize = 1024;
        
        // Create permanent global reverb nodes
        this.dryGainNode = this.ctx.createGain();
        this.dryGainNode.gain.value = 1.0; // Dry path is open by default
        
        this.wetGainNode = this.ctx.createGain();
        this.wetGainNode.gain.value = 0.0; // Wet reverb starts muted to prevent echoing on boot
        
        this.reverbFilterNode = this.ctx.createBiquadFilter();
        this.reverbFilterNode.type = 'lowpass';
        this.reverbFilterNode.frequency.value = 20000;
        
        this.reverbNode = this.ctx.createConvolver();
        const silentBuffer = this.ctx.createBuffer(2, 2, this.ctx.sampleRate);
        this.reverbNode.buffer = silentBuffer;
        
        // Create global crossfeed/spatializer nodes
        this.crossfeedSplitter = this.ctx.createChannelSplitter(2);
        this.crossfeedMerger = this.ctx.createChannelMerger(2);

        this.directGainL = this.ctx.createGain();
        this.directGainR = this.ctx.createGain();
        this.crossGainL = this.ctx.createGain();
        this.crossGainR = this.ctx.createGain();

        this.sumGainL = this.ctx.createGain();
        this.sumGainR = this.ctx.createGain();
        this.sumGainL.gain.value = 1.0;
        this.sumGainR.gain.value = 1.0;

        const monoNodes = [
            this.directGainL, this.directGainR, 
            this.crossGainL, this.crossGainR, 
            this.sumGainL, this.sumGainR
        ];
        monoNodes.forEach(n => {
            n.channelCount = 1;
            n.channelCountMode = 'explicit';
        });

        this.crossfeedDelayL = this.ctx.createDelay(0.02);
        this.crossfeedDelayR = this.ctx.createDelay(0.02);
        this.crossfeedFilterL = this.ctx.createBiquadFilter();
        this.crossfeedFilterR = this.ctx.createBiquadFilter();

        this.crossfeedFilterL.type = 'lowpass';
        this.crossfeedFilterR.type = 'lowpass';
        this.crossfeedFilterL.frequency.value = 700;
        this.crossfeedFilterR.frequency.value = 700;

        this.crossfeedDelayL.delayTime.value = 0.00035;
        this.crossfeedDelayR.delayTime.value = 0.00035;

        this.expandGainL = this.ctx.createGain();
        this.expandGainR = this.ctx.createGain();
        this.expandGainL.gain.value = 0.0;
        this.expandGainR.gain.value = 0.0;

        this.directGainL.gain.value = 1.0;
        this.directGainR.gain.value = 1.0;
        this.crossGainL.gain.value = 0.0;
        this.crossGainR.gain.value = 0.0;

        // Base Output Speakers Path (Pre-connected and shared across diagnostics)
        this.masterGain.connect(this.masterPanner);
        this.masterPanner.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        
        this.analyser.connect(this.splitter);
        this.splitter.connect(this.analyserL, 0);
        this.splitter.connect(this.analyserR, 1);

        // Restore the saved output device. This is deliberately fire-and-forget:
        // a device that was unplugged since last launch must not abort boot, and
        // setSinkId is not implemented in every Chromium build.
        try {
            const savedDevice = localStorage.getItem('settings_audio_output');
            if (savedDevice && typeof this.ctx.setSinkId === 'function') {
                this.ctx.setSinkId(savedDevice).catch(err => {
                    console.warn('[Audio] saved output device unavailable:', err && err.message);
                });
            }
        } catch (e) {}
        
        return this.ctx;
    },

    // U-006: choose the physical output (built-in speakers, USB DAC, amp).
    // All playback in the app reaches ctx.destination, so one sink switch moves
    // the playlist, EQ preview, TestLab tones and A/B arms together.
    async setOutputDevice(deviceId) {
        const ctx = this.init();
        if (!ctx || typeof ctx.setSinkId !== 'function') {
            return { ok: false, error: 'This build of Chromium cannot switch audio outputs.' };
        }
        try {
            await ctx.setSinkId(deviceId || '');
            try { localStorage.setItem('settings_audio_output', deviceId || ''); } catch (e) {}
            return { ok: true, deviceId: deviceId || '' };
        } catch (err) {
            return { ok: false, error: (err && err.message) || String(err) };
        }
    },

    async listOutputDevices() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return [];
        const all = await navigator.mediaDevices.enumerateDevices();
        return all.filter(d => d.kind === 'audiooutput');
    }
};