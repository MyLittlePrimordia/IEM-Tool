// ==========================================================================
// accessibility.js — Accessibility: blue-light filter, mono/stereo channel
// mode, L/R balance handling. Extracted verbatim from the monolithic inline
// script (audit #4, third slice).
//
// This one DOES reach into other modules, but only through late-bound global
// lookups that resolve at call time (window.EQ, window.toggleAudioMode,
// window.isMonoMode, Mascot, window.syncGlobalSliders) -- never at load time.
// Every method here only runs from a UI event handler, long after the rest of
// the app has finished loading and those globals exist, so moving this file
// earlier in the load order (it's injected in <head>, before Mascot/EQ_Module
// are even declared) is safe. This is a different situation from utils.js and
// audio-engine.js, which had zero cross-module references at all -- read this
// note before extracting anything else this way, since the safety argument
// here rests on 'nothing calls these methods until after boot', not on
// 'nothing here touches other modules'.
// ==========================================================================
// Temporary Accessibility Shim to prevent lifecycle exceptions during transition
    const Accessibility = {
        blueLightActive: false,
        init: function() {
            // Restore filter state from local storage on application load
            if (localStorage.getItem('a11y_bluelight') === 'true') {
                this.toggleBlueLightFilter();
            }
        },
                toggleBlueLightFilter: function() {
            this.blueLightActive = !this.blueLightActive;
            const overlay = document.getElementById('blue-light-screen');
            const btn = document.getElementById('a11y-bluelight-btn');
            
            if (overlay) {
                overlay.style.display = this.blueLightActive ? 'block' : 'none';
            }
            if (btn) {
                btn.innerHTML = this.blueLightActive ? "🟠 Filter: ON" : "🌙 Filter: Off";
                if (this.blueLightActive) {
                    btn.classList.add('active-btn');
                } else {
                    btn.classList.remove('active-btn');
                }
            }
            
            // Show 😎 cool shades when blue light filter activates
            if (this.blueLightActive) {
                Mascot.triggerTemporaryExpression('cool', 2000);
            }
            
            localStorage.setItem('a11y_bluelight', this.blueLightActive ? 'true' : 'false');
        },
        applyAll: function() {},
                setChannelMode: function(mode) {
            const desiredMono = (mode === 'mono');
            if (window.isMonoMode !== desiredMono && window.toggleAudioMode) {
                window.toggleAudioMode();
            }
        },
        setBalance: function(val) {
            if (window.EQ && EQ.updateBalance) {
                EQ.updateBalance(parseFloat(val) / 100);
            }
        },
        handleBalanceInput: function(slider) {
            let val = parseInt(slider.value);
            const threshold = 12; // Snap magnet zone threshold
            
            if (Math.abs(val) < threshold) {
                val = 0;
                slider.value = 0;
            }
            this.setBalance(val);
            if (window.syncGlobalSliders) window.syncGlobalSliders();
            Mascot.update();
        },
        setNormalize: function(mode) {},
        setLimiter: function(mode) {}
    };
