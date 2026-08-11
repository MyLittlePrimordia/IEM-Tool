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
            showToast("Tempo Engine engaged! Playback rate active.", "⏱️");
        } else {
            if (btn) btn.classList.remove('is-on');
            if (lbl) lbl.textContent = 'Tempo: OFF';
            if (container) container.classList.add('opacity-40', 'pointer-events-none');
        }
        this.updateTempoDSP();
    },

    updateTempoDSP: function() {
        if (this.audioEl) {
            this.audioEl.playbackRate = this.tempoActive ? (this.tempoSpeed || 1.0) : 1.0;
        }
    },
};
