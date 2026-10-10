// PEQDB curve alignment: reference level, alignment centre and amplitude cycling.
// Split out of peqdb-module.js; merged into PEQDB_Module via Object.assign there.
const PEQDB_AlignmentMethods = {
        // (initSimilarityWorker deleted — the blob worker was never posted to
        // and its onmessage path was unreachable; all similarity results flow
        // through computeSimilarityScores inline in findSimilarCurves.)

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

            // Version-stamp instead of bulk-null: walking the whole dataset
            // (10k+ items) and clearing every cachedInterp here cost ~100ms+
            // per alignment toggle and thrashed GC. The cache entries now
            // carry the alignment version they were computed under, and
            // consumers (findSimilarCurves / precalculateInterps) recompute
            // lazily only the entries they actually touch.
            this._alignmentVersion = (this._alignmentVersion || 0) + 1;
            this.STATE.lightweightDataset = null;

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
};
