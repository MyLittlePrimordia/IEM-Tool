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
// R3: state only. This used to rewrite innerHTML with "🌙 Filter: ON" /
// "🌙 Filter: Off", which destroys any markup inside the button - the reason a
// real switch could not be built here. The visible wording now lives in the
// settings row label; the control is a switch driven purely by `is-on`.
btn.classList.toggle('is-on', this.blueLightActive);
btn.setAttribute('aria-checked', this.blueLightActive ? 'true' : 'false');
}
            
            // Show 😎 cool shades when blue light filter activates
            if (this.blueLightActive) {
                Mascot.triggerTemporaryExpression('cool', 2000);
            }
            
            localStorage.setItem('a11y_bluelight', this.blueLightActive ? 'true' : 'false');
        },
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
            // Only the balance slider changed. Passing it lets the painter
            // repaint one element instead of all ~111 range inputs on every
            // input event of a drag.
            if (window.syncGlobalSliders) window.syncGlobalSliders(slider);
            Mascot.update();
        }
    };

// Restore the persisted blue-light filter once the whole bundle has evaluated
// (init() touches Mascot, which is defined later in the bundle). Without this
// call the saved a11y_bluelight value was written but never read back.
(function () {
    function boot() { try { Accessibility.init(); } catch (e) { console.warn('[Accessibility] init failed', e); } }
    if (document.readyState === 'complete') setTimeout(boot, 0);
    else window.addEventListener('load', function () { setTimeout(boot, 0); }, { once: true });
})();
