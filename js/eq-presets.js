const EQ_PresetMethods = {
        getCustomPresets: function() {
            try {
                return JSON.parse(SafeStorage.getItem('iem_custom_eq_presets') || '{}');
            } catch (e) {
                console.warn('[EQ] Corrupted custom preset data, resetting.', e);
                try { SafeStorage.removeItem('iem_custom_eq_presets'); } catch (_) {}
                return {};
            }
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
                btn.className = 'w-full text-center text-[10px] px-1 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)]/50 text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-all font-semibold shadow-sm truncate h-7 flex items-center justify-center gap-1';
                btn.textContent = '🧪 ' + (p.name || 'Preset');
                btn.onclick = () => { this.applyCustomPreset(id); };

                const delBtn = document.createElement('button');
                delBtn.className = 'absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-950/90 border border-red-900/40 text-red-400 text-[8px] font-bold rounded-full flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 cursor-pointer';
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
        applyCustomPreset: function(id) {
            const presets = this.getCustomPresets();
            const p = presets[id];
            if (!p) return;

            this.activePreset = id;
            EQ_Module.isProgrammaticSliderUpdate = true; // Lock UI updates during load

            try {
            // Map values cleanly to UI faders
            const preSlider = document.getElementById("eq-preampSlider");
            if (preSlider && p.p !== undefined) {
                preSlider.value = p.p;
                this.updatePreamp();
            }

            if (p.m) {
                p.m.forEach((val, i) => {
                    const isObject = (val && typeof val === 'object');
                    const gainVal = isObject ? val.g : val;
                    const hzVal = isObject ? val.hz : undefined;
                    const qVal = isObject ? val.q : undefined;
                    const typeVal = isObject ? val.type : undefined;
                    const slopeVal = isObject ? val.s : undefined;

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
                    const isObject = (val && typeof val === 'object');
                    const gainVal = isObject ? val.g : val;
                    const hzVal = isObject ? val.hz : undefined;
                    const qVal = isObject ? val.q : undefined;
                    const typeVal = isObject ? val.type : undefined;

                    const b = this.advancedBands[i];
                    if (b) {
                        b.g = gainVal;
                        if (hzVal !== undefined) b.hz = hzVal;
                        if (qVal !== undefined) b.q = qVal;
                        if (typeVal) b.type = typeVal;
                    }

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

                    if (hzVal !== undefined) {
                        const afInput = document.getElementById("eq-af" + i);
                        if (afInput) afInput.value = hzVal;
                    }
                    if (qVal !== undefined) {
                        const qSlider = document.getElementById("eq-q_a" + i);
                        if (qSlider) qSlider.value = qVal;
                    }

                    this.updateSlider(i, 'adv');
                });
            }

                if (p.v && Array.isArray(p.v)) {
                    this.virtualBands = p.v.map(v => ({
                        hz: v.hz, g: v.g, q: v.q != null ? v.q : 1.0, type: v.type || 'peaking'
                    }));
                } else if (p.v === undefined) {
                    // Backward compat: old presets without virtual still clear any
                    // previous virtual solve so the old 10/20-band preset does not
                    // retain a stale >20-band tail.
                    this.virtualBands = [];
                }
            } finally {
                EQ_Module.isProgrammaticSliderUpdate = false; // Release UI lock even if a band throws
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
                // Built-in presets store only gains; stale band types (e.g. shelf)
                // from a prior custom preset would otherwise persist and produce a
                // different audible response than the preset intended. Reset to PK.
                if (p.m) {
                    p.m.forEach((val, i) => {
                        const b = this.bands[i];
                        if (b && b.type && b.type !== 'peaking') {
                            b.type = 'peaking';
                            b.slope = 12;
                            this.handleTypeChange(i, 'peaking');
                            const typeBtn = document.getElementById(`eq-t_m${i}`);
                            if (typeBtn) typeBtn.textContent = 'PK';
                            const slopeBtn = document.getElementById(`eq-sl_m${i}`);
                            if (slopeBtn) slopeBtn.classList.add('hidden');
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
                            if (b.type && b.type !== 'peaking') {
                                b.type = 'peaking';
                                const typeBtn = document.getElementById(`eq-t_a${i}`);
                                if (typeBtn) typeBtn.textContent = 'PK';
                                const gainRow = document.getElementById(`row-gain_a${i}`);
                                if (gainRow) { gainRow.style.opacity = '1'; gainRow.style.pointerEvents = 'auto'; }
                            }
                        }
                        // The live DSP reads the fader value (getLiveAdvancedFiltersState),
                        // so mirror the gain onto the slider element, not just the model.
                        const aSlider = document.getElementById("eq-a" + i);
                        if (aSlider) aSlider.value = val;
                        this.updateSlider(i, 'adv');
                    });
                }

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