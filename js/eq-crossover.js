const EQ_CrossoverMethods = {
        toggleCrossover: function() {
            this.crossoverActive = !this.crossoverActive;
            const btn = document.getElementById('btn-crossover-toggle');
            const lbl = document.getElementById('lbl-crossover-state');
            const container = document.getElementById('crossover-sliders-container');

            if (this.crossoverActive) {
                if (btn) btn.classList.add('is-on');
                if (lbl) lbl.textContent = 'Crossover: ON';
                if (container) container.className = "flex flex-col gap-2 opacity-100 transition-all duration-200";
                showToast("Virtual Crossover Network Emulation engaged!", "🔀");
            } else {
                if (btn) btn.classList.remove('is-on');
                if (lbl) lbl.textContent = 'Crossover: OFF';
                if (container) container.className = "flex flex-col gap-2 opacity-40 pointer-events-none transition-all duration-200";
            }
            this.updateCrossoverDSP();
            this.drawCurve();
        },

        crossoverTypeModes: [
            { id: '2way', label: 'Way', emoji: '2️⃣' },
            { id: '3way', label: 'Way', emoji: '3️⃣' },
            { id: '4way', label: 'Way', emoji: '4️⃣' },
            { id: '5way', label: 'Way', emoji: '5️⃣' }
        ],
        cycleCrossoverType: function(dir) {
            const currentIdx = this.crossoverTypeModes.findIndex(m => m.id === (this.crossoverType || '3way'));
            const total = this.crossoverTypeModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.setCrossoverType(this.crossoverTypeModes[nextIdx].id);
        },
        setCrossoverType: function(type) {
            this.crossoverType = type;

            const stepperLabel = document.getElementById('xo-type-stepper-label');
            if (stepperLabel && this.crossoverTypeModes) {
                const info = this.crossoverTypeModes.find(m => m.id === type) || this.crossoverTypeModes[1];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }

            document.querySelectorAll('#crossover-sliders-container button').forEach(b => b.classList.remove('active'));
            const activeBtn = document.getElementById('xo-type-' + type);
            if (activeBtn) activeBtn.classList.add('active');

            // Hide/Show controls dynamically based on active crossover splits
            const f1 = document.getElementById('xo-freq1-container');
            const f2 = document.getElementById('xo-freq2-container');
            const f3 = document.getElementById('xo-freq3-container');
            const f4 = document.getElementById('xo-freq4-container');

            const tLow = document.getElementById('xo-trim-low-container');
            const tLowMid = document.getElementById('xo-trim-lowmid-container');
            const tMid = document.getElementById('xo-trim-mid-container');
            const tHighMid = document.getElementById('xo-trim-highmid-container');
            const tHigh = document.getElementById('xo-trim-high-container');

            // Reset visibilities
            [f1, f2, f3, f4, tLow, tLowMid, tMid, tHighMid, tHigh].forEach(el => {
                if (el) el.classList.add('hidden');
            });

            if (type === '2way') {
                if (f3) f3.classList.remove('hidden');
                if (tLow) tLow.classList.remove('hidden');
                if (tHigh) tHigh.classList.remove('hidden');
                
                // Retarget standard names for 2-Way displays
                const valEl = document.getElementById('xo-freq3-val');
                if (valEl) valEl.textContent = `${Math.round(this.crossoverFreq3)} Hz`;
            } 
            else if (type === '3way') {
                if (f2) f2.classList.remove('hidden');
                if (f3) f3.classList.remove('hidden');
                if (tLow) tLow.classList.remove('hidden');
                if (tMid) tMid.classList.remove('hidden');
                if (tHigh) tHigh.classList.remove('hidden');
            } 
            else if (type === '4way') {
                if (f2) f2.classList.remove('hidden');
                if (f3) f3.classList.remove('hidden');
                if (f4) f4.classList.remove('hidden');
                if (tLow) tLow.classList.remove('hidden');
                if (tMid) tMid.classList.remove('hidden');
                if (tHighMid) tHighMid.classList.remove('hidden');
                if (tHigh) tHigh.classList.remove('hidden');
            } 
            else if (type === '5way') {
                if (f1) f1.classList.remove('hidden');
                if (f2) f2.classList.remove('hidden');
                if (f3) f3.classList.remove('hidden');
                if (f4) f4.classList.remove('hidden');
                if (tLow) tLow.classList.remove('hidden');
                if (tLowMid) tLowMid.classList.remove('hidden');
                if (tMid) tMid.classList.remove('hidden');
                if (tHighMid) tHighMid.classList.remove('hidden');
                if (tHigh) tHigh.classList.remove('hidden');
            }

            this.updateCrossoverDSP();
            this.drawCurve();
        },

        updateCrossoverParam: function(param, val) {
            const num = parseFloat(val);
            const valEl = document.getElementById(`xo-${param}-val`);
            const trimEl = document.getElementById(`xo-trim-${param.toLowerCase().replace('trim','')}-val`);

            if (param === 'freq1') {
                this.crossoverFreq1 = num;
                if (valEl) valEl.textContent = Math.round(num) + " Hz";
            } else if (param === 'freq2') {
                this.crossoverFreq2 = num;
                if (valEl) valEl.textContent = Math.round(num) + " Hz";
            } else if (param === 'freq3') {
                this.crossoverFreq3 = num;
                if (valEl) valEl.textContent = Math.round(num) + " Hz";
            } else if (param === 'freq4') {
                this.crossoverFreq4 = num;
                if (valEl) valEl.textContent = Math.round(num) + " Hz";
            } else if (param === 'trimLow') {
                this.crossoverLowTrim = num;
                if (trimEl) trimEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(1) + " dB";
            } else if (param === 'trimLowMid') {
                this.crossoverLowMidTrim = num;
                if (trimEl) trimEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(1) + " dB";
            } else if (param === 'trimMid') {
                this.crossoverMidTrim = num;
                if (trimEl) trimEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(1) + " dB";
            } else if (param === 'trimHighMid') {
                this.crossoverHighMidTrim = num;
                if (trimEl) trimEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(1) + " dB";
            } else if (param === 'trimHigh') {
                this.crossoverHighTrim = num;
                if (trimEl) trimEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(1) + " dB";
            }

            this.updateCrossoverDSP();
            this.drawCurve();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },

        updateCrossoverDSP: function() {
            if (!this.graphBuilt || !SharedAudio.workletNode) return;

            const type = this.crossoverType;
            const lG = Math.pow(10, this.crossoverLowTrim / 20);
            const lmG = Math.pow(10, type === '5way' ? this.crossoverLowMidTrim / 20 : -150 / 20);
            const mG = Math.pow(10, (type === '3way' || type === '4way' || type === '5way') ? this.crossoverMidTrim / 20 : -150 / 20);
            const hmG = Math.pow(10, (type === '4way' || type === '5way') ? this.crossoverHighMidTrim / 20 : -150 / 20);
            const hG = Math.pow(10, this.crossoverHighTrim / 20);

            const payload = [
                // Driver 1 Lowpass
                { index: 0, bypassed: !this.crossoverActive, filterType: 'lowpass', frequency: type === '5way' ? this.crossoverFreq1 : (type === '2way' ? this.crossoverFreq3 : this.crossoverFreq2), gain: 0, q: 0.707 },
                
                // Driver 2 Bandpass (Highpass / Lowpass pair)
                { index: 1, bypassed: !this.crossoverActive || type !== '5way', filterType: 'highpass', frequency: this.crossoverFreq1, gain: 0, q: 0.707 },
                { index: 2, bypassed: !this.crossoverActive || type !== '5way', filterType: 'lowpass', frequency: this.crossoverFreq2, gain: 0, q: 0.707 },
                
                // Driver 3 Bandpass (Highpass / Lowpass pair)
                { index: 3, bypassed: !this.crossoverActive || !['3way', '4way', '5way'].includes(type), filterType: 'highpass', frequency: this.crossoverFreq2, gain: 0, q: 0.707 },
                { index: 4, bypassed: !this.crossoverActive || !['3way', '4way', '5way'].includes(type), filterType: 'lowpass', frequency: this.crossoverFreq3, gain: 0, q: 0.707 },
                
                // Driver 4 Bandpass (Highpass / Lowpass pair)
                { index: 5, bypassed: !this.crossoverActive || !['4way', '5way'].includes(type), filterType: 'highpass', frequency: this.crossoverFreq3, gain: 0, q: 0.707 },
                { index: 6, bypassed: !this.crossoverActive || !['4way', '5way'].includes(type), filterType: 'lowpass', frequency: this.crossoverFreq4, gain: 0, q: 0.707 },
                
                // Driver 5 Highpass
                { index: 7, bypassed: !this.crossoverActive, filterType: 'highpass', frequency: type === '2way' ? this.crossoverFreq3 : (type === '3way' ? this.crossoverFreq3 : this.crossoverFreq4), gain: 0, q: 0.707 }
            ];

            SharedAudio.workletNode.port.postMessage({
                type: 'updateCrossover',
                enabled: this.crossoverActive,
                xoType: type,
                gains: [lG, lmG, mG, hmG, hG],
                filters: payload
            });
        },
};
