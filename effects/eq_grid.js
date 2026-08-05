let gridPeaks = [];

EQ_Module.customEffects.eq_grid = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    fctx.fillRect(0, 0, w, h);

    const colCount = 32;
    const rowCount = 18;
    const colWidth = w / colCount;
    const rowHeight = h / rowCount;
    const gap = 2;
    const rgb = PEQDB_Module.hexToRgb(themeAccent);

    if (gridPeaks.length !== colCount) gridPeaks = new Array(colCount).fill(0);

    const usableBins = Math.floor(dataArray.length * 0.7);

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
                let cellColor;
                if (heat > 0.75) {
                    cellColor = `rgba(255, 70, 70, ${0.85 + treble * 0.15})`;
                } else if (heat > 0.45) {
                    cellColor = `rgba(255, 210, 60, ${0.8 + midrange * 0.2})`;
                } else {
                    cellColor = `rgba(${rgb}, ${0.75 + bassIntensity * 0.25})`;
                }
                fctx.fillStyle = cellColor;
            } else {
                fctx.fillStyle = `rgba(${rgb}, 0.06)`;
            }
            fctx.fillRect(x + gap / 2, y + gap / 2, colWidth - gap, rowHeight - gap);
        }
    }
    fctx.restore();
};
