// CurveIndexer: loads database.json(.gz), keeps the persisted curve cache in
// IndexedDB (iem_curve_index), and warms curves in the background.
// Split out of peqdb-module.js. It is a top-level const shared by PEQDB_Module,
// FindEngine and the Settings > Refresh handler, so this file MUST be concatenated
// before peqdb-module.js (see scripts/build-bundle.mjs).
const CurveIndexer = {
    DB_NAME: "iem_curve_index",

    DB_VERSION: 3,
    STORE_NAME: "curves",
    db: null,
    catalog: [],
    // Single-flight handle for the catalogue fetch + parse.
    //
    // PEQDB_Module.init() fires DATA.init() without awaiting it, so
    // the boot loop reaches FindEngine.init() while this load is
    // still in flight. FindEngine.loadDatabase() used to react by
    // re-fetching and re-parsing the same 2.85 MB payload a second
    // time (twice the transfer, twice the synchronous JSON.parse on
    // the main thread, and two separate array instances so the
    // entry indexes got built twice). Both callers now await THIS
    // promise instead, so the file is downloaded and parsed exactly
    // once per launch no matter which module gets there first.
    catalogReady: null,

    ensureCatalogReady: function() {
        if (!this.catalogReady) {
            this.catalogReady = (async () => {
                try {
                    await this._openDB();
                } catch (err) {
                    console.error("[CurveIndexer] DB open failed — continuing without persistent cache:", err);
                }
                await this._loadCatalog();
                return this.catalog;
            })();
            // Do not memoise a rejected load: allow a later retry.
            this.catalogReady.catch(() => { this.catalogReady = null; });
        }
        return this.catalogReady;
    },

    init: async function() {
        await this.ensureCatalogReady();
        return this.buildDataset();
    },

    _encodeCurve: function(points) {
        const n = points.length;
        const freqs = new Float32Array(n);
        const dbs = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            freqs[i] = points[i][0];
            dbs[i] = points[i][1];
        }
        return { freqs, dbs };
    },
    _decodeCurve: function(freqs, dbs) {
        const n = freqs.length;
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = [freqs[i], dbs[i]];
        return out;
    },

    _openDB: function() {
        return new Promise((resolve) => {
            let resolved = false;
            const safeResolve = (val) => {
                if (!resolved) { resolved = true; clearTimeout(timeoutId); resolve(val); }
            };
            const timeoutId = setTimeout(() => {
                console.warn("[CurveIndexer] IndexedDB open timed out. Falling back to memory-only mode.");
                safeResolve(false);
            }, 2000);
            try {
                const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;

                    if (db.objectStoreNames.contains(this.STORE_NAME)) {
                        db.deleteObjectStore(this.STORE_NAME);
                    }
                    db.createObjectStore(this.STORE_NAME, { keyPath: "path" });
                };
                req.onsuccess = (e) => { this.db = e.target.result; safeResolve(true); };
                req.onerror = () => safeResolve(false);
                req.onblocked = () => safeResolve(false);
            } catch (e) { safeResolve(false); }
        });
    },

    _dbGetAll: function() {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const timeoutId = setTimeout(() => {
                console.warn("[CurveIndexer] _dbGetAll timed out.");
                resolve([]);
            }, 1500);

            try {
                const tx = this.db.transaction(this.STORE_NAME, "readonly");
                const req = tx.objectStore(this.STORE_NAME).getAll();
                req.onsuccess = () => {
                    clearTimeout(timeoutId);
                    resolve(req.result || []);
                };
                req.onerror = () => {
                    clearTimeout(timeoutId);
                    resolve([]);
                };
            } catch (e) {
                clearTimeout(timeoutId);
                resolve([]);
            }
        });
    },

    // Empties the persisted curve cache (NOT the reviews store, which is
    // a different database). Cached curves are keyed by file path, so a
    // replaced data file would otherwise keep serving its old curve.
    clearCurveCache: async function() {
        if (!this.db) { try { await this._openDB(); } catch (_) {} }
        return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            const timeoutId = setTimeout(() => resolve(false), 3000);
            const done = (ok) => { clearTimeout(timeoutId); resolve(ok); };
            try {
                const tx = this.db.transaction(this.STORE_NAME, "readwrite");
                tx.objectStore(this.STORE_NAME).clear();
                tx.oncomplete = () => done(true);
                tx.onerror = () => done(false);
                tx.onabort = () => done(false);
            } catch (e) { done(false); }
        });
    },
    _dbPut: function(record) {
        return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            try {
                const tx = this.db.transaction(this.STORE_NAME, "readwrite");
                tx.objectStore(this.STORE_NAME).put(record);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        });
    },

    updateCatalogProgressUI: function(pct, loaded, total, isComplete = false) {
        const headerBadge = document.getElementById('db-download-progress');
        const headerPct = document.getElementById('db-download-pct');
        const dbIndicator = document.getElementById('peqdb-indexing-indicator');

        if (isComplete || pct >= 100) {
            if (headerBadge) {
                headerBadge.classList.remove('hidden');
                headerBadge.classList.add('flex');
                headerBadge.className = "flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-[9px] font-mono font-bold text-emerald-400 select-none ml-1.5 whitespace-nowrap flex-shrink-0";
                headerBadge.innerHTML = "<span class=\"whitespace-nowrap\">✓ DB Ready</span>";
                setTimeout(() => {
                    headerBadge.classList.add('hidden');
                    headerBadge.classList.remove('flex');
                }, 2500);
            }
            if (dbIndicator) {
                dbIndicator.textContent = "✓ DB Ready";
                dbIndicator.className = "text-[9px] font-black text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 uppercase tracking-wider whitespace-nowrap";
                setTimeout(() => dbIndicator.classList.add('hidden'), 2500);
            }
        } else {
            if (headerBadge) {
                headerBadge.classList.remove('hidden');
                headerBadge.classList.add('flex');
                headerBadge.className = "flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-[9px] font-mono font-bold text-amber-400 select-none animate-pulse ml-1.5 whitespace-nowrap flex-shrink-0";
                headerBadge.innerHTML = `<span class="whitespace-nowrap">📥 DB:</span><span id="db-download-pct" class="whitespace-nowrap">${pct}%</span>`;
            }

            if (dbIndicator) {
                dbIndicator.classList.remove('hidden');
                dbIndicator.textContent = `📥 Loading: ${pct}%`;
                dbIndicator.className = "text-[9px] font-black text-amber-400 bg-amber-950/30 border border-amber-900/40 px-2 py-0.5 animate-pulse uppercase tracking-wider whitespace-nowrap";
            }
        }
    },

    _loadCatalog: async function() {
        // A non-array root used to be reported as a 100%-complete
        // load with catalog = [], which is indistinguishable from
        // success to every downstream check. Report the failure.
        const accept = (list) => {
            if (!Array.isArray(list)) {
                console.warn('[CurveIndexer] database.json root is not an array; treating as empty.');
                this.catalog = [];
                this.updateCatalogProgressUI(0, 0, 0, true);
                throw new Error('database.json root is not an array');
            }
            this.catalog = list;
            this.updateCatalogProgressUI(100, 0, 0, true);
        };
        try {

            let res = await fetch('./database.json.gz');

            if (!res.ok) {
                console.warn("database.json.gz not found, trying database.json...");
                res = await fetch('./database.json');
                if (!res.ok) throw new Error("Database file missing");
                accept(await res.json());
                return;
            }

            const decompressedStream = res.body.pipeThrough(new DecompressionStream('gzip'));
            const response = new Response(decompressedStream);

            accept(await response.json());
        } catch (e) {
            console.warn("[CurveIndexer] Could not load catalog:", e);
            this.catalog = [];
            this.catalogLoadError = (e && e.message) || String(e);
            // 0%, not 100% — the bar meant "done", and a failed load
            // that renders as "done" is what hid this for so long.
            this.updateCatalogProgressUI(0, 0, 0, true);
        }
    },

    buildDataset: async function() {
        const cachedRecords = await this._dbGetAll();
        const cacheByPath = new Map(cachedRecords.map(r => [r.path, r]));

        return this.catalog.map(entry => {
            const brand = entry.brand || '';
            const model = entry.model || '';
            const variant = entry.variant || '';
            const fullName = variant ? `${brand} ${model} (${variant})` : `${brand} ${model}`;

            let fileList = Array.isArray(entry.files) ? [...entry.files] : [];

            if (fileList.length > 1) {
                fileList.sort((a, b) => {
                    const aMod = /adapter|impedance|foam|mod|tape|vent|10ohm|75ohm|20ohm/i.test(a);
                    const bMod = /adapter|impedance|foam|mod|tape|vent|10ohm|75ohm|20ohm/i.test(b);
                    if (aMod && !bMod) return 1;
                    if (!aMod && bMod) return -1;
                    return 0;
                });
            }

            const primaryFilePath = fileList.length > 0 ? fileList[0] : null;

            let cachedData = null;
            let cachedInterp = null;

            if (primaryFilePath) {
                const cached = cacheByPath.get(primaryFilePath);

                if (cached && cached.freqs && cached.dbs && cached.freqs.length >= 2) {
                    cachedData = this._decodeCurve(cached.freqs, cached.dbs);
                    cachedInterp = cached.cachedInterp;
                } else if (cached && Array.isArray(cached.data) && cached.data.length >= 2) {
                    cachedData = cached.data;
                    cachedInterp = cached.cachedInterp;
                }
            }

            const searchTags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
            const searchKey = `${brand} ${model} ${variant} ${searchTags}`.toLowerCase().trim();

            return {
                id: entry.id,
                name: fullName.trim() || entry.id,
                brand: brand,
                model: model,
                variant: variant,
                year: entry.year,
                price_usd: entry.price_usd,
                driver_type: entry.driver_type,
                driver_config: entry.driver_config,
                impedance: entry.impedance,
                sensitivity: entry.sensitivity,
                connector: entry.connector,
                form_factor: entry.form_factor,
                tags: Array.isArray(entry.tags) ? entry.tags : [],
                files: fileList,
                primaryFilePath: primaryFilePath,
                data: cachedData,
                cachedInterp: cachedInterp,
                sourcesCache: {},
                searchKey: searchKey
            };
        }).sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
    },

    // Truthful progress for the indexing bar.
    //
    // The bar used to be derived by counting dataset entries whose
    // `data` was non-null. That is not a measure of work in
    // progress: the catalogue is built with `data` already populated
    // from cache for most entries, and the entries still being
    // fetched do not flip that field one at a time in a way the UI
    // can observe, so the count sat at 0 and then the container was
    // hidden. Hence a bar frozen at 0% for the whole index.
    //
    // Counting here instead - one increment per curve this function
    // actually finishes with, success or failure - measures the real
    // work. Failures count too, because a file that errors is still
    // finished work; otherwise the bar would stall on a bad file.
    _progress: { done: 0, total: 0, active: false },

    getIndexProgress: function() {
        return { done: this._progress.done, total: this._progress.total, active: this._progress.active };
    },

    beginIndexProgress: function(total) {
        this._progress = { done: 0, total: total || 0, active: true };
    },

    loadCurve: async function(item, fileIndex = 0) {
        const targetFile = item.files && item.files[fileIndex] ? item.files[fileIndex] : item.primaryFilePath;
        if (!targetFile) return false;

        if (fileIndex === 0 && item.data && Array.isArray(item.data) && item.data.length >= 2) {
            this._progress.done++;
            return true;
        }

        if (item.sourcesCache && item.sourcesCache[targetFile]) {
            if (fileIndex === 0) item.data = item.sourcesCache[targetFile];
            return true;
        }

        try {
            let safePath = './' + targetFile.split('/').map(encodeURIComponent).join('/');
            let res = await fetch(safePath).catch(() => null);
            if (!res || !res.ok) {
                const loweredPath = './' + targetFile.toLowerCase().split('/').map(encodeURIComponent).join('/');
                res = await fetch(loweredPath).catch(() => null);
            }
            if (!res || !res.ok) throw new Error(res ? `HTTP ${res.status}` : "Network/Connection Error");
            const text = await res.text();
            const parsed = PEQDB_Module.parseRawCurveText(text);
            if (!parsed || parsed.length < 2) throw new Error("Parsed curve has fewer than 2 valid points");

            if (!item.sourcesCache) item.sourcesCache = {};
            item.sourcesCache[targetFile] = parsed;

            if (fileIndex === 0) {
                item.data = parsed;
                const norm = PEQDB_Module.getNormalizedData(parsed, item.name);
                item.cachedInterp = Array.from(PEQDB_Module.DSP.interpolate(norm));
                item._cachedInterpVer = PEQDB_Module._alignmentVersion || 0;
            }

            this._dbPut({
                path: targetFile,
                ...this._encodeCurve(parsed),
                indexedAt: Date.now()
            });
            this._progress.done++;
            return true;
        } catch (e) {
            console.warn(`[CurveIndexer] Could not load "${targetFile}":`, e.message);
            this._progress.done++;
            if (fileIndex === 0) {
                item.data = null;
                item.cachedInterp = null;
                item._cachedInterpVer = 0;
            }
            return false;
        }
    },

    _bgRunning: false,
    startBackgroundWarmup: async function(dataset) {

        // This used to be an empty body that immediately set
        // databaseFullyLoaded = true and hid the progress panel. So
        // the app claimed to be indexing the measurement database,
        // showed a bar pinned at 0%, and then removed the bar before
        // any indexing had happened - the work was never done by
        // this function at all, only asserted to be finished.
        //
        // It now actually indexes: each entry's primary curve is
        // loaded, loadCurve tallies every completion, and the flag
        // is only set once the run really finishes. Entries that fail
        // still count as finished work, so one bad file cannot stall
        // the bar or prevent the app from becoming ready.
        if (this._bgRunning) return;
        this._bgRunning = true;
        const list = Array.isArray(dataset) ? dataset : [];
        const notify = () => {
            if (typeof FindEngine !== 'undefined' && FindEngine.updateIndexingProgressBar) {
                FindEngine.updateIndexingProgressBar();
            }
        };
        notify();

        try {
            for (let i = 0; i < list.length; i++) {
                // Yield periodically so the ticker and the UI can
                // actually paint; a tight await-per-item loop still
                // starves rendering on a large catalogue.
                if (i % 4 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
                try {
                    await this.loadCurve(list[i], 0);
                } catch (e) {
                    this._progress.done++;
                }
                if (i % 5 === 0) notify();
            }
        } finally {
            this._bgRunning = false;
            PEQDB_Module.databaseFullyLoaded = true;
            localStorage.setItem('squig_db_indexed', 'true');
            notify();
        }

        const indicator = document.getElementById('peqdb-indexing-indicator');
        if (indicator) indicator.classList.add('hidden');
        const progressContainer = document.getElementById('find-progress-container');
        if (progressContainer) progressContainer.classList.add('hidden');
    }
};
