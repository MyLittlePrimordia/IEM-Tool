// TestLab spatial audio: orbit, depth pad, sound library, reverb and the spatial player.
// Split out of testlab-module.js; merged into TestLab_Module via Object.assign there.
const TestLab_SpatialMethods = {
        spatialActive: false,

        // (dead duplicate `spatialReverb: 'dry'` removed — the live default
        // below is now 'normal', matching both spatialReverbOptions and the
        // static "🎧 Normal" button label in index.html)
        spatialOrbitActive: false,

        spatialOrbitInterval: null,

        spatialOrbitAngle: 0,

        spatialType: 'footsteps',

        spatialReverb: 'normal',

        spatialOverallVolume: 0.7,

        spatialMusicVolume: 0.7,

        soundLibrary: [],

        customAudioBuffer: null,

        spatialSourceOptions: [],

		spatialWidthLevel: 'normal',

        spatialWidthOptions: ['normal', 'wide', 'extra_wide'],

        spatialReverbOptions: ['normal', 'small_room', 'studio_room', 'theater', 'large_venue', 'cathedral', 'infinite_space', 'underwater'],

        reverbPresets: {
            normal: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },
            dry: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },
            reference: { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 },

            small_room: { preDelay: 8, duration: 0.55, decay: 2.2, damping: 0.45, diffusion: 0.65, wet: 0.12, dry: 1.0, lowpass: 7000, width: 0.7 },

    studio_room: { preDelay: 12, duration: 0.85, decay: 2.0, damping: 0.35, diffusion: 0.8, wet: 0.15, dry: 1.0, lowpass: 9000, width: 0.8 },

    theater: { preDelay: 35, duration: 2.4, decay: 3.0, damping: 0.4, diffusion: 0.85, wet: 0.28, dry: 1.0, lowpass: 8000, width: 1.2 },

    large_venue: { preDelay: 70, duration: 5.0, decay: 4.0, damping: 0.3, diffusion: 0.95, wet: 0.38, dry: 1.0, lowpass: 6000, width: 1.6 },

    cathedral: { preDelay: 90, duration: 8.0, decay: 5.0, damping: 0.65, diffusion: 1.0, wet: 0.45, dry: 1.0, lowpass: 5000, width: 1.8 },

    infinite_space: { preDelay: 120, duration: 10.0, decay: 6.0, damping: 0.8, diffusion: 1.0, wet: 0.5, dry: 1.0, lowpass: 4000, width: 2.0 },

    underwater: { preDelay: 5, duration: 2.5, decay: 3.0, damping: 0.9, diffusion: 0.8, wet: 0.4, dry: 1.0, lowpass: 1200, width: 1.3 }
},

        bufferCache: {},

        startSpatialOrbit: function() {
            this.stopSpatialOrbitTimerOnly();

            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (!pad || !dot) return;

            // rAF with delta-time instead of setInterval(16): timer ticks
            // land between vsync frames (double paints) or drift past them
            // (stutter), and the old per-tick style.left/top writes forced a
            // pad-subtree layout every 16ms. One compositor transform per
            // frame keeps the orbit locked to the display.
            // Angle speed matches the old timer exactly: 0.018 rad/tick at
            // one tick per 16ms ≈ 1.125 rad/s.
            const ANGLE_PER_MS = 0.018 / 16;
            let lastTs = null;
            let orbitRect = null;

            const orbitFrame = (ts) => {
                if (lastTs === null) lastTs = ts;
                const dt = Math.min(64, ts - lastTs); // tab-switch clamp
                lastTs = ts;

                this.spatialOrbitAngle += ANGLE_PER_MS * dt;
                if (this.spatialOrbitAngle > Math.PI * 2) {
                    this.spatialOrbitAngle -= Math.PI * 2;
                }

                if (!orbitRect || orbitRect.width !== pad.clientWidth || orbitRect.height !== pad.clientHeight) {
                    orbitRect = pad.getBoundingClientRect();
                }

                const cw = orbitRect.width;
                const ch = orbitRect.height;

                const cx = cw / 2;
                const cy = ch / 2;
                const radius = Math.min(cw, ch) * 0.35;

                const x = cx + Math.cos(this.spatialOrbitAngle) * radius;
                const y = cy + Math.sin(this.spatialOrbitAngle) * radius;

                const normDist = radius / Math.min(cx, cy);
                let normX = normDist * Math.cos(this.spatialOrbitAngle) * 5.0;
                let normZ = normDist * Math.sin(this.spatialOrbitAngle) * 5.0;
                let normY = this.spatialHeightY || 0;

                const totalDist = Math.hypot(normX, normY, normZ);
                if (totalDist < 0.5) {
                    const scaleFactor = 0.5 / (totalDist || 1);
                    normX *= scaleFactor;
                    normY *= scaleFactor;
                    normZ *= scaleFactor;
                }

                if (this.spatialPanner && SharedAudio.ctx) {
                    if (this.spatialPanner.positionX) {
                        setAudioParamSmooth(this.spatialPanner.positionX, normX, 0.05);
                        setAudioParamSmooth(this.spatialPanner.positionZ, normZ, 0.05);
                        setAudioParamSmooth(this.spatialPanner.positionY, normY, 0.05);
                    } else if (this.spatialPanner.setPosition) {
                        this.spatialPanner.setPosition(normX, normY, normZ);
                    }
                }

                const scale = 2.0 - (normDist * 1.4);
                dot.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;

                this.spatialOrbitInterval = requestAnimationFrame(orbitFrame);
            };
            this.spatialOrbitInterval = requestAnimationFrame(orbitFrame);
        },

        stopSpatialOrbitTimerOnly: function() {
            if (this.spatialOrbitInterval) {
                cancelAnimationFrame(this.spatialOrbitInterval);
                this.spatialOrbitInterval = null;
            }
        },

        stopSpatialOrbit: function() {
            this.stopSpatialOrbitTimerOnly();
            this.spatialOrbitActive = false;
            const btn = document.getElementById('spatial-orbit-btn');
            if (btn) {
                btn.className = "bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] text-stone-200 font-bold text-[10px] h-8 px-3 shadow-sm flex items-center justify-center";
                btn.textContent = '🔄 Orbit: Off';
            }
        },

        spatialDepthZ: -1.5,

        initSpatialPad: function() {
            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (!pad || !dot) return;

            let isDragging = false;

            const updateDotVisualDepth = () => {
                const normalized = (10 - Math.abs(this.spatialDepthZ)) / 10;
                const scale = 0.6 + normalized * 1.4;
                // Keep the dot centered on its last known position when only
                // the depth changes (wheel): position is part of the same
                // compositor transform now, not left/top.
                const x = this.lastPosX !== undefined ? this.lastPosX : pad.clientWidth / 2;
                const y = this.lastPosY !== undefined ? this.lastPosY : pad.clientHeight / 2;
                dot.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            };

            pad.addEventListener('mouseenter', () => {
                if (this.spatialOrbitActive && this.playbackActive) {
                    this.startSpatialOrbit();
                }
            });

            pad.addEventListener('mouseleave', () => {
                this.stopSpatialOrbitTimerOnly();
            });

            pad.addEventListener('dragover', (e) => {
                e.preventDefault();
                pad.style.borderColor = 'var(--accent-blue)';
            });
            pad.addEventListener('dragleave', () => {
                pad.style.borderColor = '';
            });
            pad.addEventListener('drop', (e) => {
                e.preventDefault();
                pad.style.borderColor = '';
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    this.handleSpatialFile({ target: { files: files } });
                }
            });

            pad.addEventListener('wheel', (e) => {
                e.preventDefault();

                const step = e.deltaY < 0 ? 0.25 : -0.25;
                this.spatialHeightY = Math.max(-5, Math.min(5, (this.spatialHeightY || 0) + step));

                const isUp = this.spatialHeightY > 0.1;
                const isDown = this.spatialHeightY < -0.1;
                const directionLabel = isUp ? "🔺 Above Ear Level" : isDown ? "🔻 Below Ear Level" : "🟢 Ear Level";
                showToast(`Elevation: ${directionLabel} (${this.spatialHeightY.toFixed(1)}m)`, "↕️");

                if (this.spatialPanner && SharedAudio.ctx) {
                    setAudioParamSmooth(this.spatialPanner.positionY, this.spatialHeightY, 0.08);
                }
            }, { passive: false });

            // Compositor-only dot movement: the dot's position lives entirely
            // in one translate3d() transform (GPU layer, zero layout work).
            // The old per-mousemove style.left/top writes forced
            // recalc+layout on the whole pad subtree (grid background +
            // radar-pulse animation) at the mouse's event rate; a cached
            // getBoundingClientRect removes the forced-layout read too.
            let padRect = pad.getBoundingClientRect();
            let padRectCheckedAt = 0;
            const refreshPadRect = () => {
                // Rects are only invalidated by layout changes (resize, tab
                // switch, column reflow) — re-measure at most every 500ms,
                // not per event.
                const now = performance.now();
                if (now - padRectCheckedAt > 500) {
                    padRect = pad.getBoundingClientRect();
                    padRectCheckedAt = now;
                }
                return padRect;
            };
            window.addEventListener('resize', () => { padRectCheckedAt = 0; });

            // rAF coalescing: store the latest pointer coords and apply them
            // once per frame — drag updates land at exactly vsync rate, and
            // intermediate mouse events (125-240Hz on gaming mice) cost a
            // variable assignment instead of a style write.
            let pendingPtrX = null;
            let pendingPtrY = null;
            let dotFrameScheduled = false;
            const applyDotTransform = (x, y, scale) => {
                dot.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            };

            const updatePosition = (e) => {
                const rect = refreshPadRect();
                let clientX, clientY;

                if (e.touches && e.touches.length > 0) {
                    const touch = e.touches[0] || e.changedTouches[0];
                    clientX = touch.clientX;
                    clientY = touch.clientY;
                } else {
                    clientX = e.clientX;
                    clientY = e.clientY;
                }

                let x = clientX - rect.left;
                let y = clientY - rect.top;

                x = Math.max(0, Math.min(rect.width, x));
                y = Math.max(0, Math.min(rect.height, y));

                // Batch the position into the per-frame apply below.
                pendingPtrX = x;
                pendingPtrY = y;
                if (!dotFrameScheduled) {
                    dotFrameScheduled = true;
                    requestAnimationFrame(() => {
                        dotFrameScheduled = false;
                        if (pendingPtrX === null) return;
                        // Scale follows the same distance falloff as the
                        // panner math below — computed once per applied frame.
                        const cx = rect.width / 2;
                        const cy = rect.height / 2;
                        const maxDist = Math.min(cx, cy) || 1;
                        const normDist = Math.min(1.0, Math.hypot(pendingPtrX - cx, pendingPtrY - cy) / maxDist);
                        applyDotTransform(pendingPtrX, pendingPtrY, 2.0 - (normDist * 1.4));
                    });
                }

                const prevX = this.lastPosX !== undefined ? this.lastPosX : x;
                const prevY = this.lastPosY !== undefined ? this.lastPosY : y;
                this.lastPosX = x;
                this.lastPosY = y;

                const dx = x - prevX;
                const dy = y - prevY;

                if (Math.hypot(dx, dy) > 1.0) {
                    const angle = Math.atan2(dy, dx);
                    const deg = angle * (180 / Math.PI);

                    let dir = 'idle';
                    if (deg >= -22.5 && deg < 22.5) dir = 'arrow_right';
                    else if (deg >= 22.5 && deg < 67.5) dir = 'arrow_down_right';
                    else if (deg >= 67.5 && deg < 112.5) dir = 'arrow_down';
                    else if (deg >= 112.5 && deg < 157.5) dir = 'arrow_down_left';
                    else if (deg >= 157.5 || deg < -157.5) dir = 'arrow_left';
                    else if (deg >= -157.5 && deg < -112.5) dir = 'arrow_up_left';
                    else if (deg >= -112.5 && deg < -67.5) dir = 'arrow_up';
                    else if (deg >= -67.5 && deg < -22.5) dir = 'arrow_up_right';

                    if (dir !== 'idle') {
                        Mascot.isOverrideActive = true;
                        Mascot.setExpression(dir);

                        clearTimeout(this.spatialMascotResetTimeout);
                        this.spatialMascotResetTimeout = setTimeout(() => {
                            Mascot.isOverrideActive = false;
                            Mascot.setExpression('idle');
                            Mascot.update();
                        }, 300);
                    }
                }

            const nowTime = Date.now();
            if (this.lastSpatialUpdateTime && (nowTime - this.lastSpatialUpdateTime < 16)) {
                return;
            }
            this.lastSpatialUpdateTime = nowTime;

            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const dist = Math.hypot(x - cx, y - cy);
            const maxDist = Math.min(cx, cy) || 1;
            const normDist = Math.min(1.0, dist / maxDist);
            const angle = Math.atan2(y - cy, x - cx);

            let normX = normDist * Math.cos(angle) * 5.0;
            let normZ = normDist * Math.sin(angle) * 5.0;
            let normY = this.spatialHeightY || 0;

            const totalDist = Math.hypot(normX, normY, normZ);
            if (totalDist < 0.5) {
                const scaleFactor = 0.5 / (totalDist || 1);
                normX *= scaleFactor;
                normY *= scaleFactor;
                normZ *= scaleFactor;
            }

            if (this.spatialPanner && SharedAudio.ctx) {
                const now = SharedAudio.ctx.currentTime;
                if (this.spatialPanner.positionX) {
                    setAudioParamSmooth(this.spatialPanner.positionX, normX, 0.08);
                    setAudioParamSmooth(this.spatialPanner.positionY, normY, 0.08);
                    setAudioParamSmooth(this.spatialPanner.positionZ, normZ, 0.08);
                } else if (this.spatialPanner.setPosition) {
                    this.spatialPanner.setPosition(normX, normY, normZ);
                }
            }
            };

            pad.addEventListener('mousemove', (e) => {
                if (!this.spatialOrbitActive) {
                    updatePosition(e);
                }
            });

            pad.addEventListener('mousedown', (e) => {
                isDragging = true;
                updatePosition(e);
            });
            window.addEventListener('mousemove', (e) => {
                if (isDragging && !this.spatialOrbitActive) {
                    updatePosition(e);
                }
            });
            window.addEventListener('mouseup', () => {
                isDragging = false;
            });

            pad.addEventListener('touchstart', (e) => {
                isDragging = true;
                updatePosition(e);
                if (e.cancelable) e.preventDefault();
            }, { passive: false });

            window.addEventListener('touchmove', (e) => {
                if (isDragging && !this.spatialOrbitActive) {
                    updatePosition(e);
                    if (e.cancelable) e.preventDefault();
                }
            }, { passive: false });

            window.addEventListener('touchend', () => {
                isDragging = false;
            });

            updateDotVisualDepth();
        },

loadSoundLibrary: async function() {

            this.soundLibrary = [
                { "name": "Chords", "emoji": "🎼", "file": "chords.mp3" },
                { "name": "Fan", "emoji": "🌀", "file": "fan.mp3" },
                { "name": "Footsteps", "emoji": "👣", "file": "footsteps.mp3" },
                { "name": "Helicopter", "emoji": "🚁", "file": "helicopter.mp3" },
                { "name": "Hip-Hop", "emoji": "🎧", "file": "hiphop.mp3" },
                { "name": "Piano", "emoji": "🎹", "file": "piano.mp3" },
                { "name": "Pink Noise", "emoji": "🌸", "file": "pink_noise.mp3" },
                { "name": "Rain", "emoji": "🌧️", "file": "rain.mp3" },
                { "name": "Rock", "emoji": "🎸", "file": "rock.mp3" },
                { "name": "Spaceship", "emoji": "🚀", "file": "spaceship.mp3" },
                { "name": "Underwater", "emoji": "🌊", "file": "underwater.mp3" },
                { "name": "Vocals", "emoji": "🎤", "file": "vocals.mp3" },
				{ "name": "TV Static", "emoji": "📺", "file": "tv_static.mp3" },
				{ "name": "Forest", "emoji": "🌳", "file": "forest.mp3" },
            ];

            this.spatialSourceOptions = this.soundLibrary.map(s => s.name.toLowerCase().replace(/[\s-]/g, '_'));
            this.spatialSourceOptions.push('custom');
            this.updateSourceButtonLabel();
        },

        updateSourceButtonLabel: function() {
            const btn = document.getElementById('spatial-source-cycle-btn');
            if (!btn) return;
            if (this.spatialType === 'custom') {
                btn.textContent = "📁 Custom Track";
                return;
            }
            const match = this.soundLibrary.find(s => s.name.toLowerCase().replace(/[\s-]/g, '_') === this.spatialType);
            if (match) {
                btn.textContent = `${match.emoji} ${match.name}`;
            } else {
                btn.textContent = "👣 Footsteps";
            }
        },

        createSpatialBuffer: function(ctx, type) {
            const cacheKey = 'spatial_' + type + '_' + ctx.sampleRate;
            if (this.bufferCache[cacheKey]) {
                return this.bufferCache[cacheKey];
            }

            const duration = 4.0;
            const bufferSize = ctx.sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);

            const whiteGen = () => Math.random() * 2 - 1;

            if (type === 'white_noise') {
                for (let i = 0; i < bufferSize; i++) data[i] = whiteGen() * 0.12;
            } else if (type === 'pink_noise') {
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                for (let i = 0; i < bufferSize; i++) {
                    let w = whiteGen();
                    b0 = 0.99886 * b0 + w * 0.0555179;
                    b1 = 0.99332 * b1 + w * 0.0750759;
                    b2 = 0.96900 * b2 + w * 0.1538520;
                    b3 = 0.86650 * b3 + w * 0.3104856;
                    b4 = 0.55000 * b4 + w * 0.5329522;
                    b5 = -0.7616 * b5 - w * 0.0168980;
                    let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
                    b6 = w * 0.115926;
                    data[i] = pink * 0.035;
                }
            } else if (type === 'brown_noise') {
                let accum = 0.0;
                for (let i = 0; i < bufferSize; i++) {
                    let w = whiteGen();
                    accum = (accum + (0.02 * w)) / 1.02;
                    data[i] = accum * 0.45;
                }
            } else if (type === 'footsteps') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.7);
                    if (rhythm < ctx.sampleRate * 0.12) {
                        const env = Math.sin((rhythm / (ctx.sampleRate * 0.12)) * Math.PI);
                        const thud = Math.sin(rhythm * 0.015) * 0.45;
                        const scuff = whiteGen() * 0.22;
                        data[i] = (thud + scuff) * env * 0.45;
                    } else {
                        data[i] = 0;
                    }
                }
            } else if (type === 'clap') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.8);
                    if (rhythm < ctx.sampleRate * 0.15) {
                        const env = Math.exp(-rhythm * 0.00018);
                        const body = Math.sin(rhythm * 0.12) * env * 0.7;
                        const tick = whiteGen() * 0.15 * Math.exp(-rhythm * 0.001);
                        data[i] = (body + tick) * 0.4;
                    } else {
                        data[i] = 0;
                    }
                }
            } else if (type === 'drum') {
                for (let i = 0; i < bufferSize; i++) {
                    const rhythm = i % (ctx.sampleRate * 0.6);
                    let sample = 0;
                    if (rhythm < ctx.sampleRate * 0.15) {
                        const envKick = Math.sin((rhythm / (ctx.sampleRate * 0.15)) * Math.PI);
                        sample += Math.sin(rhythm * 0.007) * 0.45 * envKick;
                    }
                    if (rhythm < ctx.sampleRate * 0.02) {
                        const envHat = Math.exp(-rhythm * 0.001);
                        sample += whiteGen() * 0.18 * envHat;
                    }
                    data[i] = sample * 0.4;
                }
            } else if (type === 'vocals' || type === 'chords') {
                const fadeSize = Math.floor(ctx.sampleRate * 0.25);
                for (let i = 0; i < bufferSize; i++) {
                    const t = i / ctx.sampleRate;
                    data[i] = Math.sin(t * Math.PI * 2 * 220) * 0.4 +
                              Math.sin(t * Math.PI * 2 * 330) * 0.3 +
                              Math.sin(t * Math.PI * 2 * 440) * 0.2;
                }
                for (let i = 0; i < fadeSize; i++) {
                    const alpha = i / (fadeSize - 1);
                    const headVal = data[i];
                    const tailVal = data[bufferSize - fadeSize + i];
                    data[i] = tailVal * (1 - alpha) + headVal * alpha;
                }
                for (let i = 0; i < bufferSize; i++) {
                    data[i] *= 0.30;
                }
            } else {
                for (let i = 0; i < bufferSize; i++) {
                    const t = i / ctx.sampleRate;
                    data[i] = Math.sin(t * Math.PI * 2 * 440) * 0.12;
                }
            }

            // Loop-seam crossfade for the noise generators: white/pink/brown are
            // stochastic, so data[0] != data[len-1] and the wrap point produced
            // an audible click every 4-second loop. Equal-power blend of the
            // tail into the head makes the loop seamless.
            if (type === 'white_noise' || type === 'pink_noise' || type === 'brown_noise') {
                const fade = Math.min(Math.floor(ctx.sampleRate * 0.05), bufferSize >> 2);
                if (fade > 1) {
                    for (let i = 0; i < fade; i++) {
                        const alpha = i / fade;
                        const head = data[i];
                        const tail = data[bufferSize - fade + i];
                        const wHead = Math.sin(alpha * Math.PI / 2);
                        const wTail = Math.cos(alpha * Math.PI / 2);
                        data[i] = head * wHead + tail * wTail;
                    }
                }
            }

            this.bufferCache[cacheKey] = buffer;
            return buffer;
        },

        createImpulseResponse: function(ctx, preset) {
            const sampleRate = ctx.sampleRate;
            const duration = preset.duration;
            if (duration <= 0) return null;

            const numSamples = Math.floor(sampleRate * duration);
            const impulseBuffer = ctx.createBuffer(2, numSamples, sampleRate);
            const left = impulseBuffer.getChannelData(0);
            const right = impulseBuffer.getChannelData(1);

            const decay = preset.decay;
            const damping = preset.damping;
            const diffusion = preset.diffusion;
            const width = preset.width;
            const preDelay = preset.preDelay ? preset.preDelay / 1000 : 0;
            const preDelaySamples = Math.floor(preDelay * sampleRate);

            let lpL = 0;
            let lpR = 0;

            for (let i = 0; i < numSamples; i++) {
                if (i < preDelaySamples) {
                    left[i] = 0;
                    right[i] = 0;
                    continue;
                }

                const t = (i - preDelaySamples) / sampleRate;
                const envelope = Math.pow(1 - t / duration, decay);

                let noiseL = Math.random() * 2 - 1;
                let noiseR = Math.random() * 2 - 1;

                if (Math.sin(i * 0.05) > diffusion) {
                    noiseL *= 0.15;
                    noiseR *= 0.15;
                }

                const alpha = 1.0 - Math.min(0.99, damping * 0.95);
                lpL += alpha * (noiseL - lpL);
                lpR += alpha * (noiseR - lpR);

                let valL = lpL * envelope;
                let valR = lpR * envelope;

                const mid = (valL + valR) * 0.5;
                const side = (valL - valR) * 0.5;

                left[i] = mid + side * width;
                right[i] = mid - side * width;
            }
            return impulseBuffer;
        },

        getAudioFileBuffer: async function(ctx, file) {
            const cacheKey = 'sounds_file_' + file;
            if (this.bufferCache[cacheKey]) {
                return this.bufferCache[cacheKey];
            }
            this.isDecoding = true;
            try {
                const res = await fetch(`./app/sounds/${file}`);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = await ctx.decodeAudioData(arrayBuffer);
                this.bufferCache[cacheKey] = buffer;
                this.isDecoding = false;
                return buffer;
            } catch (e) {
                this.isDecoding = false;
                // Surface the failure — a silent fallback here previously
                // sounded like random sine tones with no hint why (packaged
                // builds once shipped without sounds/ entirely). The synthesized
                // backup is cached under its OWN key so a later retry of this
                // file can still succeed once the asset is actually available.
                console.warn(`[Soundstage] Could not load sounds/${file}:`, e.message || e, '— falling back to synthesized buffer.');
                try { if (typeof showToast === 'function') showToast(`Could not load "${file}" — using built-in synth instead.`, "⚠️"); } catch (_) {}
                const type = file.replace('.mp3', '');
                const synthKey = 'spatial_' + type + '_' + ctx.sampleRate;
                let backup = this.bufferCache[synthKey];
                if (!backup) {
                    backup = this.createSpatialBuffer(ctx, type);
                    this.bufferCache[synthKey] = backup;
                }
                return backup;
            }
        },

                startSpatialAudio: async function() {
            if (this.spatialActive || !this.playbackActive) return;
            // Re-entrancy guard.
            //
            // spatialActive is only set at the very bottom of this function, after
            // `await this.getAudioFileBuffer(...)` has fetched and decoded the
            // clip. So `if (this.spatialActive)` above is false for every start
            // still in flight, and the space between the guard and the assignment
            // is exactly where two clicks land.
            //
            // Measured with the decode held open: two concurrent starts built two
            // complete spatial graphs (14 AudioNodes), and because both runs
            // mutate the SAME this.spatialSourceNode, start() was called on it
            // twice - InvalidStateError, thrown inside an async function, so it
            // surfaced only as an unhandled rejection while the rest of the losing
            // start's body (activeNodes bookkeeping, pad positioning) never ran.
            // Three clicks produced three graphs and start() called three times.
            // Nodes were also left in activeNodes that stopSpatialAudio, which only
            // knows the tracked node, could not remove.
            //
            // The existing isDecoding check in toggleSpatialPlay only covers the
            // custom-file import path; a built-in sound goes through
            // getAudioFileBuffer with no such flag.
            if (this._spatialStartInFlight) return this._spatialStartInFlight;
            this._spatialStartInFlight = this._startSpatialAudio();
            try {
                return await this._spatialStartInFlight;
            } finally {
                // Cleared in finally: a failed decode must not wedge the button.
                this._spatialStartInFlight = null;
            }
        },

        _startSpatialAudio: async function() {
            const ctx = SharedAudio.init(); ctx.resume();
            this.spatialSourceNode = ctx.createBufferSource();

            let startOffset = 0;
            if (this.spatialType === 'custom') {
                if (!this.customAudioBuffer) {
                    showToast("Please import an audio track first using the folder icon.", "⚠️");
                    this.playbackActive = false;
                    this.updatePlayerButtonsUI();
                    return;
                }
                this.spatialSourceNode.buffer = this.customAudioBuffer;

                startOffset = this.spatialOffset || 0;
            } else {
                const match = this.soundLibrary.find(s => s.name.toLowerCase().replace(/[\s-]/g, '_') === this.spatialType);
                const file = match ? match.file : 'footsteps.mp3';
                this.spatialSourceNode.buffer = await this.getAudioFileBuffer(ctx, file);
            }
            this.spatialSourceNode.loop = true;

            this.customGainNode = ctx.createGain();

            if (this.spatialType === 'custom' || this.spatialType === 'user_imported') {
                this.customGainNode.gain.value = this.spatialMusicVolume;
            } else {
                this.customGainNode.gain.value = 1.0;
            }

            this.spatialGainNode = ctx.createGain();
            const masterVolSlider = document.getElementById("eq-musicVolumeSlider");
            const masterVol = masterVolSlider ? parseFloat(masterVolSlider.value) / 100 : 0.5;
            this.spatialGainNode.gain.value = masterVol;

            this.spatialPanner = ctx.createPanner();

            this.spatialPanner.panningModel = 'equalpower';
            this.spatialPanner.distanceModel = 'linear';

            if (this.spatialPanner.positionX) {
                this.spatialPanner.positionX.automationRate = 'a-rate';
                this.spatialPanner.positionY.automationRate = 'a-rate';
                this.spatialPanner.positionZ.automationRate = 'a-rate';
            }

            const presetName = this.spatialReverb || 'normal';
            const preset = this.reverbPresets[presetName] || this.reverbPresets.normal || { preDelay: 0, duration: 0, decay: 0, damping: 0, diffusion: 0, wet: 0, dry: 1.0, lowpass: 20000, width: 1.0 };

            this.dryGainNode = ctx.createGain();
            this.dryGainNode.gain.value = preset.dry;

            this.wetGainNode = ctx.createGain();
            this.wetGainNode.gain.value = preset.wet;

            this.reverbFilterNode = ctx.createBiquadFilter();
            this.reverbFilterNode.type = 'lowpass';
            this.reverbFilterNode.frequency.value = preset.lowpass;

            this.spatialSourceNode.connect(this.customGainNode);
            this.customGainNode.connect(this.dryGainNode);
            this.dryGainNode.connect(this.spatialGainNode);
            this.spatialGainNode.connect(this.spatialPanner);

            if (preset.duration > 0) {
                this.reverbNode = ctx.createConvolver();
                this.reverbNode.buffer = this.createImpulseResponse(ctx, preset);

                this.customGainNode.connect(this.reverbNode);
                this.reverbNode.connect(this.reverbFilterNode);
                this.reverbFilterNode.connect(this.wetGainNode);
                this.wetGainNode.connect(this.spatialPanner);
            }

            this.spatialPanner.connect(SharedAudio.masterGain);

            this.spatialSourceNode.start(0, startOffset);
            this.spatialStartTime = ctx.currentTime;
            this.spatialActive = true;

            this.activeNodes.push(this.spatialSourceNode, this.customGainNode, this.spatialGainNode, this.dryGainNode, this.wetGainNode, this.reverbFilterNode, this.spatialPanner);
            if (this.reverbNode) this.activeNodes.push(this.reverbNode);

            if (window.EQ && !EQ.vizLoopRunning) {
                EQ.startVisualizer();
            }

            const pad = document.getElementById('spatial-pad');
            const dot = document.getElementById('spatial-dot');
            if (pad && dot) {
                const rect = pad.getBoundingClientRect();
                // The dot's position now lives in its transform (compositor
                // layer — see initSpatialPad); read the tracked logical
                // position instead of the no-longer-written style.left/top.
                //
                // A zero-size pad (collapsed panel, hidden tab, or before layout
                // has settled) made the normalisation below compute 0/0, i.e.
                // NaN, and AudioParam.setValueAtTime rejects a non-finite value —
                // so starting spatial playback threw and aborted the rest of the
                // start-up. Fall back to the neutral centre position instead.
                const w = rect.width;
                const h = rect.height;
                const x = (this.lastPosX !== undefined) ? this.lastPosX : (w / 2);
                const y = (this.lastPosY !== undefined) ? this.lastPosY : (h / 2);
                const normX = w > 0 ? ((x / w) * 10) - 5 : 0;
                const normY = h > 0 ? (((h - y) / h) * 10) - 5 : 0;
                const now = ctx.currentTime;

                this.spatialPanner.positionX.setValueAtTime(Number.isFinite(normX) ? normX : 0, now);
                this.spatialPanner.positionY.setValueAtTime(Number.isFinite(normY) ? normY : 0, now);
                this.spatialPanner.positionZ.setValueAtTime(Number.isFinite(this.spatialDepthZ) ? this.spatialDepthZ : -1.5, now);
            }
            this.updateVolumeSliderVisibility();
            this.startImbalanceMeter();
        },

                stopSpatialAudio: function() {
            if (!this.spatialActive) return;

            if (this.spatialType === 'custom' && this.customAudioBuffer && SharedAudio.ctx) {
                const elapsed = SharedAudio.ctx.currentTime - this.spatialStartTime;
                const duration = this.customAudioBuffer.duration;
                this.spatialOffset = ((this.spatialOffset || 0) + elapsed) % duration;
            }

                const nodesToRemove = [
                    this.spatialSourceNode, this.customGainNode, this.spatialGainNode,
                    this.dryGainNode, this.wetGainNode, this.reverbFilterNode,
                    this.spatialPanner, this.reverbNode
                ];
                this.activeNodes = this.activeNodes.filter(n => !nodesToRemove.includes(n));

                if (this.spatialSourceNode) {
                    try { this.spatialSourceNode.stop(); } catch(e){}
                    this.spatialSourceNode.disconnect();
                    this.spatialSourceNode = null;
                }
                if (this.customGainNode) {
                    try { this.customGainNode.disconnect(); } catch(e){}
                    this.customGainNode = null;
                }
                if (this.spatialGainNode) {
                    try { this.spatialGainNode.disconnect(); } catch(e){}
                    this.spatialGainNode = null;
                }
                if (this.dryGainNode) {
                    try { this.dryGainNode.disconnect(); } catch(e){}
                    this.dryGainNode = null;
                }
                if (this.wetGainNode) {
                    try { this.wetGainNode.disconnect(); } catch(e){}
                    this.wetGainNode = null;
                }
                if (this.reverbFilterNode) {
                    try { this.reverbFilterNode.disconnect(); } catch(e){}
                    this.reverbFilterNode = null;
                }
                if (this.spatialPanner) {
                    try { this.spatialPanner.disconnect(); } catch(e){}
                    this.spatialPanner = null;
                }
                if (this.reverbNode) {
                    try { this.reverbNode.disconnect(); } catch(e){}
                    this.reverbNode = null;
                }

                this.spatialActive = false;
                Mascot.update();
        },

        // NOTE: earlier duplicate definitions of toggleSpatialPlay /
        // updatePlayerButtonsUI / handleSpatialFile were removed here — object
        // literals keep the LAST key, so the copies further below were the live
        // ones and these shadowed versions only invited drift.
        spatialReverbMix: 0.30,

        updateVolumeSliderVisibility: function() {},

        // (duplicate cycleSpatialSource removed — the live definition is in the
        // second spatial block below)
	cycleSpatialWidth: function() {
        const curIdx = this.spatialWidthOptions.indexOf(this.spatialWidthLevel);
        const nextIdx = (curIdx + 1) % this.spatialWidthOptions.length;
        this.spatialWidthLevel = this.spatialWidthOptions[nextIdx];

        const btn = document.getElementById('spatial-width-cycle-btn');
        const slider = document.getElementById('stereo-expand-level');

        let val = 0;
        if (btn) {
            if (this.spatialWidthLevel === 'normal') {
                btn.textContent = "↔️ Normal";
                val = 0;
            } else if (this.spatialWidthLevel === 'wide') {
                btn.textContent = "↔️ Wide";
                val = 50;
            } else {
                btn.textContent = "↔️ Extra Wide";
                val = 100;
            }
        }

        if (slider) {
            slider.value = val;
        }
        if (window.EQ && EQ.updateStereoExpand) {
            EQ.updateStereoExpand(val);
        }
    },

        // (duplicate cycleSpatialReverb removed — the live definition is in the
        // second spatial block below)

        toggleSpatialPlay: function(playState) {
            // Ignore presses while a custom track is still decoding — without
            // this, double-pressing during decode started two BufferSources
            // (startSpatialAudio's spatialActive guard can't see a source that
            // hasn't been created yet).
            if (this.isDecoding) {
                showToast("Decoding track, please wait...", "⏳");
                return;
            }
            this.playbackActive = playState;
            this.updatePlayerButtonsUI();
            if (this.playbackActive) {

                if (window.EQ && EQ.audioEl && !EQ.audioEl.paused) {
                    EQ.togglePlayState();
                }
                this.startSpatialAudio();
                if (this.spatialOrbitActive) {
                    this.startSpatialOrbit();
                }
            } else {
                this.stopSpatialAudio();
                this.stopSpatialOrbitTimerOnly();

                Mascot.isOverrideActive = false;
                if (Mascot.currentExpression === 'vibing') {
                    Mascot.currentIntensity = 0;
                    Mascot.setExpression('idle');
                }
                Mascot.update();
            }
        },

        updatePlayerButtonsUI: function() {
            const playBtn = document.getElementById('spatial-play-btn');
            const pauseBtn = document.getElementById('spatial-pause-btn');
            if (playBtn && pauseBtn) {
                if (this.playbackActive) {
                    playBtn.classList.add('hidden');
                    pauseBtn.classList.remove('hidden');
                } else {
                    pauseBtn.classList.add('hidden');
                    playBtn.classList.remove('hidden');
                }
            }
        },

        handleSpatialFile: function(e) {
            const file = e.target.files[0] || (e.target.files && e.target.files[0]);
            if (!file) return;

            const ctx = SharedAudio.init();
            showToast("Decoding custom test track...", "⏳");
            this.isDecoding = true;

            const reader = new FileReader();
            reader.onload = (ev) => {
                ctx.decodeAudioData(ev.target.result, (buffer) => {
                    this.stopSpatialAudio();
                    this.customAudioBuffer = buffer;
                    this.spatialType = 'custom';
                    this.spatialOffset = 0;

                    const btn = document.getElementById('spatial-source-cycle-btn');
                    if (btn) btn.textContent = "📁 Custom Track";

                    this.isDecoding = false;
                    this.updateVolumeSliderVisibility();
                    this.toggleSpatialPlay(true);
                    showToast(`Loaded "${file.name}" into 3D Soundstage!`, "📁");
                }, (err) => {
                    this.isDecoding = false;
                    showToast("Failed to decode audio file.", "⚠️");
                });
            };
            reader.readAsArrayBuffer(file);
        },

        cycleSpatialSource: function() {

            const wasPlaying = this.spatialActive;
            if (wasPlaying) {
                this.stopSpatialAudio();
            }

            let nextIdx = (this.spatialSourceOptions.indexOf(this.spatialType) + 1) % this.spatialSourceOptions.length;
            let nextType = this.spatialSourceOptions[nextIdx];

            if (nextType === 'custom' && !this.customAudioBuffer) {
                nextIdx = (nextIdx + 1) % this.spatialSourceOptions.length;
                nextType = this.spatialSourceOptions[nextIdx];
            }

                        this.spatialType = nextType;
            this.updateSourceButtonLabel();

            this.updateVolumeSliderVisibility();

            if (wasPlaying && this.playbackActive) {
                this.startSpatialAudio();
            }
        },

        cycleSpatialReverb: function() {
            const curIdx = this.spatialReverbOptions.indexOf(this.spatialReverb);
            const nextIdx = (curIdx + 1) % this.spatialReverbOptions.length;
            this.spatialReverb = this.spatialReverbOptions[nextIdx];

            const btn = document.getElementById('spatial-reverb-cycle-btn');
            if (btn) {
                const emojis = {
                    normal: "🎧", small_room: "🏠", studio_room: "🎙️", theater: "🎬",
                    large_venue: "🏟️", cathedral: "⛪", infinite_space: "🌌", underwater: "🌊"
                };
                const titles = {
                    normal: "Normal", small_room: "Small Room", studio_room: "Studio Room", theater: "Theater",
                    large_venue: "Large Venue", cathedral: "Cathedral", infinite_space: "Infinite Space", underwater: "Underwater"
                };

                const emoji = emojis[this.spatialReverb] || "🌌";
                const title = titles[this.spatialReverb] || this.spatialReverb;
                btn.textContent = `${emoji} ${title}`;
            }
            if (this.spatialActive) {
                this.stopSpatialAudio();
                this.startSpatialAudio();
            }
        },
};
