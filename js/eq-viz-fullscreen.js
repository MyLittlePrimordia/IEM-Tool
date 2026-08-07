const EQ_VizFullscreenMethods = {
    isVizFullscreen: false,
    vizAutoHideTimer: null,
    isHoveringVizControls: false,

    toggleVisualizerFullscreen: function() {
        this.isVizFullscreen = !this.isVizFullscreen;
        const body = document.body;
        const btn = document.getElementById('viz-fullscreen-btn');

        if (this.isVizFullscreen) {
            body.classList.add('viz-fullscreen-active');
            if (btn) btn.innerHTML = '🗗 Exit Fullscreen';

            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(() => {});
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            }

            this.setupVizAutoHideListeners();
            this.resetVizAutoHideTimer();
            showToast("Fullscreen Active (Move mouse or click to show controls)", "⛶");
        } else {
            this.exitVisualizerFullscreen();
        }

        setTimeout(() => {
            if (this.fullscreenVizCanvas) {
                this.fullscreenVizCanvas.width = this.fullscreenVizCanvas.clientWidth;
                this.fullscreenVizCanvas.height = this.fullscreenVizCanvas.clientHeight;
            }
            this.drawCurve();
        }, 100);
    },

    exitVisualizerFullscreen: function() {
        this.isVizFullscreen = false;
        document.body.classList.remove('viz-fullscreen-active');

        const btn = document.getElementById('viz-fullscreen-btn');
        if (btn) btn.innerHTML = '⛶ Fullscreen';

        const footer = document.getElementById('global-footer-bar');
        const overlay = document.getElementById('viz-controls-overlay');
        if (footer) footer.classList.remove('autohide-hidden');
        if (overlay) overlay.classList.remove('autohide-hidden');

        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }

        this.clearVizAutoHideListeners();
    },

    resetVizAutoHideTimer: function() {
        if (!this.isVizFullscreen) return;

        const footer = document.getElementById('global-footer-bar');
        const overlay = document.getElementById('viz-controls-overlay');
        if (footer) footer.classList.remove('autohide-hidden');
        if (overlay) overlay.classList.remove('autohide-hidden');

        clearTimeout(this.vizAutoHideTimer);
        this.vizAutoHideTimer = setTimeout(() => {
            if (this.isVizFullscreen && !this.isHoveringVizControls) {
                if (footer) footer.classList.add('autohide-hidden');
                if (overlay) overlay.classList.add('autohide-hidden');
            }
        }, 3000);
    },

    setupVizAutoHideListeners: function() {
        if (this._vizAutoHideBound) return;
        this._vizAutoHideBound = true;

        this._onVizActivity = () => {
            if (this.isVizFullscreen) {
                this.resetVizAutoHideTimer();
            }
        };

        const pane = document.getElementById('pane-visualizer');
        if (pane) {
            pane.addEventListener('mousemove', this._onVizActivity);
            pane.addEventListener('click', this._onVizActivity);
            pane.addEventListener('touchstart', this._onVizActivity, { passive: true });
        }

        const footer = document.getElementById('global-footer-bar');
        const overlay = document.getElementById('viz-controls-overlay');

        this._onControlEnter = () => {
            this.isHoveringVizControls = true;
            clearTimeout(this.vizAutoHideTimer);
        };
        this._onControlLeave = () => {
            this.isHoveringVizControls = false;
            this.resetVizAutoHideTimer();
        };

        [footer, overlay].forEach(el => {
            if (el) {
                el.addEventListener('mouseenter', this._onControlEnter);
                el.addEventListener('mouseleave', this._onControlLeave);
            }
        });

        this._onFullscreenChangeHandler = () => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement && this.isVizFullscreen) {
                this.exitVisualizerFullscreen();
            }
        };

        document.addEventListener('fullscreenchange', this._onFullscreenChangeHandler);
    },

    clearVizAutoHideListeners: function() {
        clearTimeout(this.vizAutoHideTimer);
        this.isHoveringVizControls = false;
        if (!this._vizAutoHideBound) return;

        const pane = document.getElementById('pane-visualizer');
        if (pane && this._onVizActivity) {
            pane.removeEventListener('mousemove', this._onVizActivity);
            pane.removeEventListener('click', this._onVizActivity);
            pane.removeEventListener('touchstart', this._onVizActivity);
        }

        [document.getElementById('global-footer-bar'), document.getElementById('viz-controls-overlay')].forEach(el => {
            if (el) {
                el.removeEventListener('mouseenter', this._onControlEnter);
                el.removeEventListener('mouseleave', this._onControlLeave);
            }
        });

        if (this._onFullscreenChangeHandler) {
            document.removeEventListener('fullscreenchange', this._onFullscreenChangeHandler);
        }

        this._vizAutoHideBound = false;
        this._onVizActivity = null;
        this._onControlEnter = null;
        this._onControlLeave = null;
        this._onFullscreenChangeHandler = null;
    },

    cycleVizEffect: function() {
        this.vizModeIndex = (this.vizModeIndex + 1) % this.vizModes.length;
        const btn = document.getElementById('viz-effect-btn');
        if (btn) {
            const names = {
                horizontalSpectrogram: '🌅 Spectrogram',
                fullScreenWaterfall: '⛰️ Waterfall',
                acousticTunnel: '🌌 Tunnel',
                oledSpectrum: '📊 Spectrum',
                oscilloscope: '📈 Waveform',
                audioMesh: '🌐 Mesh'
            };

            let activeName = names[this.vizModes[this.vizModeIndex]];

            if (!activeName && this.customEffectsList) {
                const customMatch = this.customEffectsList.find(e => e.id === this.vizModes[this.vizModeIndex]);
                if (customMatch) {
                    activeName = `${customMatch.emoji} ${customMatch.name}`;
                }
            }

            btn.textContent = ` ${activeName || 'Unknown'}`;
        }
    },
};
