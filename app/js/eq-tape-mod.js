// Split out of eq-core.js (2026 god-file refactor, Step 1).
// Tape-mod vent simulation: models vent-taping mods on an IEM shell as two
// worklet sim filters (slots 6/7). Fully this-scoped — merged into EQ_Module
// via Object.assign in db-cache.js; all methods keep their original names.
const EQ_TapeModMethods = {
            tapeModState: 'off',
            tapeModOptions: ['off', 'front', 'rear', 'full'],
            cycleTapeMod: function(dir = 1) {
                const total = this.tapeModOptions.length;
                const curIdx = this.tapeModOptions.indexOf(this.tapeModState);
                const nextIdx = (curIdx + dir + total) % total;
                this.tapeModState = this.tapeModOptions[nextIdx];
                this.updateTapeModUI();
                if (this.updateTapeModDSP) this.updateTapeModDSP();
                this.drawCurve();
                if (this.updateAudioConnections) this.updateAudioConnections();
            },
            updateTapeModDSP: function() {
                if (!this.graphBuilt || !SharedAudio.workletNode) return;
                const tapeMode = this.tapeModState;
                let s6 = { index: 6, bypassed: true, filterType: 'lowshelf', frequency: 120, gain: 0, q: 0.7 };
                let s7 = { index: 7, bypassed: true, filterType: 'peaking', frequency: 35, gain: 0, q: 1.2 };
                if (tapeMode === 'front') {
                    s6 = { index: 6, bypassed: false, filterType: 'lowshelf', frequency: 120, gain: 6.0, q: 0.7 };
                    s7 = { index: 7, bypassed: false, filterType: 'peaking', frequency: 35, gain: 2.5, q: 1.2 };
                } else if (tapeMode === 'rear') {
                    s6 = { index: 6, bypassed: false, filterType: 'lowshelf', frequency: 250, gain: 3.5, q: 0.7 };
                    s7 = { index: 7, bypassed: false, filterType: 'peaking', frequency: 150, gain: 2.0, q: 1.0 };
                } else if (tapeMode === 'full') {
                    s6 = { index: 6, bypassed: false, filterType: 'lowshelf', frequency: 180, gain: 8.5, q: 0.8 };
                    s7 = { index: 7, bypassed: false, filterType: 'peaking', frequency: 30, gain: 4.0, q: 1.5 };
                }
                SharedAudio.workletNode.port.postMessage({
                    type: 'updateSimulations',
                    sims: [s6, s7]
                });
            },
            updateTapeModUI: function() {
                const label = document.getElementById('label-tape-mod');
                const subLabel = document.getElementById('tape-mod-sub-label');
                const displayNames = {
                    off: 'Off (Stock Vents)',
                    front: 'Front Vent (Sub-Bass)',
                    rear: 'Rear Vent (Warmth)',
                    full: 'Full Tape (Max Slam)'
                };
                const subNames = {
                    off: 'Off',
                    front: '+6.0dB Sub',
                    rear: '+3.5dB Mid',
                    full: '+8.5dB Slam'
                };
                if (label) label.textContent = displayNames[this.tapeModState] || 'Off';
                if (subLabel) {
                    subLabel.textContent = subNames[this.tapeModState] || 'Off';
                    subLabel.className = this.tapeModState === 'off'
                        ? "font-mono text-emerald-400 font-bold text-[10px]"
                        : "font-mono text-amber-400 font-bold text-[10px]";
                }
            },
};
