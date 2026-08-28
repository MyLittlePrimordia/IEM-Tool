// Split out of the former monolithic app-core.js (2026 refactor).
// The floating mascot/companion UI (self-contained; no other module depends
// on load-time evaluation of this object, only on calls into it at runtime).
var Mascot = window.Mascot || {
        currentExpression: 'idle',
        overrideTimeout: null,
        maxDurationTimeout: null,
        lastTriggerTime: 0,
        isGeniusActive: false,
        isOverrideActive: false,
        lastActivityTime: Date.now(),
        isAsleep: false,
        caffeineExpireTime: 0,
        bassEnvelope: 0,
        bassGateActive: false,
        bassfaceHoldUntil: 0,
        idleTimer: null,
        idleStartTime: 0,
        currentIntensity: 0,
        targetIntensity: 0,
        lastFrameTime: 0,
        reactiveExpressions: ['bassface', 'strained', 'mindblown', 'pain', 'rumble', 'vibing', 'imbalance', 'fire'],

        clearTimers: function() {
            if (this.overrideTimeout) { clearTimeout(this.overrideTimeout); this.overrideTimeout = null; }
            if (this.maxDurationTimeout) { clearTimeout(this.maxDurationTimeout); this.maxDurationTimeout = null; }
        },

        expressions: {
            idle: '😐',
            vibing: '😌',
            bassface: '😤',
            sub_bass: '😮',
            mid_bass: '🤤',
            treble: '😬',
            sibilance_pain: '😫',
            focus: '🧐',
            impact: '👊',
            polarity: '😵‍💫',
            soundstage: '🤩',
            footsteps: '👣',
            pan_left: '👈',
            pan_right: '👉',
            sleep_deep: '😴',
            sleep_drool: '😪',
            sleep_dream: '😌',
            wake_coffee: '☕',
            wake_tea: '🍵',
            wake_jolt: '😳',
            scan_idle: '😣',
            scan_alert: '😬',
            scan_pain: '😖',
            scan_lock: '😎',
            genius: '🤓',
            pain: '😖',
            rumble: '😵',
            imbalance: '😵‍💫',
            thinking: '🤔',
            deaf: '😱',
            mute: '🤫',
            mindblown: '🤯',
            melting: '🫠',
            hot: '🥵',
            cool: '😎',
            yikes: '😬',
            goofy: '🤪',
            sleeping: '💤',
            fire: '🔥',
            hearnoevil: '🙉',
            sparkle: '✨',
            grin: '😁',
            ab_a: '🅰️',
            ab_b: '🅱️',
            balance: '⚖️',
            leak_left: '🙉',
                leak_right: '🙉',
                arrow_up: '↑',
                arrow_down: '↓',
                arrow_left: '←',
                arrow_right: '→',
                arrow_up_left: '↖',
                arrow_up_right: '↗',
                arrow_down_right: '↘',
                arrow_down_left: '↙',
                hearing_test: '🧐'
        },

        setExpression: function(expr) {
            if (this.currentExpression === expr) return;
            const el = document.getElementById('brand-icon-emoji');
            if (!el) return;

            this.currentExpression = expr;
            el.textContent = this.expressions[expr] || this.expressions.idle;

            el.style.fontSize = "22px";
            el.style.lineHeight = "1";
            el.style.textShadow = "none";
            el.style.transform = "";

            if (expr.startsWith('arrow_')) {

                el.className = "inline select-none";
                el.style.color = "var(--accent-blue)";
            } else {

                el.className = "inline select-none emoji-font";
                el.style.color = "";
            }

            const animMap = {
                idle: 'anim-mascot-idle',
                vibing: 'anim-mascot-vibing',
                bassface: 'anim-mascot-bassface',
                sub_bass: 'anim-mascot-rumble',
                mid_bass: 'anim-mascot-mid-bass',
                treble: 'anim-mascot-treble',
                sibilance_pain: 'anim-mascot-pain',
                focus: 'anim-mascot-focus',
                impact: 'anim-mascot-impact',
                polarity: 'anim-mascot-polarity',
                soundstage: 'anim-mascot-soundstage',
                footsteps: 'anim-mascot-footsteps',
                pan_left: 'anim-mascot-panning-left',
                pan_right: 'anim-mascot-panning-right',
                sleep_deep: 'anim-mascot-deep-sleep',
                sleep_drool: 'anim-mascot-drool-sleep',
                sleep_dream: 'anim-mascot-dream-sleep',
                wake_coffee: 'anim-mascot-wake-coffee',
                wake_tea: 'anim-mascot-wake-tea',
                wake_jolt: 'anim-mascot-wake-jolt',
                scan_idle: 'anim-mascot-scan',
                scan_alert: 'anim-mascot-scan-alert',
                scan_pain: 'anim-mascot-pain',
                scan_lock: 'anim-mascot-wake-coffee',
                genius: 'anim-mascot-genius',
                pain: 'anim-mascot-pain',
                rumble: 'anim-mascot-rumble',
                imbalance: 'anim-mascot-imbalance',
                thinking: 'anim-mascot-thinking',
                deaf: 'anim-mascot-deaf',
                mute: 'anim-mascot-mute',
                mindblown: 'anim-mascot-mindblown',
                melting: 'anim-mascot-melting',
                hot: 'anim-mascot-hot',
                cool: 'anim-mascot-cool',
                yikes: 'anim-mascot-yikes',
                goofy: 'anim-mascot-goofy',
                sleeping: 'anim-mascot-sleeping',
                fire: 'anim-mascot-fire',
                hearnoevil: 'anim-mascot-hear-no-evil',
                mute: 'anim-mascot-hear-no-evil',
                sparkle: 'anim-mascot-sparkle',
                grin: 'anim-mascot-sparkle',
                ab_a: 'anim-mascot-ab-a',
                ab_b: 'anim-mascot-ab-b',
                balance: 'anim-mascot-balance',
                leak_left: 'anim-mascot-tilt-left',
                leak_right: 'anim-mascot-tilt-right',
                arrow_up: 'anim-mascot-arrow-up',
                arrow_down: 'anim-mascot-arrow-down',
                arrow_left: 'anim-mascot-arrow-left',
                arrow_right: 'anim-mascot-arrow-right',
                arrow_up_left: 'anim-mascot-arrow-ul',
                arrow_up_right: 'anim-mascot-arrow-ur',
                arrow_down_right: 'anim-mascot-arrow-dr',
                arrow_down_left: 'anim-mascot-arrow-dl',
                hearing_test: 'anim-mascot-hearing'
            };

        const activeClass = animMap[expr];
        if (activeClass) {
            el.classList.add(activeClass);
        }

        if (this.reactiveExpressions.indexOf(expr) === -1) {
            this.resetReactiveState();
        }

        if (expr === 'genius' || expr === 'sparkle') {
            el.style.textShadow = '0 0 10px var(--accent-blue)';
        } else if (expr === 'fire' || expr === 'deaf') {
            el.style.textShadow = '0 0 12px #ef4444';
        } else if (expr === 'cool') {
            el.style.textShadow = '0 0 8px #10b981';
        } else if (expr === 'hot' || expr === 'yikes') {
            el.style.textShadow = '0 0 6px #f59e0b';
        }

        this.idleStartTime = Date.now();
        clearTimeout(this.idleTimer);
        if (expr === 'idle') {
            this.startIdleTimers();
        }
    },

    triggerTemporaryExpression: function(expr, duration) {
            var now = Date.now();
            if (now - this.lastTriggerTime < 100) return;
            this.lastTriggerTime = now;

            this.clearTimers();

            this.isOverrideActive = true;
            if (expr === 'genius') this.isGeniusActive = true;

            const el = document.getElementById('brand-icon-emoji');
            if (el) {
                el.textContent = this.expressions[expr] || this.expressions.idle;
                el.className = "inline select-none emoji-font mascot-react-pop";

                this.overrideTimeout = setTimeout(() => {
                    Mascot.setExpression(expr);
                }, 350);
            }

            this.maxDurationTimeout = setTimeout(() => {
                if (expr === 'genius') this.isGeniusActive = false;
                this.isOverrideActive = false;
                const brandIcon = document.getElementById('brand-icon-emoji');
                if (brandIcon) brandIcon.style.transform = "";
                this.update();
            }, duration || 2500);
        },
    applyReactiveAnimation: function(expr, intensity) {
        var el = document.getElementById('brand-icon-emoji');
        if (!el) return;

        if (this.reactiveExpressions.indexOf(expr) === -1) return;

        var now = performance.now();
        var dt = Math.min(50, now - (this.lastFrameTime || now)) / 1000;
        this.lastFrameTime = now;

        var speed = intensity > this.currentIntensity ? 10 : 4;
        this.currentIntensity = this.currentIntensity +
            (intensity - this.currentIntensity) * Math.min(1, dt * speed);

        var i = Math.max(0, Math.min(1, this.currentIntensity));
        var shake, scaleX, scaleY, rot, blur, glowColor, glowSize;

        switch(expr) {
            case 'bassface':
                shake = Math.sin(now * 0.07) * i * 3;
                scaleX = 1 + i * 0.2;
                scaleY = 1 - i * 0.15;
                rot = Math.cos(now * 0.05) * i * 4;
                blur = i * 0.8;
                glowSize = Math.floor(i * 8);
                glowColor = 'var(--accent-blue)';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ') rotate(' + rot.toFixed(1) + 'deg)';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor;
                break;

            case 'strained':
                shake = Math.sin(now * 0.08) * i * 4;
                scaleX = 1 + i * 0.15;
                scaleY = 1 - i * 0.28;
                rot = Math.cos(now * 0.04) * i * 3;
                blur = i * 1.2;
                glowSize = Math.floor(i * 14);
                glowColor = '#f59e0b';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ') rotate(' + rot.toFixed(1) + 'deg)';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor;
                break;

            case 'mindblown':
                scaleX = 1 + i * 0.45;
                scaleY = 1 + i * 0.45;
                shake = Math.sin(now * 0.09) * i * 5;
                blur = i * 0.5;
                glowSize = Math.floor(i * 20);
                glowColor = '#ffffff';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ')';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor + ', 0 0 ' + (glowSize*2) + 'px var(--accent-blue)';
                break;

            case 'pain':
                shake = Math.sin(now * 0.13) * i * 3;
                scaleX = 1 - i * 0.08;
                scaleY = 1 - i * 0.08;
                blur = i * 0.5;
                glowSize = Math.floor(i * 6);
                glowColor = i > 0.6 ? '#ef4444' : '#f59e0b';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) translateY(' + (Math.cos(now * 0.11) * i * 1.5).toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ')';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor;
                break;

            case 'rumble':
                shake = Math.sin(now * 0.15) * i * 6;
                scaleX = 1 + i * 0.05;
                scaleY = 1 - i * 0.05;
                rot = Math.cos(now * 0.12) * i * 3;
                blur = i * 1.5;
                glowSize = Math.floor(i * 4);
                glowColor = '#a855f7';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) translateY(' + (Math.cos(now * 0.14) * i * 2).toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ') rotate(' + rot.toFixed(1) + 'deg)';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor;
                break;

            case 'vibing':
                var bobY = Math.sin(now * 0.004) * i * 4;
                rot = Math.sin(now * 0.003) * i * 3;
                blur = 0;
                el.style.transform = 'translateY(' + bobY.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
                el.style.filter = 'none';
                el.style.textShadow = i > 0.5 ? '0 0 4px rgba(var(--accent-blue-rgb), 0.3)' : 'none';
                break;

            case 'imbalance':
                rot = Math.sin(now * 0.002) * i * 18;
                var driftX = Math.cos(now * 0.0015) * i * 3;
                blur = i * 0.6;
                el.style.transform = 'translateX(' + driftX.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
                el.style.filter = 'blur(' + blur.toFixed(1) + 'px)';
                el.style.textShadow = 'none';
                break;

            case 'fire':
                shake = Math.sin(now * 0.1) * i * 2;
                scaleX = 1 + Math.sin(now * 0.08) * i * 0.1;
                scaleY = 1 + Math.cos(now * 0.09) * i * 0.12;
                glowSize = Math.floor(i * 16);
                glowColor = '#ef4444';
                el.style.transform = 'translateX(' + shake.toFixed(1) + 'px) scaleX(' + scaleX.toFixed(2) + ') scaleY(' + scaleY.toFixed(2) + ')';
                el.style.filter = 'none';
                el.style.textShadow = '0 0 ' + glowSize + 'px ' + glowColor + ', 0 0 ' + (glowSize*2) + 'px #f97316';
                break;
        }
    },

    resetReactiveState: function() {
        var el = document.getElementById('brand-icon-emoji');
        if (!el) return;
        this.currentIntensity = 0;
        this.targetIntensity = 0;
        el.style.transform = '';
        el.style.filter = '';
        el.style.textShadow = '';
    },
    startIdleTimers: function() {
        clearTimeout(this.idleTimer);
        this.idleStartTime = Date.now();
        this.idleTimer = setTimeout(function() {
            Mascot.checkIdleState();
        }, 60000);
    },

    checkIdleState: function() {
        if (this.currentExpression !== 'idle') return;
        var elapsed = Date.now() - this.idleStartTime;
        if (elapsed >= 300000) {
            this.setExpression('sleeping');
        }
    },

    handleUserActivity: function() {
        this.lastActivityTime = Date.now();
        if (this.isAsleep) {
            this.wakeUp();
        }
    },

    getSeasonalExpression: function() {
        const now = new Date();
        const month = now.getMonth();
        const date = now.getDate();

        if (month === 9 && date === 31) return '👻';
        if (month === 11 && date >= 24 && date <= 26) return '🎅';
        if (month === 11 && date === 31) return '🥳';
        if (month === 3 && date === 1) return '🤪';

        return '😐';
    },

    fallAsleep: function() {
        this.isAsleep = true;
        this.isOverrideActive = true;

        const r = Math.floor(Math.random() * 3);
        const modes = ['sleep_deep', 'sleep_drool', 'sleep_dream'];
        const selected = modes[r];

        this.setExpression(selected);
    },

    wakeUp: function() {
        this.isAsleep = false;
        this.isOverrideActive = true;

        const r = Math.floor(Math.random() * 3);
        const el = document.getElementById('brand-icon-emoji');

        clearTimeout(this.overrideTimeout);
        clearTimeout(this.maxDurationTimeout);

        if (r === 0) {

            this.caffeineExpireTime = Date.now() + 300000;
            if (el) {
                el.textContent = '🥱';
                el.className = "inline select-none emoji-font anim-mascot-wake-coffee";
            }
            this.overrideTimeout = setTimeout(() => {
                if (el && this.currentExpression === 'wake_coffee') el.textContent = '☕';
            }, 650);
            this.currentExpression = 'wake_coffee';
        } else if (r === 1) {

            this.caffeineExpireTime = Date.now() + 300000;
            if (el) {
                el.textContent = '🥱';
                el.className = "inline select-none emoji-font anim-mascot-wake-tea";
            }
            this.overrideTimeout = setTimeout(() => {
                if (el && this.currentExpression === 'wake_tea') el.textContent = '🍵';
            }, 650);
            this.currentExpression = 'wake_tea';
        } else {

            this.caffeineExpireTime = Date.now() + 60000;
            this.setExpression('wake_jolt');
        }

        this.maxDurationTimeout = setTimeout(() => {
            this.isOverrideActive = false;
            this.update();
        }, 1500);
    },

    update: function() {
            if (this.isGeniusActive) return;

            if (window.TestLab && (TestLab.leakTestActive || TestLab.channelToneOsc || TestLab.resonanceActive || TestLab.hearingOsc)) {
                return;
            }

            const isMusicPlaying = (window.EQ && ((EQ.audioEl && !EQ.audioEl.paused) || (EQ.gaplessEl && !EQ.gaplessEl.paused) || (typeof EQ._activeEl === 'function' && EQ._activeEl() && !EQ._activeEl().paused)));
            const isToneActive = (window.Tone && Tone.osc);
            const isTestLabActive = (window.TestLab && (TestLab.activeNodes.length > 0 || TestLab.hearingOsc || TestLab.channelToneOsc));
            const isSoundActive = isMusicPlaying || isToneActive || isTestLabActive;

            if (isSoundActive) {
                this.lastActivityTime = Date.now();
                if (this.isAsleep) {
                    this.isAsleep = false;
                    this.isOverrideActive = false;
                }
            }

            if (this.isOverrideActive) return;

        if (!isSoundActive && !this.isAsleep && (Date.now() - this.lastActivityTime > 15000)) {
            this.fallAsleep();
            return;
        }

        if (this.isAsleep) return;

        const renameModal = document.getElementById('rename-modal');
        const savePresetModal = document.getElementById('save-preset-modal');
        const smartImportModal = document.getElementById('smart-import-modal');
        const smartRfModal = document.getElementById('smart-rf-modal');
        const isThinking = (renameModal && !renameModal.classList.contains('hidden')) ||
                           (savePresetModal && !savePresetModal.classList.contains('hidden')) ||
                           (smartImportModal && !smartImportModal.classList.contains('hidden')) ||
                           (smartRfModal && !smartRfModal.classList.contains('hidden')) ||
                           (window.EQ && EQ.isTuningLabActive);

        if (isThinking) {
            this.setExpression('thinking');
            return;
        }

        const volumeSlider = document.getElementById('eq-musicVolumeSlider');
        if (volumeSlider) {
            var vol = parseFloat(volumeSlider.value);
            if (vol === 0) {
                this.setExpression('hearnoevil');
                return;
            }
        }

        const balanceSlider = document.getElementById('a11y-balance-slider');
        const isImbalanced = (balanceSlider && Math.abs(parseFloat(balanceSlider.value)) > 12);
        if (isImbalanced) {
            this.setExpression('imbalance');
            return;
        }

        if (window.TestLab && !TestLab.spatialActive) {
            if (TestLab.resonanceActive) {
                this.setExpression('pain');
                return;
            }

            if (TestLab.burninActive) {
                this.setExpression('hot');
                return;
            }

            if (TestLab.channelToneOsc) {
                this.setExpression('imbalance');
                return;
            }

            var hasRumble = TestLab.activeNodes.some(function(n) {
                return (n instanceof OscillatorNode) && n.frequency && n.frequency.value <= 60;
            });
            if (hasRumble) {
                this.setExpression('rumble');
                return;
            }

            var hasPain = TestLab.activeNodes.some(function(n) {
                return (n instanceof OscillatorNode) && n.frequency && n.frequency.value >= 4000;
            });
            if (hasPain) {
                this.setExpression('pain');
                return;
            }
        }

        if (window.Tone && Tone.osc) {
            var freq = Tone.current;
            if (freq < 150) {
                this.setExpression('rumble');
                this.applyReactiveAnimation('rumble', 0.6);
            } else if (freq > 4000) {
                this.setExpression('pain');
                this.applyReactiveAnimation('pain', 0.6);
            } else {
                this.setExpression('vibing');
                this.applyReactiveAnimation('vibing', 0.5);
            }
            return;
        }

        var isSpatialPlaying = (window.TestLab && TestLab.playbackActive && !isMusicPlaying);

        if (isMusicPlaying) {
            this.setExpression('vibing');
        } else if (isSpatialPlaying) {

            if (this.currentExpression !== 'vibing' && this.currentExpression !== 'idle') {
                this.setExpression('vibing');
            }
        } else {

            this.expressions.idle = this.getSeasonalExpression();
            this.setExpression('idle');
        }
    }
};
