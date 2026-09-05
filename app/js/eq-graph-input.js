// Split out of eq-core.js (2026 god-file refactor, Step 8).
// Squig-link graph input: the full interaction surface of the frequency
// response canvas — node hit-testing (getEQNodeAtCoords), EQ-node dragging
// (updates faders + pushes the worklet through the rAF coalescer), sculptor
// node dragging, pan/zoom (wheel + drag), double-click reset, hover readout
// tracking (squigMouseX/Y), and touch equivalents.
//
// The whole block ships inside ONE idempotent method, attachGraphInput(),
// because its drag-state variables (isPanning / isDraggingSculptNode /
// isDraggingEQNode / panStartX/Y / lastMinF/MaxF) and the getEQNodeAtCoords
// arrow function close over each other — hoisting them into separate methods
// would change the closure topology that the mousemove/mouseup handlers
// depend on. The body is the original init block verbatim; only a
// const self = this; line was added at the top (the block previously
// closed over init's self).
//
// this-scoped members used: drawCurve, updateSlider, activeEQNode,
// hoverEQNode, isTuningLabActive, graphBuilt, squigMouseX/Y, plus
// PEQDB_Module view state (viewMinF/MaxF, squigYMin/Max, sculpt state) —
// all read at event time. Names unchanged; merged via Object.assign in
// db-cache.js.
const EQ_GraphInputMethods = {
    _graphInputAttached: false,
    attachGraphInput: function() {
        if (this._graphInputAttached) return;
        this._graphInputAttached = true;
        const self = this;
            const squigCanvas = document.getElementById("eq-squiglinkViz");
            if (squigCanvas) {
                let isPanning = false;
                let isDraggingSculptNode = false;
                let isDraggingEQNode = false;
                let panStartX = 0;
                let panStartY = 0;
                let lastMinF = 20;
                let lastMaxF = 20000;

            // Band element cache: hit-testing ran getElementById per band
            // per mousemove. Band rows are static-count; cache elements and
            // revalidate by reference (rows are never replaced mid-session,
            // only their .value changes).
            let eqFEls = null, eqSEls = null;
            const bandEls = () => {
                const n = EQ_Module.bands.length;
                if (!eqFEls || eqFEls.length !== n) {
                    eqFEls = []; eqSEls = [];
                    for (let i = 0; i < n; i++) {
                        eqFEls.push(document.getElementById("eq-f" + i));
                        eqSEls.push(document.getElementById("eq-s" + i));
                    }
                }
                return true;
            };
            const getEQNodeAtCoords = (clickX, clickY, w, h, minF, maxF, min, max) => {
                const alignDb = (typeof PEQDB_Module.alignDb === 'number') ? PEQDB_Module.alignDb : 75.0;
                // Hit-test against the curve the user SEES: the graph draws
                // with the effective preamp (auto-gain/hearing/loudness/tone
                // headroom folded in via effectivePreampDb), so using the raw
                // slider value here made the drag hitbox sit several dB away
                // from the drawn node whenever those compensations were active.
                const preVal = (typeof this.computeEffectivePreamp === 'function')
                    ? this.computeEffectivePreamp()
                    : (parseFloat(document.getElementById("eq-preampSlider")?.value) || 0);
                bandEls();
                for (let i = 0; i < EQ_Module.bands.length; i++) {
                    const hz = parseFloat(eqFEls[i]?.value || EQ_Module.bands[i].hz);
                    const g = parseFloat(eqSEls[i]?.value || 0);
                    const nodeX = w * (Math.log10(hz / minF) / Math.log10(maxF / minF));

                    const nodeY = h - (((alignDb + g + preVal) - min) / (max - min)) * h;
                    if (Math.hypot(nodeX - clickX, nodeY - clickY) < 18) {
                        return { type: 'main', i };
                    }
                }
                return null;
            };

            squigCanvas.addEventListener('mousedown', e => {
                const rect = squigCanvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;

                const minF = PEQDB_Module.viewMinF || 20;
                const maxF = PEQDB_Module.viewMaxF || 20000;
                const min = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 50;
                const max = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 110;
                const w = rect.width;
                const h = rect.height;

                if (PEQDB_Module.isDrawingModeActive) {
                    PEQDB_Module.isUserDrawing = true;
                    PEQDB_Module.drawnPoints = [[clickX, clickY]];
                    squigCanvas.style.cursor = 'crosshair';
                    return;
                }

                if (EQ_Module.graphFocus === 'eq' && !EQ_Module.isTuningLabActive) {
                    const eqNode = getEQNodeAtCoords(clickX, clickY, w, h, minF, maxF, min, max);
                    if (eqNode) {
                        isDraggingEQNode = true;
                        EQ_Module.isDragging = true;
                        EQ_Module.activeEQNode = eqNode;
                        squigCanvas.style.cursor = 'move';
                        return;
                    }
                }

                    if (PEQDB_Module.targetMode === 'sculptor' && EQ_Module.graphFocus === 'sculpt') {

                        for (let i = 0; i < PEQDB_Module.sculptPoints.length; i++) {
                            const p = PEQDB_Module.sculptPoints[i];
                            const nodeX = w * (Math.log10(p.hz / minF) / Math.log10(maxF / minF));
                            const nodeY = h - ((p.val - min) / (max - min)) * h;

                            if (Math.hypot(nodeX - clickX, nodeY - clickY) < 18) {
                                isDraggingSculptNode = true;
                                PEQDB_Module.isDragging = true;
                                EQ_Module.isDragging = true;
                                PEQDB_Module.activeSculptIndex = i;
                                PEQDB_Module.activeRenameUid = i;

                                squigCanvas.style.cursor = PEQDB_Module.sculptMode === 'simple' ? 'ns-resize' : 'move';
                                return;
                            }
                        }
                    }

                    if (PEQDB_Module.targetMode !== 'sculptor') {
                        isPanning = true;
                        EQ_Module.isDragging = true;
                        panStartX = e.clientX;
                        panStartY = e.clientY;
                        lastMinF = PEQDB_Module.viewMinF || 20;
                        lastMaxF = PEQDB_Module.viewMaxF || 20000;
                        squigCanvas.style.cursor = 'grabbing';
                    }
                });

                const dispatchSyntheticMouse = (type, touch) => {
                    squigCanvas.dispatchEvent(new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: touch.clientX,
                        clientY: touch.clientY
                    }));
                };
                squigCanvas.addEventListener('touchstart', e => {
                    if (e.touches.length !== 1) return;
                    e.preventDefault();
                    dispatchSyntheticMouse('mousedown', e.touches[0]);
                }, { passive: false });
                window.addEventListener('touchmove', e => {
                    if (!isDraggingEQNode && !isDraggingSculptNode && !isPanning && !PEQDB_Module.isUserDrawing) return;
                    if (e.touches.length !== 1) return;
                    e.preventDefault();
                    dispatchSyntheticMouse('mousemove', e.touches[0]);
                }, { passive: false });
                window.addEventListener('touchend', e => {
                    const lastTouch = e.changedTouches && e.changedTouches[0];
                    dispatchSyntheticMouse('mouseup', lastTouch || { clientX: 0, clientY: 0 });
                });

                squigCanvas.addEventListener('dblclick', e => {
                    if (!EQ_Module.isTuningLabActive) return;
                    const rect = squigCanvas.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;
                    const w = rect.width;
                    const h = rect.height;

                    const minF = PEQDB_Module.viewMinF || 20;
                    const maxF = PEQDB_Module.viewMaxF || 20000;
                    const min = PEQDB_Module.squigYMin || 50;
                    const max = PEQDB_Module.squigYMax || 110;

                    const f = Math.max(20, Math.min(20000, Math.round(Math.pow(10, Math.log10(minF) + (clickX / w) * (Math.log10(maxF) - Math.log10(minF))))));
                    const db = Math.max(min, Math.min(max, min + (1 - (clickY / h)) * (max - min)));

                    if (PEQDB_Module.sculptPoints.some(p => p.hz === f)) return;

                    PEQDB_Module.sculptPoints.push({ hz: f, val: db });
                    PEQDB_Module.sculptPoints.sort((a, b) => a.hz - b.hz);

                    PEQDB_Module.activeSculptIndex = PEQDB_Module.sculptPoints.findIndex(p => p.hz === f);
                    PEQDB_Module.updateSculptTargetData();
                    showToast("Tuning point added!", "➕");
                });

                let dragFrameId = null;
                window.addEventListener('mousemove', e => {

                    if (dragFrameId) return;

                    dragFrameId = requestAnimationFrame(() => {
                        dragFrameId = null;

                        const rect = squigCanvas.getBoundingClientRect();
                        const clientX = e.clientX - rect.left;
                        const clientY = e.clientY - rect.top;
                        const w = rect.width;
                        const h = rect.height;

                        const minF = PEQDB_Module.viewMinF || 20;
                        const maxF = PEQDB_Module.viewMaxF || 20000;
                        const min = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 50;
                        const max = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 110;

                        if (PEQDB_Module.isDrawingModeActive && PEQDB_Module.isUserDrawing) {
                            PEQDB_Module.drawnPoints.push([clientX, clientY]);
                            EQ_Module.drawCurve();
                            return;
                        }

                        if (isDraggingEQNode && EQ_Module.activeEQNode) {
                            const eqNode = EQ_Module.activeEQNode;
                            const alignDb = (typeof PEQDB_Module.alignDb === 'number') ? PEQDB_Module.alignDb : 75.0;
                            // Same effective-preamp math as the hit-test above:
                            // the rawDb under the cursor is compared against the
                            // drawn curve, so the inverse mapping must subtract
                            // the same effective preamp the graph was drawn with.
                            const preVal = (typeof EQ_Module.computeEffectivePreamp === 'function')
                                ? EQ_Module.computeEffectivePreamp()
                                : (parseFloat(document.getElementById("eq-preampSlider")?.value) || 0);

                            let f = Math.pow(10, Math.log10(minF) + (clientX / w) * (Math.log10(maxF) - Math.log10(minF)));
                            f = Math.max(20, Math.min(20000, Math.round(f)));

                            let rawDb = min + (1 - (clientY / h)) * (max - min);
                            let relativeGain = rawDb - alignDb - preVal;
                            relativeGain = Math.max(-20, Math.min(20, relativeGain));

                            let prefix = eqNode.type === 'main' ? 'eq-f' : 'eq-af';
                            let gainPrefix = eqNode.type === 'main' ? 'eq-s' : 'eq-a';

                            // Indexed lookups, cached per drag (4 lookups/frame
                            // → 0 after the first frame of the gesture; `self`
                            // is the module — arrow callbacks share its this).
                            const dragKey = eqNode.type + eqNode.i;
                            const dragCache = self._dragEls;
                            const cacheLive = dragCache && dragCache.key === dragKey &&
                                (!dragCache.hz || dragCache.hz.isConnected) &&
                                (!dragCache.fs || dragCache.fs.isConnected) &&
                                (!dragCache.gain || dragCache.gain.isConnected) &&
                                (!dragCache.num || dragCache.num.isConnected);
                            if (!cacheLive) {
                                self._dragEls = {
                                    key: dragKey,
                                    hz: document.getElementById(prefix + eqNode.i),
                                    fs: document.getElementById(eqNode.type === 'main' ? `eq-fs_m${eqNode.i}` : `eq-fs_a${eqNode.i}`),
                                    gain: document.getElementById(gainPrefix + eqNode.i),
                                    num: document.getElementById(eqNode.type === 'main' ? `eq-s${eqNode.i}_num` : `eq-a${eqNode.i}_num`)
                                };
                            }
                            const hzNode = self._dragEls.hz;
                            if (hzNode) hzNode.value = Math.round(f);
                            const fsNode = self._dragEls.fs;
                            if (fsNode) fsNode.value = EQ_Module.logHzToSlider(f);
                            const gainNode = self._dragEls.gain;
                            if (gainNode) gainNode.value = relativeGain.toFixed(1);
                            const gainNumNode = self._dragEls.num;
                            if (gainNumNode) gainNumNode.value = relativeGain.toFixed(1);

                            EQ_Module.updateSlider(eqNode.i, eqNode.type);
                            // The graph drag flushes through the rAF coalescer
                            // (one worklet post per frame at pointermove rate)
                            // — the drawn curve still tracks every frame, and
                            // the flush lands before the next paint.
                            if (EQ_Module.graphBuilt && SharedAudio.workletNode) {
                                EQ_Module._uacCoalesced();
                            } else if (!EQ_Module.graphBuilt) {
                                // Queue for when the worklet finishes booting
                                EQ_Module._pendingDspQueue = EQ_Module._pendingDspQueue || [];
                                if (!EQ_Module._pendingDspQueue.includes('filters')) EQ_Module._pendingDspQueue.push('filters');
                                EQ_Module.ensureDSPGraph().catch(()=>{});
                            }
                            EQ_Module.drawCurve();
                            if (window.syncGlobalSliders) {
                                if (hzNode) window.syncGlobalSliders(hzNode);
                                if (gainNode) window.syncGlobalSliders(gainNode);
                                if (fsNode) window.syncGlobalSliders(fsNode);
                            }
                            return;
                        }

                        if (isDraggingSculptNode && PEQDB_Module.activeSculptIndex > -1) {
                            const points = PEQDB_Module.sculptPoints;
                            const idx = PEQDB_Module.activeSculptIndex;
                            const p = points[idx];

                            let db = min + (1 - (clientY / h)) * (max - min);
                            p.val = Math.max(min, Math.min(max, db));

                            let f = Math.pow(10, Math.log10(minF) + (clientX / w) * (Math.log10(maxF) - Math.log10(minF)));

                            const minBound = idx > 0 ? points[idx - 1].hz + 5 : 20;
                            const maxBound = idx < points.length - 1 ? points[idx + 1].hz - 5 : 20000;

                            p.hz = Math.max(minBound, Math.min(maxBound, Math.round(f)));

                            const hzInput = document.getElementById('sculptor-node-hz');
                            const dbInput = document.getElementById('sculptor-node-db');
                            if (hzInput) hzInput.value = p.hz;
                            if (dbInput) dbInput.value = p.val.toFixed(1);

                            PEQDB_Module.updateSculptTargetData();

                            if (PEQDB_Module.searchMode === 'similar') {
                                PEQDB_Module.findSimilarCurves();
                            }

                            self.drawCurve();
                            return;
                        }

                        if (!isPanning && !isDraggingEQNode && !isDraggingSculptNode) {
                            let eqHoverNode = null;
                            if (EQ_Module.graphFocus === 'eq') {
                                eqHoverNode = getEQNodeAtCoords(clientX, clientY, w, h, minF, maxF, min, max);
                            }

                            const hoverChanged = (EQ_Module.hoverEQNode?.i !== eqHoverNode?.i) || (EQ_Module.hoverEQNode?.type !== eqHoverNode?.type);
                            if (hoverChanged) {
                                EQ_Module.hoverEQNode = eqHoverNode;
                                EQ_Module.drawCurve();
                            }

                            let sculptHoverIdx = -1;
                            if (PEQDB_Module.targetMode === 'sculptor' && EQ_Module.graphFocus === 'sculpt') {
                                for (let i = 0; i < PEQDB_Module.sculptPoints.length; i++) {
                                    const p = PEQDB_Module.sculptPoints[i];
                                    const nodeX = w * (Math.log10(p.hz / minF) / Math.log10(maxF / minF));
                                    const nodeY = h - ((p.val - min) / (max - min)) * h;
                                    if (Math.hypot(nodeX - clientX, nodeY - clientY) < 18) {
                                        sculptHoverIdx = i;
                                        break;
                                    }
                                }
                            }

                            if (PEQDB_Module.hoverSculptIndex !== sculptHoverIdx) {
                                PEQDB_Module.hoverSculptIndex = sculptHoverIdx;
                                EQ_Module.drawCurve();
                            }

                            if (eqHoverNode) {
                                squigCanvas.style.cursor = 'pointer';
                            } else if (sculptHoverIdx !== -1) {
                                squigCanvas.style.cursor = PEQDB_Module.sculptMode === 'simple' ? 'ns-resize' : 'pointer';
                            } else {
                                squigCanvas.style.cursor = 'default';
                            }
                        }

                        if (!isPanning) return;
                        const deltaX = e.clientX - panStartX;
                        const deltaY = e.clientY - panStartY;

                        if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;

                        const logRange = Math.log10(lastMaxF / lastMinF);
                        const shiftX = -(deltaX / rect.width) * logRange;
                        let newMinF = Math.pow(10, Math.log10(lastMinF) + shiftX);
                        let newMaxF = Math.pow(10, Math.log10(lastMaxF) + shiftX);

                        if (newMinF < 20) {
                            newMinF = 20;
                            newMaxF = 20 * Math.pow(10, logRange);
                        }
                        if (newMaxF > 20000) {
                            newMaxF = 20000;
                            newMinF = 20000 / Math.pow(10, logRange);
                        }

                        PEQDB_Module.viewMinF = newMinF;
                        PEQDB_Module.viewMaxF = newMaxF;
                        // Deliberately frequency-axis (X) only. Dragging the
                        // graph background must never move the Y-axis / shift
                        // every band's on-screen level together -- that's
                        // exactly what it looks like when the whole curve and
                        // all 10 nodes appear to move up/down at once, and it
                        // should only ever happen via the Amp (preamp) and
                        // Align (dB reference) controls, which adjust the
                        // actual EQ state rather than just panning the view.
                        // A prior pass here computed and clamped a vertical
                        // newMinY/newMaxY pan and committed it to
                        // PEQDB_Module.squigYMin/squigYMax -- since those two
                        // values are exactly what getEQNodeAtCoords() (above)
                        // adds into every node's Y position, that vertical
                        // commit was the bug: it silently shifted every
                        // node's *displayed* level in lockstep on any
                        // background drag, with no actual gain change behind
                        // it. Removed; only horizontal panning is wired up.

                        self.drawCurve();
                    });
                });

                window.addEventListener('mouseup', () => {
                    if (PEQDB_Module.isDrawingModeActive && PEQDB_Module.isUserDrawing) {
                        PEQDB_Module.isUserDrawing = false;
                        squigCanvas.style.cursor = 'default';

                        const w = squigCanvas.clientWidth;
                        const h = squigCanvas.clientHeight;

                        const minF = PEQDB_Module.viewMinF || 20;
                        const maxF = PEQDB_Module.viewMaxF || 20000;
                        const min = PEQDB_Module.squigYMin || 50;
                        const max = PEQDB_Module.squigYMax || 110;

                        const rawCoords = PEQDB_Module.drawnPoints.map(([x, y]) => {
                            const f = Math.pow(10, Math.log10(minF) + (x / w) * (Math.log10(maxF) - Math.log10(minF)));
                            const db = min + (1 - (y / h)) * (max - min);
                            return [f, db];
                        }).sort((a, b) => a[0] - b[0]);

                        const uniqueCoords = [];
                        for (let i = 0; i < rawCoords.length; i++) {
                            if (i === 0 || Math.abs(rawCoords[i][0] - rawCoords[i-1][0]) > 0.5) {
                                uniqueCoords.push(rawCoords[i]);
                            }
                        }

                        if (uniqueCoords.length >= 2) {
                            const tempSpline = PEQDB_Module.Spline.build(uniqueCoords);
                            if (tempSpline) {
                                PEQDB_Module.sculptPoints = PEQDB_Module.sculptPoints.map(p => {
                                    const newVal = PEQDB_Module.Spline.evaluate(tempSpline, p.hz);
                                    return { hz: p.hz, val: Math.max(min, Math.min(max, newVal)) };
                                });
                                if (window.EQ_Sculptor) {
                                    EQ_Sculptor.sculptPoints = PEQDB_Module.sculptPoints.map(p=> ({hz:p.hz,val:p.val}));
                                }
                                PEQDB_Module.updateSculptTargetData();
                                if (PEQDB_Module.searchMode === 'similar') {
                                    PEQDB_Module.findSimilarCurves();
                                }
                            }
                        }
                        PEQDB_Module.drawnPoints = [];
                        EQ_Module.drawCurve();
                    }
                    if (isDraggingEQNode) {
                        isDraggingEQNode = false;
                        EQ_Module.isDragging = false;
                        EQ_Module.activeEQNode = null;
                        squigCanvas.style.cursor = 'default';
                    }
                    if (isDraggingSculptNode) {
                        isDraggingSculptNode = false;
                        PEQDB_Module.isDragging = false;
                        EQ_Module.isDragging = false;
                        squigCanvas.style.cursor = 'default';
                        // Every mid-drag findSimilarCurves call bailed out via the
                        // isDragging guard, and nothing re-ran the scan after
                        // release — Similar-mode kept showing pre-drag matches.
                        // The debounced rescan coalesces rapid re-drags.
                        if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                            PEQDB_Module.debouncedFindSimilarCurves();
                        }
                    }
                    if (isPanning) {
                        isPanning = false;
                        EQ_Module.isDragging = false;
                        squigCanvas.style.cursor = 'default';
                    }
                });

                squigCanvas.addEventListener('wheel', e => {

                    if (PEQDB_Module.targetMode === 'sculptor') return;

                    e.preventDefault();
                    const rect = squigCanvas.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;

                    const minF = PEQDB_Module.viewMinF || 20;
                    const maxF = PEQDB_Module.viewMaxF || 20000;
                    const mouseF = minF * Math.pow(10, (mouseX / rect.width) * Math.log10(maxF / minF));

                    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;

                    let newMinF = mouseF / Math.pow(mouseF / minF, zoomFactor);
                    let newMaxF = mouseF * Math.pow(maxF / mouseF, zoomFactor);

                    if (newMinF < 20) newMinF = 20;
                    if (newMaxF > 20000) newMaxF = 20000;

                    PEQDB_Module.viewMinF = newMinF;
                    PEQDB_Module.viewMaxF = newMaxF;
                    self.drawCurve();
                }, { passive: false });

                squigCanvas.addEventListener('dblclick', () => {

                    if (PEQDB_Module.targetMode === 'sculptor') return;

                    PEQDB_Module.viewMinF = 20;
                    PEQDB_Module.viewMaxF = 20000;

                    PEQDB_Module.updateAlignmentCfgActual();
                });

                squigCanvas.addEventListener('mousemove', e => {
                    const rect = squigCanvas.getBoundingClientRect();

                    EQ_Module.squigMouseX = (e.clientX - rect.left);
                    EQ_Module.squigMouseY = (e.clientY - rect.top);
                    if (!isPanning && !isDraggingSculptNode) {
                        self.drawCurve();
                    }
                });
                squigCanvas.addEventListener('mouseleave', () => {
                    EQ_Module.squigMouseX = null;
                    EQ_Module.squigMouseY = null;
                    self.drawCurve();
                });
            }
    },
};
