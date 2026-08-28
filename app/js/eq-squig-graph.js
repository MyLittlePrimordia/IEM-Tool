const EQ_SquigGraphMethods = {
        // Live spectrum analyzer overlay: shows the currently playing audio's real-time
        // frequency content on the main graph, behind the EQ curve. Reads the same FFT data
        // (this.previousDataArray) already computed every frame by the existing visualizer
        // loop (startVisualizer's drawViz, in EQ_Module core) for the other visualizer
        // effects -- no separate analyser polling needed, so this only draws while that loop
        // is already running (i.e. while music, the tone generator, or a test-lab sweep is
        // actually making sound).
        showSpectrumOverlay: false,
        toggleSpectrumOverlay: function() {
            this.showSpectrumOverlay = !this.showSpectrumOverlay;
            const btn = document.getElementById('btn-spectrum-toggle');
            if (btn) btn.classList.toggle('is-on', this.showSpectrumOverlay);
            this.drawCurve();
        },
        effectivePreampDb: function() {
            // Single source of truth: delegate to EQ_Module
            return (window.EQ && typeof EQ.computeEffectivePreamp === 'function')
                ? EQ.computeEffectivePreamp()
                : (document.getElementById("eq-preampSlider") ? parseFloat(document.getElementById("eq-preampSlider").value) || 0 : 0);
        },
        drawSpectrumOverlay: function(cc, w, h, minF, maxF, accentBlueRgb) {
            if (!this.showSpectrumOverlay) return;
            const dataArray = this.previousDataArray || this.cachedDataArray;
            if (!dataArray || typeof SharedAudio === 'undefined' || !SharedAudio.analyser || !SharedAudio.ctx) return;
            const rgb = accentBlueRgb || '59, 130, 246';

            const binCount = SharedAudio.analyser.frequencyBinCount;
            const sampleRate = SharedAudio.ctx.sampleRate;
            const binHz = sampleRate / (2 * binCount);
            const invLogMaxMin = 1 / Math.log10(maxF / minF);
            const logMin = Math.log10(minF);

            // Pre-allocate or reuse Float32Array buffers for X/Y coordinates (Zero GC Memory Churn)
            if (!this.specXCache || this.specXCache.length < binCount + 2) {
                this.specXCache = new Float32Array(binCount + 2);
                this.specYCache = new Float32Array(binCount + 2);
            }

            const xs = this.specXCache;
            const ys = this.specYCache;
            let count = 0;
            let lastX = -10;

            for (let i = 0; i < binCount; i++) {
                const freq = i * binHz;
                if (freq < minF) continue;
                if (freq > maxF) break;

                const x = w * (Math.log10(freq) - logMin) * invLogMaxMin;

                // Logarithmic Downsampling: merge bins that land on the same pixel column
                if (count > 0 && (x - lastX) < 1.0 && i < binCount - 1) {
                    const norm = dataArray[i] / 255;
                    const y = h - (norm * h * 0.85);
                    if (y < ys[count - 1]) ys[count - 1] = y; // keep highest peak
                    continue;
                }

                const norm = dataArray[i] / 255;
                const y = h - (norm * h * 0.85);

                xs[count] = x;
                ys[count] = y;
                lastX = x;
                count++;
            }

            if (count < 2) return;

            const firstY = ys[0];
            const lastY = ys[count - 1];

            cc.save();

            // Single-pass gradient fill path
            cc.beginPath();
            cc.moveTo(0, h);
            cc.lineTo(0, firstY);

            for (let i = 0; i < count; i++) {
                cc.lineTo(xs[i], ys[i]);
            }

            cc.lineTo(w, lastY);
            cc.lineTo(w, h);
            cc.closePath();

            const gradient = cc.createLinearGradient(0, 0, 0, h);
            gradient.addColorStop(0, `rgba(${rgb}, 0.28)`);
            gradient.addColorStop(1, `rgba(${rgb}, 0.03)`);
            cc.fillStyle = gradient;
            cc.fill();

            // Top border stroke
            cc.strokeStyle = `rgba(${rgb}, 0.4)`;
            cc.lineWidth = 1.2;
            cc.beginPath();
            cc.moveTo(0, firstY);
            for (let i = 0; i < count; i++) {
                cc.lineTo(xs[i], ys[i]);
            }
            cc.lineTo(w, lastY);
            cc.stroke();

            cc.restore();
        },
        drawSquiglinkGraphInternal: function() {
            const cv = document.getElementById("eq-squiglinkViz");
            if (!cv || cv.clientWidth === 0 || cv.clientHeight === 0) {
                // Canvas is hidden/zero-size (e.g. tab not visible) - do not keep
                // scheduling frames; drawCurve() will be called again once the
                // graph becomes visible/sized (tab switch, resize, etc).
                return;
            }
            const cc = cv.getContext("2d"); 
            const { w, h } = this.setupDPRCanvas(cv);

            // Read cached theme color variables directly without triggering a browser layout recalculation
            const accentBlueRgb = (document.documentElement.style.getPropertyValue('--accent-blue-rgb') || '59, 130, 246').trim();
            const accentGreen = (document.documentElement.style.getPropertyValue('--accent-green') || '#38a169').trim();

            const dpr = window.devicePixelRatio || 1;
            const targetW = Math.floor(w * dpr);
            const targetH = Math.floor(h * dpr);

            // Initialize or resize the off-screen cache canvas
            if (!this.staticCacheCanvas) {
                this.staticCacheCanvas = document.createElement('canvas');
                this.staticCacheCtx = this.staticCacheCanvas.getContext('2d');
                this.staticDirty = true;
            }

            if (this.staticCacheCanvas.width !== targetW || this.staticCacheCanvas.height !== targetH) {
                this.staticCacheCanvas.width = targetW;
                this.staticCacheCanvas.height = targetH;
                this.staticCacheCtx.resetTransform();
                this.staticCacheCtx.scale(dpr, dpr);
                this.staticDirty = true;
            }

            const minF = PEQDB_Module.viewMinF || 20;
            const maxF = PEQDB_Module.viewMaxF || 20000;
            const min = PEQDB_Module.squigYMin || 60;
            const max = PEQDB_Module.squigYMax || 90;

            // Generate a state signature of all static variables. Each curve carries a
            // per-curve _splineVersion that drawNormalCurves bumps whenever the
            // spline is rebuilt — without it, a spline change that leaves uid/
            // color/offset untouched would serve a stale static layer from cache.
            const activeCurvesState = (PEQDB_Module.STATE.activeCurves || []).map(c => `${c.uid}-${c.visible}-${c.offset}-${c.color}-${c.role}-${c._splineVersion || 0}`).join('|');
            // Only inputs that actually affect the static layer belong here:
            // zoom, alignment, and the drawn curves. EQ model / sim state changes
            // are handled by the mode layer's own signature.
            const currentStaticState = `${minF}-${maxF}-${min}-${max}-${PEQDB_Module.alignHz}-${PEQDB_Module.alignDb}-${activeCurvesState}`;

            if (this.lastStaticState !== currentStaticState) {
                this.staticDirty = true;
                this.lastStaticState = currentStaticState;
            }

            // Redraw the Static Layer onto the off-screen cache ONLY when state changes
            if (this.staticDirty) {
                const scc = this.staticCacheCtx;
                scc.clearRect(0, 0, w, h);

                // Paint True OLED Black background
                scc.fillStyle = "#000000";
                scc.fillRect(0, 0, w, h);

                // Shading regional overlays
                const fRangeLimits = [
                    { min: 20, max: 60, col: 'rgba(239, 68, 68, 0.012)', name: "Sub-Bass" },       
                    { min: 60, max: 200, col: 'rgba(249, 115, 22, 0.012)', name: "Mid-Bass" },     
                    { min: 200, max: 800, col: 'rgba(245, 158, 11, 0.012)', name: "Low-Mids" },    
                    { min: 800, max: 3000, col: 'rgba(6, 182, 212, 0.012)', name: "Mids" },        
                    { min: 3000, max: 10000, col: 'rgba(99, 102, 241, 0.012)', name: "Treble" },   
                    { min: 10000, max: 20000, col: 'rgba(217, 70, 239, 0.012)', name: "Air" }      
                ];

                fRangeLimits.forEach(r => {
                    const startClamp = Math.max(minF, Math.min(maxF, r.min));
                    const endClamp = Math.max(minF, Math.min(maxF, r.max));
                    const xStart = w * (Math.log10(startClamp / minF) / Math.log10(maxF / minF));
                    const xEnd = w * (Math.log10(endClamp / minF) / Math.log10(maxF / minF));
                    scc.fillStyle = r.col; // Was hardcoded to solid black (a no-op band tint bug) — restore the intended subtle per-band coloring
                    scc.fillRect(xStart, 0, xEnd - xStart, h);
                });

                // Draw log grid lines
                const squigGridFreqs = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000];
                scc.lineWidth = 1;
                
                squigGridFreqs.forEach(f => {
                    if (f >= minF && f <= maxF) {
                        const x = w * (Math.log10(f / minF) / Math.log10(maxF / minF));
                        
                        const shouldDrawAllLeft = (w > 650);
                        const isMajor = (f === 20 || f === 50 || f === 100 || f === 200 || f === 500 || f === 1000 || f === 2000 || f === 5000 || f === 10000 || f === 20000);
                        const shouldDraw = shouldDrawAllLeft || isMajor;

                        // Was a flat rgba(255,255,255,0.05) for every line, which reads as
                        // essentially invisible against the pure-black background — bumped so the
                        // grid is actually legible when reading raw curve data, with labeled/major
                        // lines a touch stronger than the in-between minor ticks.
                        scc.strokeStyle = isMajor ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.09)";
                        scc.beginPath(); scc.moveTo(x, 0); scc.lineTo(x, h); scc.stroke();
                        
                        if (shouldDraw) {
                            scc.save();
                            scc.fillStyle = "rgba(225, 225, 230, 0.92)"; 
                            scc.font = this.getActiveCanvasFont(8);
                            if (f === 20) {
                                scc.textAlign = "left";
                                scc.fillText("20", x + 4, h - 6);
                            } else if (f === 20000) {
                                scc.textAlign = "right";
                                scc.fillText("20k", x - 4, h - 6);
                            } else {
                                scc.textAlign = "center";
                                const labelMap = {
                                    30: "30", 40: "40", 50: "50", 60: "60", 80: "80",
                                    100: "100", 150: "150", 200: "200", 300: "300", 400: "400", 500: "500", 600: "600", 800: "800",
                                    1000: "1k", 1500: "1.5k", 2000: "2k", 3000: "3k", 4000: "4k", 5000: "5k", 6000: "6k", 8000: "8k",
                                    10000: "10k", 15000: "15k"
                                };
                                scc.fillText(labelMap[f] || f, x, h - 6);
                            }
                            scc.restore();
                        }
                    }
                });

                // Draw decibel lines
                for (let i = 1; i <= 5; i++) {
                    const y = h * (i / 6);
                    const db = max - (i / 6) * (max - min);
                    
                    scc.save();
                    scc.strokeStyle = "rgba(255, 255, 255, 0.09)";
                    scc.beginPath(); scc.moveTo(0, y); scc.lineTo(w, y); scc.stroke();
                    scc.restore();
                    
                    scc.fillStyle = "rgba(225, 225, 230, 0.92)"; 
                    scc.font = this.getActiveCanvasFont(8);
                    scc.fillText(Math.round(db) + "dB", 8, y - 3);
                }

                // Draw standard target and static reference curves
                this.drawNormalCurves(scc, w, h, minF, maxF, null); 

                // Draw Custom Alignment Pin
                const standardAligns = ['500', '1000', '2000', 'mean'];
                if (!standardAligns.includes(PEQDB_Module.alignHz)) {
                    const pinHz = parseFloat(PEQDB_Module.alignHz);
                    const pinDb = PEQDB_Module.alignDb;
                    
                    if (pinHz >= minF && pinHz <= maxF && pinDb >= min && pinDb <= max) {
                        const px = w * (Math.log10(pinHz / minF) / Math.log10(maxF / minF));
                        const py = h - ((pinDb - min) / (max - min)) * h;
                        
                        scc.save();
                        scc.strokeStyle = "rgba(245, 158, 11, 0.4)";
                        scc.setLineDash([3, 4]);
                        scc.lineWidth = 1;
                        
                        scc.beginPath();
                        scc.moveTo(px, 0); scc.lineTo(px, h);
                        scc.moveTo(0, py); scc.lineTo(w, py);
                        scc.stroke();
                        scc.restore();
                    }
                }

                this.staticDirty = false;
            }

            // Composite cached static background onto main canvas instantly
            cc.clearRect(0, 0, w, h);
            cc.drawImage(this.staticCacheCanvas, 0, 0, w, h);

            // Live spectrum overlay of the currently playing audio, drawn on this dynamic layer
            // (not the static cache above) since it changes every frame. Sits behind the hover
            // spotlight and the EQ curve/dots drawn further below.
            this.drawSpectrumOverlay(cc, w, h, minF, maxF, accentBlueRgb);

            // Draw real-time dynamic overlays (hover spotlight, active EQ curves & nodes)
            if (EQ_Module.hoveredFrequency) {
                const activeRegion = EQ_Module.acousticRegions.find(r => EQ_Module.hoveredFrequency >= r.min && EQ_Module.hoveredFrequency <= r.max);
                if (activeRegion) {
                    const startClamp = Math.max(minF, Math.min(maxF, activeRegion.min));
                    const endClamp = Math.max(minF, Math.min(maxF, activeRegion.max));
                    const xStart = w * (Math.log10(startClamp / minF) / Math.log10(maxF / minF));
                    const xEnd = w * (Math.log10(endClamp / minF) / Math.log10(maxF / minF));
                    
                    cc.save();
                    cc.fillStyle = `rgba(${accentBlueRgb}, 0.05)`;
                    cc.fillRect(xStart, 0, xEnd - xStart, h);
                    
                    cc.strokeStyle = `rgba(${accentBlueRgb}, 0.15)`;
                    cc.lineWidth = 1;
                    cc.beginPath();
                    cc.moveTo(xStart, 0); cc.lineTo(xStart, h);
                    cc.moveTo(xEnd, 0); cc.lineTo(xEnd, h);
                    cc.stroke();
                    cc.restore();
                }
            }

            const steps = 1000;
            if (!EQ_Module.cachedSquigFreqs || EQ_Module.cachedSquigFreqs.length !== steps) {
                EQ_Module.cachedSquigFreqs = CurveUtils.generateLogGrid(steps, minF, maxF);
                EQ_Module.cachedSquigFilterMag = new Float32Array(steps);
                EQ_Module.cachedSquigMagRes = new Float32Array(steps);
                EQ_Module.cachedSquigPhaseRes = new Float32Array(steps);
                EQ_Module.lastMinF = minF;
                EQ_Module.lastMaxF = maxF;
            } else if (EQ_Module.lastMinF !== minF || EQ_Module.lastMaxF !== maxF) {
                EQ_Module.cachedSquigFreqs = CurveUtils.generateLogGrid(steps, minF, maxF);
                EQ_Module.lastMinF = minF;
                EQ_Module.lastMaxF = maxF;
            }

            const freqs = EQ_Module.cachedSquigFreqs;
            const filterMag = EQ_Module.getCompositeFilterMagnitude(freqs, steps);

            let preVal = this.effectivePreampDb ? this.effectivePreampDb() : ((this.preampSliderEl) ? parseFloat(this.preampSliderEl.value) : 0);
            const preLin = Math.pow(10, preVal / 20); 

            // Reuse pre-allocated scratch buffers instead of allocating two new
            // Float32Arrays per draw (the graph redraws on every slider/toggle
            // change, so this avoids GC churn in the hot path).
            if (!this._eqDbBuf || this._eqDbBuf.length !== steps) this._eqDbBuf = new Float32Array(steps);
            if (!this._totalMagBuf || this._totalMagBuf.length !== steps) this._totalMagBuf = new Float32Array(steps);
            const eqDb = this._eqDbBuf;
            const totalMag = this._totalMagBuf;
            for(let j = 0; j < steps; j++) {
                eqDb[j] = 20 * Math.log10(Math.max(1e-10, filterMag[j] * preLin));
                totalMag[j] = filterMag[j] * preLin;
            }

            EQ_Module.calculateTargetMatches();
			
			

            let baseCurve = null;
            let targetCurve = null;
            const active = PEQDB_Module.STATE.activeCurves;
            
            active.forEach(c => {
                if (c.role === 'base' && c.visible) baseCurve = c;
                if (c.role === 'target' && c.visible) targetCurve = c;
            });

            let baseSpline = null;
            let targetSpline = null;

            if (baseCurve) {
                // Memoize spline per (data, alignDb) — drawCurve fires on every
                // slider input event, and rebuilding the spline each time was a
                // large chunk of the drag cost. Rebuild only when the source
                // data or the alignment reference actually changed.
                if (!baseCurve._cmpSpline || baseCurve._cmpSplineData !== baseCurve.data || baseCurve._cmpSplineAlignDb !== PEQDB_Module.alignDb) {
                    baseCurve._cmpSpline = PEQDB_Module.Spline.build(PEQDB_Module.getNormalizedData(baseCurve.data, baseCurve.name));
                    baseCurve._cmpSplineData = baseCurve.data;
                    baseCurve._cmpSplineAlignDb = PEQDB_Module.alignDb;
                    baseCurve._cmpSplineVersion = (baseCurve._cmpSplineVersion || 0) + 1;
                }
                baseSpline = baseCurve._cmpSpline;
            }
            if (targetCurve) {
                if (!targetCurve._cmpSpline || targetCurve._cmpSplineData !== targetCurve.data || targetCurve._cmpSplineAlignDb !== PEQDB_Module.alignDb) {
                    targetCurve._cmpSpline = PEQDB_Module.Spline.build(PEQDB_Module.getNormalizedData(targetCurve.data, targetCurve.name));
                    targetCurve._cmpSplineData = targetCurve.data;
                    targetCurve._cmpSplineAlignDb = PEQDB_Module.alignDb;
                    targetCurve._cmpSplineVersion = (targetCurve._cmpSplineVersion || 0) + 1;
                }
                targetSpline = targetCurve._cmpSpline;
            }

            // The graphMode layer (curves/heatmap/dashed DSP line) only changes
            // when the EQ model, splines, zoom, alignment, preamp, or mode
            // changes — but drawCurve fires on every slider tick AND 20-60x/s
            // during playback, so without caching it re-did ~1000 spline
            // evals + strokes per frame. Signature below mirrors every input.
            const splineState = (PEQDB_Module.STATE.activeCurves || []).map(c =>
                `${c.uid}-${c.visible ? 1 : 0}-${c.offset}-${c.color}-${c.role}-${c._cmpSplineVersion || 0}-${c._splineVersion || 0}`
            ).join('|');
            const virtualState = (this.virtualBands || []).map(v => `${v.hz}:${v.g}:${v.q}:${v.type || 'peaking'}`).join('|');
            const modeState = [
                EQ_Module.graphMode,
                EQ_Module.isTuningLabActive ? 1 : 0,
                this._magCacheVersion, this._magCacheBypass, this._magCacheCheap,
                this._magCacheFreqKey, this._magCacheNumPoints,
                preVal, w, h, minF, maxF, min, max,
                PEQDB_Module.alignHz, PEQDB_Module.alignDb,
                splineState, virtualState
            ].join('|');
            this._renderModeLayer(cc, w, h, dpr, targetW, targetH, minF, maxF, min, max,
                eqDb, steps, freqs, baseSpline, targetSpline, accentGreen, modeState);

            if (!EQ_Module.isTuningLabActive) {
                var hoverEQ2 = EQ_Module.hoverEQNode;
                const preVal = this.effectivePreampDb ? this.effectivePreampDb() : ((this.preampSliderEl) ? parseFloat(this.preampSliderEl.value) : 0);
                const bandColors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
                const liveFilters = this.getLiveFiltersState().main;

                cc.save();
                EQ_Module.bands.forEach((b, i) => {
                    const filterState = liveFilters[i] || {};
                    const hz2 = filterState.hz || b.hz;
                    const g2 = filterState.g || 0;
                    if (hz2 >= minF && hz2 <= maxF) {
                        var x2 = w * (Math.log10(hz2 / minF) / Math.log10(maxF / minF));
                        var y2 = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + g2 + preVal, h);
                        var isHov = (hoverEQ2 && hoverEQ2.type === 'main' && hoverEQ2.i === i);
                        
                        var nodeSize = isHov ? 14 : 10;
                        var half = nodeSize / 2;
                        var px = Math.round(x2 - half);
                        var py = Math.round(y2 - half);

                        cc.save();
                        // 8-Bit drop shadow
                        cc.fillStyle = "rgba(0, 0, 0, 0.75)";
                        cc.fillRect(px + 2, py + 2, nodeSize, nodeSize);

                        // Solid band color
                        cc.fillStyle = bandColors[i % bandColors.length];
                        cc.fillRect(px, py, nodeSize, nodeSize);

                        // White outline border
                        cc.strokeStyle = '#ffffff';
                        cc.lineWidth = 1.8;
                        cc.strokeRect(px, py, nodeSize, nodeSize);
                        cc.restore();
                    }
                });
                cc.restore();
            }

            if (PEQDB_Module.isDrawingModeActive && PEQDB_Module.isUserDrawing && PEQDB_Module.drawnPoints.length > 1) {
                cc.save();
                cc.beginPath();
                cc.strokeStyle = "#ec4899"; 
                cc.lineWidth = 3.5;
                cc.lineCap = "round";
                cc.lineJoin = "round";
                PEQDB_Module.drawnPoints.forEach(([x, y], idx) => {
                    if (idx === 0) cc.moveTo(x, y);
                    else cc.lineTo(x, y);
                });
                cc.stroke();
                cc.restore();
            }

            if (PEQDB_Module.targetMode === 'sculptor' && EQ_Module.isTuningLabActive) {
                const activeIdx = PEQDB_Module.activeSculptIndex;
                const hoverIdx = PEQDB_Module.hoverSculptIndex;

                PEQDB_Module.sculptPoints.forEach((p, idx) => {
                    if (p.hz >= minF && p.hz <= maxF) {
                        const x = w * (Math.log10(p.hz / minF) / Math.log10(maxF / minF));
                        const y = h - ((p.val - min) / (max - min)) * h;
                        
                        const isHovered = (hoverIdx === idx);
                        const isActive = (activeIdx === idx);
                        
                        cc.save();
                        cc.shadowBlur = isActive ? 12 : isHovered ? 6 : 0;
                        cc.shadowColor = "#ec4899";
                        cc.fillStyle = isActive ? "#ec4899" : "rgba(236, 72, 153, 0.35)";
                        cc.beginPath();
                        cc.arc(x, y, isHovered ? 8.5 : 6.5, 0, Math.PI * 2);
                        cc.fill();
                        cc.lineWidth = 1.5;
                        cc.strokeStyle = "#ffffff";
                        cc.stroke();
                        
                        if (isActive || isHovered) {
                            cc.shadowBlur = 0;
                            cc.fillStyle = "#ffffff";
                            cc.font = "bold 9px monospace";
                            cc.textAlign = "center";
                            cc.fillText(`${Math.round(p.hz)}Hz / ${p.val.toFixed(1)}dB`, x, y - 12);
                        }
                        cc.restore();
                    }
                });
            }

            let legendY = h - 18;
            if (PEQDB_Module && PEQDB_Module.STATE.activeCurves) {
                PEQDB_Module.STATE.activeCurves.forEach((c) => {
                    cc.fillStyle = c.color;
                    cc.font = this.getActiveCanvasFont(12, 'bold');
                    // Prefer the actual measurement filename (many reviewers encode useful info
                    // in it -- tip type, cable, source impedance, etc. -- that the generic IEM
                    // entry name doesn't capture) over the entry name, when a real underlying
                    // file exists. Synthetic curves (averaged reference, custom EQ target, the
                    // AutoEQ target line) have no filePath and keep their descriptive name.
                    let legendName = c.name;
                    if (c.filePath) {
                        const fileParts = c.filePath.split('/');
                        const fileName = fileParts[fileParts.length - 1];
                        legendName = fileName.replace(/\.[^/.]+$/, '');
                    }
                    cc.fillText(`• ${legendName} (${c.role.toUpperCase()})`, 20, legendY);
                    legendY -= 17;
                });
            }

            if (PEQDB_Module.targetMode !== 'sculptor' && EQ_Module.squigMouseX !== null && EQ_Module.squigMouseX !== undefined) {
                const hoverX = EQ_Module.squigMouseX;
                const logMin = Math.log10(minF);
                const logMax = Math.log10(maxF);
                const f = Math.pow(10, logMin + (hoverX / w) * (logMax - logMin));

                const activeCount = PEQDB_Module.STATE.activeCurves.filter(c => c.visible).length;
                if (activeCount > 0) {
                    cc.save();
                    
                    // Unified Font Size & Layout Configuration
                    const hudFontSize = 11; // Exact same font size for ALL HUD text
                    const rowHeight = 20;   // Generous vertical spacing between lines
                    const rightPad = 24;    // Safe 24px buffer from right edge
                    const hudWidth = 320;   // Broad width preventing text cutoffs
                    const hudX = w - hudWidth - rightPad;
                    
                    let curY = 12;

                    let regionName = "";
                    let regionEmoji = "";
                    if (f < 60) { regionName = "Sub-Bass"; regionEmoji = "🌋"; }
                    else if (f < 250) { regionName = "Bass"; regionEmoji = "🥊"; }
                    else if (f < 2000) { regionName = "Mids"; regionEmoji = "🎤"; }
                    else if (f < 6000) { regionName = "Upper Mids"; regionEmoji = "📢"; }
                    else if (f < 10000) { regionName = "Treble"; regionEmoji = "✨"; }
                    else { regionName = "Air"; regionEmoji = "💨"; }

                    // LINE 1: Hz Readout (Left) & Region Label + Emoji (Right)
                    cc.textAlign = "left";
                    cc.textBaseline = "top";
                    cc.fillStyle = "#ffffff";
                    cc.font = this.getActiveCanvasFont(hudFontSize, 'bold');
                    cc.fillText(`${Math.round(f).toLocaleString()} Hz`, hudX, curY);

                    // Region Emoji (Right Edge with 24px safety pad)
                    cc.textAlign = "right";
                    cc.font = "24px system-ui, sans-serif";
                    cc.fillText(regionEmoji, w - rightPad, curY - 2);

                   // Region Name (Pushed 32px left of emoji with safe gap)
                    cc.fillStyle = `rgba(${accentBlueRgb}, 0.95)`; 
                    cc.font = this.getActiveCanvasFont(hudFontSize, 'bold');
                    cc.fillText(regionName.toUpperCase(), w - rightPad - 32, curY + 1);

                    curY += 26; // Extra clearance below 24px region emoji

                    // LINE 3: Curve dB Readouts (Same Font Size & Auto-Wrapping)
                    cc.textAlign = "left";
                    let dbX = hudX;
                    let refCounter = 1;
                    
                    PEQDB_Module.STATE.activeCurves.forEach((c) => {
                        if (!c.visible || !c.cachedSpline) return;
                        const evalF = PEQDB_Module.getShiftedFrequency(f, c.role);
                        const db = PEQDB_Module.Spline.evaluate(c.cachedSpline, evalF);

                        const roleShort = c.role === 'base' ? 'Base' : (c.role === 'target' ? 'Target' : `Ref ${refCounter++}`);
                        const itemTxt = `• ${roleShort}: ${db.toFixed(1)}dB`;

                        cc.font = this.getActiveCanvasFont(hudFontSize, 'bold');
                        const itemWidth = cc.measureText(itemTxt).width;

                        if (dbX + itemWidth > w - rightPad && dbX > hudX) {
                            curY += rowHeight - 4;
                            dbX = hudX;
                        }

                        cc.fillStyle = c.color;
                        cc.fillText(itemTxt, dbX, curY);
                        dbX += itemWidth + 14;
                    });

                    cc.restore();
                }
            }
        },

        // Renders the graphMode layer (heatmap / difference / quality / normal
        // curves + white dashed DSP line) into an offscreen cache canvas.
        // drawCurve fires on every slider tick and 20-60x/s during playback;
        // the cached layer is only re-rendered when `modeState` (EQ model,
        // splines, zoom, alignment, preamp, mode) actually changed.
        _renderModeLayer: function(cc, w, h, dpr, targetW, targetH, minF, maxF, min, max,
                eqDb, steps, freqs, baseSpline, targetSpline, accentGreen, modeState) {
            if (!this.modeCacheCanvas) {
                this.modeCacheCanvas = document.createElement('canvas');
                this.modeCacheCtx = this.modeCacheCanvas.getContext('2d');
                this.modeDirty = true;
            }
            if (this.modeCacheCanvas.width !== targetW || this.modeCacheCanvas.height !== targetH) {
                this.modeCacheCanvas.width = targetW;
                this.modeCacheCanvas.height = targetH;
                this.modeCacheCtx.resetTransform();
                this.modeCacheCtx.scale(dpr, dpr);
                this.modeDirty = true;
            }
            if (this.lastModeState !== modeState) {
                this.modeDirty = true;
                this.lastModeState = modeState;
            }

            if (this.modeDirty) {
                const mcc = this.modeCacheCtx;
                mcc.clearRect(0, 0, w, h);

                if (EQ_Module.graphMode === 'heatmap') {
                    mcc.save();
                    // Heatmap gradients are identical across frames whenever the
                    // eq values are unchanged, so cache them per (y0, y1, sign)
                    // instead of allocating one per sample per frame.
                    if (!this._heatmapGradCache || this._heatmapGradCacheH !== h) {
                        this._heatmapGradCache = {};
                        this._heatmapGradCacheH = h;
                        this._heatmapGradCount = 0;
                    }
                    const y0 = EQ_Module.dbToY_squig(PEQDB_Module.alignDb, h);
                    for (let i = 0; i < steps; i++) {
                        const curX = (i / (steps - 1)) * w;
                        const dbVal = eqDb[i];
                        if (Math.abs(dbVal) < 0.1) continue;
                        // y0 depends only on alignDb + h: hoisted out of the
                        // loop (was re-derived per sample on every frame).
                        const y1 = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + dbVal, h);

                        const key = Math.round(y0) + ':' + Math.round(y1) + ':' + (dbVal > 0 ? 'p' : 'n');
                        let grad = this._heatmapGradCache[key];
                        if (!grad) {
                            grad = mcc.createLinearGradient(0, y0, 0, y1);
                            if (dbVal > 0) {
                                grad.addColorStop(0, 'rgba(16, 185, 129, 0.01)');
                                grad.addColorStop(1, 'rgba(16, 185, 129, 0.1)');
                            } else {
                                grad.addColorStop(0, 'rgba(239, 68, 68, 0.01)');
                                grad.addColorStop(1, 'rgba(239, 68, 68, 0.1)');
                            }
                            this._heatmapGradCache[key] = grad;
                            if (++this._heatmapGradCount > 1000) {
                                this._heatmapGradCache = {};
                                this._heatmapGradCount = 0;
                            }
                        }
                        mcc.strokeStyle = grad;
                        mcc.lineWidth = w / steps + 1;
                        mcc.beginPath();
                        mcc.moveTo(curX, y0);
                        mcc.lineTo(curX, y1);
                        mcc.stroke();
                    }
                    mcc.restore();

                    mcc.beginPath();
                    mcc.strokeStyle = "rgba(37, 99, 235, 0.8)";
                    mcc.lineWidth = 2.5;
                    for (let i = 0; i < steps; i++) {
                        const curX = (i / (steps - 1)) * w;
                        const y = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + eqDb[i], h);
                        if (i === 0) mcc.moveTo(curX, y); else mcc.lineTo(curX, y);
                    }
                    mcc.stroke();

                    EQ_Module.drawNormalCurves(mcc, w, h, minF, maxF, eqDb);
                }
                else if (EQ_Module.graphMode === 'difference') {
                    mcc.beginPath();
                    mcc.strokeStyle = "rgba(255, 255, 255, 0.15)";
                    mcc.lineWidth = 1.5;
                    mcc.setLineDash([4, 4]);
                    const zeroY = EQ_Module.dbToY_squig(PEQDB_Module.alignDb, h);
                    mcc.moveTo(0, zeroY);
                    mcc.lineTo(w, zeroY);
                    mcc.stroke();
                    mcc.setLineDash([]);

                    if (baseSpline && targetSpline) {
                        mcc.beginPath();
                        mcc.strokeStyle = "rgba(239, 68, 68, 0.4)";
                        mcc.lineWidth = 1.5;
                        mcc.setLineDash([5, 5]);
                        for (let i = 0; i < steps; i++) {
                            const curX = (i / (steps - 1)) * w;
                            const f = freqs[i];
                            const baseDbVal = PEQDB_Module.Spline.evaluate(baseSpline, f);
                            const targetDbVal = PEQDB_Module.Spline.evaluate(targetSpline, f);
                            const y = EQ_Module.dbToY_squig((baseDbVal - targetDbVal) + PEQDB_Module.alignDb, h);
                            if (i === 0) mcc.moveTo(curX, y); else mcc.lineTo(curX, y);
                        }
                        mcc.stroke();
                        mcc.setLineDash([]);

                        mcc.beginPath();
                        mcc.strokeStyle = accentGreen;
                        mcc.lineWidth = 2.5;
                        for (let i = 0; i < steps; i++) {
                            const curX = (i / (steps - 1)) * w;
                            const f = freqs[i];
                            const baseDbVal = PEQDB_Module.Spline.evaluate(baseSpline, f);
                            const targetDbVal = PEQDB_Module.Spline.evaluate(targetSpline, f);
                            const y = EQ_Module.dbToY_squig((baseDbVal + eqDb[i] - targetDbVal) + PEQDB_Module.alignDb, h);
                            if (i === 0) mcc.moveTo(curX, y); else mcc.lineTo(curX, y);
                        }
                        mcc.stroke();
                    } else {
                        mcc.fillStyle = "rgba(255, 255, 255, 0.35)";
                        mcc.font = "11px 'Comic Sans MS', sans-serif";
                        mcc.textAlign = "center";
                        mcc.fillText("Load both Base & Target curves to plot the compensated difference.", w / 2, h / 2);
                        mcc.textAlign = "left";
                    }
                }
                else if (EQ_Module.graphMode === 'quality') {
                    mcc.save();
                    mcc.fillStyle = "rgba(16, 185, 129, 0.03)";
                    const yGreenTop = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + 1.5, h);
                    const yGreenBottom = EQ_Module.dbToY_squig(PEQDB_Module.alignDb - 1.5, h);
                    mcc.fillRect(0, yGreenTop, w, yGreenBottom - yGreenTop);

                    mcc.fillStyle = "rgba(245, 158, 11, 0.02)";
                    const yYellowTop = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + 3.0, h);
                    const yYellowBottom = EQ_Module.dbToY_squig(PEQDB_Module.alignDb - 3.0, h);
                    mcc.fillRect(0, yYellowTop, w, yGreenTop - yYellowTop);
                    mcc.fillRect(0, yGreenBottom, w, yYellowBottom - yGreenBottom);
                    mcc.restore();

                    mcc.beginPath();
                    mcc.strokeStyle = "rgba(255, 255, 255, 0.1)";
                    mcc.lineWidth = 1;
                    const zeroY = this.dbToY_squig(PEQDB_Module.alignDb, h);
                    mcc.moveTo(0, zeroY);
                    mcc.lineTo(w, zeroY);
                    mcc.stroke();

                    if (baseSpline && targetSpline) {
                        let lastX = 0;
                        let lastY = 0;
                        let started = false;
                        for (let i = 0; i < steps; i++) {
                            const curX = (i / (steps - 1)) * w;
                            const f = freqs[i];
                            const baseDbVal = PEQDB_Module.Spline.evaluate(baseSpline, f);
                            const targetDbVal = PEQDB_Module.Spline.evaluate(targetSpline, f);
                            const err = (baseDbVal + eqDb[i]) - targetDbVal;
                            const y = this.dbToY_squig(err + PEQDB_Module.alignDb, h);

                            if (!started) {
                                lastX = curX;
                                lastY = y;
                                started = true;
                                continue;
                            }

                            mcc.beginPath();
                            mcc.moveTo(lastX, lastY);
                            mcc.lineTo(curX, y);

                            const absErr = Math.abs(err);
                            if (absErr <= 1.5) {
                                mcc.strokeStyle = '#10b981';
                            } else if (absErr <= 3.0) {
                                mcc.strokeStyle = '#f59e0b';
                            } else {
                                mcc.strokeStyle = '#ef4444';
                            }
                            mcc.lineWidth = 2.5;
                            mcc.stroke();

                            lastX = curX;
                            lastY = y;
                        }
                    } else {
                        mcc.fillStyle = "rgba(255, 255, 255, 0.35)";
                        mcc.font = "11px 'Comic Sans MS', sans-serif";
                        mcc.textAlign = "center";
                        mcc.fillText("Load both Base & Target curves to plot target match deviations.", w / 2, h / 2);
                        mcc.textAlign = "left";
                    }
                }
                else {
                    EQ_Module.drawNormalCurves(mcc, w, h, minF, maxF, eqDb);
                }

                // Draw White Dashed DSP Filter Curve
                if (!EQ_Module.isTuningLabActive) {
                    mcc.save();
                    mcc.beginPath();
                    mcc.strokeStyle = "rgba(255, 255, 255, 0.95)";
                    mcc.lineWidth = 2.0;
                    mcc.setLineDash([5, 5]);
                    const stepX = w > 800 ? 2 : 1;
                    for (var i = 0; i < w; i += stepX) {
                        const eqIdx = Math.round((i / (w - 1)) * (steps - 1));
                        const eqVal = eqDb ? (eqDb[Math.max(0, Math.min(steps - 1, eqIdx))] || 0) : 0;
                        var yEq = EQ_Module.dbToY_squig(PEQDB_Module.alignDb + eqVal, h);
                        if (i === 0) mcc.moveTo(i, yEq);
                        else mcc.lineTo(i, yEq);
                    }
                    if ((w - 1) % stepX !== 0) {
                        const eqVal = eqDb ? (eqDb[steps - 1] || 0) : 0;
                        mcc.lineTo(w - 1, EQ_Module.dbToY_squig(PEQDB_Module.alignDb + eqVal, h));
                    }
                    mcc.stroke();
                    mcc.restore();
                }

                this.modeDirty = false;
            }

            cc.drawImage(this.modeCacheCanvas, 0, 0, w, h);
        },

        drawNormalCurves: function(cc, w, h, minF, maxF, eqDb) {
            if (!PEQDB_Module || !PEQDB_Module.STATE.activeCurves) return;
            const steps = 1000;
            
            PEQDB_Module.STATE.activeCurves.forEach(c => {
                    if (!c.visible) return;

                    if (!c.data || c.data.length < 2) {
                        console.warn(`[Graph] "${c.name}" (${c.id || c.uid}) has no usable curve data - skipping line render.`, c);
                        return;
                    }

                    if (c._splineSourceData !== c.data) {
                        c.cachedNormalized = PEQDB_Module.getNormalizedData(c.data, c.name);
                        c.cachedSpline = PEQDB_Module.Spline.build(c.cachedNormalized);
                        c._splineSourceData = c.data;
                        c._splineValidated = false;
                        c._splineFailed = false;
                        c._splineVersion = (c._splineVersion || 0) + 1;
                    } else if (!c.cachedSpline && !c._splineFailed) {
                        c.cachedNormalized = PEQDB_Module.getNormalizedData(c.data, c.name);
                        c.cachedSpline = PEQDB_Module.Spline.build(c.cachedNormalized);
                        c._splineValidated = false;
                        c._splineVersion = (c._splineVersion || 0) + 1;
                    }
                    const spline = c.cachedSpline;
                    if (!spline) {
                        if (!c._splineFailed) {
                            c._splineFailed = true;
                            console.warn(`[Graph] "${c.name}" (${c.id || c.uid}) failed to build a spline from its data - skipping line render.`, c.cachedNormalized);
                        }
                        return;
                    }

                // Sanity-check the spline actually produces finite values across the
                // visible range before committing to draw it - catches malformed
                // source data (duplicate/garbage rows) that silently produces NaN,
                // which canvas draws as nothing with no thrown error.
                if (!c._splineValidated) {
                    const testF1 = minF * Math.pow(maxF / minF, 0.25);
                    const testF2 = minF * Math.pow(maxF / minF, 0.75);
                    const t1 = PEQDB_Module.Spline.evaluate(spline, testF1);
                    const t2 = PEQDB_Module.Spline.evaluate(spline, testF2);
                    if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
                        if (!c._splineFailed) {
                            c._splineFailed = true;
                            console.warn(`[Graph] "${c.name}" (${c.id || c.uid}) produced a non-finite value and was skipped. Raw data may contain duplicate/malformed rows.`, c.data);
                        }
                        c._splineValidated = true;
                        return;
                    }
                    const visMin = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 60;
                    const visMax = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 90;
                    if ((t1 < visMin - 40 && t2 < visMin - 40) || (t1 > visMax + 40 && t2 > visMax + 40)) {
                        console.warn(`[Graph] "${c.name}" (${c.id || c.uid}) rendered but its values (~${t1.toFixed(1)}dB/~${t2.toFixed(1)}dB) fall far outside the visible ${visMin}-${visMax}dB window - it may be invisible until you adjust graph zoom or alignment.`);
                    }
                    c._splineValidated = true;
                }
                
                let curveColor = c.color;

                cc.save();
                cc.beginPath(); 
                cc.lineJoin = "round";
                
                cc.shadowBlur = 0;
                cc.shadowColor = "transparent";

                if (c.role === 'base') {
                    cc.strokeStyle = curveColor;
                    cc.lineWidth = 1.6;
                    cc.setLineDash([]);
                    cc.globalAlpha = 0.25;
                } else if (c.role === 'target') {
                    cc.strokeStyle = curveColor;
                    cc.lineWidth = 3.0; // Thicker sharp target line
                    cc.setLineDash([6, 4]);
                    cc.globalAlpha = 1.0;
                } else {
                    cc.strokeStyle = curveColor;
                    cc.lineWidth = 2.6; // Thicker reference lines
                    cc.setLineDash([]);
                    cc.globalAlpha = 0.35;
                }
                
                let started = false;
                const renderStep = w > 800 ? 3 : 2;
                for (let i = 0; i < w; i += renderStep) {
                    const f = minF * Math.pow(maxF / minF, i / (w - 1));
                    const evalF = PEQDB_Module.getShiftedFrequency(f, c.role);
                    const db = PEQDB_Module.Spline.evaluate(spline, evalF);
                    const y = this.dbToY_squig(db + (c.offset || 0), h);
                    
                    if (!started) {
                        cc.moveTo(i, y);
                        started = true;
                    } else {
                        cc.lineTo(i, y);
                    }
                }
                // Secure perfect alignment to the right boundary
                if ((w - 1) % renderStep !== 0) {
                    const evalF = PEQDB_Module.getShiftedFrequency(maxF, c.role);
                    const db = PEQDB_Module.Spline.evaluate(spline, evalF);
                    cc.lineTo(w - 1, this.dbToY_squig(db + (c.offset || 0), h));
                }
                cc.stroke();
                cc.restore();

                if (c.role === 'base') {
                    cc.save();
                    cc.beginPath();
                    cc.strokeStyle = curveColor;
                    cc.lineWidth = 3.2; // Thicker bold base curve
                    cc.lineJoin = "round";
                    cc.shadowBlur = 0;
                    cc.shadowColor = "transparent";
                    
                    let startedCorrected = false;
                    for (let i = 0; i < w; i += renderStep) {
                        const f = minF * Math.pow(maxF / minF, i / (w - 1));
                        const evalF = PEQDB_Module.getShiftedFrequency(f, c.role);
                        const db = PEQDB_Module.Spline.evaluate(spline, evalF);
                        
                        const eqIdx = Math.round((i / (w - 1)) * (steps - 1));
                        const eqVal = eqDb ? (eqDb[Math.max(0, Math.min(steps - 1, eqIdx))] || 0) : 0;
                        const y = this.dbToY_squig(db + (c.offset || 0) + eqVal, h);
                        
                        if (!startedCorrected) {
                            cc.moveTo(i, y);
                            startedCorrected = true;
                        } else {
                            cc.lineTo(i, y);
                        }
                    }
                    if ((w - 1) % renderStep !== 0) {
                        const evalF = PEQDB_Module.getShiftedFrequency(maxF, c.role);
                        const db = PEQDB_Module.Spline.evaluate(spline, evalF);
                        const eqVal = eqDb ? (eqDb[steps - 1] || 0) : 0;
                        cc.lineTo(w - 1, this.dbToY_squig(db + (c.offset || 0) + eqVal, h));
                    }
                    cc.stroke();
                    cc.restore();
                }
            });
        },

        dbToY_squig: function(db, h) {
            const min = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 60;
            const max = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 90;
            return h - ((db - min) / (max - min)) * h;
        },

        drawDot: function(cc, hz, g, w, h, isHovered, isActive, type) {
            const x = w * (Math.log10(hz/20) / Math.log10(20000/20));
            const y = (h / 2) - (g / 15) * (h / 2);
            
            let bIdx = 0;
            if (type === 'main') {
                bIdx = this.bands.findIndex(b => b.hz === hz);
            } else {
                bIdx = this.advancedBands.findIndex(b => b.hz === hz);
            }
            if (bIdx === -1) bIdx = 0;

            const bandColors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
            const targetColor = bandColors[bIdx % bandColors.length];

            // 8-bit pixel-node style: hard-edged square, flat offset drop shadow (no blur), solid black outline
            const half = isHovered ? 7 : 5.5;
            const px = Math.round(x - half);
            const py = Math.round(y - half);
            const size = half * 2;

            cc.save();
            // Flat retro drop shadow (2px offset, no blur — matches every other button/slider in the app)
            cc.fillStyle = "rgba(0, 0, 0, 0.55)";
            cc.fillRect(px + 2, py + 2, size, size);

            cc.fillStyle = targetColor;
            cc.fillRect(px, py, size, size);

            cc.strokeStyle = '#000000';
            cc.lineWidth = 2;
            cc.strokeRect(px, py, size, size);
            cc.restore();
        },
};
