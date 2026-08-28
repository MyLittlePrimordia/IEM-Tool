// Cache particle arrays to prevent CPU/memory collection loops inside draw cycle
let starParticles = [];
let starLastW = 0;
let starLastH = 0;

EQ_Module.customEffects.neon_stars = function(fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble) {
    // Clear canvas with smooth translucent trail layer
    fctx.fillStyle = "rgba(0, 0, 0, 0.15)";
    fctx.fillRect(0, 0, w, h);
    
    // Populate stars on first frame
    if (starParticles.length === 0) {
        for (let i = 0; i < 150; i++) {
            starParticles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                speed: Math.random() * 1.5 + 0.5,
                size: Math.random() * 2 + 0.5
            });
        }
        starLastW = w;
        starLastH = h;
    } else if (w !== starLastW || h !== starLastH) {
        // Canvas resized since particles were seeded (window resize, layout change,
        // orientation change) — rescale positions proportionally instead of leaving
        // them clustered in a now-stale sub-region (audit finding 1.6).
        const scaleX = starLastW > 0 ? w / starLastW : 1;
        const scaleY = starLastH > 0 ? h / starLastH : 1;
        starParticles.forEach(star => {
            star.x *= scaleX;
            star.y *= scaleY;
        });
        starLastW = w;
        starLastH = h;
    }
    
    fctx.save();
    starParticles.forEach(star => {
        // Move stars downwards, accelerated by music's bass intensity
        star.y += star.speed * (1.0 + bassIntensity * 4.0);
        if (star.y > h) {
            star.y = 0;
            star.x = Math.random() * w;
        }
        
        // Draw star glow
        fctx.fillStyle = themeAccent;
        fctx.beginPath();
        fctx.arc(star.x, star.y, star.size * (1.0 + treble * 1.2), 0, Math.PI * 2);
        fctx.fill();
    });
    fctx.restore();
};
