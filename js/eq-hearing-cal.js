const EQ_HearingCalMethods = {
            hearingCalEnabled: false,
            hearingOffsets: [0, 0, 0, 0, 0, 0, 0, 0], // Map to 250, 500, 1k, 2k, 4k, 8k, 12k, 16k
            resonanceCalEnabled: false,
            volumeCompEnabled: false,
            toggleResonanceCal: function() {
                this.resonanceCalEnabled = !this.resonanceCalEnabled;
                const btn = document.getElementById('btn-resonance-cal');
                const lbl = document.getElementById('lbl-resonance-cal');
                
                // Flush target interpolation cache as frequency axes will shift
                PEQDB_Module.STATE.activeCurves.forEach(c => {
                    if (c.role === 'target') c.cachedInterp = null;
                });

                if (btn && lbl) {
                    if (this.resonanceCalEnabled) {
                        btn.classList.add('active-btn');
                        lbl.textContent = 'Resonance: ON';
                        showToast("Ear Resonance Peak (" + PEQDB_Module.resonanceHz + "Hz) Applied!", "🎯");
                    } else {
                        btn.classList.remove('active-btn');
                        lbl.textContent = 'Resonance: Off';
                        showToast("Ear Resonance Peak Disabled", "🎯");
                    }
                }
                this.drawCurve();
            },
            toggleHearingCal: function() {
                this.hearingCalEnabled = !this.hearingCalEnabled;
                const btn = document.getElementById('btn-hearing-cal');
                const lbl = document.getElementById('lbl-hearing-cal');
                if (btn && lbl) {
                    if (this.hearingCalEnabled) {
                        btn.classList.add('active-btn');
                        lbl.textContent = 'Hearing: ON';
                        Mascot.triggerTemporaryExpression('cool', 2000);
                    showToast("Hearing Calibration Profile Applied!", "👂");
                    } else {
                        btn.classList.remove('active-btn');
                        lbl.textContent = 'Hearing: Off';
                        showToast("Hearing Calibration Profile Disabled", "👂");
                    }
                }
                this.applyHearingCalibrationGains();
                this.drawCurve();
            },
            toggleVolumeComp: function() {
                this.volumeCompEnabled = !this.volumeCompEnabled;
                const btn = document.getElementById('btn-volume-comp');
                const lbl = document.getElementById('lbl-volume-comp');
                if (btn && lbl) {
                    if (this.volumeCompEnabled) {
                        btn.classList.add('active-btn');
                        lbl.textContent = 'Compensator: ON';
                        showToast("Auto Headroom & Volume Compensation Active", "🔊");
                    } else {
                        btn.classList.remove('active-btn');
                        lbl.textContent = 'Compensator: Off';
                        showToast("Volume Compensation Disabled", "🔊");
                    }
                }
                this.updatePreamp();
            },
            applyHearingCalibrationGains: function() {
                if (this.graphBuilt && this.hearingFilters) {
                    let maxBoost = 0;
                    this.hearingFilters.forEach((f, idx) => {
                        const gainVal = this.hearingCalEnabled ? (this.hearingOffsets[idx] || 0) : 0;
                        setAudioParamSmooth(f.gain, gainVal);
                        if (gainVal > maxBoost) maxBoost = gainVal;
                    });

                    // Subtractive Headroom Attenuation: pad preamp automatically to prevent digital clipping
const userPreampDb = parseFloat(document.getElementById("eq-preampSlider")?.value || 0);
const finalPreampDb = this.hearingCalEnabled ? (userPreampDb - maxBoost) : userPreampDb;

if (this.preampNode) {
setAudioParamSmooth(this.preampNode.gain, Math.pow(10, finalPreampDb / 20));
}

// Sync the numeric display to show effective preamp value
const preValEl = document.getElementById("eq-preampVal");
if (preValEl && this.hearingCalEnabled) {
preValEl.value = finalPreampDb.toFixed(1);
}
                }
            },
            toggleDeEsser: function() {
                this.deEsserEnabled = !this.deEsserEnabled;
                const btn = document.getElementById('btn-deesser-toggle');
                const lbl = document.getElementById('lbl-deesser-state');
                const sensContainer = document.getElementById('deesser-sens-container');
                
                if (this.deEsserEnabled) {
                    if (btn) {
                        btn.className = 'btn-clear text-rose-400 font-bold rounded text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center';
                        btn.classList.add('active-btn');
                    }
                    if (lbl) {
                        lbl.textContent = 'ON';
                        lbl.className = 'text-[8px] font-bold text-rose-400';
                    }
                    if (sensContainer) {
                        sensContainer.classList.remove('opacity-40', 'pointer-events-none');
                    }
                    showToast("De-Esser active. Monitoring vocal sibilance peaks (4k-8kHz)", "🛡️");
                } else {
                    if (btn) {
                        btn.className = 'btn-clear text-stone-200 font-bold rounded text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center';
                        btn.classList.remove('active-btn');
                    }
                    if (lbl) {
                        lbl.textContent = 'Off';
                        lbl.className = 'text-[8px] font-bold text-zinc-400';
                    }
                    if (sensContainer) {
                        sensContainer.classList.add('opacity-40', 'pointer-events-none');
                    }
                    this.deEsserReductionDb = 0;
                    
                    // Reset the De-Esser parameters on deactivation
                    if (SharedAudio.workletNode) {
                        SharedAudio.workletNode.port.postMessage({
                            type: 'updateSimulations',
                            sims: [{
                                index: 5,
                                bypassed: true,
                                filterType: 'peaking',
                                frequency: 6000,
                                gain: 0.0,
                                q: 2.5
                            }]
                        });
                    }
                    showToast("De-Esser deactivated", "🛡️");
                }
                this.drawCurve();
            },
            updateDeEsserSens: function(val) {
                this.deEsserSensitivity = parseFloat(val);
                const sensVal = document.getElementById('deesser-sens-val');
                if (sensVal) sensVal.textContent = val + "%";
                this.drawCurve();
            },
};
