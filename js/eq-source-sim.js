const EQ_SourceSimMethods = {
        applySourceSimulation: function() {
            if (!this.graphBuilt) return;
            const dacName = IEM_Module.dacTiers[IEM_Module.currentDacIdx];
            
            let lowCutF = 10;
            let lowCutG = 0;
            let highCutF = 22000;
            let highCutG = 0;
            let headroomGain = 1.0;

            if (dacName === 'Phone') {
                lowCutF = 40;
                lowCutG = -6.0;
                highCutF = 14000;
                highCutG = -4.0;
                headroomGain = 0.55;
            } else if (dacName === 'Laptop') {
                lowCutF = 25;
                lowCutG = -2.5;
                highCutF = 18000;
                highCutG = -1.5;
                headroomGain = 0.85;
            } else if (dacName === 'Dongle') {
                lowCutF = 15;
                lowCutG = -0.5;
                highCutF = 21000;
                highCutG = -0.2;
                headroomGain = 0.95;
            } else if (dacName === 'Desktop') {
                lowCutF = 10;
                lowCutG = 0;
                highCutF = 22000;
                highCutG = 0;
                headroomGain = 0.98;
            }

            // Store in local variables for real-time graph calculations
            this.sourceSimLowF = lowCutF;
            this.sourceSimLowG = lowCutG;
            this.sourceSimHighF = highCutF;
            this.sourceSimHighG = highCutG;
            this.sourceSimGain = headroomGain;

            // Send DAC simulation parameters to worklet simulation filters (indices 10 & 11)
            if (SharedAudio.workletNode) {
                SharedAudio.workletNode.port.postMessage({
                    type: 'updateSimulations',
                    sims: [
                        { index: 10, bypassed: lowCutG === 0, filterType: 'lowshelf', frequency: lowCutF, gain: lowCutG, q: 0.7 },
                        { index: 11, bypassed: highCutG === 0, filterType: 'highshelf', frequency: highCutF, gain: highCutG, q: 0.7 }
                    ]
                });
                
                // Triggers preamp update to handle dac headroom scaling
                this.updatePreamp();
            }
            this.drawCurve();
        },
        applySimulationToFilters: function(filterArray, offsetIndex) {
            if (!filterArray || filterArray.length === 0) return;
            if (!this.simState) return;
            const tip = this.simState.tip;
            
            const strengthEl = document.getElementById('sim-tip-strength');
            const strength = strengthEl ? parseFloat(strengthEl.value) / 100 : 0.5;
            
            const depth = this.simState.depth;
            const seal = this.simState.seal;

            // Smooth Web Audio parameter transition wrapper with absolute parameter validation
            const setSmooth = (filter, type, freq, gain, q) => {
                if (!filter || !filter.frequency || !filter.gain) return;
                filter.type = type;
                setAudioParamSmooth(filter.frequency, freq);
                setAudioParamSmooth(filter.gain, gain);
                setAudioParamSmooth(filter.Q, q);
            };

            // Set default / silent states smoothly
            for (let k = 0; k < 5; k++) {
                setSmooth(filterArray[offsetIndex + k], 'peaking', 1000, 0, 1.0);
            }

            const f1 = filterArray[offsetIndex + 0];
            const f2 = filterArray[offsetIndex + 1];
            const f3 = filterArray[offsetIndex + 2];
            const f4 = filterArray[offsetIndex + 3];
            const f5 = filterArray[offsetIndex + 4];

            if (tip === 'foam') {
                setSmooth(f1, 'highshelf', 6000, -3.0 * strength, 0.7);
            } else if (tip === 'narrow') {
                setSmooth(f1, 'lowshelf', 200, 2.0 * strength, 0.7);
                setSmooth(f2, 'highshelf', 4000, -2.5 * strength, 0.7);
            } else if (tip === 'wide') {
                setSmooth(f1, 'lowshelf', 250, -1.5 * strength, 0.7);
                setSmooth(f2, 'highshelf', 5000, 1.5 * strength, 0.7);
            } else if (tip === 'double') {
                setSmooth(f1, 'peaking', 7000, -4.0 * strength, 2.5);
            } else if (tip === 'triple') {
                setSmooth(f1, 'highshelf', 5000, -3.5 * strength, 0.7);
                setSmooth(f2, 'peaking', 8000, -2.0 * strength, 1.5);
            }

            if (depth === 'shallow') {
                setSmooth(f3, 'peaking', 6000, 3.0, 2.0);
                setSmooth(f4, 'peaking', 8500, -4.0, 2.0);
            } else if (depth === 'deep') {
                setSmooth(f3, 'peaking', 8000, -4.0, 2.0);
                setSmooth(f4, 'peaking', 11500, 4.0, 1.5);
            }

            if (seal === 'good') {
                setSmooth(f5, 'lowshelf', 80, -2.5, 0.7);
            } else if (seal === 'loose') {
                setSmooth(f5, 'lowshelf', 150, -9.0, 0.7);
            } else if (seal === 'broken') {
                setSmooth(f5, 'lowshelf', 250, -18.0, 0.7);
            }
        },

        updateSelectorColors: function() {
            if (!this.simState) return;
            
            const btnTip = document.getElementById('btn-tip-sound');
            const btnDepth = document.getElementById('btn-fit-depth');
            const btnSeal = document.getElementById('btn-seal-quality');
            
            const tipNode = document.getElementById('lbl-tip-sound');
            const depthNode = document.getElementById('lbl-fit-depth');
            const sealNode = document.getElementById('lbl-seal-quality');

            if (tipNode) {
                const val = this.simState.tip || 'off';
                tipNode.textContent = val === 'off' ? "Off" : val.toUpperCase();
                if (val === 'off') {
                    tipNode.className = "text-white font-bold";
                    if (btnTip) btnTip.classList.remove('active-btn');
                } else {
                    const colMap = { foam: 'text-red-500', narrow: 'text-green-400', wide: 'text-orange-400', double: 'text-cyan-400', triple: 'text-purple-400' };
                    tipNode.className = `${colMap[val] || 'text-white'} font-bold`;
                    if (btnTip) btnTip.classList.add('active-btn');
                }
            }
            if (depthNode) {
                const val = this.simState.depth || 'off';
                depthNode.textContent = val === 'off' ? "Off" : val.toUpperCase();
                if (val === 'off') {
                    depthNode.className = "text-white font-bold";
                    if (btnDepth) btnDepth.classList.remove('active-btn');
                } else {
                    const colMap = { shallow: 'text-pink-400', medium: 'text-emerald-400', deep: 'text-purple-400' };
                    depthNode.className = `${colMap[val] || 'text-white'} font-bold`;
                    if (btnDepth) btnDepth.classList.add('active-btn');
                }
            }
            if (sealNode) {
                const val = this.simState.seal || 'off';
                const lblMap = { off: "Off", good: "GOOD", loose: "LOOSE", broken: "BROKEN" };
                sealNode.textContent = lblMap[val] || "Off";
                if (val === 'off') {
                    sealNode.className = "text-white font-bold";
                    if (btnSeal) btnSeal.classList.remove('active-btn');
                } else {
                    const colMap = { good: 'text-green-400', loose: 'text-yellow-400', broken: 'text-red-500' };
                    sealNode.className = `${colMap[val] || 'text-white'} font-bold`;
                    if (btnSeal) btnSeal.classList.add('active-btn');
                }
            }
        },

        cycleTipSound: function() {
            const curIdx = this.tipOptions.indexOf(this.simState.tip);
            const nextIdx = (curIdx + 1) % this.tipOptions.length;
            this.simState.tip = this.tipOptions[nextIdx];
            this.updateSelectorColors();
            this.updateSimulation();
        },

        cycleFitDepth: function() {
            const curIdx = this.depthOptions.indexOf(this.simState.depth);
            const nextIdx = (curIdx + 1) % this.depthOptions.length;
            this.simState.depth = this.depthOptions[nextIdx];
            this.updateSelectorColors();
            this.updateSimulation();
        },

        cycleSealQuality: function() {
            const curIdx = this.sealOptions.indexOf(this.simState.seal);
            const nextIdx = (curIdx + 1) % this.sealOptions.length;
            this.simState.seal = this.sealOptions[nextIdx];
            this.updateSelectorColors();
            this.updateSimulation();
        },

        updateSimulation: function() {
            const rawSliderVal = document.getElementById('sim-tip-strength')?.value;
            const parsedSliderVal = parseFloat(rawSliderVal);
            const strengthVal = Number.isFinite(parsedSliderVal) ? parsedSliderVal : 100;
            
            const displayEl = document.getElementById('sim-tip-strength-val');
            if (displayEl) displayEl.textContent = strengthVal + "%";
            
            if (!this.graphBuilt || !SharedAudio.workletNode) return;
            
            const tip = this.simState.tip;
            const depth = this.simState.depth;
            const seal = this.simState.seal;
            const strength = strengthVal / 100;

            const sims = [
                { index: 0, bypassed: true, filterType: 'peaking', frequency: 1000, gain: 0, q: 1.0 },
                { index: 1, bypassed: true, filterType: 'peaking', frequency: 1000, gain: 0, q: 1.0 },
                { index: 2, bypassed: true, filterType: 'peaking', frequency: 1000, gain: 0, q: 1.0 },
                { index: 3, bypassed: true, filterType: 'peaking', frequency: 1000, gain: 0, q: 1.0 },
                { index: 4, bypassed: true, filterType: 'peaking', frequency: 1000, gain: 0, q: 1.0 }
            ];

            // Map Eartip Simulations (Indices 0 and 1)
            if (tip === 'foam') {
                sims[0] = { index: 0, bypassed: false, filterType: 'highshelf', frequency: 6000, gain: -3.0 * strength, q: 0.7 };
            } else if (tip === 'narrow') {
                sims[0] = { index: 0, bypassed: false, filterType: 'lowshelf', frequency: 200, gain: 2.0 * strength, q: 0.7 };
                sims[1] = { index: 1, bypassed: false, filterType: 'highshelf', frequency: 4000, gain: -2.5 * strength, q: 0.7 };
            } else if (tip === 'wide') {
                sims[0] = { index: 0, bypassed: false, filterType: 'lowshelf', frequency: 250, gain: -1.5 * strength, q: 0.7 };
                sims[1] = { index: 1, bypassed: false, filterType: 'highshelf', frequency: 5000, gain: 1.5 * strength, q: 0.7 };
            } else if (tip === 'double') {
                sims[0] = { index: 0, bypassed: false, filterType: 'peaking', frequency: 7000, gain: -4.0 * strength, q: 2.5 };
            } else if (tip === 'triple') {
                sims[0] = { index: 0, bypassed: false, filterType: 'highshelf', frequency: 5000, gain: -3.5 * strength, q: 0.7 };
                sims[1] = { index: 1, bypassed: false, filterType: 'peaking', frequency: 8000, gain: -2.0 * strength, q: 1.5 };
            }

            // Map Fit Insertion Depth (Indices 2 and 3)
            if (depth === 'shallow') {
                sims[2] = { index: 2, bypassed: false, filterType: 'peaking', frequency: 6000, gain: 3.0, q: 2.0 };
                sims[3] = { index: 3, bypassed: false, filterType: 'peaking', frequency: 8500, gain: -4.0, q: 2.0 };
            } else if (depth === 'deep') {
                sims[2] = { index: 2, bypassed: false, filterType: 'peaking', frequency: 8000, gain: -4.0, q: 2.0 };
                sims[3] = { index: 3, bypassed: false, filterType: 'peaking', frequency: 11500, gain: 4.0, q: 1.5 };
            }

            // Map Acoustic Seal Leakage (Index 4)
            if (seal === 'good') {
                sims[4] = { index: 4, bypassed: false, filterType: 'lowshelf', frequency: 80, gain: -2.5, q: 0.7 };
            } else if (seal === 'loose') {
                sims[4] = { index: 4, bypassed: false, filterType: 'lowshelf', frequency: 150, gain: -9.0, q: 0.7 };
            } else if (seal === 'broken') {
                sims[4] = { index: 4, bypassed: false, filterType: 'lowshelf', frequency: 250, gain: -18.0, q: 0.7 };
            }

            SharedAudio.workletNode.port.postMessage({
                type: 'updateSimulations',
                sims: sims
            });
            this.drawCurve();
        },

        gearSimOptions: [
            { id: 'off', label: 'Off', icon: null, sub: 'Off', lowF: 10, lowG: 0, highF: 22000, highG: 0 },
            { id: 'desktop', label: 'Desktop Amp', icon: 'icons/desktop.png', sub: 'Clean & Flat', lowF: 10, lowG: 0, highF: 22000, highG: 0 },
            { id: 'laptop', label: 'Laptop', icon: 'icons/laptop.png', sub: 'Light Low-Cut', lowF: 40, lowG: -2.5, highF: 16000, highG: -1.5 },
            { id: 'phone', label: 'Phone', icon: 'icons/phone.png', sub: 'Mid-Bass Warmth', lowF: 120, lowG: 3.0, highF: 12000, highG: -3.5 },
            { id: 'dongle', label: 'Dongle DAC', icon: 'icons/dongle.png', sub: 'Portable Clean', lowF: 80, lowG: 1.5, highF: 18000, highG: -1.0 },
            { id: 'tube', label: 'Tube Amp', icon: 'icons/tube.png', sub: 'Warm & Smooth', lowF: 150, lowG: 5.0, highF: 5000, highG: -4.5 },
            { id: 'adapter10', label: '10Ω Adapter', icon: 'icons/impedance.png', sub: '+1.5dB Bass Boost', lowF: 120, lowG: 1.5, highF: 14000, highG: -1.0 },
            { id: 'adapter20', label: '20Ω Adapter', icon: 'icons/impedance.png', sub: '+2.5dB Bass Boost', lowF: 140, lowG: 2.5, highF: 12000, highG: -2.0 },
            { id: 'adapter30', label: '30Ω Adapter', icon: 'icons/impedance.png', sub: '+3.5dB Bass Boost', lowF: 150, lowG: 3.5, highF: 10000, highG: -3.0 },
            { id: 'adapter50', label: '50Ω Adapter', icon: 'icons/impedance.png', sub: '+5.0dB Bass Boost', lowF: 160, lowG: 5.0, highF: 8000, highG: -4.0 },
            { id: 'adapter75', label: '75Ω Adapter', icon: 'icons/impedance.png', sub: '+7.0dB Bass Boost', lowF: 180, lowG: 7.0, highF: 6000, highG: -5.0 },
            { id: 'adapter100', label: '100Ω Adapter', icon: 'icons/impedance.png', sub: '+9.0dB Bass Boost', lowF: 200, lowG: 9.0, highF: 5000, highG: -6.0 }
        ],
        currentGearIdx: 0,

        cycleGearSim: function(dir) {
            const total = this.gearSimOptions.length;
            this.currentGearIdx = ((this.currentGearIdx || 0) + dir + total) % total;
            const gear = this.gearSimOptions[this.currentGearIdx];

            const labelEl = document.getElementById('label-gear-sim');
            const subLabelEl = document.getElementById('gear-sim-sub-label');

            if (labelEl) {
                if (gear.id === 'off') {
                    labelEl.innerHTML = `<span class="truncate">Off</span>`;
                } else {
                    labelEl.innerHTML = `<img src="${gear.icon}" class="w-6 h-6 object-contain flex-shrink-0 inline-block"><span class="truncate">${gear.label}</span>`;
                }
            }
            if (subLabelEl) {
                subLabelEl.textContent = gear.sub;
            }

            this.applyGearSimDSP();
            this.drawCurve();
            if (window.Mascot) Mascot.triggerTemporaryExpression('cool', 1200);
            if (gear.id === 'off') {
                showToast("Gear Simulator: Off", "📻");
            } else {
                showToast(`Simulating ${gear.label} (${gear.sub})`, "📻");
            }
        },

        applyGearSimDSP: function() {
            if (!this.gearSimOptions) return;
            const gear = this.gearSimOptions[this.currentGearIdx || 0];
            if (!gear) return;

            this.sourceSimLowF = gear.lowF;
            this.sourceSimLowG = gear.lowG;
            this.sourceSimHighF = gear.highF;
            this.sourceSimHighG = gear.highG;

            if (SharedAudio.workletNode) {
                SharedAudio.workletNode.port.postMessage({
                    type: 'updateSimulations',
                    sims: [
                        { index: 10, bypassed: gear.lowG === 0, filterType: 'lowshelf', frequency: gear.lowF, gain: gear.lowG, q: 0.7 },
                        { index: 11, bypassed: gear.highG === 0, filterType: 'highshelf', frequency: gear.highF, gain: gear.highG, q: 0.7 }
                    ]
                });
            }
        },
};
