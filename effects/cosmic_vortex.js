let vortexParticles = [];
let vortexAngle = 0;

let _cosmicAccent = null;
let _cosmicRgb = null;
let _cosmicGlowSprite = null;
let _cosmicGlowColor = null;

function _cGlowSprite(colorHex) {
    if (_cosmicGlowSprite && _cosmicGlowColor === colorHex) return _cosmicGlowSprite;
    if (!_cosmicGlowSprite) { _cosmicGlowSprite = document.createElement('canvas'); _cosmicGlowSprite.width = 64; _cosmicGlowSprite.height = 64; }
    const c = _cosmicGlowSprite.getContext('2d');
    c.clearRect(0, 0, 64, 64);
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, colorHex);
    g.addColorStop(0.45, colorHex);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    _cosmicGlowColor = colorHex;
    return _cosmicGlowSprite;
}

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

    if (themeAccent !== _cosmicAccent) { _cosmicAccent = themeAccent; _cosmicRgb = PEQDB_Module.hexToRgb(themeAccent); }
    const rgb = _cosmicRgb;
    const glowSprite = _cGlowSprite(themeAccent);
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

        // Pre-rendered soft glow sprite instead of per-particle shadowBlur (very expensive)
        const coreR = p.size * (1.0 + bassIntensity * 1.5);
        const glowR = coreR * 3.2 * (1.0 + treble * 1.5);
        fctx.globalAlpha = distanceAlpha;
        fctx.drawImage(glowSprite, x - glowR, y - glowR, glowR * 2, glowR * 2);
        fctx.globalAlpha = 1;

        fctx.fillStyle = `rgba(${rgb}, ${Math.min(1, distanceAlpha + 0.35)})`;
        fctx.beginPath();
        fctx.arc(x, y, coreR, 0, Math.PI * 2);
        fctx.fill();
    });

    fctx.restore();
};