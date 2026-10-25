// Split out of the former monolithic app-core.js (2026 refactor).
// PEQDB_Module: the Database/Similar-search tab (list rendering, curve
// selection, similarity search UI).

            function activateOrbitMarquee(el) {
                if (!el || !el.parentElement) return false;
                const containerWidth = el.parentElement.clientWidth;
                if (containerWidth === 0 || el.scrollWidth <= containerWidth) return false;
                const rawHtml = el.innerHTML;
                const singleWidth = el.scrollWidth;
                el.innerHTML = `<span class="mr-6">${rawHtml}</span><span>${rawHtml}</span>`;
                const PX_PER_SEC = 32;
                const duration = Math.min(30, Math.max(6, singleWidth / PX_PER_SEC));
                el.style.setProperty('--marquee-orbit-duration', duration.toFixed(2) + 's');
                el.classList.add('marquee-orbit-active');
                return true;
            }

            const PEQDB_Module = {
                viewMinF: 20,
                viewMaxF: 20000,
                isDrawingModeActive: false,
                isUserDrawing: false,
                drawnPoints: [],
                databaseFullyLoaded: false,

                migrateLegacyReviews: async function() {
                    const legacy = localStorage.getItem('iem_library_v2');
                    if (legacy) {
                        try {
                            const list = JSON.parse(legacy);
                            if (Array.isArray(list) && list.length > 0) {
                                for (let i = 0; i < list.length; i++) {
                                    await DBCache.saveReview(list[i]);
                                }
                                localStorage.removeItem('iem_library_v2');
                                console.log(`[IndexedDB Migration] Successfully migrated ${list.length} profiles.`);
                            }
                        } catch(e) {
                            console.error("Migration failed:", e);
                        }
                    }
                },
                toggleDrawMode: function() {
                    this.isDrawingModeActive = !this.isDrawingModeActive;
                    const btn = document.getElementById('sculptor-draw-btn');
                    if (btn) {
                        if (this.isDrawingModeActive) {
                            btn.className = "px-2.5 py-1 bg-pink-500 text-white hover:bg-pink-600 transition-all cursor-pointer";
                            btn.textContent = "🖌️ Draw Mode: ON";
                            showToast("Draw Mode active! Hold click and draw directly onto the graph to sketch your target.", "🖌️");
                        } else {
                            btn.className = "px-2.5 py-1 bg-zinc-800 text-zinc-400 hover:text-stone-300 transition-all cursor-pointer";
                            btn.textContent = "🖌️ Draw Mode: Off";
                        }
                    }
                    this.isUserDrawing = false;
                    this.drawnPoints = [];
                    EQ_Module.drawCurve();
                },
                targetOptions: [
                    { val: '', label: '🎯 Target: None' },
                    { val: 'harman', label: '📊 Harman IE 2019' },
                    { val: 'moondrop_vdsf', label: '🌙 Moondrop VDSF' },
                    { val: 'peqdb_diamond', label: '💎 PEQdb Diamond' },
                    { val: 'jm-1', label: '🔬 JM-1' },
                    { val: 'diffuse_field', label: '📐 Diffuse Field' },
                    { val: 'basshead', label: '💥 Basshead' },
                    { val: 'vshape', label: '🔺 V-Shape' },
                    { val: 'gaming', label: '🎮 Gaming' }
                ],
                currentTargetIdx: 0,
                cycleTargetDirection: function(dir) {
                    const total = this.targetOptions.length;
                    this.currentTargetIdx = (this.currentTargetIdx + dir + total) % total;
                    const opt = this.targetOptions[this.currentTargetIdx];
                    this.setTarget(opt.val);
                },

                resonanceHz: 8000,
                alignHz: '500',
                alignDb: 75.0,
                parseRawCurveText: function(rawText) {
            // Single source of truth: CurveUtils.parseCurveText (utils.js).
            // Kept as a method because ~30 call sites expect it on PEQDB_Module.
            return CurveUtils.parseCurveText(rawText);
        },
        debouncedFindSimilar: null,
        listRenderLimit: 40,
        // (similarityWorker removed — dead code; similarity runs inline via
        // computeSimilarityScores / CurveUtils on the main thread)

        startBackgroundLoading: function() {
            if (this.databaseFullyLoaded) return;
            const dataset = this.STATE.dataset;
            // Arm the progress tally with the real work total before any curve
            // is fetched, so the bar has a denominator from the first tick.
            if (dataset && dataset.length && CurveIndexer.beginIndexProgress) {
                CurveIndexer.beginIndexProgress(dataset.length);
            }
            // catalogLoadFailed: the fallback installs a handful of built-in targets,
            // so dataset.length is NOT 0 on a failed load. Without this test the
            // warm-up ran over those few targets, finished instantly, and wrote
            // databaseFullyLoaded = true plus the persisted squig_db_indexed flag.
            if (this.catalogLoadFailed || !dataset || dataset.length === 0) {
                // This branch means the catalogue load FAILED and the fallback
                // path installed its handful of built-in targets. It used to
                // set databaseFullyLoaded = true and persist
                // squig_db_indexed='true' here, which wrote a permanent "all
                // good" flag over a failed load — replacing database.json and
                // relaunching would then never retry. Do not claim success.
                this.renderList(false, true);
                if (typeof FindEngine !== 'undefined' && FindEngine.updateIndexingProgressBar) {
                    FindEngine.updateIndexingProgressBar();
                }
                return;
            }
            CurveIndexer.startBackgroundWarmup(dataset);
        },

        STATE: { dataset: [], renderList: [], activeCurves: [], blendCurve: null, similarityScore: null, chosenColors: {} },
        squigYMin: 50,
        squigYMax: 110,
        searchMode: 'database',
        _similarTargetEverModified: false,
        targetMode: 'database',

        convertActiveToSculpt: function() {
            if (window.EQ_Sculptor) {
                EQ_Sculptor.convertActiveToSculpt(this, showToast);
            }
        },
        handleSculptChangeDirect: function(index, db) {
            if (window.EQ_Sculptor) {
                EQ_Sculptor.handleSculptChangeDirect(index, db, this);
            }
        },
        updateSculptTargetData: function() {
            if (window.EQ_Sculptor) {
                EQ_Sculptor.updateSculptTargetData(this);
            }
        },
        resetSculptTarget: function() {
            if (window.EQ_Sculptor) {
                EQ_Sculptor.resetSculptTarget(this);
            }
        },
        TARGETS: EQ_TARGETS_DATA,
        colorPalette: [
            '#ff9500', '#007aff', '#30d158', '#ff453a', '#bf5af2', '#ffd60a', '#5e5ce6', '#64d2ff',
            '#00e1d9', '#ff6482', '#a2845e', '#53d769', '#ff2d55', '#17c063', '#ff9f0a', '#00bfff'
        ],

        Spline: {
            build: function(points) {

    if (!Array.isArray(points)) return null;

    points = points.filter(p => {

        if (!Array.isArray(p) || p.length < 2)
            return false;

        const freq = Number(p[0]);
        const db = Number(p[1]);

        return (
            Number.isFinite(freq) &&
            Number.isFinite(db) &&
            freq > 0
        );
    });

    if (points.length < 2) return null;

    const cleaned = [];
    let lastFreq = null;

    points.forEach(p => {

        if (p[0] !== lastFreq) {
            cleaned.push(p);
            lastFreq = p[0];
        }

    });

    points = cleaned;

    if (points.length < 2) return null;

    const n = points.length;
                const x = new Float32Array(n);
                const a = new Float32Array(n);
                for (let i = 0; i < n; i++) {
                    x[i] = Math.log10(points[i][0]);
                    a[i] = points[i][1];
                }

                const h = new Float32Array(n - 1);
                const s = new Float32Array(n - 1);
                for (let i = 0; i < n - 1; i++) {
                    let diff = x[i + 1] - x[i];
                    if (diff < 1e-5) diff = 1e-5;
                    h[i] = diff;
                    s[i] = (a[i + 1] - a[i]) / h[i];
                }

                const m = new Float32Array(n);

                for (let i = 1; i < n - 1; i++) {
                    const s0 = s[i - 1];
                    const s1 = s[i];
                    if (s0 * s1 <= 0) {
                        m[i] = 0;
                    } else {

                        const p = (s0 * h[i] + s1 * h[i - 1]) / (h[i - 1] + h[i]);
                        const max_m = 2 * Math.min(Math.abs(s0), Math.abs(s1));
                        m[i] = Math.sign(p) * Math.min(Math.abs(p), max_m);
                    }
                }

                m[0] = s[0];
                m[n - 1] = s[n - 2];

                return { x, a, h, m };
            },
            evaluate: function(spline, f) {
                if (!spline) return 80;
                const val = Math.log10(f);
                const x = spline.x;
                const a = spline.a;
                const h = spline.h;
                const m = spline.m;
                const n = x.length;

                if (val <= x[0]) return a[0];
                if (val >= x[n - 1]) return a[n - 1];

                let low = 0, high = n - 1;
                while (low <= high) {
                    const mid = (low + high) >> 1;
                    if (x[mid] === val) return a[mid];
                    if (x[mid] < val) low = mid + 1;
                    else high = mid - 1;
                }
                const i = Math.max(0, Math.min(n - 2, high));
                const t = (val - x[i]) / h[i];
                const t2 = t * t;
                const t3 = t2 * t;

                const h00 = 2 * t3 - 3 * t2 + 1;
                const h10 = t3 - 2 * t2 + t;
                const h01 = -2 * t3 + 3 * t2;
                const h11 = t3 - t2;

                return h00 * a[i] + h10 * h[i] * m[i] + h01 * a[i + 1] + h11 * h[i] * m[i + 1];
            }
        },

        updateSearchSuggestions: function(query) {
            const box = document.getElementById('peqdb-search-suggestions');
            if (!box) return;
            const q = (query || '').trim();
            if (q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }

            const dataset = this.STATE.dataset || [];
            const normQ = this.normalizeSearchText(q);
            const seenBrands = new Set();
            const suggestions = [];

            for (let i = 0; i < dataset.length && suggestions.length < 6; i++) {
                const brand = dataset[i].brand;
                if (!brand || seenBrands.has(brand)) continue;
                const normBrand = this.getBrandNorm(brand);
                if (normBrand.includes(normQ) && normBrand !== normQ) {
                    seenBrands.add(brand);
                    suggestions.push(brand);
                }
            }

            if (suggestions.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }

            // data-cmd, not an attribute-form handler. This was `onmousedown="..."`, which
            // Chromium refuses to compile under `script-src 'self'
            // 'wasm-unsafe-eval'`, so the chips rendered and clicking did
            // nothing. Ratcheted by scripts/check-integrity.mjs check #4.
            //
            // click rather than mousedown: the #peqdb-search blur handler that
            // hides this box is a 150ms setTimeout, and click lands inside that
            // window, so insertSearchSuggestion runs before the box closes.
            box.innerHTML = suggestions.map(s => `
                <span class="spec-icon-badge" style="width:auto !important; height:24px !important; padding:0 8px; font-size:var(--t-xs) !important; font-weight:800; background:var(--bg-input); border:2px solid #000;" data-tooltip="Search: click to insert" data-cmd="PEQDB_Module.insertSearchSuggestion" data-arg-0="${esc(s)}">${esc(s)}</span>
            `).join('');
            box.classList.remove('hidden');
        },

        // Backs the #peqdb-search-suggestions chips. Extracted from the inline
        // handler string above. Note the input event is dispatched with
        // `bubbles: true` - the search input is wired with a delegated
        // capture-phase listener (peqdb-module.js:1327-1340), which needs the
        // event to bubble to reach it.
        insertSearchSuggestion: function(value) {
            if (value === undefined || value === null) return;
            const input = document.getElementById('peqdb-search');
            if (input) {
                input.value = String(value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const box = document.getElementById('peqdb-search-suggestions');
            if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
        },

                DATA: {
            fallbackDataset: [
                { id: "moondrop_aria", name: "Moondrop Aria", variant: "Stock", source: "SuperReview", data: [[20,78.5],[30,77.31],[45,75.62],[70,73.07],[100,70.5],[150,68.0],[250,68.75],[350,68.45],[500,68.0],[700,68.0],[1000,68.0],[1500,68.74],[2200,71.59],[3000,77.0],[4000,75.0],[5500,72.0],[7000,72.5],[8500,73.75],[10000,69.22],[13000,67.65],[16000,66.09],[20000,64.0]] },
                { id: "moondrop_blessing_3", name: "Moondrop Blessing 3", variant: "Stock", source: "Crinacle", data: [[20,76.5],[30,75.54],[45,74.17],[70,72.1],[100,70.03],[150,68.0],[250,68.61],[350,68.36],[500,68.0],[700,68.0],[1000,68.0],[1500,68.91],[2200,72.39],[3000,79.0],[4000,75.0],[5500,72.0],[7000,71.5],[8500,72.5],[10000,71.0],[13000,69.1],[16000,67.4],[20000,65.1]] },
                { id: "tangzu_waner", name: "Tangzu Wan'er", variant: "Stock", source: "Internal", data: [[20,79.2],[30,78.4],[45,76.1],[70,73.2],[100,71.0],[150,68.0],[250,68.5],[350,68.1],[500,68.0],[700,68.0],[1000,68.0],[1500,68.5],[2200,71.2],[3000,76.5],[4000,74.0],[5500,71.0],[7000,72.0],[8500,73.0],[10000,69.22],[13000,67.65],[16000,66.09],[20000,64.0]] },
                { id: "moondrop_blessing_2", name: "Moondrop Blessing 2", variant: "Stock", source: "Crinacle", data: [[20,76.5],[30,75.54],[45,74.17],[70,72.1],[100,70.03],[150,68.0],[250,68.61],[350,68.36],[500,68.0],[700,68.0],[1000,68.0],[1500,68.91],[2200,72.39],[3000,79.0],[4000,75.0],[5500,72.0],[7000,71.5],[8500,72.5],[10000,71.0],[13000,69.1],[16000,67.4],[20000,65.1]] },
                { id: "7hz_salnotes_zero", name: "7Hz Salnotes Zero", variant: "Stock", source: "Crinacle", data: [[20,75.1],[30,74.5],[45,76.1],[70,73.2],[100,71.0],[150,68.0],[250,68.5],[350,68.1],[500,68.0],[700,68.0],[1000,68.0],[1500,68.5],[2200,71.2],[3000,76.5],[4000,74.0],[5500,71.0],[7000,72.0],[8500,73.0],[10000,68.5],[13000,66.0],[16000,63.5],[20000,62.0]] },
                { id: "truthear_zero_red", name: "Truthear Zero:RED", variant: "Stock", source: "Internal", data: [[20,77.8],[30,76.9],[45,75.2],[70,72.8],[100,70.4],[150,68.0],[250,68.4],[350,68.2],[500,68.0],[700,68.0],[1000,68.0],[1500,68.6],[2200,71.1],[3000,75.8],[4000,73.2],[5500,71.4],[7000,72.2],[8500,72.8],[10000,69.1],[13000,66.8],[16000,64.2],[20000,61.5]] }
            ],
            async init() {
            const loader = document.getElementById('peqdb-loading');
            const loaderText = loader ? loader.querySelector('span') : null;
            if(loader) loader.style.display = 'none';
            if(loaderText) loaderText.textContent = "⏳ Indexing database...";

            PEQDB_Module.STATE.activeCurves = [];
            PEQDB_Module.databaseFullyLoaded = false;
            PEQDB_Module.catalogLoadFailed = false;

            try {
                await DBCache.init();
            } catch (err) {
                console.error("[PEQDB] DBCache.init() failed — continuing without persistent cache:", err);
            }

            try {
                PEQDB_Module.STATE.dataset = await CurveIndexer.init();
                if (!PEQDB_Module.STATE.dataset || PEQDB_Module.STATE.dataset.length === 0) {
                    throw new Error("No files found in manifest");
                }
            } catch (err) {
                console.warn("Manifest loading failed, loading local fallback targets:", err);
                const fallback = PEQDB_Module.DATA.fallbackDataset || [];
                PEQDB_Module.STATE.dataset = fallback.map(item => ({ ...item, searchKey: `${item.name} ${item.variant} ${item.source}`.toLowerCase() }));
                // These two lines used to report success while shipping 6
                // hard-coded curves in place of ~5,000, which is how a
                // malformed database.json turned into a silent downgrade:
                //   - databaseFullyLoaded = true claimed a complete catalogue
                //   - squig_db_indexed = 'true' was a persisted flag that
                //     suppressed every future re-check, so replacing the file
                //     and relaunching did not recover
                // Only claim "fully loaded" when it actually is, and only write
                // the persisted flag on the real path.
                PEQDB_Module.databaseFullyLoaded = false;
                PEQDB_Module.catalogLoadFailed = true;
                try { localStorage.removeItem('squig_db_indexed'); } catch (_) {}
                showToast('Curve database failed to load — only ' + PEQDB_Module.STATE.dataset.length +
                    ' built-in targets available. Check database.json.', '⚠️');
            }

                try {
                    PEQDB_Module.precalculateInterps();
                } catch (e) {
                    console.error("Error precalculating interpolations:", e);
                }

                try {
                    PEQDB_Module.DATA.search("");
                    PEQDB_Module.renderList();
                } catch (e) {
                    console.error("Error rendering lists:", e);
                } finally {
                    if(loader) loader.style.display = 'none';
                }

                try {
                    EQ_Module.drawCurve();
                } catch (e) {
                    console.error("Error clearing canvas:", e);
                }

                if (!PEQDB_Module.databaseFullyLoaded) {
                    try {
                        PEQDB_Module.startBackgroundLoading();
                    } catch (e) {
                        console.error("Error starting background loading:", e);
                    }
                }
            },
            search(query) {
                if (!PEQDB_Module.STATE.dataset) {
                    PEQDB_Module.STATE.dataset = [];
                }
                if (!query || !query.trim()) {
                    PEQDB_Module.STATE.renderList = PEQDB_Module.STATE.dataset.slice().sort((a, b) => {
                        const nameA = (a.name || '').toLowerCase();
                        const nameB = (b.name || '').toLowerCase();
                        if (nameA !== nameB) return nameA.localeCompare(nameB);
                        return (a.source || '').localeCompare(b.source || '');
                    });
                    return;
                }
                const results = [];
                for (let i = 0; i < PEQDB_Module.STATE.dataset.length; i++) {
                    const item = PEQDB_Module.STATE.dataset[i];
                    if (PEQDB_Module.matchSearchTokensNorm(PEQDB_Module.getSearchNorm(item), query)) {
                        results.push(item);
                    }
                }
                PEQDB_Module.STATE.renderList = results.sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    if (nameA !== nameB) return nameA.localeCompare(nameB);
                    return (a.source || '').localeCompare(b.source || '');
                });
            }
        },
        DSP: {
            FREQS: Array.from({length: 500}, (_, i) => 20 * Math.pow(1000, i / 499)),
            interpolate(rawCurve, role) {
                if (!rawCurve || rawCurve.length === 0) return Array(500).fill(0);
                const curve = PEQDB_Module.standardizeCurveData(rawCurve);
                if (curve.length === 0) return Array(500).fill(0);

                return this.FREQS.map(f => {
                    const evalF = PEQDB_Module.getShiftedFrequency(f, role);
                    if (evalF <= curve[0][0]) return curve[0][1];
                    if (evalF >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
                    let low = 0, high = curve.length - 1;
                    while (low <= high) {
                        let mid = (low + high) >> 1;
                        if (curve[mid][0] === evalF) return curve[mid][1];
                        if (curve[mid][0] < evalF) low = mid + 1;
                        else high = mid - 1;
                    }

                    const x0 = Math.log10(curve[high][0]); const y0 = curve[high][1];
                    const x1 = Math.log10(curve[low][0]); const y1 = curve[low][1];
                    return y0 + (Math.log10(evalF) - x0) * (y1 - y0) / (x1 - x0);
                });
            }
        },
        searchTimeout: null,
       init: function() {

const savedHz = localStorage.getItem('settings_align_hz');
const savedDb = localStorage.getItem('settings_align_db');
            this.setAlignHz(savedHz || '500');
            this.setAlignDb(savedDb ? parseFloat(savedDb) : 75.0);

            // (initSimilarityWorker removed — the blob worker was dead code:
            // every result arrived through computeSimilarityScores inline and
            // the worker's onmessage handler never fired, since nothing ever
            // posted to it.)

            const searchInput = document.getElementById("peqdb-search");
            if (searchInput) {
                searchInput.addEventListener("input", debounce(e => {
                    this.DATA.search(e.target.value);
                    this.renderList();
                    this.updateSearchSuggestions(e.target.value);
                }, 250));
                searchInput.addEventListener("blur", () => {
                    setTimeout(() => {
                        const box = document.getElementById('peqdb-search-suggestions');
                        if (box) box.classList.add('hidden');
                    }, 150);
                });
            }

            this.debouncedFindSimilarCurves = debounce(this.findSimilarCurves.bind(this), 220);

            const listContainer = document.getElementById("peqdb-list");
            if (listContainer) {
                listContainer.addEventListener("scroll", () => {
                    const scrollBuffer = 60;
                    if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - scrollBuffer) {
                        if (PEQDB_Module.listRenderLimit < PEQDB_Module.STATE.renderList.length) {
                            PEQDB_Module.listRenderLimit += 40;
                            PEQDB_Module.renderList(true);
                        }
                    }
                }, { passive: true });
            }

            const renameInput = document.getElementById('rename-input');
            if (renameInput) {
                renameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        PEQDB_Module.confirmRename();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        PEQDB_Module.closeRenameModal();
                    }
                });
            }

            const savePresetInput = document.getElementById('save-preset-input');
            if (savePresetInput) {
                savePresetInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        EQ_Module.confirmSavePreset();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        EQ_Module.closeSavePresetModal();
                    }
                });
            }

            // Deliberately NOT awaited. The catalogue load is shared via
            // CurveIndexer.ensureCatalogReady()'s single-flight promise, so the
            // rest of the boot sequence (Tone, Test Lab, Accessibility, and
            // FindEngine itself) proceeds in parallel and still ends up with
            // exactly ONE download + ONE parse of database.json.gz. Awaiting
            // here instead would serialise the whole boot behind a ~2.85 MB
            // JSON parse for no benefit. Do not "fix" this into an await.
            this.DATA.init().catch((err) => {
                // Floating promise otherwise: DATA.init() has internal
                // try/catch, but a future await added outside one would
                // become an unhandled rejection with nobody listening.
                console.error('[PEQDB] DATA.init() failed:', err);
            });
        },
        autoeqResolution: 10,
        resolutionsList: [10, 15, 20, 30, 40, 50],
        currentResIdx: 0,
        resolutionColors: {
            10: '#ffffff',
            15: '#facc15',
            20: '#10b981',
            30: '#06b6d4',
            40: '#a3e635',
            50: '#ec4899'
        },

        cycleResolutionDirection: function(dir) {
            const total = this.resolutionsList.length;
            this.currentResIdx = (this.currentResIdx + dir + total) % total;
            this.autoeqResolution = this.resolutionsList[this.currentResIdx];
            const color = this.resolutionColors[this.autoeqResolution] || '#ffffff';
            const label = document.getElementById('autoeq-btn-label');
            if (label) {
                label.innerHTML = `<span class="text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🪄</span> AutoEQ (<span style="color: ${color} !important; font-weight: 900;">${this.autoeqResolution} Bands</span>)`;
            }
            showToast(`AutoEQ Resolution: ${this.autoeqResolution} Bands`, "🪄");
        },

        curveToolsList: [
            { id: 'avg', name: 'Average Refs', emoji: '📊', fn: function() { PEQDB_Module.averageActiveCurves(); } },
            { id: 'freeze', name: 'Freeze EQ', emoji: '❄️', fn: function() { PEQDB_Module.freezeEQAsTarget(); } }
        ],
        currentCurveToolIdx: 0,

        cycleCurveToolIndex: function(dir) {
            const total = this.curveToolsList.length;
            this.currentCurveToolIdx = (this.currentCurveToolIdx + dir + total) % total;
            const current = this.curveToolsList[this.currentCurveToolIdx];
            const label = document.getElementById('curvetool-btn-label');
            if (label) {
                label.innerHTML = `<span class="text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${current.emoji}</span> ${current.name}`;
            }
        },

        executeCurrentCurveTool: function() {
            const current = this.curveToolsList[this.currentCurveToolIdx];
            if (current && current.fn) {
                current.fn();
            }
        },
        expandedItemDrawers: new Set(),
        expandedBrands: new Set(),
        dbItemFileIndex: {},
        toggleBrandGroup: function(brandName) {
            if (this.expandedBrands.has(brandName)) {
                this.expandedBrands.delete(brandName);
            } else {
                this.expandedBrands.add(brandName);
            }
            const brandSlug = this._brandSlug(brandName);
            const groupEl = document.querySelector(`[data-brand-group="${brandSlug}"]`);
            if (groupEl) {
                const container = groupEl.querySelector('.brand-items-container');
                const arrow = groupEl.querySelector('.brand-group-arrow');
                const isNowExpanded = this.expandedBrands.has(brandName);
                if (container) container.classList.toggle('hidden', !isNowExpanded);
                if (arrow) arrow.textContent = isNowExpanded ? '▲' : '▼';

                if (isNowExpanded && container && this.applyOrbitMarqueeFn) {
                    setTimeout(() => {
                        container.querySelectorAll('.db-title-text, .db-file-marquee-text').forEach(this.applyOrbitMarqueeFn);
                    }, 50);
                }
                requestAnimationFrame(() => PEQDB_Module.fillVisibleList());
            }
        },
        cycleDbItemSource: function(itemId, dir) {
            const item = this.STATE.dataset.find(i => i.id === itemId) || this.STATE.renderList.find(i => i.id === itemId);
            if (!item || !item.files || item.files.length <= 1) return;
            const total = item.files.length;
            const cur = this.dbItemFileIndex[itemId] || 0;
            this.dbItemFileIndex[itemId] = (cur + dir + total) % total;
            if (this.searchMode === 'similar') {
                this.rescoreSimilarItemFile(item);
            } else {
                this.renderList(false, true, true);
            }
        },

        updateRowSelectionUI: function(id, itemById, row) {
            if (!row) {
                const list = document.getElementById('peqdb-list');
                if (!list) return;
                try {
                    row = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
                } catch(e) {
                    const all = list.querySelectorAll('.peqdb-row-item');
                    for (let i = 0; i < all.length; i++) {
                        if (all[i].getAttribute('data-id') === id) { row = all[i]; break; }
                    }
                }
            }
            if (!row) return;

            // Batch callers pass a prebuilt id→item Map; a linear .find per row
            // made updateAllRowSelectionUIs O(rows × dataset) on every curve
            // toggle / color cycle / ±1 dB offset click.
            const item = (itemById && itemById.get(id)) || this.STATE.dataset.find(i => i.id === id);
            if (!item) return;

            const activeCurves = this.STATE.activeCurves;
            const loadedCurve = activeCurves.find(c => c.id === item.id);
            const isLoaded = !!loadedCurve;

            if (isLoaded) {
                row.classList.add('is-loaded');
                row.style.setProperty('--row-glow', `rgba(${this.hexToRgb(loadedCurve.color)}, 0.28)`);
                row.style.setProperty('--row-glow-solid', loadedCurve.color);
            } else {
                row.classList.remove('is-loaded');
                row.style.removeProperty('--row-glow');
                row.style.removeProperty('--row-glow-solid');
            }

            if (item.files && item.files.length > 1) {
                item.files.forEach((filePath, fIdx) => {
                    const subUid = `${item.id}_src_${fIdx}`;
                    let subRow = null;
                    try {
                        subRow = row.querySelector(`[data-subuid="${CSS.escape(subUid)}"]`);
                    } catch(e) {
                        const allSubs = row.querySelectorAll('[data-subuid]');
                        for (let k = 0; k < allSubs.length; k++) {
                            if (allSubs[k].getAttribute('data-subuid') === subUid) { subRow = allSubs[k]; break; }
                        }
                    }

                    if (subRow) {
                        const subCurve = activeCurves.find(c => c.uid === subUid);
                        const isSubLoaded = !!subCurve;
                        const subAction = subRow.querySelector('.sub-action-indicator');
                        if (isSubLoaded) {
                            subRow.style.background = `rgba(${this.hexToRgb(subCurve.color)}, 0.22)`;
                            subRow.style.borderLeft = `3px solid ${subCurve.color}`;
                            if (subAction) {
                                subAction.textContent = '✓ Active';
                                subAction.style.color = subCurve.color;
                            }
                        } else {
                            subRow.style.background = '';
                            subRow.style.borderLeft = '';
                            if (subAction) {
                                subAction.textContent = '+ Load';
                                subAction.style.color = '';
                            }
                        }
                    }
                });
            }
        },

        updateAllRowSelectionUIs: function() {
            const list = document.getElementById('peqdb-list');
            if (!list) return;
            const rows = list.querySelectorAll('.peqdb-row-item');
            if (rows.length === 0) return;
            const itemById = new Map((this.STATE.dataset || []).map(d => [d.id, d]));
            rows.forEach(row => {
                const id = row.getAttribute('data-id');
                if (id) this.updateRowSelectionUI(id, itemById, row);
            });
        },

        _updateAllPending: false,
        _updateAllQueue: null,
        updateAll: function(preserveScroll = false) {
            if (EQ_Module.isDragging) {
                EQ_Module.drawCurve();
                return;
            }
            // Coalesce rapid calls (drag swaps can fire twice via bubbling) into one rAF
            if (this._updateAllPending) {
                this._updateAllQueue = preserveScroll;
                return;
            }
            this._updateAllPending = true;
            requestAnimationFrame(() => {
                this._updateAllPending = false;
                const ps = this._updateAllQueue;
                this._updateAllQueue = null;
                this.updateAllRowSelectionUIs();
                EQ_Module.drawCurve();
                this.renderActiveCurvesDock();
                if (this._updateAllQueue !== null) {
                    const q = this._updateAllQueue;
                    this._updateAllQueue = null;
                    this.updateAll(q);
                }
            });
        },

        // DOM key for a brand group.
        //
        // The old key was `brandName.replace(/[^a-zA-Z0-9]/g, '_')`, which is
        // NOT injective: "Moondrop A", "Moondrop-A", "Moondrop/A" and
        // "Moondrop_A" all collapsed to "Moondrop_A". Since that string is the
        // `data-brand-group` value, the appendMore path's
        // querySelector('[data-brand-group="Moondrop_A"]') found the FIRST
        // match and appended a second brand's rows into the first brand's
        // container, and toggleBrandGroup toggled the wrong group's chevron
        // while the label still showed the other name. Appending a short
        // deterministic hash of the ORIGINAL string keeps the readable part and
        // makes distinct brands distinct. Both call sites must use this.
        _brandSlug: function(brandName) {
            const s = String(brandName == null ? '' : brandName);
            let h = 5381;
            for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
            return s.replace(/[^a-zA-Z0-9]/g, '_') + '-' + h.toString(36);
        },

        renderList: function(appendMore = false, preserveScroll = false, preserveLimit = false) {
            const list = document.getElementById('peqdb-list');
            const existingLoader = document.getElementById('peqdb-loading');
            if (!list) return;

            const savedScroll = list.scrollTop;
            if (!PEQDB_Module.STATE.renderList) PEQDB_Module.STATE.renderList = [];

            if (!appendMore) {

                if (!preserveLimit) this.listRenderLimit = 40;
                if (!preserveScroll) list.scrollTop = 0;
            }

            const totalItems = PEQDB_Module.STATE.renderList.length;
            const endIdx = Math.min(this.listRenderLimit, totalItems);
            const startIdx = appendMore ? this.listRenderLimit - 40 : 0;

            const countEl = document.getElementById('peqdb-result-count');
            if (countEl && this.searchMode !== 'similar') countEl.textContent = totalItems;

            // Brand row counts. This used to walk the ENTIRE filtered result set
            // on every renderList() call — including every +40-row scroll append,
            // where only 40 rows are actually rendered. That is O(N) work per
            // O(40) of output, i.e. O(N^2/40) across a full scroll-through (the
            // last append iterated ~5,000 entries to draw 40), which is why
            // scrolling the Database list got progressively jankier.
            //
            // The counts cover the whole filtered set (a brand header shows its
            // total even when only some of its rows are on screen), so a full
            // render computes them once and an append can simply reuse them.
            // renderList is only called with appendMore=true as a continuation of
            // a previous full render, so the cache is always in step.
            let brandCounts;
            if (appendMore && this._brandCounts) {
                brandCounts = this._brandCounts;
            } else {
                brandCounts = new Map();
                const all = PEQDB_Module.STATE.renderList;
                for (let i = 0; i < all.length; i++) {
                    const item = all[i];
                    if (!item) continue;
                    const bk = item.brand || 'Unknown Brand';
                    brandCounts.set(bk, (brandCounts.get(bk) || 0) + 1);
                }
                this._brandCounts = brandCounts;
            }

            const fragment = document.createDocumentFragment();
            const activeCurves = PEQDB_Module.STATE.activeCurves;

            if (!appendMore && totalItems === 0) {
                list.innerHTML = '<div class="text-zinc-650 text-xs italic text-center mt-6">No target assets matched.</div>';
                return;
            }

            this._brandCounts = brandCounts;

            const brandBuckets = new Map();
            for (let idx = startIdx; idx < endIdx; idx++) {
                const item = PEQDB_Module.STATE.renderList[idx];
                const brandKey = item.brand || 'Unknown Brand';
                if (!brandBuckets.has(brandKey)) brandBuckets.set(brandKey, []);
                brandBuckets.get(brandKey).push(item);
            }

            if (!this.expandedBrands) this.expandedBrands = new Set();
            if (!this.dbItemFileIndex) this.dbItemFileIndex = {};

            const buildModelCard = (item) => {
                const fileCount = item.files ? item.files.length : 0;
                const isMulti = fileCount > 1;
                const curFileIdx = this.dbItemFileIndex[item.id] || 0;
                const activeFileIdx = Math.min(curFileIdx, Math.max(0, fileCount - 1));

                const filePath = item.files && item.files[activeFileIdx] ? item.files[activeFileIdx] : item.primaryFilePath;
                const pathParts = (filePath || '').split('/');
                const sourceName = pathParts.length >= 3 ? pathParts[1] : (pathParts.length >= 2 ? pathParts[0] : (item.source || 'Database'));
                const fileNameRaw = pathParts[pathParts.length - 1] || '';
                const fileNameNoExt = fileNameRaw.replace(/\.[^/.]+$/, '');

                const curveUid = `${item.id}_src_${activeFileIdx}`;
                const activeCurve = activeCurves.find(c => c.uid === curveUid || (fileCount <= 1 && c.id === item.id));
                const isLoaded = !!activeCurve;
                const rowAccentColor = isLoaded ? activeCurve.color : 'var(--border-color)';

                const formFactorEmojiMap = {
                    'IEM': FindEngine.formFactorEmojis['IEM'],
                    'Earbuds (Wired)': FindEngine.formFactorEmojis['Earbuds (Wired)'],
                    'Wireless Earbuds (TWS)': FindEngine.formFactorEmojis['Wireless Earbuds (TWS)'],
                    'Over-Ear Headphones (Wired)': FindEngine.formFactorEmojis['Over-Ear Headphones (Wired)'],
                    'Wireless Over-Ear Headphones': FindEngine.formFactorEmojis['Wireless Over-Ear Headphones']
                };
                const formEmoji = formFactorEmojiMap[item.form_factor] || FindEngine.formFactorEmojis['IEM'];
                const driverEmoji = FindEngine.driverEmojis[item.driver_type] || '⚙️';
                const driverTooltip = `${item.driver_type || 'Driver'}${item.driver_config ? ' (' + item.driver_config + ')' : ''}`;
                const connectorEmoji = FindEngine.connectorEmojis[item.connector] || '🔌';

                const specIconsHtml = `
                    ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:var(--t-micro);">${esc(item.price_usd)}</span></span>` : ''}
                    ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:var(--t-micro);">${esc(item.year)}</span></span>` : ''}
                    ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                    ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${esc(item.connector)}">${connectorEmoji}</span>` : ''}
                    <span class="spec-icon-badge" data-tooltip="${esc(item.form_factor || 'In-Ear Monitor (IEM)')}">${formEmoji}</span>
                `;

                const getTagEmoji = (tagStr) => {
                    // Same defect as FindEngine.getTagEmoji: only the array-ness
                    // of `tags` is validated, never the element type, so a
                    // numeric tag reached .toLowerCase() and threw. FindEngine
                    // now normalises (and resolves the canonical emoji) itself.
                    return FindEngine.getTagEmoji(tagStr);
                };
                const tagsHtml = (item.tags || []).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${getTagEmoji(t)}</span>`).join('');

                let fileRowHtml;
                if (isMulti) {
                    fileRowHtml = `
                        <div class="flex items-center gap-1.5 mt-1">
                            <button data-cmd="PEQDB_Module.cycleDbItemSource" data-arg-0="${escJs(item.id)}" data-arg-1="-1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center type-micro font-black border border-black" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">◀</button>
                            <div class="db-file-name flex-1 min-w-0 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                                <span class="db-file-marquee-text type-micro font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                            </div>
                            <button data-cmd="PEQDB_Module.cycleDbItemSource" data-arg-0="${escJs(item.id)}" data-arg-1="1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center type-micro font-black border border-black" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">▶</button>
                        </div>
                    `;
                } else {
                    fileRowHtml = `
                        <div class="db-file-name mt-1 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="db-file-marquee-text type-micro font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
                        </div>
                    `;
                }

                const div = document.createElement('div');
                div.className = 'peqdb-row-item p-2 mb-1.5 transition-all select-none cursor-pointer';
                div.setAttribute('data-id', item.id);
                if (isLoaded) {
                    div.classList.add('is-loaded');
                    div.style.setProperty('--row-glow', `rgba(${this.hexToRgb(activeCurve.color)}, 0.28)`);
                    div.style.setProperty('--row-glow-solid', activeCurve.color);
                }
                div.onclick = () => PEQDB_Module.toggleCurveSelection(item.id, activeFileIdx);
                div.innerHTML = `
                    <div class="db-title-row overflow-hidden whitespace-nowrap">
                        <span class="db-title-text font-black text-stone-200 text-xs inline-block whitespace-nowrap">${esc(item.name)}</span>
                    </div>
                    <div class="type-micro text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
                    <div class="flex flex-wrap items-center justify-center gap-1 mt-1">${specIconsHtml}</div>
                    ${tagsHtml ? `<div class="flex flex-wrap items-center justify-center gap-1 mt-1">${tagsHtml}</div>` : ''}
                    ${fileRowHtml}
                `;
                return div;
            };

            for (const [brandName, items] of brandBuckets) {
                const brandSlug = this._brandSlug(brandName);

                let groupEl = appendMore ? list.querySelector(`[data-brand-group="${brandSlug}"]`) : null;
                let itemsContainer;

                if (groupEl) {
                    itemsContainer = groupEl.querySelector('.brand-items-container');
                } else {
                    const isExpanded = this.expandedBrands.has(brandName);
                    groupEl = document.createElement('div');
                    groupEl.className = 'mb-1.5';
                    groupEl.setAttribute('data-brand-group', brandSlug);
                    groupEl.setAttribute('data-letter', alphaKeyOf({ brand: brandName }));
                    groupEl.innerHTML = `
                        <div class="flex items-center justify-between p-2 cursor-pointer select-none border-2 border-black" style="background: var(--bg-input);" data-cmd="PEQDB_Module.toggleBrandGroup" data-arg-0="${escJs(brandName)}">
                            <span class="text-xs font-black uppercase tracking-wider text-[var(--accent-blue)]">${esc(brandName)}</span>
                            <span class="flex items-center gap-1.5 flex-shrink-0">
                                <span class="type-micro font-black text-zinc-500">${this._brandCounts.get(brandName) || 0}</span>
                                <span class="brand-group-arrow type-micro font-black text-[var(--text-secondary)]">${isExpanded ? '▲' : '▼'}</span>
                            </span>
                        </div>
                        <div class="brand-items-container pl-2 pt-1.5 ${isExpanded ? '' : 'hidden'}"></div>
                    `;
                    fragment.appendChild(groupEl);
                    itemsContainer = groupEl.querySelector('.brand-items-container');
                }

                items.forEach(item => itemsContainer.appendChild(buildModelCard(item)));
            }

            if (!appendMore) {
                list.replaceChildren(fragment);
                if (existingLoader) list.prepend(existingLoader);
            } else {
                list.appendChild(fragment);
            }

            setTimeout(() => {
                const applyOrbitMarquee = (el) => {
                    if (!el || el.classList.contains('marquee-orbit-active')) return;
                    activateOrbitMarquee(el);
                };
                list.querySelectorAll('.db-title-text, .db-file-marquee-text').forEach(applyOrbitMarquee);
                PEQDB_Module.applyOrbitMarqueeFn = applyOrbitMarquee;
            }, 80);

            list.scrollTop = savedScroll;

            requestAnimationFrame(() => PEQDB_Module.fillVisibleList());
        },

        fillVisibleList: function(depth = 0) {
            const list = document.getElementById('peqdb-list');
            if (!list || depth > 25) return;
            const total = (PEQDB_Module.STATE.renderList || []).length;
            if (this.listRenderLimit >= total) return;
            if (list.scrollHeight > list.clientHeight + 4) return;
            this.listRenderLimit += 40;
            this.renderList(true, true);
            requestAnimationFrame(() => PEQDB_Module.fillVisibleList(depth + 1));
        },

        hexToRgb: function(hex) {
            if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return '107, 114, 128';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `${r}, ${g}, ${b}`;
        },

        toggleCurveSelection: async function(id, fileIndex = 0) {
            const item = this.STATE.dataset.find(i => i.id === id);
            if (!item) return;

            const targetFile = (item.files && item.files[fileIndex]) ? item.files[fileIndex] : item.primaryFilePath;
            const curveUid = `${id}_src_${fileIndex}`;

            // Guard item.files: imported/Smart-RF/fallback dataset items carry
            // only data/id/name (no files array) — the unguarded .length threw
            // on the remove-toggle click, making imported curves un-removable.
            const activeIndex = this.STATE.activeCurves.findIndex(c => c.uid === curveUid || ((item.files ? item.files.length <= 1 : true) && c.id === id));
            if (activeIndex >= 0) {
                this.STATE.activeCurves.splice(activeIndex, 1);
            } else {
                const loader = document.getElementById('peqdb-loading');
                const loaderText = loader ? loader.querySelector('span') : null;

                let loaderShown = false;
                const loaderDelay = setTimeout(() => {
                    if (loader) { loader.style.display = 'flex'; loaderShown = true; }
                    if (loaderText) loaderText.textContent = `⏳ Loading measurement data...`;
                }, 120);

                const ok = await CurveIndexer.loadCurve(item, fileIndex);
                clearTimeout(loaderDelay);
                if (loader && loaderShown) loader.style.display = 'none';

                if (!ok) {
                    showToast(`Failed to load curve data for ${item.name}`, "⚠️");
                    return;
                }

                let sourceName = "Stock";
                if (targetFile) {
                    const parts = targetFile.split('/');
                    if (parts.length >= 2) sourceName = parts[parts.length - 2];
                }

                let role = 'reference';
                const hasBase = this.STATE.activeCurves.some(c => c.role === 'base');
                const hasTarget = this.STATE.activeCurves.some(c => c.role === 'target');

                if (!hasBase) {
                    role = 'base';
                } else if (!hasTarget) {
                    role = 'target';
                } else {
                    role = 'reference';
                }

                const colorIdx = this.STATE.activeCurves.length % this.colorPalette.length;
                const finalColor = this.colorPalette[colorIdx];

                const activeCurveData = (item.sourcesCache && item.sourcesCache[targetFile]) ? item.sourcesCache[targetFile] : item.data;
                if (!activeCurveData) return;

                const displayName = (item.files && item.files.length > 1) ? `${item.name} (${sourceName})` : item.name;

                this.STATE.activeCurves.push({
                    uid: curveUid,
                    id: item.id,
                    fileIndex: fileIndex,
                    filePath: targetFile,
                    name: displayName,
                    data: activeCurveData,
                    color: finalColor,
                    role: role,
                    visible: true,
                    offset: 0
                });

                // F-8: when this curve became the new BASE, silently restore
                // the user's remembered tip/depth/seal fit for this IEM.
                if (role === 'base' && EQ_Module.restoreFitMemoryForCurrentIem) {
                    try { EQ_Module.restoreFitMemoryForCurrentIem(); } catch (_) {}
                }
            }

            this.updateRowSelectionUI(id);
            EQ_Module.drawCurve();
            this.renderActiveCurvesDock();
            // Keep the Similar tab's LOAD/role badges in sync when a curve is
            // toggled while Similar mode is open. (_lastSimilarGroups was never
            // assigned anywhere — the gate was permanently false and the badge
            // refresh this comment promises silently never ran. Use the
            // matches list, which IS populated by every scan.)
            if (this.searchMode === 'similar' && this._lastSimilarMatches) {
                this.renderSimilarList(this._lastSimilarMatches, this._lastSimilarRefName || '');
            }
        },
        setTarget: function(val) {
            this.STATE.activeCurves = this.STATE.activeCurves.filter(c => c.role !== 'target');
            this.targetMode = val;
            // A target change outside the Tuning Lab supersedes the pre-lab
            // snapshot — exitTuningLab must not clobber the user's newer
            // selection (see enterTuningLab/exitTuningLab in eq-core.js).
            if (!EQ_Module.isTuningLabActive) this._preLabTargetMode = undefined;

            const btn = document.getElementById('target-cycle-btn');
            const hiddenSel = document.getElementById('target-selector');

            if (val === 'sculptor') {
                this.currentTargetIdx = 0;
                if (btn) btn.innerHTML = '<span class="text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">✏️</span> Custom Target';
                if (hiddenSel) hiddenSel.value = 'sculptor';
            } else {
                const optIdx = this.targetOptions.findIndex(o => o.val === val);
                if (optIdx !== -1) {
                    this.currentTargetIdx = optIdx;
                    const rawLabel = this.targetOptions[optIdx].label;
                    const match = rawLabel.match(/^(\p{Extended_Pictographic}|\p{Emoji})\s*(.*)/u);
                    if (match) {
                        btn.innerHTML = `<span class="text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${match[1]}</span> ${match[2]}`;
                    } else {
                        btn.innerHTML = rawLabel;
                    }
                    if (hiddenSel) hiddenSel.value = val;
                } else {
                    this.currentTargetIdx = 0;
                    if (btn) btn.innerHTML = '<span class="text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🎯</span> Target: None';
                    if (hiddenSel) hiddenSel.value = '';
                }
            }

            if (val === 'sculptor') {
                this.updateSculptTargetData();
            } else {
                if (val && this.TARGETS[val]) {
                    const target = this.TARGETS[val];
                    this.STATE.activeCurves.push({
                        uid: 'target-' + val, id: val, name: target.name, role: 'target',
                        color: '#2563eb', visible: true, data: target.data
                    });
                }
            }
            this.updateAll();
        },

        generateLeastSquaresAutoEQ: async function() {
            // Re-entrancy guard: a second click while the solve is yielding to
            // the UI would interleave two solvers writing the same sliders.
            if (this._autoEqRunning) return;
            this._autoEqRunning = true;

            const baseCurve = this.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
            const targetCurve = this.STATE.activeCurves.find(c => c.role === 'target' && c.visible);

            Mascot.triggerTemporaryExpression('genius', 1500);

            if (!baseCurve || !targetCurve) {
                this._autoEqRunning = false;
                showToast("Load both a Base and Target curve to solve.", "⚠️");
                return;
            }

            EQ_Module.isProgrammaticSliderUpdate = true;

            // ALWAYS release the programmatic flag. A stuck true flag silently
            // disabled every subsequent manual audio update for the whole
            // session (sliders move, curve redraws, sound does not change).
            try {
            for (let i = 0; i < 10; i++) {
                const slider = document.getElementById("eq-s" + i);
                if (slider) slider.value = 0;
                const numInput = document.getElementById(`eq-s${i}_num`);
                if (numInput) numInput.value = "0.0";

                const b = EQ_Module.bands[i];
                const fInput = document.getElementById("eq-f" + i);
                if (fInput) fInput.value = b.hz;
                const fsSlider = document.getElementById(`eq-fs_m${i}`);
                if (fsSlider) fsSlider.value = EQ_Module.logHzToSlider(b.hz);

                const qSlider = document.getElementById("eq-q_m" + i);
                if (qSlider) qSlider.value = b.defaultQ;
                const qNum = document.getElementById(`eq-q_m${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                EQ_Module.updateSlider(i, 'main');
            }

            for (let i = 0; i < 10; i++) {
                const b = EQ_Module.advancedBands[i];
                b.g = 0;

                const aSlider = document.getElementById("eq-a" + i);
                if (aSlider) aSlider.value = 0;
                const aNum = document.getElementById(`eq-a${i}_num`);
                if (aNum) aNum.value = "0.0";

                const afInput = document.getElementById("eq-af" + i);
                if (afInput) afInput.value = b.hz;

                const qSlider = document.getElementById("eq-q_a" + i);
                if (qSlider) qSlider.value = b.defaultQ;
                const qNum = document.getElementById(`eq-q_a${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                EQ_Module.updateSlider(i, 'adv');
            }

            EQ_Module.virtualBands = [];
            // (native virtualFilters zeroing removed — virtual bands live in
            // the worklet and are pushed via updateAudioConnections)

            } finally {
                EQ_Module.isProgrammaticSliderUpdate = false;
            }

            const baseInterp = this.DSP.interpolate(this.getNormalizedData(baseCurve.data, baseCurve.name));
            const targetInterp = this.DSP.interpolate(this.getNormalizedData(targetCurve.data, targetCurve.name));
            const freqs = this.DSP.FREQS;
            const points = freqs.length;

            const targetCorrection = new Float32Array(points);
            for (let j = 0; j < points; j++) {
                targetCorrection[j] = targetInterp[j] - baseInterp[j];
            }

            const bandCount = PEQDB_Module.autoeqResolution || 10;

            const optimizedBands = [];

            if (bandCount === 10) {

                for (let i = 0; i < EQ_Module.bands.length; i++) {
                    const fInput = document.getElementById("eq-f" + i);
                    const qSlider = document.getElementById("eq-q_m" + i);
                    const hz = fInput ? parseFloat(fInput.value) : EQ_Module.bands[i].hz;
                    const q = qSlider ? parseFloat(qSlider.value) : EQ_Module.bands[i].defaultQ;
                    optimizedBands.push({ freq: hz, q: q, type: 'peaking', gain: 0.0, role: 'main', index: i });
                }
            } else if (bandCount === 20) {

                for (let i = 0; i < EQ_Module.bands.length; i++) {
                    const fInput = document.getElementById("eq-f" + i);
                    const qSlider = document.getElementById("eq-q_m" + i);
                    const hz = fInput ? parseFloat(fInput.value) : EQ_Module.bands[i].hz;
                    const q = qSlider ? parseFloat(qSlider.value) : EQ_Module.bands[i].defaultQ;
                    optimizedBands.push({ freq: hz, q: q, type: 'peaking', gain: 0.0, role: 'main', index: i });
                }
                for (let i = 0; i < EQ_Module.advancedBands.length; i++) {
                    const b = EQ_Module.advancedBands[i];
                    // Model each advanced band with its REAL filter type. The
                    // audio path (updateAudioConnections) applies these bands
                    // with their configured types (band 0 is a lowshelf; 7/8/9
                    // are highshelves) — modeling them all as peaking made the
                    // solver optimize gains for the wrong transfer functions.
                    optimizedBands.push({ freq: b.hz, q: b.q !== undefined ? b.q : b.defaultQ, type: b.type || 'peaking', gain: 0.0, role: 'adv', index: i });
                }
            } else {

                const targetFrequencies = [];
                const minF = 20;
                const maxF = 19000;
                for (let i = 0; i < bandCount; i++) {
                    targetFrequencies.push(Math.round(minF * Math.pow(maxF / minF, i / (bandCount - 1))));
                }

                const proportionalQ = Math.min(4.5, Math.max(1.0, 1.44 / (9.96 / bandCount)));

                targetFrequencies.forEach((hz, i) => {
                    optimizedBands.push({ freq: hz, q: parseFloat(proportionalQ.toFixed(2)), type: 'peaking', gain: 0.0, role: 'virtual', index: i });
                });
            }

            const bandResponses = [];
            optimizedBands.forEach(b => {
                const resp = new Float32Array(points);
                for (let j = 0; j < points; j++) {
                    resp[j] = 20 * Math.log10(Math.max(1e-10, EQ_Module.getBiquadMagnitude(b.type, freqs[j], b.freq, b.q, 1.0)));
                }
                bandResponses.push(resp);
            });

            const weights = new Float32Array(points);
            for (let j = 0; j < points; j++) {
                const f = freqs[j];
                if (f < 40) weights[j] = 0.3;
                else if (f < 100) weights[j] = 0.8;
                else if (f < 3000) weights[j] = 1.5;
                else if (f < 8000) weights[j] = 1.0;
                else weights[j] = 0.2;
            }

            const iterations = 20;
            try {
                for (let iter = 0; iter < iterations; iter++) {
                    for (let b = 0; b < optimizedBands.length; b++) {
                        let num = 0;
                        let den = 0;
                        const respB = bandResponses[b];

                        for (let j = 0; j < points; j++) {
                            let modeledVal = 0;
                            for (let k = 0; k < optimizedBands.length; k++) {
                                if (k !== b) {
                                    modeledVal += bandResponses[k][j] * optimizedBands[k].gain;
                                }
                            }
                            const residual = targetCorrection[j] - modeledVal;
                            num += residual * respB[j] * weights[j];
                            den += respB[j] * respB[j] * weights[j];
                        }

                        if (den > 1e-6) {
                            const idealGain = num / den;
                            optimizedBands[b].gain = Math.max(-12, Math.min(12, idealGain));
                        }
                    }
                    // Yield to the UI between sweeps so high band counts
                    // (up to 50 bands x 20 iterations of O(B^2*P) work) never
                    // freeze input for the whole solve.
                    if (iter < iterations - 1) await new Promise(r => setTimeout(r, 0));
                }

                let maxModelDb = 0;
            for (let j = 0; j < points; j++) {
                let modelDb = 0;
                for (let b = 0; b < optimizedBands.length; b++) {
                    modelDb += bandResponses[b][j] * optimizedBands[b].gain;
                }
                if (modelDb > maxModelDb) {
                    maxModelDb = modelDb;
                }
            }
            const optimalPreamp = maxModelDb > 0 ? -maxModelDb : 0;

            const preampSlider = document.getElementById("eq-preampSlider");
            if (preampSlider) preampSlider.value = optimalPreamp.toFixed(1);
            EQ_Module.updatePreamp();

            EQ_Module.virtualBands = [];
            // (native virtualFilters zeroing removed — see above)

            EQ_Module.isProgrammaticSliderUpdate = true;

            // ALWAYS release the programmatic flag. b.gain.toFixed(1) below
            // throws outright on a non-numeric solved band, and a stuck true
            // flag silently disabled every later manual audio update for the
            // rest of the session.
            try {
            if (bandCount === 10 || bandCount === 20) {
                optimizedBands.forEach((b) => {
                    if (b.role === 'main') {
                        const slider = document.getElementById("eq-s" + b.index);
                        if (slider) slider.value = b.gain.toFixed(1);
                        const numInput = document.getElementById(`eq-s${b.index}_num`);
                        if (numInput) numInput.value = b.gain.toFixed(1);
                        EQ_Module.updateSlider(b.index, 'main');
                    } else if (b.role === 'adv') {
                        const advBand = EQ_Module.advancedBands[b.index];
                        if (advBand) advBand.g = parseFloat(b.gain.toFixed(1));
                        EQ_Module.updateSlider(b.index, 'adv');
                    }
                });
            } else {

                const virtuals = [];
                optimizedBands.forEach((b, idx) => {
                    if (idx < 10) {

                        const slider = document.getElementById("eq-s" + idx);
                        if (slider) slider.value = b.gain.toFixed(1);
                        const numInput = document.getElementById(`eq-s${idx}_num`);
                        if (numInput) numInput.value = b.gain.toFixed(1);

                        const fInput = document.getElementById("eq-f" + idx);
                        if (fInput) fInput.value = b.freq;
                        const fsSlider = document.getElementById(`eq-fs_m${idx}`);
                        if (fsSlider) fsSlider.value = EQ_Module.logHzToSlider(b.freq);

                        const qSlider = document.getElementById("eq-q_m" + idx);
                        if (qSlider) qSlider.value = b.q.toFixed(1);
                        const qNum = document.getElementById(`eq-q_m${idx}_num`);
                        if (qNum) qNum.value = b.q.toFixed(2);

                        EQ_Module.updateSlider(idx, 'main');
                    } else if (idx < 20) {

                        const advIdx = idx - 10;
                        const advBand = EQ_Module.advancedBands[advIdx];
                        if (advBand) {
                            advBand.hz = b.freq;
                            advBand.g = parseFloat(b.gain.toFixed(1));
                            advBand.q = b.q;
                        }

                        const afInput = document.getElementById("eq-af" + advIdx);
                        if (afInput) afInput.value = b.freq;

                        const aSlider = document.getElementById("eq-a" + advIdx);
                        if (aSlider) aSlider.value = b.gain.toFixed(1);
                        const aNum = document.getElementById(`eq-a${advIdx}_num`);
                        if (aNum) aNum.value = b.gain.toFixed(1);

                        const qSlider = document.getElementById("eq-q_a" + advIdx);
                        if (qSlider) qSlider.value = b.q.toFixed(1);
                        const qNum = document.getElementById(`eq-q_a${advIdx}_num`);
                        if (qNum) qNum.value = b.q.toFixed(2);

                        EQ_Module.updateSlider(advIdx, 'adv');
                    } else {

                        const virtIdx = idx - 20;
                        virtuals.push({ hz: b.freq, g: b.gain, q: b.q, type: 'peaking' });
                        // (native virtualFilter param sync removed — the
                        // worklet owns slots 50+; updateAudioConnections
                        // pushes the whole virtual bank below)
                    }
                });
                EQ_Module.virtualBands = virtuals;
            }

            } finally {
                EQ_Module.isProgrammaticSliderUpdate = false;
            }

            EQ_Module.eqEnabled = true;
            const eqToggleBtn = document.getElementById("eqToggleBtn");
            if (eqToggleBtn) {
                eqToggleBtn.classList.add('is-on');
                eqToggleBtn.textContent = "EQ: ON";
            }

            // The solved bands above were applied while isProgrammaticSliderUpdate
            // was true, so updateSlider skipped its own DSP push. Send the filter
            // bank now — without this the worklet keeps the previous coefficients
            // and AutoEQ only changes what's heard after the next manual tweak
            // (same pattern as applyGeneratedPEQ/convertHearingToEQ).
            if (EQ_Module.graphBuilt) {
                EQ_Module.updateAudioConnections();
            }

            EQ_Module.updatePreamp();
            EQ_Module.drawCurve();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
            // The solve rewrote the DSP curve programmatically — unlock
            // live Similar-mode matching (this was the only path that
            // accidentally flipped the flag before, via its preamp change).
            this._similarTargetEverModified = true;
            showToast(`AutoEQ solved and loaded ${bandCount} bands successfully!`, "🪄");
            } finally {
                this._autoEqRunning = false;
            }
        },

        clearState: async function() {
            // This button discards every loaded curve AND resets the whole EQ,
            // in one click, with no undo. It used to run unguarded, so a stray
            // click lost the entire session's work irrecoverably. Route it
            // through the same themed confirm the preset delete already uses.
            const ok = await UIKit.confirm({
                title: 'Clear the graph and reset the EQ?',
                message: 'Every loaded curve and target will be removed and all bands reset to flat. This cannot be undone.',
                confirmLabel: 'Clear Everything',
                danger: true
            });
            if (!ok) return;

            this.STATE.activeCurves = [];
            this.targetMode = '';
            this.activeSculptIndex = -1;
            this.hoverSculptIndex = -1;
            EQ_Module.isTuningLabActive = false;
            EQ_Module.graphFocus = 'eq';
            var overlay = document.getElementById('graph-focus-selector');
            if (overlay) overlay.classList.add('hidden');
            var editBtn = document.getElementById('target-edit-btn');
            if (editBtn) { editBtn.classList.remove('active-btn', 'is-on'); editBtn.innerHTML = '✏️'; }
            var selector = document.getElementById('target-selector');
            if (selector) selector.value = "";
            EQ_Module.resetEQ(true);
            this.updateAll();
        },
        // NOTE: the expensive full-renderList() duplicate of updateAll() that used
        // to sit here was removed — it silently shadowed the lightweight version
        // above (which uses updateAllRowSelectionUIs()) since object literals keep
        // only the last "updateAll:" key. That meant every curve toggle/color
        // cycle/dB-offset click was rebuilding the entire visible DB list from
        // scratch instead of just patching each row's selection state in place.
        renderActiveCurvesDock: function() {
            const baseSlot = document.getElementById('base-slot');
            const targetSlot = document.getElementById('target-slot');
            const referencePile = document.getElementById('reference-pile');
            if (!baseSlot || !targetSlot || !referencePile) return;
            baseSlot.innerHTML = '';
            targetSlot.innerHTML = '';
            referencePile.innerHTML = '';
            let baseCount = 0, targetCount = 0, refCount = 0;
            this.STATE.activeCurves.forEach(c => {
                const item = document.createElement('div');
                const hex = c.color || "#3b82f6";
                let r = 37, g = 99, b = 235;
                if (hex && typeof hex === 'string' && hex.startsWith('#')) {
                    const cleanHex = hex.replace('#', '');
                    if (cleanHex.length === 3) {
                        const rv = parseInt(cleanHex[0]+cleanHex[0],16), gv = parseInt(cleanHex[1]+cleanHex[1],16), bv = parseInt(cleanHex[2]+cleanHex[2],16);
                        r = isNaN(rv)?37:rv; g = isNaN(gv)?99:gv; b = isNaN(bv)?235:bv;
                    } else if (cleanHex.length >= 6) {
                        const rv = parseInt(cleanHex.slice(0,2),16), gv = parseInt(cleanHex.slice(2,4),16), bv = parseInt(cleanHex.slice(4,6),16);
                        r = isNaN(rv)?37:rv; g = isNaN(gv)?99:gv; b = isNaN(bv)?235:bv;
                    }
                }
                item.setAttribute('draggable','true');
                item.addEventListener('dragstart', (e)=>this.handleDragStart(e,c.uid));
                item.className = "w-[190px] h-[118px] p-2 flex flex-col justify-between relative select-none cursor-grab active:cursor-grabbing transition-all hover:scale-[1.01] flex-shrink-0";
                item.style.cssText = `background: rgba(${r},${g},${b},0.28) !important;border:2px solid rgba(${r},${g},${b},0.95) !important;`;
                item.style.boxShadow = `2px 2px 0px 0px rgba(0,0,0,0.8)`;
                item.setAttribute('data-uid', c.uid);
                item.title = "Drag to Base / Target / Reference slot to change role";
                const roleLabel = c.role==='base'?'BASE':(c.role==='target'?'TARGET':'REF');
                /* The three header controls carry flex-shrink-0. As flex children they
           defaulted to shrink:1, so a wide chip (a long role label, or a wide
           font) squeezed the button row and the 24px controls rendered at 19px -
           which is exactly the "swatch is smaller than its neighbours"
           symptom, and it came and went with the curve name rather than
           reporting itself as a bug. Pinning the size makes the row
           deterministic. */
item.innerHTML = `<div class="flex items-center justify-between w-full h-6 select-none" draggable="false"><span class="curve-role-chip px-2 py-0.5 type-micro font-black tracking-wider text-white uppercase bg-black/60 border border-white/10 flex-shrink-0" title="Drag to rearrange" draggable="false">${roleLabel}</span><div class="flex items-center gap-1.5 flex-shrink-0" draggable="false"><button data-cmd="PEQDB_Module.toggleVisible" data-arg-0="@from:uid" class="w-6 h-6 flex-shrink-0 bg-black/50 hover:bg-black/80 text-white type-xs flex items-center justify-center border border-white/10 cursor-pointer" title="Show or hide this curve" draggable="false">${c.visible?'👁️':'🙈'}</button><button data-cmd="PEQDB_Module.cycleColor" data-arg-0="@from:uid" class="curve-card-swatch w-6 h-6 flex-shrink-0 border-2 border-white shadow-md flex items-center justify-center cursor-pointer hover:scale-110 transition-transform" style="background-color:${c.color}" title="Change this curve's color" draggable="false">🎨</button><button data-cmd="PEQDB_Module.removeCurve" data-arg-0="@from:uid" class="w-6 h-6 flex-shrink-0 bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 font-black type-xs flex items-center justify-center cursor-pointer" title="Remove this curve" draggable="false">✕</button></div></div><div data-cmd="PEQDB_Module.renameCurve" data-arg-0="@from:uid" class="flex-1 flex items-center justify-center overflow-hidden cursor-pointer w-full px-1.5 py-0.5" draggable="false"><div class="w-full overflow-hidden whitespace-nowrap flex justify-center items-center pointer-events-none"><span id="marquee-${esc(c.uid)}" class="text-black font-black text-xs tracking-wide inline-block whitespace-nowrap">${esc(c.name)}</span></div></div><div class="flex justify-between items-center w-full h-6" draggable="false"><div class="flex items-center gap-1.5 h-6 decibel-stepper flex-shrink-0 select-none" style="width:110px !important;min-width:110px !important;max-width:110px !important;" draggable="false"><button type="button" data-cmd="PEQDB_Module.adjustCurveOffset" data-arg-0="@from:uid" data-arg-1="-1" class="w-6 h-6 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black type-micro flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0" title="Move the curve down 1 dB" draggable="false">◄</button><button type="button" data-stop-propagation class="flex-1 h-6 bg-[var(--bg-input)] border-2 border-black text-[#c85a0e] font-mono font-black type-micro flex items-center justify-center text-center cursor-default select-none focus:outline-none px-0 min-w-0" draggable="false">${(c.offset||0)>=0?'+':''}${c.offset||0}dB</button><button type="button" data-cmd="PEQDB_Module.adjustCurveOffset" data-arg-0="@from:uid" data-arg-1="1" class="w-6 h-6 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black type-micro flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0" title="Move the curve up 1 dB" draggable="false">►</button></div><div class="flex items-center gap-1.5" draggable="false"><button data-cmd="PEQDB_Module.exportCurveByUid" data-arg-0="@from:uid" class="w-6 h-6 bg-black/50 hover:bg-black/80 border border-white/10 text-white type-micro flex items-center justify-center cursor-pointer" title="Export this curve as a text file" draggable="false">📥</button><button data-cmd="PEQDB_Module.findMatchesFromDock" data-arg-0="@from:uid" class="w-6 h-6 bg-black/50 hover:bg-black/80 border border-white/10 text-white type-micro flex items-center justify-center cursor-pointer" title="Find similar curves" draggable="false">🔍</button></div></div>`;
                if (c.role==='base') { baseSlot.appendChild(item); baseCount++; }
                else if (c.role==='target') { targetSlot.appendChild(item); targetCount++; }
                else { referencePile.appendChild(item); refCount++; }
            });
            if (baseCount===0) { baseSlot.innerHTML='<div class="text-center type-micro leading-normal text-zinc-600 px-3 select-none pointer-events-none">📥 Drag or click curve<br>to set as <span class="text-amber-500 font-bold">Base</span></div>'; }
            if (targetCount===0) { targetSlot.innerHTML='<div class="text-center type-micro leading-normal text-zinc-600 px-3 select-none pointer-events-none">🎯 Drag or click curve<br>to set as <span class="text-blue-500 font-bold">Target</span></div>'; }
            if (refCount===0) { referencePile.innerHTML='<div class="text-center type-micro leading-normal text-zinc-650 px-3 w-full select-none pointer-events-none">Empty Reference Pile<br><span class="type-micro opacity-80">(Compare overlays)</span></div>'; }
            setTimeout(()=>{
                this.STATE.activeCurves.forEach(c=>{
                    const el = document.getElementById(`marquee-${c.uid}`);
                    if(el && el.parentElement && el.parentElement.clientWidth>0){
                        const pW=el.parentElement.clientWidth, cW=el.scrollWidth;
                        if(cW>pW){ const dist=-(cW-pW+8); el.style.setProperty('--scroll-dist',`${dist}px`); el.classList.add('marquee-active'); }
                    }
                });
            },80);
        },

        handleDragStart: function(e, uid) {
            e.dataTransfer.setData("text/plain", uid);
            e.dataTransfer.effectAllowed = 'move';
            // Use tiny drag image to avoid rasterizing 190x118 card (can stall on low-end)
            try {
                const dragImg = document.createElement('canvas');
                dragImg.width = 1; dragImg.height = 1;
                if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(dragImg, 0, 0);
            } catch(_) {}
        },

        handleDrop: function(e, targetRole) {
            e.preventDefault();
            e.stopPropagation();
            const uid = e.dataTransfer.getData("text/plain");
            if (!uid) return;
            requestAnimationFrame(() => {
                this.assignRole(uid, targetRole);
            });
        },

        assignRole: function(uid, targetRole) {
            const targetCard = this.STATE.activeCurves.find(c => c.uid === uid);
            if (!targetCard) return;
            const affectedIds = new Set();
            if (targetRole === 'base') {
                this.STATE.activeCurves.forEach(c => {
                    if (c.role === 'base' && c.uid !== uid) {
                        c.role = 'reference';
                        affectedIds.add(c.id);
                    }
                });
            } else if (targetRole === 'target') {
                this.STATE.activeCurves.forEach(c => {
                    if (c.role === 'target' && c.uid !== uid) {
                        c.role = 'reference';
                        affectedIds.add(c.id);
                    }
                });
                this.targetMode = '';
                const selectVal = document.getElementById('target-selector');
                if (selectVal) selectVal.value = '';
            }
            affectedIds.add(targetCard.id);
            targetCard.role = targetRole;
            try {
                affectedIds.forEach(id => this.updateRowSelectionUI(id));
                EQ_Module.drawCurve();
                this.renderActiveCurvesDock();
                if (!this._deferredFullSync) {
                    this._deferredFullSync = true;
                    requestAnimationFrame(()=> {
                        this._deferredFullSync = false;
                        try { this.updateAllRowSelectionUIs(); } catch(_){ }
                    });
                }
            } catch(e) {
                this.updateAll();
            }
        },
        toggleVisible: function(uid) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (c) c.visible = !c.visible;

            this.updateAll();
        },
        activeRenameUid: null,
        renameCurve: function(uid) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (!c) return;
            this.activeRenameUid = uid;

            const modal = document.getElementById('rename-modal');
            const input = document.getElementById('rename-input');
            if (modal && input) {
                input.value = c.name;
                modal.classList.remove('hidden');
                Mascot.update();

                setTimeout(() => input.focus(), 50);
            }
        },
        closeRenameModal: function() {
            const modal = document.getElementById('rename-modal');
            if (modal) modal.classList.add('hidden');
            this.activeRenameUid = null;
            Mascot.update();
        },
        confirmRename: function() {
            if (!this.activeRenameUid) return;
            const c = this.STATE.activeCurves.find(item => item.uid === this.activeRenameUid);
            const input = document.getElementById('rename-input');
            if (c && input) {
                const cleanName = input.value.trim();
                if (cleanName) {
                    c.name = cleanName;
                    this.updateAll();
                    showToast(`Curve renamed to "${cleanName}"`, "📝");
                }
            }
            this.closeRenameModal();
        },
        removeCurve: function(uid) {
            const victim = this.STATE.activeCurves.find(c => c.uid === uid);
            const victimId = victim ? victim.id : null;
            this.STATE.activeCurves = this.STATE.activeCurves.filter(c => c.uid !== uid);
            try {
                if (victimId) this.updateRowSelectionUI(victimId);
                else this.updateAllRowSelectionUIs();
                EQ_Module.drawCurve();
                this.renderActiveCurvesDock();
            } catch(e) { this.updateAll(); }
        },
        cycleColor: function(uid) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (!c) return;
            const idx = this.colorPalette.indexOf(c.color);
            c.color = this.colorPalette[(idx + 1) % this.colorPalette.length];
            this.updateAll();
        },
        adjustCurveOffset: function(uid, delta) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (c) {
                c.offset = Math.max(-10, Math.min(10, (c.offset || 0) + delta));
                this.updateAll();
            }
        },


        findMatchesFromDock: function(uid) {
            const card = this.STATE.activeCurves.find(c => c.uid === uid);
            if (!card || !card.data) return;

            this.assignRole(uid, 'base');
            App.switchTab('find');
            FindEngine.setFindMode('tuning');
            FindEngine.applyEQBaseClone();
            FindEngine.scanAndMatch();
            showToast(`Searching matches for "${card.name}"...`, "🔍");
        },

        exportCurveByUid: function(uid) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (!c) return;

            const norm = this.getNormalizedData(c.data, c.name);
            const spline = this.Spline.build(norm);
            if (!spline) return;

            let out = `Frequency\tAmplitude\n`;
            const freqs = this.DSP.FREQS;

            freqs.forEach(f => {
                const evalF = this.getShiftedFrequency(f, c.role);
                let db = this.Spline.evaluate(spline, evalF);
                db += (c.offset || 0);
                out += `${f.toFixed(2)}\t${db.toFixed(2)}\n`;
            });

            const filename = c.name.replace(/[\s/\\?%*:|"<>]+/g, '_') + '.txt';
            EQ_Module.triggerDownload(filename, out);
        },

                analyzeCurveSignature: function(data) {
            if (!data || data.length < 10) return [];
            const tags = [];

            const norm = this.getNormalizedData(data, 'analyzer');
            const getDbAt = (hz) => {
                let closest = norm[0];
                let minDiff = Infinity;
                for (let i = 0; i < norm.length; i++) {
                    const diff = Math.abs(norm[i][0] - hz);
                    if (diff < minDiff) { minDiff = diff; closest = norm[i]; }
                }
                return closest[1];
            };

            const subBass = (getDbAt(20) + getDbAt(30) + getDbAt(40) + getDbAt(50) + getDbAt(60)) / 5;
            const midBass = (getDbAt(80) + getDbAt(100) + getDbAt(125) + getDbAt(150) + getDbAt(200)) / 5;
            const lowMids = (getDbAt(250) + getDbAt(300) + getDbAt(400) + getDbAt(500)) / 4;
            const mids = (getDbAt(600) + getDbAt(800) + getDbAt(1000) + getDbAt(1200)) / 4;
            const upperMids = (getDbAt(1500) + getDbAt(2000) + getDbAt(2500) + getDbAt(3000)) / 4;
            const presence = (getDbAt(3500) + getDbAt(4000) + getDbAt(5000) + getDbAt(6000)) / 4;
            const treble = (getDbAt(7000) + getDbAt(8000) + getDbAt(9000) + getDbAt(10000)) / 4;
            const air = (getDbAt(12000) + getDbAt(14000) + getDbAt(16000) + getDbAt(18000) + getDbAt(20000)) / 5;

            const midReference = (lowMids + mids) / 2;
            const bassBoost = subBass - midReference;
            const trebleBoost = treble - midReference;
            const upperMidPresence = upperMids - midReference;

            if (bassBoost > 8) tags.push('💥 Basshead');
            else if (bassBoost > 5) tags.push('🌊 Bass Boosted');
            else if (bassBoost > 2.5) tags.push('🔊 Warm Tilt');

            if (subBass - midBass > 3) tags.push('🌋 Sub Focus');

            if (bassBoost > 3 && trebleBoost > 3 && mids < midReference - 1) tags.push('🔺 V-Shaped');

            if (bassBoost > 2 && trebleBoost > 2 && Math.abs(mids - midReference) < 2) tags.push('🧲 U-Shaped');

            if (Math.abs(bassBoost) < 2 && Math.abs(trebleBoost) < 2 && Math.abs(upperMidPresence) < 2.5) {
                tags.push('⚖️ Neutral');
            }

            if (trebleBoost > 4) tags.push('✨ Bright');
            else if (trebleBoost > 2) tags.push('🔍 Detailed');

            if (trebleBoost < -3) tags.push('🌑 Dark');
            else if (trebleBoost < -1.5) tags.push('😌 Relaxed Treble');

            if (upperMidPresence > 3) tags.push('🎤 Vocal Forward');

            const presenceBoost = presence - midReference;
            if (Math.abs(upperMidPresence) < 2 && presenceBoost > 2) tags.push('🔬 Analytical');

            if (bassBoost > 1.5 && trebleBoost < 0 && Math.abs(upperMidPresence) < 3) tags.push('🎵 Musical');

            const pinnaRegion = (getDbAt(2000) + getDbAt(2500) + getDbAt(3000) + getDbAt(3500)) / 4;
            const pinnaSharpness = pinnaRegion - ((mids + presence) / 2);
            if (pinnaSharpness > 4) tags.push('🎯 BA Timbre');

            if (air > treble - 2 && air > midReference - 2) tags.push('🎐 Extended Air');

            if (air < treble - 6) tags.push('📉 Treble Roll-off');

            if (upperMidPresence > 2 && presenceBoost > 1) tags.push('🎮 Gaming Ready');

            if (subBass - midReference > 4 && Math.abs(trebleBoost) < 3) tags.push('🎬 Cinematic');

            return tags.slice(0, 4);
        },

        standardizeCurveData: function(data) {
            if (!data) return [];

            if (typeof data === 'string') {

                if (data.includes('\n') || data.includes('\r')) {
                    const parsed = this.parseRawFRText(data);
                    return parsed ? parsed.data : [];
                }
                data = data.split(/[\s,]+/);
            }

            if (typeof data === 'object' && !Array.isArray(data)) {
                const freqs = data.f || data.freqs || data.frequency || data.x;
                const dbs = data.db || data.dbs || data.amplitude || data.y || data.values;
                if (freqs && dbs) {
                    const parsed = [];
                    for (let i = 0; i < Math.min(freqs.length, dbs.length); i++) {
                        parsed.push([parseFloat(freqs[i]), parseFloat(dbs[i])]);
                    }
                    return parsed;
                }
            }

            if (Array.isArray(data)) {

                if (data.length > 0 && !Array.isArray(data[0]) && typeof data[0] !== 'object') {
                    const parsed = [];
                    for (let i = 0; i < data.length; i += 2) {
                        const f = parseFloat(data[i]);
                        const a = parseFloat(data[i+1]);
                        if (!isNaN(f) && !isNaN(a)) {
                            parsed.push([f, a]);
                        }
                    }
                    return parsed;
                }

                return data.map(item => {
                    if (Array.isArray(item)) return [parseFloat(item[0]), parseFloat(item[1])];
                    if (typeof item === 'object' && item.hz !== undefined) return [parseFloat(item.hz), parseFloat(item.db || item.gain || 0)];
                    return [0, 0];
                }).filter(item => !isNaN(item[0]) && !isNaN(item[1]));
            }
            return [];
        },

                toggleTargetSculptor: function() {
            if (EQ_Module.isTuningLabActive) {
                EQ_Module.exitTuningLab(true);
            } else {
                EQ_Module.enterTuningLab();
            }
        },
        // NOTE: there is deliberately NO fallback curve here. Empty input
        // returns empty: downstream renders/interpolates it as flat (no
        // data → no claim) and scoring entry points skip <2-point curves.
        // A previous hash-seeded "dynamic fallback" invented plausible
        // bass/pinna values from the curve NAME and every consumer treated
        // them as measurement — removed.
        getNormalizedData: function(raw_data, curveName) {
            let data = this.standardizeCurveData(raw_data);

            if (!data || data.length === 0) return [];

            const ref_db = this.getRefDb(data);
            return data.map(item => [item[0], item[1] - ref_db + this.alignDb]);
        },


        precalculateInterps: function() {
            if (!this.STATE.dataset) return;
            const ver = this._alignmentVersion || 0;
            this.STATE.dataset.forEach(item => {
                // Skip items already cached under the CURRENT alignment
                // version — the version bump in updateAlignmentCfgActual
                // invalidates them without a bulk walk that nulls 10k+
                // arrays on every align toggle.
                if (item.cachedInterp && item._cachedInterpVer === ver) return;
                if (!item.data) return;
                try {
                    const norm = this.getNormalizedData(item.data, item.name);
                    item.cachedInterp = Array.from(this.DSP.interpolate(norm));
                    item._cachedInterpVer = ver;
                } catch(e) {
                    item.cachedInterp = null;
                }
            });
            this.STATE.lightweightDataset = this.STATE.dataset.map(item => ({
                id: item.id,
                name: item.name,
                variant: item.variant,
                source: item.source,
                cachedInterp: (item.cachedInterp && item._cachedInterpVer === ver) ? item.cachedInterp : null
            })).filter(item => item.cachedInterp !== null);
        },

        normalizeSearchText: function(str) {
            if (!str) return "";
            let clean = str.toLowerCase();

            clean = clean.replace(/\bmk\s*ii\b/g, 'mk 2');
            clean = clean.replace(/\bmk\s*iii\b/g, 'mk 3');
            clean = clean.replace(/\bmk\s*iv\b/g, 'mk 4');
            clean = clean.replace(/\bii\b/g, '2');
            clean = clean.replace(/\biii\b/g, '3');
            clean = clean.replace(/\biv\b/g, '4');
            clean = clean.replace(/\bv\b/g, '5');
            clean = clean.replace(/\bvi\b/g, '6');
            clean = clean.replace(/\bvii\b/g, '7');
            clean = clean.replace(/\bviii\b/g, '8');
            clean = clean.replace(/\bix\b/g, '9');
            clean = clean.replace(/\bx\b/g, '10');

            clean = clean.replace(/([a-z]+)(\d+)/g, '$1 $2 $1$2');
            clean = clean.replace(/(\d+)([a-z]+)/g, '$1 $2 $1$2');

            if (clean.includes('kz') || clean.includes('knowledge zenith')) clean += ' kz knowledge zenith';
            if (clean.includes('7hz') || clean.includes('salnotes')) clean += ' 7hz salnotes';
            if (clean.includes('1more') || clean.includes('onemore')) clean += ' 1more onemore';
            if (clean.includes('cca') || clean.includes('clear concept')) clean += ' cca clear concept audio';
            if (clean.includes('tfz') || clean.includes('fragrant zither')) clean += ' tfz the fragrant zither';
            if (clean.includes('um') || clean.includes('unique melody')) clean += ' um unique melody';
            if (clean.includes('jh') || clean.includes('jerry harvey')) clean += ' jh jh audio jerry harvey';
            if (clean.includes('ue') || clean.includes('ultimate ears')) clean += ' ue ultimate ears';
            if (clean.includes('simgot')) clean += ' simgot audio';
            if (clean.includes('tangzu') || clean.includes('tforce')) clean += ' tangzu tforce';
            if (clean.includes('fatfreq') || clean.includes('fat freq')) clean += ' fatfreq fat freq';
            if (clean.includes('nfaudio') || clean.includes('nf audio')) clean += ' nfaudio nf audio';
            if (clean.includes('634ears') || clean.includes('634 ears')) clean += ' 634ears 634 ears';
            if (clean.includes('shuoer') || clean.includes('letshuoer')) clean += ' shuoer letshuoer';
            if (clean.includes('tgx') || clean.includes('tgxear')) clean += ' tgx tgxear';

            clean = clean.replace(/[^a-z0-9\s]/g, ' ');
            return clean.replace(/\s+/g, ' ').trim();
        },

        matchSearchTokens: function(targetText, rawQuery) {
            if (!rawQuery || !rawQuery.trim()) return true;
            const normTarget = this.normalizeSearchText(targetText);
            const normQuery = this.normalizeSearchText(rawQuery);

            const queryTokens = normQuery.split(' ').filter(t => t.length > 0);
            if (queryTokens.length === 0) return true;

            return queryTokens.every(token => normTarget.includes(token));
        },

        getSearchNorm: function(item) {
            if (item && !item._searchNorm) {
                const filePaths = Array.isArray(item.files) ? item.files.join(' ') : (item.primaryFilePath || '');
                item._searchNorm = this.normalizeSearchText(`${item.name} ${item.brand || ''} ${item.model || ''} ${item.variant || ''} ${item.source || ''} ${filePaths} ${item.searchKey || ''}`);
            }
            return item ? (item._searchNorm || '') : '';
        },

        matchSearchTokensNorm: function(normTarget, rawQuery) {
            if (!rawQuery || !rawQuery.trim()) return true;
            const normQuery = this.normalizeSearchText(rawQuery);
            const queryTokens = normQuery.split(' ').filter(t => t.length > 0);
            if (queryTokens.length === 0) return true;
            return queryTokens.every(token => normTarget.includes(token));
        },

        _brandNormCache: null,
        getBrandNorm: function(brand) {
            if (!this._brandNormCache) this._brandNormCache = new Map();
            if (!this._brandNormCache.has(brand)) this._brandNormCache.set(brand, this.normalizeSearchText(brand));
            return this._brandNormCache.get(brand);
        },





        buildDbModelCard: function(item, similarInfo) {
            if (!this.dbItemFileIndex) this.dbItemFileIndex = {};
            const fileCount = item.files ? item.files.length : 0;
            const isMulti = fileCount > 1;
            const curFileIdx = this.dbItemFileIndex[item.id] || 0;
            const activeFileIdx = Math.min(curFileIdx, Math.max(0, fileCount - 1));

            const filePath = item.files && item.files[activeFileIdx] ? item.files[activeFileIdx] : item.primaryFilePath;
            const pathParts = (filePath || '').split('/');
            const sourceName = pathParts.length >= 3 ? pathParts[1] : (pathParts.length >= 2 ? pathParts[0] : (item.source || 'Database'));
            const fileNameRaw = pathParts[pathParts.length - 1] || '';
            const fileNameNoExt = fileNameRaw.replace(/\.[^/.]+$/, '');

            const activeCurves = this.STATE.activeCurves;

            const rank = similarInfo?.rank;
            const similarity = similarInfo?.similarity;
            // Resolve loaded state: prefer explicit similarInfo, else detect via active curves
            const _curveUid = `${item.id}_src_${activeFileIdx}`;
            const _activeCurve = activeCurves.find(c => c.uid === _curveUid || (fileCount <= 1 && c.id === item.id));
            const isLoaded = similarInfo?.isLoaded ?? !!_activeCurve;
            const _activeColor = _activeCurve ? _activeCurve.color : null;
            const rowAccentColor = similarInfo?.rowAccentColor || _activeColor || 'var(--border-color)';

            const formFactorEmojiMap = {
                'IEM': FindEngine.formFactorEmojis['IEM'],
                'Earbuds (Wired)': FindEngine.formFactorEmojis['Earbuds (Wired)'],
                'Wireless Earbuds (TWS)': FindEngine.formFactorEmojis['Wireless Earbuds (TWS)'],
                'Over-Ear Headphones (Wired)': FindEngine.formFactorEmojis['Over-Ear Headphones (Wired)'],
                'Wireless Over-Ear Headphones': FindEngine.formFactorEmojis['Wireless Over-Ear Headphones']
            };
            const formEmoji = formFactorEmojiMap[item.form_factor] || FindEngine.formFactorEmojis['IEM'];
            const driverEmoji = FindEngine.driverEmojis[item.driver_type] || '⚙️';
            const driverTooltip = `${item.driver_type || 'Driver'}${item.driver_config ? ' (' + item.driver_config + ')' : ''}`;
            const connectorEmoji = FindEngine.connectorEmojis[item.connector] || '🔌';

            const specIconsHtml = `
                ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:var(--t-micro);">$${esc(item.price_usd)}</span></span>` : ''}
                ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:var(--t-micro);">${esc(item.year)}</span></span>` : ''}
                ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${esc(item.connector)}">${connectorEmoji}</span>` : ''}
                <span class="spec-icon-badge" data-tooltip="${esc(item.form_factor || 'In-Ear Monitor (IEM)')}">${formEmoji}</span>
            `;

            const tagsHtml = (item.tags || []).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${FindEngine.getTagEmoji(t)}</span>`).join('');

            let fileRowHtml;
            if (isMulti) {
                fileRowHtml = `
                    <div class="flex items-center gap-1.5 mt-1">
                        <button data-cmd="PEQDB_Module.cycleDbItemSource" data-arg-0="${escJs(item.id)}" data-arg-1="-1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center type-micro font-black border border-black" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">◀</button>
                        <div class="db-file-name flex-1 min-w-0 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="db-file-marquee-text type-micro font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                        </div>
                        <button data-cmd="PEQDB_Module.cycleDbItemSource" data-arg-0="${escJs(item.id)}" data-arg-1="1" class="w-5 h-5 flex-shrink-0 flex items-center justify-center type-micro font-black border border-black" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">▶</button>
                    </div>
                `;
            } else {
                fileRowHtml = `
                    <div class="db-file-name mt-1 overflow-hidden border border-white/[0.06] px-1.5 py-0.5" style="background: var(--bg-input);">
                        <span class="db-file-marquee-text type-micro font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
                    </div>
                `;
            }

            const similarHeader = similarInfo ? `
                <div class="flex items-center justify-between gap-2 mb-1.5 border-b border-white/[0.05] pb-1.5">
                    <span class="type-micro font-mono text-[var(--text-secondary)]">#${similarInfo.rank}</span>
                    <span class="flex items-center gap-1.5">
                        <span class="type-xs font-black text-[var(--accent-green)]" title="Probe similarity (linear MAE scale) — not the Find tab's exponential tuning-match %">${similarInfo.similarity.toFixed(1)}%</span>
                        ${similarInfo.badgeHtml || ''}
                    </span>
                </div>
            ` : '';

            const div = document.createElement('div');
            div.className = 'peqdb-row-item p-2 mb-1.5 transition-all select-none cursor-pointer';
            div.setAttribute('data-id', item.id);
            if (isLoaded && _activeCurve) {
                div.classList.add('is-loaded');
                div.style.setProperty('--row-glow', `rgba(${this.hexToRgb(_activeCurve.color)}, 0.28)`);
                div.style.setProperty('--row-glow-solid', _activeCurve.color);
            }
            // NOTE: this card is serialized via .outerHTML and reinjected as an
            // HTML string at both call sites (renderSimilarList's main list
            // build and toggleGroupExpand's lazy drawer fill), so the
            // click-to-load handler MUST be a real attribute, not a
            // JS property (div.onclick = ...) — property handlers are
            // invisible to .outerHTML and get silently dropped once the
            // markup is re-parsed from the string.
            //
            // It must NOT be an attribute-form `onclick` either: script-src has
            // no 'unsafe-inline', so Chromium refused to compile it and the card
            // rendered as clickable but did nothing. `data-cmd` + `data-arg-N`
            // satisfies the outerHTML requirement (they are plain attributes)
            // AND is dispatched by the capture-phase document listener in
            // events.js, so it survives the round-trip without re-binding.
            div.setAttribute('data-cmd', 'PEQDB_Module.toggleCurveSelection');
            // esc, NOT escJs. escJs escapes for a JS string literal inside an
            // attribute (it turns ' into \'), but an attribute read back with
            // getAttribute decodes HTML entities and leaves backslashes as
            // literal characters - so escJs would hand the handler "Lil\' Jamz"
            // instead of "Lil' Jamz". No id in database.json contains an
            // apostrophe today, so this is not a live break; esc is simply the
            // correct escaper for a data-arg-N. (16 other data-arg sites still
            // use escJs for the same reason - filed separately as a latent bug.)
            div.setAttribute('data-arg-0', esc(item.id));
            // String, because it arrives via getAttribute; events.js coerceArg
            // turns a numeric string back into a Number, which is what
            // toggleCurveSelection expects as its second argument.
            div.setAttribute('data-arg-1', String(activeFileIdx));
            div.innerHTML = similarHeader + `
                <div class="db-title-row overflow-hidden whitespace-nowrap">
                    <span class="db-title-text font-black text-stone-200 text-xs inline-block whitespace-nowrap">${esc(item.name)}</span>
                </div>
                <div class="type-micro text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
                <div class="flex flex-wrap items-center justify-center gap-1 mt-1">${specIconsHtml}</div>
                ${tagsHtml ? `<div class="flex flex-wrap items-center justify-center gap-1 mt-1">${tagsHtml}</div>` : ''}
                ${fileRowHtml}
            `;
            return div;
        },
        averageActiveCurves: function() {
            const activeReferences = this.STATE.activeCurves.filter(c => c.role === 'reference' && c.visible);
            if (activeReferences.length < 2) {
                showToast("Activate at least 2 Reference curves to calculate average values.", "📊");
                return;
            }
            const points = 500;
            const freqs = new Float32Array(this.DSP.FREQS);
            const summedVals = new Float32Array(points).fill(0);

            activeReferences.forEach(c => {
                const norm = this.getNormalizedData(c.data, c.name);
                const interp = this.DSP.interpolate(norm);
                for (let i = 0; i < points; i++) {
                    summedVals[i] += interp[i];
                }
            });

            const rawAverage = new Float32Array(points);
            for (let i = 0; i < points; i++) {
                rawAverage[i] = summedVals[i] / activeReferences.length;
            }

            const smoothedAverage = CurveUtils.gaussianSmooth(freqs, rawAverage, 0.08);

            const numAnchors = 120;
            const avgData = [];
            for (let k = 0; k < numAnchors; k++) {
                const index = Math.round((k / (numAnchors - 1)) * (points - 1));
                avgData.push([freqs[index], smoothedAverage[index]]);
            }

            const uid = 'target-averaged-' + Date.now();
            const name = `Average (${activeReferences.length} Refs)`;

            this.STATE.activeCurves = this.STATE.activeCurves.filter(c => c.role !== 'target');
            this.STATE.activeCurves.push({
                uid, name, role: 'target', color: '#ff9500', visible: true, data: avgData
            });
            this.updateAll();
            showToast(`Averaged ${activeReferences.length} traces into smooth Target plot.`, "📊");
        },
        freezeEQAsTarget: function() {
            Mascot.triggerTemporaryExpression('genius', 1500);
            const points = 500;
            const freqs = new Float32Array(this.DSP.FREQS);
            const composite = new Float32Array(points).fill(80.0);
            const realValues = EQ_Module.getRealValues();

            for (let i = 0; i < points; i++) {
                composite[i] += realValues.preVal;
            }

            // (The legacy native-BiquadFilterNode 'mathFilters' bank was
            // removed with the AudioWorklet refactor — this tool crashed with
            // a TypeError on every invocation. Rebuilt with
            // getBiquadMagnitude (eq-biquad-math.js), the same RBJ math the
            // worklet and the drawn curve use, mirroring updateAudioConnections'
            // main-band rules: per-band type, DOM hz/gain/Q, bypass flags and
            // the shelf/HP/LP slope cascade.)
            EQ_Module.bands.forEach((b, i) => {
                const isBypassed = window.bypassedBands.has("m" + i);
                if (isBypassed) return;
                const type = b.type || 'peaking';

                const rawHz = parseFloat(document.getElementById("eq-f" + i)?.value);
                const hz = Number.isFinite(rawHz) ? rawHz : b.hz;
                const rawG = parseFloat(document.getElementById("eq-s" + i)?.value);
                const g = Number.isFinite(rawG) ? rawG : 0.0;
                const rawQ = parseFloat(document.getElementById("eq-q_m" + i)?.value);
                const q = Number.isFinite(rawQ) ? rawQ : b.defaultQ;

                const slopeCapable = (type === 'lowshelf' || type === 'highshelf' || type === 'lowpass' || type === 'highpass');
                const activeSlope = slopeCapable ? (b.slope || 12) : 12;
                const cascadeNodesCount = Math.max(1, Math.round(activeSlope / 12));
                const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(type);
                const nodeGain = (type === 'lowshelf' || type === 'highshelf')
                    ? (hasNoGain ? 0.0 : g) / cascadeNodesCount
                    : (hasNoGain ? 0.0 : g);

                for (let k = 0; k < cascadeNodesCount; k++) {
                    for (let j = 0; j < points; j++) {
                        composite[j] += 20 * Math.log10(Math.max(1e-10,
                            EQ_Module.getBiquadMagnitude(type, freqs[j], hz, q, nodeGain)));
                    }
                }
            });

            const curveData = [];
            for (let i = 0; i < points; i++) {
                curveData.push([freqs[i], composite[i]]);
            }

            const uid = 'target-eq-' + Date.now();
            const name = "Custom EQ Target";

            this.STATE.activeCurves = this.STATE.activeCurves.filter(c => c.role !== 'target');
            this.STATE.activeCurves.push({
                uid, name, role: 'target', color: '#bf5af2', visible: true, data: curveData
            });

            this.updateAll();
            showToast("Cloned active filters to Target plot curve.", "❄️");
        }
    };
Object.assign(PEQDB_Module, PEQDB_SimilarMethods);
Object.assign(PEQDB_Module, PEQDB_AlignmentMethods);
Object.assign(PEQDB_Module, PEQDB_SmartRFMethods);

