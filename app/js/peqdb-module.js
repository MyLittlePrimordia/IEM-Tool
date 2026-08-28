// Split out of the former monolithic app-core.js (2026 refactor).
// PEQDB_Module: the Database/Similar-search tab (list rendering, curve
// selection, similarity search UI).

            const CurveIndexer = {
                DB_NAME: "iem_curve_index",

                DB_VERSION: 3,
                STORE_NAME: "curves",
                db: null,
                catalog: [],

                init: async function() {
                    try {
                        await this._openDB();
                    } catch (err) {
                        console.error("[CurveIndexer] DB open failed — continuing without persistent cache:", err);
                    }
                    await this._loadCatalog();
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
                            headerBadge.className = "flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-[9px] font-mono font-bold text-emerald-400 select-none ml-1.5 whitespace-nowrap flex-shrink-0";
                            headerBadge.innerHTML = "<span class=\"whitespace-nowrap\">✓ DB Ready</span>";
                            setTimeout(() => {
                                headerBadge.classList.add('hidden');
                                headerBadge.classList.remove('flex');
                            }, 2500);
                        }
                        if (dbIndicator) {
                            dbIndicator.textContent = "✓ DB Ready";
                            dbIndicator.className = "text-[9px] font-black text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap";
                            setTimeout(() => dbIndicator.classList.add('hidden'), 2500);
                        }
                    } else {
                        if (headerBadge) {
                            headerBadge.classList.remove('hidden');
                            headerBadge.classList.add('flex');
                            headerBadge.className = "flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded text-[9px] font-mono font-bold text-amber-400 select-none animate-pulse ml-1.5 whitespace-nowrap flex-shrink-0";
                            headerBadge.innerHTML = `<span class="whitespace-nowrap">📥 DB:</span><span id="db-download-pct" class="whitespace-nowrap">${pct}%</span>`;
                        }

                        if (dbIndicator) {
                            dbIndicator.classList.remove('hidden');
                            dbIndicator.textContent = `📥 Loading: ${pct}%`;
                            dbIndicator.className = "text-[9px] font-black text-amber-400 bg-amber-950/30 border border-amber-900/40 px-2 py-0.5 rounded animate-pulse uppercase tracking-wider whitespace-nowrap";
                        }
                    }
                },

                _loadCatalog: async function() {
                    try {

                        let res = await fetch('./database.json.gz');

                        if (!res.ok) {
                            console.warn("database.json.gz not found, trying database.json...");
                            res = await fetch('./database.json');
                            if (!res.ok) throw new Error("Database file missing");
                            const list = await res.json();
                            this.catalog = Array.isArray(list) ? list : [];
                            this.updateCatalogProgressUI(100, 0, 0, true);
                            return;
                        }

                        const decompressedStream = res.body.pipeThrough(new DecompressionStream('gzip'));
                        const response = new Response(decompressedStream);

                        const list = await response.json();
                        this.catalog = Array.isArray(list) ? list : [];
                        this.updateCatalogProgressUI(100, 0, 0, true);
                    } catch (e) {
                        console.warn("[CurveIndexer] Could not load catalog:", e);
                        this.catalog = [];
                        this.updateCatalogProgressUI(100, 0, 0, true);
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

                loadCurve: async function(item, fileIndex = 0) {
                    const targetFile = item.files && item.files[fileIndex] ? item.files[fileIndex] : item.primaryFilePath;
                    if (!targetFile) return false;

                    if (fileIndex === 0 && item.data && Array.isArray(item.data) && item.data.length >= 2) {
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
                        }

                        this._dbPut({
                            path: targetFile,
                            ...this._encodeCurve(parsed),
                            indexedAt: Date.now()
                        });
                        return true;
                    } catch (e) {
                        console.warn(`[CurveIndexer] Could not load "${targetFile}":`, e.message);
                        if (fileIndex === 0) {
                            item.data = null;
                            item.cachedInterp = null;
                        }
                        return false;
                    }
                },

                _bgRunning: false,
                startBackgroundWarmup: function(dataset) {

                    PEQDB_Module.databaseFullyLoaded = true;
                    localStorage.setItem('squig_db_indexed', 'true');
                    const indicator = document.getElementById('peqdb-indexing-indicator');
                    if (indicator) indicator.classList.add('hidden');
                    const progressContainer = document.getElementById('find-progress-container');
                    if (progressContainer) progressContainer.classList.add('hidden');
                }
            };

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
                            btn.className = "px-2.5 py-1 rounded bg-pink-500 text-white hover:bg-pink-600 transition-all cursor-pointer";
                            btn.textContent = "🖌️ Draw Mode: ON";
                            showToast("Draw Mode active! Hold click and draw directly onto the graph to sketch your target.", "🖌️");
                        } else {
                            btn.className = "px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-stone-300 transition-all cursor-pointer";
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
                cycleTarget: function() {
                    this.cycleTargetDirection(1);
                },

                resonanceHz: 8000,
                alignHz: '500',
                alignDb: 75.0,
                parseRawCurveText: function(rawText) {

            const lines = rawText.split(/\r\n|\r|\n/);
            const data = [];
                    let commaIsDecimal = false;
                    for (let i = 0; i < Math.min(100, lines.length); i++) {
                        const line = lines[i].trim();
                        if (line.startsWith('#') || line === '') continue;
                        if ((line.includes('\t') || line.includes(';')) && line.includes(',')) {
                            commaIsDecimal = true;
                            break;
                        }
                    }
                    lines.forEach(line => {
                        let cleanLine = line.trim();
                        if (cleanLine.startsWith('#') || cleanLine.startsWith('*') || cleanLine.startsWith('//') || cleanLine === '') return;

                        // Grouped-digit repair ("1,000" -> "1000"), applied
                        // BEFORE the branch split regardless of commaIsDecimal:
                        // a tab/semicolon elsewhere on the SAME line can flip
                        // that heuristic to true, which would otherwise
                        // reinterpret a thousands-separated frequency as a
                        // decimal (e.g. tab-delimited "1,000\t6.5" -> 1 Hz
                        // instead of 1000 Hz). The strict 3-digit-grouping
                        // regex can never match a genuine decimal-comma token
                        // like "1,5", so this is safe either way.
                        const firstTok = cleanLine.split(/[\t;\s]+/)[0] || '';
                        if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(firstTok)) {
                            cleanLine = cleanLine.replace(/(\d),(\d{3})/g, '$1$2');
                        }

                        let parts = [];
                        if (commaIsDecimal) {
                            cleanLine = cleanLine.replace(/,/g, '.');
                            parts = cleanLine.split(/[\t;\s]+/);
                        } else {
                            parts = cleanLine.split(/[\s,;\t]+/);
                        }
                        parts = parts.filter(p => p.length > 0);
                        if (parts.length >= 2) {
                            const f = parseFloat(parts[0]);
                            const a = parseFloat(parts[1]);
                            // Number.isFinite (not isNaN) also rejects
                            // Infinity/-Infinity, which parseFloat happily
                            // returns for overflowing literals like "1e999"
                            // or the literal token "Infinity" -- isNaN alone
                            // let those through and into the curve dataset.
                            if (Number.isFinite(f) && Number.isFinite(a)) {
                                if (f >= 1 && f <= 24000) {
                                    data.push([f, a]);
                                }
                            }
                        }
                    });
                    data.sort((a,b) => a[0] - b[0]);

                    const deduped = [];
                    for (let i = 0; i < data.length; i++) {
                        const prev = deduped[deduped.length - 1];
                        if (prev && Math.abs(Math.log10(data[i][0]) - Math.log10(prev[0])) < 1e-4) {
                            prev[1] = (prev[1] + data[i][1]) / 2;
                        } else {
                            deduped.push(data[i]);
                        }
                    }
                    return deduped;
                },
        debouncedFindSimilar: null,
        listRenderLimit: 40,
        similarityWorker: null,

        startBackgroundLoading: function() {
            if (this.databaseFullyLoaded) return;
            const dataset = this.STATE.dataset;
            if (!dataset || dataset.length === 0) {
                this.databaseFullyLoaded = true;
                localStorage.setItem('squig_db_indexed', 'true');
                this.renderList(false, true);
                if (window.FindEngine && FindEngine.updateIndexingProgressBar) {
                    FindEngine.updateIndexingProgressBar();
                }
                return;
            }
            CurveIndexer.startBackgroundWarmup(dataset);
        },
        srfPendingItems: [],
        showSmartRFModal: function() {
            const modal = document.getElementById('smart-rf-modal');
            if (modal) {
                modal.classList.remove('hidden');
                this.clearSmartRF();
                Mascot.update();

                const textarea = document.getElementById('smart-rf-textarea');
                if (textarea && !textarea.srfDragDropInitialized) {
                    textarea.srfDragDropInitialized = true;
                    textarea.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        textarea.style.borderColor = 'var(--accent-blue)';
                        textarea.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                    });
                    textarea.addEventListener('dragleave', (e) => {
                        e.preventDefault();
                        textarea.style.borderColor = '';
                        textarea.style.backgroundColor = '';
                    });
                    textarea.addEventListener('drop', (e) => {
                        e.preventDefault();
                        textarea.style.borderColor = '';
                        textarea.style.backgroundColor = '';
                        const files = e.dataTransfer.files;
                        if (files && files.length > 0) {
                            this.handleSmartRFFilesList(files);
                        }
                    });
                }
                if (textarea) setTimeout(() => textarea.focus(), 50);
            }
        },
        closeSmartRFModal: function() {
            const modal = document.getElementById('smart-rf-modal');
            if (modal) modal.classList.add('hidden');
            Mascot.update();
        },
        clearSmartRF: function() {
            const textarea = document.getElementById('smart-rf-textarea');
            if (textarea) textarea.value = '';
            this.srfPendingItems = [];
            this.updateSmartRFUI();
        },
        pasteSmartRF: function() {
            navigator.clipboard.readText().then(text => {
                const textarea = document.getElementById('smart-rf-textarea');
                if (textarea) {
                    textarea.value = text;
                    this.handleSmartRFInput();
                    showToast("FR coordinate data pasted!", "📋");
                }
            }).catch(() => {
                showToast("Clipboard blocked. Paste manually.", "⚠️");
            });
        },
        handleSmartRFFile: function(e) {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            this.handleSmartRFFilesList(files);
            e.target.value = '';
        },
        handleSmartRFFilesList: function(files) {
            this.srfPendingItems = [];
            let loadedCount = 0;
            const totalFiles = files.length;

            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const res = this.parseRawFRText(ev.target.result, file.name);
                    if (res) {
                        this.srfPendingItems.push(res);
                    }
                    loadedCount++;
                    if (loadedCount === totalFiles) {
                        this.updateSmartRFUI();
                        if (this.srfPendingItems.length > 0) {
                            showToast(`Loaded ${this.srfPendingItems.length} files successfully!`, "📥");
                        } else {
                            showToast("No valid FR coordinates found in loaded files.", "⚠️");
                        }
                    }
                };
                reader.readAsText(file);
            }
        },
        handleSmartRFInput: function() {
            const textarea = document.getElementById('smart-rf-textarea');
            if (!textarea) return;
            const text = textarea.value;
            this.srfPendingItems = [];
            const res = this.parseRawFRText(text, "Pasted Curve");
            if (res) {
                this.srfPendingItems.push(res);
            }
            this.updateSmartRFUI();
        },
        updateSmartRFUI: function() {
            const statusEl = document.getElementById('srf-status');
            const detectedEl = document.getElementById('srf-detected');
            const pointsEl = document.getElementById('srf-stat-points');
            const importBtn = document.getElementById('srf-import-btn');

            if (this.srfPendingItems.length > 0) {
                if (detectedEl) {
                    if (this.srfPendingItems.length === 1) {
                        detectedEl.textContent = this.srfPendingItems[0].name;
                    } else {
                        detectedEl.textContent = `${this.srfPendingItems.length} Curves`;
                    }
                }
                if (statusEl) {
                    statusEl.textContent = "✓ Valid FR Coordinates Detected";
                    statusEl.className = "text-emerald-400";
                }
                if (pointsEl) {
                    let totalPoints = 0;
                    this.srfPendingItems.forEach(item => totalPoints += item.data.length);
                    pointsEl.textContent = totalPoints;
                }
                if (importBtn) {
                    importBtn.disabled = false;
                    importBtn.className = "py-2 text-[10px] font-bold rounded bg-[var(--accent-blue)] text-white hover:brightness-110 transition-all text-center cursor-pointer";
                }
            } else {
                if (detectedEl) detectedEl.textContent = "None";
                if (statusEl) {
                    statusEl.textContent = "⚠ No valid coordinates found";
                    statusEl.className = "text-red-400";
                }
                if (pointsEl) pointsEl.textContent = "0";
                if (importBtn) {
                    importBtn.disabled = true;
                    importBtn.className = "py-2 text-[10px] font-bold rounded bg-zinc-800 text-zinc-500 cursor-not-allowed transition-all text-center";
                }
            }
        },
        confirmSmartRF: function() {
            if (this.srfPendingItems.length === 0) return;
            const autoAverageChk = document.getElementById('smart-rf-auto-average');
            const autoAverage = autoAverageChk ? autoAverageChk.checked : true;

            this.processSmartRFImport(this.srfPendingItems, autoAverage);
            this.closeSmartRFModal();
        },
        parseRawFRText: function(text, filename = 'Imported Curve') {
            if (!text || typeof text !== 'string') return null;

            text = text.replace(/^\uFEFF/, '').trim();

            const lines = text.split(/\r\n|\r|\n/);
            const data = [];

            const coordRegex = /^\s*([+-]?\d+(?:\.\d+)?)\s*[\t;,\s]+\s*([+-]?\d+(?:\.\d+)?)/;

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line || line.startsWith('#') || line.startsWith('*') || line.startsWith('//')) continue;
                if (line.toLowerCase().startsWith('freq') || line.toLowerCase().startsWith('hz')) continue;

                if (line.includes(',') && (line.includes('\t') || line.includes(' '))) {
                    line = line.replace(/,/g, '.');
                }

                const match = line.match(coordRegex);
                if (match) {
                    const f = parseFloat(match[1]);
                    const a = parseFloat(match[2]);
                    if (!isNaN(f) && !isNaN(a)) {
                        if (f >= 1 && f <= 24000) {
                            data.push([f, a]);
                        }
                    }
                }
            }

            if (data.length > 0) {
                data.sort((a, b) => a[0] - b[0]);
                return {
                    name: filename.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
                    data: data
                };
            }
            return null;
        },
        processSmartRFImport: function(parsedItems, autoAverage) {
            if (parsedItems.length === 0) return;

            const groups = {};
            const cleanPattern = /\s*[\[\(_-]\s*(?:left|right|l|r|1|2)\s*[\]\)]?$/i;

            parsedItems.forEach(item => {
                const baseName = item.name.replace(cleanPattern, '').trim();
                if (!groups[baseName]) {
                    groups[baseName] = [];
                }
                groups[baseName].push(item);
            });

            const curvesToLoad = [];

            Object.entries(groups).forEach(([baseName, items]) => {
                if (autoAverage && items.length > 1) {
                    const points = 500;
                    const freqs = new Float32Array(this.DSP.FREQS);
                    const summedVals = new Float32Array(points).fill(0);

                    items.forEach(item => {
                        const norm = this.getNormalizedData(item.data, item.name);
                        const interp = this.DSP.interpolate(norm);
                        for (let i = 0; i < points; i++) {
                            summedVals[i] += interp[i];
                        }
                    });

                    const averagedData = [];
                    for (let i = 0; i < points; i++) {
                        averagedData.push([freqs[i], summedVals[i] / items.length]);
                    }

                    curvesToLoad.push({
                        name: `${baseName} (Avg L/R)`,
                        data: averagedData
                    });
                } else {
                    items.forEach(item => {
                        curvesToLoad.push(item);
                    });
                }
            });

            curvesToLoad.forEach(c => {
                const id = 'imported_rf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                const newItem = {
                    id,
                    name: c.name,
                    variant: 'Imported RF',
                    source: 'Smart RF Import',
                    searchKey: c.name.toLowerCase(),
                    data: c.data
                };
                this.STATE.dataset.unshift(newItem);
                this.STATE.renderList.unshift(newItem);
                this.toggleCurveSelection(id);
            });

            this.renderList();
            showToast(`Imported ${curvesToLoad.length} frequency response curves!`, "📥");
        },
        initSimilarityWorker: function() {
                if (typeof Worker === 'undefined') return;
                const workerCode = `
                    self.onmessage = function(e) {
                        const { dataset, targetInterp, freqs, threshold } = e.data;
                        const matches = [];
                        for (let idx = 0; idx < dataset.length; idx++) {
                            const item = dataset[idx];
                            if (!item.cachedInterp) continue;
                            let totalDiff = 0;
                            let count = 0;
                            for (let i = 0; i < freqs.length; i += 8) {
                                const f = freqs[i];
                                if (f > 10000) break;
                                totalDiff += Math.abs(targetInterp[i] - item.cachedInterp[i]);
                                count++;
                            }
                            const mae = totalDiff / count;
                            const similarity = Math.max(0, 100 * (1 - (mae / threshold)));
                            matches.push({
                                id: item.id, name: item.name, variant: item.variant, source: item.source, similarity: similarity
                            });
                        }
                        matches.sort((a, b) => b.similarity - a.similarity);
                        self.postMessage({ matches });
                    };
                `;
                try {
                    const blob = new Blob([workerCode], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    this.similarityWorker = new Worker(blobUrl);
                    URL.revokeObjectURL(blobUrl);
                    this.similarityWorker.onmessage = (e) => {
                        this.handleSimilarityResults(e.data.matches);
                    };
                } catch (err) {
                    console.warn("Similarity Web Worker creation restricted on local files. Running inline.");
                    this.similarityWorker = null;
                }
            },

        getRefDb: function(data) {
            if (!data || data.length === 0) return 0;
            const mode = this.alignHz;

            if (mode === 'mean') {
                let sum = 0, count = 0;
                for (let i = 0; i < data.length; i++) {
                    const hz = data[i][0];
                    if (hz >= 500 && hz <= 2000) {
                        sum += data[i][1];
                        count++;
                    }
                }
                if (count > 0) return sum / count;
                return data[0][1];
            } else {
                const hzTarget = parseFloat(mode) || 500;
                let ref_db = 0;
                let min_diff = Infinity;
                for (let i = 0; i < data.length; i++) {
                    let diff = Math.abs(data[i][0] - hzTarget);
                    if (diff < min_diff) {
                        min_diff = diff;
                        ref_db = data[i][1];
                    }
                }
                return ref_db;
            }
        },

        setAlignHz: function(hz) {
                    if (typeof hz !== 'string' && typeof hz !== 'number') return;
                    const hzStr = String(hz);
                    this.alignHz = hzStr;

                    const graphBtn = document.getElementById('graph-align-hz-btn');
                    if (graphBtn) {
                        const labelMap = { '500': '500Hz', '1000': '1kHz', '2000': '2kHz', 'mean': 'AVG' };
                        graphBtn.innerHTML = `<span class="align-label-prefix">Align: </span>${labelMap[hzStr] || hzStr}`;
                    }

                    this.updateAlignmentCfgActual();
                },
                setAlignDb: function(db) {
            const numDb = parseFloat(db);
            if (isNaN(numDb)) return;
            this.alignDb = numDb;

            const graphBtn = document.getElementById('graph-align-db-btn');
            if (graphBtn) {
                graphBtn.innerHTML = `<span class="align-label-prefix">Amp: </span>${numDb === 0 ? '0' : numDb}dB`;
            }

            const options = [75, 80, 85, 0];
            options.forEach(opt => {
                try {
                    const btn = document.getElementById('align-db-' + opt);
                    if (btn) btn.classList.remove('active');
                } catch(e) {}
            });
            try {
                const activeBtn = document.getElementById('align-db-' + numDb);
                if (activeBtn) activeBtn.classList.add('active');
            } catch(e) {}

            this.updateAlignmentCfg();
        },
                        cycleAlignHz: function() {
                    const options = ['500', '1000', '2000', 'mean'];
                    const curIdx = options.indexOf(this.alignHz);
                    const nextIdx = (curIdx + 1) % options.length;
                    this.setAlignHz(options[nextIdx]);
                },
                cycleAlignDb: function() {
                    const options = [0, 75, 80, 85];
                    const curIdx = options.indexOf(parseFloat(this.alignDb));
                    const nextIdx = (curIdx + 1) % options.length;
                    this.setAlignDb(options[nextIdx]);
                },
        updateAlignmentCfg: function() {
            clearTimeout(this.alignUpdateTimeout);
            this.alignUpdateTimeout = setTimeout(() => {
                this.updateAlignmentCfgActual();
            }, 120);
        },
        updateAlignmentCfgActual: function() {
            if (this.alignDb === 0) {
                this.squigYMin = -30;
                this.squigYMax = 30;
            } else {
                this.squigYMin = this.alignDb - 30;
                this.squigYMax = this.alignDb + 30;
            }

            if (this.STATE.activeCurves && this.STATE.activeCurves.length > 0) {
                this.STATE.activeCurves.forEach(c => {
                    c.cachedNormalized = null;
                    c.cachedSpline = null;
                    c.cachedInterp = null;
                });
            }

            if (this.STATE.dataset) {
                this.STATE.dataset.forEach(item => {
                    item.cachedInterp = null;
                });
            }

            try {
                localStorage.setItem('settings_align_hz', this.alignHz);
                localStorage.setItem('settings_align_db', this.alignDb);
            } catch(e) {}

            EQ_Module.drawCurve();

            if (this.searchMode === 'similar') {
                setTimeout(() => {
                    if (this.STATE.dataset) {
                        this.precalculateInterps();
                    }
                    this.findSimilarCurves();
                }, 40);
            }
        },
        getShiftedFrequency: function(f, role) {
            if (role === 'target' && EQ_Module.resonanceCalEnabled && this.resonanceHz && this.resonanceHz !== 8000) {

                const delta = Math.log10(this.resonanceHz) - Math.log10(8000);
                const sigma = 0.12;
                const env = Math.exp(-Math.pow(Math.log10(f) - Math.log10(8000), 2) / (2 * sigma * sigma));
                return Math.pow(10, Math.log10(f) - delta * env);
            }
            return f;
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
        TARGETS: {
            harman: { id: 'harman', name: 'Harman IE 2019', data: [[20.00, 82.617], [20.36, 82.629], [20.73, 82.641], [21.11, 82.653], [21.50, 82.665], [21.89, 82.676], [22.29, 82.686], [22.69, 82.695], [23.10, 82.703], [23.52, 82.709], [23.95, 82.714], [24.39, 82.718], [24.83, 82.721], [25.28, 82.722], [25.74, 82.724], [26.21, 82.724], [26.69, 82.724], [27.18, 82.724], [27.67, 82.723], [28.17, 82.722], [28.69, 82.720], [29.21, 82.718], [29.74, 82.716], [30.28, 82.713], [30.83, 82.708], [31.39, 82.703], [31.97, 82.696], [32.55, 82.687], [33.14, 82.676], [33.74, 82.664], [34.36, 82.648], [34.98, 82.631], [35.62, 82.610], [36.27, 82.587], [36.93, 82.562], [37.60, 82.534], [38.28, 82.503], [38.98, 82.470], [39.69, 82.434], [40.41, 82.395], [41.15, 82.353], [41.90, 82.307], [42.66, 82.258], [43.44, 82.205], [44.23, 82.148], [45.03, 82.087], [45.85, 82.023], [46.68, 81.954], [47.53, 81.883], [48.40, 81.808], [49.28, 81.732], [50.18, 81.653], [51.09, 81.574], [52.02, 81.493], [52.97, 81.411], [53.93, 81.329], [54.91, 81.247], [55.91, 81.163], [56.93, 81.079], [57.97, 80.993], [59.02, 80.904], [60.09, 80.812], [61.19, 80.717], [62.30, 80.620], [63.44, 80.520], [64.59, 80.419], [65.77, 80.317], [66.96, 80.214], [68.18, 80.110], [69.42, 80.005], [70.69, 79.900], [71.97, 79.794], [73.28, 79.689], [74.62, 79.584], [75.97, 79.480], [77.36, 79.377], [78.76, 79.276], [80.20, 79.174], [81.66, 79.072], [83.14, 78.969], [84.66, 78.865], [86.20, 78.759], [87.77, 78.651], [89.36, 78.540], [90.99, 78.428], [92.65, 78.314], [94.33, 78.199], [96.05, 78.084], [97.80, 77.969], [99.58, 77.855], [101.39, 77.742], [103.23, 77.630], [105.11, 77.518], [107.03, 77.406], [108.97, 77.294], [110.96, 77.181], [112.98, 77.068], [115.03, 76.954], [117.13, 76.840], [119.26, 76.726], [121.43, 76.613], [123.64, 76.501], [125.89, 76.390], [128.18, 76.280], [130.51, 76.171], [132.89, 76.065], [135.31, 75.961], [137.77, 75.861], [140.28, 75.764], [142.83, 75.670], [145.43, 75.578], [148.07, 75.489], [150.77, 75.401], [153.51, 75.313], [156.31, 75.224], [159.15, 75.136], [162.05, 75.046], [165.00, 74.957], [168.00, 74.867], [171.06, 74.776], [174.17, 74.686], [177.34, 74.596], [180.57, 74.507], [183.86, 74.419], [187.20, 74.332], [190.61, 74.248], [194.08, 74.167], [197.61, 74.090], [201.21, 74.016], [204.87, 73.947], [208.60, 73.881], [212.39, 73.819], [216.26, 73.761], [220.19, 73.706], [224.20, 73.654], [228.28, 73.605], [232.44, 73.561], [236.67, 73.520], [240.97, 73.483], [245.36, 73.450], [249.82, 73.420], [254.37, 73.395], [259.00, 73.372], [263.71, 73.352], [268.51, 73.336], [273.40, 73.322], [278.38, 73.310], [283.44, 73.301], [288.60, 73.294], [293.85, 73.290], [299.20, 73.287], [304.65, 73.285], [310.19, 73.286], [315.84, 73.288], [321.59, 73.291], [327.44, 73.295], [333.40, 73.301], [339.47, 73.307], [345.64, 73.315], [351.93, 73.323], [358.34, 73.333], [364.86, 73.343], [371.50, 73.353], [378.26, 73.364], [385.15, 73.375], [392.16, 73.386], [399.29, 73.398], [406.56, 73.410], [413.96, 73.422], [421.49, 73.436], [429.16, 73.449], [436.97, 73.464], [444.93, 73.480], [453.02, 73.496], [461.27, 73.513], [469.66, 73.531], [478.21, 73.550], [486.91, 73.569], [495.78, 73.589], [504.80, 73.609], [513.99, 73.629], [523.34, 73.650], [532.87, 73.671], [542.56, 73.693], [552.44, 73.714], [562.49, 73.736], [572.73, 73.759], [583.15, 73.782], [593.77, 73.807], [604.57, 73.834], [615.57, 73.862], [626.78, 73.891], [638.18, 73.921], [649.80, 73.951], [661.63, 73.983], [673.67, 74.015], [685.93, 74.048], [698.41, 74.083], [711.12, 74.118], [724.06, 74.155], [737.24, 74.192], [750.66, 74.229], [764.32, 74.267], [778.23, 74.304], [792.39, 74.342], [806.82, 74.381], [821.50, 74.421], [836.45, 74.463], [851.67, 74.506], [867.17, 74.551], [882.96, 74.599], [899.02, 74.649], [915.39, 74.702], [932.05, 74.758], [949.01, 74.816], [966.28, 74.878], [983.87, 74.941], [1001.77, 75.006], [1020.00, 75.074], [1038.57, 75.145], [1057.47, 75.219], [1076.71, 75.297], [1096.31, 75.381], [1116.26, 75.470], [1136.58, 75.565], [1157.26, 75.665], [1178.32, 75.770], [1199.77, 75.880], [1221.60, 75.995], [1243.84, 76.116], [1266.47, 76.242], [1289.52, 76.374], [1312.99, 76.510], [1336.89, 76.648], [1361.22, 76.789], [1385.99, 76.929], [1411.22, 77.070], [1436.90, 77.211], [1463.05, 77.354], [1489.68, 77.500], [1516.79, 77.651], [1544.40, 77.807], [1572.50, 77.971], [1601.12, 78.141], [1630.26, 78.319], [1659.93, 78.504], [1690.14, 78.697], [1720.90, 78.897], [1752.22, 79.104], [1784.11, 79.319], [1816.58, 79.540], [1849.64, 79.768], [1883.30, 80.001], [1917.58, 80.237], [1952.48, 80.473], [1988.01, 80.706], [2024.19, 80.936], [2061.03, 81.161], [2098.54, 81.382], [2136.73, 81.601], [2175.62, 81.818], [2215.22, 82.033], [2255.53, 82.244], [2296.58, 82.451], [2338.38, 82.650], [2380.94, 82.840], [2424.27, 83.018], [2468.39, 83.186], [2513.31, 83.343], [2559.05, 83.490], [2605.63, 83.627], [2653.05, 83.753], [2701.33, 83.869], [2750.50, 83.973], [2800.55, 84.064], [2851.52, 84.144], [2903.42, 84.211], [2956.26, 84.269], [3010.06, 84.317], [3064.85, 84.357], [3120.62, 84.386], [3177.42, 84.405], [3235.25, 84.413], [3294.13, 84.411], [3354.08, 84.399], [3415.12, 84.377], [3477.27, 84.345], [3540.56, 84.305], [3605.00, 84.257], [3670.60, 84.202], [3737.41, 84.143], [3805.43, 84.079], [3874.68, 84.011], [3945.20, 83.941], [4017.00, 83.866], [4090.11, 83.788], [4164.55, 83.706], [4240.34, 83.620], [4317.51, 83.531], [4396.09, 83.439], [4476.10, 83.344], [4557.56, 83.246], [4640.50, 83.147], [4724.96, 83.046], [4810.95, 82.945], [4898.51, 82.845], [4987.66, 82.746], [5078.43, 82.648], [5170.86, 82.552], [5264.97, 82.458], [5360.79, 82.363], [5458.35, 82.269], [5557.69, 82.176], [5658.84, 82.082], [5761.82, 81.986], [5866.69, 81.884], [5973.46, 81.775], [6082.17, 81.654], [6192.87, 81.523], [6305.57, 81.383], [6420.33, 81.236], [6537.18, 81.081], [6656.15, 80.917], [6777.29, 80.741], [6900.63, 80.551], [7026.22, 80.347], [7154.10, 80.129], [7284.30, 79.898], [7416.87, 79.658], [7551.85, 79.411], [7689.29, 79.157], [7829.23, 78.898], [7971.72, 78.630], [8116.80, 78.351], [8264.53, 78.059], [8414.94, 77.755], [8568.09, 77.436], [8724.02, 77.104], [8882.79, 76.758], [9044.46, 76.400], [9209.06, 76.031], [9376.66, 75.652], [9547.31, 75.266], [9721.07, 74.877], [9897.99, 74.489], [10078.13, 74.106], [10261.55, 73.727], [10448.30, 73.351], [10638.45, 72.976], [10832.07, 72.598], [11029.21, 72.218], [11229.94, 71.835], [11434.32, 71.452], [11642.41, 71.071], [11854.30, 70.697], [12070.04, 70.330], [12289.71, 69.970], [12513.38, 69.615], [12741.12, 69.264], [12973.00, 68.918], [13209.10, 68.576], [13449.50, 68.241], [13694.28, 67.913], [13943.51, 67.592], [14197.27, 67.274], [14455.66, 66.955], [14718.74, 66.628], [14986.62, 66.285], [15259.37, 65.919], [15537.08, 65.522], [15819.85, 65.090], [16107.76, 64.614], [16400.92, 64.090], [16699.41, 63.512], [17003.33, 62.873], [17312.78, 62.169], [17627.86, 61.398], [17948.68, 60.560], [18275.34, 59.661], [18607.94, 58.716], [18946.60, 57.746], [19291.42, 56.777], [19642.52, 55.829], [20000.00, 54.901]] },
            diffuse_field: { id: 'diffuse_field', name: 'Diffuse Field', data: [[20.00, 71.057], [20.36, 71.057], [20.73, 71.057], [21.11, 71.057], [21.50, 71.057], [21.89, 71.057], [22.29, 71.057], [22.69, 71.057], [23.10, 71.057], [23.52, 71.057], [23.95, 71.057], [24.39, 71.057], [24.83, 71.057], [25.28, 71.057], [25.74, 71.057], [26.21, 71.057], [26.69, 71.057], [27.18, 71.057], [27.67, 71.057], [28.17, 71.057], [28.69, 71.057], [29.21, 71.057], [29.74, 71.057], [30.28, 71.057], [30.83, 71.057], [31.39, 71.057], [31.97, 71.057], [32.55, 71.057], [33.14, 71.057], [33.74, 71.057], [34.36, 71.057], [34.98, 71.057], [35.62, 71.057], [36.27, 71.057], [36.93, 71.057], [37.60, 71.057], [38.28, 71.057], [38.98, 71.057], [39.69, 71.057], [40.41, 71.057], [41.15, 71.057], [41.90, 71.057], [42.66, 71.057], [43.44, 71.057], [44.23, 71.057], [45.03, 71.057], [45.85, 71.057], [46.68, 71.057], [47.53, 71.057], [48.40, 71.057], [49.28, 71.057], [50.18, 71.057], [51.09, 71.057], [52.02, 71.057], [52.97, 71.057], [53.93, 71.057], [54.91, 71.057], [55.91, 71.057], [56.93, 71.057], [57.97, 71.057], [59.02, 71.057], [60.09, 71.057], [61.19, 71.057], [62.30, 71.057], [63.44, 71.057], [64.59, 71.057], [65.77, 71.057], [66.96, 71.057], [68.18, 71.057], [69.42, 71.057], [70.69, 71.057], [71.97, 71.057], [73.28, 71.057], [74.62, 71.057], [75.97, 71.057], [77.36, 71.057], [78.76, 71.057], [80.20, 71.057], [81.66, 71.057], [83.14, 71.057], [84.66, 71.056], [86.20, 71.056], [87.77, 71.056], [89.36, 71.055], [90.99, 71.055], [92.65, 71.054], [94.33, 71.054], [96.05, 71.054], [97.80, 71.055], [99.58, 71.057], [101.39, 71.060], [103.23, 71.065], [105.11, 71.071], [107.03, 71.080], [108.97, 71.090], [110.96, 71.101], [112.98, 71.112], [115.03, 71.123], [117.13, 71.133], [119.26, 71.141], [121.43, 71.148], [123.64, 71.154], [125.89, 71.160], [128.18, 71.166], [130.51, 71.173], [132.89, 71.181], [135.31, 71.191], [137.77, 71.203], [140.28, 71.215], [142.83, 71.228], [145.43, 71.240], [148.07, 71.253], [150.77, 71.266], [153.51, 71.280], [156.31, 71.296], [159.15, 71.312], [162.05, 71.330], [165.00, 71.348], [168.00, 71.367], [171.06, 71.387], [174.17, 71.407], [177.34, 71.428], [180.57, 71.448], [183.86, 71.468], [187.20, 71.488], [190.61, 71.508], [194.08, 71.528], [197.61, 71.548], [201.21, 71.567], [204.87, 71.586], [208.60, 71.606], [212.39, 71.626], [216.26, 71.645], [220.19, 71.664], [224.20, 71.683], [228.28, 71.703], [232.44, 71.723], [236.67, 71.744], [240.97, 71.764], [245.36, 71.785], [249.82, 71.807], [254.37, 71.830], [259.00, 71.853], [263.71, 71.876], [268.51, 71.899], [273.40, 71.923], [278.38, 71.946], [283.44, 71.968], [288.60, 71.990], [293.85, 72.010], [299.20, 72.030], [304.65, 72.048], [310.19, 72.064], [315.84, 72.080], [321.59, 72.095], [327.44, 72.109], [333.40, 72.122], [339.47, 72.134], [345.64, 72.146], [351.93, 72.157], [358.34, 72.169], [364.86, 72.183], [371.50, 72.199], [378.26, 72.218], [385.15, 72.241], [392.16, 72.268], [399.29, 72.300], [406.56, 72.339], [413.96, 72.384], [421.49, 72.435], [429.16, 72.492], [436.97, 72.553], [444.93, 72.618], [453.02, 72.683], [461.27, 72.749], [469.66, 72.814], [478.21, 72.878], [486.91, 72.941], [495.78, 73.001], [504.80, 73.059], [513.99, 73.114], [523.34, 73.168], [532.87, 73.220], [542.56, 73.272], [552.44, 73.324], [562.49, 73.376], [572.73, 73.429], [583.15, 73.482], [593.77, 73.536], [604.57, 73.591], [615.57, 73.645], [626.78, 73.700], [638.18, 73.755], [649.80, 73.811], [661.63, 73.867], [673.67, 73.924], [685.93, 73.981], [698.41, 74.038], [711.12, 74.094], [724.06, 74.150], [737.24, 74.204], [750.66, 74.257], [764.32, 74.308], [778.23, 74.357], [792.39, 74.403], [806.82, 74.445], [821.50, 74.485], [836.45, 74.523], [851.67, 74.560], [867.17, 74.596], [882.96, 74.634], [899.02, 74.673], [915.39, 74.716], [932.05, 74.763], [949.01, 74.814], [966.28, 74.872], [983.87, 74.936], [1001.77, 75.007], [1020.00, 75.087], [1038.57, 75.174], [1057.47, 75.225], [1076.71, 75.372], [1096.31, 75.481], [1116.26, 75.594], [1136.58, 75.713], [1157.26, 75.835], [1178.32, 75.961], [1199.77, 76.091], [1221.60, 76.225], [1243.84, 76.363], [1266.47, 76.504], [1289.52, 76.648], [1312.99, 76.794], [1336.89, 76.941], [1361.22, 77.091], [1385.99, 77.241], [1411.22, 77.395], [1436.90, 77.552], [1463.05, 77.713], [1489.68, 77.881], [1516.79, 78.057], [1544.40, 78.242], [1572.50, 78.439], [1601.12, 78.649], [1630.26, 78.872], [1659.93, 79.108], [1690.14, 79.356], [1720.90, 79.616], [1752.22, 79.885], [1784.11, 80.161], [1816.58, 80.444], [1849.64, 80.733], [1883.30, 81.024], [1917.58, 81.319], [1952.48, 81.617], [1988.01, 81.917], [2024.19, 82.220], [2061.03, 82.527], [2098.54, 82.839], [2136.73, 83.157], [2175.62, 83.481], [2215.22, 83.810], [2255.53, 84.141], [2296.58, 84.471], [2338.38, 84.793], [2380.94, 85.104], [2424.27, 85.397], [2468.39, 85.666], [2513.31, 85.909], [2559.05, 86.120], [2605.63, 86.297], [2653.05, 86.441], [2701.33, 86.551], [2750.50, 86.630], [2800.55, 86.682], [2851.52, 86.709], [2903.42, 86.712], [2956.26, 86.694], [3010.06, 86.655], [3064.85, 86.595], [3120.62, 86.514], [3177.42, 86.414], [3235.25, 86.293], [3294.13, 86.153], [3354.08, 85.997], [3415.12, 85.827], [3477.27, 85.647], [3540.56, 85.457], [3605.00, 85.261], [3670.60, 85.059], [3737.41, 84.853], [3805.43, 84.644], [3874.68, 84.433], [3945.20, 84.221], [4017.00, 84.007], [4090.11, 83.794], [4164.55, 83.581], [4240.34, 83.369], [4317.51, 83.159], [4396.09, 82.953], [4476.10, 82.753], [4557.56, 82.559], [4640.50, 82.375], [4724.96, 82.200], [4810.95, 82.036], [4898.51, 81.885], [4987.66, 81.745], [5078.43, 81.618], [5170.86, 81.502], [5264.97, 81.396], [5360.79, 81.297], [5458.35, 81.205], [5557.69, 81.118], [5658.84, 81.036], [5761.82, 80.960], [5866.69, 80.890], [5973.46, 80.825], [6082.17, 80.767], [6192.87, 80.717], [6305.57, 80.673], [6420.33, 80.635], [6537.18, 80.603], [6656.15, 80.575], [6777.29, 80.550], [6900.63, 80.529], [7026.22, 80.509], [7154.10, 80.488], [7284.30, 80.465], [7416.87, 80.435], [7551.85, 80.396], [7689.29, 80.344], [7829.23, 80.276], [7971.72, 80.189], [8116.80, 80.081], [8264.53, 79.952], [8414.94, 79.805], [8568.09, 79.642], [8724.02, 79.469], [8882.79, 79.287], [9044.46, 79.101], [9209.06, 78.914], [9376.66, 78.725], [9547.31, 78.534], [9721.07, 78.342], [9897.99, 78.147], [10078.13, 77.948], [10261.55, 77.744], [10448.30, 77.535], [10638.45, 77.320], [10832.07, 77.099], [11029.21, 76.873], [11229.94, 76.641], [11434.32, 76.406], [11642.41, 76.166], [11854.30, 75.923], [12070.04, 75.677], [12289.71, 75.429], [12513.38, 75.178], [12741.12, 74.926], [12973.00, 74.674], [13209.10, 74.424], [13449.50, 74.177], [13694.28, 73.932], [13943.51, 73.691], [14197.27, 73.451], [14455.66, 73.214], [14718.74, 72.977], [14986.62, 72.741], [15259.37, 72.506], [15537.08, 72.271], [15819.85, 72.036], [16107.76, 71.800], [16400.92, 71.565], [16699.41, 71.328], [17003.33, 71.091], [17312.78, 70.853], [17627.86, 70.613], [17948.68, 70.372], [18275.34, 70.129], [18607.94, 69.884], [18946.60, 69.638], [19291.42, 69.389], [19642.52, 69.140], [20000.00, 68.890]] },
            vshape: { id: 'vshape', name: 'V-Shape', data: [[20.00, 81.540], [20.36, 81.567], [20.73, 81.594], [21.11, 81.622], [21.50, 81.649], [21.89, 81.675], [22.29, 81.702], [22.69, 81.729], [23.10, 81.755], [23.52, 81.780], [23.95, 81.806], [24.39, 81.831], [24.83, 81.855], [25.28, 81.879], [25.74, 81.903], [26.21, 81.925], [26.69, 81.948], [27.18, 81.970], [27.67, 81.990], [28.17, 82.010], [28.69, 82.030], [29.21, 82.048], [29.74, 82.065], [30.28, 82.082], [30.83, 82.098], [31.39, 82.112], [31.97, 82.126], [32.55, 82.138], [33.14, 82.150], [33.74, 82.160], [34.36, 82.169], [34.98, 82.177], [35.62, 82.183], [36.27, 82.188], [36.93, 82.192], [37.60, 82.194], [38.28, 82.194], [38.98, 82.193], [39.69, 82.190], [40.41, 82.186], [41.15, 82.179], [41.90, 82.170], [42.66, 82.160], [43.44, 82.147], [44.23, 82.133], [45.03, 82.116], [45.85, 82.096], [46.68, 82.075], [47.53, 82.051], [48.40, 82.026], [49.28, 81.999], [50.18, 81.971], [51.09, 81.942], [52.02, 81.913], [52.97, 81.884], [53.93, 81.855], [54.91, 81.827], [55.91, 81.800], [56.93, 81.773], [57.97, 81.749], [59.02, 81.726], [60.09, 81.706], [61.19, 81.687], [62.30, 81.670], [63.44, 81.653], [64.59, 81.636], [65.77, 81.619], [66.96, 81.601], [68.18, 81.582], [69.42, 81.561], [70.69, 81.538], [71.97, 81.513], [73.28, 81.484], [74.62, 81.453], [75.97, 81.420], [77.36, 81.385], [78.76, 81.347], [80.20, 81.308], [81.66, 81.268], [83.14, 81.226], [84.66, 81.183], [86.20, 81.140], [87.77, 81.095], [89.36, 81.051], [90.99, 81.005], [92.65, 80.960], [94.33, 80.914], [96.05, 80.868], [97.80, 80.822], [99.58, 80.777], [101.39, 80.731], [103.23, 80.685], [105.11, 80.638], [107.03, 80.589], [108.97, 80.539], [110.96, 80.488], [112.98, 80.435], [115.03, 80.380], [117.13, 80.324], [119.26, 80.268], [121.43, 80.210], [123.64, 80.152], [125.89, 80.094], [128.18, 80.036], [130.51, 79.977], [132.89, 79.918], [135.31, 79.858], [137.77, 79.797], [140.28, 79.734], [142.83, 79.671], [145.43, 79.608], [148.07, 79.544], [150.77, 79.480], [153.51, 79.416], [156.31, 79.351], [159.15, 79.288], [162.05, 79.224], [165.00, 79.161], [168.00, 79.098], [171.06, 79.035], [174.17, 78.971], [177.34, 78.907], [180.57, 78.841], [183.86, 78.775], [187.20, 78.707], [190.61, 78.639], [194.08, 78.569], [197.61, 78.498], [201.21, 78.426], [204.87, 78.353], [208.60, 78.279], [212.39, 78.204], [216.26, 78.129], [220.19, 78.055], [224.20, 77.982], [228.28, 77.909], [232.44, 77.837], [236.67, 77.765], [240.97, 77.693], [245.36, 77.620], [249.82, 77.548], [254.37, 77.474], [259.00, 77.401], [263.71, 77.327], [268.51, 77.253], [273.40, 77.179], [278.38, 77.107], [283.44, 77.034], [288.60, 76.962], [293.85, 76.890], [299.20, 76.819], [304.65, 76.748], [310.19, 76.678], [315.84, 76.609], [321.59, 76.540], [327.44, 76.473], [333.40, 76.408], [339.47, 76.343], [345.64, 76.280], [351.93, 76.218], [358.34, 76.156], [364.86, 76.095], [371.50, 76.034], [378.26, 75.973], [385.15, 75.912], [392.16, 75.853], [399.29, 75.796], [406.56, 75.740], [413.96, 75.685], [421.49, 75.633], [429.16, 75.582], [436.97, 75.531], [444.93, 75.482], [453.02, 75.432], [461.27, 75.384], [469.66, 75.336], [478.21, 75.289], [486.91, 75.245], [495.78, 75.201], [504.80, 75.159], [513.99, 75.118], [523.34, 75.079], [532.87, 75.040], [542.56, 75.004], [552.44, 74.969], [562.49, 74.935], [572.73, 74.902], [583.15, 74.869], [593.77, 74.836], [604.57, 74.804], [615.57, 74.774], [626.78, 74.744], [638.18, 74.716], [649.80, 74.689], [661.63, 74.663], [673.67, 74.638], [685.93, 74.613], [698.41, 74.589], [711.12, 74.566], [724.06, 74.544], [737.24, 74.523], [750.66, 74.506], [764.32, 74.492], [778.23, 74.483], [792.39, 74.478], [806.82, 74.479], [821.50, 74.489], [836.45, 74.507], [851.67, 74.530], [867.17, 74.556], [882.96, 74.587], [899.02, 74.622], [915.39, 74.664], [932.05, 74.714], [949.01, 74.773], [966.28, 74.841], [983.87, 74.919], [1001.77, 75.009], [1020.00, 75.110], [1038.57, 75.224], [1057.47, 75.351], [1076.71, 75.489], [1096.31, 75.637], [1116.26, 75.794], [1136.58, 75.958], [1157.26, 76.126], [1178.32, 76.297], [1199.77, 76.470], [1221.60, 76.641], [1243.84, 76.809], [1266.47, 76.976], [1289.52, 77.140], [1312.99, 77.302], [1336.89, 77.460], [1361.22, 77.615], [1385.99, 77.768], [1411.22, 77.919], [1436.90, 78.068], [1463.05, 78.218], [1489.68, 78.369], [1516.79, 78.523], [1544.40, 78.679], [1572.50, 78.839], [1601.12, 79.006], [1630.26, 79.180], [1659.93, 79.361], [1690.14, 79.548], [1720.90, 79.740], [1752.22, 79.938], [1784.11, 80.143], [1816.58, 80.355], [1849.64, 80.574], [1883.30, 80.798], [1917.58, 81.023], [1952.48, 81.246], [1988.01, 81.464], [2024.19, 81.672], [2061.03, 81.866], [2098.54, 82.041], [2136.73, 82.193], [2175.62, 82.319], [2215.22, 82.416], [2255.53, 82.482], [2296.58, 82.515], [2338.38, 82.516], [2380.94, 82.484], [2424.27, 82.421], [2468.39, 82.331], [2513.31, 82.219], [2559.05, 82.092], [2605.63, 81.958], [2653.05, 81.822], [2701.33, 81.687], [2750.50, 81.558], [2800.55, 81.440], [2851.52, 81.339], [2903.42, 81.262], [2956.26, 81.216], [3010.06, 81.204], [3064.85, 81.232], [3120.62, 81.296], [3177.42, 81.393], [3235.25, 81.514], [3294.13, 81.648], [3354.08, 81.782], [3415.12, 81.903], [3477.27, 81.998], [3540.56, 82.056], [3605.00, 82.068], [3670.60, 82.032], [3737.41, 81.949], [3805.43, 81.825], [3874.68, 81.670], [3945.20, 81.494], [4017.00, 81.306], [4090.11, 81.112], [4164.55, 80.919], [4240.34, 80.732], [4317.51, 80.624], [4396.09, 80.419], [4476.10, 80.315], [4557.56, 80.254], [4640.50, 80.228], [4724.96, 80.212], [4810.95, 80.173], [4898.51, 80.075], [4987.66, 79.894], [5078.43, 79.622], [5170.86, 79.276], [5264.97, 78.882], [5360.79, 78.478], [5458.35, 78.098], [5557.69, 77.772], [5658.84, 77.516], [5761.82, 77.331], [5866.69, 77.206], [5973.46, 77.121], [6082.17, 77.062], [6192.87, 77.022], [6305.57, 77.006], [6420.33, 77.025], [6537.18, 77.095], [6656.15, 77.236], [6777.29, 77.465], [6900.63, 77.795], [7026.22, 78.229], [7154.10, 78.758], [7284.30, 79.357], [7416.87, 79.981], [7551.85, 80.568], [7689.29, 81.044], [7829.23, 81.335], [7971.72, 81.383], [8116.80, 81.164], [8264.53, 80.693], [8414.94, 80.018], [8568.09, 79.212], [8724.02, 78.355], [8882.79, 77.520], [9044.46, 76.773], [9209.06, 76.159], [9376.66, 75.697], [9547.31, 75.381], [9721.07, 75.180], [9897.99, 75.052], [10078.13, 74.945], [10261.55, 74.808], [10448.30, 74.604], [10638.45, 74.313], [10832.07, 73.438], [11029.21, 72.988], [11229.94, 72.513], [11434.32, 72.025], [11642.41, 71.538], [11854.30, 71.065], [12070.04, 70.989], [12289.71, 70.581], [12513.38, 70.246], [12741.12, 70.004], [12973.00, 69.870], [13209.10, 69.853], [13449.50, 69.954], [13694.28, 70.161], [13943.51, 70.443], [14197.27, 71.175], [14455.66, 72.015], [14718.74, 71.750], [14986.62, 71.485], [15259.37, 71.204], [15537.08, 70.011], [15819.85, 69.455], [16107.76, 68.945], [16400.92, 68.539], [16699.41, 68.187], [17003.33, 67.777], [17312.78, 67.189], [17627.86, 66.340], [17948.68, 65.194], [18275.34, 63.757], [18607.94, 62.065], [18946.60, 60.165], [19291.42, 58.107], [19642.52, 55.958], [20000.00, 53.788]] },
            gaming: { id: 'gaming', name: 'Gaming', data: [[20.00, 80.699], [20.36, 80.739], [20.73, 80.778], [21.11, 80.816], [21.50, 80.854], [21.89, 80.890], [22.29, 80.925], [22.69, 80.960], [23.10, 80.992], [23.52, 81.024], [23.95, 81.054], [24.39, 81.083], [24.83, 81.111], [25.28, 81.138], [25.74, 81.163], [26.21, 81.187], [26.69, 81.209], [27.18, 81.231], [27.67, 81.251], [28.17, 81.269], [28.69, 81.287], [29.21, 81.303], [29.74, 81.317], [30.28, 81.331], [30.83, 81.343], [31.39, 81.354], [31.97, 81.363], [32.55, 81.372], [33.14, 81.378], [33.74, 81.384], [34.36, 81.388], [34.98, 81.391], [35.62, 81.393], [36.27, 81.393], [36.93, 81.393], [37.60, 81.392], [38.28, 81.389], [38.98, 81.385], [39.69, 81.380], [40.41, 81.374], [41.15, 81.367], [41.90, 81.358], [42.66, 81.349], [43.44, 81.337], [44.23, 81.325], [45.03, 81.312], [45.85, 81.297], [46.68, 81.281], [47.53, 81.263], [48.40, 81.245], [49.28, 81.225], [50.18, 81.203], [51.09, 81.181], [52.02, 81.157], [52.97, 81.132], [53.93, 81.105], [54.91, 81.078], [55.91, 81.049], [56.93, 81.020], [57.97, 80.989], [59.02, 80.957], [60.09, 80.924], [61.19, 80.891], [62.30, 80.856], [63.44, 80.821], [64.59, 80.784], [65.77, 80.748], [66.96, 80.710], [68.18, 80.672], [69.42, 80.632], [70.69, 80.593], [71.97, 80.552], [73.28, 80.511], [74.62, 80.470], [75.97, 80.427], [77.36, 80.384], [78.76, 80.340], [80.20, 80.296], [81.66, 80.251], [83.14, 80.205], [84.66, 80.160], [86.20, 80.113], [87.77, 80.066], [89.36, 80.019], [90.99, 79.972], [92.65, 79.923], [94.33, 79.875], [96.05, 79.825], [97.80, 79.774], [99.58, 79.722], [101.39, 79.669], [103.23, 79.615], [105.11, 79.561], [107.03, 79.506], [108.97, 79.450], [110.96, 79.393], [112.98, 79.337], [115.03, 79.280], [117.13, 79.223], [119.26, 79.167], [121.43, 79.110], [123.64, 79.055], [125.89, 79.000], [128.18, 78.946], [130.51, 78.893], [132.89, 78.842], [135.31, 78.792], [137.77, 78.744], [140.28, 78.698], [142.83, 78.653], [145.43, 78.608], [148.07, 78.564], [150.77, 78.520], [153.51, 78.475], [156.31, 78.429], [159.15, 78.383], [162.05, 78.334], [165.00, 78.285], [168.00, 78.233], [171.06, 78.179], [174.17, 78.124], [177.34, 78.068], [180.57, 78.011], [183.86, 77.953], [187.20, 77.894], [190.61, 77.836], [194.08, 77.778], [197.61, 77.720], [201.21, 77.663], [204.87, 77.607], [208.60, 77.552], [212.39, 77.498], [216.26, 77.445], [220.19, 77.393], [224.20, 77.342], [228.28, 77.292], [232.44, 77.241], [236.67, 77.191], [240.97, 77.139], [245.36, 77.087], [249.82, 77.034], [254.37, 76.980], [259.00, 76.925], [263.71, 76.869], [268.51, 76.812], [273.40, 76.756], [278.38, 76.700], [283.44, 76.644], [288.60, 76.589], [293.85, 76.535], [299.20, 76.483], [304.65, 76.433], [310.19, 76.385], [315.84, 76.338], [321.59, 76.293], [327.44, 76.249], [333.40, 76.207], [339.47, 76.164], [345.64, 76.122], [351.93, 76.078], [358.34, 76.034], [364.86, 75.989], [371.50, 75.943], [378.26, 75.895], [385.15, 75.847], [392.16, 75.798], [399.29, 75.749], [406.56, 75.701], [413.96, 75.653], [421.49, 75.605], [429.16, 75.558], [436.97, 75.512], [444.93, 75.466], [453.02, 75.421], [461.27, 75.376], [469.66, 75.332], [478.21, 75.288], [486.91, 75.246], [495.78, 75.204], [504.80, 75.163], [513.99, 75.123], [523.34, 75.083], [532.87, 75.043], [542.56, 75.004], [552.44, 74.965], [562.49, 74.927], [572.73, 74.889], [583.15, 74.851], [593.77, 74.815], [604.57, 74.779], [615.57, 74.745], [626.78, 74.712], [638.18, 74.680], [649.80, 74.650], [661.63, 74.621], [673.67, 74.594], [685.93, 74.568], [698.41, 74.545], [711.12, 74.523], [724.06, 74.502], [737.24, 74.484], [750.66, 74.469], [764.32, 74.456], [778.23, 74.446], [792.39, 74.440], [806.82, 74.435], [821.50, 74.433], [836.45, 74.434], [851.67, 74.439], [867.17, 74.455], [882.96, 74.484], [899.02, 74.528], [915.39, 74.587], [932.05, 74.658], [949.01, 74.738], [966.28, 74.824], [983.87, 74.915], [1001.77, 75.009], [1020.00, 75.107], [1038.57, 75.209], [1057.47, 75.315], [1076.71, 75.429], [1096.31, 75.553], [1116.26, 75.691], [1136.58, 75.840], [1157.26, 76.001], [1178.32, 76.170], [1199.77, 76.341], [1221.60, 76.512], [1243.84, 76.677], [1266.47, 76.838], [1289.52, 76.991], [1312.99, 77.137], [1336.89, 77.275], [1361.22, 77.405], [1385.99, 77.527], [1411.22, 77.645], [1436.90, 77.758], [1463.05, 77.868], [1489.68, 77.978], [1516.79, 78.088], [1544.40, 78.199], [1572.50, 78.309], [1601.12, 78.420], [1630.26, 78.533], [1659.93, 78.649], [1690.14, 78.769], [1720.90, 78.892], [1752.22, 79.020], [1784.11, 79.154], [1816.58, 79.292], [1849.64, 79.436], [1883.30, 79.584], [1917.58, 79.736], [1952.48, 79.891], [1988.01, 80.050], [2024.19, 80.214], [2061.03, 80.381], [2098.54, 80.553], [2136.73, 80.728], [2175.62, 80.905], [2215.22, 81.084], [2255.53, 81.264], [2296.58, 81.441], [2338.38, 81.615], [2380.94, 81.783], [2424.27, 81.944], [2468.39, 82.099], [2513.31, 82.249], [2559.05, 82.395], [2605.63, 82.539], [2653.05, 82.682], [2701.33, 82.823], [2750.50, 82.959], [2800.55, 83.086], [2851.52, 83.199], [2903.42, 83.292], [2956.26, 83.364], [3010.06, 83.410], [3064.85, 83.433], [3120.62, 83.432], [3177.42, 83.410], [3235.25, 83.370], [3294.13, 83.311], [3354.08, 83.235], [3415.12, 83.143], [3477.27, 83.036], [3540.56, 82.917], [3605.00, 82.790], [3670.60, 82.658], [3737.41, 82.526], [3805.43, 82.395], [3874.68, 82.268], [3945.20, 82.143], [4017.00, 82.023], [4090.11, 81.906], [4164.55, 81.791], [4240.34, 81.679], [4317.51, 81.569], [4396.09, 81.461], [4476.10, 81.357], [4557.56, 81.256], [4640.50, 81.161], [4724.96, 81.070], [4810.95, 80.984], [4898.51, 80.900], [4987.66, 80.819], [5078.43, 80.739], [5170.86, 80.659], [5264.97, 80.579], [5360.79, 80.498], [5458.35, 80.418], [5557.69, 80.340], [5658.84, 80.264], [5761.82, 80.193], [5866.69, 80.127], [5973.46, 80.067], [6082.17, 80.012], [6192.87, 79.965], [6305.57, 79.928], [6420.33, 79.903], [6537.18, 79.898], [6656.15, 79.920], [6777.29, 79.975], [6900.63, 80.073], [7026.22, 80.218], [7154.10, 80.411], [7284.30, 80.646], [7416.87, 80.904], [7551.85, 81.157], [7689.29, 81.361], [7829.23, 81.467], [7971.72, 81.425], [8116.80, 81.194], [8264.53, 80.756], [8414.94, 80.117], [8568.09, 79.309], [8724.02, 78.376], [8882.79, 77.366], [9044.46, 76.323], [9209.06, 75.281], [9376.66, 74.269], [9547.31, 73.308], [9721.07, 72.419], [9897.99, 71.617], [10078.13, 70.918], [10261.55, 70.337], [10448.30, 69.889], [10638.45, 69.583], [10832.07, 69.415], [11029.21, 69.369], [11229.94, 69.421], [11434.32, 69.551], [11642.41, 69.748], [11854.30, 70.014], [12070.04, 70.353], [12289.71, 70.762], [12513.38, 71.224], [12741.12, 71.698], [12973.00, 72.125], [13209.10, 72.444], [13449.50, 72.610], [13694.28, 72.614], [13943.51, 72.484], [14197.27, 72.269], [14455.66, 72.015], [14718.74, 71.750], [14986.62, 71.485], [15259.37, 71.204], [15537.08, 70.874], [15819.85, 70.455], [16107.76, 69.904], [16400.92, 69.193], [16699.41, 68.321], [17003.33, 67.318], [17312.78, 66.229], [17627.86, 65.090], [17948.68, 63.910], [18275.34, 62.672], [18607.94, 61.352], [18946.60, 59.940], [19291.42, 58.453], [19642.52, 56.924], [20000.00, 55.392]] },
            moondrop_vdsf: { id: 'moondrop_vdsf', name: 'Moondrop VDSF', data: [[20.00, 77.103], [20.36, 77.093], [20.73, 77.083], [21.11, 77.073], [21.50, 77.062], [21.89, 77.051], [22.29, 77.039], [22.69, 77.026], [23.10, 77.013], [23.52, 76.999], [23.95, 76.985], [24.39, 76.971], [24.83, 76.957], [25.28, 76.943], [25.74, 76.930], [26.21, 76.917], [26.69, 76.906], [27.18, 76.895], [27.67, 76.884], [28.17, 76.875], [28.69, 76.867], [29.21, 76.859], [29.74, 76.852], [30.28, 76.845], [30.83, 76.839], [31.39, 76.834], [31.97, 76.829], [32.55, 76.824], [33.14, 76.819], [33.74, 76.815], [34.36, 76.811], [34.98, 76.807], [35.62, 76.803], [36.27, 76.799], [36.93, 76.795], [37.60, 76.791], [38.28, 76.787], [38.98, 76.783], [39.69, 76.779], [40.41, 76.774], [41.15, 76.770], [41.90, 76.765], [42.66, 76.759], [43.44, 76.753], [44.23, 76.747], [45.03, 76.740], [45.85, 76.731], [46.68, 76.722], [47.53, 76.711], [48.40, 76.698], [49.28, 76.684], [50.18, 76.667], [51.09, 76.649], [52.02, 76.628], [52.97, 76.604], [53.93, 76.579], [54.91, 76.551], [55.91, 76.521], [56.93, 76.489], [57.97, 76.455], [59.02, 76.420], [60.09, 76.385], [61.19, 76.349], [62.30, 76.312], [63.44, 76.277], [64.59, 76.242], [65.77, 76.208], [66.96, 76.176], [68.18, 76.146], [69.42, 76.118], [70.69, 76.091], [71.97, 76.067], [73.28, 76.044], [74.62, 76.023], [75.97, 76.004], [77.36, 75.986], [78.76, 75.969], [80.20, 75.952], [81.66, 75.935], [83.14, 75.918], [84.66, 75.900], [86.20, 75.881], [87.77, 75.861], [89.36, 75.839], [90.99, 75.816], [92.65, 75.790], [94.33, 75.763], [96.05, 75.733], [97.80, 75.702], [99.58, 75.668], [101.39, 75.633], [103.23, 75.597], [105.11, 75.559], [107.03, 75.520], [108.97, 75.481], [110.96, 75.442], [112.98, 75.404], [115.03, 75.366], [117.13, 75.329], [119.26, 75.294], [121.43, 75.260], [123.64, 75.228], [125.89, 75.198], [128.18, 75.170], [130.51, 75.143], [132.89, 75.118], [135.31, 75.093], [137.77, 75.069], [140.28, 75.045], [142.83, 75.020], [145.43, 74.993], [148.07, 74.965], [150.77, 74.934], [153.51, 74.901], [156.31, 74.863], [159.15, 74.822], [162.05, 74.777], [165.00, 74.728], [168.00, 74.674], [171.06, 74.616], [174.17, 74.555], [177.34, 74.490], [180.57, 74.423], [183.86, 74.355], [187.20, 74.286], [190.61, 74.219], [194.08, 74.153], [197.61, 74.091], [201.21, 74.033], [204.87, 73.981], [208.60, 73.934], [212.39, 73.894], [216.26, 73.860], [220.19, 73.832], [224.20, 73.810], [228.28, 73.793], [232.44, 73.782], [236.67, 73.775], [240.97, 73.772], [245.36, 73.772], [249.82, 73.776], [254.37, 73.784], [259.00, 73.794], [263.71, 73.806], [268.51, 73.822], [273.40, 73.840], [278.38, 73.860], [283.44, 73.883], [288.60, 73.906], [293.85, 73.931], [299.20, 73.957], [304.65, 73.982], [310.19, 74.007], [315.84, 74.030], [321.59, 74.051], [327.44, 74.071], [333.40, 74.088], [339.47, 74.102], [345.64, 74.115], [351.93, 74.125], [358.34, 74.134], [364.86, 74.141], [371.50, 74.148], [378.26, 74.153], [385.15, 74.157], [392.16, 74.162], [399.29, 74.165], [406.56, 74.169], [413.96, 74.173], [421.49, 74.176], [429.16, 74.179], [436.97, 74.183], [444.93, 74.187], [453.02, 74.191], [461.27, 74.195], [469.66, 74.201], [478.21, 74.208], [486.91, 74.216], [495.78, 74.226], [504.80, 74.239], [513.99, 74.254], [523.34, 74.273], [532.87, 74.294], [542.56, 74.320], [552.44, 74.348], [562.49, 74.380], [572.73, 74.414], [583.15, 74.451], [593.77, 74.489], [604.57, 74.528], [615.57, 74.568], [626.78, 74.607], [638.18, 74.646], [649.80, 74.683], [661.63, 74.717], [673.67, 74.749], [685.93, 74.777], [698.41, 74.802], [711.12, 74.823], [724.06, 74.841], [737.24, 74.855], [750.66, 74.867], [764.32, 74.877], [778.23, 74.885], [792.39, 74.891], [806.82, 74.896], [821.50, 74.901], [836.45, 74.906], [851.67, 74.910], [867.17, 74.914], [882.96, 74.919], [899.02, 74.925], [915.39, 74.932], [932.05, 74.941], [949.01, 74.952], [966.28, 74.965], [983.87, 74.982], [1001.77, 75.002], [1020.00, 75.026], [1038.57, 75.055], [1057.47, 75.088], [1076.71, 75.126], [1096.31, 75.169], [1116.26, 75.218], [1136.58, 75.272], [1157.26, 75.332], [1178.32, 75.400], [1199.77, 75.475], [1221.60, 75.559], [1243.84, 75.652], [1266.47, 75.754], [1289.52, 75.866], [1312.99, 75.987], [1336.89, 76.116], [1361.22, 76.253], [1385.99, 76.396], [1411.22, 76.546], [1436.90, 76.700], [1463.05, 76.859], [1489.68, 77.021], [1516.79, 77.187], [1544.40, 77.357], [1572.50, 77.530], [1601.12, 77.707], [1630.26, 77.887], [1659.93, 78.071], [1690.14, 78.257], [1720.90, 78.446], [1752.22, 78.636], [1784.11, 78.829], [1816.58, 79.024], [1849.64, 79.220], [1883.30, 79.419], [1917.58, 79.620], [1952.48, 79.823], [1988.01, 80.029], [2024.19, 80.237], [2061.03, 80.447], [2098.54, 80.658], [2136.73, 80.869], [2175.62, 81.077], [2215.22, 81.282], [2255.53, 81.481], [2296.58, 81.673], [2338.38, 81.857], [2380.94, 82.030], [2424.27, 82.193], [2468.39, 82.344], [2513.31, 82.483], [2559.05, 82.609], [2605.63, 82.724], [2653.05, 82.826], [2701.33, 82.915], [2750.50, 82.993], [2800.55, 83.059], [2851.52, 83.112], [2903.42, 83.154], [2956.26, 83.182], [3010.06, 83.198], [3064.85, 83.198], [3120.62, 83.184], [3177.42, 83.153], [3235.25, 83.106], [3294.13, 83.041], [3354.08, 82.959], [3415.12, 82.861], [3477.27, 82.749], [3540.56, 82.623], [3605.00, 82.487], [3670.60, 82.343], [3737.41, 82.194], [3805.43, 82.041], [3874.68, 81.887], [3945.20, 81.732], [4017.00, 81.578], [4090.11, 81.422], [4164.55, 81.266], [4240.34, 81.107], [4317.51, 80.944], [4396.09, 80.776], [4476.10, 80.603], [4557.56, 80.423], [4640.50, 80.237], [4724.96, 80.044], [4810.95, 79.846], [4898.51, 79.644], [4987.66, 79.439], [5078.43, 79.232], [5170.86, 79.025], [5264.97, 78.819], [5360.79, 78.616], [5458.35, 78.416], [5557.69, 78.220], [5658.84, 78.029], [5761.82, 77.843], [5866.69, 77.660], [5973.46, 77.482], [6082.17, 77.306], [6192.87, 77.133], [6305.57, 76.961], [6420.33, 76.791], [6537.18, 76.620], [6656.15, 76.451], [6777.29, 76.282], [6900.63, 76.114], [7026.22, 75.951], [7154.10, 75.793], [7284.30, 75.644], [7416.87, 75.508], [7551.85, 75.388], [7689.29, 75.287], [7829.23, 75.208], [7971.72, 75.154], [8116.80, 75.124], [8264.53, 75.117], [8414.94, 75.131], [8568.09, 75.160], [8724.02, 75.198], [8882.79, 75.237], [9044.46, 75.268], [9209.06, 75.282], [9376.66, 75.270], [9547.31, 75.221], [9721.07, 75.129], [9897.99, 74.985], [10078.13, 74.787], [10261.55, 74.530], [10448.30, 74.217], [10638.45, 73.851], [10832.07, 73.438], [11029.21, 72.988], [11229.94, 72.513], [11434.32, 72.025], [11642.41, 71.538], [11854.30, 71.065], [12070.04, 70.618], [12289.71, 70.205], [12513.38, 69.833], [12741.12, 69.503], [12973.00, 69.214], [13209.10, 68.963], [13449.50, 68.744], [13694.28, 68.548], [13943.51, 68.369], [14197.27, 68.200], [14455.66, 68.034], [14718.74, 67.867], [14986.62, 67.694], [15259.37, 67.511], [15537.08, 67.312], [15819.85, 67.090], [16107.76, 66.834], [16400.92, 66.527], [16699.41, 66.147], [17003.33, 65.661], [17312.78, 65.026], [17627.86, 64.186], [17948.68, 63.076], [18275.34, 61.615], [18607.94, 59.722], [18946.60, 57.322], [19291.42, 54.366], [19642.52, 50.866], [20000.00, 46.930]] },
            peqdb_diamond: { id: 'peqdb_diamond', name: 'PEQdb Diamond', data: [[20.00, 82.981], [20.36, 82.974], [20.73, 82.967], [21.11, 82.959], [21.50, 82.952], [21.89, 82.944], [22.29, 82.935], [22.69, 82.926], [23.10, 82.917], [23.52, 82.908], [23.95, 82.898], [24.39, 82.887], [24.83, 82.876], [25.28, 82.865], [25.74, 82.853], [26.21, 82.841], [26.69, 82.828], [27.18, 82.815], [27.67, 82.801], [28.17, 82.787], [28.69, 82.772], [29.21, 82.756], [29.74, 82.740], [30.28, 82.723], [30.83, 82.705], [31.39, 82.686], [31.97, 82.667], [32.55, 82.647], [33.14, 82.626], [33.74, 82.604], [34.36, 82.581], [34.98, 82.557], [35.62, 82.532], [36.27, 82.507], [36.93, 82.479], [37.60, 82.451], [38.28, 82.422], [38.98, 82.391], [39.69, 82.359], [40.41, 82.326], [41.15, 82.291], [41.90, 82.255], [42.66, 82.218], [43.44, 82.178], [44.23, 82.138], [45.03, 82.095], [45.85, 82.051], [46.68, 82.005], [47.53, 81.957], [48.40, 81.907], [49.28, 81.855], [50.18, 81.801], [51.09, 81.745], [52.02, 81.687], [52.97, 81.627], [53.93, 81.565], [54.91, 81.500], [55.91, 81.433], [56.93, 81.363], [57.97, 81.291], [59.02, 81.216], [60.09, 81.139], [61.19, 81.060], [62.30, 80.977], [63.44, 80.893], [64.59, 80.805], [65.77, 80.715], [66.96, 80.622], [68.18, 80.527], [69.42, 80.429], [70.69, 80.328], [71.97, 80.224], [73.28, 80.118], [74.62, 80.010], [75.97, 79.899], [77.36, 79.785], [78.76, 79.669], [80.20, 79.551], [81.66, 79.431], [83.14, 79.308], [84.66, 79.182], [86.20, 79.055], [87.77, 78.927], [89.36, 78.795], [90.99, 78.663], [92.65, 78.529], [94.33, 78.394], [96.05, 78.257], [97.80, 78.121], [99.58, 77.985], [101.39, 77.848], [103.23, 77.714], [105.11, 77.579], [107.03, 77.448], [108.97, 77.317], [110.96, 77.187], [112.98, 77.057], [115.03, 76.927], [117.13, 76.797], [119.26, 76.666], [121.43, 76.534], [123.64, 76.403], [125.89, 76.272], [128.18, 76.142], [130.51, 76.015], [132.89, 75.891], [135.31, 75.770], [137.77, 75.652], [140.28, 75.537], [142.83, 75.424], [145.43, 75.313], [148.07, 75.204], [150.77, 75.098], [153.51, 74.996], [156.31, 74.897], [159.15, 74.801], [162.05, 74.710], [165.00, 74.621], [168.00, 74.535], [171.06, 74.453], [174.17, 74.374], [177.34, 74.299], [180.57, 74.225], [183.86, 74.154], [187.20, 74.085], [190.61, 74.019], [194.08, 73.956], [197.61, 73.895], [201.21, 73.836], [204.87, 73.779], [208.60, 73.726], [212.39, 73.675], [216.26, 73.625], [220.19, 73.578], [224.20, 73.534], [228.28, 73.492], [232.44, 73.453], [236.67, 73.417], [240.97, 73.382], [245.36, 73.350], [249.82, 73.321], [254.37, 73.294], [259.00, 73.270], [263.71, 73.247], [268.51, 73.227], [273.40, 73.208], [278.38, 73.191], [283.44, 73.174], [288.60, 73.158], [293.85, 73.142], [299.20, 73.127], [304.65, 73.112], [310.19, 73.096], [315.84, 73.081], [321.59, 73.066], [327.44, 73.052], [333.40, 73.037], [339.47, 73.023], [345.64, 73.009], [351.93, 72.995], [358.34, 72.984], [364.86, 72.975], [371.50, 72.969], [378.26, 72.966], [385.15, 72.969], [392.16, 72.976], [399.29, 72.989], [406.56, 73.009], [413.96, 73.036], [421.49, 73.070], [429.16, 73.110], [436.97, 73.155], [444.93, 73.204], [453.02, 73.254], [461.27, 73.305], [469.66, 73.355], [478.21, 73.405], [486.91, 73.454], [495.78, 73.500], [504.80, 73.545], [513.99, 73.587], [523.34, 73.628], [532.87, 73.668], [542.56, 73.708], [552.44, 73.747], [562.49, 73.788], [572.73, 73.829], [583.15, 73.870], [593.77, 73.913], [604.57, 73.956], [615.57, 73.999], [626.78, 74.042], [638.18, 74.086], [649.80, 74.131], [661.63, 74.176], [673.67, 74.221], [685.93, 74.267], [698.41, 74.312], [711.12, 74.357], [724.06, 74.401], [737.24, 74.444], [750.66, 74.485], [764.32, 74.524], [778.23, 74.560], [792.39, 74.594], [806.82, 74.623], [821.50, 74.650], [836.45, 74.675], [851.67, 74.699], [867.17, 74.721], [882.96, 74.744], [899.02, 74.769], [915.39, 74.797], [932.05, 74.828], [949.01, 74.863], [966.28, 74.905], [983.87, 74.952], [1001.77, 75.005], [1020.00, 75.066], [1038.57, 75.135], [1057.47, 75.211], [1076.71, 75.292], [1096.31, 75.380], [1116.26, 75.471], [1136.58, 75.567], [1157.26, 75.665], [1178.32, 75.766], [1199.77, 75.869], [1221.60, 75.976], [1243.84, 76.086], [1266.47, 76.197], [1289.52, 76.309], [1312.99, 76.423], [1336.89, 76.536], [1361.22, 76.650], [1385.99, 76.762], [1411.22, 76.877], [1436.90, 76.992], [1463.05, 77.110], [1489.68, 77.233], [1516.79, 77.361], [1544.40, 77.496], [1572.50, 77.640], [1601.12, 77.795], [1630.26, 77.960], [1659.93, 78.136], [1690.14, 78.321], [1720.90, 78.514], [1752.22, 78.714], [1784.11, 78.918], [1816.58, 79.126], [1849.64, 79.336], [1883.30, 79.546], [1917.58, 79.756], [1952.48, 79.967], [1988.01, 80.178], [2024.19, 80.389], [2061.03, 80.603], [2098.54, 80.820], [2136.73, 81.042], [2175.62, 81.271], [2215.22, 81.506], [2255.53, 81.744], [2296.58, 81.985], [2338.38, 82.222], [2380.94, 82.454], [2424.27, 82.675], [2468.39, 82.881], [2513.31, 83.071], [2559.05, 83.241], [2605.63, 83.389], [2653.05, 83.519], [2701.33, 83.629], [2750.50, 83.724], [2800.55, 83.807], [2851.52, 83.880], [2903.42, 83.943], [2956.26, 84.000], [3010.06, 84.048], [3064.85, 84.087], [3120.62, 84.115], [3177.42, 84.133], [3235.25, 84.138], [3294.13, 84.129], [3354.08, 84.110], [3415.12, 84.079], [3477.27, 84.041], [3540.56, 83.995], [3605.00, 83.943], [3670.60, 83.885], [3737.41, 83.822], [3805.43, 83.756], [3874.68, 83.685], [3945.20, 83.612], [4017.00, 83.535], [4090.11, 83.456], [4164.55, 83.374], [4240.34, 83.292], [4317.51, 83.208], [4396.09, 83.125], [4476.10, 83.046], [4557.56, 82.970], [4640.50, 82.901], [4724.96, 82.838], [4810.95, 82.783], [4898.51, 82.738], [4987.66, 82.701], [5078.43, 82.674], [5170.86, 82.655], [5264.97, 82.643], [5360.79, 82.634], [5458.35, 82.630], [5557.69, 82.628], [5658.84, 82.627], [5761.82, 82.630], [5866.69, 82.636], [5973.46, 82.643], [6082.17, 82.655], [6192.87, 82.672], [6305.57, 82.692], [6420.33, 82.715], [6537.18, 82.741], [6656.15, 82.769], [6777.29, 82.797], [6900.63, 82.827], [7026.22, 82.855], [7154.10, 82.879], [7284.30, 82.900], [7416.87, 82.911], [7551.85, 82.911], [7689.29, 82.896], [7829.23, 82.863], [7971.72, 82.809], [8116.80, 82.732], [8264.53, 82.633], [8414.94, 82.514], [8568.09, 82.377], [8724.02, 82.229], [8882.79, 82.071], [9044.46, 81.907], [9209.06, 81.741], [9376.66, 81.572], [9547.31, 81.399], [9721.07, 81.225], [9897.99, 81.046], [10078.13, 80.863], [10261.55, 80.673], [10448.30, 80.478], [10638.45, 80.276], [10832.07, 80.067], [11029.21, 79.852], [11229.94, 79.631], [11434.32, 79.406], [11642.41, 79.176], [11854.30, 78.942], [12070.04, 78.704], [12289.71, 78.464], [12513.38, 78.221], [12741.12, 77.976], [12973.00, 77.731], [13209.10, 77.487], [13449.50, 77.246], [13694.28, 77.006], [13943.51, 76.771], [14197.27, 76.536], [14455.66, 76.303], [14718.74, 76.070], [14986.62, 75.839], [15259.37, 75.607], [15537.08, 75.376], [15819.85, 75.144], [16107.76, 74.912], [16400.92, 74.680], [16699.41, 74.445], [17003.33, 74.211], [17312.78, 73.975], [17627.86, 73.738], [17948.68, 73.499], [18275.34, 73.258], [18607.94, 73.015], [18946.60, 72.770], [19291.42, 72.523], [19642.52, 72.275], [20000.00, 72.027]] },
            'jm-1': { id: 'jm-1', name: 'JM-1', data: [[20.00, 4.538], [20.30, 4.543], [20.60, 4.547], [20.90, 4.549], [21.20, 4.550], [21.40, 4.551], [21.80, 4.553], [22.00, 4.554], [22.40, 4.555], [22.70, 4.556], [23.00, 4.557], [23.30, 4.558], [23.60, 4.559], [24.00, 4.560], [24.30, 4.561], [24.70, 4.562], [25.00, 4.563], [25.40, 4.563], [25.80, 4.564], [26.20, 4.566], [26.50, 4.566], [26.90, 4.567], [27.20, 4.567], [27.60, 4.568], [28.00, 4.568], [28.50, 4.569], [29.00, 4.570], [29.50, 4.570], [30.00, 4.570], [30.40, 4.570], [30.70, 4.570], [31.10, 4.571], [31.50, 4.571], [32.00, 4.571], [32.50, 4.570], [33.00, 4.569], [33.50, 4.567], [34.00, 4.566], [34.50, 4.565], [35.00, 4.563], [35.50, 4.562], [36.00, 4.560], [36.50, 4.558], [37.00, 4.556], [37.50, 4.553], [38.20, 4.549], [38.70, 4.546], [39.50, 4.540], [40.00, 4.536], [40.60, 4.531], [41.20, 4.526], [41.80, 4.521], [42.50, 4.513], [43.10, 4.507], [43.70, 4.500], [44.40, 4.491], [45.00, 4.483], [45.50, 4.476], [46.20, 4.466], [46.80, 4.457], [47.50, 4.445], [48.20, 4.433], [48.70, 4.424], [49.40, 4.411], [50.00, 4.399], [50.80, 4.382], [51.50, 4.367], [52.20, 4.350], [53.00, 4.331], [53.80, 4.311], [54.50, 4.293], [55.20, 4.273], [56.00, 4.250], [57.00, 4.220], [58.00, 4.189], [59.00, 4.156], [60.00, 4.121], [60.80, 4.092], [61.50, 4.067], [62.20, 4.041], [63.00, 4.010], [64.00, 3.969], [65.00, 3.927], [66.00, 3.884], [67.00, 3.839], [68.00, 3.794], [69.00, 3.746], [70.00, 3.698], [71.00, 3.648], [72.00, 3.597], [73.00, 3.545], [74.00, 3.492], [75.00, 3.437], [76.20, 3.371], [77.50, 3.297], [78.80, 3.222], [80.00, 3.152], [81.20, 3.081], [82.50, 3.003], [83.80, 2.924], [85.00, 2.850], [86.20, 2.776], [87.50, 2.695], [88.50, 2.633], [90.00, 2.539], [91.20, 2.463], [92.50, 2.382], [93.80, 2.301], [95.00, 2.225], [96.20, 2.151], [97.50, 2.070], [98.80, 1.990], [100.00, 1.917], [101.50, 1.826], [103.00, 1.735], [104.40, 1.652], [106.00, 1.559], [107.50, 1.473], [109.00, 1.388], [110.60, 1.300], [112.00, 1.224], [113.80, 1.129], [115.00, 1.067], [117.20, 0.956], [118.00, 0.916], [120.60, 0.792], [122.00, 0.727], [124.10, 0.634], [125.00, 0.595], [126.50, 0.531], [128.00, 0.469], [131.50, 0.332], [132.00, 0.314], [134.00, 0.241], [136.00, 0.172], [138.00, 0.105], [140.00, 0.041], [143.00, -0.050], [145.00, -0.106], [147.50, -0.172], [150.00, -0.235], [152.50, -0.293], [155.00, -0.347], [157.50, -0.398], [160.00, -0.445], [162.50, -0.489], [165.00, -0.530], [167.50, -0.567], [170.00, -0.602], [172.50, -0.635], [175.00, -0.665], [177.50, -0.692], [180.00, -0.718], [182.50, -0.741], [185.00, -0.761], [187.50, -0.781], [190.00, -0.798], [192.50, -0.815], [195.00, -0.830], [197.50, -0.843], [200.00, -0.855], [203.00, -0.868], [206.00, -0.879], [209.00, -0.889], [212.00, -0.898], [214.00, -0.902], [218.00, -0.909], [220.00, -0.911], [224.00, -0.915], [227.00, -0.917], [230.00, -0.917], [233.00, -0.917], [236.00, -0.917], [240.00, -0.915], [243.00, -0.912], [247.00, -0.908], [250.00, -0.905], [254.00, -0.898], [258.00, -0.891], [262.00, -0.883], [265.00, -0.877], [269.00, -0.867], [272.00, -0.860], [276.00, -0.849], [280.00, -0.839], [285.00, -0.826], [290.00, -0.812], [295.00, -0.798], [300.00, -0.781], [304.00, -0.766], [307.00, -0.755], [311.00, -0.740], [315.00, -0.725], [320.00, -0.707], [325.00, -0.689], [330.00, -0.671], [335.00, -0.653], [340.00, -0.635], [345.00, -0.617], [350.00, -0.598], [355.00, -0.579], [360.00, -0.560], [365.00, -0.540], [370.00, -0.519], [375.00, -0.499], [382.00, -0.470], [387.00, -0.448], [395.00, -0.414], [400.00, -0.392], [406.00, -0.365], [412.00, -0.338], [418.00, -0.310], [425.00, -0.277], [431.00, -0.249], [437.00, -0.220], [444.00, -0.186], [450.00, -0.157], [455.00, -0.133], [462.00, -0.099], [468.00, -0.069], [475.00, -0.034], [482.00, 0.000], [487.00, 0.025], [494.00, 0.060], [500.00, 0.090], [508.00, 0.129], [515.00, 0.164], [522.00, 0.198], [530.00, 0.236], [538.00, 0.275], [545.00, 0.309], [552.00, 0.342], [560.00, 0.379], [570.00, 0.424], [580.00, 0.468], [590.00, 0.512], [600.00, 0.553], [608.00, 0.585], [615.00, 0.613], [622.00, 0.640], [630.00, 0.670], [640.00, 0.707], [650.00, 0.742], [660.00, 0.775], [670.00, 0.808], [680.00, 0.839], [690.00, 0.869], [700.00, 0.898], [710.00, 0.926], [720.00, 0.953], [730.00, 0.979], [740.00, 1.004], [750.00, 1.028], [762.00, 1.056], [775.00, 1.085], [788.00, 1.114], [800.00, 1.139], [812.00, 1.164], [825.00, 1.191], [838.00, 1.217], [850.00, 1.242], [862.00, 1.266], [875.00, 1.293], [885.00, 1.315], [900.00, 1.348], [912.00, 1.376], [925.00, 1.407], [938.00, 1.440], [950.00, 1.472], [962.00, 1.506], [975.00, 1.544], [988.00, 1.584], [1000.00, 1.623], [1015.00, 1.674], [1030.00, 1.728], [1044.00, 1.780], [1060.00, 1.841], [1075.00, 1.900], [1090.00, 1.961], [1106.00, 2.028], [1120.00, 2.087], [1138.00, 2.164], [1150.00, 2.216], [1172.00, 2.312], [1180.00, 2.347], [1206.00, 2.463], [1220.00, 2.525], [1241.00, 2.619], [1250.00, 2.659], [1265.00, 2.726], [1280.00, 2.794], [1315.00, 2.951], [1320.00, 2.973], [1340.00, 3.063], [1360.00, 3.152], [1380.00, 3.241], [1400.00, 3.330], [1430.00, 3.463], [1450.00, 3.553], [1475.00, 3.664], [1500.00, 3.776], [1525.00, 3.888], [1550.00, 4.001], [1575.00, 4.115], [1600.00, 4.230], [1625.00, 4.346], [1650.00, 4.463], [1675.00, 4.582], [1700.00, 4.702], [1725.00, 4.824], [1750.00, 4.948], [1775.00, 5.074], [1800.00, 5.203], [1825.00, 5.335], [1850.00, 5.470], [1875.00, 5.608], [1900.00, 5.750], [1925.00, 5.894], [1950.00, 6.041], [1975.00, 6.190], [2000.00, 6.342], [2030.00, 6.524], [2060.00, 6.707], [2090.00, 6.888], [2120.00, 7.067], [2140.00, 7.184], [2180.00, 7.412], [2200.00, 7.522], [2240.00, 7.733], [2270.00, 7.883], [2300.00, 8.025], [2330.00, 8.159], [2360.00, 8.284], [2400.00, 8.440], [2430.00, 8.548], [2470.00, 8.681], [2500.00, 8.774], [2540.00, 8.888], [2580.00, 8.995], [2620.00, 9.095], [2650.00, 9.166], [2690.00, 9.257], [2720.00, 9.323], [2760.00, 9.407], [2800.00, 9.488], [2850.00, 9.583], [2900.00, 9.671], [2950.00, 9.749], [3000.00, 9.815], [3040.00, 9.859], [3070.00, 9.885], [3110.00, 9.911], [3150.00, 9.926], [3200.00, 9.930], [3250.00, 9.918], [3300.00, 9.891], [3350.00, 9.848], [3400.00, 9.792], [3450.00, 9.724], [3500.00, 9.645], [3550.00, 9.556], [3600.00, 9.460], [3650.00, 9.357], [3700.00, 9.248], [3750.00, 9.134], [3820.00, 8.970], [3870.00, 8.850], [3950.00, 8.654], [4000.00, 8.531], [4060.00, 8.384], [4120.00, 8.238], [4180.00, 8.093], [4250.00, 7.927], [4310.00, 7.789], [4370.00, 7.653], [4440.00, 7.500], [4500.00, 7.373], [4550.00, 7.271], [4620.00, 7.134], [4680.00, 7.021], [4750.00, 6.895], [4820.00, 6.776], [4870.00, 6.695], [4940.00, 6.588], [5000.00, 6.501], [5080.00, 6.393], [5150.00, 6.305], [5220.00, 6.223], [5300.00, 6.136], [5380.00, 6.057], [5450.00, 5.993], [5520.00, 5.935], [5600.00, 5.874], [5700.00, 5.806], [5800.00, 5.747], [5900.00, 5.697], [6000.00, 5.655], [6080.00, 5.628], [6150.00, 5.608], [6220.00, 5.591], [6300.00, 5.576], [6400.00, 5.564], [6500.00, 5.556], [6600.00, 5.555], [6700.00, 5.559], [6800.00, 5.567], [6900.00, 5.577], [7000.00, 5.590], [7100.00, 5.603], [7200.00, 5.617], [7300.00, 5.628], [7400.00, 5.635], [7500.00, 5.637], [7620.00, 5.628], [7750.00, 5.599], [7880.00, 5.548], [8000.00, 5.477], [8120.00, 5.382], [8250.00, 5.254], [8380.00, 5.104], [8500.00, 4.951], [8620.00, 4.785], [8750.00, 4.598], [8850.00, 4.449], [9000.00, 4.221], [9120.00, 4.036], [9250.00, 3.836], [9380.00, 3.634], [9500.00, 3.448], [9620.00, 3.262], [9750.00, 3.061], [9880.00, 2.860], [10000.00, 2.676], [10150.00, 2.447], [10300.00, 2.220], [10440.00, 2.010], [10600.00, 1.773], [10750.00, 1.555], [10900.00, 1.341], [11060.00, 1.118], [11200.00, 0.928], [11380.00, 0.691], [11500.00, 0.539], [11720.00, 0.272], [11800.00, 0.180], [12060.00, -0.107], [12200.00, -0.251], [12410.00, -0.455], [12500.00, -0.537], [12650.00, -0.667], [12800.00, -0.790], [13150.00, -1.056], [13200.00, -1.092], [13400.00, -1.230], [13600.00, -1.361], [13800.00, -1.488], [14000.00, -1.611], [14300.00, -1.791], [14500.00, -1.911], [14750.00, -2.061], [15000.00, -2.214], [15250.00, -2.370], [15500.00, -2.530], [15750.00, -2.694], [16000.00, -2.864], [16250.00, -3.038], [16500.00, -3.218], [16750.00, -3.402], [17000.00, -3.589], [17250.00, -3.779], [17500.00, -3.971], [17750.00, -4.163], [18000.00, -4.354], [18250.00, -4.544], [18500.00, -4.732], [18750.00, -4.917], [19000.00, -5.111], [19250.00, -5.357], [19500.00, -5.771], [19750.00, -6.453], [20000.00, -7.158]] },
            basshead: { id: 'basshead', name: 'Basshead', data: [[20.00, 86.177], [20.36, 86.214], [20.73, 86.250], [21.11, 86.286], [21.50, 86.320], [21.89, 86.354], [22.29, 86.386], [22.69, 86.417], [23.10, 86.447], [23.52, 86.476], [23.95, 86.503], [24.39, 86.529], [24.83, 86.553], [25.28, 86.576], [25.74, 86.598], [26.21, 86.618], [26.69, 86.636], [27.18, 86.653], [27.67, 86.669], [28.17, 86.683], [28.69, 86.695], [29.21, 86.706], [29.74, 86.715], [30.28, 86.723], [30.83, 86.729], [31.39, 86.733], [31.97, 86.736], [32.55, 86.736], [33.14, 86.736], [33.74, 86.733], [34.36, 86.729], [34.98, 86.723], [35.62, 86.716], [36.27, 86.708], [36.93, 86.698], [37.60, 86.687], [38.28, 86.674], [38.98, 86.660], [39.69, 86.645], [40.41, 86.629], [41.15, 86.612], [41.90, 86.594], [42.66, 86.575], [43.44, 86.554], [44.23, 86.533], [45.03, 86.511], [45.85, 86.488], [46.68, 86.464], [47.53, 86.439], [48.40, 86.413], [49.28, 86.385], [50.18, 86.357], [51.09, 86.327], [52.02, 86.296], [52.97, 86.263], [53.93, 86.229], [54.91, 86.193], [55.91, 86.155], [56.93, 86.115], [57.97, 86.074], [59.02, 86.030], [60.09, 85.984], [61.19, 85.936], [62.30, 85.887], [63.44, 85.836], [64.59, 85.782], [65.77, 85.728], [66.96, 85.672], [68.18, 85.614], [69.42, 85.556], [70.69, 85.496], [71.97, 85.435], [73.28, 85.373], [74.62, 85.310], [75.97, 85.246], [77.36, 85.181], [78.76, 85.114], [80.20, 85.047], [81.66, 84.978], [83.14, 84.908], [84.66, 84.836], [86.20, 84.764], [87.77, 84.690], [89.36, 84.615], [90.99, 84.539], [92.65, 84.461], [94.33, 84.382], [96.05, 84.301], [97.80, 84.219], [99.58, 84.135], [101.39, 84.049], [103.23, 83.962], [105.11, 83.874], [107.03, 83.785], [108.97, 83.696], [110.96, 83.606], [112.98, 83.517], [115.03, 83.427], [117.13, 83.336], [119.26, 83.244], [121.43, 83.150], [123.64, 83.053], [125.89, 82.954], [128.18, 82.852], [130.51, 82.748], [132.89, 82.643], [135.31, 82.537], [137.77, 82.429], [140.28, 82.321], [142.83, 82.212], [145.43, 82.103], [148.07, 81.991], [150.77, 81.878], [153.51, 81.764], [156.31, 81.648], [159.15, 81.530], [162.05, 81.410], [165.00, 81.287], [168.00, 81.162], [171.06, 81.033], [174.17, 80.902], [177.34, 80.768], [180.57, 80.632], [183.86, 80.494], [187.20, 80.354], [190.61, 80.213], [194.08, 80.072], [197.61, 79.931], [201.21, 79.791], [204.87, 79.652], [208.60, 79.513], [212.39, 79.376], [216.26, 79.239], [220.19, 79.103], [224.20, 78.968], [228.28, 78.834], [232.44, 78.700], [236.67, 78.567], [240.97, 78.434], [245.36, 78.300], [249.82, 78.166], [254.37, 78.032], [259.00, 77.897], [263.71, 77.762], [268.51, 77.627], [273.40, 77.493], [278.38, 77.360], [283.44, 77.228], [288.60, 77.097], [293.85, 76.968], [299.20, 76.841], [304.65, 76.717], [310.19, 76.595], [315.84, 76.477], [321.59, 76.361], [327.44, 76.248], [333.40, 76.136], [339.47, 76.026], [345.64, 75.918], [351.93, 75.810], [358.34, 75.704], [364.86, 75.598], [371.50, 75.494], [378.26, 75.392], [385.15, 75.291], [392.16, 75.193], [399.29, 75.097], [406.56, 75.005], [413.96, 74.916], [421.49, 74.829], [429.16, 74.744], [436.97, 74.662], [444.93, 74.582], [453.02, 74.506], [461.27, 74.433], [469.66, 74.364], [478.21, 74.300], [486.91, 74.241], [495.78, 74.187], [504.80, 74.137], [513.99, 74.091], [523.34, 74.048], [532.87, 74.008], [542.56, 73.971], [552.44, 73.937], [562.49, 73.906], [572.73, 73.877], [583.15, 73.851], [593.77, 73.828], [604.57, 73.810], [615.57, 73.796], [626.78, 73.786], [638.18, 73.780], [649.80, 73.779], [661.63, 73.782], [673.67, 73.789], [685.93, 73.799], [698.41, 73.814], [711.12, 73.831], [724.06, 73.853], [737.24, 73.878], [750.66, 73.906], [764.32, 73.936], [778.23, 73.969], [792.39, 74.006], [806.82, 74.045], [821.50, 74.090], [836.45, 74.140], [851.67, 74.196], [867.17, 74.259], [882.96, 74.327], [899.02, 74.402], [915.39, 74.484], [932.05, 74.574], [949.01, 74.672], [966.28, 74.779], [983.87, 74.892], [1001.77, 75.012], [1020.00, 75.137], [1038.57, 75.267], [1057.47, 75.401], [1076.71, 75.538], [1096.31, 75.679], [1116.26, 75.822], [1136.58, 75.966], [1157.26, 76.109], [1178.32, 76.250], [1199.77, 76.387], [1221.60, 76.521], [1243.84, 76.648], [1266.47, 76.769], [1289.52, 76.885], [1312.99, 76.996], [1336.89, 77.102], [1361.22, 77.203], [1385.99, 77.299], [1411.22, 77.390], [1436.90, 77.475], [1463.05, 77.557], [1489.68, 77.634], [1516.79, 77.710], [1544.40, 77.783], [1572.50, 77.854], [1601.12, 77.925], [1630.26, 77.995], [1659.93, 78.067], [1690.14, 78.142], [1720.90, 78.220], [1752.22, 78.303], [1784.11, 78.391], [1816.58, 78.485], [1849.64, 78.583], [1883.30, 78.685], [1917.58, 78.790], [1952.48, 78.897], [1988.01, 79.003], [2024.19, 79.107], [2061.03, 79.207], [2098.54, 79.302], [2136.73, 79.392], [2175.62, 79.478], [2215.22, 79.564], [2255.53, 79.652], [2296.58, 79.744], [2338.38, 79.845], [2380.94, 79.955], [2424.27, 80.074], [2468.39, 80.196], [2513.31, 80.318], [2559.05, 80.429], [2605.63, 80.527], [2653.05, 80.607], [2701.33, 80.670], [2750.50, 80.720], [2800.55, 80.764], [2851.52, 80.809], [2903.42, 80.860], [2956.26, 80.920], [3010.06, 80.987], [3064.85, 81.055], [3120.62, 81.117], [3177.42, 81.163], [3235.25, 81.184], [3294.13, 81.176], [3354.08, 81.137], [3415.12, 81.068], [3477.27, 80.975], [3540.56, 80.863], [3605.00, 80.738], [3670.60, 80.606], [3737.41, 80.470], [3805.43, 80.336], [3874.68, 80.206], [3945.20, 80.083], [4017.00, 79.969], [4090.11, 79.865], [4164.55, 79.772], [4240.34, 79.692], [4317.51, 79.624], [4396.09, 79.569], [4476.10, 79.527], [4557.56, 79.499], [4640.50, 79.485], [4724.96, 79.485], [4810.95, 79.498], [4898.51, 79.520], [4987.66, 79.545], [5078.43, 79.565], [5170.86, 79.568], [5264.97, 79.542], [5360.79, 79.480], [5458.35, 79.377], [5557.69, 79.234], [5658.84, 79.064], [5761.82, 78.884], [5866.69, 78.715], [5973.46, 78.575], [6082.17, 78.474], [6192.87, 78.415], [6305.57, 78.391], [6420.33, 78.397], [6537.18, 78.430], [6656.15, 78.495], [6777.29, 78.605], [6900.63, 78.779], [7026.22, 79.035], [7154.10, 79.382], [7284.30, 79.814], [7416.87, 80.304], [7551.85, 80.801], [7689.29, 81.234], [7829.23, 81.522], [7971.72, 81.596], [8116.80, 81.418], [8264.53, 80.996], [8414.94, 80.374], [8568.09, 79.619], [8724.02, 78.792], [8882.79, 77.936], [9044.46, 77.071], [9209.06, 76.201], [9376.66, 75.323], [9547.31, 74.432], [9721.07, 73.532], [9897.99, 72.633], [10078.13, 71.756], [10261.55, 70.928], [10448.30, 70.181], [10638.45, 69.547], [10832.07, 69.051], [11029.21, 68.709], [11229.94, 68.519], [11434.32, 68.466], [11642.41, 68.523], [11854.30, 68.652], [12070.04, 68.807], [12289.71, 68.941], [12513.38, 69.008], [12741.12, 68.975], [12973.00, 68.830], [13209.10, 68.584], [13449.50, 68.277], [13694.28, 67.964], [13943.51, 67.711], [14197.27, 67.583], [14455.66, 67.629], [14718.74, 67.864], [14986.62, 68.243], [15259.37, 68.652], [15537.08, 68.933], [15819.85, 68.925], [16107.76, 68.530], [16400.92, 67.744], [16699.41, 66.647], [17003.33, 65.345], [17312.78, 63.920], [17627.86, 62.422], [17948.68, 60.886], [18275.34, 59.353], [18607.94, 57.873], [18946.60, 56.470], [19291.42, 55.135], [19642.52, 53.839], [20000.00, 52.551]] },
        },
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

            box.innerHTML = suggestions.map(s => `
                <span class="spec-icon-badge" style="width:auto !important; height:24px !important; padding:0 8px; font-size:11px !important; font-weight:800; background:var(--bg-input); border:2px solid #000;" data-tooltip="Search: click to insert" onmousedown="event.preventDefault(); document.getElementById('peqdb-search').value='${escJs(s)}'; document.getElementById('peqdb-search').dispatchEvent(new Event('input')); document.getElementById('peqdb-search-suggestions').classList.add('hidden');">${esc(s)}</span>
            `).join('');
            box.classList.remove('hidden');
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
                PEQDB_Module.databaseFullyLoaded = true;
                localStorage.setItem('squig_db_indexed', 'true');
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
this.setAlignHz(savedHz || 'mean');
this.setAlignDb(savedDb ? parseFloat(savedDb) : 75.0);

            this.initSimilarityWorker();

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

            this.DATA.init();
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
            const brandSlug = brandName.replace(/[^a-zA-Z0-9]/g, '_');
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
        toggleItemDrawer: function(itemId) {
            const list = document.getElementById('peqdb-list');
            if (!list) return;

            let row = null;
            try {
                row = list.querySelector(`[data-id="${CSS.escape(itemId)}"]`);
            } catch(e) {
                const all = list.querySelectorAll('.peqdb-row-item');
                for (let i = 0; i < all.length; i++) {
                    if (all[i].getAttribute('data-id') === itemId) { row = all[i]; break; }
                }
            }

            const item = this.STATE.dataset.find(i => i.id === itemId);
            if (!row || !item) return;

            const drawer = row.querySelector('.nested-sources-drawer');
            const toggleBtn = row.querySelector('.drawer-toggle-btn');

            if (this.expandedItemDrawers.has(itemId)) {
                this.expandedItemDrawers.delete(itemId);
                if (drawer) drawer.classList.add('hidden');
                if (toggleBtn) toggleBtn.textContent = '▼';
            } else {
                this.expandedItemDrawers.add(itemId);
                if (drawer) drawer.classList.remove('hidden');
                if (toggleBtn) toggleBtn.textContent = '▲';

                setTimeout(() => {
                    if (drawer) {
                        const subMarquees = drawer.querySelectorAll('.sub-marquee-text');
                        subMarquees.forEach(el => {
                            if (el && el.parentElement && el.parentElement.clientWidth > 0) {
                                const pW = el.parentElement.clientWidth;
                                const cW = el.scrollWidth;
                                if (cW > pW) {
                                    const dist = -(cW - pW + 12);
                                    el.style.setProperty('--scroll-dist', `${dist}px`);
                                    el.classList.add('marquee-active');
                                }
                            }
                        });
                    }
                }, 50);
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
        _updateAllImmediate: function() {
            if (EQ_Module.isDragging) { EQ_Module.drawCurve(); return; }
            this.updateAllRowSelectionUIs();
            EQ_Module.drawCurve();
            this.renderActiveCurvesDock();
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

            const brandCounts = new Map();
            PEQDB_Module.STATE.renderList.forEach(item => {
                const bk = item.brand || 'Unknown Brand';
                brandCounts.set(bk, (brandCounts.get(bk) || 0) + 1);
            });

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
                    ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:9px;">$${item.price_usd}</span></span>` : ''}
                    ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:9px;">${item.year}</span></span>` : ''}
                    ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${driverTooltip}">${driverEmoji}</span>` : ''}
                    ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${item.connector}">${connectorEmoji}</span>` : ''}
                    <span class="spec-icon-badge" data-tooltip="${item.form_factor || 'In-Ear Monitor (IEM)'}">${formEmoji}</span>
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
                const tagsHtml = (item.tags || []).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${getTagEmoji(t)}</span>`).join('');

                let fileRowHtml;
                if (isMulti) {
                    fileRowHtml = `
                        <div class="flex items-center gap-1.5 mt-1">
                            <button onclick="event.stopPropagation(); PEQDB_Module.cycleDbItemSource('${escJs(item.id)}', -1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">◀</button>
                            <div class="flex-1 min-w-0 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                                <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                            </div>
                            <button onclick="event.stopPropagation(); PEQDB_Module.cycleDbItemSource('${escJs(item.id)}', 1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">▶</button>
                        </div>
                    `;
                } else {
                    fileRowHtml = `
                        <div class="mt-1 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
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
                    <div class="text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
                    <div class="flex flex-wrap items-center justify-center gap-1 mt-1">${specIconsHtml}</div>
                    ${tagsHtml ? `<div class="flex flex-wrap items-center justify-center gap-1 mt-1">${tagsHtml}</div>` : ''}
                    ${fileRowHtml}
                `;
                return div;
            };

            for (const [brandName, items] of brandBuckets) {
                const brandSlug = brandName.replace(/[^a-zA-Z0-9]/g, '_');

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
                        <div class="flex items-center justify-between p-2 cursor-pointer select-none border-2 border-black rounded" style="background: var(--bg-input);" onclick="PEQDB_Module.toggleBrandGroup('${escJs(brandName)}')">
                            <span class="text-xs font-black uppercase tracking-wider text-[var(--accent-blue)]">${esc(brandName)}</span>
                            <span class="flex items-center gap-1.5 flex-shrink-0">
                                <span class="text-[9px] font-black text-zinc-500">${this._brandCounts.get(brandName) || 0}</span>
                                <span class="brand-group-arrow text-[10px] font-black text-[var(--text-secondary)]">${isExpanded ? '▲' : '▼'}</span>
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

            const activeIndex = this.STATE.activeCurves.findIndex(c => c.uid === curveUid || (item.files.length <= 1 && c.id === id));
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
            }

            this.updateRowSelectionUI(id);
            EQ_Module.drawCurve();
            this.renderActiveCurvesDock();
            // Keep the Similar tab's LOAD/role badges in sync when a curve is
            // toggled while Similar mode is open.
            if (this.searchMode === 'similar' && this._lastSimilarGroups) {
                this.renderSimilarList(this._lastSimilarGroups, this._lastSimilarRefName || '');
            }
        },
        setTarget: function(val) {
            this.STATE.activeCurves = this.STATE.activeCurves.filter(c => c.role !== 'target');
            this.targetMode = val;

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
            if (EQ_Module.virtualFilters) {
                EQ_Module.virtualFilters.forEach(f => {
                    setAudioParamSmooth(f.gain, 0);
                });
            }

            EQ_Module.isProgrammaticSliderUpdate = false;

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
                    optimizedBands.push({ freq: b.hz, q: b.q !== undefined ? b.q : b.defaultQ, type: 'peaking', gain: 0.0, role: 'adv', index: i });
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
            if (EQ_Module.virtualFilters) {
                EQ_Module.virtualFilters.forEach(f => {
                    setAudioParamSmooth(f.gain, 0);
                });
            }

            EQ_Module.isProgrammaticSliderUpdate = true;

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

                        if (EQ_Module.virtualFilters && EQ_Module.virtualFilters[virtIdx]) {
                            const f = EQ_Module.virtualFilters[virtIdx];
                            setAudioParamSmooth(f.frequency, b.freq);
                            setAudioParamSmooth(f.gain, EQ_Module.eqEnabled ? b.gain : 0);
                            setAudioParamSmooth(f.Q, b.q);
                        }
                    }
                });
                EQ_Module.virtualBands = virtuals;
            }

            EQ_Module.isProgrammaticSliderUpdate = false;
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

                        clearState: function() {
            this.STATE.activeCurves = [];
            this.targetMode = '';
            this.activeSculptIndex = -1;
            this.hoverSculptIndex = -1;
            EQ_Module.isTuningLabActive = false;
            EQ_Module.graphFocus = 'eq';
            var overlay = document.getElementById('graph-focus-selector');
            if (overlay) overlay.classList.add('hidden');
            var editBtn = document.getElementById('target-edit-btn');
            if (editBtn) { editBtn.classList.remove('active-btn', 'active-yellow'); editBtn.innerHTML = '✏️'; }
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
                const esc = (str) => String(str||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
                item.setAttribute('draggable','true');
                item.addEventListener('dragstart', (e)=>this.handleDragStart(e,c.uid));
                item.className = "w-[190px] h-[118px] p-2 flex flex-col justify-between relative select-none cursor-grab active:cursor-grabbing transition-all hover:scale-[1.01] flex-shrink-0";
                item.style.cssText = `background: rgba(${r},${g},${b},0.28) !important;border:2px solid rgba(${r},${g},${b},0.95) !important;`;
                item.style.boxShadow = `2px 2px 0px 0px rgba(0,0,0,0.8)`;
                item.setAttribute('data-uid', c.uid);
                item.title = "Drag to Base / Target / Reference slot to change role";
                const roleLabel = c.role==='base'?'BASE':(c.role==='target'?'TARGET':'REF');
                item.innerHTML = `<div class="flex items-center justify-between w-full h-6 select-none" draggable="false"><span class="px-2 py-0.5 rounded text-[8.5px] font-black tracking-wider text-white uppercase bg-black/60 border border-white/10 flex-shrink-0" title="Drag to rearrange" draggable="false">${roleLabel}</span><div class="flex items-center gap-1.5" draggable="false"><button onclick="PEQDB_Module.toggleVisible(this.closest('[data-uid]').dataset.uid)" class="w-6 h-6 rounded bg-black/50 hover:bg-black/80 text-white text-[11px] flex items-center justify-center border border-white/10 cursor-pointer" title="Show or hide this curve" draggable="false">${c.visible?'👁️':'🙈'}</button><button onclick="PEQDB_Module.cycleColor(this.closest('[data-uid]').dataset.uid)" class="w-5 h-5 rounded-full border-2 border-white shadow-md flex items-center justify-center cursor-pointer hover:scale-110 transition-transform" style="background-color:${c.color}" title="Change this curve's color" draggable="false"></button><button onclick="PEQDB_Module.removeCurve(this.closest('[data-uid]').dataset.uid)" class="w-6 h-6 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 font-black text-[11px] flex items-center justify-center cursor-pointer" title="Remove this curve" draggable="false">✕</button></div></div><div onclick="PEQDB_Module.renameCurve(this.closest('[data-uid]').dataset.uid)" class="flex-1 flex items-center justify-center overflow-hidden cursor-pointer w-full px-1.5 py-0.5" draggable="false"><div class="w-full overflow-hidden whitespace-nowrap flex justify-center items-center pointer-events-none"><span id="marquee-${c.uid}" class="text-black font-black text-xs tracking-wide inline-block whitespace-nowrap">${esc(c.name)}</span></div></div><div class="flex justify-between items-center w-full h-6" draggable="false"><div class="flex items-center gap-1.5 h-6 decibel-stepper flex-shrink-0 select-none" style="width:110px !important;min-width:110px !important;max-width:110px !important;" draggable="false"><button type="button" onclick="event.stopPropagation();PEQDB_Module.adjustCurveOffset(this.closest('[data-uid]').dataset.uid,-1)" class="w-6 h-6 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0" title="Move the curve down 1 dB" draggable="false">◄</button><button type="button" onclick="event.stopPropagation();" class="flex-1 h-6 bg-[var(--bg-input)] border-2 border-black text-[#c85a0e] font-mono font-black text-[9px] flex items-center justify-center text-center cursor-default select-none focus:outline-none px-0 min-w-0" draggable="false">${(c.offset||0)>=0?'+':''}${c.offset||0}dB</button><button type="button" onclick="event.stopPropagation();PEQDB_Module.adjustCurveOffset(this.closest('[data-uid]').dataset.uid,1)" class="w-6 h-6 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0" title="Move the curve up 1 dB" draggable="false">►</button></div><div class="flex items-center gap-1.5" draggable="false"><button onclick="PEQDB_Module.exportCurveByUid(this.closest('[data-uid]').dataset.uid)" class="w-6 h-6 rounded bg-black/50 hover:bg-black/80 border border-white/10 text-white text-[10px] flex items-center justify-center cursor-pointer" title="Export this curve as a text file" draggable="false">📥</button><button onclick="PEQDB_Module.findMatchesFromDock(this.closest('[data-uid]').dataset.uid)" class="w-6 h-6 rounded bg-black/50 hover:bg-black/80 border border-white/10 text-white text-[10px] flex items-center justify-center cursor-pointer" title="Find similar curves" draggable="false">🔍</button></div></div>`;
                if (c.role==='base') { baseSlot.appendChild(item); baseCount++; }
                else if (c.role==='target') { targetSlot.appendChild(item); targetCount++; }
                else { referencePile.appendChild(item); refCount++; }
            });
            if (baseCount===0) { baseSlot.innerHTML='<div class="text-center text-[10px] leading-normal text-zinc-600 px-3 select-none pointer-events-none">📥 Drag or click curve<br>to set as <span class="text-amber-500 font-bold">Base</span></div>'; }
            if (targetCount===0) { targetSlot.innerHTML='<div class="text-center text-[10px] leading-normal text-zinc-600 px-3 select-none pointer-events-none">🎯 Drag or click curve<br>to set as <span class="text-blue-500 font-bold">Target</span></div>'; }
            if (refCount===0) { referencePile.innerHTML='<div class="text-center text-[10px] leading-normal text-zinc-650 px-3 w-full select-none pointer-events-none">Empty Reference Pile<br><span class="text-[9px] opacity-80">(Compare overlays)</span></div>'; }
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
        cycleRole: function(uid) {
            const c = this.STATE.activeCurves.find(item => item.uid === uid);
            if (!c) return;
            const roles = ['base', 'target', 'reference'];
            const idx = roles.indexOf(c.role);
            c.role = roles[(idx + 1) % roles.length];
            this.updateAll();
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

        renderActiveCurveCards: function() {
            this.renderActiveCurvesDock();
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

            if (bassBoost > 3 && trebleBoost > 3 && mids < midReference - 1) tags.push('🔺 V-Shape');

            if (bassBoost > 2 && trebleBoost > 2 && Math.abs(mids - midReference) < 2) tags.push('🪞 U-Shape');

            if (Math.abs(bassBoost) < 2 && Math.abs(trebleBoost) < 2 && Math.abs(upperMidPresence) < 2.5) {
                tags.push('⚖️ Neutral');
            }

            if (trebleBoost > 4) tags.push('✨ Bright');
            else if (trebleBoost > 2) tags.push('💎 Detailed');

            if (trebleBoost < -3) tags.push('🌑 Dark');
            else if (trebleBoost < -1.5) tags.push('😌 Relaxed Treble');

            if (upperMidPresence > 3) tags.push('🎤 Vocal Forward');

            const presenceBoost = presence - midReference;
            if (Math.abs(upperMidPresence) < 2 && presenceBoost > 2) tags.push('🔬 Analytical');

            if (bassBoost > 1.5 && trebleBoost < 0 && Math.abs(upperMidPresence) < 3) tags.push('🎵 Musical');

            const pinnaRegion = (getDbAt(2000) + getDbAt(2500) + getDbAt(3000) + getDbAt(3500)) / 4;
            const pinnaSharpness = pinnaRegion - ((mids + presence) / 2);
            if (pinnaSharpness > 4) tags.push('🎯 BA Timbre');

            if (air > treble - 2 && air > midReference - 2) tags.push('🧲 Extended Air');

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
generateDynamicFallbackCurve: function(name) {
            const freqs = [20, 30, 45, 70, 100, 150, 250, 350, 500, 700, 1000, 1500, 2200, 3000, 4000, 5500, 7000, 8500, 10000, 13000, 16000, 20000];
            const curve = [];
            let seed = 0;
            for (let i = 0; i < name.length; i++) seed += name.charCodeAt(i);

            const bassBoost = 5 + (seed % 8);
            const pinnaPeak = 7 + (seed % 6);
            const trebleDip = 1 + (seed % 4);

            freqs.forEach(f => {
                let db = 0;
                if (f <= 150) {
                    const factor = (150 - f) / 130;
                    db = 68.0 + bassBoost * Math.pow(factor, 1.5);
                } else if (f <= 500) {
                    const factor = (f - 150) / 350;
                    db = 68.0 + bassBoost * 0.1 * (1.0 - factor);
                } else if (f <= 1000) {
                    db = 68.0;
                } else if (f <= 3000) {
                    const factor = (f - 1000) / 2000;
                    db = 68.0 + pinnaPeak * Math.pow(factor, 1.8);
                } else if (f <= 6000) {
                    const factor = (f - 3000) / 3000;
                    db = (68.0 + pinnaPeak) - ((68.0 + pinnaPeak) - 71.0) * factor;
                } else if (f <= 8500) {
                    const factor = Math.abs(f - 8000) / 2000;
                    db = (68.0 + pinnaPeak) - 2.0 - trebleDip - 5.0 * factor;
                } else {
                    const factor = (f - 8500) / 11500;
                    db = 72.0 * (1.0 - factor) + 60.0 * factor;
                }
                curve.push([f, db]);
            });
            return curve;
        },

        // (duplicate toggleTargetSculptor definition removed � it shadowed the
        // identical copy above and only invited drift)

        getNormalizedData: function(raw_data, curveName) {
            let data = this.standardizeCurveData(raw_data);

            if (!data || data.length === 0) {
                data = this.generateDynamicFallbackCurve(curveName || "Target");
            }

            const ref_db = this.getRefDb(data);
            return data.map(item => [item[0], item[1] - ref_db + this.alignDb]);
        },

        exportCurve: function(id) {
            const item = this.STATE.dataset.find(i => i.id === id); if(!item) return;
            let out = `Frequency\tAmplitude\n`; item.data.forEach(pt => out += `${pt[0].toFixed(2)}\t${pt[1].toFixed(2)}\n`);
            EQ_Module.triggerDownload(`${item.name.replace(/\s+/g,'_')}.txt`, out);
        },
        importCurve: function(e) {
            const file = e.target.files[0]; if(!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const rawText = ev.target.result;
                const lines = rawText.split(/\r?\n/);
                const data = [];

                let commaIsDecimal = false;
                for (let i = 0; i < Math.min(100, lines.length); i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('#') || line.startsWith('*') || line.startsWith('//')) continue;
                    if ((line.includes('\t') || line.includes(';')) && line.includes(',')) {
                        commaIsDecimal = true;
                        break;
                    }
                }

                lines.forEach(line => {
                    let cleanLine = line.trim();

                    if (cleanLine.startsWith('#') || cleanLine.startsWith('*') || cleanLine.startsWith('//')) return;

                    let parts = [];
                    if (commaIsDecimal) {

                        cleanLine = cleanLine.replace(/,/g, '.');
                        parts = cleanLine.split(/[\t;\s]+/);
                    } else {

                        parts = cleanLine.split(/[\s,;\t]+/);
                    }

                    parts = parts.filter(p => p.length > 0);

                    if (parts.length >= 2) {
                        const f = parseFloat(parts[0]);
                        const a = parseFloat(parts[1]);
                        if (!isNaN(f) && !isNaN(a)) {

                            if (f >= 1 && f <= 24000) {
                                data.push([f, a]);
                            }
                        }
                    }
                });

                if (data.length > 0) {
                    data.sort((a,b) => a[0] - b[0]);
                    const id = 'imported_' + Date.now();
                    const cleanName = file.name.replace(/\.[^/.]+$/, "").replace("omega", "Ω");
                    const newItem = {
                        id,
                        name: cleanName,
                        variant: 'Imported',
                        source: 'Local File',
                        searchKey: file.name.toLowerCase(),
                        data
                    };
                    PEQDB_Module.STATE.dataset.unshift(newItem);
                    PEQDB_Module.STATE.renderList.unshift(newItem);
                    PEQDB_Module.renderList();
                    PEQDB_Module.toggleCurveSelection(id);
                    showToast(`Trace "${cleanName}" imported successfully.`, "📥");
                } else {
                    showToast("Failed to parse coordinates from target trace.", "⚠️");
                }
            };
            reader.readAsText(file); e.target.value = '';
        },

        precalculateInterps: function() {
            if (!this.STATE.dataset) return;
            this.STATE.dataset.forEach(item => {
                if (item.cachedInterp) return;
                if (!item.data) return;
                try {
                    const norm = this.getNormalizedData(item.data, item.name);
                    item.cachedInterp = Array.from(this.DSP.interpolate(norm));
                } catch(e) {
                    item.cachedInterp = null;
                }
            });
            this.STATE.lightweightDataset = this.STATE.dataset.map(item => ({
                id: item.id,
                name: item.name,
                variant: item.variant,
                source: item.source,
                cachedInterp: item.cachedInterp
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

        normBrandKey: function(brand) {
            return String(brand || 'Unknown Brand').toLowerCase().replace(/[^a-z0-9]+/g, '');
        },

        getFuzzyBaseName: function(name) {
            if (!name) return "";
            let clean = name.toLowerCase();
            clean = clean.replace(/\bzero\s+ii\b/gi, 'zero 2');
            clean = clean.replace(/\bii\b/gi, '2');
            clean = clean.replace(/\s*\(.*?\)/g, '');
            clean = clean.replace(/\s*\[.*?\]/g, '');
            clean = clean.replace(/\s+by\s+\w+/gi, '');
            clean = clean.trim().replace(/\s+/g, ' ');
            return clean;
        },

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
            toggleSearchMode: function(mode) {
                this.setSearchMode(mode || 'database');
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
                if (sim) sim.classList.toggle('active', this.searchMode === 'similar');
                if (db) db.classList.toggle('active', this.searchMode !== 'similar');
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

                let baselineInterp = null;
                const activeBase = this.STATE.activeCurves.find(c => c.role === 'base');
                if (activeBase) {
                    baselineInterp = this.DSP.interpolate(this.getNormalizedData(activeBase.data, activeBase.name));
                }

                for (let i = 0; i < points; i++) {
                    composite[i] = (baselineInterp ? baselineInterp[i] : 80.0) + realValues.preVal;
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
            const lightweightDs = [];
            const fullDs = this.STATE.dataset || [];
            for (let i = 0; i < fullDs.length; i++) {
                const item = fullDs[i];
                if (!item.cachedInterp) {
                    if (item.data) {
                        try {
                            const norm = this.getNormalizedData(item.data, item.name);
                            item.cachedInterp = Array.from(this.DSP.interpolate(norm));
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
                    return `<span class="text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded text-white flex-shrink-0" style="background-color: ${loadedCurve.color}">${loadedCurve.role.toUpperCase()}</span>`;
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
                filterHtml += '<button type="button" onclick="PEQDB_Module.toggleSimilarFormFactor(\'' + f.key + '\')" class="no-tactile find-pick-badge' + (isActive ? ' on' : '') + '" data-tooltip="' + f.label + '" title="' + f.label + '" aria-pressed="' + isActive + '">';
                filterHtml += '<img src="' + f.icon + '" alt="' + f.label + '" draggable="false">';
                filterHtml += '</button>';
            });
            filterHtml += '</div>';

            let html = '<div class="text-[9px] text-zinc-555 font-bold uppercase tracking-wider mb-2 border-b border-[var(--border-color)] pb-1 flex justify-between items-center mr-3 select-none">' +
                '<span>Matches for:</span>' +
                '<span class="text-[var(--accent-amber)] truncate max-w-[130px]" title="' + esc(refName) + '">' + esc(refName) + '</span>' +
                '</div>' + filterHtml;

            if (filteredMatches.length === 0) {
                html += '<div class="text-zinc-500 text-[11px] italic text-center mt-8 p-4 border border-dashed border-zinc-800 rounded">' +
                    (anySelected ? 'No matches for selected form factors.<br><span class="text-[10px]">Try enabling more filters.</span>' : '&#9889; 0 matches &mdash; adjust the DSP curve to find similar IEMs.') +
                    '</div>';
            } else {
                filteredMatches.forEach((match, idx) => {
                    const rank = idx + 1;
                    const fullItem = datasetById ? (datasetById.get(match.id) || match) : match;
                    html += this.buildDbModelCard(fullItem, {
                        rank,
                        similarity: match.similarity,
                        badgeHtml: badgeFor(match)
                    }).outerHTML;
                });
            }

            list.innerHTML = html;
            this.lastSimilarHTML = list.innerHTML;

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
                                    return `<span class="text-[8px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded text-white flex-shrink-0" style="background-color: ${loadedCurve.color}">${loadedCurve.role.toUpperCase()}</span>`;
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
        loadSimilarItem: function(id) {
            this.toggleCurveSelection(id);
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
                ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:9px;">$${esc(item.price_usd)}</span></span>` : ''}
                ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:9px;">${esc(item.year)}</span></span>` : ''}
                ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${esc(item.connector)}">${connectorEmoji}</span>` : ''}
                <span class="spec-icon-badge" data-tooltip="${esc(item.form_factor || 'In-Ear Monitor (IEM)')}">${formEmoji}</span>
            `;

            const tagsHtml = (item.tags || []).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${FindEngine.getTagEmoji(t)}</span>`).join('');

            let fileRowHtml;
            if (isMulti) {
                fileRowHtml = `
                    <div class="flex items-center gap-1.5 mt-1">
                        <button onclick="event.stopPropagation(); PEQDB_Module.cycleDbItemSource('${escJs(item.id)}', -1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">◀</button>
                        <div class="flex-1 min-w-0 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                        </div>
                        <button onclick="event.stopPropagation(); PEQDB_Module.cycleDbItemSource('${escJs(item.id)}', 1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isLoaded ? '#fff' : 'var(--text-secondary)'};">▶</button>
                    </div>
                `;
            } else {
                fileRowHtml = `
                    <div class="mt-1 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                        <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isLoaded ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
                    </div>
                `;
            }

            const similarHeader = similarInfo ? `
                <div class="flex items-center justify-between gap-2 mb-1.5 border-b border-white/[0.05] pb-1.5">
                    <span class="text-[9px] font-mono text-[var(--text-secondary)]">#${similarInfo.rank}</span>
                    <span class="flex items-center gap-1.5">
                        <span class="text-[11px] font-black text-[var(--accent-green)]">${similarInfo.similarity.toFixed(1)}%</span>
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
            // click-to-load handler MUST be a real onclick="" attribute, not a
            // JS property (div.onclick = ...) — property handlers are
            // invisible to .outerHTML and get silently dropped once the
            // markup is re-parsed from the string.
            div.setAttribute('onclick', `PEQDB_Module.toggleCurveSelection('${escJs(item.id)}', ${activeFileIdx})`);
            div.innerHTML = similarHeader + `
                <div class="db-title-row overflow-hidden whitespace-nowrap">
                    <span class="db-title-text font-black text-stone-200 text-xs inline-block whitespace-nowrap">${esc(item.name)}</span>
                </div>
                <div class="text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
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
        exportCurrentTarget: function() {
            const target = this.STATE.activeCurves.find(c => c.role === 'target' && c.visible);
            if (!target) {
                showToast("Activate a Target curve on the viewport to export.", "⚠️");
                return;
            }
            let out = `Frequency\tAmplitude\n`;
            const norm = this.getNormalizedData(target.data, target.name);
            norm.forEach(pt => out += `${pt[0].toFixed(2)}\t${pt[1].toFixed(2)}\n`);
            EQ_Module.triggerDownload(`${target.name.replace(/\s+/g,'_')}_target.txt`, out);
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

            const magRes = new Float32Array(points);
            const phaseRes = new Float32Array(points);

            EQ_Module.bands.forEach((b, i) => {
                const fNode = EQ_Module.mathFilters[i];
                fNode.type = b.type || 'peaking';
                fNode.frequency.value = parseFloat(document.getElementById("eq-f" + i)?.value || b.hz);
                fNode.gain.value = parseFloat(document.getElementById("eq-s" + i)?.value || 0);
                fNode.Q.value = parseFloat(document.getElementById("eq-q_m" + i)?.value || b.defaultQ);

                fNode.getFrequencyResponse(freqs, magRes, phaseRes);
                for (let j = 0; j < points; j++) {
                    composite[j] += 20 * Math.log10(Math.max(1e-10, magRes[j]));
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

