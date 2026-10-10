// IEM review tab database search: pick an IEM from the catalogue and fill the review from it.
// Split out of iem-module.js; merged into IEM_Module via Object.assign there.
const IEM_DbSearchMethods = {
        _iemDbSearchTimer: null,

        _iemDbFileIdx: {},

        _iemDbActiveId: null,

        getIemDatabase: function() {
            try {
                if (typeof CurveIndexer !== 'undefined' && Array.isArray(CurveIndexer.catalog) && CurveIndexer.catalog.length > 0) {
                    return CurveIndexer.catalog;
                }
            } catch (e) {}
            if (typeof FindEngine !== 'undefined' && Array.isArray(FindEngine.iemDatabase)) {
                return FindEngine.iemDatabase;
            }
            if (typeof PEQDB_Module !== 'undefined' && Array.isArray(PEQDB_Module.STATE.dataset)) {
                return PEQDB_Module.STATE.dataset;
            }
            return [];
        },

onDbSearchInput: function(value) {
            clearTimeout(this._iemDbSearchTimer);
            this._iemDbSearchTimer = setTimeout(() => this.renderIemDbSearch(value), 140);
        },

        _initIemSearchIndex: function() {
            if (this._iemSearchIndexInitialized) return;
            const db = this.getIemDatabase();
            if (db && db.length > 0 && window.IemSearchIndex) {
                window.IemSearchIndex.init(db);
                this._iemSearchIndexInitialized = true;
            }
        },

        renderIemDbSearch: function(query) {
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            this._initIemSearchIndex();
            const db = this.getIemDatabase();
            const q = (query || '').trim().toLowerCase();
            const countEl = document.getElementById('iem-db-result-count');

            if (db.length === 0 && !q) {
                list.innerHTML = '<div class="text-zinc-600 text-xs italic text-center mt-6">Database still loading…</div>';
                if (countEl) countEl.textContent = '0';
                if (!this._iemDbSearchRetry) {
                    this._iemDbSearchRetry = true;
                    setTimeout(() => { this._iemDbSearchRetry = false; this.renderIemDbSearch(''); }, 900);
                }
                return;
            }

            let matches = [];
            if (!q) {
                matches = db;
            } else {
                matches = window.IemSearchIndex ? window.IemSearchIndex.search(q) : [];
            }

            if (matches.length === 0) {
                list.innerHTML = '<div class="text-zinc-600 text-xs italic text-center mt-6">No database entry matched.</div>';
                if (countEl) countEl.textContent = '0';
                return;
            }

            if (countEl) countEl.textContent = matches.length;

            if (!this._iemDbExpandedBrands) this._iemDbExpandedBrands = new Set();
            if (!this._iemBrandCache) this._iemBrandCache = {};

            list.innerHTML = '';
            const escSafe = (str) => esc(str || '');

            const brandBuckets = new Map();
            matches.forEach(item => {
                const brand = item.brand || 'Unknown Brand';
                if (!brandBuckets.has(brand)) brandBuckets.set(brand, []);
                brandBuckets.get(brand).push(item);
            });
            this._iemBrandCache = {};
            brandBuckets.forEach((items, brand) => { this._iemBrandCache[brand] = items; });
            const sortedBrands = Array.from(brandBuckets.keys()).sort((a, b) => a.localeCompare(b));

            for (const brandName of sortedBrands) {
                const items = brandBuckets.get(brandName);
                const isExpanded = this._iemDbExpandedBrands.has(brandName);
                const groupEl = document.createElement('div');
                groupEl.className = 'mb-1.5 w-full min-w-0 flex flex-col';
                groupEl.setAttribute('data-iem-brand', brandName);
                groupEl.setAttribute('data-letter', alphaKeyOf({ brand: brandName }));
                groupEl.innerHTML = `
                    <div class="flex items-center justify-between p-2 cursor-pointer select-none border-2 border-black flex-shrink-0 w-full min-w-0" style="background: var(--bg-input);" data-cmd="IEM.toggleIemDbBrand" data-arg-0="${escJs(brandName)}">
                        <span class="text-xs font-black uppercase tracking-wider text-[var(--accent-blue)] truncate min-w-0">${escSafe(brandName)}</span>
                        <span class="flex items-center gap-1.5 flex-shrink-0">
                            <span class="text-[9px] font-black text-zinc-500">${items.length}</span>
                            <span class="brand-group-arrow text-[10px] font-black text-[var(--text-secondary)] transition-transform duration-200">${isExpanded ? '▲' : '▼'}</span>
                        </span>
                    </div>
                `;
                const itemsContainer = document.createElement('div');
                itemsContainer.className = `brand-items-container w-full min-w-0 pl-2 pt-1.5 ${isExpanded ? '' : 'hidden'} flex flex-col gap-1.5`;
                if (isExpanded) {
                    items.forEach(item => itemsContainer.appendChild(this.buildIemDbModelCard(item)));
                }
                groupEl.appendChild(itemsContainer);
                list.appendChild(groupEl);
            }

            this.applyIemDbFileMarquees();
        },

        buildIemDbModelCard: function(item) {
            const itemName = `${item.brand}${item.model ? ' ' + item.model : ''}${item.variant ? ' (' + item.variant + ')' : ''}`;

            const fileCount = Array.isArray(item.files) ? item.files.length : 0;
            const isMulti = fileCount > 1;
            const curIdx = this._iemDbFileIdx[item.id] || 0;
            const activeFileIdx = Math.max(0, Math.min(curIdx, fileCount - 1));

            const filePath = (item.files && item.files[activeFileIdx]) ? item.files[activeFileIdx] : item.primaryFilePath;
            const pathParts = (filePath || '').split('/');
            const sourceName = pathParts.length >= 3 ? pathParts[1] : (pathParts.length >= 2 ? pathParts[0] : (item.source || 'Database'));
            const fileNameNoExt = String(pathParts[pathParts.length - 1] || '').replace(/\.[^/.]+$/, '');

            const formFactorEmojiMap = {
                'IEM': FindEngine.formFactorEmojis['IEM'],
                'Earbuds (Wired)': FindEngine.formFactorEmojis['Earbuds (Wired)'],
                'Wireless Earbuds (TWS)': FindEngine.formFactorEmojis['Wireless Earbuds (TWS)'],
                'Over-Ear Headphones (Wired)': FindEngine.formFactorEmojis['Over-Ear Headphones (Wired)'],
                'Wireless Over-Ear Headphones': FindEngine.formFactorEmojis['Wireless Over-Ear Headphones']
            };
            const formEmoji = formFactorEmojiMap[item.form_factor] || FindEngine.formFactorEmojis['IEM'];
            const driverTooltip = `${item.driver_type || 'Driver'}${item.driver_config ? ' (' + item.driver_config + ')' : ''}`;
            const driverEmoji = FindEngine.driverEmojis[item.driver_type] || '⚙️';
            const connectorEmoji = FindEngine.connectorEmojis[item.connector] || '🔌';

            const specIconsHtml = `
                ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:9px;">$${item.price_usd}</span></span>` : ''}
                ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:9px;">${item.year}</span></span>` : ''}
                ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${esc(item.connector)}">${connectorEmoji}</span>` : ''}
                <span class="spec-icon-badge" data-tooltip="${esc(item.form_factor || 'In-Ear Monitor (IEM)')}">${formEmoji}</span>
            `;
            const getTagEmoji = (tagStr) => {
                if (!tagStr) return '🏷️';
                const cleanKey = tagStr.toLowerCase().trim().replace(/[\s_]+/g, '-');
                const emojiMap = {
                    'basshead': '💥', 'sub-bass': '🌊', 'punchy-bass': '🥊', 'warm': '🌿', 'warm-tilt': '🌿',
                    'neutral': '⚖️', 'v-shaped': '🔺', 'balanced': '⚖️', 'bright': '✨', 'dark': '🌑',
                    'detailed': '💎', 'detail': '💎', 'resolving': '🔍', 'technical': '🔬', 'wide-stage': '🏟️',
                        'soundstage': '🏟️', 'good-imaging': '🔭', 'imaging': '🔭', 'smooth': '🧈', 'reference': '🎯',
                        'analytical': '🧠', 'fun': '🔥', 'relaxed': '😌', 'gaming': '🎮', 'competitive-gaming': '🏆',
                        'vocal-focused': '🗣️', 'vocal': '🎤', 'budget': '💰', 'mid-tier': '🪙', 'premium': '👑',
                        'flagship': '🥇', 'collab': '🤝', 'limited-edition': '🌟', 'vintage': '📼'
                };
                return emojiMap[cleanKey] || '🏷️';
            };
            const tagsHtml = (item.tags || []).slice(0, 4).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${getTagEmoji(t)}</span>`).join('');

            const isActive = (this._iemDbActiveId === item.id);
            const rowAccentColor = isActive ? 'var(--accent-blue)' : 'var(--border-color)';

            let fileRowHtml;
            if (isMulti) {
                fileRowHtml = `
                    <div class="flex items-center gap-1.5 mt-1">
                        <button data-cmd="IEM.cycleIemDbFile" data-arg-0="${escJs(item.id)}" data-arg-1="-1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black" style="background:${rowAccentColor}; color:${isActive ? '#fff' : 'var(--text-secondary)'};">◀</button>
                        <div class="flex-1 min-w-0 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="iem-db-file-marquee text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isActive ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                        </div>
                        <button data-cmd="IEM.cycleIemDbFile" data-arg-0="${escJs(item.id)}" data-arg-1="1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black" style="background:${rowAccentColor}; color:${isActive ? '#fff' : 'var(--text-secondary)'};">▶</button>
                    </div>
                `;
            } else {
                fileRowHtml = `
                    <div class="mt-1 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                        <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isActive ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
                    </div>
                `;
            }

            const div = document.createElement('div');
            div.className = 'peqdb-row-item p-2 mb-1.5 transition-all select-none cursor-pointer';
            div.setAttribute('data-id', item.id);
            if (isActive) {
                div.classList.add('is-loaded');
                div.style.setProperty('--row-glow', 'rgba(var(--accent-blue-rgb), 0.28)');
                div.style.setProperty('--row-glow-solid', 'var(--accent-blue)');
            }
            div.onclick = () => IEM.toggleIemDbSelection(item.id);
            div.innerHTML = `
                <div class="db-title-row overflow-hidden whitespace-nowrap">
                    <span class="db-title-text font-black text-stone-200 text-xs inline-block whitespace-nowrap">${esc(itemName)}</span>
                </div>
                <div class="text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
                <div class="flex flex-wrap items-center justify-center gap-1 mt-1">${specIconsHtml}</div>
                ${tagsHtml ? `<div class="flex flex-wrap items-center justify-center gap-1 mt-1">${tagsHtml}</div>` : ''}
                ${fileRowHtml}
            `;
            return div;
        },

        toggleIemDbBrand: function(brandName) {
            if (!this._iemDbExpandedBrands) this._iemDbExpandedBrands = new Set();
            if (this._iemDbExpandedBrands.has(brandName)) {
                this._iemDbExpandedBrands.delete(brandName);
            } else {
                this._iemDbExpandedBrands.add(brandName);
            }
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            list.querySelectorAll('[data-iem-brand]').forEach(group => {
                if (group.getAttribute('data-iem-brand') === brandName) {
                    const container = group.querySelector('.brand-items-container');
                    const arrow = group.querySelector('.brand-group-arrow');
                    const isOpen = this._iemDbExpandedBrands.has(brandName);
                    if (container) {
                        if (isOpen && container.children.length === 0 && this._iemBrandCache && this._iemBrandCache[brandName]) {
                            this._iemBrandCache[brandName].forEach(item => container.appendChild(this.buildIemDbModelCard(item)));
                        }
                        container.classList.toggle('hidden', !isOpen);
                    }
                    if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
                }
            });
            this.applyIemDbFileMarquees();
        },

        applyIemDbFileMarquees: function() {
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            requestAnimationFrame(() => {
                setTimeout(() => {
                    list.querySelectorAll('.iem-db-file-marquee, .db-file-marquee-text').forEach((el) => {
                        if (!el.classList.contains('marquee-orbit-active')) activateOrbitMarquee(el);
                    });
                }, 60);
            });
        },

        cycleIemDbFile: function(id, dir) {
            const db = this.getIemDatabase();
            const item = db.find(x => x.id === id);
            if (!item || !Array.isArray(item.files)) return;
            const fc = item.files.length;
            let cur = this._iemDbFileIdx[id] || 0;
            cur = (cur + dir + fc) % fc;
            this._iemDbFileIdx[id] = cur;
            const input = document.getElementById('iem-db-search-input');
            this.renderIemDbSearch(input ? input.value : '');
        },

        toggleIemDbSelection: function(itemId) {
            if (this._iemDbActiveId === itemId) {
                this.clearIemDbSelection();
            } else {
                this.applyDbEntryToReview(itemId);
            }
        },

        clearIemDbSelection: function() {
            this._iemDbActiveId = null;
            const searchInput = document.getElementById('iem-db-search-input');
            if (searchInput) this.renderIemDbSearch(searchInput.value);

            const snap = this._iemPreApplySnapshot || {};
            document.getElementById('brand').value = snap.brand || '';
            document.getElementById('model').value = snap.model || '';
            document.getElementById('price').value = snap.price || '';
            this.setListeningVolume(snap.listeningVolume || 'moderate');
            document.getElementById('sensitivity').value = snap.sensitivity || '110';
            if (snap.impedance != null) { const ie = document.getElementById('impedance'); if (ie) ie.value = snap.impedance; }
            this.setFormFactor(snap.formFactor || 'IEM');
            this.setConnector(snap.connector || '2-pin');
            this.selectedDriverTypes = snap.selectedDriverTypes || {};
            this.runDriverAutoLogic();
            if (snap.toneSliders) {
                snap.toneSliders.forEach(entry => {
                    const el = document.getElementById(entry.id);
                    if (el) { el.value = entry.value; const dv = document.getElementById(entry.id + '-val'); if (dv) dv.textContent = entry.display; }
                });
            }
            this.selectedTags.clear(); this.selectedGenres.clear(); this.selectedBass.clear();
            (snap.tags || []).forEach(t => this.selectedTags.add(t));
            (snap.genres || []).forEach(t => this.selectedGenres.add(t));
            (snap.bass || []).forEach(t => this.selectedBass.add(t));
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);
            this.renderReviewSelectedTags();
            this.updateAll();
            showToast("Selection cleared — review restored.", "↩️");
        },

        applyDbEntryToReview: async function(itemId) {
            const db = this.getIemDatabase();
            const item = db.find(x => x.id === itemId);
            if (!item) { showToast("Database entry not found.", "⚠️"); return; }

            this._iemPreApplySnapshot = {
                brand: document.getElementById('brand') ? document.getElementById('brand').value : '',
                model: document.getElementById('model') ? document.getElementById('model').value : '',
                price: document.getElementById('price') ? document.getElementById('price').value : '',
                listeningVolume: document.getElementById('listening-volume') ? document.getElementById('listening-volume').value : 'moderate',
                impedance: document.getElementById('impedance') ? document.getElementById('impedance').value : '32',
                sensitivity: document.getElementById('sensitivity') ? document.getElementById('sensitivity').value : '110',
                formFactor: this.formFactor || 'IEM',
                connector: this.connector || '2-pin',
                selectedDriverTypes: Object.assign({}, this.selectedDriverTypes || {}),
                tags: Array.from(this.selectedTags || []),
                genres: Array.from(this.selectedGenres || []),
                bass: Array.from(this.selectedBass || []),
                toneSliders: this.sliderNodes ? this.sliderNodes.map(n => ({ id: n.element.id, value: n.element.value, display: n.displayValueNode ? n.displayValueNode.textContent : n.element.value })) : []
            };

            const fileCount = Array.isArray(item.files) ? item.files.length : 0;
            const fileIdx = Math.max(0, Math.min(this._iemDbFileIdx[item.id] || 0, fileCount - 1));
            const targetFile = (item.files && item.files[fileIdx]) ? item.files[fileIdx] : null;

            showToast(`Loading "${item.brand} ${item.model}${item.variant ? ' (' + item.variant + ')' : ''}" from database...`, "🔍");
            this._iemDbActiveId = item.id;
            const searchInput = document.getElementById('iem-db-search-input');
            if (searchInput) this.renderIemDbSearch(searchInput.value);
            await this.ensureChartReady().catch(() => {});
            let curve = null;
            if (typeof CurveIndexer !== 'undefined') {
                try {
                    const ok = await CurveIndexer.loadCurve(item, fileIdx);
                    if (ok) {
                        curve = (fileIdx === 0) ? (item.data || null) : (item.sourcesCache && item.sourcesCache[targetFile]) || null;
                    }
                } catch (e) { console.warn("[IEM DB Fill] curve load failed:", e); }
            }

            document.getElementById('brand').value = item.brand || '';
            document.getElementById('model').value = (item.model || '') + (item.variant ? ' ' + item.variant : '');
            document.getElementById('price').value = (item.price_usd != null ? item.price_usd : '');

            if (document.getElementById('impedance')) document.getElementById('impedance').value = Math.max(5, Math.min(300, Math.round(item.impedance || 5)));
            if (document.getElementById('impedance-slider')) document.getElementById('impedance-slider').value = Math.min(300, Math.max(5, Math.round(item.impedance || 5)));
            if (document.getElementById('sensitivity')) document.getElementById('sensitivity').value = Math.max(55, Math.min(150, Math.round(item.sensitivity || 80)));
            if (document.getElementById('sensitivity-slider')) document.getElementById('sensitivity-slider').value = Math.min(150, Math.max(55, Math.round(item.sensitivity || 80)));
            let impEl = document.getElementById('impedance');
            if (impEl) document.getElementById('impedance').dispatchEvent(new Event('input', { bubbles: true }));

            if (item.form_factor) this.setFormFactor(item.form_factor);
            if (item.connector) this.setConnector(item.connector);

            // Drivers
            if (item.driver_config && FindEngine && FindEngine.parseDriverConfig) {
                const techs = FindEngine.parseDriverConfig(item.driver_config);
                const counts = {};
                const re = /(\d+)\s*x?\s*([A-Za-z]{2,})/gi;
                let m;
                while ((m = re.exec(String(item.driver_config))) !== null) {
                    const canonical = FindEngine.driverTechCanon[m[2].toUpperCase()];
                    if (canonical) counts[canonical] = (counts[canonical] || 0) + parseInt(m[1], 10);
                }
                // Bare mentions without a digit ("2x BA + EST", "DD & BA"):
                // count 1 for each mentioned tech the digit pass missed.
                techs.forEach(t => {
                    if (!counts[t]) {
                        const aliasHit = Object.keys(FindEngine.driverTechCanon).some(alias => {
                            if (FindEngine.driverTechCanon[alias] !== t) return false;
                            return new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(item.driver_config));
                        });
                        if (aliasHit) counts[t] = 1;
                    }
                });
                if (Object.keys(counts).length === 0) {
                    techs.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
                }
                this.selectedDriverTypes = counts;
                this.runDriverAutoLogic();
            }

            // Sound-char tone sliders from the measured curve (subjective axes untouched)
            if (curve && PEQDB_Module && PEQDB_Module.getNormalizedData) {
                this.fillToneSlidersFromCurve(curve);
            }

            // Tags: DB tags + curve-derived tags, best 4
            const signatureTags = (curve && PEQDB_Module && PEQDB_Module.analyzeCurveSignature) ? PEQDB_Module.analyzeCurveSignature(curve) : [];
            this.derivedTagsForReview(item, signatureTags);

            this.updateAll();
            showToast(`Loaded ${item.brand} ${item.model} from database.`, "✓");
        },

        // Derive objective tone-character slider values from a measured FR curve.
        // Only "measurable" tone axes are touched: bass/sub-bass/punch/texture/speed,
        // mids/vocals, treble energy/smooth/detail/extension. Subjective axes
        // (soundstage, imaging, dynamics, comfort, build, fit) stay untouched.
        fillToneSlidersFromCurve: function(curve) {
            let norm;
            try { norm = PEQDB_Module.getNormalizedData(curve, 'review-fill'); } catch (e) { return; }
            if (!norm || norm.length < 10) return;

            const getDbAt = (hz) => {
                let closest = norm[0];
                let minDiff = Infinity;
                for (let i = 0; i < norm.length; i++) {
                    const diff = Math.abs(norm[i][0] - hz);
                    if (diff < minDiff) { minDiff = diff; closest = norm[i]; }
                }
                return closest[1];
            };
            const avg = (fs) => fs.reduce((s, f) => s + getDbAt(f), 0) / fs.length;
            const clampS = (v, lim = 10) => Math.max(-lim, Math.min(lim, Math.round(v * 10) / 10));

            const subBass = avg([20, 30, 40, 50, 60]);
            const midBass = avg([80, 100, 120, 150, 200]);
            const lowMids = avg([250, 300, 400, 500]);
            const mids = avg([600, 800, 1000, 1200]);
            const upperMids = avg([1500, 2000, 2500, 3000]);
            const presence = avg([3500, 4000, 5000, 6000]);
            const treble = avg([7000, 8000, 9000, 10000]);
            const air = avg([12000, 14000, 16000, 18000, 20000]);

            // Reference the mean of the lower-mid → upper-mid region we treat as neutral.
            const ref = (lowMids + mids + upperMids) / 3;
            const v = {};
            v['bass'] = clampS(subBass - ref);
            v['sub-bass-extension'] = clampS(subBass - midBass);
            v['mid-bass-punch'] = clampS(midBass - ref);
            v['bass-texture'] = clampS((midBass + lowMids) / 2 - ref, 8);
            v['bass-speed'] = clampS((midBass - subBass) * 0.6, 8);
            v['lower-mids'] = clampS(lowMids - ref);
            v['upper-mids'] = clampS(upperMids - ref);
            v['vocals'] = clampS(upperMids - ref);
            v['vocal-fullness'] = clampS((lowMids + mids) / 2 - ref, 8);
            v['mid-naturalness'] = clampS(-(Math.max(0, mids - ref) - Math.min(0, lowMids - ref)), 6);
            v['treble-energy'] = clampS(treble - ref, 9);
            v['treble-smooth'] = clampS(-(presence - treble), 8);
            v['treble-extension'] = clampS(air - treble, 9);
            v['sibilance'] = clampS(presence - ref, 7);
            v['treble-detail'] = clampS((treble + air) / 2 - ref, 9);

            this.sliderNodes.forEach(node => {
                const id = node.element.id;
                if (v[id] !== undefined) {
                    node.element.value = v[id].toFixed(1);
                    if (node.displayValueNode) node.displayValueNode.textContent = (v[id] >= 0 ? "+" : "") + v[id].toFixed(1);
                }
            });
        },

        // Fill exactly 4 slots from the whitelist ONLY: DB tags first (authoritative, every entry >=4),
        // then curve signature tags that map onto a whitelist tag. Never inject non-whitelist names.
        derivedTagsForReview: function(item, signatureTags) {
            const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const tagNameWithoutEmoji = (t) => String(t || '').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]+/u, '').trim();

            const reviewTagByNorm = new Map();
            this.allReviewTags.forEach(t => { reviewTagByNorm.set(normalize(tagNameWithoutEmoji(t)), t); });

            // 1) DB whitelist tags (authoritative, preserve DB order, drop anything unmapped)
            const dbTagNames = (item && Array.isArray(item.tags)) ? item.tags : [];
            const merged = [];
            dbTagNames.forEach(n => {
                const t = reviewTagByNorm.get(normalize(n));
                if (t && merged.indexOf(t) === -1) merged.push(t);
            });
            // 2) Curve tags only if they resolve onto the whitelist (U-shape etc. are dropped)
            Array.from(signatureTags || []).forEach(t => {
                const mapped = reviewTagByNorm.get(normalize(tagNameWithoutEmoji(t)));
                if (mapped && merged.indexOf(mapped) === -1) merged.push(mapped);
            });

            const tagCategory = (t) => {
                const plain = tagNameWithoutEmoji(t);
                if (this.bassTags.some(b => tagNameWithoutEmoji(b.name) === plain)) return 'bass';
                if (this.genreTags.some(g => tagNameWithoutEmoji(g.name) === plain)) return 'genre';
                return 'tone';
            };

            this.selectedTags = new Set(); this.selectedBass = new Set(); this.selectedGenres = new Set();
            const limits = { tone: 2, bass: 1, genre: 1 };
            const placed = { tone: 0, bass: 0, genre: 0 };
            const seen = new Set();
            const place = (t, cat) => {
                if (cat === 'bass') this.selectedBass.add(t);
                else if (cat === 'genre') this.selectedGenres.add(t);
                else this.selectedTags.add(t);
                placed[cat]++; seen.add(t);
            };
            let total = 0;
            // Pass 1: respect category caps for a spread
            for (let i = 0; total < 4 && i < merged.length; i++) {
                const t = merged[i], cat = tagCategory(t);
                if (placed[cat] >= limits[cat]) continue;
                place(t, cat); total++;
            }
            // Pass 2: guarantee all 4 slots still fill even if one category overflows
            for (let i = 0; total < 4 && i < merged.length; i++) {
                const t = merged[i];
                if (seen.has(t)) continue;
                place(t, tagCategory(t)); total++;
            }

            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);
            this.renderReviewSelectedTags();
        },
};
