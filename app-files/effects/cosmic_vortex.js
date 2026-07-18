let vortexParticles = [];
let vortexAngle = 0;

EQ_Module.customEffects.cosmic_vortex = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    // True OLED trailing clear layer
    fctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    fctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxDistance = Math.hypot(cx, cy); // Calculated from center to far corners

    // Initialize 350 particles spreading across 100% of the canvas
    if (vortexParticles.length === 0) {
        for (let i = 0; i < 350; i++) {
            vortexParticles.push({
                angle: Math.random() * Math.PI * 2,
                distanceRatio: Math.random(), // 0.0 (center) to 1.0 (corners)
                baseSpeed: (Math.random() * 0.008 + 0.002) * (Math.random() < 0.5 ? 1 : -1),
                size: Math.random() * 2.0 + 0.5
            });
        }
    }

    const rgb = PEQDB_Module.hexToRgb(themeAccent);
    vortexAngle += 0.005 + (midrange * 0.02);

    fctx.save();
    
    vortexParticles.forEach(p => {
        // Orbit speed scales with midrange/vocal frequencies
        p.angle += p.baseSpeed * (1.0 + midrange * 4.0);

        // Bass expansion factor: pushes particles toward screen boundaries
        let currentDistance = p.distanceRatio * maxDistance;
        if (bassIntensity > 0.1) {
            currentDistance += (bassIntensity * 120 * p.distanceRatio);
        }

        // Circular math projection
        const x = cx + Math.cos(p.angle + vortexAngle) * currentDistance;
        const y = cy + Math.sin(p.angle + vortexAngle) * currentDistance;

        // Skip calculations if particle is thrown off-screen
        if (x < 0 || x > w || y < 0 || y > h) return;

        // Color intensity matches distance from core (edge-fading)
        const distanceAlpha = Math.sin(p.distanceRatio * Math.PI) * (0.3 + treble * 0.7);

        fctx.fillStyle = `rgba(${rgb}, ${distanceAlpha})`;
        fctx.shadowBlur = p.size * (1.0 + treble * 6.0);
        fctx.shadowColor = themeAccent;
        
        fctx.beginPath();
        fctx.arc(x, y, p.size * (1.0 + bassIntensity * 1.5), 0, Math.PI * 2);
        fctx.fill();
    });

    fctx.restore();
};