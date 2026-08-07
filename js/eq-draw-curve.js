const EQ_DrawCurveMethods = {
    drawCurve: function() {
        if (this.drawPending) return;
        const cv = document.getElementById("eq-squiglinkViz");
        if (!cv || cv.clientWidth === 0 || cv.clientHeight === 0) return;
        
        const now = Date.now();
        const isPlaying = this.audioEl && !this.audioEl.paused;
        const isDragging = this.isDragging;
        
        // 60 FPS (16ms) only during node dragging (interaction needs max response).
        // The Spectrum Overlay shows a live bar chart, but the response curve + grid
        // behind it are static, so 40 FPS (24ms) keeps the bars smooth while cutting
        // the per-second graph redraw cost ~40% on live sound.
        // Decays to 20 FPS (50ms) during static music playback when overlay is OFF.
        const limit = isDragging ? 16 : (this.showSpectrumOverlay ? 24 : 50);
        if (isPlaying && (now - this.lastDrawTime < limit)) {
            return;
        }
        
        this.drawPending = true;
        requestAnimationFrame(() => {
            this.drawPending = false;
            this.lastDrawTime = Date.now();
            this.drawSquiglinkGraphInternal();
        });
    },

    drawLargeResponse: function() {
        const numPoints = 150; 
        const _now = Date.now();
        if (this._lfAccentTs === undefined || _now - this._lfAccentTs > 120) {
            this._lfAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent-blue').trim() || '#6488b0';
            this._lfAccentTs = _now;
        }
        const accentBlue = this._lfAccent;
        
        if (!this.cachedResponseFreqs) {
            this.allocateResponseBuffers(numPoints);
        }
        const freqs = this.cachedResponseFreqs;
        const filterMag = this.cachedResponseFilterMag;
        filterMag.fill(1.0);
        
        const magRes = this.cachedResponseMagRes;
        const phaseRes = this.cachedResponsePhaseRes;
        const { main: mainState } = this.getLiveFiltersState();
        const advState = this.getLiveAdvancedFiltersState();
        
        // Calculate exact response over unified 10 parametric bands
        this.bands.forEach((b, i) => {
            const state = mainState[i];
            const f = this.mathFilters[i]; 
            if (f) {
                // Mirror the DSP slope cascade (slope/12 identical sections). Shelves
                // split their gain across sections so the total stays g dB; LP/HP
                // cascades sharpen the roll-off to match the audible graph.
                const cascadeCount = Math.max(1, Math.round((b.slope || 12) / 12));
                const isShelf = (state.type === 'lowshelf' || state.type === 'highshelf');
                f.type = state.type || 'peaking'; 
                f.frequency.value = state.hz;
                f.gain.value = isShelf ? (state.g / cascadeCount) : state.g; 
                f.Q.value = state.q;
                f.getFrequencyResponse(freqs, magRes, phaseRes); 
                for (let k = 0; k < cascadeCount; k++) {
                    for (let j = 0; j < numPoints; j++) filterMag[j] *= magRes[j];
                }
            }
        });

        // Calculate advanced bands response
        this.advancedBands.forEach((b, i) => {
            const state = advState[i];
            const f = this.mathFilters[10 + i];
            if (f) {
                f.type = state.type || 'peaking';
                f.frequency.value = state.hz;
                f.gain.value = state.g;
                f.Q.value = state.q;
                f.getFrequencyResponse(freqs, magRes, phaseRes);
                for (let j = 0; j < numPoints; j++) filterMag[j] *= magRes[j];
            }
        });

        // Map and plot active virtual filters
        if (this.virtualBands) {
            this.virtualBands.forEach((b, i) => {
                const f = this.mathFilters[20 + i];
                if (f) {
                    f.type = b.type || 'peaking';
                    f.frequency.value = b.hz;
                    f.gain.value = b.g;
                    f.Q.value = b.q;
                    f.getFrequencyResponse(freqs, magRes, phaseRes);
                    for (let j = 0; j < numPoints; j++) filterMag[j] *= magRes[j];
                }
            });
        }

        // Map and plot active Fletcher-Munson Equal Loudness filters
        if (this.loudnessActive) {
            const currentVol = parseFloat(document.getElementById("eq-musicVolumeSlider")?.value || 50);
            const volumeDiff = Math.max(0, this.loudnessCalibrationVol - currentVol);
            const bassBoost = (volumeDiff / 100) * 14.0 * (this.loudnessStrength / 100); 
            const trebleBoost = (volumeDiff / 100) * 8.0 * (this.loudnessStrength / 100); 
            
            for (let j = 0; j < numPoints; j++) {
                const f = freqs[j];
                if (bassBoost !== 0) {
                    filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 100, 0.7, bassBoost);
                }
                if (trebleBoost !== 0) {
                    filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 7500, 0.7, trebleBoost);
                }
            }
        }

        if (this.deEsserEnabled && this.deEsserReductionDb !== 0) {
            const activeFreq = this.deEsserCurrentFreq || 6000;
            for (let j = 0; j < numPoints; j++) {
                filterMag[j] *= this.getBiquadMagnitude('peaking', freqs[j], activeFreq, 2.5, this.deEsserReductionDb);
            }
        }

        // Factoring in Master Tone Controls (Bass/Treble)
        const masterBassSlider = document.getElementById("eq-masterBass");
        const rawMasterBass = masterBassSlider ? parseFloat(masterBassSlider.value) : 0;
        const masterBassDb = isNaN(rawMasterBass) ? 0 : rawMasterBass;

        const masterTrebleSlider = document.getElementById("eq-masterTreble");
        const rawMasterTreble = masterTrebleSlider ? parseFloat(masterTrebleSlider.value) : 0;
        const masterTrebleDb = isNaN(rawMasterTreble) ? 0 : rawMasterTreble;

        for (let j = 0; j < numPoints; j++) {
            const f = freqs[j];
            if (masterBassDb !== 0) {
                filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 105, 0.7, masterBassDb);
            }
            if (masterTrebleDb !== 0) {
                filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 8000, 0.7, masterTrebleDb);
            }
        }

        // Real-time visual overlay for Tip Type, Fit Depth, and Seal Quality
        const tip = this.simState.tip;
        const depth = this.simState.depth;
        const seal = this.simState.seal;
        const strength = parseFloat(document.getElementById('sim-tip-strength')?.value || 100) / 100;

        for (let j = 0; j < numPoints; j++) {
            const f = freqs[j];
            let simVal = 1.0;

            if (tip === 'foam') {
                simVal *= this.getBiquadMagnitude('highshelf', f, 6000, 0.7, -3.0 * strength);
            } else if (tip === 'narrow') {
                simVal *= this.getBiquadMagnitude('lowshelf', f, 200, 0.7, 2.0 * strength);
                simVal *= this.getBiquadMagnitude('highshelf', f, 4000, 0.7, -2.5 * strength);
            } else if (tip === 'wide') {
                simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -1.5 * strength);
                simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, 1.5 * strength);
            } else if (tip === 'double') {
                simVal *= this.getBiquadMagnitude('peaking', f, 7000, 2.5, -4.0 * strength);
            } else if (tip === 'triple') {
                simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, -3.5 * strength);
                simVal *= this.getBiquadMagnitude('peaking', f, 8000, 1.5, -2.0 * strength);
            }

            if (depth === 'shallow') {
                simVal *= this.getBiquadMagnitude('peaking', f, 6000, 2.0, 3.0);
                simVal *= this.getBiquadMagnitude('peaking', f, 8500, 2.0, -4.0);
            } else if (depth === 'deep') {
                simVal *= this.getBiquadMagnitude('peaking', f, 8000, 2.0, -4.0);
                simVal *= this.getBiquadMagnitude('peaking', f, 11500, 1.5, 4.0);
            }

            if (seal === 'good') {
                simVal *= this.getBiquadMagnitude('lowshelf', f, 80, 0.7, -2.5);
            } else if (seal === 'loose') {
                simVal *= this.getBiquadMagnitude('lowshelf', f, 150, 0.7, -9.0);
            } else if (seal === 'broken') {
                simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -18.0);
            }

            filterMag[j] *= simVal;
        }

        let maxFilterMag = 0;
        for (let i = 0; i < numPoints; i++) { 
            if (filterMag[i] > maxFilterMag) maxFilterMag = filterMag[i]; 
        }
        
        const rawPreamp = parseFloat(document.getElementById("eq-preampSlider")?.value || 0);
        const preVal = isNaN(rawPreamp) ? 0 : rawPreamp;

        const cv = document.getElementById("eq-largeResponseViz");
        if (!cv) return; // Exit cleanly if canvas is not present
        
        const cc = cv.getContext("2d"); 
        const { w, h } = this.setupDPRCanvas(cv);
        
        // Paint solid matching deep-black background
        cc.fillStyle = "#030305";
        cc.fillRect(0, 0, w, h);

        const preLin = Math.pow(10, preVal / 20); 
        if (!this._largeTotalMag || this._largeTotalMag.length !== numPoints) this._largeTotalMag = new Float32Array(numPoints);
        const totalMag = this._largeTotalMag;
        for (let j = 0; j < numPoints; j++) {
            totalMag[j] = filterMag[j] * preLin;
        }

        const gridFreqs = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000];
        cc.strokeStyle = "rgba(255, 255, 255, 0.05)"; 
        cc.lineWidth = 1;
        
        const isExpandedRight = document.getElementById('viewport-card-right')?.classList.contains('fixed');
        
        gridFreqs.forEach(f => {
            const x = w * (Math.log10(f / 20) / Math.log10(20000 / 20));
            cc.beginPath(); 
            cc.moveTo(x, 0); 
            cc.lineTo(x, h); 
            cc.stroke();
            
            cc.fillStyle = "#6b7280"; 
            cc.font = this.getActiveCanvasFont(8);
            
            const shouldDraw = isExpandedRight ? true : (f === 100 || f === 1000 || f === 10000 || f === 20000);
            
            if (shouldDraw) {
                cc.save();
                if (f === 20) {
                    cc.textAlign = "left";
                    cc.fillText("20", x + 4, h - 6);
                } else {
                    cc.textAlign = "center";
                    const labelMap = {
                        30: "30", 40: "40", 50: "50", 60: "60", 80: "80",
                        100: "100", 150: "150", 200: "200", 300: "300", 400: "400", 500: "500", 600: "600", 800: "800",
                        1000: "1k", 1500: "1.5k", 2000: "2k", 3000: "3k", 4000: "4k", 5000: "5k", 6000: "6k", 8000: "8k",
                        10000: "10k", 15000: "15k", 20000: "20k"
                    };
                    cc.fillText(labelMap[f] || f, x, h - 6);
                }
                cc.restore();
            }
        });

        [-15, -10, -5, 0, 5, 10, 15].forEach(db => {
            const y = (h / 2) - (db / 15) * (h / 2);
            cc.save();
            if (db === 0) {
                cc.strokeStyle = "rgba(255, 255, 255, 0.08)";
                cc.setLineDash([4, 4]);
            } else {
                cc.strokeStyle = "rgba(255, 255, 255, 0.02)";
            }
            cc.beginPath(); 
            cc.moveTo(0, y); 
            cc.lineTo(w, y); 
            cc.stroke();
            cc.restore();
            
            cc.fillStyle = "#6b7280"; 
            cc.font = this.getActiveCanvasFont(8);
            cc.fillText((db > 0 ? "+" : "") + db + " dB", 5, y - 3);
        });

        cc.beginPath(); 
        cc.strokeStyle = accentBlue; 
        cc.lineWidth = 2.5; 
        cc.lineJoin = "round";
        for (let i = 0; i < numPoints; i++) {
            const magDB = 20 * Math.log10(Math.max(1e-10, totalMag[i]));
            const x = w * (Math.log10(freqs[i] / 20) / Math.log10(20000 / 20));
            const y = (h / 2) - (magDB / 15) * (h / 2);
            if (i === 0) cc.moveTo(x, y); 
            else cc.lineTo(x, y);
        }
        cc.stroke();

        // Draw clean 10-band spectrum dots on Large response chart
        this.bands.forEach((b, i) => {
            const hz = parseFloat(document.getElementById("eq-f" + i)?.value || b.hz);
            const g = parseFloat(document.getElementById("eq-s" + i)?.value || 0);
            const isHovered = (this.hoverTarget && this.hoverTarget.type === 'main' && this.hoverTarget.i === i);
            this.drawDot(cc, hz, g, w, h, isHovered, g !== 0, 'main');
        });
    }
};