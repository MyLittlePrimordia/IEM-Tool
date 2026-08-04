// ==========================================================================
// eq-playlist.js — Music/playlist transport controls for EQ_Module: loading
// audio/audio.json, play/pause/shuffle/repeat/prev/next, seek, volume fade and
// mute. Extracted verbatim from the monolithic inline script (audit #4, sixth
// slice -- second slice out of EQ_Module).
//
// Same re-attachment pattern as js/eq-export.js: this file defines a plain
// object of just these methods, and the main script does
// Object.assign(EQ_Module, EQ_PlaylistMethods) right after EQ_Module's own
// closing brace, so `this` inside every method here is still EQ_Module and
// every existing call site (this.playPlaylistIndex(), EQ.toggleMute(), etc.)
// keeps working unchanged.
//
// Checked before extracting: only reads/calls other EQ_Module state (audioEl,
// playlist, playlistIndex, shuffleActive, repeatActive, musicVolumeNode,
// graphBuilt, lastVolume) and methods (drawCurve, ensureDSPGraph,
// updateLoudnessDSP, updateMarquee, clearGhostFiles) -- normal for methods on a
// shared object, unaffected by which file the source lives in.
// ==========================================================================
const EQ_PlaylistMethods = {
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
                        // Pick a random track index on load if Shuffle is active, otherwise default to the first track
                        const startIndex = this.shuffleActive ? Math.floor(Math.random() * this.playlist.length) : 0;
                        this.playlistIndex = startIndex;
                        const track = this.playlist[startIndex];
                        
                        this.audioEl.src = track.url;
                        this.audioEl.load();
                        
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
            if (this.graphBuilt && this.musicVolumeNode && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                this.musicVolumeNode.gain.setTargetAtTime(targetVal, now, duration);
            }
        },
        fadeMasterGain: function(targetVal, duration = 0.015) {
            if (SharedAudio.masterGain && SharedAudio.ctx) {
                setAudioParamSmooth(SharedAudio.masterGain.gain, targetVal);
            }
        },
        playPlaylistIndex: function(index) {
            if(index < 0 || index >= this.playlist.length) return;
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
            
            const infoText = document.getElementById("playlist-track-info");
            if (infoText) infoText.textContent = "No tracks Loaded";
            const modalInfoText = document.getElementById("modal-track-name");
            if (modalInfoText) modalInfoText.textContent = "No tracks Loaded";
            this.updateMarquee();
            
            const playBtn = document.getElementById("playlist-play-btn");
            if (playBtn) playBtn.innerHTML = "<span class=\"text-sm\">▶️</span>";
            
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
                const randIndex = Math.floor(Math.random() * this.playlist.length);
                this.playlistIndex = randIndex;
                this.playPlaylistIndex(randIndex);
                return;
            }

            this.playlistIndex = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length;
            this.playPlaylistIndex(this.playlistIndex);
        },
        nextTrack: function() {
            if (this.playlist.length === 0) return;
            
            if (this.repeatActive) {
                this.playPlaylistIndex(this.playlistIndex);
                return;
            }
            
            if (this.shuffleActive) {
                const randIndex = Math.floor(Math.random() * this.playlist.length);
                this.playlistIndex = randIndex;
                this.playPlaylistIndex(randIndex);
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
                if(btn) btn.innerHTML = "<span class=\"text-[18px]\">⏸</span>";
                if(mobBtn) mobBtn.innerHTML = "<span class=\"text-xs\">⏸</span>";
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
                if(mobBtn) mobBtn.innerHTML = "<span class=\"text-xs\">▶</span>";
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
            if (this.audioEl) {
                this.audioEl.volume = 1.0; // Lock browser stream at maximum to prevent unsynced thread-stepping clicks
            }
            if (this.graphBuilt && this.musicVolumeNode) {
                setAudioParamSmooth(this.musicVolumeNode.gain, vol, 0.05);
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
