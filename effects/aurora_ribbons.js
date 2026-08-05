let auroraTime = 0;

EQ_Module.customEffects.aurora_ribbons = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    fctx.fillRect(0, 0, w, h);

    const rgb = PEQDB_Module.hexToRgb(themeAccent);
    auroraTime += 0.015 + bassIntensity * 0.03;

    const ribbonCount = 4;
    const usableBins = Math.floor(dataArray.length * 0.55);

    fctx.save();
    for (let r = 0; r < ribbonCount; r++) {
        // Each ribbon claims its own horizontal band, together covering the full height
        const baseY = h * ((r + 0.5) / ribbonCount);
        const bandHeight = (h / ribbonCount) * 0.9;

        fctx.beginPath();
        for (let x = 0; x <= w; x += 6) {
            const nx = x / w;
            const binIdx = Math.floor(nx * usableBins);
            const amp = (dataArray[binIdx] || 0) / 255;

            const wave = Math.sin(nx * 6 + auroraTime + r * 1.7) * (bandHeight * 0.35);
            const audioLift = amp * bandHeight * 0.6 * (1 + bassIntensity * 0.5);
            const y = baseY + wave - audioLift;

            if (x === 0) fctx.moveTo(x, y);
            else fctx.lineTo(x, y);
        }
        // Close the ribbon shape back along the band for a filled, flowing look
        for (let x = w; x >= 0; x -= 6) {
            const nx = x / w;
            const binIdx = Math.floor(nx * usableBins);
            const amp = (dataArray[binIdx] || 0) / 255;
            const wave = Math.sin(nx * 6 + auroraTime + r * 1.7 + 0.6) * (bandHeight * 0.35);
            const y = baseY + wave + amp * bandHeight * 0.1 + bandHeight * 0.15;
            fctx.lineTo(x, y);
        }
        fctx.closePath();

        const alpha = 0.12 + treble * 0.15 + (r === 0 ? bassIntensity * 0.1 : 0);
        const grad = fctx.createLinearGradient(0, baseY - bandHeight, 0, baseY + bandHeight);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(0.5, `rgba(${rgb}, ${Math.min(0.85, alpha + 0.3)})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        fctx.fillStyle = grad;
        fctx.fill();
    }
    fctx.restore();
};
