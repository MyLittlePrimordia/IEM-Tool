const EQ_MathUtilMethods = {
    // Helper to retrieve the current active font family stack for HTML5 canvas drawings
    getActiveCanvasFont: function(size, weight = '') {
        const _now = Date.now();
        if (this._fontStackTs === undefined || _now - this._fontStackTs > 120) {
            this._fontStack = document.documentElement.style.getPropertyValue('--font-family') || '"Comic Sans MS"';
            this._fontStackTs = _now;
        }
        return `${weight ? weight + ' ' : ''}${size}px ${this._fontStack}`;
    },
    invalidateFontCache: function() {
        this._fontStackTs = 0;
    },
    // Linear-to-Logarithmic and Logarithmic-to-Linear conversion helpers
    logHzToSlider: function(hz) {
        const minF = 20, maxF = 20000;
        // Guard against corrupt/edge inputs (0, negative, NaN) that would log
        // straight to -Infinity and poison the slider fill.
        const safeHz = Number.isFinite(hz) ? Math.min(maxF, Math.max(minF, hz)) : minF;
        return Math.round(((Math.log10(safeHz) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF))) * 1000);
    },
    sliderToLogHz: function(val) {
        const minF = 20, maxF = 20000;
        return Math.round(Math.pow(10, Math.log10(minF) + (val / 1000) * (Math.log10(maxF) - Math.log10(minF))));
    }
};
