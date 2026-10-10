// PEQDB Smart RF import: paste or drop FR text and files and turn them into curves.
// Split out of peqdb-module.js; merged into PEQDB_Module via Object.assign there.
const PEQDB_SmartRFMethods = {
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
                    importBtn.className = "py-2 text-[10px] font-bold bg-[var(--accent-blue)] text-white hover:brightness-110 transition-all text-center cursor-pointer";
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
                    importBtn.className = "py-2 text-[10px] font-bold bg-zinc-800 text-zinc-500 cursor-not-allowed transition-all text-center";
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
};
