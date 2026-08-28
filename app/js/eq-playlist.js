const EQ_PlaylistMethods = {
        // Shuffle bag state (indices into this.playlist). Rebuilt via _rebuildShuffleBag.
        // Avoids the classic Math.random() "same song again" problem by exhausting
        // the full permutation before reshuffling, and never starting a new bag
        // with the track that just finished.
        _shuffleOrder: null,
        _shufflePos: -1,

        // ===== Playback Loudness Matcher (under-the-hood) =====
        // Automatically matches the loudness of every playlist track so song-to-song
        // jumps don't blast your ears. Computes a per-track RMS loudness offset
        // offline (decodeAudioData) when a track loads, caches it keyed by
        // `{name}-{size}-{lastModified}`, and applies a clamped gain trim on top of
        // the user's music volume node. No UI. Toggle optional via
        // localStorage key "settings_loudness_match" ("0" to disable).
        _loudnessGains: {},      // key -> linear gain factor (1 = no change)
        _loudnessGainOrder: [],  // LRU order, oldest first
        _LOUDNESS_CACHE_MAX: 120,
        _activeKey: null,        // key of the currently loaded/playing track
        _targetTrackKey: null,
        _activeLoudnessGain: 1,
        _trackKey: null,
        _loudnessInFlight: false,
        _evictLoudnessCacheIfNeeded: function() {
            while (this._loudnessGainOrder.length > this._LOUDNESS_CACHE_MAX) {
                const oldest = this._loudnessGainOrder.shift();
                if (oldest && this._loudnessGains.hasOwnProperty(oldest)) delete this._loudnessGains[oldest];
            }
        },
        _cacheLoudnessGain: function(key, gain) {
            if (!this._loudnessGains.hasOwnProperty(key)) this._loudnessGainOrder.push(key);
            else {
                const idx = this._loudnessGainOrder.indexOf(key);
                if (idx !== -1) { this._loudnessGainOrder.splice(idx, 1); this._loudnessGainOrder.push(key); }
            }
            this._loudnessGains[key] = gain;
            this._evictLoudnessCacheIfNeeded();
        },

        // ===== Gapless Playback =====
        // Two <audio> elements: the "active" one plays the current track while
        // the "idle" one is preloaded with the next track. Advancing the track
        // crossfades the idle element in (~120ms, gain arms sourceGain/gaplessGain
        // in the DSP graph) so there is no silence gap between songs. Toggle via
        // the Accessibility panel button (localStorage key "settings_gapless",
        // "0" = off). Falls back to the old swap-with-gap path when the graph
        // lacks the second arm, the standby isn't ready, or gapless is off.
        _activeIsA: true,        // true  = this.audioEl is the active player
                                 // false = this.gaplessEl is the active player
        _standbyTrackIndex: null, // playlist index currently loaded in the idle element
        _preloadedIndex: null,    // index of the track we expect to play next
        _transitioning: false,    // a crossfade is in flight — suppress double-advance

        settingsLoudnessMatchEnabled: function() {
            return localStorage.getItem('settings_loudness_match') !== '0';
        },

_retargetActiveArm: function(gain, tc = 0.05) {
            const arm = this._activeIsA ? this.sourceGain : this.gaplessGain;
            if (arm && SharedAudio.ctx) {
                arm.gain.setTargetAtTime(Math.max(0.05, Math.min(4, gain || 1)), SharedAudio.ctx.currentTime, tc);
            }
        },

        // Analyze the currently loaded audio element (decodeAudioData offline) and
        // cache its loudness factor. Fallback: no change (1.0). Never throws.
        _analyzeCurrentLoudness: function() {
            const el = this._activeEl();
            if (!el || !el.src || !el.canPlayType) return;
            if (!this.settingsLoudnessMatchEnabled()) {
                // Feature off - don't fetch + fully decode the track, the gain
                // arms are pinned to unity anyway. Just reset.
                this._activeLoudnessGain = 1.0;
                this._retargetActiveArm(1, 0.05);
                return;
            }
            if (this._loudnessInFlight) {
                // Track changed while a previous measurement was decoding:
                // remember we owe the new track a measurement and re-run it
                // once the in-flight one finishes.
                this._loudnessRerun = true;
                return;
            }
            
            const key = this._targetTrackKey || String(el.src);
            const cached = this._loudnessGains[key];
            if (cached !== undefined) {
                this._activeLoudnessGain = cached;
                this._retargetActiveArm(cached, 0.05);
                return;
            }

            this._loudnessInFlight = true;
            this._decodeAndMeasureLoudness(el.currentSrc || el.src).then(gain => {
                if (gain !== null) {
                    this._cacheLoudnessGain(key, gain);
                }
                if (this._targetTrackKey === key || this._targetTrackKey === null) {
                    this._activeLoudnessGain = (gain === null ? 1 : gain);
                    // Apply on the active element's arm only — the shared volume
                    // node must not move while the old track's tail is fading.
                    this._retargetActiveArm(gain === null ? 1 : gain, 0.1);
                }
            }).catch(() => {
                // Leave the cache untouched: transient failures shouldn't pin
                // unity gain (or stale gains) for this track forever.
            }).finally(() => {
                this._loudnessInFlight = false;
                if (this._loudnessRerun) {
                    this._loudnessRerun = false;
                    this._analyzeCurrentLoudness();
                }
            });
        },

        // Standalone worker script: fetch + decode + RMS measurement happen
        // off the main thread so a long track never stalls playback UI while
        // its loudness is measured. Falls back to the main-thread path below.
        _loudnessWorkerSrc: function() {
            return "self.onmessage = async (e) => {" +
                "const url = e.data && e.data.url; " +
                "if (!url) { self.postMessage({ ok: false }); return; } " +
                "try { " +
                "const res = await fetch(url); " +
                "if (!res.ok) { self.postMessage({ ok: false }); return; } " +
                "const buf = await res.arrayBuffer(); " +
                "const Ctx = self.OfflineAudioContext || self.webkitOfflineAudioContext; " +
                "if (!Ctx) { self.postMessage({ ok: false }); return; } " +
                "const ctx = new Ctx(1, 1, 44100); " +
                "const audio = await new Promise((resolve, reject) => ctx.decodeAudioData(buf, resolve, reject)); " +
                "const n = audio.length; " +
                "const ch = audio.numberOfChannels; " +
                "let sumSq = 0; " +
                "for (let c = 0; c < ch; c++) { " +
                "const d = audio.getChannelData(c); " +
                "let s = 0; " +
                "for (let i = 0; i < n; i++) s += d[i] * d[i]; " +
                "sumSq += s; " +
                "} " +
                "const rms = Math.max(1e-9, Math.sqrt((sumSq / (ch * n)) || 0)); " +
                "const dbfs = 20 * Math.log10(rms); " +
                "let gainDb = -23 - dbfs; " +
                "gainDb = Math.max(-12, Math.min(12, gainDb)); " +
                "self.postMessage({ ok: true, gain: Math.pow(10, gainDb / 20) }); " +
                "} catch (err) { self.postMessage({ ok: false, error: String(err) }); } " +
                "};";
        },

        // Resolves a linear gain factor that brings track loudness to a matched
        // target (-23 dBFS channel RMS). Clamped to +/- 12 dB. Returns 1 on error.
        _decodeAndMeasureLoudness: async function(url) {
            try {
                if (!url) return 1;
                // Normalize to absolute URL so blob-worker fetch() resolves
                // correctly (workers from blob: URLs have a blob: base, so
                // relative "./app/audio/..." would otherwise fetch "blob:.../audio").
                let absoluteUrl = url;
                try { absoluteUrl = new URL(url, location.href).href; } catch (_) {}

                // Worker path first: keeps the decode off the main thread.
                if (typeof Worker === 'function') {
                    const workerGain = await new Promise((resolve) => {
                        try {
                            if (!this._loudnessWorkerBlobUrl) {
                                const blob = new Blob([this._loudnessWorkerSrc()], { type: 'application/javascript' });
                                this._loudnessWorkerBlobUrl = URL.createObjectURL(blob);
                            }
                            const workerUrl = this._loudnessWorkerBlobUrl;
                            const worker = new Worker(workerUrl);
                            const done = (gain) => {
                                clearTimeout(timer);
                                worker.terminate();
                                resolve(gain);
                            };
                            const timer = setTimeout(() => done(null), 60000);
                            worker.onmessage = (e) => done(e.data && e.data.ok ? e.data.gain : null);
                            worker.onerror = () => done(null);
                            worker.postMessage({ url: absoluteUrl });
                        } catch (e) {
                            resolve(null);
                        }
                    });
                    if (workerGain !== null) return workerGain;
                }

                const res = await fetch(absoluteUrl);
                if (!res.ok) return 1;
                const arrayBuffer = await res.arrayBuffer();
                const audioBuffer = await new Promise((resolve, reject) => {
                    const Ctx = (window.OfflineAudioContext || window.webkitOfflineAudioContext);
                    if (!Ctx) { reject(new Error("No OfflineAudioContext")); return; }
                    const ctx = new Ctx(1, 1, 44100);
                    ctx.decodeAudioData(arrayBuffer, (buffer) => resolve(buffer),
                        (err) => reject(err));
                });

                // Average RMS across channels (power mean).
                const n = audioBuffer.length;
                const channelCount = audioBuffer.numberOfChannels;
                let sumSq = 0;
                for (let ch = 0; ch < channelCount; ch++) {
                    const chData = audioBuffer.getChannelData(ch);
                    let chSum = 0;
                    for (let i = 0; i < n; i++) chSum += chData[i] * chData[i];
                    sumSq += chSum;
                }
                const total = (sumSq / (channelCount * n)) || 0;
                const rms = Math.max(1e-9, Math.sqrt(total));
                const dbfs = 20 * Math.log10(rms);

                const targetLoudness = -23; // dBFS matched target
                let gainDb = targetLoudness - dbfs;
                gainDb = Math.max(-12, Math.min(12, gainDb));

                return Math.pow(10, gainDb / 20);
            } catch (e) {
                console.warn("[Playlist] Loudness measurement failed, using unity gain:", e);
                return 1;
            }
        },

        // Pick a stability-robust key for the current track so caches survive.
        _deriveTrackKey: function(track) {
            if (!track) return null;
            if (track.key) return track.key;
            // Include lastModified: re-uploading the same file name+size with
            // different content must not reuse the stale loudness measurement.
            const stamp = track.file ? (track.file.lastModified || '') : '';
            return track.url || (track.name + '-' + (track.file ? track.file.size : '') + '-' + stamp);
        },

        // Lazily (re)create the object URL for a file-backed track. Revoking
        // the URL at track-swap time means uploaded files no longer pin their
        // full decode buffers for the whole session; the URL is recreated on
        // demand the next time the track is played.
        _ensureTrackUrl: function(track) {
            if (!track) return null;
            if (track.url) return track.url;
            if (track.file) {
                const url = URL.createObjectURL(track.file);
                track.url = url;
                if (this._urlRegistry && track.key) this._urlRegistry[track.key] = url;
                if (this.objectUrlsCache) this.objectUrlsCache.push(url);
                return url;
            }
            return track.url || null;
        },

        // Revoke a file-backed track's blob URL and remove it from the
        // registries so clearGhostFiles() doesn't double-revoke it.
        // Only blob: URLs (created for uploaded files) are ever revoked —
        // bundled audio.json tracks use plain path URLs that stay valid
        // forever, so a playlist wrap-around (or prevTrack) can still load
        // the track instead of coming up silent.
        _revokeTrackUrl: function(track) {
            if (!track || !track.url) return;
            if (typeof track.url !== 'string' || track.url.indexOf('blob:') !== 0) return;
            const url = track.url;
            if (this._urlRegistry && track.key && this._urlRegistry[track.key] === url) {
                delete this._urlRegistry[track.key];
            }
            if (this.objectUrlsCache) {
                const idx = this.objectUrlsCache.indexOf(url);
                if (idx !== -1) this.objectUrlsCache.splice(idx, 1);
            }
            track.url = null;
            URL.revokeObjectURL(url);
        },

        // Revoke all blob URLs in the current playlist and clear caches.
        // Call when replacing the entire playlist to prevent leaks.
        _clearAllBlobUrls: function() {
            if (this.playlist) {
                this.playlist.forEach(t => this._revokeTrackUrl(t));
            }
            if (this.objectUrlsCache) {
                this.objectUrlsCache.forEach(u => {
                    try { URL.revokeObjectURL(u); } catch (_) {}
                });
                this.objectUrlsCache = [];
            }
            if (this._urlRegistry) {
                this._urlRegistry = {};
            }
        },

        /**
         * Fisher-Yates shuffle of an array of indices.
         * Optionally keep `excludeIndex` out of the first slot so the same track
         * is never played twice in a row when a new bag is generated.
         */
        _rebuildShuffleBag: function(excludeIndex) {
            const n = this.playlist ? this.playlist.length : 0;
            if (n === 0) {
                this._shuffleOrder = [];
                this._shufflePos = -1;
                return;
            }

            const order = Array.from({ length: n }, (_, i) => i);

            // Fisher-Yates
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = order[i];
                order[i] = order[j];
                order[j] = tmp;
            }

            // If we just played a track, make sure the new bag doesn't start with it
            // (unless there's only one track).
            if (n > 1 && excludeIndex !== undefined && excludeIndex !== null && order[0] === excludeIndex) {
                // Swap first element with a random later one
                const swapWith = 1 + Math.floor(Math.random() * (n - 1));
                const tmp = order[0];
                order[0] = order[swapWith];
                order[swapWith] = tmp;
            }

            this._shuffleOrder = order;
            this._shufflePos = -1; // next call to _nextShuffledIndex advances to 0
        },

        /**
         * Returns the next index from the shuffle bag. Rebuilds the bag when
         * exhausted (or when the playlist length changed).
         */
        _nextShuffledIndex: function() {
            const n = this.playlist.length;
            if (n === 0) return 0;

            // Bag missing, empty, or out of sync with playlist size → rebuild
            if (!this._shuffleOrder || this._shuffleOrder.length !== n) {
                this._rebuildShuffleBag(this.playlistIndex);
            }

            this._shufflePos++;

            if (this._shufflePos >= this._shuffleOrder.length) {
                // Exhausted the bag — rebuild, avoiding the track we just played
                this._rebuildShuffleBag(this.playlistIndex);
                this._shufflePos = 0;
            }

            return this._shuffleOrder[this._shufflePos];
        },

        /**
         * Returns the previous index from the shuffle bag (history).
         * If we're at the start of the bag, rebuild and pick a random different track.
         */
        _prevShuffledIndex: function() {
            const n = this.playlist.length;
            if (n === 0) return 0;

            if (!this._shuffleOrder || this._shuffleOrder.length !== n) {
                this._rebuildShuffleBag(this.playlistIndex);
            }

            if (this._shufflePos > 0) {
                this._shufflePos--;
                return this._shuffleOrder[this._shufflePos];
            }

            // At the beginning of history — rebuild so we don't just stay put
            this._rebuildShuffleBag(this.playlistIndex);
            this._shufflePos = 0;
            return this._shuffleOrder[0];
        },

        setupPlaylist: async function() {
            try {
                const res = await fetch('./app/audio/audio.json');
                if (res.ok) {
                    const data = await res.json();
                    this.playlist = data.map(item => ({
                        name: item.name,
                        url: `./app/audio/${item.file}`
                    }));
                    if (this.playlist.length > 0) {
                        // When shuffle is already on, start with a proper bag instead of a single random pick
                        if (this.shuffleActive) {
                            this._rebuildShuffleBag();
                            this.playlistIndex = this._nextShuffledIndex();
                        } else {
                            this.playlistIndex = 0;
                            this._shuffleOrder = null;
                            this._shufflePos = -1;
                        }
                        const startIndex = this.playlistIndex;
                        const track = this.playlist[startIndex];
                        
                        this.audioEl.src = track.url;
                        this.audioEl.load();
                        
                        this._targetTrackKey = this._deriveTrackKey(track);
                        this._activeKey = this._targetTrackKey;
                        this._activeLoudnessGain = 1;
                        // Loudness is measured lazily on first play instead of
                        // at boot: the first track's full decode shouldn't
                        // compete with page-load work when nothing is playing.
                        
                        const infoText = document.getElementById("playlist-track-info");
                        if (infoText) infoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        const mobInfoText = document.getElementById("mobile-track-info");
                        if (mobInfoText) mobInfoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        const modalInfoText = document.getElementById("modal-track-name");
                        if (modalInfoText) modalInfoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        this.updateMarquee();

                        // Boot the gapless standby with the second track so the
                        // very first skip is already seamless.
                        this._preloadedIndex = null;
                        this._preloadNextTrack();
                    }
                }
            } catch(e) {
                console.log("No custom audio/audio.json found, fallback to manual uploads.");
            }
        },

fadeMusicVolume: function(targetVal, duration = 0.015) {
            if (this.connected && this.graphBuilt && this.musicVolumeNode && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                // User volume only — per-track loudness match lives on the
                // element gain arms (sourceGain/gaplessGain), so applying it
                // here would boost BOTH tracks mid-crossfade.
                this.musicVolumeNode.gain.setTargetAtTime(Math.max(0, Math.min(1, targetVal)), now, duration);
            } else {
                // Graph absent �?" mirror the fade on the active element attribute directly.
                const active = this._activeEl();
                if (active) active.volume = Math.max(0, Math.min(1, targetVal));
            }
        },
        fadeMasterGain: function(targetVal, duration = 0.015) {
            if (SharedAudio.masterGain && SharedAudio.ctx) {
                setAudioParamSmooth(SharedAudio.masterGain.gain, targetVal);
            }
        },

        gaplessEnabled: function() {
            return localStorage.getItem('settings_gapless') !== '0';
        },

        crossfadeEnabled: function() {
            return localStorage.getItem('settings_crossfade') === '1';
        },

        crossfadeSeconds: function() {
            const raw = parseFloat(localStorage.getItem('settings_crossfade_secs'));
            if (isNaN(raw)) return 6;
            return Math.max(0.5, Math.min(12, raw));
        },

        // Effective overlap at track boundaries: the user crossfade when enabled,
        // otherwise the tiny gapless seam (0.18s), otherwise 0 (hard swaps only).
        _overlapSecs: function() {
            if (this.crossfadeEnabled()) return this.crossfadeSeconds();
            if (this.gaplessEnabled()) return 0.18;
            return 0;
        },

        // The dual-element standby machinery is shared by gapless and crossfade —
        // either feature being on is enough to keep the standby element preloaded.
        _standbyReady: function() {
            return (this.gaplessEnabled() || this.crossfadeEnabled()) && this.gaplessEl && this.gaplessGain && this.gaplessSource;
        },

        _activeEl: function() {
            return this._activeIsA ? this.audioEl : this.gaplessEl;
        },

        _idleEl: function() {
            return this._activeIsA ? this.gaplessEl : this.audioEl;
        },

        // Mirrors nextTrack()'s decision tree WITHOUT swapping sources, so the
        // shuffle bag advances exactly once per track (preloading IS the advance).
        _computeNextPlaylistIndex: function() {
            if (this.repeatActive) return this.playlistIndex;
            if (this.shuffleActive) return this._nextShuffledIndex();
            return (this.playlistIndex + 1) % this.playlist.length;
        },

        // Load the next track into the idle element so it can be crossfaded in
        // at the seam. Called after every track start (and at boot when gapless
        // or crossfade is enabled). Never touches the active element.
        _preloadNextTrack: function() {
            if (!this._standbyReady() || !this.playlist || this.playlist.length === 0) return;
            if (this.repeatActive && this.playlist.length === 1) {
                // Single-track repeat: preloading is wasteful.
                this._standbyTrackIndex = null;
                this._preloadedIndex = null;
                return;
            }
            const idle = this._idleEl();
            if (!idle) return;
            const nextIndex = this._computeNextPlaylistIndex();
            const track = this.playlist[nextIndex];
            if (!track) { this._standbyTrackIndex = null; this._preloadedIndex = null; return; }
            const url = this._ensureTrackUrl(track);
            if (!url) return;
            idle.volume = 1.0;
            if (idle.src !== url) { idle.src = url; idle.load(); }
            this._standbyTrackIndex = nextIndex;
            this._preloadedIndex = nextIndex;
        },

        // Crossfade the idle element (which holds track `index`) into the active
        // slot. Returns true on success, false if the standby isn't usable (caller
        // falls back to the hard swap path). Guards against double-advance via the
        // `_transitioning` flag and the play-sequence token.
        _crossfadeToStandby: function(seq, index, oldIndex) {
            if (!this._standbyReady() || this._transitioning) return false;
            const standby = this._idleEl();
            if (!standby || this._standbyTrackIndex !== index || standby.readyState < 2) return false;

            const ctx = SharedAudio.ctx;
            if (!ctx) return false;
            const now = ctx.currentTime;
            const toB = this._activeIsA; // true = switching audioEl -> gaplessEl

            this._transitioning = true;
            const oldActive = this._activeEl();
            const oldGain = this._activeIsA ? this.sourceGain : this.gaplessGain;
            const newGain = toB ? this.gaplessGain : this.sourceGain;
            // Overlap window: user crossfade length, or the tiny gapless seam.
            // Exponential ramps (timeConstant ~ 1/3 of the window) fade smoothly
            // and stay inaudible if the retired track's tail ends mid-fade.
            const overlap = this._overlapSecs() || 0.18;
            const tc = Math.max(0.03, overlap / 3);
            // The incoming arm fades to the new track's loudness gain (cached
            // value when known — a late measurement re-targets it smoothly).
            const loudG = (this.settingsLoudnessMatchEnabled() && this._loudnessGains && this._loudnessGains[this._targetTrackKey] !== undefined) ? this._loudnessGains[this._targetTrackKey] : 1;
            if (oldGain) oldGain.gain.setTargetAtTime(0, now, tc);
            if (newGain) newGain.gain.setTargetAtTime(Math.max(0.05, Math.min(4, loudG)), now, tc);

            standby.play().then(() => {
                if (seq !== this._playSeq) return;
                const slider = document.getElementById("eq-musicVolumeSlider");
                const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                this.fadeMusicVolume(vol, 0.05);
                this._analyzeCurrentLoudness();
                if (window.syncGlobalSliders) window.syncGlobalSliders(slider);
            }).catch(() => {
                // Playback blocked (e.g. paused mid-transition) — restore gains.
                if (oldGain) oldGain.gain.setTargetAtTime(1, now, 0.01);
                if (newGain) newGain.gain.setTargetAtTime(0, now, 0.01);
                this._transitioning = false;
            });

            this.playlistIndex = index;
            this._activeIsA = !this._activeIsA;
            this._standbyTrackIndex = null;
            this._preloadedIndex = null;
            // Note: scrub fill is no longer reset to 0 here — paintPlaybackScrub
            // rAF loop updates it every frame from active.currentTime once the
            // audio has loaded enough data (readyState >= 2), and
            // updateScrubDisplay handles the interim via timeupdate events.
            // This avoids snapping the slider to 0:00 on every crossfade skip.

            // Let the old element's tail play out (~150ms) so the crossfade
            // actually overlaps, then retire it and point it at the next track.
            setTimeout(() => {
                // Always retire the old element and drop its arm — even if a
                // newer playPlaylistIndex took over (seq mismatch), the old
                // element must not keep bleeding audio into the graph.
                try { oldActive.pause(); } catch (e) {}
                if (oldGain) oldGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
                this._transitioning = false;
                if (seq !== this._playSeq) return; // a newer switch owns the preload
                const nextTrack = this.playlist[this.playlistIndex];
                const prevTrack = this.playlist[oldIndex];
                // Preload the following track into the retired element before
                // revoking the old URL so the reference is never dangling.
                const idle = this._idleEl();
                if (idle) {
                    const nextNext = this._computeNextPlaylistIndex();
                    const t2 = this.playlist[nextNext];
                    if (t2) {
                        const u2 = this._ensureTrackUrl(t2);
                        if (u2 && idle.src !== u2) { idle.src = u2; idle.load(); }
                        this._standbyTrackIndex = nextNext;
                        this._preloadedIndex = nextNext;
                    }
                }
                if (prevTrack && nextTrack && prevTrack !== nextTrack) {
                    this._revokeTrackUrl(prevTrack);
                }
            }, overlap * 1000 + 250);
            return true;
        },

        // Toggle gapless playback from the Accessibility panel button.
        toggleGapless: function() {
            const on = !this.gaplessEnabled();
            localStorage.setItem('settings_gapless', on ? '1' : '0');
            this._applyGaplessButton();
            if (on) {
                // Re-sync the standby element with the current playlist position.
                if (this.playlist && this.playlist.length > 0 && this.playlist[this.playlistIndex]) {
                    this._preloadedIndex = null;
                    this._preloadNextTrack();
                }
                showToast("Gapless Playback: ON", "🔗");
            } else {
                // Crossfade still needs the standby machinery — only tear it
                // down when BOTH features are off.
                if (!this.crossfadeEnabled()) this._teardownStandby();
                showToast("Gapless Playback: Off", "🔗");
            }
        },

        _applyGaplessButton: function() {
            const btn = document.getElementById("a11y-gapless-btn");
            if (!btn) return;
            if (this.gaplessEnabled()) {
                btn.classList.add('is-on');
                btn.textContent = "🔗 Gapless: On";
            } else {
                btn.classList.remove('is-on');
                btn.textContent = "🔗 Gapless: Off";
            }
        },

        // Toggle crossfade playback (Settings -> Accessibility panel button).
        // Takes over from the gapless seam with a longer, user-adjustable
        // overlap between tracks. Duration via setCrossfadeSeconds.
        toggleCrossfade: function() {
            const on = !this.crossfadeEnabled();
            localStorage.setItem('settings_crossfade', on ? '1' : '0');
            this._applyCrossfadeButton();
            if (on) {
                if (this.playlist && this.playlist.length > 0 && this.playlist[this.playlistIndex]) {
                    this._preloadedIndex = null;
                    this._preloadNextTrack();
                }
                showToast("Crossfade: ON", "🎚️");
            } else {
                if (!this.gaplessEnabled()) this._teardownStandby();
                showToast("Crossfade: Off", "🎚️");
            }
        },

        setCrossfadeSeconds: function(val) {
            const secs = Math.max(0.5, Math.min(12, parseFloat(val) || 6));
            localStorage.setItem('settings_crossfade_secs', String(secs));
            const display = document.getElementById("a11y-crossfade-display");
            if (display) display.textContent = (secs % 1 === 0) ? secs + "s" : secs.toFixed(1) + "s";
        },

        _applyCrossfadeButton: function() {
            const btn = document.getElementById("a11y-crossfade-btn");
            if (!btn) return;
            const on = this.crossfadeEnabled();
            if (on) {
                btn.classList.add('is-on');
                btn.textContent = "🎚️ Crossfade: On";
            } else {
                btn.classList.remove('is-on');
                btn.textContent = "🎚️ Crossfade: Off";
            }
            const slider = document.getElementById("a11y-crossfade-slider");
            if (slider) {
                slider.disabled = !on;
                slider.classList.toggle('opacity-40', !on);
                slider.value = this.crossfadeSeconds();
                this.setCrossfadeSeconds(slider.value);
            }
        },

        // Stop the dual-element machinery: clear the standby element, drop its
        // gain arm, and pin whichever element is actually playing as the sole
        // active player. Direction-aware so toggling off mid-fade never kills
        // the track that is currently audible (B may be the active arm).
        _teardownStandby: function() {
            this._standbyTrackIndex = null;
            this._preloadedIndex = null;
            const idle = this._idleEl();
            if (idle) { try { idle.pause(); } catch (e) {} }
            const loudG = Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1));
            if (this._activeIsA) {
                if (this.gaplessEl) { this.gaplessEl.removeAttribute('src'); this.gaplessEl.load(); }
                if (this.gaplessGain) this.gaplessGain.gain.value = 0;
                if (this.sourceGain) this.sourceGain.gain.value = loudG;
            } else {
                if (this.audioEl) { this.audioEl.removeAttribute('src'); this.audioEl.load(); }
                if (this.sourceGain) this.sourceGain.gain.value = 0;
                if (this.gaplessGain) this.gaplessGain.gain.value = loudG;
            }
        },
        playPlaylistIndex: function(index) {
            if(index < 0 || index >= this.playlist.length) return;
            this.isSeeking = false;
            // Invalidate any pending scrub seek (performCleanSeek) so a track skip
            // doesn't get re-seeked to the old drag position every other time.
            this._seekSeq = (this._seekSeq || 0) + 1;
            // Swap token: rapid track changes within the 80ms source-swap
            // window would otherwise play the stale track's blob after the
            // newer one was picked (and analyze the wrong loudness).
            this._playSeq = (this._playSeq || 0) + 1;
            const seq = this._playSeq;
            const prevIndex = this.playlistIndex;
            this.playlistIndex = index;
            const infoText = document.getElementById("playlist-track-info");
            const mobInfoText = document.getElementById("mobile-track-info");
            const modalInfoText = document.getElementById("modal-track-name");
            const track = this.playlist[index];
            const trackLabel = `(${index + 1}/${this.playlist.length}) ${track.name}`;
            
            if(infoText) infoText.textContent = trackLabel;
            if(mobInfoText) mobInfoText.textContent = trackLabel;
            if(modalInfoText) modalInfoText.textContent = trackLabel;
            this.updateMarquee();
            
            this._targetTrackKey = this._deriveTrackKey(track);
            this._activeKey = this._targetTrackKey;
            this._activeLoudnessGain = 1;

            // Gapless path first: if the idle element is already preloaded with
            // this exact track, crossfade to it. The crossfade arms handle the
            // seam, so we must NOT dip the shared volume the way the hard-swap
            // path does below.
            if (this._crossfadeToStandby(seq, index, prevIndex)) return;

            // Rapid skip while a crossfade is still in flight: tear the old
            // element's tail down NOW instead of letting it keep bleeding
            // underneath the hard-swapped track for the rest of the overlap
            // window (the pending crossfade timeout pauses it too late).
            if (this._transitioning) {
                const idle = this._idleEl();
                if (idle) { try { idle.pause(); } catch (e) {} }
                const idleArm = this._activeIsA ? this.gaplessGain : this.sourceGain;
                if (idleArm && SharedAudio.ctx) idleArm.gain.setTargetAtTime(0, SharedAudio.ctx.currentTime, 0.01);
                this._transitioning = false;
            }

            // Note: scrub fill is updated solely by paintPlaybackScrub
            // rAF loop from active.currentTime. The active element is
            // swapped in _crossfadeToStandby, so the scrub follows
            // whichever element is currently playing.
            // Scrub value reset to 0 is intentionally omitted here to
            // avoid snapping the slider to 0:00 on every track skip.

            // Smoothly fade out current music track before swapping sources to eliminate popping
            this.fadeMusicVolume(0, 0.015); // 15ms fade-out
            
            setTimeout(() => {
                if (seq !== this._playSeq) return;
                // Free the previous track's blob URL at swap time — uploaded
                // files otherwise pin their full buffer until playlist clear.
                if (prevIndex !== index) {
                    const prevTrack = this.playlist[prevIndex];
                    if (prevTrack && prevTrack !== track) this._revokeTrackUrl(prevTrack);
                }
                const trackUrl = this._ensureTrackUrl(track);
                const active = this._activeEl();
                if (active) {
                    active.src = trackUrl;
                    active.load();
                    // Point the active arm at the (possibly stale) loudness gain;
                    // _analyzeCurrentLoudness re-targets it to the true value.
                    const activeArm = this._activeIsA ? this.sourceGain : this.gaplessGain;
                    if (activeArm && SharedAudio.ctx) {
                        activeArm.gain.setTargetAtTime(Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1)), SharedAudio.ctx.currentTime, 0.02);
                    }
                    this._preloadNextTrack();
                    active.play()
                        .then(() => {
                            if (seq !== this._playSeq) return;
                            // Restore back to the active slider value smoothly
                            const slider = document.getElementById("eq-musicVolumeSlider");
                            const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                            this.fadeMusicVolume(vol, 0.08); // 80ms safety fade-in completely masks browser buffer pops!
                            this._analyzeCurrentLoudness();
                            // Ensure visual fill bar stays in sync if slider value was changed programmatically
                            if (window.syncGlobalSliders) window.syncGlobalSliders(slider);
                        })
                        .catch(e => {
                            if (seq !== this._playSeq) return;
                            console.log("Play interrupted: ", e);
                            const slider = document.getElementById("eq-musicVolumeSlider");
                            const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                            this.fadeMusicVolume(vol, 0.02);
                            if (window.syncGlobalSliders) window.syncGlobalSliders(slider);
                        });
                }
            }, 80);
        },
                clearGhostFiles: function() {
            if (this.objectUrlsCache) {
                this.objectUrlsCache.forEach(url => URL.revokeObjectURL(url));
                this.objectUrlsCache = [];
            }
            if (this._urlRegistry) {
                Object.values(this._urlRegistry).forEach(url => URL.revokeObjectURL(url));
                this._urlRegistry = {};
            }
            if (this.loadedFiles) this.loadedFiles.clear();
            // Revoke loudness worker blob URL
            if (this._loudnessWorkerBlobUrl) {
                URL.revokeObjectURL(this._loudnessWorkerBlobUrl);
                this._loudnessWorkerBlobUrl = null;
            }
        },
        clearPlaylist: function() {
            if (this.audioEl) {
                this.audioEl.pause();
                this.audioEl.src = '';
                this.audioEl.load();
            }
            if (this.gaplessEl) {
                this.gaplessEl.pause();
                this.gaplessEl.removeAttribute('src');
                this.gaplessEl.load();
            }
            this._activeIsA = true;
            this._standbyTrackIndex = null;
            this._preloadedIndex = null;
            this._transitioning = false;
            if (this.sourceGain) this.sourceGain.gain.value = 1;
            if (this.gaplessGain) this.gaplessGain.gain.value = 0;
            if (SharedAudio.workletNode) {
                SharedAudio.workletNode.port.postMessage({ type: 'reset' });
            }
            this.clearGhostFiles();
            this.playlist = [];
            this.playlistIndex = 0;
            this._shuffleOrder = null;
            this._shufflePos = -1;
            this._loudnessGains = {};
            this._loudnessGainOrder = [];
            this._activeKey = null;
            this._targetTrackKey = null;
            this._activeLoudnessGain = 1;
            
            const infoText = document.getElementById("playlist-track-info");
            if (infoText) infoText.textContent = "No tracks Loaded";
            const modalInfoText = document.getElementById("modal-track-name");
            if (modalInfoText) modalInfoText.textContent = "No tracks Loaded";
            this.updateMarquee();
            
            const playBtn = document.getElementById("playlist-play-btn");
            const mobPlayBtn = document.getElementById("mobile-play-btn");
            if (playBtn) playBtn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
            if (mobPlayBtn) mobPlayBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
            
            showToast("Playlist cleared and ghost memory buffers revoked.", "🗑️");
        },

        toggleShuffle: function() {
            this.shuffleActive = !this.shuffleActive;
            const btn = document.getElementById('playlist-shuffle-btn');
            const mobBtn = document.getElementById('mobile-shuffle-btn');
            [btn, mobBtn].forEach(el => {
                if (el) {
                    if (this.shuffleActive) el.classList.add('active-yellow');
                    else el.classList.remove('active-yellow');
                }
            });

            if (this.shuffleActive) {
                // Build a fresh bag the moment shuffle is turned on.
                // Exclude the currently playing track so the very next "Next"
                // won't immediately re-select it.
                this._rebuildShuffleBag(this.playlistIndex);
            } else {
                this._shuffleOrder = null;
                this._shufflePos = -1;
            }

            showToast(this.shuffleActive ? "Shuffle Mode: ON" : "Shuffle Mode: Off", "🔀");
        },
        toggleRepeat: function() {
            this.repeatActive = !this.repeatActive;
            const btn = document.getElementById('playlist-repeat-btn');
            const mobBtn = document.getElementById('mobile-repeat-btn');
            [btn, mobBtn].forEach(el => {
                if (el) {
                    if (this.repeatActive) el.classList.add('active-yellow');
                    else el.classList.remove('active-yellow');
                }
            });
            showToast(this.repeatActive ? "Repeat Mode: ON" : "Repeat Mode: Off", "🔁");
        },
        prevTrack: function() {
            if (this.playlist.length === 0) return;

            // Prev is always a hard swap (the standby element holds the NEXT
            // track, never the previous one). Reset the preload state so the
            // recompute happens against the backward position.
            if (this._standbyReady()) {
                this._standbyTrackIndex = null;
                this._preloadedIndex = null;
            }

            if (this.shuffleActive) {
                const prevIndex = this._prevShuffledIndex();
                this.playPlaylistIndex(prevIndex);
                return;
            }

            this.playPlaylistIndex((this.playlistIndex - 1 + this.playlist.length) % this.playlist.length);
        },
        nextTrack: function() {
            if (this.playlist.length === 0) return;

            // Repeat-one takes priority over shuffle
            if (this.repeatActive) {
                this.playPlaylistIndex(this.playlistIndex);
                return;
            }

            // Gapless: the next track is already decided and preloaded by the
            // last playPlaylistIndex — use it so the shuffle bag advances only
            // once per track. Falls back to the computed index if the standby
            // was invalidated (e.g. after a prev).
            if (this._standbyReady() && this._preloadedIndex !== null && this._preloadedIndex !== this.playlistIndex) {
                this.playPlaylistIndex(this._preloadedIndex);
                return;
            }

            if (this.shuffleActive) {
                this.playPlaylistIndex(this._nextShuffledIndex());
                return;
            }

            this.playPlaylistIndex((this.playlistIndex + 1) % this.playlist.length);
        },

        // Pause whatever the playlist is currently playing and reset the
        // transport UI. Used by exclusive-playback features (A/B comparison)
        // so two sources never drive the shared output chain simultaneously —
        // mixing them corrupts level-matched comparisons, the VU/imbalance
        // meters, de-esser tracking and the anti-clip AGC.
        stopPlaylistPlayback: function() {
            const active = this._activeEl ? this._activeEl() : this.audioEl;
            const wasPlaying = !!(active && !active.paused);
            [this.audioEl, this.gaplessEl].forEach(el => {
                if (el && !el.paused) { try { el.pause(); } catch (e) {} }
            });
            this._pausePending = false;

            const btn = document.getElementById("playlist-play-btn");
            if (btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
            const mobBtn = document.getElementById("mobile-play-btn");
            if (mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
            const modalPlayBtn = document.getElementById('modal-play-btn');
            if (modalPlayBtn) modalPlayBtn.innerHTML = "<span>▶</span><span>Play</span>";
            return wasPlaying;
        },

        togglePlayState: async function() {
if (this.playlist.length === 0) {
showToast("Load audio tracks first using the '📂 Upload' button.", "⚠️");
return;
}
if (!this.graphBuilt) await this.ensureDSPGraph();
if (window.SharedAudio) {
const ctx = SharedAudio.init();
if (ctx.state === 'suspended') {
await ctx.resume();
}
}
            const btn = document.getElementById("playlist-play-btn");
            const modalPlayBtn = document.getElementById('modal-play-btn');
            
            const mobBtn = document.getElementById("mobile-play-btn");
            // Play/pause must be decided on the ACTIVE element — with gapless
            // or crossfade on, the B element (eq-audio-gapless) can be the one
            // actually playing while the primary element sits idle/paused.
            const active = this._activeEl();
            const noSrc = !active || !(active.currentSrc || active.getAttribute('src'));
            if (noSrc && this.playlistIndex >= 0 && this.playlist[this.playlistIndex]) {
                // Boot-loaded queue (footer fill) never touched the <audio> element —
                // load the current track and start it before attempting to play.
                this.playPlaylistIndex(this.playlistIndex);
                return;
            }
            if (!active || active.paused || this._pausePending) {
                // Fade-in play
                // Exclusive playback: an active A/B comparison must yield the
                // shared output chain before playlist audio starts (mirror of
                // toggleABPlay pausing the playlist).
                if (window.TestLab && TestLab.pauseABPlayback) TestLab.pauseABPlayback();
                this._pausePending = false;
                this._pauseSeq = (this._pauseSeq || 0) + 1;
                if (active) {
                    if (this.audioEl) this.audioEl.volume = 1.0;
                    if (this.gaplessEl) this.gaplessEl.volume = 1.0;
                    this.fadeMusicVolume(0, 0.005); // Start silent
                    active.play().then(() => {
                        const slider = document.getElementById("eq-musicVolumeSlider");
                        const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                        this.fadeMusicVolume(vol, 0.05); // Smooth 50ms fade-in
                        // Lazy loudness measurement: only decode when playback
                        // actually starts, never at boot or on pause.
                        this._analyzeCurrentLoudness();
                    }).catch(e => console.log("Playback blocked or interrupted."));
                }
                if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                if(modalPlayBtn) modalPlayBtn.innerHTML = "<span>⏸</span><span>Pause</span>";
            } else {
                                // Fade-out pause
                this.fadeMusicVolume(0, 0.015);
                this._pausePending = true;
                this._pauseSeq = (this._pauseSeq || 0) + 1;
                const pauseSeq = this._pauseSeq;
                setTimeout(() => {
                    if (pauseSeq !== this._pauseSeq) return;
                    this._pausePending = false;
                    const active = this._activeEl();
                    if (active && !active.paused) {
                        active.pause();
                    }
                }, 80); // Wait 80ms for the fade-out to complete before pausing
                if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
                if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
                if(modalPlayBtn) modalPlayBtn.innerHTML = "<span>▶</span><span>Play</span>";
            }
        },

        formatTime: function(secs) {
            if (isNaN(secs)) return "0:00";
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        },

        performCleanSeek: function(targetTime, targetScrubVal) {
const active = this._activeEl();
if (!active) return;

// Seek token, separate from the play-swap token (_playSeq): a track change
// pending inside its 80ms swap window must not have its fade-in cancelled
// by a scrub, and a seek must not be cancelled by a track change either.
this._seekSeq = (this._seekSeq || 0) + 1;
const seq = this._seekSeq;

// Keep isSeeking latched until the media element reports the new position.
// currentTime assignment is async — clearing the flag on mouseup let a
// timeupdate repaint the OLD position first, making the thumb snap back.
this.isSeeking = true;
const releaseSeekHold = () => {
    if (seq !== this._seekSeq) return;
    this.isSeeking = false;
};

// Fade out the music signal cleanly
this.fadeMusicVolume(0, 0.008);

setTimeout(() => {
if (seq !== this._seekSeq) { releaseSeekHold(); return; }
const active = this._activeEl();
if (active) {
    active.currentTime = targetTime;
    active.addEventListener('seeked', releaseSeekHold, { once: true });
    setTimeout(releaseSeekHold, 600);
}

['playlist-scrub','mobile-scrub','modal-scrub'].forEach(id => {
const s = document.getElementById(id);
if (!s) return;
s.value = targetScrubVal;
if (window.paintSliderTrack) window.paintSliderTrack(s);
else if (window.syncGlobalSliders) window.syncGlobalSliders(s);
});

// Allow HTML5 buffer fusions to settle, then fade back in
setTimeout(() => {
if (seq !== this._seekSeq) return;
const slider = document.getElementById("eq-musicVolumeSlider");
const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
this.fadeMusicVolume(vol, 0.015);
}, 45);
}, 10);
},

        updateMusicVolume: function(val) {
            const vol = parseFloat(val) / 100;
            if (parseFloat(val) === 100 && this._lastVolPct !== 100) {
                Mascot.triggerTemporaryExpression('deaf', 2000);
            }
            this._lastVolPct = parseFloat(val);
            if (this.connected && this.graphBuilt && this.musicVolumeNode) {
                if (this.audioEl) this.audioEl.volume = 1.0; // Lock browser streams at maximum to prevent unsynced thread-stepping clicks
                if (this.gaplessEl) this.gaplessEl.volume = 1.0;
                setAudioParamSmooth(this.musicVolumeNode.gain, Math.max(0, Math.min(1, vol)), 0.05);
            } else {
                // DSP graph not built yet — fall back to the element volume so the
                // slider always affects what you hear.
                const active = this._activeEl();
                if (active) active.volume = Math.max(0, Math.min(1, vol));
            }

            this.updateLoudnessDSP(); // Recalculate and apply loudness filters on volume slider movement
            Mascot.update();
            this.drawCurve();         // Redraws the graph line in real-time to show the loudness shelf morphing
            const display = document.getElementById("eq-volDisplay");
            if (display) display.textContent = `${val}%`;
            const icon = document.getElementById("eq-volIcon");
            const mobIcon = document.getElementById("mobile-volIcon");
            if (icon) {
                if (vol === 0) icon.textContent = "🔇";
                else if (vol < 0.4) icon.textContent = "🔈";
                else icon.textContent = "🔊";
            }
            if (mobIcon) {
                if (vol === 0) mobIcon.textContent = "🔇";
                else if (vol < 0.4) mobIcon.textContent = "🔈";
                else mobIcon.textContent = "🔊";
            }

            // Sync visualizer pop-up controls immediately
            const modalVolDisplay = document.getElementById("modal-vol-display");
            if (modalVolDisplay) modalVolDisplay.textContent = `${val}%`;
            const modalVolSlider = document.getElementById("modal-volume-slider");
            if (modalVolSlider) modalVolSlider.value = val;
            const modalIcon = document.getElementById("modal-vol-icon");
            if (modalIcon) {
                if (vol === 0) modalIcon.textContent = "🔇";
                else if (vol < 0.4) modalIcon.textContent = "🔈";
                else modalIcon.textContent = "🔊";
            }
        },

                toggleMute: function() {
            Mascot.triggerTemporaryExpression('mute', 2000);
            const slider = App.getEl("eq-musicVolumeSlider");
            if (!slider) return;
            const currentVol = parseFloat(slider.value);
            try {
                if (currentVol > 0) {
                    this.lastVolume = currentVol / 100;
                    this.updateMusicVolume(0);
                    slider.value = 0;
                } else {
                    const restoreVol = this.lastVolume !== undefined ? Math.max(0, Math.min(1, this.lastVolume)) * 100 : 50;
                    this.updateMusicVolume(restoreVol);
                    slider.value = restoreVol;
                }
                if (window.syncGlobalSliders) window.syncGlobalSliders();
            } catch (error) {
                console.error("Error during mute toggle:", error);
            }
        },
};