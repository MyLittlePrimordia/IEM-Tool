const EQ_SmartImportMethods = {
    parsedEQData: null,
            showSmartImportModal: function() {
            var modal = document.getElementById('smart-import-modal');
            if (modal) { modal.classList.remove('hidden'); Mascot.update(); }
            var textarea = document.getElementById('smart-import-textarea');
            if (textarea) { textarea.value = ''; setTimeout(function() { textarea.focus(); }, 50); }
            var dz = document.getElementById('smart-import-dropzone');
            if (dz && !dz._init) {
                dz._init = true;
                ['dragenter', 'dragover'].forEach(function(ev) {
                    dz.addEventListener(ev, function(e) { e.preventDefault(); dz.style.borderColor = 'var(--accent-blue)'; });
                });
                ['dragleave', 'drop'].forEach(function(ev) {
                    dz.addEventListener(ev, function(e) { e.preventDefault(); dz.style.borderColor = ''; });
                });
                dz.addEventListener('drop', function(e) {
                    var files = e.dataTransfer.files;
                    if (files && files.length > 0) { EQ.readSmartFile(files[0]); }
                });
                dz.addEventListener('click', function() { document.getElementById('smart-file-input').click(); });
            }
        },
        closeSmartImportModal: function() {
            var modal = document.getElementById('smart-import-modal');
            if (modal) modal.classList.add('hidden');
            Mascot.update();
        },
        handleSmartFileSelect: function(e) {
            var files = e.target.files;
            if (files && files.length > 0) { EQ.readSmartFile(files[0]); }
        },
        readSmartFile: function(file) {
            if (!file) return;
            var MAX_IMPORT_BYTES = 5 * 1024 * 1024;
            if (file.size && file.size > MAX_IMPORT_BYTES) { showToast("File too large (max 5 MB).", "⚠️"); return; }
            var reader = new FileReader();
            reader.onerror = function() { showToast("Failed to read file.", "⚠️"); };
            reader.onabort = function() { showToast("File read cancelled.", "⚠️"); };
            reader.onload = function(ev) {
                var textarea = document.getElementById('smart-import-textarea');
                if (textarea) { textarea.value = ev.target.result; }
                showToast('File "' + file.name + '" loaded!', "📂");
            };
            reader.readAsText(file);
        },
        processSmartImport: function() {
                var textarea = document.getElementById('smart-import-textarea');
                if (!textarea || !textarea.value.trim()) { showToast("Please paste text or load a file first.", "⚠️"); return; }
                var text = textarea.value.trim();
                
                if (text.startsWith('{') && text.endsWith('}')) {
                    try {
                        var data = JSON.parse(text, function(k, v) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined; return v; });
                        if (data.mainVals || data.advVals || data.preVal !== undefined) {
                            // Validate EQ payload before applying — prevents prototype pollution side-effects and TypeErrors from malformed arrays
                            var validMain = !data.mainVals || Array.isArray(data.mainVals);
                            var validAdv = !data.advVals || Array.isArray(data.advVals);
                            if (validMain && validAdv) { EQ.loadValues(data); showToast("EQ profile loaded!", "📊"); EQ.closeSmartImportModal(); return; }
                        }
                        if (typeof data.brand === 'string' && typeof data.model === 'string') { IEM.loadConfigDirect(data); showToast("IEM Profile loaded!", "📝"); EQ.closeSmartImportModal(); return; }
                    } catch(e) {}
                }
                
                if (text.includes("GraphicEQ:")) {
                    var eqStr = text.substring(text.indexOf("GraphicEQ:") + 10).trim();
                    var pairs = eqStr.split(';');
                    var coords = [];
                    pairs.forEach(function(p) {
                        var parts = p.trim().split(/\s+/).map(Number);
                        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) coords.push({ hz: parts[0], g: parts[1] });
                    });
                    if (coords.length > 0) { EQ.mapGraphicEQToSliders(coords); showToast("Wavelet GraphicEQ applied!", "〰️"); EQ.closeSmartImportModal(); return; }
                }
                
                // Detect any multiline parametric EQ configuration format (Peace, APO, REW, Qudelix, raw numbers)
                var lines = text.split(/\r?\n/);
                var cleanLines = lines.filter(line => line.trim() !== '').slice(0, 15);
                var hasParametricLines = lines.some(line => {
                    var clean = line.trim().toLowerCase();
                    return clean.includes("preamp") || clean.includes("fc") || clean.includes("filter") || clean.includes("peak") || clean.includes("pk");
                }) || cleanLines.some(line => line.split(/[\s,;\t]+/).filter(Boolean).length >= 3);

                if (hasParametricLines) {
                    if (EQ.parsePeaceFormat(text)) { EQ.closeSmartImportModal(); return; }
                }
                
                var dataCoords = [];
                lines.forEach(function(line) {
                    var clean = line.trim();
                    if (clean.startsWith('#') || clean === '') return;
                    var parts = clean.split(/[\s,;\t]+/).filter(function(p) { return p.length > 0; }).map(Number);
                    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] >= 1 && parts[0] <= 24000) {
                        dataCoords.push([parts[0], parts[1]]);
                    }
                });
                if (dataCoords.length >= 5) {
                    var id = 'imported_' + Date.now();
                    var newItem = { id: id, name: "Imported Curve", variant: 'Imported', source: 'Universal Paste', searchKey: 'imported curve', data: dataCoords };
                    if (!PEQDB_Module.STATE.dataset) PEQDB_Module.STATE.dataset = [];
                    PEQDB_Module.STATE.dataset.unshift(newItem);
                    PEQDB_Module.STATE.renderList.unshift(newItem);
                    PEQDB_Module.renderList();
                    PEQDB_Module.toggleCurveSelection(id);
                    showToast("Raw sound curve imported!", "📈"); EQ.closeSmartImportModal(); return;
                }
                showToast("Unrecognized format.", "⚠️");
            },
            parsePeaceFormat: function(text) {
                var lines = text.split(/\r?\n/);
                var preamp = 0;
                var mappedAny = false;
                var mainVals = this.bands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
                var advVals = this.advancedBands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
                var self = this;
                
                var usedMain = new Set();
                var usedAdv = new Set();
                lines.forEach(function(line) {
                    var clean = line.trim();
                    if (!clean || clean.startsWith('#') || clean.startsWith('*') || clean.startsWith('//')) return;
                    
                    // 1. Detect Preamp gain values across multiple syntaxes
                    var preampMatch = clean.match(/preamp\s*[:=,\s]\s*([-\d.]+)/i);
                    if (preampMatch) {
                        preamp = parseFloat(preampMatch[1]) || 0;
                        return;
                    }
                    
                    // 2. Parse Standard parametric EQ filter parameters
                    var fc = null, gain = 0, q = 1.0;
                    var filterType = self.detectFilterType(clean);
                    
                    // Check for standard Peace format: "Filter X: ON PK Fc 105 Hz Gain -3.0 dB Q 1.4"
                    var peaceMatch = clean.match(/Fc\s*([\d.]+)\s*Hz\s*Gain\s*([-\d.]+)\s*dB\s*Q\s*([\d.]+)/i);
                    if (peaceMatch) {
                        fc = Math.round(parseFloat(peaceMatch[1]));
                        gain = parseFloat(peaceMatch[2]);
                        q = parseFloat(peaceMatch[3]);
                    } 
                    // Check for Qudelix-5K CSV format: "Filter 1,ON,PEAK,20,-3.5,1.2"
                    // (also NOTCH / LSC / HSC / LPQ / HPQ types)
                    else if (filterType) {
                        var csvParts = clean.split(/[,;\t\s]+/);
                        if (csvParts.length >= 6) {
                            var fVal = parseFloat(csvParts[csvParts.length - 3]);
                            var gVal = parseFloat(csvParts[csvParts.length - 2]);
                            var qVal = parseFloat(csvParts[csvParts.length - 1]);
                            if (!isNaN(fVal) && !isNaN(gVal) && !isNaN(qVal)) {
                                fc = Math.round(fVal);
                                gain = gVal;
                                q = qVal;
                            }
                        }
                    }
                    // Check for raw column arrays: "20 3.5 1.2" (Freq, Gain, Q)
                    else {
                        var parts = clean.split(/[\s,;\t]+/).map(Number);
                        if (parts.length >= 3 && !parts.some(isNaN)) {
                            if (parts[0] >= 10 && parts[0] <= 24000 && parts[1] >= -40 && parts[1] <= 40 && parts[2] >= 0.01 && parts[2] <= 40) {
                                fc = Math.round(parts[0]);
                                gain = parts[1];
                                q = parts[2];
                            }
                        }
                    }
                    
                    if (fc !== null) {
                        mappedAny = true;
                        self.mapSingleFilter(fc, gain, q, filterType, mainVals, advVals, usedMain, usedAdv);
                    }
                });
                
                // Nothing recognizably parametric was parsed (e.g. a pasted
                // frequency-response table with an extra phase column, or a
                // 3-column measurement block). Bail out before loadValues wipes
                // the current EQ, so processSmartImport can fall through to the
                // raw curve importer instead.
                if (preamp === 0 && !mappedAny) return false;
                
                this.loadValues({ preVal: preamp, mainVals: mainVals, advVals: advVals });
                showToast("Parametric EQ profile processed!", "🪄");
                return true;
            },
        detectFilterType: function(raw) {
            // Map common EQ export type tokens (Peace/APO, Qudelix, REW) to the
            // app's band types so NOTCH / shelf / LP / HP filters stay their own
            // type instead of silently becoming peaking filters.
            var s = ' ' + String(raw || '').toLowerCase().replace(/[()]/g, ' ') + ' ';
            if (/\bnotch\b|\bno\b/.test(s)) return 'notch';
            if (/\blow\s*shelf\b|\blshelf\b|\blsc\b/.test(s)) return 'lowshelf';
            if (/\bhigh\s*shelf\b|\bhshelf\b|\bhsc\b/.test(s)) return 'highshelf';
            if (/\bhigh\s*pass\b|\bhipass\b|\bhighpass\b|\bhpq\b/.test(s)) return 'highpass';
            if (/\blow\s*pass\b|\blowpass\b|\blpq\b/.test(s)) return 'lowpass';
            if (/\bpeak\b|\bpk\b|\bpeq\b/.test(s)) return 'peaking';
            return null;
        },
        mapSingleFilter: function(hz, g, q, type, mainVals, advVals, usedMain, usedAdv) {
            var filterType = type || 'peaking';
            var uM = usedMain || new Set();
            var uA = usedAdv || new Set();

            var bestM = -1, bestMd = Infinity;
            mainVals.forEach(function(v, i) {
                if (!uM.has(i)) {
                    var d = Math.abs(v.hz - hz);
                    if (d < bestMd) { bestMd = d; bestM = i; }
                }
            });

            var bestA = -1, bestAd = Infinity;
            advVals.forEach(function(v, i) {
                if (!uA.has(i)) {
                    var d = Math.abs(v.hz - hz);
                    if (d < bestAd) { bestAd = d; bestA = i; }
                }
            });

            // If all slots in both banks were used, fallback to closest overall
            if (bestM === -1 && bestA === -1) {
                mainVals.forEach(function(v, i) { var d = Math.abs(v.hz - hz); if (d < bestMd) { bestMd = d; bestM = i; } });
                advVals.forEach(function(v, i) { var d = Math.abs(v.hz - hz); if (d < bestAd) { bestAd = d; bestA = i; } });
            }

            if (bestM !== -1 && (bestA === -1 || bestMd <= bestAd)) {
                mainVals[bestM].g = g;
                mainVals[bestM].q = q;
                mainVals[bestM].hz = hz;
                mainVals[bestM].type = filterType;
                uM.add(bestM);
            } else if (bestA !== -1) {
                advVals[bestA].g = g;
                advVals[bestA].q = q;
                advVals[bestA].hz = hz;
                advVals[bestA].type = filterType;
                uA.add(bestA);
            }
        },
        mapGraphicEQToSliders: function(coords) {
            var mainVals = this.bands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
            var advVals = this.advancedBands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
            var usedMain = new Set();
            var usedAdv = new Set();
            var self = this;
            coords.forEach(function(pt) { self.mapSingleFilter(pt.hz, pt.g, 1.0, 'peaking', mainVals, advVals, usedMain, usedAdv); });
            this.loadValues({ preVal: 0, mainVals: mainVals, advVals: advVals });
        },
};
