let waveScrollOffset = 0;

EQ_Module.customEffects.liquid_fiber = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    fctx.fillStyle = "rgba(0, 0, 0, 0.22)"; // Heavy trails for liquid visual flow
    fctx.fillRect(0, 0, w, h);

    const numStrands = 5;
    const cy = h / 2;
    const rgb = PEQDB_Module.hexToRgb(themeAccent);

    // Scroll speed is modulated by average bass levels
    waveScrollOffset += 0.05 + (bassIntensity * 0.12);

    fctx.save();
    
    for (let s = 0; s < numStrands; s++) {
        fctx.beginPath();
        fctx.lineWidth = 1.0 + (s * 0.8) + (treble * 2.0);
        
        // Multi-level opacity fade per strand layer
        const alpha = (1.0 - (s / numStrands)) * (0.35 + midrange * 0.5);
        fctx.strokeStyle = `rgba(${rgb}, ${alpha})`;

        for (let x = 0; x < w; x += 3) {
            // Map horizontal index directly to corresponding FFT bin ranges
            const binIdx = Math.floor((x / w) * (dataArray.length * 0.35));
            const fftAmplitude = (dataArray[binIdx] || 0) / 255.0;

            // Mathematical sine wave landscape
            const waveX = (x * 0.006) + waveScrollOffset + (s * 0.45);
            const primaryHarmonic = Math.sin(waveX);
            const secondaryHarmonic = Math.cos(waveX * 2.2 + s) * 0.35;

            // Height displacement is driven by the dynamic audio parameters
            const scaleY = (h * 0.18) * (1.0 + bassIntensity * 0.8) * (0.2 + fftAmplitude * 0.8);
            
            const y = cy + (primaryHarmonic + secondaryHarmonic) * scaleY;

            if (x === 0) fctx.moveTo(x, y);
            else fctx.lineTo(x, y);
        }
        fctx.stroke();
    }

    fctx.restore();
};