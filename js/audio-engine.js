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
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.08;
        
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
        
        return this.ctx;
    }
};