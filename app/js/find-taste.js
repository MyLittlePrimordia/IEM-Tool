// Find taste profile: favorites, fingerprint, chips and taste search.
// Split out of find-engine.js; merged into FindEngine via Object.assign there.
const Find_TasteMethods = {
                loadSavedTasteFavorites: function() {
                    try {
                        const saved = localStorage.getItem('find_taste_favorites');
                        if (saved) {
                            const parsed = JSON.parse(saved);
                            // Shape validation (same discipline as
                            // _getSpecSelection): a valid-JSON non-array
                            // (legacy format, partial write, hand edit) made
                            // .map/.some throw in taste flows — crash-on-scan
                            // and crash-on-type until the key was cleared.
                            this.tasteFavorites = Array.isArray(parsed)
                                ? parsed.filter(f => f && typeof f === 'object' && f.id)
                                : [];
                        }
                    } catch(e) { this.tasteFavorites = []; }
                    this.renderTasteChips();
                },

                saveTasteFavorites: function() {
                    try {
                        localStorage.setItem('find_taste_favorites', JSON.stringify(this.tasteFavorites));
                    } catch(e) {}
                },

                handleTasteSearchDebounced: debounce(function(query) { FindEngine.handleTasteSearch(query); }, 160),

                handleTasteSearch: function(query) {
                    const container = document.getElementById('find-taste-results');
                    if (!container) return;
                    const hasQuery = !!(query && query.trim());
                    container.classList.remove('hidden');

                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const dbList = this.iemDatabase || [];

                    const seenIds = new Set();
                    const candidates = [];

                    dataset.forEach(item => {
                        if (item && item.id) {
                            seenIds.add(item.id);
                            candidates.push(item);
                        }
                    });

                    dbList.forEach(db => {
                        if (db && db.id && !seenIds.has(db.id)) {
                            seenIds.add(db.id);
                            candidates.push({
                                id: db.id,
                                name: (db.variant ? `${db.brand} ${db.model} (${db.variant})` : `${db.brand} ${db.model}`).trim(),
                                brand: db.brand,
                                model: db.model,
                                variant: db.variant,
                                files: db.files || []
                            });
                        }
                    });

                    const matches = candidates.filter(item => {
                        if (!hasQuery) return true;
                        return PEQDB_Module.matchSearchTokensNorm(this._fnSearchNorm(item, true), query);
                    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                    if (matches.length === 0) {
                        container.innerHTML = '<span class="text-zinc-500 italic font-bold text-xs p-1 block">No matches found.</span>';
                        return;
                    }

                    let html = '';
                    const limit = matches.length;
                    for (let i = 0; i < limit; i++) {
                        const item = matches[i];
                        const isAdded = this.tasteFavorites.some(f => f.id === item.id);

                        html += `
                            <div class="peqdb-row-item flex items-center justify-between p-1.5 cursor-pointer hover:bg-[var(--bg-card)] mb-1 transition-all select-none" data-cmd="FindEngine.addTasteFavorite" data-arg-0="${escJs(item.id)}">
                                <span class="text-xs text-stone-200 font-bold truncate flex-1 pr-2">${esc(item.name)}</span>
                                ${isAdded ? '<span class="text-[9px] text-rose-400 font-black flex-shrink-0 ml-1">✓ Added</span>' : '<span class="text-[9px] text-[var(--accent-blue)] font-black flex-shrink-0 ml-1">+ Add</span>'}
                            </div>
                        `;
                    }

                    container.innerHTML = html;
                },

                tasteFavorites: [],

                addTasteFavorite: function(id) {
                    if (this.tasteFavorites.length >= 3) {
                        showToast("Maximum 3 favorites. Remove one first.", "⚠️");
                        return;
                    }

                    let item = (PEQDB_Module.STATE.dataset || []).find(i => i.id === id);
                    if (!item && this.iemDatabase) {
                        const dbMatch = this.iemDatabase.find(d => d.id === id);
                        if (dbMatch) {
                            item = { id: dbMatch.id, name: `${dbMatch.brand} ${dbMatch.model}`.trim() };
                        }
                    }

                    if (!item) return;
                    if (this.tasteFavorites.some(f => f.id === id)) {
                        showToast("Already added!", "ℹ️");
                        return;
                    }

                    this.tasteFavorites.push({ id: item.id, name: item.name });
                    this.saveTasteFavorites();
                    this.renderTasteChips();

                    const searchInput = document.getElementById('find-taste-search');
                    const container = document.getElementById('find-taste-results');
                    if (searchInput) {
                        searchInput.value = '';
                    }
                    if (container) {
                        container.classList.add('hidden');
                    }

                    showToast('Added "' + item.name + '" to favorites!', '❤️');
                },

                removeTasteFavorite: function(id) {
                    this.tasteFavorites = this.tasteFavorites.filter(f => f.id !== id);
                    this.saveTasteFavorites();
                    this.renderTasteChips();
                },

                generateTasteFingerprint: async function() {
                    const box = document.getElementById('find-taste-fingerprint');
                    const textEl = document.getElementById('find-taste-fingerprint-text');
                    if (!box || !textEl) return;

                    if (this.tasteFavorites.length === 0) {
                        box.classList.add('hidden');
                        return;
                    }

                    box.classList.remove('hidden');

                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const selected = this.tasteFavorites.map(f => f.id);

                    await Promise.all(selected.map(async (id) => {
                        const item = dataset.find(i => i.id === id);
                        if (item && (!item.data || item.data.length < 2)) {
                            await CurveIndexer.loadCurve(item, 0);
                        }
                    }));

                    const freqs = CurveUtils.generateLogGrid(50);
                    const avgInterp = new Float32Array(freqs.length).fill(0);
                    let validCount = 0;

                    selected.forEach(id => {
                        const item = dataset.find(i => i.id === id);
                        if (item && item.data) {
                            const normalized = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const interp = CurveUtils.cubicSplineInterpolate(normalized, freqs);
                            for (let i = 0; i < freqs.length; i++) avgInterp[i] += interp[i];
                            validCount++;
                        }
                    });

                    if (validCount === 0) {
                        textEl.textContent = "Search to analyze acoustic profile...";
                        return;
                    }

                    for (let i = 0; i < freqs.length; i++) avgInterp[i] /= validCount;

                    const getBandDb = (minHz, maxHz) => {
                        let sum = 0, count = 0;
                        for (let i = 0; i < freqs.length; i++) {
                            if (freqs[i] >= minHz && freqs[i] <= maxHz) {
                                sum += avgInterp[i];
                                count++;
                            }
                        }
                        return count > 0 ? (sum / count) : 75;
                    };

                    const subBass = getBandDb(20, 60);
                    const midBass = getBandDb(60, 250);
                    const midRef  = getBandDb(400, 800);
                    const vocals  = getBandDb(2000, 4000);
                    const treble  = getBandDb(6000, 10000);

                    const bassBoost = subBass - midRef;
                    const warmth = midBass - midRef;
                    const vocalPresence = vocals - midRef;
                    const trebleBoost = treble - midRef;

                    const traits = [];

                    if (bassBoost > 6.0) traits.push({ emoji: "🌊", label: "Sub-Bass Rumble" });
                    else if (bassBoost > 3.0) traits.push({ emoji: "🥊", label: "Punchy Slam" });
                    else traits.push({ emoji: "⚖️", label: "Neutral Bass" });

                    if (warmth > 2.0) traits.push({ emoji: "🌿", label: "Warm Mids" });
                    else traits.push({ emoji: "🧼", label: "Clean Mids" });

                    if (vocalPresence > 5.0) traits.push({ emoji: "🎤", label: "Forward Vocals" });
                    else if (vocalPresence < 2.0) traits.push({ emoji: "😌", label: "Relaxed Mids" });

                    if (trebleBoost > 3.0) traits.push({ emoji: "✨", label: "Crisp Sparkle" });
                    else if (trebleBoost < -2.0) traits.push({ emoji: "🌑", label: "Dark Treble" });
                    else traits.push({ emoji: "🧈", label: "Smooth Air" });

                    textEl.innerHTML = traits.map(t => `
                        <span class="spec-icon-badge" style="font-size: 20px !important; width: 26px !important; height: 26px !important;" data-tooltip="${t.label}">${t.emoji}</span>
                    `).join('');
                },

                renderTasteChips: function() {
                    const container = document.getElementById('find-taste-chips');
                    const btn = document.getElementById('find-taste-btn-scan');
                    if (!container) return;

                    container.innerHTML = '';

                    for (let i = 0; i < 3; i++) {
                        const f = this.tasteFavorites[i];
                        if (f) {
                            const div = document.createElement('div');
                            // R2: was an inline `box-shadow: 2px 2px 0 #000`
                            // plus a 2px border — a hard square slab. Now a
                            // raised row with a hairline and a rounded corner,
                            // matching every other list row in the app.
                            div.className = 'flex items-center justify-between gap-2 select-none w-full h-9 relative px-3';
                            div.style.cssText = 'background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--r-md);';
                            div.innerHTML = `
                                <div class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                    <span class="emoji-font vibrant-emoji text-lg flex-shrink-0 overflow-visible" style="line-height: 1.25;">❤️</span>
                                    <span class="text-xs font-semibold truncate" style="color: var(--text-hi);">${esc(f.name)}</span>
                                </div>
                                <button type="button" data-cmd="FindEngine.removeTasteFavorite" data-arg-0="${escJs(f.id)}" class="w-6 h-6 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0" style="border-radius: var(--r-xs); background: transparent; color: var(--text-lo); border: 1px solid transparent;" title="Remove ${esc(f.name)}">✕</button>
                            `;
                            container.appendChild(div);
                        } else {
                            // R2: was `border-2 border-dashed border-black` with
                            // square corners. Now the shared .slot-empty well.
                            const div = document.createElement('div');
                            div.className = 'slot-empty w-full h-9 flex items-center justify-center select-none';
                            div.innerHTML = `<span class="text-[9px] font-semibold uppercase tracking-wider">+ Favorite ${i + 1}</span>`;
                            container.appendChild(div);
                        }
                    }

                    if (btn) {
                        if (this.tasteFavorites.length >= 2) {
                            btn.disabled = false;
                            btn.classList.remove('cursor-not-allowed', 'opacity-40');
                        } else {
                            btn.disabled = true;
                            btn.classList.add('cursor-not-allowed', 'opacity-40');
                        }
                    }

                    this.generateTasteFingerprint();
                },
};
