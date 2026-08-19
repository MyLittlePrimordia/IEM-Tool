const EQ_BandHandlerMethods = {
        cycleBandType: function(i) {
            const b = this.bands[i];
            const types = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];
            let curIdx = types.indexOf(b.type || 'peaking');
            if (curIdx === -1) curIdx = 0;
            const nextType = types[(curIdx + 1) % types.length];
            
            b.type = nextType;

            const btn = document.getElementById(`eq-t_m${i}`);
            if (btn) {
                const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                btn.textContent = labelMap[nextType] || 'PK';
            }

            // Show or hide the slope cycle button dynamically
            const slopeBtn = document.getElementById(`eq-sl_m${i}`);
            if (slopeBtn) {
                const isSlopeVisible = ['lowshelf', 'highshelf', 'lowpass', 'highpass'].includes(nextType);
                if (isSlopeVisible) {
                    slopeBtn.classList.remove('hidden');
                } else {
                    slopeBtn.classList.add('hidden');
                }
            }

            this.handleTypeChange(i, nextType);
        },

        cycleBandSlope: function(i) {
            const b = this.bands[i];
            const slopes = [12, 24, 36, 48];
            let curIdx = slopes.indexOf(b.slope || 12);
            if (curIdx === -1) curIdx = 0;
            const nextSlope = slopes[(curIdx + 1) % slopes.length];
            
            b.slope = nextSlope;

            const btn = document.getElementById(`eq-sl_m${i}`);
            if (btn) {
                btn.textContent = `${nextSlope}dB`;
            }

            this.updateSlider(i, 'main');
            showToast(`Band ${i + 1} slope set to ${nextSlope} dB/octave!`, "🎛️");
        },

        copyBand: function(i) {
            const b = this.bands[i];
            const typeBtn = document.getElementById(`eq-t_m${i}`);
            const rawType = typeBtn ? typeBtn.textContent.trim() : 'PK';
            
            // Map parameters to Equalizer APO native guidelines
            const typeMap = { 'PK': 'PK', 'LS': 'LSC', 'HS': 'HSC', 'HP': 'HP', 'LP': 'LP', 'Notch': 'NO' };
            const apoType = typeMap[rawType] || 'PK';
            
            const hz = document.getElementById(`eq-f${i}`)?.value || b.hz;
            
            const hasNoGain = ['HP', 'LP', 'Notch'].includes(rawType);
            const gain = hasNoGain ? '0.0' : (document.getElementById(`eq-s${i}_num`)?.value || '0.0');
            
            const q = document.getElementById(`eq-q_m${i}_num`)?.value || b.defaultQ;

            const apoLine = `Filter ${i + 1}: ON ${apoType} Fc ${hz} Hz Gain ${parseFloat(gain).toFixed(1)} dB Q ${parseFloat(q).toFixed(2)}`;
            
            navigator.clipboard.writeText(apoLine).then(() => {
                showToast(`Copied APO: "Filter ${i+1}: ON ${apoType}..."`, "📋");
            }).catch(() => {
                showToast("Clipboard access denied.", "⚠️");
            });
        },

        handleFreqSlider: function(i, sliderVal) {
            const hz = this.sliderToLogHz(parseFloat(sliderVal));
            const numInput = document.getElementById(`eq-f${i}`);
            if (numInput) {
                numInput.value = hz;
            }
            this.updateSlider(i);
        },

        handleFreqNumInput: function(i, textVal) {
            const hz = Math.max(20, Math.min(20000, Math.round(parseFloat(textVal) || 1000)));
            const numInput = document.getElementById(`eq-f${i}`);
            if (numInput) numInput.value = hz;

            const slider = document.getElementById(`eq-fs_m${i}`);
            if (slider) {
                slider.value = this.logHzToSlider(hz);
            }
            this.updateSlider(i);
        },

        handleGainNumInput: function(i, textVal) {
            const val = parseFloat(textVal) || 0.0;
            // Slider range is ±20 dB; clamp to it so the displayed value
            // always matches what is actually applied to the audio path.
            const clampedVal = Math.max(-20, Math.min(20, val));
            
            const numInput = document.getElementById(`eq-s${i}_num`);
            if (numInput) numInput.value = clampedVal.toFixed(1);

            const slider = document.getElementById(`eq-s${i}`);
            if (slider) {
                slider.value = clampedVal;
            }
            this.updateSlider(i);
        },

        handleQNumInput: function(i, textVal) {
            const val = parseFloat(textVal) || 1.0;
            // Slider range is Q 0.1–10; clamp to it for the same reason.
            const clampedVal = Math.max(0.1, Math.min(10, val));

            const numInput = document.getElementById(`eq-q_m${i}_num`);
            if (numInput) numInput.value = clampedVal.toFixed(2);

            const slider = document.getElementById(`eq-q_m${i}`);
            if (slider) {
                slider.value = Math.max(0.1, Math.min(10, clampedVal));
            }
            this.updateSlider(i);
        },

        handleTypeChange: function(i, selectedType) {
            const b = this.bands[i];
            b.type = selectedType;

            const gainRow = document.getElementById(`row-gain_m${i}`);
            const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(selectedType);

            if (gainRow) {
                if (hasNoGain) {
                    gainRow.style.opacity = '0.15';
                    gainRow.style.pointerEvents = 'none';
                    const gainNum = document.getElementById(`eq-s${i}_num`);
                    if (gainNum) gainNum.value = 'N/A';
                } else {
                    gainRow.style.opacity = '1';
                    gainRow.style.pointerEvents = 'auto';
                    const gainSlider = document.getElementById(`eq-s${i}`);
                    const gainNum = document.getElementById(`eq-s${i}_num`);
                    if (gainNum && gainSlider) gainNum.value = parseFloat(gainSlider.value).toFixed(1);
                }
            }

            this.updateSlider(i);
        },

        resetBand: function(i) {
            const b = this.bands[i];
            
            const typeBtn = document.getElementById(`eq-t_m${i}`);
            if (typeBtn) typeBtn.textContent = 'PK';
            
            this.handleTypeChange(i, b.defaultType || 'peaking');
            this.handleFreqNumInput(i, b.hz);
            this.handleGainNumInput(i, '0.0');
            this.handleQNumInput(i, b.defaultQ);

            showToast(`Band ${i+1} reset back to defaults.`, "🔄");
        },

        toggleAutoGainMatch: function() {
            this.autoGainMatchActive = !this.autoGainMatchActive;
            const btn = document.getElementById('eqAutoGainMatchBtn');

            if (this.autoGainMatchActive) {
                if (btn) {
                    btn.classList.add('is-on');
                    btn.textContent = "GAIN: ON";
                }
                showToast("Auto-Gain Match active! Normalizing A/B volume.", "⚖️");
            } else {
                if (btn) {
                    btn.classList.remove('is-on');
                    btn.textContent = "GAIN: OFF";
                }
                showToast("Auto-Gain Match disabled.", "⚖️");
            }
            
            this.recalculateAutoGainMatch();
            this.updatePreamp();
        },

        recalculateAutoGainMatch: function() {
            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const { mainVals, advVals } = this.getRealValues();
            
            let sumWeights = 0;
            let sumWeightedGains = 0;
            
            // Perceptually weighted ISO A-weighting curves at standard fader centers
            const mainWeights = [0.3, 0.7, 1.0, 1.0, 1.0, 1.0, 0.8, 0.5, 0.3, 0.1];
            mainVals.forEach((v, idx) => {
                if (v && v.g !== 0 && !window.bypassedBands.has("m" + idx)) {
                    sumWeightedGains += v.g * mainWeights[idx];
                    sumWeights += mainWeights[idx];
                }
            });
            
            const advWeights = [0.2, 0.7, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.3, 0.1];
            advVals.forEach((v, idx) => {
                if (v && v.g !== 0 && !window.bypassedBands.has("a" + idx)) {
                    sumWeightedGains += v.g * advWeights[idx];
                    sumWeights += advWeights[idx];
                }
            });
            
            this.autoGainCompensationDb = sumWeights > 0 ? -(sumWeightedGains / sumWeights) : 0;
        },

        setupDPRCanvas: function(canvas) {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth || 300;
            const h = canvas.clientHeight || 150;
            const targetW = Math.floor(w * dpr);
            const targetH = Math.floor(h * dpr);
            
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext("2d");
                ctx.resetTransform();
                ctx.scale(dpr, dpr);
            }
            return { w, h };
        },

        toggleBandBypass: function(i) {
            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const key = "m" + i;
            const btn = document.getElementById("eq-bp_" + key);
            const card = btn ? btn.closest('.eq-band-card') : null;
            
            if (window.bypassedBands.has(key)) {
                window.bypassedBands.delete(key);
                if (btn) {
                    btn.textContent = "🟢";
                    btn.style.color = "var(--accent-green)";
                }
                if (card) {
                    card.style.opacity = "1";
                    card.classList.remove('bypassed');
                }
            } else {
                window.bypassedBands.add(key);
                if (btn) {
                    btn.textContent = "🔴";
                    btn.style.color = "var(--accent-red)";
                }
                if (card) {
                    card.style.opacity = "0.3";
                    card.classList.add('bypassed');
                }
            }
            
            this.updateSlider(i);
        },
};
