const App_Theme = {
    themeMap: {},
    fontMap: {},
    fontMeta: [],
    builtInThemes: [],
    currentTheme: 'slate',
    currentFontScale: 1.0,
    currentReadingScale: 1.0,
    currentFontMeta: null,
    isComicFont: false,

    init: function(builtInThemes, fontMeta) {
        this.builtInThemes = builtInThemes;
        this.fontMeta = fontMeta;
        this.builtInThemes.forEach(theme => {
            this.themeMap[theme.id] = {
                name: theme.name,
                emoji: theme.emoji,
                variables: theme.variables,
                accent: theme.variables['--accent-blue']
            };
        });
    },

    _defaultThemeEntry: function() {
        const g = this.builtInThemes.find(t => t.id === 'slate');
        return g ? { name: g.name, emoji: g.emoji, accent: g.variables['--accent-blue'], variables: g.variables } : null;
    },

    setGlobalTheme: function(themeId) {
        try {
            const t = (this.themeMap && this.themeMap[themeId]) ? this.themeMap[themeId] : this._defaultThemeEntry();
            this.currentTheme = this.themeMap[themeId] ? themeId : 'slate';

            const root = document.documentElement;

            if (t.variables) {
                Object.entries(t.variables).forEach(([key, val]) => {
                    root.style.setProperty(key, val);
                });
            }

            document.documentElement.className = 'theme-' + themeId;

            const accentColor = t.accent || (t.variables && t.variables['--accent-blue']) || '#787878';
            const rgbStr = (typeof PEQDB_Module !== 'undefined' && PEQDB_Module.hexToRgb) ? PEQDB_Module.hexToRgb(accentColor) : '120, 120, 120';
            root.style.setProperty('--accent-blue-rgb', rgbStr);

            const expThemeSelector = document.getElementById('export-theme-selector');
            if (expThemeSelector) expThemeSelector.value = themeId;

            ['find', 'eq', 'testlab', 'iem', 'visualizer', 'settings'].forEach(id => {
                const b = document.getElementById(`tab-${id}-btn`);
                if (b) {
                    b.style.backgroundColor = '';
                    b.style.color = '';
                    b.style.boxShadow = '';
                    b.style.transform = '';
                }
            });
            const activeTabId = ['find', 'eq', 'testlab', 'iem', 'visualizer', 'settings'].find(id => {
                const pane = document.getElementById(`pane-${id}`);
                return pane && !pane.classList.contains('hidden');
            }) || 'find';
            const activeBtn = document.getElementById(`tab-${activeTabId}-btn`);
            if (activeBtn) {
                activeBtn.style.backgroundColor = accentColor;
                activeBtn.style.color = window.App && App.getContrastTextColor ? App.getContrastTextColor(accentColor) : '#ffffff';
                activeBtn.style.boxShadow = 'inset 2px 2px 0px 0px rgba(0, 0, 0, 0.35)';
                activeBtn.style.transform = 'translate(1px, 1px)';
            }

            const themeBtn = document.getElementById('theme-cycle-btn');
            if (themeBtn) {
                themeBtn.innerHTML = `<span>${t.emoji || '🎨'} ${t.name}</span>`;
            }

            if (window.IEM && IEM.radarChart) {
                IEM.radarChart.data.datasets[0].borderColor = t.accent;
                IEM.radarChart.data.datasets[0].pointBackgroundColor = t.accent;
                IEM.radarChart.data.datasets[0].backgroundColor = t.accent + '1a';
                if (IEM.radarChart.options && IEM.radarChart.options.scales && IEM.radarChart.options.scales.r) {
                    IEM.radarChart.options.scales.r.pointLabels.color = t.variables ? t.variables['--text-main'] : '#1a1105';
                }
                IEM.radarChart.update();
            }
            if (window.EQ) {
                EQ.drawCurve();
            }
            if (window.syncGlobalSliders) {
                window.syncGlobalSliders();
            }
            localStorage.setItem('settings_theme_id', themeId);
            if (typeof EQ_Module !== 'undefined') {
                EQ_Module._vizThemeDirty = true;
            }
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
            this.applyThemeTransition();
        } catch (error) {
            console.error("Theme application failed:", error);
        }
    },

    cycleTheme: function() {
        const keys = Object.keys(this.themeMap);
        const current = localStorage.getItem('settings_theme_id') || 'slate';
        let nextIdx = (keys.indexOf(current) + 1) % keys.length;
        if (nextIdx < 0 || nextIdx >= keys.length) nextIdx = 0;
        this.setGlobalTheme(keys[nextIdx]);
    },

    getContrastTextColor: function(hex) {
        try {
            if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return '#ffffff';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);

            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.6 ? '#000000' : '#ffffff';
        } catch (e) {
            return '#ffffff';
        }
    },

    setGlobalFont: function(fontId) {
        try {
            const fontStack = (this.fontMap && this.fontMap[fontId]) ? this.fontMap[fontId] : 'system-ui, -apple-system, sans-serif';
            if (!fontStack) return;

            document.documentElement.style.setProperty('--font-family', fontStack);
            this.isComicFont = fontId.toLowerCase().includes('comic');

            const meta = this.fontMeta.find(m => m.id === fontId) || { scale: 1.0, letterSpacing: 'normal', emoji: '🔤' };

            this.currentFontMeta = meta;
            document.documentElement.style.setProperty('--font-letter-spacing', meta.letterSpacing);

            this.currentFontScale = meta.scale;
            this.updateCombinedFontScale();

            const fontBtn = document.getElementById('font-cycle-btn');
            if (fontBtn) {
                fontBtn.innerHTML = `<span>${meta.emoji} ${fontId}</span>`;
            }

            if (typeof IEM_Module !== 'undefined' && IEM_Module.selectExportFont) {
                IEM_Module.selectExportFont(fontId);
            }

            if (window.Chart) {
                Chart.defaults.font.family = fontStack;
            }
            if (window.IEM && IEM.radarChart) {
                IEM.radarChart.options.scales.r.pointLabels.font.family = fontStack;
                IEM.radarChart.update();
            }
            if (window.EQ) {
                EQ.drawCurve();
            }
            localStorage.setItem('settings_font_id', fontId);
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
        } catch (error) {
            console.error("Font application failed:", error);
        }
    },

    cycleFont: function() {
        const keys = Object.keys(this.fontMap);
        if (keys.length === 0) return;
        const current = localStorage.getItem('settings_font_id') || keys[0];
        let curIdx = keys.indexOf(current);
        if (curIdx === -1) curIdx = 0;
        const nextIdx = (curIdx + 1) % keys.length;
        this.setGlobalFont(keys[nextIdx]);
    },

    currentFontScale: 1.0,
    currentReadingScale: 1.0,

    updateCombinedFontScale: function() {
        const raw = this.currentFontScale * this.currentReadingScale;
        const combined = Math.max(0.7, Math.min(1.3, raw));

        document.documentElement.style.setProperty('--font-scale-modifier', combined);
        document.documentElement.style.fontSize = (16 * combined) + 'px';
        document.documentElement.style.zoom = '1';

        if (window.EQ && EQ.drawCurve) EQ.drawCurve();
    },

    setReadingSize: function(scaleVal) {
        const val = parseFloat(scaleVal) || 1.0;
        this.currentReadingScale = val;

        const pct = Math.round(val * 100);
        const disp = document.getElementById('reading-size-display');
        if (disp) disp.textContent = pct + '%';

        this.updateCombinedFontScale();
        localStorage.setItem('settings_reading_scale', val);
    },

    applyThemeTransition: function() {
        document.body.classList.add('theme-transition');
        setTimeout(() => {
            document.body.classList.remove('theme-transition');
        }, 300);
    },

    loadDynamicFonts: async function() {
        try {
            var res = await fetch('./app/fonts/fonts.json');
            if (!res.ok) throw new Error("Could not find fonts.json");
            var fontList = await res.json();

            this.fontMap = {};
            this.fontMeta = [];

            const loadedEntries = [];
            for (var i = 0; i < fontList.length; i++) {
                var f = fontList[i];
                if (!f.file || f.file.includes(',')) {
                    loadedEntries.push({ meta: f, isSystemStack: true });
                    continue;
                }
                try {
                    var fontFace = new FontFace(f.name, 'url(./app/fonts/' + f.file + ')');
                    await fontFace.load();
                    document.fonts.add(fontFace);
                    loadedEntries.push({ meta: f, isSystemStack: false });
                } catch (fontErr) {
                    console.warn(`[Offline Font Notice] Local font "${f.name}" (${f.file}) not found in ./app/fonts/. Falling back.`);
                }
            }

            const baselineEntry = loadedEntries.find(e => !e.isSystemStack && e.meta.name === this.BASELINE_FONT_NAME);
            const baselineFamily = baselineEntry ? `"${this.BASELINE_FONT_NAME}", sans-serif` : "system-ui, -apple-system, sans-serif";

            for (var j = 0; j < loadedEntries.length; j++) {
                const entry = loadedEntries[j];
                const f = entry.meta;

                if (entry.isSystemStack) {
                    this.fontMap[f.name] = f.file || 'system-ui, -apple-system, sans-serif';
                    this.fontMeta.push({
                        id: f.name, name: f.name, emoji: f.emoji || '🔤',
                        scale: 1.0, letterSpacing: 'normal'
                    });
                    continue;
                }

                this.fontMap[f.name] = '"' + f.name + '", sans-serif';

                const metrics = (f.name === this.BASELINE_FONT_NAME)
                    ? { scale: 1.0, letterSpacing: 'normal' }
                    : this.calculateFontMetrics(f.name, baselineFamily);

                this.fontMeta.push({
                    id: f.name,
                    name: f.name,
                    emoji: f.emoji || '🔤',
                    scale: metrics.scale,
                    letterSpacing: metrics.letterSpacing
                });
            }

            if (Object.keys(this.fontMap).length === 0) {
                this.useSystemFontsFallback();
            }
        } catch (err) {
            console.warn("Fonts loading failed.", err);
            this.useSystemFontsFallback();
        }
    },

    BASELINE_FONT_NAME: 'Silkscreen',

    calculateFontMetrics: function(fontName, baselineFamily) {
        try {
            const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const refFamily = baselineFamily || "system-ui, -apple-system, sans-serif";

            ctx.font = `72px ${refFamily}`;
            const refM = ctx.measureText(testString);
            const refW = refM.width;
            const refH = (refM.actualBoundingBoxAscent || 50) + (refM.actualBoundingBoxDescent || 12);

            ctx.font = `72px "${fontName}", sans-serif`;
            const customM = ctx.measureText(testString);
            const customW = customM.width;
            const customH = (customM.actualBoundingBoxAscent || 50) + (customM.actualBoundingBoxDescent || 12);

            if (!customW || !refW) return { scale: 1.0, letterSpacing: 'normal' };

            const wRatio = refW / customW;
            const hRatio = refH / customH;

            let fontScale = Math.min(wRatio, hRatio);

            fontScale = Math.max(0.7, Math.min(1.3, fontScale));

            let spacing = "normal";
            if (wRatio < 0.82) spacing = "-0.03em";
            else if (wRatio > 1.18) spacing = "0.03em";

            return {
                scale: parseFloat(fontScale.toFixed(2)),
                letterSpacing: spacing
            };
        } catch (e) {
            return { scale: 1.0, letterSpacing: 'normal' };
        }
    },

    useSystemFontsFallback: function() {
        this.fontMap = {
            "System UI": "system-ui, sans-serif"
        };
        this.fontMeta = [{
            id: "System UI",
            name: "System UI",
            emoji: "💻",
            scale: 1.0,
            letterSpacing: "normal"
        }];
    }
};

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App_Theme;
} else {
    window.App_Theme = App_Theme;
}