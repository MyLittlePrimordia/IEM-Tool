let burstAngleOffset = 0;

EQ_Module.customEffects.radial_burst = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    fctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.hypot(cx, cy); // reaches every corner of the canvas
    const rgb = PEQDB_Module.hexToRgb(themeAccent);
    const spokeCount = 96;

    burstAngleOffset += 0.0025 + (midrange * 0.01);

    fctx.save();
    fctx.lineCap = 'round';

    const usableBins = Math.floor(dataArray.length * 0.6);
    for (let i = 0; i < spokeCount; i++) {
        const angle = (i / spokeCount) * Math.PI * 2 + burstAngleOffset;
        const binIdx = Math.floor((i / spokeCount) * usableBins);
        const amp = (dataArray[binIdx] || 0) / 255;

        const innerR = maxRadius * 0.08 * (1.0 + bassIntensity * 0.6);
        const outerR = innerR + amp * maxRadius * (0.85 + bassIntensity * 0.3);

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR;

        const alpha = 0.25 + amp * 0.65 + treble * 0.2;
        fctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, alpha)})`;
        fctx.lineWidth = 1.5 + amp * 4;
        fctx.shadowBlur = 6 + treble * 10;
        fctx.shadowColor = themeAccent;

        fctx.beginPath();
        fctx.moveTo(x1, y1);
        fctx.lineTo(x2, y2);
        fctx.stroke();
    }
    fctx.restore();
};
