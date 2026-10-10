// PEQDB Similar search: find curves close to the active EQ/target and render the results list.
// Split out of peqdb-module.js; merged into PEQDB_Module via Object.assign there.
const PEQDB_SimilarMethods = {
setSearchMode: function(mode) {
                this.searchMode = (mode === 'similar') ? 'similar' : 'database';
                const searchBox = document.getElementById('peqdb-search');
                const suggestions = document.getElementById('peqdb-search-suggestions');
                const hideSearch = this.searchMode === 'similar';
                const searchWrap = document.getElementById('peqdb-search-wrap');
                if (searchWrap) searchWrap.classList.toggle('hidden', hideSearch);
                if (searchBox) searchBox.classList.toggle('hidden', hideSearch);
                // The suggestions box is only ever shown while the user types;
                // a mode switch must never reveal it empty.
                if (suggestions) suggestions.classList.add('hidden');
                this.ensureSimilarList();
                const dbList = document.getElementById('peqdb-list');
                const simList = document.getElementById('similar-list');
                if (this.searchMode === 'similar') {
                    if (dbList) dbList.classList.add('hidden');
                    if (simList) simList.classList.remove('hidden');
                    this.similarDirty = false;
                    this.findSimilarCurves();
                } else {
                    if (simList) simList.classList.add('hidden');
                    if (dbList) {
                        dbList.classList.remove('hidden');
                        this.renderList();
                    }
                }
                this.updateSearchModeButtons();
            },

            ensureSimilarList: function() {
                if (document.getElementById('similar-list')) return;
                const wrapper = document.getElementById('peqdb-list-wrapper');
                if (!wrapper) return;
                const listEl = document.createElement('div');
                listEl.id = 'similar-list';
                listEl.className = 'flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5 mt-1 mx-1 hidden';
                wrapper.appendChild(listEl);
            },

            updateSearchModeButtons: function() {
                const sim = document.getElementById('btn-sim-mode');
                const db = document.getElementById('btn-db-mode');
                const simOn = this.searchMode === 'similar';
                if (sim) {
                    sim.classList.toggle('active', simOn);
                    // R8: aria-selected follows .active so the row is announced
                    // correctly rather than only looking selected.
                    sim.setAttribute('aria-selected', simOn ? 'true' : 'false');
                }
                if (db) {
                    db.classList.toggle('active', !simOn);
                    db.setAttribute('aria-selected', simOn ? 'false' : 'true');
                }
            },

        handleSimilarityResults: function(matches, fingerprint) {
        this.similarDirty = false;
        this._similarCalculating = false;
        this._similarHasEverLoaded = true;

        this._lastMatches = matches;
        const basisCurve = this.STATE.activeCurves.find(c => (c.role === 'target' || c.role === 'base') && c.visible);
        if (basisCurve && Array.isArray(matches)) {
            matches = matches.filter(m => m.id !== basisCurve.id);
        }
        SimilarCurvesCache.results = matches;
        // Use the fingerprint captured when the search was issued, never
        // recompute at arrival time (the user may have changed the target
        // while the search was running).
        if (fingerprint !== undefined) {
            SimilarCurvesCache.targetHash = fingerprint;
        }
        SimilarCurvesCache.query = document.getElementById('peqdb-search')?.value.trim().toLowerCase() || '';
        const referenceName = "DSP Curve";

        // Flat list sorted by similarity descending (no brand grouping) + enrich with form_factor
        const datasetById2 = (this.STATE.dataset) ? new Map(this.STATE.dataset.map(i => [i.id, i])) : null;
        const enriched = matches.map(m => {
            let ff = m.form_factor;
            if (!ff && datasetById2) {
                const di = datasetById2.get(m.id);
                if (di) ff = di.form_factor;
            }
            return { ...m, form_factor: ff || 'IEM' };
        });
        const sortedMatches = enriched
            .filter(m => m.similarity >= 50)
            .sort((a, b) => b.similarity - a.similarity);

        this._lastSimilarTotal = sortedMatches.length;
        this._lastSimilarMatches = sortedMatches;
        this._lastSimilarRefName = referenceName;
        
        if (!this._similarFormFactorFilters) {
            this._similarFormFactorFilters = { iem: false, earbuds: false, tws: false, headphones: false, wireless: false };
        }
        this.renderSimilarList(this._lastSimilarMatches, referenceName);
        },

        findSimilarCurves: function() {
    const listEl = document.getElementById('similar-list');
    if (!listEl) return;

    if (EQ_Module.isDragging) {
        this.similarDirty = true;
        return;
    }

    if (!this._similarTargetEverModified) {
        if (this.searchMode === 'similar') {
            listEl.innerHTML = '<div class="text-zinc-450 italic text-center text-xs mt-6">⚡ 0 matches — adjust the DSP curve (drag the band dots, EQ sliders, or run AutoEQ) to find similar IEMs.</div>';
            const countEl = document.getElementById('peqdb-result-count');
            if (countEl) countEl.textContent = '0';
        }
        return;
    }

    const searchInput = document.getElementById('peqdb-search');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (SimilarCurvesCache.isValid(query) && SimilarCurvesCache.results && SimilarCurvesCache.results.length > 0) {
        this.handleSimilarityResults(SimilarCurvesCache.results);

        return;
    }

    if (!this._similarHasEverLoaded) {
        listEl.innerHTML = '<div class="text-zinc-450 italic text-center text-xs mt-6">⚡ Calculating matching curves...</div>';
    }

    let targetInterp = null;

        {
            const points = 500;

            if (!this.compositeBuffer) {
                this.compositeBuffer = new Float32Array(points);
                this.magResBuffer = new Float32Array(points);
                this.phaseResBuffer = new Float32Array(points);
                this.freqsBuffer = new Float32Array(this.DSP.FREQS);
            }

                const freqs = this.freqsBuffer;
                const composite = this.compositeBuffer;
                composite.fill(80.0);

                const realValues = EQ_Module.getRealValues();
                // The graph draws with the EFFECTIVE preamp (auto-gain,
                // hearing/loudness/tone headroom folded in), so the Similar
                // composite must use the same value or the match target sits
                // off by exactly that compensation delta whenever any of
                // those features is active.
                const effPreamp = (typeof EQ_Module.computeEffectivePreamp === 'function')
                    ? EQ_Module.computeEffectivePreamp()
                    : realValues.preVal;

                let baselineInterp = null;
                const activeBase = this.STATE.activeCurves.find(c => c.role === 'base');
                if (activeBase) {
                    baselineInterp = this.DSP.interpolate(this.getNormalizedData(activeBase.data, activeBase.name));
                }

                for (let i = 0; i < points; i++) {
                    composite[i] = (baselineInterp ? baselineInterp[i] : 80.0) + effPreamp;
                }

                // Match against the cached composite magnitude that the graph
                // itself draws: it covers main + advanced + virtual bands plus
                // every active sim, honors bypassed bands and the EQ on/off
                // toggle, and matches what the user hears.
                if (EQ_Module.graphBuilt) {
                    const mag = EQ_Module.getCompositeFilterMagnitude(freqs, points);
                    for (let j = 0; j < points; j++) {
                        composite[j] += 20 * Math.log10(Math.max(1e-10, mag[j]));
                    }
                }
                targetInterp = composite;
            }

            if (!targetInterp) return;

            // Slim candidate list: only id/name/variant/source/cachedInterp.
            // Lazily-loaded or imported curves get their interpolation computed
            // inline here so they are never silently dropped by a stale cache.
            // Entries cached under an older alignment version are recomputed
            // (version-stamp invalidation — see updateAlignmentCfgActual).
            const lightweightDs = [];
            const fullDs = this.STATE.dataset || [];
            const alignVer = this._alignmentVersion || 0;
            for (let i = 0; i < fullDs.length; i++) {
                const item = fullDs[i];
                if (!item.cachedInterp || item._cachedInterpVer !== alignVer) {
                    if (item.data) {
                        try {
                            const norm = this.getNormalizedData(item.data, item.name);
                            item.cachedInterp = Array.from(this.DSP.interpolate(norm));
                            item._cachedInterpVer = alignVer;
                        } catch (e) {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }
                lightweightDs.push({
                    id: item.id,
                    name: item.name,
                    variant: item.variant,
                    source: item.source,
                    cachedInterp: item.cachedInterp
                });
            }

            const probeFreqs = CurveUtils.SIM_PROBE_FREQS;
            const probesIdx = CurveUtils.probeIndices(this.DSP.FREQS, probeFreqs);
            const weights = probeFreqs.map(f => CurveUtils.weightFor(f));
            const midMask = probeFreqs.map(f =>
                (f >= CurveUtils.MID_MEAN_BAND[0] && f <= CurveUtils.MID_MEAN_BAND[1]) ? 1 : 0
            );

            this._similarTargetInterp = Array.from(targetInterp);
            const threshold = 8.0;
            const matches = computeSimilarityScores(
                targetInterp, lightweightDs, probesIdx, weights, midMask, threshold
            );
            this.handleSimilarityResults(matches, SimilarCurvesCache.getTargetFingerprint());
        },

        renderSimilarList: function(matches, refName, preserveScroll = true) {
            const list = document.getElementById('similar-list');
            if (!list) return;

            const savedScrollTop = preserveScroll ? list.scrollTop : 0;

            // Ensure filter state exists - specs-tab style: all gray = no filter = show all
            if (!this._similarFormFactorFilters) {
                this._similarFormFactorFilters = { iem: false, earbuds: false, tws: false, headphones: false, wireless: false };
            }
            const formFactorMap = {
                'IEM': 'iem',
                'Earbuds (Wired)': 'earbuds',
                'Wireless Earbuds (TWS)': 'tws',
                'Over-Ear Headphones (Wired)': 'headphones',
                'Wireless Over-Ear Headphones': 'wireless'
            };

            const datasetById = (this.STATE.dataset) ? new Map(this.STATE.dataset.map(d => [d.id, d])) : null;
            const activeCurves = this.STATE.activeCurves;
            const badgeFor = (item) => {
                const loadedCurve = activeCurves.find(c => c.id === item.id);
                if (loadedCurve) {
                    return `<span class="text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 text-white flex-shrink-0" style="background-color: ${loadedCurve.color}">${loadedCurve.role.toUpperCase()}</span>`;
                }
                return `<span class="text-[8px] text-zinc-500 uppercase tracking-widest font-black">LOAD</span>`;
            };

            // Filter and re-rank by form factor - specs-tab logic: none selected = show all, else filter to selected
            const activeFilters = this._similarFormFactorFilters;
            const anySelected = Object.values(activeFilters).some(v => v);
            const filteredMatches = !anySelected ? matches : matches.filter(m => {
                let ff = m.form_factor;
                if (!ff && datasetById) {
                    const di = datasetById.get(m.id);
                    if (di) ff = di.form_factor;
                }
                ff = ff || 'IEM';
                const key = formFactorMap[ff] || 'iem';
                return !!activeFilters[key];
            });

            this._lastSimilarFiltered = filteredMatches;
            this._lastSimilarTotalFiltered = filteredMatches.length;

const countEl = document.getElementById('peqdb-result-count');
            if (countEl) countEl.textContent = String(filteredMatches.length);

            const filterIcons = [
                { key: 'iem', label: 'IEM', icon: 'app/icons/iem.png' },
                { key: 'earbuds', label: 'Earbuds', icon: 'app/icons/earbud.png' },
                { key: 'tws', label: 'TWS', icon: 'app/icons/tws.png' },
                { key: 'headphones', label: 'Over-Ear Headphones', icon: 'app/icons/headphone.png' },
                { key: 'wireless', label: 'Wireless Over-Ear', icon: 'app/icons/wireless.png' }
            ];

            // Rendered as bare find-pick-badge buttons (same class the Specs
            // tab's form-factor chips use) so sizing, grayed-out/active
            // states, and hover behavior are identical and pixel-symmetrical
            // with the rest of the app — no per-icon box/container.
            let filterHtml = '<div class="flex items-center justify-center gap-0.5 mb-2 py-1 overflow-x-hidden w-full max-w-full similar-formfactor-filters">';
            filterIcons.forEach(f => {
                const isActive = !!this._similarFormFactorFilters[f.key];
                // Was onclick="PEQDB_Module.toggleSimilarFormFactor('<key>')", built
                // by string concatenation with the quotes spliced in by hand. As a
                // data attribute the key goes through esc() like every other one.
                filterHtml += '<button type="button" data-cmd="PEQDB_Module.toggleSimilarFormFactor" data-arg-0="' + esc(f.key) + '" class="no-tactile find-pick-badge' + (isActive ? ' on' : '') + '" data-tooltip="' + f.label + '" title="' + f.label + '" aria-pressed="' + isActive + '">';
                filterHtml += '<img src="' + f.icon + '" alt="' + f.label + '" draggable="false">';
                filterHtml += '</button>';
            });
            filterHtml += '</div>';

            let html = '<div class="text-[9px] text-zinc-555 font-bold uppercase tracking-wider mb-2 border-b border-[var(--border-color)] pb-1 flex justify-between items-center mr-3 select-none">' +
                '<span>Matches for:</span>' +
                '<span class="text-[var(--accent-amber)] truncate max-w-[130px]" title="' + esc(refName) + '">' + esc(refName) + '</span>' +
                '</div>' + filterHtml;

            if (filteredMatches.length === 0) {
                html += '<div class="text-zinc-500 text-[11px] italic text-center mt-8 p-4 border border-dashed border-zinc-800">' +
                    (anySelected ? 'No matches for selected form factors.<br><span class="text-[10px]">Try enabling more filters.</span>' : '&#9889; 0 matches &mdash; adjust the DSP curve to find similar IEMs.') +
                    '</div>';
            } else {
                // Cap the rendered cards. This list had no limit at all while the
                // Database list is chunked at 40 (`listRenderLimit`) and
                // fillVisibleList is depth-capped at 25. The 50% similarity
                // threshold is low enough that a near-flat DSP target matches a
                // large fraction of a 5,000-curve catalogue, and every card is
                // built with createElement + innerHTML + outerHTML before being
                // concatenated into one multi-megabyte string — a multi-second
                // input freeze. `matches` is already sorted best-first, so the
                // top slice is the part the user actually reads.
                const RENDER_CAP = 150;
                const shown = filteredMatches.slice(0, RENDER_CAP);
                shown.forEach((match, idx) => {
                    const rank = idx + 1;
                    const fullItem = datasetById ? (datasetById.get(match.id) || match) : match;
                    html += this.buildDbModelCard(fullItem, {
                        rank,
                        similarity: match.similarity,
                        badgeHtml: badgeFor(match)
                    }).outerHTML;
                });
                if (filteredMatches.length > shown.length) {
                    // Never hide that the list was truncated — the count above
                    // still reports the true total.
                    html += '<div class="text-[10px] text-zinc-500 italic text-center mt-4 p-3 border border-dashed border-zinc-800">' +
                        'Showing the top ' + shown.length + ' of ' + filteredMatches.length +
                        ' matches &mdash; the closest curves are ranked first. Refine the EQ to narrow the field.' +
                        '</div>';
                }
            }

            list.innerHTML = html;
            // (lastSimilarHTML dead store removed: it re-serialized the
            // entire just-built list into a JS string every rescan —
            // megabytes of transient garbage at 1000+ matches — and had no
            // readers anywhere.)

            list.style.overflowX = 'hidden';
            setTimeout(() => {
                const dbTitles = list.querySelectorAll('.db-title-text, .db-file-marquee-text');
                Array.from(dbTitles).slice(0, 200).forEach(el => {
                    if (!el.classList.contains('marquee-orbit-active')) activateOrbitMarquee(el);
                });
                // Constrain any large product images inside cards to prevent horizontal scroll
                list.querySelectorAll('.peqdb-row-item img').forEach(img => {
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                });
            }, 80);

            if (preserveScroll) list.scrollTop = savedScrollTop;
        },

        toggleGroupExpand: function(header) {
            const card = header.closest('.peqdb-row-item') || header.closest('div.p-2');
            const drawer = card.querySelector('.similar-items-drawer');
            const arrow = card.querySelector('.group-arrow');
            const groupName = card.dataset.groupName || (card.querySelector('.font-bold') ? card.querySelector('.font-bold').textContent.trim() : '');

            if (!this.expandedGroups) this.expandedGroups = new Set();

            if (drawer && arrow) {
                const hidden = drawer.classList.toggle('hidden');
                arrow.textContent = hidden ? "▼" : "▲";
                if (hidden) {
                    this.expandedGroups.delete(groupName);
                } else {
                    this.expandedGroups.add(groupName);
                    // Lazy-fill: an expand of a group that rendered while
                    // collapsed has no child cards yet — build them now.
                    if (!drawer.querySelector('.peqdb-row-item') && this._lastSimilarGroups) {
                        const groupIdx = Number(card.dataset.groupIdx);
                        const group = this._lastSimilarGroups[groupIdx];
                        if (group) {
                            const datasetById = (this.STATE.dataset) ? new Map(this.STATE.dataset.map(d => [d.id, d])) : null;
                            const activeCurves = this.STATE.activeCurves;
                            const badgeFor = (item) => {
                                const loadedCurve = activeCurves.find(c => c.id === item.id);
                                if (loadedCurve) {
                                    return `<span class="text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 text-white flex-shrink-0" style="background-color: ${loadedCurve.color}">${loadedCurve.role.toUpperCase()}</span>`;
                                }
                                return `<span class="text-[8px] text-zinc-500 uppercase tracking-widest font-black">LOAD</span>`;
                            };
                            const rank = groupIdx + 1;
                            drawer.innerHTML = group.items.map(item => {
                                const fullItem = datasetById ? (datasetById.get(item.id) || item) : item;
                                return this.buildDbModelCard(fullItem, {
                                    rank,
                                    similarity: item.similarity,
                                    badgeHtml: badgeFor(item)
                                }).outerHTML;
                            }).join('');
                            setTimeout(() => {
                                const titles = drawer.querySelectorAll('.db-title-text, .db-file-marquee-text');
                                Array.from(titles).slice(0, 200).forEach(el => {
                                    if (!el.classList.contains('marquee-orbit-active')) activateOrbitMarquee(el);
                                });
                            }, 50);
                        }
                    }
                }
            }
        },

        toggleSimilarFormFactor: function(key) {
            if (!this._similarFormFactorFilters) {
                this._similarFormFactorFilters = { iem: false, earbuds: false, tws: false, headphones: false, wireless: false };
            }
            // Specs-tab logic: gray = no filter, colored = filter active. Simple toggle.
            this._similarFormFactorFilters[key] = !this._similarFormFactorFilters[key];
            if (this._lastSimilarMatches) {
                this.renderSimilarList(this._lastSimilarMatches, this._lastSimilarRefName || 'DSP Curve', false);
            }
        },

        rescoreSimilarItemFile: async function(item) {
            const target = this._similarTargetInterp;
            if (!target || (!this._lastSimilarMatches && !this._lastSimilarGroups)) return;
            const idx = this.dbItemFileIndex[item.id] || 0;
            if (!this._fileSwitchTokens) this._fileSwitchTokens = {};
            const token = (this._fileSwitchTokens[item.id] = (this._fileSwitchTokens[item.id] || 0) + 1);
            const targetFile = item.files && item.files[idx] ? item.files[idx] : item.primaryFilePath;
            if (!targetFile) return;

            if (!(item.sourcesCache && item.sourcesCache[targetFile])) {
                try { await CurveIndexer.loadCurve(item, idx); } catch (e) { return; }
            }
            if (this._fileSwitchTokens[item.id] !== token) return;
            const parsed = (item.sourcesCache && item.sourcesCache[targetFile]) || item.data;
            if (!parsed || parsed.length < 2) return;

            const norm = this.getNormalizedData(parsed, item.name);
            const interp = Array.from(this.DSP.interpolate(norm));

            const probeFreqs = CurveUtils.SIM_PROBE_FREQS;
            const probesIdx = CurveUtils.probeIndices(this.DSP.FREQS, probeFreqs);
            const weights = probeFreqs.map(f => CurveUtils.weightFor(f));
            const midMask = probeFreqs.map(f =>
                (f >= CurveUtils.MID_MEAN_BAND[0] && f <= CurveUtils.MID_MEAN_BAND[1]) ? 1 : 0
            );
            const fakeItem = { id: item.id, name: item.name, variant: item.variant, source: item.source, cachedInterp: interp };
            const scores = computeSimilarityScores(target, [fakeItem], probesIdx, weights, midMask, 8.0);
            if (!scores.length || this._fileSwitchTokens[item.id] !== token) return;
            const sim = scores[0].similarity;

            const matches = SimilarCurvesCache.results;
            if (Array.isArray(matches)) {
                const m = matches.find(x => x.id === item.id);
                if (m) m.similarity = sim;
            }
            // Update flat matches list
            if (this._lastSimilarMatches) {
                const mm = this._lastSimilarMatches.find(x => x.id === item.id);
                if (mm) mm.similarity = sim;
                // Keep sorted order
                this._lastSimilarMatches.sort((a,b)=> b.similarity - a.similarity);
            }
            // Back-compat for old grouped cache
            if (this._lastSimilarGroups) {
                const group = this._lastSimilarGroups.find(g => g.items.some(it => it.id === item.id));
                if (group) group.bestSimilarity = Math.max(...group.items.map(it => it.similarity));
            }
            this.renderSimilarList(this._lastSimilarMatches || this._lastSimilarGroups, this._lastSimilarRefName || '');
        },
};
