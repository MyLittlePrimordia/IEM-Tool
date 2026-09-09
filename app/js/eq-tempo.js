const EQ_TempoMethods = {
    toggleTempo: function() {
        this.tempoActive = !this.tempoActive;
        const btn = document.getElementById('btn-tempo-toggle');
        const lbl = document.getElementById('lbl-tempo-state');
        const container = document.getElementById('tempo-slider-container');

        if (this.tempoActive) {
            if (btn) btn.classList.add('is-on');
            if (lbl) lbl.textContent = 'Tempo: ON';
            if (container) container.classList.remove('opacity-40', 'pointer-events-none');
            showToast("Speed active (playbackRate: pitch shifts with speed).", "⏱️");
        } else {
            if (btn) btn.classList.remove('is-on');
            if (lbl) lbl.textContent = 'Tempo: OFF';
            if (container) container.classList.add('opacity-40', 'pointer-events-none');
        }
        this.updateTempoDSP();
    },
    updateTempoDSP: function() {
        // Apply to BOTH playback arms — with gapless/crossfade active the
        // standby element takes over at the seam and previously stayed at
        // 1.0x, pitch-jumping mid-track.
        const rate = this.tempoActive ? (this.tempoSpeed || 1.0) : 1.0;
        if (this.audioEl) this.audioEl.playbackRate = rate;
        if (this.gaplessEl) this.gaplessEl.playbackRate = rate;
    },
    updateTempoSpeed: function(val) {
        // Guard the parse: parseFloat('') || 100 mapped a programmatic 0 to
        // 100 (1.0x) instead of the floor.
        const parsed = parseFloat(val);
        this.tempoSpeed = Math.max(0.1, Math.min(5, Number.isFinite(parsed) ? parsed / 100 : 100 / 100));
        this.updateTempoDSP();
        // The readout had no writer — it showed 1.00x forever.
        const disp = document.getElementById('tempo-speed-val');
        if (disp) disp.textContent = this.tempoSpeed.toFixed(2) + 'x';
    },
};
