// TestLab burn-in signal generator and timer.
// Split out of testlab-module.js; merged into TestLab_Module via Object.assign there.
const TestLab_BurninMethods = {
    burninActive: false,

    burninType: 'pink',

    burninDurationHours: 1,

    burninSecondsLeft: 3600,

    burninSecondsElapsed: 0,

    burninIntervalId: null,

    burninOsc: null,

    burninNoise: null,

    burninGainNode: null,

    burninVolumeDb: -12.0,

    setBurninTime: function(hours) {
        if (this.burninActive) return;
        this.burninDurationHours = hours;
        this.burninSecondsLeft = hours === 0 ? -1 : hours * 3600;

        const btn = document.getElementById('burnin-time-btn');
        if (btn) {
            const labels = { 1: '1H', 4: '4H', 8: '8H', 24: '24H', 0: 'Infinite' };
            btn.textContent = ` ${labels[hours] || hours + 'H'}`;
        }
        this.updateBurninDisplay();
    },

    setBurninSignal: function(sigType) {
        if (this.burninActive) return;
        this.burninType = sigType;

        const btn = document.getElementById('burnin-signal-btn');
        if (btn) {
            const labels = { pink: 'Pink', brown: 'Brown', sweep: 'Sweep', cycle: 'Cycle' };
            btn.textContent = ` ${labels[sigType] || sigType}`;
        }
    },

    cycleBurninSignal: function() {
        if (this.burninActive) return;
        const signals = ['pink', 'brown', 'sweep', 'cycle'];
        const curIdx = signals.indexOf(this.burninType);
        const nextIdx = (curIdx + 1) % signals.length;
        this.setBurninSignal(signals[nextIdx]);
    },

    cycleBurninTime: function() {
        if (this.burninActive) return;
        const times = [1, 4, 8, 24, 0];
        const curIdx = times.indexOf(this.burninDurationHours);
        const nextIdx = (curIdx + 1) % times.length;
        this.setBurninTime(times[nextIdx]);
    },

    updateBurninVolume: function(val) {
        this.burninVolumeDb = parseFloat(val);
        const disp = document.getElementById('burnin-volume-display');
        if (disp) disp.textContent = this.burninVolumeDb.toFixed(1) + " dB";

        if (this.burninActive && this.burninGainNode && SharedAudio.ctx) {
            const linearGain = Math.pow(10, this.burninVolumeDb / 20);
            setAudioParamSmooth(this.burninGainNode.gain, linearGain);
        }
    },

    updateBurninDisplay: function() {
        const timerDisp = document.getElementById('burnin-time-display');
        const headerLabel = document.getElementById('burnin-header-label');
        if (!timerDisp) return;

        if (this.burninSecondsLeft === -1) {
            if (headerLabel) headerLabel.textContent = "Duration";
            const h = Math.floor(this.burninSecondsElapsed / 3600).toString().padStart(2, '0');
            const m = Math.floor((this.burninSecondsElapsed % 3600) / 60).toString().padStart(2, '0');
            const s = (this.burninSecondsElapsed % 60).toString().padStart(2, '0');
            timerDisp.textContent = `${h}:${m}:${s}`;
            return;
        }

        if (headerLabel) headerLabel.textContent = "Remaining";
        const h = Math.floor(this.burninSecondsLeft / 3600).toString().padStart(2, '0');
        const m = Math.floor((this.burninSecondsLeft % 3600) / 60).toString().padStart(2, '0');
        const s = (this.burninSecondsLeft % 60).toString().padStart(2, '0');
        timerDisp.textContent = `${h}:${m}:${s}`;
    },

    updateBurninStatus: function(status) {
        const statusDisp = document.getElementById('burnin-status-display');
        const statusEmoji = document.getElementById('burnin-status-emoji');
        const hourglass = document.getElementById('burnin-hourglass');

        if (!statusDisp || !statusEmoji) return;

        if (status === 'idle') {
            statusDisp.textContent = "Idle";
            statusDisp.className = "text-[10px] font-black uppercase tracking-widest text-zinc-400";
            statusEmoji.textContent = "💤";
            statusEmoji.className = "text-xs";
            if (hourglass) {
                hourglass.textContent = "⌛";
                hourglass.classList.remove('animate-hourglass');
            }
        } else if (status === 'burning') {
            statusDisp.textContent = "Burning-In";
            statusDisp.className = "text-[10px] font-black uppercase tracking-widest text-emerald-400 animate-state-active";
            statusEmoji.textContent = "🔥";
            statusEmoji.className = "text-xs animate-state-active";
            if (hourglass) {
                hourglass.textContent = "⏳";
                hourglass.classList.add('animate-hourglass');
            }
        } else if (status === 'resting') {
            statusDisp.textContent = "Resting";
            statusDisp.className = "text-[10px] font-black uppercase tracking-widest text-amber-500 animate-state-active";
            statusEmoji.textContent = "💤";
            statusEmoji.className = "text-xs animate-state-active";
            if (hourglass) {
                hourglass.textContent = "⏳";
                hourglass.classList.add('animate-hourglass');
            }
        }
    },

    toggleBurnin: async function() {
        const startBtn = document.getElementById('burnin-start-btn');
        if (this.burninActive) {
            this.stopBurninActual();
            showToast("Burn-In session paused.", "⏳");
        } else {
            this.stopAll();

            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.init(); await ctx.resume();

            this.burninGainNode = ctx.createGain();
            const linearGain = Math.pow(10, this.burninVolumeDb / 20);
            this.burninGainNode.gain.value = linearGain;

            this.burninGainNode.connect(EQ_Module.preampNode || SharedAudio.masterGain);

            this.burninActive = true;
            this.burninSecondsElapsed = 0;

            if (startBtn) {
                startBtn.textContent = "Stop";
            }

                        Mascot.triggerTemporaryExpression('hot', 2000);
            this.startBurninSignal();

            this.burninIntervalId = setInterval(() => {
                this.tickBurnin();
            }, 1000);

            this.startImbalanceMeter();
            showToast("Burn-In session started!", "🔥");
        }
    },

    startBurninSignal: function() {
        this.stopBurninSignal();

        const ctx = SharedAudio.ctx;
        const now = ctx.currentTime;

        let activeType = this.burninType;

        if (this.burninType === 'cycle') {
            const cycleSecs = (this.burninSecondsElapsed || 0) % 60;
            if (cycleSecs < 15) {
                activeType = 'pink';
            } else if (cycleSecs < 30) {
                activeType = 'brown';
            } else if (cycleSecs < 45) {
                activeType = 'sweep';
            } else {
                activeType = 'rest';
            }
        }

        if (activeType === 'rest') {
            this.updateBurninStatus('resting');
            return;
        }

        this.updateBurninStatus('burning');

        if (activeType === 'pink') {
            this.burninNoise = ctx.createBufferSource();
            this.burninNoise.buffer = this.createSpatialBuffer(ctx, 'pink_noise');
            this.burninNoise.loop = true;
            this.burninNoise.connect(this.burninGainNode);
            this.burninNoise.start();
        }
        else if (activeType === 'brown') {
            this.burninNoise = ctx.createBufferSource();
            this.burninNoise.buffer = this.createSpatialBuffer(ctx, 'brown_noise');
            this.burninNoise.loop = true;
            this.burninNoise.connect(this.burninGainNode);
            this.burninNoise.start();
        }
        else if (activeType === 'sweep') {
            this.burninOsc = ctx.createOscillator();
            this.burninOsc.type = 'sine';

            this.burninOsc.frequency.setValueAtTime(20, now);
            this.burninOsc.frequency.exponentialRampToValueAtTime(20000, now + 15.0);

            this.burninOsc.connect(this.burninGainNode);
            this.burninOsc.start();

            this.burninSweepTimeout = setInterval(() => {
                if (this.burninActive && this.burninOsc) {
                    const sweepNow = ctx.currentTime;
                    this.burninOsc.frequency.cancelScheduledValues(sweepNow);
                    this.burninOsc.frequency.setValueAtTime(20, sweepNow);
                    this.burninOsc.frequency.exponentialRampToValueAtTime(20000, sweepNow + 15.0);
                }
            }, 15000);
        }
    },

    stopBurninSignal: function() {
        if (this.burninNoise) {
            try { this.burninNoise.stop(); } catch(e){}
            this.burninNoise.disconnect();
            this.burninNoise = null;
        }
        if (this.burninOsc) {
            try { this.burninOsc.stop(); } catch(e){}
            this.burninOsc.disconnect();
            this.burninOsc = null;
        }
        if (this.burninSweepTimeout) {
            clearInterval(this.burninSweepTimeout);
            this.burninSweepTimeout = null;
        }
    },

    tickBurnin: function() {
        if (!this.burninActive) return;

        this.burninSecondsElapsed++;

        if (this.burninSecondsLeft > 0) {
            this.burninSecondsLeft--;
            this.updateBurninDisplay();

            if (this.burninType === 'cycle') {
                const phase = this.burninSecondsElapsed % 15;
                if (phase === 0) {
                    this.startBurninSignal();
                }
            }
        }
        else if (this.burninSecondsLeft === -1) {
            this.updateBurninDisplay();
            if (this.burninType === 'cycle' && this.burninSecondsElapsed % 15 === 0) {
                this.startBurninSignal();
            }
        }
        else if (this.burninSecondsLeft === 0) {
            this.stopBurninActual();
            this.resetBurnin();
            Mascot.triggerTemporaryExpression('cool', 2000);
            showToast("Burn-In session completed!", "🎉");
        }
    },

    stopBurninActual: function() {
            this.burninActive = false;
            if (this.burninIntervalId) {
                clearInterval(this.burninIntervalId);
                this.burninIntervalId = null;
            }
            this.stopBurninSignal();

            if (this.burninGainNode) {
                this.burninGainNode.disconnect();
                this.burninGainNode = null;
            }

            const startBtn = document.getElementById('burnin-start-btn');
            if (startBtn) {
                startBtn.textContent = "Start";
            }

            this.updateBurninStatus('idle');

            Mascot.isOverrideActive = false;
            Mascot.clearTimers();
            Mascot.setExpression('idle');
            Mascot.update();
        },

    resetBurnin: function() {
        this.stopBurninActual();
        this.setBurninTime(this.burninDurationHours);
        showToast("Burn-In timer reset.", "🔄");
    },
};
