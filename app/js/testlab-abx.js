// TestLab A/B and ABX blind-test engine.
// Split out of testlab-module.js; merged into TestLab_Module via Object.assign there.
const TestLab_AbxMethods = {
        // (dead duplicate `spatialType: 'pink'` removed — 'pink' was never a
        // valid entry in spatialSourceOptions anyway; the live default lives
        // further down as 'footsteps', matching the static HTML button label)
        getAbxConfidence: function(correct, total) {
            if (total === 0) return { pct: 0, text: "No Trials", class: "text-zinc-500" };

            const binom = (n, k) => {
                if (k < 0 || k > n) return 0;
                if (k === 0 || k === n) return 1;
                let res = 1;
                for (let i = 1; i <= k; i++) {
                    res = res * (n - i + 1) / i;
                }
                return res;
            };

            let pGuessOrBetter = 0;
            for (let i = correct; i <= total; i++) {
                pGuessOrBetter += binom(total, i) * Math.pow(0.5, total);
            }
            // Mid-p correction: count only half of the observed cell's probability
            // as "as-or-better than guessing", which reduces the discrete p-value
            // bias at small n (matches common psychometric practice and just barely
            // shifts the boundary scores 8/10 etc., rather than inflating them).
            pGuessOrBetter -= 0.5 * binom(total, correct) * Math.pow(0.5, total);

            const confidence = 100 * (1 - pGuessOrBetter);

            let text = "Guessing";
            let colorClass = "text-zinc-500";

            // A perfect 3/3 is p=0.125 — suggestive, not significant, but
            // calling it "Guessing" overstated the case the other way. Show
            // the trend with an explicit small-sample caveat instead of the
            // flat dismissal.
            if (total >= 4 || (total >= 2 && correct === total)) {
                if (confidence >= 95) {
                    text = "Highly Significant";
                    colorClass = "text-emerald-400";
                } else if (confidence >= 80) {
                    text = "Significant";
                    colorClass = "text-teal-400";
                } else if (confidence >= 50) {
                    text = "Acuity Trend";
                    colorClass = "text-amber-500";
                } else {
                    text = "Insignificant";
                    colorClass = "text-red-400";
                }
                if (total < 4) text += " (small sample)";
            }

            return {
                // Number, not string: callers compose it for display and any
                // future numeric consumer got string coercion before.
                pct: Math.max(0, Math.round(confidence * 10) / 10),
                text: text,
                class: colorClass
            };
        },

        abPlaying: false,

        abBlindMode: false,

        abTrackAPhysical: 'A',

        abTrackBPhysical: 'B',

        abxIsActive: false,

        abxTrialIndex: 0,

        abxTotalTrials: 10,

        abxCorrect: 0,

        abxIncorrect: 0,

        abxTargetAnswer: null,

        abxTrialsOptions: [5, 10, 15, 20],

        abxCycleTrials: function(dir) {
            // Changing the denominator mid-session ends/rescores a running
            // test against a number it was never configured for (7 >= 5 ends
            // it early; 10 -> 15 silently extends it). Lock the stepper while
            // a session is active — the same treatment the A/B crossfade
            // controls already get via setABXControlsEnabled.
            if (this.abxIsActive) {
                showToast("Finish or stop the current test before changing the trial count.", "⚠️");
                return;
            }
            const opts = this.abxTrialsOptions;
            let idx = opts.indexOf(this.abxTotalTrials);
            if (idx < 0) idx = opts.indexOf(10);
            const len = opts.length;
            this.abxTotalTrials = opts[((idx + dir) % len + len) % len];
            this.abxRenderTrials();
        },

        abxRenderTrials: function() {
            const lbl = document.getElementById('abx-trial-count');
            if (lbl) lbl.textContent = String(this.abxTotalTrials);
            /* Drives the readout colour ramp in CSS 8.21. Kept as an attribute
               rather than a class so the palette stays in the stylesheet - the
               same split the rest of the app uses (JS owns state, CSS owns
               colour). Without this the whole "N Trials" would sit on the
               default tier no matter which option was picked. */
            const stepper = document.getElementById('abx-trials-stepper');
            if (stepper) stepper.dataset.trials = String(this.abxTotalTrials);
        },

        /* Blind-test panel visibility, in one place.
           Three states:
             'idle'  - nothing has run yet. Only the trial stepper, START and a
                        hint. The A/B chooser and the scoreboard are hidden
                        because before any trial they can only read as a run of
                        zeros the user never asked for.
             'active'- a test is running. Chooser enabled, scoreboard live.
             'done'  - finished. Chooser disabled, scoreboard kept (that is the
                        result), START available again.

           Previously each of abxStart / abxEndGame / abxReset poked
           #abx-choices-row's inline pointerEvents/opacity directly and nothing
           ever hid the scoreboard, so "Correct: 0 Wrong: 0 / Conf: 0.0%
           (No Trials)" was on screen from first paint. */
        setABXPanelState: function(state) {
            const choices = document.getElementById('abx-choices-row');
            const stats = document.getElementById('abx-stats-row');
            const hint = document.getElementById('abx-idle-hint');

            if (stats) stats.classList.toggle('hidden', state === 'idle');
            if (hint) hint.classList.toggle('hidden', state !== 'idle');

            if (choices) {
                if (state === 'idle') {
                    /* Collapsed, not just faded. opacity:0 kept the row's 29px of
                       layout, which left a dead gap between the hint and the
                       footer on a panel that has nothing to show there. */
                    choices.style.display = 'none';
                    choices.style.pointerEvents = 'none';
                } else {
                    choices.style.display = '';           /* back to Tailwind's grid */
                    if (state === 'active') {
                        choices.style.pointerEvents = 'auto';
                        choices.style.opacity = '1.0';
                    } else {
                        choices.style.pointerEvents = 'none';
                        choices.style.opacity = '0.5';
                    }
                }
            }
        },

        abxStart: async function() {
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (!audioA || !audioB || !audioA.src || !audioB.src) {
                showToast("Please load Source A and Source B tracks first.", "⚠️");
                return;
            }

            this.stopAll(false, this.burninActive);
            this.abxIsActive = true;
            this.abxTrialIndex = 0;
            this.abxCorrect = 0;
            this.abxIncorrect = 0;
            this._abxAnswered = false;

            if (isNaN(this.abxTotalTrials) || this.abxTotalTrials < 5) this.abxTotalTrials = 10;
            this.abxRenderTrials();

            document.getElementById('abx-correct-count').textContent = '0';
            document.getElementById('abx-incorrect-count').textContent = '0';

            const confPctEl = document.getElementById('abx-confidence-pct');
            const confTxtEl = document.getElementById('abx-confidence-text');
            const confWrap = document.getElementById('abx-confidence-wrapper');
            if (confPctEl && confTxtEl && confWrap) {
                confPctEl.textContent = '0.0%';
                confTxtEl.textContent = 'No Trials';
                confWrap.className = 'text-zinc-500';
            }

            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn) {
                startBtn.textContent = 'STOP TEST';
                startBtn.className = 'abx-start-btn is-stop';
                startBtn.onclick = () => this.abxReset();
            }

            this.setABXPanelState('active');

            this.setABXControlsEnabled(false);

            this.abxNextTrial();
        },

        abxNextTrial: async function() {
            // A queued inter-trial timer may fire after STOP — never start a
            // ghost trial once the test is no longer active.
            if (!this.abxIsActive) return;
            if (this.abxTrialIndex >= this.abxTotalTrials) {
                this.abxEndGame();
                return;
            }

            this.abxTargetAnswer = Math.random() < 0.5 ? 'A' : 'B';
            // Re-arm the one-answer-per-trial guard (abxChoose sets it).
            this._abxAnswered = false;

            const progress = document.getElementById('abx-progress-lbl');
            if (progress) progress.textContent = `Trial ${this.abxTrialIndex + 1}/${this.abxTotalTrials}`;

            const status = document.getElementById('abx-status-lbl');
            if (status) {
                status.textContent = 'Playing Target X...';
                status.className = "text-[9px] text-[var(--accent-amber)] font-mono animate-pulse";
            }

            await EQ_Module.ensureDSPGraph();
            // The session may have been stopped while this await was pending
            // (e.g. STOP clicked during trial start, or a tab switch) — never
            // start audio for a session that is no longer active.
            if (!this.abxIsActive) return;
            this.ensureABSources();
            // ensureABSources() only creates gainNodeA/gainNodeB once and
            // wires them into the shared audio graph; updateABFade() is the
            // only place their gain values ever get set, and it refuses to
            // run while an ABX session is active. Without this, whatever
            // the non-blind crossfade slider was last set to (including a
            // hard 0/1 extreme) stays baked into these two GainNodes for
            // every trial, on top of the .volume toggle below — verified in
            // a sandbox trace: a stale gainNodeB=0 makes every "B" target
            // trial completely silent while the UI still scores it.
            this._abxSetArmGainsUnity();

            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');

            if (this.abxTargetAnswer === 'A') {
                audioA.volume = 1.0;
                audioB.volume = 0.0;
            } else {
                audioA.volume = 0.0;
                audioB.volume = 1.0;
            }

            audioA.currentTime = 0;
            audioB.currentTime = 0;
            // Floating play() promises: autoplay-policy denials become unhandled
            // rejections. Catch and surface them like the rest of the test flow.
            audioA.play().catch(e => {
                console.warn("[TestLab] ABX source A playback blocked:", e && e.message);
                if (this.abxIsActive) {
                    const status = document.getElementById('abx-status-lbl');
                    if (status) status.textContent = 'Playback blocked — click anywhere and retry.';
                }
            });
            audioB.play().catch(e => {
                console.warn("[TestLab] ABX source B playback blocked:", e && e.message);
            });

            this.abPlaying = true;
        },

        abxChoose: function(choice) {
            if (!this.abxIsActive) return;
            // One answer per trial: nothing disabled the choice row during
            // the 1s inter-trial window, so a rapid double-click scored the
            // same target twice and skipped a trial index.
            if (this._abxAnswered) return;
            this._abxAnswered = true;

            const isCorrect = choice === this.abxTargetAnswer;
            if (isCorrect) {
                this.abxCorrect++;
                showToast("✅ Correct! That was indeed the target source.", "✅");
            } else {
                this.abxIncorrect++;
                showToast("❌ Incorrect. Try again on the next trial.", "❌");
            }

            document.getElementById('abx-correct-count').textContent = this.abxCorrect;
            document.getElementById('abx-incorrect-count').textContent = this.abxIncorrect;

            const total = this.abxCorrect + this.abxIncorrect;
            const conf = this.getAbxConfidence(this.abxCorrect, total);
            const confPctEl = document.getElementById('abx-confidence-pct');
            const confTxtEl = document.getElementById('abx-confidence-text');
            const confWrap = document.getElementById('abx-confidence-wrapper');
            if (confPctEl && confTxtEl && confWrap) {
                confPctEl.textContent = conf.pct + "%";
                confTxtEl.textContent = conf.text;
                confWrap.className = conf.class;
            }

            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA) audioA.pause();
            if (audioB) audioB.pause();
            this.abPlaying = false;

            this.abxTrialIndex++;
            // Track the inter-trial timer so STOP (abxReset) can cancel it —
            // an untracked timer used to fire one ghost trial after stopping.
            if (this._abxTrialTimer) clearTimeout(this._abxTrialTimer);
            this._abxTrialTimer = setTimeout(() => {
                this._abxTrialTimer = null;
                this.abxNextTrial();
            }, 1000);
        },

        abxEndGame: function() {
            this.abxIsActive = false;
            const percentage = Math.round((this.abxCorrect / this.abxTotalTrials) * 100);

            const status = document.getElementById('abx-status-lbl');
            if (status) {
                status.textContent = `Completed! Score: ${percentage}%`;
                status.className = "text-[9px] text-emerald-400 font-black uppercase tracking-wider";
            }

            this.setABXPanelState('done');

            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn) {
                startBtn.textContent = 'START TEST';
                startBtn.className = 'abx-start-btn';
                startBtn.onclick = () => this.abxStart();
            }
            this.setABXControlsEnabled(true);
            // Restore whatever the non-blind crossfade slider was set to
            // before the session started -- updateABFade() early-returns
            // while abxIsActive is true, so this is the first safe point
            // to apply it once the trial arms are no longer in exclusive
            // use.
            this.updateABFade();
        },

        abxReset: function() {
            this.abxIsActive = false;
            this.abxTrialIndex = 0;
            this.abxCorrect = 0;
            this.abxIncorrect = 0;
            this._abxAnswered = false;
            if (this._abxTrialTimer) { clearTimeout(this._abxTrialTimer); this._abxTrialTimer = null; }

            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn) {
                startBtn.textContent = 'START TEST';
                startBtn.className = 'abx-start-btn';
                startBtn.onclick = () => this.abxStart();
            }

            const status = document.getElementById('abx-status-lbl');
            if (status) {
                status.textContent = '';
            }

            const progress = document.getElementById('abx-progress-lbl');
            if (progress) progress.textContent = 'Trial 0/10';

            const confPctEl = document.getElementById('abx-confidence-pct');
            const confTxtEl = document.getElementById('abx-confidence-text');
            const confWrap = document.getElementById('abx-confidence-wrapper');
            if (confPctEl && confTxtEl && confWrap) {
                confPctEl.textContent = '0.0%';
                confTxtEl.textContent = 'No Trials';
                confWrap.className = 'text-zinc-500';
            }

            this.setABXPanelState('idle');

            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA) audioA.pause();
            if (audioB) audioB.pause();
            this.abPlaying = false;
            this.setABXControlsEnabled(true);
            // Same restore as abxEndGame() -- see that call site for why.
            this.updateABFade();
        },

        updateABMarquee: function() {
            ['ab-file-name-a', 'ab-file-name-b'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;

                el.classList.remove('marquee-active');
                el.style.transform = '';

                setTimeout(() => {
                    const parentWidth = el.parentElement.clientWidth;
                    const childWidth = el.scrollWidth;

                    if (childWidth > parentWidth) {
                        const scrollDist = -(childWidth - parentWidth + 12);
                        el.style.setProperty('--scroll-dist', `${scrollDist}px`);
                        el.classList.add('marquee-active');
                    }
                }, 80);
            });
        },

        initABTest: function() {
            const fileA = document.getElementById('ab-file-a');
            const fileB = document.getElementById('ab-file-b');
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');

            if (fileA && audioA) {
                fileA.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        if (audioA.src && audioA.src.startsWith('blob:')) {
                            URL.revokeObjectURL(audioA.src);
                        }
                        audioA.src = URL.createObjectURL(file);
                        audioA.load();
                        const label = document.getElementById('ab-file-name-a');
                        if (label) label.textContent = file.name;
                        this.updateABMarquee();
                    }
                });
            }
            if (fileB && audioB) {
                fileB.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        if (audioB.src && audioB.src.startsWith('blob:')) {
                            URL.revokeObjectURL(audioB.src);
                        }
                        audioB.src = URL.createObjectURL(file);
                        audioB.load();
                        const label = document.getElementById('ab-file-name-b');
                        if (label) label.textContent = file.name;
                        this.updateABMarquee();
                    }
                });
            }

            this.updateABMarquee();

            // Wire the START/STOP button's initial state. The static
            // data-action="click_101_TestLab_abxStart" was removed from
            // index.html: with it, clicking STOP fired BOTH abxStart
            // (capture-phase EventBinding delegation) and the dynamically
            // assigned abxReset — the resumed async trial then played
            // looping audio with the session flag already false. The button
            // is now driven exclusively by the dynamic onclick that
            // abxStart/abxReset/abxEndGame re-assign on every state change.
            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn && !startBtn.onclick) {
                startBtn.onclick = () => this.abxStart();
            }
        },

        clearComparisonTracks: function() {
            if (this.abxIsActive) this.abxReset();
            this.stopAll(false, this.burninActive);
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            const fileA = document.getElementById('ab-file-a');
            const fileB = document.getElementById('ab-file-b');
            const labelA = document.getElementById('ab-file-name-a');
            const labelB = document.getElementById('ab-file-name-b');

            if (audioA) { audioA.pause(); audioA.src = ''; audioA.load(); }
            if (audioB) { audioB.pause(); audioB.src = ''; audioB.load(); }
            // NOTE: the MediaElementSource wrappers are deliberately KEPT —
            // they are one-per-element for the context's lifetime and keep
            // working with whatever blob src is loaded next. Nulling them here
            // would make the next ensureABSources() throw permanently.
            if (fileA) fileA.value = '';
            if (fileB) fileB.value = '';
            if (labelA) labelA.textContent = 'Browse or drop...';
            if (labelB) labelB.textContent = 'Browse or drop...';

            this.updateABMarquee();
            showToast("A/B comparison tracks cleared.", "🗑️");
        },

        ensureABSources: function() {
            const ctx = SharedAudio.init();
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (!audioA || !audioB) return;

            try {
                // A MediaElementSource is one-per-element for the lifetime of
                // the context — recreating it throws. Wrap-and-reuse instead,
                // so a Clear followed by new files keeps working.
                if (!this.sourceA) this.sourceA = ctx.createMediaElementSource(audioA);
                if (!this.sourceB) this.sourceB = ctx.createMediaElementSource(audioB);
                if (!this.gainNodeA) this.gainNodeA = ctx.createGain();
                if (!this.gainNodeB) this.gainNodeB = ctx.createGain();

                if (!this.abSourcesConnected) {
                    // Route into the shared DSP chain (EQ applies) when it
                    // exists, otherwise straight to the master bus. Duplicate
                    // connect() calls with identical endpoints are collapsed
                    // by the spec, so this is safe to re-run.
                    const dest = EQ_Module.inputGainNode || SharedAudio.masterGain;
                    this.sourceA.connect(this.gainNodeA).connect(dest);
                    this.sourceB.connect(this.gainNodeB).connect(dest);
                    this.abSourcesConnected = true;
                } else if (this._abReroutedToMaster && EQ_Module.inputGainNode) {
                    // The silence-probe previously bypassed the DSP chain and
                    // nothing ever wired it back (abSourcesConnected stayed
                    // true), so every later A/B and ABX playback silently ran
                    // without EQ. Restore the DSP route now that the chain
                    // exists — collapsed-connect semantics make this idempotent.
                    try {
                        this.gainNodeA.disconnect();
                        this.gainNodeB.disconnect();
                        this.gainNodeA.connect(EQ_Module.inputGainNode);
                        this.gainNodeB.connect(EQ_Module.inputGainNode);
                        this._abReroutedToMaster = false;
                    } catch (e) {
                        console.warn('[A/B] DSP chain rewire failed:', e);
                    }
                }
            } catch (e) {
                console.warn('[A/B] Failed to wire comparison sources:', e);
                try { if (typeof showToast === 'function') showToast("A/B audio routing failed — see console, then press Play again.", "⚠️"); } catch (_) {}
            }
        },

        // Forces both ABX playback arms to unity gain so the only thing
        // distinguishing "A" from "B" during a trial is the .volume toggle
        // in abxNextTrial() -- see the call site there for why this exists.
        _abxSetArmGainsUnity: function() {
            if (!SharedAudio.ctx) return;
            const now = SharedAudio.ctx.currentTime;
            if (this.gainNodeA) this.gainNodeA.gain.setTargetAtTime(1.0, now, 0.005);
            if (this.gainNodeB) this.gainNodeB.gain.setTargetAtTime(1.0, now, 0.005);
        },

setABXControlsEnabled: function(enabled) {
            const slider = document.getElementById('ab-crossfade');
            const playBtn = document.getElementById('ab-play-btn');
            if (slider) slider.disabled = !enabled;
            if (playBtn) playBtn.disabled = !enabled;
        },

        toggleABPlay: async function() {
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            const btn = document.getElementById('ab-play-btn');

            if (this.abxIsActive) {
                // Previously a silent early-return: the button appeared dead.
                showToast("An ABX session is active — finish or reset it first.", "ℹ️");
                return;
            }
            if (!audioA || !audioB || !audioA.src || !audioB.src) {
                showToast("Upload audio files to compare.", "⚠️");
                return;
            }

            await EQ_Module.ensureDSPGraph();

            if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                await SharedAudio.ctx.resume();
            }

            this.ensureABSources();
            if (!this.abSourcesConnected) {
                console.error('[A/B] abort: sources not connected', {
                    hasSourceA: !!this.sourceA, hasSourceB: !!this.sourceB,
                    graphBuilt: EQ_Module.graphBuilt
                });
                return;
            }

            const dbg = (label, extra) => console.info('[A/B]', label, extra || '');

            if (this.abPlaying) {
                audioA.pause();
                audioB.pause();
                this.abPlaying = false;
                if (btn) btn.innerHTML = 'Play Sync';
            } else {
                // Exclusive playback: the playlist must not drive the shared
                // chain while A/B compares two files (levels, meters, de-esser
                // and AGC all assume a single source).
                if (window.EQ && EQ.stopPlaylistPlayback) EQ.stopPlaylistPlayback();
                this.stopAll(false, this.burninActive);
                audioA.currentTime = 0;
                audioB.currentTime = 0;
                this.updateABFade();

                try {
                    // Surface element-level failures (unsupported codec, failed
                    // load, interrupted play) instead of logging to console only
                    // while the UI claims "Pause".
                    dbg('play() requested', {
                        ctx: SharedAudio.ctx.state,
                        readyA: audioA.readyState, readyB: audioB.readyState,
                        durA: audioA.duration, durB: audioB.duration
                    });
                    await Promise.all([audioA.play(), audioB.play()]);
                    this.abPlaying = true;
                    if (btn) btn.innerHTML = 'Pause';

                    // Verify audible signal shortly after starting. Elements can
                    // report "playing" while the routing feeding them is dead
                    // (or something paused them again); tell the user which
                    // world we are in and offer a one-click bypass of the
                    // shared DSP chain.
                    setTimeout(() => {
                        const stillPlaying = !audioA.paused && !audioB.paused;
                        let metered = false;
                        try {
                            const probe = new Uint8Array(SharedAudio.analyser ? SharedAudio.analyser.fftSize : 1024);
                            if (SharedAudio.analyser) {
                                SharedAudio.analyser.getByteTimeDomainData(probe);
                                for (let i = 0; i < probe.length; i++) {
                                    if (Math.abs(probe[i] - 128) > 2) { metered = true; break; }
                                }
                            }
                        } catch (_) {}
                        dbg('350ms check', {
                            stillPlaying, metered,
                            gainA: this.gainNodeA && this.gainNodeA.gain.value.toFixed(3),
                            gainB: this.gainNodeB && this.gainNodeB.gain.value.toFixed(3),
                            tA: audioA.currentTime.toFixed(2), tB: audioB.currentTime.toFixed(2),
                            ctx: SharedAudio.ctx.state,
                            destChain: 'inputGainNode'
                        });
                        if (!stillPlaying) {
                            showToast("Tracks stopped unexpectedly right after starting.", "⚠️");
                        } else if (!metered) {
                            // A single 350ms probe false-positives on quiet
                            // intros (fade-ins, live recordings, encoder
                            // silence): rerouting away from the EQ chain on
                            // that evidence permanently bypassed DSP for the
                            // session (abSourcesConnected stayed true and
                            // nothing ever rewired it). Re-probe once after a
                            // grace period; only reroute if STILL silent.
                            setTimeout(() => {
                                let metered2 = false;
                                try {
                                    const probe2 = new Uint8Array(SharedAudio.analyser ? SharedAudio.analyser.fftSize : 1024);
                                    if (SharedAudio.analyser) {
                                        SharedAudio.analyser.getByteTimeDomainData(probe2);
                                        for (let i = 0; i < probe2.length; i++) {
                                            if (Math.abs(probe2[i] - 128) > 2) { metered2 = true; break; }
                                        }
                                    }
                                } catch (_) {}
                                if (metered2 || audioA.paused || audioB.paused) return;
                                try {
                                    const dest = SharedAudio.masterGain;
                                    this.gainNodeA.disconnect();
                                    this.gainNodeB.disconnect();
                                    this.gainNodeA.connect(dest);
                                    this.gainNodeB.connect(dest);
                                    this._abReroutedToMaster = true;
                                    showToast("No signal through the DSP chain — A/B routed to master (bypassed).", "🔌");
                                } catch (e) {
                                    console.warn('[A/B] direct reroute failed:', e);
                                    showToast("No signal reaching output — check files.", "⚠️");
                                }
                            }, 1000);
                        }
                    }, 350);
                } catch (err) {
                    console.error("Audio playback failure:", err);
                    this.abPlaying = false;
                    if (btn) btn.innerHTML = 'Play Sync';
                    showToast(`Playback failed: ${err && err.name ? err.name : 'unknown error'} — try re-selecting the file.`, "⚠️");
                }
            }
        },

        // Pause any active A/B session (used by playlist playback for
        // exclusive output — see toggleABPlay's mirror of this behavior).
        pauseABPlayback: function() {
            if (!this.abPlaying) return false;
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA && !audioA.paused) { try { audioA.pause(); } catch (e) {} }
            if (audioB && !audioB.paused) { try { audioB.pause(); } catch (e) {} }
            this.abPlaying = false;
            const btn = document.getElementById('ab-play-btn');
            if (btn) btn.innerHTML = 'Play Sync';
            showToast("A/B paused — playlist took over.", "ℹ️");
            return true;
        },

        updateABFade: function() {
            if (this.abxIsActive) return;
            const slider = document.getElementById('ab-crossfade');
            if (!slider) return;
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA) audioA.volume = 1.0;
            if (audioB) audioB.volume = 1.0;

            const val = parseFloat(slider.value);
            let gainA = 1 - val;
            let gainB = val;

            if (this.abBlindMode) {
                if (this.abTrackAPhysical === 'B') {
                    gainA = val;
                    gainB = 1 - val;
                }
            }

            if (this.abSourcesConnected && this.gainNodeA && this.gainNodeB && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                this.gainNodeA.gain.setTargetAtTime(gainA, now, 0.015);
                this.gainNodeB.gain.setTargetAtTime(gainB, now, 0.015);
            }

            if (val < 0.42) {
                Mascot.setExpression('ab_a');
            } else if (val > 0.58) {
                Mascot.setExpression('ab_b');
            } else {
                Mascot.setExpression('balance');
            }
        },
};
