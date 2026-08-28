// Split out of the former monolithic app-core.js (2026 refactor).
// A few small shared helpers (getBandEnergy, debounce, rafThrottle, etc.)
// followed by IEM_Module (the review-card / IEM-info builder tab). Kept
// together because they sat immediately adjacent in the original file.

function getBandEnergy(dataArray, startBin, endBin) {
    var sum = 0;
    for (var i = startBin; i <= endBin; i++) {
        sum += dataArray[i] || 0;
    }
    return sum / (endBin - startBin + 1) / 255;
}

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    }

    function rafThrottle(func) {
        let scheduled = false;
        let lastArgs = null;
        return function throttled(...args) {
            lastArgs = args;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                func.apply(this, lastArgs);
            });
        };
    }

    function setAudioParamSmooth(audioParam, value, timeConstant = 0.015) {
        if (audioParam) {
            if (SharedAudio.ctx && SharedAudio.ctx.state !== 'suspended') {
                const now = SharedAudio.ctx.currentTime;
                try {

                    audioParam.setTargetAtTime(value, now, timeConstant);
                } catch (e) {
                    audioParam.value = value;
                }
            } else {
                audioParam.value = value;
            }
        }
    }

    function showToast(message, icon = "ℹ️", opts) {
        opts = opts || {};
        const stack = document.getElementById('toast-stack');
        if (!stack) return;

        // Cap the number of visible toasts — evict the oldest first.
        while (stack.children.length >= 6) {
            const first = stack.firstElementChild;
            if (first) { clearTimeout(first.timeoutId); first.remove(); }
        }

        const item = document.createElement('div');
        item.className = 'toast-item pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 rounded-md border-2 border-black bg-[var(--bg-card)] text-[var(--text-main)] shadow-[4px_4px_0_0_#000] text-xs font-bold select-none';
        item.style.animation = 'toast-in .18s ease-out';

        const action = opts.action;
        let html = '<span class="toast-icon flex-shrink-0 leading-none">' + esc(icon || 'ℹ️') + '</span>';
        html += '<div class="min-w-0 flex-1 leading-snug break-words">' + esc(String(message == null ? '' : message)) + '</div>';
        if (action && action.label) {
            html += '<button class="toast-act flex-shrink-0 px-2 py-1 border-2 border-black bg-[var(--accent-blue)] text-white text-[10px] font-black rounded-sm cursor-pointer hover:brightness-110">' + esc(action.label) + '</button>';
        }
        html += '<button class="toast-x flex-shrink-0 text-zinc-500 hover:text-red-400 text-[10px] leading-none cursor-pointer">✕</button>';
        item.innerHTML = html;

        const dismiss = (el, immediate) => {
            clearTimeout(el.timeoutId);
            if (immediate || !el.parentNode) { el.remove(); return; }
            el.style.transition = 'opacity .25s ease, transform .25s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(-6px)';
            setTimeout(() => { if (el.parentNode) el.remove(); }, 260);
        };

        const actBtn = item.querySelector('.toast-act');
        if (actBtn && action) {
            actBtn.onclick = (ev) => {
                ev.stopPropagation();
                dismiss(item);
                if (typeof action.onClick === 'function') {
                    try { action.onClick(); } catch (e) { console.error('toast action', e); }
                }
            };
        }
        const xBtn = item.querySelector('.toast-x');
        if (xBtn) xBtn.onclick = (ev) => { ev.stopPropagation(); dismiss(item); };

        item.addEventListener('click', (ev) => {
            if (ev.target.closest && ev.target.closest('.toast-act, .toast-x')) return;
            dismiss(item);
        });

        stack.appendChild(item);
        const duration = action ? (opts.duration || 6000) : (opts.duration || 2600);
        item.timeoutId = setTimeout(() => dismiss(item), duration);
    }

    window.toggleAudioMode = function() {
        window.isMonoMode = !window.isMonoMode;
        const btn = document.getElementById('a11y-audio-btn');
        if (btn) btn.innerHTML = window.isMonoMode ? "🦻 Mono" : "🔊 Stereo";
        if (SharedAudio.masterGain) {
            if (window.isMonoMode) {
                SharedAudio.masterGain.channelCount = 1;
                SharedAudio.masterGain.channelCountMode = 'explicit';
            } else {
                SharedAudio.masterGain.channelCount = 2;
                SharedAudio.masterGain.channelCountMode = 'max';
            }
        }

        var el = document.getElementById('brand-icon-emoji');
        if (el && window.isMonoMode) {
            el.textContent = '🦻';
            el.style.fontSize = '22px';
            el.style.lineHeight = '1';
            el.className = 'inline select-none emoji-font anim-mascot-idle';
            setTimeout(function() { Mascot.update(); }, 1500);
        } else if (el && !window.isMonoMode) {
            el.textContent = '🔊';
            el.style.fontSize = '22px';
            el.style.lineHeight = '1';
            el.className = 'inline select-none emoji-font anim-mascot-sparkle';
            setTimeout(function() { Mascot.update(); }, 1200);
        }
    };

window.updateExpandedAutoHide = function() {
    const isAnyExpanded = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
    const footer = document.getElementById('global-footer-bar');
    if (!footer) return;

    if (isAnyExpanded) {
        footer.style.zIndex = '999999';
        if (!window._expandedMouseMoveBound) {
            window._expandedMouseMoveBound = true;
            window._expandedHideTimer = null;
            window._onExpandedMouseMove = () => {
                const active = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
                if (!active) return;

                if (footer) {
                    footer.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                    footer.style.transform = 'translateY(0)';
                    footer.style.opacity = '1';
                    footer.style.pointerEvents = 'auto';
                }

                clearTimeout(window._expandedHideTimer);
                window._expandedHideTimer = setTimeout(() => {
                    const stillActive = (window.EQ && EQ.isGraphExpanded) || (window.TestLab && TestLab.isSpatialExpanded);
                    if (stillActive && footer) {
                        footer.style.transform = 'translateY(150%)';
                        footer.style.opacity = '0';
                        footer.style.pointerEvents = 'none';
                    }
                }, 2500);
            };
            window.addEventListener('mousemove', window._onExpandedMouseMove);
        }

        if (footer) {
            footer.style.transform = 'translateY(150%)';
            footer.style.opacity = '0';
            footer.style.pointerEvents = 'none';
        }
    } else {
        clearTimeout(window._expandedHideTimer);
        if (footer) {
            footer.style.zIndex = '';
            footer.style.transition = '';
            footer.style.transform = '';
            footer.style.opacity = '';
            footer.style.pointerEvents = '';
        }
    }
};

    const App = {
    domCache: new Map(),
    getEl: function(id) {
        if (!this.domCache.has(id)) {
            this.domCache.set(id, document.getElementById(id));
        }
        return this.domCache.get(id);
    },
    saveWorkspaceState: function() {

    },
    mobileDrawerOpen: false,
    toggleMobileDrawer: function() {
        this.mobileDrawerOpen = !this.mobileDrawerOpen;
        const drawer = document.getElementById('mobile-nav-drawer');
        if (drawer) {
            if (this.mobileDrawerOpen) {
                drawer.classList.remove('hidden');
            } else {
                drawer.classList.add('hidden');
            }
        }
    },
    toggleMobileSidebar: function() {
        this.toggleMobileDrawer();
    },
        isComicFont: false,
        themeMap: {},

        builtInThemes: [
            { "id": "slate", "name": "Slate", "emoji": "🕹️", "variables": { "--accent-blue": "#6488b0", "--bg-body": "#111115", "--bg-window": "#16161c", "--bg-card": "#202028", "--bg-sidebar": "#0d0d10", "--bg-input": "#181822", "--text-main": "#f0f0f4", "--text-secondary": "#8c8c9e", "--border-color": "#000000" } },
            { "id": "parchment", "name": "Parchment", "emoji": "📜", "variables": { "--accent-blue": "#c85a0e", "--bg-body": "#cdb98c", "--bg-window": "#d4c093", "--bg-card": "#e2d2a8", "--bg-sidebar": "#bda87d", "--bg-input": "#e6d8b0", "--text-main": "#1a1105", "--text-secondary": "#4a3722", "--border-color": "#000000" } },
            { "id": "ember", "name": "Ember", "emoji": "🔴", "variables": { "--accent-blue": "#c84b4b", "--bg-body": "#181111", "--bg-window": "#201616", "--bg-card": "#2c1e1e", "--bg-sidebar": "#130d0d", "--bg-input": "#171010", "--text-main": "#f5ecec", "--text-secondary": "#a88080", "--border-color": "#000000" } },
            { "id": "circuit", "name": "Circuit", "emoji": "🔵", "variables": { "--accent-blue": "#457cb4", "--bg-body": "#101520", "--bg-window": "#161c2b", "--bg-card": "#20283b", "--bg-sidebar": "#0d111a", "--bg-input": "#121724", "--text-main": "#ecf2f8", "--text-secondary": "#788ca8", "--border-color": "#000000" } },
            { "id": "byte", "name": "Byte", "emoji": "📟", "variables": { "--accent-blue": "#489a58", "--bg-body": "#111812", "--bg-window": "#162018", "--bg-card": "#202d23", "--bg-sidebar": "#0d130e", "--bg-input": "#121a13", "--text-main": "#ecf5ed", "--text-secondary": "#7ea383", "--border-color": "#000000" } },
            { "id": "cartridge", "name": "Cartridge", "emoji": "🟠", "variables": { "--accent-blue": "#c8733a", "--bg-body": "#191410", "--bg-window": "#211a15", "--bg-card": "#2e251e", "--bg-sidebar": "#13100d", "--bg-input": "#18130f", "--text-main": "#f7f0eb", "--text-secondary": "#aa8e80", "--border-color": "#000000" } },
            { "id": "arcade", "name": "Arcade", "emoji": "👾", "variables": { "--accent-blue": "#8262c8", "--bg-body": "#14111d", "--bg-window": "#1b1728", "--bg-card": "#272138", "--bg-sidebar": "#100e18", "--bg-input": "#14111f", "--text-main": "#f2edf8", "--text-secondary": "#9284a8", "--border-color": "#000000" } },
            { "id": "blush", "name": "Blush", "emoji": "🌸", "variables": { "--accent-blue": "#c85a95", "--bg-body": "#1a1116", "--bg-window": "#22161d", "--bg-card": "#301e28", "--bg-sidebar": "#140e13", "--bg-input": "#191016", "--text-main": "#f8edf4", "--text-secondary": "#ac8497", "--border-color": "#000000" } },
            { "id": "bit", "name": "Bit", "emoji": "🪙", "variables": { "--accent-blue": "#ca9f33", "--bg-body": "#18150d", "--bg-window": "#201c11", "--bg-card": "#2e2918", "--bg-sidebar": "#13110a", "--bg-input": "#18150d", "--text-main": "#f7f4e8", "--text-secondary": "#ab9d78", "--border-color": "#000000" } }
        ],
        loadDynamicThemes: function() {

        },
        fontMap: {},
        fontMeta: [],

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
        },
        currentTheme: 'slate',

        switchTab: function(tabId) {
            if (tabId !== 'visualizer' && window.EQ && EQ.isVizFullscreen) {
                EQ.exitVisualizerFullscreen();
            }
            try {

                const iemWrapper = document.getElementById('pane-iem-outer-wrapper');
                if (iemWrapper) iemWrapper.classList.toggle('hidden', tabId !== 'iem');

                ['iem', 'eq', 'testlab', 'visualizer', 'settings', 'find'].forEach(id => {
                    const pane = document.getElementById(`pane-${id}`);
                    if (pane) pane.classList.add('hidden');
                    const btn = document.getElementById(`tab-${id}-btn`);
                    if (btn) {
                        btn.classList.remove('bg-zinc-800', 'text-white', 'shadow-sm', 'is-on');
                        btn.classList.add('text-[var(--text-secondary)]');
                        btn.style.backgroundColor = '';
                        btn.style.boxShadow = '';
                        btn.style.transform = '';
                    }
                });
                const activePane = document.getElementById(`pane-${tabId}`);
                if (activePane) activePane.classList.remove('hidden');
                const activeBtn = document.getElementById(`tab-${tabId}-btn`);
                if (activeBtn) {
                    activeBtn.classList.remove('text-[var(--text-secondary)]', 'text-white');
                    activeBtn.classList.add('shadow-sm');

                    const savedTheme = localStorage.getItem('settings_theme_id') || 'slate';
                    const t = (this.themeMap && this.themeMap[savedTheme]) ? this.themeMap[savedTheme] :
                              ((this.themeMap && this.themeMap['slate']) ? this.themeMap['slate'] : { accent: '#787878' });
                    const accentColor = t.accent || '#787878';
                    activeBtn.style.backgroundColor = accentColor;
                    activeBtn.style.color = this.getContrastTextColor ? this.getContrastTextColor(accentColor) : '#ffffff';

                    activeBtn.style.boxShadow = 'inset 2px 2px 0px 0px rgba(0, 0, 0, 0.35)';
                    activeBtn.style.transform = 'translate(1px, 1px)';
                }
                if (tabId === 'eq' && EQ_Module) {
                setTimeout(() => {
                    const cv = document.getElementById("eq-squiglinkViz");
                    if (cv && cv.clientWidth > 0) {
                        EQ_Module.drawCurve();
                    } else {

                        setTimeout(() => EQ_Module.drawCurve(), 200);
                    }
                }, 100);
            }
                if (tabId === 'iem' && window.IEM) {
                    IEM.ensureChartReady();
                }
                if (tabId === 'find' && window.FindEngine) {
                setTimeout(() => {
                    FindEngine.drawTargetVisualization();
                    App.setFindSection(App.activeFindSection);
                }, 50);
            }
            if (tabId === 'eq' && PEQDB_Module.searchMode === 'similar') {
                setTimeout(() => {
                    PEQDB_Module.similarDirty = true;
                    PEQDB_Module.findSimilarCurves();
                }, 100);
            }
                if (tabId === 'visualizer' && EQ_Module) {
                    if (window.SharedAudio && SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume().catch(()=>{});
                    }
                    EQ_Module.vizLoopRunning = false;
                    requestAnimationFrame(() => {
                        EQ_Module.startVisualizer();
                        setTimeout(()=> { if (!EQ_Module.vizLoopRunning) EQ_Module.startVisualizer(); }, 120);
                    });
                }
                if (window.TestLab) {
                    if (tabId === 'testlab') {
                        if (TestLab.spatialOrbitActive) {
                            TestLab.startSpatialOrbit();
                        }
                        const hasActiveSignal = TestLab.activeNodes.length > 0 || TestLab.hearingOsc || TestLab.channelToneOsc;
                        if (hasActiveSignal) {
                            TestLab.startImbalanceMeter();
                        }
                    } else {
                        TestLab.stopSpatialOrbitTimerOnly();
                        if (TestLab.imbalanceInterval) {
                            clearInterval(TestLab.imbalanceInterval);
                            TestLab.imbalanceInterval = null;
                        }
                        // Every Test Lab tone generator (resonance sweep,
                        // hearing test, channel-balance tone, stereo leak
                        // test, spatial/A-B playback) is designed to be
                        // stopped by its own Stop control -- there was no
                        // guard here, so navigating away mid-test left them
                        // playing indefinitely with no visible way to reach
                        // Stop. Burn-in is the one deliberate exception
                        // (long-duration background signal), preserved via
                        // stopAll's second argument.
                        if (TestLab.resonanceInterval || TestLab.hearingOsc || TestLab.channelToneOsc ||
                            TestLab.oscL || TestLab.oscR || TestLab.leakTestActive ||
                            TestLab.spatialActive || TestLab.abPlaying ||
                            (TestLab.activeNodes && TestLab.activeNodes.length > 0)) {
                            TestLab.stopAll(false, true);
                        }
                    }
                }
            } catch (error) {
                console.error("Tab switching failed:", error);
            }
        },

        renderThemeToggles: function() {
            try {
                const container = document.getElementById('theme-toggles-container');
                if (!container) return;
                container.innerHTML = '';

                const themes = [
                    { id: 'slate', label: '🕹️ Slate', emoji: '🕹️' },
                    { id: 'parchment', label: '📜 Parchment', emoji: '📜' },
                    { id: 'ember', label: '🔴 Ember', emoji: '🔴' },
                    { id: 'circuit', label: '🔵 Circuit', emoji: '🔵' },
                    { id: 'byte', label: '📟 Byte', emoji: '📟' },
                    { id: 'cartridge', label: '🟠 Cartridge', emoji: '🟠' },
                    { id: 'arcade', label: '👾 Arcade', emoji: '👾' },
                    { id: 'blush', label: '🌸 Blush', emoji: '🌸' },
                    { id: 'bit', label: '🪙 Bit', emoji: '🪙' }
                ];

                themes.forEach(theme => {
                    const isReady = !!(this.themeMap && this.themeMap[theme.id]);
                    const btn = document.createElement('button');
                    btn.id = 'theme-btn-' + theme.id;
                    btn.className = 'theme-toggle-btn px-2.5 py-1.5 rounded text-[10px] font-bold text-[var(--text-secondary)] hover:text-white border border-transparent transition-all duration-200 flex items-center justify-center gap-1.5 bg-zinc-950/40 hover:scale-[1.03] cursor-pointer';
                    btn.innerHTML = `<span>${theme.emoji}</span> <span class="truncate">${theme.label.split(' ')[1]}</span>`;

                    if (isReady) {
                        btn.onclick = () => App.setGlobalTheme(theme.id);
                        btn.addEventListener('click', function() {
                            this.classList.add('pulse');
                            setTimeout(() => this.classList.remove('pulse'), 200);
                        });
                    } else {
                        btn.disabled = true;
                        btn.classList.add('opacity-40', 'cursor-not-allowed');
                        btn.title = 'Still loading theme data…';
                        btn.onclick = () => showToast('Themes are still loading — try again in a moment.', '⏳');
                    }

                    container.appendChild(btn);
                });
            } catch (error) {
                console.error("Theme toggles creation failed:", error);
            }
        },

        cycleTheme: function() {
            if (window.App_Theme) return App_Theme.cycleTheme.call(this);
            const keys = Object.keys(this.themeMap);
            const current = localStorage.getItem('settings_theme_id') || 'slate';
            let nextIdx = (keys.indexOf(current) + 1) % keys.length;
            if (nextIdx < 0 || nextIdx >= keys.length) nextIdx = 0;
            this.setGlobalTheme(keys[nextIdx]);
        },
        getContrastTextColor: function(hex) {
            if (window.App_Theme) return App_Theme.getContrastTextColor(hex);
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
setGlobalTheme: function(themeId) {
            if (window.App_Theme) return App_Theme.setGlobalTheme.call(this, themeId);
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
                activeBtn.style.color = App.getContrastTextColor ? App.getContrastTextColor(accentColor) : '#ffffff';
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
            // Invalidate the visualizer's cached accent so the next frame
            // re-resolves it (the draw loop no longer re-reads the theme
            // from localStorage every frame).
            if (typeof EQ_Module !== 'undefined') {
                EQ_Module._vizThemeDirty = true;
            }
            // Invalidate canvas font cache
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
            this.applyThemeTransition();
        } catch (error) {
            console.error("Theme application failed:", error);
        }
        },
        cycleFont: function() {
            if (window.App_Theme) return App_Theme.cycleFont.call(this);
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
setGlobalFont: function(fontId) {
            if (window.App_Theme) return App_Theme.setGlobalFont.call(this, fontId);
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
            // Invalidate canvas font cache
            if (window.EQ_MathUtilMethods && EQ_MathUtilMethods.invalidateFontCache) {
                EQ_MathUtilMethods.invalidateFontCache();
            }
        } catch (error) {
            console.error("Font application failed:", error);
        }
        },

        applyThemeTransition: function() {
            if (window.App_Theme) return App_Theme.applyThemeTransition.call(this);
            document.body.classList.add('theme-transition');
            setTimeout(() => {
                document.body.classList.remove('theme-transition');
            }, 300);
        },

        activeReviewSection: 'specs',
        activeEqSection: 'db',
        activeFindSection: 'matches',

        setReviewSection: function(secId) {
            this.activeReviewSection = secId;
            this.updateMobileSectionLabel('iem', secId);

            ['specs', 'radar', 'sliders'].forEach(id => {
                const pill = document.getElementById('m-iem-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colSpecs = document.getElementById('iem-col-specs');
            const colRadar = document.getElementById('iem-col-radar');
            const colSliders = document.getElementById('iem-col-sliders');

            if (colSpecs && colRadar && colSliders) {
                if (window.innerWidth < 1280) {
                    colSpecs.style.display = secId === 'specs' ? 'flex' : 'none';
                    colRadar.style.display = secId === 'radar' ? 'flex' : 'none';
                    colSliders.style.display = secId === 'sliders' ? 'flex' : 'none';

                    if (secId === 'radar' && window.IEM && IEM.radarChart) {
                        setTimeout(() => {
                            IEM.radarChart.resize();
                            IEM.radarChart.update();
                        }, 50);
                    }
                } else {

                    colSpecs.style.display = '';
                    colRadar.style.display = '';
                    colSliders.style.display = '';
                }
            }
        },
                setFindSection: function(secId) {
            this.activeFindSection = secId;
            this.updateMobileSectionLabel('find', secId);
            ['prefs', 'matches', 'tools'].forEach(id => {
                const pill = document.getElementById('m-find-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });
            const colPrefs = document.getElementById('find-col-prefs');
            const colMatches = document.getElementById('find-col-results');
            const colTools = document.getElementById('find-col-tools');
            if (colPrefs && colMatches && colTools) {
                if (window.innerWidth < 1280) {
                    colPrefs.style.display = secId === 'prefs' ? 'flex' : 'none';
                    colMatches.style.display = secId === 'matches' ? 'flex' : 'none';
                    colTools.style.display = secId === 'tools' ? 'flex' : 'none';
                } else {
                    colPrefs.style.display = 'flex';
                    colMatches.style.display = 'flex';
                    colTools.style.display = 'flex';
                }
            }
        },
        setEqSection: function(secId) {
            this.activeEqSection = secId;
            this.updateMobileSectionLabel('eq', secId);

            ['db', 'graph', 'console'].forEach(id => {
                const pill = document.getElementById('m-eq-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colDb = document.getElementById('eq-col-db');
            const colGraph = document.getElementById('eq-col-graph');
            const colConsole = document.getElementById('eq-col-console');

            if (colDb && colGraph && colConsole) {
                if (window.innerWidth < 1280) {
                    colDb.style.display = secId === 'db' ? 'flex' : 'none';
                    colGraph.style.display = secId === 'graph' ? 'flex' : 'none';
                    colConsole.style.display = secId === 'console' ? 'flex' : 'none';

                    if (secId === 'graph' && window.EQ && EQ.drawCurve) {
                        setTimeout(() => {
                            EQ.drawCurve();
                        }, 50);
                    }
                } else {

                    colDb.style.display = '';
                    colGraph.style.display = '';
                    colConsole.style.display = '';
                }
            }
        },

        activeTestLabSection: 'sweeps',

        mobileSectionConfig: {
            iem: { order: ['specs', 'radar', 'sliders'], labels: { specs: '📋 Specs', radar: '📊 Chart', sliders: '🎚️ Sliders' }, current: 'activeReviewSection', setter: 'setReviewSection' },
            find: { order: ['prefs', 'matches', 'tools'], labels: { prefs: '🎯 Tuning', matches: '🔍 Matches', tools: '🛠️ Tools' }, current: 'activeFindSection', setter: 'setFindSection' },
            eq: { order: ['db', 'graph', 'console'], labels: { db: '🎯 Targets', graph: '📈 Graph', console: '🎛️ Console' }, current: 'activeEqSection', setter: 'setEqSection' },
            testlab: { order: ['sweeps', 'spatial', 'generators'], labels: { sweeps: '📡 Signals', spatial: '🔊 Soundstage', generators: '🎵 Generators' }, current: 'activeTestLabSection', setter: 'setTestLabSection' }
        },
        cycleMobileSection: function(paneKey, direction) {
            const cfg = this.mobileSectionConfig[paneKey];
            if (!cfg) return;
            const curId = this[cfg.current] || cfg.order[0];
            let idx = cfg.order.indexOf(curId);
            idx = (idx + direction + cfg.order.length) % cfg.order.length;
            const nextId = cfg.order[idx];
            this[cfg.setter](nextId);
            this.updateMobileSectionLabel(paneKey, nextId);
        },
        updateMobileSectionLabel: function(paneKey, secId) {
            const cfg = this.mobileSectionConfig[paneKey];
            if (!cfg) return;
            const labelEl = document.getElementById(paneKey + '-mobile-section-label');
            if (labelEl) labelEl.textContent = cfg.labels[secId] || secId;
        },
        toggleDiagnosticSweepsMobile: function() {
            const grid = document.getElementById('diagnostic-sweeps-grid');
            const arrow = document.getElementById('diagnostic-sweeps-mobile-arrow');
            if (!grid) return;
            const isHidden = grid.classList.contains('hidden');
            grid.classList.toggle('hidden', !isHidden);
            grid.classList.toggle('grid', isHidden);
            if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
        },

        setTestLabSection: function(secId) {
            this.activeTestLabSection = secId;
            this.updateMobileSectionLabel('testlab', secId);

            ['sweeps', 'spatial', 'generators'].forEach(id => {
                const pill = document.getElementById('m-testlab-' + id);
                if (pill) {
                    if (id === secId) pill.classList.add('active');
                    else pill.classList.remove('active');
                }
            });

            const colSweeps = document.getElementById('testlab-col-sweeps');
            const colSpatial = document.getElementById('testlab-col-spatial');
            const colGenerators = document.getElementById('testlab-col-generators');

            if (colSweeps && colSpatial && colGenerators) {
                if (window.innerWidth < 1280) {
                    colSweeps.style.display = secId === 'sweeps' ? 'flex' : 'none';
                    colSpatial.style.display = secId === 'spatial' ? 'flex' : 'none';
                    colGenerators.style.display = secId === 'generators' ? 'flex' : 'none';
                } else {
                    colSweeps.style.display = '';
                    colSpatial.style.display = '';
                    colGenerators.style.display = '';
                }
            }
        },

        priceSpinActive: false,
        triggerPriceSlotMachine: function() {
            if (this.priceSpinActive) return;
            const input = document.getElementById('price');
            if (!input) return;

            const val = input.value.trim();

            const secretMap = {
                '9999': "Priceless 👑",
                '115': "Brains... 🧟",
                '69': "Nice... 😏",
                '808': "BASS... 🥁",
                '777': "Lucy 🍀",
                '8008': "LOL 😂",
                '800': "Boo... 👻",
                '404': "Not Found ⚠️",
                '999': "Run... 👹",
                '42': "The Answer 🌌",
                '5151': "LOCO 🤪",
                '935': "Element 115 🧪",
                '420': "Blaze It 🌿",
                '100': "Keep It 💯",
                '101': "Knowledge 🔓"
            };

            if (!secretMap.hasOwnProperty(val)) {

                const label = document.getElementById('price-label');
                if (label) {
                    label.classList.add('text-amber-500');
                    setTimeout(() => label.classList.remove('text-amber-500'), 400);
                }
                return;
            }

            this.priceSpinActive = true;
            let elapsed = 0;
            const finalWord = secretMap[val];

            const ctx = SharedAudio.init();
            if (ctx) ctx.resume();

            const spinInterval = setInterval(() => {
                elapsed += 50;

                let scramble = "";
                const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$@!%&";
                for (let i = 0; i < finalWord.length; i++) {
                    scramble += glyphs[Math.floor(Math.random() * glyphs.length)];
                }
                input.value = scramble;

                try {
                    if (ctx) {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(1000 + Math.random() * 600, ctx.currentTime);
                        gain.gain.setValueAtTime(0.015, ctx.currentTime);
                        osc.connect(gain).connect(ctx.destination);
                        osc.start();
                        osc.stop(ctx.currentTime + 0.02);
                    }
                } catch(e) {}

                if (elapsed >= 1500) {
                    clearInterval(spinInterval);
                    input.value = finalWord;
                    this.priceSpinActive = false;

                    try {
                        if (ctx) {
                            const now = ctx.currentTime;

                            const osc1 = ctx.createOscillator();
                            const gain1 = ctx.createGain();
                            osc1.type = 'square';
                            osc1.frequency.setValueAtTime(987.77, now);
                            gain1.gain.setValueAtTime(0, now);
                            gain1.gain.linearRampToValueAtTime(0.03, now + 0.005);
                            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                            osc1.connect(gain1).connect(ctx.destination);
                            osc1.start(now);
                            osc1.stop(now + 0.08);

                            const osc2 = ctx.createOscillator();
                            const gain2 = ctx.createGain();
                            osc2.type = 'square';
                            osc2.frequency.setValueAtTime(1318.51, now + 0.08);
                            gain2.gain.setValueAtTime(0, now + 0.08);
                            gain2.gain.linearRampToValueAtTime(0.03, now + 0.085);
                            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                            osc2.connect(gain2).connect(ctx.destination);
                            osc2.start(now + 0.08);
                            osc2.stop(now + 0.35);
                        }
                    } catch(e) {}

                    showToast(`Secret Unlocked: ${finalWord}! 🎰`, "🪙");
                }
            }, 50);
        },

        tbSequence: [],
        tbClick: function(step) {
            this.tbSequence.push(step);
            if (this.tbSequence.length > 3) this.tbSequence.shift();

            if (this.tbSequence.join('-') === '1-2-3') {
                this.tbSequence = [];
                this.triggerTeddyBearMelody();
            }
        },
        triggerTeddyBearMelody: function() {
                        try {
                            const ctx = SharedAudio.init();
                            if (ctx) {
                                ctx.resume();
                                const now = ctx.currentTime;

                                const notes = [146.83, 155.56, 146.83, 110.00];
                                notes.forEach((freq, idx) => {
                                    const osc = ctx.createOscillator();
                                    const gain = ctx.createGain();

                                    osc.type = 'sawtooth';

                                    const filter = ctx.createBiquadFilter();
                                    filter.type = 'lowpass';
                                    filter.frequency.value = 400;

                                    osc.frequency.setValueAtTime(freq, now + idx * 0.45);

                                    gain.gain.setValueAtTime(0, now + idx * 0.45);
                                    gain.gain.linearRampToValueAtTime(0.06, now + idx * 0.45 + 0.05);
                                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.45 + 0.45);

                                    osc.connect(filter).connect(gain).connect(ctx.destination);
                                    osc.start(now + idx * 0.45);
                                    osc.stop(now + idx * 0.45 + 0.45);
                                });
                            }
                        } catch(e) {}
                        showToast("Spooky Vibes Unlocked.", "👻");
                    },

        rippleEffect: function(event, button) {
            try {
                if (!button) return;
                button.style.position = 'relative';

                const circle = document.createElement('span');
                const diameter = Math.max(button.clientWidth, button.clientHeight);
                const radius = diameter / 2;

                circle.style.width = circle.style.height = `${diameter}px`;

                const rect = button.getBoundingClientRect();
                circle.style.left = `${event.clientX - rect.left - radius}px`;
                circle.style.top = `${event.clientY - rect.top - radius}px`;
                circle.style.position = 'absolute';
                circle.style.pointerEvents = 'none';
                circle.classList.add('ripple');

                const existing = button.getElementsByClassName('ripple')[0];
                if (existing) {
                    existing.remove();
                }

                button.appendChild(circle);

                setTimeout(() => {
                    circle.remove();
                }, 500);
            } catch (error) {
                console.error("Ripple animation failed:", error);
            }
        },

                triggerMushroomEgg: function(el) {
            if (el.classList.contains('mushroom-pop-active')) return;

            window.mushroomSporesActive = !window.mushroomSporesActive;

            el.classList.add('mushroom-pop-active');
            setTimeout(() => {
                el.classList.remove('mushroom-pop-active');
                if (window.mushroomSporesActive) {
                    el.classList.add('mushroom-enabled');
                } else {
                    el.classList.remove('mushroom-enabled');
                }
            }, 500);

            const listenerIcon = document.getElementById('spatial-listener-icon');
            if (listenerIcon) {
                listenerIcon.textContent = window.mushroomSporesActive ? "🍄" : "🎧";
            }

            if (window.mushroomHueInterval) {
                clearInterval(window.mushroomHueInterval);
                window.mushroomHueInterval = null;
            }
            if (window.mushroomSporesActive) {
                Mascot.triggerTemporaryExpression('imbalance', 3000);
                var mascotEl = document.getElementById('brand-icon-emoji');
                if (mascotEl) {
                    mascotEl.style.filter = 'hue-rotate(0deg)';
                    window.mushroomHueInterval = setInterval(function() {
                        if (!window.mushroomSporesActive) {
                            clearInterval(window.mushroomHueInterval);
                            window.mushroomHueInterval = null;
                            mascotEl.style.filter = '';
                            return;
                        }
                        var hue = (Date.now() / 20) % 360;
                        mascotEl.style.filter = 'hue-rotate(' + hue + 'deg) brightness(1.3)';
                    }, 50);
                }
            } else {
                var mascotEl = document.getElementById('brand-icon-emoji');
                if (mascotEl) {
                    mascotEl.style.filter = '';
                }
            }

            try {
                const ctx = SharedAudio.init();
                if (ctx) {
                    ctx.resume();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(220, ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1440, ctx.currentTime + 0.45);
                    gain.gain.setValueAtTime(0.06, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.45);
                }
            } catch(e) {}

            if (window.mushroomSporesActive) {
                showToast("Spores Activated!", "✔️");
                this.runGlobalSporesLoop();
            } else {
                showToast("Spores Deactivated.", "❌");
            }
        },

        runGlobalSporesLoop: function() {

            if (this._sporesLoopStarted) return;
            this._sporesLoopStarted = true;

            const canvas = document.getElementById('global-spores-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            const resizeCanvas = () => {
                if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                }
            };
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            const particles = [];
            const maxParticles = 65;

            const createParticle = () => {
                return {
                    x: Math.random() * canvas.width,
                    y: canvas.height + Math.random() * 80,
                    size: Math.random() * 2.5 + 0.8,
                    speedY: Math.random() * -0.7 - 0.3,
                    wobble: Math.random() * Math.PI,
                    wobbleSpeed: Math.random() * 0.02 + 0.01,
                    alpha: Math.random() * 0.4 + 0.3
                };
            };

            const draw = () => {
                if (!window.mushroomSporesActive) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    canvas.style.display = 'none';
                    return;
                }

                canvas.style.display = 'block';
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                const activeThemeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                const themeAccent = activeThemeConfig.accent || "#787878";

                while (particles.length < maxParticles) {
                    particles.push(createParticle());
                }

                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    p.y += p.speedY;
                    p.wobble += p.wobbleSpeed;
                    const px = p.x + Math.sin(p.wobble) * 20;

                    ctx.save();
                    ctx.fillStyle = themeAccent;
                    ctx.globalAlpha = p.alpha;
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = themeAccent;
                    ctx.beginPath();
                    ctx.arc(px, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();

                    if (p.y < -10) {
                        p.y = canvas.height + 10;
                        p.x = Math.random() * canvas.width;
                        p.speedY = Math.random() * -0.7 - 0.3;
                        p.alpha = 0.3 + Math.random() * 0.7;
                        p.size = Math.random() * 2.5 + 0.8;
                        p.wobble = Math.random() * Math.PI * 2;
                    }
                }

                requestAnimationFrame(draw);
            };
            draw();
        },
        resetAllInputsOnLoad: function() {
            try {
                if (window.PEQDB && PEQDB.STATE) {
                    PEQDB.STATE.activeCurves = [];
                    PEQDB.targetMode = '';
                }

                document.querySelectorAll('input:not([type="file"]):not([type="range"]):not([type="checkbox"]), select, textarea').forEach(el => {
                    el.value = el.defaultValue || '';
                });

                document.querySelectorAll('input[type="range"]').forEach(el => {
                    const defaultVal = el.getAttribute('value');
                    if (defaultVal !== null) {
                        el.value = defaultVal;
                    } else {
                        const min = parseFloat(el.min || 0);
                        const max = parseFloat(el.max || 100);
                        el.value = (min + max) / 2;
                    }
                });

                document.querySelectorAll('input[type="checkbox"]').forEach(el => {
                    el.checked = el.defaultChecked || false;
                });
            } catch (error) {
                console.error("Autofill reset failed:", error);
            }
        },
        initGlobalSliders: function() {
            try {
                // Skip identical background rewrites: the playback rAF ticker and
                // drag input events otherwise rebuild + reassign the same gradient
                // string hundreds of times per second, forcing needless style
                // recalcs that show up as drag jank.
                const trackFillCache = new WeakMap();
                const setTrackBg = (el, bg) => {
                    if (trackFillCache.get(el) === bg) return;
                    trackFillCache.set(el, bg);
                    el.style.background = bg;
                };
                const updateTrack = (el) => {
                    const val = parseFloat(el.value);
                    const min = parseFloat(el.min || 0);
                    const max = parseFloat(el.max || 100);

                    if (el.classList.contains('dual-range')) return;

                    if (el.classList.contains('iem-slider') && min === -10 && max === 10) {
                        if (val >= 0) {
                            const activePercent = (val / 10) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff 50%, var(--accent-blue) 50%, var(--accent-blue) ${50 + activePercent}%, #ffffff ${50 + activePercent}%, #ffffff 100%)`);
                        } else {
                            const activePercent = (Math.abs(val) / 10) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff ${50 - activePercent}%, var(--accent-red) ${50 - activePercent}%, var(--accent-red) 50%, #ffffff 50%, #ffffff 100%)`);
                        }
                    } else if (el.classList.contains('eq-slider-vertical')) {
                        if (val >= 0) {
                            const activePercent = (val / 12) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff 50%, var(--accent-blue) 50%, var(--accent-blue) ${50 + activePercent}%, #ffffff ${50 + activePercent}%, #ffffff 100%)`);
                        } else {
                            const activePercent = (Math.abs(val) / 12) * 50;
                            setTrackBg(el, `linear-gradient(90deg, #ffffff 0%, #ffffff ${50 - activePercent}%, var(--accent-red) ${50 - activePercent}%, var(--accent-red) 50%, #ffffff 50%, #ffffff 100%)`);
                        }
                    } else {
                        const percent = ((val - min) / (max - min)) * 100;
                        setTrackBg(el, `linear-gradient(90deg, var(--accent-blue) ${percent}%, #ffffff ${percent}%)`);
                    }
                };

                // Shared painter for high-frequency callers (scrub timeupdate /
                // drag input) so they restyle ONE element instead of running a
                // full-page syncGlobalSliders pass on every mousemove frame.
                window.paintSliderTrack = updateTrack;

                const applyMagneticSnapping = (input) => {
                    let val = parseFloat(input.value);
                    const id = input.id;

                    if (id.startsWith('eq-s') || id.startsWith('eq-a') || id === 'eq-preampSlider' || id === 'comp-gain-slider') {
                        const threshold = 0.45;
                        let snapThreshold = threshold;
                        if (id === 'comp-gain-slider') snapThreshold = 3.0;

                        if (Math.abs(val) <= snapThreshold) {
                            input.value = "0.0";
                        }
                    }

                    if (id.startsWith('eq-q_')) {
                        if (Math.abs(val - 1.0) <= 0.12) {
                            input.value = "1.0";
                        }
                    }

                    if (id === 'a11y-balance-slider') {
                        if (Math.abs(val) <= 12.0) {
                            input.value = "0";
                        }
                    }

                    if (id === 'ab-crossfade') {
                        if (Math.abs(val - 0.5) <= 0.05) {
                            input.value = "0.5";
                        }
                    }

                    if (id === 'eq-musicVolumeSlider' || id === 'modal-volume-slider') {
                        if (Math.abs(val - 50) <= 5.0) {
                            input.value = "50";
                        }
                    }
                };

                document.querySelectorAll('input[type="range"]').forEach(input => {
                    updateTrack(input);

                    input.addEventListener('input', () => {
                        applyMagneticSnapping(input);
                        updateTrack(input);
                    });

                    input.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const step = parseFloat(input.step) || 1.0;
                        const direction = e.deltaY < 0 ? 1 : -1;
                        let val = parseFloat(input.value) || 0;

                        let newVal = val + (direction * step);
                        const min = parseFloat(input.min !== "" ? input.min : 0);
                        const max = parseFloat(input.max !== "" ? input.max : 100);
                        newVal = Math.max(min, Math.min(max, newVal));

                        input.value = newVal;
                        applyMagneticSnapping(input);
                        updateTrack(input);

                        input.dispatchEvent(new Event('input'));
                        input.dispatchEvent(new Event('change'));
                    }, { passive: false });
                });

                window.syncGlobalSliders = () => {
                    document.querySelectorAll('input[type="range"]').forEach(input => {
                        input.lastDragVal = parseFloat(input.value) || 0;
                        updateTrack(input);
                    });
                };
            } catch (error) {
                console.error("Slider initialization failed:", error);
            }
        },
        initDragAndDrop: function() {
            const preventDefaults = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            const addDragStyles = (el) => {
                el.style.borderColor = 'var(--accent-blue)';
                el.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            };

            const removeDragStyles = (el) => {
                el.style.borderColor = '';
                el.style.backgroundColor = '';
            };

            const dockLabel = document.getElementById('eq-file-label');
            const eqFileInput = document.getElementById('eq-file');
            if (dockLabel && eqFileInput) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, () => dockLabel.style.transform = 'scale(1.15)', false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    dockLabel.addEventListener(evtName, () => dockLabel.style.transform = '', false);
                });
                dockLabel.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        eqFileInput.files = files;
                        eqFileInput.dispatchEvent(new Event('change'));
                    }
                }, false);
            }

            const zoneA = document.getElementById('ab-drop-zone-a');
            const fileA = document.getElementById('ab-file-a');
            const labelA = document.getElementById('ab-file-label-a');
            if (zoneA && fileA) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    zoneA.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    zoneA.addEventListener(evtName, () => {
                        addDragStyles(zoneA);
                        if (labelA) labelA.style.transform = 'scale(1.15)';
                    }, false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    zoneA.addEventListener(evtName, () => {
                        removeDragStyles(zoneA);
                        if (labelA) labelA.style.transform = '';
                    }, false);
                });
                zoneA.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        fileA.files = files;
                        fileA.dispatchEvent(new Event('change'));
                    }
                }, false);
            }

            const zoneB = document.getElementById('ab-drop-zone-b');
            const fileB = document.getElementById('ab-file-b');
            const labelB = document.getElementById('ab-file-label-b');
            if (zoneB && fileB) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
                    zoneB.addEventListener(evtName, preventDefaults, false);
                });
                ['dragenter', 'dragover'].forEach(evtName => {
                    zoneB.addEventListener(evtName, () => {
                        addDragStyles(zoneB);
                        if (labelB) labelB.style.transform = 'scale(1.15)';
                    }, false);
                });
                ['dragleave', 'drop'].forEach(evtName => {
                    zoneB.addEventListener(evtName, () => {
                        removeDragStyles(zoneB);
                        if (labelB) labelB.style.transform = '';
                    }, false);
                });
                zoneB.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files && files.length > 0) {
                        fileB.files = files;
                        fileB.dispatchEvent(new Event('change'));
                    }
                }, false);
            }
        },
        restoreSavedSettings: function() {
            if (this.settingsRestored) return;
            this.settingsRestored = true;

            try {
                const savedTheme = localStorage.getItem('settings_theme_id') || 'slate';
                this.setGlobalTheme(this.themeMap[savedTheme] ? savedTheme : 'slate');

                const savedFont = localStorage.getItem('settings_font_id') || 'Silkscreen';
                this.setGlobalFont(this.fontMap[savedFont] ? savedFont : 'Silkscreen');

                const savedScale = localStorage.getItem('settings_reading_scale') || '1.00';
                const sizeSlider = document.getElementById('reading-size-slider');
                if (sizeSlider) sizeSlider.value = savedScale;
                this.setReadingSize(savedScale);

            } catch(e) {
                console.error("Autosave load failed:", e);
            }

            try {
                const savedAlignHz = localStorage.getItem('settings_align_hz');
                const savedAlignDb = localStorage.getItem('settings_align_db');
                if (savedAlignHz !== null && window.PEQDB) {
                    PEQDB.setAlignHz(savedAlignHz);
                }
                if (savedAlignDb !== null && window.PEQDB) {
                    PEQDB.setAlignDb(parseFloat(savedAlignDb));
                }
            } catch (error) {
                console.error("Settings alignment load failed:", error);
            }
        },
        init: function() {
            try {
                window.App = App; window.IEM = IEM_Module; window.EQ = EQ_Module; window.Tone = Tone_Module; window.TestLab = TestLab_Module; window.PEQDB = PEQDB_Module;

                ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel'].forEach(evt => {
                    window.addEventListener(evt, () => {
                        if (window.Mascot && Mascot.handleUserActivity) {
                            Mascot.handleUserActivity();
                        }
                    }, { passive: true });
                });

                document.addEventListener('touchstart', function() {
                    if (window.SharedAudio && SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume();
                    }
                }, { once: true, passive: true });

                setInterval(() => {
                    if (document.visibilityState !== 'visible') return;
                    if (window.Mascot && window.EQ && !EQ.vizLoopRunning) {
                        Mascot.update();
                    }
                }, 1000);

                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        document.body.style.setProperty('--animation-speed-fast', '0s');
                        document.body.style.setProperty('--animation-speed-normal', '0s');
                    } else {
                        document.body.style.setProperty('--animation-speed-fast', '0.15s');
                        document.body.style.setProperty('--animation-speed-normal', '0.3s');
                    }
                });

                this.resetAllInputsOnLoad();

                this.renderThemeToggles();
                this.switchTab('find');
                this.initGlobalSliders();
                this.initDragAndDrop();

                document.addEventListener('click', (e) => {
                    const btn = e.target.closest('.btn-playback-reactive, .category-pill, button, .tag, label.btn-label');
                    if (btn) {
                        App.rippleEffect(e, btn);
                    }

                    if (window.EQ && !EQ.graphBuilt) {
                        EQ.ensureDSPGraph().catch(err => console.log("DSP boot delayed: ", err));
                    } else if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        SharedAudio.ctx.resume();
                    }
                });

                const brandMushroom = document.querySelector('.sidebar-label span');
                if (brandMushroom) {
                    brandMushroom.className = "cursor-pointer inline-block ml-1 hover:brightness-125 select-none transition-all duration-300 rounded-full px-1";
                    brandMushroom.addEventListener('mouseenter', () => {
                        brandMushroom.style.textShadow = '0 0 10px var(--accent-blue)';
                        brandMushroom.style.transform = 'scale(1.1)';
                    });
                    brandMushroom.addEventListener('mouseleave', () => {
                        brandMushroom.style.textShadow = 'none';
                        brandMushroom.style.transform = 'none';
                    });
                }

                let resizeTimeout;
                window.addEventListener('resize', () => {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(() => {
                        if (window.EQ && EQ.drawCurve) {
                            EQ.drawCurve();
                        }
                        if (window.IEM && IEM.renderImagePreview) {
                            IEM.renderImagePreview();
                        }
                    }, 150);
                });

                window.addEventListener('dragover', (e) => {
                    e.preventDefault();
                });
                window.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file && file.name.toLowerCase().endsWith('.json')) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            try {
                                let rawText = reader.result;
                                rawText = rawText.replace(/^\uFEFF/, '').trim();

                                const data = JSON.parse(rawText);
                                if (data && typeof data === 'object') {
                                    IEM_Module.loadProfileData(data);
                                    const label = (data.brand || data.model) ? `${data.brand || ''} ${data.model || ''}` : "Blank Profile";
                                    showToast(`Loaded ${label.trim()} successfully!`, "📥");
                                } else {
                                    showToast("Invalid JSON profile structure.", "⚠️");
                                }
                            } catch (err) {
                                console.error("Drop import parsing crash:", err);
                                showToast("Failed to parse imported file.", "⚠️");
                            }
                        };
                        reader.readAsText(file);
                    }
                });
            } catch (error) {
                console.error("Application boot failed:", error);
            }
        }
    };

    App._defaultThemeEntry = function() {
        const g = this.builtInThemes.find(t => t.id === 'slate');
        return g ? { name: g.name, emoji: g.emoji, accent: g.variables['--accent-blue'], variables: g.variables } : null;
    };
    App.builtInThemes.forEach(theme => {
        App.themeMap[theme.id] = {
            name: theme.name,
            emoji: theme.emoji,
            variables: theme.variables,
            accent: theme.variables['--accent-blue']
        };
    });

    (function applySavedThemeImmediately() {
        try {
            const savedId = localStorage.getItem('settings_theme_id') || 'slate';
            const theme = App.builtInThemes.find(t => t.id === savedId);
            if (theme) {
                document.documentElement.className = 'theme-' + savedId;
                Object.entries(theme.variables).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
            }
        } catch (e) {  }
    })();

    const IEM_Module = {
        radarChart: null, selectedTags: new Set(), selectedGenres: new Set(), selectedBass: new Set(), currentImage: null, sliderNodes: [],
        selectedDriverTypes: {},
        exportTheme: null,
        exportFont: null,
        // (dead duplicate `exportGrade: null` removed — live default is
        // `exportGrade: 'A'` further down, next to exportColor)
        sensUnit: 'mW',
        activeLeftTab: 'search',
        activeRightTab: 'sound',

        leftTabModes: [
            { id: 'search', label: 'Search', emoji: '🔍' },
            { id: 'info', label: 'Info', emoji: '📝' },
            { id: 'drivers', label: 'Drivers', emoji: '⚙️' },
            { id: 'power', label: 'Power', emoji: '⚡' }
        ],
        cycleLeftTab: function(dir) {
            const currentIdx = this.leftTabModes.findIndex(m => m.id === this.activeLeftTab);
            const total = this.leftTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchLeftTab(this.leftTabModes[nextIdx].id);
        },
        switchLeftTab: function(tabId) {
            this.activeLeftTab = tabId;
            ['search', 'info', 'drivers', 'power'].forEach(id => {
                const panel = document.getElementById('iem-left-panel-' + id);
                const btn = document.getElementById('iem-left-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            const stepperLabel = document.getElementById('iem-left-tab-stepper-label');
            if (stepperLabel) {
                const info = this.leftTabModes.find(m => m.id === tabId) || this.leftTabModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }
        },

        rightTabModes: [
            { id: 'sound', label: 'Sound', emoji: '🎚️' },
            { id: 'photo', label: 'Photo', emoji: '📷' },
            { id: 'impressions', label: 'Notes', emoji: '📝' }
        ],
        cycleRightTab: function(dir) {
            const currentIdx = this.rightTabModes.findIndex(m => m.id === this.activeRightTab);
            const total = this.rightTabModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchRightTab(this.rightTabModes[nextIdx].id);
        },
        switchRightTab: function(tabId) {
            this.activeRightTab = tabId;
            ['sound', 'photo', 'impressions'].forEach(id => {
                const panel = document.getElementById('iem-right-panel-' + id);
                const btn = document.getElementById('iem-right-tab-' + id);
                if (panel) {
                    if (id === tabId) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
                if (btn) {
                    if (id === tabId) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });

            const stepperLabel = document.getElementById('iem-right-tab-stepper-label');
            if (stepperLabel) {
                const info = this.rightTabModes.find(m => m.id === tabId) || this.rightTabModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }

            if (tabId === 'photo' && this.renderImagePreview) {
                setTimeout(() => this.renderImagePreview(), 50);
            }
            if (tabId === 'impressions') {
                this.renderReviewSelectedTags();
            }
        },

        toggleSensUnit: function() {
            this.sensUnit = this.sensUnit === 'mW' ? 'V' : 'mW';
            this.updateSensUnitUI();
            this.updateAll();
        },
        updateSensUnitUI: function() {
            const toggleBtn = document.getElementById('sens-unit-toggle');
            if (toggleBtn) {
                if (this.sensUnit === 'V') {
                    toggleBtn.textContent = '(dB/V)';
                    toggleBtn.style.color = '#d946ef';
                    toggleBtn.style.textShadow = '0 0 8px rgba(217, 70, 239, 0.6)';
                } else {
                    toggleBtn.textContent = '(dB/mW)';
                    toggleBtn.style.color = '#06b6d4';
                    toggleBtn.style.textShadow = '0 0 8px rgba(6, 182, 212, 0.6)';
                }
            }
        },
        updateExportButtonState: function() {
            const btn = document.getElementById('export-confirm-btn');
            if (!btn) return;
            const isValid = this.exportGrade && this.exportTheme && this.exportFont;
            if (isValid) {
                btn.disabled = false;
                btn.className = "w-full py-2 bg-[var(--accent-blue)] text-white hover:brightness-110 font-bold rounded-md text-xs shadow-lg transition-all text-center mb-3 cursor-pointer";
                btn.style.opacity = "1";
            } else {
                btn.disabled = true;
                btn.className = "w-full py-2 bg-zinc-800 text-zinc-500 font-bold rounded-md text-xs transition-all text-center mb-3 cursor-not-allowed";
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

        cycleExportGrade: function(dir) {
            const total = this.exportGradesList.length;
            this.currentExportGradeIdx = (this.currentExportGradeIdx + dir + total) % total;
            const grade = this.exportGradesList[this.currentExportGradeIdx];
            this.selectExportGrade(grade);
            const btn = document.getElementById('export-grade-cycle-btn');
            if (btn) btn.textContent = `🏅 Grade Badge: ${grade}`;
        },

        cycleExportThemeDirection: function(dir) {
            const themes = ['slate', 'bit', 'byte', 'blush', 'arcade', 'circuit', 'cartridge', 'ember', 'parchment'];
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

        cycleExportTheme: function() {
            this.cycleExportThemeDirection(1);
        },
        cycleExportFont: function() {
            this.cycleExportFontDirection(1);
        },
        cycleListeningVolume: function() {
            const list = ['moderate', 'low', 'high', 'variable'];
            const curVal = document.getElementById('listening-volume').value || 'moderate';
            let curIdx = list.indexOf(curVal);
            if (curIdx === -1) curIdx = 0;
            const nextIdx = (curIdx + 1) % list.length;
            this.setListeningVolume(list[nextIdx]);
        },
        setListeningVolume: function(val) {
            const input = document.getElementById('listening-volume');
            if (input) input.value = val;

            const btn = document.getElementById('listening-volume-btn');
            if (btn) {
                const labelMap = { moderate: 'Normal', low: 'Quiet', high: 'Loud', variable: 'Variable' };
                btn.textContent = labelMap[val] || 'Normal';
            }
            this.updateAll();
        },
        formFactorOptions: ['IEM', 'Earbuds (Wired)', 'Wireless Earbuds (TWS)', 'Over-Ear Headphones (Wired)', 'Wireless Over-Ear Headphones'],
        connectorOptions: ['2-pin', 'MMCX', 'QDC', 'A2DC', 'Fixed Cable', 'Detachable Cable', 'Bluetooth', 'Electrostatic'],
        cycleFormFactor: function(dir) {
            this.formFactor = this.formFactor || 'IEM';
            let idx = this.formFactorOptions.indexOf(this.formFactor);
            if (idx === -1) idx = 0;
            idx = (idx + dir + this.formFactorOptions.length) % this.formFactorOptions.length;
            this.setFormFactor(this.formFactorOptions[idx]);
        },
        cycleConnector: function(dir) {
            this.connector = this.connector || '2-pin';
            let idx = this.connectorOptions.indexOf(this.connector);
            if (idx === -1) idx = 0;
            idx = (idx + dir + this.connectorOptions.length) % this.connectorOptions.length;
            this.setConnector(this.connectorOptions[idx]);
        },
        setFormFactor: function(val) {
            this.formFactor = val;
            const hidden = document.getElementById('iem-formfactor');
            if (hidden) hidden.value = val || '';
            const label = document.getElementById('iem-formfactor-label');
            if (label) {
                const shortNames = {
                    'IEM': 'IEM',
                    'Earbuds (Wired)': 'EARBUDS',
                    'Wireless Earbuds (TWS)': 'TWS',
                    'Over-Ear Headphones (Wired)': 'HEADPHONES',
                    'Wireless Over-Ear Headphones': 'WIRELESS HEADPHONES'
                };
                const show = shortNames[val] || val || 'IEM';
                const emoji = (FindEngine && FindEngine.formFactorEmojis[val]) ? FindEngine.formFactorEmojis[val] : '<img src="app/icons/iem.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">';
                label.innerHTML = `<span class="flex items-center justify-center gap-2 truncate" title="${esc(val || '')}">${emoji}<span class="truncate text-[10.5px] tracking-wide">${esc(show)}</span></span>`;
            }
        },
        setConnector: function(val) {
            this.connector = val;
            const hidden = document.getElementById('iem-connector');
            if (hidden) hidden.value = val || '';
            const label = document.getElementById('iem-connector-label');
            if (label) {
                const emoji = (FindEngine && FindEngine.connectorEmojis[val]) ? FindEngine.connectorEmojis[val] : (val ? '🔌' : '❓');
                label.innerHTML = `<span class="flex items-center justify-center gap-1.5 truncate">${emoji}<span class="truncate">${esc(val || 'Unknown')}</span></span>`;
            }
        },
        _iemDbSearchTimer: null,
        _iemDbFileIdx: {},
        _iemDbActiveId: null,
        getIemDatabase: function() {
            try {
                if (typeof CurveIndexer !== 'undefined' && Array.isArray(CurveIndexer.catalog) && CurveIndexer.catalog.length > 0) {
                    return CurveIndexer.catalog;
                }
            } catch (e) {}
            if (typeof FindEngine !== 'undefined' && Array.isArray(FindEngine.iemDatabase)) {
                return FindEngine.iemDatabase;
            }
            if (typeof PEQDB_Module !== 'undefined' && Array.isArray(PEQDB_Module.STATE.dataset)) {
                return PEQDB_Module.STATE.dataset;
            }
            return [];
        },
onDbSearchInput: function(value) {
            clearTimeout(this._iemDbSearchTimer);
            this._iemDbSearchTimer = setTimeout(() => this.renderIemDbSearch(value), 140);
        },
        _initIemSearchIndex: function() {
            if (this._iemSearchIndexInitialized) return;
            const db = this.getIemDatabase();
            if (db && db.length > 0 && window.IemSearchIndex) {
                window.IemSearchIndex.init(db);
                this._iemSearchIndexInitialized = true;
            }
        },
        renderIemDbSearch: function(query) {
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            this._initIemSearchIndex();
            const db = this.getIemDatabase();
            const q = (query || '').trim().toLowerCase();
            const countEl = document.getElementById('iem-db-result-count');

            if (db.length === 0 && !q) {
                list.innerHTML = '<div class="text-zinc-600 text-xs italic text-center mt-6">Database still loading…</div>';
                if (countEl) countEl.textContent = '0';
                if (!this._iemDbSearchRetry) {
                    this._iemDbSearchRetry = true;
                    setTimeout(() => { this._iemDbSearchRetry = false; this.renderIemDbSearch(''); }, 900);
                }
                return;
            }

            let matches = [];
            if (!q) {
                matches = db;
            } else {
                matches = window.IemSearchIndex ? window.IemSearchIndex.search(q) : [];
            }

            if (matches.length === 0) {
                list.innerHTML = '<div class="text-zinc-600 text-xs italic text-center mt-6">No database entry matched.</div>';
                if (countEl) countEl.textContent = '0';
                return;
            }

            if (countEl) countEl.textContent = matches.length;

            if (!this._iemDbExpandedBrands) this._iemDbExpandedBrands = new Set();
            if (!this._iemBrandCache) this._iemBrandCache = {};

            list.innerHTML = '';
            const escSafe = (str) => esc(str || '');

            const brandBuckets = new Map();
            matches.forEach(item => {
                const brand = item.brand || 'Unknown Brand';
                if (!brandBuckets.has(brand)) brandBuckets.set(brand, []);
                brandBuckets.get(brand).push(item);
            });
            this._iemBrandCache = {};
            brandBuckets.forEach((items, brand) => { this._iemBrandCache[brand] = items; });
            const sortedBrands = Array.from(brandBuckets.keys()).sort((a, b) => a.localeCompare(b));

            for (const brandName of sortedBrands) {
                const items = brandBuckets.get(brandName);
                const isExpanded = this._iemDbExpandedBrands.has(brandName);
                const groupEl = document.createElement('div');
                groupEl.className = 'mb-1.5 w-full min-w-0 flex flex-col';
                groupEl.setAttribute('data-iem-brand', brandName);
                groupEl.setAttribute('data-letter', alphaKeyOf({ brand: brandName }));
                groupEl.innerHTML = `
                    <div class="flex items-center justify-between p-2 cursor-pointer select-none border-2 border-black rounded flex-shrink-0 w-full min-w-0" style="background: var(--bg-input);" onclick="IEM.toggleIemDbBrand('${escJs(brandName)}')">
                        <span class="text-xs font-black uppercase tracking-wider text-[var(--accent-blue)] truncate min-w-0">${escSafe(brandName)}</span>
                        <span class="flex items-center gap-1.5 flex-shrink-0">
                            <span class="text-[9px] font-black text-zinc-500">${items.length}</span>
                            <span class="brand-group-arrow text-[10px] font-black text-[var(--text-secondary)] transition-transform duration-200">${isExpanded ? '▲' : '▼'}</span>
                        </span>
                    </div>
                `;
                const itemsContainer = document.createElement('div');
                itemsContainer.className = `brand-items-container w-full min-w-0 pl-2 pt-1.5 ${isExpanded ? '' : 'hidden'} flex flex-col gap-1.5`;
                if (isExpanded) {
                    items.forEach(item => itemsContainer.appendChild(this.buildIemDbModelCard(item)));
                }
                groupEl.appendChild(itemsContainer);
                list.appendChild(groupEl);
            }

            this.applyIemDbFileMarquees();
        },
        buildIemDbModelCard: function(item) {
            const itemName = `${item.brand}${item.model ? ' ' + item.model : ''}${item.variant ? ' (' + item.variant + ')' : ''}`;

            const fileCount = Array.isArray(item.files) ? item.files.length : 0;
            const isMulti = fileCount > 1;
            const curIdx = this._iemDbFileIdx[item.id] || 0;
            const activeFileIdx = Math.max(0, Math.min(curIdx, fileCount - 1));

            const filePath = (item.files && item.files[activeFileIdx]) ? item.files[activeFileIdx] : item.primaryFilePath;
            const pathParts = (filePath || '').split('/');
            const sourceName = pathParts.length >= 3 ? pathParts[1] : (pathParts.length >= 2 ? pathParts[0] : (item.source || 'Database'));
            const fileNameNoExt = String(pathParts[pathParts.length - 1] || '').replace(/\.[^/.]+$/, '');

            const formFactorEmojiMap = {
                'IEM': FindEngine.formFactorEmojis['IEM'],
                'Earbuds (Wired)': FindEngine.formFactorEmojis['Earbuds (Wired)'],
                'Wireless Earbuds (TWS)': FindEngine.formFactorEmojis['Wireless Earbuds (TWS)'],
                'Over-Ear Headphones (Wired)': FindEngine.formFactorEmojis['Over-Ear Headphones (Wired)'],
                'Wireless Over-Ear Headphones': FindEngine.formFactorEmojis['Wireless Over-Ear Headphones']
            };
            const formEmoji = formFactorEmojiMap[item.form_factor] || FindEngine.formFactorEmojis['IEM'];
            const driverTooltip = `${item.driver_type || 'Driver'}${item.driver_config ? ' (' + item.driver_config + ')' : ''}`;
            const driverEmoji = FindEngine.driverEmojis[item.driver_type] || '⚙️';
            const connectorEmoji = FindEngine.connectorEmojis[item.connector] || '🔌';

            const specIconsHtml = `
                ${item.price_usd != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Price">💰<span class="ml-0.5" style="font-size:9px;">$${item.price_usd}</span></span>` : ''}
                ${item.year != null ? `<span class="spec-icon-badge" style="width:auto !important; padding:0 4px;" data-tooltip="Release Year">📅<span class="ml-0.5" style="font-size:9px;">${item.year}</span></span>` : ''}
                ${item.driver_type ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                ${item.connector ? `<span class="spec-icon-badge" data-tooltip="${esc(item.connector)}">${connectorEmoji}</span>` : ''}
                <span class="spec-icon-badge" data-tooltip="${esc(item.form_factor || 'In-Ear Monitor (IEM)')}">${formEmoji}</span>
            `;
            const getTagEmoji = (tagStr) => {
                if (!tagStr) return '🏷️';
                const cleanKey = tagStr.toLowerCase().trim().replace(/[\s_]+/g, '-');
                const emojiMap = {
                    'basshead': '💥', 'sub-bass': '🌊', 'punchy-bass': '🥊', 'warm': '🌿', 'warm-tilt': '🌿',
                    'neutral': '⚖️', 'v-shaped': '🔺', 'balanced': '⚖️', 'bright': '✨', 'dark': '🌑',
                    'detailed': '💎', 'detail': '💎', 'resolving': '🔍', 'technical': '🔬', 'wide-stage': '🏟️',
                        'soundstage': '🏟️', 'good-imaging': '🔭', 'imaging': '🔭', 'smooth': '🧈', 'reference': '🎯',
                        'analytical': '🧠', 'fun': '🔥', 'relaxed': '😌', 'gaming': '🎮', 'competitive-gaming': '🏆',
                        'vocal-focused': '🗣️', 'vocal': '🎤', 'budget': '💰', 'mid-tier': '🪙', 'premium': '👑',
                        'flagship': '🥇', 'collab': '🤝', 'limited-edition': '🌟', 'vintage': '📼'
                };
                return emojiMap[cleanKey] || '🏷️';
            };
            const tagsHtml = (item.tags || []).slice(0, 4).map(t => `<span class="spec-icon-badge" data-tooltip="${esc(t)}">${getTagEmoji(t)}</span>`).join('');

            const isActive = (this._iemDbActiveId === item.id);
            const rowAccentColor = isActive ? 'var(--accent-blue)' : 'var(--border-color)';

            let fileRowHtml;
            if (isMulti) {
                fileRowHtml = `
                    <div class="flex items-center gap-1.5 mt-1">
                        <button onclick="event.stopPropagation(); IEM.cycleIemDbFile('${escJs(item.id)}', -1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isActive ? '#fff' : 'var(--text-secondary)'};">◀</button>
                        <div class="flex-1 min-w-0 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                            <span class="iem-db-file-marquee text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isActive ? rowAccentColor : 'var(--text-main)'};">${activeFileIdx + 1}/${fileCount} · ${esc(sourceName)} · ${esc(fileNameNoExt)}</span>
                        </div>
                        <button onclick="event.stopPropagation(); IEM.cycleIemDbFile('${escJs(item.id)}', 1)" class="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-black border border-black rounded" style="background:${rowAccentColor}; color:${isActive ? '#fff' : 'var(--text-secondary)'};">▶</button>
                    </div>
                `;
            } else {
                fileRowHtml = `
                    <div class="mt-1 overflow-hidden border border-white/[0.06] rounded px-1.5 py-0.5" style="background: var(--bg-input);">
                        <span class="db-file-marquee-text text-[8.5px] font-bold inline-block whitespace-nowrap" style="color:${isActive ? rowAccentColor : 'var(--text-main)'};">${esc(fileNameNoExt)}</span>
                    </div>
                `;
            }

            const div = document.createElement('div');
            div.className = 'peqdb-row-item p-2 mb-1.5 transition-all select-none cursor-pointer';
            div.setAttribute('data-id', item.id);
            if (isActive) {
                div.classList.add('is-loaded');
                div.style.setProperty('--row-glow', 'rgba(var(--accent-blue-rgb), 0.28)');
                div.style.setProperty('--row-glow-solid', 'var(--accent-blue)');
            }
            div.onclick = () => IEM.toggleIemDbSelection(item.id);
            div.innerHTML = `
                <div class="db-title-row overflow-hidden whitespace-nowrap">
                    <span class="db-title-text font-black text-stone-200 text-xs inline-block whitespace-nowrap">${esc(itemName)}</span>
                </div>
                <div class="text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">${esc(item.source || sourceName)}</div>
                <div class="flex flex-wrap items-center justify-center gap-1 mt-1">${specIconsHtml}</div>
                ${tagsHtml ? `<div class="flex flex-wrap items-center justify-center gap-1 mt-1">${tagsHtml}</div>` : ''}
                ${fileRowHtml}
            `;
            return div;
        },
        toggleIemDbBrand: function(brandName) {
            if (!this._iemDbExpandedBrands) this._iemDbExpandedBrands = new Set();
            if (this._iemDbExpandedBrands.has(brandName)) {
                this._iemDbExpandedBrands.delete(brandName);
            } else {
                this._iemDbExpandedBrands.add(brandName);
            }
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            list.querySelectorAll('[data-iem-brand]').forEach(group => {
                if (group.getAttribute('data-iem-brand') === brandName) {
                    const container = group.querySelector('.brand-items-container');
                    const arrow = group.querySelector('.brand-group-arrow');
                    const isOpen = this._iemDbExpandedBrands.has(brandName);
                    if (container) {
                        if (isOpen && container.children.length === 0 && this._iemBrandCache && this._iemBrandCache[brandName]) {
                            this._iemBrandCache[brandName].forEach(item => container.appendChild(this.buildIemDbModelCard(item)));
                        }
                        container.classList.toggle('hidden', !isOpen);
                    }
                    if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
                }
            });
            this.applyIemDbFileMarquees();
        },
        applyIemDbFileMarquees: function() {
            const list = document.getElementById('iem-db-search-list');
            if (!list) return;
            requestAnimationFrame(() => {
                setTimeout(() => {
                    list.querySelectorAll('.iem-db-file-marquee, .db-file-marquee-text').forEach((el) => {
                        if (!el.classList.contains('marquee-orbit-active')) activateOrbitMarquee(el);
                    });
                }, 60);
            });
        },
        cycleIemDbFile: function(id, dir) {
            const db = this.getIemDatabase();
            const item = db.find(x => x.id === id);
            if (!item || !Array.isArray(item.files)) return;
            const fc = item.files.length;
            let cur = this._iemDbFileIdx[id] || 0;
            cur = (cur + dir + fc) % fc;
            this._iemDbFileIdx[id] = cur;
            const input = document.getElementById('iem-db-search-input');
            this.renderIemDbSearch(input ? input.value : '');
        },
        toggleIemDbSelection: function(itemId) {
            if (this._iemDbActiveId === itemId) {
                this.clearIemDbSelection();
            } else {
                this.applyDbEntryToReview(itemId);
            }
        },
        clearIemDbSelection: function() {
            this._iemDbActiveId = null;
            const searchInput = document.getElementById('iem-db-search-input');
            if (searchInput) this.renderIemDbSearch(searchInput.value);

            const snap = this._iemPreApplySnapshot || {};
            document.getElementById('brand').value = snap.brand || '';
            document.getElementById('model').value = snap.model || '';
            document.getElementById('price').value = snap.price || '';
            this.setListeningVolume(snap.listeningVolume || 'moderate');
            document.getElementById('sensitivity').value = snap.sensitivity || '110';
            if (snap.impedance != null) { const ie = document.getElementById('impedance'); if (ie) ie.value = snap.impedance; }
            this.setFormFactor(snap.formFactor || 'IEM');
            this.setConnector(snap.connector || '2-pin');
            this.selectedDriverTypes = snap.selectedDriverTypes || {};
            this.runDriverAutoLogic();
            if (snap.toneSliders) {
                snap.toneSliders.forEach(entry => {
                    const el = document.getElementById(entry.id);
                    if (el) { el.value = entry.value; const dv = document.getElementById(entry.id + '-val'); if (dv) dv.textContent = entry.display; }
                });
            }
            this.selectedTags.clear(); this.selectedGenres.clear(); this.selectedBass.clear();
            (snap.tags || []).forEach(t => this.selectedTags.add(t));
            (snap.genres || []).forEach(t => this.selectedGenres.add(t));
            (snap.bass || []).forEach(t => this.selectedBass.add(t));
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);
            this.renderReviewSelectedTags();
            this.updateAll();
            showToast("Selection cleared — review restored.", "↩️");
        },
        applyDbEntryToReview: async function(itemId) {
            const db = this.getIemDatabase();
            const item = db.find(x => x.id === itemId);
            if (!item) { showToast("Database entry not found.", "⚠️"); return; }

            this._iemPreApplySnapshot = {
                brand: document.getElementById('brand') ? document.getElementById('brand').value : '',
                model: document.getElementById('model') ? document.getElementById('model').value : '',
                price: document.getElementById('price') ? document.getElementById('price').value : '',
                listeningVolume: document.getElementById('listening-volume') ? document.getElementById('listening-volume').value : 'moderate',
                impedance: document.getElementById('impedance') ? document.getElementById('impedance').value : '32',
                sensitivity: document.getElementById('sensitivity') ? document.getElementById('sensitivity').value : '110',
                formFactor: this.formFactor || 'IEM',
                connector: this.connector || '2-pin',
                selectedDriverTypes: Object.assign({}, this.selectedDriverTypes || {}),
                tags: Array.from(this.selectedTags || []),
                genres: Array.from(this.selectedGenres || []),
                bass: Array.from(this.selectedBass || []),
                toneSliders: this.sliderNodes ? this.sliderNodes.map(n => ({ id: n.element.id, value: n.element.value, display: n.displayValueNode ? n.displayValueNode.textContent : n.element.value })) : []
            };

            const fileCount = Array.isArray(item.files) ? item.files.length : 0;
            const fileIdx = Math.max(0, Math.min(this._iemDbFileIdx[item.id] || 0, fileCount - 1));
            const targetFile = (item.files && item.files[fileIdx]) ? item.files[fileIdx] : null;

            showToast(`Loading "${item.brand} ${item.model}${item.variant ? ' (' + item.variant + ')' : ''}" from database...`, "🔍");
            this._iemDbActiveId = item.id;
            const searchInput = document.getElementById('iem-db-search-input');
            if (searchInput) this.renderIemDbSearch(searchInput.value);
            await this.ensureChartReady().catch(() => {});
            let curve = null;
            if (typeof CurveIndexer !== 'undefined') {
                try {
                    const ok = await CurveIndexer.loadCurve(item, fileIdx);
                    if (ok) {
                        curve = (fileIdx === 0) ? (item.data || null) : (item.sourcesCache && item.sourcesCache[targetFile]) || null;
                    }
                } catch (e) { console.warn("[IEM DB Fill] curve load failed:", e); }
            }

            document.getElementById('brand').value = item.brand || '';
            document.getElementById('model').value = (item.model || '') + (item.variant ? ' ' + item.variant : '');
            document.getElementById('price').value = (item.price_usd != null ? item.price_usd : '');

            if (document.getElementById('impedance')) document.getElementById('impedance').value = Math.max(5, Math.min(300, Math.round(item.impedance || 5)));
            if (document.getElementById('impedance-slider')) document.getElementById('impedance-slider').value = Math.min(300, Math.max(5, Math.round(item.impedance || 5)));
            if (document.getElementById('sensitivity')) document.getElementById('sensitivity').value = Math.max(80, Math.min(125, Math.round(item.sensitivity || 80)));
            if (document.getElementById('sensitivity-slider')) document.getElementById('sensitivity-slider').value = Math.min(125, Math.max(80, Math.round(item.sensitivity || 80)));
            let impEl = document.getElementById('impedance');
            if (impEl) document.getElementById('impedance').dispatchEvent(new Event('input', { bubbles: true }));

            if (item.form_factor) this.setFormFactor(item.form_factor);
            if (item.connector) this.setConnector(item.connector);

            // Drivers
            if (item.driver_config && FindEngine && FindEngine.parseDriverConfig) {
                const techs = FindEngine.parseDriverConfig(item.driver_config);
                const counts = {};
                const re = /(\d+)\s*x?\s*([A-Za-z]{2,})/gi;
                let m;
                while ((m = re.exec(String(item.driver_config))) !== null) {
                    const canonical = FindEngine.driverTechCanon[m[2].toUpperCase()];
                    if (canonical) counts[canonical] = (counts[canonical] || 0) + parseInt(m[1], 10);
                }
                if (Object.keys(counts).length === 0) {
                    techs.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
                }
                this.selectedDriverTypes = counts;
                this.runDriverAutoLogic();
            }

            // Sound-char tone sliders from the measured curve (subjective axes untouched)
            if (curve && PEQDB_Module && PEQDB_Module.getNormalizedData) {
                this.fillToneSlidersFromCurve(curve);
            }

            // Tags: DB tags + curve-derived tags, best 4
            const signatureTags = (curve && PEQDB_Module && PEQDB_Module.analyzeCurveSignature) ? PEQDB_Module.analyzeCurveSignature(curve) : [];
            this.derivedTagsForReview(item, signatureTags);

            this.updateAll();
            showToast(`Loaded ${item.brand} ${item.model} from database.`, "✓");
        },
        // Derive objective tone-character slider values from a measured FR curve.
        // Only "measurable" tone axes are touched: bass/sub-bass/punch/texture/speed,
        // mids/vocals, treble energy/smooth/detail/extension. Subjective axes
        // (soundstage, imaging, dynamics, comfort, build, fit) stay untouched.
        fillToneSlidersFromCurve: function(curve) {
            let norm;
            try { norm = PEQDB_Module.getNormalizedData(curve, 'review-fill'); } catch (e) { return; }
            if (!norm || norm.length < 10) return;

            const getDbAt = (hz) => {
                let closest = norm[0];
                let minDiff = Infinity;
                for (let i = 0; i < norm.length; i++) {
                    const diff = Math.abs(norm[i][0] - hz);
                    if (diff < minDiff) { minDiff = diff; closest = norm[i]; }
                }
                return closest[1];
            };
            const avg = (fs) => fs.reduce((s, f) => s + getDbAt(f), 0) / fs.length;
            const clampS = (v, lim = 10) => Math.max(-lim, Math.min(lim, Math.round(v * 10) / 10));

            const subBass = avg([20, 30, 40, 50, 60]);
            const midBass = avg([80, 100, 120, 150, 200]);
            const lowMids = avg([250, 300, 400, 500]);
            const mids = avg([600, 800, 1000, 1200]);
            const upperMids = avg([1500, 2000, 2500, 3000]);
            const presence = avg([3500, 4000, 5000, 6000]);
            const treble = avg([7000, 8000, 9000, 10000]);
            const air = avg([12000, 14000, 16000, 18000, 20000]);

            // Reference the mean of the lower-mid → upper-mid region we treat as neutral.
            const ref = (lowMids + mids + upperMids) / 3;
            const v = {};
            v['bass'] = clampS(subBass - ref);
            v['sub-bass-extension'] = clampS(subBass - midBass);
            v['mid-bass-punch'] = clampS(midBass - ref);
            v['bass-texture'] = clampS((midBass + lowMids) / 2 - ref, 8);
            v['bass-speed'] = clampS((midBass - subBass) * 0.6, 8);
            v['lower-mids'] = clampS(lowMids - ref);
            v['upper-mids'] = clampS(upperMids - ref);
            v['vocals'] = clampS(upperMids - ref);
            v['vocal-fullness'] = clampS((lowMids + mids) / 2 - ref, 8);
            v['mid-naturalness'] = clampS(-(Math.max(0, mids - ref) - Math.min(0, lowMids - ref)), 6);
            v['treble-energy'] = clampS(treble - ref, 9);
            v['treble-smooth'] = clampS(-(presence - treble), 8);
            v['treble-extension'] = clampS(air - treble, 9);
            v['sibilance'] = clampS(presence - ref, 7);
            v['treble-detail'] = clampS((treble + air) / 2 - ref, 9);

            this.sliderNodes.forEach(node => {
                const id = node.element.id;
                if (v[id] !== undefined) {
                    node.element.value = v[id].toFixed(1);
                    if (node.displayValueNode) node.displayValueNode.textContent = (v[id] >= 0 ? "+" : "") + v[id].toFixed(1);
                }
            });
        },
        // Fill exactly 4 slots from the whitelist ONLY: DB tags first (authoritative, every entry >=4),
        // then curve signature tags that map onto a whitelist tag. Never inject non-whitelist names.
        derivedTagsForReview: function(item, signatureTags) {
            const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const tagNameWithoutEmoji = (t) => String(t || '').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]+/u, '').trim();

            const reviewTagByNorm = new Map();
            this.allReviewTags.forEach(t => { reviewTagByNorm.set(normalize(tagNameWithoutEmoji(t)), t); });

            // 1) DB whitelist tags (authoritative, preserve DB order, drop anything unmapped)
            const dbTagNames = (item && Array.isArray(item.tags)) ? item.tags : [];
            const merged = [];
            dbTagNames.forEach(n => {
                const t = reviewTagByNorm.get(normalize(n));
                if (t && merged.indexOf(t) === -1) merged.push(t);
            });
            // 2) Curve tags only if they resolve onto the whitelist (U-shape etc. are dropped)
            Array.from(signatureTags || []).forEach(t => {
                const mapped = reviewTagByNorm.get(normalize(tagNameWithoutEmoji(t)));
                if (mapped && merged.indexOf(mapped) === -1) merged.push(mapped);
            });

            const tagCategory = (t) => {
                const plain = tagNameWithoutEmoji(t);
                if (this.bassTags.some(b => tagNameWithoutEmoji(b.name) === plain)) return 'bass';
                if (this.genreTags.some(g => tagNameWithoutEmoji(g.name) === plain)) return 'genre';
                return 'tone';
            };

            this.selectedTags = new Set(); this.selectedBass = new Set(); this.selectedGenres = new Set();
            const limits = { tone: 2, bass: 1, genre: 1 };
            const placed = { tone: 0, bass: 0, genre: 0 };
            const seen = new Set();
            const place = (t, cat) => {
                if (cat === 'bass') this.selectedBass.add(t);
                else if (cat === 'genre') this.selectedGenres.add(t);
                else this.selectedTags.add(t);
                placed[cat]++; seen.add(t);
            };
            let total = 0;
            // Pass 1: respect category caps for a spread
            for (let i = 0; total < 4 && i < merged.length; i++) {
                const t = merged[i], cat = tagCategory(t);
                if (placed[cat] >= limits[cat]) continue;
                place(t, cat); total++;
            }
            // Pass 2: guarantee all 4 slots still fill even if one category overflows
            for (let i = 0; total < 4 && i < merged.length; i++) {
                const t = merged[i];
                if (seen.has(t)) continue;
                place(t, tagCategory(t)); total++;
            }

            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);
            this.renderReviewSelectedTags();
        },
        crossoverOverride: false,
        wayOverride: false,
        currentCrossover: 'UNK',
        currentWay: 'UNK',
        currentDriverType: 'DD',
        crossoverOptions: ['UNK', 'NONE', 'PASS', 'ACOU', 'ACTV', 'HYBR'],
        wayOptions: ['UNK', '1W', '2W', '3W', '4W', '5W', '6W+'],
        cycleDriverType: function() {
            const list = ['DD', 'BA', 'Planar', 'EST', 'PZT', 'BC', 'MEMS'];
            const curIdx = list.indexOf(this.currentDriverType);
            const nextIdx = (curIdx + 1) % list.length;
            this.currentDriverType = list[nextIdx];
            this.updateDriverTypeCycleUI();
        },
        updateDriverTypeCycleUI: function() {
            const btn = document.getElementById('driver-type-cycle-btn');
            if (!btn) return;
            const labels = {
                DD: '🥁 DD (Dynamic)',
                BA: '🎯 BA (Balanced Armature)',
                Planar: '🧲 PLANAR (Planar)',
                EST: '⚡ EST (Electrostatic)',
                PZT: '🔮 PZT (Piezoelectric)',
                BC: '🦴 BC (Bone Conduction)',
                MEMS: '🔬 MEMS (Micro)'
            };
            btn.textContent = labels[this.currentDriverType] || '🥁 DD (Dynamic)';
        },
        cycleCrossover: function() {
            this.crossoverOverride = true;
            const curIdx = this.crossoverOptions.indexOf(this.currentCrossover);
            const nextIdx = (curIdx + 1) % this.crossoverOptions.length;
            this.currentCrossover = this.crossoverOptions[nextIdx];
            this.updateCrossoverButtonsUI();
            this.updateDriverSummary();
        },
        cycleWay: function() {
            this.wayOverride = true;
            const curIdx = this.wayOptions.indexOf(this.currentWay);
            const nextIdx = (curIdx + 1) % this.wayOptions.length;
            this.currentWay = this.wayOptions[nextIdx];
            this.updateWayButtonsUI();
            this.updateDriverSummary();
        },
        updateCrossoverButtonsUI: function() {
            const btn = document.getElementById('crossover-cycle-btn');
            if (!btn) return;
            const labels = {
                UNK: '🔀 Unknown',
                NONE: '🚫 None',
                PASS: '🔌 Passive',
                ACOU: '🌬️ Acoustic',
                ACTV: '⚡ DSP',
                HYBR: '🔀 Hybrid'
            };
            btn.textContent = labels[this.currentCrossover] || '🔀 Crossover: Unknown';
            if (this.currentCrossover === 'UNK') {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border border-[var(--border-color)] rounded text-[9px] font-bold text-zinc-400 transition-all flex items-center justify-center gap-1 cursor-pointer";
            } else {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border-[var(--accent-blue)] rounded text-[9px] font-bold text-[var(--accent-blue)] transition-all flex items-center justify-center gap-1 cursor-pointer";
            }
        },
        updateWayButtonsUI: function() {
            const btn = document.getElementById('way-cycle-btn');
            if (!btn) return;
            const labels = {
                UNK: '🧩 Unknown',
                '1W': '1️⃣  1-Way',
                '2W': '2️⃣  2-Way',
                '3W': '3️⃣  3-Way',
                '4W': '4️⃣  4-Way',
                '5W': '5️⃣  5-Way',
                '6W+': '🔟 6-Way+'
            };
            btn.textContent = labels[this.currentWay] || '🧩 Way: Unknown';
            if (this.currentWay === 'UNK') {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border border-[var(--border-color)] rounded text-[9px] font-bold text-zinc-400 transition-all flex items-center justify-center gap-1 cursor-pointer";
            } else {
                btn.className = "w-full h-7 bg-[var(--bg-input)] hover:bg-zinc-800 border-[var(--accent-blue)] rounded text-[9px] font-bold text-[var(--accent-blue)] transition-all flex items-center justify-center gap-1 cursor-pointer";
            }
        },
        imgScale: 1.0,
        imgOffsetX: 0,
        imgOffsetY: 0,
        removeWhiteBg: false,
        rawImageObj: null,
        processedCanvas: null,
        imageDrawPending: false,
        dacTiers: ['Phone', 'Laptop', 'Dongle', 'Desktop'],
        dacDetails: {
            'Phone': { icon: 'app/icons/phone.png', label: 'Phone' },
            'Laptop': { icon: 'app/icons/laptop.png', label: 'Laptop' },
            'Dongle': { icon: 'app/icons/dongle.png', label: 'Dongle' },
            'Desktop': { icon: 'app/icons/desktop.png', label: 'Amp' }
        },
        currentDacIdx: 2,

        cycleDacPower: function(dir) {
            const total = this.dacTiers.length;
            this.currentDacIdx = (this.currentDacIdx + dir + total) % total;
            const activeTier = this.dacTiers[this.currentDacIdx];
            this.updateDacUI(activeTier);
            this.updateAll();
        },
        tonalityTags: [
            {name: "⚖️ Neutral"}, {name: "✨ Bright"}, {name: "🌿 Warm"}, {name: "🌑 Dark"},
            {name: "🔺 V-Shape"}, {name: "🪞 U-Shape"}, {name: "🎯 Mid-Forward"}, {name: "🌬️ Airy"},
            {name: "💎 Detailed"}, {name: "☁️ Smooth"}, {name: "🔥 Energetic"}, {name: "😌 Relaxed"}
        ],
        bassTags: [
            {name: "💥 Basshead"}, {name: "🌊 Deep Bass"}, {name: "📳 Rumble"}, {name: "🥊 Punchy"},
            {name: "🎯 Controlled"}, {name: "🎈 Light Bass"}, {name: "⚡ Fast Bass"}, {name: "🪨 Thick Bass"},
            {name: "🧼 Clean Bass"}, {name: "🫀 Slam"}
        ],
        genreTags: [
            {name: "📱 All-Rounder"}, {name: "🎤 Vocal"}, {name: "🎸 Rock"}, {name: "⚡ EDM"},
            {name: "🎧 Hip-Hop"}, {name: "🎹 Pop"}, {name: "🎻 Classical"}, {name: "🎷 Jazz"},
            {name: "🤠 Country"}, {name: "🎼 Orchestra"}, {name: "🎮 Gaming"}, {name: "🎬 Movies"},
            {name: "🔬 Critical"}
        ],

        init: function() {

         if (document.getElementById('tonality-tags')) {
             this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
             this.createTags('genre-tags', this.genreTags, this.selectedGenres);
             this.createTags('bass-tags', this.bassTags, this.selectedBass);
         }
            this.initGauges();
            this.updateSensUnitUI();

            this.runDriverAutoLogic();
            this.initImageControls();

                        this.sliderNodes = Array.from(document.querySelectorAll('.iem-slider')).map(s => {
                return { element: s, displayValueNode: document.getElementById(s.id + '-val') };
            });

            this.debouncedUpdateAll = rafThrottle(() => this.updateAll());
            // index.html's #lib-search oninput calls IEM.debouncedRenderLibrary(),
            // which was never defined -- every keystroke threw and the
            // Library search never filtered as you typed.
            this.debouncedRenderLibrary = debounce(() => this.renderLibrary(), 180);

            this.updateDacUI(this.dacTiers[this.currentDacIdx]);
            this.renderReviewSelectedTags();
            this.setFormFactor(this.formFactor || 'IEM');
            this.setConnector(this.connector || '2-pin');
            this.renderIemDbSearch('');
            this.switchLeftTab(this.activeLeftTab || 'info');
            this.updateAll();
        },
        ensureChartReady: async function() {
            if (this.radarChart) return;
            if (!this._chartJsLoadPromise) {
                this._chartJsLoadPromise = (typeof Chart !== 'undefined')
                    ? Promise.resolve(true)
                    : EQ_Module.injectScriptAsync('app/js/chart.js');
            }
            await this._chartJsLoadPromise;
            if (this.radarChart || typeof Chart === 'undefined') return;

            this.initChart();
            this.updateAll();

        },
        initChart: function() {
            const ctx = document.getElementById('radarChart').getContext('2d');
        const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
        const activeThemeConfig = (window.App && App.themeMap && App.themeMap[savedThemeId]) || {};
        const themeVars = activeThemeConfig.variables || {};
        const accentColor = activeThemeConfig.accent || themeVars['--accent-blue'] || '#6488b0';
        const pointLabelColor = themeVars['--text-main'] || '#f0f0f4';
        const gridColor = themeVars['--text-secondary'] ? themeVars['--text-secondary'] + '40' : 'rgba(255, 255, 255, 0.15)';
        this.radarChart = new Chart(ctx, {
            type: 'radar',
            data: { labels: ['Bass', 'Mids', 'Treble', 'Detail', 'Soundstage', 'Imaging', 'Dynamics', 'Tonality', 'Technicalities'], datasets: [{ label: 'Sound Profile', data: [5, 5, 5, 5, 5, 5, 5, 5, 5], backgroundColor: accentColor + '22', borderColor: accentColor, pointBackgroundColor: accentColor, borderWidth: 2, pointRadius: 4, pointHoverRadius: 7, pointHitRadius: 12 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 10, bottom: 15, left: 10, right: 10 } },
                    scales: { r: { min: 0, max: 10, ticks: { display: false, stepSize: 2 }, grid: { color: gridColor }, angleLines: { color: gridColor }, pointLabels: { color: pointLabelColor, font: { size: 10, weight: 'bold', family: 'system-ui, -apple-system, sans-serif' } } } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: true,
                            titleAlign: 'center',
                            bodyAlign: 'center',
                            displayColors: false,
                            callbacks: {
                                title: function(context) {
                                    const label = context[0].label;
                                    const emojiMap = {
                                        'Bass': '🥁 Bass',
                                        'Mids': '🎤 Mids',
                                        'Treble': '✨ Treble',
                                        'Detail': '🔍 Detail',
                                        'Soundstage': '🏟️ Soundstage',
                                        'Imaging': '🎯 Imaging',
                                        'Dynamics': '📈 Dynamics',
                                        'Tonality': '🎼 Tonality',
                                        'Technicalities': '🔬 Technicalities'
                                    };
                                    return emojiMap[label] || label;
                                },
                                label: function(context) {
                                    return 'Score: ' + context.raw;
                                }
                            }
                        }
                    },
                    animation: { duration: 250 } }
            });
        },
        initGauges: function() {
            document.querySelectorAll('.gauge-container').forEach(container => {
                let isDragging = false;
                let updatePending = false;

                const id = container.getAttribute('data-id');
                const min = parseFloat(container.getAttribute('data-min'));
                const max = parseFloat(container.getAttribute('data-max'));
                const input = document.getElementById(id);

                const startDrag = (e) => {
                    isDragging = true;
                    updateFromMouse(e);
                };

                const updateFromMouse = (e) => {
                    if (!isDragging) return;
                    if (updatePending) return;

                    updatePending = true;
                    requestAnimationFrame(() => {
                        updatePending = false;

                        const rect = container.getBoundingClientRect();
                        const clientX = e.touches ? (e.touches[0]?.clientX || e.changedTouches[0]?.clientX) : e.clientX;
                        if (clientX === undefined) return;

                        let percent = (clientX - rect.left) / rect.width;
                        percent = Math.max(0, Math.min(1, percent));
                        const newValue = Math.round(min + (percent * (max - min)));

                        if (input) input.value = newValue;
                        IEM_Module.updateGauge(id, newValue);
                        IEM_Module.updateAll();
                    });
                };

                const stopDrag = () => {
                    if (isDragging) {
                        isDragging = false;
                        document.removeEventListener('mousemove', updateFromMouse);
                        document.removeEventListener('mouseup', stopDrag);
                    }
                };

                container.addEventListener('mousedown', (e) => {
                    startDrag(e);

                    document.addEventListener('mousemove', updateFromMouse);
                    document.addEventListener('mouseup', stopDrag);
                });

                container.addEventListener('touchstart', (e) => {
                    isDragging = true;
                    updateFromMouse(e.touches[0] || e.changedTouches[0]);

                    const touchMove = (evt) => { if (isDragging) updateFromMouse(evt.touches[0] || evt.changedTouches[0]); };
                    const touchEnd = () => {
                        isDragging = false;
                        document.removeEventListener('touchmove', touchMove);
                        document.removeEventListener('touchend', touchEnd);
                    };
                    document.addEventListener('touchmove', touchMove, { passive: true });
                    document.addEventListener('touchend', touchEnd);
                }, { passive: true });
            });
        },
        updateGauge: function(id, val) {
            const numVal = parseFloat(val);
            const needle = document.getElementById(`${id}-needle`);
            const light = document.getElementById(`${id}-light`);
            const input = document.getElementById(id);
            const config = { impedance: { min: 5, max: 300 }, sensitivity: { min: 80, max: 125 } };
            const constraint = config[id];

            if (!constraint || !needle) return;
            const clamped = Math.max(constraint.min, Math.min(constraint.max, numVal));
            const normalized = (clamped - constraint.min) / (constraint.max - constraint.min);
            const rotation = (normalized * 180) - 90;

            needle.style.transition = "transform .5s cubic-bezier(.22, 1, .36, 1)";
            needle.style.transform = `rotate(${rotation}deg)`;

            const impedance = id === "impedance" ? clamped : parseFloat(document.getElementById("impedance")?.value || 32);
            const sensitivity = id === "sensitivity" ? clamped : parseFloat(document.getElementById("sensitivity")?.value || 100);

            let difficulty = 0;

            if (impedance > 150) {
                difficulty += 45;
            } else if (impedance > 64) {
                difficulty += 25;
            } else if (impedance > 32) {
                difficulty += 10;
            }

            if (sensitivity < 90) {
                difficulty += 60;
            } else if (sensitivity < 100) {
                difficulty += 35;
            } else if (sensitivity < 105) {
                difficulty += 15;
            }

            difficulty = Math.min(100, difficulty);

            let targetColor;
            let status;

            if (difficulty < 20) {
                targetColor = '#22c55e';
                status = "easy";
            } else if (difficulty < 45) {
                targetColor = '#06b6d4';
                status = "normal";
            } else if (difficulty < 70) {
                targetColor = '#facc15';
                status = "moderate";
            } else {
                targetColor = '#ef4444';
                status = "hard";
            }

            if (input) {
                input.style.color = targetColor;
                input.style.textShadow = `0 0 6px ${targetColor}40`;
            }

            if (light) {
                light.style.backgroundColor = targetColor;
                light.style.boxShadow = `0 0 10px ${targetColor}`;
                light.className = `gauge-light ${status}`;
            }

            const slider = document.getElementById(`${id}-slider`);
            if (slider && parseFloat(slider.value) !== clamped) {
                slider.value = clamped;
                if (window.syncGlobalSliders) window.syncGlobalSliders();
            }
        },
        handleGaugeSlider: function(id, val) {
            const input = document.getElementById(id);
            if (input) {
                let snapVal = parseFloat(val);

                if (id === 'impedance') {
                    const commonOhms = [8, 12, 16, 18, 24, 32];
                    const threshold = 1.5;
                    for (let k = 0; k < commonOhms.length; k++) {
                        if (Math.abs(snapVal - commonOhms[k]) <= threshold) {
                            snapVal = commonOhms[k];
                            const slider = document.getElementById('impedance-slider');
                            if (slider) slider.value = snapVal;
                            break;
                        }
                    }
                }

                input.value = Math.round(snapVal);
                this.updateGauge(id, snapVal);
                this.updateAll();
            }
        },
        setDacPower: function(dacName) {
            const idx = this.dacTiers.indexOf(dacName);
            if (idx !== -1) {
                this.currentDacIdx = idx;
                this.updateDacUI(dacName);
                this.updateAll();
            }
        },
        updateDacUI: function(dacName) {
            const btnLabel = document.getElementById('dac-btn-label');
            if (btnLabel) {
                const info = (this.dacDetails && this.dacDetails[dacName]) ? this.dacDetails[dacName] : { icon: 'app/icons/dongle.png', label: dacName };
                btnLabel.innerHTML = `<img src="${info.icon}" class="w-6 h-6 object-contain flex-shrink-0 inline-block anim-toggle-pop"> ${info.label}`;
            }
        },
        soundCharModes: [
            { id: 'bass', label: 'Bass', emoji: '🥁' },
            { id: 'mids', label: 'Mids', emoji: '🎤' },
            { id: 'treble', label: 'Treble', emoji: '✨' },
            { id: 'stage', label: 'Stage', emoji: '🏟️' },
            { id: 'fit', label: 'Fit', emoji: '🎧' }
        ],
        activeSoundCharTab: 'bass',
        cycleSoundCharTab: function(dir) {
            const currentIdx = this.soundCharModes.findIndex(m => m.id === this.activeSoundCharTab);
            const total = this.soundCharModes.length;
            const nextIdx = (currentIdx + dir + total) % total;
            this.switchSoundCharTab(this.soundCharModes[nextIdx].id);
        },
        switchSoundCharTab: function(tabId) {
            this.activeSoundCharTab = tabId;
            document.querySelectorAll('#sound-char-tabs button').forEach(btn => btn.classList.remove('active'));
            const activeTabBtn = document.getElementById('sc-tab-' + tabId);
            if (activeTabBtn) activeTabBtn.classList.add('active');

            document.querySelectorAll('.sound-char-panel').forEach(panel => panel.classList.add('hidden'));
            const activePanel = document.getElementById('sc-panel-' + tabId);
            if (activePanel) activePanel.classList.remove('hidden');

            const stepperLabel = document.getElementById('sc-tab-stepper-label');
            if (stepperLabel) {
                const info = this.soundCharModes.find(m => m.id === tabId) || this.soundCharModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }
        },

        allReviewTags: [
            "⚖️ Neutral", "💥 Basshead", "🌊 Sub-Bass", "🥊 Punchy Bass", "🌿 Warm", "🔺 V-Shaped", "☯️ Balanced", "✨ Bright", "🌑 Dark", "💎 Detailed", "🔍 Resolving", "🔬 Technical", "🏟️ Wide-Stage", "🔭 Good-Imaging", "🧈 Smooth", "📐 Reference", "🧠 Analytical", "🔥 Fun", "😌 Relaxed", "🎮 Gaming", "🏆 Competitive-Gaming", "🎤 Vocal-Focused", "💰 Budget", "🪙 Mid-Tier", "👑 Premium", "🥇 Flagship", "🤝 Collab", "🌟 Limited-Edition"
        ],
        currentReviewTagIndex: 0,

        cycleReviewTag: function(dir) {
            const total = this.allReviewTags.length;
            this.currentReviewTagIndex = (this.currentReviewTagIndex + dir + total) % total;
            this.updateReviewTagPreviewLabel();
        },

        updateReviewTagPreviewLabel: function() {
            const label = document.getElementById('label-review-tag-select');
            if (!label) return;
            const tag = this.allReviewTags[this.currentReviewTagIndex] || this.allReviewTags[0];
            const match = tag.match(/^(\p{Extended_Pictographic}+(?:\uFE0F|\uFE0E)?)/u);
            let emoji = "🏷️";
            let text = tag;
            if (match) {
                emoji = match[1];
                text = tag.slice(emoji.length).trim();
            }
            const animClass = FindEngine.getTagAnimationClass ? FindEngine.getTagAnimationClass(text) : 'anim-toggle-pop';
            label.innerHTML = `<span class="emoji-font vibrant-emoji ${animClass} text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5">${emoji}</span> ${text}`;
        },

        addCurrentReviewTag: function() {
            const tag = this.allReviewTags[this.currentReviewTagIndex] || this.allReviewTags[0];
            this.addReviewTagFromSelect(tag);
        },
        switchMetaTab: function(tabId) {
            document.querySelectorAll('#meta-tag-tabs button').forEach(btn => btn.classList.remove('active'));
            const activeTabBtn = document.getElementById('meta-tab-' + tabId);
            if (activeTabBtn) activeTabBtn.classList.add('active');

            document.querySelectorAll('.meta-tag-panel').forEach(panel => panel.classList.add('hidden'));
            const activePanel = document.getElementById('meta-panel-' + tabId);
            if (activePanel) activePanel.classList.remove('hidden');
        },
        addReviewTagFromSelect: function(tagName) {
            if (!tagName) return;
            const totalSelected = this.selectedTags.size + this.selectedGenres.size + this.selectedBass.size;
            if (totalSelected >= 4) {
                showToast("Limit: Maximum 4 signature tags allowed.", "⚠️");
                const sel = document.getElementById('review-tag-select');
                if (sel) sel.value = '';
                return;
            }

            this.selectedTags.add(tagName);

            this.renderReviewSelectedTags();
            const sel = document.getElementById('review-tag-select');
            if (sel) sel.value = '';
            this.updateAll();
        },
        removeReviewTag: function(tagName) {
            this.selectedTags.delete(tagName);
            this.selectedBass.delete(tagName);
            this.selectedGenres.delete(tagName);
            this.renderReviewSelectedTags();
            if (window.hideGlobalTooltip) window.hideGlobalTooltip();
            const tt = document.getElementById('global-floating-tooltip');
            if (tt) { tt.style.opacity='0'; tt.style.display='none'; }
            this.updateAll();
        },
        getTagAnimationClass: function(tag) {
                    return 'anim-toggle-pop';
                },

        renderReviewSelectedTags: function() {
            const container = document.getElementById('review-selected-tags-container');
            if (!container) return;
            container.innerHTML = '';

            const allActive = [
                ...Array.from(this.selectedTags),
                ...Array.from(this.selectedBass),
                ...Array.from(this.selectedGenres)
            ];

            for (let i = 0; i < 4; i++) {
                const tag = allActive[i];
                if (tag) {
                    const match = tag.match(/^(\p{Extended_Pictographic}+(?:\uFE0F|\uFE0E)?)/u);
                    let emoji = "🏷️";
                    let text = tag;
                    if (match) {
                        emoji = match[1];
                        text = tag.slice(emoji.length).trim();
                    }

                    const animClass = this.getTagAnimationClass(tag);

                    const div = document.createElement('div');
                    div.className = 'bg-[var(--bg-card)] border-2 border-[var(--border-color)] px-2 py-1 flex items-center justify-between gap-1 select-none w-full h-full relative';
                    div.style.cssText = 'box-shadow: 2px 2px 0px 0px var(--border-color) !important;';
                    div.innerHTML = `
                        <div class="flex items-center gap-2 min-w-0 flex-1 overflow-visible">
                            <span class="emoji-font vibrant-emoji ${animClass} text-2xl flex-shrink-0 leading-none" style="display: inline-block; transform-origin: center;">${emoji}</span>
                            <span class="text-[9.5px] font-black text-[var(--text-main)] truncate leading-tight">${text}</span>
                        </div>
                        <button type="button" onclick="event.stopPropagation(); IEM.removeReviewTag('${tag}')" class="w-4 h-4 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[9px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Remove ${text}">✕</button>
                    `;
                    container.appendChild(div);
                } else {
                    const div = document.createElement('div');
                    div.className = 'border-2 border-dashed border-black rounded-none p-1 flex items-center justify-center select-none w-full h-full bg-black/10';
                    div.innerHTML = `<span class="text-[9px] font-black text-stone-400 uppercase tracking-wider">+ Slot ${i+1}</span>`;
                    container.appendChild(div);
                }
            }
        },
        updateBrandSuggestions: function(query) {
            const box = document.getElementById('brand-suggestions');
            if (!box) return;
            const q = (query || '').trim();

            const db = (window.FindEngine && FindEngine.iemDatabase) || (window.CurveIndexer && CurveIndexer.catalog) || [];
            const normQ = q.toLowerCase();
            const seen = new Set();
            const matches = [];
            for (let i = 0; i < db.length; i++) {
                const brand = db[i] && db[i].brand;
                if (!brand || seen.has(brand)) continue;
                if (q.length < 1 || brand.toLowerCase().includes(normQ)) {
                    seen.add(brand);
                    matches.push(brand);
                }
            }
            matches.sort((a, b) => a.localeCompare(b));

            if (matches.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }

            if (box.parentNode !== document.body) {
                document.body.appendChild(box);
            }

            box.innerHTML = matches.map(b => `
                <div class="p-1.5 text-xs font-bold text-zinc-200 cursor-pointer hover:bg-[var(--accent-blue)] hover:text-white select-none" onmousedown="event.preventDefault(); document.getElementById('brand').value='${escJs(b)}'; document.getElementById('brand-suggestions').classList.add('hidden');">${esc(b)}</div>
            `).join('');

            const inputEl = document.getElementById('brand');
            if (inputEl) {
                const rect = inputEl.getBoundingClientRect();
                box.style.position = 'fixed';
                box.style.left = rect.left + 'px';
                box.style.top = (rect.bottom + 2) + 'px';
                box.style.width = rect.width + 'px';
                box.style.right = 'auto';
                box.style.zIndex = '99999';
            }
            box.classList.remove('hidden');
        },
        incrementDriver: function(type) {
            if (!this.selectedDriverTypes) this.selectedDriverTypes = {};
            const cur = this.selectedDriverTypes[type] || 0;
            this.selectedDriverTypes[type] = Math.min(99, cur + 1);
            this.lastUpdatedDriverType = type;
            this.playDriverSound(type);
            this.runDriverAutoLogic();
        },
        decrementDriver: function(type) {
            if (!this.selectedDriverTypes) return;
            const cur = this.selectedDriverTypes[type] || 0;
            if (cur <= 1) {
                delete this.selectedDriverTypes[type];
            } else {
                this.selectedDriverTypes[type] = cur - 1;
            }
            this.lastUpdatedDriverType = type;
            this.playDriverSound(type);
            this.runDriverAutoLogic();
        },
        playDriverSound: function(type) {
            try {
                const ctx = SharedAudio.init();
                if (!ctx) return;
                if (ctx.state === 'suspended') ctx.resume();

                const now = ctx.currentTime;
                const outNode = SharedAudio.masterGain || ctx.destination;

                const playSynth = (cfg) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();

                    osc.type = cfg.type || 'sine';
                    osc.frequency.setValueAtTime(cfg.startFreq, now);
                    if (cfg.endFreq) {
                        osc.frequency.linearRampToValueAtTime(cfg.endFreq, now + cfg.duration);
                    }

                    gain.gain.setValueAtTime(0, now);
                    gain.gain.linearRampToValueAtTime(cfg.maxGain, now + 0.008);
                    gain.gain.linearRampToValueAtTime(0.001, now + cfg.duration);

                    if (cfg.filterType) {
                        const filter = ctx.createBiquadFilter();
                        filter.type = cfg.filterType;
                        filter.frequency.value = cfg.filterFreq;
                        osc.connect(gain);
                        gain.connect(filter);
                        filter.connect(outNode);
                    } else {
                        osc.connect(gain);
                        gain.connect(outNode);
                    }

                    osc.start(now);
                    osc.stop(now + cfg.duration + 0.02);
                };

                const configMap = {
                    DD: { type: 'sine', startFreq: 180, endFreq: 40, maxGain: 0.35, duration: 0.18 },
                    BA: { type: 'triangle', startFreq: 800, endFreq: 1400, maxGain: 0.25, duration: 0.08 },
                    Planar: { type: 'sawtooth', startFreq: 500, endFreq: 1200, maxGain: 0.22, duration: 0.14, filterType: 'lowpass', filterFreq: 2200 },
                    BC: { type: 'sine', startFreq: 100, endFreq: 25, maxGain: 0.40, duration: 0.28 },
                    EST: { type: 'sine', startFreq: 3500, endFreq: 7000, maxGain: 0.20, duration: 0.09 },
                    PZT: { type: 'sine', startFreq: 2400, endFreq: 4800, maxGain: 0.22, duration: 0.12 },
                    MEMS: { type: 'square', startFreq: 1800, endFreq: 3200, maxGain: 0.18, duration: 0.06 }
                };

                const cfg = configMap[type];
                if (cfg) {
                    playSynth(cfg);
                    if (type === 'PZT') {
                        playSynth({ type: 'sine', startFreq: 4800, endFreq: 7200, maxGain: 0.10, duration: 0.12 });
                    }
                }
            } catch (e) {
                console.warn("Driver synth audio playback failed:", e);
            }
        },
        addDriverConfig: function() {

        },
        removeDriverConfig: function(type) {
            if (this.selectedDriverTypes && this.selectedDriverTypes[type] !== undefined) {
                delete this.selectedDriverTypes[type];
            }
            this.runDriverAutoLogic();
        },
        handleCrossoverChange: function(val) {
            this.crossoverOverride = true;
            this.updateDriverSummary();
        },
        handleWayChange: function(val) {
            this.wayOverride = true;
            this.updateDriverSummary();
        },
        runDriverAutoLogic: function() {
            let totalDrivers = 0;
            let solvedActiveTypesCount = 0;
            let containsEST = false;
            let containsBA = false;
            let containsDD = false;
            let containsPlanar = false;

            if (!this.selectedDriverTypes) this.selectedDriverTypes = {};

            Object.entries(this.selectedDriverTypes).forEach(([type, count]) => {
                if (count > 0) {
                    totalDrivers += count;
                    solvedActiveTypesCount++;
                    if (type === 'EST') containsEST = true;
                    if (type === 'BA') containsBA = true;
                    if (type === 'DD') containsDD = true;
                    if (type === 'Planar') containsPlanar = true;
                }
            });

            if (totalDrivers === 0) {
                this.crossoverOverride = false;
                this.wayOverride = false;
            }

            if (!this.crossoverOverride) {
                if (totalDrivers === 0) {
                    this.currentCrossover = 'UNK';
                } else if (totalDrivers === 1) {
                    this.currentCrossover = 'NONE';
                } else if (totalDrivers === 2) {
                    this.currentCrossover = 'PASS';
                } else if (totalDrivers >= 3) {
                    if (containsPlanar && solvedActiveTypesCount === 1) {
                        this.currentCrossover = 'NONE';
                    } else {
                        this.currentCrossover = 'PASS';
                    }
                }
                this.updateCrossoverButtonsUI();
            }

            if (!this.wayOverride) {
                if (totalDrivers === 0) {
                    this.currentWay = 'UNK';
                } else if (totalDrivers === 1) {
                    this.currentWay = '1W';
                } else {
                    if (containsPlanar && solvedActiveTypesCount === 1) {
                        this.currentWay = '1W';
                    } else if (containsBA && solvedActiveTypesCount === 1) {
                        this.currentWay = '1W';
                    } else {
                        if (totalDrivers === 2) this.currentWay = '2W';
                        else if (totalDrivers === 3) this.currentWay = '3W';
                        else if (totalDrivers >= 4) this.currentWay = '4W';
                    }
                }
                this.updateWayButtonsUI();
            }

            this.updateDriverSummary();
        },
        toggleCustomTagMenu: function() {
            const menu = document.getElementById('menu-review-tag');
            if (menu) menu.classList.toggle('hidden');
        },

        renderReviewTagMenuOptions: function() {
            const menu = document.getElementById('menu-review-tag');
            if (!menu) return;
            menu.innerHTML = '';

            const groups = [
                {
                    label: 'Tonality',
                    tags: ['⚖️ Neutral', '✨ Bright', '🌿 Warm', '🌑 Dark', '🔺 V-Shape', '🪞 U-Shape', '🎯 Mid-Forward', '🌬️ Airy', '💎 Detailed', '☁️ Smooth', '🔥 Energetic', '😌 Relaxed']
                },
                {
                    label: 'Bass',
                    tags: ['💥 Basshead', '🌊 Deep Bass', '📳 Rumble', '🥊 Punchy', '🎯 Controlled', '🎈 Light Bass', '⚡ Fast Bass', '🪨 Thick Bass', '🧼 Clean Bass', '🫀 Slam']
                },
                {
                    label: 'Genres',
                    tags: ['📱 All-Rounder', '🎤 Vocal', '🎸 Rock', '⚡ EDM', '🎧 Hip-Hop', '🎹 Pop', '🎻 Classical', '🎷 Jazz', '🤠 Country', '🎼 Orchestra', '🎮 Gaming', '🎬 Movies', '🔬 Critical']
                }
            ];

            groups.forEach(g => {
                const header = document.createElement('div');
                header.className = "text-[9px] font-black uppercase text-amber-400 px-2 py-1 bg-black/40 border-y border-black mt-1";
                header.textContent = `--- ${g.label} ---`;
                menu.appendChild(header);

                g.tags.forEach(tag => {
                    const match = tag.match(/^(\p{Extended_Pictographic}+(?:\uFE0F|\uFE0E)?)/u);
                    let emoji = "🏷️";
                    let text = tag;
                    if (match) {
                        emoji = match[1];
                        text = tag.slice(emoji.length).trim();
                    }
                    const animClass = FindEngine.getTagAnimationClass ? FindEngine.getTagAnimationClass(text) : 'anim-match-float';

                    const div = document.createElement('div');
                    div.className = "px-2 py-1.5 hover:bg-[var(--bg-card)] hover:text-[var(--accent-blue)] cursor-pointer flex items-center gap-2 font-bold group transition-all text-xs";
                    div.onclick = () => {
                        IEM.addReviewTagFromSelect(tag);
                        IEM.toggleCustomTagMenu();
                    };
                    div.innerHTML = `
                        <span class="emoji-font vibrant-emoji ${animClass} text-lg flex-shrink-0 leading-none inline-block">${emoji}</span>
                        <span>${text}</span>
                    `;
                    menu.appendChild(div);
                });
            });
        },

        updateDriverSummary: function() {
            const r1Container = document.getElementById('driver-row-1');
            const r2Container = document.getElementById('driver-row-2');
            if (!r1Container || !r2Container) return;

            r1Container.innerHTML = '';
            r2Container.innerHTML = '';

            const row1List = [
                { type: 'DD', label: 'Dynamic', icon: 'dd.png' },
                { type: 'BA', label: 'Armature', icon: 'ba.png' },
                { type: 'Planar', label: 'Planar', icon: 'planar.png' }
            ];

            const row2List = [
                { type: 'BC', label: 'Bone Cond', icon: 'bc.png' },
                { type: 'EST', label: 'Electrostat', icon: 'est.png' },
                { type: 'PZT', label: 'Piezo', icon: 'pzt.png' },
                { type: 'MEMS', label: 'Micro', icon: 'mems.png' }
            ];

            const activeDict = this.selectedDriverTypes || {};
            let totalDrivers = 0;

            const renderItem = (d, container) => {
                const count = activeDict[d.type] || 0;
                const isActive = count > 0;
                if (isActive) {
                    totalDrivers += count;
                }

                const isRecentlyUpdated = (this.lastUpdatedDriverType === d.type);

                const div = document.createElement('div');
                div.className = 'flex flex-col items-center gap-1 select-none text-center bg-transparent border-none w-full relative transition-all cursor-default';

                div.innerHTML = `
                    <div class="flex flex-col items-center leading-none overflow-visible">
                        <img src="app/icons/${d.icon}" class="w-11 h-11 object-contain select-none transition-transform hover:scale-110 overflow-visible ${isRecentlyUpdated ? 'driver-pulse-active' : ''}" style="transform-origin: center;">
                        <span class="text-xs font-black tracking-wide mt-1 transition-colors ${isActive ? 'text-[var(--accent-blue)]' : 'text-zinc-400'}">${count} ${d.type}</span>
                    </div>

                    <div class="flex items-center justify-center gap-1 w-full max-w-[64px] mt-1">
                        <button type="button" onclick="IEM.decrementDriver('${d.type}')" class="w-7 h-6 flex items-center justify-center text-xs font-black text-red-400 bg-[var(--bg-card)] border-2 border-black active:translate-y-[1px] select-none cursor-pointer ${!isActive ? 'opacity-20 pointer-events-none' : ''}" style="box-shadow: 2px 2px 0px 0px #000000 !important;">−</button>
                        <button type="button" onclick="IEM.incrementDriver('${d.type}')" class="w-7 h-6 flex items-center justify-center text-xs font-black text-emerald-400 bg-[var(--bg-card)] border-2 border-black active:translate-y-[1px] select-none cursor-pointer" style="box-shadow: 2px 2px 0px 0px #000000 !important;">+</button>
                    </div>
                `;
                container.appendChild(div);
            };

            row1List.forEach(d => renderItem(d, r1Container));
            row2List.forEach(d => renderItem(d, r2Container));

            this.lastUpdatedDriverType = null;
            const badge = document.getElementById('driver-header-count-badge');
            if (badge) badge.textContent = totalDrivers + " Units";

            this.renderReviewTagMenuOptions();
            this.updateAll();
        },
        getDriverBreakdownText: function() {
            const parts = [];
            Object.entries(this.selectedDriverTypes).forEach(([type, count]) => {
                if (count > 0) parts.push(`${count}x ${type}`);
            });
            return parts.length > 0 ? parts.join(' + ') : '0 Drivers';
        },
        createTags: function(containerId, tagsArray, selectedSet) {
         const container = document.getElementById(containerId);
         if (!container) return;
         container.innerHTML = '';
            tagsArray.forEach(tag => {
                const div = document.createElement('div'); div.className = `tag`; div.innerHTML = `<span>${tag.name}</span>`;
                if (selectedSet.has(tag.name)) {
                    div.classList.add('active');
                }
                div.onclick = () => {
                    if (selectedSet.has(tag.name)) {
                        selectedSet.delete(tag.name);
                        div.classList.remove('active');
                    } else {
                        const totalSelected = this.selectedTags.size + this.selectedGenres.size + this.selectedBass.size;
                        if (totalSelected >= 4) {
                            showToast("Limit: Maximum of 4 signature tags active for export.", "⚠️");
                            return;
                        }
                        selectedSet.add(tag.name);
                        div.classList.add('active');
                    }
                    this.updateAll();
                };
                container.appendChild(div);
            });
        },
        downsampleImage: function(imgObj, maxDim = 400) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            let w = imgObj.width;
            let h = imgObj.height;

            if (w > maxDim || h > maxDim) {
                if (w > h) {
                    h = Math.round((h * maxDim) / w);
                    w = maxDim;
                } else {
                    w = Math.round((w * maxDim) / h);
                    h = maxDim;
                }
            }

            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(imgObj, 0, 0, w, h);

            return canvas.toDataURL('image/jpeg', 0.75);
        },

        handleImageUpload: function(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            this.rawImageObj = new Image();
            this.rawImageObj.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let w = this.rawImageObj.width;
                let h = this.rawImageObj.height;
                const maxDim = 400;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                    else { w = Math.round((w * maxDim) / h); h = maxDim; }
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(this.rawImageObj, 0, 0, w, h);

                canvas.toBlob((blob) => {
                    if (this.currentImage && this.currentImage.startsWith('blob:')) {
                        URL.revokeObjectURL(this.currentImage);
                    }
                    this.currentImageBlob = blob;
                    this.currentImage = URL.createObjectURL(blob);

                    const compressedImg = new Image();
                    compressedImg.onload = () => {
                        this.rawImageObj = compressedImg;
                        this.imgScale = 1.0;
                        this.imgOffsetX = 0;
                        this.imgOffsetY = 0;
                        this.processedCanvas = null;

                        const slider = document.getElementById('image-zoom-slider');
                        if (slider) slider.value = 1.0;

                        document.getElementById('image-preview-canvas').classList.remove('hidden');
                        document.getElementById('image-controls-bar').classList.remove('hidden');
                        document.getElementById('image-clear-btn').classList.remove('hidden');
                        document.getElementById('upload-placeholder').classList.add('hidden');

                        const checkbox = document.getElementById('image-transparency-chk');
                        if (checkbox && checkbox.checked) {
                            this.preProcessImage();
                        } else {
                            this.renderImagePreview();
                        }
                    };
                    compressedImg.src = this.currentImage;
                }, 'image/jpeg', 0.75);
            };
            this.rawImageObj.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    },
        clearImage: function(e) {
        if (e) e.stopPropagation();
        if (this.currentImage && this.currentImage.startsWith('blob:')) {
            URL.revokeObjectURL(this.currentImage);
        }
        this.currentImage = null;
        this.currentImageBlob = null;
        this.rawImageObj = null;
        this.processedCanvas = null;
        const uploadInput = document.getElementById('image-upload');
        if (uploadInput) uploadInput.value = '';

        const canvas = document.getElementById('image-preview-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.classList.add('hidden');
        }

        document.getElementById('image-controls-bar').classList.add('hidden');
        document.getElementById('image-clear-btn').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
        this.updateConfidence();
    },
        // Restore an image saved in a library profile or imported JSON. The
        // stored value may be a data URL / path string OR a raw Blob (IndexedDB
        // preserves Blobs; saveToLibrary stores currentImageBlob). Assigning a
        // Blob to img.src coerces to "[object Blob]" and onload never fires, so
        // Blob values get an object URL. Tracked for revocation on replace.
        _restoreStoredImage: function(value) {
            if (!value) { this.clearImage(); return; }
            if (this.currentImage && this.currentImage.startsWith('blob:') && !(value instanceof Blob)) {
                try { URL.revokeObjectURL(this.currentImage); } catch (_) {}
            }
            const isBlob = (typeof Blob !== 'undefined') && (value instanceof Blob);
            this.currentImage = isBlob ? URL.createObjectURL(value) : value;
            this.rawImageObj = new Image();
            this.rawImageObj.onload = () => {
                document.getElementById('image-preview-canvas').classList.remove('hidden');
                document.getElementById('image-controls-bar').classList.remove('hidden');
                document.getElementById('image-clear-btn').classList.remove('hidden');
                document.getElementById('upload-placeholder').classList.add('hidden');
                this.renderImagePreview();
            };
            this.rawImageObj.onerror = () => {
                console.warn("[IEM] Stored image failed to load — clearing preview.");
                this.clearImage();
            };
            this.rawImageObj.src = this.currentImage;
        },
        initImageControls: function() {
            const wrapper = document.getElementById('image-preview-container');
            if (!wrapper) return;

            let isDragging = false;
            let startX = 0;
            let startY = 0;

            const handleDown = (e) => {
                if (!this.rawImageObj) return;
                isDragging = true;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                startX = clientX - this.imgOffsetX;
                startY = clientY - this.imgOffsetY;
                wrapper.style.cursor = 'grabbing';
                e.preventDefault();
            };

            const handleMove = (e) => {
                if (!isDragging) return;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                this.imgOffsetX = clientX - startX;
                this.imgOffsetY = clientY - startY;
                this.renderImagePreview();
            };

            const handleUp = () => {
                isDragging = false;
                wrapper.style.cursor = 'grab';
            };

            wrapper.addEventListener('mousedown', handleDown);
            wrapper.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);

            wrapper.addEventListener('touchstart', handleDown, { passive: false });
            wrapper.addEventListener('touchmove', handleMove, { passive: false });
            window.addEventListener('touchend', handleUp);

            wrapper.addEventListener('wheel', (e) => {
                if (!this.rawImageObj) return;
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.08 : 0.92;
                this.imgScale = Math.max(0.2, Math.min(8.0, this.imgScale * factor));
                const slider = document.getElementById('image-zoom-slider');
                if (slider) slider.value = this.imgScale;
                this.renderImagePreview();
            }, { passive: false });
        },
        handleZoomSlider: function(val) {
            this.imgScale = parseFloat(val);
            this.renderImagePreview();
        },
        recenterImage: function() {
            this.imgScale = 1.0;
            this.imgOffsetX = 0;
            this.imgOffsetY = 0;
            const slider = document.getElementById('image-zoom-slider');
            if (slider) slider.value = 1.0;
            this.renderImagePreview();
        },
        preProcessImage: function() {
            if (!this.rawImageObj) return;

            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');

            const maxDimension = 800;
            let w = this.rawImageObj.width;
            let h = this.rawImageObj.height;
            if (w > maxDimension || h > maxDimension) {
                if (w > h) {
                    h = Math.round((h * maxDimension) / w);
                    w = maxDimension;
                } else {
                    w = Math.round((w * maxDimension) / h);
                    h = maxDimension;
                }
            }

            tempCanvas.width = w;
            tempCanvas.height = h;

            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(this.rawImageObj, 0, 0, w, h);

            let imgData = tempCtx.getImageData(0, 0, w, h);
            imgData = this.processWhiteBgRemoval(imgData);
            tempCtx.putImageData(imgData, 0, 0);

            this.processedCanvas = tempCanvas;
            this.renderImagePreview();
        },
        toggleBgRemoval: function(checked) {
            this.removeWhiteBg = checked;
            if (this.removeWhiteBg && !this.processedCanvas) {
                this.preProcessImage();
            } else {
                this.renderImagePreview();
            }
        },
        processWhiteBgRemoval: function(imgData) {
            const data = imgData.data;
            const w = imgData.width;
            const h = imgData.height;
            const isBg = new Uint8Array(w * h);
            const queue = [];

            const isNearWhiteFlood = (r, g, b) => {
                const distSq = (255 - r)**2 + (255 - g)**2 + (255 - b)**2;
                return distSq < 8100;
            };

            const isGloballyWhite = (r, g, b) => {
                const maxVal = Math.max(r, g, b);
                return (255 - maxVal) < 22;
            };

            for (let x = 0; x < w; x++) {
                let idxTop = x * 4;
                if (isNearWhiteFlood(data[idxTop], data[idxTop+1], data[idxTop+2])) {
                    isBg[x] = 1;
                    queue.push(x);
                }
                let idxBot = ((h - 1) * w + x) * 4;
                if (isNearWhiteFlood(data[idxBot], data[idxBot+1], data[idxBot+2])) {
                    isBg[(h - 1) * w + x] = 1;
                    queue.push((h - 1) * w + x);
                }
            }
            for (let y = 1; y < h - 1; y++) {
                let idxLeft = (y * w) * 4;
                if (isNearWhiteFlood(data[idxLeft], data[idxLeft+1], data[idxLeft+2])) {
                    isBg[y * w] = 1;
                    queue.push(y * w);
                }
                let idxRight = (y * w + w - 1) * 4;
                if (isNearWhiteFlood(data[idxRight], data[idxRight+1], data[idxRight+2])) {
                    isBg[y * w + w - 1] = 1;
                    queue.push(y * w + w - 1);
                }
            }

            let qHead = 0;
            while (qHead < queue.length) {
                const curr = queue[qHead++];
                const cx = curr % w;
                const cy = Math.floor(curr / w);

                for (let i = 0; i < 4; i++) {
                    const nx = cx + (i === 0 ? -1 : i === 1 ? 1 : 0);
                    const ny = cy + (i === 2 ? -1 : i === 3 ? 1 : 0);

                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nIdx = ny * w + nx;
                        if (isBg[nIdx] === 0) {
                            const pixelIdx = nIdx * 4;
                            if (isNearWhiteFlood(data[pixelIdx], data[pixelIdx+1], data[pixelIdx+2])) {
                                isBg[nIdx] = 1;
                                queue.push(nIdx);
                            }
                        }
                    }
                }
            }

            for (let i = 0; i < w * h; i++) {
                if (isBg[i]) {
                    data[i * 4 + 3] = 0;
                }
            }

            const minThreshold = 15;
            const maxThreshold = 55;
            const range = maxThreshold - minThreshold;

            for (let i = 0; i < w * h; i++) {
                const pixelIdx = i * 4;
                const r = data[pixelIdx];
                const g = data[pixelIdx+1];
                const b = data[pixelIdx+2];

                const maxVal = Math.max(r, g, b);
                const diffToWhite = 255 - maxVal;

                if (diffToWhite <= minThreshold) {
                    data[pixelIdx+3] = 0;
                } else if (diffToWhite < maxThreshold) {
                    const factor = (diffToWhite - minThreshold) / range;
                    data[pixelIdx+3] = Math.min(data[pixelIdx+3], Math.round(factor * 255));
                }
            }

            const tempAlpha = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
                tempAlpha[i] = data[i * 4 + 3];
            }

            const horizontalBlurred = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = y * w + x;
                    horizontalBlurred[idx] = Math.round((tempAlpha[idx - 1] + tempAlpha[idx] + tempAlpha[idx + 1]) / 3);
                }
            }

            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const idx = y * w + x;
                    if (tempAlpha[idx] < 255) {
                        data[idx * 4 + 3] = Math.round((horizontalBlurred[idx - w] + horizontalBlurred[idx] + horizontalBlurred[idx + w]) / 3);
                    }
                }
            }
            return imgData;
        },
        renderImagePreview: function() {
            if (this.imageDrawPending) return;
            this.imageDrawPending = true;
            requestAnimationFrame(() => {
                this.imageDrawPending = false;
                this.renderImagePreviewInternal();
            });
        },
        renderImagePreviewInternal: function() {
            const canvas = document.getElementById('image-preview-canvas');
            if (!canvas || !this.rawImageObj) return;
            const ctx = canvas.getContext('2d');

            const rect = canvas.parentNode.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const img = (this.removeWhiteBg && this.processedCanvas) ? this.processedCanvas : this.rawImageObj;
            const iw = img.width;
            const ih = img.height;
            const cw = canvas.width;
            const ch = canvas.height;

            const rImg = iw / ih;
            const rCvs = cw / ch;
            let drawW = cw;
            let drawH = ch;
            if (rImg > rCvs) {
                drawH = cw / rImg;
            } else {
                drawW = ch * rImg;
            }

            ctx.save();
            ctx.translate(cw / 2 + this.imgOffsetX, ch / 2 + this.imgOffsetY);
            ctx.scale(this.imgScale, this.imgScale);
            ctx.translate(-drawW / 2, -drawH / 2);
            ctx.drawImage(img, 0, 0, drawW, drawH);
            ctx.restore();
        },
        updateConfidence: function() {
        },
        updateAll: function() {
            let totalScore = 0; let count = 0; let valMap = {};
            const acousticSliders = [
                'bass', 'sub-bass-extension', 'mid-bass-punch', 'bass-texture', 'bass-speed',
                'lower-mids', 'upper-mids', 'vocals', 'vocal-fullness', 'mid-naturalness',
                'treble-energy', 'treble-smooth', 'treble-extension', 'sibilance', 'treble-detail',
                'soundstage-width', 'soundstage-depth', 'resolution-detail', 'macro-dynamics',
                'imaging-precision', 'instrument-separation', 'timbre-coherence'
            ];
            this.sliderNodes.forEach(node => {
                let val = parseFloat(node.element.value);

                if (Math.abs(val) <= 0.05) {
                    val = 0.0;
                    node.element.value = "0.0";
                }

                const normVal = (val + 10) / 2;
                valMap[node.element.id] = normVal;
                if (node.displayValueNode) {
                    node.displayValueNode.textContent = (val >= 0 ? "+" : "") + val.toFixed(1);
                    if (acousticSliders.includes(node.element.id)) {
                        totalScore += normVal;
                        count++;
                    }
                }
                // Repaint the bipolar fill here: DB profile fills, library loads
                // and resets set .value programmatically (no input event fires),
                // and the old polling tick that used to mask this gap was
                // removed. paintSliderTrack skips identical gradients, so the
                // per-node cost on manual drags is a string compare.
                if (window.paintSliderTrack) window.paintSliderTrack(node.element);
                else if (window.syncGlobalSliders) window.syncGlobalSliders(node.element);
            });
            const avg = (...ids) => ids.reduce((sum, id) => sum + (valMap[id] !== undefined ? valMap[id] : 5.0), 0) / ids.length;

            let impVal = parseFloat(document.getElementById('impedance').value);
            if (isNaN(impVal) || impVal <= 0) impVal = 5;
            let sensVal = parseFloat(document.getElementById('sensitivity').value);
            if (isNaN(sensVal)) sensVal = 80;

            this.updateGauge('impedance', impVal);
            this.updateGauge('sensitivity', sensVal);

            if (window.EQ && EQ.applySourceSimulation) {
                EQ.applySourceSimulation();
            }

            const dacImpedances = {
                'Phone': 6.0,
                'Laptop': 3.5,
                'Dongle': 1.0,
                'Desktop': 0.1
            };
            const dacLimits = {
                'Phone': { v: 0.4, p: 8 },
                'Laptop': { v: 1.0, p: 30 },
                'Dongle': { v: 2.0, p: 100 },
                'Desktop': { v: 4.0, p: 1000 }
            };

            const activeDacName = this.dacTiers[this.currentDacIdx];
            const dac = dacLimits[activeDacName] || dacLimits['Dongle'];
            const Rs = dacImpedances[activeDacName] || 1.0;

            let pReqIem, vReqIem;
            if (this.sensUnit === 'V') {
                vReqIem = Math.pow(10, (115 - sensVal) / 20);
                pReqIem = (vReqIem * vReqIem / impVal) * 1000;
            } else {
                pReqIem = Math.pow(10, (115 - sensVal) / 10);
                vReqIem = Math.sqrt((pReqIem * impVal) / 1000);
            }

            const vDivider = impVal / (impVal + Rs);
            const vReqSource = vReqIem / vDivider;

            const pDrawnSource = (vReqSource * vReqSource) / (impVal + Rs) * 1000;

            const dampingFactor = impVal / Rs;

            const voltageRatio = vReqSource / dac.v;
            const powerRatio = pDrawnSource / dac.p;

            let compatColor = '#ef4444';
            if (voltageRatio <= 1.0 && powerRatio <= 1.0) {
                compatColor = '#10b981';
            } else if (voltageRatio <= 1.5 && powerRatio <= 1.5) {
                compatColor = '#22c55e';
            } else if (voltageRatio <= 2 && powerRatio <= 2) {
                compatColor = '#f59e0b';
            }

            let matchText = '';
            let matchClass = '';

            if (voltageRatio <= 1.0 && powerRatio <= 1.0) {
                matchText = '✅ Good Match';
                matchClass = 'anim-good-match';
            } else if (voltageRatio <= 1.5 && powerRatio <= 1.5) {
                matchText = '🟡 Okay Match';
                matchClass = 'anim-okay-match';
            } else if (voltageRatio <= 2.0 && powerRatio <= 2.0) {
                matchText = '⚠️ Risky Match';
                matchClass = 'anim-risky-match';
            } else {
                matchText = '❌ Poor Match';
                matchClass = 'anim-poor-match';
            }

            let bassText = '';
            let bassClass = '';

            if (dampingFactor >= 20) {
                bassText = '🎯 Tight Bass';
                bassClass = 'anim-tight-bass';
            } else if (dampingFactor >= 12) {
                bassText = '🥊 Punchy Bass';
                bassClass = 'anim-punchy-bass';
            } else if (dampingFactor >= 6) {
                bassText = '🫧 Warm Bass';
                bassClass = 'anim-warm-bass';
            } else if (dampingFactor >= 4) {
                bassText = '🌊 Deep Bass';
                bassClass = 'anim-deep-bass';
            } else if (dampingFactor >= 1.5) {
                bassText = '🌫️ Bloated Bass';
                bassClass = 'anim-bloated-bass';
            } else {
                bassText = '🥀 Weak Bass';
                bassClass = 'anim-weak-bass';
            }

            const vValNode = document.getElementById('voltage-value');
            const pValNode = document.getElementById('power-value');
            const compatBarNode = document.getElementById('compatibility-bar');
            const statusNode = document.getElementById('compatibility-status');

            if (vValNode) vValNode.textContent = vReqSource.toFixed(2) + " V";
            if (pValNode) pDrawnSource === Infinity ? pValNode.textContent = "0.0 mW" : pValNode.textContent = pDrawnSource.toFixed(1) + " mW";

            if (statusNode) {
                statusNode.innerHTML = `<span class="${matchClass} text-sm sm:text-base">${matchText}</span>`;
            }

            const maxRatio = Math.max(voltageRatio, powerRatio);
            let compPercent = 100;
            let compColor = '#10b981';

            if (maxRatio <= 1.0) {

                compPercent = Math.round(100 - (maxRatio * 25));
                compColor = compPercent > 82 ? '#10b981' : '#84cc16';
            } else if (maxRatio <= 2.0) {

                compPercent = Math.round(75 - ((maxRatio - 1.0) * 50));
                compColor = '#f59e0b';
            } else {

                compPercent = Math.round(Math.max(3, 25 - ((maxRatio - 2.0) * 10)));
                compColor = '#ef4444';
            }

            if (compatBarNode) {
                compatBarNode.style.width = compPercent + '%';
                compatBarNode.style.backgroundColor = compColor;
            }

            const powerIconEmoji = document.getElementById('power-icon-emoji');
            if (powerIconEmoji) {
                powerIconEmoji.textContent = '🔋';
            }

            if (statusNode) {
                statusNode.innerHTML = `<span class="${matchClass}">${matchText}</span>`;
            }

            const notesInput = document.getElementById('review-notes');
            const counter = document.getElementById('notes-counter');
            if (notesInput && counter) {
                const len = notesInput.value.length;
                counter.textContent = `${len}/150`;
                if (len >= 135) {
                    counter.classList.remove('text-zinc-500', 'text-amber-500');
                    counter.classList.add('text-red-500', 'animate-pulse');
                } else if (len >= 100) {
                    counter.classList.remove('text-zinc-500', 'text-red-500', 'animate-pulse');
                    counter.classList.add('text-amber-500');
                } else {
                    counter.classList.remove('text-red-500', 'text-amber-500', 'animate-pulse');
                    counter.classList.add('text-zinc-500');
                }
            }

            const finalScore = count > 0 ? (totalScore / count).toFixed(1) : 5.0;
            const scoreVal = parseFloat(finalScore);
            const scoreEl = document.getElementById('overall-score');
            if (scoreEl) {
                scoreEl.textContent = finalScore;

                scoreEl.classList.remove('text-blue-500', 'text-red-500', 'text-amber-500', 'text-emerald-500');

                if (scoreVal < 5.0) {
                    scoreEl.classList.add('text-red-500');
                } else if (scoreVal < 7.0) {
                    scoreEl.classList.add('text-amber-500');
                } else if (scoreVal < 8.5) {
                    scoreEl.classList.add('text-emerald-500');
                } else {
                    scoreEl.classList.add('text-blue-500');
                }
            }
            const techScore = avg('resolution-detail', 'imaging-precision', 'macro-dynamics', 'instrument-separation');
            const toneScore = avg('timbre-coherence', 'mid-naturalness', 'vocals', 'treble-smooth');
            const bassScore = avg('bass', 'sub-bass-extension', 'mid-bass-punch');
            const trebleScore = avg('treble-energy', 'treble-detail', 'sibilance');

            const badge = document.getElementById('bias-badge');
            let biasStr, biasClass;

            const unifiedBiasClass = 'text-xs uppercase tracking-wider font-black px-3 py-1 rounded-none bg-[var(--bg-input)] border-2 border-black text-[var(--text-main)] w-full text-center transition-all shadow-[2px_2px_0px_0px_#000]';

            if (bassScore > toneScore + 1.2 && bassScore > techScore + 1.2) {
                biasStr = '💥 Basshead & Warm Bias';
            } else if (trebleScore > toneScore + 1.2 && trebleScore > bassScore + 1.0) {
                biasStr = '✨ Bright / V-Shape Bias';
            } else if (techScore > toneScore + 0.5) {
                biasStr = '🔬 Analytical & Technical Bias';
            } else if (toneScore > techScore + 0.5) {
                biasStr = '🎵 Musical & Natural Bias';
            } else {
                biasStr = '⚖️ Neutral';
            }
            biasClass = unifiedBiasClass;
            if(badge) { badge.innerHTML = biasStr; badge.className = biasClass; }
if(this.radarChart) {
                const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                const activeThemeConfig = (window.App && App.themeMap && App.themeMap[savedThemeId]) || {};
                const themeVars = activeThemeConfig.variables || {};
                const accentColor = activeThemeConfig.accent || themeVars['--accent-blue'] || '#6488b0';
                this.radarChart.data.datasets[0].borderColor = accentColor;
                this.radarChart.data.datasets[0].pointBackgroundColor = accentColor;
                this.radarChart.data.datasets[0].backgroundColor = accentColor + '22';
                if (this.radarChart.options && this.radarChart.options.scales && this.radarChart.options.scales.r) {
                    this.radarChart.options.scales.r.pointLabels.color = themeVars['--text-main'] || '#f0f0f4';
                    if (themeVars['--text-secondary']) {
                        this.radarChart.options.scales.r.grid.color = themeVars['--text-secondary'] + '40';
                        this.radarChart.options.scales.r.angleLines.color = themeVars['--text-secondary'] + '40';
                    }
                }
                this.radarChart.data.datasets[0].data = [
                    avg('bass', 'sub-bass-extension', 'bass-texture', 'bass-speed', 'mid-bass-punch'), avg('vocals', 'vocal-fullness', 'lower-mids', 'upper-mids', 'mid-naturalness'),
                    avg('treble-energy', 'treble-smooth', 'treble-extension', 'sibilance', 'treble-detail'), valMap['resolution-detail'], avg('soundstage-width', 'soundstage-depth'),
                    valMap['imaging-precision'], valMap['macro-dynamics'], avg('vocals', 'mid-naturalness', 'treble-smooth', 'timbre-coherence'), avg('instrument-separation', 'timbre-coherence', 'ease-of-drive', 'driver-flex')
                ];
                this.radarChart.update('none');
            }

            if (window.EQ) {
                EQ.drawCurve();
            }

            return finalScore;
        },
        getLibrary: async function() {
            return await DBCache.getAllReviews();
        },
        saveToLibrary: async function() {
        const brand = document.getElementById('brand').value.trim(); const model = document.getElementById('model').value.trim();
        if(!brand || !model) { showToast("Enter a Brand and Model name before saving.", "⚠️"); return; }
        await this.ensureChartReady();

        const finalScore = this.updateAll(); const id = `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const sliderValues = {}; this.sliderNodes.forEach(n => { if (n.element.id) sliderValues[n.element.id] = n.element.value; });

        const profile = { id, brand, model, score: parseFloat(finalScore), price: document.getElementById('price').value, impedance: document.getElementById('impedance').value, sensitivity: document.getElementById('sensitivity').value, sensUnit: this.sensUnit || 'mW', image: this.currentImageBlob || this.currentImage, notes: document.getElementById('review-notes').value, refVolume: document.getElementById('listening-volume').value, selectedTags: Array.from(this.selectedTags), selectedGenres: Array.from(this.selectedGenres), selectedBass: Array.from(this.selectedBass), sliders: sliderValues, selectedDriverTypes: this.selectedDriverTypes, formFactor: this.formFactor || 'IEM', connector: this.connector || '2-pin', timestamp: Date.now(), radarData: Array.from(this.radarChart.data.datasets[0].data), toneData: (typeof Tone_Module !== 'undefined' && Tone_Module.getState) ? Tone_Module.getState() : null, eqData: (typeof EQ_Module !== 'undefined' && EQ_Module.getRealValues) ? EQ_Module.getRealValues() : null };

        const success = await DBCache.saveReview(profile);
        if (success) {
            showToast(`Saved ${brand} ${model} to Library inventory.`, "💾");
            await this.renderLibrary();
        } else {
            showToast("Database write failed.", "⚠️");
        }
    },
        renderLibrary: async function() {
            const searchInput = document.getElementById('lib-search');
            const searchVal = (searchInput ? searchInput.value : '').toLowerCase();
            const rawLibrary = await this.getLibrary();
            const library = rawLibrary.filter(item => {

                if (!item || !item.brand || !item.model) return false;
                const searchableText = `${item.brand} ${item.model} ${item.notes || ''}`;
                return PEQDB_Module.matchSearchTokens(searchableText, searchVal);
            }).sort((a, b) => (b.score || 0) - (a.score || 0));

            const tbody = document.getElementById('library-table-body');
            const emptyState = document.getElementById('library-empty');
            if (!tbody) return;

            tbody.innerHTML = '';
            if(library.length === 0) {
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }
            if (emptyState) emptyState.classList.add('hidden');

            if (this.libraryObjectURLs) {
                this.libraryObjectURLs.forEach(url => URL.revokeObjectURL(url));
            }
            this.libraryObjectURLs = [];

            const fragment = document.createDocumentFragment();
            library.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-[var(--bg-input)] transition-all";

                let imgPath = '';
                if (item.image) {
                    if (item.image instanceof Blob) {
                        const url = URL.createObjectURL(item.image);
                        this.libraryObjectURLs.push(url);
                        imgPath = url;
                    } else {
                        imgPath = item.image;
                    }
                }

                const esc = (str) => String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                const safeId = esc(item.id);
                const safeImg = esc(imgPath);
                const safeBrand = esc(item.brand);
                const safeModel = esc(item.model);

                tr.innerHTML = `
                    <td class="px-4 py-3"><input type="checkbox" class="compare-cb accent-blue-500 w-4 h-4 cursor-pointer" value="${safeId}"></td>
                    <td class="px-4 py-3 font-semibold text-[var(--text-main)] flex items-center gap-3">
                        <span class="text-[var(--text-secondary)] font-mono text-xs w-4">#${idx+1}</span>
                        ${imgPath ? `<img src="${safeImg}" class="w-8 h-8 object-cover rounded border border-[var(--border-color)] bg-[#111]">` : '<div class="w-8 h-8 rounded border border-[var(--border-color)] bg-[#111] flex items-center justify-center text-zinc-650">🎧</div>'}
                        <div>
                            <div class="text-xs">${safeBrand} <span class="text-[var(--accent-blue)]">${safeModel}</span></div>
                            <div class="text-xs text-[var(--text-secondary)] font-normal mt-0.5">$${item.price || '---'} • Vol: ${item.refVolume || 'N/A'}</div>
                        </div>
                    </td>
                    <td class="px-4 py-3 font-black text-md text-center text-[var(--accent-blue)]">${(item.score || 5.0).toFixed(1)}</td>
                    <td class="px-4 py-3 text-right">
                        <button onclick="IEM.loadFromLibrary('${item.id}')" class="px-3 py-1 bg-zinc-800 text-stone-200 rounded text-xs font-bold hover:bg-zinc-700 transition-colors shadow-sm">Load</button>
                        <button onclick="IEM.deleteFromLibrary('${item.id}')" class="ml-2.5 text-red-500 hover:text-red-400 cursor-pointer text-[8px]">❌</button>
                    </td>`;
                fragment.appendChild(tr);
            });

            requestAnimationFrame(() => {
                tbody.appendChild(fragment);
            });
        },
        toggleLibraryModal: async function() { const modal = document.getElementById('library-modal'); if(modal.classList.contains('hidden')) { modal.classList.remove('hidden'); this.closeCompare(); await this.renderLibrary(); } else { modal.classList.add('hidden'); } },
        loadFromLibrary: async function(id) {
            const profile = await DBCache.getReview(id); if(!profile) return;
            document.getElementById('brand').value = profile.brand || ''; document.getElementById('model').value = profile.model || ''; document.getElementById('price').value = profile.price || ''; document.getElementById('impedance').value = profile.impedance || '32'; document.getElementById('sensitivity').value = profile.sensitivity || '110'; document.getElementById('review-notes').value = profile.notes || ''; if(profile.refVolume) this.setListeningVolume(profile.refVolume);
            if (profile.formFactor) this.setFormFactor(profile.formFactor);
            if (profile.connector) this.setConnector(profile.connector);
            if (profile.image) {
                this._restoreStoredImage(profile.image);
            } else {
                this.clearImage();
            }

            // Restore the sensitivity unit the profile was saved with — dB/mW
            // and dB/V readings differ by ~10*log10(1000/Z), so guessing the
            // unit silently corrupts every downstream power calculation.
            if (profile.sensUnit && (profile.sensUnit === 'mW' || profile.sensUnit === 'V')) {
                this.sensUnit = profile.sensUnit;
                this.updateSensUnitUI();
            }

            this.selectedDriverTypes = profile.selectedDriverTypes || {};
            this.runDriverAutoLogic();

            this.selectedTags = new Set(profile.selectedTags || []); this.createTags('tonality-tags', this.tonalityTags, this.selectedTags); this.selectedGenres = new Set(profile.selectedGenres || []); this.createTags('genre-tags', this.genreTags, this.selectedGenres); this.selectedBass = new Set(profile.selectedBass || []); this.createTags('bass-tags', this.bassTags, this.selectedBass);
            if (profile.sliders) {
                this.sliderNodes.forEach(n => {
                    if (profile.sliders[n.element.id] !== undefined) {
                        n.element.value = profile.sliders[n.element.id];
                    }
                });
            }
            if (profile.toneData && typeof Tone_Module !== 'undefined' && Tone_Module.loadState) Tone_Module.loadState(profile.toneData);
if (profile.eqData && typeof EQ_Module !== 'undefined' && EQ_Module.loadValues) EQ_Module.loadValues(profile.eqData);
else if (typeof EQ_Module !== 'undefined' && EQ_Module.applyPreset) EQ_Module.applyPreset('balanced');
            this.updateAll(); this.toggleLibraryModal();
        },
        deleteFromLibrary: async function(id) { if(!confirm("Are you sure you want to delete this profile?")) return; await DBCache.deleteReview(id); await this.renderLibrary(); },
        compareSelected: async function() {
            const checkboxes = document.querySelectorAll('.compare-cb:checked'); if(checkboxes.length < 2 || checkboxes.length > 4) { alert("Please select between 2 and 4 IEMs to compare."); return; }
            const library = await this.getLibrary(); const selected = Array.from(checkboxes).map(cb => library.find(i => i.id === cb.value));
            document.getElementById('library-table').classList.add('hidden'); const compView = document.getElementById('compare-view'); const compGrid = document.getElementById('compare-grid');
            compGrid.innerHTML = '';
            let _compHtml = '';

            selected.forEach(item => {
                let imgPath = '';
                if (item.image) {
                    if (item.image instanceof Blob) {
                        const url = URL.createObjectURL(item.image);
                        this.libraryObjectURLs.push(url);
                        imgPath = url;
                    } else {
                        imgPath = item.image;
                    }
                }

                const esc = (str) => String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                const safeImg = esc(imgPath);

                const radar = Array.isArray(item.radarData) ? item.radarData : [];
                const rd = (i) => (typeof radar[i] === 'number' && isFinite(radar[i])) ? radar[i].toFixed(1) : '--';
                const scoreVal = (typeof item.score === 'number' && isFinite(item.score)) ? item.score.toFixed(1) : '--';
                const brandEsc = esc(item.brand); const modelEsc = esc(item.model);
                const axes = [['Bass',0],['Mids',1],['Treble',2],['Detail',3],['Stage',4],['Imaging',5],['Dynamics',6],['Tonality',7],['Tech',8]];
                const axisRows = axes.map(([label, i]) => `<div class="flex justify-between border-b border-[var(--border-color)] pb-0.5"><span class="text-zinc-500">${label}</span><span class="text-[var(--text-main)]">${rd(i)}</span></div>`).join('');
                _compHtml += `<div class="bg-[var(--bg-input)] border border-[var(--border-color)] rounded p-4 flex flex-col items-center shadow relative"><div class="absolute top-2 left-2 text-xs text-[var(--text-secondary)] font-mono border border-[var(--border-color)] px-1.5 rounded">$${esc(item.price || '--')}</div>${imgPath ? `<img src="${safeImg}" class="h-20 object-contain mb-3 rounded bg-[#111] p-1 border border-[var(--border-color)]">` : `<div class="h-20 w-20 bg-[#111] rounded flex items-center justify-center mb-3 text-zinc-650 border border-[var(--border-color)]">🎧</div>`}<h3 class="font-bold text-xs text-center leading-tight">${brandEsc}<br><span class="text-[var(--accent-blue)] text-sm">${modelEsc}</span></h3><div class="text-3xl font-black mt-2 text-[var(--text-main)] tracking-tighter">${scoreVal}</div><div class="w-full mt-4 space-y-1 text-xs font-semibold">${axisRows}</div></div>`;
            });
            compGrid.innerHTML = _compHtml;
            compView.classList.remove('hidden'); compView.classList.add('flex');
        },
        closeCompare: function() { document.getElementById('library-table').classList.remove('hidden'); document.getElementById('compare-view').classList.add('hidden'); document.getElementById('compare-view').classList.remove('flex'); },
        resetAll: function() {
            if(!confirm("Clear all current workspace data?")) return;

            const preservedKeys = ['iem_library_v2', 'settings_theme_id', 'settings_font_id', 'settings_align_hz', 'settings_align_db'];
            const preserved = {};
            preservedKeys.forEach(k => { preserved[k] = localStorage.getItem(k); });
            localStorage.clear();
            preservedKeys.forEach(k => { if (preserved[k]) localStorage.setItem(k, preserved[k]); });

            this.sliderNodes.forEach(n => { n.element.value = 0.0; });
            document.getElementById('review-notes').value = '';
            document.getElementById('brand').value = '';
            document.getElementById('model').value = '';
            document.getElementById('price').value = '';
            this.setListeningVolume('moderate');
            document.getElementById('impedance').value = '5';
            document.getElementById('sensitivity').value = '80';

            this.clearImage();

            this.selectedTags.clear(); this.selectedGenres.clear(); this.selectedBass.clear();
            this.selectedDriverTypes = {};
            this.setFormFactor('IEM');
            this.setConnector('2-pin');
            this.crossoverOverride = false;
            this.wayOverride = false;
            this.currentCrossover = 'UNK';
            this.currentWay = 'UNK';
            this.updateCrossoverButtonsUI();
            this.updateWayButtonsUI();
            this.runDriverAutoLogic();
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);

            Tone_Module.reset(); EQ_Module.resetEQ(); TestLab_Module.stopAll(); PEQDB_Module.clearState(); this.updateAll();
        },
        saveConfig: async function() {
            try {
                const brand = (document.getElementById('brand')?.value || '').trim();
                const model = (document.getElementById('model')?.value || '').trim() || "Workstation";
                const baseName = brand ? `${brand}_${model}` : model;

                const sliderValues = {};
                this.sliderNodes.forEach(n => {
                    if (n.element && n.element.id) sliderValues[n.element.id] = n.element.value;
                });

                const currentWorkspace = {
                    brand: document.getElementById('brand')?.value || '',
                    model: document.getElementById('model')?.value || '',
                    price: document.getElementById('price')?.value || '',
                    refVolume: document.getElementById('listening-volume')?.value || 'moderate',
                    impedance: document.getElementById('impedance')?.value || '5',
                    sensitivity: document.getElementById('sensitivity')?.value || '80',
                    notes: document.getElementById('review-notes')?.value || '',
                    image: this.currentImage,
                    selectedTags: Array.from(this.selectedTags || []),
                    selectedGenres: Array.from(this.selectedGenres || []),
                    selectedBass: Array.from(this.selectedBass || []),
                    sliders: sliderValues,
                    selectedDriverTypes: this.selectedDriverTypes || {},
                    formFactor: this.formFactor || 'IEM',
                    connector: this.connector || '2-pin',
                    crossoverOverride: this.crossoverOverride || false,
                    wayOverride: this.wayOverride || false,
                    currentCrossover: this.currentCrossover || 'UNK',
                    currentWay: this.currentWay || 'UNK',
                    toneData: Tone_Module.getState(),
                    eqData: EQ_Module.getRealValues()
                };

                const fullBackup = {
                    backupType: "full_workstation_backup",
                    activeWorkspace: currentWorkspace,
                    library: await this.getLibrary()
                };

                const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName.replace(/[\s/\\?%*:|"<>]+/g, '_')}_backup.json`;
                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast("Workstation backup exported!", "📥");
            } catch (err) {
                console.error("Export failed:", err);
                showToast("Failed to export backup.", "⚠️");
            }
        },
        loadProfileData: function(data) {
            if (!data) return;

            if (document.getElementById('brand')) document.getElementById('brand').value = data.brand || '';
            if (document.getElementById('model')) document.getElementById('model').value = data.model || '';
            if (document.getElementById('price')) document.getElementById('price').value = data.price || '';
            if (data.refVolume) this.setListeningVolume(data.refVolume);

            if (document.getElementById('impedance')) {
                document.getElementById('impedance').value = data.impedance || '5';
                document.getElementById('impedance-slider').value = data.impedance || '5';
            }
            if (document.getElementById('sensitivity')) {
                document.getElementById('sensitivity').value = data.sensitivity || '80';
                document.getElementById('sensitivity-slider').value = data.sensitivity || '80';
            }
            if (document.getElementById('review-notes')) document.getElementById('review-notes').value = data.notes || '';

            if (data.image) {
                this._restoreStoredImage(data.image);
            } else {
                this.clearImage();
            }

            if (data.sensUnit && (data.sensUnit === 'mW' || data.sensUnit === 'V')) {
                this.sensUnit = data.sensUnit;
                this.updateSensUnitUI();
            }

            this.selectedDriverTypes = data.selectedDriverTypes || {};
            this.crossoverOverride = data.crossoverOverride || false;
            this.wayOverride = data.wayOverride || false;
            this.currentCrossover = data.currentCrossover || 'UNK';
            this.currentWay = data.currentWay || 'UNK';
            this.updateCrossoverButtonsUI();
            this.updateWayButtonsUI();
            this.updateDriverSummary();
            if (data.formFactor) this.setFormFactor(data.formFactor);
            if (data.connector) this.setConnector(data.connector);

            this.selectedTags = new Set(data.selectedTags || []);
            this.createTags('tonality-tags', this.tonalityTags, this.selectedTags);

            this.selectedGenres = new Set(data.selectedGenres || []);
            this.createTags('genre-tags', this.genreTags, this.selectedGenres);

            this.selectedBass = new Set(data.selectedBass || []);
            this.createTags('bass-tags', this.bassTags, this.selectedBass);

            if (data.sliders) {
                this.sliderNodes.forEach(n => {
                    if (data.sliders[n.element.id] !== undefined) {
                        n.element.value = data.sliders[n.element.id];
                    }
                });
            }

            if (data.toneData) Tone_Module.loadState(data.toneData);
            if (data.eqData) EQ_Module.loadValues(data.eqData);

            if (window.syncGlobalSliders) window.syncGlobalSliders();
            this.updateAll();
        },
        loadConfigDirect: function(data) {
            this.loadProfileData(data);
        },
        importConfig: function(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    let rawText = ev.target.result;
                    rawText = rawText.replace(/^\uFEFF/, '').trim();
                    const data = JSON.parse(rawText);

                    if (data && data.backupType === undefined && data.hasOwnProperty('activeCurves') === false && (data.library !== undefined || data.eqData !== undefined || data.sliders !== undefined)) {
                        if (data.eqData || data.sliders) {
                            if (data.library && Array.isArray(data.library)) {
                                for (let i = 0; i < data.library.length; i++) {
                                    await DBCache.saveReview(data.library[i]);
                                }
                            }
                            const workspaceToLoad = data.activeWorkspace || data;
                            this.loadProfileData(workspaceToLoad);
                            await this.renderLibrary();
                            showToast("Workspace and library restored!", "📥");
                        } else {
                            this.loadProfileData(data);
                            showToast("Loaded profile successfully!", "📥");
                        }
                    } else if (data && data.backupType === "full_workstation_backup" || (data && data.hasOwnProperty('library') && Array.isArray(data.library))) {
                        if (data.library && Array.isArray(data.library)) {
                            for (let i = 0; i < data.library.length; i++) {
                                await DBCache.saveReview(data.library[i]);
                            }
                        }
                        if (data.activeWorkspace) {
                            this.loadProfileData(data.activeWorkspace);
                        }
                        await this.renderLibrary();
                        showToast("Workstation backup restored successfully!", "📥");
                    } else {
                        this.loadProfileData(data);
                        const nameLabel = (data.brand || data.model) ? `${data.brand || ''} ${data.model || ''}` : "Profile";
                        showToast(`Loaded ${nameLabel.trim()} successfully!`, "📥");
                    }
                } catch (err) {
                    console.error("Import parsing crash:", err);
                    showToast("Failed to parse file.", "⚠️");
                }
            };
            reader.readAsText(file);
            event.target.value = '';
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
        selectExportColor: function(color) {
            this.exportColor = color;
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
            colors.forEach(c => {
                const btn = document.getElementById('exp-col-' + c);
                if (btn) {
                    if (c === color) {
                        btn.style.borderColor = '#ffffff';
                        btn.style.transform = 'scale(1.1)';
                    } else {
                        btn.style.borderColor = 'transparent';
                        btn.style.transform = 'scale(1)';
                    }
                }
            });
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
            const selectedFontFamily = IEM_Module.exportFont || localStorage.getItem('settings_font_id') || 'Silkscreen';

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
                bgBody: v['--bg-window'] || v['--bg-body'] || '#111115',
                bgCard: v['--bg-card'] || '#202028',
                bgInput: v['--bg-input'] || '#181822',
                textMain: v['--text-main'] || '#f0f0f4',
                textSecondary: v['--text-secondary'] || '#8c8c9e',
                accent: v['--accent-blue'] || '#6488b0',
                border: '#000000'
            };

            const canvas = document.createElement('canvas');
            canvas.width = 2400;
            canvas.height = 1600;
            const ctx = canvas.getContext('2d');

            ctx.imageSmoothingEnabled = false;
            ctx.scale(2, 2);

            ctx.fillStyle = currentTheme.bgBody;
            ctx.fillRect(0, 0, 1200, 800);

            ctx.save();
            ctx.lineWidth = 2;

            if (selectedThemeId === 'parchment') {
                ctx.save();
                ctx.strokeStyle = 'rgba(26, 17, 5, 0.15)';
                ctx.lineWidth = 2;
                for (let x = 0; x < 1200; x += 36) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 800); ctx.stroke();
                }
                for (let y = 0; y < 800; y += 36) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
                }
                ctx.strokeStyle = 'rgba(26, 17, 5, 0.05)';
                ctx.lineWidth = 2;
                for (let i = -800; i < 2000; i += 8) {
                    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 800, 800); ctx.stroke();
                }
                ctx.restore();
            } else if (selectedThemeId === 'ember') {
                ctx.save();
                ctx.strokeStyle = 'rgba(200, 75, 75, 0.15)';
                ctx.lineWidth = 2;
                for (let i = -800; i < 2000; i += 20) {
                    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 800, 800); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - 800, 800); ctx.stroke();
                }
                ctx.restore();
            } else if (selectedThemeId === 'circuit') {
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
                ctx.lineWidth = 1;
                for (let r = 32; r < 1200; r += 32) {
                    ctx.beginPath();
                    ctx.ellipse(600, 400, r, r * 0.6, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
                ctx.lineWidth = 1;
                for (let x = 0; x < 1200; x += 48) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 800); ctx.stroke();
                }
                for (let y = 0; y < 800; y += 48) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
                }
                ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
                for (let x = 0; x < 1200; x += 64) {
                    for (let y = 0; y < 800; y += 64) {
                        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
                    }
                }
                ctx.restore();
            } else if (selectedThemeId === 'byte') {
                ctx.save();
                const radGrad = ctx.createRadialGradient(600, 400, 10, 600, 400, 600);
                radGrad.addColorStop(0, 'rgba(80, 255, 100, 0.12)');
                radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = radGrad;
                ctx.fillRect(0, 0, 1200, 800);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                for (let y = 0; y < 800; y += 5) {
                    ctx.fillRect(0, y, 1200, 2);
                }
                ctx.restore();
            } else if (selectedThemeId === 'cartridge') {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                for (let i = -800; i < 2000; i += 24) {
                    ctx.beginPath();
                    ctx.moveTo(i, 0);
                    ctx.lineTo(i + 12, 0);
                    ctx.lineTo(i + 812, 800);
                    ctx.lineTo(i + 800, 800);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                for (let y = 0; y < 800; y += 4) {
                    ctx.fillRect(0, y, 1200, 2);
                }
                ctx.restore();
            } else if (selectedThemeId === 'arcade') {
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
                ctx.lineWidth = 2;
                for (let y = 0; y < 800; y += 16) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
                    const offset = (y / 16) % 2 === 0 ? 0 : 16;
                    for (let x = offset; x < 1200; x += 32) {
                        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke();
                    }
                }
                ctx.restore();
            } else if (selectedThemeId === 'blush') {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
                for (let x = 0; x < 1200; x += 20) {
                    for (let y = 0; y < 800; y += 20) {
                        if (((x / 20) + (y / 20)) % 2 === 0) {
                            ctx.fillRect(x, y, 10, 10);
                        }
                    }
                }
                ctx.restore();
            } else if (selectedThemeId === 'bit') {
                ctx.save();
                ctx.fillStyle = 'rgba(202, 159, 51, 0.14)';
                for (let x = 0; x < 1200; x += 20) {
                    ctx.fillRect(x, 0, 3, 800);
                }
                for (let y = 0; y < 800; y += 20) {
                    ctx.fillRect(0, y, 1200, 3);
                }
                ctx.fillStyle = 'rgba(202, 159, 51, 0.35)';
                for (let x = 0; x < 1200; x += 20) {
                    for (let y = 10; y < 800; y += 20) {
                        ctx.beginPath();
                        ctx.arc(x + 11.5, y + 11.5, 2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.restore();
            } else {
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.lineWidth = 2;
                for (let x = 0; x < 1200; x += 32) {
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 800); ctx.stroke();
                }
                for (let y = 0; y < 800; y += 32) {
                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
                }
                ctx.restore();
            }
            ctx.restore();

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
                ctx.fillStyle = currentTheme.bgCard;
                ctx.strokeStyle = currentTheme.border;
                ctx.lineWidth = 3;
                ctx.fillRect(40, y, 250, h);
                ctx.strokeRect(40, y, 250, h);

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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(40, 270, 250, 85);
            ctx.strokeRect(40, 270, 250, 85);

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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(40, 365, 250, 160);
            ctx.strokeRect(40, 365, 250, 160);

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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(40, 535, 250, 225);
            ctx.strokeRect(40, 535, 250, 225);

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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(310, 120, 540, 640);
            ctx.strokeRect(310, 120, 540, 640);

            const liveBiasBadge = document.getElementById('bias-badge');
            const biasText = liveBiasBadge ? liveBiasBadge.textContent.trim() : '⚖️ Neutral';

            ctx.save();
            ctx.font = `bold 12px ${activeFont}`;
            const biasTextWidth = ctx.measureText(biasText).width;
            const biasBoxW = Math.max(120, Math.min(480, biasTextWidth + 32));
            const biasBoxH = 30;
            const biasBoxX = 310 + (540 - biasBoxW) / 2;
            const biasBoxY = 132;

            ctx.fillStyle = selectedThemeId === 'parchment' ? '#a39169' : (currentTheme.bgInput || currentTheme.bgCard);
ctx.strokeStyle = currentTheme.border;
ctx.lineWidth = 2;
ctx.fillRect(biasBoxX, biasBoxY, biasBoxW, biasBoxH);
            ctx.strokeRect(biasBoxX, biasBoxY, biasBoxW, biasBoxH);

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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(870, 120, 290, 90);
            ctx.strokeRect(870, 120, 290, 90);

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
            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.accent;
            ctx.lineWidth = 3;
            ctx.fillRect(gx, gy, gw, gh);
            ctx.strokeRect(gx, gy, gw, gh);

            ctx.fillStyle = currentTheme.accent;
            ctx.fillRect(gx - 3, gy - 3, 6, 6);
            ctx.fillRect(gx + gw - 3, gy - 3, 6, 6);
            ctx.fillRect(gx - 3, gy + gh - 3, 6, 6);
            ctx.fillRect(gx + gw - 3, gy + gh - 3, 6, 6);

            ctx.fillStyle = currentTheme.textMain;
            ctx.font = `bold 24px ${activeFont}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(gradeText, gx + gw / 2, gy + gh / 2);
            ctx.restore();

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(870, 220, 290, 210);
            ctx.strokeRect(870, 220, 290, 210);

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

                ctx.strokeStyle = currentTheme.border;
                ctx.lineWidth = 2;
                ctx.strokeRect(885, 235, 260, 180);
            } else {
                ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
                ctx.fillRect(885, 235, 260, 180);
                ctx.strokeStyle = currentTheme.border;
                ctx.lineWidth = 2;
                ctx.strokeRect(885, 235, 260, 180);

                ctx.fillStyle = currentTheme.textSecondary;
                ctx.font = `32px ${activeFont}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("📷", 1015, 325);
                ctx.textAlign = "left";
                ctx.textBaseline = "alphabetic";
            }

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(870, 440, 290, 160);
            ctx.strokeRect(870, 440, 290, 160);

            ctx.fillStyle = currentTheme.accent;
            ctx.font = `bold 9px ${activeFont}`;
            ctx.fillText("COMPATIBILITY", 890, 464);

            let impVal = parseFloat(document.getElementById('impedance').value);
            if (isNaN(impVal) || impVal <= 0) impVal = 5;
            let sensVal = parseFloat(document.getElementById('sensitivity').value);
            if (isNaN(sensVal)) sensVal = 80;

            let pReqIemExport, vReq;
            if (this.sensUnit === 'V') {
                vReq = Math.pow(10, (115 - sensVal) / 20);
                pReqIemExport = (vReq * vReq / impVal) * 1000;
            } else {
                pReqIemExport = Math.pow(10, (115 - sensVal) / 10);
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
                { id: 'Amp', emoji: '🖥️' }
            ];

            let guideY = 485;
            dacTiersList.forEach(tier => {
                const dac = dacLimits[tier.id];
                const Rs = dacImpedances[tier.id] || 1.0;
                const vDivider = impVal / (impVal + Rs);
                const vReqSource = vReq / vDivider;
                const pDrawnSource = (vReqSource * vReqSource) / (impVal + Rs) * 1000;

                let text = "POOR", col = "#ef4444", ratio = Math.min(1.0, dac.p / pDrawnSource);

                if (pDrawnSource > dac.p * 1.5 || vReqSource > dac.v * 1.5) {
                    text = "WEAK"; col = "#ef4444"; ratio = Math.max(0.12, Math.min(1.0, dac.p / pDrawnSource));
                } else if (pDrawnSource > dac.p || vReqSource > dac.v) {
                    text = "RISKY"; col = "#f59e0b"; ratio = Math.min(1.0, dac.p / pDrawnSource);
                } else if (pDrawnSource > dac.p * 0.4 || vReqSource > dac.v * 0.4) {
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

            ctx.fillStyle = currentTheme.bgCard;
            ctx.strokeStyle = currentTheme.border;
            ctx.lineWidth = 3;
            ctx.fillRect(870, 610, 290, 150);
            ctx.strokeRect(870, 610, 290, 150);

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
        }
    };
