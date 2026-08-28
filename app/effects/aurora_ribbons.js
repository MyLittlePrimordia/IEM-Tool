let auroraTime = 0;

let _aurAccent = null;
let _aurRgb = null;
let _aurGrads = null;
let _aurGradH = -1;

EQ_Module.customEffects.aurora_ribbons = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    fctx.fillRect(0, 0, w, h);

    // Rebuild the four ribbon gradients only when the accent color or canvas
    // height changes. The gradient's alpha envelope is fixed (edges 0, peak 1);
    // the per-frame brightness is applied via globalAlpha, so the peak alpha
    // stays `min(0.85, alpha+0.3)` exactly as before — no gradient is created
    // per frame.
    if (themeAccent !== _aurAccent || _aurGradH !== h) {
        _aurAccent = themeAccent;
        _aurRgb = PEQDB_Module.hexToRgb(themeAccent);
        _aurGradH = h;
        _aurGrads = [];
        for (let r = 0; r < 4; r++) {
            const baseY = h * ((r + 0.5) / 4);
            const bandHeight = (h / 4) * 0.9;
            const g = fctx.createLinearGradient(0, baseY - bandHeight, 0, baseY + bandHeight);
            g.addColorStop(0, `rgba(${_aurRgb}, 0)`);
            g.addColorStop(0.5, `rgba(${_aurRgb}, 1)`);
            g.addColorStop(1, `rgba(${_aurRgb}, 0)`);
            _aurGrads[r] = g;
        }
    }
    const rgb = _aurRgb;
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
        fctx.globalAlpha = Math.min(0.85, alpha + 0.3);
        fctx.fillStyle = _aurGrads[r];
        fctx.fill();
        fctx.globalAlpha = 1;
    }
    fctx.restore();
};
