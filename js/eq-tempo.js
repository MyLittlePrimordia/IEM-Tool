// ==========================================================================
// eq-tempo.js — Playback tempo/speed control for EQ_Module: on/off toggle and
// the audio element playbackRate DSP application. Extracted verbatim from the
// monolithic inline script (audit #4, twelfth slice -- eighth slice out of
// EQ_Module).
//
// Same re-attachment pattern as the previous EQ_Module slices: defines a plain
// object of just these methods, re-attached via
// Object.assign(EQ_Module, EQ_TempoMethods) right after EQ_Module's own closing
// brace, so `this` inside every method here is still EQ_Module -- no call sites
// changed.
//
// Checked before extracting: only reads/calls its own state (tempoActive,
// tempoSpeed, audioEl) and its own method (updateTempoDSP).
// ==========================================================================
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
