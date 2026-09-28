const EQ_PresetMethods = {
        // Unique quarantine key. A bare Date.now() collides when two corruptions
        // land in the same millisecond, which would silently overwrite the first
        // backup — the exact data loss this is meant to prevent.
        _quarantinePresets: function(raw) {
            const KEY = 'iem_custom_eq_presets';
            const base = KEY + '.corrupt.' + Date.now();
            let key = base, n = 1;
            while (SafeStorage.getItem(key) !== null) { key = base + '-' + (n++); }
            try { SafeStorage.setItem(key, raw); } catch (_) {}
            try { SafeStorage.removeItem(KEY); } catch (_) {}
            return key;
        },

        getCustomPresets: function() {
            const KEY = 'iem_custom_eq_presets';
            let raw;
            try { raw = SafeStorage.getItem(KEY); } catch (_) { return {}; }
            if (!raw) return {};
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                // Do NOT delete the key. This is the user's hand-built preset
                // library; the old code called removeItem() here, so a single
                // truncated write (exactly the QuotaExceededError-mid-write case
                // SafeStorage exists to absorb) destroyed every preset with only
                // a console.warn. Quarantine it instead so it can be recovered.
                const qk = this._quarantinePresets(raw);
                console.error('[EQ] Corrupted custom preset data. Original preserved at "' + qk + '".', e);
                showToast('Custom presets were corrupted. A backup was kept — please report this.', '⚠️');
                return {};
            }
            // Shape check: JSON.parse can succeed on something that is not a
            // preset map (an array, a number, null). Downstream code does
            // `presets[id]`, so anything non-object must not leak through.
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                const qk = this._quarantinePresets(raw);
                console.error('[EQ] Custom preset data is not a preset map. Original preserved at "' + qk + '".');
                showToast('Custom presets were corrupt. A backup was kept — please report this.', '⚠️');
                return {};
            }
            return parsed;
        },
        saveCurrentAsCustomPreset: function() {
            const modal = document.getElementById('save-preset-modal');
            const input = document.getElementById('save-preset-input');
            if (modal && input) {
                input.value = '';
                modal.classList.remove('hidden');
                Mascot.update();
                setTimeout(() => input.focus(), 50);
            }
        },
        closeSavePresetModal: function() {
            const modal = document.getElementById('save-preset-modal');
            if (modal) modal.classList.add('hidden');
            Mascot.update();
        },
        confirmSavePreset: function() {
            const input = document.getElementById('save-preset-input');
            if (!input) return;
            const name = input.value.trim();
            if (!name) return;

            const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const config = this.getRealValues(); // { preVal, mainVals, advVals }
            // Persist virtual bands (used when autoeqResolution >20) so a
            // >20-band solve survives a preset save/load cycle (was previously
            // discarded, causing the >20-band target match to collapse on recall).
            const presetData = {
                p: config.preVal,
                m: config.mainVals.map(v => ({ g: v.g, hz: v.hz, q: v.q, type: v.type || 'peaking', s: v.slope })),
                a: config.advVals.map(v => ({ g: v.g, hz: v.hz, q: v.q, type: v.type || 'peaking' })),
                v: (this.virtualBands || []).map(v => ({ g: v.g, hz: v.hz, q: v.q, type: v.type || 'peaking' })),
                name: name
            };

            const customPresets = this.getCustomPresets();
            customPresets[id] = presetData;
            SafeStorage.setItem('iem_custom_eq_presets', JSON.stringify(customPresets));

            showToast(`Preset "${name}" saved!`, "⭐");
            this.closeSavePresetModal();
            this.switchCategory('custom');
        },
        renderCustomPresets: function() {
            const grid = document.getElementById('preset-grid-content');
            if (!grid) return;
            grid.innerHTML = '';
            const presets = this.getCustomPresets();
            const keys = Object.keys(presets);

            if (keys.length === 0) {
                grid.innerHTML = '<div class="col-span-3 text-center text-[9px] text-zinc-650 italic py-4">No custom presets saved yet.</div>';
                return;
            }

            keys.forEach(id => {
                const p = presets[id];
                const relativeContainer = document.createElement('div');
                relativeContainer.className = 'relative group w-full';

                const btn = document.createElement('button');
                btn.id = 'preset-btn-' + id;
                btn.className = 'w-full text-center text-[10px] px-1 py-1 bg-[var(--bg-card)] border border-[var(--border-color)]/50 text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-all font-semibold shadow-sm truncate h-7 flex items-center justify-center gap-1';
                btn.textContent = '🧪 ' + (p.name || 'Preset');
                btn.onclick = () => { this.applyCustomPreset(id); };

                const delBtn = document.createElement('button');
                delBtn.className = 'absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-950/90 border border-red-900/40 text-red-400 text-[8px] font-bold flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 cursor-pointer';
                delBtn.innerHTML = '❌';
                delBtn.title = 'Delete Preset';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteCustomPreset(id);
                };

                relativeContainer.appendChild(btn);
                relativeContainer.appendChild(delBtn);
                grid.appendChild(relativeContainer);

                if (id === this.activePreset) {
                    btn.classList.remove('bg-[var(--bg-card)]', 'text-[var(--text-main)]');
                    btn.classList.add('bg-[var(--accent-blue)]', 'text-white', 'border-[var(--accent-blue)]');
                }
            });
        },
        // Presets are untrusted input: they come from localStorage, which is
        // writable by any import path, and advanced bands have NO UI at all
        // (#eq-panel-advanced is an empty container), so the model is the ONLY
        // source for their hz/g/q. A non-numeric or out-of-range value flowed
        // straight to updateAudioConnections -> worklet, where
        // w0 = 2*PI*freq/sampleRate became NaN and the biquad produced NaN for
        // the rest of the session: permanent total silence, no error shown.
        // The worklet's own Number.isFinite(a0) guard only prevented a
        // divide-by-zero; it happily propagated the NaN coefficients.
        //
        // Same defensive shape as eq-genre-targets.js loadValues(), which
        // already documents the same data as untrusted.
        _sanitizePresetBand: function(raw, fallback) {
            const fb = fallback || {};
            const src = (raw && typeof raw === 'object') ? raw : { g: raw };
            const num = (v, lo, hi, dflt) => {
                if (v === undefined || v === null) return dflt;
                const n = parseFloat(v);
                if (!Number.isFinite(n)) return dflt;
                if (n < lo || n > hi) return dflt;
                return n;
            };
            const VALID_TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];
            const out = {
                hz: num(src.hz, 10, 24000, Number.isFinite(fb.hz) ? fb.hz : 1000),
                g: num(src.g, -60, 60, Number.isFinite(fb.g) ? fb.g : 0),
                q: num(src.q, 0.01, 50, Number.isFinite(fb.q) ? fb.q : 1.0),
                type: VALID_TYPES.includes(src.type) ? src.type : (VALID_TYPES.includes(fb.type) ? fb.type : 'peaking'),
            };
            if (src.s !== undefined && src.s !== null) {
                const s = parseFloat(src.s);
                out.s = (Number.isFinite(s) && s >= 1 && s <= 60) ? s : 12;
            }
            // Track whether anything had to be replaced so the user is told.
            out.__repaired =
                (src.hz !== undefined && out.hz !== parseFloat(src.hz)) ||
                (src.g !== undefined && out.g !== parseFloat(src.g)) ||
                (src.q !== undefined && out.q !== parseFloat(src.q)) ||
                (src.type !== undefined && !VALID_TYPES.includes(src.type)) ||
                (out.s !== undefined && out.s !== parseFloat(src.s));
            return out;
        },

        applyCustomPreset: function(id) {
            const presets = this.getCustomPresets();
            const p = presets[id];
            if (!p) return;

            this.activePreset = id;
            EQ_Module.isProgrammaticSliderUpdate = true; // Lock UI updates during load
            let repairedBands = 0;

            try {
            // Map values cleanly to UI faders
            const preSlider = document.getElementById("eq-preampSlider");
            if (preSlider && p.p !== undefined) {
                const pNum = parseFloat(p.p);
                // A range input silently self-heals an invalid assignment (it
                // snaps to the midpoint), so clamp explicitly instead of letting
                // a corrupt preamp land halfway up the slider.
                preSlider.value = (Number.isFinite(pNum) && pNum >= -20 && pNum <= 20) ? pNum : 0;
                this.updatePreamp();
            }

            if (p.m) {
                p.m.forEach((val, i) => {
                    const band = this.bands[i];
                    if (!band) return;   // more bands than the UI has slots
                    const clean = this._sanitizePresetBand(val, { hz: band.hz, g: 0, q: Number.isFinite(band.q) ? band.q : band.defaultQ, type: band.type });
                    if (clean.__repaired) repairedBands++;
                    const gainVal = clean.g;
                    const hzVal = clean.hz;
                    const qVal = clean.q;
                    const typeVal = clean.type;
                    const slopeVal = clean.s;

                    const slider = document.getElementById("eq-s" + i);
                    if (slider) slider.value = gainVal;

                    if (hzVal !== undefined) {
                        const fInput = document.getElementById("eq-f" + i);
                        if (fInput) fInput.value = hzVal;
                        const fsSlider = document.getElementById(`eq-fs_m${i}`);
                        if (fsSlider) fsSlider.value = this.logHzToSlider(hzVal);
                    }
                    if (qVal !== undefined) {
                        const qSlider = document.getElementById("eq-q_m" + i);
                        if (qSlider) qSlider.value = qVal;
                    }
                    if (typeVal && this.bands[i]) {
                        // handleTypeChange keeps the band card in sync: gain
                        // row visibility/pointer-events and slider behavior
                        // depend on the selected type.
                        this.handleTypeChange(i, typeVal);
                        const typeBtn = document.getElementById(`eq-t_m${i}`);
                        if (typeBtn) {
                            const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                            typeBtn.textContent = labelMap[typeVal] || 'PK';
                        }
                        const slopeBtn = document.getElementById(`eq-sl_m${i}`);
                        if (slopeBtn) {
                            const isSlopeVisible = ['lowshelf', 'highshelf', 'lowpass', 'highpass'].includes(typeVal);
                            slopeBtn.classList.toggle('hidden', !isSlopeVisible);
                        }
                    }
                    // Only restore a saved slope when the (just-applied)
                    // type actually supports one -- an older preset saved
                    // before this guard existed could carry a slope value
                    // alongside a Peaking/Notch type, which would otherwise
                    // silently reintroduce the stale-slope cascade bug on
                    // load even though handleTypeChange() above already
                    // reset it.
                    const slopeCapableForPreset = this.bands[i] && ['lowshelf', 'highshelf', 'lowpass', 'highpass'].includes(this.bands[i].type);
                    if (slopeVal !== undefined && this.bands[i] && slopeCapableForPreset) {
                        this.bands[i].slope = slopeVal;
                        const slopeBtn = document.getElementById(`eq-sl_m${i}`);
                        if (slopeBtn) {
                            slopeBtn.textContent = `${slopeVal}dB`;
                            slopeBtn.classList.remove('hidden');
                        }
                    } else if (slopeVal !== undefined && this.bands[i]) {
                        this.bands[i].slope = 12;
                    }

                    this.updateSlider(i, 'main');
                });
            }

            if (p.a) {
                p.a.forEach((val, i) => {
                    const b = this.advancedBands[i];
                    if (!b) return;
                    // Advanced bands have no UI, so this model write is the ONLY
                    // place the value can be rejected before it reaches the
                    // worklet. Validate here or not at all.
                    const clean = this._sanitizePresetBand(val, { hz: b.hz, g: 0, q: b.q, type: b.type });
                    if (clean.__repaired) repairedBands++;
                    const gainVal = clean.g;
                    const hzVal = clean.hz;
                    const qVal = clean.q;
                    const typeVal = clean.type;

                    b.g = gainVal;
                    b.hz = hzVal;
                    b.q = qVal;
                    b.type = typeVal;

                    if (typeVal && this.advancedBands[i]) {
                        // Mirror the main-band card sync (handleTypeChange):
                        // the type button label and gain-row state must match
                        // the restored type, not just the model.
                        const typeBtn = document.getElementById(`eq-t_a${i}`);
                        if (typeBtn) {
                            const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                            typeBtn.textContent = labelMap[typeVal] || 'PK';
                        }
                        const gainRow = document.getElementById(`row-gain_a${i}`);
                        const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(typeVal);
                        if (gainRow) {
                            if (hasNoGain) {
                                gainRow.style.opacity = '0.15';
                                gainRow.style.pointerEvents = 'none';
                                const gainNum = document.getElementById(`eq-a${i}_num`);
                                if (gainNum) gainNum.value = 'N/A';
                            } else {
                                gainRow.style.opacity = '1';
                                gainRow.style.pointerEvents = 'auto';
                                const gainNum = document.getElementById(`eq-a${i}_num`);
                                const gainSlider = document.getElementById("eq-a" + i);
                                if (gainNum && gainSlider) gainNum.value = parseFloat(gainSlider.value).toFixed(1);
                            }
                        }
                    }

                    const aSlider = document.getElementById("eq-a" + i);
                    if (aSlider) aSlider.value = gainVal;

                    // NOTE: there is no `eq-af${i}` element anywhere in
                    // index.html — advanced bands have no frequency control
                    // (in fact #eq-panel-advanced is an empty container, so
                    // advancedBands is a model-only concept reachable solely
                    // through custom presets). The model write above is
                    // therefore the only place the value lands, which is why
                    // it is validated rather than mirrored. Do not add a
                    // read here expecting it to do something.

                    if (qVal !== undefined) {
                        const qSlider = document.getElementById("eq-q_a" + i);
                        if (qSlider) qSlider.value = qVal;
                    }

                    this.updateSlider(i, 'adv');
                });
            }

                if (p.v && Array.isArray(p.v)) {
                    // Virtual bands feed worklet slots 50+ directly from
                    // eq-dsp-graph.js, so they need the same validation.
                    this.virtualBands = p.v.map(v => {
                        const clean = this._sanitizePresetBand(v, { hz: 1000, g: 0, q: 1.0, type: 'peaking' });
                        if (clean.__repaired) repairedBands++;
                        return { hz: clean.hz, g: clean.g, q: clean.q, type: clean.type };
                    });
                } else if (p.v === undefined) {
                    // Backward compat: old presets without virtual still clear any
                    // previous virtual solve so the old 10/20-band preset does not
                    // retain a stale >20-band tail.
                    this.virtualBands = [];
                }
            } finally {
                EQ_Module.isProgrammaticSliderUpdate = false; // Release UI lock even if a band throws
            }

            // Never silently alter a user's saved EQ. If anything had to be
            // replaced because it was missing, non-numeric, or outside the
            // range the DSP can represent, say so.
            if (repairedBands > 0) {
                console.warn('[EQ] Preset "' + id + '": repaired ' + repairedBands +
                    ' band(s) with missing or out-of-range values.');
                showToast('Preset loaded with ' + repairedBands + ' band value(s) reset to safe defaults.', '⚠️');
            }

            if (this.graphBuilt) {
                this.updateAudioConnections();
            }

            this.drawCurve();
            this.renderCustomPresets();
            // Applying a preset reshaped the DSP curve programmatically —
            // unlock live Similar-mode matching and refresh matches.
            PEQDB_Module._similarTargetEverModified = true;
            if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                PEQDB_Module.debouncedFindSimilarCurves();
            }
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },
        deleteCustomPreset: async function(id) {
            const ok = await UIKit.confirm({
                title: "Delete this custom preset?",
                confirmLabel: "Delete",
                danger: true
            });
            if (!ok) return;
            const presets = this.getCustomPresets();
            const removed = presets[id];
            delete presets[id];
            SafeStorage.setItem('iem_custom_eq_presets', JSON.stringify(presets));
            if (this.activePreset === id) this.activePreset = null;
            this.switchCategory('custom');
            showToast(`Deleted preset "${(removed && removed.name) || id}"`, "🗑️", {
                action: removed ? {
                    label: "Undo",
                    onClick: () => {
                        const current = this.getCustomPresets();
                        current[id] = removed;
                        SafeStorage.setItem('iem_custom_eq_presets', JSON.stringify(current));
                        this.switchCategory('custom');
                        showToast("Preset restored.", "↩️");
                    }
                } : undefined
            });
        },
        applyPreset: function(name) {
            this.activePreset = name;
            document.querySelectorAll('#preset-grid-content button').forEach(btn => {
                btn.classList.remove('bg-[var(--accent-blue)]', 'text-white', 'border-[var(--accent-blue)]');
                btn.classList.add('bg-[var(--bg-card)]', 'text-[var(--text-main)]');
            });
            const activeBtn = document.getElementById('preset-btn-' + name);
            if (activeBtn) {
                activeBtn.classList.remove('bg-[var(--bg-card)]', 'text-[var(--text-main)]');
                activeBtn.classList.add('bg-[var(--accent-blue)]', 'text-white', 'border-[var(--accent-blue)]');
            }

            setTimeout(() => {
                const p = this.eqPresets[name];
                if (!p) return;
                
                EQ_Module.isProgrammaticSliderUpdate = true; // Raise protection flag
                try {
                const preSlider = document.getElementById("eq-preampSlider");
                if (preSlider && p.p !== undefined) {
                    preSlider.value = p.p;
                    this.updatePreamp();
                }
                // Built-in presets store only gains; stale band state (types,
                // frequencies, Q — settable via Smart Import, number inputs and
                // custom presets) would otherwise persist and produce a
                // different audible response than the preset intended.
                // Reset type AND Hz/Q to the band defaults, and clear bypass.
                window.bypassedBands = window.bypassedBands || new Set();
                window.bypassedBands.clear();
                if (p.m) {
                    p.m.forEach((val, i) => {
                        const b = this.bands[i];
                        if (b) {
                            if (b.type && b.type !== 'peaking') {
                                b.type = 'peaking';
                                b.slope = 12;
                                this.handleTypeChange(i, 'peaking');
                                const typeBtn = document.getElementById(`eq-t_m${i}`);
                                if (typeBtn) typeBtn.textContent = 'PK';
                                const slopeBtn = document.getElementById(`eq-sl_m${i}`);
                                if (slopeBtn) slopeBtn.classList.add('hidden');
                            }
                            // Reset Hz/Q to the band defaults — a preset's
                            // curated gains land at the curated frequencies,
                            // not whatever a previous import left behind.
                            const fInput = document.getElementById("eq-f" + i);
                            if (fInput) fInput.value = b.hz;
                            const fsSlider = document.getElementById(`eq-fs_m${i}`);
                            if (fsSlider) fsSlider.value = this.logHzToSlider(b.hz);
                            const qSlider = document.getElementById("eq-q_m" + i);
                            if (qSlider) qSlider.value = b.defaultQ;
                            const qNum = document.getElementById(`eq-q_m${i}_num`);
                            if (qNum) qNum.value = b.defaultQ.toFixed(2);
                            // Un-bypass the band and restore its indicator
                            // (bypass state is honored by updateAudioConnections).
                            const bypassBtn = document.getElementById(`eq-bp_m${i}`);
                            if (bypassBtn) { bypassBtn.textContent = "🟢"; bypassBtn.style.color = "var(--accent-green)"; }
                            const bypassCard = bypassBtn ? bypassBtn.closest('.eq-band-card') : null;
                            if (bypassCard) { bypassCard.style.opacity = "1"; bypassCard.classList.remove('bypassed'); }
                        }
                        const slider = document.getElementById("eq-s" + i);
                        if (slider) {
                            slider.value = val;
                        }
                        this.updateSlider(i, 'main');
                    });
                    // Clear any leftover virtual bands (>20-band solve) so a flat
                    // 10-band preset does not retain a stale tail.
                    if (this.virtualBands && this.virtualBands.length) this.virtualBands = [];
                }
                if (p.a) {
                    p.a.forEach((val, i) => {
                        const b = this.advancedBands[i];
                        if (b) {
                            b.g = val;
                            // Same completeness as the main loop: reset the
                            // advanced band's type, Hz and Q to defaults.
                            if (b.type && b.type !== 'peaking') {
                                b.type = 'peaking';
                                const typeBtn = document.getElementById(`eq-t_a${i}`);
                                if (typeBtn) typeBtn.textContent = 'PK';
                                const gainRow = document.getElementById(`row-gain_a${i}`);
                                if (gainRow) { gainRow.style.opacity = '1'; gainRow.style.pointerEvents = 'auto'; }
                            }
                            // `b.defaultHz` never existed on an advancedBands
                            // entry (they carry `hz`, not `defaultHz`), so this
                            // was a no-op that only survived on `undefined || b.hz`.
                            b.hz = b.hz;
                            b.q = b.defaultQ;
                            const aqSlider = document.getElementById("eq-q_a" + i);
                            if (aqSlider) aqSlider.value = b.defaultQ;
                            const bypassBtnA = document.getElementById(`eq-bp_a${i}`);
                            if (bypassBtnA) { bypassBtnA.textContent = "🟢"; bypassBtnA.style.color = "var(--accent-green)"; }
                        }
                        // The live DSP reads the fader value (getLiveAdvancedFiltersState),
                        // so mirror the gain onto the slider element, not just the model.
                        const aSlider = document.getElementById("eq-a" + i);
                        if (aSlider) aSlider.value = val;
                        this.updateSlider(i, 'adv');
                    });
                }

                // Headroom safety net: no curated or custom preset may leave
                // net-positive gain (max band boost + preamp > 0 clips). The
                // data fixes cover today's three offenders; this guards all
                // future presets and user-authored customs alike.
                try {
                    let maxBoost = 0;
                    (p.m || []).forEach(val => {
                        const g = (val && typeof val === 'object') ? val.g : val;
                        if (Number.isFinite(g) && g > maxBoost) maxBoost = g;
                    });
                    (p.a || []).forEach(val => {
                        const g = (val && typeof val === 'object') ? val.g : val;
                        if (Number.isFinite(g) && g > maxBoost) maxBoost = g;
                    });
                    const preSlider2 = document.getElementById("eq-preampSlider");
                    const preValEl2 = document.getElementById("eq-preampVal");
                    if (preSlider2 && maxBoost > 0 && parseFloat(preSlider2.value) > -maxBoost) {
                        preSlider2.value = -maxBoost;
                        if (preValEl2) preValEl2.value = (-maxBoost).toFixed(1);
                        this.updatePreamp();
                    }
                } catch (e) {}

                } finally {
                    EQ_Module.isProgrammaticSliderUpdate = false; // Release protection flag even if a band throws
                }
                
                // Send a single, complete message update to the worklet
                if (this.graphBuilt) {
                    this.updateAudioConnections();
                }
                
                this.drawCurve();
                if (window.syncGlobalSliders) window.syncGlobalSliders();
                
                if (PEQDB_Module.searchMode === 'similar') {
                    PEQDB_Module._similarTargetEverModified = true;
                    PEQDB_Module.findSimilarCurves();
                }
            }, 50);
        },
};