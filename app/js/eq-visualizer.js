// Split out of eq-core.js (2026 god-file refactor, Step 9).
// Audio visualizer: the fullscreen/main viz rAF loop (startVisualizer) with
// its six canvas renderers (oledSpectrum, oscilloscope, acousticTunnel,
// horizontalSpectrogram, fullScreenWaterfall, audioMesh), the auto-gain
// (prevent-clipping) watchdog interval, and the mode list/index state.
//
// The whole loop ships inside the ORIGINAL single method: every per-frame
// buffer (cachedBars/Peaks/Clips arrays, vintagePeaks, liquidPhase,
// particleArray, the AGC Uint8Arrays) is a local allocated ONCE inside the
// method, exactly as before — extraction does not change any allocation
// behavior, so the redraw path stays GC-pause-identical (no new allocations
// were introduced; drawViz's closure topology is untouched).
//
// this-scoped members used: vizFrameId, vizLoopRunning, agcIntervalId,
// preventClipping, vizModeIndex, vizModes, drawCurve (via _liveDragUntil
// throttling), plus SharedAudio analysers — read at frame time. Names
// unchanged; merged into EQ_Module via Object.assign in db-cache.js.
const EQ_VisualizerMethods = {
        vizModeIndex: 4,
            vizModes: [
                'horizontalSpectrogram', 'fullScreenWaterfall', 'acousticTunnel', 'oledSpectrum', 'oscilloscope', 'audioMesh'
            ],
stopVisualizer: function() {
        // The AGC watchdog must survive background tabs (rAF stops when
        // hidden, so it cannot live in drawViz) — but it must also be
        // stoppable so the 30ms timer doesn't outlive the feature.
        if (this.agcIntervalId) {
            clearInterval(this.agcIntervalId);
            this.agcIntervalId = null;
        }
        if (this.vizFrameId) {
            cancelAnimationFrame(this.vizFrameId);
            this.vizFrameId = null;
        }
        if (this._vizIdleTimer) {
            clearTimeout(this._vizIdleTimer);
            this._vizIdleTimer = null;
        }
        this.vizLoopRunning = false;
    },
startVisualizer: function() {
        if (this.vizFrameId) {
            cancelAnimationFrame(this.vizFrameId);
            this.vizFrameId = null;
        }
        if (this.vizLoopRunning) return;

        if (!this.agcIntervalId) {

            let agcArrayL = new Uint8Array(SharedAudio.analyserL ? SharedAudio.analyserL.frequencyBinCount : 2048);
            let agcArrayR = new Uint8Array(SharedAudio.analyserR ? SharedAudio.analyserR.frequencyBinCount : 2048);
            this.agcIntervalId = setInterval(() => {
                if (document.hidden) return;
                if (EQ_Module.preventClipping && SharedAudio.ctx && SharedAudio.analyserL && SharedAudio.analyserR) {

                    if (agcArrayL.length !== SharedAudio.analyserL.frequencyBinCount) {
                        agcArrayL = new Uint8Array(SharedAudio.analyserL.frequencyBinCount);
                    }
                    if (agcArrayR.length !== SharedAudio.analyserR.frequencyBinCount) {
                        agcArrayR = new Uint8Array(SharedAudio.analyserR.frequencyBinCount);
                    }
                    const arrayL = agcArrayL;
                    const arrayR = agcArrayR;
                    SharedAudio.analyserL.getByteTimeDomainData(arrayL);
                    SharedAudio.analyserR.getByteTimeDomainData(arrayR);

                    let maxL = 0, maxR = 0;
                    for (let i = 0; i < arrayL.length; i++) {
                        const valL = Math.abs(arrayL[i] - 128);
                        const valR = Math.abs(arrayR[i] - 128);
                        if (valL > maxL) maxL = valL;
                        if (valR > maxR) maxR = valR;
                    }

                    const pctL = (maxL / 128) * 100;
                    const pctR = (maxR / 128) * 100;
                    const peakLevel = Math.max(pctL, pctR);

                    if (peakLevel > 94.0) {
                        const excessDb = 20 * Math.log10(peakLevel / 93.0);
                        if (excessDb > 0.1) {
                            const preampSlider = document.getElementById("eq-preampSlider");
                            if (preampSlider) {
                                const currentPreamp = parseFloat(preampSlider.value) || 0;
                                const newPreamp = Math.max(-20, currentPreamp - excessDb);

                                preampSlider.value = newPreamp.toFixed(1);
                                window.isProgrammaticPreampUpdate = true;
                                EQ_Module.updatePreamp();
                                window.isProgrammaticPreampUpdate = false;
                            }
                        }
                    }
                }
            }, 30);
        }

        this.particleArray = [];
            for (let i = 0; i < 220; i++) {
                this.particleArray.push({
                    x: Math.random() * 1200,
                    y: Math.random() * 800,
                    size: Math.random() * 3 + 1.0,
                    speedX: Math.random() * 1.5 - 0.75,
                    speedY: Math.random() * -2.5 - 0.5,
                    hue: Math.random() * 360,
                    alpha: Math.random() * 0.4 + 0.4
                });
            }

            const miniCanvas = document.getElementById("mini-spectrum");
            const miniCtx = miniCanvas ? miniCanvas.getContext("2d") : null;

            const vintagePeaks = new Float32Array(256).fill(0);
            let liquidPhase = 0;

            let cachedBarsL = null, cachedBarsR = null;
            let cachedPeaksL = null, cachedPeaksR = null;
            let cachedClips = null;

            const refreshVizDomCache = () => {
                cachedBarsL = document.getElementsByClassName('meter-bar-l-vu-vu');
                cachedBarsR = document.getElementsByClassName('meter-bar-r-vu-vu');
                cachedPeaksL = document.getElementsByClassName('meter-bar-l-peak-hold');
                cachedPeaksR = document.getElementsByClassName('meter-bar-r-peak-hold');
                cachedClips = document.getElementsByClassName('vu-meter-clipping-text');
            };
            // Live HTMLCollections stay valid across DOM mutations; refresh
            // only the reference when it is null/empty (tab switches rebuild
            // the meter DOM). Callers must use these, not fresh queries.
            const vizBarsL = () => (cachedBarsL && cachedBarsL.length) ? cachedBarsL : (refreshVizDomCache(), cachedBarsL);
            const vizBarsR = () => (cachedBarsR && cachedBarsR.length) ? cachedBarsR : (refreshVizDomCache(), cachedBarsR);
            const vizPeaksL = () => (cachedPeaksL && cachedPeaksL.length) ? cachedPeaksL : (refreshVizDomCache(), cachedPeaksL);
            const vizPeaksR = () => (cachedPeaksR && cachedPeaksR.length) ? cachedPeaksR : (refreshVizDomCache(), cachedPeaksR);
            const vizClips = () => (cachedClips && cachedClips.length) ? cachedClips : (refreshVizDomCache(), cachedClips);
            // Per-frame text/scrub nodes: lazy-cached, revalidated when null.
            // (IDs are static for the app lifetime; null-check suffices.)
            const vizNodes = {};
            const vizNode = (id) => vizNodes[id] || (vizNodes[id] = document.getElementById(id));

            const drawViz = () => {
                if (!cachedBarsL || cachedBarsL.length === 0) {
                    refreshVizDomCache();
                }

                const activeEl = (typeof this._activeEl === 'function' ? this._activeEl() : null) || this.audioEl;
                const isSoundActive = (activeEl && !activeEl.paused) ||
                                     (this.gaplessEl && !this.gaplessEl.paused) ||
                                     (window.Tone && Tone.osc) ||
                                     (window.TestLab && (TestLab.activeNodes.length > 0 || TestLab.hearingOsc || TestLab.channelToneOsc));

                if (!isSoundActive) {
                // Keep loop alive at low polling rate instead of killing it — killing required a
                // future play event to restart, but a gap between tracks or a brief pause during
                // crossfade could strand the visualizer blank until manual pause/unpause.
                const barsL = vizBarsL();
                const barsR = vizBarsR();
                for (let i = 0; i < barsL.length; i++) barsL[i].style.width = "0%";
                for (let i = 0; i < barsR.length; i++) barsR[i].style.width = "0%";
                const peaksL = vizPeaksL();
                const peaksR = vizPeaksR();
                for (let i = 0; i < peaksL.length; i++) peaksL[i].style.left = "0%";
                for (let i = 0; i < peaksR.length; i++) peaksR[i].style.left = "0%";
                this.peakL = 0;
                this.peakR = 0;
                const imbalanceL = vizNode('imbalance-meter-l');
                const imbalanceR = vizNode('imbalance-meter-r');
                if (imbalanceL) imbalanceL.style.width = "0%";
                if (imbalanceR) imbalanceR.style.width = "0%";
                this.meterCurrentL = 0;
                this.meterCurrentR = 0;
                // Throttle idle polling to 10 Hz instead of 60 Hz to save CPU while silent,
                // but keep vizLoopRunning true so tab switch while music playing never sees a dead loop.
                this.vizLoopRunning = true;
                if (this._vizIdleTimer) clearTimeout(this._vizIdleTimer);
                this._vizIdleTimer = setTimeout(() => {
                    this.vizFrameId = requestAnimationFrame(drawViz);
                }, 100);
                return;
            }

            this.vizLoopRunning = true;
            if (this._vizIdleTimer) { clearTimeout(this._vizIdleTimer); this._vizIdleTimer = null; }
            this.vizFrameId = requestAnimationFrame(drawViz);

            // While the user is scrubbing/dragging a slider, skip the heavy
            // viz work on most frames so the drag keeps its frame budget;
            // meters freeze imperceptibly (decay smoothing hides ~30ms gaps).
            if (this.isSeeking) {
                const nowMs = performance.now();
                if (this._vizSeekThrottle === undefined || nowMs - this._vizSeekThrottle >= 34) {
                    this._vizSeekThrottle = nowMs;
                } else {
                    return;
                }
            } else {
                this._vizSeekThrottle = undefined;
            }

                const bufferLength = SharedAudio.analyser ? SharedAudio.analyser.frequencyBinCount : 1024;
                if (!this.cachedDataArray || this.cachedDataArray.length !== bufferLength) {
                    this.cachedDataArray = new Uint8Array(bufferLength);
                    this.cachedTimeDomain = new Uint8Array(bufferLength);
                }
                const dataArray = this.cachedDataArray;
                const timeDomain = this.cachedTimeDomain;

                let hasData = false;
                if (SharedAudio.analyser) {
                    SharedAudio.analyser.getByteFrequencyData(dataArray);
                    SharedAudio.analyser.getByteTimeDomainData(timeDomain);

                    const threshold = 5;
                    for (let i = 0; i < bufferLength; i++) {
                        if (dataArray[i] > threshold || Math.abs(timeDomain[i] - 128) > threshold) {
                            hasData = true;
                            break;
                        }
                    }
                }

                if (!this.previousDataArray || this.previousDataArray.length !== bufferLength) {
                    this.previousDataArray = new Uint8Array(bufferLength);
                }

                if (hasData) {
                this.previousDataArray.set(dataArray);
            }

                if (this.showSpectrumOverlay) {
                    this.drawCurve();
                }

                if (!hasData) {
                    const time = Date.now() * 0.0025;
                    for (let i = 0; i < bufferLength; i++) {
                        timeDomain[i] = 128 + Math.sin(i * 0.035 + time) * 30 * Math.sin(time * 0.2);

                        const weight = Math.pow((i / bufferLength), 1.5);
                        const baseValue = 45 + Math.sin(i * 0.06 - time) * 20;
                        const freqResponse = Math.sin(i * 0.035 + time) * 30 * Math.sin(time * 0.2);

                        dataArray[i] = Math.max(0, baseValue * (1 - weight) + freqResponse * weight);
                    }
                }

            if (SharedAudio.analyserL && SharedAudio.analyserR) {
                const binCountL = SharedAudio.analyserL.frequencyBinCount;
                const binCountR = SharedAudio.analyserR.frequencyBinCount;
                if (!this.cachedArrayL || this.cachedArrayL.length !== binCountL) {
                    this.cachedArrayL = new Uint8Array(binCountL);
                }
                if (!this.cachedArrayR || this.cachedArrayR.length !== binCountR) {
                    this.cachedArrayR = new Uint8Array(binCountR);
                }
                const arrayL = this.cachedArrayL;
                const arrayR = this.cachedArrayR;
                SharedAudio.analyserL.getByteTimeDomainData(arrayL);
                SharedAudio.analyserR.getByteTimeDomainData(arrayR);

                let maxL = 0, maxR = 0;
                for (let i = 0; i < arrayL.length; i++) {
                    const valL = Math.abs(arrayL[i] - 128);
                    const valR = Math.abs(arrayR[i] - 128);
                    if (valL > maxL) maxL = valL;
                    if (valR > maxR) maxR = valR;
                }

                let pctL = (maxL / 128) * 100;
                let pctR = (maxR / 128) * 100;
                if (pctL < 1.0) pctL = 0;
                if (pctR < 1.0) pctR = 0;

                if (this.meterCurrentL === undefined) this.meterCurrentL = 0;
                if (this.meterCurrentR === undefined) this.meterCurrentR = 0;

                const decayFactor = 0.92;
                this.meterCurrentL = (this.meterCurrentL || 0) * decayFactor + pctL * (1 - decayFactor);
                this.meterCurrentR = (this.meterCurrentR || 0) * decayFactor + pctR * (1 - decayFactor);

                if (isNaN(this.meterCurrentL)) this.meterCurrentL = 0;
                if (isNaN(this.meterCurrentR)) this.meterCurrentR = 0;

                if (this.meterCurrentL < 0.5) this.meterCurrentL = 0;
                if (this.meterCurrentR < 0.5) this.meterCurrentR = 0;

                const diffL = Math.abs(this.meterCurrentL - (this.lastMeterL || 0));
                const diffR = Math.abs(this.meterCurrentR - (this.lastMeterR || 0));

                if (diffL > 0.4) {
                    this.lastMeterL = this.meterCurrentL;
                    const barsL = vizBarsL();
                    const targetWidth = this.meterCurrentL.toFixed(1) + "%";
                    for (let i = 0; i < barsL.length; i++) {
                        barsL[i].style.width = targetWidth;
                    }
                }
if (diffR > 0.4) {
                    this.lastMeterR = this.meterCurrentR;
                    const barsR = vizBarsR();
                    const targetWidth = this.meterCurrentR.toFixed(1) + "%";
                    for (let i = 0; i < barsR.length; i++) {
                        barsR[i].style.width = targetWidth;
                    }
                }

                const curTime = Date.now();
                const holdDuration = 1000;
                const decaySpeed = 1.2;

                if (this.meterCurrentL >= (this.peakL || 0)) {
                    this.peakL = this.meterCurrentL;
                    this.peakTimeL = curTime;
                } else {
                    if (curTime - (this.peakTimeL || 0) > holdDuration) {
                        this.peakL = Math.max(0, this.peakL - decaySpeed);
                    }
                }

                if (this.meterCurrentR >= (this.peakR || 0)) {
                    this.peakR = this.meterCurrentR;
                    this.peakTimeR = curTime;
                } else {
                    if (curTime - (this.peakTimeR || 0) > holdDuration) {
                        this.peakR = Math.max(0, this.peakR - decaySpeed);
                    }
                }

                const peaksHoldL = vizPeaksL();
                const targetPeakLeft = this.peakL.toFixed(1) + "%";
                for (let i = 0; i < peaksHoldL.length; i++) {
                    peaksHoldL[i].style.left = targetPeakLeft;
                }

                const peaksHoldR = vizPeaksR();
                const targetPeakRight = this.peakR.toFixed(1) + "%";
                for (let i = 0; i < peaksHoldR.length; i++) {
                    peaksHoldR[i].style.left = targetPeakRight;
                }

                const currentAutoGain = (SharedAudio.autoGainNode) ? SharedAudio.autoGainNode.gain.value : 1.0;
                const reductionDb = 20 * Math.log10(currentAutoGain);
                const isAttenuationActive = (reductionDb < -0.15);

                const clippingTexts = vizClips();
                for (let i = 0; i < clippingTexts.length; i++) {
                    const el = clippingTexts[i];

                    // Only swap the state classes — never replace className, or the
                    // fixed width (w-16 / min-w-[64px]) gets stripped and the footer
                    // right group reflows (scrub + peak meter jump right).
                    el.classList.remove('text-emerald-400', 'text-amber-500', 'text-rose-500', 'animate-pulse', 'cursor-pointer');

                    if (isAttenuationActive) {
                        el.textContent = `${reductionDb.toFixed(1)} dB`;
                        el.classList.add('text-amber-500', 'animate-pulse', 'cursor-pointer');
                        el.title = "Anti-Clip AGC active. Automatically maintaining headroom.";
                    } else {
                        el.title = "";
                        if (this.meterCurrentL > 94 || this.meterCurrentR > 94) {
                            el.textContent = "⚡ Clipping";
                            el.classList.add('text-rose-500', 'animate-pulse');
                        } else if (this.meterCurrentL > 75 || this.meterCurrentR > 75) {
                            el.textContent = "⚠️ Warning";
                            el.classList.add('text-amber-500');
                        } else {
                            el.textContent = "Stable";
                            el.classList.add('text-emerald-400');
                        }
                    }
                }
            }

                if (isSoundActive && !Mascot.isGeniusActive && !Mascot.isOverrideActive && Mascot.currentExpression !== 'deaf' && Mascot.currentExpression !== 'mute' && !(window.TestLab && (TestLab.leakTestActive || TestLab.channelToneOsc || TestLab.resonanceActive || TestLab.hearingOsc)) && !(window.Tone && Tone.osc)) {

                    if (Mascot.currentExpression !== 'vibing') {
                        Mascot.setExpression('vibing');
                    }

                    var overallVolume = getBandEnergy(dataArray, 0, 256);
                    var intensity = Math.min(1, overallVolume * 1.6);
                    Mascot.applyReactiveAnimation('vibing', intensity);
                }

                if (this.deEsserEnabled) {

                    let midSum = 0;
                    // FFT-bin geometry must be derived from the live context.
                    // The old hardcoded values (23/93/186/372, binWidth 21.53)
                    // assumed 44.1 kHz + fftSize 2048; at 48 kHz they shifted the
                    // scan window to ~4.4-8.7 kHz and mislocated sibilance peaks
                    // by ~9% (bin 280 is 6563 Hz real vs 6028 Hz computed).
                    // These formulas reproduce the old bins exactly at 44.1 kHz:
                    // round(500/21.53)=23, round(2000/21.53)=93,
                    // round(4000/21.53)=186, round(8000/21.53)=372.
                    const deEsserSr = (SharedAudio.ctx && SharedAudio.ctx.sampleRate) || 44100;
                    const deEsserFft = (SharedAudio.analyser && SharedAudio.analyser.fftSize) || 2048;
                    const binWidth = deEsserSr / deEsserFft;
                    const midStartBin = Math.max(1, Math.round(500 / binWidth));
                    const midEndBin = Math.min(dataArray.length - 1, Math.round(2000 / binWidth));
                    for (let i = midStartBin; i < midEndBin; i++) {
                        midSum += dataArray[i];
                    }
                    const midAverage = midSum / (midEndBin - midStartBin) / 255;

                    let maxVal = 0;
                    let peakBin = Math.round(6000 / binWidth);
                    const startBin = Math.max(1, Math.round(4000 / binWidth));
                    const endBin = Math.min(dataArray.length - 1, Math.round(8000 / binWidth));
                    for (let i = startBin; i < endBin; i++) {
                        if (dataArray[i] > maxVal) {
                            maxVal = dataArray[i];
                            peakBin = i;
                        }
                    }
                    const sibilancePeak = maxVal / 255;

                    const relativeMargin = 0.08;
                    const isSibilant = (sibilancePeak > (midAverage + relativeMargin)) && (sibilancePeak > 0.12);
                    const lastReduction = this.deEsserReductionDb;
                    // Compare against the PREVIOUS frame's tracked value. The old
                    // source here was the static deEsserFilter placeholder
                    // (always 6000), so once deEsserCurrentFreq settled anywhere
                    // else, freqChanged stayed true every frame and redrew the
                    // full graph at ~60 fps for as long as playback ran.
                    const lastFreq = Number.isFinite(this.deEsserCurrentFreq) ? this.deEsserCurrentFreq : 6000;

                    let targetFreq = 6000;
                    let targetGain = 0;

                    if (isSibilant) {
                        const excess = sibilancePeak - (midAverage + relativeMargin);
                        const scaleFactor = Math.min(1.0, excess * 15.0);
                        const maxClampDb = 15.0;
                        targetGain = -scaleFactor * maxClampDb * (this.deEsserSensitivity / 100);
                        targetFreq = Math.round(peakBin * binWidth);
                    } else {
                        targetGain = 0;
                        targetFreq = 6000;
                    }

                    if (this.deEsserCurrentFreq === undefined) this.deEsserCurrentFreq = 6000;
                    if (this.deEsserCurrentGain === undefined) this.deEsserCurrentGain = 0;

                    this.deEsserCurrentFreq += 0.45 * (targetFreq - this.deEsserCurrentFreq);
                    this.deEsserCurrentGain += 0.70 * (targetGain - this.deEsserCurrentGain);

                    this.deEsserReductionDb = this.deEsserCurrentGain;

                    const gainDiff = Math.abs(this.deEsserReductionDb - (this.lastSentDeEsserGain || 0));
                    const freqDiff = Math.abs(this.deEsserCurrentFreq - (this.lastSentDeEsserFreq || 6000));

                    if (gainDiff > 0.15 || freqDiff > 50) {
                        this.lastSentDeEsserGain = this.deEsserReductionDb;
                        this.lastSentDeEsserFreq = this.deEsserCurrentFreq;

                        if (SharedAudio.workletNode) {
                            SharedAudio.workletNode.port.postMessage({
                                type: 'updateSimulations',
                                sims: [{
                                    index: 5,
                                    bypassed: !this.deEsserEnabled,
                                    filterType: 'peaking',
                                    frequency: this.deEsserCurrentFreq,
                                    gain: this.deEsserReductionDb,
                                    q: 2.5
                                }]
                            });
                        }
                    }

                    const freqChanged = Math.abs(lastFreq - this.deEsserCurrentFreq) > 20;
                    const gainChanged = Math.abs(lastReduction - this.deEsserCurrentGain) > 0.05;

                    if (gainChanged || freqChanged) {
                        this.drawCurve();
                    }
                } else {
                    if (this.deEsserReductionDb !== 0) {
                        this.deEsserReductionDb = 0;

                        if (SharedAudio.workletNode) {
                            SharedAudio.workletNode.port.postMessage({
                                type: 'updateSimulations',
                                sims: [{
                                    index: 5,
                                    bypassed: true,
                                    filterType: 'peaking',
                                    frequency: 6000,
                                    gain: 0,
                                    q: 2.5
                                }]
                            });
                        }
                        this.drawCurve();
                    }
                }

                const modalTimeCur = vizNode('modal-time-current');
                const timeCur = vizNode('playlist-time-current');
                const scrub = vizNode('playlist-scrub');
                const modalScrub = vizNode('modal-scrub');
                const timeDur = vizNode('playlist-time-duration');
                const modalTimeDur = vizNode('modal-time-duration');

                const mainTrackName = vizNode("playlist-track-info");
                const modalTrackName = vizNode("modal-track-name");
                if (mainTrackName && modalTrackName && modalTrackName.textContent !== mainTrackName.textContent) {
                    modalTrackName.textContent = mainTrackName.textContent;
                }

                const vizActiveEl = (typeof this._activeEl === 'function' ? this._activeEl() : null) || this.audioEl;
                if (vizActiveEl && !this.isSeeking) {
                    const formattedCur = this.formatTime(vizActiveEl.currentTime);
                    const mobTimeCur = vizNode('mobile-time-current');
                    const mobScrub = vizNode('mobile-scrub');
                    const mobTimeDur = vizNode('mobile-time-duration');

                    if (timeCur) timeCur.textContent = formattedCur;
                    if (mobTimeCur) mobTimeCur.textContent = formattedCur;
                    if (modalTimeCur) modalTimeCur.textContent = formattedCur;

                    if (vizActiveEl.duration) {
                        const pct = (vizActiveEl.currentTime / vizActiveEl.duration) * 100;
                        if (scrub) scrub.value = pct;
                        if (mobScrub) mobScrub.value = pct;
                        if (modalScrub) modalScrub.value = pct;

                        const formattedDur = this.formatTime(vizActiveEl.duration);
                        if (timeDur) timeDur.textContent = formattedDur;
                        if (mobTimeDur) mobTimeDur.textContent = formattedDur;
                        if (modalTimeDur) modalTimeDur.textContent = formattedDur;
                    }
                }

                if (miniCtx && miniCanvas) {
                    const mw = miniCanvas.width;
                    const mh = miniCanvas.height;
                    miniCtx.clearRect(0, 0, mw, mh);
                    miniCtx.strokeStyle = "rgba(37, 99, 235, 0.85)";
                    miniCtx.lineWidth = 2.0;
                    miniCtx.beginPath();

                    const step = 16;
                    const sliceWidth = (mw / bufferLength) * step;
                    let x = 0;
                    for (let i = 0; i < bufferLength; i += step) {
                        const v = timeDomain[i] / 128.0;
                        const y = (v * mh) / 2;
                        if (i === 0) miniCtx.moveTo(x, y);
                        else miniCtx.lineTo(x, y);
                        x += sliceWidth;
                    }
                    miniCtx.stroke();
                }

                if (!EQ_Module.fullscreenVizCanvas) {
                    EQ_Module.fullscreenVizCanvas = document.getElementById("fullscreen-viz-canvas");
                    if (EQ_Module.fullscreenVizCanvas) {
                        EQ_Module.fullscreenVizCtx = EQ_Module.fullscreenVizCanvas.getContext("2d");
                    }
                }

                const fcv = EQ_Module.fullscreenVizCanvas;
                const fctx = EQ_Module.fullscreenVizCtx;
                const paneViz = vizNode('pane-visualizer');
                const isVizTabActive = !paneViz || !paneViz.classList.contains('hidden');

                if ((EQ_Module.vizModalActive || isVizTabActive) && fcv && fctx) {
                    const clientW = fcv.clientWidth || 800;
                    const clientH = fcv.clientHeight || 600;

                    // Internal render resolution: 0.66 (vs 0.75) cuts every custom
                    // effect's fill/path cost ~25-35% with no layout change, at full
                    // rAF rate (no frame skipping).
                    const renderScale = 0.66;
                    const targetW = Math.floor(clientW * renderScale);
                    const targetH = Math.floor(clientH * renderScale);

                    if (fcv.width !== targetW || fcv.height !== targetH) {
                        fcv.width = targetW;
                        fcv.height = targetH;
                    }

                    const w = fcv.width;
                    const h = fcv.height;

                    // Single folded pass: fixed ranges mirror the old loops
                    // exactly (sub 1-4 /4, mid 5-186 /182, treb 187-N,
                    // total 0-N — including out-of-range reads as 0 via
                    // `|| 0` on degenerate tiny buffers), so results match
                    // bit-for-bit with 4x fewer iterations.
                    let subBassSum = 0, midSum = 0, trebSum = 0, trebN = 0, totSum = 0;
                    const foldEnd = Math.max(bufferLength, 187);
                    for (let i = 0; i < foldEnd; i++) {
                        const v = dataArray[i] || 0;
                        if (i < bufferLength) totSum += v;
                        if (i >= 1 && i <= 4) subBassSum += v;
                        else if (i >= 5 && i <= 186) midSum += v;
                        else if (i >= 187 && i < bufferLength) { trebSum += v; trebN++; }
                    }
                    let subBass = (subBassSum / 4) / 255;
                    let midrange = (midSum / 182) / 255;
                    let treble = trebN > 0 ? (trebSum / trebN) / 255 : 0;
                    let totalEnergy = (totSum / bufferLength) / 255;
                    if (!Number.isFinite(subBass)) subBass = 0;
                    if (!Number.isFinite(midrange)) midrange = 0;
                    if (!Number.isFinite(treble)) treble = 0;
                    if (!Number.isFinite(totalEnergy)) totalEnergy = 0;

                    // Theme lookup + hex→rgb conversion are loop-invariant per
                    // theme. Resolve once and cache; App.setGlobalTheme bumps
                    // _vizThemeDirty so a live theme switch re-resolves on the
                    // next frame instead of paying localStorage + parse costs
                    // at 60 fps.
                    if (!this._vizTheme || this._vizThemeDirty) {
                        const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                        const activeThemeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                        const accent = activeThemeConfig.accent === '#ffffff' ? '#ffffff' : (activeThemeConfig.accent || "#787878");
                        this._vizTheme = { accent: accent, rgb: PEQDB_Module.hexToRgb(accent) };
                        this._vizThemeDirty = false;
                    }
                    const themeAccent = this._vizTheme.accent;
                    const themeRgb = this._vizTheme.rgb;

                    const mode = EQ_Module.vizModes[EQ_Module.vizModeIndex];

                    if (EQ_Module.customEffects && EQ_Module.customEffects[mode]) {
                        try {
                            const bassIntensity = subBass;
                            EQ_Module.customEffects[mode](fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble);
                        } catch (err) {
                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);
                        }
                        return;
                    }

                    switch (mode) {
                        case 'oledSpectrum': {

                        fctx.fillStyle = '#000000';
                        fctx.fillRect(0, 0, w, h);

                        const barCount = 48;
                        const barWidth = w / barCount;
                        const rgb = themeRgb;

                        if (!this.vintagePeaks || this.vintagePeaks.length !== barCount) {
                            this.vintagePeaks = new Float32Array(barCount).fill(0);
                        }

                        const gradKey = `${w}-${h}-${themeAccent}`;
                        if (this.lastGradKey !== gradKey || !this.cachedOledGrad) {
                            this.lastGradKey = gradKey;
                            const masterGrad = fctx.createLinearGradient(0, h, 0, 0);
                            masterGrad.addColorStop(0, `rgba(${rgb}, 0.05)`);
                            masterGrad.addColorStop(0.5, `rgba(${rgb}, 0.4)`);
                            masterGrad.addColorStop(1, themeAccent);
                            this.cachedOledGrad = masterGrad;
                        }
                        const masterGrad = this.cachedOledGrad;

                        for (let i = 0; i < barCount; i++) {
                                const dataIdx = Math.floor(Math.pow(i / barCount, 1.4) * (bufferLength * 0.45));
                                const amp = (dataArray[dataIdx] || 0) / 255;
                                const barHeight = amp * h * 0.85;

                                if (barHeight > this.vintagePeaks[i]) {
                                    this.vintagePeaks[i] = barHeight;
                                } else {
                                    this.vintagePeaks[i] = Math.max(0, this.vintagePeaks[i] - 3.0);
                                }

                                fctx.fillStyle = masterGrad;
                                fctx.fillRect(i * barWidth + 1.5, h - barHeight, barWidth - 3, barHeight);

                                fctx.fillStyle = '#ffffff';
                                fctx.fillRect(i * barWidth + 1.5, h - this.vintagePeaks[i] - 4, barWidth - 3, 2);
                            }
                            break;
                        }

                        case 'oscilloscope': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            fctx.strokeStyle = themeAccent;
                            fctx.lineWidth = 2.5;
                            fctx.beginPath();

                            const sliceWidth = w / bufferLength;
                            let x = 0;

                            for (let i = 0; i < bufferLength; i++) {
                                const v = (timeDomain[i] || 128) / 128.0;
                                const y = (v * h) / 2;

                                if (i === 0) fctx.moveTo(x, y);
                                else fctx.lineTo(x, y);

                                x += sliceWidth;
                            }
                            fctx.stroke();
                            break;
                        }

                        case 'acousticTunnel': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            const ringCount = 10;
                            const cx = w / 2;
                            const cy = h / 2;
                            const rgb = themeRgb;
                            const maxRadius = Math.hypot(cx, cy);

                            if (this.tunnelPhase === undefined) this.tunnelPhase = 0;
                            this.tunnelPhase += 0.012 + subBass * 0.035;

                            fctx.save();
                            fctx.lineWidth = 1.8;

                            for (let i = 0; i < ringCount; i++) {
                                const ringRatio = ((i + (this.tunnelPhase % 1)) / ringCount);
                                const radius = ringRatio * maxRadius;

                                const opacity = Math.sin(ringRatio * Math.PI) * (0.2 + midrange * 0.5);

                                fctx.strokeStyle = `rgba(${rgb}, ${opacity})`;
                                fctx.beginPath();

                                const points = 120;
                                if (!this.lutCos || this.lutCos.length !== points + 1) {
                                    this.lutCos = new Float32Array(points + 1);
                                    this.lutSin = new Float32Array(points + 1);
                                    for (let k = 0; k <= points; k++) {
                                        const angle = k * ((Math.PI * 2) / points);
                                        this.lutCos[k] = Math.cos(angle);
                                        this.lutSin[k] = Math.sin(angle);
                                    }
                                }

                                for (let k = 0; k <= points; k++) {

                                    const waveIdx = Math.floor((k % points) * (bufferLength / points));
                                    const waveVal = ((timeDomain[waveIdx] || 128) - 128) / 128.0;

                                    const ripple = waveVal * 45 * ringRatio * (1.0 + subBass * 1.5);

                                    const rx = cx + this.lutCos[k] * (radius + ripple);
                                    const ry = cy + this.lutSin[k] * (radius + ripple);

                                    if (k === 0) fctx.moveTo(rx, ry);
                                    else fctx.lineTo(rx, ry);
                                }
                                fctx.closePath();
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }

						                    case 'horizontalSpectrogram': {
                        if (!this.horizSpectrogramCanvas) {
                            this.horizSpectrogramCanvas = document.createElement('canvas');
                            this.horizSpectrogramCanvas.width = 600;
                            this.horizSpectrogramCanvas.height = 400;
                            this.horizSpectrogramCtx = this.horizSpectrogramCanvas.getContext('2d');
                            this.horizSpectrogramCtx.fillStyle = '#000000';
                            this.horizSpectrogramCtx.fillRect(0, 0, 600, 400);
                        }

                        const hCvs = this.horizSpectrogramCanvas;
                        const hCtx = this.horizSpectrogramCtx;
                        const speed = 3;

                        hCtx.drawImage(hCvs, speed, 0, hCvs.width - speed, hCvs.height, 0, 0, hCvs.width - speed, hCvs.height);

                        hCtx.fillStyle = '#000000';
                        hCtx.fillRect(hCvs.width - speed, 0, speed, hCvs.height);

                        const numBins = hCvs.height;
                        const rgb = themeRgb;

                        const startBin = 3;
                        const maxMappedBin = Math.floor(bufferLength * 0.42);

                        for (let y = 0; y < numBins; y++) {

                            const normY = y / numBins;

                            const logScale = Math.pow(normY, 1.35);
                            const dataIdx = startBin + Math.floor(logScale * (maxMappedBin - startBin));

                            const amp = (dataArray[dataIdx] || 0) / 255;
                            if (amp > 0.01) {

                                if (amp > 0.88) {
                                    hCtx.fillStyle = `rgba(255, 255, 255, ${(amp - 0.8) * 5})`;
                                } else {
                                    hCtx.fillStyle = `rgba(${rgb}, ${amp})`;
                                }
                                hCtx.fillRect(hCvs.width - speed, y, speed, 1);
                            }
                        }

                        fctx.fillStyle = '#000000';
                        fctx.fillRect(0, 0, w, h);
                        fctx.drawImage(hCvs, 0, 0, hCvs.width, hCvs.height, 0, 0, w, h);
                        break;
                    }

                        case 'fullScreenWaterfall': {
                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            if (!this.fullWaterfallHistory) {
                                this.fullWaterfallHistory = [];
                                for (let i = 0; i < 40; i++) {
                                    this.fullWaterfallHistory.push(new Float32Array(80).fill(0));
                                }
                            }

                            const recycledArray = this.fullWaterfallHistory.pop();
                            for (let i = 0; i < 80; i++) {
                                recycledArray[i] = (dataArray[Math.floor(i * (bufferLength / 80))] / 255);
                            }
                            this.fullWaterfallHistory.unshift(recycledArray);

                            const rows = this.fullWaterfallHistory.length;
                            const cols = 80;

                            fctx.save();
                            fctx.lineWidth = 1.5;

                            for (let r = rows - 1; r >= 0; r--) {
                                const z = r / (rows - 1);

                                const rowY = 15 + ((1 - z) * (h - 30));
                                const stepX = w / (cols - 1);

                                const frame = this.fullWaterfallHistory[r];
                                const opacity = 0.2 + z * 0.8;
                                const colorRgb = themeRgb;

                                fctx.strokeStyle = `rgba(${colorRgb}, ${opacity})`;
                                fctx.fillStyle = '#000000';

                                fctx.beginPath();
                                fctx.moveTo(0, h);
                                for (let c = 0; c < cols; c++) {
                                    const amp = frame[c];
                                    const px = c * stepX;
                                    const py = rowY - (amp * (h / 7));
                                    fctx.lineTo(px, py);
                                }
                                fctx.lineTo(w, h);
                                fctx.closePath();
                                fctx.fill();

                                fctx.beginPath();
                                for (let c = 0; c < cols; c++) {
                                    const amp = frame[c];
                                    const px = c * stepX;
                                    const py = rowY - (amp * (h / 7));
                                    if (c === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }

                        case 'audioMesh': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            fctx.save();
                            const rgb = themeRgb;
                            fctx.strokeStyle = `rgba(${rgb}, ${0.15 + midrange * 0.35})`;
                            fctx.lineWidth = 1.2;

                            const meshRows = 12;
                            const meshCols = 18;
                            const stepX = w / (meshCols - 1);
                            const stepY = h / (meshRows - 1);

                            for (let r = 0; r < meshRows; r++) {
                                fctx.beginPath();
                                const rowRatio = r / (meshRows - 1);

                                const baseDepthY = rowRatio * h;

                                for (let c = 0; c < meshCols; c++) {
                                    const bin = Math.floor((c / meshCols) * (bufferLength * 0.42));
                                    const amp = (dataArray[bin] || 0) / 255;

                                    const elevation = amp * 75 * Math.sin(rowRatio * Math.PI) * (1.0 + subBass);
                                    const px = c * stepX;
                                    const py = baseDepthY - elevation;

                                    if (c === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }

                            for (let c = 0; c < meshCols; c++) {
                                fctx.beginPath();
                                for (let r = 0; r < meshRows; r++) {
                                    const rowRatio = r / (meshRows - 1);
                                    const baseDepthY = rowRatio * h;
                                    const bin = Math.floor((c / meshCols) * (bufferLength * 0.42));
                                    const amp = (dataArray[bin] || 0) / 255;

                                    const elevation = amp * 75 * Math.sin(rowRatio * Math.PI) * (1.0 + subBass);
                                    const px = c * stepX;
                                    const py = baseDepthY - elevation;

                                    if (r === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }
                    }

                    if (window.mushroomSporesActive) {
                        if (!this.sporeParticles || this.sporeParticles.length === 0) {
                            this.sporeParticles = [];
                            for (let i = 0; i < 40; i++) {
                                this.sporeParticles.push({
                                    x: Math.random() * w,
                                    y: h + Math.random() * 100,
                                    size: Math.random() * 3 + 1,
                                    speedY: Math.random() * -0.8 - 0.3,
                                    wobble: Math.random() * Math.PI
                                });
                            }
                        }

                        // Hoisted canvas state: shadowBlur is one of the most
                        // expensive states — set once per frame, not per particle.
                        fctx.save();
                        const themeColor = themeAccent || "#3b82f6";
                        fctx.fillStyle = themeColor;
                        fctx.shadowBlur = 6;
                        fctx.shadowColor = themeColor;
                        fctx.globalAlpha = 0.25 + (treble * 0.5);
                        this.sporeParticles.forEach(spore => {
                            spore.y += spore.speedY;
                            spore.wobble += 0.02;

                            const dx = spore.x + Math.sin(spore.wobble) * 15;

                            if (spore.y < -10) {
                                spore.y = h + 10;
                                spore.x = Math.random() * w;
                            }

                            fctx.beginPath();
                            fctx.arc(dx, spore.y, spore.size, 0, Math.PI * 2);
                            fctx.fill();
                        });
                        fctx.restore();
                    }
                }
            };
            drawViz();
        },
};
