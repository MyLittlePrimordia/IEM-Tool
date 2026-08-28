// Split out of the former monolithic app-core.js (2026 refactor).
// Tone_Module: the simple tone-sweep/tone-generator test.

    const Tone_Module = {
        osc: null, gain: null, current: 0, sweepTimer: null,
        init: function() {
            this.updateUI();
        },
        updateToneFreq: function() {
            const slider = document.getElementById('tone-slider');
            this.current = slider ? parseInt(slider.value) : 1000;
            this.updateUI();
            if(this.osc) {
                setAudioParamSmooth(this.osc.frequency, this.current);
            }

            Mascot.isOverrideActive = true;

            if (this.current < 150) {
                Mascot.setExpression('rumble');
            } else if (this.current > 4000) {
                Mascot.setExpression('pain');
            } else {
                Mascot.setExpression('vibing');
            }

            clearTimeout(this.toneMascotResetTimeout);
            this.toneMascotResetTimeout = setTimeout(() => {
                Mascot.isOverrideActive = false;
                Mascot.setExpression('idle');
                Mascot.update();
            }, 400);
        },
        updateToneVolume: function() { const volEl = document.getElementById('tone-volume'); const vol = volEl ? parseFloat(volEl.value) : 50; const disp = document.getElementById('tone-vol-display'); if (disp) disp.innerText = vol + '%'; if(this.gain) { setAudioParamSmooth(this.gain.gain, vol / 100 * 0.2); } },
        toneTogglePlay: async function() {
            if(this.osc) { this.toneStop(); return; }
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.init(); await ctx.resume();

            if (EQ_Module.musicVolumeNode && EQ_Module.audioEl && EQ_Module.audioEl.paused) {
                const musicVolSlider = document.getElementById('eq-musicVolumeSlider');
                const musicVol = musicVolSlider ? parseFloat(musicVolSlider.value) / 100 : 0.5;
                EQ_Module.fadeMusicVolume(musicVol, 0.05);
            }
            this.osc = ctx.createOscillator(); this.gain = ctx.createGain(); this.osc.type = "sine"; this.osc.frequency.value = this.current;
            const volEl = document.getElementById('tone-volume'); const vol = volEl ? parseFloat(volEl.value) : 50; this.gain.gain.value = vol / 100 * 0.2;
            this.osc.connect(this.gain);

            this.gain.connect(EQ_Module.inputGainNode || SharedAudio.masterGain);

            this.osc.start();
            const btn2 = document.getElementById("tone-playBtn2"); if(btn2) { btn2.classList.add("tone-playing"); btn2.innerHTML = 'Pause'; }

            if (!EQ_Module.vizLoopRunning) {
                EQ_Module.startVisualizer();
            }
        },
        toneStop: function() {
            if (this.sweepTimer) {
                clearInterval(this.sweepTimer);
                this.sweepTimer = null;
            }
            const btnSweep = document.querySelector('button[onclick="Tone.toneSweep()"]');
            if (btnSweep) {
                btnSweep.innerHTML = 'Auto Sweep';
                btnSweep.classList.remove('active-yellow');
            }
            if(this.osc) { try { this.osc.stop(); } catch(e){} this.osc.disconnect(); this.osc = null; }
            if(this.gain) { this.gain.disconnect(); this.gain = null; }
            const btn2 = document.getElementById("tone-playBtn2"); if(btn2) { btn2.classList.remove("tone-playing"); btn2.innerHTML = 'Play'; }
            Mascot.update();
        },
toneSweep: async function() {
if (this.sweepTimer) {
clearInterval(this.sweepTimer);
this.sweepTimer = null;
const btnSweep = document.querySelector('button[onclick="Tone.toneSweep()"]');
if (btnSweep) {
btnSweep.innerHTML = 'Auto Sweep';
btnSweep.classList.remove('active-yellow');
}
return;
}
            if (!this.osc) {
                await this.toneTogglePlay();
            }
            const btnSweep = document.querySelector('button[onclick="Tone.toneSweep()"]');
            if (btnSweep) {
                btnSweep.innerHTML = 'Stop Sweep';
                btnSweep.classList.add('active-yellow');
            }
                        this.sweepTimer = setInterval(() => {
                this.current += 30;
                if(this.current > 20000) this.current = 100;
                const slider = document.getElementById('tone-slider');
                if (slider) {
                    slider.value = this.current;
                    if (window.syncGlobalSliders) window.syncGlobalSliders();
                }
                this.updateUI();
                if(this.osc) setAudioParamSmooth(this.osc.frequency, this.current);

                Mascot.isOverrideActive = false;

                var freq = this.current;
                if (freq < 150) {
                    Mascot.setExpression('rumble');
                    Mascot.applyReactiveAnimation('rumble', 0.6);
                } else if (freq > 4000) {
                    Mascot.setExpression('pain');
                    Mascot.applyReactiveAnimation('pain', 0.6);
                } else {
                    Mascot.setExpression('vibing');
                    Mascot.applyReactiveAnimation('vibing', 0.5);
                }
                        }, 50);
        },
        region: function(f) { if(f < 60) return "Sub Bass"; if(f < 120) return "Mid Bass"; if(f < 250) return "Upper Bass"; if(f < 2000) return "Midrange"; if(f < 5000) return "Upper Mids"; if(f < 10000) return "Treble"; return "Air"; },
        updateUI: function() {
                        const freqEl = document.getElementById("tone-freq");
            const regionEl = document.getElementById("tone-region");
            if (freqEl) freqEl.innerText = this.current + " Hz";
            if (regionEl) regionEl.innerText = this.region(this.current);

            const cursor = document.getElementById("tone-cursor");
            if (cursor) cursor.style.left = (this.current/20000)*100 + "%";

            const slider = document.getElementById("tone-slider");
            if (slider) {
                if (window.paintSliderTrack) {
                    window.paintSliderTrack(slider);
                } else {
                    const percent = (this.current / 20000) * 100;
                    slider.style.background = `linear-gradient(90deg, var(--accent-blue) ${percent}%, #ffffff ${percent}%)`;
                }
            }
        },
        getState: function() { return { freq: this.current, volume: document.getElementById('tone-volume').value }; },
        loadState: function(state) {
            if (state) { this.current = state.freq || 0; document.getElementById('tone-slider').value = this.current; document.getElementById('tone-volume').value = (state.volume || 50); document.getElementById('tone-vol-display').innerText = (state.volume || 50) + '%'; if(this.gain) setAudioParamSmooth(this.gain.gain, (state.volume || 50) / 100 * 0.2); } else { this.reset(); }
            this.updateUI();
        },
        reset: function() {
            this.current = 0; document.getElementById('tone-slider').value = 0; document.getElementById('tone-volume').value = 50; document.getElementById('tone-vol-display').innerText = '50%';
            if(this.gain) setAudioParamSmooth(this.gain.gain, 50 / 100 * 0.2); this.updateUI();
        }
    };

