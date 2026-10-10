const EQ_SmartImportMethods = {
    parsedEQData: null,

    // ---- Destructive-import safety -------------------------------------------
    // parsePeaceFormat() commits by calling loadValues(), which overwrites the
    // preamp and ALL 20 band slots with whatever it managed to parse. Nothing
    // in that path kept a snapshot, so a misparse destroyed the user's mix with
    // no undo. Two independent guards now:
    //
    //   1. snapshotEQState / restoreEQState + an Undo affordance on the toast
    //      that announces the import. This is the one that fixes the CLASS of
    //      bug: even a parse we get wrong cannot lose work.
    //   2. The plausibility gate in parsePeaceFormat, which refuses to commit
    //      to a "this is a filter set" reading of an ambiguous paste at all.
    //
    // Snapshot/restore has to read the DOM, not the band model, because the DOM
    // is the source of truth for the main bank: updateAudioConnections()
    // (eq-dsp-graph.js:414-421) reads eq-f{i} / eq-s{i} / eq-q_m{i} and only
    // falls back to the model when those are absent. They are always present.
    // The advanced bank is the mirror image - #eq-panel-advanced is an empty
    // container with no inputs built for it, so eq-a{i} / eq-q_a{i} never exist
    // and eq-dsp-graph.js:457-466 falls back to advancedBands[i].hz / .g / .q.

    snapshotEQState: function() {
        var snap = {
            preamp: null,
            activePreset: this.activePreset,
            main: [],
            adv: [],
            bypassed: []
        };
        var preSlider = document.getElementById('eq-preampSlider');
        snap.preamp = preSlider ? preSlider.value : this.preVal;
        for (var i = 0; i < this.bands.length; i++) {
            var b = this.bands[i];
            var f = document.getElementById('eq-f' + i);
            var fs = document.getElementById('eq-fs_m' + i);
            var g = document.getElementById('eq-s' + i);
            var gn = document.getElementById('eq-s' + i + '_num');
            var q = document.getElementById('eq-q_m' + i);
            var qn = document.getElementById('eq-q_m' + i + '_num');
            snap.main.push({
                hz: f ? f.value : b.hz,
                fs: fs ? fs.value : null,
                g: g ? g.value : 0,
                gn: gn ? gn.value : null,
                q: q ? q.value : b.defaultQ,
                qn: qn ? qn.value : null,
                type: b.type || 'peaking',
                slope: b.slope
            });
        }
        for (var j = 0; j < this.advancedBands.length; j++) {
            var ab = this.advancedBands[j];
            snap.adv.push({ hz: ab.hz, g: ab.g, q: ab.q, type: ab.type, slope: ab.slope });
        }
        if (window.bypassedBands && typeof window.bypassedBands.forEach === 'function') {
            window.bypassedBands.forEach(function(k) { snap.bypassed.push(k); });
        }
        // >20-band AutoEQ solves live in virtualBands; without them an undo of a
        // big solve (or a remembered session) would leave the old tail behind.
        snap.virtual = (this.virtualBands || []).map(function(v) {
            return { hz: v.hz, g: v.g, q: v.q, type: v.type || 'peaking' };
        });
        return snap;
    },

    restoreEQState: function(snap) {
        if (!snap) return false;
        var self = this;
        var preValEl = document.getElementById('eq-preampVal');
        var preSlider = document.getElementById('eq-preampSlider');
        if (preValEl && snap.preamp != null) preValEl.value = Number(snap.preamp).toFixed(1);
        if (preSlider && snap.preamp != null) {
            preSlider.value = Math.max(-20, Math.min(20, Number(snap.preamp)));
        }
        function setVal(id, v) { var e = document.getElementById(id); if (e && v != null) e.value = v; }
        snap.main.forEach(function(m, i) {
            var b = self.bands[i];
            if (!b) return;
            b.type = m.type;
            if (m.slope !== undefined) b.slope = m.slope;
            setVal('eq-f' + i, m.hz);
            setVal('eq-fs_m' + i, m.fs);
            setVal('eq-s' + i, m.g);
            setVal('eq-s' + i + '_num', m.gn);
            setVal('eq-q_m' + i, m.q);
            setVal('eq-q_m' + i + '_num', m.qn);
        });
        snap.adv.forEach(function(a, i) {
            var b = self.advancedBands[i];
            if (!b) return;
            b.hz = a.hz; b.g = a.g; b.q = a.q; b.type = a.type;
            if (a.slope !== undefined) b.slope = a.slope;
        });
        if (window.bypassedBands) {
            window.bypassedBands.clear();
            snap.bypassed.forEach(function(k) { window.bypassedBands.add(k); });
        }
        if (Array.isArray(snap.virtual)) {
            this.virtualBands = snap.virtual.map(function(v) { return { hz: v.hz, g: v.g, q: v.q, type: v.type || 'peaking' }; });
        } else {
            this.virtualBands = [];
        }
        this.activePreset = snap.activePreset || null;
        // Band cards: the type / slope buttons and the bypass dot are plain DOM
        // that the writes above do not touch, so without this a restored band
        // could show "PK" while actually being a high-shelf (or show the wrong
        // bypass state). handleTypeChange is the same funnel every type change
        // already goes through; it also re-applies the slope reset rule.
        var TYPE_LABELS = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
        var SLOPE_TYPES = ['lowshelf', 'highshelf', 'lowpass', 'highpass'];
        var prevProg = this.isProgrammaticSliderUpdate;
        this.isProgrammaticSliderUpdate = true;
        try {
            for (var k = 0; k < this.bands.length; k++) {
                var bk = this.bands[k];
                var typeBtn = document.getElementById('eq-t_m' + k);
                if (typeBtn) typeBtn.textContent = TYPE_LABELS[bk.type] || 'PK';
                if (this.handleTypeChange) this.handleTypeChange(k, bk.type || 'peaking');
                var slopeBtn = document.getElementById('eq-sl_m' + k);
                if (slopeBtn) {
                    slopeBtn.classList.toggle('hidden', SLOPE_TYPES.indexOf(bk.type) === -1);
                    slopeBtn.textContent = (bk.slope || 12) + 'dB';
                }
                var key = 'm' + k;
                var off = !!(window.bypassedBands && window.bypassedBands.has(key));
                var bpBtn = document.getElementById('eq-bp_' + key);
                if (bpBtn) {
                    bpBtn.textContent = off ? '\uD83D\uDD34' : '\uD83D\uDFE2';
                    bpBtn.style.color = off ? 'var(--accent-red)' : 'var(--accent-green)';
                    var card = bpBtn.closest('.eq-band-card');
                    if (card) {
                        card.style.opacity = off ? '0.3' : '1';
                        card.classList.toggle('bypassed', off);
                    }
                }
            }
        } finally {
            this.isProgrammaticSliderUpdate = prevProg;
        }
        // Re-drive every band through the normal update path. The DOM values we
        // just wrote are what updateAudioConnections() reads, so this is what
        // actually pushes the restored curve back to the worklet - without it
        // the audio would keep playing the imported curve while the sliders
        // appeared restored.
        var prevFlag = this.isProgrammaticSliderUpdate;
        this.isProgrammaticSliderUpdate = true;
        try {
            for (var i = 0; i < this.bands.length; i++) this.updateSlider(i);
            for (var j = 0; j < this.advancedBands.length; j++) this.updateSlider(j, 'adv');
            if (this.updatePreamp) this.updatePreamp();
        } finally {
            this.isProgrammaticSliderUpdate = prevFlag;
        }
        if (this.updateAudioConnections) this.updateAudioConnections();
        if (this.renderCustomPresets) this.renderCustomPresets();
        if (this.drawCurve) this.drawCurve();
        return true;
    },

            showSmartImportModal: function() {
            var modal = document.getElementById('smart-import-modal');
            if (modal) { modal.classList.remove('hidden'); Mascot.update(); }
            var textarea = document.getElementById('smart-import-textarea');
            // Wire the expand/collapse controls HERE, on open. Doing it lazily from
            // inside expandSmartImportField cannot work: the only thing that calls
            // that is the button's own click listener, which is what is not wired
            // yet, so the button would never do anything.
            this._smartImportWireExpand();
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
            // Collapse first: the textarea lives in the expanded overlay while it
            // is open, so closing the modal underneath it would hide the text
            // and then the next open would restore a detached node.
            this.collapseSmartImportExpand({ silent: true });
            var modal = document.getElementById('smart-import-modal');
            if (modal) modal.classList.add('hidden');
            Mascot.update();
        },

        /* Expand / collapse the paste field.
           The SAME textarea element is moved between the collapsed row and the
           expanded overlay instead of being copied into a second one. That keeps
           a single source of truth: the value, the caret position, the selection,
           the native undo history and the #smart-import-textarea id that
           processSmartImport() reads all survive the move untouched. A mirrored
           pair would need two-way sync on every input event plus paste, and
           would have two undo stacks that disagree.

           Listeners are attached once here rather than through data-action,
           because these two controls are created with the modal and are not part
           of the generated action table. */
        expandSmartImportField: function() {
            var ta = document.getElementById('smart-import-textarea');
            var overlay = document.getElementById('smart-import-expand-overlay');
            var slot = document.getElementById('smart-import-expand-slot');
            var btn = document.getElementById('smart-import-expand-btn');
            if (!ta || !overlay || !slot) return;

            this._smartImportWireExpand();

            var caret = ta.selectionStart;
            slot.appendChild(ta);
            ta.classList.add('is-expanded');
            overlay.classList.add('is-open');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            // Moving an element drops focus and, in Chromium, can reset the
            // caret to the end - which would be very wrong for a long paste.
            ta.focus();
            try { ta.setSelectionRange(caret, caret); } catch (e) { /* noop */ }
        },

        collapseSmartImportExpand: function(opts) {
            var ta = document.getElementById('smart-import-textarea');
            var overlay = document.getElementById('smart-import-expand-overlay');
            var home = document.getElementById('smart-import-textarea-home');
            var btn = document.getElementById('smart-import-expand-btn');
            if (!ta || !overlay || !home) return;
            if (!overlay.classList.contains('is-open')) return;   // already collapsed

            var caret = ta.selectionStart;
            home.appendChild(ta);
            ta.classList.remove('is-expanded');
            overlay.classList.remove('is-open');
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (!(opts && opts.silent) && document.getElementById('smart-import-modal')) {
                ta.focus();
                try { ta.setSelectionRange(caret, caret); } catch (e) { /* noop */ }
            }
        },


        _smartImportWireExpand: function() {
            if (this._smartImportExpandWired) return;
            var self = this;
            this._smartImportExpandWired = true;

            var expandBtn = document.getElementById('smart-import-expand-btn');
            var collapseBtn = document.getElementById('smart-import-collapse-btn');
            var overlay = document.getElementById('smart-import-expand-overlay');

            if (expandBtn) {
                expandBtn.addEventListener('click', function() { self.expandSmartImportField(); });
            }
            if (collapseBtn) {
                collapseBtn.addEventListener('click', function() { self.collapseSmartImportExpand(); });
            }
            if (overlay) {
                // Click the backdrop (but not the panel) to dismiss.
                overlay.addEventListener('mousedown', function(e) {
                    if (e.target === overlay) self.collapseSmartImportExpand();
                });
            }
            // Esc collapses from anywhere while the overlay is open. Bound once at
            // the document and guarded on visibility so it cannot swallow an Esc
            // that belongs to some other dialog.
            document.addEventListener('keydown', function(e) {
                if (e.key !== 'Escape') return;
                var ov = document.getElementById('smart-import-expand-overlay');
                if (ov && ov.classList.contains('is-open')) {
                    e.preventDefault();
                    self.collapseSmartImportExpand();
                }
            });
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
                            // Validate EQ payload before applying — prevents prototype pollution side-effects and TypeErrors from malformed arrays.
                            // Members must be OBJECTS with the expected fields: a bare
                            // numeric array ([4,3,2,...]) is the app's internal
                            // gain-array preset style, NOT a loadValues payload —
                            // applying it used to "succeed" while silently
                            // flattening every band to defaults.
                            var validMain = !data.mainVals || (Array.isArray(data.mainVals) && data.mainVals.every(function(m) { return m && typeof m === 'object'; }));
                            var validAdv = !data.advVals || (Array.isArray(data.advVals) && data.advVals.every(function(m) { return m && typeof m === 'object'; }));
                            if (validMain && validAdv) { EQ.loadValues(data); showToast("EQ profile loaded!", "📊"); EQ.closeSmartImportModal(); return; }
                            showToast("JSON looks like an EQ profile but band arrays are malformed (each band must be an object like {\"g\":2,\"hz\":105,\"q\":1.4}).", "⚠️");
                            return;
                        }
                        if (typeof data.brand === 'string' && typeof data.model === 'string') { IEM.loadConfigDirect(data); showToast("IEM Profile loaded!", "📝"); EQ.closeSmartImportModal(); return; }
                    } catch(e) {
                        showToast("Invalid JSON: " + (e && e.message ? e.message : 'parse error'), "⚠️");
                        return;
                    }
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
                    // Validate like the Peace branch: sane freq + dB range.
                    // One bad line (e.g. "20 999") must not corrupt the spline.
                    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] >= 1 && parts[0] <= 24000 && parts[1] >= -60 && parts[1] <= 60) {
                        dataCoords.push([parts[0], parts[1]]);
                    }
                });
                // Sort ascending and drop duplicate frequencies so the cubic
                // spline receives strictly increasing x (unsorted pastes and
                // dupes previously poisoned normalization for the whole curve).
                dataCoords.sort(function(a, b) { return a[0] - b[0]; });
                dataCoords = dataCoords.filter(function(p, i) { return i === 0 || p[0] !== dataCoords[i - 1][0]; });
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
                var mappedGains = [];
                var rawThirdColumn = [];
                var rawBranchRows = 0;
                this._importFullWarned = false;
                var mainVals = this.bands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
                var advVals = this.advancedBands.map(function(b, i) { return { hz: b.hz, g: 0, q: b.defaultQ }; });
                var self = this;
                
                var usedMain = new Set();
                var usedAdv = new Set();
                lines.forEach(function(line) {
                    var clean = line.trim();
                    if (!clean || clean.startsWith('#') || clean.startsWith('*') || clean.startsWith('//')) return;
                    
                    // 1. Detect Preamp gain values across multiple syntaxes
                    var preampMatch = clean.match(/preamp\s*[:=,\s]\s*([+-\d.]+)/i);
                    if (preampMatch) {
                        preamp = parseFloat(preampMatch[1]) || 0;
                        return;
                    }
                    
                    // 2. Parse Standard parametric EQ filter parameters
                    var fc = null, gain = 0, q = 1.0;
                    var filterType = self.detectFilterType(clean);
                    
                    // Check for standard Peace format: "Filter X: ON PK Fc 105 Hz Gain -3.0 dB Q 1.4"
                    // [+-\d.]+ — some exporters sign positive gains ("Gain +3.0 dB");
                    // [-\d.]+ silently dropped those lines (half-imported EQ).
                    var peaceMatch = clean.match(/Fc\s*([\d.]+)\s*Hz\s*Gain\s*([+-\d.]+)\s*dB\s*Q\s*([\d.]+)/i);
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
                            // Same range validation as the raw-numbers branch:
                            // NaN-only filtering previously accepted 1e9 Hz /
                            // -1e9 dB / Q 1e-9, polluting the band model and
                            // re-exporting garbage filter lines.
                            if (!isNaN(fVal) && !isNaN(gVal) && !isNaN(qVal)
                                && fVal >= 10 && fVal <= 24000 && gVal >= -40 && gVal <= 40 && qVal >= 0.01 && qVal <= 40) {
                                fc = Math.round(fVal);
                                gain = gVal;
                                q = qVal;
                            }
                        }
                    }
                    // Check for raw column arrays: "20 3.5 1.2" (Freq, Gain, Q)
                    // The third column is unlabelled here, so it is only a Q if it
                    // falls inside the range the app can actually apply: the Q
                    // slider is min=0.1 max=10 (eq-core.js:838). A value outside
                    // that is not a Q - it is a phase column, a bandwidth, a slope
                    // or a score - and reading it as Q builds a fictional EQ out of
                    // a measurement table. Recorded so parsePeaceFormat can tell.
                    else {
                        var parts = clean.split(/[\s,;\t]+/).map(Number);
                        if (parts.length >= 3 && !parts.some(isNaN)) {
                            if (parts[0] >= 10 && parts[0] <= 24000 && parts[1] >= -40 && parts[1] <= 40 && parts[2] >= 0.01 && parts[2] <= 40) {
                                fc = Math.round(parts[0]);
                                gain = parts[1];
                                q = parts[2];
                                rawThirdColumn.push(parts[2]);
                                rawBranchRows++;
                            }
                        }
                    }
                    
                    if (fc !== null) {
                        mappedAny = true;
                        mappedGains.push(gain);
                        self.mapSingleFilter(fc, gain, q, filterType, mainVals, advVals, usedMain, usedAdv);
                    }
                });

                // Nothing recognizably parametric was parsed (e.g. a pasted
                // frequency-response table with an extra phase column, or a
                // 3-column measurement block). Bail out before loadValues wipes
                // the current EQ, so processSmartImport can fall through to the
                // raw curve importer instead.
                if (preamp === 0 && !mappedAny) return false;

                // Plausibility gate. The 3-column raw branch above accepts ANY numeric row
                // whose third value lands in [0.01, 40], so a pasted measurement
                // table (freq, dB, phase-degrees / bandwidth / score) is read as
                // freq/gain/Q and mapped onto the bands. The only thing that used
                // to stop this was the !mappedAny test above, which fires
                // precisely when parsing SUCCEEDED - so the guard protected
                // against the one case that was never a problem and let the
                // destructive one through.
                //
                // Three checks, each using something we already know:
                //  - The third column of an unlabelled row is only a Q if it is
                //    inside the Q slider's own range (0.1-10). A phase column,
                //    a bandwidth, a slope or a score is not, and reading it as Q
                //    invents filters out of a measurement table.
                //  - The app has 10 main + 10 advanced slots. More parsed rows
                //    than that cannot be a filter set; they are a curve, and
                //    mapping them was silently collapsing them onto the nearest
                //    slots anyway (behind the "Import slots full" toast).
                //  - If every parsed gain is 0 there is nothing to apply, and
                //    loadValues would flatten all 20 bands to zero.
                var slotCount = mainVals.length + advVals.length;
                var nonZeroGains = mappedGains.filter(function(g) { return g !== 0; }).length;
                var thirdTooWide = rawThirdColumn.some(function(v) { return v > 10 || v < 0.1; });
                if (mappedAny && preamp === 0) {
                    if (rawBranchRows > 0 && thirdTooWide) return false;
                    if (mappedGains.length > slotCount || nonZeroGains === 0) return false;
                }

                // Preamp-only paste: apply just the preamp, leave all bands
                // untouched (loading all-zero mainVals here would flatten 20
                // bands over a "Preamp: -6 dB" note).
                if (preamp !== 0 && !mappedAny) {
                    const preValEl = document.getElementById("eq-preampVal");
                    const preSlider = document.getElementById("eq-preampSlider");
                    if (preValEl) preValEl.value = preamp.toFixed(1);
                    if (preSlider) preSlider.value = Math.max(-20, Math.min(20, preamp));
                    if (this.updatePreamp) this.updatePreamp();
                    showToast("Preamp imported (" + preamp.toFixed(1) + " dB) — bands untouched.", "🎚️");
                    return true;
                }

                // Snapshot before the destructive write, and offer Undo on the
                // toast that reports it. The gate above narrows what can reach
                // here; this is what guarantees a wrong parse is recoverable.
                var self2 = this;
                var before = this.snapshotEQState();
                this.loadValues({ preVal: preamp, mainVals: mainVals, advVals: advVals });
                showToast("Parametric EQ profile processed — " + mappedGains.length + " filter(s).", "🪄", {
                    duration: 9000,
                    action: {
                        label: 'Undo',
                        onClick: function () {
                            self2.restoreEQState(before);
                            showToast("EQ restored to before the import.", "↩️");
                        }
                    }
                });
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
        // Logarithmic distance: pitch/filters live on a log axis — linear Hz
        // systematically snaps high-frequency imports downward on ties
        // (e.g. 12kHz between 8k/16k slots tied 4k/4k linear, but 16k is
        // 0.415 oct away vs 8k's 0.585).
        _filterDist: function(slotHz, hz) {
            if (!Number.isFinite(slotHz) || slotHz <= 0 || !Number.isFinite(hz) || hz <= 0) return Infinity;
            return Math.abs(Math.log2(slotHz / hz));
        },
        mapSingleFilter: function(hz, g, q, type, mainVals, advVals, usedMain, usedAdv) {
            var filterType = type || 'peaking';
            var uM = usedMain || new Set();
            var uA = usedAdv || new Set();
            var self = this;

            var bestM = -1, bestMd = Infinity;
            mainVals.forEach(function(v, i) {
                if (!uM.has(i)) {
                    var d = self._filterDist(v.hz, hz);
                    if (d < bestMd) { bestMd = d; bestM = i; }
                }
            });

            var bestA = -1, bestAd = Infinity;
            advVals.forEach(function(v, i) {
                if (!uA.has(i)) {
                    var d = self._filterDist(v.hz, hz);
                    if (d < bestAd) { bestAd = d; bestA = i; }
                }
            });

            // If all slots in both banks were used, fallback to closest overall
            // — but warn instead of silently overwriting a mapped filter.
            if (bestM === -1 && bestA === -1) {
                mainVals.forEach(function(v, i) { var d = self._filterDist(v.hz, hz); if (d < bestMd) { bestMd = d; bestM = i; } });
                advVals.forEach(function(v, i) { var d = self._filterDist(v.hz, hz); if (d < bestAd) { bestAd = d; bestA = i; } });
                if (!self._importFullWarned) {
                    self._importFullWarned = true;
                    showToast("Import slots full — closest filter overwritten.", "⚠️");
                }
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
