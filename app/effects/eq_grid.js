let gridPeaks = [];

let _gridAccent = null;
let _gridRgb = null;

EQ_Module.customEffects.eq_grid = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    fctx.fillRect(0, 0, w, h);

    const colCount = 32;
    const rowCount = 18;
    const colWidth = w / colCount;
    const rowHeight = h / rowCount;
    const gap = 2;
    if (themeAccent !== _gridAccent) { _gridAccent = themeAccent; _gridRgb = PEQDB_Module.hexToRgb(themeAccent); }
    const rgb = _gridRgb;

    if (gridPeaks.length !== colCount) gridPeaks = new Array(colCount).fill(0);

    const usableBins = Math.floor(dataArray.length * 0.7);

    // Per-frame color table: the three heat tiers + the unlit cell color are
    // the ONLY colors this effect ever draws (their variables — treble,
    // midrange, bassIntensity, rgb — are constant within a frame). Building
    // them once instead of per-cell removes ~570 string allocations +
    // fillStyle churn per frame (~34k/sec at 60fps).
    const colorHot = `rgba(255, 70, 70, ${(0.85 + treble * 0.15).toFixed(3)})`;
    const colorMid = `rgba(255, 210, 60, ${(0.8 + midrange * 0.2).toFixed(3)})`;
    const colorLow = `rgba(${rgb}, ${(0.75 + bassIntensity * 0.25).toFixed(3)})`;
    const colorOff = `rgba(${rgb}, 0.06)`;

    fctx.save();
    for (let c = 0; c < colCount; c++) {
        const startBin = Math.floor(Math.pow(c / colCount, 1.4) * usableBins);
        const endBin = Math.max(startBin + 1, Math.floor(Math.pow((c + 1) / colCount, 1.4) * usableBins));
        let sum = 0;
        for (let b = startBin; b < endBin; b++) sum += dataArray[b] || 0;
        const amp = (sum / (endBin - startBin)) / 255;

        gridPeaks[c] = Math.max(amp, gridPeaks[c] - 0.02);
        const litRows = Math.round(gridPeaks[c] * rowCount * (1 + bassIntensity * 0.3));

        // Columns span the full width, rows stack the full height (classic hardware VU meter)
        for (let r = 0; r < rowCount; r++) {
            const fromBottom = rowCount - 1 - r;
            const x = c * colWidth;
            const y = r * rowHeight;

            if (fromBottom < litRows) {
                const heat = fromBottom / rowCount; // near 0 at bottom, near 1 at top
                if (heat > 0.75) fctx.fillStyle = colorHot;
                else if (heat > 0.45) fctx.fillStyle = colorMid;
                else fctx.fillStyle = colorLow;
            } else {
                fctx.fillStyle = colorOff;
            }
            fctx.fillRect(x + gap / 2, y + gap / 2, colWidth - gap, rowHeight - gap);
        }
    }
    fctx.restore();
};
