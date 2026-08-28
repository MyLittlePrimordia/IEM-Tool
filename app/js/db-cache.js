// Split out of the former monolithic app-core.js (2026 refactor).
// DBCache: small in-memory cache used when browsing/searching the database.
    Object.assign(EQ_Module, EQ_ExportMethods);
    Object.assign(EQ_Module, EQ_PlaylistMethods);

    const origToggleShuffle = EQ_Module.toggleShuffle;
    EQ_Module.toggleShuffle = function() {
        if (origToggleShuffle) origToggleShuffle.call(this);
        else this.shuffleActive = !this.shuffleActive;
        ['playlist-shuffle-btn', 'mobile-shuffle-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('is-on', !!this.shuffleActive);
        });
    };

    const origToggleRepeat = EQ_Module.toggleRepeat;
    EQ_Module.toggleRepeat = function() {
        if (origToggleRepeat) origToggleRepeat.call(this);
        else this.repeatActive = !this.repeatActive;
        ['playlist-repeat-btn', 'mobile-repeat-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('is-on', !!this.repeatActive);
        });
    };

    Object.assign(EQ_Module, EQ_ReverbMethods);
    Object.assign(EQ_Module, EQ_CrossfeedMethods);
    Object.assign(EQ_Module, EQ_CrossoverMethods);
    Object.assign(EQ_Module, EQ_DynamicsMethods);
    Object.assign(EQ_Module, EQ_LoudnessMethods);
    Object.assign(EQ_Module, EQ_TempoMethods);
    Object.assign(EQ_Module, EQ_SmartImportMethods);
    Object.assign(EQ_Module, EQ_HearingCalMethods);
    Object.assign(EQ_Module, EQ_VizFullscreenMethods);
    Object.assign(EQ_Module, EQ_SourceSimMethods);
    Object.assign(EQ_Module, EQ_PresetMethods);
    Object.assign(EQ_Module, EQ_BandHandlerMethods);
    Object.assign(EQ_Module, EQ_DrawCurveMethods);
    // Coalesce redundant redraws onto a single requestAnimationFrame. The offline
    // magnitude path below is dirty-flagged per slider `input`, so during a drag a
    // full DSP+redraw can fire more often than the screen can show; batching to one
    // draw per frame removes per-event jank while keeping updates latency-free.
    {
        const _drawCurve = EQ_Module.drawCurve || function () {};
        let _pending = false;
        EQ_Module.drawCurve = function () {
            const self = this;
            if (!_pending) {
                _pending = true;
                requestAnimationFrame(() => {
                    _pending = false;
                    _drawCurve.apply(self, arguments);
                });
            }
        };
    }
    Object.assign(EQ_Module, EQ_SquigGraphMethods);
    Object.assign(EQ_Module, EQ_MathUtilMethods);

const DBCache = {
            DB_NAME: "squig_database_cache",
            DB_VERSION: 3,
                STORE_NAME: "processed_curves",
                db: null,
                init: function() {
                    return new Promise((resolve) => {
                        let resolved = false;
                        const safeResolve = (val) => {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeoutId);
                                resolve(val);
                            }
                        };

                        const timeoutId = setTimeout(() => {
                            console.warn("[IndexedDB] Initialization timed out. Falling back to memory-only mode.");
                            safeResolve(false);
                        }, 2000);

                        try {
                            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                            req.onblocked = () => {
                                console.warn("[IndexedDB] Database open blocked by another tab.");
                                safeResolve(false);
                            };

                            req.onupgradeneeded = (e) => {
                                try {
                                    const db = e.target.result;
                                    if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                                        db.createObjectStore(this.STORE_NAME, { keyPath: "id" });
                                    }
                                    if (!db.objectStoreNames.contains("iem_reviews")) {
                                        db.createObjectStore("iem_reviews", { keyPath: "id" });
                                    }
                                } catch (upgradeErr) {
                                    console.error("[IndexedDB] Upgrade error:", upgradeErr);
                                }
                            };

                            req.onsuccess = async (e) => {
                                try {
                                    this.db = e.target.result;
                                    await PEQDB_Module.migrateLegacyReviews();
                                    safeResolve(true);
                                } catch (successErr) {
                                    console.error("[IndexedDB] Success handler error:", successErr);
                                    safeResolve(false);
                                }
                            };

                            req.onerror = (err) => {
                                console.error("[IndexedDB] Open error:", err);
                                safeResolve(false);
                            };
                        } catch (openErr) {
                            console.error("[IndexedDB] Sync exception during open:", openErr);
                            safeResolve(false);
                        }
                    });
                },

            getReview: function(id) {
                return new Promise((resolve) => {
                    if (!this.db) return resolve(null);
                    try {
                        const tx = this.db.transaction("iem_reviews", "readonly");
                        const store = tx.objectStore("iem_reviews");
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result || null);
                        req.onerror = () => resolve(null);
                    } catch(e) { resolve(null); }
                });
            },
            saveReview: function(profile) {
                return new Promise((resolve) => {
                    if (!this.db) return resolve(false);
                    try {
                        const tx = this.db.transaction("iem_reviews", "readwrite");
                        const store = tx.objectStore("iem_reviews");
                        const req = store.put(profile);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch(e) { resolve(false); }
                });
            },
            deleteReview: function(id) {
                return new Promise((resolve) => {
                    if (!this.db) return resolve(false);
                    try {
                        const tx = this.db.transaction("iem_reviews", "readwrite");
                        const store = tx.objectStore("iem_reviews");
                        const req = store.delete(id);
                        req.onsuccess = () => resolve(true);
                        req.onerror = () => resolve(false);
                    } catch(e) { resolve(false); }
                });
            },
            getAllReviews: function() {
                return new Promise((resolve) => {
                    if (!this.db) return resolve([]);
                    try {
                        const tx = this.db.transaction("iem_reviews", "readonly");
                        const store = tx.objectStore("iem_reviews");
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => resolve([]);
                    } catch(e) { resolve([]); }
                });
            }
            };
