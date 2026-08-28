let specBarsPeaks = [];

let _specAccent = null;
let _specRgb = null;

EQ_Module.customEffects.spectrum_bars = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    fctx.fillRect(0, 0, w, h);

    const barCount = 64;
    const barWidth = w / barCount;
    const cy = h / 2;
    if (themeAccent !== _specAccent) { _specAccent = themeAccent; _specRgb = PEQDB_Module.hexToRgb(themeAccent); }
    const rgb = _specRgb;

    if (specBarsPeaks.length !== barCount) {
        specBarsPeaks = new Array(barCount).fill(0);
    }

    const usableBins = Math.floor(dataArray.length * 0.7);

    // The bar alpha depends only on the frame's treble value, which is the
    // same for every bar, so a single unit-space gradient replaces the old
    // 64 gradients per frame. Each bar scales unit-Y onto its own height, so
    // the vertical taper (dim -> bright -> dim) adapts to each bar exactly.
    const alpha = 0.55 + treble * 0.4;
    const bright = Math.min(1, alpha + 0.3);
    const grad = fctx.createLinearGradient(0, 0, 0, 1);
    grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grad.addColorStop(0.5, `rgba(${rgb}, ${bright})`);
    grad.addColorStop(1, `rgba(${rgb}, ${alpha})`);

    fctx.save();
    for (let i = 0; i < barCount; i++) {
        // Log-ish bin mapping so low bars carry bass detail and high bars sweep treble
        const startBin = Math.floor(Math.pow(i / barCount, 1.5) * usableBins);
        const endBin = Math.max(startBin + 1, Math.floor(Math.pow((i + 1) / barCount, 1.5) * usableBins));
        let sum = 0;
        for (let b = startBin; b < endBin; b++) sum += dataArray[b] || 0;
        const amp = (sum / (endBin - startBin)) / 255;

        // Peak-hold caps that slowly fall, classic hardware-EQ look
        specBarsPeaks[i] = Math.max(amp, specBarsPeaks[i] - 0.012);

        const barHeight = amp * (h * 0.48) * (1.0 + bassIntensity * 0.4);
        const x = i * barWidth;

        // Map unit space onto the bar: y in [0,1] -> [cy-barHeight, cy+barHeight]
        fctx.save();
        fctx.translate(x + 1, cy - barHeight);
        fctx.scale(1, barHeight * 2);
        fctx.fillStyle = grad;
        fctx.fillRect(0, 0, barWidth - 2, 1);
        fctx.restore();

        // Peak cap markers, top and bottom
        const peakOffset = specBarsPeaks[i] * (h * 0.48) * (1.0 + bassIntensity * 0.4);
        fctx.fillStyle = `rgba(${rgb}, 0.9)`;
        fctx.fillRect(x + 1, cy - peakOffset - 2, barWidth - 2, 2);
        fctx.fillRect(x + 1, cy + peakOffset, barWidth - 2, 2);
    }
    fctx.restore();
};
