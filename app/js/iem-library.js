// IEM review library: save, load, compare, delete, and config import/export.
// Split out of iem-module.js; merged into IEM_Module via Object.assign there.
const IEM_LibraryMethods = {
        getLibrary: async function() {
            return await DBCache.getAllReviews();
        },

        saveToLibrary: async function() {
        const brand = document.getElementById('brand').value.trim(); const model = document.getElementById('model').value.trim();
        if(!brand || !model) { showToast("Enter a Brand and Model name before saving.", "⚠️"); return; }
        await this.ensureChartReady();

        const finalScore = this.updateAll(); const id = `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
        // Same-id saves overwrite silently (DBCache.put) — and the normalizer
        // collapses distinct names onto one id (non-Latin names all become
        // "-"). Confirm before replacing an EXISTING record so a save can't
        // destroy a review without the user knowing.
        const existing = await DBCache.getReview(id);
        if (existing) {
            const okToOverwrite = await UIKit.confirm({
                title: "Overwrite existing review?",
                message: `A saved review for "${existing.brand || ''} ${existing.model || ''}" already exists in the library. Saving again will replace it.`,
                confirmLabel: "Overwrite",
                danger: true
            });
            if (!okToOverwrite) { showToast("Save cancelled — nothing changed.", "ℹ️"); return; }
        }
        const sliderValues = {}; this.sliderNodes.forEach(n => { if (n.element.id) sliderValues[n.element.id] = n.element.value; });
        // ensureChartReady tolerates Chart.js failing to load (radarChart stays
        // null) — the unguarded .data access below then rejected the whole
        // async save with no toast. Fall back to the live slider-derived axes
        // (the same values the chart would display).
        const radarData = (this.radarChart && this.radarChart.data && this.radarChart.data.datasets && this.radarChart.data.datasets[0])
            ? Array.from(this.radarChart.data.datasets[0].data)
            : this.sliderNodes.map(n => parseFloat(n.element.value) || 0);
        // Price easter-egg writes non-numeric words (e.g. "Priceless 👑") via direct assignment
        // bypassing the digit-only input handler. Coerce to digits for storage so
        // library re-load and numeric consumers never see NaN, while keeping the
        // on-screen easter-egg until next edit. Six digits, not four: real DB
        // entries reach $59,000 and the old slice(0,4) silently corrupted them
        // to a tenth of their value on save (59000 -> 5900).
        const rawPrice = document.getElementById('price').value || "";
        const priceDigits = rawPrice.replace(/[^0-9]/g, '').slice(0, 6) || null;
        const price = priceDigits;

        const profile = { id, brand, model, score: parseFloat(finalScore), price: price, impedance: document.getElementById('impedance').value, sensitivity: document.getElementById('sensitivity').value, sensUnit: this.sensUnit || 'mW', image: this.currentImageBlob || this.currentImage, notes: document.getElementById('review-notes').value, refVolume: document.getElementById('listening-volume').value, selectedTags: Array.from(this.selectedTags), selectedGenres: Array.from(this.selectedGenres), selectedBass: Array.from(this.selectedBass), sliders: sliderValues, selectedDriverTypes: this.selectedDriverTypes, formFactor: this.formFactor || 'IEM', connector: this.connector || '2-pin', crossoverOverride: this.crossoverOverride || false, wayOverride: this.wayOverride || false, currentCrossover: this.currentCrossover || 'UNK', currentWay: this.currentWay || 'UNK', timestamp: Date.now(), radarData: radarData, toneData: (typeof Tone_Module !== 'undefined' && Tone_Module.getState) ? Tone_Module.getState() : null, eqData: (typeof EQ_Module !== 'undefined' && EQ_Module.getRealValues) ? EQ_Module.getRealValues() : null };

        const success = await DBCache.saveReview(profile);
        if (success) {
            showToast(`Saved ${brand} ${model} to Library inventory.`, "💾");
            await this.renderLibrary();
        } else {
            showToast("Database write failed.", "⚠️");
        }
    },

        renderLibrary: async function() {
            const searchInput = document.getElementById('lib-search');
            const searchVal = (searchInput ? searchInput.value : '').toLowerCase();
            const rawLibrary = await this.getLibrary();
            const library = rawLibrary.filter(item => {

                if (!item || !item.brand || !item.model) return false;
                const searchableText = `${item.brand} ${item.model} ${item.notes || ''}`;
                return PEQDB_Module.matchSearchTokens(searchableText, searchVal);
            }).sort((a, b) => (b.score || 0) - (a.score || 0));

            const tbody = document.getElementById('library-table-body');
            const emptyState = document.getElementById('library-empty');
            if (!tbody) return;

            tbody.innerHTML = '';
            if(library.length === 0) {
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }
            if (emptyState) emptyState.classList.add('hidden');

            if (this.libraryObjectURLs) {
                this.libraryObjectURLs.forEach(url => URL.revokeObjectURL(url));
            }
            this.libraryObjectURLs = [];

            const fragment = document.createDocumentFragment();
            library.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-[var(--bg-input)] transition-all";

                let imgPath = '';
                if (item.image) {
                    if (item.image instanceof Blob) {
                        const url = URL.createObjectURL(item.image);
                        this.libraryObjectURLs.push(url);
                        imgPath = url;
                    } else {
                        imgPath = item.image;
                    }
                }

                const safeId = esc(item.id);
                const safeImg = esc(imgPath);
                const safeBrand = esc(item.brand);
                const safeModel = esc(item.model);
                // Imported library records can carry arbitrary strings (the
                // save-time sanitizer is bypassed by direct JSON import), so
                // price/volume/score must be coerced before interpolation.
                // A string score ("9") previously threw toFixed and killed
                // the whole library render.
                const safePrice = esc(String(Number.isFinite(parseFloat(item.price)) ? item.price : '---'));
                const safeVol = esc(String(item.refVolume || 'N/A'));
                const numScore = Number(item.score);
                const safeScore = Number.isFinite(numScore) ? numScore.toFixed(1) : '--';

                tr.innerHTML = `
                    <td class="px-4 py-3"><input type="checkbox" class="compare-cb accent-blue-500 w-4 h-4 cursor-pointer" value="${safeId}"></td>
                    <td class="px-4 py-3 font-semibold text-[var(--text-main)] flex items-center gap-3">
                        <span class="text-[var(--text-secondary)] font-mono text-xs w-4">#${idx+1}</span>
                        ${imgPath ? `<img src="${safeImg}" class="w-8 h-8 object-cover border border-[var(--border-color)] bg-[#111]">` : '<div class="w-8 h-8 border border-[var(--border-color)] bg-[#111] flex items-center justify-center text-zinc-650">🎧</div>'}
                        <div>
                            <div class="text-xs">${safeBrand} <span class="text-[var(--accent-blue)]">${safeModel}</span></div>
                            <div class="text-xs text-[var(--text-secondary)] font-normal mt-0.5">$${safePrice} • Vol: ${safeVol}</div>
                        </div>
                    </td>
                    <td class="px-4 py-3 font-black text-sm text-center text-[var(--accent-blue)]">${safeScore}</td>
                    <td class="px-4 py-3 text-right"></td>`;
                // Load/Delete buttons are DOM-built with real listeners (no
                // onclick string literals) — imported ids can contain quotes
                // that previously broke out of the inline handler string.
                const loadBtn = document.createElement('button');
                loadBtn.className = 'px-3 py-1 bg-zinc-800 text-stone-200 text-xs font-bold hover:bg-zinc-700 transition-colors shadow-sm';
                loadBtn.textContent = 'Load';
                loadBtn.addEventListener('click', () => IEM_Module.loadFromLibrary(item.id));
                const delBtn = document.createElement('button');
                delBtn.className = 'ml-2.5 text-red-500 hover:text-red-400 cursor-pointer text-[8px]';
                delBtn.textContent = '❌';
                delBtn.addEventListener('click', () => IEM_Module.deleteFromLibrary(item.id));
                const btnTd = document.createElement('td');
                btnTd.className = 'px-4 py-3 text-right';
                btnTd.appendChild(loadBtn);
                btnTd.appendChild(delBtn);
                tr.appendChild(btnTd);
                fragment.appendChild(tr);
            });

            requestAnimationFrame(() => {
                tbody.appendChild(fragment);
            });
        },

        toggleLibraryModal: async function() { const modal = document.getElementById('library-modal'); if(modal.classList.contains('hidden')) { modal.classList.remove('hidden'); this.closeCompare(); await this.renderLibrary(); } else { modal.classList.add('hidden'); } },

        loadFromLibrary: async function(id) {
            const profile = await DBCache.getReview(id); if(!profile) return;
            document.getElementById('brand').value = profile.brand || ''; document.getElementById('model').value = profile.model || ''; document.getElementById('price').value = profile.price || ''; document.getElementById('impedance').value = profile.impedance || '32'; document.getElementById('sensitivity').value = profile.sensitivity || '110'; document.getElementById('review-notes').value = profile.notes || ''; if(profile.refVolume) this.setListeningVolume(profile.refVolume);
            if (profile.formFactor) this.setFormFactor(profile.formFactor);
            if (profile.connector) this.setConnector(profile.connector);
            if (profile.image) {
                this._restoreStoredImage(profile.image);
            } else {
                this.clearImage();
            }

            // Restore the sensitivity unit the profile was saved with — dB/mW
            // and dB/V readings differ by ~10*log10(1000/Z), so guessing the
            // unit silently corrupts every downstream power calculation.
            if (profile.sensUnit && (profile.sensUnit === 'mW' || profile.sensUnit === 'V')) {
                this.sensUnit = profile.sensUnit;
                this.updateSensUnitUI();
            }

            this.selectedDriverTypes = profile.selectedDriverTypes || {};
            this.runDriverAutoLogic();

            // Restore manual crossover/way overrides (same fields the config
            // backup saves). Reset first when absent: a loaded profile with
            // no override must not inherit the PREVIOUS profile's stuck
            // override/currentCrossover/currentWay state.
            this.crossoverOverride = !!profile.crossoverOverride;
            this.wayOverride = !!profile.wayOverride;
            this.currentCrossover = profile.currentCrossover || 'UNK';
            this.currentWay = profile.currentWay || 'UNK';
            this.updateCrossoverButtonsUI();
            this.updateWayButtonsUI();

            this.selectedTags = new Set(profile.selectedTags || []); this.createTags('tonality-tags', this.tonalityTags, this.selectedTags); this.selectedGenres = new Set(profile.selectedGenres || []); this.createTags('genre-tags', this.genreTags, this.selectedGenres); this.selectedBass = new Set(profile.selectedBass || []); this.createTags('bass-tags', this.bassTags, this.selectedBass);
            if (profile.sliders) {
                this.sliderNodes.forEach(n => {
                    if (profile.sliders[n.element.id] !== undefined) {
                        n.element.value = profile.sliders[n.element.id];
                    }
                });
            }
            if (profile.toneData && typeof Tone_Module !== 'undefined' && Tone_Module.loadState) Tone_Module.loadState(profile.toneData);
if (profile.eqData && typeof EQ_Module !== 'undefined' && EQ_Module.loadValues) EQ_Module.loadValues(profile.eqData);
else if (typeof EQ_Module !== 'undefined' && EQ_Module.applyPreset) EQ_Module.applyPreset('balanced');
            this.updateAll(); this.toggleLibraryModal();
        },

        // Was a native confirm(), which blocks the whole renderer on a modal the
        // app cannot style - and froze the window until a human answered, which
        // also made it impossible to exercise from a test. Every other
        // destructive action in the app already uses UIKit.confirm.
        deleteFromLibrary: async function(id) {
            const ok = await UIKit.confirm({
                title: "Delete this profile?",
                confirmLabel: "Delete",
                danger: true
            });
            if (!ok) return;
            await DBCache.deleteReview(id);
            await this.renderLibrary();
        },

        compareSelected: async function() {
            const checkboxes = document.querySelectorAll('.compare-cb:checked'); if(checkboxes.length < 2 || checkboxes.length > 4) { alert("Please select between 2 and 4 IEMs to compare."); return; }
            const library = await this.getLibrary(); const selected = Array.from(checkboxes).map(cb => library.find(i => i.id === cb.value));
            document.getElementById('library-table').classList.add('hidden'); const compView = document.getElementById('compare-view'); const compGrid = document.getElementById('compare-grid');
            compGrid.innerHTML = '';
            let _compHtml = '';

            selected.forEach(item => {
                let imgPath = '';
                if (item.image) {
                    if (item.image instanceof Blob) {
                        const url = URL.createObjectURL(item.image);
                        this.libraryObjectURLs.push(url);
                        imgPath = url;
                    } else {
                        imgPath = item.image;
                    }
                }

                const safeImg = esc(imgPath);

                const radar = Array.isArray(item.radarData) ? item.radarData : [];
                const rd = (i) => (typeof radar[i] === 'number' && isFinite(radar[i])) ? radar[i].toFixed(1) : '--';
                const scoreVal = (typeof item.score === 'number' && isFinite(item.score)) ? item.score.toFixed(1) : '--';
                const brandEsc = esc(item.brand); const modelEsc = esc(item.model);
                const axes = [['Bass',0],['Mids',1],['Treble',2],['Detail',3],['Stage',4],['Imaging',5],['Dynamics',6],['Tonality',7],['Tech',8]];
                const axisRows = axes.map(([label, i]) => `<div class="flex justify-between border-b border-[var(--border-color)] pb-0.5"><span class="text-zinc-500">${label}</span><span class="text-[var(--text-main)]">${rd(i)}</span></div>`).join('');
                _compHtml += `<div class="bg-[var(--bg-input)] border border-[var(--border-color)] p-4 flex flex-col items-center shadow relative"><div class="absolute top-2 left-2 text-xs text-[var(--text-secondary)] font-mono border border-[var(--border-color)] px-1.5">$${esc(item.price || '--')}</div>${imgPath ? `<img src="${safeImg}" class="h-20 object-contain mb-3 bg-[#111] p-1 border border-[var(--border-color)]">` : `<div class="h-20 w-20 bg-[#111] flex items-center justify-center mb-3 text-zinc-650 border border-[var(--border-color)]">🎧</div>`}<h3 class="font-bold text-xs text-center leading-tight">${brandEsc}<br><span class="text-[var(--accent-blue)] text-sm">${modelEsc}</span></h3><div class="text-3xl font-black mt-2 text-[var(--text-main)] tracking-tighter">${scoreVal}</div><div class="w-full mt-4 space-y-1 text-xs font-semibold">${axisRows}</div></div>`;
            });
            compGrid.innerHTML = _compHtml;
            compView.classList.remove('hidden'); compView.classList.add('flex');
        },

        closeCompare: function() { document.getElementById('library-table').classList.remove('hidden'); document.getElementById('compare-view').classList.add('hidden'); document.getElementById('compare-view').classList.remove('flex'); },

        saveConfig: async function() {
            try {
                const brand = (document.getElementById('brand')?.value || '').trim();
                const model = (document.getElementById('model')?.value || '').trim() || "Workstation";
                const baseName = brand ? `${brand}_${model}` : model;

                const sliderValues = {};
                this.sliderNodes.forEach(n => {
                    if (n.element && n.element.id) sliderValues[n.element.id] = n.element.value;
                });

                const currentWorkspace = {
                    brand: document.getElementById('brand')?.value || '',
                    model: document.getElementById('model')?.value || '',
                    price: document.getElementById('price')?.value || '',
                    refVolume: document.getElementById('listening-volume')?.value || 'moderate',
                    impedance: document.getElementById('impedance')?.value || '5',
                    sensitivity: document.getElementById('sensitivity')?.value || '80',
                    notes: document.getElementById('review-notes')?.value || '',
                // Workspace photo: blob: URLs die with the session and Blobs
                // stringify to {} — serialize as a bounded dataURL instead.
                // (Image is already <=400px from the upload pipeline; this is
                // the same 0.75-quality JPEG the upload path produces.)
                image: await this._imageToDataURL(this.currentImage, this.currentImageBlob),
                selectedTags: Array.from(this.selectedTags || []),
                selectedGenres: Array.from(this.selectedGenres || []),
                selectedBass: Array.from(this.selectedBass || []),
                sliders: sliderValues,
                selectedDriverTypes: this.selectedDriverTypes || {},
                formFactor: this.formFactor || 'IEM',
                connector: this.connector || '2-pin',
                crossoverOverride: this.crossoverOverride || false,
                wayOverride: this.wayOverride || false,
                currentCrossover: this.currentCrossover || 'UNK',
                currentWay: this.currentWay || 'UNK',
                sensUnit: this.sensUnit || 'mW',
                toneData: Tone_Module.getState(),
                eqData: EQ_Module.getRealValues()
            };

            // Library records hold photo Blobs (IndexedDB-native) — they must
            // be converted to dataURLs BEFORE JSON.stringify, which would
            // otherwise silently serialize every one of them to {}.
            const rawLibrary = await this.getLibrary();
            const serializedLibrary = [];
            for (const rec of rawLibrary) {
                if (rec && rec.image instanceof Blob) {
                    rec.image = await this._imageToDataURL(null, rec.image);
                }
                serializedLibrary.push(rec);
            }

            const fullBackup = {
                backupType: "full_workstation_backup",
                activeWorkspace: currentWorkspace,
                library: serializedLibrary
            };

                const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName.replace(/[\s/\\?%*:|"<>]+/g, '_')}_backup.json`;
                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast("Workstation backup exported!", "📥");
            } catch (err) {
                console.error("Export failed:", err);
                showToast("Failed to export backup.", "⚠️");
            }
        },

        loadProfileData: function(data) {
            if (!data) return;

            if (document.getElementById('brand')) document.getElementById('brand').value = data.brand || '';
            if (document.getElementById('model')) document.getElementById('model').value = data.model || '';
            if (document.getElementById('price')) document.getElementById('price').value = data.price || '';
            if (data.refVolume) this.setListeningVolume(data.refVolume);

            if (document.getElementById('impedance')) {
                document.getElementById('impedance').value = data.impedance || '5';
                document.getElementById('impedance-slider').value = data.impedance || '5';
            }
            if (document.getElementById('sensitivity')) {
                document.getElementById('sensitivity').value = data.sensitivity || '80';
                document.getElementById('sensitivity-slider').value = data.sensitivity || '80';
            }
            if (document.getElementById('review-notes')) document.getElementById('review-notes').value = data.notes || '';

            if (data.image) {
                this._restoreStoredImage(data.image);
            } else {
                this.clearImage();
            }

            if (data.sensUnit && (data.sensUnit === 'mW' || data.sensUnit === 'V')) {
                this.sensUnit = data.sensUnit;
                this.updateSensUnitUI();
            }

            this.selectedDriverTypes = data.selectedDriverTypes || {};
            this.crossoverOverride = data.crossoverOverride || false;
            this.wayOverride = data.wayOverride || false;
            this.currentCrossover = data.currentCrossover || 'UNK';
            this.currentWay = data.currentWay || 'UNK';
            this.updateCrossoverButtonsUI();
            this.updateWayButtonsUI();
            this.updateDriverSummary();
            if (data.formFactor) this.setFormFactor(data.formFactor);
            if (data.connector) this.setConnector(data.connector);

            this.selectedTags = new Set(data.selectedTags || []);
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);

            this.selectedGenres = new Set(data.selectedGenres || []);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);

            this.selectedBass = new Set(data.selectedBass || []);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);

            if (data.sliders) {
                this.sliderNodes.forEach(n => {
                    if (data.sliders[n.element.id] !== undefined) {
                        n.element.value = data.sliders[n.element.id];
                    }
                });
            }

            if (data.toneData) Tone_Module.loadState(data.toneData);
            if (data.eqData) EQ_Module.loadValues(data.eqData);

            if (window.syncGlobalSliders) window.syncGlobalSliders();
            this.updateAll();
        },

        loadConfigDirect: function(data) {
            this.loadProfileData(data);
        },

        importConfig: function(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    let rawText = ev.target.result;
                    rawText = rawText.replace(/^\uFEFF/, '').trim();
                    const data = JSON.parse(rawText);
                    this._importParsedConfig(data);
                } catch (err) {
                    console.error("Import parsing crash:", err);
                    showToast("Failed to parse file.", "⚠️");
                }
            };
            reader.readAsText(file);
            event.target.value = '';
        },

// Shared importer for the file input AND the window drop handler.
        // The drop path previously called loadProfileData directly, which
        // ignored the backup structure entirely - dropping the app's own
        // _backup.json blanked the workspace without restoring any of it.
        //
        // Everything below runs against a JSON.parse() result, which is
        // attacker-controlled in the sense that matters here: the user (or a
        // file they were handed) chooses it. Three consequences, all of which
        // were live bugs:
        //
        //  - data.hasOwnProperty(...) is a prototype-dependent call. A payload
        //    of {"hasOwnProperty": 0} is valid JSON and made it throw a
        //    TypeError, which the catch reported as "Failed to parse file."
        //    even though the file parsed fine. Object.prototype.hasOwnProperty
        //    .call() cannot be shadowed by the payload.
        //  - A non-object payload (an array, a bare number, a string) was
        //    accepted and reported as "Loaded <x> successfully!", which is not
        //    true of any of them.
        //  - DBCache.saveReview resolves false rather than rejecting when
        //    IndexedDB is unavailable, and the old loops threw that result
        //    away - so a full backup could report "restored successfully!" with
        //    ZERO records written. That state is designed-for: DBCache.init()
        //    is explicitly allowed to fail (see peqdb-module.js), and it also
        //    happens in private mode and on quota exhaustion.
        _isValidLibraryRecord: function(rec) {
            if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
            // id is the IndexedDB keyPath and the row lookup key downstream, so
            // a record without a usable one can never be read back.
            if (typeof rec.id !== 'string' || rec.id.length === 0) return false;
            return true;
        },

        // Returns { saved, skipped } so the caller can report what actually
        // happened instead of asserting success.
        _importLibraryRecords: async function(records) {
            if (!Array.isArray(records) || records.length === 0) return { saved: 0, skipped: 0 };
            let saved = 0, skipped = 0;
            for (let i = 0; i < records.length; i++) {
                if (!this._isValidLibraryRecord(records[i])) { skipped++; continue; }
                try {
                    if (await DBCache.saveReview(records[i])) saved++;
                    else skipped++;
                } catch (e) {
                    skipped++;
                }
            }
            return { saved: saved, skipped: skipped };
        },

        // Honest wording for a library restore. Kept in one place so the two
        // branches below cannot drift apart again.
        _reportLibraryRestore: function(result, total, okMessage) {
            if (total === 0) { showToast(okMessage, "📥"); return; }
            if (result.saved === 0) {
                showToast("Library could NOT be restored - storage is unavailable, so no records were saved.", "⚠️", { duration: 7000 });
                return;
            }
            const skippedNote = result.skipped > 0
                ? ` (${result.skipped} invalid or unwritable entr${result.skipped === 1 ? 'y' : 'ies'} skipped)`
                : '';
            showToast(`${okMessage} ${result.saved} of ${total} record(s) saved${skippedNote}.`, "📥", { duration: 6000 });
        },

        _importParsedConfig: async function(data) {
            try {
                // Shape guard first. JSON.parse can hand back any JSON value,
                // and a dropped file can be anything at all. Only a plain
                // object can carry a profile; arrays and primitives cannot, and
                // loadProfileData would either throw on them or silently do
                // nothing while the toast claims success.
                if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                    showToast("That file is not a profile - expected a JSON object.", "⚠️");
                    return;
                }
                const has = (k) => Object.prototype.hasOwnProperty.call(data, k);
                // Note the explicit parens. The original relied on && binding
                // tighter than || across an unparenthesised ternary chain.
                const looksLikeBundle = has('activeCurves') === false
                    && (has('library') || has('eqData') || has('sliders'));
                const isFullBackup = data.backupType === "full_workstation_backup";

                if (isFullBackup || (looksLikeBundle && has('library') && Array.isArray(data.library))) {
                    const total = Array.isArray(data.library) ? data.library.length : 0;
                    const result = await this._importLibraryRecords(data.library);
                    if (has('activeWorkspace')) this.loadProfileData(data.activeWorkspace);
                    await this.renderLibrary();
                    this._reportLibraryRestore(result, total, "Workstation backup restored -");
                    return;
                }

                if (looksLikeBundle && (data.eqData || data.sliders)) {
                    const total = Array.isArray(data.library) ? data.library.length : 0;
                    const result = await this._importLibraryRecords(data.library);
                    const workspaceToLoad = has('activeWorkspace') ? data.activeWorkspace : data;
                    this.loadProfileData(workspaceToLoad);
                    await this.renderLibrary();
                    this._reportLibraryRestore(result, total, "Workspace and library restored -");
                    return;
                }

                this.loadProfileData(data);
                const nameLabel = (data.brand || data.model) ? `${data.brand || ''} ${data.model || ''}` : "Profile";
                showToast(`Loaded ${nameLabel.trim()} successfully!`, "📥");
            } catch (err) {
                console.error("Import failed:", err);
                // The file parsed (JSON.parse already succeeded); this is a
                // failure further in, so do not claim the file was unreadable.
                showToast("Import failed: " + (err && err.message ? err.message : String(err)), "⚠️", { duration: 6000 });
            }
        },
};
