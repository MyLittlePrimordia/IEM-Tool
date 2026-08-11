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
        _activeKey: null,        // key of the currently loaded/playing track
        _targetTrackKey: null,
        _activeLoudnessGain: 1,
        _trackKey: null,
        _loudnessInFlight: false,

        settingsLoudnessMatchEnabled: function() {
            return localStorage.getItem('settings_loudness_match') !== '0';
        },

        // Analyze the currently loaded audio element (decodeAudioData offline) and
        // cache its loudness factor. Fallback: no change (1.0). Never throws.
        _analyzeCurrentLoudness: function() {
            if (!this.audioEl || !this.audioEl.src || !this.audioEl.canPlayType) return;
            if (!this.settingsLoudnessMatchEnabled()) { this._activeLoudnessGain = 1.0; }
            if (this._loudnessInFlight) return;
            
            const el = this.audioEl;
            const key = this._targetTrackKey || String(el.src);
            const cached = this._loudnessGains[key];
            if (cached !== undefined) {
                this._activeLoudnessGain = cached;
                return;
            }

            this._loudnessInFlight = true;
            this._decodeAndMeasureLoudness(el.currentSrc || el.src).then(gain => {
                this._loudnessGains[key] = (gain === null ? 1 : gain);
                if (this._targetTrackKey === key || this._targetTrackKey === null) {
                    this._activeLoudnessGain = this._loudnessGains[key];
                    this.fadeMusicVolume(document.getElementById('eq-musicVolumeSlider') ?
                        parseFloat(document.getElementById('eq-musicVolumeSlider').value) / 100 : 0.5, 0.1);
                }
            }).catch(() => {
                this._loudnessGains[key] = 1;
            }).finally(() => {
                this._loudnessInFlight = false;
            });
        },

        // Resolves a linear gain factor that brings track loudness to a matched
        // target (~-18 dBFS channel RMS). Clamped to +/- 12 dB. Returns 1 on error.
        _decodeAndMeasureLoudness: async function(url) {
            try {
                if (!url) return 1;
                const res = await fetch(url);
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
            return track.url || (track.name + '-' + (track.file ? track.file.size : ''));
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
                const res = await fetch('./audio/audio.json');
                if (res.ok) {
                    const data = await res.json();
                    this.playlist = data.map(item => ({
                        name: item.name,
                        url: `./audio/${item.file}`
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
                        this._analyzeCurrentLoudness();
                        
                        const infoText = document.getElementById("playlist-track-info");
                        if (infoText) infoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        const mobInfoText = document.getElementById("mobile-track-info");
                        if (mobInfoText) mobInfoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        const modalInfoText = document.getElementById("modal-track-name");
                        if (modalInfoText) modalInfoText.textContent = `(${startIndex + 1}/${this.playlist.length}) ${track.name}`;
                        this.updateMarquee();
                    }
                }
            } catch(e) {
                console.log("No custom audio/audio.json found, fallback to manual uploads.");
            }
        },

        fadeMusicVolume: function(targetVal, duration = 0.015) {
            if (this.connected && this.graphBuilt && this.musicVolumeNode && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                const loudGain = (this.settingsLoudnessMatchEnabled && this.settingsLoudnessMatchEnabled()) ? (this._activeLoudnessGain || 1) : 1;
                this.musicVolumeNode.gain.setTargetAtTime(Math.max(0, Math.min(1, targetVal * loudGain)), now, duration);
            } else if (this.audioEl) {
                // Graph absent — mirror the fade on the element attribute directly.
                this.audioEl.volume = Math.max(0, Math.min(1, targetVal));
            }
        },
        fadeMasterGain: function(targetVal, duration = 0.015) {
            if (SharedAudio.masterGain && SharedAudio.ctx) {
                setAudioParamSmooth(SharedAudio.masterGain.gain, targetVal);
            }
        },
        playPlaylistIndex: function(index) {
            if(index < 0 || index >= this.playlist.length) return;
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
            
            // Smoothly fade out current music track before swapping sources to eliminate popping
            this.fadeMusicVolume(0, 0.015); // 15ms fade-out
            
            this._targetTrackKey = this._deriveTrackKey(track);
            this._activeKey = this._targetTrackKey;
            this._activeLoudnessGain = 1;
            
            setTimeout(() => {
                if (this.audioEl) {
                    this.audioEl.src = track.url;
                    this.audioEl.load();
                    this.audioEl.play()
                        .then(() => {
                            // Restore back to the active slider value smoothly
                            const slider = document.getElementById("eq-musicVolumeSlider");
                            const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                            this.fadeMusicVolume(vol, 0.08); // 80ms safety fade-in completely masks browser buffer pops!
                            this._analyzeCurrentLoudness();
                        })
                        .catch(e => {
                            console.log("Play interrupted: ", e);
                            const slider = document.getElementById("eq-musicVolumeSlider");
                            const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                            this.fadeMusicVolume(vol, 0.02);
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
        },
        clearPlaylist: function() {
            if (this.audioEl) {
                this.audioEl.pause();
                this.audioEl.src = '';
                this.audioEl.load();
            }
            this.clearGhostFiles();
            this.playlist = [];
            this.playlistIndex = 0;
            this._shuffleOrder = null;
            this._shufflePos = -1;
            this._loudnessGains = {};
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
            
            if (this.shuffleActive) {
                const prevIndex = this._prevShuffledIndex();
                this.playlistIndex = prevIndex;
                this.playPlaylistIndex(prevIndex);
                return;
            }

            this.playlistIndex = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length;
            this.playPlaylistIndex(this.playlistIndex);
        },
        nextTrack: function() {
            if (this.playlist.length === 0) return;
            
            // Repeat-one takes priority over shuffle
            if (this.repeatActive) {
                this.playPlaylistIndex(this.playlistIndex);
                return;
            }
            
            if (this.shuffleActive) {
                const nextIndex = this._nextShuffledIndex();
                this.playlistIndex = nextIndex;
                this.playPlaylistIndex(nextIndex);
                return;
            }

            this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
            this.playPlaylistIndex(this.playlistIndex);
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
            const noSrc = !this.audioEl || !(this.audioEl.currentSrc || this.audioEl.getAttribute('src'));
            if (noSrc && this.playlistIndex >= 0 && this.playlist[this.playlistIndex]) {
                // Boot-loaded queue (footer fill) never touched the <audio> element —
                // load the current track and start it before attempting to play.
                this.playPlaylistIndex(this.playlistIndex);
                return;
            }
            if (this.audioEl.paused) {
                // Fade-in play
                if (this.audioEl) {
                    this.audioEl.volume = 1.0;
                    this.fadeMusicVolume(0, 0.005); // Start silent
                    this.audioEl.play().then(() => {
                        const slider = document.getElementById("eq-musicVolumeSlider");
                        const vol = slider ? parseFloat(slider.value) / 100 : 0.5;
                        this.fadeMusicVolume(vol, 0.05); // Smooth 50ms fade-in
                    }).catch(e => console.log("Playback blocked or interrupted."));
                }
                if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                if(modalPlayBtn) modalPlayBtn.innerHTML = "<span>⏸</span><span>Pause</span>";
            } else {
                                // Fade-out pause
                this.fadeMusicVolume(0, 0.015);
                setTimeout(() => {
                    if (!this.audioEl.paused) {
                        this.audioEl.pause();
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
if (!this.audioEl) return;

// Fade out the music signal cleanly
this.fadeMusicVolume(0, 0.008);

setTimeout(() => {
this.audioEl.currentTime = targetTime;

const scrub = document.getElementById('playlist-scrub');
const modalScrub = document.getElementById('modal-scrub');
if (scrub) scrub.value = targetScrubVal;
if (modalScrub) modalScrub.value = targetScrubVal;

// Allow HTML5 buffer fusions to settle, then fade back in
setTimeout(() => {
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
                if (this.audioEl) {
                    this.audioEl.volume = 1.0; // Lock browser stream at maximum to prevent unsynced thread-stepping clicks
                }
                const loudGain = (this.settingsLoudnessMatchEnabled && this.settingsLoudnessMatchEnabled()) ? (this._activeLoudnessGain || 1) : 1;
                setAudioParamSmooth(this.musicVolumeNode.gain, Math.max(0, Math.min(1, vol * loudGain)), 0.05);
            } else if (this.audioEl) {
                // DSP graph not built yet — fall back to the element volume so the
                // slider always affects what you hear.
                this.audioEl.volume = Math.max(0, Math.min(1, vol));
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