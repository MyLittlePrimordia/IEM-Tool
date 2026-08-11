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
