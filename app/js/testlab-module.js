// Split out of the former monolithic app-core.js (2026 refactor).
// TestLab_Module: ABX / spatial soundstage / resonance / hearing tests.
    const TestLab_Module = {
        activeNodes: [],
        spatialActive: false,
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

            if (total >= 4) {
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
            }

            return {
                pct: Math.max(0, confidence).toFixed(1),
                text: text,
                class: colorClass
            };
        },
        // (dead duplicate `spatialReverb: 'dry'` removed — the live default
        // below is now 'normal', matching both spatialReverbOptions and the
        // static "🎧 Normal" button label in index.html)
        spatialOrbitActive: false,
        spatialOrbitInterval: null,
        spatialOrbitAngle: 0,
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
        },
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
                    if (id === tabId) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            const stepperLabel = document.getElementById('tl-left-tab-stepper-label');
            if (stepperLabel) {
                const info = this.leftTabModes.find(m => m.id === tabId) || this.leftTabModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }
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
                    if (id === tabId) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            const stepperLabel = document.getElementById('tl-right-tab-stepper-label');
            if (stepperLabel) {
                const info = this.rightTabModes.find(m => m.id === tabId) || this.rightTabModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }
        },

        abxStart: async function() {
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (!audioA || !audioB || !audioA.src || !audioB.src) {
                showToast("Please load Source A and Source B tracks first.", "⚠️");
                return;
            }

            this.stopAll();
            this.abxIsActive = true;
            this.abxTrialIndex = 0;
            this.abxCorrect = 0;
            this.abxIncorrect = 0;

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
                startBtn.className = "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/15 font-bold text-[10px] px-2.5 h-7 rounded shadow whitespace-nowrap flex-shrink-0";
                startBtn.onclick = () => this.abxReset();
            }

            document.getElementById('abx-choices-row').style.pointerEvents = 'auto';
            document.getElementById('abx-choices-row').style.opacity = '1.0';

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

            const progress = document.getElementById('abx-progress-lbl');
            if (progress) progress.textContent = `Trial ${this.abxTrialIndex + 1}/${this.abxTotalTrials}`;

            const status = document.getElementById('abx-status-lbl');
            if (status) {
                status.textContent = 'Playing Target X...';
                status.className = "text-[9px] text-[var(--accent-amber)] font-mono animate-pulse";
            }

            await EQ_Module.ensureDSPGraph();
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

            document.getElementById('abx-choices-row').style.pointerEvents = 'none';
            document.getElementById('abx-choices-row').style.opacity = '0.5';

            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn) {
                startBtn.textContent = 'START TEST';
                startBtn.className = "bg-indigo-600/15 border border-indigo-500/40 text-indigo-400 hover:bg-indigo-600/20 font-bold text-[10px] px-2.5 h-7 rounded shadow whitespace-nowrap flex-shrink-0";
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
            if (this._abxTrialTimer) { clearTimeout(this._abxTrialTimer); this._abxTrialTimer = null; }

            const startBtn = document.getElementById('abx-start-btn');
            if (startBtn) {
                startBtn.textContent = 'START TEST';
                startBtn.className = "bg-indigo-600/15 border border-indigo-500/40 text-indigo-400 hover:bg-indigo-600/20 font-bold text-[10px] px-2.5 h-7 rounded shadow whitespace-nowrap flex-shrink-0";
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

            document.getElementById('abx-choices-row').style.pointerEvents = 'none';
            document.getElementById('abx-choices-row').style.opacity = '0.5';

            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA) audioA.pause();
            if (audioB) audioB.pause();
            this.abPlaying = false;
            this.setABXControlsEnabled(true);
            // Same restore as abxEndGame() -- see that call site for why.
            this.updateABFade();
        },

        imbalanceInterval: null,
        isChannelSwapped: false,
        channelToneOsc: null,
        channelToneGain: null,
        channelTonePanner: null,

        spatialType: 'footsteps',
        spatialReverb: 'normal',
        spatialOverallVolume: 0.7,
        spatialMusicVolume: 0.7,
        playbackActive: false,
        soundLibrary: [],
        customAudioBuffer: null,
        spatialSourceOptions: [],
		spatialWidthLevel: 'normal',
        spatialWidthOptions: ['normal', 'wide', 'extra_wide'],
        spatialReverbOptions: ['normal', 'small_room', 'studio_room', 'theater', 'large_venue', 'cathedral', 'infinite_space', 'underwater'],

        reverbPresets: {
            normal: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },
            dry: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },
            reference: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },

            small_room: { preDelay: 8, duration: 0.55, decay: 2.2, damping: 0.45, diffusion: 0.65, wet: 0.12, dry: 1.0, lowpass: 7000, width: 0.7 },

    studio_room: { preDelay: 12, duration: 0.85, decay: 2.0, damping: 0.35, diffusion: 0.8, wet: 0.15, dry: 1.0, lowpass: 9000, width: 0.8 },

    theater: { preDelay: 35, duration: 2.4, decay: 3.0, damping: 0.4, diffusion: 0.85, wet: 0.28, dry: 1.0, lowpass: 8000, width: 1.2 },

    large_venue: { preDelay: 70, duration: 5.0, decay: 4.0, damping: 0.3, diffusion: 0.95, wet: 0.38, dry: 1.0, lowpass: 6000, width: 1.6 },

    cathedral: { preDelay: 90, duration: 8.0, decay: 5.0, damping: 0.65, diffusion: 1.0, wet: 0.45, dry: 1.0, lowpass: 5000, width: 1.8 },

    infinite_space: { preDelay: 120, duration: 10.0, decay: 6.0, damping: 0.8, diffusion: 1.0, wet: 0.5, dry: 1.0, lowpass: 4000, width: 2.0 },

    underwater: { preDelay: 5, duration: 2.5, decay: 3.0, damping: 0.9, diffusion: 0.8, wet: 0.4, dry: 1.0, lowpass: 1200, width: 1.3 }
},

        bufferCache: {},

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
        },
        clearComparisonTracks: function() {
            if (this.abxIsActive) this.abxReset();
            this.stopAll();
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
                this.stopAll();
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
                            // Elements running but the master bus sees silence — auto-reroute to master
                            // instead of requiring user to click "Direct" toast. Keeps old behavior's
                            // logging but makes playback work immediately.
                            try {
                                const dest = SharedAudio.masterGain;
                                this.gainNodeA.disconnect();
                                this.gainNodeB.disconnect();
                                this.gainNodeA.connect(dest);
                                this.gainNodeB.connect(dest);
                                showToast("A/B auto-routed to master (DSP chain bypassed).", "🔌");
                            } catch (e) {
                                console.warn('[A/B] direct reroute failed:', e);
                                showToast("No signal reaching output — check files.", "⚠️");
                            }
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

        _hearingStaircaseMaxLevel: 0.12,   // hard safety ceiling (matches old safeVol cap)
        _hearingStaircaseStartLevel: 0.06, // start audible for most users
        _hearingStaircaseMinLevel: 0.0004,

        startHearingStaircase: async function() {
            const ctx = SharedAudio.init(); await ctx.resume();
            if (this.hearingOsc) { this.stopHearingTone(); }

            // Begin at frequency 0 (250 Hz).
            this.hearingStep = 0;
            this.hearingThresholds = [0, 0, 0, 0, 0, 0, 0, 0];
            this._beginHearingFrequency(0);
        },

        _beginHearingFrequency: function(stepIdx) {
            this.hearingStep = stepIdx;
            // Staircase state: level in linear gain, step in dB, reversal
            // bookkeeping, and the collected reversal levels for averaging.
            this.staircase = {
                level: this._hearingStaircaseStartLevel,
                stepDb: 12,
                lastAnswer: null,
                reversals: [],
                reversalCount: 0,
                lastReversalDir: 0,
                done: false,
                thresholdDb: null
            };
            this._playHearingToneAt(this.staircase.level);

            const btn = document.getElementById('hearing-test-btn');
            if (btn) btn.textContent = 'HEARD (+)';
            const notHeardBtn = document.getElementById('hearing-not-heard-btn');
            if (notHeardBtn) notHeardBtn.classList.remove('hidden');

            const status = document.getElementById('hearing-test-status');
            const hzDisp = document.getElementById('hearing-test-hz');
            const freq = this.hearingTestFreqs[stepIdx];
            if (status) status.textContent = `Staircase ${stepIdx + 1}/8 — listen, then answer.`;
            if (hzDisp) hzDisp.textContent = `${freq} Hz`;
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

            // Level step in dB (down when heard, up when not heard).
            const dbStep = st.stepDb * (dir > 0 ? -1 : 1);
            st.level = Math.max(this._hearingStaircaseMinLevel,
                Math.min(this._hearingStaircaseMaxLevel, st.level * Math.pow(10, dbStep / 20)));

            // Reversal = answer flipped vs the previous one.
            const reversed = (st.lastAnswer !== null && st.lastAnswer !== dir);
            if (reversed) {
                st.reversalCount++;
                st.reversals.push(20 * Math.log10(Math.max(1e-6, st.level)));
                // Halve the step after every reversal: 12 -> 6 -> 3 -> 1.5.
                st.stepDb = Math.max(1.5, st.stepDb / 2);
                // Threshold: two reversals at the finest (1.5dB) step.
                if (st.stepDb <= 1.5 && st.reversals.length >= 2) {
                    // Average the last two reversal levels (the classic
                    // 2-reversal mean at final step size).
                    const lastTwo = st.reversals.slice(-2);
                    st.thresholdDb = (lastTwo[0] + lastTwo[1]) / 2;
                    st.done = true;
                    this._finishHearingFrequency();
                    return;
                }
            }
            st.lastAnswer = dir;

            this._playHearingToneAt(st.level);

            const status = document.getElementById('hearing-test-status');
            if (status) {
                const dbFs = 20 * Math.log10(Math.max(1e-6, st.level));
                status.textContent = `${this.hearingTestFreqs[this.hearingStep]} Hz · ${dbFs.toFixed(1)} dBFS · step ±${st.stepDb}dB · reversals ${st.reversalCount}`;
            }
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

            const btn = document.getElementById('hearing-test-btn');
            if (btn) btn.textContent = 'Start Test';
            const notHeardBtn = document.getElementById('hearing-not-heard-btn');
            if (notHeardBtn) notHeardBtn.classList.add('hidden');

            const status = document.getElementById('hearing-test-status');
            if (status) status.textContent = 'Staircase complete — profile computed.';
            const hzDisp = document.getElementById('hearing-test-hz');
            if (hzDisp) hzDisp.textContent = 'DONE';

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

        playHearingTone: function() {
            // Retained for compatibility with other callers: plays the tone
            // at the current staircase level (or start level outside a test).
            this._playHearingToneAt(this._currentHearingLevel || this._hearingStaircaseStartLevel);

            const status = document.getElementById('hearing-test-status');
            const hzDisp = document.getElementById('hearing-test-hz');
            if (status) status.textContent = `Testing Step ${this.hearingStep + 1} of 8`;
            if (hzDisp) hzDisp.textContent = `${this.hearingTestFreqs[this.hearingStep] || '---'} Hz`;
        },
        updateHearingTestVolume: function() {
            const slider = document.getElementById('hearing-test-vol');
            // During a staircase the test owns the tone level — the slider
            // is only a pre-test comfort calibration and must not override
            // the adaptive step.
            if (slider && this.hearingGain && SharedAudio.ctx && !this.staircase) {
                const vol = parseFloat(slider.value) / 100;
                const safeVol = vol * 0.12;
                setAudioParamSmooth(this.hearingGain.gain, safeVol);

                const el = document.getElementById('brand-icon-emoji');
                if (el) {
                    Mascot.setExpression('hearing_test');
                    const scaleFactor = 0.8 + (vol * 0.7);
                    el.style.transform = `scale(${scaleFactor})`;
                }
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
        resetHearingTest: function() {
            this.stopHearingTone();
            this.hearingStep = -1;
            this.staircase = null;
            this.hearingThresholds = [0, 0, 0, 0, 0, 0, 0, 0];
            EQ_Module.hearingOffsets = [0, 0, 0, 0, 0, 0, 0, 0];
            EQ_Module.hearingCalEnabled = false;

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
            if (status) status.textContent = 'Status: Idle';
            if (hzDisp) hzDisp.textContent = '--- Hz';
            if (volSlider) volSlider.value = 0;
            if (calBtn) calBtn.classList.remove('active-btn');
            if (calLbl) calLbl.textContent = 'Hearing: Off';

            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.classList.add('hidden', 'bg-zinc-800', 'text-zinc-500', 'cursor-not-allowed');
                generateBtn.classList.remove('bg-emerald-500', 'text-white', 'hover:brightness-110', 'cursor-pointer');
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
                generateBtn.classList.remove('hidden', 'bg-zinc-800', 'text-zinc-500', 'cursor-not-allowed');
                generateBtn.classList.add('bg-emerald-500', 'text-white', 'hover:brightness-110', 'cursor-pointer');
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

            EQ_Module.isProgrammaticSliderUpdate = false;
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

        toggleBlindMode: function() {
            const checkbox = document.getElementById('ab-blind-mode');
            const labelA = document.getElementById('label-a');
            const labelB = document.getElementById('label-b');
            const revealBtn = document.getElementById('blind-reveal-btn');

            if (!checkbox) return;
            this.abBlindMode = checkbox.checked;

            if (this.abBlindMode) {
                const rand = Math.random() < 0.5;
                this.abTrackAPhysical = rand ? 'A' : 'B';
                this.abTrackBPhysical = rand ? 'B' : 'A';

                if (labelA) labelA.textContent = 'X';
                if (labelB) labelB.textContent = 'Y';
                if (revealBtn) revealBtn.classList.remove('hidden');
            } else {
                this.abTrackAPhysical = 'A';
                this.abTrackBPhysical = 'B';
                if (labelA) labelA.textContent = 'A';
                if (labelB) labelB.textContent = 'B';
                if (revealBtn) revealBtn.classList.add('hidden');
            }
            this.updateABFade();
        },

        revealBlind: function() {
            if (!this.abBlindMode) return;
            showToast(`Blind Reveal: X is Track ${this.abTrackAPhysical} | Y is Track ${this.abTrackBPhysical}`, "🔍");
        },

        toggleSpatialOrbit: function() {
            this.spatialOrbitActive = !this.spatialOrbitActive;
            const btn = document.getElementById('spatial-orbit-btn');
            if (!btn) return;

            if (this.spatialOrbitActive) {
                btn.className = "bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold rounded text-[10px] h-8 px-3 shadow-sm flex items-center justify-center active-btn";
                btn.textContent = '🔄 Orbit: ON';

                if (this.spatialActive) {
                    this.startSpatialOrbit();
                }
                showToast("Auto-Orbit armed. Resumes on panel hover", "🔄");
            } else {
                btn.className = "bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] text-stone-200 font-bold rounded text-[10px] h-8 px-3 shadow-sm flex items-center justify-center";
                btn.textContent = '🔄 Orbit: Off';
                this.stopSpatialOrbit();
                showToast("Auto-Orbit disabled", "🔄");
            }
        },
        startSpatialOrbit: function() {
            this.stopSpatialOrbitTimerOnly();

            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (!pad || !dot) return;

            this.spatialOrbitInterval = setInterval(() => {
                this.spatialOrbitAngle += 0.018;
                if (this.spatialOrbitAngle > Math.PI * 2) {
                    this.spatialOrbitAngle -= Math.PI * 2;
                }

                const rect = pad.getBoundingClientRect();
                const cw = rect.width;
                const ch = rect.height;

                const cx = cw / 2;
                const cy = ch / 2;
                const radius = Math.min(cw, ch) * 0.35;

                const x = cx + Math.cos(this.spatialOrbitAngle) * radius;
                const y = cy + Math.sin(this.spatialOrbitAngle) * radius;

                dot.style.left = `${x}px`;
                dot.style.top = `${y}px`;

                const normDist = radius / Math.min(cx, cy);
                let normX = normDist * Math.cos(this.spatialOrbitAngle) * 5.0;
                let normZ = normDist * Math.sin(this.spatialOrbitAngle) * 5.0;
                let normY = this.spatialHeightY || 0;

                const totalDist = Math.hypot(normX, normY, normZ);
                if (totalDist < 0.5) {
                    const scaleFactor = 0.5 / (totalDist || 1);
                    normX *= scaleFactor;
                    normY *= scaleFactor;
                    normZ *= scaleFactor;
                }

                if (this.spatialPanner && SharedAudio.ctx) {
                    if (this.spatialPanner.positionX) {
                        setAudioParamSmooth(this.spatialPanner.positionX, normX, 0.05);
                        setAudioParamSmooth(this.spatialPanner.positionZ, normZ, 0.05);
                        setAudioParamSmooth(this.spatialPanner.positionY, normY, 0.05);
                    } else if (this.spatialPanner.setPosition) {
                        this.spatialPanner.setPosition(normX, normY, normZ);
                    }
                }

                const scale = 2.0 - (normDist * 1.4);
                dot.style.transform = `translate(-50%, -50%) scale(${scale})`;
            }, 16);
        },
        stopSpatialOrbitTimerOnly: function() {
            if (this.spatialOrbitInterval) {
                clearInterval(this.spatialOrbitInterval);
                this.spatialOrbitInterval = null;
            }
        },
        stopSpatialOrbit: function() {
            this.stopSpatialOrbitTimerOnly();
            this.spatialOrbitActive = false;
            const btn = document.getElementById('spatial-orbit-btn');
            if (btn) {
                btn.className = "bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] text-stone-200 font-bold rounded text-[10px] h-8 px-3 shadow-sm flex items-center justify-center";
                btn.textContent = '🔄 Orbit: Off';
            }
        },

        spatialDepthZ: -1.5,

        initSpatialPad: function() {
            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (!pad || !dot) return;

            let isDragging = false;

            const updateDotVisualDepth = () => {
                const normalized = (10 - Math.abs(this.spatialDepthZ)) / 10;
                const scale = 0.6 + normalized * 1.4;
                dot.style.transform = `translate(-50%, -50%) scale(${scale})`;
            };

            pad.addEventListener('mouseenter', () => {
                if (this.spatialOrbitActive && this.playbackActive) {
                    this.startSpatialOrbit();
                }
            });

            pad.addEventListener('mouseleave', () => {
                this.stopSpatialOrbitTimerOnly();
            });

            pad.addEventListener('dragover', (e) => {
                e.preventDefault();
                pad.style.borderColor = 'var(--accent-blue)';
            });
            pad.addEventListener('dragleave', () => {
                pad.style.borderColor = '';
            });
            pad.addEventListener('drop', (e) => {
                e.preventDefault();
                pad.style.borderColor = '';
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    this.handleSpatialFile({ target: { files: files } });
                }
            });

            pad.addEventListener('wheel', (e) => {
                e.preventDefault();

                const step = e.deltaY < 0 ? 0.25 : -0.25;
                this.spatialHeightY = Math.max(-5, Math.min(5, (this.spatialHeightY || 0) + step));

                const isUp = this.spatialHeightY > 0.1;
                const isDown = this.spatialHeightY < -0.1;
                const directionLabel = isUp ? "🔺 Above Ear Level" : isDown ? "🔻 Below Ear Level" : "🟢 Ear Level";
                showToast(`Elevation: ${directionLabel} (${this.spatialHeightY.toFixed(1)}m)`, "↕️");

                if (this.spatialPanner && SharedAudio.ctx) {
                    setAudioParamSmooth(this.spatialPanner.positionY, this.spatialHeightY, 0.08);
                }
            }, { passive: false });

            const updatePosition = (e) => {
                const rect = pad.getBoundingClientRect();
                let clientX, clientY;

                if (e.touches && e.touches.length > 0) {
                    const touch = e.touches[0] || e.changedTouches[0];
                    clientX = touch.clientX;
                    clientY = touch.clientY;
                } else {
                    clientX = e.clientX;
                    clientY = e.clientY;
                }

                let x = clientX - rect.left;
                let y = clientY - rect.top;

                x = Math.max(0, Math.min(rect.width, x));
                y = Math.max(0, Math.min(rect.height, y));

                dot.style.left = `${x}px`;
                dot.style.top = `${y}px`;

                const prevX = this.lastPosX !== undefined ? this.lastPosX : x;
                const prevY = this.lastPosY !== undefined ? this.lastPosY : y;
                this.lastPosX = x;
                this.lastPosY = y;

                const dx = x - prevX;
                const dy = y - prevY;

                if (Math.hypot(dx, dy) > 1.0) {
                    const angle = Math.atan2(dy, dx);
                    const deg = angle * (180 / Math.PI);

                    let dir = 'idle';
                    if (deg >= -22.5 && deg < 22.5) dir = 'arrow_right';
                    else if (deg >= 22.5 && deg < 67.5) dir = 'arrow_down_right';
                    else if (deg >= 67.5 && deg < 112.5) dir = 'arrow_down';
                    else if (deg >= 112.5 && deg < 157.5) dir = 'arrow_down_left';
                    else if (deg >= 157.5 || deg < -157.5) dir = 'arrow_left';
                    else if (deg >= -157.5 && deg < -112.5) dir = 'arrow_up_left';
                    else if (deg >= -112.5 && deg < -67.5) dir = 'arrow_up';
                    else if (deg >= -67.5 && deg < -22.5) dir = 'arrow_up_right';

                    if (dir !== 'idle') {
                        Mascot.isOverrideActive = true;
                        Mascot.setExpression(dir);

                        clearTimeout(this.spatialMascotResetTimeout);
                        this.spatialMascotResetTimeout = setTimeout(() => {
                            Mascot.isOverrideActive = false;
                            Mascot.setExpression('idle');
                            Mascot.update();
                        }, 300);
                    }
                }

            const nowTime = Date.now();
            if (this.lastSpatialUpdateTime && (nowTime - this.lastSpatialUpdateTime < 16)) {
                return;
            }
            this.lastSpatialUpdateTime = nowTime;

            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const dist = Math.hypot(x - cx, y - cy);
            const maxDist = Math.min(cx, cy) || 1;
            const normDist = Math.min(1.0, dist / maxDist);
            const angle = Math.atan2(y - cy, x - cx);

            let normX = normDist * Math.cos(angle) * 5.0;
            let normZ = normDist * Math.sin(angle) * 5.0;
            let normY = this.spatialHeightY || 0;

            const totalDist = Math.hypot(normX, normY, normZ);
            if (totalDist < 0.5) {
                const scaleFactor = 0.5 / (totalDist || 1);
                normX *= scaleFactor;
                normY *= scaleFactor;
                normZ *= scaleFactor;
            }

            if (this.spatialPanner && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                if (this.spatialPanner.positionX) {
                    setAudioParamSmooth(this.spatialPanner.positionX, normX, 0.08);
                    setAudioParamSmooth(this.spatialPanner.positionY, normY, 0.08);
                    setAudioParamSmooth(this.spatialPanner.positionZ, normZ, 0.08);
                } else if (this.spatialPanner.setPosition) {
                    this.spatialPanner.setPosition(normX, normY, normZ);
                }
            }

            const scale = 2.0 - (normDist * 1.4);
            dot.style.transform = `translate(-50%, -50%) scale(${scale})`;
            };

            pad.addEventListener('mousemove', (e) => {
                if (!this.spatialOrbitActive) {
                    updatePosition(e);
                }
            });

            pad.addEventListener('mousedown', (e) => {
                isDragging = true;
                updatePosition(e);
            });
            window.addEventListener('mousemove', (e) => {
                if (isDragging && !this.spatialOrbitActive) {
                    updatePosition(e);
                }
            });
            window.addEventListener('mouseup', () => {
                isDragging = false;
            });

            pad.addEventListener('touchstart', (e) => {
                isDragging = true;
                updatePosition(e);
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            window.addEventListener('touchmove', (e) => {
                if (isDragging && !this.spatialOrbitActive) {
                    updatePosition(e);
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });

            window.addEventListener('touchend', () => {
                isDragging = false;
            });

            updateDotVisualDepth();
        },

        updateGlobalBalance: function() {
            clearTimeout(this.balanceUpdateTimeout);
            this.balanceUpdateTimeout = setTimeout(() => {
                const slider = document.getElementById('global-balance');
                if (!slider) return;
                const val = parseFloat(slider.value);
                const disp = document.getElementById('balance-display');
                if (disp) {
                    if (val === 0) disp.textContent = 'Center';
                    else if (val < 0) disp.textContent = `L ${Math.abs(Math.round(val * 100))}%`;
                    else disp.textContent = `R ${Math.round(val * 100)}%`;
                }
                if (SharedAudio.masterPanner) {
                    setAudioParamSmooth(SharedAudio.masterPanner.pan, val);
                }
            }, 10);
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
         this.stopAll(true);

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

    switchCenterView: function(viewId) {
        const spatialPad = document.getElementById('spatial-pad');
        const spatialCtrls = document.getElementById('tl-controls-spatial');
        const burninPad = document.getElementById('burnin-pad');
        const burninCtrls = document.getElementById('tl-controls-burnin');

        const btnSpatial = document.getElementById('tl-btn-spatial');
        const btnBurnin = document.getElementById('tl-btn-burnin');

        this.stopAll();

        if (viewId === 'burnin') {
            if (spatialPad) {
                spatialPad.classList.add('hidden');
                spatialPad.classList.remove('flex-1');
            }
            if (spatialCtrls) {
                spatialCtrls.classList.add('hidden');
                spatialCtrls.classList.remove('flex');
            }
            if (burninPad) {
                burninPad.classList.remove('hidden');
                burninPad.classList.add('flex-1');
                burninPad.classList.add('flex');
            }
            if (burninCtrls) {
                burninCtrls.classList.add('hidden');
            }

            if (btnSpatial) btnSpatial.className = "px-2.5 py-1 rounded text-[10px] font-bold text-[var(--text-secondary)]";
            if (btnBurnin) btnBurnin.className = "px-2.5 py-1 rounded text-[10px] font-bold bg-white/[0.08] text-[var(--text-main)] shadow";

            this.updateBurninDisplay();
            this.updateBurninStatus('idle');
        } else {
            if (burninPad) {
                burninPad.classList.add('hidden');
                burninPad.classList.remove('flex-1');
                burninPad.classList.remove('flex');
            }
            if (burninCtrls) {
                burninCtrls.classList.add('hidden');
            }
            if (spatialPad) {
                spatialPad.classList.remove('hidden');
                spatialPad.classList.add('flex-1');
            }
            if (spatialCtrls) {
                spatialCtrls.classList.remove('hidden');
                spatialCtrls.classList.add('flex');
            }

            if (btnBurnin) btnBurnin.className = "px-2.5 py-1 rounded text-[10px] font-bold text-[var(--text-secondary)]";
            if (btnSpatial) btnSpatial.className = "px-2.5 py-1 rounded text-[10px] font-bold bg-white/[0.08] text-[var(--text-main)] shadow";
        }
    },

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
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5 rounded";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 rounded opacity-50 cursor-not-allowed";
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

            if (this.imbalanceInterval) {
                clearInterval(this.imbalanceInterval);
                this.imbalanceInterval = null;
            }
            const imbalanceL = document.getElementById('imbalance-meter-l');
            const imbalanceR = document.getElementById('imbalance-meter-r');
            if (imbalanceL) imbalanceL.style.width = "0%";
            if (imbalanceR) imbalanceR.style.width = "0%";

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
            const spatialBtn = document.getElementById('spatial-btn');
            if (spatialBtn) {
                spatialBtn.innerHTML = '▶️ Start';
                spatialBtn.classList.remove('text-red-400');
            }
            this.spatialActive = false;
            const abBtn = document.getElementById('ab-play-btn');
            if (abBtn) abBtn.innerHTML = 'Play Sync';
            this.abPlaying = false;
            const audioA = document.getElementById('ab-audio-a');
            const audioB = document.getElementById('ab-audio-b');
            if (audioA) audioA.pause();
            if (audioB) audioB.pause();
        },
                startResonanceScan: function() {

            Mascot.triggerTemporaryExpression('scan_idle', 300000);
            this.stopAll(true);

            const ctx = SharedAudio.init(); ctx.resume();
            this.resonanceActive = true;
            this.resonanceFreq = 8000;

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            const readout = document.getElementById('resonance-lock-hz');
            const needle = document.getElementById('resonance-gauge-needle');

            if (needle) {

                needle.className = "absolute top-0 bottom-0 w-1 bg-sky-400 rounded-full transition-all duration-75";
                needle.style.boxShadow = "0 0 6px #38bdf8";
            }

            if (scanBtn) {
                scanBtn.textContent = 'Scan...';
                scanBtn.className = "w-full bg-sky-500/20 border border-sky-500/50 text-sky-300 font-bold text-[9px] py-1.5 rounded active-btn animate-pulse truncate";
            }
            if (lockBtn) {
                lockBtn.disabled = false;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15 font-bold text-[9px] py-1.5 rounded";
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
                needle.className = "absolute top-0 bottom-0 w-1 bg-emerald-400 rounded-full animate-pulse";
                needle.style.boxShadow = "0 0 10px #10b981";
            }

            Mascot.triggerTemporaryExpression('scan_lock', 2200);

            const scanBtn = document.getElementById('resonance-scan-btn');
            const lockBtn = document.getElementById('resonance-lock-btn');
            const readout = document.getElementById('resonance-lock-hz');

            if (scanBtn) {
                scanBtn.textContent = 'Scan';
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5 rounded";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 rounded opacity-50 cursor-not-allowed";
            }
            if (readout) {
                readout.textContent = `${PEQDB_Module.resonanceHz.toLocaleString()} Hz`;
                readout.className = "text-xs font-mono font-black text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded shadow-[0_0_8px_rgba(16,185,129,0.2)]";
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

                needle.className = "absolute top-0 bottom-0 w-1 bg-sky-400 rounded-full transition-all duration-75";
                needle.style.left = "50%";
                needle.style.boxShadow = "0 0 6px #38bdf8";
            }

            if (scanBtn) {
                scanBtn.textContent = 'Scan';
                scanBtn.className = "w-full bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/15 font-bold text-[9px] py-1.5 rounded";
            }
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.className = "w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-[9px] py-1.5 rounded opacity-50 cursor-not-allowed";
            }
            if (readout) {
                readout.textContent = '8,000 Hz';
                readout.className = "text-xs font-mono font-black text-sky-400 bg-sky-950/30 px-2 py-0.5 rounded border border-sky-900/30";
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
        this.stopAll(true);

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
            this.stopAll(true);
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
            this.stopAll(true);
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
        toggleResonanceTuner: function() {
            if (this.resonanceActive) {

                clearInterval(this.resonanceInterval);
                // The sweep oscillator created below is stored on
                // resonanceOsc/resonanceGain � stopping hearingOsc here left the
                // 6.4-9.6 kHz sweep tone running after toggle-off.
                this.stopResonanceTone();
                this.resonanceActive = false;

                PEQDB_Module.resonanceHz = Math.round(this.resonanceFreq);

                const btn = document.getElementById('btn-resonance-tuner');
                if (btn) {
                    btn.textContent = '🎯 Find Ear Resonance Peak';
                    btn.className = "w-full bg-sky-950/20 border border-zinc-900/40 text-sky-400 font-bold text-xs py-2 rounded transition-all";
                }

                EQ_Module.resonanceCalEnabled = true;
                const calBtn = document.getElementById('btn-resonance-cal');
                const calLbl = document.getElementById('lbl-resonance-cal');
                if (calBtn && calLbl) {
                    calBtn.classList.add('active-btn');
                    calLbl.textContent = 'Res: ON';
                }

                EQ_Module.drawCurve();
                showToast(`Ear canal peak locked at ${PEQDB_Module.resonanceHz} Hz!`, "🎯");
            } else {

                this.stopAll();
                const ctx = SharedAudio.init(); ctx.resume();
                this.resonanceActive = true;
                this.resonanceFreq = 8000;

                const btn = document.getElementById('btn-resonance-tuner');
                if (btn) {
                    btn.className = "w-full bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-sky-400 font-bold text-xs py-2 rounded transition-all active-btn";
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
                    if (btn) {
                        btn.textContent = `🎯 Mark Peak: ${Math.round(this.resonanceFreq)}Hz`;
                    }
                }, 50);
                this.startImbalanceMeter();
            }
        },
    playDetailRetrieval: async function() {
        this.stopAll(true);
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
            this.stopAll(true);
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
            this.stopAll();
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
            this.stopAll(true);
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
            this.stopAll(true);
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
loadSoundLibrary: async function() {

            this.soundLibrary = [
                { "name": "Chords", "emoji": "🎼", "file": "chords.mp3" },
                { "name": "Fan", "emoji": "🌀", "file": "fan.mp3" },
                { "name": "Footsteps", "emoji": "👣", "file": "footsteps.mp3" },
                { "name": "Helicopter", "emoji": "🚁", "file": "helicopter.mp3" },
                { "name": "Hip-Hop", "emoji": "🎧", "file": "hiphop.mp3" },
                { "name": "Piano", "emoji": "🎹", "file": "piano.mp3" },
                { "name": "Pink Noise", "emoji": "🌸", "file": "pink_noise.mp3" },
                { "name": "Rain", "emoji": "🌧️", "file": "rain.mp3" },
                { "name": "Rock", "emoji": "🎸", "file": "rock.mp3" },
                { "name": "Spaceship", "emoji": "🚀", "file": "spaceship.mp3" },
                { "name": "Underwater", "emoji": "🌊", "file": "underwater.mp3" },
                { "name": "Vocals", "emoji": "🎤", "file": "vocals.mp3" },
				{ "name": "TV Static", "emoji": "📺", "file": "tv_static.mp3" },
				{ "name": "Forest", "emoji": "🌳", "file": "forest.mp3" },
            ];

            this.spatialSourceOptions = this.soundLibrary.map(s => s.name.toLowerCase().replace(/[\s-]/g, '_'));
            this.spatialSourceOptions.push('custom');
            this.updateSourceButtonLabel();
        },
        updateSourceButtonLabel: function() {
            const btn = document.getElementById('spatial-source-cycle-btn');
            if (!btn) return;
            if (this.spatialType === 'custom') {
                btn.textContent = "📁 Custom Track";
                return;
            }
            const match = this.soundLibrary.find(s => s.name.toLowerCase().replace(/[\s-]/g, '_') === this.spatialType);
            if (match) {
                btn.textContent = `${match.emoji} ${match.name}`;
            } else {
                btn.textContent = "👣 Footsteps";
            }
        },
        createSpatialBuffer: function(ctx, type) {
            const cacheKey = 'spatial_' + type + '_' + ctx.sampleRate;
            if (this.bufferCache[cacheKey]) {
                return this.bufferCache[cacheKey];
            }

            const duration = 4.0;
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);

            const whiteGen = () => Math.random() * 2 - 1;

            if (type === 'white_noise') {
                for (let i = 0; i < bufferSize; i++) data[i] = whiteGen() * 0.12;
            } else if (type === 'pink_noise') {
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                for (let i = 0; i < bufferSize; i++) {
                    let w = whiteGen();
                    b0 = 0.99886 * b0 + w * 0.0555179;
                    b1 = 0.99332 * b1 + w * 0.0750759;
                    b2 = 0.96900 * b2 + w * 0.1538520;
                    b3 = 0.86650 * b3 + w * 0.3104856;
                    b4 = 0.55000 * b4 + w * 0.5329522;
                    b5 = -0.7616 * b5 - w * 0.0168980;
                    let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
                    b6 = w * 0.115926;
                    data[i] = pink * 0.035;
                }
            } else if (type === 'brown_noise') {
                let accum = 0.0;
                for (let i = 0; i < bufferSize; i++) {
                    let w = whiteGen();
                    accum = (accum + (0.02 * w)) / 1.02;
                    data[i] = accum * 0.45;
                }
            } else if (type === 'footsteps') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.7);
                    if (rhythm < ctx.sampleRate * 0.12) {
                        const env = Math.sin((rhythm / (ctx.sampleRate * 0.12)) * Math.PI);
                        const thud = Math.sin(rhythm * 0.015) * 0.45;
                        const scuff = whiteGen() * 0.22;
                        data[i] = (thud + scuff) * env * 0.45;
                    } else {
                        data[i] = 0;
                    }
                }
            } else if (type === 'clap') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.8);
                    if (rhythm < ctx.sampleRate * 0.15) {
                        const env = Math.exp(-rhythm * 0.00018);
                        const body = Math.sin(rhythm * 0.12) * env * 0.7;
                        const tick = whiteGen() * 0.15 * Math.exp(-rhythm * 0.001);
                        data[i] = (body + tick) * 0.4;
                    } else {
                        data[i] = 0;
                    }
                }
            } else if (type === 'drum') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.6);
                    let sample = 0;
                    if (rhythm < ctx.sampleRate * 0.15) {
                        const envKick = Math.sin((rhythm / (ctx.sampleRate * 0.15)) * Math.PI);
                        sample += Math.sin(rhythm * 0.007) * 0.45 * envKick;
                    }
                    if (rhythm < ctx.sampleRate * 0.02) {
                        const envHat = Math.exp(-rhythm * 0.001);
                        sample += whiteGen() * 0.18 * envHat;
                    }
                    data[i] = sample * 0.4;
                }
            } else if (type === 'vocals' || type === 'chords') {
                const fadeSize = Math.floor(ctx.sampleRate * 0.25);
                for (let i = 0; i < bufferSize; i++) {
                    const t = i / ctx.sampleRate;
                    data[i] = Math.sin(t * Math.PI * 2 * 220) * 0.4 +
                              Math.sin(t * Math.PI * 2 * 330) * 0.3 +
                              Math.sin(t * Math.PI * 2 * 440) * 0.2;
                }
                for (let i = 0; i < fadeSize; i++) {
                    const alpha = i / (fadeSize - 1);
                    const headVal = data[i];
                    const tailVal = data[bufferSize - fadeSize + i];
                    data[i] = tailVal * (1 - alpha) + headVal * alpha;
                }
                for (let i = 0; i < bufferSize; i++) {
                    data[i] *= 0.30;
                }
            } else {
                for (let i = 0; i < bufferSize; i++) {
                    const t = i / ctx.sampleRate;
                    data[i] = Math.sin(t * Math.PI * 2 * 440) * 0.12;
                }
            }

            // Loop-seam crossfade for the noise generators: white/pink/brown are
            // stochastic, so data[0] != data[len-1] and the wrap point produced
            // an audible click every 4-second loop. Equal-power blend of the
            // tail into the head makes the loop seamless.
            if (type === 'white_noise' || type === 'pink_noise' || type === 'brown_noise') {
                const fade = Math.min(Math.floor(ctx.sampleRate * 0.05), bufferSize >> 2);
                if (fade > 1) {
                    for (let i = 0; i < fade; i++) {
                        const alpha = i / fade;
                        const head = data[i];
                        const tail = data[bufferSize - fade + i];
                        const wHead = Math.sin(alpha * Math.PI / 2);
                        const wTail = Math.cos(alpha * Math.PI / 2);
                        data[i] = head * wHead + tail * wTail;
                    }
                }
            }

            this.bufferCache[cacheKey] = buffer;
            return buffer;
        },
        createImpulseResponse: function(ctx, preset) {
            const sampleRate = ctx.sampleRate;
            const duration = preset.duration;
            if (duration <= 0) return null;

            const numSamples = Math.floor(sampleRate * duration);
            const impulseBuffer = ctx.createBuffer(2, numSamples, sampleRate);
            const left = impulseBuffer.getChannelData(0);
            const right = impulseBuffer.getChannelData(1);

            const decay = preset.decay;
            const damping = preset.damping;
            const diffusion = preset.diffusion;
            const width = preset.width;
            const preDelay = preset.preDelay ? preset.preDelay / 1000 : 0;
            const preDelaySamples = Math.floor(preDelay * sampleRate);

            let lpL = 0;
            let lpR = 0;

            for (let i = 0; i < numSamples; i++) {
                if (i < preDelaySamples) {
                    left[i] = 0;
                    right[i] = 0;
                    continue;
                }

                const t = (i - preDelaySamples) / sampleRate;
                const envelope = Math.pow(1 - t / duration, decay);

                let noiseL = Math.random() * 2 - 1;
                let noiseR = Math.random() * 2 - 1;

                if (Math.sin(i * 0.05) > diffusion) {
                    noiseL *= 0.15;
                    noiseR *= 0.15;
                }

                const alpha = 1.0 - Math.min(0.99, damping * 0.95);
                lpL += alpha * (noiseL - lpL);
                lpR += alpha * (noiseR - lpR);

                let valL = lpL * envelope;
                let valR = lpR * envelope;

                const mid = (valL + valR) * 0.5;
                const side = (valL - valR) * 0.5;

                left[i] = mid + side * width;
                right[i] = mid - side * width;
            }
            return impulseBuffer;
        },
        getAudioFileBuffer: async function(ctx, file) {
            const cacheKey = 'sounds_file_' + file;
            if (this.bufferCache[cacheKey]) {
                return this.bufferCache[cacheKey];
            }
            this.isDecoding = true;
            try {
                const res = await fetch(`./app/sounds/${file}`);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = await ctx.decodeAudioData(arrayBuffer);
                this.bufferCache[cacheKey] = buffer;
                this.isDecoding = false;
                return buffer;
            } catch (e) {
                this.isDecoding = false;
                // Surface the failure — a silent fallback here previously
                // sounded like random sine tones with no hint why (packaged
                // builds once shipped without sounds/ entirely). The synthesized
                // backup is cached under its OWN key so a later retry of this
                // file can still succeed once the asset is actually available.
                console.warn(`[Soundstage] Could not load sounds/${file}:`, e.message || e, '— falling back to synthesized buffer.');
                try { if (typeof showToast === 'function') showToast(`Could not load "${file}" — using built-in synth instead.`, "⚠️"); } catch (_) {}
                const type = file.replace('.mp3', '');
                const synthKey = 'spatial_' + type + '_' + ctx.sampleRate;
                let backup = this.bufferCache[synthKey];
                if (!backup) {
                    backup = this.createSpatialBuffer(ctx, type);
                    this.bufferCache[synthKey] = backup;
                }
                return backup;
            }
        },
                startSpatialAudio: async function() {
            if (this.spatialActive || !this.playbackActive) return;

                        const ctx = SharedAudio.init(); ctx.resume();
            this.spatialSourceNode = ctx.createBufferSource();

            let startOffset = 0;
            if (this.spatialType === 'custom') {
                if (!this.customAudioBuffer) {
                    showToast("Please import an audio track first using the folder icon.", "⚠️");
                    this.playbackActive = false;
                    this.updatePlayerButtonsUI();
                    return;
                }
                this.spatialSourceNode.buffer = this.customAudioBuffer;

                startOffset = this.spatialOffset || 0;
            } else {
                const match = this.soundLibrary.find(s => s.name.toLowerCase().replace(/[\s-]/g, '_') === this.spatialType);
                const file = match ? match.file : 'footsteps.mp3';
                this.spatialSourceNode.buffer = await this.getAudioFileBuffer(ctx, file);
            }
            this.spatialSourceNode.loop = true;

            this.customGainNode = ctx.createGain();

            if (this.spatialType === 'custom' || this.spatialType === 'user_imported') {
                this.customGainNode.gain.value = this.spatialMusicVolume;
            } else {
                this.customGainNode.gain.value = 1.0;
            }

            this.spatialGainNode = ctx.createGain();
            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            this.spatialGainNode.gain.value = masterVol;

            this.spatialPanner = ctx.createPanner();

            this.spatialPanner.panningModel = 'equalpower';
            this.spatialPanner.distanceModel = 'linear';

            if (this.spatialPanner.positionX) {
                this.spatialPanner.positionX.automationRate = 'a-rate';
                this.spatialPanner.positionY.automationRate = 'a-rate';
                this.spatialPanner.positionZ.automationRate = 'a-rate';
            }

            const presetName = this.spatialReverb || 'normal';
            const preset = this.reverbPresets[presetName] || this.reverbPresets.normal || { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 };

            this.dryGainNode = ctx.createGain();
            this.dryGainNode.gain.value = preset.dry;

            this.wetGainNode = ctx.createGain();
            this.wetGainNode.gain.value = preset.wet;

            this.reverbFilterNode = ctx.createBiquadFilter();
            this.reverbFilterNode.type = 'lowpass';
            this.reverbFilterNode.frequency.value = preset.lowpass;

            this.spatialSourceNode.connect(this.customGainNode);
            this.customGainNode.connect(this.dryGainNode);
            this.dryGainNode.connect(this.spatialGainNode);
            this.spatialGainNode.connect(this.spatialPanner);

            if (preset.duration > 0) {
                this.reverbNode = ctx.createConvolver();
                this.reverbNode.buffer = this.createImpulseResponse(ctx, preset);

                this.customGainNode.connect(this.reverbNode);
                this.reverbNode.connect(this.reverbFilterNode);
                this.reverbFilterNode.connect(this.wetGainNode);
                this.wetGainNode.connect(this.spatialPanner);
            }

            this.spatialPanner.connect(SharedAudio.masterGain);

            this.spatialSourceNode.start(0, startOffset);
            this.spatialStartTime = ctx.currentTime;
            this.spatialActive = true;

            this.activeNodes.push(this.spatialSourceNode, this.customGainNode, this.spatialGainNode, this.dryGainNode, this.wetGainNode, this.reverbFilterNode, this.spatialPanner);
            if (this.reverbNode) this.activeNodes.push(this.reverbNode);

            if (window.EQ && !EQ.vizLoopRunning) {
                EQ.startVisualizer();
            }

            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (pad && dot) {
                const rect = pad.getBoundingClientRect();
                const x = parseFloat(dot.style.left) || (rect.width / 2);
                const y = parseFloat(dot.style.top) || (rect.height / 2);
                const normX = ((x / rect.width) * 10) - 5;
                const normY = (((rect.height - y) / rect.height) * 10) - 5;
                const now = ctx.currentTime;

                this.spatialPanner.positionX.setValueAtTime(normX, now);
                this.spatialPanner.positionY.setValueAtTime(normY, now);
                this.spatialPanner.positionZ.setValueAtTime(this.spatialDepthZ, now);
            }
            this.updateVolumeSliderVisibility();
            this.startImbalanceMeter();
        },
                stopSpatialAudio: function() {
            if (!this.spatialActive) return;

            if (this.spatialType === 'custom' && this.customAudioBuffer && SharedAudio.ctx) {
                const elapsed = SharedAudio.ctx.currentTime - this.spatialStartTime;
                const duration = this.customAudioBuffer.duration;
                this.spatialOffset = ((this.spatialOffset || 0) + elapsed) % duration;
            }

                const nodesToRemove = [
                    this.spatialSourceNode, this.customGainNode, this.spatialGainNode,
                    this.dryGainNode, this.wetGainNode, this.reverbFilterNode,
                    this.spatialPanner, this.reverbNode
                ];
                this.activeNodes = this.activeNodes.filter(n => !nodesToRemove.includes(n));

                if (this.spatialSourceNode) {
                    try { this.spatialSourceNode.stop(); } catch(e){}
                    this.spatialSourceNode.disconnect();
                    this.spatialSourceNode = null;
                }
                if (this.customGainNode) {
                    try { this.customGainNode.disconnect(); } catch(e){}
                    this.customGainNode = null;
                }
                if (this.spatialGainNode) {
                    try { this.spatialGainNode.disconnect(); } catch(e){}
                    this.spatialGainNode = null;
                }
                if (this.dryGainNode) {
                    try { this.dryGainNode.disconnect(); } catch(e){}
                    this.dryGainNode = null;
                }
                if (this.wetGainNode) {
                    try { this.wetGainNode.disconnect(); } catch(e){}
                    this.wetGainNode = null;
                }
                if (this.reverbFilterNode) {
                    try { this.reverbFilterNode.disconnect(); } catch(e){}
                    this.reverbFilterNode = null;
                }
                if (this.spatialPanner) {
                    try { this.spatialPanner.disconnect(); } catch(e){}
                    this.spatialPanner = null;
                }
                if (this.reverbNode) {
                    try { this.reverbNode.disconnect(); } catch(e){}
                    this.reverbNode = null;
                }

                this.spatialActive = false;
                Mascot.update();
        },
        // NOTE: earlier duplicate definitions of toggleSpatialPlay /
        // updatePlayerButtonsUI / handleSpatialFile were removed here — object
        // literals keep the LAST key, so the copies further below were the live
        // ones and these shadowed versions only invited drift.
        spatialReverbMix: 0.30,
        updateReverbMix: function(val) {
            const num = parseFloat(val);
            this.spatialReverbMix = num / 100;
            const display = document.getElementById('spatial-reverb-mix-display');
            if (display) display.textContent = Math.round(num) + '%';

            if (this.dryGainNode && this.wetGainNode && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                const dryVal = 1 - this.spatialReverbMix;
                const wetVal = this.spatialReverbMix;

                setAudioParamSmooth(this.dryGainNode.gain, dryVal);
                setAudioParamSmooth(this.wetGainNode.gain, wetVal);
            }
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },
        // updateSpatialVolume's real implementation is in the second spatial
        // block below; these noops are the only definitions of their keys.
        updateSpatialOverallVolume: function() {},
        updateSpatialMusicVolume: function() {},
        updateVolumeSliderVisibility: function() {},
        // (duplicate cycleSpatialSource removed — the live definition is in the
        // second spatial block below)
	cycleSpatialWidth: function() {
        const curIdx = this.spatialWidthOptions.indexOf(this.spatialWidthLevel);
        const nextIdx = (curIdx + 1) % this.spatialWidthOptions.length;
        this.spatialWidthLevel = this.spatialWidthOptions[nextIdx];

        const btn = document.getElementById('spatial-width-cycle-btn');
        const slider = document.getElementById('stereo-expand-level');

        let val = 0;
        if (btn) {
            if (this.spatialWidthLevel === 'normal') {
                btn.textContent = "↔️ Normal";
                val = 0;
            } else if (this.spatialWidthLevel === 'wide') {
                btn.textContent = "↔️ Wide";
                val = 50;
            } else {
                btn.textContent = "↔️ Extra Wide";
                val = 100;
            }
        }

        if (slider) {
            slider.value = val;
        }
        if (window.EQ && EQ.updateStereoExpand) {
            EQ.updateStereoExpand(val);
        }
    },
        // (duplicate cycleSpatialReverb removed — the live definition is in the
        // second spatial block below)

        updateReverbDSPOnTheFly: function() {
            if (!this.spatialActive || !SharedAudio.ctx) return;

            const ctx = SharedAudio.ctx;
            const presetName = this.spatialReverb;
            const preset = this.reverbPresets[presetName] || this.reverbPresets.reference;
            const now = ctx.currentTime;

            if (this.dryGainNode) {
                this.dryGainNode.gain.setTargetAtTime(preset.dry, now, 0.015);
            }
            if (this.wetGainNode) {
                this.wetGainNode.gain.setTargetAtTime(preset.wet, now, 0.015);
            }
            if (this.reverbFilterNode) {
                this.reverbFilterNode.frequency.setTargetAtTime(preset.lowpass, now, 0.015);
            }

            if (this.reverbNode) {
                try {
                    this.customGainNode.disconnect(this.reverbNode);
                } catch(e){}
                try {
                    this.reverbNode.disconnect();
                } catch(e){}
                this.reverbNode = null;
            }

            if (preset.duration > 0) {
                this.reverbNode = ctx.createConvolver();
                this.reverbNode.buffer = this.createImpulseResponse(ctx, preset);

                this.customGainNode.connect(this.reverbNode);
                this.reverbNode.connect(this.reverbFilterNode);
                this.reverbFilterNode.connect(this.wetGainNode);
            }
        },
        toggleSpatialPlay: function(playState) {
            // Ignore presses while a custom track is still decoding — without
            // this, double-pressing during decode started two BufferSources
            // (startSpatialAudio's spatialActive guard can't see a source that
            // hasn't been created yet).
            if (this.isDecoding) {
                showToast("Decoding track, please wait...", "⏳");
                return;
            }
            this.playbackActive = playState;
            this.updatePlayerButtonsUI();
            if (this.playbackActive) {

                if (window.EQ && EQ.audioEl && !EQ.audioEl.paused) {
                    EQ.togglePlayState();
                }
                this.startSpatialAudio();
                if (this.spatialOrbitActive) {
                    this.startSpatialOrbit();
                }
            } else {
                this.stopSpatialAudio();
                this.stopSpatialOrbitTimerOnly();

                Mascot.isOverrideActive = false;
                if (Mascot.currentExpression === 'vibing') {
                    Mascot.currentIntensity = 0;
                    Mascot.setExpression('idle');
                }
                Mascot.update();
            }
        },
        updatePlayerButtonsUI: function() {
            const playBtn = document.getElementById('spatial-play-btn');
            const pauseBtn = document.getElementById('spatial-pause-btn');
            if (playBtn && pauseBtn) {
                if (this.playbackActive) {
                    playBtn.classList.add('hidden');
                    pauseBtn.classList.remove('hidden');
                } else {
                    pauseBtn.classList.add('hidden');
                    playBtn.classList.remove('hidden');
                }
            }
        },
        handleSpatialFile: function(e) {
            const file = e.target.files[0] || (e.target.files && e.target.files[0]);
            if (!file) return;

            const ctx = SharedAudio.init();
            showToast("Decoding custom test track...", "⏳");
            this.isDecoding = true;

            const reader = new FileReader();
            reader.onload = (ev) => {
                ctx.decodeAudioData(ev.target.result, (buffer) => {
                    this.stopSpatialAudio();
                    this.customAudioBuffer = buffer;
                    this.spatialType = 'custom';
                    this.spatialOffset = 0;

                    const btn = document.getElementById('spatial-source-cycle-btn');
                    if (btn) btn.textContent = "📁 Custom Track";

                    this.isDecoding = false;
                    this.updateVolumeSliderVisibility();
                    this.toggleSpatialPlay(true);
                    showToast(`Loaded "${file.name}" into 3D Soundstage!`, "📁");
                }, (err) => {
                    this.isDecoding = false;
                    showToast("Failed to decode audio file.", "⚠️");
                });
            };
            reader.readAsArrayBuffer(file);
        },
        updateSpatialVolume: function() {
            const slider = document.getElementById('spatial-volume');
            if (!slider) return;
            const val = parseFloat(slider.value) / 100;
            this.spatialVolume = val;

            const display = document.getElementById('spatial-vol-display');
            if (display) display.textContent = Math.round(val * 100) + '%';

            const icon = document.getElementById('spatial-vol-icon');
            if (icon) icon.textContent = val === 0 ? '🔇' : '🔊';

            if (this.customGainNode && (this.spatialType === 'custom' || this.spatialType === 'user_imported') && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                this.customGainNode.gain.setTargetAtTime(val, now, 0.005);
            }
        },
        cycleSpatialSource: function() {

            const wasPlaying = this.spatialActive;
            if (wasPlaying) {
                this.stopSpatialAudio();
            }

            let nextIdx = (this.spatialSourceOptions.indexOf(this.spatialType) + 1) % this.spatialSourceOptions.length;
            let nextType = this.spatialSourceOptions[nextIdx];

            if (nextType === 'custom' && !this.customAudioBuffer) {
                nextIdx = (nextIdx + 1) % this.spatialSourceOptions.length;
                nextType = this.spatialSourceOptions[nextIdx];
            }

                        this.spatialType = nextType;
            this.updateSourceButtonLabel();

            this.updateVolumeSliderVisibility();

            if (wasPlaying && this.playbackActive) {
                this.startSpatialAudio();
            }
        },
        cycleSpatialReverb: function() {
            const curIdx = this.spatialReverbOptions.indexOf(this.spatialReverb);
            const nextIdx = (curIdx + 1) % this.spatialReverbOptions.length;
            this.spatialReverb = this.spatialReverbOptions[nextIdx];

            const btn = document.getElementById('spatial-reverb-cycle-btn');
            if (btn) {
                const emojis = {
                    normal: "🎧", small_room: "🏠", studio_room: "🎙️", theater: "🎬",
                    large_venue: "🏟️", cathedral: "⛪", infinite_space: "🌌", underwater: "🌊"
                };
                const titles = {
                    normal: "Normal", small_room: "Small Room", studio_room: "Studio Room", theater: "Theater",
                    large_venue: "Large Venue", cathedral: "Cathedral", infinite_space: "Infinite Space", underwater: "Underwater"
                };

                const emoji = emojis[this.spatialReverb] || "🌌";
                const title = titles[this.spatialReverb] || this.spatialReverb;
                btn.textContent = `${emoji} ${title}`;
            }
            if (this.spatialActive) {
                this.stopSpatialAudio();
                this.startSpatialAudio();
            }
        },
        heightModeActive: false,
        toggleHeightMode: function() {
            this.heightModeActive = !this.heightModeActive;
            const btn = document.getElementById('spatial-height-btn');
            if (btn) {
                if (this.heightModeActive) {
                    btn.textContent = "↕️ Height: ON";
                    btn.className = "bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold rounded text-[10px] h-7 px-2.5 shadow-sm active-btn";
                    showToast("3D Elevation engaged! Vertical movement now adjusts Height (Y-axis).", "↕️");
                } else {
                    btn.textContent = "↕️ Height: OFF";
                    btn.className = "bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] text-stone-200 font-bold rounded text-[10px] h-7 px-2.5 shadow-sm";
                    showToast("Returned to standard 2D flat plane.", "🧭");
                }
            }
            if (this.spatialActive) {
                this.stopSpatialAudio();
                this.startSpatialAudio();
            }
        },
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
            this.stopAll(true);
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

        (function() {
            let tooltipEl = null;

            function getTooltip() {
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'global-floating-tooltip';
                    tooltipEl.style.cssText = `
                        position: fixed;
                        z-index: 999999;
                        pointer-events: none;
                        display: none;
                        background: #000000;
                        color: #ffffff;
                        font-size: 9.5px;
                        font-weight: 800;
                        white-space: nowrap;
                        padding: 3px 8px;
                        border: 2px solid var(--accent-blue);
                        box-shadow: 2px 2px 0px #000000;
                        opacity: 0;
                        transition: opacity 0.1s ease-out;
                    `;
                    document.body.appendChild(tooltipEl);
                }
                return tooltipEl;
            }

            document.addEventListener('mouseover', (e) => {
                const target = e.target.closest('[data-tooltip], [title]');
                if (!target) return;
                if (target.hasAttribute('title')) {
                    target.setAttribute('data-tooltip', target.getAttribute('title'));
                    target.removeAttribute('title');
                }
                const text = target.getAttribute('data-tooltip');
                if (!text || !text.trim()) return;

                const tt = getTooltip();
                tt.textContent = text;
                tt.style.display = 'block';

                const rect = target.getBoundingClientRect();
                const ttW = tt.offsetWidth;
                const ttH = tt.offsetHeight;

                let left = rect.left + (rect.width / 2) - (ttW / 2);
                let top = rect.top - ttH - 6;

                if (left < 8) left = 8;
                if (left + ttW > window.innerWidth - 8) {
                    left = window.innerWidth - ttW - 8;
                }
                if (top < 8) {
                    top = rect.bottom + 6;
                }

                tt.style.left = `${left}px`;
                tt.style.top = `${top}px`;
                tt.style.opacity = '1';
            });

            document.addEventListener('mouseout', (e) => {
                const target = e.target.closest('[data-tooltip]');
                if (target && tooltipEl) {
                    tooltipEl.style.opacity = '0';
                    tooltipEl.style.display = 'none';
                }
            });

            window.addEventListener('scroll', () => {
                if (tooltipEl) {
                    tooltipEl.style.opacity = '0';
                    tooltipEl.style.display = 'none';
                }
            }, true);
            document.addEventListener('click', () => {
                if (tooltipEl) {
                    tooltipEl.style.opacity = '0';
                    tooltipEl.style.display = 'none';
                }
            }, true);
            window.hideGlobalTooltip = () => {
                if (tooltipEl) {
                    tooltipEl.style.opacity = '0';
                    tooltipEl.style.display = 'none';
                }
            };
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

        for (const [name, mod] of bootModules) {
            try {
                await mod.init();
            } catch (err) {
                console.error(`[Boot] ${name}.init() failed — continuing with remaining modules.`, err);
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

