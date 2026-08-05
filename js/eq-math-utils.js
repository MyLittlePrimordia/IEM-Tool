const EQ_MathUtilMethods = {
    // Helper to retrieve the current active font family stack for HTML5 canvas drawings
    getActiveCanvasFont: function(size, weight = '') {
        const fontStack = document.documentElement.style.getPropertyValue('--font-family') || '"Comic Sans MS"';
        return `${weight ? weight + ' ' : ''}${size}px ${fontStack}`;
    },
    // Linear-to-Logarithmic and Logarithmic-to-Linear conversion helpers
    logHzToSlider: function(hz) {
        const minF = 20, maxF = 20000;
        return Math.round(((Math.log10(hz) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF))) * 1000);
    },
    sliderToLogHz: function(val) {
        const minF = 20, maxF = 20000;
        return Math.round(Math.pow(10, Math.log10(minF) + (val / 1000) * (Math.log10(maxF) - Math.log10(minF))));
    }
};
