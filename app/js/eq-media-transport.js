// Split out of eq-core.js (2026 god-file refactor, Step 7).
// Media transport wiring: the <audio> element + gapless-standby element
// listeners (play/pause/ended buttons + Mascot/reverb hooks + safety-net
// MediaElementSource boot), the local-file input, and the playback scrub
// machinery (per-frame rAF ticker, per-element seek binding, time displays).
//
// Everything ships inside ONE method, attachMediaTransport(), because the
// block's helper closures (updateScrubDisplay / attachTimeUpdate /
// startSeek / bindScrubEvents / paintPlaybackScrub + the _scrubStuckWarn
// counter) close over each other — hoisting them to methods would change
// the closure topology. The method body IS the original init block, so the
// closures are preserved exactly. Idempotent: safe to call once at boot
// (init does exactly that, in the same sequence position as before).
//
// this-scoped state used/owned: audioEl, gaplessEl, isSeeking, _scrubRaf,
// connected, source, sourceGain, inputGainNode, vizLoopRunning (read),
// plus _activeEl/nextTrack/formatTime/performCleanSeek/handleAudioFileSelection/
// ensureDSPGraph/startVisualizer — all merged EQ_Module members. Names
// unchanged; attached via Object.assign in db-cache.js.
const EQ_MediaTransportMethods = {
    _mediaTransportAttached: false,
    attachMediaTransport: function() {
        if (this._mediaTransportAttached) return;
        this._mediaTransportAttached = true;
        this.audioEl = document.getElementById("eq-audio");
        // Gapless/crossfade standby element ("B" arm). Grabbed here so the
        // timeupdate/durationchange listeners below bind at boot; its
        // MediaElementSource + gain arm are created later in _buildDSPGraph.
        this.gaplessEl = document.getElementById("eq-audio-gapless");
        if (!this.audioEl) {
            console.error("[EQ_Module.init] #eq-audio element not found — audio playback wiring skipped.");
        } else {
                this.audioEl.volume = 0.5;
                this.audioEl.preservesPitch = true;

                this.audioEl.addEventListener('volumechange', () => {

                });

                this.audioEl.onplay = async () => {
                    Mascot.update();

                    const btn = document.getElementById("playlist-play-btn");
                    const mobBtn = document.getElementById("mobile-play-btn");
                    if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                    if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                    const modalBtn = document.getElementById("modal-play-btn");
                    if(modalBtn) modalBtn.innerHTML = "<span>⏸</span><span>Pause</span>";

                    if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        await SharedAudio.ctx.resume();
                    }
                    // On the normal path the MediaElementSource is created once in
                    // ensureDSPGraph() before any playback starts (that's what fixes
                    // the boot-mute). This branch is only a safety net for the rare
                    // case where the graph was built without the element present.
                    if(!this.connected) {
                        await this.ensureDSPGraph();
                        if (!this.source && this.audioEl && SharedAudio.ctx && this.inputGainNode) {
                            this.source = SharedAudio.ctx.createMediaElementSource(this.audioEl);
                            // Route through the same gain arm _buildDSPGraph uses
                            // so per-track loudness match applies on this path too.
                            if (!this.sourceGain) {
                                this.sourceGain = SharedAudio.ctx.createGain();
                                this.sourceGain.gain.value = Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1));
                            }
                            this.source.connect(this.sourceGain);
                            this.sourceGain.connect(this.inputGainNode);
                        }
                        if (this.audioEl) this.audioEl.volume = 1.0;
                        this.connected = true;
                    }

                    if (!this.vizLoopRunning) {
                        this.startVisualizer();
                    }
                };
                this.audioEl.addEventListener('play', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                });
                this.audioEl.addEventListener('pause', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                    // Update play button if both elements are paused (gapless may still be playing)
                    const active = this._activeEl ? this._activeEl() : this.audioEl;
                    const gaplessPaused = !this.gaplessEl || this.gaplessEl.paused;
                    const audioPaused = this.audioEl.paused;
                    if (active && active.paused && gaplessPaused && audioPaused) {
                        const btn = document.getElementById("playlist-play-btn");
                        if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
                        const mobBtn = document.getElementById("mobile-play-btn");
                        if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
                        const modalBtn = document.getElementById("modal-play-btn");
                        if(modalBtn) modalBtn.innerHTML = "<span>▶</span><span>Play</span>";
                    }
                });
                this.audioEl.addEventListener('ended', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                    this.nextTrack();
                });
                if (this.gaplessEl) {
                    this.gaplessEl.onplay = async () => {
                        Mascot.update();
                        const btn = document.getElementById("playlist-play-btn");
                        const mobBtn = document.getElementById("mobile-play-btn");
                        if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                        if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                        const modalBtn = document.getElementById("modal-play-btn");
                        if(modalBtn) modalBtn.innerHTML = "<span>⏸</span><span>Pause</span>";
                        if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                            await SharedAudio.ctx.resume();
                        }
                        if (!this.vizLoopRunning) {
                            this.startVisualizer();
                        }
                    };
                    this.gaplessEl.addEventListener('play', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                    });
                    this.gaplessEl.addEventListener('pause', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                        const active = this._activeEl ? this._activeEl() : null;
                        if (!active || active.paused) {
                            const btn = document.getElementById("playlist-play-btn");
                            if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
                            const mobBtn = document.getElementById("mobile-play-btn");
                            if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
                            const modalBtn = document.getElementById("modal-play-btn");
                            if(modalBtn) modalBtn.innerHTML = "<span>▶</span><span>Play</span>";
                        }
                    });
                    this.gaplessEl.addEventListener('ended', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                        this.nextTrack();
                    });
                }
            }

            const eqFileInput = document.getElementById("eq-file");
            if (!eqFileInput) {
                console.error("[EQ_Module.init] #eq-file element not found — file upload wiring skipped.");
            } else {
                eqFileInput.addEventListener("change", e => {
                    this.handleAudioFileSelection(e.target.files);
                    e.target.value = '';
                });
            }

            const updateScrubDisplay = (activeEl) => {
                if (!activeEl) return;
                const dur = activeEl.duration;
                const cur = activeEl.currentTime;
                if (!this.isSeeking && dur && Number.isFinite(dur) && dur > 0) {
                    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
                    ['playlist-scrub', 'mobile-scrub', 'modal-scrub'].forEach(id => {
                        const s = document.getElementById(id);
                        if (!s) return;
                        s.value = pct;
                        if (window.paintSliderTrack) window.paintSliderTrack(s);
                        else s.style.setProperty('--range-fill', pct + '%');
                    });
                }
                const formatted = this.formatTime(cur || 0);
                const timeCur = document.getElementById('playlist-time-current');
                const mobTimeCur = document.getElementById('mobile-time-current');
                const modalTimeCur = document.getElementById('modal-time-current');
                if (timeCur) timeCur.textContent = formatted;
                if (mobTimeCur) mobTimeCur.textContent = formatted;
                if (modalTimeCur) modalTimeCur.textContent = formatted;
            };

            const attachTimeUpdate = (el) => {
                if (!el) return;
                el.addEventListener('timeupdate', () => updateScrubDisplay(el));
                el.addEventListener('canplay', () => updateScrubDisplay(el));
                el.addEventListener('loadeddata', () => updateScrubDisplay(el));
                el.addEventListener('durationchange', () => {
                    const dur = el.duration;
                    if (dur && Number.isFinite(dur) && dur > 0) {
                        const formatted = this.formatTime(dur);
                        const timeDur = document.getElementById('playlist-time-duration');
                        const mobTimeDur = document.getElementById('mobile-time-duration');
                        const modalTimeDur = document.getElementById('modal-time-duration');
                        if (timeDur) timeDur.textContent = formatted;
                        if (mobTimeDur) mobTimeDur.textContent = formatted;
                        if (modalTimeDur) modalTimeDur.textContent = formatted;
                    }
                });
            };

            attachTimeUpdate(this.audioEl);
            if (this.gaplessEl) attachTimeUpdate(this.gaplessEl);

            const scrub = document.getElementById('playlist-scrub');
            const mobScrub = document.getElementById('mobile-scrub');
            const modalScrub = document.getElementById('modal-scrub');

            const startSeek = () => {
                this.isSeeking = true;
            };

            const bindScrubEvents = (el) => {
                if (!el) return;
                el.addEventListener('mousedown', startSeek);
                el.addEventListener('touchstart', startSeek, { passive: true });

                let scrubFlushPending = false;
                el.addEventListener('input', () => {
                    this.isSeeking = true;
                    if (scrubFlushPending) return;
                    scrubFlushPending = true;
                    requestAnimationFrame(() => {
                        scrubFlushPending = false;
                        const val = parseFloat(el.value) || 0;
                        if (window.paintSliderTrack) window.paintSliderTrack(el);
                        else el.style.setProperty('--range-fill', val + '%');

                        const active = (this._activeEl && this._activeEl()) || this.audioEl;
                        if (active && active.duration) {
                            const tempTime = (val / 100) * active.duration;
                            const formatted = this.formatTime(tempTime);
                            const timeCur = document.getElementById('playlist-time-current');
                            const mobTimeCur = document.getElementById('mobile-time-current');
                            const modalTimeCur = document.getElementById('modal-time-current');
                            if (timeCur) timeCur.textContent = formatted;
                            if (mobTimeCur) mobTimeCur.textContent = formatted;
                            if (modalTimeCur) modalTimeCur.textContent = formatted;
                        }
                    });
                });

                el.addEventListener('change', () => {
                    const val = parseFloat(el.value) || 0;
                    const active = (this._activeEl && this._activeEl()) || this.audioEl;
                    if (active && active.duration) {
                        const targetTime = (val / 100) * active.duration;
                        // performCleanSeek owns isSeeking until the media
                        // element actually reports the new position.
                        this.performCleanSeek(targetTime, val);
                    } else {
                        setTimeout(() => { this.isSeeking = false; }, 100);
                    }
                });
            };

            bindScrubEvents(scrub);
            bindScrubEvents(mobScrub);
            bindScrubEvents(modalScrub);

            window.addEventListener('mouseup', () => { this.isSeeking = false; });
            window.addEventListener('touchend', () => { this.isSeeking = false; });

            // rAF scrub ticker: timeupdate only fires ~4x/sec, which made the
            // thumb crawl in visible 250ms steps. Paint per-frame instead;
            // skipped entirely while paused, seeking, or dragging.
            if (this._scrubRaf) cancelAnimationFrame(this._scrubRaf);
            let _scrubStuckWarn = 0;
            const paintPlaybackScrub = () => {
                this._scrubRaf = requestAnimationFrame(paintPlaybackScrub);
                if (this.isSeeking) return;
                const active = (this._activeEl && this._activeEl()) || this.audioEl;
                if (!active || active.paused) return;
                // Wait until the audio has loaded enough data to report
                // a non-zero currentTime before overriding the scrub.
                // updateScrubDisplay (via timeupdate) handles the interim.
                if (!active.duration || !Number.isFinite(active.duration) || active.readyState < 2) return;
                _scrubStuckWarn = 0;
                const pct = Math.max(0, Math.min(100, (active.currentTime / active.duration) * 100));
                ['playlist-scrub', 'mobile-scrub', 'modal-scrub'].forEach(id => {
                    const s = document.getElementById(id);
                    if (!s) return;
                    if (Math.abs(parseFloat(s.value) - pct) < 0.05) return;
                    s.value = pct;
                    if (window.paintSliderTrack) window.paintSliderTrack(s);
                    else s.style.setProperty('--range-fill', pct + '%');
                });
            };
            paintPlaybackScrub();
    },
};
