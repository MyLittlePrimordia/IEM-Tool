// Split out of eq-core.js (2026 god-file refactor, Step 5).
// Genre-target AutoEQ pickers + live genre match badges:
//   - _genreTargetState + the picker open/close/select handlers that target
//     a genre profile (FindEngine.genreFamilies classification), and
//     applyGenreTargetAutoEQ which solves the faders toward that target.
//   - updateMusicMatch / updateGameMatch + their badge setters, and
//     calculateTargetMatches (the per-draw badge refresh entry point
//     called by the squig graph renderer).
// Fully this-scoped; reads FindEngine + PEQDB_Module at call time; merged
// into EQ_Module via Object.assign in db-cache.js. Names unchanged.
const EQ_GenreTargetMethods = {        _genreTargetState: { music: { open: false, listOpen: false, selectedIdx: -1 }, game: { open: false, listOpen: false, selectedIdx: -1 } },

        toggleGenreTargetPicker: function(side) {
            const st = this._genreTargetState[side];
            st.open = !st.open;
            const panel = document.getElementById(`${side}-genre-target-panel`);
            if (panel) panel.classList.toggle('hidden', !st.open);
            if (st.open) {
                this._renderGenreTargetLabel(side);
            } else {
                st.listOpen = false;
                const list = document.getElementById(`${side}-genre-target-list`);
                if (list) list.classList.add('hidden');
            }
        },

        closeGenreTargetPicker: function(side) {
            const st = this._genreTargetState[side];
            st.open = false;
            st.listOpen = false;
            const panel = document.getElementById(`${side}-genre-target-panel`);
            if (panel) panel.classList.add('hidden');
            const list = document.getElementById(`${side}-genre-target-list`);
            if (list) list.classList.add('hidden');
        },

        toggleGenreTargetList: function(side) {
            const st = this._genreTargetState[side];
            const list = document.getElementById(`${side}-genre-target-list`);
            if (!list) return;
            st.listOpen = !st.listOpen;
            list.classList.toggle('hidden', !st.listOpen);
            if (st.listOpen) this._renderGenreTargetList(side);
        },

        _pickTargetFamilies: function(side) {
            if (typeof FindEngine === 'undefined') return [];
            // Game side uses the independent gaming-tuned profiles, not the
            // deprecated 1:1 music-paired gameVariants table.
            if (side === 'game' && Array.isArray(FindEngine.gameGenreFamilies)) return FindEngine.gameGenreFamilies;
            return Array.isArray(FindEngine.genreFamilies) ? FindEngine.genreFamilies : [];
        },

        _renderGenreTargetList: function(side) {
            const list = document.getElementById(`${side}-genre-target-list`);
            if (!list) return;
            const st = this._genreTargetState[side];
            const families = this._pickTargetFamilies(side);
            list.innerHTML = '';
            families.forEach((fam, i) => {
                const variant = side === 'music' ? (fam.musicVariants && fam.musicVariants[0]) : (fam.gameVariants && fam.gameVariants[0]);
                if (!variant) return;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'genre-target-item' + (st.selectedIdx === i ? ' genre-target-item-active' : '');
                const numSpan = document.createElement('span');
                numSpan.className = 'genre-target-item-num';
                numSpan.textContent = String(i + 1);
                item.appendChild(numSpan);
                item.appendChild(document.createTextNode(`${variant.emoji} ${variant.name}`));
                item.onclick = () => {
                    st.selectedIdx = i;
                    st.listOpen = false;
                    list.classList.add('hidden');
                    this._renderGenreTargetLabel(side);
                };
                list.appendChild(item);
            });
            const count = families.length;
            const countLabel = document.getElementById(`${side}-genre-target-count`);
            if (countLabel) countLabel.textContent = count + ' genres';
        },

        _renderGenreTargetLabel: function(side) {
            const st = this._genreTargetState[side];
            const label = document.getElementById(`${side}-genre-target-label`);
            const hint = document.getElementById(`${side}-genre-target-hint`);
            const families = this._pickTargetFamilies(side);
            const fam = families[st.selectedIdx];
            const variant = fam ? (side === 'music' ? fam.musicVariants[0] : fam.gameVariants[0]) : null;
            if (label) label.textContent = variant ? `${variant.emoji} ${variant.name}` : 'Choose a genre…';
            if (hint) hint.textContent = variant
                ? `Apply AutoEQ to push the active curve toward ${variant.name}'s tonal signature.`
                : 'Pick a genre, then Apply AutoEQ.';
        },

        applyGenreTargetAutoEQ: function(side) {
            const st = this._genreTargetState[side];
            const families = this._pickTargetFamilies(side);
            const fam = families[st.selectedIdx];
            if (!fam) { showToast("Pick a genre first.", "⚠️"); return; }

            const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
            if (!baseCurve) { showToast("Load a curve into Base first.", "⚠️"); return; }

            const variant = side === 'music' ? fam.musicVariants[0] : fam.gameVariants[0];
            // fam.profile is the same [sub, warmth, vocal, treble, air] delta
            // shape getEqBandDeltas() derives from a real 10-band FR (see
            // FindEngine.getEqBandDeltas / nearestGenreFamilyIndex) --
            // expanding it back out to those same band frequencies, plus
            // 20Hz/20kHz endpoints so the curve interpolates cleanly across
            // the full audible range instead of collapsing to 0 past the
            // outermost defined point.
            const [sub, warmth, vocal, treble, air] = fam.profile;
            const data = [
                [20, sub], [31, sub], [62, sub],
                [125, warmth], [250, warmth],
                [1000, vocal],
                [2000, treble], [4000, treble],
                [8000, air], [16000, air], [20000, air]
            ];

            PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'target');
            PEQDB_Module.STATE.activeCurves.push({
                uid: 'target-genre-' + side + '-' + st.selectedIdx,
                id: 'genre-' + side + '-' + st.selectedIdx,
                name: (variant ? variant.name : 'Genre') + ' Target',
                role: 'target',
                color: side === 'music' ? '#2563eb' : '#f59e0b',
                visible: true,
                data: data
            });

            this.closeGenreTargetPicker(side);
            PEQDB_Module.updateAll();
            PEQDB_Module.generateLeastSquaresAutoEQ();
        },

        // (live-state readers + getCompositeFilterMagnitude extracted to
        //  eq-magnitude-engine.js — EQ_MagnitudeEngineMethods, merged via Object.assign in db-cache.js)

        loadValues: function(eqData) {
            if (!eqData) return;

            EQ_Module.isProgrammaticSliderUpdate = true;

            const { preVal, mainVals } = eqData;

            if (preVal !== undefined) {
                const preValEl = document.getElementById("eq-preampVal");
                const preSlider = document.getElementById("eq-preampSlider");
                if (preValEl) preValEl.value = preVal.toFixed(1);
                if (preSlider) preSlider.value = Math.max(-20, Math.min(20, preVal));
                if (this.preampNode) setAudioParamSmooth(this.preampNode.gain, Math.pow(10, preVal / 20));
                this.updatePreamp();
            }

            if (mainVals) {
                mainVals.forEach((v, i) => {
                    if (i < this.bands.length) {
                        const b = this.bands[i];
                        const hz = v.hz !== undefined ? v.hz : b.hz;
                        const g = v.g !== undefined ? v.g : 0.0;
                        const q = v.q !== undefined ? v.q : b.defaultQ;
                        const type = v.type || 'peaking';

                        b.type = type;

                        const fInput = document.getElementById("eq-f" + i);
                        const fsSlider = document.getElementById(`eq-fs_m${i}`);
                        const sSlider = document.getElementById("eq-s" + i);
                        const sNum = document.getElementById(`eq-s${i}_num`);
                        const qSlider = document.getElementById("eq-q_m" + i);
                        const qNum = document.getElementById(`eq-q_m${i}_num`);
                        const typeBtn = document.getElementById(`eq-t_m${i}`);

                        if (fInput) fInput.value = hz;
                        if (fsSlider) fsSlider.value = this.logHzToSlider(hz);
                        if (sSlider) sSlider.value = Math.max(-20, Math.min(20, g));
                        if (sNum) sNum.value = g.toFixed(1);
                        if (qSlider) qSlider.value = Math.max(0.1, Math.min(10, q));
                        if (qNum) qNum.value = q.toFixed(2);

                        if (typeBtn) {
                            const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                            typeBtn.textContent = labelMap[type] || 'PK';
                        }

                        // (native this.filters[i] sync removed — the worklet
                        // owns the filters; updateAudioConnections pushes state)

                                                this.updateSlider(i);
                    }
                });
            }

            if (eqData.advVals) {
                eqData.advVals.forEach((v, i) => {
                    if (i < this.advancedBands.length) {
                        const b = this.advancedBands[i];
                        b.hz = v.hz !== undefined ? v.hz : b.hz;
                        b.g = v.g !== undefined ? v.g : 0.0;
                        b.q = v.q !== undefined ? v.q : b.defaultQ;
                        b.type = v.type || 'peaking';

                        const fInput = document.getElementById("eq-af" + i);
                        const sSlider = document.getElementById("eq-a" + i);
                        const qSlider = document.getElementById("eq-q_a" + i);

                        if (fInput) fInput.value = b.hz;
                        if (sSlider) sSlider.value = Math.max(-20, Math.min(20, b.g));
                        if (qSlider) qSlider.value = Math.max(0.1, Math.min(10, b.q));

                        this.updateSlider(i, 'adv');
                    }
                });
            }
            this.drawCurve();

            EQ_Module.isProgrammaticSliderUpdate = false;

            // An imported/loaded profile reshaped the DSP curve even though it
            // was applied programmatically — unlock Similar-mode matching.
            PEQDB_Module._similarTargetEverModified = true;

            if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                PEQDB_Module.debouncedFindSimilarCurves();
            }
        },
        updateMusicMatch: function() {
            const faders = [];
            for (let i = 0; i < 10; i++) {
                const el = document.getElementById('eq-s' + i);
                faders.push(el ? parseFloat(el.value) : 0.0);
            }

            const totalAbs = faders.reduce((sum, v) => sum + Math.abs(v), 0);
            if (totalAbs < 1.5) {
                this.setMusicMatchUI("🚫", "No Match", "text-zinc-500", "anim-match-breath");
                return;
            }

            const bestMatch = FindEngine.determineLiveMusicGenreMatch(faders, this.activePreset);
            this.setMusicMatchUI(bestMatch.emoji, bestMatch.name, bestMatch.colorClass, bestMatch.animClass);
        },
        setMusicMatchUI: function(emoji, label, colorClass, animClass) {
            // Runs from the graph draw path (~20-60x/s with the spectrum
            // overlay active); skip every DOM write while the badge is unchanged.
            const sig = emoji + '|' + label + '|' + colorClass + '|' + animClass;
            if (this._musicMatchSig === sig) return;
            this._musicMatchSig = sig;
            const emojiContainer = document.getElementById('music-match-emoji-container');
            const textContainer = document.getElementById('music-match-genre-text');

            if (emojiContainer) {
                const fx = (FindEngine.pickFx || {})[label] || '';
                const prevFx = this._musicFxKey;
                this._musicFxKey = fx;
                emojiContainer.innerHTML = `<span class="fx-play ${animClass}" data-fx="${fx}" style="display: inline-block; position: relative; transform-origin: center;"><span class="emoji-font vibrant-emoji leading-none" style="display: inline-block; transform-origin: center;">${emoji}</span></span>`;
                const fxEl = emojiContainer.firstElementChild;
                if (fx && fxEl) {
                    if (fx === prevFx) {
                        fxEl.classList.remove('fx-play');
                    } else {
                        const ms = (parseFloat(getComputedStyle(fxEl).animationDuration) || 0) * 1000 + 80;
                        setTimeout(() => { if (fxEl.isConnected) fxEl.classList.remove('fx-play'); }, ms);
                    }
                }
            }
            if (textContainer) {
                textContainer.textContent = label;
                textContainer.className = `text-[10px] font-black leading-tight ${colorClass} ${animClass}`;
                textContainer.style.display = "inline-block";
                textContainer.style.transformOrigin = "left center";
            }
        },
        setGameMatchUI: function(emoji, label, colorClass, animClass) {
            const sig = emoji + '|' + label + '|' + colorClass + '|' + animClass;
            if (this._gameMatchSig === sig) return;
            this._gameMatchSig = sig;
            const emojiContainer = document.getElementById('game-match-emoji-container');
            const textContainer = document.getElementById('game-match-genre-text');

            if (emojiContainer) {
                const fx = (FindEngine.pickFx || {})[label] || '';
                const prevFx = this._gameFxKey;
                this._gameFxKey = fx;
                emojiContainer.innerHTML = `<span class="fx-play ${animClass}" data-fx="${fx}" style="display: inline-block; position: relative; transform-origin: center;"><span class="emoji-font vibrant-emoji leading-none" style="display: inline-block; transform-origin: center;">${emoji}</span></span>`;
                const fxEl = emojiContainer.firstElementChild;
                if (fx && fxEl) {
                    if (fx === prevFx) {
                        fxEl.classList.remove('fx-play');
                    } else {
                        const ms = (parseFloat(getComputedStyle(fxEl).animationDuration) || 0) * 1000 + 80;
                        setTimeout(() => { if (fxEl.isConnected) fxEl.classList.remove('fx-play'); }, ms);
                    }
                }
            }
            if (textContainer) {
                textContainer.textContent = label;
                textContainer.className = `text-[10px] font-black leading-tight ${colorClass} ${animClass}`;
                textContainer.style.display = "inline-block";
                textContainer.style.transformOrigin = "left center";
            }
        },
        updateGameMatch: function() {
            const faders = [];
            for (let i = 0; i < 10; i++) {
                const el = document.getElementById('eq-s' + i);
                faders.push(el ? parseFloat(el.value) : 0.0);
            }

            const totalAbs = faders.reduce((sum, v) => sum + Math.abs(v), 0);
            if (totalAbs < 1.5) {
                this.setGameMatchUI("🚫", "No Match", "text-zinc-500", "anim-match-breath");
                return;
            }

            const bestMatch = FindEngine.determineLiveGameGenreMatch(faders, this.activePreset);
            this.setGameMatchUI(bestMatch.emoji, bestMatch.name, bestMatch.colorClass, bestMatch.animClass);
        },

        changeGraphMode: function(mode) {
            this.graphMode = mode;

            const optIdx = this.graphModes.findIndex(m => m.id === mode);
            if (optIdx !== -1) {
                this.currentGraphModeIdx = optIdx;
                const btn = document.getElementById('graph-mode-cycle-btn');
                if (btn) btn.textContent = this.graphModes[optIdx].label;
            }

            this.drawCurve();
        },

toggleVizFullscreen: function() {
            const modal = document.getElementById('fullscreen-viz-modal');
            const trackName = document.getElementById('modal-track-name');
            const modalPlayBtn = document.getElementById('modal-play-btn');

            if (!modal) return;

            this.vizModalActive = !this.vizModalActive;

            if (this.vizModalActive) {

                this.ensureDSPGraph();

                modal.classList.remove('hidden');
                modal.classList.add('flex');

                const currentTrackInfo = document.getElementById('playlist-track-info')?.textContent || "No tracks Loaded";
                if (trackName) trackName.textContent = currentTrackInfo;

                if (modalPlayBtn) {
                    modalPlayBtn.innerHTML = this.audioEl.paused ? "<span>▶️</span><span>Play</span>" : "<span>⏸️</span><span>Pause</span>";
                }

                if (!this.vizLoopRunning) {
                    this.startVisualizer();
                }
            } else {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        },

                calculateTargetMatches: function() {

            this.updateMusicMatch();
            this.updateGameMatch();
        },

};
