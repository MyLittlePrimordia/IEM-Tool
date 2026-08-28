const EQ_ExportMethods = {
        triggerDownload: function(filename, text) { 
            try {
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const el = document.createElement('a'); 
                el.setAttribute('href', url); 
                el.setAttribute('download', filename); 
                el.style.display = 'none'; 
                if (!document.body) { URL.revokeObjectURL(url); return; }
                document.body.appendChild(el); 
                try { el.click(); } catch (_) {}
                try { document.body.removeChild(el); } catch (_) {}
                setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
            } catch (e) { console.warn('[Export] download failed', e); }
        },
        getSanitizedExportFilename: function(suffix, extension) {
            const model = (document.getElementById('model')?.value || '').trim() || "IEM";
            const brand = (document.getElementById('brand')?.value || '').trim();
            const baseName = brand ? `${brand}_${model}` : model;
            
            // Access lexical scope variable directly instead of window namespace
            let targetName = "Custom_EQ";
            if (typeof PEQDB_Module !== 'undefined' && PEQDB_Module.STATE && PEQDB_Module.STATE.activeCurves) {
                const targetCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target' && c.visible);
                if (targetCurve) {
                    targetName = targetCurve.name;
                }
            }
            
            // Strip emojis to prevent OS file saving errors
            let cleanTargetName = targetName.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF])/g, '').trim();
            if (!cleanTargetName) cleanTargetName = "Target";

            let rawFilename = `${baseName}_to_${cleanTargetName}_${suffix}`;
            
            rawFilename = rawFilename.replace(/[\s/\\?%*:|"<>]+/g, '_'); 
            rawFilename = rawFilename.replace(/__+/g, '_');
            rawFilename = rawFilename.replace(/[^\w\-.()]/g, ''); 
            return `${rawFilename}.${extension}`;
        },
        updateMarquee: function() {
            ['playlist-track-info', 'mobile-track-info'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                
                el.classList.remove('marquee-active');
                el.style.transform = '';
                
                // Allow DOM thread to apply changes, then calculate widths
                setTimeout(() => {
                    if (!el || !el.parentElement) return;
                    const parentWidth = el.parentElement.clientWidth;
                    const childWidth = el.scrollWidth;
                    
                    if (childWidth > parentWidth) {
                        const scrollDist = -(childWidth - parentWidth + 12);
                        el.style.setProperty('--scroll-dist', `${scrollDist}px`);
                        el.classList.add('marquee-active');
                    }
                }, 50);
            });
        },
        exportPeace: function() {
            var _a = this.getRealValues() || {}, preVal = _a.preVal || 0, mainVals = _a.mainVals || [], advVals = _a.advVals || [];
            var out = 'Preamp: ' + preVal.toFixed(1) + ' dB\n';
            var fIdx = 1;

            var typeMap = {
                peaking: 'PK', lowshelf: 'LSC', highshelf: 'HSC',
                highpass: 'HPQ', lowpass: 'LPQ', notch: 'NO'
            };

            var exportBand = function(v) {
                if (!v) return;
                var apoType = typeMap[v.type] || 'PK';
                var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                var gVal = hasNoGain ? 0.0 : v.g;
                
                // Only bypass completely flat peaking bands to declutter the file
                if (v.type === 'peaking' && v.g === 0) return;
                
                out += 'Filter ' + (fIdx++) + ': ON ' + apoType + ' Fc ' + v.hz + ' Hz Gain ' + gVal.toFixed(1) + ' dB Q ' + v.q.toFixed(2) + '\n';
            };
            
            const bandCount = PEQDB_Module.autoeqResolution || 10;
            
            // 1. Export Standard Bands (Up to 10)
            // The DSP always applies all 10 standard + all 10 advanced bands
            // regardless of autoeqResolution, so every non-flat band must be
            // exported — a smaller bandCount only affects how many get a slot
            // in the auto-EQ resolution, not what the user hears.
            const standardCountToExport = Math.min(10, bandCount);
            for (let i = 0; i < standardCountToExport; i++) {
                exportBand(mainVals[i]);
            }
            
            // 2. Export Advanced Bands (all 10, when non-flat)
            for (let i = 0; i < 10; i++) {
                exportBand(advVals[i]);
            }
            
            // 3. Export under-the-hood virtual filters (Up to 30)
            if (this.virtualBands) {
                const virtualCountToExport = Math.min(30, this.virtualBands.length);
                for (let i = 0; i < virtualCountToExport; i++) {
                    const v = this.virtualBands[i];
                    if (v && v.g !== 0) {
                        const apoType = typeMap[v.type] || 'PK';
                        out += 'Filter ' + (fIdx++) + ': ON ' + apoType + ' Fc ' + v.hz + ' Hz Gain ' + v.g.toFixed(1) + ' dB Q ' + v.q.toFixed(2) + '\n';
                    }
                }
            }
            
            // Peace GUI EQ text format has no slope field — warn when an
            // exported shelf (or any cascaded band) would lose its slope.
            const shelfWithSlope = (v) => v && (v.type === 'lowshelf' || v.type === 'highshelf') && (v.slope || 12) !== 12;
            if (mainVals.some(shelfWithSlope) || advVals.some(shelfWithSlope) || (this.virtualBands || []).some(shelfWithSlope)) {
                showToast("Note: export format can't encode shelf slope — using default 12 dB/oct.", "📜");
            }
            
            if (this.hearingCalEnabled) {
                [250, 500, 1000, 2000, 4000, 8000, 12000, 16000].forEach(function(freq, idx) {
                    var gain = EQ_Module.hearingOffsets[idx] || 0;
                    if (gain !== 0) out += 'Filter ' + (fIdx++) + ': ON PK Fc ' + freq + ' Hz Gain ' + gain.toFixed(1) + ' dB Q 1.00\n';
                });
            }
            
            // NOTE: the ear-resonance notch needs no extra filter here.
            // lockResonancePeak() writes it into main band 8, so it is already
            // included via mainVals below — appending another filter here
            // double-counted it (~-7.5 dB total vs -4.5 dB live).

            if (this.deEsserEnabled) {
                // Export the tracked notch frequency (matches what the worklet
                // is actually applying) rather than the 6 kHz placeholder.
                var deFreq = (typeof this.deEsserCurrentFreq === 'number' && isFinite(this.deEsserCurrentFreq)) ? Math.round(this.deEsserCurrentFreq) : 6000;
                out += 'Filter ' + (fIdx++) + ': ON PK Fc ' + deFreq + ' Hz Gain ' + (-3.0 * (this.deEsserSensitivity / 100)).toFixed(1) + ' dB Q 2.50\n';
            }
            
            var bassSlider = document.getElementById("eq-masterBass");
            var trebSlider = document.getElementById("eq-masterTreble");
            if (bassSlider && parseFloat(bassSlider.value) !== 0) {
                out += 'Filter ' + (fIdx++) + ': ON LSC Fc 105 Hz Gain ' + parseFloat(bassSlider.value).toFixed(1) + ' dB Q 0.70\n';
            }
            if (trebSlider && parseFloat(trebSlider.value) !== 0) {
                out += 'Filter ' + (fIdx++) + ': ON HSC Fc 8000 Hz Gain ' + parseFloat(trebSlider.value).toFixed(1) + ' dB Q 0.70\n';
            }
            
            this.triggerDownload(this.getSanitizedExportFilename("PEQ", "txt"), out);
            showToast("Exported Peace GUI EQ Preset!", "📜");
        },
        exportWavelet: function() {
            var _a = this.getRealValues() || {}, preVal = _a.preVal || 0, mainVals = _a.mainVals || [], advVals = _a.advVals || [];
            var waveletFreqs = [20, 21, 22, 23, 24, 26, 27, 29, 30, 32, 34, 36, 38, 40, 43, 45, 48, 50, 53, 56, 59, 63, 66, 70, 74, 78, 83, 87, 92, 97, 103, 109, 115, 121, 128, 136, 143, 151, 160, 169, 178, 188, 199, 210, 222, 235, 248, 262, 277, 292, 309, 326, 345, 364, 385, 406, 429, 453, 479, 506, 534, 565, 596, 630, 665, 703, 743, 784, 829, 875, 924, 977, 1032, 1090, 1151, 1216, 1284, 1357, 1433, 1514, 1599, 1689, 1784, 1885, 1991, 2103, 2221, 2347, 2479, 2618, 2766, 2921, 3086, 3260, 3443, 3637, 3842, 4058, 4287, 4528, 4783, 5052, 5337, 5637, 5955, 6290, 6644, 7018, 7414, 7831, 8272, 8738, 9230, 9749, 10298, 10878, 11490, 12137, 12821, 13543, 14305, 15110, 15961, 16860, 17809, 18812, 19871];
            var outEntries = [];
            var self = this;
            var magCache = new Map();
            function cachedMag(type,f,hz,q,g){ var k=type+'|'+f+'|'+hz+'|'+q+'|'+g; var v=magCache.get(k); if(v!==undefined) return v; var m=Math.max(1e-4,self.getBiquadMagnitude(type,f,hz,q,g)); magCache.set(k,m); return m; }
            
            waveletFreqs.forEach(function(f) {
                var cumulativeDb = preVal;
                
                mainVals.forEach(function(v) {
                    var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                    var rawG = hasNoGain ? 0.0 : v.g;
                    // Slope only means anything for Shelf/HP/LP; a stale
                    // value carried over from a previous type must not
                    // bake extra cascaded copies of a Peaking/Notch section
                    // into the exported curve (matches the live-audio guard
                    // in EQ_Module.updateAudioConnections).
                    var slopeCapableForExport = (v.type === 'lowshelf' || v.type === 'highshelf' || v.type === 'lowpass' || v.type === 'highpass');
                    var slope = slopeCapableForExport ? (v.slope || 12) : 12;
                    var cascadeCount = Math.max(1, Math.round(slope / 12));
                    var nodeGain = (v.type === 'lowshelf' || v.type === 'highshelf') ? (rawG / cascadeCount) : rawG;
                    if (v.type !== 'peaking' || v.g !== 0) {
                        for (var k = 0; k < cascadeCount; k++) {
                            var mag = cachedMag(v.type, f, v.hz, v.q, nodeGain);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    }
                });
                
                advVals.forEach(function(v) {
                    var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                    var gVal = hasNoGain ? 0.0 : v.g;
                    if (v.type !== 'peaking' || v.g !== 0) {
                        var mag = cachedMag(v.type, f, v.hz, v.q, gVal);
                        cumulativeDb += 20 * Math.log10(mag);
                    }
                });
                
                if (self.virtualBands) {
                    self.virtualBands.forEach(function(v) {
                        if (v && v.g !== 0) {
                            var mag = cachedMag(v.type || 'peaking', f, v.hz, v.q, v.g);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    });
                }
                
                if (self.hearingCalEnabled) {
                    [250, 500, 1000, 2000, 4000, 8000, 12000, 16000].forEach(function(freq, idx) {
                        var gain = self.hearingOffsets[idx] || 0;
                        if (gain !== 0) {
                            var mag = cachedMag('peaking', f, freq, 1.0, gain);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    });
                }
                
                // Resonance notch lives in main band 8 (see exportPeace note) —
                // already accounted for via mainVals; no extra filter here.

                if (self.deEsserEnabled) {
                    var deFreqW = (typeof self.deEsserCurrentFreq === 'number' && isFinite(self.deEsserCurrentFreq)) ? Math.round(self.deEsserCurrentFreq) : 6000;
                    var mag = cachedMag('peaking', f, deFreqW, 2.5, -3.0 * (self.deEsserSensitivity / 100));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                
                var bassSlider = document.getElementById("eq-masterBass");
                var trebSlider = document.getElementById("eq-masterTreble");
                if (bassSlider && parseFloat(bassSlider.value) !== 0) {
                    var mag = cachedMag('lowshelf', f, 105, 0.7, parseFloat(bassSlider.value));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                if (trebSlider && parseFloat(trebSlider.value) !== 0) {
                    var mag = cachedMag('highshelf', f, 8000, 0.7, parseFloat(trebSlider.value));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                
                outEntries.push(f + ' ' + cumulativeDb.toFixed(1));
            });
            
            this.triggerDownload(this.getSanitizedExportFilename("Wavelet", "txt"), "GraphicEQ: " + outEntries.join("; "));
            showToast("Exported Wavelet GraphicEQ Preset!", "〰️");
        },
        injectDynamicPresetsOnLoad: function() {
            const standardTemplates = {
                // Music presets
                spicy: { p: -2.0, m: [0, 0.5, 1, 1.5, 2, 2.5, 3.5, 4, 2, 0.5] },
                chill_music: { p: -2.5, m: [4, 3, 1.5, -1, -2, -3, -2, -1, 0.5, 1] },
                retro_music: { p: 0, m: [-6, -3, 1, 2, 3, 2, 1, -1, -4, -8] },
                ambient: { p: -3.5, m: [5.5, 4, 1, -1.5, -2.5, -1.5, 1, 2, 4, 4.5] },
                vocal_music: { p: -2.5, m: [-1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4, 2.5, 1, 0.5] },
                tribal: { p: -3.5, m: [3, 5.5, 4.5, 2, -1, -2.5, -3, -2.5, -1.5, -0.5] },
                cosmic: { p: -3.5, m: [5, 3.5, 1, -2, -3, -1.5, 1.5, 3.5, 5.5, 3.5] },
                country: { p: -2, m: [1.5, 2.5, 2, 1.5, 0.5, 1, 2, 3, 2, 1] },
                salsa: { p: -2.5, m: [0, 1.5, 2.5, 1, -0.5, 1, 2.5, 3.5, 2, 1] },
                intimate: { p: -1.5, m: [1, 2.5, 3.5, 2, 0.5, -1, -2, -3, -2, -1] },
                hypnotic: { p: -3, m: [6, 4.5, 2, -1.5, -3, -4, -3, -2, -1, 0] },
                ethereal: { p: -1.5, m: [0.5, 0.5, 0, 0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5] },
                horn: { p: -1.5, m: [1, 2, 1.5, 0.5, 1, 2.5, 3, 2, 1, 0.5] },
                // Gaming presets
                tactical: { p: -2.5, m: [-5, -4, -2, 1.5, 2.5, 3, 4.5, 3.5, 1.5, 0] },
                cyberpunk: { p: -3.5, m: [4.5, 3.5, 1.5, -1, -1.5, 0.5, 2, 3, 4, 2.5] },
                defense: { p: -1.5, m: [1.5, 2, 2.5, 1.5, 0.5, 0, -1, -1.5, -2, -3] },
                eightbit: { p: -1, m: [-3, -1, 1, 2.5, 3, 2, 1, -1, -3, -5] },
                rhythm: { p: -2, m: [1.5, 3.5, 4, 2.5, 1, 0.5, 1, 1.5, 1, 0.5] },
                snappy: { p: -2.5, m: [-1.5, 0.5, 1.5, 0, -1, 1, 2.5, 3.5, 2, 1] },
                scary: { p: -3, m: [5.5, 4, 1.5, -1, -2, 0, 1, 2.5, 3.5, 4.5] },
                orbital: { p: -1.5, m: [0.5, 1, 1, 0.5, 0, 0.5, 1, 2.5, 3.5, 4.5] },
                fantasy: { p: -1.5, m: [1.5, 2, 2.5, 1.5, 1, 0.5, 1, 1.5, 1, 0.5] },
                apocalypse: { p: -3, m: [5, 3.5, 1.5, -1, -2, -2.5, -3, -2.5, -1.5, -0.5] },
                nitro: { p: -3.5, m: [4, 5, 3, 0.5, 0, 1, 2.5, 4, 3, 1.5] },
                detective: { p: -1, m: [-4, -2, 0.5, 1.5, 2, 2.5, 3, 2, 1, 0.5] },
                puzzle: { p: 0, m: [0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0] },
                // Media presets
                tablet: { p: -1.5, m: [-6, -3, 0.5, 2.5, 4, 3, 1.5, 0, -1, -3] },
                musical: { p: -2, m: [1, 2, 2, 1.5, 1, 1, 2, 2.5, 2, 1] },
                scifi_media: { p: -3, m: [4.5, 3.5, 1.5, -0.5, -1, 0.5, 1.5, 3, 3.5, 4.5] },
                satellite: { p: 0, m: [-10, -7, -2, 2.5, 3, 2, 0.5, -3, -6, -10] },
                comedy: { p: -2, m: [1.5, 2.5, 2, 0.5, 0, 0.5, 1.5, 2.5, 2, 1] },
                thriller: { p: -2.5, m: [3, 4, 2, 0, 0.5, 1, 2, 3, 2.5, 1.5] },
                noir: { p: -1.5, m: [2, 2.5, 2, 1, 0, 0.5, 1, 0.5, -1, -2.5] },
                serene: { p: -1, m: [1.5, 1.5, 1, 0.5, -0.5, -1, -1.5, -2, -1, 0] },
                cartoon: { p: -2.5, m: [2.5, 3.5, 2, 0.5, 1, 1.5, 2.5, 3, 2, 1] },
                arena_media: { p: -2.5, m: [2, 1.5, 0.5, 0, 0.5, 1.5, 2.5, 3.5, 4, 3] },
                educational: { p: 0, m: [-5, -3, 0.5, 2, 3.5, 3, 1.5, 0.5, -1, -3] },
                nature: { p: -1.5, m: [1, 2, 2.5, 1.5, 1, 0.5, 1, 1.5, 1, 0.5] },
                horror_media: { p: -3, m: [5.5, 4, 1, 0, 1, 2, 3, 4, 3.5, 1.5] },
                // Audiophile presets
                critical: { p: 0, m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                panning: { p: -1, m: [0.5, 1, 1, 0.5, 0.5, 0.5, 1, 1, 0.5, 0] },
                pure: { p: -1.5, m: [-2, -1, 0.5, 1, 1.5, 2, 2.5, 3, 2.5, 1.5] },
                acoustic_audio: { p: -1.5, m: [1, 2, 1.5, 1, 0.5, 0.5, 1, 1.5, 1, 0.5] },
                precision_audio: { p: -2, m: [-3, -1, 0.5, 1.5, 2.5, 2.5, 3, 2, 1, 0.5] },
                booth: { p: -1, m: [-1.5, -0.5, 0.5, 1.5, 2, 1.5, 1, 0.5, 0, 0] },
                live: { p: -2, m: [1.5, 1, 0.5, 0, 0.5, 1.5, 2.5, 3.5, 4, 3] },
                field: { p: -2.5, m: [-4, -2.5, 0, 1.5, 3.5, 4.5, 3, 1.5, 0, -1] },
                hologram: { p: -2, m: [0.5, 1, 1.5, 2, 1.5, 1, 1.5, 2, 1.5, 0.5] },
                cozy: { p: -1.5, m: [2, 2.5, 1.5, 0.5, 0, -0.5, -1, -1.5, -1, 0] },
                phase: { p: -1, m: [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0] },
                velocity: { p: -2, m: [1, 2.5, 2, 1, 1, 1.5, 2.5, 3.5, 2, 1] },
                clinical: { p: -0.5, m: [-2, -1, -0.5, 0, 0.5, 1, 1.5, 1.5, 1, 0.5] },
                // Basshead presets
                trench: { p: -5, m: [10, 8.5, 4.5, 0.5, -1, -2, -1.5, -1, -0.5, 0] },
                volcanic: { p: -4.5, m: [5.5, 7.5, 6, 3.5, 1, 0, -0.5, 0.5, 1, 0.5] },
                piston: { p: -3, m: [2.5, 5, 4.5, 2.5, 0.5, 0, 0, 0, 0, 0] },
                crusher: { p: -6, m: [10.5, 9.5, 7, 4, 1.5, 0, 0, 0.5, 1, 1.5] },
                oscillator: { p: -3.5, m: [7.5, 6, 2, -1, -2, -2, 0, 0, 0, 0] },
                detonation: { p: -4.5, m: [4.5, 6.5, 5.5, 3.5, 1, 0.5, 1, 1.5, 1, 0.5] },
                furious: { p: -4, m: [3.5, 6, 5.5, 3.5, 1.5, 0.5, 1.5, 2.5, 2, 1] },
                rave: { p: -4.5, m: [5, 4.5, 2.5, -0.5, -1.5, 0.5, 1.5, 3, 3, 1] },
                magnetic: { p: -3, m: [3, 4, 3.5, 2, 0.5, 0, 0.5, 1, 1, 0.5] },
                solid: { p: -3.5, m: [1, 3.5, 5, 3.5, 1, 0.5, 1, 1.5, 1, 0.5] },
                toxic: { p: -5, m: [8.5, 8, 6.5, 4, 2, 0.5, 0, 0, 0, 0] },
                brutal: { p: -4.5, m: [1.5, 4.5, 6, 4.5, 1.5, 0.5, 0.5, 1, 1, 0.5] },
                cyclone: { p: -4, m: [6.5, 5.5, 3, 0.5, -1, 0, 1, 2, 1.5, 0.5] }
            };

            Object.entries(standardTemplates).forEach(([id, cfg]) => {
                this.eqPresets[id] = {
                    p: cfg.p,
                    m: cfg.m,
                    a: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                };
            });
        },
        exportPoweramp: function() {
            var _a = this.getRealValues() || {}, preVal = _a.preVal || 0, mainVals = _a.mainVals || [], advVals = _a.advVals || [];
            
            let targetName = "Custom EQ";
            if (typeof PEQDB_Module !== 'undefined' && PEQDB_Module.STATE && PEQDB_Module.STATE.activeCurves) {
                const targetCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target' && c.visible);
                if (targetCurve) {
                    targetName = targetCurve.name;
                }
            }

            const model = (document.getElementById('model')?.value || '').trim() || "IEM";
            const brand = (document.getElementById('brand')?.value || '').trim();
            const baseName = brand ? `${brand} ${model}` : model;
            const internalPresetName = `${baseName} to ${targetName}`.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF])/g, '').trim();

            // Formulate compliant Poweramp Android specification structure
            var peq = { 
                "name": internalPresetName, 
                "preamp": preVal, 
                "parametric": true, 
                "bands": [] 
            };

            var typeMap = {
                lowshelf: 0,
                highshelf: 1,
                peaking: 2,
                lowpass: 3,
                highpass: 4,
                notch: 5
            };

            var exportBand = function(v) {
                var pType = typeMap[v.type] !== undefined ? typeMap[v.type] : 2;
                var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                var gVal = hasNoGain ? 0.0 : v.g;
                
                // Keep the exported file clean by skipping flat bands
                if (v.type === 'peaking' && v.g === 0) return;
                
                peq.bands.push({ 
                    "type": pType,
                    "channels": 0,
                    "frequency": Math.round(v.hz),
                    "q": parseFloat(v.q.toFixed(4)),
                    "gain": parseFloat(gVal.toFixed(4)),
                    "color": 0
                });
            };

            // Export both standard and advanced active bands to the output JSON array
            mainVals.forEach(exportBand);
            advVals.forEach(exportBand);
            // Include virtual bands (>20-band AutoEQ) — Poweramp supports an
            // arbitrary number of bands, so discarding them silently would
            // make the exported file sound different from the live DSP.
            if (this.virtualBands && this.virtualBands.length) {
                this.virtualBands.forEach(function(v) {
                    if (v && v.g !== 0) exportBand({ hz: v.hz, g: v.g, q: v.q, type: v.type || 'peaking' });
                });
            }

            // Append calibration corrections directly to the active band list
            if (this.hearingCalEnabled) {
                [250, 500, 1000, 2000, 4000, 8000, 12000, 16000].forEach(function(freq, idx) {
                    var gain = EQ_Module.hearingOffsets[idx] || 0;
                    if (gain !== 0) {
                        peq.bands.push({
                            "type": 2,
                            "channels": 0,
                            "frequency": freq,
                            "q": 1.0,
                            "gain": parseFloat(gain.toFixed(4)),
                            "color": 0
                        });
                    }
                });
            }
            
            // Resonance notch lives in main band 8 (see exportPeace note) —
            // already exported via mainVals; no extra band here.

            if (this.deEsserEnabled) {
                var deFreqPA = (typeof this.deEsserCurrentFreq === 'number' && isFinite(this.deEsserCurrentFreq)) ? Math.round(this.deEsserCurrentFreq) : 6000;
                peq.bands.push({
                    "type": 2,
                    "channels": 0,
                    "frequency": deFreqPA,
                    "q": 2.5,
                    "gain": parseFloat((-3.0 * (this.deEsserSensitivity / 100)).toFixed(4)),
                    "color": 0
                });
            }
            
            var bassSlider = document.getElementById("eq-masterBass");
            var trebSlider = document.getElementById("eq-masterTreble");
            if (bassSlider && parseFloat(bassSlider.value) !== 0) {
                peq.bands.push({
                    "type": 0,
                    "channels": 0,
                    "frequency": 105,
                    "q": 0.7,
                    "gain": parseFloat(parseFloat(bassSlider.value).toFixed(4)),
                    "color": 0
                });
            }
            if (trebSlider && parseFloat(trebSlider.value) !== 0) {
                peq.bands.push({
                    "type": 1,
                    "channels": 0,
                    "frequency": 8000,
                    "q": 0.7,
                    "gain": parseFloat(parseFloat(trebSlider.value).toFixed(4)),
                    "color": 0
                });
            }

            // Poweramp's band schema has no cascade/slope field -- a Shelf
            // set to anything above the default 12 dB/oct is silently
            // collapsed to a single 12 dB/oct section on export, same
            // limitation as exportPeace's txt format, but this exporter
            // never disclosed it.
            var shelfWithSlopePA = function(v) {
                return v && (v.type === 'lowshelf' || v.type === 'highshelf') && (v.slope || 12) !== 12;
            };
            var poweramp_hasUndisclosedSlope = mainVals.some(shelfWithSlopePA) || advVals.some(shelfWithSlopePA) || (this.virtualBands || []).some(shelfWithSlopePA);

            this.triggerDownload(this.getSanitizedExportFilename("PowerAmp", "json"), JSON.stringify([peq], null, 2));
            if (poweramp_hasUndisclosedSlope) {
                showToast("Exported — note: export format can't encode shelf slope, using default 12 dB/oct.", "⚡");
            } else {
                showToast("Exported Poweramp Preset!", "⚡");
            }
        },
        exportQudelix: function() {
            var _a = this.getRealValues() || {}, preVal = _a.preVal || 0, mainVals = _a.mainVals || [], advVals = _a.advVals || [];
            var out = 'Preamp,' + preVal.toFixed(1) + ',dB\n';
            var fIdx = 1;

            var typeMap = {
                peaking: 'PEAK', lowshelf: 'LSHELF', highshelf: 'HSHELF',
                highpass: 'HPASS', lowpass: 'LPASS', notch: 'NOTCH'
            };

            var exportBand = function(v) {
                var qType = typeMap[v.type] || 'PEAK';
                var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                var gVal = hasNoGain ? 0.0 : v.g;
                
                if (v.type === 'peaking' && v.g === 0) return;
                
                out += 'Filter ' + (fIdx++) + ',ON,' + qType + ',' + v.hz + ',' + gVal.toFixed(1) + ',' + v.q.toFixed(2) + '\n';
            };

            mainVals.forEach(exportBand);
            // Advanced bands ignored for hardware compatibility — the Qudelix-5K's onboard PEQ only
            // supports 10 bands, so bands 11+ can't be written to this format at all.

            // The old drop-detection here compared the number of *written*
            // filter lines against 10 -- which is the wrong signal in both
            // directions: hearing-cal/de-esser/tone-shelf lines can push
            // that count past 10 with zero advanced/virtual bands ever
            // touched (false "bands were dropped" warning on a lossless
            // export), while a real advanced/virtual band is silently
            // skipped above regardless of how few main bands are active
            // (no warning at all, real EQ data missing from a "success"
            // toast). Count what's actually omitted instead.
            const activeAdvBands = advVals.filter(function(v) {
                return v && !(v.type === 'peaking' && v.g === 0);
            }).length;
            const activeVirtualBands = (this.virtualBands || []).filter(function(v) {
                return v && v.g !== 0;
            }).length;
            const droppedBands = activeAdvBands + activeVirtualBands;

            if (this.hearingCalEnabled) {
                [250, 500, 1000, 2000, 4000, 8000, 12000, 16000].forEach(function(freq, idx) {
                    var gain = EQ_Module.hearingOffsets[idx] || 0;
                    if (gain !== 0) out += 'Filter ' + (fIdx++) + ',ON,PEAK,' + freq + ',' + gain.toFixed(1) + ',1.00\n';
                });
            }

            // Resonance notch lives in main band 8 (see exportPeace note) —
            // already exported via mainVals; no extra filter here.

            if (this.deEsserEnabled) {
                var deFreqQ = (typeof this.deEsserCurrentFreq === 'number' && isFinite(this.deEsserCurrentFreq)) ? Math.round(this.deEsserCurrentFreq) : 6000;
                out += 'Filter ' + (fIdx++) + ',ON,PEAK,' + deFreqQ + ',' + (-3.0 * (this.deEsserSensitivity / 100)).toFixed(1) + ',2.50\n';
            }

            var bassSlider = document.getElementById("eq-masterBass");
            var trebSlider = document.getElementById("eq-masterTreble");
            if (bassSlider && parseFloat(bassSlider.value) !== 0) {
                out += 'Filter ' + (fIdx++) + ',ON,LSHELF,105,' + parseFloat(bassSlider.value).toFixed(1) + ',0.70\n';
            }
            if (trebSlider && parseFloat(trebSlider.value) !== 0) {
                out += 'Filter ' + (fIdx++) + ',ON,HSHELF,8000,' + parseFloat(trebSlider.value).toFixed(1) + ',0.70\n';
            }

            const qudelixLineOverflow = (fIdx - 1) > 10;

            this.triggerDownload(this.getSanitizedExportFilename("Qudelix5K", "csv"), out);
            if (droppedBands > 0) {
                showToast(`Exported — ${droppedBands} advanced/virtual band(s) exceed the Qudelix-5K's 10-band PEQ and were omitted.`, "⚠️");
            } else if (qudelixLineOverflow) {
                showToast("Exported — note: total filters exceed the Qudelix-5K's 10-band PEQ; the device may ignore the extras.", "⚠️");
            } else {
                showToast("Exported Qudelix-5K CSV Preset!", "🎛️");
            }
        },
        exportFxSound: function() {
            var _a = this.getRealValues() || {}, preVal = _a.preVal || 0, mainVals = _a.mainVals || [], advVals = _a.advVals || [];
            
            let targetName = "Custom EQ";
            if (typeof PEQDB_Module !== 'undefined' && PEQDB_Module.STATE && PEQDB_Module.STATE.activeCurves) {
                const targetCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target' && c.visible);
                if (targetCurve) {
                    targetName = targetCurve.name;
                }
            }

            const model = (document.getElementById('model')?.value || '').trim() || "IEM";
            const brand = (document.getElementById('brand')?.value || '').trim();
            const baseName = brand ? `${brand} ${model}` : model;
            const presetTitle = `${baseName} to ${targetName}`.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF])/g, '').trim();

            // 10 Standard EQ Center Frequencies for FxSound
            const fxFreqs = [31, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
            const self = this;
            var fxCache = new Map();
            function fxCachedMag(type,f,hz,q,g){ var k=type+'|'+f+'|'+hz+'|'+q+'|'+g; var v=fxCache.get(k); if(v!==undefined) return v; var m=Math.max(1e-4,self.getBiquadMagnitude(type,f,hz,q,g)); fxCache.set(k,m); return m; }

            var bandsText = "";
            fxFreqs.forEach(function(f, idx) {
                var cumulativeDb = preVal;
                mainVals.forEach(function(v) {
                    var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                    var rawG = hasNoGain ? 0.0 : v.g;
                    // Slope only means anything for Shelf/HP/LP; a stale
                    // value carried over from a previous type must not
                    // bake extra cascaded copies of a Peaking/Notch section
                    // into the exported curve (matches the live-audio guard
                    // in EQ_Module.updateAudioConnections).
                    var slopeCapableForExport = (v.type === 'lowshelf' || v.type === 'highshelf' || v.type === 'lowpass' || v.type === 'highpass');
                    var slope = slopeCapableForExport ? (v.slope || 12) : 12;
                    var cascadeCount = Math.max(1, Math.round(slope / 12));
                    var nodeGain = (v.type === 'lowshelf' || v.type === 'highshelf') ? (rawG / cascadeCount) : rawG;
                    if (v.type !== 'peaking' || v.g !== 0) {
                        for (var k = 0; k < cascadeCount; k++) {
                            var mag = fxCachedMag(v.type, f, v.hz, v.q, nodeGain);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    }
                });
                advVals.forEach(function(v) {
                    var hasNoGain = ['highpass', 'lowpass', 'notch'].includes(v.type);
                    var gVal = hasNoGain ? 0.0 : v.g;
                    if (v.type !== 'peaking' || v.g !== 0) {
                        var mag = fxCachedMag(v.type, f, v.hz, v.q, gVal);
                        cumulativeDb += 20 * Math.log10(mag);
                    }
                });
                if (self.virtualBands) {
                    self.virtualBands.forEach(function(v) {
                        if (v && v.g !== 0) {
                            var mag = fxCachedMag(v.type || 'peaking', f, v.hz, v.q, v.g);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    });
                }
                if (self.hearingCalEnabled) {
                    [250, 500, 1000, 2000, 4000, 8000, 12000, 16000].forEach(function(freq, hIdx) {
                        var gain = self.hearingOffsets[hIdx] || 0;
                        if (gain !== 0) {
                            var mag = fxCachedMag('peaking', f, freq, 1.0, gain);
                            cumulativeDb += 20 * Math.log10(mag);
                        }
                    });
                }
                // Resonance notch lives in main band 8 (see exportPeace note) —
                // already accounted for via mainVals; no extra filter here.
                if (self.deEsserEnabled) {
                    var deFreqFx = (typeof self.deEsserCurrentFreq === 'number' && isFinite(self.deEsserCurrentFreq)) ? Math.round(self.deEsserCurrentFreq) : 6000;
                    var mag = fxCachedMag('peaking', f, deFreqFx, 2.5, -3.0 * (self.deEsserSensitivity / 100));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                var bassSlider = document.getElementById("eq-masterBass");
                var trebSlider = document.getElementById("eq-masterTreble");
                if (bassSlider && parseFloat(bassSlider.value) !== 0) {
                    var mag = fxCachedMag('lowshelf', f, 105, 0.7, parseFloat(bassSlider.value));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                if (trebSlider && parseFloat(trebSlider.value) !== 0) {
                    var mag = fxCachedMag('highshelf', f, 8000, 0.7, parseFloat(trebSlider.value));
                    cumulativeDb += 20 * Math.log10(mag);
                }
                var gainVal = parseFloat(cumulativeDb.toFixed(2));

                bandsText += "Band " + (idx + 1) + "\n   " + f + ": CF\n   " + gainVal + ": Boost/Cut\n";
            });

            var out = "CLASS1 : Effect Type\n" +
                "9: Version\n" +
                presetTitle + "\n" +
                "0: Double Params Flag\n" +
                "1: Total number of elements\n" +
                "0: Main 0\n" +
                "0: Main 1\n" +
                "0: Main 2\n" +
                "0: Main 3\n" +
                "0: Main 4\n" +
                "0: Main 5\n" +
                "0: Element Number\n" +
                "   0: Param 0\n" +
                "   0: Param 1\n" +
                "   0: Param 2\n" +
                "   0: Param 3\n" +
                "   0: Param 4\n" +
                "   0: Param 5\n" +
                "   0: Param 6\n" +
                "7: Number of Application Dependent Integers\n" +
                "0: Number of Application Dependent Reals\n" +
                "0: Number of Application Dependent Strings\n" +
                "1: Integer[0]\n" +
                "1: Integer[1]\n" +
                "0: Integer[2]\n" +
                "1: Integer[3]\n" +
                "1: Integer[4]\n" +
                "0: Integer[5]\n" +
                "2: Integer[6]\n" +
                "10: Number of EQ Bands\n" +
                "1: On/Off Flag\n" +
                bandsText.trim();

            this.triggerDownload(this.getSanitizedExportFilename("FxSound", "fac"), out);
            showToast("Exported FxSound (.fac) Preset!", "🔊");
        }
};