// Split out of the former monolithic app-core.js (2026 refactor).
// TestLab_Module: ABX / spatial soundstage / resonance / hearing tests.
    const TestLab_Module = {
        activeNodes: [],
        activeLeftTab: 'resonance',
        leftTabModes: [
            { id: 'resonance', label: 'Resonance', emoji: '🎯' },
            { id: 'balance', label: 'Balance', emoji: '⚖️' },
            { id: 'burnin', label: 'Burn-In', emoji: '🔥' }
        ],
        cycleLeftTab: function(dir) {
            const currentIdx = this.leftTabModes.findIndex(m => m.id === this.activeLeftTab);
            const total = this.leftTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchLeftTab(this.leftTabModes[nextIdx].id);
        },
        switchLeftTab: function(tabId) {
            this.activeLeftTab = tabId;
            ['resonance', 'balance', 'burnin'].forEach(id => {
                const panel = document.getElementById('tl-left-panel-' + id);
                const btn = document.getElementById('tl-left-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) {
                        btn.classList.add('active');
                        btn.setAttribute('aria-selected', 'true');
                    } else {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-selected', 'false');
                    }
                }
            });
            // The ◀/▶ stepper label was removed in R7 when this became a 3-up
            // segmented row. The lookup is deleted rather than left behind: a
            // stale getElementById for a removed id would push the dead-ref
            // ratchet over its baseline.
        },

        activeRightTab: 'tone',
        rightTabModes: [
            { id: 'tone', label: 'Tone Gen', emoji: '🔊' },
            { id: 'ab', label: 'A/B Test', emoji: '🆚' },
            { id: 'hearing', label: 'Hearing', emoji: '👂' }
        ],
        cycleRightTab: function(dir) {
            const currentIdx = this.rightTabModes.findIndex(m => m.id === this.activeRightTab);
            const total = this.rightTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchRightTab(this.rightTabModes[nextIdx].id);
        },
        switchRightTab: function(tabId) {
            this.activeRightTab = tabId;
            ['tone', 'ab', 'hearing'].forEach(id => {
                const panel = document.getElementById('tl-right-panel-' + id);
                const btn = document.getElementById('tl-right-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) {
                        btn.classList.add('active');
                        btn.setAttribute('aria-selected', 'true');
                    } else {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-selected', 'false');
                    }
                }
            });
            // See the note in switchLeftTab about the removed stepper label.
        },



        imbalanceInterval: null,
        isChannelSwapped: false,
        channelToneOsc: null,
        channelToneGain: null,
        channelTonePanner: null,

        playbackActive: false,



        init: function() {
            // Guarded: initSpatialPad adds window/pad listeners that would
            // double-bind (double-firing drags) on a second init.
            if (this._initialized) return;
            this._initialized = true;
            this.initSpatialPad();
            this.initABTest();
            this.loadSoundLibrary();

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            if (masterVolSlider) {
                masterVolSlider.addEventListener("input", () => {
                    if (this.abPlaying) {
                        this.updateABFade();
                    }
                    if (this.channelToneGain && SharedAudio.ctx) {
                        const vol = parseFloat(masterVolSlider.value) / 100;
                        setAudioParamSmooth(this.channelToneGain.gain, 0.15 * vol, 0.02);
                    }
                });
            }
        },







// hard safety ceiling (matches old safeVol cap)
// start audible for most users











        // The resonance sweeper owns its OWN oscillator. It previously stored
        // it in hearingOsc/hearingGain, so a sweep running concurrently with
        // (or right after) a hearing test would retune the hearing tone to
        // 6.4–9.6 kHz while the UI displayed a completely different pitch.
        stopResonanceTone: function() {
            if (this.resonanceOsc) {
                try { this.resonanceOsc.stop(); } catch(e){}
                this.resonanceOsc.disconnect();
                this.resonanceOsc = null;
            }
            if (this.resonanceGain) {
                this.resonanceGain.disconnect();
                this.resonanceGain = null;
            }
        },






        startImbalanceMeter: function() {
            if (this.imbalanceInterval) return;

            const arrayL = new Uint8Array(SharedAudio.analyserL.frequencyBinCount);
            const arrayR = new Uint8Array(SharedAudio.analyserR.frequencyBinCount);

            this.imbalanceInterval = setInterval(() => {
                if (!SharedAudio.ctx || !SharedAudio.analyserL || !SharedAudio.analyserR) return;
                // Skip all sampling/DOM writes while the meters can't be seen
                // (Test-Lab tab hidden or page backgrounded). The interval
                // itself keeps running so re-entering the tab is instant.
                const meterLCheck = document.getElementById('imbalance-meter-l');
                if (!meterLCheck || meterLCheck.offsetParent === null || document.hidden) return;
                SharedAudio.analyserL.getByteTimeDomainData(arrayL);
                SharedAudio.analyserR.getByteTimeDomainData(arrayR);

                let sumL = 0, sumR = 0;
                for (let i = 0; i < arrayL.length; i++) {
                    const valL = (arrayL[i] - 128) / 128;
                    const valR = (arrayR[i] - 128) / 128;
                    sumL += valL * valL;
                    sumR += valR * valR;
                }
                const rmsL = Math.sqrt(sumL / arrayL.length);
                const rmsR = Math.sqrt(sumR / arrayR.length);

                const pctL = rmsL < 0.0015 ? 0 : Math.min(100, rmsL * 350);
                const pctR = rmsR < 0.0015 ? 0 : Math.min(100, rmsR * 350);

                const meterL = meterLCheck;
                const meterR = document.getElementById('imbalance-meter-r');
                if (meterL) meterL.style.width = pctL + "%";
                if (meterR) meterR.style.width = pctR + "%";

                let dbDiff = 0;
                if (rmsL > 0.001 && rmsR > 0.001) {
                    const dbL = 20 * Math.log10(rmsL);
                    const dbR = 20 * Math.log10(rmsR);
                    dbDiff = Math.abs(dbL - dbR);
                } else if (rmsL > 0.001) {
                    dbDiff = 99;
                } else if (rmsR > 0.001) {
                    dbDiff = 99;
                }

                const diffEl = document.getElementById('imbalance-db-diff');
                const verdictEl = document.getElementById('imbalance-verdict');

                if (diffEl) {
                    diffEl.textContent = dbDiff === 99 ? "Single Channel Active" : `Difference: ~${dbDiff.toFixed(1)} dB`;
                }

                if (verdictEl) {
                    if (dbDiff === 99) {
                        verdictEl.textContent = "Verdict: Single Sided";
                        verdictEl.className = "text-yellow-500 font-bold text-xs";
                    } else if (dbDiff < 0.8) {
                        verdictEl.textContent = "Verdict: Balanced";
                        verdictEl.className = "text-emerald-400 font-bold text-xs";
                    } else if (dbDiff < 2.0) {
                        verdictEl.textContent = "Verdict: Slight Imbalance";
                        verdictEl.className = "text-amber-400 font-bold text-xs";
                    } else {
                        verdictEl.textContent = "Verdict: Imbalanced";
                        verdictEl.className = "text-red-500 font-bold text-xs";
                    }
                }
            }, 100);
        },
        playChannelTone: async function(channel) {
         // Channel tones are short diagnostics; preserve a running burn-in.
         this.stopAll(true, this.burninActive);

         ['l', 'r', 'c'].forEach(k => {
             const btn = document.getElementById('c-test-' + k);
             if (btn) btn.classList.remove('is-on', 'active');
         });
         const activeKey = channel === 'left' ? 'l' : (channel === 'right' ? 'r' : 'c');
         const activeBtn = document.getElementById('c-test-' + activeKey);
         if (activeBtn) activeBtn.classList.add('is-on', 'active');

         const ctx = SharedAudio.init(); await ctx.resume();
         this.channelToneOsc = ctx.createOscillator();
         this.channelToneGain = ctx.createGain();

         this.channelToneOsc.type = 'sine';
         this.channelToneOsc.frequency.value = 1000;

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            const targetVolume = 0.15 * masterVol;

            const now = ctx.currentTime;
            this.channelToneGain.gain.setValueAtTime(0, now);
            this.channelToneGain.gain.linearRampToValueAtTime(targetVolume, now + 0.05);

            let panVal = 0;
            if (channel === 'left') {
                panVal = -1;
                Mascot.triggerTemporaryExpression('pan_left', 300000);
            } else if (channel === 'right') {
                panVal = 1;
                Mascot.triggerTemporaryExpression('pan_right', 300000);
            } else {
                Mascot.triggerTemporaryExpression('balance', 300000);
            }

            if (this.isChannelSwapped) {
                panVal = -panVal;

                if (channel === 'left') Mascot.triggerTemporaryExpression('pan_right', 300000);
                if (channel === 'right') Mascot.triggerTemporaryExpression('pan_left', 300000);
            }

            this.channelTonePanner = ctx.createStereoPanner();
            this.channelTonePanner.pan.value = panVal;

            this.channelToneOsc.connect(this.channelTonePanner).connect(this.channelToneGain);
            this.channelToneGain.connect(SharedAudio.masterGain);

            this.channelToneOsc.start(now);
            this.activeNodes.push(this.channelToneOsc, this.channelTonePanner, this.channelToneGain);
            this.startImbalanceMeter();
        },
        stopChannelTone: function() {

         ['l', 'r', 'c'].forEach(k => {
             const btn = document.getElementById('c-test-' + k);
             if (btn) btn.classList.remove('is-on', 'active');
         });

         if (this.channelToneOsc) {
             try { this.channelToneOsc.stop(); } catch(e){}
             this.channelToneOsc = null;
         }
         if (this.channelToneGain) {
             try { this.channelToneGain.disconnect(); } catch(e){}
             this.channelToneGain = null;
         }
         this.channelTonePanner = null;

         Mascot.isOverrideActive = false;
         Mascot.setExpression('idle');
         Mascot.update();
     },
toggleChannelSwap: function() {
         this.isChannelSwapped = !this.isChannelSwapped;
         const btn = document.getElementById('c-test-swap');
         if (btn) {
             btn.textContent = this.isChannelSwapped ? "SWAP L/R: ON" : "SWAP L/R: OFF";
             if (this.isChannelSwapped) {
                 btn.classList.add('is-on');
             } else {
                 btn.classList.remove('is-on');
             }
         }
         if (this.channelTonePanner && SharedAudio.ctx) {
             const currentPan = this.channelTonePanner.pan.value;
             if (currentPan !== 0) {
                 setAudioParamSmooth(this.channelTonePanner.pan, -currentPan);
             }
         }
     },













                stopAll: function(keepMascotOverride = false, preserveBurnin = false) {
            this.stopSpatialOrbit();
            if (this.resonanceInterval) {
                clearInterval(this.resonanceInterval);
                this.resonanceInterval = null;
            }
            this.resonanceActive = false;

            if (this.panTimeout) {
                clearTimeout(this.panTimeout);
                this.panTimeout = null;
            }

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            if (scanBtn) {
                scanBtn.textContent = 'Scan';
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 opacity-50 cursor-not-allowed";
            }

            if (this.hearingOsc) {
                try { this.hearingOsc.stop(); } catch(e){}
                this.hearingOsc.disconnect();
                this.hearingOsc = null;
            }
            if (this.hearingGain) {
                this.hearingGain.disconnect();
                this.hearingGain = null;
            }
            this.stopResonanceTone();

            const leakNodes = [this.oscL, this.oscR, this.gainL, this.gainR];
            if (this.oscL) { try { this.oscL.stop(); } catch(e){} this.oscL = null; }
            if (this.oscR) { try { this.oscR.stop(); } catch(e){} this.oscR = null; }
            if (this.gainL) { try { this.gainL.disconnect(); } catch(e){} this.gainL = null; }
            if (this.gainR) { try { this.gainR.disconnect(); } catch(e){} this.gainR = null; }
            this.leakTestActive = false;

            if (this.channelToneOsc) {
                try { this.channelToneOsc.stop(); } catch(e){}
                this.channelToneOsc = null;
            }
            if (this.channelToneGain) {
                try { this.channelToneGain.disconnect(); } catch(e){}
                this.channelToneGain = null;
            }
            this.channelTonePanner = null;

            // Burn-in is an intentional long-duration background process
            // (driver break-in noise meant to keep running for minutes to
            // hours) -- unlike every other generator above, it should
            // survive a plain tab switch. preserveBurnin lets callers like
            // App.switchTab() stop every other Test Lab sound source
            // without silently killing an in-progress burn-in run.
            if (!preserveBurnin) {
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
                const bBtn = document.getElementById('burnin-start-btn');
                if (bBtn) bBtn.textContent = "Start";
                this.updateBurninStatus('idle');
            }

            this.activeNodes = this.activeNodes.filter(n => !leakNodes.includes(n));

            // The imbalance meter is the burn-in panel's L/R level display.
            // Killing it unconditionally — including on the tab-switch path
            // that PRESERVES burn-in audio — left the meters pinned at 0%
            // while the noise kept playing. Only clear it when burn-in is
            // being stopped too (the meter would otherwise read dead signal).
            if (!(preserveBurnin && this.burninActive)) {
                if (this.imbalanceInterval) {
                    clearInterval(this.imbalanceInterval);
                    this.imbalanceInterval = null;
                }
                const imbalanceL = document.getElementById('imbalance-meter-l');
                const imbalanceR = document.getElementById('imbalance-meter-r');
                if (imbalanceL) imbalanceL.style.width = "0%";
                if (imbalanceR) imbalanceR.style.width = "0%";
            }

            this.activeNodes.forEach(node => {
                if (node instanceof GainNode) {
                    try {
                        const now = SharedAudio.ctx.currentTime;
                        node.gain.cancelScheduledValues(now);
                        node.gain.setValueAtTime(node.gain.value, now);
                        node.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
                    } catch(e) {}
                }
            });

            const nodesToCleanup = [...this.activeNodes];
            this.activeNodes = [];

            if (!keepMascotOverride) {
                Mascot.isOverrideActive = false;
                Mascot.isGeniusActive = false;
                Mascot.clearTimers();
                Mascot.setExpression('idle');
                Mascot.update();
            }

            setTimeout(() => {
                nodesToCleanup.forEach(node => {
                    if (typeof node.stop === 'function') {
                        try { node.stop(); } catch(e){}
                    }
                    try { node.disconnect(); } catch(e){}
                });
            }, 25);
            // Route spatial teardown through stopSpatialAudio instead of
            // flipping spatialActive directly: the direct flip left
            // playbackActive=true with the pause button showing while
            // nothing played (updatePlayerButtonsUI never ran), and skipped
            // the custom-track resume bookkeeping (spatialOffset), so custom
            // tracks lost their position. #spatial-btn never existed in
            // index.html (the real controls are #spatial-play-btn/pause-btn,
            // synced by updatePlayerButtonsUI below).
            this.stopSpatialAudio();
            this.stopSpatialOrbitTimerOnly();
            this.playbackActive = false;
            this.updatePlayerButtonsUI();
            const abBtn = document.getElementById('ab-play-btn');
            if (abBtn) abBtn.innerHTML = 'Play Sync';
            this.abPlaying = false;
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');

            // An ABX session's inter-trial timer must die with everything
            // else: stopAll previously left abxIsActive=true and the 1s
            // timer armed, so switching tabs right after answering started
            // a trial in the background (looping elements, no answer UI
            // reachable). Full reset of the session state, same as abxReset.
            if (this.abxIsActive || this._abxTrialTimer) {
                if (this._abxTrialTimer) { clearTimeout(this._abxTrialTimer); this._abxTrialTimer = null; }
                this.abxIsActive = false;
                this.abxTrialIndex = 0;
                this.abxCorrect = 0;
                this.abxIncorrect = 0;

                const startBtn = document.getElementById('abx-start-btn');
                if (startBtn) {
                    startBtn.textContent = 'START TEST';
                    startBtn.onclick = () => this.abxStart();
                }
                this.setABXPanelState('idle');
                this.setABXControlsEnabled(true);

                const abxStatus = document.getElementById('abx-status-lbl');
                if (abxStatus) abxStatus.textContent = '';
                const abxProgress = document.getElementById('abx-progress-lbl');
                if (abxProgress) abxProgress.textContent = 'Trial 0/10';
                const confPct = document.getElementById('abx-confidence-pct');
                const confTxt = document.getElementById('abx-confidence-text');
                const confWrap = document.getElementById('abx-confidence-wrapper');
                if (confPct && confTxt && confWrap) {
                    confPct.textContent = '0.0%';
                    confTxt.textContent = 'No Trials';
                    confWrap.className = 'text-zinc-500';
                }
            }
            if (audioA) audioA.pause();
            if (audioB) audioB.pause();
        },
                startResonanceScan: function() {

            Mascot.triggerTemporaryExpression('scan_idle', 300000);
            this.stopAll(true, this.burninActive);

            const ctx = SharedAudio.init(); ctx.resume();
            this.resonanceActive = true;
            this.resonanceFreq = 8000;

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            const readout = document.getElementById('resonance-lock-hz');
            const needle = document.getElementById('resonance-gauge-needle');

            if (needle) {

                needle.className = "absolute top-0 bottom-0 w-1 bg-sky-400 transition-all duration-75";
                needle.style.boxShadow = "0 0 6px #38bdf8";
            }

            if (scanBtn) {
                scanBtn.textContent = 'Scan...';
                scanBtn.className = "w-full bg-sky-500/20 border border-sky-500/50 text-sky-300 font-bold text-[9px] py-1.5 active-btn animate-pulse truncate";
            }
            if (lockBtn) {
                lockBtn.disabled = false;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 font-bold text-[9px] py-1.5";
            }

            this.resonanceOsc = ctx.createOscillator();
            this.resonanceGain = ctx.createGain();
            this.resonanceOsc.type = 'sine';
            this.resonanceOsc.frequency.setValueAtTime(this.resonanceFreq, ctx.currentTime);
            this.resonanceGain.gain.setValueAtTime(0.06, ctx.currentTime);

            this.resonanceOsc.connect(this.resonanceGain).connect(SharedAudio.masterGain);
            this.resonanceOsc.start();

            let sweepDir = 1;
            this.resonanceInterval = setInterval(() => {
                this.resonanceFreq += sweepDir * 40;
                if (this.resonanceFreq >= 9600) sweepDir = -1;
                if (this.resonanceFreq <= 6400) sweepDir = 1;

                if (this.resonanceOsc) {
                    setAudioParamSmooth(this.resonanceOsc.frequency, this.resonanceFreq);
                }

                if (needle) {
                    const percent = ((this.resonanceFreq - 6400) / (9600 - 6400)) * 100;
                    needle.style.left = `${percent}%`;
                }

                const targetCenter = 8000;
                const delta = Math.abs(this.resonanceFreq - targetCenter);
                const sensitivity = Math.max(0, 100 * (1.0 - (delta / 1500)));

                if (needle) {
                    let needleColor, needleGlow;
                    if (sensitivity < 35) { needleColor = '#38bdf8'; needleGlow = 'rgba(56, 189, 248, 0.6)'; }
                    else if (sensitivity < 75) { needleColor = '#f59e0b'; needleGlow = 'rgba(245, 158, 11, 0.6)'; }
                    else { needleColor = '#ef4444'; needleGlow = 'rgba(239, 68, 68, 0.7)'; }
                    needle.style.backgroundColor = needleColor;
                    needle.style.boxShadow = `0 0 8px ${needleGlow}`;
                }

                if (sensitivity < 35) {
                    Mascot.setExpression('scan_idle');
                } else if (sensitivity < 75) {
                    Mascot.setExpression('scan_alert');
                } else {
                    Mascot.setExpression('scan_pain');
                }

                if (readout) {
                    readout.textContent = `${Math.round(this.resonanceFreq).toLocaleString()} Hz`;
                }
            }, 50);
            this.startImbalanceMeter();
        },
        lockResonancePeak: function() {
            if (!this.resonanceActive) return;
            clearInterval(this.resonanceInterval);
            this.stopResonanceTone();
            this.resonanceActive = false;

            PEQDB_Module.resonanceHz = Math.round(this.resonanceFreq);

            const needle = document.getElementById('resonance-gauge-needle');
            if (needle) {
                needle.className = "absolute top-0 bottom-0 w-1 bg-emerald-400 animate-pulse";
                needle.style.boxShadow = "0 0 10px #10b981";
            }

            Mascot.triggerTemporaryExpression('scan_lock', 2200);

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            const readout = document.getElementById('resonance-lock-hz');

            if (scanBtn) {
                scanBtn.textContent = 'Scan';
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 opacity-50 cursor-not-allowed";
            }
            if (readout) {
                readout.textContent = `${PEQDB_Module.resonanceHz.toLocaleString()} Hz`;
                readout.className = "text-xs font-mono font-black text-emerald-400 bg-emerald-950/30 px-2 py-0.5 shadow-[0_0_8px_rgba(16,185,129,0.2)]";
            }

            EQ_Module.resonanceCalEnabled = true;
            const calBtn = document.getElementById('btn-resonance-cal');
            const calLbl = document.getElementById('lbl-resonance-cal');
            if (calBtn && calLbl) {
                calBtn.classList.add('active-btn');
                calLbl.textContent = 'Resonance: ON';
            }

            const fInput = document.getElementById("eq-f8");
            const sSlider = document.getElementById("eq-s8");
            const sNum = document.getElementById("eq-s8_num");
            const qSlider = document.getElementById("eq-q_m8");
            const qNum = document.getElementById(`eq-q_m8_num`);

            // Snapshot band 8 before overwriting so the toast can offer Undo —
            // the notch previously destroyed whatever the user had on this band
            // with no way back.
            const prevBand8 = {
                hz: fInput ? fInput.value : null,
                g: sSlider ? sSlider.value : null,
                q: qSlider ? qSlider.value : null
            };
            const hadUserNotch = parseFloat(prevBand8.g) !== 0;

            if (fInput) fInput.value = PEQDB_Module.resonanceHz;
            if (sSlider) sSlider.value = -4.5;
            if (sNum) sNum.value = "-4.5";
            if (qSlider) qSlider.value = 4.0;
            if (qNum) qNum.value = "4.00";

            const fsSlider = document.getElementById(`eq-fs_m8`);
            if (fsSlider) fsSlider.value = EQ_Module.logHzToSlider(PEQDB_Module.resonanceHz);

            EQ_Module.isProgrammaticSliderUpdate = true;
            EQ_Module.updateSlider(8, 'main');
            EQ_Module.isProgrammaticSliderUpdate = false;
            // updateSlider skipped its DSP push under the programmatic flag;
            // send the notch to the worklet now so it is audible immediately.
            if (EQ_Module.graphBuilt) {
                EQ_Module.updateAudioConnections();
            }

            EQ_Module.drawCurve();
            showToast(`Corrective PEQ Notch applied at ${PEQDB_Module.resonanceHz} Hz!`, "🎯", hadUserNotch ? {
                action: {
                    label: "Undo",
                    onClick: () => {
                        const b8 = EQ_Module.bands[8];
                        const fi = document.getElementById("eq-f8");
                        const ss = document.getElementById("eq-s8");
                        const sn = document.getElementById("eq-s8_num");
                        const qs = document.getElementById("eq-q_m8");
                        const qn = document.getElementById("eq-q_m8_num");
                        const fss = document.getElementById("eq-fs_m8");
                        if (fi && prevBand8.hz !== null) fi.value = prevBand8.hz;
                        if (ss && prevBand8.g !== null) ss.value = prevBand8.g;
                        if (sn && prevBand8.g !== null) sn.value = parseFloat(prevBand8.g).toFixed(1);
                        if (qs && prevBand8.q !== null) qs.value = prevBand8.q;
                        if (qn && prevBand8.q !== null) qn.value = parseFloat(prevBand8.q).toFixed(2);
                        if (fss && fi) {
                            const restoreHz = parseFloat(fi.value);
                            if (Number.isFinite(restoreHz)) fss.value = EQ_Module.logHzToSlider(restoreHz);
                            else if (b8) fss.value = EQ_Module.logHzToSlider(b8.hz);
                        }
                        EQ_Module.isProgrammaticSliderUpdate = true;
                        EQ_Module.updateSlider(8, 'main');
                        EQ_Module.isProgrammaticSliderUpdate = false;
                        if (EQ_Module.graphBuilt) EQ_Module.updateAudioConnections();
                        EQ_Module.drawCurve();
                        showToast("Band 8 restored.", "↩️");
                    }
                }
            } : undefined);
        },
        resetResonance: function() {
            this.stopResonanceTone();
            clearInterval(this.resonanceInterval);
            this.resonanceActive = false;

            PEQDB_Module.resonanceHz = 8000;
            EQ_Module.resonanceCalEnabled = false;

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            const readout = document.getElementById('resonance-lock-hz');
            const calBtn = document.getElementById('btn-resonance-cal');
            const calLbl = document.getElementById('lbl-resonance-cal');
            const needle = document.getElementById('resonance-gauge-needle');

            if (needle) {

                needle.className = "absolute top-0 bottom-0 w-1 bg-sky-400 transition-all duration-75";
                needle.style.left = "50%";
                needle.style.boxShadow = "0 0 6px #38bdf8";
            }

            if (scanBtn) {
                scanBtn.textContent = 'Scan';
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 opacity-50 cursor-not-allowed";
            }
            if (readout) {
                readout.textContent = '8,000 Hz';
                readout.className = "text-xs font-mono font-black text-sky-400 bg-sky-950/30 px-2 py-0.5 border border-sky-900/30";
            }
            if (calBtn) calBtn.classList.remove('active-btn');
            if (calLbl) calLbl.textContent = 'Resonance: Off';

            const b = EQ_Module.bands[8];
            const fInput = document.getElementById("eq-f8");
            const sSlider = document.getElementById("eq-s8");
            const sNum = document.getElementById("eq-s8_num");
            const qSlider = document.getElementById("eq-q_m8");
            const qNum = document.getElementById("eq-q_m8_num");

            if (fInput) fInput.value = b.hz;
            if (sSlider) sSlider.value = 0;
            if (sNum) sNum.value = "0.0";
            if (qSlider) qSlider.value = b.defaultQ;
            if (qNum) qNum.value = b.defaultQ.toFixed(2);

            const fsSlider = document.getElementById(`eq-fs_m8`);
            if (fsSlider) fsSlider.value = EQ_Module.logHzToSlider(b.hz);

            EQ_Module.isProgrammaticSliderUpdate = true;
            EQ_Module.updateSlider(8, 'main');
            EQ_Module.isProgrammaticSliderUpdate = false;
            // Push the restored band-8 defaults to the worklet (skipped above
            // while the programmatic flag was set).
            if (EQ_Module.graphBuilt) {
                EQ_Module.updateAudioConnections();
            }

            EQ_Module.drawCurve();
            showToast("Ear Resonance Peak Tuner Reset", "🔄");
        },
        playSweep: async function(startFreq, endFreq, duration) {
        this.stopAll(true, this.burninActive);

        if (window.EQ && EQ.audioEl && !EQ.audioEl.paused) {
            EQ.togglePlayState();
        }

        await EQ_Module.ensureDSPGraph();
        const ctx = SharedAudio.ctx;
        Mascot.update();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';

            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(startFreq, now);
            osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            const targetVolume = 0.15 * masterVol;

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(targetVolume, now + 0.05);
            gain.gain.setValueAtTime(targetVolume, now + duration - 0.05);
            gain.gain.linearRampToValueAtTime(0, now + duration);

            osc.connect(gain);
            gain.connect(SharedAudio.masterGain);
            osc.start(now);
            osc.stop(now + duration);
            this.activeNodes.push(osc, gain);
            Mascot.update();

            if (window.EQ && !EQ.vizLoopRunning) {
                EQ.startVisualizer();
            }

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
                const idx1 = this.activeNodes.indexOf(osc);
                if (idx1 > -1) this.activeNodes.splice(idx1, 1);
                const idx2 = this.activeNodes.indexOf(gain);
                if (idx2 > -1) this.activeNodes.splice(idx2, 1);
                Mascot.update();
            };
            this.startImbalanceMeter();
        },
        playTransientSlam: async function() {
            this.stopAll(true, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx;
            Mascot.update();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';

            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            const targetVolume = 0.4 * masterVol;

            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.linearRampToValueAtTime(targetVolume, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.001 * masterVol), now + 0.15);

            osc.connect(gain);
            gain.connect(SharedAudio.masterGain);
            osc.start(now);
            osc.stop(now + 0.16);
            this.activeNodes.push(osc, gain);

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
                const idx1 = this.activeNodes.indexOf(osc);
                if (idx1 > -1) this.activeNodes.splice(idx1, 1);
                const idx2 = this.activeNodes.indexOf(gain);
                if (idx2 > -1) this.activeNodes.splice(idx2, 1);
            };
            this.startImbalanceMeter();
        },
        playSibilanceTest: async function() {
            this.stopAll(true, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx;
            Mascot.update();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';

            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(8000, now);

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            const targetVolume = 0.1 * masterVol;

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(targetVolume, now + 0.05);
            gain.gain.setValueAtTime(targetVolume, now + 1.95);
            gain.gain.linearRampToValueAtTime(0, now + 2.0);

            osc.connect(gain);
            gain.connect(SharedAudio.masterGain);
            osc.start(now);
            osc.stop(now + 2.0);
            this.activeNodes.push(osc, gain);
            Mascot.update();

            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
                const idx1 = this.activeNodes.indexOf(osc);
                if (idx1 > -1) this.activeNodes.splice(idx1, 1);
                const idx2 = this.activeNodes.indexOf(gain);
                if (idx2 > -1) this.activeNodes.splice(idx2, 1);
                Mascot.update();
            };
            this.startImbalanceMeter();
        },
    playDetailRetrieval: async function() {
        this.stopAll(true, this.burninActive);
        await EQ_Module.ensureDSPGraph();
        const ctx = SharedAudio.ctx;
        Mascot.update();

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            const targetVolume = 0.04 * masterVol;

            // Cache unit-amplitude noise (keyed only on sample rate) and
            // apply the volume at play time via a gain node instead of
            // baking it into the buffer -- baking it in meant the buffer
            // was generated once at whatever volume happened to be current
            // on the FIRST play, then reused verbatim (same cache key)
            // forever after, so the Master Volume slider had no effect on
            // this test tone from the second play onward.
            const cacheKey = 'noise_detail_' + ctx.sampleRate;
            if (!this.bufferCache[cacheKey]) {
                const bufferSize = ctx.sampleRate * 3;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1);
                }
                this.bufferCache[cacheKey] = buffer;
            }

            const noise = ctx.createBufferSource();
            noise.buffer = this.bufferCache[cacheKey];
            noise.loop = false;

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 12000;
            filter.Q.value = 1.0;

            const noiseGain = ctx.createGain();
            noiseGain.gain.value = targetVolume;

            noise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(SharedAudio.masterGain);
            noise.start();
            this.activeNodes.push(noise, filter, noiseGain);

            noise.onended = () => {
                noise.disconnect();
                filter.disconnect();
                noiseGain.disconnect();
                const idx1 = this.activeNodes.indexOf(noise);
                if (idx1 > -1) this.activeNodes.splice(idx1, 1);
                const idx2 = this.activeNodes.indexOf(filter);
                if (idx2 > -1) this.activeNodes.splice(idx2, 1);
                const idx3 = this.activeNodes.indexOf(noiseGain);
                if (idx3 > -1) this.activeNodes.splice(idx3, 1);
            };
            this.startImbalanceMeter();
        },
        playPolarityTest: async function() {
            this.stopAll(true, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx || SharedAudio.init();
            Mascot.update();
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            const gain2 = ctx.createGain();
            const merger = ctx.createChannelMerger(2);
            osc1.type = 'sine';
            osc1.frequency.value = 200;
            osc2.type = 'sine';
            osc2.frequency.value = 200;

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;

            gain1.gain.value = 0.15 * masterVol;
            gain2.gain.value = -0.15 * masterVol;
            osc1.connect(gain1).connect(merger, 0, 0);
            osc2.connect(gain2).connect(merger, 0, 1);
            merger.connect(SharedAudio.masterGain);
            osc1.start();
            osc2.start();
            osc1.stop(ctx.currentTime + 3);
            osc2.stop(ctx.currentTime + 3);
            this.activeNodes.push(osc1, osc2, gain1, gain2, merger);

            osc1.onended = () => {
                osc1.disconnect();
                osc2.disconnect();
                gain1.disconnect();
                gain2.disconnect();
                merger.disconnect();
                this.activeNodes = this.activeNodes.filter(n => ![osc1, osc2, gain1, gain2, merger].includes(n));
            };
            this.startImbalanceMeter();
        },
        playImaging: async function() {
            this.stopAll(false, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx || SharedAudio.init();

            Mascot.triggerTemporaryExpression('pan_left', 5000);
            this.panTimeout = setTimeout(() => {
                if (this.activeNodes.length > 0) {
                    Mascot.triggerTemporaryExpression('pan_right', 2500);
                }
            }, 2500);

            const osc = ctx.createOscillator();
            const panner = ctx.createStereoPanner();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 440;

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            gain.gain.value = 0.15 * masterVol;

            panner.pan.setValueAtTime(-1, ctx.currentTime);
            panner.pan.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
            panner.pan.linearRampToValueAtTime(-1, ctx.currentTime + 5.0);
            osc.connect(panner).connect(gain).connect(SharedAudio.masterGain);
            osc.start();
            osc.stop(ctx.currentTime + 5.0);
            this.activeNodes.push(osc, panner, gain);
            this.startImbalanceMeter();
        },
        playSoundstage: async function() {
            this.stopAll(true, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx || SharedAudio.init();
            Mascot.update();
            const bufferSize = ctx.sampleRate * 3;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            const delay = ctx.createDelay();
            delay.delayTime.value = 0.025;
            const merger = ctx.createChannelMerger(2);
            const gainL = ctx.createGain();
            const gainR = ctx.createGain();

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            gainL.gain.value = 0.08 * masterVol;
            gainR.gain.value = 0.08 * masterVol;

            noise.connect(gainL).connect(merger, 0, 0);
            noise.connect(delay).connect(gainR).connect(merger, 0, 1);
            merger.connect(SharedAudio.masterGain);
            noise.start();
            this.activeNodes.push(noise, delay, merger, gainL, gainR);
            this.startImbalanceMeter();
        },
        playFPSImaging: async function() {
            this.stopAll(true, this.burninActive);
            await EQ_Module.ensureDSPGraph();
            const ctx = SharedAudio.ctx || SharedAudio.init();
            Mascot.update();
            const osc = ctx.createOscillator();
            const panner = ctx.createStereoPanner();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = 150;

            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;

            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            panner.pan.setValueAtTime(-1, ctx.currentTime);
            for (let i = 0; i < 5; i++) {
                const t = ctx.currentTime + i * 0.6;
                gain.gain.setValueAtTime(Math.max(0.0001, 0.001 * masterVol), t);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.2 * masterVol), t + 0.1);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.001 * masterVol), t + 0.4);
                panner.pan.setValueAtTime(Math.sin(t * 1.5), t);
            }
            osc.connect(gain).connect(panner).connect(SharedAudio.masterGain);
            osc.start();
            osc.stop(ctx.currentTime + 3);
            this.activeNodes.push(osc, panner, gain);
            this.startImbalanceMeter();
        },
        heightModeActive: false,
        toggleFullscreen: function() {
            const card = document.getElementById('spatial-card');
            const btn = document.getElementById('btn-expand-spatial');
            if (!card || !btn) return;

            const isExpanded = card.classList.contains('is-expanded-card');

            if (!isExpanded) {
                this.isSpatialExpanded = true;
                card.classList.add('is-expanded-card');
                btn.innerHTML = '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 14h6v6M20 10h-6V4M14 10l7-7M4 20l6-6"/></svg><span class="hidden sm:inline">Minimize</span>';
                btn.title = 'Minimize View';

                card.style.setProperty('height', 'calc(100dvh - 24px)', 'important');
                card.style.setProperty('min-height', '0', 'important');
                card.style.setProperty('max-height', 'calc(100dvh - 24px)', 'important');
            } else {
                this.isSpatialExpanded = false;
                card.classList.remove('is-expanded-card');
                btn.innerHTML = '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg><span class="hidden sm:inline">Expand</span>';
                btn.title = 'Expand View';
                card.style.removeProperty('height');
                card.style.removeProperty('min-height');
                card.style.removeProperty('max-height');
            }

            if (window.updateExpandedAutoHide) window.updateExpandedAutoHide();
        },
        toggleBassLeakTest: function(side) {
            this.stopAll(true, this.burninActive);
            const ctx = SharedAudio.init(); ctx.resume();

            this.leakTestActive = true;

            this.oscL = ctx.createOscillator();
            this.oscR = ctx.createOscillator();
            this.gainL = ctx.createGain();
            this.gainR = ctx.createGain();
            this.leakMerger = ctx.createChannelMerger(2);

            this.oscL.type = 'sine';
            this.oscR.type = 'sine';

            if (side === 'left') {
                this.oscL.frequency.value = 50;
                this.oscR.frequency.value = 1000;
                this.gainL.gain.value = 0.35;
                this.gainR.gain.value = 0.08;
                Mascot.triggerTemporaryExpression('leak_left', 300000);
            } else {
                this.oscL.frequency.value = 1000;
                this.oscR.frequency.value = 50;
                this.gainL.gain.value = 0.08;
                this.gainR.gain.value = 0.35;
                Mascot.triggerTemporaryExpression('leak_right', 300000);
            }

            this.oscL.connect(this.gainL).connect(this.leakMerger, 0, 0);
            this.oscR.connect(this.gainR).connect(this.leakMerger, 0, 1);
            this.leakMerger.connect(SharedAudio.masterGain);

            this.oscL.start();
            this.oscR.start();

            this.activeNodes.push(this.oscL, this.oscR, this.gainL, this.gainR, this.leakMerger);
            this.startImbalanceMeter();
        },
        stopBassLeakTest: function() {
            const nodesToClean = [this.oscL, this.oscR, this.gainL, this.gainR, this.leakMerger];
            if (this.oscL) { try { this.oscL.stop(); } catch(e){} this.oscL = null; }
            if (this.oscR) { try { this.oscR.stop(); } catch(e){} this.oscR = null; }
            if (this.gainL) { try { this.gainL.disconnect(); } catch(e){} this.gainL = null; }
            if (this.gainR) { try { this.gainR.disconnect(); } catch(e){} this.gainR = null; }
            if (this.leakMerger) { try { this.leakMerger.disconnect(); } catch(e){} this.leakMerger = null; }

            this.activeNodes = this.activeNodes.filter(n => !nodesToClean.includes(n));
            this.leakTestActive = false;

            Mascot.isOverrideActive = false;
            Mascot.clearTimers();
            Mascot.setExpression('idle');
            Mascot.update();
        }
    };
Object.assign(TestLab_Module, TestLab_SpatialMethods);
Object.assign(TestLab_Module, TestLab_BurninMethods);
Object.assign(TestLab_Module, TestLab_HearingMethods);
Object.assign(TestLab_Module, TestLab_AbxMethods);

        (function() {
            let tooltipEl = null;

            // R0: appearance moved from an inline cssText string to the
            // .ui-tooltip class in app/css/app.css. The old inline block
            // hard-coded #000000 fill, a 2px solid accent border and a 2px hard
            // black shadow, which bypassed every design token and kept the
            // tooltip square while the rest of the app became rounded. Only
            // position and visibility stay inline, because those are computed.
            function getTooltip() {
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'global-floating-tooltip';
                    tooltipEl.className = 'ui-tooltip';
                    tooltipEl.setAttribute('role', 'tooltip');
                    document.body.appendChild(tooltipEl);
                }
                return tooltipEl;
            }

            // The element the tooltip is currently describing, and the title we
            // temporarily blanked to suppress the browser's native tooltip.
            let activeOwner = null;
            let suppressed = null;

            function restoreSuppressedTitle() {
                if (!suppressed) return;
                suppressed.el.setAttribute('title', suppressed.text);
                suppressed = null;
            }

            function hideTooltip() {
                restoreSuppressedTitle();
                if (activeOwner) {
                    activeOwner.removeAttribute('aria-describedby');
                    activeOwner = null;
                }
                if (!tooltipEl) return;
                tooltipEl.classList.remove('is-visible');
                // IEM.removeReviewTag used to do this with inline styles, which
                // then outranked .is-visible forever after: one tag removal
                // killed the tooltip for the rest of the session. Visibility is
                // the stylesheet's job, so clear any stale inline leftovers.
                tooltipEl.style.display = '';
                tooltipEl.style.opacity = '';
            }

            function showTooltip(target) {
                // data-tooltip wins; title is the fallback so that the ~73
                // elements in index.html which only carry a title still work.
                const text = (target.getAttribute('data-tooltip')
                    || target.getAttribute('title') || '').trim();
                if (!text) return;
                if (activeOwner === target) return;

                hideTooltip();
                activeOwner = target;

                const tt = getTooltip();
                tt.textContent = text;
                tt.classList.add('is-visible');
                // role="tooltip" is only meaningful if something points at it.
                target.setAttribute('aria-describedby', tt.id);

                // Suppress the NATIVE tooltip only while ours is up. The old
                // code called removeAttribute('title') and never put it back,
                // which silently deleted the accessible name of every element
                // whose only label was its title - 73 of the 81 title-bearing
                // elements in index.html have no aria-label to fall back on. It
                // also made the name depend on input device: hover and you lose
                // the name, tab to it and you keep it.
                const title = target.getAttribute('title');
                if (title) {
                    suppressed = { el: target, text: title };
                    target.setAttribute('title', '');
                }

                const rect = target.getBoundingClientRect();
                const ttW = tt.offsetWidth;
                const ttH = tt.offsetHeight;

                let left = rect.left + (rect.width / 2) - (ttW / 2);
                let top = rect.top - ttH - 8;

                if (left < 8) left = 8;
                if (left + ttW > window.innerWidth - 8) {
                    left = window.innerWidth - ttW - 8;
                }
                if (top < 8) {
                    // No room above: flip below. Clamped so a tooltip on a
                    // bottom-edge control (the transport bar) cannot be pushed
                    // off-screen, which is where the old fixed 6px offset
                    // clipped it.
                    top = Math.min(rect.bottom + 8, window.innerHeight - ttH - 8);
                }
                if (left < 8) left = 8;

                tt.style.left = `${left}px`;
                tt.style.top = `${Math.max(8, top)}px`;
            }

            function tooltipTargetFrom(e) {
                return e.target.closest('[data-tooltip], [title]');
            }

            // Still leaving? Crossing from a button to one of its own child
            // spans used to tear the tooltip down and immediately rebuild it -
            // a visible flicker on every icon button that wraps a glyph.
            function stillInside(target, related) {
                return !!(related && target.contains(related));
            }

            document.addEventListener('mouseover', (e) => {
                const target = tooltipTargetFrom(e);
                if (target) showTooltip(target);
            });

            // Keyboard parity. Without this the tooltip was mouse-only: 73
            // elements carried their entire label in a title that no keyboard
            // user could ever surface.
            document.addEventListener('focusin', (e) => {
                const target = tooltipTargetFrom(e);
                if (target) showTooltip(target);
            });

            document.addEventListener('mouseout', (e) => {
                const target = tooltipTargetFrom(e);
                if (!target) return;
                if (stillInside(target, e.relatedTarget)) return;
                hideTooltip();
            });

            document.addEventListener('focusout', (e) => {
                const target = tooltipTargetFrom(e);
                if (!target) return;
                if (stillInside(target, e.relatedTarget)) return;
                hideTooltip();
            });

            window.addEventListener('scroll', hideTooltip, true);
            document.addEventListener('click', (e) => {
                // Hide after a pointer click so no stale tooltip is left over
                // the UI, but NOT after a keyboard activation: detail === 0 is
                // how the browser marks a click synthesised from Enter/Space,
                // and killing the tooltip there would strip the keyboard user
                // of the text they just tabbed to.
                if (e.detail === 0) return;
                hideTooltip();
            }, true);
            window.hideGlobalTooltip = hideTooltip;
        })();

    // Boot entry point. index.html injects this bundle via a dynamically
    // created <script>, which is async by default — so this code can execute
    // AFTER DOMContentLoaded has already fired. Registering a DOMContentLoaded
    // listener unconditionally meant the entire boot sequence (module init,
    // mathFilters allocation, audio element wiring) silently never ran in that
    // case, leaving EQ.mathFilters empty (getCompositeFilterMagnitude crash)
    // and EQ.audioEl null (drawViz crash). Run immediately when we're late.
    const runAppBoot = async () => {
        const bootModules = [
            ['App', App],
            ['IEM_Module', IEM_Module],
            ['EQ_Module', EQ_Module],
            ['PEQDB_Module', PEQDB_Module],
            ['Tone_Module', Tone_Module],
            ['TestLab_Module', TestLab_Module],
            ['Accessibility', Accessibility],
            ['FindEngine', FindEngine]
        ];

        // Silent degradation is a legitimate design choice only when it is
        // VISIBLE. Previously a failed mod.init() produced nothing but a
        // console.error and the two global handlers — so a dead IEM_Module or
        // EQ_Module left the UI looking completely normal while the features
        // silently did nothing, with no banner, no disabled state and no retry.
        // Collect the failures and surface them once, non-blocking, naming the
        // features the user actually lost.
        const bootFailures = [];
        for (const [name, mod] of bootModules) {
            try {
                await mod.init();
            } catch (err) {
                console.error(`[Boot] ${name}.init() failed — continuing with remaining modules.`, err);
                bootFailures.push({ name, err });
            }
        }
        if (bootFailures.length) {
            const FRIENDLY = {
                App: 'Navigation',
                IEM_Module: 'Review tab',
                EQ_Module: 'EQ / parametric equalizer',
                PEQDB_Module: 'Curve database',
                Tone_Module: 'Tone generator',
                TestLab_Module: 'Test Lab',
                Accessibility: 'Accessibility options',
                FindEngine: 'Find tab',
            };
            const lost = bootFailures.map((f) => FRIENDLY[f.name] || f.name);
            const firstMsg = (bootFailures[0].err && bootFailures[0].err.message) || 'unknown error';
            console.error('[Boot] ' + bootFailures.length + ' module(s) failed to initialise: ' +
                bootFailures.map((f) => f.name).join(', '));
            if (typeof showToast === 'function') {
                showToast(
                    lost.length === 1
                        ? lost[0] + ' failed to start — that feature is unavailable.'
                        : lost.length + ' features failed to start: ' + lost.join(', ') + '.',
                    '⚠️'
                );
            }
            if (typeof showDebugError === 'function') {
                showDebugError(
                    lost.join(', ') + ' failed to start',
                    'Boot: ' + bootFailures.map((f) => f.name).join(', ') + ' — ' + firstMsg
                );
            }
        }

        if (window.EQ && EQ.setupPlaylist) {
            try { EQ.setupPlaylist(); } catch (err) { console.error('[Boot] Playlist preload failed:', err); }
        }

        try { bootstrapAlphabetIndex(); } catch (err) { console.error('[Boot] Alphabet index init failed:', err); }

        if (window.EQ && EQ.injectExtraPresetsOnLoad) {
            EQ.injectExtraPresetsOnLoad();
        }

        setTimeout(() => {
            if (PEQDB_Module && PEQDB_Module.startBackgroundLoading) {
                try {
                    // (Restored: the invocation was accidentally deleted,
                    // leaving this if/try scaffolding behind — the 1.2s deferred
                    // DB warmup never ran.) typeof guard — FindEngine is a
                    // top-level const, never a window property.
                    PEQDB_Module.startBackgroundLoading();
                    if (typeof FindEngine !== 'undefined' && FindEngine.checkInitialProgress) {
                        FindEngine.checkInitialProgress();
                    }
                } catch (err) {
                    console.error('[Boot] startBackgroundLoading failed:', err);
                }
            }
        }, 1200);

        window.addEventListener('resize', () => {
            if (window.innerWidth >= 1280) {
                const colSpecs = document.getElementById('iem-col-specs');
                const colRadar = document.getElementById('iem-col-radar');
                const colSliders = document.getElementById('iem-col-sliders');
                if (colSpecs && colRadar && colSliders) {
                    colSpecs.style.display = '';
                    colRadar.style.display = '';
                    colSliders.style.display = '';
                }
                const colDb = document.getElementById('eq-col-db');
                const colGraph = document.getElementById('eq-col-graph');
                const colConsole = document.getElementById('eq-col-console');
                if (colDb && colGraph && colConsole) {
                    colDb.style.display = '';
                    colGraph.style.display = '';
                    colConsole.style.display = '';
                }
                const colSweeps = document.getElementById('testlab-col-sweeps');
                const colSpatial = document.getElementById('testlab-col-spatial');
                const colGenerators = document.getElementById('testlab-col-generators');
                if (colSweeps && colSpatial && colGenerators) {
                    colSweeps.style.display = '';
                    colSpatial.style.display = '';
                    colGenerators.style.display = '';
                }
            } else {
                App.setReviewSection(App.activeReviewSection);
                App.setEqSection(App.activeEqSection);
                App.setTestLabSection(App.activeTestLabSection);
            }
        });

        App.setReviewSection('specs');
        App.setFindSection('prefs');
        App.setEqSection('db');
        App.setTestLabSection('spatial');

        if (window.syncGlobalSliders) window.syncGlobalSliders();

        App.loadDynamicFonts().then(() => {
            return App.loadDynamicThemes();
        }).then(() => {
            if (App.renderThemeToggles) App.renderThemeToggles();
            return EQ_Module.loadCustomVisualizerEffects();
        }).then(() => {
            App.restoreSavedSettings();
        }).catch(err => {
            console.error('[Boot] Font/theme/settings restore chain failed:', err);
        });

                try {
                    EQ_Module.startVisualizer();
                } catch (err) {
                    console.error('[Boot] startVisualizer failed:', err);
                }
            };

            if (document.readyState === 'loading') {
                window.addEventListener('DOMContentLoaded', runAppBoot, { once: true });
            } else {
                // Bundle executed after DOMContentLoaded (async script injection):
                // boot right away instead of waiting for an event that already
                // fired. Deferred to a microtask because runAppBoot closes over
                // consts (e.g. FindEngine) declared LATER in this bundle — calling
                // it synchronously here would hit their temporal dead zone.
                if (typeof queueMicrotask === 'function') queueMicrotask(() => runAppBoot());
                else setTimeout(() => runAppBoot(), 0);
            }

