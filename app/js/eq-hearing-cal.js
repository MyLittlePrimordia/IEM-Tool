const EQ_HearingCalMethods = {
            hearingCalEnabled: false,
            hearingOffsets: [0, 0, 0, 0, 0, 0, 0, 0], // Map to 250, 500, 1k, 2k, 4k, 8k, 12k, 16k
            // MUST stay in sync with applyHearingCalibrationGains() below and the
            // export loops (eq-export.js). getCompositeFilterMagnitude
            // (app-core.js) keys its drawn hearing-cal block off this property,
            // so leaving it undefined silently dropped the calibration from the
            // graph while the worklet kept applying it.
            hearingCalibrationFrequencies: [250, 500, 1000, 2000, 4000, 8000, 12000, 16000],
            resonanceCalEnabled: false,
            volumeCompEnabled: false,
            applyHearingCalibrationGains: function() {
                const hearingFreqs = [250, 500, 1000, 2000, 4000, 8000, 12000, 16000];
                let maxBoost = 0, secondBoost = 0;
                if (this.hearingCalEnabled && Array.isArray(this.hearingOffsets)) {
                    for (let i = 0; i < this.hearingOffsets.length; i++) {
                        const g = this.hearingOffsets[i] || 0;
                        if (g > maxBoost) { secondBoost = maxBoost; maxBoost = g; }
                        else if (g > secondBoost) secondBoost = g;
                    }
                }
                // Q=1.0 peaks 1 octave apart overlap (~1.4 oct BW); adjacent
                // boosts stack at midpoints, so max() alone under-compensates
                // by ~2-3 dB. Add half the second-largest boost, capped at +3 dB.
                const overlapped = maxBoost + Math.min(3, secondBoost * 0.5);
                this._hearingMaxBoost = this.hearingCalEnabled ? overlapped : 0;
                if (!this.graphBuilt || !SharedAudio.workletNode) {
                    if (this._queuePendingDsp) this._queuePendingDsp('hearing');
                    else { this._pendingDspQueue = this._pendingDspQueue || []; if (!this._pendingDspQueue.includes('hearing')) this._pendingDspQueue.push('hearing'); if (!this.graphBuilt) this.ensureDSPGraph && this.ensureDSPGraph().catch(()=>{}); }
                    this.updatePreamp();
                    return;
                }

                if (SharedAudio.workletNode) {
                    const sims = [];
                    for (let i = 0; i < 8; i++) {
                        const gainVal = this.hearingCalEnabled ? (this.hearingOffsets[i] || 0) : 0;
                        sims.push({
                            index: 12 + i,
                            bypassed: gainVal === 0,
                            filterType: 'peaking',
                            frequency: hearingFreqs[i],
                            gain: gainVal,
                            q: 1.0
                        });
                    }
                    SharedAudio.workletNode.port.postMessage({ type: 'updateSimulations', sims });
                }

                this.updatePreamp();
            },
            toggleDeEsser: function() {
                this.deEsserEnabled = !this.deEsserEnabled;
                const btn = document.getElementById('btn-deesser-toggle');
                const lbl = document.getElementById('lbl-deesser-state');
                const sensContainer = document.getElementById('deesser-sens-container');
                
                if (this.deEsserEnabled) {
                    if (btn) {
                        btn.className = 'btn-clear text-rose-400 font-bold text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center';
                        btn.classList.add('active-btn');
                    }
                    if (lbl) {
                        lbl.textContent = 'ON';
                        lbl.className = 'text-[8px] font-bold text-rose-400';
                    }
                    if (sensContainer) {
                        sensContainer.classList.remove('opacity-40', 'pointer-events-none');
                    }
                    // Initialize frequency tracker if not set
                    if (!this.deEsserCurrentFreq) this.deEsserCurrentFreq = 6000;
                    if (!Number.isFinite(this.deEsserSensitivity)) this.deEsserSensitivity = 50;
                    showToast("De-Esser active. Monitoring vocal sibilance peaks (4k-8kHz)", "ðŸ›¡ï¸");
                } else {
                    if (btn) {
                        btn.className = 'btn-clear text-stone-200 font-bold text-[8px] px-1 py-1 h-8 flex flex-col items-center justify-center';
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
                    showToast("De-Esser deactivated", "ðŸ›¡ï¸");
                }
                this.drawCurve();
            },
updateDeEsserSens: function(val) {
                const parsed = parseFloat(val);
                this.deEsserSensitivity = Number.isFinite(parsed) ? parsed : 100;
                // The per-frame viz tracker owns deEsserReductionDb (dynamic
                // sibilance gain, up to -15 dB) and posts it to both the
                // worklet and the drawn curve â€” do NOT write a static value
                // here or it fights the tracker for a frame and spams the
                // worklet with an immediately-superseded gain.
                const sensVal = document.getElementById('deesser-sens-val');
                if (sensVal) sensVal.textContent = val + "%";
                this.drawCurve();
            },
        };
