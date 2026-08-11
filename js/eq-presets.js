const EQ_PresetMethods = {
        getCustomPresets: function() {
            try {
                return JSON.parse(SafeStorage.getItem('iem_custom_eq_presets') || '{}');
            } catch (e) {
                console.warn('[EQ] Corrupted custom preset data, resetting.', e);
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

            const id = 'custom_' + Date.now();
            const config = this.getRealValues(); // { preVal, mainVals, advVals }

            const presetData = {
                p: config.preVal,
                m: config.mainVals.map(v => ({ g: v.g, hz: v.hz, q: v.q, type: v.type || 'peaking', s: v.slope })),
                a: config.advVals.map(v => ({ g: v.g, hz: v.hz, q: v.q, type: v.type || 'peaking' })),
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
                btn.innerHTML = `<span>🧪 ${p.name}</span>`;
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
                        this.bands[i].type = typeVal;
                        const typeBtn = document.getElementById(`eq-t_m${i}`);
                        if (typeBtn) {
                            const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                            typeBtn.textContent = labelMap[typeVal] || 'PK';
                        }
                    }
                    if (slopeVal !== undefined && this.bands[i]) {
                        this.bands[i].slope = slopeVal;
                        const slopeBtn = document.getElementById(`eq-sl_m${i}`);
                        if (slopeBtn) {
                            slopeBtn.textContent = `${slopeVal}dB`;
                            slopeBtn.classList.remove('hidden');
                        }
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

            EQ_Module.isProgrammaticSliderUpdate = false; // Release UI lock

            if (this.graphBuilt) {
                this.updateAudioConnections();
            }

            this.drawCurve();
            this.renderCustomPresets();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },
        deleteCustomPreset: function(id) {
            if (!confirm("Delete this custom preset?")) return;
            const presets = this.getCustomPresets();
            delete presets[id];
            SafeStorage.setItem('iem_custom_eq_presets', JSON.stringify(presets));
            if (this.activePreset === id) this.activePreset = null;
            this.switchCategory('custom');
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
                
                const preSlider = document.getElementById("eq-preampSlider");
                if (preSlider && p.p !== undefined) {
                    preSlider.value = p.p;
                    this.updatePreamp();
                }
                if (p.m) {
                    p.m.forEach((val, i) => {
                        const slider = document.getElementById("eq-s" + i);
                        if (slider) {
                            slider.value = val;
                        }
                        this.updateSlider(i, 'main');
                    });
                }
                if (p.a) {
                    p.a.forEach((val, i) => {
                        const b = this.advancedBands[i];
                        if (b) {
                            b.g = val;
                        }
                        // The live DSP reads the fader value (getLiveAdvancedFiltersState),
                        // so mirror the gain onto the slider element, not just the model.
                        const aSlider = document.getElementById("eq-a" + i);
                        if (aSlider) aSlider.value = val;
                        this.updateSlider(i, 'adv');
                    });
                }
                
                EQ_Module.isProgrammaticSliderUpdate = false; // Release protection flag
                
                // Send a single, complete message update to the worklet
                if (this.graphBuilt) {
                    this.updateAudioConnections();
                }
                
                this.drawCurve();
                
                if (PEQDB_Module.searchMode === 'similar') {
                    PEQDB_Module.findSimilarCurves();
                }
            }, 50);
        },
};