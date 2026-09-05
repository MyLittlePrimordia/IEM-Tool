// Split out of eq-core.js (2026 god-file refactor, Step 4).
// Magnitude engine: the composite filter magnitude cache that the graph
// renderer, the Similar-mode matcher, and the exporters all read, plus the
// live-band-state readers (getLiveFiltersState / getLiveAdvancedFiltersState
// / getRealValues) every consumer uses to snapshot the current EQ.
// Fully this-scoped (cache buffers + the one-shot document input listener
// guarded by _magLiveTrackSetup live on EQ_Module); merged into EQ_Module
// via Object.assign in db-cache.js. All method names unchanged.
const EQ_MagnitudeEngineMethods = {
                getLiveAdvancedFiltersState: function() {
if (window.bypassedBands === undefined) window.bypassedBands = new Set();
const adv = this.advancedBands.map((b, i) => {
                    const fEl = document.getElementById("eq-af" + i);
                    const sEl = document.getElementById("eq-a" + i);
                    const qEl = document.getElementById("eq-q_a" + i);
                    const isBypassed = window.bypassedBands.has("a" + i);

                    const rawHz = fEl ? parseFloat(fEl.value) : b.hz;
                    const hzVal = Number.isFinite(rawHz) ? rawHz : b.hz;
                    let gVal = 0;
                    if (sEl) {
                        const rawG = isBypassed ? 0 : parseFloat(sEl.value);
                        gVal = Number.isFinite(rawG) ? rawG : 0;
                    } else {
                        gVal = isBypassed ? 0 : (b.g !== undefined ? b.g : 0.0);
                    }
                    const rawQ = qEl ? parseFloat(qEl.value) : (b.q !== undefined ? b.q : b.defaultQ);
                    const qVal = Number.isFinite(rawQ) ? rawQ : (b.q !== undefined ? b.q : b.defaultQ);

                    return {
                        hz: hzVal,
                        g: gVal,
                        q: qVal,
                        type: b.type || 'peaking',
                        slope: b.slope || 12
                    };
                });
return adv;
},
getLiveFiltersState: function() {
            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const main = this.bands.map((b, i) => {
                const fEl = document.getElementById("eq-f" + i);
                const sEl = document.getElementById("eq-s" + i);
                const qEl = document.getElementById("eq-q_m" + i);
                const isBypassed = window.bypassedBands.has("m" + i);
                const rawHz = fEl ? parseFloat(fEl.value) : b.hz;
                const rawG = (isBypassed || !sEl) ? 0 : parseFloat(sEl.value);
                const rawQ = qEl ? parseFloat(qEl.value) : b.defaultQ;
                return {
                    hz: Number.isFinite(rawHz) ? rawHz : b.hz,
                    g: Number.isFinite(rawG) ? rawG : 0,
                    q: Number.isFinite(rawQ) ? rawQ : b.defaultQ,
                    type: b.type || 'peaking',
                    slope: b.slope || 12
                };
            });
            return { main };
        },
                getRealValues: function() {
            const preValEl = document.getElementById("eq-preampVal");
            const preVal = preValEl ? parseFloat(preValEl.value) : 0;
            const { main } = this.getLiveFiltersState();
            const adv = this.getLiveAdvancedFiltersState();
            return { preVal, mainVals: main, advVals: adv };
        },

        getCompositeFilterMagnitude: function(freqs, numPoints) {
            if (!this.cachedFilterMag || this.cachedFilterMag.length !== numPoints) {
                this.cachedFilterMag = new Float32Array(numPoints);
            }
            const filterMag = this.cachedFilterMag;

            // Read all mutable state ONCE; the recompute body below reuses these
            // same locals. The graph redraws on every EQ change AND also ~20-60x/s
            // during playback, and before caching this re-evaluated ~20-30 biquad
            // filters over 1000 points on every call even when nothing changed.
            // We only re-run the expensive work when this signature actually differs.
            // Incremental dirty-flag. The graph is re-pulled ~20-60x/s during playback
            // even when the user changes nothing. Rather than re-reading ~20 DOM
            // slider inputs and building a large signature JSON on every call, we
            // bump a cheap counter when any live band/advanced slider fires an
            // `input` event, and compare a small snapshot of the switch-style
            // settings (bypass, de-esser, loudness, crossover, source-sim, tape,
            // virtual bands, sim tip). If nothing changed we return the cached
            // magnitude directly, skipping both the DOM reads and the signature work.
            if (!this._magLiveTrackSetup) {
                this._magLiveTrackSetup = true;
                this._magFiltersVersion = 0;
                const self = this;
                document.addEventListener('input', (e) => {
                    const el = e.target;
                    if (el && el.id && /^(?:eq-q_a|eq-q_m|eq-af|eq-f|eq-s|eq-a)/.test(el.id)) self._magFiltersVersion++;
                }, true);
            }
            const rawSimStrength = parseFloat(document.getElementById('sim-tip-strength')?.value);
            const simStrength = Number.isFinite(rawSimStrength) ? rawSimStrength / 100 : 1.0;
            const rawLoudVol = parseFloat(document.getElementById("eq-musicVolumeSlider")?.value);
            const loudnessVol = Number.isFinite(rawLoudVol) ? rawLoudVol : 50;
            // The de-esser notch FOLLOWS the detected sibilance peak in the audio
            // path (updateSimulations index 5 receives deEsserCurrentFreq), so the
            // drawn curve must use the same tracked value — deEsserFilter is a
            // static {frequency:{value:6000}} placeholder that never changes, and
            // keying the cache off it froze both the notch position and the cache.
            const deEsserFreq = Number.isFinite(this.deEsserCurrentFreq)
                ? this.deEsserCurrentFreq
                : ((this.deEsserFilter && this.deEsserFilter.frequency) ? this.deEsserFilter.frequency.value : 6000);
            const bypassSize = window.bypassedBands ? window.bypassedBands.size : -1;
            const rawMasterBass = parseFloat(document.getElementById("eq-masterBass")?.value);
            const rawMasterTreb = parseFloat(document.getElementById("eq-masterTreble")?.value);
            const masterBassVal = Number.isFinite(rawMasterBass) ? rawMasterBass : 0;
            const masterTrebVal = Number.isFinite(rawMasterTreb) ? rawMasterTreb : 0;
            const hearingCalStr = (this.hearingCalEnabled && this.hearingOffsets) ? this.hearingOffsets.join(',') : 'off';
            const gearIdx = (this.currentGearIdx !== undefined) ? this.currentGearIdx : 0;
            // The magnitude cache is keyed by content, but callers pass
            // DIFFERENT frequency grids (the graph's 1000-pt view grid vs the
            // Similar scan's fixed 500-pt DSP grid, and the view grid is
            // regenerated on every pan/zoom while keeping the same length).
            // Including the grid's endpoints (and the caller's view range)
            // in the key prevents a cached 20Hz-20kHz sweep from being served
            // to a zoomed 200Hz-8kHz view — the drawn curve previously froze
            // on the pre-zoom shape until the next slider change.
            const gridKey = (numPoints > 0 && freqs && freqs.length >= numPoints)
                ? (Math.round(freqs[0] * 100) + '-' + Math.round(freqs[numPoints - 1] * 100)) : 'x';
            const viewRange = (window.PEQDB_Module && PEQDB_Module.viewMinF !== undefined)
                ? (PEQDB_Module.viewMinF + '-' + PEQDB_Module.viewMaxF) : 'x';

            const cheapKey = [simStrength, loudnessVol, Number.isFinite(deEsserFreq) ? +deEsserFreq.toFixed(2) : 0,
                this.deEsserEnabled ? 1 : 0, this.deEsserReductionDb || 0,
                this.loudnessActive ? 1 : 0, this.loudnessCalibrationVol, this.loudnessStrength,
                this.crossoverActive ? 1 : 0, this.crossoverType,
                this.crossoverLowTrim, this.crossoverLowMidTrim, this.crossoverMidTrim,
                this.crossoverHighMidTrim, this.crossoverHighTrim,
                this.crossoverFreq1, this.crossoverFreq2, this.crossoverFreq3, this.crossoverFreq4,
                this.sourceSimLowG, this.sourceSimLowF, this.sourceSimHighG, this.sourceSimHighF,
                this.simState.tip, this.simState.depth, this.simState.seal,
                this.tapeModState ? JSON.stringify(this.tapeModState) : 'n',
                masterBassVal, masterTrebVal, hearingCalStr, gearIdx,
                this.virtualBands ? this.virtualBands.length : -1,
                this.eqEnabled ? 1 : 0, gridKey, viewRange].join('|');

            if (this._magCacheNumPoints === numPoints
                && this._magCacheVersion === this._magFiltersVersion
                && this._magCacheBypass === bypassSize
                && this._magCacheCheap === cheapKey) {
                return filterMag;
            }

            this._magCacheVersion = this._magFiltersVersion;
            this._magCacheBypass = bypassSize;
            this._magCacheCheap = cheapKey;
            this._magCacheNumPoints = numPoints;

            const { main: mainState } = this.getLiveFiltersState();
            const advState = this.getLiveAdvancedFiltersState();

            filterMag.fill(1.0);

            // When the EQ is toggled OFF (bypass), the worklet skips the main,
            // advanced and virtual band banks (updateAudioConnections ORs
            // !eqEnabled into every band's bypassed flag) while sims stay
            // audible — mirror exactly that here so the drawn curve matches.
            const includeBands = this.eqEnabled !== false;

            if (includeBands) this.bands.forEach((b, i) => {
                const state = mainState[i];
                const activeType = state.type || 'peaking';
                const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(activeType);
                const rawG = hasNoGain ? 0.0 : state.g;

                // Slope only means anything for Shelf/HP/LP; a stale value
                // left over from a previous type must not cascade multiple
                // full-gain copies of a Peaking/Notch section (matches the
                // same guard in updateAudioConnections()).
                const slopeCapableForCascade = (activeType === 'lowshelf' || activeType === 'highshelf' || activeType === 'lowpass' || activeType === 'highpass');
                const activeSlope = slopeCapableForCascade ? (b.slope || 12) : 12;
                const cascadeNodesCount = Math.max(1, Math.round(activeSlope / 12));

                // Native BiquadFilterNode ignores Q for lowshelf/highshelf
                // (fixed slope S=1), while the worklet (dsp-processor.js) and
                // getBiquadMagnitude implement RBJ Q-aware shelf alpha. Evaluate
                // shelves through getBiquadMagnitude with the DSP's [0.3, 3.0]
                // shelfQ clamp so the drawn curve matches what is audible and
                // exported for every shelf Q the UI allows.
                if (activeType === 'lowshelf' || activeType === 'highshelf') {
                    const nodeGain = rawG / cascadeNodesCount;
                    const shelfQ = Math.max(0.3, Math.min(3.0, Number.isFinite(state.q) ? state.q : 1.0));
                    for (let j = 0; j < numPoints; j++) {
                        let m = 1.0;
                        for (let k = 0; k < cascadeNodesCount; k++) {
                            m *= this.getBiquadMagnitude(activeType, freqs[j], state.hz, shelfQ, nodeGain);
                        }
                        filterMag[j] *= m;
                    }
                    return;
                }

                // Evaluate every section through getBiquadMagnitude — the
                // exact RBJ math the worklet runs (same coefficient formulas,
                // same freq/Q clamps). The previous native-BiquadFilterNode
                // path (getFrequencyResponse via 70 offline "mathFilters")
                // kept a whole OfflineAudioContext alive just for drawing,
                // and its native shelf implementations disagreed with the
                // DSP (fixed S=1 slope, Q ignored).
                for (let k = 0; k < cascadeNodesCount; k++) {
                    for (let j = 0; j < numPoints; j++) {
                        filterMag[j] *= this.getBiquadMagnitude(activeType, freqs[j], state.hz, state.q, rawG);
                    }
                }
            });

            if (includeBands) this.advancedBands.forEach((b, i) => {
                const state = advState[i];
                const advType = state.type || 'peaking';

                // Same shelf-Q parity as the main bands above (custom presets
                // can restore LS/HS types on advanced bands).
                if (advType === 'lowshelf' || advType === 'highshelf') {
                    const advShelfQ = Math.max(0.3, Math.min(3.0, Number.isFinite(state.q) ? state.q : 1.0));
                    for (let j = 0; j < numPoints; j++) {
                        filterMag[j] *= this.getBiquadMagnitude(advType, freqs[j], state.hz, advShelfQ, state.g);
                    }
                    return;
                }

                // Same getBiquadMagnitude parity as the main bands above:
                // native nodes are gone, everything evaluates through the
                // worklet's exact RBJ math.
                for (let j = 0; j < numPoints; j++) {
                    filterMag[j] *= this.getBiquadMagnitude(advType, freqs[j], state.hz, state.q, state.g);
                }
            });

            if (includeBands && this.virtualBands) {
                this.virtualBands.forEach((b) => {
                    for (let j = 0; j < numPoints; j++) {
                        filterMag[j] *= this.getBiquadMagnitude(b.type || 'peaking', freqs[j], b.hz, b.q, b.g);
                    }
                });
            }

            if (this.sourceSimLowG !== undefined && this.sourceSimHighG !== undefined) {
                const simLowF = this.sourceSimLowF || 10;
                const simLowG = this.sourceSimLowG || 0;
                const simHighF = this.sourceSimHighF || 22000;
                const simHighG = this.sourceSimHighG || 0;

                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (simLowG !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, simLowF, 0.7, simLowG);
                    if (simHighG !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, simHighF, 0.7, simHighG);
                }
            }

            if (this.deEsserEnabled && this.deEsserReductionDb !== 0 && this.deEsserFilter) {
                const activeFreq = deEsserFreq;
                for (let j = 0; j < numPoints; j++) {
                    filterMag[j] *= this.getBiquadMagnitude('peaking', freqs[j], activeFreq, 2.5, this.deEsserReductionDb);
                }
            }

            const tip = this.simState.tip;
            const depth = this.simState.depth;
            const seal = this.simState.seal;
            const strength = simStrength;

            for (let j = 0; j < numPoints; j++) {
                const f = freqs[j];
                let simVal = 1.0;

                if (tip === 'foam') {
                    simVal *= this.getBiquadMagnitude('highshelf', f, 6000, 0.7, -3.0 * strength);
                } else if (tip === 'narrow') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 200, 0.7, 2.0 * strength);
                    simVal *= this.getBiquadMagnitude('highshelf', f, 4000, 0.7, -2.5 * strength);
                } else if (tip === 'wide') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -1.5 * strength);
                    simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, 1.5 * strength);
                } else if (tip === 'double') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 7000, 2.5, -4.0 * strength);
                } else if (tip === 'triple') {
                    simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, -3.5 * strength);
                    simVal *= this.getBiquadMagnitude('peaking', f, 8000, 1.5, -2.0 * strength);
                }

                if (depth === 'shallow') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 6000, 2.0, 3.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 8500, 2.0, -4.0);
                } else if (depth === 'deep') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 8000, 2.0, -4.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 11500, 1.5, 4.0);
                }

                if (seal === 'good') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 80, 0.7, -2.5);
                } else if (seal === 'loose') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 150, 0.7, -9.0);
                } else if (seal === 'broken') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -18.0);
                }

                const tapeMode = this.tapeModState;
                if (tapeMode === 'front') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 120, 0.7, 6.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 35, 1.2, 2.5);
                } else if (tapeMode === 'rear') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, 3.5);
                    simVal *= this.getBiquadMagnitude('peaking', f, 150, 1.0, 2.0);
                } else if (tapeMode === 'full') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 180, 0.8, 8.5);
                    simVal *= this.getBiquadMagnitude('peaking', f, 30, 1.5, 4.0);
                }

                filterMag[j] *= simVal;
            }

            if (this.gearSimOptions && this.gearSimOptions[gearIdx]) {
                const gear = this.gearSimOptions[gearIdx];
                if (gear.lowG !== 0 || gear.highG !== 0) {
                    for (let j = 0; j < numPoints; j++) {
                        const f = freqs[j];
                        if (gear.lowG !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, gear.lowF, 0.7, gear.lowG);
                        if (gear.highG !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, gear.highF, 0.7, gear.highG);
                    }
                }
            }

            if (masterBassVal !== 0 || masterTrebVal !== 0) {
                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (masterBassVal !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 105, 0.7, masterBassVal);
                    if (masterTrebVal !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 8000, 0.7, masterTrebVal);
                }
            }

            if (this.hearingCalEnabled && this.hearingOffsets && this.hearingCalibrationFrequencies) {
                const hFreqs = this.hearingCalibrationFrequencies;
                for (let k = 0; k < hFreqs.length; k++) {
                    const hGain = this.hearingOffsets[k] || 0;
                    if (hGain !== 0) {
                        const hf = hFreqs[k];
                        for (let j = 0; j < numPoints; j++) {
                            // Q must match the worklet sim (eq-hearing-cal.js q:1.0)
                            // and the exports (Q 1.00) or the drawn curve would be
                            // narrower than what the user actually hears.
                            filterMag[j] *= this.getBiquadMagnitude('peaking', freqs[j], hf, 1.0, hGain);
                        }
                    }
                }
            }

            if (this.loudnessActive) {
                const currentVol = loudnessVol;
                const volumeDiff = Math.max(0, this.loudnessCalibrationVol - currentVol);
                const norm = volumeDiff / 100;
                const bassBoost = 14.0 * Math.pow(norm, 0.6) * (this.loudnessStrength / 100);
                const trebleBoost = 8.0 * Math.pow(norm, 0.65) * (this.loudnessStrength / 100);

                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (bassBoost !== 0) {
                        filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 100, 0.7, bassBoost);
                    }
                    if (trebleBoost !== 0) {
                        filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 7500, 0.7, trebleBoost);
                    }
                }
            }

            if (this.crossoverActive) {
                const type = this.crossoverType;
                const trimToLin = (v) => Number.isFinite(v) ? Math.pow(10, v / 20) : 1.0;
                const lLin = trimToLin(this.crossoverLowTrim);
                const lmLin = trimToLin(this.crossoverLowMidTrim);
                const mLin = trimToLin(this.crossoverMidTrim);
                const hmLin = trimToLin(this.crossoverHighMidTrim);
                const hLin = trimToLin(this.crossoverHighTrim);

                // Phasor sum to match DSP time-domain summation: each LR4 side
                // is a squared complex biquad (2 cascaded stages), bands are
                // complex-multiplied then complex-added, magnitude taken last.
                const cSq = (c) => [c[0] * c[0] - c[1] * c[1], 2 * c[0] * c[1]];
                const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];

                    const lowCutFreq = type === '5way' ? this.crossoverFreq1 : (type === '2way' ? this.crossoverFreq3 : this.crossoverFreq2);
                    const hLP = cSq(this.getBiquadComplex('lowpass', f, lowCutFreq, 0.707, 0));
                    let sumRe = hLP[0] * lLin, sumIm = hLP[1] * lLin;

                    if (type === '5way') {
                        const h = cMul(cSq(this.getBiquadComplex('highpass', f, this.crossoverFreq1, 0.707, 0)), cSq(this.getBiquadComplex('lowpass', f, this.crossoverFreq2, 0.707, 0)));
                        sumRe += h[0] * lmLin; sumIm += h[1] * lmLin;
                    }

                    if (type === '3way' || type === '4way' || type === '5way') {
                        const h = cMul(cSq(this.getBiquadComplex('highpass', f, this.crossoverFreq2, 0.707, 0)), cSq(this.getBiquadComplex('lowpass', f, this.crossoverFreq3, 0.707, 0)));
                        sumRe += h[0] * mLin; sumIm += h[1] * mLin;
                    }

                    if (type === '4way' || type === '5way') {
                        const h = cMul(cSq(this.getBiquadComplex('highpass', f, this.crossoverFreq3, 0.707, 0)), cSq(this.getBiquadComplex('lowpass', f, this.crossoverFreq4, 0.707, 0)));
                        sumRe += h[0] * hmLin; sumIm += h[1] * hmLin;
                    }

                    const highCutFreq = type === '2way' ? this.crossoverFreq3 : (type === '3way' ? this.crossoverFreq3 : this.crossoverFreq4);
                    const hHP = cSq(this.getBiquadComplex('highpass', f, highCutFreq, 0.707, 0));
                    sumRe += hHP[0] * hLin; sumIm += hHP[1] * hLin;

                    const sumMag = Math.sqrt(sumRe * sumRe + sumIm * sumIm);
                    filterMag[j] *= Number.isFinite(sumMag) ? sumMag : 1.0;
                }
            }

            return filterMag;
        },
};
