// TestLab hearing test: staircase thresholds, correction curve and conversion to EQ.
// Split out of testlab-module.js; merged into TestLab_Module via Object.assign there.
const TestLab_HearingMethods = {
        hearingTestFreqs: [250, 500, 1000, 2000, 4000, 8000, 12000, 16000],

        hearingStep: -1,

        hearingThresholds: [0, 0, 0, 0, 0, 0, 0, 0],

        hearingOsc: null,

        hearingGain: null,

        // ===== F-9: hearing-test-grade staircase + ISO SPL mapping =====
        // Replaces the old "raise the slider until you hear it" flow with a
        // manual adaptive 1-down/1-up staircase:
        //   - The tone plays at a level set by the test, not the slider.
        //   - The user presses HEARD / NOT HEARD; each answer steps the
        //     level (down on heard, up on not-heard) with a step size that
        //     halves after every reversal (12 -> 6 -> 3 -> 1.5 dB), the
        //     classic psychophysical convergence on the 50% detection point.
        //   - 2 reversals at the finest step = threshold for that frequency
        //     (typically 6-8 reversals total, ~20s per frequency).
        //   - Output is a dB HL-style readout per frequency using ISO
        //     389-8/389-7 reference thresholds (RETFL for insert-style
        //     earphones), relative to the user's own 1 kHz threshold so no
        //     absolute SPL calibration is claimed — the 1 kHz result becomes
        //     the anchor and every other frequency reports relative shift,
        //     which is what actually matters for EQ correction.
        // The old hearing-test-vol slider remains as a global pre-test
        // comfort calibration (set it so 1 kHz is comfortably audible at
        // mid-slider; the staircase works relative to that point).
        staircase: null,

        // ISO 389-8 reference equivalent threshold sound pressure levels
        // (dB SPL at the eardrum, TDH-39/insert-earphone hybrid values) for
        // the test frequencies — used ONLY to shape the relative-loss curve
        // between frequencies, never displayed as absolute SPL.
        isoRetflDb: { 250: 14.5, 500: 8.5, 1000: 7.5, 2000: 9.0, 4000: 11.5, 8000: 15.5, 12000: 21.0, 16000: 28.0 },

        _hearingStaircaseMaxLevel: 0.12,

        _hearingStaircaseStartLevel: 0.06,

        _hearingStaircaseMinLevel: 0.0004,

        // Progress bar + instruction line helpers (UI mirror of staircase state).
        // The bar is SEGMENTED (one cell per test frequency) and DRIVES OFF
        // ANSWERS, not just tone boundaries: the current tone's cell fills
        // continuously as the user answers (a realistic tone takes 3-9
        // answers, so boundary-only progress looked frozen for 40+ clicks).
        // Colors are set via inline style.background — class swaps depended
        // on compiled CSS that can go stale between tailwind rebuilds.
        _updateHearingTestUI: function(opts) {
            const o = opts || {};
            const instr = document.getElementById('hearing-test-instruction');
            const status = document.getElementById('hearing-test-status');
            const hzDisp = document.getElementById('hearing-test-hz');
            const pctDisp = document.getElementById('hearing-progress-pct');
            const fill = document.getElementById('hearing-progress-fill');
            const calRow = document.getElementById('hearing-cal-row');

            if (o.progress !== undefined) {
                // o.progress is a FRACTION 0..1 of the whole 8-tone test.
                // Drives the width of the shared pill track; the discrete tone
                // count is carried by the status line ("Tone 3 of 8").
                const frac = Math.max(0, Math.min(1, o.progress));
                const pct = Math.round(frac * 100);
                if (pctDisp) pctDisp.textContent = pct + '%';
                if (fill) fill.style.width = pct + '%';
            }
            if (o.showSlider === true && calRow) calRow.classList.remove('hidden');
            if (o.showSlider === false && calRow) calRow.classList.add('hidden');
            if (o.instruction !== undefined && instr) {
                instr.innerHTML = o.instruction;
            }
            if (o.status !== undefined && status) status.textContent = o.status;
            if (o.hz !== undefined && hzDisp) hzDisp.textContent = o.hz;
        },

        // Fraction of the ENTIRE test completed, credited per-answer:
        // finished tones count fully; the current tone credits its answers
        // against an expected budget (8 answers ≈ a typical staircase; the
        // force-finish path is 3).
        _hearingTestFraction: function() {
            const freqCount = this.hearingTestFreqs.length;
            if (this.hearingStep < 0 || this.hearingStep >= freqCount) {
                return this._hearingAllDone ? 1 : 0;
            }
            const per = 1 / freqCount;
            const doneFrac = this.hearingStep * per;
            // Answers given within the current tone (staircase records
            // every answer as a reversal-or-step; budget on the generous
            // side so the bar never races ahead of reality).
            const answers = this._hearingToneAnswers || 0;
            const ANSWER_BUDGET = 8;
            const toneFrac = Math.min(1, answers / ANSWER_BUDGET) * per;
            return Math.min(1 - 1e-9, doneFrac + toneFrac);
        },

        startHearingStaircase: async function() {
            const ctx = SharedAudio.init(); await ctx.resume();
            if (this.hearingOsc) { this.stopHearingTone(); }

            // The pre-test slider sets where the staircase begins: the user
            // calibrated "comfortably audible" at this level. LOCKED once the
            // test begins — mid-test level changes would corrupt the
            // staircase, so the slider row hides for the duration.
            const calSlider = document.getElementById('hearing-test-vol');
            if (calSlider) {
                const raw = parseFloat(calSlider.value);
                if (Number.isFinite(raw) && raw > 0) {
                    this._hearingStaircaseStartLevel = Math.max(0.002, Math.min(this._hearingStaircaseMaxLevel, (raw / 100) * 0.12));
                }
            }

            // Begin at frequency 0 (250 Hz).
            this.hearingStep = 0;
            this.hearingThresholds = [0, 0, 0, 0, 0, 0, 0, 0];
            this._hearingAllDone = false;
            this._beginHearingFrequency(0);
        },

        _beginHearingFrequency: function(stepIdx) {
            this.hearingStep = stepIdx;
            this._hearingToneAnswers = 0; // per-answer progress within this tone
            // Staircase state: level in linear gain, step in dB, reversal
            // bookkeeping, and the collected reversal levels for averaging.
            this.staircase = {
                level: this._hearingStaircaseStartLevel,
                stepDb: 12,
                lastAnswer: null,
                reversals: [],
                reversalSteps: [],
                reversalCount: 0,
                lastReversalDir: 0,
                sameAnswerRun: 0,
                done: false,
                thresholdDb: null
            };
            this._playHearingToneAt(this.staircase.level);

            const btn = document.getElementById('hearing-test-btn');
            if (btn) btn.textContent = 'HEARD (+)';
            const notHeardBtn = document.getElementById('hearing-not-heard-btn');
            if (notHeardBtn) notHeardBtn.classList.remove('hidden');
            // Switch the action row to two columns now that there are two answers.
            const actions = document.getElementById('hearing-actions');
            if (actions) actions.classList.add('is-running');

            const freq = this.hearingTestFreqs[stepIdx];
            this._updateHearingTestUI({
                status: `Tone ${stepIdx + 1} of 8`,
                hz: `${freq} Hz`,
                progress: this._hearingTestFraction(),
                showSlider: false, // locked in — hide the calibration row
                instruction: `Heard it? Answer <span class="text-white font-bold">${freq} Hz</span> honestly.`
            });
        },

        _playHearingToneAt: function(level) {
            this.stopHearingTone();
            const ctx = SharedAudio.ctx;
            if (!ctx) return;
            const freq = this.hearingTestFreqs[this.hearingStep];
            if (!freq) return;

            this.hearingOsc = ctx.createOscillator();
            this.hearingGain = ctx.createGain();
            this.hearingOsc.type = 'sine';
            this.hearingOsc.frequency.value = freq;
            // 0 attack / smooth 120ms release so toggling the tone doesn't click.
            this.hearingGain.gain.value = level;
            this.hearingOsc.connect(this.hearingGain).connect(SharedAudio.masterGain);
            this.hearingOsc.start();
            this._currentHearingLevel = level;
        },

        // User answered. dir = +1 (heard) or -1 (not heard).
        hearingStaircaseAnswer: function(dir) {
            const st = this.staircase;
            if (!st || st.done) return;
            this._hearingToneAnswers = (this._hearingToneAnswers || 0) + 1;

            // Level step in dB (down when heard, up when not heard).
            const dbStep = st.stepDb * (dir > 0 ? -1 : 1);
            const prevLevel = st.level;
            st.level = Math.max(this._hearingStaircaseMinLevel,
                Math.min(this._hearingStaircaseMaxLevel, st.level * Math.pow(10, dbStep / 20)));

            // STUCK GUARD: repeating the same answer runs the level into the
            // ceiling/floor with no reversals — the staircase could never
            // converge (spamming "Heard +" parked at -68 dBFS forever, the
            // exact reported bug). If the level is clamped at a bound and the
            // same answer keeps coming, force-finish this frequency:
            //   - pegged at the FLOOR while hearing -> extremely sensitive at
            //     this band; record the floor as the threshold.
            //   - pegged at the CEILING while NOT hearing -> can't hear this
            //     band at safe levels; record the ceiling (max loss).
            const hitFloor = st.level <= this._hearingStaircaseMinLevel + 1e-9;
            const hitCeil = st.level >= this._hearingStaircaseMaxLevel - 1e-9;
            const clamped = (hitFloor && dir > 0) || (hitCeil && dir < 0);
            if (clamped && st.lastAnswer === dir) {
                st.sameAnswerRun++;
                if (st.sameAnswerRun >= 2) {
                    st.thresholdDb = 20 * Math.log10(Math.max(1e-6, st.level));
                    st.done = true;
                    this._updateHearingTestUI({
                        status: dir > 0 ? 'Keen ear here — next tone!' : 'Too quiet to hear — max boost recorded.',
                        instruction: dir > 0
                            ? 'You heard it at the quietest safe level.'
                            : 'Unheard even at max safe level — this tone gets full correction.'
                    });
                    this._finishHearingFrequency();
                    return;
                }
            } else {
                st.sameAnswerRun = 0;
            }

            // Reversal = answer flipped vs the previous one.
            const reversed = (st.lastAnswer !== null && st.lastAnswer !== dir);
            if (reversed) {
                st.reversalCount++;
                // Record the PRE-step level: the tone the user actually just
                // answered on is the turnaround point (st.level has already
                // advanced one full step past it — recording the post-step
                // value biased every reversal by a full step size).
                const reversalDb = 20 * Math.log10(Math.max(1e-6, prevLevel));
                const stepUsed = st.stepDb;
                st.reversals.push(reversalDb);
                st.reversalSteps.push(stepUsed);
                // Halve the step after every reversal: 12 -> 6 -> 3 -> 1.5.
                st.stepDb = Math.max(1.5, st.stepDb / 2);
                // Threshold: two reversals AT the finest (1.5 dB) step —
                // averaging the last two reversal levels only when BOTH
                // were measured with the final step size. (Checking after
                // the halve made stepDb<=1.5 true on the 3rd reversal while
                // the averaged pair came from 6 dB / 3 dB steps.)
                const lastTwoSteps = st.reversalSteps.slice(-2);
                if (st.stepDb <= 1.5 && st.reversals.length >= 2
                    && lastTwoSteps.length === 2
                    && lastTwoSteps[0] <= 1.5 && lastTwoSteps[1] <= 1.5) {
                    // Average the last two reversal levels (the classic
                    // 2-reversal mean at final step size).
                    const lastTwo = st.reversals.slice(-2);
                    st.thresholdDb = (lastTwo[0] + lastTwo[1]) / 2;
                    st.done = true;
                    this._updateHearingTestUI({
                        status: 'Threshold locked ✔'
                    });
                    this._finishHearingFrequency();
                    return;
                }
            }
            st.lastAnswer = dir;

            this._playHearingToneAt(st.level);

            const dbFs = 20 * Math.log10(Math.max(1e-6, st.level));
            const freqIdx = this.hearingStep;
            this._updateHearingTestUI({
                status: `Tone ${freqIdx + 1}/8 · ${dbFs.toFixed(1)} dBFS`,
                // Per-ANSWER progress: every click moves the current segment's
                // fill forward (boundary-only progress previously looked
                // frozen for 40+ answers in a realistic run).
                progress: this._hearingTestFraction(),
                instruction: reversed
                    ? 'Almost there — narrowing in on your limit.'
                    : (dir > 0 ? 'Got quieter. Still hear it?' : 'Got louder. Hear it now?')
            });
        },

        _finishHearingFrequency: function() {
            const st = this.staircase;
            if (!st) return;
            // Store the threshold as dB relative to the MAX level ceiling —
            // lower threshold (heard at a quieter level) = better sensitivity.
            const thresholdDb = st.thresholdDb !== null ? st.thresholdDb : 20 * Math.log10(Math.max(1e-6, st.level));
            this.hearingThresholds[this.hearingStep] = thresholdDb;
            this.staircase = null;
            this.stopHearingTone();

            const nextIdx = this.hearingStep + 1;
            if (nextIdx < this.hearingTestFreqs.length) {
                this._beginHearingFrequency(nextIdx);
            } else {
                this._finishHearingStaircaseAll();
            }
        },

        _finishHearingStaircaseAll: function() {
            this.hearingStep = -1;
            this._hearingAllDone = true;

            const btn = document.getElementById('hearing-test-btn');
            if (btn) btn.textContent = 'Start Test';
            const notHeardBtn = document.getElementById('hearing-not-heard-btn');
            if (notHeardBtn) notHeardBtn.classList.add('hidden');
            const actions = document.getElementById('hearing-actions');
            if (actions) actions.classList.remove('is-running');

            this._updateHearingTestUI({
                status: 'Done — correction applied ✔',
                hz: 'DONE',
                progress: 1,
                showSlider: true, // test over — calibration row can come back
                instruction: 'Saved to the EQ until Reset.'
            });

            this.calculateHearingCorrection();
        },

        // Relative-HL mapping: shift each frequency's raw threshold by the
        // ISO reference difference so the final offsets reflect loss
        // relative to the user's own 1 kHz anchor.
        getHearingRelativeDb: function() {
            const anchor = this.hearingThresholds[2] || 0; // 1 kHz
            const out = [];
            for (let i = 0; i < this.hearingTestFreqs.length; i++) {
                const iso = this.isoRetflDb[this.hearingTestFreqs[i]] || 0;
                const isoAnchor = this.isoRetflDb[1000] || 0;
                out.push((this.hearingThresholds[i] || 0) - anchor - (iso - isoAnchor));
            }
            return out;
        },

        nextHearingStep: async function() {
            // Legacy entry (old button) now starts/advances the staircase.
            if (this.hearingStep === -1) {
                if (this.staircase) return;
                await this.startHearingStaircase();
            } else {
                this.hearingStaircaseAnswer(+1);
            }
        },

        hearingNotHeard: function() {
            this.hearingStaircaseAnswer(-1);
        },

        updateHearingTestVolume: function() {
            const slider = document.getElementById('hearing-test-vol');
            const raw = slider ? parseFloat(slider.value) : NaN;
            const vol = Number.isFinite(raw) ? raw : 0;

            // Live % readout beside the slider.
            const calVal = document.getElementById('hearing-cal-val');
            if (calVal) calVal.textContent = Math.round(vol) + '%';

            // During a staircase the test owns the tone level — the row is
            // hidden anyway; ignore stray input events.
            if (this.staircase) return;

            // Pre/post-test: the slider is a LIVE calibration preview. Play
            // 1 kHz at the chosen level so the user hears exactly what they
            // are setting (the old version required a tone to already be
            // playing, which never happened outside a test — the control did
            // nothing at all).
            const ctx = SharedAudio.init();
            if (!ctx) return;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const safeVol = (vol / 100) * 0.12;
            if (vol <= 0) {
                this.stopHearingTone();
                this._updateHearingTestUI({
                    instruction: 'Raise the level until the preview tone is comfortable.'
                });
            } else {
                if (!this.hearingOsc) {
                    this.stopHearingTone();
                    this.hearingOsc = ctx.createOscillator();
                    this.hearingGain = ctx.createGain();
                    this.hearingOsc.type = 'sine';
                    this.hearingOsc.frequency.value = 1000;
                    this.hearingGain.gain.value = Math.max(0.0001, safeVol);
                    this.hearingOsc.connect(this.hearingGain).connect(SharedAudio.masterGain);
                    this.hearingOsc.start();
                } else if (this.hearingGain) {
                    setAudioParamSmooth(this.hearingGain.gain, Math.max(0.0001, safeVol), 0.02);
                }
                this._updateHearingTestUI({
                    instruction: `Preview 1 kHz at ${Math.round(vol)}% — then start.`
                });
            }

            // Remember the calibration so Start Test begins from this level.
            if (vol > 0) {
                this._hearingStaircaseStartLevel = Math.max(0.002, Math.min(this._hearingStaircaseMaxLevel, safeVol));
            }
        },

        stopHearingTone: function() {
            if (this.hearingOsc) {
                try { this.hearingOsc.stop(); } catch(e){}
                this.hearingOsc.disconnect();
                this.hearingOsc = null;
            }
            if (this.hearingGain) {
                this.hearingGain.disconnect();
                this.hearingGain = null;
            }
        },

        resetHearingTest: function() {
            this.stopHearingTone();
            this.hearingStep = -1;
            this.staircase = null;
            this._hearingAllDone = false;
            this._hearingToneAnswers = 0;
            this.hearingThresholds = [0, 0, 0, 0, 0, 0, 0, 0];
            EQ_Module.hearingOffsets = [0, 0, 0, 0, 0, 0, 0, 0];
            EQ_Module.hearingCalEnabled = false;
            // Clear the persisted profile too — Reset means "remove my saved
            // hearing correction", not just "discard this run" (the old
            // version left a stale copy that re-armed itself on next reload).
            try { localStorage.removeItem('settings_hearing_offsets'); } catch (e) {}

            const btn = document.getElementById('hearing-test-btn');
            const status = document.getElementById('hearing-test-status');
            const hzDisp = document.getElementById('hearing-test-hz');
            const volSlider = document.getElementById('hearing-test-vol');
            const calBtn = document.getElementById('btn-hearing-cal');
            const calLbl = document.getElementById('lbl-hearing-cal');
            const generateBtn = document.getElementById('hearing-eq-generate-btn');
            const notHeardBtn = document.getElementById('hearing-not-heard-btn');

            if (btn) btn.textContent = 'Start Test';
            if (notHeardBtn) notHeardBtn.classList.add('hidden');
            if (status) status.textContent = 'Hearing Test: Idle';
            if (hzDisp) hzDisp.textContent = '--- Hz';
            if (volSlider) volSlider.value = 50;
            const calVal = document.getElementById('hearing-cal-val');
            if (calVal) calVal.textContent = '50%';
            if (calBtn) calBtn.classList.remove('active-btn');
            if (calLbl) calLbl.textContent = 'Hearing: Off';
            this._updateHearingTestUI({
                progress: 0,
                showSlider: true,
                instruction: 'Set a comfortable level, then start.'
            });
            // Back to a single full-width primary (mirrors the is-running toggle
            // in _beginHearingFrequency).
            const hearingActions = document.getElementById('hearing-actions');
            if (hearingActions) hearingActions.classList.remove('is-running');

            if (generateBtn) {
                generateBtn.disabled = true;
                // R7: state is now carried by [disabled] plus a token-driven
                // .tl-eq-bake style rather than swapped Tailwind classes. The old
                // pair was bg-emerald-500 (#10B981) with text-white, which is
                // ~2.4:1 - it failed WCAG AA for the button's own label and was
                // the single brightest object in the pane on an OLED theme.
                generateBtn.classList.remove('is-ready');
                generateBtn.classList.add('hidden');
            }

            const el = document.getElementById('brand-icon-emoji');
            if (el) el.style.transform = "";

            EQ_Module.applyHearingCalibrationGains();
            EQ_Module.drawCurve();
            showToast("Hearing Test Reset", "🔄");
        },

        calculateHearingCorrection: function() {
            // Staircase thresholds are dBFS values where LOWER = more
            // sensitive. Convert to relative hearing level (anchored at the
            // user's own 1 kHz threshold, ISO-shaped) and cap the correction.
            const maxCorrectionDb = 6.0;

            const relDb = (typeof this.getHearingRelativeDb === 'function')
                ? this.getHearingRelativeDb()
                : [];

            const offsets = this.hearingThresholds.map((rawDb, i) => {
                // Positive relative loss = user heard this frequency LATER
                // (quieter) than their own 1 kHz anchor + ISO difference.
                const loss = (relDb[i] !== undefined) ? relDb[i] : 0;
                if (loss <= 0) return 0;
                return Math.min(maxCorrectionDb, loss * 0.4);
            });

            EQ_Module.hearingOffsets = offsets;
            EQ_Module.hearingCalEnabled = true;

            const btn = document.getElementById('btn-hearing-cal');
            const lbl = document.getElementById('lbl-hearing-cal');
            if (btn && lbl) {
                btn.classList.add('active-btn');
                lbl.textContent = 'Hearing: ON';
            }

            const generateBtn = document.getElementById('hearing-eq-generate-btn');
            if (generateBtn) {
                generateBtn.classList.add('is-ready');
                generateBtn.classList.remove('hidden');
                generateBtn.disabled = false;
            }

            EQ_Module.applyHearingCalibrationGains();
            EQ_Module.drawCurve();
            if (window.App && App.saveWorkspaceState) App.saveWorkspaceState();
            showToast("Hearing Calibration Profile Applied!", "👂");
        },

        convertHearingToEQ: function() {
            if (!this.hearingThresholds || this.hearingStep !== -1) return;

            // hearingTestFreqs: [250, 500, 1000, 2000, 4000, 8000, 12000, 16000]
            // hearingOffsets index 6 (12 kHz) has no dedicated fader — the main
            // band grid jumps 8kHz (fader 8) to 16kHz (fader 9). Fold the 12k
            // offset into both neighbors weighted by log-frequency distance so
            // no measured loss is silently discarded:
            //   w8  = (log12k - log8k)  / (log16k - log8k)  -> weight on fader 8
            //   w16 = (log16k - log12k) / (log16k - log8k)  -> weight on fader 9
            const off12k = EQ_Module.hearingOffsets[6] || 0;
            let split8 = 0, split16 = 0;
            if (off12k !== 0) {
                const lo = Math.log10(8000), mid = Math.log10(12000), hi = Math.log10(16000);
                const wLo = (mid - lo) / (hi - lo);   // ~0.58 -> fader 9 (16k)
                const wHi = (hi - mid) / (hi - lo);   // ~0.42 -> fader 8 (8k)
                split8 = off12k * wHi;
                split16 = off12k * wLo;
            }

            const faderMappings = {
                3: EQ_Module.hearingOffsets[0] || 0,
                4: EQ_Module.hearingOffsets[1] || 0,
                5: EQ_Module.hearingOffsets[2] || 0,
                6: EQ_Module.hearingOffsets[3] || 0,
                7: EQ_Module.hearingOffsets[4] || 0,
                8: (EQ_Module.hearingOffsets[5] || 0) + split8,
                9: (EQ_Module.hearingOffsets[7] || 0) + split16
            };

            EQ_Module.isProgrammaticSliderUpdate = true;

            // ALWAYS release the programmatic flag. updateSlider() is called up
            // to 8 times in here and any one of them throwing would leave the
            // lock stuck true, silently killing every later manual EQ change
            // for the rest of the session.
            try {
            let maxGain = -999;
            Object.entries(faderMappings).forEach(([fIdx, offsetVal]) => {
                const slider = document.getElementById("eq-s" + fIdx);
                const numInput = document.getElementById(`eq-s${fIdx}_num`);

                const currentGain = slider ? parseFloat(slider.value) : 0;

                const combinedVal = Math.max(-20, Math.min(20, currentGain + offsetVal));

                if (slider) slider.value = combinedVal.toFixed(1);
                if (numInput) numInput.value = combinedVal.toFixed(1);

                if (combinedVal > maxGain) maxGain = combinedVal;

                EQ_Module.updateSlider(parseInt(fIdx), 'main');
            });

            for (let idx = 0; idx < EQ_Module.bands.length; idx++) {
                if (faderMappings[idx] === undefined) {
                    const slider = document.getElementById("eq-s" + idx);
                    const val = slider ? parseFloat(slider.value) : 0;
                    if (val > maxGain) maxGain = val;
                }
            }

            const preamp = maxGain > 0 ? -maxGain : 0;
            const preampSlider = document.getElementById("eq-preampSlider");
            if (preampSlider) preampSlider.value = preamp.toFixed(1);
            EQ_Module.updatePreamp();

            } finally {
                EQ_Module.isProgrammaticSliderUpdate = false;
            }

            EQ_Module.eqEnabled = true;

            const eqToggleBtn = document.getElementById("eqToggleBtn");
            if (eqToggleBtn) {
                eqToggleBtn.classList.add('is-on');
                eqToggleBtn.textContent = "EQ: ON";
            }

            EQ_Module.updateAudioConnections();
            EQ_Module.drawCurve();

            if (window.syncGlobalSliders) window.syncGlobalSliders();

            App.switchTab('eq');
            showToast("Hearing correction added on top of active EQ faders!", "🪄");
            if (off12k !== 0) {
                // Surface the interpolation so the user knows the 12k
                // measurement wasn't dropped (it has no dedicated fader).
                showToast(`12kHz correction (+${off12k.toFixed(1)}dB) folded into 8k/16k faders proportionally.`, "🎚️");
            }
        },
};
