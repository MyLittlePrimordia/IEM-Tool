// IEM review-card export: theme/font/grade pickers and the infographic renderer.
// Split out of iem-module.js; merged into IEM_Module via Object.assign there.
const IEM_ExportMethods = {
        exportTheme: null,

        exportFont: null,

        updateExportButtonState: function() {
            const btn = document.getElementById('export-confirm-btn');
            if (!btn) return;
            const isValid = this.exportGrade && this.exportTheme && this.exportFont;
            if (isValid) {
                btn.disabled = false;
                btn.className = "w-full py-2 bg-[var(--accent-blue)] text-white hover:brightness-110 font-bold text-xs shadow-lg transition-all text-center mb-3 cursor-pointer";
                btn.style.opacity = "1";
            } else {
                btn.disabled = true;
                btn.className = "w-full py-2 bg-zinc-800 text-zinc-500 font-bold text-xs transition-all text-center mb-3 cursor-not-allowed";
                btn.style.opacity = "0.5";
            }
        },

        selectExportTheme: function(themeId) {
            this.exportTheme = themeId;
            const btn = document.getElementById('export-theme-cycle-btn');
            if (btn) {
                const t = (window.App && App.themeMap && App.themeMap[themeId]) ? App.themeMap[themeId] : null;
                const emoji = t ? (t.emoji || '🎨') : '🎨';
                const name = t ? t.name : themeId;
                btn.innerHTML = `<span>${emoji} ${name}</span>`;
            }
            this.updateExportButtonState();
        },

        selectExportFont: function(fontId) {
            this.exportFont = fontId;
            const btn = document.getElementById('export-font-cycle-btn');
            if (btn) {
                const meta = App.fontMeta.find(m => m.id === fontId) || { emoji: '🔤', name: fontId };
                btn.innerHTML = `<span>${meta.emoji} ${meta.name}</span>`;
            }
            this.updateExportButtonState();
        },

        exportGradesList: ['S', 'A', 'B', 'C', 'D', 'F'],

        currentExportGradeIdx: 1,

        cycleExportThemeDirection: function(dir) {
            // R0: derived from builtInThemes instead of a second hard-coded
            // array. The old literal listed the same nine ids in a DIFFERENT
            // order, so any add/remove/rename desynced the export stepper from
            // the app's own theme list with no error.
            const themes = App.builtInThemes.map(t => t.id);
            let curIdx = themes.indexOf(this.exportTheme);
            if (curIdx === -1) curIdx = 0;
            const total = themes.length;
            const nextIdx = (curIdx + dir + total) % total;
            this.selectExportTheme(themes[nextIdx]);
        },

        cycleExportFontDirection: function(dir) {
            const keys = Object.keys(App.fontMap);
            if (keys.length === 0) return;
            let curIdx = keys.indexOf(this.exportFont);
            if (curIdx === -1) curIdx = 0;
            const total = keys.length;
            const nextIdx = (curIdx + dir + total) % total;
            this.selectExportFont(keys[nextIdx]);
        },

        exportColor: '#3b82f6',

        exportGrade: 'A',

        showExportModal: function() {

            this.exportGrade = null;

            const currentThemeId = (App && App.currentTheme) || localStorage.getItem('settings_theme_id') || 'slate';
            const currentFontId = localStorage.getItem('settings_font_id') || (App.fontMap && Object.keys(App.fontMap).length ? Object.keys(App.fontMap)[0] : 'System UI');
            this.selectExportTheme(currentThemeId);
            this.selectExportFont(currentFontId);

            const grades = ['S', 'A', 'B', 'C', 'D', 'F'];
            grades.forEach(g => {
                const btn = document.getElementById('exp-grade-' + g);
                if (btn) {
                    btn.style.removeProperty('background-color');
                    btn.style.removeProperty('color');
                    btn.style.removeProperty('box-shadow');
                    btn.style.removeProperty('transform');
                }
            });

            this.updateExportButtonState();

            const modal = document.getElementById('export-modal');
            if (modal) modal.classList.remove('hidden');
        },

        closeExportModal: function() {
            const modal = document.getElementById('export-modal');
            if (modal) modal.classList.add('hidden');
        },

        selectExportGrade: function(grade) {
            this.exportGrade = grade;
            const grades = ['S', 'A', 'B', 'C', 'D', 'F'];
            grades.forEach(g => {
                const btn = document.getElementById('exp-grade-' + g);
                if (btn) {
                    if (g === grade) {
                        btn.style.setProperty('background-color', 'var(--accent-blue)', 'important');
                        btn.style.setProperty('color', '#ffffff', 'important');
                        btn.style.setProperty('box-shadow', 'inset 2px 2px 0px 0px rgba(0, 0, 0, 0.6)', 'important');
                        btn.style.setProperty('transform', 'translate(2px, 2px)', 'important');
                    } else {
                        btn.style.removeProperty('background-color');
                        btn.style.removeProperty('color');
                        btn.style.removeProperty('box-shadow');
                        btn.style.removeProperty('transform');
                    }
                }
            });
            this.updateExportButtonState();
        },

        confirmAndTriggerExport: function() {
            this.closeExportModal();
            this.exportReviewCard();
        },

exportReviewCard: async function() {
            if (!this.radarChart || !this.radarChart.canvas) {
                showToast("Radar chart not available. Please initialize review first.", "⚠️");
                return;
            }
            const brand = document.getElementById('brand').value.trim() || "Generic";
            const model = document.getElementById('model').value.trim() || "IEM";
            const price = document.getElementById('price').value.trim() || "N/A";
            const score = document.getElementById('overall-score').textContent || "5.0";
            const volume = document.getElementById('listening-volume').value || "Moderate";
            const notes = document.getElementById('review-notes').value.trim() || "No custom impressions entered.";

            const selectedThemeId = IEM_Module.exportTheme || localStorage.getItem('settings_theme_id') || 'slate';
            const selectedFontFamily = IEM_Module.exportFont || localStorage.getItem('settings_font_id') || 'JetBrains Mono';

            const fontStack = App.fontMap[selectedFontFamily] || '"Silkscreen", monospace';
            const activeFont = fontStack;

            try {
                const primaryFontName = (fontStack.split(',')[0] || '').replace(/["']/g, '').trim();
                if (primaryFontName && primaryFontName.toLowerCase() !== 'system ui') {
                    await Promise.all([
                        document.fonts.load(`bold 42px "${primaryFontName}"`),
                        document.fonts.load(`14px "${primaryFontName}"`),
                        document.fonts.load(`bold 16px "${primaryFontName}"`)
                    ]);
                }
                await document.fonts.ready;
            } catch (fontErr) {
                console.warn("Export font failed to preload, falling back to default:", fontErr);
            }

            const driverIconFiles = {
                DD: 'app/icons/dd.png', BA: 'app/icons/ba.png', Planar: 'app/icons/planar.png',
                EST: 'app/icons/est.png', PZT: 'app/icons/pzt.png', BC: 'app/icons/bc.png', MEMS: 'app/icons/mems.png'
            };
            const dacIconFiles = {
                Phone: 'app/icons/phone.png', Laptop: 'app/icons/laptop.png',
                Dongle: 'app/icons/dongle.png', Amp: 'app/icons/desktop.png', Desktop: 'app/icons/desktop.png'
            };
            const loadIconImage = (src) => new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
            const dacIconImages = {};
            await Promise.all(Object.keys(dacIconFiles).map(async (key) => {
                dacIconImages[key] = await loadIconImage(dacIconFiles[key]);
            }));
            const neededDriverTypes = Object.entries(this.selectedDriverTypes)
                .filter(([, count]) => count > 0)
                .map(([type]) => type);
            const driverIconImages = {};
            await Promise.all(neededDriverTypes.map(async (type) => {
                const file = driverIconFiles[type];
                if (file) driverIconImages[type] = await loadIconImage(file);
            }));

            // Form Factor + Connector badge icons (drawn bottom-center inside radar box)
            const formIconFiles = {
                'IEM': 'app/icons/iem.png', 'Earbuds (Wired)': 'app/icons/earbud.png',
                'Wireless Earbuds (TWS)': 'app/icons/tws.png', 'Over-Ear Headphones (Wired)': 'app/icons/headphone.png',
                'Wireless Over-Ear Headphones': 'app/icons/wireless.png'
            };
            const connectorIconFiles = {
                '2-pin': 'app/icons/2pin.png', 'MMCX': 'app/icons/mmcx.png', 'QDC': 'app/icons/qdc.png', 'A2DC': 'app/icons/a2dc.png',
                'Fixed Cable': 'app/icons/fixed.png', 'Detachable Cable': 'app/icons/detach.png', 'Bluetooth': 'app/icons/bluetooth.png',
                'Electrostatic': 'app/icons/electro.png'
            };
            const formIconImages = {};
            const activeForm = this.formFactor || 'IEM';
            if (formIconFiles[activeForm]) formIconImages.form = await loadIconImage(formIconFiles[activeForm]);
            const connectorIconImages = {};
            const activeConnector = this.connector || '2-pin';
            if (connectorIconFiles[activeConnector]) connectorIconImages.connector = await loadIconImage(connectorIconFiles[activeConnector]);

            const themeEntry = (App.themeMap && App.themeMap[selectedThemeId]) || (App.themeMap && App.themeMap.slate);
            const v = themeEntry ? (themeEntry.variables || {}) : {};

            const currentTheme = {
                bgBody: v['--bg-window'] || v['--bg-body'] || '#0A0A0B',
                bgCard: v['--bg-card'] || '#0A0A0B',
                bgInput: v['--bg-input'] || '#0E0E11',
                bgInset: v['--bg-sidebar'] || '#050506',
                // Panels need a surface that is actually DIFFERENT from the card
                // body. In the Void theme --bg-card and --bg-window are both
                // #0A0A0B, so a panel filled with bgCard is invisible and the
                // old 3px black outline was doing all the separating - which is
                // exactly why it looked heavy. bg-raised is one step up from the
                // body, the same relationship an in-app card has to its pane.
                bgPanel: v['--bg-raised'] || '#121215',
                textMain: v['--text-main'] || '#F2F3F5',
                textMid: v['--text-secondary'] || '#9CA3AF',
                textLo: '#6B7280',
                textSecondary: v['--text-secondary'] || '#9CA3AF',
                accent: v['--accent-blue'] || '#5AA9E6',
                accentHi: v['--accent-hi'] || '#8FD0FF',
                ok: '#34D399',
                danger: '#F87171',
                // Was hard-coded '#000000'. On an OLED card that is not a border,
                // it is a hole: it reads as a gap between panels rather than an
                // edge, and it is invisible against the dark themes. The app
                // draws every panel edge with this one value, so moving it to a
                // real hairline restyles all 13 panels at once.
                border: '#2E2E35',
                // Card corner radius, in the card's own 1200x800 space (the
                // canvas is 2x scaled). Matches --r-md in the UI.
                radius: 10,
                radiusSm: 6
            };

            const canvas = document.createElement('canvas');
            canvas.width = 2400;
            canvas.height = 1600;
            const ctx = canvas.getContext('2d');

            ctx.imageSmoothingEnabled = false;
            ctx.scale(2, 2);

            ctx.fillStyle = currentTheme.bgBody;
            ctx.fillRect(0, 0, 1200, 800);

            // R9: the per-theme texture. This used to be nine hand-written
            // branches keyed on selectedThemeId, each with its own hard-coded
            // rgba() values - roughly 16 literals that no theme token could
            // reach. Under Ember it painted diagonal red hatching at 15% alpha,
            // under Verdant a green radial bloom, under Gold a dot grid; the
            // exported card therefore looked like a different artefact per theme
            // rather than one design in nine colours.

            // The theme backdrop is the app's REAL CSS, rasterised offscreen by
            // the main process (theme:capture-backdrop). It used to be redrawn
            // here by hand - square grids, hatch, trace grids, rays, all keyed
            // on the theme id - and the two copies drifted: the cards showed
            // textures the app had stopped using. The themes are now layered
            // gradient stacks (--tp over --tp-floor) that canvas 2D simply
            // cannot express, so mirroring them a second time would have
            // reintroduced the same drift with a more elaborate set of wrong
            // shapes. Capturing the stylesheet makes the card agree with the app
            // by construction.
            //
            // Captured at the CARD size, not smaller: the texture tiles at a
            // fixed pixel pitch, so a small capture scaled up would blur and
            // stretch the pattern instead of showing the theme.
            const W = 1200, H = 800;
            let backdropPainted = false;
            try {
                if (window.appBridge && typeof window.appBridge.captureThemeBackdrop === 'function') {
                    const dataUrl = await window.appBridge.captureThemeBackdrop(selectedThemeId, W, H);
                    if (dataUrl) {
                        const bmp = await new Promise((resolve, reject) => {
                            const im = new Image();
                            im.onload = () => resolve(im);
                            im.onerror = () => reject(new Error('backdrop decode failed'));
                            im.src = dataUrl;
                        });
                        ctx.drawImage(bmp, 0, 0, W, H);
                        backdropPainted = true;
                    }
                }
            } catch (err) {
                console.error('Theme backdrop capture failed:', err);
            }
            if (!backdropPainted) {
                // Degrade to the theme's own floor colour. A plain but themed
                // card beats either a blank one or a card textured with
                // something the app does not use.
                ctx.fillStyle = currentTheme.bg || '#0A0A0B';
                ctx.fillRect(0, 0, W, H);
            }

            // R9: one rounded-rect path helper plus the two panel primitives every box in
            // the card is built from. Previously each panel was a hand-rolled
            // fillRect + strokeRect pair with lineWidth 3 and a #000000 stroke,
            // which is the pre-R0 raised look: square corners and a heavy black
            // outline that reads as a hole rather than an edge on a dark theme.
            const roundRectPath = (x, y, w, h, r) => {
                const rr = Math.min(r, w / 2, h / 2);
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(x, y, w, h, rr);
                    return;
                }
                // Manual fallback: ctx.roundRect is unavailable on older
                // Electron, and silently drawing nothing would be worse.
                ctx.moveTo(x + rr, y);
                ctx.arcTo(x + w, y, x + w, y + h, rr);
                ctx.arcTo(x + w, y + h, x, y + h, rr);
                ctx.arcTo(x, y + h, x, y, rr);
                ctx.arcTo(x, y, x + w, y, rr);
                ctx.closePath();
            };

            // A card surface: rounded, filled, hairline edge. Optional soft
            // elevation for the few panels that sit "above" the card.
            const panel = (x, y, w, h, opts = {}) => {
                const r = opts.radius === undefined ? currentTheme.radius : opts.radius;
                const fill = opts.fill || currentTheme.bgPanel;
                if (opts.elevate) {
                    ctx.save();
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
                    ctx.shadowBlur = 18;
                    ctx.shadowOffsetY = 6;
                    ctx.fillStyle = fill;
                    roundRectPath(x, y, w, h, r);
                    ctx.fill();
                    ctx.restore();
                }
                ctx.fillStyle = fill;
                roundRectPath(x, y, w, h, r);
                ctx.fill();
                if (opts.stroke !== false) {
                    ctx.strokeStyle = opts.strokeColor || currentTheme.border;
                    ctx.lineWidth = 1;
                    roundRectPath(x, y, w, h, r);
                    ctx.stroke();
                }
            };

            const drawFittedText = (txt, x, y, maxW, baseFontSize, isBold = false, align = 'left') => {
                let size = baseFontSize;
                ctx.font = `${isBold ? 'bold ' : ''}${size}px ${activeFont}`;
                while (ctx.measureText(txt).width > maxW && size > 7) {
                    size -= 0.5;
                    ctx.font = `${isBold ? 'bold ' : ''}${size}px ${activeFont}`;
                }
                ctx.textAlign = align;
                ctx.fillText(txt, x, y);
            };

            ctx.fillStyle = currentTheme.accent;
            ctx.fillRect(40, 35, 6, 60);

            ctx.fillStyle = currentTheme.textMain;
            const fullTitle = `${brand.toUpperCase()} ${model.toUpperCase()}`;
            drawFittedText(fullTitle, 60, 78, 980, 36, true, 'left');

            const drawLeftBox = (y, h, icon, label, val) => {
                panel(40, y, 250, h);

                ctx.fillStyle = currentTheme.accent;
                ctx.font = `20px ${activeFont}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(icon, 68, y + (h / 2));
                ctx.textBaseline = "alphabetic";
                ctx.textAlign = "left";

                ctx.fillStyle = currentTheme.textSecondary;
                ctx.font = `bold 9px ${activeFont}`;
                ctx.fillText(label, 96, y + 24);

                ctx.fillStyle = currentTheme.textMain;
                drawFittedText(val, 96, y + 52, 180, 16, true, 'left');
            };

            drawLeftBox(120, 65, "💰", "PRICE", `$ ${price}`);
            drawLeftBox(195, 65, "🔌", "VOLUME", volume.toUpperCase());

            panel(40, 270, 250, 85);

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `20px ${activeFont}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("🛠️", 68, 312);
            ctx.textBaseline = "alphabetic";
            ctx.textAlign = "left";

            ctx.fillStyle = currentTheme.textSecondary;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("IMPEDANCE", 96, 292);
            ctx.fillText("SENSITIVITY", 172, 292);

            ctx.fillStyle = currentTheme.textMain;
            const impStr = document.getElementById('impedance').value + " Ω";
            const sensUnitText = (this.sensUnit === 'V' ? "dB/V" : "dB/mW");
            const sensStr = document.getElementById('sensitivity').value + " " + sensUnitText;

            drawFittedText(impStr, 96, 325, 70, 13, true, 'left');
            drawFittedText(sensStr, 172, 325, 110, 13, true, 'left');

            panel(40, 365, 250, 160);

            ctx.fillStyle = currentTheme.textSecondary;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("DRIVERS", 56, 388);

            const activeDrivers = [];
            Object.entries(this.selectedDriverTypes).forEach(([type, count]) => {
                if (count > 0) {
                    activeDrivers.push({ type, count, icon: driverIconImages[type] || null });
                }
            });

            if (activeDrivers.length > 0) {
                activeDrivers.slice(0, 6).forEach((d, idx) => {
                    const col = idx % 2;
                    const row = Math.floor(idx / 2);
                    const dx = 56 + col * 105;
                    const dy = 402 + row * 28;

                    if (d.icon) {
                        ctx.drawImage(d.icon, dx, dy + 1, 20, 20);
                    } else {
                        ctx.fillStyle = currentTheme.textMain;
                        ctx.font = `18px ${activeFont}`;
                        ctx.fillText('⚙️', dx, dy + 18);
                    }

                    ctx.fillStyle = currentTheme.textMain;
                    drawFittedText(`${d.count}x ${d.type}`, dx + 24, dy + 15, 80, 10, true, 'left');
                });
            } else {
                ctx.fillStyle = currentTheme.textSecondary;
                ctx.font = `italic 10px ${activeFont}`;
                ctx.fillText("No Drivers Configured", 56, 415);
            }

            const crossoverMap = { NONE: 'SINGLE', PASS: 'PASSIVE', ACOU: 'ACOUSTIC', ACTV: 'ACTIVE/DSP', HYBR: 'HYBRID', UNK: 'UNKNOWN' };
            const wayMap = { '1W': '1-WAY', '2W': '2-WAY', '3W': '3-WAY', '4W': '4-WAY', '5W': '5-WAY', '6W+': '6+ WAY', UNK: 'UNKNOWN' };

            const xoText = crossoverMap[this.currentCrossover] || 'UNKNOWN';
            const wayText = wayMap[this.currentWay] || 'UNKNOWN';

            ctx.save();
            ctx.textBaseline = "middle";

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `20px ${activeFont}`;
            ctx.textAlign = "center";
            ctx.fillText("🔀", 68, 504);

            ctx.fillStyle = currentTheme.textMain;
            ctx.textAlign = "left";
            drawFittedText(xoText, 82, 505, 75, 10, true, 'left');

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `20px ${activeFont}`;
            ctx.textAlign = "center";
            ctx.fillText("🧩", 175, 504);

            ctx.fillStyle = currentTheme.textMain;
            ctx.textAlign = "left";
            drawFittedText(wayText, 189, 505, 75, 10, true, 'left');

            ctx.restore();

            panel(40, 535, 250, 225);

            ctx.fillStyle = currentTheme.textSecondary;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("NOTES", 56, 558);

            const notesText = document.getElementById("review-notes").value.trim() || "No notes entered.";

            const wrapNotesText = (txt, maxW) => {
                const words = txt.split(' ');
                const lines = [];
                let currentLine = '';

                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    const testLine = currentLine + (currentLine ? ' ' : '') + word;
                    if (ctx.measureText(testLine).width > maxW) {
                        if (currentLine) {
                            lines.push(currentLine);
                            currentLine = word;
                        } else {
                            let tempLine = '';
                            for (let j = 0; j < word.length; j++) {
                                const char = word[j];
                                if (ctx.measureText(tempLine + char).width > maxW) {
                                    lines.push(tempLine);
                                    tempLine = char;
                                } else {
                                    tempLine += char;
                                }
                            }
                            currentLine = tempLine;
                        }
                    } else {
                        currentLine = testLine;
                    }
                }
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            ctx.fillStyle = currentTheme.textMain;

            const notesTop = 582;
            const notesBottom = 535 + 225 - 14;
            let noteFontSize = 11;
            let notesLines = [];
            let noteLineHeight = 0;
            do {
                ctx.font = `bold ${noteFontSize}px ${activeFont}`;
                notesLines = wrapNotesText(notesText, 218);
                noteLineHeight = noteFontSize * 1.65;
                if ((notesTop + notesLines.length * noteLineHeight) <= notesBottom + noteLineHeight) break;
                noteFontSize -= 0.5;
            } while (noteFontSize > 6.5);

            ctx.font = `bold ${noteFontSize}px ${activeFont}`;
            let notesY = notesTop;
            for (let n = 0; n < notesLines.length; n++) {
                if (notesY > notesBottom) break;
                ctx.fillText(notesLines[n], 56, notesY);
                notesY += noteLineHeight;
            }

            panel(310, 120, 540, 640);

            const liveBiasBadge = document.getElementById('bias-badge');
            const biasText = liveBiasBadge ? liveBiasBadge.textContent.trim() : '⚖️ Neutral';

            ctx.save();
            ctx.font = `bold 12px ${activeFont}`;
            const biasTextWidth = ctx.measureText(biasText).width;
            const biasBoxW = Math.max(120, Math.min(480, biasTextWidth + 32));
            const biasBoxH = 30;
            const biasBoxX = 310 + (540 - biasBoxW) / 2;
            const biasBoxY = 132;

            panel(biasBoxX, biasBoxY, biasBoxW, biasBoxH, { fill: selectedThemeId === 'parchment' ? '#a39169' : (currentTheme.bgInput || currentTheme.bgCard) });

            ctx.fillStyle = currentTheme.textMain;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(biasText, biasBoxX + biasBoxW / 2, biasBoxY + biasBoxH / 2);
            ctx.restore();

            const savedBorderColor = this.radarChart.data.datasets[0].borderColor;
            const savedPointColor = this.radarChart.data.datasets[0].pointBackgroundColor;
            const savedBgColor = this.radarChart.data.datasets[0].backgroundColor;
            const savedLabelFont = { ...this.radarChart.options.scales.r.pointLabels.font };
            const savedLabelColor = this.radarChart.options.scales.r.pointLabels.color;

            const chartCanvas = this.radarChart.canvas;
            const originalWidth = chartCanvas.style.width;
            const originalHeight = chartCanvas.style.height;

            this.radarChart.data.datasets[0].borderColor = currentTheme.accent;
            this.radarChart.data.datasets[0].pointBackgroundColor = currentTheme.accent;
            this.radarChart.data.datasets[0].backgroundColor = currentTheme.accent + '22';

            this.radarChart.options.scales.r.pointLabels.font.family = activeFont;
            this.radarChart.options.scales.r.pointLabels.color = currentTheme.textSecondary;

            const radarCaptureSize = 900;
            chartCanvas.style.width = radarCaptureSize + 'px';
            chartCanvas.style.height = radarCaptureSize + 'px';

            const normalLabelSize = savedLabelFont.size || 10;
            this.radarChart.options.scales.r.pointLabels.font.size = normalLabelSize * 2.4;

            this.radarChart.resize(radarCaptureSize, radarCaptureSize);
            this.radarChart.update('none');
            this.radarChart.draw();

            const tempRadarSrc = this.radarChart.toBase64Image();

            chartCanvas.style.width = originalWidth;
            chartCanvas.style.height = originalHeight;
            this.radarChart.data.datasets[0].borderColor = savedBorderColor;
            this.radarChart.data.datasets[0].pointBackgroundColor = savedPointColor;
            this.radarChart.data.datasets[0].backgroundColor = savedBgColor;
            this.radarChart.options.scales.r.pointLabels.font = savedLabelFont;
            this.radarChart.options.scales.r.pointLabels.color = savedLabelColor;
            this.radarChart.resize();
            this.radarChart.update('none');
            this.radarChart.draw();

            const radarDrawSize = 480;
            const radarDrawX = 310 + (540 - radarDrawSize) / 2;
            const radarDrawY = 120 + (640 - radarDrawSize) / 2;

            const radarImg = new Image();
            radarImg.onload = () => {
                ctx.drawImage(radarImg, radarDrawX, radarDrawY, radarDrawSize, radarDrawSize);

                // Form Factor + Connector badges, bottom-center of the radar box
                const badgeCenterX = 310 + 270;           // 580 → center of the box x-range [310,850]
                const badgeY = 120 + 640 - 42;          // ~718 → just below the 480px radar glyph
                const badgeLabel = this.formFactor || 'IEM';
                const connLabel = this.connector || '2-pin';

                ctx.textAlign = "center";
                ctx.textBaseline = "middle";

                ctx.font = `bold 11px ${activeFont}`;
                const formTextW = ctx.measureText(badgeLabel).width;
                const connTextW = ctx.measureText(connLabel).width;
                const iconSize = 22;
                const iconTextGap = 12;
                const hasFormIcon = !!formIconImages.form;
                const hasConnIcon = !!connectorIconImages.connector;
                const formGroupW = (hasFormIcon ? iconSize + iconTextGap : 0) + formTextW;
                const connGroupW = (hasConnIcon ? iconSize + iconTextGap : 0) + connTextW;

                // Form factor occupies the left half of the badge band, connector the right half
                const formCenterX = badgeCenterX - 135;
                const connCenterX = badgeCenterX + 135;

                if (hasFormIcon) {
                    ctx.drawImage(formIconImages.form, formCenterX - formGroupW / 2, badgeY - iconSize / 2, iconSize, iconSize);
                }
                ctx.fillStyle = currentTheme.textMain;
                ctx.fillText(badgeLabel, formCenterX - formGroupW / 2 + (hasFormIcon ? iconSize + iconTextGap : 0) + formTextW / 2, badgeY);

                if (hasConnIcon) {
                    ctx.drawImage(connectorIconImages.connector, connCenterX - connGroupW / 2, badgeY - iconSize / 2, iconSize, iconSize);
                }
                ctx.fillStyle = currentTheme.textMain;
                ctx.fillText(connLabel, connCenterX - connGroupW / 2 + (hasConnIcon ? iconSize + iconTextGap : 0) + connTextW / 2, badgeY);

                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";

                this.triggerInfographicDownload(canvas, brand, model);
            };
            radarImg.src = tempRadarSrc;

            panel(870, 120, 290, 90);

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("OVERALL SCORE", 890, 144);

            ctx.fillStyle = currentTheme.textMain;
            ctx.font = `bold 52px ${activeFont}`;
            ctx.fillText(score, 890, 196);
            const scoreWidth = ctx.measureText(score).width;

            ctx.fillStyle = currentTheme.textSecondary;
            ctx.font = `20px ${activeFont}`;
            ctx.fillText("/10", 890 + scoreWidth + 6, 196);

            const gx = 1070;
            const gy = 25;
            const gw = 85, gh = 45;
            const gradeText = this.exportGrade || "A";

            ctx.save();
            panel(gx, gy, gw, gh, { strokeColor: currentTheme.accent });

            // The four accent corner marks that used to sit here were solid 6x6
            // squares drawn OUTSIDE the panel bounds. On a rounded panel they read
            // as crop/resize handles - "this image is selected" - rather than as
            // part of the design, and being square they clashed with every
            // rounded corner on the card. The accent-stroked panel already marks
            // the grade clearly, so they were removed rather than restyled.

            ctx.fillStyle = currentTheme.textMain;
            ctx.font = `bold 24px ${activeFont}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gradeText, gx + gw / 2, gy + gh / 2);
            ctx.restore();

            panel(870, 220, 290, 210);

            const canvasPrev = document.getElementById('image-preview-canvas');
            const imgToDraw = (IEM_Module.removeWhiteBg && IEM_Module.processedCanvas) ? IEM_Module.processedCanvas : IEM_Module.rawImageObj;

            if (imgToDraw && imgToDraw.width > 0 && imgToDraw.height > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(885, 235, 260, 180);
                ctx.clip();

                const iw = imgToDraw.width, ih = imgToDraw.height;
                const rImg = iw / ih, rCvs = 260 / 180;
                let drawW = 260, drawH = 180;
                if (rImg > rCvs) drawH = 260 / rImg;
                else drawW = 180 * rImg;

                const prevW = (canvasPrev && canvasPrev.clientWidth > 0) ? canvasPrev.clientWidth : 340;
                const prevH = (canvasPrev && canvasPrev.clientHeight > 0) ? canvasPrev.clientHeight : 340;

                const scale = IEM_Module.imgScale || 1.0;
                const offsetX = (IEM_Module.imgOffsetX || 0) * (260 / prevW);
                const offsetY = (IEM_Module.imgOffsetY || 0) * (180 / prevH);

                ctx.translate(885 + 130 + offsetX, 235 + 90 + offsetY);
                ctx.scale(scale, scale);
                ctx.translate(-drawW / 2, -drawH / 2);
                ctx.drawImage(imgToDraw, 0, 0, drawW, drawH);
                ctx.restore();

                // R9: the photo frame was the last square panel. Drawn as a stroke only,
                // because the photo itself is painted first and the frame sits
                // on top of it.
                ctx.strokeStyle = currentTheme.border;
                ctx.lineWidth = 1;
                roundRectPath(885, 235, 260, 180, currentTheme.radiusSm);
                ctx.stroke();
            } else {
                panel(885, 235, 260, 180, { fill: 'rgba(0, 0, 0, 0.25)', radius: currentTheme.radiusSm });

                ctx.fillStyle = currentTheme.textSecondary;
                ctx.font = `32px ${activeFont}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("📷", 1015, 325);
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";
            }

            panel(870, 440, 290, 160);

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("COMPATIBILITY", 890, 464);

            let impVal = parseFloat(document.getElementById('impedance').value);
            if (isNaN(impVal) || impVal <= 0) impVal = 5;
            let sensVal = parseFloat(document.getElementById('sensitivity').value);
            if (isNaN(sensVal)) sensVal = 80;

            let pReqIemExport, vReq;
            const splTargetExport = this.getListeningSplTarget();
            if (this.sensUnit === 'V') {
                vReq = Math.pow(10, (splTargetExport - sensVal) / 20);
                pReqIemExport = (vReq * vReq / impVal) * 1000;
            } else {
                pReqIemExport = Math.pow(10, (splTargetExport - sensVal) / 10);
                vReq = Math.sqrt((pReqIemExport * impVal) / 1000);
            }

            const dacImpedances = { 'Phone': 6.0, 'Laptop': 3.5, 'Dongle': 1.0, 'Amp': 0.1, 'Desktop': 0.1 };
            const dacLimits = {
                'Phone': { v: 0.4, p: 8 },
                'Laptop': { v: 1.0, p: 30 },
                'Dongle': { v: 2.0, p: 100 },
                'Amp': { v: 4.0, p: 1000 },
                'Desktop': { v: 4.0, p: 1000 }
            };
            const dacTiersList = [
                { id: 'Phone', emoji: '📱' },
                { id: 'Laptop', emoji: '💻' },
                { id: 'Dongle', emoji: '🔌' },
                { id: 'Desktop', emoji: '🖥️' }
            ];

            let guideY = 485;
            dacTiersList.forEach(tier => {
                const dac = dacLimits[tier.id];
                const Rs = dacImpedances[tier.id] || 1.0;
                const vDivider = impVal / (impVal + Rs);
                const vReqSource = vReq / vDivider;
                // Keep total-draw for reference but classification uses load power pReqIemExport
                const pDrawnSource = (vReqSource * vReqSource) / (impVal + Rs) * 1000;
                // Bar must reflect the WORST of power/voltage like the live
                // view (maxRatio); power-only showed full-green on V-failures.
                const pRatio = pReqIemExport > 0 ? dac.p / pReqIemExport : 0;
                const vRatio = vReqSource > 0 ? dac.v / vReqSource : 0;
                const worstRatio = Math.min(pRatio, vRatio);

                let text = "POOR", col = "#ef4444", ratio = Math.min(1.0, worstRatio);

                if (pReqIemExport > dac.p * 1.5 || vReqSource > dac.v * 1.5) {
                    text = "WEAK"; col = "#ef4444"; ratio = Math.max(0.12, Math.min(1.0, worstRatio));
                } else if (pReqIemExport > dac.p || vReqSource > dac.v) {
                    text = "RISKY"; col = "#f59e0b"; ratio = Math.min(1.0, worstRatio);
                } else if (pReqIemExport > dac.p * 0.4 || vReqSource > dac.v * 0.4) {
                    text = "OK"; col = "#22c55e"; ratio = 0.88;
                } else {
                    text = "GREAT"; col = "#10b981"; ratio = 1.0;
                }

                if (typeof dacIconImages !== 'undefined' && dacIconImages && dacIconImages[tier.id]) {
                    ctx.drawImage(dacIconImages[tier.id], 890, guideY - 12, 18, 18);
                } else {
                    ctx.font = `16px ${activeFont}`;
                    ctx.fillText(tier.emoji, 890, guideY + 4);
                }

                ctx.fillStyle = currentTheme.textSecondary;
                ctx.font = `bold 10px ${activeFont}`;
                ctx.fillText(tier.id, 914, guideY);

                ctx.font = `bold 10px ${activeFont}`;
                const statusTextWidth = ctx.measureText(text).width;
                const barGap = 8;
                const barMaxWidth = Math.max(30, 1140 - statusTextWidth - barGap - 965);

                ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
                ctx.fillRect(965, guideY - 7, barMaxWidth, 7);

                ctx.fillStyle = col;
                ctx.fillRect(965, guideY - 7, Math.round(barMaxWidth * ratio), 7);

                ctx.textAlign = "right";
                ctx.fillText(text, 1140, guideY - 1);
                ctx.textAlign = "left";
                guideY += 26;
            });

            panel(870, 610, 290, 150);

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("SOUND SIGNATURES", 890, 634);

            let allActiveTags = [
                ...Array.from(this.selectedTags),
                ...Array.from(this.selectedBass),
                ...Array.from(this.selectedGenres)
            ].slice(0, 4);
            if (allActiveTags.length === 0) allActiveTags.push("⚖️ Neutral");

            allActiveTags.forEach((t, i) => {
                const colIdx = i % 2;
                const rowIdx = Math.floor(i / 2);

                const tx = 888 + colIdx * 135;
                const ty = 655 + rowIdx * 42;

                const emojiMatch = t.match(/^([\uD800-\uDBFF][\uDC00-\uDFFF]|\u00ae|\u00a9|[\u2000-\u3300]|[\ud000-\udfff]|\ud83d\udcbf|\ud83c\udfae|\ud83c\udfac)/);
                let emoji = "•";
                let label = t;
                if (emojiMatch) {
                    emoji = emojiMatch[1];
                    label = t.slice(emoji.length).trim();
                }

                ctx.fillStyle = currentTheme.accent;
                ctx.font = `18px ${activeFont}`;
                ctx.fillText(emoji, tx, ty + 18);

                ctx.fillStyle = currentTheme.textMain;
                drawFittedText(label, tx + 24, ty + 15, 105, 10, true, 'left');
            });
        },

        triggerInfographicDownload: function(canvas, brand, model) {
            const dataStr = canvas.toDataURL("image/png");
            const a = document.createElement('a');
            a.href = dataStr;
            a.download = `${brand}-${model}-review-card.png`;
            a.click();
        },

        // Export was a permanent primary CTA, so the loudest button in the pane
        // advertised something most users cannot do yet - the card still exports
        // "Generic IEM" until a brand, model, driver or note exists. It now
        // promotes itself only once there is something worth exporting, which is
        // what a primary action is supposed to mean. Called from updateAll.
        // Export is always clickable. An earlier pass disabled it while the
        // review was empty, on the reasoning that a primary action should not
        // advertise something unavailable. That was wrong: exporting a partially
        // filled review is a legitimate thing to want (you often export a card
        // mid-review, or export an empty one as a blank template), and silently
        // taking the button away lost a capability that used to work.
        //
        // So only the emphasis is state-driven: quiet while there is nothing much
        // to show, primary once the review has real content. Never disabled.
        updateExportAvailability: function() {
            const btn = document.querySelector('[data-action="click_233_IEM_showExportModal"]');
            if (!btn) return;

            // Bind a delegated listener once. updateAll() covers programmatic
            // changes, but typing in the brand/model/price/notes fields fires
            // only their own input handlers, so without this the button stayed
            // greyed out while the user filled the form in front of it.
            if (!this._exportAvailBound) {
                this._exportAvailBound = true;
                document.addEventListener('input', (e) => {
                    const id = e.target && e.target.id;
                    if (id === 'brand' || id === 'model' || id === 'price' || id === 'review-notes') {
                        IEM.updateExportAvailability();
                    }
                });
            }

            const fieldText = (id) => {
                const el = document.getElementById(id);
                return el ? String(el.value || '').trim() : '';
            };
            const drivers = Object.values(this.selectedDriverTypes || {}).some(n => Number(n) > 0);
            const tags = Array.isArray(this.signatureTags) ? this.signatureTags.length > 0 : false;
            const ready =
                fieldText('brand') !== '' ||
                fieldText('model') !== '' ||
                fieldText('price') !== '' ||
                fieldText('review-notes') !== '' ||
                drivers || tags;
            btn.classList.toggle('is-ready', ready);
            btn.title = ready
                ? 'Export review card'
                : 'Export review card (mostly empty)';
        },
};
